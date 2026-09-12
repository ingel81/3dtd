import {
  getAllTowerTypes,
  getTowerType,
  getUpgradeCost,
  upgradeFactor,
  TOWER_TYPES,
  TowerTypeConfig,
  TowerTypeId,
  TowerUpgrade,
} from './tower-types.config';
import { ARMOR_TYPES, ArmorType } from './combat/combat.types';
import { DAMAGE_MATRIX } from './combat/damage-matrix.config';
import { computeTowerDPSFromLevels } from '../ai/core/tower-dps.util';
import { getResearch, getResearchForTower } from './research/research-tree.config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('tower types config', () => {
  // Combat towers + passive buildings (research-center)
  const combatIds: TowerTypeId[] = ['archer', 'dual-gatling', 'cannon', 'magic', 'rocket', 'ice', 'fire', 'tentacle', 'poison', 'lightning', 'chaos'];
  const allIds: TowerTypeId[] = [...combatIds, 'research-center'];

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
