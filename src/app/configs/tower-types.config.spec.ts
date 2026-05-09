import {
  getAllTowerTypes,
  getTowerType,
  getUpgradeCost,
  TOWER_TYPES,
  TowerTypeId,
  TowerUpgrade,
} from './tower-types.config';

describe('tower types config', () => {
  // Combat towers + passive buildings (research-center)
  const combatIds: TowerTypeId[] = ['archer', 'dual-gatling', 'cannon', 'magic', 'rocket', 'ice', 'fire', 'tentacle', 'poison'];
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
    expect(fire.beamRange).toBeGreaterThan(0);
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
