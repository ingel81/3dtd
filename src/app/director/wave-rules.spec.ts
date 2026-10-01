import { afterEach, describe, expect, it } from 'vitest';
import { setActiveWaveRules, waveHasAir, waveMutator, waveRules, type WaveRules } from './wave-rules';
import { WAVE_MUTATORS } from '../configs/wave-mutators.config';
import { RUN_PLAN_RULES, planRowForWave, waveLeakScale } from './sources/budget/run-plan';
import { enemyBaseDamageForWave, waveGold } from '../configs/campaign.config';
import { TableWaveSource } from './sources/table/table-source';
import { summarizeWaveGroups } from '../managers/game-state/wave-preview';

const LOUD: WaveRules = {
  leakScale: () => 7,
  gold: () => ({ kill: 1, complete: 2 }),
  isBoss: (wave) => wave === 3,
  enemyMix: (wave) => (wave === 4 ? [['bat', 1]] : null),
  name: () => 'Loud',
  mutator: (wave) => (wave === 5 ? 'swift' : null),
};

describe('wave rules', () => {
  afterEach(() => setActiveWaveRules(RUN_PLAN_RULES));

  it('are the run plan rules, the default source, before any source is set', () => {
    for (const wave of [1, 31, 61]) expect(waveRules().leakScale(wave)).toBe(waveLeakScale(wave));
    expect(waveRules().gold(12)).toEqual(waveGold(12, false));
    expect(waveRules().isBoss(10)).toBe(planRowForWave(10)!.boss === true);
  });

  it('follow the active source, so the game reads what the source says', () => {
    setActiveWaveRules(LOUD);
    expect(waveRules().leakScale(1)).toBe(7);
    expect(waveRules().isBoss(3)).toBe(true);
    expect(waveHasAir(4, (id) => id === 'bat')).toBe(true);
    expect(waveHasAir(5, (id) => id === 'bat')).toBe(false);
    expect(waveMutator(5)).toBe(WAVE_MUTATORS.swift);
    expect(waveMutator(6)).toBeNull();
    // The preview prices a leak with the active rules
    const config = { schedule: { entries: [{ enemyType: 'rat', speed: 1 }], baseDelay: 100 } } as never;
    const loud = JSON.stringify(summarizeWaveGroups(config, 1, 1));
    setActiveWaveRules(RUN_PLAN_RULES);
    expect(loud).not.toBe(JSON.stringify(summarizeWaveGroups(config, 1, 1)));
  });

  it('of the table source keep the campaign leak and name the wave by the list', () => {
    const rules = new TableWaveSource().rules;
    expect(rules.leakScale(40)).toBe(enemyBaseDamageForWave(40));
    expect(rules.name(1)).toBeTruthy();
    expect(rules.enemyMix(1)?.length).toBeGreaterThan(0);
    // The list is the wave as written: no mutator on a blood moon either
    expect(rules.mutator(14)).toBeNull();
  });
});
