import { cellSplit } from '../height-field';
import type { GridRect } from '../terrain/terrain-chunks';

/**
 * The shore cut of an area body: per height sample the signed distance (in
 * cells) to where the drawn terrain crosses the body's level, positive on
 * the wet side, smoothed, moved inward at steep banks. The water material
 * cuts the surface where its bilinear value falls to 0.
 *
 * Why: the terrain mesh has two triangles per cell, so where a wall rises
 * within one cell (a pit dug with Terrain Lower, a quay) the line where it
 * crosses the level runs along the samples in steps, one chamfer per cell
 * (cellSplit), and the per-pixel depth cut shows them. A distance field to that line, smoothed
 * (BLUR), moved inward (STEEP_INSET) and sampled bilinearly, gives a
 * smooth line just inside them: the waterline runs smooth along the wall
 * and a little of the wall shows above it. At gentle banks the cut lies
 * outside the line (GENTLE_OUTSET) and the depth per pixel stays the shore,
 * as before.
 *
 * A whole bake (a new level, a new mask array) on a 1025² grid takes tens
 * of ms: in the editor it runs in a worker (bakeShoreCutOffThread,
 * shore-cut.worker.ts), the arrays copied out to it.
 */

/** Cells from the waterline the distance is measured to; farther ones keep this */
export const SHORE_CUT_REACH = 3;
/** Encoding: 128 + cells * SCALE in a byte, so ±4 cells at 1/32 */
export const SHORE_CUT_SCALE = 32;
/** Cells the cut stays inside the waterline at a steep bank (the smoothed line inside the teeth) */
const STEEP_INSET = 0.5;
/** Cells it stays outside at a gentle one (the depth per pixel cuts there) */
const GENTLE_OUTSET = 0.5;
/** Rise per run (largest step to a neighbour, around a sample) from which a bank counts as steep, and fully */
const STEEP_FROM = 1.5;
const STEEP_FULL = 3;
/** Smoothing passes over the distances */
const BLUR = 2;
/** Samples around a change of heights or level whose cut changes with it */
export const SHORE_CUT_RADIUS = SHORE_CUT_REACH + BLUR + 1;

/**
 * Writes the mask (R) and the shore cut (G) of the samples in `rect` into
 * `out` (two bytes per sample). The cut there depends on the heights and
 * the level up to SHORE_CUT_RADIUS samples around.
 */
