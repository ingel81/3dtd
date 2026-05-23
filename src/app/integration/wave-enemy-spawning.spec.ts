/**
 * Integration Test: WaveManager + EnemyManager
 *
 * Tests wave progression and enemy spawning:
 *   Start wave → enemies spawn → correct types/counts → wave completes
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Three.js before any imports
vi.mock('three', async () => {
  const mod = await import('@/test/mocks/three.mock');
  return { ...mod };
});

import {
  createTestManagers,
  TestManagers,
  TEST_SPAWN_POINTS,
  createTestCachedPaths,
  tickEngine,
  makeSingleTypeWaveConfig,
} from './test-helpers';

describe('Wave + Enemy Spawning Integration', () => {
  let m: TestManagers;
  let clock: { now: number };

  beforeEach(() => {
    m = createTestManagers();
    m.waveManager.initialize(TEST_SPAWN_POINTS, createTestCachedPaths());
    clock = { now: 0 };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Tests ────────────────────────────────────────────────────────

  it('should start in setup phase', () => {
    expect(m.waveManager.phase()).toBe('setup');
    expect(m.waveManager.waveNumber()).toBe(0);
  });

  it('should transition to wave phase when startWave is called', () => {
    const config = makeSingleTypeWaveConfig({
      count: 3,
      type: 'zombie',
      speed: 5,
      spawnDelay: 100,
    });

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
    const config = makeSingleTypeWaveConfig({
      count: 3,
      type: 'zombie',
      speed: 5,
      spawnDelay: 200,
    });

    m.waveManager.startWave(config);

    tickEngine(m, 16, clock); // first sub-step → first spawn
    expect(m.enemyManager.getAll().length).toBe(1);

    tickEngine(m, 200, clock);
    expect(m.enemyManager.getAll().length).toBe(2);

    tickEngine(m, 200, clock);
    expect(m.enemyManager.getAll().length).toBe(3);

    tickEngine(m, 200, clock);
    expect(m.enemyManager.getAll().length).toBe(3);
  });

  it('should spawn enemies of the correct type', () => {
    const config = makeSingleTypeWaveConfig({
      count: 2,
      type: 'zombie',
      speed: 8,
      spawnDelay: 50,
    });

    m.waveManager.startWave(config);
    tickEngine(m, 200, clock);

    const enemies = m.enemyManager.getAll();
    expect(enemies).toHaveLength(2);
    for (const enemy of enemies) {
      expect(enemy.typeConfig.id).toBe('zombie');
      expect(enemy.movement.speedMps).toBe(8);
    }
  });

  it('should apply custom health override to spawned enemies', () => {
    const config = makeSingleTypeWaveConfig({
      count: 1,
      type: 'zombie',
      speed: 5,
      health: 500,
      spawnDelay: 0,
    });

    m.waveManager.startWave(config);
    tickEngine(m, 16, clock);

    const enemies = m.enemyManager.getAll();
    expect(enemies).toHaveLength(1);
    expect(enemies[0].health.maxHp).toBe(500);
    expect(enemies[0].health.hp).toBe(500);
  });

  it('should detect wave completion when all enemies are dead', () => {
    const config = makeSingleTypeWaveConfig({
      count: 2,
      type: 'zombie',
      speed: 5,
      spawnDelay: 50,
    });

    m.waveManager.startWave(config);
    tickEngine(m, 200, clock);

    expect(m.waveManager.checkWaveComplete()).toBe(false);

    for (const enemy of [...m.enemyManager.getAll()]) {
      m.enemyManager.kill(enemy);
    }

    // Death animation pending: not complete yet
    expect(m.waveManager.checkWaveComplete()).toBe(false);

    tickEngine(m, 2100, clock); // tick past death-animation duration

    expect(m.waveManager.checkWaveComplete()).toBe(true);
  });

  it('should NOT mark wave complete while enemies are still spawning', () => {
    const config = makeSingleTypeWaveConfig({
      count: 3,
      type: 'zombie',
      speed: 5,
      spawnDelay: 500,
    });

    m.waveManager.startWave(config);
    tickEngine(m, 16, clock); // spawn first

    const enemy = m.enemyManager.getAll()[0];
    m.enemyManager.kill(enemy);

    expect(m.waveManager.checkWaveComplete()).toBe(false);
  });

  it('should increment wave number with each wave', () => {
    const config = makeSingleTypeWaveConfig({
      count: 1,
      type: 'zombie',
      speed: 5,
      spawnDelay: 0,
    });

    m.waveManager.startWave(config);
    expect(m.waveManager.waveNumber()).toBe(1);
    tickEngine(m, 16, clock);

    for (const e of [...m.enemyManager.getAll()]) {
      m.enemyManager.kill(e);
    }
    m.waveManager.endWave();
    expect(m.waveManager.phase()).toBe('setup');

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

    const config = makeSingleTypeWaveConfig({
      count: 4,
      type: 'zombie',
      speed: 5,
      spawnDelay: 50,
      spawnMode: 'each',
    });

    const spawnedHandler = vi.fn();
    m.eventBus.on('enemy:spawned', spawnedHandler);

    m.waveManager.startWave(config);
    tickEngine(m, 300, clock);

    expect(spawnedHandler).toHaveBeenCalledTimes(4);
    expect(m.enemyManager.getAll()).toHaveLength(4);
  });

  it('should reset cleanly', () => {
    const config = makeSingleTypeWaveConfig({
      count: 3,
      type: 'zombie',
      speed: 5,
      spawnDelay: 100,
    });

    m.waveManager.startWave(config);
    tickEngine(m, 50, clock);

    m.waveManager.reset();

    expect(m.waveManager.phase()).toBe('setup');
    expect(m.waveManager.waveNumber()).toBe(0);
    expect(m.enemyManager.getAll()).toHaveLength(0);

    tickEngine(m, 1000, clock);
    expect(m.enemyManager.getAll()).toHaveLength(0);
  });

  it('spawn timing is identical at any timescale (engine sub-stepping)', () => {
    // Sub-stepping makes spawn delays purely game-time. Whether wall-clock
    // is 1× or 75× doesn't matter — tickSpawn drives off game-time deltas.
    const config = makeSingleTypeWaveConfig({
      count: 3,
      type: 'zombie',
      speed: 5,
      spawnDelay: 200,
    });

    m.waveManager.startWave(config);
    tickEngine(m, 16, clock);
    expect(m.enemyManager.getAll()).toHaveLength(1);
    tickEngine(m, 200, clock);
    expect(m.enemyManager.getAll()).toHaveLength(2);
    tickEngine(m, 200, clock);
    expect(m.enemyManager.getAll()).toHaveLength(3);
  });
});
