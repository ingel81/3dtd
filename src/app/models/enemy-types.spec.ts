import {
  ENEMY_TYPES,
  getAllEnemyTypes,
  getEnemyType,
  getEnemyTypeIds,
} from './enemy-types';

describe('enemy types config', () => {
  it('all enemy types have required fields', () => {
    const all = getAllEnemyTypes();
    all.forEach((enemy) => {
      expect(enemy.id).toBeTruthy();
      expect(enemy.name).toBeTruthy();
      expect(enemy.modelUrl).toBeTruthy();
      expect(enemy.baseHp).toBeGreaterThan(0);
      expect(enemy.baseSpeed).toBeGreaterThan(0);
    });
  });

  it('getEnemyType() returns correct type for each id', () => {
    const ids = getEnemyTypeIds();
    ids.forEach((id) => {
      expect(getEnemyType(id)).toBe(ENEMY_TYPES[id]);
    });
  });

  it('has consistent numeric fields', () => {
    const all = getAllEnemyTypes();
    all.forEach((enemy) => {
      expect(typeof enemy.heightOffset).toBe('number');
      expect(enemy.scale).toBeGreaterThan(0);
    });
  });

  it('all enemy IDs are unique', () => {
    const ids = getEnemyTypeIds();
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});
