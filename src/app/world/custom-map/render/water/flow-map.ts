import type { MapWater } from '../../map-document';
import type { HeightField } from '../height-field';

/**
 * Baked flow of an area water body, one RG byte pair per height sample:
 * where its surface drifts, in scene x and z (127.5 is still,
 * FLOW_MAP_MAX m/s at 0 and 255). The water material moves its waves along
 * it in two phases that cross-fade (water-material.ts), so nothing is
 * simulated.
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
  const flow = out && out.length === n * 2 ? out : new Uint8Array(n * 2);
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
      flow[k * 2] = encode(-fx);
      flow[k * 2 + 1] = encode(fy);
    }
  }
  return flow;
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
