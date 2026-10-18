import { CRATERS } from '../../configs/destruction.config';

/** Whole numbers per crater: middle x and y (map dm), radius (dm), depth (cm) */
export const CRATER_STRIDE = 4;

/** What dig() did: the crater's index, and its entry before when it deepened one (null for a new one) */
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

/**
 * The craters of a run (docs/DESTRUCTION_PLAN.md): four whole numbers each,
 * in the order they were dug. A hit within CRATERS.mergeM of a crater's
 * middle deepens it and widens it to the larger radius, up to the depth its
 * radius allows, instead of making another: the list grows with the places,
 * not with the hits, and holds at most CRATERS.max. Part of the snapshot and
 * the state hash once it has an entry.
 */
export class CraterLedger {
  private readonly data = new Int32Array(CRATERS.max * CRATER_STRIDE);
  private count = 0;
  private readonly mergeDm2 = (CRATERS.mergeM * 10) ** 2;

  get size(): number {
    return this.count;
  }

  /**
   * A hit at map dm (`xDm`, `yDm`) digging a crater `rDm` dm wide `depthCm`
   * deeper; null when the list is full or the hit changes nothing (a crater
   * as deep as its radius allows)
   */
  dig(xDm: number, yDm: number, rDm: number, depthCm: number): CraterDug | null {
    const d = this.data;
    for (let i = 0; i < this.count; i++) {
      const k = i * CRATER_STRIDE;
      const dx = d[k] - xDm;
      const dy = d[k + 1] - yDm;
      if (dx * dx + dy * dy > this.mergeDm2) continue;
      const before = [d[k], d[k + 1], d[k + 2], d[k + 3]] as const;
      const radius = Math.max(d[k + 2], rDm);
      const depth = Math.min(craterMaxDepthCm(radius), Math.max(d[k + 3], d[k + 3] + depthCm));
      if (radius === d[k + 2] && depth === d[k + 3]) return null;
      d[k + 2] = radius;
      d[k + 3] = depth;
      return { index: i, before };
    }
    if (this.count >= CRATERS.max) return null;
    const k = this.count * CRATER_STRIDE;
    d[k] = xDm;
    d[k + 1] = yDm;
    d[k + 2] = rDm;
    d[k + 3] = Math.min(craterMaxDepthCm(rDm), depthCm);
    return { index: this.count++, before: null };
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
    this.count = 0;
    if (!list) return;
    const n = Math.min(CRATERS.max, Math.floor(list.length / CRATER_STRIDE));
    for (let i = 0; i < n * CRATER_STRIDE; i++) {
      const v = list[i];
      if (!Number.isInteger(v)) {
        this.count = 0;
        return;
      }
      this.data[i] = v;
    }
    this.count = n;
  }

  clear(): void {
    this.count = 0;
  }
}
