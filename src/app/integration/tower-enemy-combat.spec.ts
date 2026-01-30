/**
 * Integration Test: TowerManager + EnemyManager + ProjectileManager
 *
 * Tests the full combat loop:
 *   Tower fires → projectile spawns → hits enemy → enemy takes damage
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Three.js before any imports that use it
vi.mock('three', () => ({
  Vector3: class {
    x = 0; y = 0; z = 0;
    constructor(x?: number, y?: number, z?: number) {
      this.x = x ?? 0; this.y = y ?? 0; this.z = z ?? 0;
    }
  },
  InstancedMesh: class {},
  Mesh: class {},
  MeshBasicMaterial: class {},
  SphereGeometry: class {},
  Scene: class {},
  Object3D: class {},
}));

import {
  createTestManagers,
  TestManagers,
  TEST_PATH,
  TEST_TOWER_POSITION,
  TEST_BASE_POSITION,
  TEST_SPAWN_POINTS,
  createTestCachedPaths,
} from './test-helpers';
import { Enemy } from '../entities/enemy.entity';
import { Tower } from '../entities/tower.entity';
import { Projectile } from '../entities/projectile.entity';
import { GameEventBus } from '../game-engine/game-event-bus';

describe('Tower → Enemy Combat Integration', () => {
  let m: TestManagers;

  beforeEach(() => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    m = createTestManagers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Helpers ──────────────────────────────────────────────────────

  function spawnEnemy(speedMps = 5): Enemy {
    return m.enemyManager.spawn(TEST_PATH, 'zombie', speedMps, true);
  }

  function placeTower(): Tower {
    // Initialize tower manager first
    m.towerManager.initializeWithContext(
      m.tilesEngine,
      { nodes: [], ways: [] } as any,
      TEST_BASE_POSITION,
      TEST_SPAWN_POINTS.map(s => ({ lat: s.lat, lon: s.lon }))
    );
    return m.towerManager.placeTower(TEST_TOWER_POSITION, 'archer', 0)!;
  }

  // ── Tests ────────────────────────────────────────────────────────

  it('should place a tower and have it tracked in the manager', () => {
    const tower = placeTower();

    expect(tower).toBeDefined();
    expect(m.towerManager.getAll()).toHaveLength(1);
    expect(m.towerManager.getById(tower.id)).toBe(tower);
    expect(m.tilesEngine.towers.create).toHaveBeenCalledOnce();
  });

  it('should emit tower:placed event when a tower is placed', () => {
    const handler = vi.fn();
    m.eventBus.on('tower:placed', handler);

    const tower = placeTower();

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tower:placed',
        tower,
      })
    );
  });

  it('should find enemy target when enemy is within range', () => {
    const tower = placeTower();
    const enemy = spawnEnemy();

    // Enemy starts at path[0] which is within range of tower
    const target = tower.findTarget([enemy]);
    expect(target).toBe(enemy);
  });

  it('should spawn a projectile from tower towards enemy', () => {
    const tower = placeTower();
    const enemy = spawnEnemy();

    const projectile = m.projectileManager.spawn(tower, enemy);

    expect(projectile).toBeDefined();
    expect(m.projectileManager.getAll()).toHaveLength(1);
    expect(projectile.targetEnemy).toBe(enemy);
    expect(projectile.damage).toBe(tower.combat.damage);
    expect(m.tilesEngine.projectiles.create).toHaveBeenCalledOnce();
  });

  it('should move projectile toward target and hit it', () => {
    const tower = placeTower();
    const enemy = spawnEnemy();
    const projectile = m.projectileManager.spawn(tower, enemy);

    const initialHp = enemy.health.hp;

    // Listen for projectile:hit
    const hitHandler = vi.fn();
    m.eventBus.on('projectile:hit', hitHandler);

    // Simulate many frames — projectile should eventually reach enemy
    for (let i = 0; i < 500; i++) {
      m.projectileManager.update(16); // 16ms per frame
      if (m.projectileManager.getAll().length === 0) break;
    }

    // Projectile should have been removed (hit or completed flight)
    expect(m.projectileManager.getAll()).toHaveLength(0);

    // projectile:hit event should have fired
    expect(hitHandler).toHaveBeenCalledOnce();
    expect(hitHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'projectile:hit',
        projectile,
        target: enemy,
        damage: tower.combat.damage,
      })
    );
  });

  it('should apply damage when projectile:hit is processed by a damage handler', () => {
    const tower = placeTower();
    const enemy = spawnEnemy();
    const initialHp = enemy.health.hp;

    // Wire up a simple damage handler (what CombatEffectService does)
    m.eventBus.on('projectile:hit', (event) => {
      event.target.health.takeDamage(event.damage);
    });

    m.projectileManager.spawn(tower, enemy);

    // Run until hit
    for (let i = 0; i < 500; i++) {
      m.projectileManager.update(16);
      if (m.projectileManager.getAll().length === 0) break;
    }

    expect(enemy.health.hp).toBe(initialHp - tower.combat.damage);
  });

  it('should kill enemy when enough damage is applied', () => {
    const tower = placeTower();
    const enemy = spawnEnemy();

    // Wire up damage handler
    m.eventBus.on('projectile:hit', (event) => {
      const killed = event.target.health.takeDamage(event.damage);
      if (killed) {
        m.enemyManager.kill(event.target);
      }
    });

    const diedHandler = vi.fn();
    m.eventBus.on('enemy:died', diedHandler);

    // Spawn enough projectiles to kill the enemy
    const hitsNeeded = Math.ceil(enemy.health.maxHp / tower.combat.damage);
    for (let shot = 0; shot < hitsNeeded; shot++) {
      if (!enemy.alive) break;
      m.projectileManager.spawn(tower, enemy);
      // Run until this projectile hits
      for (let i = 0; i < 500; i++) {
        m.projectileManager.update(16);
        if (m.projectileManager.getAll().length === 0) break;
      }
    }

    expect(enemy.health.isDead).toBe(true);
    expect(diedHandler).toHaveBeenCalledOnce();
  });

  it('should handle projectile continuing to last position when target dies mid-flight', () => {
    const tower = placeTower();
    const enemy = spawnEnemy();

    m.projectileManager.spawn(tower, enemy);

    // Kill enemy immediately (simulating another tower killing it)
    enemy.health.takeDamage(enemy.health.maxHp);

    // Projectile should still complete its flight
    for (let i = 0; i < 500; i++) {
      m.projectileManager.update(16);
      if (m.projectileManager.getAll().length === 0) break;
    }

    // Projectile should eventually be removed (reached last position)
    expect(m.projectileManager.getAll()).toHaveLength(0);
  });

  it('should emit tower:sold event and remove tower when sold', () => {
    const tower = placeTower();
    const soldHandler = vi.fn();
    m.eventBus.on('tower:sold', soldHandler);

    const refund = m.towerManager.sell(tower);

    expect(refund).toBe(tower.typeConfig.sellValue);
    expect(m.towerManager.getAll()).toHaveLength(0);
    expect(soldHandler).toHaveBeenCalledOnce();
    expect(soldHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tower:sold',
        tower,
        refund,
      })
    );
  });
});
