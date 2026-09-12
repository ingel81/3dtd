import { describe, expect, it } from 'vitest';
import { abilityButtonView } from './ability-button';
import { lockedAbilityStatus, type AbilityStatus } from '../../../configs/abilities.config';

const LOCKED = lockedAbilityStatus('nuclear-strike');
const CHARGED: AbilityStatus = { ...LOCKED, unlocked: true, charges: 1 };
const view = (status: AbilityStatus, waveActive = true, targeting = false) =>
  abilityButtonView('Nuclear Strike', status, 3, waveActive, targeting);

describe('abilityButtonView', () => {
  it('stays hidden until the research is done', () => {
    expect(view(LOCKED).visible).toBe(false);
  });

  it('ready in a wave: a press arms, every pip lit', () => {
    expect(view(CHARGED)).toEqual({
      visible: true,
      state: 'ready',
      enabled: true,
      pips: [true, true, true],
      label: 'Nuclear Strike: ready',
    });
  });

  it('armed while aiming: a press leaves the mode', () => {
    expect(view(CHARGED, true, true)).toMatchObject({ state: 'armed', enabled: true });
  });

  it('charged between waves: shown, but a press does nothing', () => {
    expect(view(CHARGED, false)).toMatchObject({
      state: 'waiting',
      enabled: false,
      label: 'Nuclear Strike: ready, fires during a wave',
    });
  });

  it('pending while the strike is on its way', () => {
    const incoming = { ...CHARGED, charges: 0, wavesUntilCharge: 3, pending: true };
    expect(view(incoming)).toMatchObject({ state: 'pending', enabled: false, pips: [false, false, false] });
  });

  it('recharging: one pip per completed wave, the rest to go in the label', () => {
    expect(view({ ...CHARGED, charges: 0, wavesUntilCharge: 2 })).toMatchObject({
      state: 'recharging',
      enabled: false,
      pips: [true, false, false],
      label: 'Nuclear Strike: recharges in 2 waves',
    });
    expect(view({ ...CHARGED, charges: 0, wavesUntilCharge: 1 }).label).toBe('Nuclear Strike: recharges in 1 wave');
  });
});
