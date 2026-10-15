/**
 * Rasters for the land and water stages of an OSM world: areas filled onto a
 * square grid of cells (the height samples, the splat texels or a coarser
 * grid), distances to a mask, and lines stamped with a width. A grid of `n`
 * cells per side has cell `i` at `origin + i * step` (its centre for texels,
 * its sample point for heights).
 */
import type { MapPoint } from '../../custom-map/map-document';

export interface RasterGrid {
  n: number;
  /** Map metres of cell 0 */
  origin: number;
  step: number;
}

/** The grid of a terrain's height samples */
export function sampleGrid(side: number, cellSize: number): RasterGrid {
  return { n: Math.round(side / cellSize) + 1, origin: -side / 2, step: cellSize };
}

/** A grid of `n` texels over a map of `side` metres, cells at their centres */
export function texelGrid(side: number, n: number): RasterGrid {
  return { n, origin: -side / 2 + side / n / 2, step: side / n };
}

/**
 * Visits every cell whose point lies inside the rings (even-odd rule: an
 * inner ring cuts a hole, as do overlapping outer rings of one area). One
 * scanline per row, spans between the crossings.
 */
export function fillRings(rings: readonly (readonly MapPoint[])[], grid: RasterGrid, visit: (i: number, j: number) => void): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of rings) for (const p of r) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (minY > maxY) return;
  const j0 = Math.max(0, Math.ceil((minY - grid.origin) / grid.step));
  const j1 = Math.min(grid.n - 1, Math.floor((maxY - grid.origin) / grid.step));
  const xs: number[] = [];
  for (let j = j0; j <= j1; j++) {
    const y = grid.origin + j * grid.step;
    xs.length = 0;
    for (const r of rings) {
      for (let k = 0, m = r.length - 1; k < r.length; m = k++) {
        const a = r[m];
        const b = r[k];
        if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let s = 0; s + 1 < xs.length; s += 2) {
      const i0 = Math.max(0, Math.ceil((xs[s] - grid.origin) / grid.step));
      const i1 = Math.min(grid.n - 1, Math.floor((xs[s + 1] - grid.origin) / grid.step));
      for (let i = i0; i <= i1; i++) visit(i, j);
    }
  }
}

/**
 * Visits the cells within `reach(t)` metres of a polyline, with the distance
 * to it and the share along the segment; a cell near two segments is
 * visited for each (the caller keeps the nearest)
 */
export function stampLine(
  line: readonly MapPoint[],
  grid: RasterGrid,
  reach: number,
  visit: (i: number, j: number, dist: number, segment: number, t: number) => void,
): void {
  for (let s = 0; s + 1 < line.length; s++) {
    const p = line[s];
    const q = line[s + 1];
    const i0 = Math.max(0, Math.floor((Math.min(p.x, q.x) - reach - grid.origin) / grid.step));
    const i1 = Math.min(grid.n - 1, Math.ceil((Math.max(p.x, q.x) + reach - grid.origin) / grid.step));
    const j0 = Math.max(0, Math.floor((Math.min(p.y, q.y) - reach - grid.origin) / grid.step));
    const j1 = Math.min(grid.n - 1, Math.ceil((Math.max(p.y, q.y) + reach - grid.origin) / grid.step));
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len2 = dx * dx + dy * dy || 1;
    for (let j = j0; j <= j1; j++) {
      const y = grid.origin + j * grid.step;
      for (let i = i0; i <= i1; i++) {
        const x = grid.origin + i * grid.step;
        const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / len2));
        const d = Math.hypot(x - (p.x + t * dx), y - (p.y + t * dy));
        if (d <= reach) visit(i, j, d, s, t);
      }
    }
  }
}

/**
 * Metres from every cell to the nearest cell where `inside` is false
 * (inside cells get their distance to the outside, outside cells 0), capped
 * at `max`: two chamfer passes (3-4 weights), within about 8 % of the true
 * distance. `inside` null: the distance to the nearest set cell of `mask`
 * instead (set cells 0).
 */
export function distanceField(mask: Uint8Array, n: number, step: number, max: number, inside = true): Float32Array {
  const d = new Float32Array(n * n);
  const far = max / step;
  for (let k = 0; k < d.length; k++) d[k] = (mask[k] !== 0) === inside ? far : 0;
  const a = 1;
  const b = Math.SQRT2;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      let v = d[k];
      if (v === 0) continue;
      if (i > 0) v = Math.min(v, d[k - 1] + a);
      if (j > 0) {
        v = Math.min(v, d[k - n] + a);
        if (i > 0) v = Math.min(v, d[k - n - 1] + b);
        if (i < n - 1) v = Math.min(v, d[k - n + 1] + b);
      }
      d[k] = v;
    }
  }
  for (let j = n - 1; j >= 0; j--) {
    for (let i = n - 1; i >= 0; i--) {
      const k = j * n + i;
      let v = d[k];
      if (v === 0) continue;
      if (i < n - 1) v = Math.min(v, d[k + 1] + a);
      if (j < n - 1) {
        v = Math.min(v, d[k + n] + a);
        if (i < n - 1) v = Math.min(v, d[k + n + 1] + b);
        if (i > 0) v = Math.min(v, d[k + n - 1] + b);
      }
      d[k] = v;
    }
  }
  for (let k = 0; k < d.length; k++) d[k] = Math.min(max, d[k] * step);
  return d;
}

