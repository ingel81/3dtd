import { describe, it, expect, beforeEach } from 'vitest';
import { LocationStore } from './location.store';

describe('LocationStore', () => {
  let store: LocationStore;

  beforeEach(() => {
    store = new LocationStore();
  });

  describe('initial values', () => {
    it('baseCoords starts at 0,0', () => {
      expect(store.baseCoords()).toEqual({ lat: 0, lon: 0 });
    });

    it('centerCoords starts at 0,0 with height 400', () => {
      expect(store.centerCoords()).toEqual({ lat: 0, lon: 0, height: 400 });
    });

    it('spawnPoints starts as empty array', () => {
      expect(store.spawnPoints()).toEqual([]);
    });

    it('currentLocationName starts as empty string', () => {
      expect(store.currentLocationName()).toBe('');
    });

    it('favorites starts as empty array', () => {
      expect(store.favorites()).toEqual([]);
    });

    it('favoriteNamesMap starts as empty Map', () => {
      expect(store.favoriteNamesMap().size).toBe(0);
    });

    it('streetCount starts at 0', () => {
      expect(store.streetCount()).toBe(0);
    });

    it('isApplyingLocation starts as false', () => {
      expect(store.isApplyingLocation()).toBe(false);
    });
  });

  describe('signal set/update', () => {
    it('baseCoords can be set', () => {
      store.baseCoords.set({ lat: 48.7758, lon: 9.1829 });
      expect(store.baseCoords()).toEqual({ lat: 48.7758, lon: 9.1829 });
    });

    it('centerCoords can be set with height', () => {
      store.centerCoords.set({ lat: 48.7758, lon: 9.1829, height: 600 });
      expect(store.centerCoords()).toEqual({ lat: 48.7758, lon: 9.1829, height: 600 });
    });

    it('spawnPoints can be set', () => {
      const spawns = [
        { id: 'sp1', name: 'North', lat: 48.78, lon: 9.18, color: 0xff0000 },
        { id: 'sp2', name: 'South', lat: 48.77, lon: 9.19, color: 0x00ff00 },
      ];
      store.spawnPoints.set(spawns);
      expect(store.spawnPoints()).toEqual(spawns);
      expect(store.spawnPoints()).toHaveLength(2);
    });

    it('favorites can be set', () => {
      const favs = [
        { id: 'f1', name: 'Stuttgart', hq: { lat: 48.77, lon: 9.18 }, spawns: [] },
      ];
      store.favorites.set(favs);
      expect(store.favorites()).toHaveLength(1);
      expect(store.favorites()[0].name).toBe('Stuttgart');
    });

    it('favoriteNamesMap can be set', () => {
      const map = new Map([['f1', 'Stuttgart'], ['f2', 'Berlin']]);
      store.favoriteNamesMap.set(map);
      expect(store.favoriteNamesMap().get('f1')).toBe('Stuttgart');
      expect(store.favoriteNamesMap().size).toBe(2);
    });

    it('streetCount can be set', () => {
      store.streetCount.set(42);
      expect(store.streetCount()).toBe(42);
    });

    it('isApplyingLocation can be toggled', () => {
      store.isApplyingLocation.set(true);
      expect(store.isApplyingLocation()).toBe(true);
      store.isApplyingLocation.set(false);
      expect(store.isApplyingLocation()).toBe(false);
    });
  });

  describe('resetAll', () => {
    it('resets all location state to initial values', () => {
      store.baseCoords.set({ lat: 48.77, lon: 9.18 });
      store.centerCoords.set({ lat: 48.77, lon: 9.18, height: 800 });
      store.spawnPoints.set([
        { id: 'sp1', name: 'Test', lat: 48.78, lon: 9.19, color: 0xff0000 },
      ]);
      store.currentLocationName.set('Stuttgart');
      store.favorites.set([
        { id: 'f1', name: 'Fav', hq: { lat: 0, lon: 0 }, spawns: [] },
      ]);
      store.favoriteNamesMap.set(new Map([['f1', 'Fav']]));
      store.streetCount.set(100);
      store.isApplyingLocation.set(true);

      store.resetAll();

      expect(store.baseCoords()).toEqual({ lat: 0, lon: 0 });
      expect(store.centerCoords()).toEqual({ lat: 0, lon: 0, height: 400 });
      expect(store.spawnPoints()).toEqual([]);
      expect(store.currentLocationName()).toBe('');
      expect(store.favorites()).toEqual([]);
      expect(store.favoriteNamesMap().size).toBe(0);
      expect(store.streetCount()).toBe(0);
      expect(store.isApplyingLocation()).toBe(false);
    });
  });
});
