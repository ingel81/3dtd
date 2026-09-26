import { FavoriteLocation, SavedSpawn } from '../../models/location.types';
import { isPoint } from './recent-locations';
import { readJson, writeJson } from '../../utils/storage';

/** localStorage key of the favorites, separate from the recent list (td_recent_locations_v1) */
export const FAVORITES_KEY = 'td_favorites_v2';

/** Longest name kept; the input stops there as well */
export const FAVORITE_NAME_MAX_LENGTH = 80;

/** A name as it is stored: trimmed and capped, undefined when nothing is left. */
export function normalizeFavoriteName(name: string | undefined): string | undefined {
  const trimmed = (name ?? '').trim().slice(0, FAVORITE_NAME_MAX_LENGTH).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isSavedSpawn(v: unknown): v is SavedSpawn {
  const bearing = (v as Partial<SavedSpawn> | null)?.portalBearing;
  return isPoint(v) && (bearing === undefined || Number.isFinite(bearing));
}

function isFavoriteLocation(v: unknown): v is FavoriteLocation {
  const f = v as Partial<FavoriteLocation> | null;
  return !!f
    && typeof f.id === 'string'
    && isPoint(f.hq)
    && Array.isArray(f.spawns) && f.spawns.every(isSavedSpawn)
    && (f.name === undefined || typeof f.name === 'string');
}

/**
 * Stored list in the order the player gave it, empty when missing,
 * unreadable or blocked. Malformed entries are skipped; entries saved
 * before names existed have none, spawns saved before the portal bearing
 * have none either (their portal faces along its route), and both read as
 * they are.
 */
export function loadFavoriteLocations(): FavoriteLocation[] {
  const parsed = readJson(FAVORITES_KEY);
  return Array.isArray(parsed) ? parsed.filter(isFavoriteLocation) : [];
}

export function saveFavoriteLocations(list: readonly FavoriteLocation[]): void {
  // Storage full or blocked: the list lives until the reload
  writeJson(FAVORITES_KEY, list);
}

/** The list with the favorite `id` renamed; an empty name drops the name, see FavoriteLocation.name. */
export function renameFavoriteLocation(
  list: readonly FavoriteLocation[],
  id: string,
  name: string,
): FavoriteLocation[] {
  const normalized = normalizeFavoriteName(name);
  return list.map((fav) => {
    if (fav.id !== id) return fav;
    const { name: _old, ...rest } = fav;
    return normalized ? { ...rest, name: normalized } : rest;
  });
}

/**
 * The list with the favorite `id` moved `offset` places (-1 up, 1 down),
 * stopped at either end. The same list when `id` is not in it.
 */
export function moveFavoriteLocation(
  list: readonly FavoriteLocation[],
  id: string,
  offset: number,
): FavoriteLocation[] {
  const from = list.findIndex((fav) => fav.id === id);
  if (from < 0) return [...list];
  const to = Math.max(0, Math.min(list.length - 1, from + offset));
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
