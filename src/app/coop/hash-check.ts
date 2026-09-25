/**
 * Divergence check of a coop room (docs/COOP_PLAN.md, C5): every client
 * reports its state hash at every HASH_EVERY_TICKS-th tick boundary; the
 * relay compares what came for one tick. Two different hashes for the same
 * tick mean the simulations ran apart.
 *
 * Pure and framework-free: the network relay (coop-server/room.ts) and the
 * in-process relay of the specs (local-relay.ts) share it.
 */

/** Ticks between two hash reports: 30 ticks are one game second. */
export const HASH_EVERY_TICKS = 30;

/** How many reports back a tick is kept while a player has not reported it yet. */
const KEEP_REPORTS = 20;

/** The hashes the players reported for a tick, where they did not agree. */
export interface Divergence {
  tick: number;
  /** Player id and hash, in the order they came in */
  hashes: [string, number][];
  /**
   * The players whose hash is not the majority's (docs/COOP_PLAN.md, S3);
   * empty where there is no majority, as with two players.
   */
  outOfStep: string[];
}

/** The players off the majority's hash; none without a strict majority. */
export function outOfStep(hashes: readonly [string, number][]): string[] {
  const counts = new Map<number, number>();
  for (const [, hash] of hashes) counts.set(hash, (counts.get(hash) ?? 0) + 1);
  for (const [hash, count] of counts) {
    if (count * 2 > hashes.length) return hashes.filter(([, h]) => h !== hash).map(([id]) => id);
  }
  return [];
}

export class HashCheck {
  private readonly byTick = new Map<number, Map<string, number>>();
  private readonly flagged = new Set<number>();
  /** The last hash each player reported, and for which tick */
  readonly last = new Map<string, { tick: number; hash: number }>();

  /**
   * A player's hash for `tick`, with the number of players who report
   * (`expected`). A tick is judged once all of them reported it, or once a
   * later tick came in (someone never will: a lost report, a player gone),
   * so a majority can say who is out of step. Returns the divergence the
   * first time a judged tick has different hashes, null otherwise.
   */
  report(tick: number, playerId: string, hash: number, expected = 2): Divergence | null {
    this.last.set(playerId, { tick, hash });
    let reports = this.byTick.get(tick);
    if (!reports) {
      reports = new Map();
      this.byTick.set(tick, reports);
      this.prune(tick);
    }
    reports.set(playerId, hash);
    for (const [at, those] of this.byTick) {
      if (at > tick) break;
      if (this.flagged.has(at) || (at === tick && those.size < expected) || allAlike(those)) continue;
      this.flagged.add(at);
      const hashes = [...those];
      return { tick: at, hashes, outOfStep: outOfStep(hashes) };
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

function allAlike(reports: Map<string, number>): boolean {
  const first = reports.values().next().value;
  for (const hash of reports.values()) if (hash !== first) return false;
  return true;
}
