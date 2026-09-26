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

/**
 * The parts of the state hash, in the order the StateHasher reads them
 * (simulator/state-hash.ts). Here, not there: the relay imports this file
 * and nothing that pulls the game in.
 */
export const HASH_PARTS = ['clock', 'credits', 'health', 'wave', 'ids', 'rng', 'enemies', 'towers', 'projectiles', 'heroes'] as const;
export type HashPart = (typeof HASH_PARTS)[number];

/** Per entity part, each entity as the hash read it: its id (or index) first, then its values. */
export type HashedEntities = Partial<Record<HashPart, (string | number)[][]>>;

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
  /** The parts whose hashes differ (HASH_PARTS); empty where a client sent none */
  parts: HashPart[];
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
  private readonly partsByTick = new Map<number, Map<string, readonly number[]>>();
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
  report(tick: number, playerId: string, hash: number, expected = 2, parts?: readonly number[]): Divergence | null {
    this.last.set(playerId, { tick, hash });
    let reports = this.byTick.get(tick);
    if (!reports) {
      reports = new Map();
      this.byTick.set(tick, reports);
      this.prune(tick);
    }
    reports.set(playerId, hash);
    if (parts && parts.length === HASH_PARTS.length) {
      let byPlayer = this.partsByTick.get(tick);
      if (!byPlayer) this.partsByTick.set(tick, (byPlayer = new Map()));
      byPlayer.set(playerId, parts);
    }
    for (const [at, those] of this.byTick) {
      if (at > tick) break;
      if (this.flagged.has(at) || (at === tick && those.size < expected) || allAlike(those)) continue;
      this.flagged.add(at);
      const hashes = [...those];
      return { tick: at, hashes, outOfStep: outOfStep(hashes), parts: differingParts(this.partsByTick.get(at)) };
    }
    return null;
  }

  private prune(newest: number): void {
    const oldest = newest - KEEP_REPORTS * HASH_EVERY_TICKS;
    for (const tick of this.byTick.keys()) {
      if (tick >= oldest) break;
      this.byTick.delete(tick);
      this.partsByTick.delete(tick);
      this.flagged.delete(tick);
    }
  }
}

function allAlike(reports: Map<string, number>): boolean {
  const first = reports.values().next().value;
  for (const hash of reports.values()) if (hash !== first) return false;
  return true;
}

/** The parts where the players' part hashes differ; none without two players' parts. */
function differingParts(byPlayer: Map<string, readonly number[]> | undefined): HashPart[] {
  if (!byPlayer || byPlayer.size < 2) return [];
  const all = [...byPlayer.values()];
  return HASH_PARTS.filter((_, i) => all.some((parts) => parts[i] !== all[0][i]));
}

/** An entity that differs between the players: its part, its id and what each player had (null: not there). */
export interface EntityDifference {
  part: HashPart;
  id: string | number;
  values: [string, (string | number)[] | null][];
}

/** Most rows a detail may hold per part; more is not a state this game reaches. */
const MAX_DETAIL_ROWS = 5000;
/** Longest string in a detail row (entity ids, a tower's target and owner) */
const MAX_DETAIL_ID = 64;

/** `data` as HashedEntities when it has that shape (plain values, bounded), null otherwise. */
export function validDetail(data: unknown): HashedEntities | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  const out: HashedEntities = {};
  for (const part of HASH_PARTS) {
    const rows = (data as Record<string, unknown>)[part];
    if (rows === undefined) continue;
    if (!Array.isArray(rows) || rows.length > MAX_DETAIL_ROWS) return null;
    const plain = rows.every((row) => Array.isArray(row) && row.length > 0 && row.length <= 16
      && row.every((v) => (typeof v === 'string' && v.length <= MAX_DETAIL_ID) || (typeof v === 'number' && Number.isFinite(v))));
    if (!plain) return null;
    out[part] = rows as (string | number)[][];
  }
  return out;
}

/**
 * The first `limit` entities that differ between the players' details, part
 * by part in HASH_PARTS order: one missing on a side, or other values. The
 * id is the first value of a row.
 */
export function firstDifferences(details: readonly [string, HashedEntities][], limit = 5): EntityDifference[] {
  const out: EntityDifference[] = [];
  for (const part of HASH_PARTS) {
    const byPlayer = details.map(([player, detail]) => [player, new Map((detail[part] ?? []).map((row) => [row[0], row]))] as const);
    const ids = new Set<string | number>();
    for (const [, rows] of byPlayer) for (const id of rows.keys()) ids.add(id);
    for (const id of ids) {
      const values = byPlayer.map(([player, rows]) => [player, rows.get(id) ?? null] as [string, (string | number)[] | null]);
      const first = JSON.stringify(values[0][1]);
      if (values.every(([, v]) => JSON.stringify(v) === first)) continue;
      out.push({ part, id, values });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
