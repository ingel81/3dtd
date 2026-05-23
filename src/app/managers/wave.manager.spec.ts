import { beforeEach, describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('three', async () => await import('@/test/mocks/three.mock'));

import { GameEventBus } from '../game-engine';
import { EnemyManager } from './enemy.manager';
import { WaveManager, WaveConfig, SpawnPoint, SpawnEntry } from './wave.manager';
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

/**
 * Helper to build a WaveConfig (schedule-only — no legacy single-type path).
 * Accepts familiar single-type knobs (count/type/speed/spawnDelay/spawnMode)
 * and synthesises a SpawnSchedule with one entry per enemy.
 */
function makeWaveConfig(opts?: {
  count?: number;
  type?: string;
  speed?: number;
  health?: number;
  spawnDelay?: number;
  spawnMode?: 'each' | 'random';
}): WaveConfig {
  const count = opts?.count ?? 3;
  const type = opts?.type ?? 'basic';
  const speed = opts?.speed ?? 5;
  const health = opts?.health;
  const entries: SpawnEntry[] = [];
  for (let i = 0; i < count; i++) {
    entries.push({ enemyType: type as never, speed, health });
  }
  return {
    schedule: {
      entries,
      baseDelay: opts?.spawnDelay ?? 100,
      spawnMode: opts?.spawnMode ?? 'each',
    },
  };
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
    // Clone the shared maps so destroy() in one test cannot mutate state for
    // the next test (destroy() calls cachedPaths.clear()).
    wm.initialize([...SPAWN_POINTS], new Map(CACHED_PATHS));
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
      wm.startWave(makeWaveConfig({ count: 5 }));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'wave:started',
          wave: 1,
          enemyCount: 5,
        })
      );
    });

    it('spawns first enemy on first tickSpawn', () => {
      wm.startWave(makeWaveConfig({ count: 2 }));
      wm.tickSpawn(0);
      expect(enemyManager.spawn).toHaveBeenCalledTimes(1);
    });

    it('spawns enemies with game-time delay between them', () => {
      wm.startWave(makeWaveConfig({ count: 3, spawnDelay: 200 }));

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
      wm.startWave(makeWaveConfig({ count: 3, spawnMode: 'each', spawnDelay: 50 }));

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

    it('does nothing for an empty schedule (no event, stays in setup)', () => {
      const handler = vi.fn();
      bus.on('wave:started', handler);
      wm.startWave({ schedule: { entries: [], baseDelay: 100 } });
      expect(handler).not.toHaveBeenCalled();
      expect(wm.phase()).toBe('setup');
      expect(wm.waveNumber()).toBe(0);
    });

    it('spawning is timescale-agnostic — advanced via game-time tickSpawn', () => {
      // Sub-stepping: the engine ticks game-time in fixed 16ms steps. Two
      // 100ms-each ticks together cover one 200ms spawn delay regardless
      // of training timescale.
      wm.startWave(makeWaveConfig({ count: 2, spawnDelay: 200 }));
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
      wm.startWave(makeWaveConfig({ count: 3, spawnDelay: 1000 }));
      // Only 1 spawned so far, 2 pending
      expect(wm.checkWaveComplete()).toBe(false);
    });

    it('returns true when all enemies spawned AND all dead', () => {
      wm.startWave(makeWaveConfig({ count: 1, spawnDelay: 50 }));
      wm.tickSpawn(0); // spawn the 1 enemy
      expect(wm.checkWaveComplete()).toBe(true);
    });

    it('returns false when all spawned but some alive', () => {
      (enemyManager.getAliveCount as ReturnType<typeof vi.fn>).mockReturnValue(2);
      wm.startWave(makeWaveConfig({ count: 1, spawnDelay: 50 }));
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
      wm.startWave(makeWaveConfig({ count: 10, spawnDelay: 100 }));
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
      wm.startWave(makeWaveConfig({ count: 5, spawnDelay: 100 }));
      wm.tickSpawn(0);
      expect(enemyManager.spawn).toHaveBeenCalledTimes(1);

      wm.stopSpawning();
      wm.tickSpawn(1000);
      expect(enemyManager.spawn).toHaveBeenCalledTimes(1);
    });

    it('adjusts expected count so wave can complete', () => {
      wm.startWave(makeWaveConfig({ count: 5, spawnDelay: 100 }));
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

      // Phase 5.16: debug kill-all passes awardCredits=false so the player
       // can't farm gold via the dev shortcut.
       expect(enemyManager.kill).toHaveBeenCalledWith(mockEnemy, false);
    });

    it('stops further spawning after kill-all', () => {
      (enemyManager.getAlive as ReturnType<typeof vi.fn>).mockReturnValue([]);

      wm.startWave(makeWaveConfig({ count: 5, spawnDelay: 100 }));
      wm.tickSpawn(0);
      const callsBefore = (enemyManager.spawn as ReturnType<typeof vi.fn>).mock.calls.length;

      bus.emit({ type: 'debug:kill-all' });

      wm.tickSpawn(1000);
      expect(enemyManager.spawn).toHaveBeenCalledTimes(callsBefore);
    });
  });

  describe('startWave() (mixed-schedule features)', () => {
    function scheduledConfig(
      entries: { enemyType: string; speed: number; health?: number; delay?: number; pauseAfter?: number }[],
      baseDelay = 100,
    ): WaveConfig {
      return {
        schedule: {
          entries: entries as never,
          baseDelay,
        },
      };
    }

    it('emits wave:started with the schedule entry count', () => {
      const handler = vi.fn();
      bus.on('wave:started', handler);
      wm.startWave(scheduledConfig([
        { enemyType: 'a', speed: 5 },
        { enemyType: 'b', speed: 6 },
        { enemyType: 'c', speed: 7 },
      ]));
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'wave:started', enemyCount: 3 }),
      );
    });

    it('does nothing for an empty schedule', () => {
      // wave-phase still flips? No — entries.length === 0 short-circuits.
      wm.startWave(scheduledConfig([], 100));
      expect(enemyManager.spawn).not.toHaveBeenCalled();
      // phase stays at setup since the early return is before phase.set
      expect(wm.phase()).toBe('setup');
    });

    it('spawns each entry with the configured enemy type, speed and health', () => {
      wm.startWave(scheduledConfig([
        { enemyType: 'a', speed: 5,  health: 100 },
        { enemyType: 'b', speed: 6,  health: 200 },
      ], 50));
      wm.tickSpawn(0);
      wm.tickSpawn(50);
      const calls = (enemyManager.spawn as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.length).toBe(2);
      // spawn signature: (path, enemyType, speed, false, health)
      expect(calls[0][1]).toBe('a');
      expect(calls[0][2]).toBe(5);
      expect(calls[0][4]).toBe(100);
      expect(calls[1][1]).toBe('b');
      expect(calls[1][2]).toBe(6);
      expect(calls[1][4]).toBe(200);
    });

    it('uses per-entry delay override as the gap before the NEXT spawn', () => {
      // First entry has delay=500 → 500ms gap before entry[1] spawns.
      wm.startWave(scheduledConfig([
        { enemyType: 'a', speed: 5, delay: 500 },
        { enemyType: 'b', speed: 6 },
      ], 100));
      wm.tickSpawn(0);            // entry[0] fires immediately
      expect(enemyManager.spawn).toHaveBeenCalledTimes(1);
      wm.tickSpawn(100);          // baseDelay alone is not enough
      expect(enemyManager.spawn).toHaveBeenCalledTimes(1);
      wm.tickSpawn(400);          // total 500 → entry[1] fires
      expect(enemyManager.spawn).toHaveBeenCalledTimes(2);
    });

    it('pauseAfter on an entry extends the gap to the next spawn', () => {
      // entry[0] pauseAfter=500 → next spawn fires at baseDelay (100) + 500 = 600ms
      wm.startWave(scheduledConfig([
        { enemyType: 'a', speed: 5, pauseAfter: 500 },
        { enemyType: 'b', speed: 6 },
      ], 100));
      wm.tickSpawn(0);            // entry[0]
      wm.tickSpawn(100);          // would normally fire entry[1] — but pauseAfter delays it
      expect(enemyManager.spawn).toHaveBeenCalledTimes(1);
      wm.tickSpawn(500);          // total 600 → entry[1] fires
      expect(enemyManager.spawn).toHaveBeenCalledTimes(2);
    });

    it('completes after spawning all schedule entries', () => {
      wm.startWave(scheduledConfig([
        { enemyType: 'a', speed: 5 },
        { enemyType: 'b', speed: 6 },
      ], 50));
      wm.tickSpawn(0);
      wm.tickSpawn(50);
      // Further ticks should be no-ops since the spawner is exhausted.
      const callsBefore = (enemyManager.spawn as ReturnType<typeof vi.fn>).mock.calls.length;
      wm.tickSpawn(1000);
      expect(enemyManager.spawn).toHaveBeenCalledTimes(callsBefore);
      // checkWaveComplete returns true once all spawned and getAliveCount === 0
      expect(wm.checkWaveComplete()).toBe(true);
    });

    it('routes schedule spawns through "random" spawn-point selection', () => {
      // We don't assert the specific point chosen — Math.random — only that
      // a valid SpawnPoint path was used. Cover both calls.
      wm.startWave(scheduledConfig([
        { enemyType: 'a', speed: 5 },
        { enemyType: 'b', speed: 6 },
      ], 50));
      wm.tickSpawn(0);
      wm.tickSpawn(50);
      const calls = (enemyManager.spawn as ReturnType<typeof vi.fn>).mock.calls;
      for (const call of calls) {
        const path = call[0];
        const isKnownPath = path === CACHED_PATHS.get('sp-1') || path === CACHED_PATHS.get('sp-2');
        expect(isKnownPath).toBe(true);
      }
    });
  });
});
