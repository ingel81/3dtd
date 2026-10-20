import { CRATERS } from '../../configs/destruction.config';

/** Whole numbers per crater: middle x and y (map dm), radius (dm), depth (cm) */
export const CRATER_STRIDE = 4;

/** What dig() did: the crater's index, and its entry before when it changed one (null for a new one) */
export interface CraterDug {
  index: number;
  before: readonly [number, number, number, number] | null;
}

/** The most a crater of `rDm` dm radius gets deep, cm (CRATERS.maxDepthPerRadiusCm) */
export function craterMaxDepthCm(rDm: number): number {
  return Math.round((rDm * CRATERS.maxDepthPerRadiusCm) / 10);
}

/** The cm one hit of a crater `rDm` dm wide digs (CRATERS.depthPerRadiusCm) */
export function craterHitDepthCm(rDm: number): number {
  return Math.round((rDm * CRATERS.depthPerRadiusCm) / 10);
}

/** Decimetres a side of the index's cells: a hit looks for the crater it deepens in its own cell and the eight round it */
const CELL_DM = Math.max(1, CRATERS.mergeM * 10);

/**
 * The craters of a run (docs/DESTRUCTION_PLAN.md): four whole numbers each,
 * in the order they were dug. A hit within CRATERS.mergeM of a crater's
 * middle deepens it and widens it to the larger radius, up to the depth its
 * radius allows, instead of making another: the list grows with the places,
 * not with the hits. Once that depth is reached a hit there widens it (by
 * CRATERS.widenShare of the hit's radius, up to CRATERS.widenTo times it),
 * so a crater bombed again keeps growing.
 *
 * The list grows as the run needs it (doubling), with an index of cells of
 * CRATERS.mergeM, so a hit finds its crater among the few near it, not
 * among all. Only at CRATERS.max, a guard far beyond any run, does a new
 * crater take the place of the smallest, which goes into its nearest
 * neighbour (merge): nothing a hit digs is lost. Part of the snapshot and
 * the state hash once it has an entry.
 */
export class CraterLedger {
  private data: Int32Array = new Int32Array(64 * CRATER_STRIDE);
  private count = 0;
  private readonly mergeDm2 = (CRATERS.mergeM * 10) ** 2;
  /** The craters by the cell of their middle, in dig order within a cell */
  private readonly cells = new Map<number, number[]>();

  get size(): number {
    return this.count;
  }

  /**
   * A hit at map dm (`xDm`, `yDm`) digging a crater `rDm` dm wide `depthCm`
   * deeper; null when it changes nothing: a crater as deep and as wide as
   * the hit can make it. `merged` hears a crater the guard (CRATERS.max)
   * folded into its neighbour first, with that neighbour's entry before
   */
  dig(xDm: number, yDm: number, rDm: number, depthCm: number, merged?: (dug: CraterDug) => void): CraterDug | null {
    const d = this.data;
    const near = this.nearest(xDm, yDm);
    if (near >= 0) {
      const k = near * CRATER_STRIDE;
      const before = [d[k], d[k + 1], d[k + 2], d[k + 3]] as const;
      let radius = Math.max(d[k + 2], rDm);
      let depth = Math.min(craterMaxDepthCm(radius), Math.max(d[k + 3], d[k + 3] + depthCm));
      // As deep as its radius allows: the hit widens it, and the wider one may go deeper
      if (radius === d[k + 2] && depth === d[k + 3]) {
        radius = Math.max(radius, Math.min(Math.round(rDm * CRATERS.widenTo), radius + Math.round(rDm * CRATERS.widenShare)));
        depth = Math.min(craterMaxDepthCm(radius), depth + depthCm);
      }
      if (radius === d[k + 2] && depth === d[k + 3]) return null;
      d[k + 2] = radius;
      d[k + 3] = depth;
      return { index: near, before };
    }
    const depth = Math.min(craterMaxDepthCm(rDm), depthCm);
    if (this.count < CRATERS.max) {
      this.grow();
      this.write(this.count, xDm, yDm, rDm, depth);
      this.index(this.count);
      return { index: this.count++, before: null };
    }
    // The guard: the smallest crater into its nearest neighbour, the new one in its place
    const smallest = this.smallest();
    const into = this.nearestTo(smallest);
    const s = smallest * CRATER_STRIDE;
    const t = into * CRATER_STRIDE;
    const intoBefore = [d[t], d[t + 1], d[t + 2], d[t + 3]] as const;
    const radius = Math.max(d[t + 2], d[s + 2]);
    d[t + 2] = radius;
    d[t + 3] = Math.min(craterMaxDepthCm(radius), Math.max(d[t + 3], d[s + 3]));
    merged?.({ index: into, before: intoBefore });
    const before = [d[s], d[s + 1], d[s + 2], d[s + 3]] as const;
    this.unindex(smallest);
    this.write(smallest, xDm, yDm, rDm, depth);
    this.index(smallest);
    return { index: smallest, before };
  }

