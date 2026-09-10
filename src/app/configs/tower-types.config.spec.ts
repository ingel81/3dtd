import {
  getAllTowerTypes,
  getTowerType,
  getUpgradeCost,
  upgradeFactor,
  TOWER_TYPES,
  TowerTypeId,
  TowerUpgrade,
} from './tower-types.config';

describe('tower types config', () => {
  // Combat towers + passive buildings (research-center)
  const combatIds: TowerTypeId[] = ['archer', 'dual-gatling', 'cannon', 'magic', 'rocket', 'ice', 'fire', 'tentacle', 'poison', 'lightning'];
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
