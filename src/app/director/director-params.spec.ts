import { describe, it, expect, afterEach } from 'vitest';
import {
  DEFAULT_DIRECTOR_PARAMS,
  DIRECTOR_PARAM_SETS,
  directorParams,
  directorParamsName,
  resetDirectorParams,
  useDirectorParams,
} from './director-params';
import { BudgetWaveSource } from './sources/budget/budget-source';
import { createEmptySnapshot } from './models/game-state-snapshot';

describe('director parameter sets', () => {
  afterEach(() => resetDirectorParams());

  it('plays the default set until a batch asks for another', () => {
    expect(directorParamsName()).toBe('default');
    expect(directorParams()).toEqual(DEFAULT_DIRECTOR_PARAMS);
  });

  it('switches to a named set', () => {
    expect(useDirectorParams('fast-loop')).toBe(true);
    expect(directorParamsName()).toBe('fast-loop');
    expect(directorParams().pressureGain).toBe(DIRECTOR_PARAM_SETS['fast-loop'].pressureGain);
  });

  it('keeps what is in force when the name is unknown, and says so', () => {
    useDirectorParams('pressure-high');
    expect(useDirectorParams('typo')).toBe(false);
    expect(directorParamsName()).toBe('pressure-high');
  });

  it('reaches the budget source: pressure-high raises the target a wave aims at', () => {
    const targetAt = (wave: number) => {
      const state = createEmptySnapshot();
      state.waveNumber = wave - 1;
      return new BudgetWaveSource().plan({ wave, state, random: () => 0.5 }).log.targetPressure!;
    };

    const withDefault = targetAt(20);
    useDirectorParams('pressure-high');
    expect(targetAt(20)).toBeCloseTo(withDefault * 1.5);
  });
});
