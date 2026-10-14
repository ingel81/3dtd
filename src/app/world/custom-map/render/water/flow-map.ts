import type { MapWater } from '../../map-document';
import type { HeightField } from '../height-field';

/**
 * Baked flow of an area water body, four bytes per height sample. RG:
 * where its surface drifts, in scene x and z (127.5 is still,
 * FLOW_MAP_MAX m/s at 0 and 255). The water material moves its waves along
 * it in two phases that cross-fade (water-material.ts), so nothing is
 * simulated. B: the distance to the shore in metres (0 to SHORE_FIELD_MAX),
 * blurred so its lines round the corners of the bank; the surf bands run
 * along it. A: how steep the bank is nearby (rise over run, 0 to
 * SLOPE_FIELD_MAX): at a quay wall the foam stays narrow.
 *
 * - Water, sea and swamp circulate along their banks: the flow runs along
 *   the shore's contour (across the gradient of the distance to the shore),
 *   still right at the bank where the water piles up, fastest a few cells
 *   out, slow in open water; narrows speed up (the distance field is
 *   steep there), islands get a current around them.
 * - Lava turns over in convection cells (a divergence-free field of cells
 *   about 30 m wide, wobbled by noise), slowing towards its banks.
 *
 * Baked from the mask and the heights on load and whenever the body is
 * set again (the editor's pool brush); a 513² grid takes a few ms, a 1025²
 * one tens of ms: after an edit the bake runs in a worker (bakeFlowOffThread,
 * flow-map.worker.ts), the arrays copied out to it.
 */

/** Flow speed at the ends of the byte range, m/s */
export const FLOW_MAP_MAX = 1.2;
/** Distance to the shore at byte 255 (B), metres; farther reads as this */
export const SHORE_FIELD_MAX = 32;
/** Bank slope at byte 255 (A), rise over run */
export const SLOPE_FIELD_MAX = 2.5;
/** Cells the distance is blurred over on each side */
const SHORE_BLUR = 3;
/** Cells a steep bank's slope reaches out on each side */
const SLOPE_REACH = 1;

/** What a bake reads: the height grid and the body, as plain arrays (a worker gets copies) */
export interface FlowInput {
  columns: number;
  rows: number;
  cellSize: number;
  originX: number;
  originY: number;
  heights: Float32Array;
  mask: Uint8Array;
  level: number;
  lava: boolean;
}

/** The input of a bake from the map's field and body; `copy` for a worker (the arrays go to it) */
export function flowInput(field: HeightField, water: MapWater, copy = false): FlowInput {
  return {
    columns: field.columns,
    rows: field.rows,
    cellSize: field.cellSize,
    originX: field.originX,
    originY: field.originY,
    heights: copy ? field.grid.heights.slice() : field.grid.heights,
    mask: copy ? water.mask.slice() : water.mask,
    level: water.level,
    lava: water.kind === 'lava',
  };
}

export function bakeFlowMap(field: HeightField, water: MapWater, out?: Uint8Array): Uint8Array {
  return bakeFlow(flowInput(field, water), out);
}

