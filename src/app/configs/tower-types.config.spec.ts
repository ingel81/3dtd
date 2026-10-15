import {
  getAllTowerTypes,
  getTowerType,
  getUpgradeCost,
  upgradeFactor,
  TOWER_TYPES,
  TowerTypeConfig,
  TowerTypeId,
  TowerUpgrade,
  laserHeat,
} from './tower-types.config';
import { ARMOR_TYPES, ArmorType } from './combat/combat.types';
import { DAMAGE_MATRIX } from './combat/damage-matrix.config';
import { computeTowerDPSFromLevels } from '../director/tower-dps.util';
import { PROJECTILE_TYPES } from './projectile-types.config';
import { getResearch, getResearchForTower } from './research/research-tree.config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('tower types config', () => {
  // Combat towers + passive buildings (research-center, missile-silo)
  const combatIds: TowerTypeId[] = ['archer', 'dual-gatling', 'cannon', 'magic', 'rocket', 'ice', 'fire', 'tentacle', 'poison', 'lightning', 'chaos', 'bastion', 'sentinel', 'chainsaw'];
  const allIds: TowerTypeId[] = [...combatIds, 'research-center', 'missile-silo'];

  it('contains all tower types', () => {
    allIds.forEach((id) => {
      expect(TOWER_TYPES[id]).toBeDefined();
    });
  });

  it('getTowerType() returns correct type for each id', () => {
    allIds.forEach((id) => {
      expect(getTowerType(id)).toBe(TOWER_TYPES[id]);
    });
  });

  it('getAllTowerTypes() returns correct number of elements', () => {
    const all = getAllTowerTypes();
    expect(all).toHaveLength(allIds.length);
  });

  it('all tower types have required fields', () => {
    const all = getAllTowerTypes();
    all.forEach((tower) => {
      expect(tower.id).toBeTruthy();
      expect(tower.name).toBeTruthy();
      expect(tower.modelUrl).toBeTruthy();
      expect(tower.scale).toBeGreaterThan(0);
      expect(typeof tower.heightOffset).toBe('number');
      expect(typeof tower.shootHeight).toBe('number');
      expect(tower.damage).toBeGreaterThanOrEqual(0);
      // Passive buildings (research-center) legitimately have range=0
      if (tower.attackType !== 'passive') {
        expect(tower.range).toBeGreaterThan(0);
      }
      expect(tower.cost).toBeGreaterThan(0);
      expect(Array.isArray(tower.upgrades)).toBe(true);
    });
  });

  it('the missile silo is a passive building for 400, one per map, without upgrades, unlocked by the nuclear strike', () => {
    const silo = getTowerType('missile-silo');
    expect(silo.attackType).toBe('passive');
    expect(silo.cost).toBe(400);
    expect(silo.unique).toBe(true);
    expect(silo.upgrades).toEqual([]);
    expect(silo.modelUrl).toBe('assets/models/buildings/missile_silo.glb');
    expect(getResearchForTower('missile-silo')?.id).toBe('nuclear-strike');
  });

  it('only the passive buildings are one per map, and each says what it does', () => {
    for (const tower of getAllTowerTypes()) {
      expect(tower.unique === true, tower.id).toBe(tower.attackType === 'passive');
      if (tower.attackType === 'passive') expect(tower.description, tower.id).toBeTruthy();
    }
  });

  it('fire tower special properties', () => {
    const fire = getTowerType('fire');
    expect(fire.attackType).toBe('beam');
    expect(fire.damagePerSecond).toBeGreaterThan(0);
    expect(fire.beamWidth).toBeGreaterThan(0);
  });

  it('getUpgradeCost() works without scaling', () => {
    const upgrade: TowerUpgrade = {
      id: 'damage',
      name: 'Test',
      description: 'Test',
      cost: 100,
      maxLevel: 3,
      effect: { stat: 'damage', multiplier: 1.5 },
    };

    expect(getUpgradeCost(upgrade, 0)).toBe(100);
    expect(getUpgradeCost(upgrade, 1)).toBe(100);
    expect(getUpgradeCost(upgrade, 2)).toBe(100);
  });

  it('getUpgradeCost() works with scaling', () => {
    const upgrade: TowerUpgrade = {
      id: 'speed',
      name: 'Test',
      description: 'Test',
      cost: 100,
      costScaling: 2.0,
      maxLevel: 3,
      effect: { stat: 'fireRate', multiplier: 2.0 },
    };

    expect(getUpgradeCost(upgrade, 0)).toBe(100);
    expect(getUpgradeCost(upgrade, 1)).toBe(200);
    expect(getUpgradeCost(upgrade, 2)).toBe(400);
  });

  it('upgradeFactor: full multiplier up to lateFromLevel, then the late one, capped at maxLevel', () => {
    const upgrade: TowerUpgrade = {
      id: 'damage',
      name: 'Test',
      description: 'Test',
      cost: 50,
      maxLevel: 25,
      effect: { stat: 'damage', multiplier: 1.1 },
      lateFromLevel: 15,
      lateMultiplier: 1.04,
    };
    expect(upgradeFactor(upgrade, 0)).toBe(1);
    expect(upgradeFactor(upgrade, 15)).toBeCloseTo(1.1 ** 15, 10);
    expect(upgradeFactor(upgrade, 20)).toBeCloseTo(1.1 ** 15 * 1.04 ** 5, 10);
    expect(upgradeFactor(upgrade, 40)).toBeCloseTo(upgradeFactor(upgrade, 25), 10);
  });

  it('damage/rate tracks run 25 levels and turn degressive after L15, range tracks stop at L10', () => {
    for (const id of combatIds) {
      for (const u of getTowerType(id).upgrades) {
        if (u.effect.stat === 'range' || u.effect.stat === 'beamWidth') {
          expect(u.maxLevel, `${id} ${u.id}`).toBe(10);
          expect(u.effect.multiplier, `${id} ${u.id}`).toBe(1.03);
        } else {
          expect(u.maxLevel, `${id} ${u.id}`).toBe(25);
          expect(u.lateFromLevel, `${id} ${u.id}`).toBe(15);
          expect(u.lateMultiplier, `${id} ${u.id}`).toBeCloseTo(1 + 0.4 * (u.effect.multiplier - 1), 10);
        }
      }
    }
  });

  it('L25 damage × rate lands at 5 to 6.5 times the base (was 14.5)', () => {
    for (const id of combatIds.filter((t) => t !== 'fire')) {
      const upgrades = getTowerType(id).upgrades;
      const damage = upgrades.find((u) => u.effect.stat === 'damage')!;
      const rate = upgrades.find((u) => u.effect.stat === 'fireRate')!;
      const factor = upgradeFactor(damage, 25) * upgradeFactor(rate, 25);
      expect(factor, id).toBeGreaterThan(5);
      expect(factor, id).toBeLessThan(6.5);
    }
  });

  it('chaos is the priciest combat tower and at no armor the most cost-efficient pick', () => {
    // The generalist hits every armor at 1.0 but must not be the obvious buy
    // anywhere. Measured at base level, where the tower price still weighs in.
    const chaos = getTowerType('chaos');
    const others = combatIds.filter((id) => id !== 'chaos').map(getTowerType);
    for (const t of others) expect(chaos.cost, t.id).toBeGreaterThan(t.cost);

    const dpsPerGold = (t: TowerTypeConfig, armor: ArmorType) =>
      (computeTowerDPSFromLevels(t, {}) * DAMAGE_MATRIX[t.damageType][armor]) / t.cost;
    for (const armor of ARMOR_TYPES) {
      const best = Math.max(...others.map((t) => dpsPerGold(t, armor)));
      expect(dpsPerGold(chaos, armor), armor).toBeCloseTo(0.3, 5);
      expect(best, armor).toBeGreaterThan(0.55);
    }
  });

  it('chaos hits air and ground and unlocks behind the siege and the ethereal path', () => {
    const chaos = getTowerType('chaos');
    expect(chaos.damageType).toBe('chaos');
    expect(chaos.canTargetAir).toBe(true);
    expect(chaos.canTargetGround).toBe(true);

    // Transitive prerequisites: chaos must never arrive before a real counter
    // to heavy (cannon) and to ethereal (magic).
    const required = new Set<string>();
    const visit = (id: string): void => {
      for (const p of getResearch(id)?.prerequisites ?? []) {
        required.add(p);
        visit(p);
      }
    };
    const unlock = getResearchForTower('chaos');
    expect(unlock).toBeDefined();
    visit(unlock!.id);
    expect(required).toContain('siege-engineering');
    expect(required).toContain('arcane-studies');
  });

  it('the iron bastion is flak: splash in the air and on the ground, never the best gold against one body', () => {
    // Its burst is the point (MASTER_GAME_DESIGN §3.14): against a single light body the gatling stays the
    // better buy, and against heavy and fortified the pierce shell is weak, as the gatling's bullets.
    const bastion = getTowerType('bastion');
    expect(bastion.damageType).toBe('pierce');
    expect(bastion.canTargetAir).toBe(true);
    expect(bastion.canTargetGround).toBe(true);
    expect(PROJECTILE_TYPES[bastion.projectileType].splashRadius).toBeGreaterThan(0);

    const dpsPerGold = (t: TowerTypeConfig, armor: ArmorType) =>
      (computeTowerDPSFromLevels(t, {}) * DAMAGE_MATRIX[t.damageType][armor]) / t.cost;
    const gatling = getTowerType('dual-gatling');
    expect(dpsPerGold(bastion, 'light')).toBeCloseTo(0.432, 3);
    expect(dpsPerGold(bastion, 'light')).toBeLessThan(dpsPerGold(gatling, 'light'));
    expect(dpsPerGold(bastion, 'heavy')).toBeLessThan(0.1);
    expect(getResearchForTower('bastion')?.prerequisites).toContain('siege-engineering');
  });

  it('the sentinel laser heats up on one target: no better gold than lightning at its mean, the best on a held heavy body', () => {
    const sentinel = getTowerType('sentinel');
    const laser = sentinel.laser!;
    expect(sentinel.attackType).toBe('laser');
    expect(sentinel.canTargetAir).toBe(true);
    expect(laserHeat(laser, 0, 1)).toBe(1);
    expect(laserHeat(laser, laser.rampSeconds / 2, 1)).toBeCloseTo((1 + laser.maxFactor) / 2, 9);
    expect(laserHeat(laser, laser.rampSeconds * 2, 1)).toBe(laser.maxFactor);
    // The Heat-up track shortens the ramp
    expect(laserHeat(laser, laser.rampSeconds / 2, 2)).toBe(laser.maxFactor);

    const perGold = (t: TowerTypeConfig, armor: ArmorType, dps = computeTowerDPSFromLevels(t, {})) =>
      (dps * DAMAGE_MATRIX[t.damageType][armor]) / t.cost;
    const lightning = getTowerType('lightning');
    expect(perGold(sentinel, 'heavy')).toBeCloseTo(0.424, 3);
    expect(perGold(sentinel, 'heavy')).toBeLessThan(perGold(lightning, 'heavy'));
    // Hot on one heavy body: more than any tower's single target model DPS per gold against heavy
    const hot = perGold(sentinel, 'heavy', sentinel.damage * laser.maxFactor);
    expect(hot).toBeCloseTo(0.678, 3);
    for (const id of ['cannon', 'lightning', 'magic', 'chaos'] as const) {
      expect(hot, id).toBeGreaterThan(perGold(getTowerType(id), 'heavy'));
    }
    expect(getResearchForTower('sentinel')?.prerequisites).toContain('storm-mastery');
  });

  it('the chainsaw saws three bodies at once at the road: much damage per gold for its short reach', () => {
    const saw = getTowerType('chainsaw');
    expect(saw.attackType).toBe('saw');
    expect(saw.sawArms).toHaveLength(3);
    expect(saw.canTargetAir).toBe(false);
    // Arms of 14 m: from the closest a tower may stand to a route (10 m) across the road
    expect(saw.range).toBe(14);

    const perGold = (t: TowerTypeConfig, armor: ArmorType) =>
      (computeTowerDPSFromLevels(t, {}) * DAMAGE_MATRIX[t.damageType][armor]) / t.cost;
    expect(perGold(saw, 'unarmored')).toBeCloseTo(0.804, 3);
    // More than the gatling, which reaches 50 m, less than the tentacle and its slam at the choke
    expect(perGold(saw, 'unarmored')).toBeGreaterThan(perGold(getTowerType('dual-gatling'), 'unarmored'));
    expect(perGold(saw, 'unarmored')).toBeLessThan(perGold(getTowerType('tentacle'), 'unarmored'));
    expect(perGold(saw, 'heavy')).toBeLessThan(0.25);
    expect(getResearchForTower('chainsaw')?.prerequisites).toEqual(['tentacle-biology', 'siege-engineering']);
  });

  it('every configured turretNode exists in its model', () => {
    // A renamed node would leave the tower without a turret and no error.
    const towers = getAllTowerTypes().filter((t) => t.turretNode);
    expect(towers.map((t) => t.id)).toContain('chaos');
    for (const tower of towers) {
      const glb = readFileSync(resolve(process.cwd(), 'public', tower.modelUrl));
      const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
      const names = (json.nodes ?? []).map((n: { name?: string }) => n.name);
      expect(names, tower.id).toContain(tower.turretNode);
    }
  });

  it('targeting rules for specific towers', () => {
    const rocket = getTowerType('rocket');
    const ice = getTowerType('ice');
    const fire = getTowerType('fire');

    expect(rocket.canTargetAir).toBe(true);
    expect(rocket.canTargetGround).toBe(false);

    expect(ice.canTargetAir).toBe(true);
    expect(ice.canTargetGround).toBe(true);

    expect(fire.canTargetAir).toBe(false);
    expect(fire.canTargetGround).toBe(true);
  });
});
