/**
 * Integration Test: WaveManager + EnemyManager
 *
 * Tests wave progression and enemy spawning:
 *   Start wave → enemies spawn → correct types/counts → wave completes
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Three.js before any imports
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
  TEST_SPAWN_POINTS,
  createTestCachedPaths,
} from './test-helpers';
import { WaveConfig } from '../managers/wave.manager';

describe('Wave + Enemy Spawning Integration', () => {
  let m: TestManagers;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    m = createTestManagers();
    m.waveManager.initialize(TEST_SPAWN_POINTS, createTestCachedPaths());
    m.waveManager.setTimescaleProvider(() => 1.0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── Tests ────────────────────────────────────────────────────────

  it('should start in setup phase', () => {
    expect(m.waveManager.phase()).toBe('setup');
    expect(m.waveManager.waveNumber()).toBe(0);
  });

  it('should transition to wave phase when startWave is called', () => {
    const config: WaveConfig = {
      enemyCount: 3,
      enemyType: 'zombie',
      enemySpeed: 5,
      spawnMode: 'each',
      spawnDelay: 100,
    };

    const waveStartedHandler = vi.fn();
    m.eventBus.on('wave:started', waveStartedHandler);

    m.waveManager.startWave(config);

    expect(m.waveManager.phase()).toBe('wave');
    expect(m.waveManager.waveNumber()).toBe(1);
    expect(waveStartedHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'wave:started',
        wave: 1,
        enemyCount: 3,
      })
    );
  });

  it('should spawn enemies over time based on spawnDelay', () => {
    const config: WaveConfig = {
      enemyCount: 3,
      enemyType: 'zombie',
      enemySpeed: 5,
      spawnMode: 'each',
      spawnDelay: 200,
    };

    m.waveManager.startWave(config);

    // First enemy spawns immediately
    expect(m.enemyManager.getAll().length).toBe(1);

    // Advance time → second enemy spawns
    vi.advanceTimersByTime(200);
    expect(m.enemyManager.getAll().length).toBe(2);

    // Advance again → third enemy spawns
    vi.advanceTimersByTime(200);
    expect(m.enemyManager.getAll().length).toBe(3);

    // No more spawns after count reached
    vi.advanceTimersByTime(200);
    expect(m.enemyManager.getAll().length).toBe(3);
  });

  it('should spawn enemies of the correct type', () => {
    const config: WaveConfig = {
      enemyCount: 2,
      enemyType: 'zombie',
      enemySpeed: 8,
      spawnMode: 'each',
      spawnDelay: 50,
    };

    m.waveManager.startWave(config);
    vi.advanceTimersByTime(100); // spawn all

    const enemies = m.enemyManager.getAll();
    expect(enemies).toHaveLength(2);
    for (const enemy of enemies) {
      expect(enemy.typeConfig.id).toBe('zombie');
      expect(enemy.movement.speedMps).toBe(8);
    }
  });

  it('should apply custom health override to spawned enemies', () => {
    const config: WaveConfig = {
      enemyCount: 1,
      enemyType: 'zombie',
      enemySpeed: 5,
      enemyHealth: 500,
      spawnMode: 'each',
      spawnDelay: 0,
    };

    m.waveManager.startWave(config);

    const enemies = m.enemyManager.getAll();
    expect(enemies).toHaveLength(1);
    expect(enemies[0].health.maxHp).toBe(500);
    expect(enemies[0].health.hp).toBe(500);
  });

  it('should detect wave completion when all enemies are dead', () => {
    const config: WaveConfig = {
      enemyCount: 2,
      enemyType: 'zombie',
      enemySpeed: 5,
      spawnMode: 'each',
      spawnDelay: 50,
    };

    m.waveManager.startWave(config);
    vi.advanceTimersByTime(100); // spawn all 2

    expect(m.waveManager.checkWaveComplete()).toBe(false);

    // Kill all enemies
    const enemies = [...m.enemyManager.getAll()];
    for (const enemy of enemies) {
      m.enemyManager.kill(enemy, 1.0);
    }

    // Wave should now be complete
    expect(m.waveManager.checkWaveComplete()).toBe(true);
  });

  it('should NOT mark wave complete while enemies are still spawning', () => {
    const config: WaveConfig = {
      enemyCount: 3,
      enemyType: 'zombie',
      enemySpeed: 5,
      spawnMode: 'each',
      spawnDelay: 500, // Slow spawning
    };

    m.waveManager.startWave(config);

    // Only 1 enemy spawned, kill it
    const enemy = m.enemyManager.getAll()[0];
    m.enemyManager.kill(enemy, 1.0);

    // Wave should NOT be complete (2 more enemies to spawn)
    expect(m.waveManager.checkWaveComplete()).toBe(false);
  });

  it('should increment wave number with each wave', () => {
    const config: WaveConfig = {
      enemyCount: 1,
      enemyType: 'zombie',
      enemySpeed: 5,
      spawnMode: 'each',
      spawnDelay: 0,
    };

    // Wave 1
    m.waveManager.startWave(config);
    expect(m.waveManager.waveNumber()).toBe(1);

    // Kill enemies and end wave
    for (const e of [...m.enemyManager.getAll()]) {
      m.enemyManager.kill(e, 1.0);
    }
    m.waveManager.endWave();
    expect(m.waveManager.phase()).toBe('setup');

    // Wave 2
    m.waveManager.startWave(config);
    expect(m.waveManager.waveNumber()).toBe(2);
  });

  it('should cycle spawn points in "each" mode', () => {
    // Add a second spawn point
    const multiSpawnPoints: typeof TEST_SPAWN_POINTS = [
      ...TEST_SPAWN_POINTS,
      {
        id: 'spawn-2',
        name: 'Test Spawn 2',
        lat: 48.7758,
        lon: 9.1831,
        height: 300,
      },
    ];
    const cachedPaths = createTestCachedPaths();
    // Add path for second spawn point
    cachedPaths.set('spawn-2', [
      { lat: 48.7758, lon: 9.1831, height: 300 },
      { lat: 48.7768, lon: 9.1831, height: 300 },
    ]);

    m.waveManager.initialize(multiSpawnPoints, cachedPaths);

    const config: WaveConfig = {
      enemyCount: 4,
      enemyType: 'zombie',
      enemySpeed: 5,
      spawnMode: 'each',
      spawnDelay: 50,
    };

    const spawnedHandler = vi.fn();
    m.eventBus.on('enemy:spawned', spawnedHandler);

    m.waveManager.startWave(config);
    vi.advanceTimersByTime(300); // spawn all 4

    expect(spawnedHandler).toHaveBeenCalledTimes(4);
    expect(m.enemyManager.getAll()).toHaveLength(4);
  });

  it('should reset cleanly', () => {
    const config: WaveConfig = {
      enemyCount: 3,
      enemyType: 'zombie',
      enemySpeed: 5,
      spawnMode: 'each',
      spawnDelay: 100,
    };

    m.waveManager.startWave(config);
    vi.advanceTimersByTime(50);

    m.waveManager.reset();

    expect(m.waveManager.phase()).toBe('setup');
    expect(m.waveManager.waveNumber()).toBe(0);
    expect(m.enemyManager.getAll()).toHaveLength(0);

    // No more spawns should happen
    vi.advanceTimersByTime(1000);
    expect(m.enemyManager.getAll()).toHaveLength(0);
  });

  it('should scale spawn delays with timescale', () => {
    m.waveManager.setTimescaleProvider(() => 2.0); // 2x speed

    const config: WaveConfig = {
      enemyCount: 3,
      enemyType: 'zombie',
      enemySpeed: 5,
      spawnMode: 'each',
      spawnDelay: 200, // Game-time delay
    };

    m.waveManager.startWave(config);

    // At 2x, real-time delay = 200/2 = 100ms
    expect(m.enemyManager.getAll()).toHaveLength(1); // first immediate

    vi.advanceTimersByTime(100);
    expect(m.enemyManager.getAll()).toHaveLength(2);

    vi.advanceTimersByTime(100);
    expect(m.enemyManager.getAll()).toHaveLength(3);
  });
});
