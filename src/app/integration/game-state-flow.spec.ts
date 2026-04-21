/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Integration Test: Full Game-State Flow via EventBus
 *
 * Tests high-level game flows using the EventBus as orchestrator:
 *   - Place tower → event emitted → tower tracked
 *   - Start wave → enemies spawn → walk → reach HQ → base health decreases
 *   - Tower shoots → projectile hits → enemy dies → credits awarded
 *   - Wave completion detection
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Three.js
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
import { GAME_BALANCE } from '../configs/game-balance.config';
import { TOWER_TYPES } from '../configs/tower-types.config';

describe('Game State Flow Integration', () => {
  let m: TestManagers;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    m = createTestManagers();

    // Initialize wave + tower managers
    m.waveManager.initialize(TEST_SPAWN_POINTS, createTestCachedPaths());
    m.waveManager.setTimescaleProvider(() => 1.0);

    m.towerManager.initializeWithContext(
      m.tilesEngine,
      { nodes: [], ways: [] } as any,
      TEST_BASE_POSITION,
      TEST_SPAWN_POINTS.map(s => ({ lat: s.lat, lon: s.lon }))
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Tests ────────────────────────────────────────────────────────

  it('should emit all expected events during a complete game round', () => {
    const events: string[] = [];
    m.eventBus.onAny((event) => events.push(event.type));

    // 1. Place tower
    const _tower = m.towerManager.placeTower(TEST_TOWER_POSITION, 'archer', 0)!;
    expect(events).toContain('tower:placed');

    // 2. Start wave
    m.waveManager.startWave({
      enemyCount: 1,
      enemyType: 'zombie',
      enemySpeed: 5,
      spawnMode: 'each',
      spawnDelay: 0,
    });
    expect(events).toContain('wave:started');
    expect(events).toContain('enemy:spawned');

    // 3. Kill enemy
    const enemy = m.enemyManager.getAll()[0];
    m.enemyManager.kill(enemy, 1.0);
    expect(events).toContain('enemy:died');
  });

  it('should handle base damage through event chain (enemy reaches base)', () => {
    // Track health:changed through events
    let baseHealth = GAME_BALANCE.player.startHealth;
    m.eventBus.on('enemy:reached-base', (event) => {
      baseHealth = Math.max(0, baseHealth - event.damage);
    });

    // Spawn fast enemy that reaches base
    m.enemyManager.spawn(TEST_PATH, 'zombie', 500, false);

    // Run until enemy reaches end
    for (let i = 0; i < 200; i++) {
      m.enemyManager.update(50, 1.0);
      if (m.enemyManager.getAll().length === 0) break;
    }

    expect(baseHealth).toBe(GAME_BALANCE.player.startHealth - GAME_BALANCE.combat.enemyBaseDamage);
  });

  it('should track credits through event chain (enemy killed → credits)', () => {
    let totalCredits = GAME_BALANCE.player.startCredits;

    // Place tower (costs credits)
    const archerCost = TOWER_TYPES['archer'].cost;
    const _tower = m.towerManager.placeTower(TEST_TOWER_POSITION, 'archer', 0)!;
    totalCredits -= archerCost;

    // Simulate earning credits from killing an enemy
    m.eventBus.on('enemy:died', (event) => {
      totalCredits += event.credits;
    });

    const enemy = m.enemyManager.spawn(TEST_PATH, 'zombie', 5, true);
    m.enemyManager.kill(enemy, 1.0);

    // Credits should have increased
    expect(totalCredits).toBeGreaterThan(GAME_BALANCE.player.startCredits - archerCost);
  });

  it('should complete full wave lifecycle: start → spawn → kill all → complete', () => {
    m.waveManager.startWave({
      enemyCount: 2,
      enemyType: 'zombie',
      enemySpeed: 5,
      spawnMode: 'each',
      spawnDelay: 50,
    });

    // Wait for all enemies to spawn
    vi.advanceTimersByTime(100);
    expect(m.enemyManager.getAll()).toHaveLength(2);
    expect(m.waveManager.phase()).toBe('wave');

    // Kill all enemies
    const enemies = [...m.enemyManager.getAll()];
    for (const enemy of enemies) {
      m.enemyManager.kill(enemy, 1.0);
    }

    // Advance past death animation (wave waits for killingEnemies to clear)
    vi.advanceTimersByTime(2100);

    // Check wave complete
    expect(m.waveManager.checkWaveComplete()).toBe(true);

    // End wave
    const completedHandler = vi.fn();
    m.eventBus.on('wave:completed', completedHandler);
    m.waveManager.endWave();

    // Process deferred events
    m.eventBus.processQueue();

    expect(m.waveManager.phase()).toBe('setup');
    expect(completedHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'wave:completed',
        wave: 1,
      })
    );
  });

  it('should wire tower targeting + projectile + kill through real objects', () => {
    const tower = m.towerManager.placeTower(TEST_TOWER_POSITION, 'archer', 0)!;
    const enemy = m.enemyManager.spawn(TEST_PATH, 'zombie', 5, true);

    // Wire damage handler
    m.eventBus.on('projectile:hit', (event) => {
      const killed = event.target.health.takeDamage(event.damage);
      if (killed) {
        m.enemyManager.kill(event.target);
      }
    });

    // Tower finds target
    const target = tower.findTarget(m.enemyManager.getAll(), false);
    expect(target).toBe(enemy);

    // Fire projectiles until enemy dies
    const hitsNeeded = Math.ceil(enemy.health.maxHp / tower.combat.damage);
    for (let shot = 0; shot < hitsNeeded + 1; shot++) {
      if (!enemy.alive) break;

      m.projectileManager.spawn(tower, enemy);

      for (let frame = 0; frame < 500; frame++) {
        m.projectileManager.update(16);
        if (m.projectileManager.getAll().length === 0) break;
      }
    }

    expect(enemy.health.isDead).toBe(true);
  });

  it('should handle tower upgrade increasing fire rate', () => {
    const tower = m.towerManager.placeTower(TEST_TOWER_POSITION, 'archer', 0)!;
    const baseFireRate = tower.combat.fireRate;

    // Archer has 'speed' upgrade (doubles fire rate)
    const upgraded = tower.applyUpgrade('speed');
    expect(upgraded).toBe(true);
    expect(tower.combat.fireRate).toBeGreaterThan(baseFireRate);
  });

  it('should handle selling tower and getting refund', () => {
    const tower = m.towerManager.placeTower(TEST_TOWER_POSITION, 'archer', 0)!;
    const expectedRefund = tower.typeConfig.sellValue;

    const refund = m.towerManager.sell(tower);

    expect(refund).toBe(expectedRefund);
    expect(m.towerManager.getAll()).toHaveLength(0);
  });

  it('should handle multiple waves sequentially', () => {
    // Wave 1
    m.waveManager.startWave({
      enemyCount: 1,
      enemyType: 'zombie',
      enemySpeed: 5,
      spawnMode: 'each',
      spawnDelay: 0,
    });
    expect(m.waveManager.waveNumber()).toBe(1);

    // Kill and complete wave 1
    for (const e of [...m.enemyManager.getAll()]) m.enemyManager.kill(e, 1.0);
    m.waveManager.endWave();

    // Wave 2
    m.waveManager.startWave({
      enemyCount: 2,
      enemyType: 'zombie',
      enemySpeed: 8,
      spawnMode: 'each',
      spawnDelay: 50,
    });
    expect(m.waveManager.waveNumber()).toBe(2);

    vi.advanceTimersByTime(100);
    expect(m.enemyManager.getAll()).toHaveLength(2);
  });
});
