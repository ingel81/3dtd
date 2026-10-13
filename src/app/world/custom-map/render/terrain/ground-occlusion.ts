import { ClampToEdgeWrapping, DataTexture, LinearFilter, NoColorSpace, RedFormat, UnsignedByteType } from 'three';
import type { MapObject } from '../../map-document';
import type { CatalogObject } from '../asset-catalog';
import type { HeightField } from '../height-field';
import { uploadRect } from './texture-ranges';

/**
 * Ambient occlusion baked onto the height grid, one value per sample:
 *
 * - terrain: how much of the sky the slopes around a sample hide (horizon
 *   angles in eight directions out to 32 m), so hollows, gullies and the
 *   foot of slopes and cliffs darken
 * - objects: a soft dark spot under trees, rocks and buildings (contact
 *   shadow), as wide as their footprint and a bit more
 *
 * The terrain shader multiplies its ambient light by it (and the direct
 * light a little). One byte per sample, linearly filtered.
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

  constructor(private readonly field: HeightField) {
    const n = field.columns * field.rows;
    this.terrain = new Float32Array(n).fill(1);
    this.objects = new Float32Array(n).fill(1);
    this.pixels = new Uint8Array(n).fill(255);
    this.texture = new DataTexture(this.pixels, field.columns, field.rows, RedFormat, UnsignedByteType);
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
    this.upload(i0, j0, i1, j1);
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
    return this.pixels[j * this.field.columns + i] / 255;
  }

  dispose(): void {
    this.texture.dispose();
  }

  private upload(i0: number, j0: number, i1: number, j1: number): void {
    const cols = this.field.columns;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * cols + i;
        this.pixels[k] = Math.round(Math.max(0, Math.min(1, this.terrain[k] * this.objects[k])) * 255);
      }
    }
    const whole = i0 === 0 && j0 === 0 && i1 === cols - 1 && j1 === this.field.rows - 1;
    uploadRect(this.texture, whole ? undefined : { i0, j0, i1, j1 });
  }
}
