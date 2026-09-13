import {
  ABILITIES,
  ABILITY_IDS,
  abilityDamageFraction,
  lockedAbilityStatus,
} from './abilities.config';
import { ENEMY_TYPES, getAllEnemyTypes } from './enemy-types.config';
import { getResearch } from './research/research-tree.config';

describe('abilities config', () => {
  it('holds the nuclear strike as decided (PLAYER_AGENCY_CONCEPT.md, section 7)', () => {
    const nuke = ABILITIES['nuclear-strike'];
    expect(nuke.maxCharges).toBe(1);
    expect(nuke.rechargeWaves).toBe(3);
    expect(nuke.radiusM).toBe(25);
    expect(nuke.warningMs).toBe(1500);
    expect(nuke.maxHpFraction).toBe(0.6);
    expect(nuke.bossMaxHpFraction).toBe(0.2);
    expect(nuke.snapRadiusM).toBe(30);
    expect(nuke.researchId).toBe('nuclear-strike');
    expect(nuke.icon).toBe('radiation');
    expect(nuke.hotkey).toBe('K');
  });

  it('is unlocked by its research: 1,000 gold, 40 s, after Advanced Weaponry', () => {
    const nuke = ABILITIES['nuclear-strike'];
    const research = getResearch(nuke.researchId)!;
    expect(research).toMatchObject({
      category: 'global-perk',
      icon: 'radiation',
      cost: 1000,
      duration: 40,
      prerequisites: ['advanced-weaponry'],
    });
    expect(research.effects).toContainEqual(
      expect.objectContaining({ kind: 'global-perk', perkId: nuke.perkId }),
    );
  });

  it('keys every ability by its own id', () => {
    for (const id of ABILITY_IDS) {
      expect(ABILITIES[id].id).toBe(id);
    }
  });

  it('takes the boss share from bosses and the full share from everyone else', () => {
    const nuke = ABILITIES['nuclear-strike'];
    expect(abilityDamageFraction(nuke, ENEMY_TYPES['zombie'])).toBe(0.6);
    expect(abilityDamageFraction(nuke, ENEMY_TYPES['herbert'])).toBe(0.2);
  });

  it('flags only herbert as a boss: golem and dragon also march in regular waves', () => {
    const bosses = getAllEnemyTypes().filter((e) => e.isBoss).map((e) => e.id);
    expect(bosses).toEqual(['herbert']);
  });

  it('starts locked with no charge', () => {
    expect(lockedAbilityStatus('nuclear-strike')).toEqual({
      id: 'nuclear-strike',
      unlocked: false,
      charges: 0,
      maxCharges: 1,
      wavesUntilCharge: 0,
      pending: false,
    });
  });
});