/** The flow of a body from its input (bakeFlowMap; the worker's bake) */
export function bakeFlow(input: FlowInput, out?: Uint8Array): Uint8Array {
  const cols = input.columns;
  const rows = input.rows;
  const n = cols * rows;
  const flow = out && out.length === n * 4 ? out : new Uint8Array(n * 4);
  const lava = input.lava;
  const heights = input.heights;
  // Distance to the shore in cells (chamfer 3-4 over the wet samples)
  const dist = new Float32Array(n);
  const big = 1e9;
  for (let k = 0; k < n; k++) {
    const i = k % cols;
    const j = (k / cols) | 0;
    dist[k] = input.mask[k] && heights[j * cols + i] < input.level ? big : 0;
  }
  const relax = (k: number, other: number, step: number): void => {
    const d = dist[other] + step;
    if (d < dist[k]) dist[k] = d;
  };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      if (!dist[k]) continue;
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
      if (!dist[k]) continue;
      if (i < cols - 1) relax(k, k + 1, 3);
      if (j < rows - 1) {
        relax(k, k + cols, 3);
        if (i < cols - 1) relax(k, k + cols + 1, 4);
        if (i > 0) relax(k, k + cols - 1, 4);
      }
    }
  }
  // Water reaching the grid's edge goes on beyond it: no shore there
  for (let k = 0; k < n; k++) dist[k] = dist[k] >= big ? 60 : dist[k] / 3;
  const at = (i: number, j: number): number => dist[Math.min(rows - 1, Math.max(0, j)) * cols + Math.min(cols - 1, Math.max(0, i))];
  const cell = input.cellSize;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      let fx = 0;
      let fy = 0;
      const d = dist[k];
      if (d > 0) {
        // Metres from the bank: still right at it, then a current
        const m = d * cell;
        if (lava) {
          // Convection cells: the curl of a field of bumps about 30 m apart, so the crust neither gathers nor tears
          const x = input.originX + i * cell;
          const y = input.originY + j * cell;
          const w = 0.6 * Math.sin(x * 0.013 + y * 0.021);
          const kx = (2 * Math.PI) / 30;
          // psi = sin(kx (x + w)) sin(kx (y - w)); flow = (dpsi/dy, -dpsi/dx)
          const sx = Math.sin(kx * (x + w * 8));
          const cx = Math.cos(kx * (x + w * 8));
          const sy = Math.sin(kx * (y - w * 8));
          const cy = Math.cos(kx * (y - w * 8));
          fx = sx * cy * 0.35;
          fy = -cx * sy * 0.35;
          const near = Math.min(1, m / 6);
          fx *= near;
          fy *= near;
        } else {
          // Along the bank's contour: across the gradient of the distance to the shore
          const gx = (at(i + 1, j) - at(i - 1, j)) / 2;
          const gy = (at(i, j + 1) - at(i, j - 1)) / 2;
          const g = Math.hypot(gx, gy);
          if (g > 1e-4) {
            const speed = 0.45 * Math.min(1, m / 4) * Math.exp(-m / 40) * Math.min(1.6, g * 1.3);
            fx = (-gy / g) * speed;
            fy = (gx / g) * speed;
          }
        }
      }
      // Scene x is map -x
      flow[k * 4] = encode(-fx);
      flow[k * 4 + 1] = encode(fy);
    }
  }
  shoreField(input, dist, flow);
  return flow;
}

/** B and A of the bake: the blurred distance to the shore (dist in cells) and the bank's slope near it */
function shoreField(input: FlowInput, dist: Float32Array, flow: Uint8Array): void {
  const cols = input.columns;
  const rows = input.rows;
  const cell = input.cellSize;
  const heights = input.heights;
  const n = cols * rows;
  // Metres, blurred by a box in each direction: the chamfer's corners round off
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let k = 0; k < n; k++) a[k] = Math.min(dist[k] * cell, SHORE_FIELD_MAX);
  blurAlongRows(a, b, cols, rows);
  acrossRows(b, a, cols, rows, SHORE_BLUR, false);
  // The steepest rise between neighbouring samples, then the largest of it within reach of each sample
  const slope = b;
  slope.fill(0);
  const inv = 1 / cell;
  for (let j = 0; j < rows; j++) {
    const row = j * cols;
    for (let i = 0; i < cols; i++) {
      const k = row + i;
      const h = heights[k];
      // Each pair once: the rise to the right and below counts for both samples
      if (i < cols - 1) {
        const d = Math.abs(heights[k + 1] - h) * inv;
        if (d > slope[k]) slope[k] = d;
        if (d > slope[k + 1]) slope[k + 1] = d;
      }
      if (j < rows - 1) {
        const d = Math.abs(heights[k + cols] - h) * inv;
        if (d > slope[k]) slope[k] = d;
        if (d > slope[k + cols]) slope[k + cols] = d;
      }
    }
  }
  const reach = new Float32Array(n);
  maxAlongRows(slope, reach, cols, rows);
  acrossRows(reach, slope, cols, rows, SLOPE_REACH, true);
  // A clamped view rounds and clamps on its own
  const bytes = new Uint8ClampedArray(flow.buffer, flow.byteOffset, flow.length);
  const toB = 255 / SHORE_FIELD_MAX;
  const toA = 255 / SLOPE_FIELD_MAX;
  for (let k = 0; k < n; k++) {
    bytes[k * 4 + 2] = a[k] * toB;
    bytes[k * 4 + 3] = slope[k] * toA;
  }
}

