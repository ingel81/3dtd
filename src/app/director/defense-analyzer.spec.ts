import { describe, it, expect, vi } from 'vitest';

vi.mock('three', async () => await import('@/test/mocks/three.mock'));

import { analyzeDefense, isSplashTower } from './defense-analyzer';
import { computeTowerDPS } from './tower-dps.util';
import { FAIRNESS_MATCHUP_FLOOR } from './templates';
import { Tower } from '../entities/tower.entity';
import { TOWER_TYPES, TowerTypeId } from '../configs/tower-types.config';
import { DAMAGE_MATRIX } from '../configs/combat/damage-matrix.config';
import { ARMOR_TYPES } from '../configs/combat/combat.types';
import { HERO, heroDefenseProfile } from '../configs/hero.config';

const POS = { lat: 10, lon: 20, height: 0 };

describe('isSplashTower()', () => {
  it('matches what the game actually does', () => {
    const splash: TowerTypeId[] = ['cannon', 'ice', 'poison', 'fire', 'lightning'];
    const single: TowerTypeId[] = ['archer', 'dual-gatling', 'magic', 'rocket', 'tentacle', 'chaos', 'research-center', 'missile-silo'];
    for (const id of splash) expect(isSplashTower(id), id).toBe(true);
    for (const id of single) expect(isSplashTower(id), id).toBe(false);
  });
});

describe('analyzeDefense() kill throughput', () => {
  it('counts a rocket as one target per shot, it has no splash', () => {
    const rocket = new Tower(POS, 'rocket');
    const { killThroughput } = analyzeDefense([rocket], false);
    expect(killThroughput.air).toBeCloseTo(TOWER_TYPES.rocket.fireRate, 6);
    expect(killThroughput.ground).toBe(0);
  });

  it('gate DPS floors bad ground matchups, but not ethereal and air', () => {
    const archer = new Tower(POS, 'archer'); // physical: fortified 0.3, ethereal 0.1
    const dps = computeTowerDPS(archer);
    const m = DAMAGE_MATRIX.physical;
    const { effectiveDPSPerArmor: eff, gateDpsPerArmor: gate } = analyzeDefense([archer], false);

    expect(m.fortified).toBeLessThan(FAIRNESS_MATCHUP_FLOOR);
    expect(eff.ground.fortified).toBeCloseTo(dps * m.fortified, 6);
    expect(gate.ground.fortified).toBeCloseTo(dps * FAIRNESS_MATCHUP_FLOOR, 6);
    expect(gate.ground.unarmored).toBeCloseTo(dps * m.unarmored, 6); // above the floor
    expect(gate.ground.ethereal).toBeCloseTo(eff.ground.ethereal, 6);
    expect(gate.air).toEqual(eff.air);
  });

  it('a chaos tower alone opens the air and ethereal gates, at full DPS against every armor', () => {
    const chaos = new Tower(POS, 'chaos');
    const dps = computeTowerDPS(chaos);
    const { capabilities, effectiveDPSPerArmor: eff, gateDpsPerArmor: gate } = analyzeDefense([chaos], false);

    expect(capabilities.hasAntiAir).toBe(true);
    expect(capabilities.hasAntiEthereal).toBe(true);
    expect(capabilities.hasSplash).toBe(false);
    for (const armor of ARMOR_TYPES) {
      expect(eff.ground[armor], armor).toBeCloseTo(dps, 6);
      expect(eff.air[armor], armor).toBeCloseTo(dps, 6);
      // 1.0 sits above FAIRNESS_MATCHUP_FLOOR, so the gate sees the same.
      expect(gate.ground[armor], armor).toBeCloseTo(dps, 6);
    }
  });

  describe('the hero as a virtual tower at half presence', () => {
    const hero = heroDefenseProfile(0);

    it('changes nothing without a hero', () => {
      const archer = new Tower(POS, 'archer');
      expect(analyzeDefense([archer], false, null)).toEqual(analyzeDefense([archer], false));
    });

    it('adds half his best ammo per armor, ground and air, to effective and gate DPS', () => {
      const { effectiveDPSPerArmor: eff, gateDpsPerArmor: gate, killThroughput } = analyzeDefense([], false, hero);
      // 48 DPS for every ammo; best matrix row per armor: physical, siege, magic
      const expected = { unarmored: 48 * 1.0, light: 48 * 1.0, heavy: 48 * 1.75, fortified: 48 * 1.6, ethereal: 48 * 2.0 };
      for (const armor of ARMOR_TYPES) {
        expect(eff.ground[armor], armor).toBeCloseTo(expected[armor] * HERO.gatePresence, 6);
        expect(eff.air[armor], armor).toBeCloseTo(expected[armor] * HERO.gatePresence, 6);
        // His best ammo sits above the matchup floor everywhere, so the gate sees the same
        expect(gate.ground[armor], armor).toBeCloseTo(eff.ground[armor], 6);
      }
      expect(gate.air).toEqual(eff.air);
      // Three shots a second with standard rounds, at half presence
      expect(killThroughput).toEqual({ ground: 3 * HERO.gatePresence, air: 3 * HERO.gatePresence });
    });

    it('adds to the towers, and leaves total DPS, capabilities and AoE share to them', () => {
      const archer = new Tower(POS, 'archer');
      const alone = analyzeDefense([archer], false);
      const withHero = analyzeDefense([archer], false, hero);
      expect(withHero.effectiveDPSPerArmor.ground.heavy)
        .toBeCloseTo(alone.effectiveDPSPerArmor.ground.heavy + 48 * 1.75 * HERO.gatePresence, 6);
      expect(withHero.killThroughput.ground).toBeCloseTo(alone.killThroughput.ground + 3 * HERO.gatePresence, 6);
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
    expect(analysis.killThroughput.ground).toBeGreaterThan(
      TOWER_TYPES.ice.fireRate + TOWER_TYPES.poison.fireRate,
    );
  });
});
