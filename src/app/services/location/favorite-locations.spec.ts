import { beforeEach, describe, expect, it } from 'vitest';
import {
  FAVORITES_KEY,
  FAVORITE_NAME_MAX_LENGTH,
  loadFavoriteLocations,
  moveFavoriteLocation,
  normalizeFavoriteName,
  renameFavoriteLocation,
  saveFavoriteLocations,
} from './favorite-locations';
import type { FavoriteLocation } from '../../models/location.types';

const fav = (id: string, name?: string): FavoriteLocation => ({
  id,
  hq: { lat: 48.8, lon: 2.3 },
  spawns: [{ lat: 48.805, lon: 2.3 }],
  createdAt: 1,
  ...(name ? { name } : {}),
});

const ids = (list: FavoriteLocation[]) => list.map((f) => f.id);

describe('favorite locations', () => {
  beforeEach(() => localStorage.clear());

  describe('storage', () => {
    it('reads favorites saved before names existed as they are', () => {
      // The format of td_favorites_v2 until 2026-09-14: no name
      const old = [
        { id: 'a', hq: { lat: 48.8, lon: 2.3 }, spawns: [{ lat: 48.805, lon: 2.3 }], createdAt: 1700000000000 },
        { id: 'b', hq: { lat: 49.17, lon: 9.26 }, spawns: [], createdAt: 1700000000001 },
      ];
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(old));
      expect(loadFavoriteLocations()).toEqual(old);
    });

    it('keeps the order and the names through a save', () => {
      saveFavoriteLocations([fav('b', 'Home'), fav('a')]);
      expect(loadFavoriteLocations()).toEqual([fav('b', 'Home'), fav('a')]);
    });

    it('skips malformed entries and reads a broken value as an empty list', () => {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify([fav('a'), { id: 'x' }, null, { ...fav('n'), name: 7 }]));
      expect(ids(loadFavoriteLocations())).toEqual(['a']);
      localStorage.setItem(FAVORITES_KEY, '{nope');
      expect(loadFavoriteLocations()).toEqual([]);
    });
  });

  describe('names', () => {
    it('trims and caps a name, and gives none for an empty one', () => {
      expect(normalizeFavoriteName('  Eiffel  ')).toBe('Eiffel');
      expect(normalizeFavoriteName('x'.repeat(FAVORITE_NAME_MAX_LENGTH + 5))).toHaveLength(FAVORITE_NAME_MAX_LENGTH);
      expect(normalizeFavoriteName('   ')).toBeUndefined();
      expect(normalizeFavoriteName(undefined)).toBeUndefined();
    });

    it('renames one favorite and drops the name when it is cleared', () => {
      const list = [fav('a', 'Old'), fav('b')];
      expect(renameFavoriteLocation(list, 'a', ' New ')).toEqual([fav('a', 'New'), fav('b')]);
      const cleared = renameFavoriteLocation(list, 'a', '');
      expect(cleared[0]).not.toHaveProperty('name');
      expect(list[0].name).toBe('Old');
    });
  });

  describe('order', () => {
    const list = [fav('a'), fav('b'), fav('c')];

    it('moves a favorite up or down one place', () => {
      expect(ids(moveFavoriteLocation(list, 'b', -1))).toEqual(['b', 'a', 'c']);
      expect(ids(moveFavoriteLocation(list, 'b', 1))).toEqual(['a', 'c', 'b']);
      expect(ids(list)).toEqual(['a', 'b', 'c']);
    });

    it('stops at either end and leaves the list alone for an unknown id', () => {
      expect(ids(moveFavoriteLocation(list, 'a', -1))).toEqual(['a', 'b', 'c']);
      expect(ids(moveFavoriteLocation(list, 'c', 1))).toEqual(['a', 'b', 'c']);
      expect(ids(moveFavoriteLocation(list, 'zz', 1))).toEqual(['a', 'b', 'c']);
    });
  });
});
