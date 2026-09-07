import { describe, it, expect } from 'vitest';
import { RuleDirector } from './rule-director';
import { MAX_TEMPLATE_SLOTS, NUM_ACTIVE_TEMPLATES } from './templates';

describe('RuleDirector', () => {
  const director = new RuleDirector();
  const mask = (allowed: number) =>
    Array.from({ length: MAX_TEMPLATE_SLOTS }, (_, i) => i < allowed);

  it('only ever picks an allowed template', () => {
    // The mask carries the curriculum pin, capability gates, boss cadence and
    // the template cooldown. Picking outside it ships a wave the designer
    // explicitly excluded — e.g. an air wave against a ground-only defense.
    for (let i = 0; i < 200; i++) {
      const d = director.decide(mask(3), 12, [0, 1]);
      expect(d.templateIdx).toBeLessThan(3);
      expect(d.templateIdx).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps every factor inside [0,1]', () => {
    // The decoder interpolates these into designer ranges; out-of-range values
    // would silently extrapolate past the range the designer authored.
    for (const wave of [1, 30, 60, 200]) {
      for (let i = 0; i < 100; i++) {
        const d = director.decide(mask(6), wave, []);
        for (const f of [d.countFactor, d.spawnFactor, d.hpFactor, d.variationFactor]) {
          expect(f).toBeGreaterThanOrEqual(0);
          expect(f).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('avoids recently used templates', () => {
    // Variety is enforced rather than rewarded: the reward function had a
    // variation factor and the mask has a cooldown, and waves still came out
    // repetitive.
    const picks = new Set<number>();
    for (let i = 0; i < 200; i++) {
      picks.add(director.decide(mask(4), 9, [0, 1]).templateIdx);
    }
    expect(picks).toEqual(new Set([2, 3]));
  });

  it('falls back to the oldest of the used templates when all are recent', () => {
    // Index 0 is the stalest of the two, so it must come back rather than the
    // director stalling or picking outside the mask.
    const picks = new Set<number>();
    for (let i = 0; i < 50; i++) {
      picks.add(director.decide(mask(2), 9, [0, 1]).templateIdx);
    }
    expect(picks).toEqual(new Set([0]));
  });

  it('ramps difficulty with the wave number', () => {
    // The player never heals, so HP is a whole-run budget and difficulty is a
    // curve — something written down, not inferred per wave.
    const mean = (wave: number, key: 'countFactor' | 'hpFactor') => {
      let sum = 0;
      for (let i = 0; i < 300; i++) sum += director.decide(mask(6), wave, [])[key];
      return sum / 300;
    };
    expect(mean(60, 'countFactor')).toBeGreaterThan(mean(1, 'countFactor'));
    expect(mean(60, 'hpFactor')).toBeGreaterThan(mean(1, 'hpFactor'));
  });

  it('tightens the spawn delay as the run progresses', () => {
    const mean = (wave: number) => {
      let sum = 0;
      for (let i = 0; i < 300; i++) sum += director.decide(mask(6), wave, []).spawnFactor;
      return sum / 300;
    };
    expect(mean(60)).toBeLessThan(mean(1));
  });

  it('holds the ramp flat past its end instead of overshooting', () => {
    const at = (wave: number) => director.decide(mask(6), wave, [], () => 0.5).countFactor;
    expect(at(200)).toBeCloseTo(at(60), 6);
  });

  it('survives an empty mask without throwing', () => {
    // Reachable: a curriculum-forced template whose slot the capability mask
    // also blocks. Shipping the designer's first template beats shipping
    // nothing at all.
    const d = director.decide(new Array(MAX_TEMPLATE_SLOTS).fill(false), 5, []);
    expect(d.templateIdx).toBe(0);
    expect(d.templateIdx).toBeLessThan(NUM_ACTIVE_TEMPLATES);
  });

  it('is deterministic given a fixed random source', () => {
    const fixed = () => 0.5;
    const a = director.decide(mask(6), 20, [1], fixed);
    const b = director.decide(mask(6), 20, [1], fixed);
    expect(a).toEqual(b);
  });

  it('varies successive waves at the same wave number', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 50; i++) seen.add(director.decide(mask(6), 20, []).countFactor);
    expect(seen.size).toBeGreaterThan(1);
  });
});
