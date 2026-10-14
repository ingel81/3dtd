import { ClampToEdgeWrapping, DataTexture, LinearFilter, NoColorSpace, RGBAFormat, UnsignedByteType } from 'three';
import type { MapObject } from '../../map-document';
import type { CatalogObject } from '../asset-catalog';
import type { HeightField } from '../height-field';
import { uploadRect } from './texture-ranges';

/**
 * The ground's shape baked onto the height grid, four bytes per sample
 * (RGBA, linearly filtered), all read with the one texture fetch the
 * terrain shader already made:
 *
 * - R, occlusion: how much of the sky the slopes around a sample hide
 *   (horizon angles in eight directions out to 32 m), so hollows, gullies
 *   and the foot of slopes and cliffs darken; times a soft dark spot under
 *   trees, rocks and buildings (contact shadow). The shader multiplies its
 *   ambient light by it (and the direct light a little).
 * - G, curvature: the height against the mean of rings at 4 and 12 m
 *   around it, 0.5 flat, above on crests and knolls, below in hollows and
 *   channels (about +-4 m of difference over the range)
 * - B, drainage: how much ground drains through a sample (D8 flow
 *   accumulation, log scale): runnels and valley floors light up. Baked for
 *   the whole grid on a full update; a brush leaves it until the next one
 * - A, lava: closeness to lava, 1 on it, 0 from 12 m (`setLava`)
 */

const DIRECTIONS = 8;
const STEPS = [2, 4, 8, 16, 32];
/** Queued occlusion waits until the heights rest this long … */
const OCCLUSION_QUIET_MS = 120;
/** … or at most this long */
const OCCLUSION_WAIT_MS = 500;
/** How dark full occlusion gets */
const TERRAIN_STRENGTH = 1.1;

const OBJECT_DARKNESS: Partial<Record<CatalogObject['category'], number>> = {
  tree: 0.4,
  building: 0.55,
  structure: 0.4,
  wall: 0.35,
  rock: 0.35,
  plant: 0.15,
  prop: 0.2,
};

export class GroundOcclusion {
  readonly texture: DataTexture;
  private readonly terrain: Float32Array;
  private readonly objects: Float32Array;
  private readonly pixels: Uint8Array;
  /** Samples whose terrain occlusion waits (horizon reach included), and the next row to do */
  private pending: { i0: number; j0: number; i1: number; j1: number; row: number; since: number; last: number } | null = null;
  private readonly curvature: Float32Array;
  private readonly drainage: Float32Array;
  private readonly lava: Float32Array;

  constructor(private readonly field: HeightField) {
    const n = field.columns * field.rows;
    this.terrain = new Float32Array(n).fill(1);
    this.objects = new Float32Array(n).fill(1);
    this.curvature = new Float32Array(n).fill(0.5);
    this.drainage = new Float32Array(n);
    this.lava = new Float32Array(n);
    this.pixels = new Uint8Array(n * 4).fill(255);
    this.texture = new DataTexture(this.pixels, field.columns, field.rows, RGBAFormat, UnsignedByteType);
    this.texture.colorSpace = NoColorSpace;
    this.texture.wrapS = this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.magFilter = LinearFilter;
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.unpackAlignment = 1;
    this.updateTerrain();
  }

  /** Terrain occlusion of the samples in a rectangle (whole grid when omitted), plus the reach of the horizon search */
  updateTerrain(rect?: { i0: number; j0: number; i1: number; j1: number }): void {
    const r = this.reachOf(rect);
    if (!rect) this.bakeDrainage();
    this.terrainRows(r.i0, r.i1, r.j0, r.j1);
  }

  /**
   * Like updateTerrain, but later: a held brush changes heights every frame,
   * and the horizon search over its rectangle cost a 2 m map some 5 ms each
   * time. The rectangles gather while the changes go on (OCCLUSION_QUIET_MS
   * without one, at most OCCLUSION_WAIT_MS), then `flush` works them off in
   * slices of rows: a stroke costs the search over its area a few times, not
   * once a frame.
   */
  queueTerrain(rect: { i0: number; j0: number; i1: number; j1: number }, now = performance.now()): void {
    const r = this.reachOf(rect);
    const p = this.pending;
    this.pending = p
      ? { i0: Math.min(p.i0, r.i0), j0: Math.min(p.row, r.j0), i1: Math.max(p.i1, r.i1), j1: Math.max(p.j1, r.j1), row: Math.min(p.row, r.j0), since: p.since, last: now }
      : { ...r, row: r.j0, since: now, last: now };
  }

