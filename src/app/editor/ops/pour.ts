/**
 * Pour: water (or lava) poured at a point with plenty of inflow, filling
 * like the real thing (fill and spill). The hollow it lands in fills to the
 * height where it overflows, the overflow runs downhill into the next lower
 * hollow and fills that too, and so on until the water leaves the map at
 * its edge or runs into a body that is already there.
 *
 * The whole map's hollows are filled once (priority flood from the edge
 * and from the bodies, Barnes et al. 2014, "Priority-Flood"): `filled`
 * holds for every sample the height its water stands at, flat across a
 * filled hollow. The pour then walks down that surface from the start:
 * each flat it crosses is a hollow (where the ground lies below it) and
 * the lowest sample next to the flat is where the water runs on.
 *
 * On a 1025² map the flood takes a few hundred ms: the editor runs it in a
 * worker (`pourOffThread`, `workers/pour.worker.ts`).
 */
import { MinHeap } from './water-ops';

export interface PourInput {
  columns: number;
  rows: number;
  heights: Float32Array;
  /** Samples poured at (the point and its symmetry images) */
  starts: number[];
  /** 1 where a body already stands (its mask set, the ground below its level): the water runs into it */
  wet: Uint8Array;
}

/** A hollow the water filled */
export interface PouredLake {
  /** Where it overflows */
  level: number;
  /** Its lowest ground */
  floor: number;
  /** The samples below `level` */
  cells: Int32Array;
}

export interface PourResult {
  /** In the order the water reached them */
  lakes: PouredLake[];
  /** Hollows past POUR_MAX_LAKES that stayed dry */
  skipped: number;
}

/** A hollow shallower than this (metres from its floor to where it overflows) the water just runs through */
export const POUR_MIN_DEPTH = 0.5;
/** Fewer samples than this make no lake */
const MIN_CELLS = 4;
/** Hollows one pour fills at most (each becomes a body, a map carries 64) */
export const POUR_MAX_LAKES = 12;

/**
 * The height water stands at on every sample when every hollow is full:
 * the ground where water runs off, the overflow height across a hollow.
 * Water leaves at the map's edge and into `wet` samples.
 */
export function filledHeights(heights: Float32Array, columns: number, rows: number, wet: Uint8Array): Float32Array {
  const n = columns * rows;
  const filled = heights.slice();
  const closed = new Uint8Array(n);
  const heap = new MinHeap();
  // Samples inside a hollow, at its level: they need no heap (Priority-Flood+Queue)
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let k = 0; k < n; k++) {
    const i = k % columns;
    const j = (k - i) / columns;
    if (wet[k] || i === 0 || j === 0 || i === columns - 1 || j === rows - 1) {
      closed[k] = 1;
      heap.push(k, filled[k]);
    }
  }
  while (head < tail || heap.size) {
    const k = head < tail ? queue[head++] : heap.pop();
    const level = filled[k];
    const i = k % columns;
    for (const m of [i > 0 ? k - 1 : -1, i < columns - 1 ? k + 1 : -1, k - columns, k + columns]) {
      if (m < 0 || m >= n || closed[m]) continue;
      closed[m] = 1;
      if (filled[m] <= level) {
        filled[m] = level;
        queue[tail++] = m;
      } else {
        heap.push(m, filled[m]);
      }
    }
  }
  return filled;
}

/** Where water poured at `input.starts` stands: the hollows on its way down, each filled to where it overflows */
export function pourWater(input: PourInput): PourResult {
  const { columns, rows, heights: h, wet } = input;
  const n = columns * rows;
  const filled = filledHeights(h, columns, rows, wet);
  /** The flat each sample was last found in */
  const flatOf = new Int32Array(n).fill(-1);
  const lakes: PouredLake[] = [];
  const found = new Set<number>();
  let skipped = 0;
  let flats = 0;
  const flat: number[] = [];
  /** The hollow each sample was found in */
  const lakeOf = new Int32Array(n).fill(-1);
  const lake: number[] = [];
  for (const start of input.starts) {
    let at = start;
    // Down the filled surface: each step a lower flat, so the walk ends
    for (;;) {
      if (wet[at] || flatOf[at] >= 0) break;
      const level = filled[at];
      const id = flats++;
      flat.length = 0;
      flat.push(at);
      flatOf[at] = id;
      let next = -1;
      for (const k of flat) {
        const i = k % columns;
        for (const m of [i > 0 ? k - 1 : -1, i < columns - 1 ? k + 1 : -1, k - columns, k + columns]) {
          if (m < 0 || m >= n || flatOf[m] === id) continue;
          if (filled[m] === level) {
            flatOf[m] = id;
            flat.push(m);
          } else if (filled[m] < level && (next < 0 || filled[m] < filled[next])) {
            next = m;
          }
        }
      }
      // Landed below the flat: a hollow, the ground below its level connected to where the water came in
      // (other hollows in the same flat, pits in a plain beyond its rim, stay dry)
      if (h[at] < level) {
        lake.length = 0;
        lake.push(at);
        lakeOf[at] = id;
        let floor = h[at];
        let lowest = at;
        for (const k of lake) {
          if (h[k] < floor) {
            floor = h[k];
            lowest = k;
          }
          const i = k % columns;
          for (const m of [i > 0 ? k - 1 : -1, i < columns - 1 ? k + 1 : -1, k - columns, k + columns]) {
            if (m < 0 || m >= n || lakeOf[m] === id || h[m] >= level) continue;
            lakeOf[m] = id;
            lake.push(m);
          }
        }
        // The lowest sample names the hollow: two starts that reach the same one fill it once
        if (lake.length >= MIN_CELLS && level - floor >= POUR_MIN_DEPTH && !found.has(lowest)) {
          found.add(lowest);
          if (lakes.length < POUR_MAX_LAKES) lakes.push({ level, floor, cells: Int32Array.from(lake) });
          else skipped++;
        }
      }
      // Without a lower sample next to it the flat drains only over the map's edge
      if (next < 0) break;
      at = next;
    }
  }
  return { lakes, skipped };
}

/**
 * The pour in a worker, so the flood over a big map stays off the page's
 * thread; inline where there are no workers. Rejects when the worker fails.
 */
export function pourOffThread(input: PourInput): Promise<PourResult> {
  if (typeof Worker === 'undefined') return Promise.resolve(pourWater(input));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/pour.worker', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<PourResult | { error: string }>) => {
      worker.terminate();
      if ('error' in e.data) reject(new Error(e.data.error));
      else resolve(e.data);
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'The pour worker failed'));
    };
    // The worker gets copies; the page keeps its own arrays
    const copy = { ...input, heights: input.heights.slice(), wet: input.wet.slice() };
    worker.postMessage(copy, [copy.heights.buffer, copy.wet.buffer]);
  });
}
