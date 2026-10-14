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

/** The band's heights before (taken earlier) and as built (now), packed */
export function packGround(grid: MapHeightGrid, samples: readonly number[], before: Float32Array): MapRoadGround {
  let base = Infinity;
  let top = -Infinity;
  for (let k = 0; k < samples.length; k++) {
    base = Math.min(base, before[k], grid.heights[samples[k]]);
    top = Math.max(top, before[k], grid.heights[samples[k]]);
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
    for (let m = 0; m < n; m++) words.push(units(before[k + m]), units(grid.heights[samples[k + m]]));
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
