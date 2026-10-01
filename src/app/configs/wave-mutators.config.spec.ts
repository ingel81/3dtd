import { describe, expect, it } from 'vitest';
import { BLOOD_MOON_MUTATORS, WAVE_MUTATORS, bloodMoonMutator } from './wave-mutators.config';
import { isBloodMoonWave } from './blood-moon.config';

describe('wave mutators', () => {
  it('give every blood moon wave one, by the rotation, and no other wave', () => {
    expect([14, 21, 28, 35, 42].map(bloodMoonMutator)).toEqual(['swift', 'swarm', 'regen', 'bounty', 'swift']);
    for (let wave = 1; wave <= 200; wave++) {
      expect(bloodMoonMutator(wave) !== null, `wave ${wave}`).toBe(isBloodMoonWave(wave));
    }
  });

  it('use every mutator in the rotation, each with its own id', () => {
    expect(new Set(BLOOD_MOON_MUTATORS)).toEqual(new Set(Object.keys(WAVE_MUTATORS)));
    for (const [id, mutator] of Object.entries(WAVE_MUTATORS)) expect(mutator.id).toBe(id);
  });

  it('take HP where the enemies get harder to kill, never add any', () => {
    expect(WAVE_MUTATORS.swift.budget).toBeLessThan(1);
    expect(WAVE_MUTATORS.regen.budget).toBeLessThan(1);
    for (const mutator of Object.values(WAVE_MUTATORS)) expect(mutator.budget ?? 1).toBeLessThanOrEqual(1);
  });
});