export function bakeShoreCut(
  heights: Float32Array,
  columns: number,
  rows: number,
  cellSize: number,
  level: number,
  mask: Uint8Array,
  out: Uint8Array,
  rect: GridRect,
): void {
  const { i0, j0, i1, j1 } = rect;
  // The distances are smoothed (BLUR passes reaching a sample each): measured that far around rect
  const a0 = Math.max(0, i0 - BLUR);
  const b0 = Math.max(0, j0 - BLUR);
  const a1 = Math.min(columns - 1, i1 + BLUR);
  const b1 = Math.min(rows - 1, j1 + BLUR);
  const w = a1 - a0 + 1;
  const hgt = b1 - b0 + 1;
  const dist = new Float32Array(w * hgt).fill(SHORE_CUT_REACH);
  const R = SHORE_CUT_REACH;
  // Distance of the samples around rect to one segment of the waterline (cell coordinates)
  const segment = (ax: number, ay: number, bx: number, by: number): void => {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const si0 = Math.max(a0, Math.ceil(Math.min(ax, bx) - R));
    const si1 = Math.min(a1, Math.floor(Math.max(ax, bx) + R));
    const sj0 = Math.max(b0, Math.ceil(Math.min(ay, by) - R));
    const sj1 = Math.min(b1, Math.floor(Math.max(ay, by) + R));
    for (let j = sj0; j <= sj1; j++) {
      for (let i = si0; i <= si1; i++) {
        const t = len2 > 0 ? Math.min(1, Math.max(0, ((i - ax) * dx + (j - ay) * dy) / len2)) : 0;
        const d = Math.hypot(i - ax - t * dx, j - ay - t * dy);
        const k = (j - b0) * w + i - a0;
        if (d < dist[k]) dist[k] = d;
      }
    }
  };
  // Where one triangle of the mesh crosses the level: the edges whose ends lie on either side
  const px: number[] = [];
  const py: number[] = [];
  const triangle = (ax: number, ay: number, ha: number, bx: number, by: number, hb: number, cx: number, cy: number, hc: number): void => {
    px.length = py.length = 0;
    const edge = (x0: number, y0: number, h0: number, x1: number, y1: number, h1: number): void => {
      if (h0 < level === h1 < level) return;
      const t = (level - h0) / (h1 - h0);
      px.push(x0 + (x1 - x0) * t);
      py.push(y0 + (y1 - y0) * t);
    };
    edge(ax, ay, ha, bx, by, hb);
    edge(bx, by, hb, cx, cy, hc);
    edge(cx, cy, hc, ax, ay, ha);
    if (px.length === 2) segment(px[0], py[0], px[1], py[1]);
  };
  const ci0 = Math.max(0, a0 - R);
  const cj0 = Math.max(0, b0 - R);
  const ci1 = Math.min(columns - 2, a1 + R);
  const cj1 = Math.min(rows - 2, b1 + R);
  for (let j = cj0; j <= cj1; j++) {
    for (let i = ci0; i <= ci1; i++) {
      const k = j * columns + i;
      const h00 = heights[k];
      const h10 = heights[k + 1];
      const h01 = heights[k + columns];
      const h11 = heights[k + columns + 1];
      const wet = (h00 < level ? 1 : 0) + (h10 < level ? 1 : 0) + (h01 < level ? 1 : 0) + (h11 < level ? 1 : 0);
      if (wet === 0 || wet === 4) continue;
      // The mesh's two triangles per cell (cellSplit, as HeightField and terrainHeightAt)
      if (cellSplit(h00, h10, h01, h11)) {
        triangle(i, j, h00, i + 1, j, h10, i + 1, j + 1, h11);
        triangle(i, j, h00, i + 1, j + 1, h11, i, j + 1, h01);
      } else {
        triangle(i, j, h00, i + 1, j, h10, i, j + 1, h01);
        triangle(i + 1, j, h10, i + 1, j + 1, h11, i, j + 1, h01);
      }
    }
  }
  // Signed (positive on the wet side), then smoothed: the distance to a waterline in teeth is itself
  // scalloped along the samples, the [1 2 1] passes take that out and leave a straight shore as it was
  const signed = dist;
  for (let j = b0; j <= b1; j++) {
    for (let i = a0; i <= a1; i++) if (heights[j * columns + i] >= level) signed[(j - b0) * w + i - a0] *= -1;
  }
  const tmp = new Float32Array(signed.length);
  for (let pass = 0; pass < BLUR; pass++) {
    for (let j = 0; j < hgt; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        tmp[k] = (signed[i > 0 ? k - 1 : k] + 2 * signed[k] + signed[i < w - 1 ? k + 1 : k]) / 4;
      }
    }
    for (let j = 0; j < hgt; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        signed[k] = (tmp[j > 0 ? k - w : k] + 2 * tmp[k] + tmp[j < hgt - 1 ? k + w : k]) / 4;
      }
    }
  }
  const rise = (k: number, m: number): number => Math.abs(heights[k] - heights[m]);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const k = j * columns + i;
      let cells = signed[(j - b0) * w + i - a0];
      out[k * 2] = mask[k];
      if (Math.abs(cells) < R) {
        // The steepest step to a neighbour around the sample: a wall moves the cut inward
        let step = 0;
        for (let jj = Math.max(0, j - 1); jj <= Math.min(rows - 1, j + 1); jj++) {
          for (let ii = Math.max(0, i - 1); ii <= Math.min(columns - 1, i + 1); ii++) {
            const m = jj * columns + ii;
            if (ii < columns - 1) step = Math.max(step, rise(m, m + 1));
            if (jj < rows - 1) step = Math.max(step, rise(m, m + columns));
          }
        }
        const s = Math.min(1, Math.max(0, (step / cellSize - STEEP_FROM) / (STEEP_FULL - STEEP_FROM)));
        const steep = s * s * (3 - 2 * s);
        cells -= -GENTLE_OUTSET + (STEEP_INSET + GENTLE_OUTSET) * steep;
      }
      out[k * 2 + 1] = Math.max(0, Math.min(255, Math.round(128 + cells * SHORE_CUT_SCALE)));
    }
  }
}

/** What a whole bake reads: the height grid, the level, the mask and the samples to bake, as plain arrays */
export interface ShoreCutInput {
  heights: Float32Array;
  columns: number;
  rows: number;
  cellSize: number;
  level: number;
  mask: Uint8Array;
  rect: GridRect;
}

/** The mask and shore cut of a whole grid (two bytes per sample): `rect` baked, 0 elsewhere (the worker's bake) */
export function bakeShoreCutWhole(input: ShoreCutInput): Uint8Array {
  const out = new Uint8Array(input.columns * input.rows * 2);
  bakeShoreCut(input.heights, input.columns, input.rows, input.cellSize, input.level, input.mask, out, input.rect);
  return out;
}

/**
 * The whole bake in a worker, the arrays of `input` handed over (pass
 * copies); inline where there are no workers. Resolves with the bytes, or
 * null when the worker failed.
 */
export function bakeShoreCutOffThread(input: ShoreCutInput): Promise<Uint8Array | null> {
  if (typeof Worker === 'undefined') return Promise.resolve(bakeShoreCutWhole(input));
  const worker = shoreWorker();
  const id = ++shoreJobs;
  return new Promise((resolve) => {
    shoreWaiting.set(id, resolve);
    worker.postMessage({ id, input }, [input.heights.buffer, input.mask.buffer]);
  });
}

let worker: Worker | null = null;
let shoreJobs = 0;
const shoreWaiting = new Map<number, (cut: Uint8Array | null) => void>();

function shoreWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./shore-cut.worker', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<{ id: number; cut: Uint8Array }>) => {
    shoreWaiting.get(e.data.id)?.(e.data.cut);
    shoreWaiting.delete(e.data.id);
  };
  // A worker that fails: the bakes waiting get nothing, the next one starts a new worker
  w.onerror = () => {
    for (const resolve of shoreWaiting.values()) resolve(null);
    shoreWaiting.clear();
    w.terminate();
    worker = null;
  };
  return (worker = w);
}
