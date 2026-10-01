import {
  ENEMY_TYPES,
  getAllEnemyTypes,
  getDebugEnemyTypes,
  getEnemyType,
  getEnemyTypeIds,
  lineageHp,
  splitBodyCount,
  leakDamageOf,
  lineageLeakDamage,
  MAX_LEAK_DAMAGE,
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

  it('offers Skarnax to Custom Wave and Enemy Debug as the worm and its segment, not its tail', () => {
    const skarnax = getDebugEnemyTypes().map((e) => e.id).filter((id) => id.startsWith('worm'));
    expect(skarnax).toEqual(['worm', 'worm-segment']);
    expect(getDebugEnemyTypes()).toHaveLength(getAllEnemyTypes().length - 1);
  });

  it('flags the machines as mechanical: tank and mech', () => {
    const machines = getAllEnemyTypes().filter((e) => e.mechanical).map((e) => e.id);
    expect(machines).toEqual(['tank', 'mech']);
  });

  it('counts a skeleton with its two minions: three bodies, 20 + 2 × 6 HP', () => {
    expect(splitBodyCount('skeleton')).toBe(3);
    expect(lineageHp('skeleton')).toBe(32);
    expect(splitBodyCount('skeleton-minion')).toBe(1);
    expect(lineageHp('skeleton-minion')).toBe(6);
    expect(splitBodyCount('zombie')).toBe(1);
    expect(lineageHp('zombie')).toBe(ENEMY_TYPES['zombie'].baseHp);
  });

  it('breaks an ooze into twenty slime clumps that split no further', () => {
    expect(ENEMY_TYPES['ooze'].splitOnDeath?.type).toBe('slime-clump');
    expect(splitBodyCount('ooze')).toBe(21);
    expect(lineageHp('ooze')).toBe(ENEMY_TYPES['ooze'].baseHp + 20 * ENEMY_TYPES['slime-clump'].baseHp);
    // 20 clumps of 3 at the HQ cost more than the whole ooze (49)
    expect(lineageLeakDamage('ooze')).toBe(20 * leakDamageOf('slime-clump'));
    expect(ENEMY_TYPES['slime-clump'].splitOnDeath).toBeUndefined();
  });

  it('keeps the clumps of a full ooze at a tenth of its HP', () => {
    // Die Beziehung, nicht die Zahl: Der Ooze zog am 2026-09-22 von 3.000 auf
    // 60.000, weil ihn als einzelnen Körper jeder Turm gleichzeitig trifft.
    // Die Klumpen mussten mit, sonst wäre aus einem Zehntel ein Zweihundertstel
    // geworden.
    const ooze = ENEMY_TYPES['ooze'];
    const split = ooze.splitOnDeath!;
    expect(split.count * ENEMY_TYPES['slime-clump'].baseHp).toBe(ooze.baseHp / 10);
    expect(lineageHp('ooze')).toBe(ooze.baseHp * 1.1);
  });

  it('lets a skeleton leak twice: both minions reach the base when it dies just before', () => {
    expect(lineageLeakDamage('skeleton')).toBe(ENEMY_TYPES['skeleton'].splitOnDeath!.count * leakDamageOf('skeleton-minion'));
    expect(lineageLeakDamage('skeleton')).toBe(2);
    expect(lineageLeakDamage('skeleton-minion')).toBe(1);
    expect(lineageLeakDamage('zombie')).toBe(leakDamageOf('zombie'));
  });

  it('costs the HQ by the square root of the HP, from 1 to 50 (TODO E49)', () => {
    expect(leakDamageOf('rat')).toBe(1);
    expect(leakDamageOf('zombie')).toBe(2);
    expect(leakDamageOf('tank')).toBe(3);
    expect(leakDamageOf('stone-golem')).toBe(4);
    expect(leakDamageOf('herbert')).toBe(13);
    expect(leakDamageOf('ooze')).toBe(49);
    for (const enemy of getAllEnemyTypes()) {
      const damage = leakDamageOf(enemy.id as never);
      expect(damage).toBeGreaterThanOrEqual(1);
      // A type's own leak damage stands in for the one from its HP
      expect(damage).toBeLessThanOrEqual(enemy.leakDamage ?? MAX_LEAK_DAMAGE);
    }
  });

  it('lets a type set its own leak damage: the worm costs 150 for all its segments', () => {
    expect(ENEMY_TYPES['worm'].leakDamage).toBe(150);
    expect(leakDamageOf('worm')).toBe(150);
    expect(ENEMY_TYPES['worm-segment'].leakDamage).toBeUndefined();
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
