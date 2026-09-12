import { describe, it, expect, vi } from 'vitest';

vi.mock('three', async () => await import('@/test/mocks/three.mock'));

import { analyzeDefense, isSplashTower } from './defense-analyzer';
import { computeTowerDPS } from './tower-dps.util';
import { FAIRNESS_MATCHUP_FLOOR } from './templates';
import { Tower } from '../../entities/tower.entity';
import { TOWER_TYPES, TowerTypeId } from '../../configs/tower-types.config';
import { DAMAGE_MATRIX } from '../../configs/combat/damage-matrix.config';
import { ARMOR_TYPES } from '../../configs/combat/combat.types';

const POS = { lat: 10, lon: 20, height: 0 };

describe('isSplashTower()', () => {
  it('matches what the game actually does', () => {
    const splash: TowerTypeId[] = ['cannon', 'ice', 'poison', 'fire', 'lightning'];
    const single: TowerTypeId[] = ['archer', 'dual-gatling', 'magic', 'rocket', 'tentacle', 'chaos', 'research-center'];
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

  it('counts ice and poison splash', () => {
    const analysis = analyzeDefense([new Tower(POS, 'ice'), new Tower(POS, 'poison')], false);
    expect(analysis.capabilities.hasSplash).toBe(true);
    expect(analysis.aoeDpsShare.ground).toBe(1);
    expect(analysis.killThroughput.ground).toBeGreaterThan(
      TOWER_TYPES.ice.fireRate + TOWER_TYPES.poison.fireRate,
    );
  });
});
