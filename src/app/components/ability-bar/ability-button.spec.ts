import { describe, expect, it } from 'vitest';
import { ABILITY_BAR_EDGE_PX, ABILITY_BAR_PX, abilityBarIds, abilityButtonView, abilityTooltip, heroTooltip } from './ability-button';
import { ABILITIES, ABILITY_IDS, lockedAbilityStatus, type AbilityId, type AbilityStatus } from '../../configs/abilities.config';
import { en } from '../../i18n/messages/en';

const NUKE = ABILITIES['nuclear-strike'];
const CHARGED: AbilityStatus = { ...lockedAbilityStatus('nuclear-strike'), unlocked: true, charges: 1, launchSite: true };
const view = (status: AbilityStatus, waveActive = true, targeting = false) =>
  abilityButtonView(en, NUKE, status, waveActive, targeting);

describe('abilityBarIds', () => {
  const statuses = (researched: AbilityId[], launchSites = true) => Object.fromEntries(ABILITY_IDS.map((id) => [
    id,
    { ...lockedAbilityStatus(id), unlocked: researched.includes(id), launchSite: launchSites || !ABILITIES[id].launchFrom },
  ])) as Record<AbilityId, AbilityStatus>;

  it('has no button before any research', () => {
    expect(abilityBarIds(statuses([]))).toEqual([]);
  });

  it('adds a button once its research is done, in ABILITIES order', () => {
    expect(abilityBarIds(statuses(['orbital-laser', 'nuclear-strike']))).toEqual(['nuclear-strike', 'orbital-laser']);
    expect(abilityBarIds(statuses([...ABILITY_IDS]))).toEqual(ABILITY_IDS);
  });

  it('has no button for the nuclear strike while no missile silo stands, the others keep theirs', () => {
    expect(abilityBarIds(statuses([...ABILITY_IDS], false))).toEqual(ABILITY_IDS.filter((id) => id !== 'nuclear-strike'));
    expect(abilityBarIds(statuses(['nuclear-strike'], false))).toEqual([]);
  });
});

describe('abilityButtonView', () => {
  it('ready in a wave: a press arms, its one rivet full', () => {
    expect(view(CHARGED)).toEqual({
      state: 'ready',
      enabled: true,
      rivets: [1],
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
    expect(view(incoming)).toMatchObject({ state: 'pending', enabled: false, rivets: [0] });
  });

  it('recharging: the rivet fills a third per completed wave, the rest to go in the label', () => {
    expect(view({ ...CHARGED, charges: 0, wavesUntilCharge: 2 })).toMatchObject({
      state: 'recharging',
      enabled: false,
      rivets: [1 / 3],
      label: 'Nuclear Strike: recharges in 2 waves',
    });
    expect(view({ ...CHARGED, charges: 0, wavesUntilCharge: 1 }).label).toBe('Nuclear Strike: recharges in 1 wave');
  });

  it('has a rivet per charge: those on hand full, the next filling, the rest empty', () => {
    const threeCharges = { ...NUKE, maxCharges: 3 };
    expect(abilityButtonView(en, threeCharges, { ...CHARGED, maxCharges: 3, charges: 1, wavesUntilCharge: 1 }, true, false))
      .toMatchObject({ state: 'ready', rivets: [1, 2 / 3, 0] });
    expect(abilityButtonView(en, threeCharges, { ...CHARGED, maxCharges: 3, charges: 3, wavesUntilCharge: 0 }, true, false).rivets)
      .toEqual([1, 1, 1]);
  });
});

describe('abilityTooltip', () => {
  it('shows state, charges and recharge', () => {
    const recharging = { ...CHARGED, charges: 0, wavesUntilCharge: 2 };
    expect(abilityTooltip(en, NUKE, recharging, view(recharging))).toEqual({
      title: 'Nuclear Strike',
      category: 'RECHARGES IN 2 WAVES',
      hotkey: 'K',
      accent: 'neutral',
      stats: [
        { label: 'CHARGES', value: '0/1' },
        { label: 'RECHARGE', value: '3 waves' },
      ],
      flavor: en.abilities[NUKE.id].description,
    });
  });
});

describe('ABILITY_BAR_EDGE_PX', () => {
  it('is the bar drawn from ABILITY_BAR_PX: 7 px left, no border, 5 px padding for the shadow, a 48 px button', () => {
    expect(ABILITY_BAR_PX).toEqual({ left: 7, border: 0, padding: 5, button: 48, clear: 3 });
    // `clear` is room above and below the bar, not part of its width
    expect(ABILITY_BAR_EDGE_PX).toBe(65);
  });
});

describe('heroTooltip', () => {
  it('says what a press does unless the hero feature says more', () => {
    const hero = { icon: 'user' as const, name: 'Mercenary', hotkey: 'g', selected: false };
    expect(heroTooltip(en, hero)).toMatchObject({ title: 'Mercenary', category: 'HERO', hotkey: 'G' });
    expect(heroTooltip(en, { ...hero, detail: 'Level 2 | Siege' }).flavor).toBe('Level 2 | Siege');
  });
});
