import { describe, it, expect } from 'vitest';
import { EnemySoundBudget, isEnemySoundId } from './enemy-sound-budget';
import { AUDIO_LIMITS } from '../../configs/audio.config';

describe('EnemySoundBudget', () => {
  it('hands out slots up to the cap and takes them back', () => {
    const budget = new EnemySoundBudget();
    for (let i = 0; i < AUDIO_LIMITS.maxEnemySounds; i++) expect(budget.reserve()).toBe(true);

    expect(budget.canReserve()).toBe(false);
    expect(budget.reserve()).toBe(false);
    expect(budget.stats()).toEqual({ current: AUDIO_LIMITS.maxEnemySounds, max: AUDIO_LIMITS.maxEnemySounds });

    budget.release();
    expect(budget.canReserve()).toBe(true);
  });

  it('never counts below zero', () => {
    const budget = new EnemySoundBudget();
    budget.release();
    budget.release();
    expect(budget.stats().current).toBe(0);
    expect(budget.reserve()).toBe(true);
    expect(budget.stats().current).toBe(1);
  });

  it('recognises enemy sounds by id pattern, ignoring case', () => {
    expect(isEnemySoundId('Zombie_Walk')).toBe(true);
    expect(isEnemySoundId('enemy-12_zombie_walk')).toBe(true);
    expect(isEnemySoundId('arrow')).toBe(false);
  });
});
