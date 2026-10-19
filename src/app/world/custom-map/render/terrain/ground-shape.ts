/**
 * The ground's shape worked out from the height grid, without three: the
 * horizon occlusion and curvature of a rectangle of samples, the drainage of
 * the whole grid, the closeness to lava and the land's far shadow. GroundOcclusion packs them into
 * its texture; the game works them out in place as the map loads, the
 * editor in its worker (editor/workers/editor-core-host.ts) while the map is
 * edited.
 */
import type { MapTerrain } from '../../map-document';
import { cellHeight, type HeightField } from '../height-field';
import { sampleRiver } from '../water/river-line';
import type { PathMaskInput } from '../paths/path-mask';

const DIRECTIONS = 8;
const STEPS = [2, 4, 8, 16, 32];
/** How dark full occlusion gets */
const TERRAIN_STRENGTH = 1.1;
/** Metres from lava where its closeness falls to 0 */
const LAVA_REACH = 12;

export interface SampleRect {
  i0: number;
  j0: number;
  i1: number;
  j1: number;
}

/**
 * Occlusion (0..1) and curvature (a byte, 128 flat) of `rect` (row by row) on a grid of `columns` x `rows`, with
 * the drainage (bytes) of a whole update
 */
export interface ShapePatch {
  columns: number;
  rows: number;
  rect: SampleRect;
  terrain: Float32Array;
  curvature: Uint8Array;
  drainage?: Uint8Array;
}

/** The far shadow's texels (farShadowData) */
export interface FarShadowTexels {
  data: Uint8Array;
  columns: number;
  rows: number;
}

/**
 * Who works the ground's shape out off the page's thread (the editor's
 * worker, from the map as it is when asked). Each answers null when a newer
 * request took its place. Without one the view works it out in place.
 */
export interface GroundBaker {
  /** Occlusion and curvature of the samples of `rect` (its reach included by the asker); null: all, with the drainage */
  shape(rect: SampleRect | null): Promise<ShapePatch | null>;
  /** Closeness to lava per sample (bytes), and whether there is lava at all */
  lava(): Promise<{ closeness: Uint8Array; any: boolean } | null>;
  /** The far shadow for the sun in `sunDir` (scene space, towards the sun) */
  farShadow(sunDir: { x: number; y: number; z: number }): Promise<FarShadowTexels | null>;
  /** The whole path mask (path-mask.ts) of a map that loads; missing: painted in place */
  pathMask?(input: PathMaskInput): Promise<Uint8Array | null>;
  /**
   * The heights of `rect` changed (MapTerrainLayer.rebuild): a baker that works on a copy of its own takes them
   * before the next job (GroundWorker). Missing: it reads the map as it is (the editor's mirror)
   */
  heightsChanged?(heights: Float32Array, columns: number, rect: SampleRect | null): void;
}

/** Occlusion and curvature of `rect` (and the drainage when `rect` is null: all of the grid) worked out at once */
export function shapePatch(field: HeightField, rect: SampleRect | null, terrain?: Float32Array, curvature?: Uint8Array): ShapePatch {
  const n = field.columns * field.rows;
  const t = terrain && terrain.length === n ? terrain : new Float32Array(n);
  const c = curvature && curvature.length === n ? curvature : new Uint8Array(n);
  const r = rect ?? { i0: 0, j0: 0, i1: field.columns - 1, j1: field.rows - 1 };
  shapeRows(field, t, c, r.i0, r.i1, r.j0, r.j1);
  const w = r.i1 - r.i0 + 1;
  const out = { terrain: new Float32Array(w * (r.j1 - r.j0 + 1)), curvature: new Uint8Array(w * (r.j1 - r.j0 + 1)) };
  for (let j = r.j0; j <= r.j1; j++) {
    const from = j * field.columns + r.i0;
    out.terrain.set(t.subarray(from, from + w), (j - r.j0) * w);
    out.curvature.set(c.subarray(from, from + w), (j - r.j0) * w);
  }
  return { columns: field.columns, rows: field.rows, rect: r, ...out, ...(rect ? {} : { drainage: drainage(field) }) };
}