/** A box blur of SHORE_BLUR cells to each side along each row, a running sum (clamped at the ends) */
function blurAlongRows(src: Float32Array, dst: Float32Array, cols: number, rows: number): void {
  const r = SHORE_BLUR;
  const w = 1 / (2 * r + 1);
  const last = cols - 1;
  for (let j = 0; j < rows; j++) {
    const base = j * cols;
    let sum = src[base] * r;
    for (let d = 0; d <= r; d++) sum += src[base + Math.min(last, d)];
    for (let x = 0; x < cols; x++) {
      dst[base + x] = sum * w;
      sum += src[base + Math.min(last, x + r + 1)] - src[base + Math.max(0, x - r)];
    }
  }
}

/** The largest value within SLOPE_REACH cells to each side along each row */
function maxAlongRows(src: Float32Array, dst: Float32Array, cols: number, rows: number): void {
  const r = SLOPE_REACH;
  const last = cols - 1;
  for (let j = 0; j < rows; j++) {
    const base = j * cols;
    for (let x = 0; x < cols; x++) {
      const hi = Math.min(last, x + r);
      let m = src[base + Math.max(0, x - r)];
      for (let y = Math.max(0, x - r) + 1; y <= hi; y++) {
        const v = src[base + y];
        if (v > m) m = v;
      }
      dst[base + x] = m;
    }
  }
}

/**
 * Across the rows: each row of `dst` the mean (or with `max` the largest) of
 * `r` rows to each side of it in `src`, clamped at the ends. Row by row, so
 * the memory runs in order (a column at a time strides the whole grid)
 */
function acrossRows(src: Float32Array, dst: Float32Array, cols: number, rows: number, r: number, max: boolean): void {
  const w = 1 / (2 * r + 1);
  for (let j = 0; j < rows; j++) {
    const out = j * cols;
    const first = Math.min(rows - 1, Math.max(0, j - r)) * cols;
    for (let i = 0; i < cols; i++) dst[out + i] = src[first + i];
    for (let d = -r + 1; d <= r; d++) {
      const from = Math.min(rows - 1, Math.max(0, j + d)) * cols;
      if (max) {
        for (let i = 0; i < cols; i++) {
          const v = src[from + i];
          if (v > dst[out + i]) dst[out + i] = v;
        }
      } else {
        for (let i = 0; i < cols; i++) dst[out + i] += src[from + i];
      }
    }
    if (!max) for (let i = 0; i < cols; i++) dst[out + i] *= w;
  }
}

function encode(v: number): number {
  return Math.max(0, Math.min(255, Math.round(127.5 + (v / FLOW_MAP_MAX) * 127.5)));
}

/** The flow a byte pair stands for (scene x, z), m/s; the shader decodes the same way */
export function decodeFlow(r: number, g: number): [number, number] {
  return [((r - 127.5) / 127.5) * FLOW_MAP_MAX, ((g - 127.5) / 127.5) * FLOW_MAP_MAX];
}

/**
 * The bake in a worker, so a 1025² body's tens of ms stay off the page's
 * thread; inline where there are no workers. Resolves with the flow, or
 * null when the worker failed.
 */
export function bakeFlowOffThread(input: FlowInput): Promise<Uint8Array | null> {
  if (typeof Worker === 'undefined') return Promise.resolve(bakeFlow(input));
  const worker = flowWorker();
  const id = ++flowJobs;
  return new Promise((resolve) => {
    flowWaiting.set(id, resolve);
    worker.postMessage({ id, input }, [input.heights.buffer, input.mask.buffer]);
  });
}

let worker: Worker | null = null;
let flowJobs = 0;
const flowWaiting = new Map<number, (flow: Uint8Array | null) => void>();

function flowWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./flow-map.worker', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<{ id: number; flow: Uint8Array }>) => {
    flowWaiting.get(e.data.id)?.(e.data.flow);
    flowWaiting.delete(e.data.id);
  };
  // A worker that fails: the bakes waiting get nothing, the next one starts a new worker
  w.onerror = () => {
    for (const resolve of flowWaiting.values()) resolve(null);
    flowWaiting.clear();
    w.terminate();
    worker = null;
  };
  return (worker = w);
}
