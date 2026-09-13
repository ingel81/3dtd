import { describe, expect, it } from 'vitest';
import { abilityButtonView, abilityTooltip, heroTooltip } from './ability-button';
import { ABILITIES, lockedAbilityStatus, type AbilityStatus } from '../../configs/abilities.config';
import { getResearch } from '../../configs/research/research-tree.config';

const NUKE = ABILITIES['nuclear-strike'];
const LOCKED = lockedAbilityStatus('nuclear-strike');
const CHARGED: AbilityStatus = { ...LOCKED, unlocked: true, charges: 1 };
const view = (status: AbilityStatus, waveActive = true, targeting = false) =>
  abilityButtonView(NUKE, status, waveActive, targeting);

describe('abilityButtonView', () => {
  it('locked until the research is done: no pips, a press does nothing', () => {
    expect(view(LOCKED)).toEqual({
      state: 'locked',
      enabled: false,
      pips: [],
      charges: null,
      status: 'locked until researched',
      label: 'Nuclear Strike: locked until researched',
    });
  });

  it('ready in a wave: a press arms, every pip lit', () => {
    expect(view(CHARGED)).toEqual({
      state: 'ready',
      enabled: true,
      pips: [true, true, true],
      charges: null,
      status: 'ready',
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

  it('counts the charges only for an ability that holds more than one', () => {
    const twoCharges = { ...NUKE, maxCharges: 2 };
    expect(abilityButtonView(twoCharges, { ...CHARGED, maxCharges: 2, charges: 1, wavesUntilCharge: 2 }, true, false))
      .toMatchObject({ state: 'ready', charges: 1 });
    expect(abilityButtonView(twoCharges, { ...LOCKED, maxCharges: 2 }, true, false).charges).toBeNull();
  });
});

describe('abilityTooltip', () => {
  it('names the research that unlocks a locked ability', () => {
    const tooltip = abilityTooltip(NUKE, LOCKED, view(LOCKED), getResearch(NUKE.researchId));
    expect(tooltip).toMatchObject({ title: 'Nuclear Strike', category: 'LOCKED', hotkey: 'K' });
    expect(tooltip.flavor).toContain('research Nuclear Strike in the Research Center, 1,000 credits.');
    expect(tooltip.stats).toBeUndefined();
  });

  it('shows state, charges and recharge once researched', () => {
    const recharging = { ...CHARGED, charges: 0, wavesUntilCharge: 2 };
    expect(abilityTooltip(NUKE, recharging, view(recharging), getResearch(NUKE.researchId))).toEqual({
      title: 'Nuclear Strike',
      category: 'RECHARGES IN 2 WAVES',
      hotkey: 'K',
      accent: 'neutral',
      stats: [
        { label: 'CHARGES', value: '0/1' },
        { label: 'RECHARGE', value: '3 waves' },
      ],
      flavor: NUKE.description,
    });
  });
});

describe('heroTooltip', () => {
  it('says what a press does unless the hero feature says more', () => {
    const hero = { icon: 'user' as const, name: 'Mercenary', hotkey: 'g', selected: false };
    expect(heroTooltip(hero)).toMatchObject({ title: 'Mercenary', category: 'HERO', hotkey: 'G' });
    expect(heroTooltip({ ...hero, detail: 'Level 2 · Siege' }).flavor).toBe('Level 2 · Siege');
  });
});
