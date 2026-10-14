/**
 * The ground under a road as it was before the road brush levelled it, kept
 * in the edge's dress (`MapRoadDress.ground`), so taking the road back
 * restores it exactly. For each height sample of the band the brush may
 * touch it holds the height before and the height the brush left; a later
 * restore puts back `before + (now - built)`, so ground shaped after the
 * road was built keeps that shaping (untouched ground gets `before` itself).
 * Packed as runs of samples per row, heights in steps of a millimetre (or
 * coarser, on a band more than 65 m high) above the band's lowest, as base64:
 *
 *   per run: row j (u16), first column i (u16), count n (u16), then n pairs
 *   of (before, built) as u16 steps above `base`
 *
 * Size: some 4 bytes a sample plus 6 a run, a third more as text.
 */
import type { MapHeightGrid, MapPoint, MapRoadGround } from '../../../world/custom-map/map-document';
import { nearestOnPolyline } from '../path-graph';

/** Height samples (row-major indices) within `reach` metres of a line */
export function bandSamples(grid: MapHeightGrid, width: number, depth: number, line: readonly MapPoint[], reach: number): number[] {
  if (line.length < 2) return [];
  const c = grid.cellSize;
  const xs = line.map((p) => p.x);
  const ys = line.map((p) => p.y);
  const i0 = Math.max(0, Math.floor((Math.min(...xs) - reach + width / 2) / c));
  const i1 = Math.min(grid.columns - 1, Math.ceil((Math.max(...xs) + reach + width / 2) / c));
  const j0 = Math.max(0, Math.floor((Math.min(...ys) - reach + depth / 2) / c));
  const j1 = Math.min(grid.rows - 1, Math.ceil((Math.max(...ys) + reach + depth / 2) / c));
  const out: number[] = [];
  for (let j = j0; j <= j1; j++) {
    const y = -depth / 2 + j * c;
    for (let i = i0; i <= i1; i++) {
      const hit = nearestOnPolyline(line, { x: -width / 2 + i * c, y });
      if (hit && hit.dist <= reach) out.push(j * grid.columns + i);
    }
  }
  return out;
}

/**
 * The band's heights before (taken earlier) and as built (by default the
 * grid's now), packed; `samples` ascending
 */
export function packGround(
  grid: Pick<MapHeightGrid, 'columns' | 'rows' | 'cellSize' | 'heights'>,
  samples: readonly number[],
  before: ArrayLike<number>,
  built: ArrayLike<number> = samples.map((k) => grid.heights[k]),
): MapRoadGround {
  let base = Infinity;
  let top = -Infinity;
  for (let k = 0; k < samples.length; k++) {
    base = Math.min(base, before[k], built[k]);
    top = Math.max(top, before[k], built[k]);
  }
  base = Math.floor(base * 1000) / 1000;
  const step = Math.max(0.001, Math.ceil(((top - base) / 65000) * 1000) / 1000);
  const words: number[] = [];
  const units = (h: number) => Math.max(0, Math.min(65535, Math.round((h - base) / step)));
  let k = 0;
  while (k < samples.length) {
    const j = Math.floor(samples[k] / grid.columns);
    const i = samples[k] % grid.columns;
    let n = 1;
    while (k + n < samples.length && samples[k + n] === samples[k] + n && Math.floor(samples[k + n] / grid.columns) === j) n++;
    words.push(j, i, n);
    for (let m = 0; m < n; m++) words.push(units(before[k + m]), units(built[k + m]));
    k += n;
  }
  const bytes = new Uint8Array(words.length * 2);
  const view = new DataView(bytes.buffer);
  words.forEach((w, q) => view.setUint16(q * 2, w, true));
  let text = '';
  for (let q = 0; q < bytes.length; q += 0x8000) text += String.fromCharCode(...bytes.subarray(q, q + 0x8000));
  return { columns: grid.columns, rows: grid.rows, cell: grid.cellSize, base, step, data: btoa(text) };
}

/** The samples of a packed ground: index, height before, height built; null when the grid is not the one it was taken on */
export function unpackGround(grid: MapHeightGrid, ground: MapRoadGround): { k: number; before: number; built: number }[] | null {
  if (ground.columns !== grid.columns || ground.rows !== grid.rows || ground.cell !== grid.cellSize) return null;
  const text = atob(ground.data);
  const bytes = new Uint8Array(text.length);
  for (let q = 0; q < text.length; q++) bytes[q] = text.charCodeAt(q);
  const view = new DataView(bytes.buffer);
  const out: { k: number; before: number; built: number }[] = [];
  let q = 0;
  while (q + 6 <= bytes.length) {
    const j = view.getUint16(q, true);
    const i = view.getUint16(q + 2, true);
    const n = view.getUint16(q + 4, true);
    q += 6;
    for (let m = 0; m < n; m++, q += 4) {
      out.push({ k: j * grid.columns + i + m, before: ground.base + view.getUint16(q, true) * ground.step, built: ground.base + view.getUint16(q + 2, true) * ground.step });
    }
  }
  return out;
}