/** The samples the occlusion of `rect` (the whole grid when omitted) changes: it plus the horizon search's reach */
export function shapeReach(field: HeightField, rect?: SampleRect): SampleRect {
  const reach = Math.ceil(STEPS[STEPS.length - 1] / field.cellSize);
  return {
    i0: Math.max(0, (rect?.i0 ?? 0) - reach),
    j0: Math.max(0, (rect?.j0 ?? 0) - reach),
    i1: Math.min(field.columns - 1, (rect?.i1 ?? field.columns - 1) + reach),
    j1: Math.min(field.rows - 1, (rect?.j1 ?? field.rows - 1) + reach),
  };
}

/**
 * Occlusion and curvature of rows j0..j1 (columns i0..i1) into the grid's
 * `terrain` and `curvature` arrays (curvature as a byte, 128 flat). Occlusion: per sample the highest rise
 * in each direction at each step, the steps offsets in samples worked out
 * once, the heights read straight from the grid and interpolated on its
 * triangles like HeightField.heightAt (some four times faster than calling
 * it 40 times a sample). Curvature: the height against the mean of two
 * rings (grid samples about 4 and 12 m out), above a crest, below a hollow.
 */
export function shapeRows(field: HeightField, terrain: Float32Array, curvature: Uint8Array, i0: number, i1: number, j0: number, j1: number): void {
  const f = field;
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
          const height = cellHeight(h[c], h[c + 1], h[c + cols], h[c + cols + 1], u, v);
          const rise = height - base;
          if (rise <= 0) continue;
          const d = dist[q];
          const sin = rise / Math.sqrt(rise * rise + d * d);
          if (sin > maxSin) maxSin = sin;
        }
        occ += maxSin;
      }
      terrain[j * cols + i] = Math.max(0.25, 1 - (occ / DIRECTIONS) * TERRAIN_STRENGTH);
    }
  }
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
      curvature[j * cols + i] = Math.round(Math.max(0, Math.min(1, 0.5 + (h[j * cols + i] - ring / DIRECTIONS) * 0.125)) * 255);
    }
  }
}

/**
 * D8 flow accumulation over the whole grid, log scale as bytes: every sample
 * drains into its steepest lower neighbour; the accumulation runs from the
 * samples nothing drains into down to the outlets (Kahn's order, linear in
 * the grid)
 */
export function drainage(field: HeightField): Uint8Array {
  const cols = field.columns;
  const rows = field.rows;
  const n = cols * rows;
  const h = field.grid.heights;
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
  const out = new Uint8Array(n);
  for (let k = 0; k < n; k++) out[k] = Math.round(Math.min(1, Math.log(acc[k]) / top) * 255);
  return out;
}

/** The samples under lava (1) or not (0): lava bodies below their level, lava rivers along their width */
export function lavaSamples(t: Pick<MapTerrain, 'water' | 'waterBodies' | 'rivers'>, field: HeightField): Uint8Array {
  const f = field;
  const lava = new Uint8Array(f.columns * f.rows);
  for (const body of [t.water, ...(t.waterBodies ?? [])]) {
    if (!body || body.kind !== 'lava') continue;
    for (let k = 0; k < lava.length; k++) {
      if (body.mask[k] && f.grid.heights[k] < body.level) lava[k] = 1;
    }
  }
  for (const r of t.rivers ?? []) {
    if (r.kind !== 'lava' || r.points.length < 2) continue;
    for (const p of sampleRiver(r.points)) {
      const reach = Math.ceil(p.width / 2 / f.cellSize);
      const ci = Math.round((p.x - f.originX) / f.cellSize);
      const cj = Math.round((p.y - f.originY) / f.cellSize);
      for (let j = Math.max(0, cj - reach); j <= Math.min(f.rows - 1, cj + reach); j++) {
        for (let i = Math.max(0, ci - reach); i <= Math.min(f.columns - 1, ci + reach); i++) {
          if (Math.hypot(i - ci, j - cj) * f.cellSize <= p.width / 2) lava[j * f.columns + i] = 1;
        }
      }
    }
  }
  return lava;
}

