import { haversineDistance } from '../../utils/geo-utils';
import { readJson, writeJson } from '../../utils/storage';

/** localStorage key of the recent list, separate from the favorites (td_favorites_v2) */
export const RECENT_LOCATIONS_KEY = 'td_recent_locations_v1';

/** Entries kept, newest first */
export const MAX_RECENT_LOCATIONS = 8;

/**
 * HQs closer than this (m) are one place: visiting it again moves the entry to
 * the top and takes the newer spawn and name instead of adding a second row.
 */
export const RECENT_SAME_PLACE_M = 150;

export interface RecentLocation {
  hq: { lat: number; lon: number };
  /** Spawns as played; the dialog loads the first */
  spawns: { lat: number; lon: number }[];
  /** Name the header showed, resolved when the place was played */
  name: string;
  /** Date.now() of the last visit */
  visitedAt: number;
}

export function isSamePlace(a: { lat: number; lon: number }, b: { lat: number; lon: number }): boolean {
  return haversineDistance(a.lat, a.lon, b.lat, b.lon) <= RECENT_SAME_PLACE_M;
}

/** The list with `entry` on top, older entries of the same place dropped, capped. */
export function addRecentLocation(list: readonly RecentLocation[], entry: RecentLocation): RecentLocation[] {
  const others = list.filter((r) => !isSamePlace(r.hq, entry.hq));
  return [entry, ...others].slice(0, MAX_RECENT_LOCATIONS);
}

export function isPoint(v: unknown): v is { lat: number; lon: number } {
  const p = v as { lat?: unknown; lon?: unknown } | null;
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon);
}

function isRecentLocation(v: unknown): v is RecentLocation {
  const r = v as Partial<RecentLocation> | null;
  return !!r
    && isPoint(r.hq)
    && Array.isArray(r.spawns) && r.spawns.every(isPoint)
    && typeof r.name === 'string'
    && Number.isFinite(r.visitedAt);
}

/** Stored list, empty when missing, unreadable or blocked. Malformed entries are skipped. */
export function loadRecentLocations(): RecentLocation[] {
  const parsed = readJson(RECENT_LOCATIONS_KEY);
  return Array.isArray(parsed) ? parsed.filter(isRecentLocation).slice(0, MAX_RECENT_LOCATIONS) : [];
}

export function saveRecentLocations(list: readonly RecentLocation[]): void {
  // Storage full or blocked: the list lives until the reload
  writeJson(RECENT_LOCATIONS_KEY, list);
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** "just now", "5 h ago", "yesterday", "3 days ago" */
export function formatVisitAge(visitedAt: number, now: number): string {
  const age = Math.max(0, now - visitedAt);
  if (age < HOUR_MS) return 'just now';
  if (age < DAY_MS) return `${Math.floor(age / HOUR_MS)} h ago`;
  const days = Math.floor(age / DAY_MS);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
