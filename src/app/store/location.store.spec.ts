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

    it('streetCount starts at 0', () => {
      expect(store.streetCount()).toBe(0);
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

    it('streetCount can be set', () => {
      store.streetCount.set(42);
      expect(store.streetCount()).toBe(42);
    });
  });

  describe('resetAll', () => {
    it('resets all location state to initial values', () => {
      store.baseCoords.set({ lat: 48.77, lon: 9.18 });
      store.centerCoords.set({ lat: 48.77, lon: 9.18, height: 800 });
      store.spawnPoints.set([
        { id: 'sp1', name: 'Test', lat: 48.78, lon: 9.19, color: 0xff0000 },
      ]);
      store.streetCount.set(100);

      store.resetAll();

      expect(store.baseCoords()).toEqual({ lat: 0, lon: 0 });
      expect(store.centerCoords()).toEqual({ lat: 0, lon: 0, height: 400 });
      expect(store.spawnPoints()).toEqual([]);
      expect(store.streetCount()).toBe(0);
    });
  });
});
