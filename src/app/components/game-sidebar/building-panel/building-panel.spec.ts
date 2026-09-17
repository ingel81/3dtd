import { describe, expect, it } from 'vitest';
import { buildingAbilityRows } from './building-panel';
import { ABILITY_IDS, lockedAbilityStatus, type AbilityId, type AbilityStatus } from '../../../configs/abilities.config';

/** Every ability locked, `over` on top, the silo standing */
function statuses(over: Partial<Record<AbilityId, Partial<AbilityStatus>>> = {}): Record<AbilityId, AbilityStatus> {
  return Object.fromEntries(ABILITY_IDS.map((id) => [
    id,
    { ...lockedAbilityStatus(id), launchSite: true, ...over[id] },
  ])) as Record<AbilityId, AbilityStatus>;
}

describe('buildingAbilityRows', () => {
  it('lists the nuclear strike under the missile silo with its key and the state of its button', () => {
    const charged = statuses({ 'nuclear-strike': { unlocked: true, charges: 1 } });
    expect(buildingAbilityRows('missile-silo', charged, false)).toEqual([
      { id: 'nuclear-strike', name: 'Nuclear Strike', hotkey: 'K', status: 'ready, fires during a wave' },
    ]);
    expect(buildingAbilityRows('missile-silo', charged, true)[0].status).toBe('ready');

    const recharging = statuses({ 'nuclear-strike': { unlocked: true, charges: 0, wavesUntilCharge: 2 } });
    expect(buildingAbilityRows('missile-silo', recharging, true)[0].status).toBe('recharges in 2 waves');
  });

  it('lists nothing before the research, and nothing for a building no ability launches from', () => {
    expect(buildingAbilityRows('missile-silo', statuses(), true)).toEqual([]);
    const all = statuses(Object.fromEntries(ABILITY_IDS.map((id) => [id, { unlocked: true, charges: 1 }])));
    expect(buildingAbilityRows('research-center', all, true)).toEqual([]);
  });
});
