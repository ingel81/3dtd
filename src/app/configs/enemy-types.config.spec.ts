import {
  ENEMY_TYPES,
  getAllEnemyTypes,
  getEnemyType,
  getEnemyTypeIds,
} from './enemy-types.config';

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

  it('preview fields are undefined or valid numbers', () => {
    const all = getAllEnemyTypes();
    all.forEach((enemy) => {
      if (enemy.previewCameraDistance !== undefined) {
        expect(typeof enemy.previewCameraDistance).toBe('number');
        expect(enemy.previewCameraDistance).toBeGreaterThan(0);
      }
      if (enemy.previewCameraAngle !== undefined) {
        expect(typeof enemy.previewCameraAngle).toBe('number');
        expect(enemy.previewCameraAngle).toBeGreaterThanOrEqual(0);
        expect(enemy.previewCameraAngle).toBeLessThanOrEqual(Math.PI / 2);
      }
      if (enemy.previewOffsetY !== undefined) {
        expect(typeof enemy.previewOffsetY).toBe('number');
      }
    });
  });

  it('preview defaults are applied correctly', () => {
    const all = getAllEnemyTypes();
    all.forEach((enemy) => {
      const cameraDistance = enemy.previewCameraDistance ?? 7;
      const cameraAngle = enemy.previewCameraAngle ?? Math.PI / 12;
      const offsetY = enemy.previewOffsetY ?? 0;

      expect(cameraDistance).toBeGreaterThan(0);
      expect(cameraAngle).toBeGreaterThanOrEqual(0);
      expect(typeof offsetY).toBe('number');
    });
  });
});