  /** Works off queued occlusion for about `budgetMs` once the changes paused; true while some is left */
  flush(budgetMs: number, now = performance.now()): boolean {
    const p = this.pending;
    if (!p) return false;
    if (now - p.last < OCCLUSION_QUIET_MS && now - p.since < OCCLUSION_WAIT_MS) return true;
    const until = now + budgetMs;
    // A band of rows at a time: the clock is read once a band
    const band = Math.max(1, Math.floor(1024 / (p.i1 - p.i0 + 1)));
    while (p.row <= p.j1) {
      const end = Math.min(p.j1, p.row + band - 1);
      this.terrainRows(p.i0, p.i1, p.row, end);
      p.row = end + 1;
      if (performance.now() > until) break;
    }
    if (p.row > p.j1) this.pending = null;
    // Under a held brush one slice per wait, the rest once it rests
    else p.since = now;
    return !!this.pending;
  }

  private reachOf(rect?: { i0: number; j0: number; i1: number; j1: number }): { i0: number; j0: number; i1: number; j1: number } {
    const f = this.field;
    const reach = Math.ceil(STEPS[STEPS.length - 1] / f.cellSize);
    return {
      i0: Math.max(0, (rect?.i0 ?? 0) - reach),
      j0: Math.max(0, (rect?.j0 ?? 0) - reach),
      i1: Math.min(f.columns - 1, (rect?.i1 ?? f.columns - 1) + reach),
      j1: Math.min(f.rows - 1, (rect?.j1 ?? f.rows - 1) + reach),
    };
  }

