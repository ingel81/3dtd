import { describe, it, expect, beforeEach } from 'vitest';
import {
  BEST_WAVES_KEY,
  BestWave,
  MAX_BEST_WAVES,
  byBestWave,
  findBestWave,
  loadBestWaves,
  recordBestWave,
  saveBestWaves,
} from './best-waves';

function best(lat: number, lon: number, bestWave: number, name = 'Somewhere', reachedAt = 0): BestWave {
  return { hq: { lat, lon }, spawns: [{ lat: lat + 0.005, lon }], name, detail: `Main St, ${name}`, bestWave, reachedAt };
}

describe('best waves', () => {
  beforeEach(() => localStorage.clear());

  describe('recordBestWave', () => {
    it('adds a new place', () => {
      const list = recordBestWave([best(48, 2, 7, 'Paris')], best(49, 9, 3, 'Heilbronn'));
      expect(list.map((r) => r.name)).toEqual(['Paris', 'Heilbronn']);
    });

    it('raises the record of a place about 100 m away and takes its HQ and spawn', () => {
      const higher = { ...best(49.0009, 9, 12, 'Heilbronn'), spawns: [{ lat: 49.01, lon: 9 }] };
      const list = recordBestWave([best(49, 9, 8, 'Heilbronn')], higher);
      expect(list).toHaveLength(1);
      expect(list[0]).toEqual(higher);
    });

    it('returns the same list when the wave does not beat the record', () => {
      const list = [best(49, 9, 8)];
      expect(recordBestWave(list, best(49, 9, 8))).toBe(list);
      expect(recordBestWave(list, best(49, 9, 5))).toBe(list);
    });

    it(`keeps at most ${MAX_BEST_WAVES}: the new place gets in, the weakest other record goes`, () => {
      let list: readonly BestWave[] = [];
      for (let i = 0; i < MAX_BEST_WAVES; i++) list = recordBestWave(list, best(i * 0.1, 0, 10, `P${i}`, i));

      // all the others are wave 10, the oldest of them goes
      list = recordBestWave(list, best(-10, 0, 2, 'Weak', 1000));
      expect(list).toHaveLength(MAX_BEST_WAVES);
      expect(list.some((r) => r.name === 'Weak')).toBe(true);
      expect(list.some((r) => r.name === 'P0')).toBe(false);

      // now the lowest wave goes before any older wave 10
      list = recordBestWave(list, best(-20, 0, 30, 'Strong', 2000));
      expect(list).toHaveLength(MAX_BEST_WAVES);
      expect(list.some((r) => r.name === 'Strong')).toBe(true);
      expect(list.some((r) => r.name === 'Weak')).toBe(false);
      expect(list.some((r) => r.name === 'P1')).toBe(true);
    });
  });

  it('findBestWave matches the place, not the exact coordinates', () => {
    expect(findBestWave([best(49, 9, 8, 'Heilbronn')], { lat: 49.0005, lon: 9 })?.name).toBe('Heilbronn');
    expect(findBestWave([best(49, 9, 8, 'Heilbronn')], { lat: 49.01, lon: 9 })).toBeUndefined();
  });

  it('byBestWave sorts the highest wave first, ties by the newer record', () => {
    const list = [best(1, 1, 5, 'A', 1), best(2, 2, 9, 'B', 1), best(3, 3, 5, 'C', 2)];
    expect([...list].sort(byBestWave).map((r) => r.name)).toEqual(['B', 'C', 'A']);
  });

  describe('persistence', () => {
    it('round-trips through its own key', () => {
      saveBestWaves([best(49, 9, 12, 'Heilbronn', 1000)]);
      expect(localStorage.getItem(BEST_WAVES_KEY)).not.toBeNull();
      expect(loadBestWaves()).toEqual([best(49, 9, 12, 'Heilbronn', 1000)]);
    });

    it('reads garbage as an empty list', () => {
      localStorage.setItem(BEST_WAVES_KEY, '{not json');
      expect(loadBestWaves()).toEqual([]);
      localStorage.setItem(BEST_WAVES_KEY, '{"hq":1}');
      expect(loadBestWaves()).toEqual([]);
    });

    it('skips malformed entries and keeps the rest', () => {
      localStorage.setItem(BEST_WAVES_KEY, JSON.stringify([
        best(49, 9, 12, 'Good'),
        { ...best(48, 2, 3, 'No detail'), detail: undefined },
        { ...best(48, 2, 0, 'Wave zero') },
        { ...best(48, 2, 2.5, 'Half a wave') },
        { ...best(48, 2, 4, 'Bad HQ'), hq: { lat: 'x', lon: 2 } },
        null,
      ]));
      expect(loadBestWaves().map((r) => r.name)).toEqual(['Good']);
    });
  });
});
