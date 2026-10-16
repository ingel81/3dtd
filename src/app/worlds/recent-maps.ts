import { readJson, writeJson } from '../utils/storage';

/** localStorage key of the Built Worlds' Recent: the ids of the maps played lately, newest first */
export const RECENT_MAPS_KEY = 'td_recent_maps_v1';
/** Entries the Built Worlds' Recent keeps (decision 11) */
export const MAX_RECENT_MAPS = 5;
/** Unchanged OpenStreetMap maps the world keeps as its Recent worlds; an older one goes to the trash (decision 3, 4) */
export const MAX_RECENT_WORLDS = 10;

export function loadRecentMaps(): string[] {
  const value = readJson(RECENT_MAPS_KEY);
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').slice(0, MAX_RECENT_MAPS) : [];
}

/** `id` on top of the Built Worlds' Recent, kept */
export function recordRecentMap(id: string): string[] {
  const next = [id, ...loadRecentMaps().filter((other) => other !== id)].slice(0, MAX_RECENT_MAPS);
  writeJson(RECENT_MAPS_KEY, next);
  return next;
}

/** `id` off the Built Worlds' Recent */
export function forgetRecentMap(id: string): string[] {
  const next = loadRecentMaps().filter((other) => other !== id);
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