  /**
   * The horizon search over rows j0..j1: per sample the highest rise in each
   * direction at each step. The steps are offsets in samples worked out
   * once, the heights read straight from the grid and interpolated on its
   * triangles like HeightField.heightAt (some four times faster than calling
   * it 40 times a sample, which a 2 m map felt under a held brush).
   */
  private terrainRows(i0: number, i1: number, j0: number, j1: number): void {
    const f = this.field;
    const h = f.grid.heights;
    const cols = f.columns;
    const maxX = cols - 1;
    const maxY = f.rows - 1;
    const n = DIRECTIONS * STEPS.length;
    const offX = new Float64Array(n);
    const offY = new Float64Array(n);
    const dist = new Float64Array(n);
    for (let k = 0; k < DIRECTIONS; k++) {
      const a = (k / DIRECTIONS) * Math.PI * 2;
      STEPS.forEach((d, s) => {
        offX[k * STEPS.length + s] = (Math.cos(a) * d) / f.cellSize;
        offY[k * STEPS.length + s] = (Math.sin(a) * d) / f.cellSize;
        dist[k * STEPS.length + s] = d;
      });
    }
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const base = h[j * cols + i];
        let occ = 0;
        for (let k = 0; k < DIRECTIONS; k++) {
          let maxSin = 0;
          for (let s = 0; s < STEPS.length; s++) {
            const q = k * STEPS.length + s;
            let fx = i + offX[q];
            let fy = j + offY[q];
            fx = fx < 0 ? 0 : fx > maxX ? maxX : fx;
            fy = fy < 0 ? 0 : fy > maxY ? maxY : fy;
            let ii = Math.floor(fx);
            let jj = Math.floor(fy);
            if (ii >= maxX) ii = maxX - 1;
            if (jj >= maxY) jj = maxY - 1;
            const u = fx - ii;
            const v = fy - jj;
            const c = jj * cols + ii;
            const h00 = h[c];
            const h11 = h[c + cols + 1];
            const height = u >= v ? h00 + u * (h[c + 1] - h00) + v * (h11 - h[c + 1]) : h00 + v * (h[c + cols] - h00) + u * (h11 - h[c + cols]);
            const rise = height - base;
            if (rise <= 0) continue;
            const d = dist[q];
            const sin = rise / Math.sqrt(rise * rise + d * d);
            if (sin > maxSin) maxSin = sin;
          }
          occ += maxSin;
        }
        this.terrain[j * cols + i] = Math.max(0.25, 1 - (occ / DIRECTIONS) * TERRAIN_STRENGTH);
      }
    }
    // Curvature: above the mean of two rings (grid samples about 4 and 12 m out) is a crest, below a hollow.
    // The rows' reach includes the horizon search's, which is wider than the outer ring
    const r4 = Math.max(1, Math.round(4 / f.cellSize));
    const r12 = Math.max(2, Math.round(12 / f.cellSize));
    const near = r4 * 2;
    const rings: [number, number][] = [];
    for (let k = 0; k < DIRECTIONS; k++) {
      const a = (k / DIRECTIONS) * Math.PI * 2;
      rings.push([Math.round(Math.cos(a) * r4), Math.round(Math.sin(a) * r4)], [Math.round(Math.cos(a) * r12), Math.round(Math.sin(a) * r12)]);
    }
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        let ring = 0;
        for (const [di, dj] of rings) ring += f.sample(i + di, j + dj) * (Math.abs(di) + Math.abs(dj) > near ? 0.4 : 0.6);
        this.curvature[j * cols + i] = Math.max(0, Math.min(1, 0.5 + (h[j * cols + i] - ring / DIRECTIONS) * 0.125));
      }
    }
    this.upload(i0, j0, i1, j1);
  }

  /**
   * Closeness to lava per sample: `lava` marks the samples under lava (1)
   * or not (0); 1 there, falling off to 0 at 12 m. Lights the ground from
   * below and turns it to cooled rock around flows and pools.
   */
  setLava(lava: Uint8Array): void {
    const f = this.field;
    const cols = f.columns;
    const rows = f.rows;
    const reach = 12 / f.cellSize;
    // Distance in cells (chamfer 3-4) from the lava samples
    const d = new Float32Array(cols * rows);
    for (let k = 0; k < d.length; k++) d[k] = lava[k] ? 0 : 1e9;
    const relax = (k: number, o: number, step: number): void => {
      if (d[o] + step < d[k]) d[k] = d[o] + step;
    };
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        if (i > 0) relax(k, k - 1, 3);
        if (j > 0) {
          relax(k, k - cols, 3);
          if (i > 0) relax(k, k - cols - 1, 4);
          if (i < cols - 1) relax(k, k - cols + 1, 4);
        }
      }
    }
    for (let j = rows - 1; j >= 0; j--) {
      for (let i = cols - 1; i >= 0; i--) {
        const k = j * cols + i;
        if (i < cols - 1) relax(k, k + 1, 3);
        if (j < rows - 1) {
          relax(k, k + cols, 3);
          if (i < cols - 1) relax(k, k + cols + 1, 4);
          if (i > 0) relax(k, k + cols - 1, 4);
        }
      }
    }
    for (let k = 0; k < d.length; k++) this.lava[k] = Math.max(0, 1 - d[k] / 3 / reach);
    this.upload(0, 0, cols - 1, rows - 1);
  }

  /**
   * D8 flow accumulation over the whole grid: every sample drains into its
   * steepest lower neighbour; the accumulation runs from the samples nothing
   * drains into down to the outlets (Kahn's order, linear in the grid)
   */
  private bakeDrainage(): void {
    const f = this.field;
    const cols = f.columns;
    const rows = f.rows;
    const n = cols * rows;
    const h = f.grid.heights;
    const to = new Int32Array(n).fill(-1);
    const inflow = new Uint8Array(n);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        let drop = 0;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= rows) continue;
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            if ((!di && !dj) || ii < 0 || ii >= cols) continue;
            const o = jj * cols + ii;
            const g = (h[k] - h[o]) * (di && dj ? Math.SQRT1_2 : 1);
            if (g > drop) {
              drop = g;
              to[k] = o;
            }
          }
        }
        if (to[k] >= 0) inflow[to[k]]++;
      }
    }
    const acc = new Float32Array(n).fill(1);
    const queue = new Int32Array(n);
    let head = 0;
    let tail = 0;
    for (let k = 0; k < n; k++) if (!inflow[k]) queue[tail++] = k;
    while (head < tail) {
      const k = queue[head++];
      const o = to[k];
      if (o < 0) continue;
      acc[o] += acc[k];
      if (--inflow[o] === 0) queue[tail++] = o;
    }
    // Log scale: a few cells upslope already show, a valley floor of thousands saturates
    const top = Math.log(Math.max(2, n / 16));
    for (let k = 0; k < n; k++) this.drainage[k] = Math.min(1, Math.log(acc[k]) / top);
  }

  /**
   * Contact shadows of the placed objects (replaces the previous ones). With
   * a sample rectangle only the samples in it are redone, from the objects
   * that reach into it: an object placed or removed costs its own spot.
   */
  setObjects(
    objects: MapObject[],
    entries: Map<string, CatalogObject>,
    rect?: { i0: number; j0: number; i1: number; j1: number },
  ): void {
    const f = this.field;
    const i0 = Math.max(0, rect?.i0 ?? 0);
    const j0 = Math.max(0, rect?.j0 ?? 0);
    const i1 = Math.min(f.columns - 1, rect?.i1 ?? f.columns - 1);
    const j1 = Math.min(f.rows - 1, rect?.j1 ?? f.rows - 1);
    if (i0 > i1 || j0 > j1) return;
    if (rect) {
      for (let j = j0; j <= j1; j++) this.objects.fill(1, j * f.columns + i0, j * f.columns + i1 + 1);
    } else {
      this.objects.fill(1);
    }
    // With a rectangle, objects far from it are passed over before their catalogue entry is looked up
    let reach = 0;
    if (rect) for (const e of entries.values()) reach = Math.max(reach, e.footprint * 1.5);
    const minX = f.originX + i0 * f.cellSize;
    const maxX = f.originX + i1 * f.cellSize;
    const minY = f.originY + j0 * f.cellSize;
    const maxY = f.originY + j1 * f.cellSize;
    for (const o of objects) {
      if (rect) {
        const r = reach * (o.scale || 1);
        if (o.x + r < minX || o.x - r > maxX || o.y + r < minY || o.y - r > maxY) continue;
      }
      const e = entries.get(o.asset);
      const dark = e ? OBJECT_DARKNESS[e.category] : undefined;
      if (!e || !dark || e.footprint <= 0) continue;
      const r = e.footprint * (o.scale || 1) * 1.5;
      const ci = (o.x - f.originX) / f.cellSize;
      const cj = (o.y - f.originY) / f.cellSize;
      const rc = r / f.cellSize;
      for (let j = Math.max(j0, Math.floor(cj - rc)); j <= Math.min(j1, Math.ceil(cj + rc)); j++) {
        for (let i = Math.max(i0, Math.floor(ci - rc)); i <= Math.min(i1, Math.ceil(ci + rc)); i++) {
          const d = Math.hypot(i - ci, j - cj) / rc;
          if (d >= 1) continue;
          const t = 1 - d;
          const k = j * f.columns + i;
          this.objects[k] *= 1 - dark * t * t * (3 - 2 * t);
        }
      }
    }
    this.upload(i0, j0, i1, j1);
  }

  /** Occlusion at sample (i, j), 0 dark to 1 open */
  at(i: number, j: number): number {
    return this.pixels[(j * this.field.columns + i) * 4] / 255;
  }

  /** Curvature, drainage and lava at sample (i, j), 0..1 as baked (curvature 0.5 flat) */
  shapeAt(i: number, j: number): { curvature: number; drainage: number; lava: number } {
    const q = (j * this.field.columns + i) * 4;
    return { curvature: this.pixels[q + 1] / 255, drainage: this.pixels[q + 2] / 255, lava: this.pixels[q + 3] / 255 };
  }

  dispose(): void {
    this.texture.dispose();
  }

  private upload(i0: number, j0: number, i1: number, j1: number): void {
    const cols = this.field.columns;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * cols + i;
        const q = k * 4;
        this.pixels[q] = Math.round(Math.max(0, Math.min(1, this.terrain[k] * this.objects[k])) * 255);
        this.pixels[q + 1] = Math.round(this.curvature[k] * 255);
        this.pixels[q + 2] = Math.round(this.drainage[k] * 255);
        this.pixels[q + 3] = Math.round(this.lava[k] * 255);
      }
    }
    const whole = i0 === 0 && j0 === 0 && i1 === cols - 1 && j1 === this.field.rows - 1;
    uploadRect(this.texture, whole ? undefined : { i0, j0, i1, j1 });
  }
}
