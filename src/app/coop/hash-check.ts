/**
 * Divergence check of a coop room (docs/COOP_PLAN.md, C5): every client
 * reports its state hash at every HASH_EVERY_TICKS-th tick boundary; the
 * relay compares what came for one tick. Two different hashes for the same
 * tick mean the simulations ran apart.
 *
 * Pure and framework-free: the network relay (coop-server/room.ts) and the
 * in-process relay of the specs (local-relay.ts) share it.
 */

/** Ticks between two hash reports: 15 ticks are one game second. */
export const HASH_EVERY_TICKS = 15;

/** How many reports back a tick is kept while a player has not reported it yet. */
const KEEP_REPORTS = 20;

/** The hashes the players reported for a tick, where they did not agree. */
export interface Divergence {
  tick: number;
  /** Player id and hash, in the order they came in */
  hashes: [string, number][];
}

export class HashCheck {
  private readonly byTick = new Map<number, Map<string, number>>();
  private readonly flagged = new Set<number>();
  /** The last hash each player reported, and for which tick */
  readonly last = new Map<string, { tick: number; hash: number }>();

  /**
   * A player's hash for `tick`. Returns the divergence the first time the
   * tick has two different hashes, null otherwise: a later report for the
   * same tick does not report it again.
   */
  report(tick: number, playerId: string, hash: number): Divergence | null {
    this.last.set(playerId, { tick, hash });
    let reports = this.byTick.get(tick);
    if (!reports) {
      reports = new Map();
      this.byTick.set(tick, reports);
      this.prune(tick);
    }
    reports.set(playerId, hash);
    if (this.flagged.has(tick)) return null;
    const first = reports.values().next().value;
    for (const other of reports.values()) {
      if (other !== first) {
        this.flagged.add(tick);
        return { tick, hashes: [...reports] };
      }
    }
    return null;
  }

  private prune(newest: number): void {
    const oldest = newest - KEEP_REPORTS * HASH_EVERY_TICKS;
    for (const tick of this.byTick.keys()) {
      if (tick >= oldest) break;
      this.byTick.delete(tick);
      this.flagged.delete(tick);
    }
  }
}
