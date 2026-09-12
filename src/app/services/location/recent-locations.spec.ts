import { describe, it, expect, beforeEach } from 'vitest';
import {
  addRecentLocation,
  formatVisitAge,
  isSamePlace,
  loadRecentLocations,
  MAX_RECENT_LOCATIONS,
  RECENT_LOCATIONS_KEY,
  RecentLocation,
  saveRecentLocations,
} from './recent-locations';

function recent(lat: number, lon: number, name = 'Somewhere', visitedAt = 0): RecentLocation {
  return { hq: { lat, lon }, spawns: [{ lat: lat + 0.005, lon }], name, visitedAt };
}

describe('recent locations', () => {
  beforeEach(() => localStorage.clear());

  describe('isSamePlace', () => {
    it('treats HQs about 100 m apart as one place', () => {
      // 0.0009 deg latitude is about 100 m
      expect(isSamePlace({ lat: 49.0, lon: 9.0 }, { lat: 49.0009, lon: 9.0 })).toBe(true);
    });

    it('keeps HQs about 300 m apart apart', () => {
      expect(isSamePlace({ lat: 49.0, lon: 9.0 }, { lat: 49.0027, lon: 9.0 })).toBe(false);
    });
  });

  describe('addRecentLocation', () => {
    it('puts the new entry on top', () => {
      const list = addRecentLocation([recent(49, 9, 'Old')], recent(48, 2, 'New'));
      expect(list.map((r) => r.name)).toEqual(['New', 'Old']);
    });

    it('replaces an entry of the same place instead of adding one', () => {
      const list = addRecentLocation(
        [recent(48, 2, 'Paris'), recent(49.0, 9.0, 'Heilbronn old spawn')],
        { ...recent(49.0005, 9.0, 'Heilbronn new spawn'), spawns: [{ lat: 49.01, lon: 9.0 }] },
      );
      expect(list.map((r) => r.name)).toEqual(['Heilbronn new spawn', 'Paris']);
      expect(list[0].spawns).toEqual([{ lat: 49.01, lon: 9.0 }]);
    });

    it(`keeps at most ${MAX_RECENT_LOCATIONS}, dropping the oldest`, () => {
      let list: RecentLocation[] = [];
      for (let i = 0; i < MAX_RECENT_LOCATIONS + 2; i++) {
        list = addRecentLocation(list, recent(10 + i, 10, `P${i}`));
      }
      expect(list).toHaveLength(MAX_RECENT_LOCATIONS);
      expect(list[0].name).toBe(`P${MAX_RECENT_LOCATIONS + 1}`);
      expect(list.some((r) => r.name === 'P0' || r.name === 'P1')).toBe(false);
    });
  });

  describe('persistence', () => {
    it('round-trips through its own key', () => {
      saveRecentLocations([recent(49, 9, 'Heilbronn', 1000)]);
      expect(localStorage.getItem(RECENT_LOCATIONS_KEY)).not.toBeNull();
      expect(loadRecentLocations()).toEqual([recent(49, 9, 'Heilbronn', 1000)]);
    });

    it('reads garbage as an empty list', () => {
      localStorage.setItem(RECENT_LOCATIONS_KEY, '{not json');
      expect(loadRecentLocations()).toEqual([]);
      localStorage.setItem(RECENT_LOCATIONS_KEY, '{"hq":1}');
      expect(loadRecentLocations()).toEqual([]);
    });

    it('skips malformed entries and keeps the rest', () => {
      localStorage.setItem(RECENT_LOCATIONS_KEY, JSON.stringify([
        recent(49, 9, 'Good'),
        { hq: { lat: 'x', lon: 9 }, spawns: [], name: 'Bad', visitedAt: 0 },
        { name: 'No coords' },
      ]));
      expect(loadRecentLocations().map((r) => r.name)).toEqual(['Good']);
    });
  });

  describe('formatVisitAge', () => {
    const now = 10 * 24 * 3_600_000;
    it('reads out hours, then days', () => {
      expect(formatVisitAge(now - 5 * 60_000, now)).toBe('just now');
      expect(formatVisitAge(now - 5 * 3_600_000, now)).toBe('5 h ago');
      expect(formatVisitAge(now - 30 * 3_600_000, now)).toBe('yesterday');
      expect(formatVisitAge(now - 3 * 24 * 3_600_000, now)).toBe('3 days ago');
    });

    it('clamps a visit stamped in the future to just now', () => {
      expect(formatVisitAge(now + 60_000, now)).toBe('just now');
    });
  });
});
