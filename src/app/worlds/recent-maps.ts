import { readJson, writeJson } from '../utils/storage';

/** localStorage key of the maps played lately in Built Worlds: id and when, newest first (v1 held ids only) */
export const RECENT_MAPS_KEY = 'td_recent_maps_v2';
/** Entries kept: their rows in the Built Worlds' list say when they were played (decision 11) */
export const MAX_RECENT_MAPS = 5;
/** Unchanged OpenStreetMap maps the world keeps as its Recent worlds; an older one goes to the trash (decision 3, 4) */
export const MAX_RECENT_WORLDS = 10;

/** A map played lately: its id and when its run began (ISO 8601) */
export interface RecentMap {
  id: string;
  at: string;
}

function isRecent(value: unknown): value is RecentMap {
  const r = value as Partial<RecentMap> | null;
  return !!r && typeof r.id === 'string' && typeof r.at === 'string';
}

export function loadRecentMaps(): RecentMap[] {
  const value = readJson(RECENT_MAPS_KEY);
  return Array.isArray(value) ? value.filter(isRecent).slice(0, MAX_RECENT_MAPS) : [];
}

/** `id` on top of the maps played lately, played `at` (now), kept */
export function recordRecentMap(id: string, at = new Date().toISOString()): RecentMap[] {
  const next = [{ id, at }, ...loadRecentMaps().filter((other) => other.id !== id)].slice(0, MAX_RECENT_MAPS);
  writeJson(RECENT_MAPS_KEY, next);
  return next;
}

/**
 * The generated maps beyond the Recent worlds' share, the oldest first out:
 * those that go to the trash, but never one a run still plays on (`keep`)
 */
export function overflowWorlds<T extends { id: string; updatedAt: string }>(generated: readonly T[], keep: ReadonlySet<string>, max = MAX_RECENT_WORLDS): T[] {
  const newest = [...generated].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return newest.slice(max).filter((m) => !keep.has(m.id));
}