/** Closeness to the `lava` samples as bytes: 255 on them, falling off to 0 at LAVA_REACH metres (chamfer 3-4 distance) */
export function lavaCloseness(lava: Uint8Array, field: HeightField): Uint8Array {
  const cols = field.columns;
  const rows = field.rows;
  const reach = LAVA_REACH / field.cellSize;
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
  const out = new Uint8Array(cols * rows);
  for (let k = 0; k < d.length; k++) out[k] = Math.round(Math.max(0, 1 - d[k] / 3 / reach) * 255);
  return out;
}

// The far shadow of the land (far-shadow.ts FarShadow draws it)

/** Texels along the map's longer side */
const SIZE = 256;
/** How far the march looks for land in the way, metres */
const REACH = 1200;

/** Visibility of the sun (0 shadow, 255 lit) over the map, `width` x `height` texels row by row from the map's south west */
export function farShadowData(field: HeightField, sunDir: { x: number; y: number; z: number }, width: number, depth: number): FarShadowTexels {
  const out = farShadowStart(sunDir, width, depth);
  farShadowRows(field, sunDir, width, depth, out, 0, out.rows);
  return out;
}

/** The far shadow's texels, all lit (all dark once the sun has set), before farShadowRows marches them */
export function farShadowStart(sunDir: { y: number }, width: number, depth: number): FarShadowTexels {
  const columns = width >= depth ? SIZE : Math.max(2, Math.round((SIZE * width) / depth));
  const rows = depth >= width ? SIZE : Math.max(2, Math.round((SIZE * depth) / width));
  return { data: new Uint8Array(columns * rows).fill(sunDir.y <= 0.01 ? 0 : 255), columns, rows };
}

/** Rows j0 up to j1 of the far shadow, marched towards the sun (one band of a bake spread over frames) */
export function farShadowRows(
  field: HeightField,
  sunDir: { x: number; y: number; z: number },
  width: number,
  depth: number,
  out: FarShadowTexels,
  j0: number,
  j1: number,
): void {
  const { data, columns, rows } = out;
  // The sun's direction on the map (scene x is map -x, scene z map y), its rise per metre along it
  const horizontal = Math.hypot(sunDir.x, sunDir.z);
  if (sunDir.y <= 0.01 || horizontal < 1e-4) return;
  const dx = -sunDir.x / horizontal;
  const dy = sunDir.z / horizontal;
  const rise = sunDir.y / horizontal;
  const cellX = width / columns;
  const cellY = depth / rows;
  const first = Math.max(field.cellSize, Math.min(cellX, cellY)) * 0.75;
  const reach = Math.min(REACH, Math.hypot(width, depth));
  const halfW = width / 2;
  const halfD = depth / 2;
  for (let j = j0; j < Math.min(j1, rows); j++) {
    const y = -halfD + (j + 0.5) * cellY;
    for (let i = 0; i < columns; i++) {
      const x = -halfW + (i + 0.5) * cellX;
      const h0 = field.heightAt(x, y) + 0.5;
      let lit = 1;
      for (let t = first; t < reach; t *= 1.06) {
        const px = x + dx * t;
        const py = y + dy * t;
        if (px < -halfW || px > halfW || py < -halfD || py > halfD) break;
        const above = h0 + t * rise - field.heightAt(px, py);
        // Soft: how far below the ray the land stays, against the distance (a penumbra widening with it)
        const k = above / (t * 0.04 + 0.5);
        if (k < lit) {
          lit = k;
          if (lit <= 0) break;
        }
      }
      data[j * columns + i] = Math.round(Math.max(0, lit) * 255);
    }
  }
}
