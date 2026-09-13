import {
  ENEMY_TYPES,
  getAllEnemyTypes,
  getEnemyType,
  getEnemyTypeIds,
  lineageHp,
  splitBodyCount,
  splitLeafCount,
} from './enemy-types.config';

describe('enemy types config', () => {
  it('splits only into enemy types that exist, without a cycle', () => {
    for (const enemy of getAllEnemyTypes()) {
      const split = enemy.splitOnDeath;
      if (!split) continue;
      expect(ENEMY_TYPES[split.type], `${enemy.id} splits into ${split.type}`).toBeDefined();
      expect(split.count).toBeGreaterThan(0);
      expect(split.spread).toBeGreaterThanOrEqual(0);
      expect(split.spread).toBeLessThanOrEqual(1);
      // Following the children ends before the depth guard would cut it off
      let next: string | undefined = split.type;
      for (let depth = 0; next && depth < 4; depth++) next = ENEMY_TYPES[next]?.splitOnDeath?.type;
      expect(next, `${enemy.id} split chain`).toBeUndefined();
    }
  });

  it('counts a skeleton with its two minions: three bodies, 20 + 2 × 6 HP', () => {
    expect(splitBodyCount('skeleton')).toBe(3);
    expect(lineageHp('skeleton')).toBe(32);
    expect(splitBodyCount('skeleton-minion')).toBe(1);
    expect(lineageHp('skeleton-minion')).toBe(6);
    expect(splitBodyCount('zombie')).toBe(1);
    expect(lineageHp('zombie')).toBe(ENEMY_TYPES['zombie'].baseHp);
  });

  it('breaks an ooze into ten slime clumps that split no further', () => {
    expect(ENEMY_TYPES['ooze'].splitOnDeath?.type).toBe('slime-clump');
    expect(splitBodyCount('ooze')).toBe(11);
    expect(lineageHp('ooze')).toBe(ENEMY_TYPES['ooze'].baseHp + 10 * ENEMY_TYPES['slime-clump'].baseHp);
    expect(splitLeafCount('ooze')).toBe(10);
    expect(ENEMY_TYPES['slime-clump'].splitOnDeath).toBeUndefined();
  });

  it('lets a skeleton leak twice: both minions reach the base when it dies just before', () => {
    expect(splitLeafCount('skeleton')).toBe(ENEMY_TYPES['skeleton'].splitOnDeath!.count);
    expect(splitLeafCount('skeleton')).toBe(2);
    expect(splitLeafCount('skeleton-minion')).toBe(1);
    expect(splitLeafCount('zombie')).toBe(1);
  });

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