type GridShape = Pick<MapHeightGrid, 'columns' | 'rows' | 'cellSize'>;

/** Packs samples given as index, before and built (sorted by index first) on `grid` */
function repack(grid: GridShape, list: { k: number; before: number; built: number }[]): MapRoadGround | null {
  if (!list.length) return null;
  list.sort((a, b) => a.k - b.k);
  return packGround({ ...grid, heights: new Float32Array(0) }, list.map((s) => s.k), list.map((s) => s.before), list.map((s) => s.built));
}

/**
 * The kept ground on a resized grid of the same cell size: sample (i, j)
 * of `from` is (i - di, j - dj) of `to` (both grids centred, as resizeMap
 * keeps them); samples that fall outside drop out. Exact. Null when the
 * ground is not of `from` or nothing of it is left.
 */
export function shiftGround(ground: MapRoadGround, from: MapHeightGrid, to: GridShape, di: number, dj: number): MapRoadGround | null {
  const samples = unpackGround(from, ground);
  if (!samples || to.cellSize !== from.cellSize) return null;
  const out: { k: number; before: number; built: number }[] = [];
  for (const s of samples) {
    const i = (s.k % from.columns) - di;
    const j = Math.floor(s.k / from.columns) - dj;
    if (i >= 0 && j >= 0 && i < to.columns && j < to.rows) out.push({ k: j * to.columns + i, before: s.before, built: s.built });
  }
  return repack(to, out);
}

/**
 * The kept ground on a finer grid over the same extent (Increase detail):
 * each new sample bilinear between the four old ones around it, as the
 * refined heights are. An old sample the ground does not hold (beyond the
 * band) counts with its height on `from` as both before and built: the
 * road never touched it. Null when the ground is not of `from`.
 */
export function refineGround(ground: MapRoadGround, from: MapHeightGrid, to: GridShape): MapRoadGround | null {
  const samples = unpackGround(from, ground);
  if (!samples?.length) return null;
  const kept = new Map(samples.map((s) => [s.k, s]));
  const at = (k: number) => kept.get(k) ?? { before: from.heights[k], built: from.heights[k] };
  const fx = (from.columns - 1) / (to.columns - 1);
  const fy = (from.rows - 1) / (to.rows - 1);
  // The fine samples within one old cell of the kept ones
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
  for (const s of samples) {
    const i = s.k % from.columns;
    const j = Math.floor(s.k / from.columns);
    i0 = Math.min(i0, i);
    i1 = Math.max(i1, i);
    j0 = Math.min(j0, j);
    j1 = Math.max(j1, j);
  }
  const out: { k: number; before: number; built: number }[] = [];
  const jFirst = Math.max(0, Math.ceil((j0 - 1) / fy - 1e-9));
  const jLast = Math.min(to.rows - 1, Math.floor((j1 + 1) / fy + 1e-9));
  const iFirst = Math.max(0, Math.ceil((i0 - 1) / fx - 1e-9));
  const iLast = Math.min(to.columns - 1, Math.floor((i1 + 1) / fx + 1e-9));
  for (let j = jFirst; j <= jLast; j++) {
    const y = j * fy;
    const oj = Math.min(Math.floor(y + 1e-9), from.rows - 2);
    const v = y - oj;
    for (let i = iFirst; i <= iLast; i++) {
      const x = i * fx;
      const oi = Math.min(Math.floor(x + 1e-9), from.columns - 2);
      const u = x - oi;
      const corners = [oj * from.columns + oi, oj * from.columns + oi + 1, (oj + 1) * from.columns + oi, (oj + 1) * from.columns + oi + 1];
      const weights = [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v];
      // Only where the band reaches: some weighed corner is kept
      if (!corners.some((k, n) => weights[n] > 1e-9 && kept.has(k))) continue;
      let before = 0;
      let built = 0;
      corners.forEach((k, n) => {
        if (weights[n] <= 1e-9) return;
        const q = at(k);
        before += q.before * weights[n];
        built += q.built * weights[n];
      });
      out.push({ k: j * to.columns + i, before, built });
    }
  }
  return repack(to, out);
}
