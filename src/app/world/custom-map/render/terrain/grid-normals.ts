import { DataUtils } from 'three';
import type { SampleRect } from './ground-shape';

/**
 * The texels of the ground's normal texture (GridNormalTexture), worked out
 * from the height grid and the main water's mask, on whichever thread runs
 * them (the game's ground worker, ground-jobs.ts): RGB the scene-space
 * normal, A near water, as half floats.
 */

/** Samples from the water within which a bank counts as wet (alpha 1), and where the shore strip ends (alpha 0) */
export const WET_REACH = 2;
export const SHORE_REACH = 6;

/**
 * How near each sample lies to the water: 1 within WET_REACH samples,
 * fading to 0 at SHORE_REACH. A chamfer distance over the mask; with `rect`
 * (and `wet` from before) only the samples within the reach of it, the
 * distances there measured a reach further.
 */
export function gridWet(mask: Uint8Array, cols: number, rows: number, rect: SampleRect | null, wet: Float32Array | null): Float32Array {
  const g = SHORE_REACH;
  const r = rect && wet ? { i0: Math.max(0, rect.i0 - g), j0: Math.max(0, rect.j0 - g), i1: Math.min(cols - 1, rect.i1 + g), j1: Math.min(rows - 1, rect.j1 + g) } : null;
  const out = r ? wet! : new Float32Array(cols * rows);
  const w0 = { i0: Math.max(0, (r?.i0 ?? 0) - g), j0: Math.max(0, (r?.j0 ?? 0) - g), i1: Math.min(cols - 1, (r?.i1 ?? cols - 1) + g), j1: Math.min(rows - 1, (r?.j1 ?? rows - 1) + g) };
  const ww = w0.i1 - w0.i0 + 1;
  const wh = w0.j1 - w0.j0 + 1;
  const d = new Float32Array(ww * wh);
  for (let j = 0; j < wh; j++) for (let i = 0; i < ww; i++) d[j * ww + i] = mask[(j + w0.j0) * cols + i + w0.i0] > 0 ? 0 : 1e6;
  // Two passes of a 3-4 chamfer (in samples: 1 along, 1.41 across)
  const D = Math.SQRT2;
  for (let j = 0; j < wh; j++) {
    for (let i = 0; i < ww; i++) {
      const k = j * ww + i;
      let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + 1);
      if (j > 0) {
        v = Math.min(v, d[k - ww] + 1);
        if (i > 0) v = Math.min(v, d[k - ww - 1] + D);
        if (i < ww - 1) v = Math.min(v, d[k - ww + 1] + D);
      }
      d[k] = v;
    }
  }
  for (let j = wh - 1; j >= 0; j--) {
    for (let i = ww - 1; i >= 0; i--) {
      const k = j * ww + i;
      let v = d[k];
      if (i < ww - 1) v = Math.min(v, d[k + 1] + 1);
      if (j < wh - 1) {
        v = Math.min(v, d[k + ww] + 1);
        if (i < ww - 1) v = Math.min(v, d[k + ww + 1] + D);
        if (i > 0) v = Math.min(v, d[k + ww - 1] + D);
      }
      d[k] = v;
    }
  }
  for (let j = r?.j0 ?? 0; j <= (r?.j1 ?? rows - 1); j++) {
    for (let i = r?.i0 ?? 0; i <= (r?.i1 ?? cols - 1); i++) {
      const dist = d[(j - w0.j0) * ww + i - w0.i0];
      out[j * cols + i] = dist <= WET_REACH ? 1 : Math.max(0, 1 - (dist - WET_REACH) / (SHORE_REACH - WET_REACH));
    }
  }
  return out;
}

/** The rectangle the wet samples of a brush's `rect` reach (gridWet) */
export function wetReach(rect: SampleRect, cols: number, rows: number): SampleRect {
  const g = SHORE_REACH;
  return { i0: Math.max(0, rect.i0 - g), j0: Math.max(0, rect.j0 - g), i1: Math.min(cols - 1, rect.i1 + g), j1: Math.min(rows - 1, rect.j1 + g) };
}

/** The normals (and the wet banks in A) of the samples in `rect` into `pixels` (RGBA half floats) */
export function writeGridNormals(
  heights: Float32Array,
  cols: number,
  rows: number,
  cellSize: number,
  wet: Float32Array | null,
  pixels: Uint16Array,
  rect: SampleRect,
): void {
  const inv = 1 / (2 * cellSize);
  const h = heights;
  const last = cols - 1;
  const lastRow = rows - 1;
  // Per brush frame over the whole brush (a 200 m mountain: some 160 000 samples), so the samples are read
  // straight from the grid (clamped at the border as HeightField.sample does) and normalised without Math.hypot
  for (let j = rect.j0; j <= rect.j1; j++) {
    const row = j * cols;
    const up = (j > 0 ? j - 1 : 0) * cols;
    const down = (j < lastRow ? j + 1 : lastRow) * cols;
    for (let i = rect.i0; i <= rect.i1; i++) {
      const dhdx = (h[row + (i < last ? i + 1 : last)] - h[row + (i > 0 ? i - 1 : 0)]) * inv;
      const dhdy = (h[down + i] - h[up + i]) * inv;
      // Scene normal (dhdx, 1, -dhdy), normalised
      const k = 1 / Math.sqrt(dhdx * dhdx + 1 + dhdy * dhdy);
      const q = (row + i) * 4;
      pixels[q] = DataUtils.toHalfFloat(dhdx * k);
      pixels[q + 1] = DataUtils.toHalfFloat(k);
      pixels[q + 2] = DataUtils.toHalfFloat(-dhdy * k);
      pixels[q + 3] = wet ? DataUtils.toHalfFloat(wet[row + i]) : 0;
    }
  }
}