  /** Crater `i`'s four numbers, a view into the list */
  entry(i: number): Int32Array {
    return this.data.subarray(i * CRATER_STRIDE, (i + 1) * CRATER_STRIDE);
  }

  /** Every crater, CRATER_STRIDE numbers each, a view (the state hash) */
  view(): Int32Array {
    return this.data.subarray(0, this.count * CRATER_STRIDE);
  }

  /** Every crater, CRATER_STRIDE numbers each, a copy (the op, the snapshot) */
  list(): Int32Array {
    return this.data.slice(0, this.count * CRATER_STRIDE);
  }

  /** The craters of list() back; anything else (a snapshot from before craters) leaves none */
  restore(list: ArrayLike<number> | undefined): void {
    this.clear();
    if (!list) return;
    const n = Math.min(CRATERS.max, Math.floor(list.length / CRATER_STRIDE));
    for (let i = 0; i < n * CRATER_STRIDE; i++) {
      if (!Number.isInteger(list[i])) return;
    }
    while (this.data.length < n * CRATER_STRIDE) this.data = grown(this.data);
    for (let i = 0; i < n * CRATER_STRIDE; i++) this.data[i] = list[i];
    this.count = n;
    for (let i = 0; i < n; i++) this.index(i);
  }

  clear(): void {
    this.count = 0;
    this.cells.clear();
  }

  /** The crater a hit at (`xDm`, `yDm`) deepens: the first dug within mergeM of it, -1 none */
  private nearest(xDm: number, yDm: number): number {
    const d = this.data;
    const cx = Math.floor(xDm / CELL_DM);
    const cy = Math.floor(yDm / CELL_DM);
    let found = -1;
    for (let j = cy - 1; j <= cy + 1; j++) {
      for (let i = cx - 1; i <= cx + 1; i++) {
        for (const c of this.cells.get(cellKey(i, j)) ?? NONE) {
          if (found >= 0 && c >= found) break;
          const k = c * CRATER_STRIDE;
          const dx = d[k] - xDm;
          const dy = d[k + 1] - yDm;
          if (dx * dx + dy * dy <= this.mergeDm2) found = c;
        }
      }
    }
    return found;
  }

  /** The smallest crater (radius squared times depth), the first of equals */
  private smallest(): number {
    const d = this.data;
    let best = 0;
    let least = Infinity;
    for (let i = 0; i < this.count; i++) {
      const k = i * CRATER_STRIDE;
      const v = d[k + 2] * d[k + 2] * d[k + 3];
      if (v < least) {
        least = v;
        best = i;
      }
    }
    return best;
  }

  /** The crater whose middle lies nearest crater `i`'s, the first of equals */
  private nearestTo(i: number): number {
    const d = this.data;
    const x = d[i * CRATER_STRIDE];
    const y = d[i * CRATER_STRIDE + 1];
    let best = i === 0 ? 1 : 0;
    let least = Infinity;
    for (let c = 0; c < this.count; c++) {
      if (c === i) continue;
      const dx = d[c * CRATER_STRIDE] - x;
      const dy = d[c * CRATER_STRIDE + 1] - y;
      const v = dx * dx + dy * dy;
      if (v < least) {
        least = v;
        best = c;
      }
    }
    return best;
  }

  private grow(): void {
    if ((this.count + 1) * CRATER_STRIDE > this.data.length) this.data = grown(this.data);
  }

  private write(i: number, xDm: number, yDm: number, rDm: number, depthCm: number): void {
    const k = i * CRATER_STRIDE;
    this.data[k] = xDm;
    this.data[k + 1] = yDm;
    this.data[k + 2] = rDm;
    this.data[k + 3] = depthCm;
  }

  /** Crater `i` into its cell's list, in index order */
  private index(i: number): void {
    const key = cellKey(Math.floor(this.data[i * CRATER_STRIDE] / CELL_DM), Math.floor(this.data[i * CRATER_STRIDE + 1] / CELL_DM));
    const list = this.cells.get(key);
    if (!list) {
      this.cells.set(key, [i]);
      return;
    }
    let at = list.length;
    while (at > 0 && list[at - 1] > i) at--;
    list.splice(at, 0, i);
  }

  private unindex(i: number): void {
    const key = cellKey(Math.floor(this.data[i * CRATER_STRIDE] / CELL_DM), Math.floor(this.data[i * CRATER_STRIDE + 1] / CELL_DM));
    const list = this.cells.get(key);
    const at = list?.indexOf(i) ?? -1;
    if (at >= 0) list!.splice(at, 1);
  }
}

const NONE: readonly number[] = [];

/** One number per index cell (map dm within +-2^24 cells either way) */
function cellKey(i: number, j: number): number {
  return (i + 0x800000) * 0x1000000 + (j + 0x800000);
}

/** `a` twice as long, its numbers kept */
function grown(a: Int32Array): Int32Array {
  const out = new Int32Array(a.length * 2);
  out.set(a);
  return out;
}
