import { beforeEach, describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('three', async () => await import('@/test/mocks/three.mock'));

import { GameEventBus } from '../game-engine';
import { EnemyManager } from './enemy.manager';
import { WaveManager, WaveConfig, SpawnPoint } from './wave.manager';
import { GeoPosition } from '../models/game.types';

// Create a minimal mock for EnemyManager
function createMockEnemyManager(): EnemyManager {
  return {
    spawn: vi.fn(),
    getAll: vi.fn().mockReturnValue([]),
    getAlive: vi.fn().mockReturnValue([]),
    getAliveCount: vi.fn().mockReturnValue(0),
    getKillingCount: vi.fn().mockReturnValue(0),
    clear: vi.fn(),
    kill: vi.fn(),
  } as unknown as EnemyManager;
}

const SPAWN_POINTS: SpawnPoint[] = [
  { id: 'sp-1', name: 'North', lat: 48.78, lon: 9.18, height: 0 },
  { id: 'sp-2', name: 'South', lat: 48.77, lon: 9.19, height: 0 },
];

const CACHED_PATHS = new Map<string, GeoPosition[]>([
  ['sp-1', [
    { lat: 48.78, lon: 9.18 },
    { lat: 48.775, lon: 9.185 },
    { lat: 48.77, lon: 9.19 },
  ]],
  ['sp-2', [
    { lat: 48.77, lon: 9.19 },
    { lat: 48.775, lon: 9.185 },
    { lat: 48.78, lon: 9.18 },
  ]],
]);

function makeWaveConfig(overrides?: Partial<WaveConfig>): WaveConfig {
  return {
    enemyCount: 3,
    enemyType: 'basic',
    enemySpeed: 5,
    spawnMode: 'each',
    spawnDelay: 100,
    ...overrides,
  } as WaveConfig;
}

describe('WaveManager', () => {
  let bus: GameEventBus;
  let enemyManager: EnemyManager;
  let wm: WaveManager;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new GameEventBus();
    enemyManager = createMockEnemyManager();
    wm = new WaveManager(bus, enemyManager);
    wm.initialize(SPAWN_POINTS, CACHED_PATHS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('starts in setup phase', () => {
      expect(wm.phase()).toBe('setup');
    });

    it('starts at wave 0', () => {
      expect(wm.waveNumber()).toBe(0);
    });
  });

  describe('beginWave() (manual mode)', () => {
    it('sets phase to wave', () => {
      wm.beginWave();
      expect(wm.phase()).toBe('wave');
    });

    it('increments wave number', () => {
      wm.beginWave();
      expect(wm.waveNumber()).toBe(1);
      wm.endWave();
      wm.beginWave();
      expect(wm.waveNumber()).toBe(2);
    });

    it('emits wave:started event', () => {
      const handler = vi.fn();
      bus.on('wave:started', handler);
      wm.beginWave();

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'wave:started',
          wave: 1,
          enemyCount: 0, // manual mode
        })
      );
    });
  });

  describe('startWave() (auto-spawn mode)', () => {
    it('sets phase to wave', () => {
      wm.startWave(makeWaveConfig());
      expect(wm.phase()).toBe('wave');
    });

    it('increments wave number', () => {
      wm.startWave(makeWaveConfig());
      expect(wm.waveNumber()).toBe(1);
    });

    it('emits wave:started with correct enemy count', () => {
      const handler = vi.fn();
      bus.on('wave:started', handler);
      wm.startWave(makeWaveConfig({ enemyCount: 5 }));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'wave:started',
          wave: 1,
          enemyCount: 5,
        })
      );
    });

    it('spawns first enemy on first tickSpawn', () => {
      wm.startWave(makeWaveConfig({ enemyCount: 2 }));
      wm.tickSpawn(0);
      expect(enemyManager.spawn).toHaveBeenCalledTimes(1);
    });

    it('spawns enemies with game-time delay between them', () => {
      wm.startWave(makeWaveConfig({ enemyCount: 3, spawnDelay: 200 }));

      wm.tickSpawn(0);
      expect(enemyManager.spawn).toHaveBeenCalledTimes(1);

      wm.tickSpawn(200);
      expect(enemyManager.spawn).toHaveBeenCalledTimes(2);

      wm.tickSpawn(200);
      expect(enemyManager.spawn).toHaveBeenCalledTimes(3);

      // No more spawning after all enemies
      wm.tickSpawn(200);
      expect(enemyManager.spawn).toHaveBeenCalledTimes(3);
    });

    it('uses "each" spawn mode (round-robin)', () => {
      wm.startWave(makeWaveConfig({ enemyCount: 3, spawnMode: 'each', spawnDelay: 50 }));

      wm.tickSpawn(0);
      expect(enemyManager.spawn).toHaveBeenCalledWith(
        CACHED_PATHS.get('sp-1'),
        expect.anything(),
        expect.anything(),
        false,
        undefined,
      );

      wm.tickSpawn(50);
      expect(enemyManager.spawn).toHaveBeenCalledWith(
        CACHED_PATHS.get('sp-2'),
        expect.anything(),
        expect.anything(),
        false,
        undefined,
      );
    });

    it('handles invalid enemyCount gracefully (falls back to 10)', () => {
      const handler = vi.fn();
      bus.on('wave:started', handler);
      wm.startWave(makeWaveConfig({ enemyCount: NaN }));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          enemyCount: 10,
        })
      );
    });

    it('handles negative enemyCount gracefully', () => {
      const handler = vi.fn();
      bus.on('wave:started', handler);
      wm.startWave(makeWaveConfig({ enemyCount: -5 }));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          enemyCount: 10,
        })
      );
    });

    it('spawning is timescale-agnostic — advanced via game-time tickSpawn', () => {
      // Sub-stepping: the engine ticks game-time in fixed 16ms steps. Two
      // 100ms-each ticks together cover one 200ms spawn delay regardless
      // of training timescale.
      wm.startWave(makeWaveConfig({ enemyCount: 2, spawnDelay: 200 }));
      wm.tickSpawn(0);
      expect(enemyManager.spawn).toHaveBeenCalledTimes(1);
      wm.tickSpawn(100);
      expect(enemyManager.spawn).toHaveBeenCalledTimes(1);
      wm.tickSpawn(100);
      expect(enemyManager.spawn).toHaveBeenCalledTimes(2);
    });
  });

  describe('checkWaveComplete()', () => {
    it('returns false when not in wave phase', () => {
      expect(wm.checkWaveComplete()).toBe(false);
    });

    it('returns false during spawning (not all enemies spawned)', () => {
      wm.startWave(makeWaveConfig({ enemyCount: 3, spawnDelay: 1000 }));
      // Only 1 spawned so far, 2 pending
      expect(wm.checkWaveComplete()).toBe(false);
    });

    it('returns true when all enemies spawned AND all dead', () => {
      wm.startWave(makeWaveConfig({ enemyCount: 1, spawnDelay: 50 }));
      wm.tickSpawn(0); // spawn the 1 enemy
      expect(wm.checkWaveComplete()).toBe(true);
    });

    it('returns false when all spawned but some alive', () => {
      (enemyManager.getAliveCount as ReturnType<typeof vi.fn>).mockReturnValue(2);
      wm.startWave(makeWaveConfig({ enemyCount: 1, spawnDelay: 50 }));
      wm.tickSpawn(0);
      expect(wm.checkWaveComplete()).toBe(false);
    });
  });

  describe('endWave()', () => {
    it('sets phase back to setup', () => {
      wm.startWave(makeWaveConfig());
      wm.endWave();
      expect(wm.phase()).toBe('setup');
    });

    it('clears enemies', () => {
      wm.startWave(makeWaveConfig());
      wm.endWave();
      expect(enemyManager.clear).toHaveBeenCalled();
    });

    it('emits wave:completed (deferred)', () => {
      const handler = vi.fn();
      bus.on('wave:completed', handler);

      wm.startWave(makeWaveConfig());
      wm.endWave();

      // Deferred - not called yet
      expect(handler).not.toHaveBeenCalled();

      // Process queue
      bus.processQueue();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'wave:completed',
          wave: 1,
        })
      );
    });
  });

  describe('reset()', () => {
    it('resets phase to setup', () => {
      wm.startWave(makeWaveConfig());
      wm.reset();
      expect(wm.phase()).toBe('setup');
    });

    it('resets wave number to 0', () => {
      wm.startWave(makeWaveConfig());
      wm.reset();
      expect(wm.waveNumber()).toBe(0);
    });

    it('clears enemies on reset', () => {
      wm.startWave(makeWaveConfig());
      wm.reset();
      expect(enemyManager.clear).toHaveBeenCalled();
    });

    it('stops pending spawns on reset', () => {
      wm.startWave(makeWaveConfig({ enemyCount: 10, spawnDelay: 100 }));
      wm.tickSpawn(0);
      const spawnCountBefore = (enemyManager.spawn as ReturnType<typeof vi.fn>).mock.calls.length;

      wm.reset();
      // Subsequent tickSpawn() calls should be no-ops after reset
      wm.tickSpawn(2000);
      expect(enemyManager.spawn).toHaveBeenCalledTimes(spawnCountBefore);
    });
  });

  describe('stopSpawning()', () => {
    it('prevents further spawns', () => {
      wm.startWave(makeWaveConfig({ enemyCount: 5, spawnDelay: 100 }));
      wm.tickSpawn(0);
      expect(enemyManager.spawn).toHaveBeenCalledTimes(1);

      wm.stopSpawning();
      wm.tickSpawn(1000);
      expect(enemyManager.spawn).toHaveBeenCalledTimes(1);
    });

    it('adjusts expected count so wave can complete', () => {
      wm.startWave(makeWaveConfig({ enemyCount: 5, spawnDelay: 100 }));
      wm.stopSpawning();

      // Now checkWaveComplete should reflect adjusted counts
      // All spawned enemies are "dead" (mock returns 0)
      expect(wm.checkWaveComplete()).toBe(true);
    });
  });

  describe('destroy()', () => {
    it('clears spawn points and cached paths', () => {
      wm.startWave(makeWaveConfig());
      wm.destroy();

      expect(wm.spawnPoints).toEqual([]);
      expect(wm.phase()).toBe('setup');
    });
  });

  describe('debug:kill-all event', () => {
    it('kills all alive enemies', () => {
      const mockEnemy = { alive: true } as never;
      (enemyManager.getAlive as ReturnType<typeof vi.fn>).mockReturnValue([mockEnemy]);

      wm.beginWave();

      bus.emit({ type: 'debug:kill-all' });

      expect(enemyManager.kill).toHaveBeenCalledWith(mockEnemy);
    });

    it('stops further spawning after kill-all', () => {
      (enemyManager.getAlive as ReturnType<typeof vi.fn>).mockReturnValue([]);

      wm.startWave(makeWaveConfig({ enemyCount: 5, spawnDelay: 100 }));
      wm.tickSpawn(0);
      const callsBefore = (enemyManager.spawn as ReturnType<typeof vi.fn>).mock.calls.length;

      bus.emit({ type: 'debug:kill-all' });

      wm.tickSpawn(1000);
      expect(enemyManager.spawn).toHaveBeenCalledTimes(callsBefore);
    });
  });
});
