import { describe, it, expect, vi } from 'vitest';

vi.mock('three', async () => await import('@/test/mocks/three.mock'));

import { analyzeDefense, damageMetresPerArmor, isSplashTower } from './defense-analyzer';
import { computeTowerDPS } from './tower-dps.util';
import { Tower } from '../entities/tower.entity';
import { TOWER_TYPES, TowerTypeId } from '../configs/tower-types.config';
import { DAMAGE_MATRIX } from '../configs/combat/damage-matrix.config';
import { ARMOR_TYPES } from '../configs/combat/combat.types';
import { HERO, heroDefenseProfile } from '../configs/hero.config';

const POS = { lat: 10, lon: 20, height: 0 };

describe('isSplashTower()', () => {
  it('matches what the game actually does', () => {
    const splash: TowerTypeId[] = ['cannon', 'ice', 'poison', 'fire', 'lightning', 'rocket'];
    const single: TowerTypeId[] = ['archer', 'dual-gatling', 'magic', 'tentacle', 'chaos', 'research-center', 'missile-silo'];
    for (const id of splash) expect(isSplashTower(id), id).toBe(true);
    for (const id of single) expect(isSplashTower(id), id).toBe(false);
  });
});

describe('analyzeDefense() with several heroes', () => {
  // Coop: every player's hero counts, not only the first (TODO E34)
  it('adds each hired hero to the defense', () => {
    const hero = heroDefenseProfile(0);
    const one = analyzeDefense([], false, hero);
    const two = analyzeDefense([], false, [hero, hero]);
    expect(two.effectiveDPSPerArmor.ground.light).toBeCloseTo(one.effectiveDPSPerArmor.ground.light * 2, 6);
    expect(analyzeDefense([], false, []).effectiveDPSPerArmor.ground.light).toBe(0);
  });
});

describe('analyzeDefense() air targeting per tower', () => {
  // Coop: the AA retrofit is the research of the tower's owner (TODO E34)
  it('counts a gatling against air only when its owner has the retrofit', () => {
    const mine = new Tower(POS, 'dual-gatling');
    const theirs = new Tower(POS, 'dual-gatling');
    const dps = computeTowerDPS(mine);
    const defense = analyzeDefense([mine, theirs], (tower) => tower === mine);

    expect(defense.antiAirDPS).toBeCloseTo(dps, 6);
    expect(defense.capabilities.hasAntiAir).toBe(true);
    expect(defense.effectiveDPSPerArmor.air.light).toBeCloseTo(defense.effectiveDPSPerArmor.ground.light / 2, 6);
    expect(analyzeDefense([mine, theirs], () => false).antiAirDPS).toBe(0);
  });
});

describe('analyzeDefense() DPS per armor', () => {
  it('counts the rocket only against air', () => {
    // `canTargetGround` ist false und das ist ihre Rolle.
    const rocket = new Tower(POS, 'rocket');
    const { effectiveDPSPerArmor: eff } = analyzeDefense([rocket], false);
    expect(eff.air.heavy).toBeGreaterThan(0);
    expect(eff.ground.heavy).toBe(0);
  });

  it('takes the plain damage matrix, bad matchups included', () => {
    const archer = new Tower(POS, 'archer'); // physical: fortified 0.3, ethereal 0.1
    const dps = computeTowerDPS(archer);
    const m = DAMAGE_MATRIX.physical;
    const { effectiveDPSPerArmor: eff } = analyzeDefense([archer], false);

    expect(eff.ground.fortified).toBeCloseTo(dps * m.fortified, 6);
    expect(eff.ground.ethereal).toBeCloseTo(dps * m.ethereal, 6);
    expect(eff.air.fortified).toBeCloseTo(dps * m.fortified, 6);
  });

  it('a chaos tower alone opens the air and ethereal gates, at full DPS against every armor', () => {
    const chaos = new Tower(POS, 'chaos');
    const dps = computeTowerDPS(chaos);
    const { capabilities, effectiveDPSPerArmor: eff } = analyzeDefense([chaos], false);

    expect(capabilities.hasAntiAir).toBe(true);
    expect(capabilities.hasAntiEthereal).toBe(true);
    expect(capabilities.hasSplash).toBe(false);
    for (const armor of ARMOR_TYPES) {
      expect(eff.ground[armor], armor).toBeCloseTo(dps, 6);
      expect(eff.air[armor], armor).toBeCloseTo(dps, 6);
    }
  });

  describe('the hero as a virtual tower at half presence', () => {
    const hero = heroDefenseProfile(0);

    it('changes nothing without a hero', () => {
      const archer = new Tower(POS, 'archer');
      expect(analyzeDefense([archer], false, null)).toEqual(analyzeDefense([archer], false));
    });

    it('adds half his best ammo per armor, ground and air', () => {
      const { effectiveDPSPerArmor: eff } = analyzeDefense([], false, hero);
      // 48 DPS for every ammo; best matrix row per armor: physical, siege, magic
      const expected = { unarmored: 48 * 1.0, light: 48 * 1.0, heavy: 48 * 1.75, fortified: 48 * 1.6, ethereal: 48 * 2.0 };
      for (const armor of ARMOR_TYPES) {
        expect(eff.ground[armor], armor).toBeCloseTo(expected[armor] * HERO.gatePresence, 6);
        expect(eff.air[armor], armor).toBeCloseTo(expected[armor] * HERO.gatePresence, 6);
      }
    });

    it('adds to the towers, and leaves total DPS, capabilities and AoE share to them', () => {
      const archer = new Tower(POS, 'archer');
      const alone = analyzeDefense([archer], false);
      const withHero = analyzeDefense([archer], false, hero);
      expect(withHero.effectiveDPSPerArmor.ground.heavy)
        .toBeCloseTo(alone.effectiveDPSPerArmor.ground.heavy + 48 * 1.75 * HERO.gatePresence, 6);
      expect(withHero.totalDPS).toBe(alone.totalDPS);
      expect(withHero.capabilities).toEqual(alone.capabilities);
      expect(withHero.aoeDpsShare).toEqual(alone.aoeDpsShare);
    });

    it('counts his level', () => {
      const leveled = analyzeDefense([], false, heroDefenseProfile(30)).effectiveDPSPerArmor.ground.unarmored;
      expect(leveled).toBeCloseTo(48 * 1.15 * HERO.gatePresence, 6);
    });
  });

  it('counts ice and poison splash', () => {
    const analysis = analyzeDefense([new Tower(POS, 'ice'), new Tower(POS, 'poison')], false);
    expect(analysis.capabilities.hasSplash).toBe(true);
    expect(analysis.aoeDpsShare.ground).toBe(1);
  });
});

describe('damageMetresPerArmor()', () => {
  it('counts each tower with the metres it sees, not the union times the total', () => {
    const a = new Tower(POS, 'archer');
    const b = new Tower(POS, 'archer');
    const dps = computeTowerDPS(a);
    const light = DAMAGE_MATRIX[TOWER_TYPES.archer.damageType].light;
    const out = damageMetresPerArmor([a, b], false, new Map([[a.id, { ground: 10, air: 0 }], [b.id, { ground: 30, air: 0 }]]));
    expect(out.ground.light).toBeCloseTo(dps * light * 40, 6);
    expect(out.air.light).toBe(0);
  });

  it('leaves out a tower the route does not pass', () => {
    const a = new Tower(POS, 'archer');
    expect(damageMetresPerArmor([a], false, new Map()).ground.light).toBe(0);
  });
});
