import {
  ABILITIES,
  ABILITY_IDS,
  abilityDamageFraction,
  abilityBeamCap,
  abilityBeamFraction,
  abilityBeamBurnMs,
  abilityBeamReachM,
  abilityFreezeMs,
  abilityStunMs,
  lockedAbilityStatus,
} from './abilities.config';
import type { AbilityEffect } from './abilities.config';
import { ENEMY_TYPES, getAllEnemyTypes } from './enemy-types.config';
import { getResearch } from './research/research-tree.config';

describe('abilities config', () => {
  it('holds the nuclear strike as decided (PLAYER_AGENCY_CONCEPT.md, section 7)', () => {
    const nuke = ABILITIES['nuclear-strike'];
    expect(nuke.maxCharges).toBe(1);
    expect(nuke.rechargeWaves).toBe(3);
    expect(nuke.radiusM).toBe(25);
    // The missile's flight from the silo, user's decision 2026-09-17: 6.5 s from any distance
    expect(nuke.warningMs).toBe(6500);
    expect(nuke.launchFrom).toBe('missile-silo');
    expect(nuke.effect).toEqual({ kind: 'max-hp-fraction', fraction: 0.6, bossFraction: 0.2 });
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

  it('holds the frost bomb: 20 m, 0.5 s, 3 s of freeze, bosses 1 s, key F', () => {
    const frost = ABILITIES['frost-bomb'];
    expect(frost).toMatchObject({
      maxCharges: 1,
      rechargeWaves: 3,
      radiusM: 20,
      warningMs: 500,
      snapRadiusM: 30,
      icon: 'snowflake',
      hotkey: 'F',
      effect: { kind: 'freeze', durationMs: 3000, bossDurationMs: 1000 },
    });
    const effect = frost.effect as Extract<typeof frost.effect, { kind: 'freeze' }>;
    expect(abilityFreezeMs(effect, ENEMY_TYPES['zombie'])).toBe(3000);
    expect(abilityFreezeMs(effect, ENEMY_TYPES['herbert'])).toBe(1000);
  });

  it('unlocks the frost bomb by its research: 700 gold, 25 s, after Arcane Studies', () => {
    const frost = ABILITIES['frost-bomb'];
    const research = getResearch(frost.researchId)!;
    expect(research).toMatchObject({
      category: 'global-perk',
      icon: 'snowflake',
      cost: 700,
      duration: 25,
      prerequisites: ['arcane-studies'],
    });
    expect(research.effects).toContainEqual(
      expect.objectContaining({ kind: 'global-perk', perkId: frost.perkId }),
    );
  });

  it('holds the EMP: 30 m, 0.5 s, machines 6 s, others 1.5 s, bosses 0.75 s, key E', () => {
    const emp = ABILITIES['emp'];
    expect(emp).toMatchObject({
      maxCharges: 1,
      rechargeWaves: 3,
      radiusM: 30,
      warningMs: 500,
      snapRadiusM: 30,
      icon: 'bolt',
      hotkey: 'E',
      effect: { kind: 'stun', durationMs: 1500, mechanicalDurationMs: 6000, bossDurationMs: 750 },
    });
    const effect = emp.effect as Extract<typeof emp.effect, { kind: 'stun' }>;
    expect(abilityStunMs(effect, ENEMY_TYPES['tank'])).toBe(6000);
    expect(abilityStunMs(effect, ENEMY_TYPES['mech'])).toBe(6000);
    expect(abilityStunMs(effect, ENEMY_TYPES['zombie'])).toBe(1500);
    expect(abilityStunMs(effect, ENEMY_TYPES['herbert'])).toBe(750);
    // A machine that is a boss counts as a boss
    expect(abilityStunMs(effect, { isBoss: true, mechanical: true })).toBe(750);
  });

  it('unlocks the EMP by its research: 800 gold, 30 s, after Storm Mastery', () => {
    const emp = ABILITIES['emp'];
    const research = getResearch(emp.researchId)!;
    expect(research).toMatchObject({
      category: 'global-perk',
      icon: 'bolt',
      cost: 800,
      duration: 30,
      prerequisites: ['storm-mastery'],
    });
    expect(research.effects).toContainEqual(
      expect.objectContaining({ kind: 'global-perk', perkId: emp.perkId }),
    );
  });

  it('holds the orbital laser: a 5 m fire beam, 18 m/s for 4 s after 1 s, capped at 60 %, bosses 20 %, key L', () => {
    const laser = ABILITIES['orbital-laser'];
    expect(laser).toMatchObject({
      maxCharges: 1,
      rechargeWaves: 3,
      radiusM: 5,
      warningMs: 1000,
      snapRadiusM: 30,
      icon: 'laser',
      hotkey: 'L',
      effect: {
        kind: 'beam',
        damageType: 'fire',
        speedMps: 18,
        durationMs: 4000,
        fractionPerSecond: 1,
        bossFractionPerSecond: 0.3,
        maxFraction: 0.6,
        bossMaxFraction: 0.2,
      },
    });
    const effect = laser.effect as Extract<typeof laser.effect, { kind: 'beam' }>;
    expect(abilityBeamReachM(effect)).toBe(72);
    // 4 s along the whole reach, 2 s along a stretch that ends after 36 m
    expect(abilityBeamBurnMs(effect, 72)).toBe(4000);
    expect(abilityBeamBurnMs(effect, 100)).toBe(4000);
    expect(abilityBeamBurnMs(effect, 36)).toBeCloseTo(2000, 6);
    expect(abilityBeamBurnMs({ ...effect, speedMps: 0 }, 0)).toBe(4000);
    // One sub-step: the share per second times the fire multiplier against the armor
    expect(abilityBeamFraction(effect, ENEMY_TYPES['zombie'], 'unarmored', 1000)).toBeCloseTo(1.5);
    expect(abilityBeamFraction(effect, ENEMY_TYPES['tank'], 'heavy', 500)).toBeCloseTo(0.3);
    expect(abilityBeamFraction(effect, ENEMY_TYPES['herbert'], 'fortified', 1000)).toBeCloseTo(0.075);
    expect(abilityBeamCap(effect, ENEMY_TYPES['zombie'])).toBe(0.6);
    expect(abilityBeamCap(effect, ENEMY_TYPES['herbert'])).toBe(0.2);
  });

  it('unlocks the orbital laser by its research: 1,500 gold, 45 s, after Master Engineering', () => {
    const laser = ABILITIES['orbital-laser'];
    const research = getResearch(laser.researchId)!;
    expect(research).toMatchObject({
      category: 'global-perk',
      icon: 'laser',
      cost: 1500,
      duration: 45,
      prerequisites: ['master-engineering'],
    });
    expect(research.effects).toContainEqual(
      expect.objectContaining({ kind: 'global-perk', perkId: laser.perkId }),
    );
  });

  it('keys every ability by its own id', () => {
    for (const id of ABILITY_IDS) {
      expect(ABILITIES[id].id).toBe(id);
    }
  });

  it('takes the boss share from bosses and the full share from everyone else', () => {
    const effect = { kind: 'max-hp-fraction', fraction: 0.6, bossFraction: 0.2 } as const;
    expect(abilityDamageFraction(effect, ENEMY_TYPES['zombie'])).toBe(0.6);
    expect(abilityDamageFraction(effect, ENEMY_TYPES['herbert'])).toBe(0.2);
  });

  it('flags only the pure bosses: golem and dragon also march in regular waves', () => {
    // The worm, its ring and tail and the ooze appear only as a boss (rotation, Custom Wave, Enemy Debug)
    const bosses = getAllEnemyTypes().filter((e) => e.isBoss).map((e) => e.id);
    expect(bosses).toEqual(['herbert', 'worm', 'worm-segment', 'worm-tail', 'ooze']);
    const nuke = ABILITIES['nuclear-strike'].effect as Extract<AbilityEffect, { kind: 'max-hp-fraction' }>;
    expect(abilityDamageFraction(nuke, ENEMY_TYPES['worm'])).toBe(0.2);
    expect(abilityDamageFraction(nuke, ENEMY_TYPES['ooze'])).toBe(0.2);
  });

  it('starts locked with no charge', () => {
    expect(lockedAbilityStatus('nuclear-strike')).toEqual({
      id: 'nuclear-strike',
      unlocked: false,
      charges: 0,
      maxCharges: 1,
      wavesUntilCharge: 0,
      pending: false,
      // Launches from a missile silo, none stands at the start
      launchSite: false,
    });
    expect(lockedAbilityStatus('frost-bomb').launchSite).toBe(true);
  });
});
