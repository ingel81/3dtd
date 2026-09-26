import { isPoint, isSamePlace } from './recent-locations';
import { readJson, writeJson } from '../../utils/storage';

/** localStorage key of the best wave per place, the world map reads it */
export const BEST_WAVES_KEY = 'td_best_waves_v1';

/**
 * Places kept. Past this the place just played still gets in and the weakest
 * other record makes room (lowest wave, then the oldest), so a high record
 * outlives stray wave-1 visits.
 */
export const MAX_BEST_WAVES = 200;

/** The best wave reached at one place. HQs within RECENT_SAME_PLACE_M count as one place. */
export interface BestWave {
  hq: { lat: number; lon: number };
  /** Spawns of the record run; the world map loads the first */
  spawns: { lat: number; lon: number }[];
  /** Town or city, the name the world map shows */
  name: string;
  /** Header text of the place (street, town), tells two HQs in one town apart */
  detail: string;
  /** Highest wave started here, 1 or more */
  bestWave: number;
  /** Date.now() when bestWave was reached */
  reachedAt: number;
}

/** The record of the place `hq` belongs to, if any. */
export function findBestWave(list: readonly BestWave[], hq: { lat: number; lon: number }): BestWave | undefined {
  return list.find((r) => isSamePlace(r.hq, hq));
}

/**
 * The list with `entry` as the place's record, when it beats the stored one
 * or the place is new; otherwise `list` itself, so callers can skip the
 * write. A beaten record takes the new HQ, spawns and names: the world map
 * loads the place as it was played when the record fell.
 */
export function recordBestWave(list: readonly BestWave[], entry: BestWave): readonly BestWave[] {
  const stored = findBestWave(list, entry.hq);
  if (stored && stored.bestWave >= entry.bestWave) return list;
  const others = list.filter((r) => r !== stored);
  const next = [...others, entry];
  if (next.length <= MAX_BEST_WAVES) return next;
  const weakest = others.reduce((a, b) =>
    b.bestWave < a.bestWave || (b.bestWave === a.bestWave && b.reachedAt < a.reachedAt) ? b : a,
  );
  return next.filter((r) => r !== weakest);
}

/** Highest wave first, ties by the more recent record. */
export function byBestWave(a: BestWave, b: BestWave): number {
  return b.bestWave - a.bestWave || b.reachedAt - a.reachedAt;
}

function isBestWave(v: unknown): v is BestWave {
  const r = v as Partial<BestWave> | null;
  return !!r
    && isPoint(r.hq)
    && Array.isArray(r.spawns) && r.spawns.every(isPoint)
    && typeof r.name === 'string'
    && typeof r.detail === 'string'
    && Number.isInteger(r.bestWave) && r.bestWave! >= 1
    && Number.isFinite(r.reachedAt);
}

/** Stored records, empty when missing, unreadable or blocked. Malformed entries are skipped. */
export function loadBestWaves(): BestWave[] {
  const parsed = readJson(BEST_WAVES_KEY);
  return Array.isArray(parsed) ? parsed.filter(isBestWave).slice(0, MAX_BEST_WAVES) : [];
}

export function saveBestWaves(list: readonly BestWave[]): void {
  // Storage full or blocked: the records live until the reload
  writeJson(BEST_WAVES_KEY, list);
}
