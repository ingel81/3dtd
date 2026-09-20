import { describe, it, expect } from 'vitest';
import { decideWave } from './director-rules';
import { NUM_ACTIVE_TEMPLATES } from './templates';

describe('decideWave', () => {
  /** The first `n` templates as candidates. */
  const first = (n: number) => Array.from({ length: n }, (_, i) => i);

  it('only ever picks a candidate', () => {
    // The candidate list carries the campaign pin, the requirements, the boss
    // cadence and the template cooldown. Picking outside it ships a wave the
    // designer explicitly excluded — e.g. an air wave against a ground-only
    // defense.
    for (let i = 0; i < 200; i++) {
      const d = decideWave(first(3), 12, [0, 1]);
      expect(d.templateIdx).toBeLessThan(3);
      expect(d.templateIdx).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps every factor inside [0,1]', () => {
    // The decoder interpolates these into designer ranges; out-of-range values
    // would silently extrapolate past the range the designer authored.
    for (const wave of [1, 30, 60, 200]) {
      for (let i = 0; i < 100; i++) {
        const d = decideWave(first(6), wave, []);
        for (const f of [d.factors.count, d.factors.spawn, d.factors.hp, d.factors.variation]) {
          expect(f).toBeGreaterThanOrEqual(0);
          expect(f).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('avoids recently used templates', () => {
    // Variety is enforced rather than rewarded: the old reward function had a
    // variation term and the candidate list has a cooldown, and waves still
    // came out repetitive.
    const picks = new Set<number>();
    for (let i = 0; i < 200; i++) {
      picks.add(decideWave(first(4), 9, [0, 1]).templateIdx);
    }
    expect(picks).toEqual(new Set([2, 3]));
  });

  it('falls back to the oldest of the used templates when all are recent', () => {
    // Index 0 is the stalest of the two, so it must come back rather than the
    // director stalling or picking a template that was not a candidate.
    const picks = new Set<number>();
    for (let i = 0; i < 50; i++) {
      picks.add(decideWave(first(2), 9, [0, 1]).templateIdx);
    }
    expect(picks).toEqual(new Set([0]));
  });

  it('ramps difficulty with the wave number', () => {
    // The player never heals, so HP is a whole-run budget and difficulty is a
    // curve — something written down, not inferred per wave.
    const mean = (wave: number, key: 'count' | 'hp') => {
      let sum = 0;
      for (let i = 0; i < 300; i++) sum += decideWave(first(6), wave, []).factors[key];
      return sum / 300;
    };
    expect(mean(60, 'count')).toBeGreaterThan(mean(1, 'count'));
    expect(mean(60, 'hp')).toBeGreaterThan(mean(1, 'hp'));
  });

  it('tightens the spawn delay as the run progresses', () => {
    const mean = (wave: number) => {
      let sum = 0;
      for (let i = 0; i < 300; i++) sum += decideWave(first(6), wave, []).factors.spawn;
      return sum / 300;
    };
    expect(mean(60)).toBeLessThan(mean(1));
  });

  it('holds the ramp flat past its end instead of overshooting', () => {
    const at = (wave: number) => decideWave(first(6), wave, [], () => 0.5).factors.count;
    expect(at(200)).toBeCloseTo(at(60), 6);
  });

  it('survives an empty candidate list without throwing', () => {
    // Defensive: candidateTemplates never returns an empty list. Shipping the
    // designer's first template beats shipping nothing at all.
    const d = decideWave([], 5, []);
    expect(d.templateIdx).toBe(0);
    expect(d.templateIdx).toBeLessThan(NUM_ACTIVE_TEMPLATES);
  });

  it('is deterministic given a fixed random source', () => {
    const fixed = () => 0.5;
    const a = decideWave(first(6), 20, [1], fixed);
    const b = decideWave(first(6), 20, [1], fixed);
    expect(a).toEqual(b);
  });

  it('varies successive waves at the same wave number', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) seen.add(decideWave(first(6), 20, []).factors.count);
    expect(seen.size).toBeGreaterThan(1);
  });

  describe('reports how it picked, for the decision explainer', () => {
    it('counts the candidates and the tie among templates outside the history', () => {
      const { why } = decideWave(first(6), 40, [0, 1], () => 0);
      expect(why).toMatchObject({ candidates: 6, lastRanWavesAgo: null, history: 2, tied: 4 });
    });

    it('says how long ago the pick last ran when every candidate is recent', () => {
      // Slot 0 ran two waves ago, slot 1 last wave: 0 is the stalest.
      const d = decideWave(first(2), 40, [0, 1]);
      expect(d.templateIdx).toBe(0);
      expect(d.why).toMatchObject({ candidates: 2, lastRanWavesAgo: 2, tied: 1 });
    });

    it('reports the ramp position it used', () => {
      const ramp = (wave: number) => {
        const { why } = decideWave(first(6), wave, []);
        return why.ramp;
      };
      expect(ramp(30)).toBeCloseTo(0.5, 6);
      expect(ramp(200)).toBe(1);
    });

    it('marks the empty-list fallback', () => {
      const d = decideWave([], 5, []);
      expect(d.why).toMatchObject({ candidates: 0 });
    });
  });
});
