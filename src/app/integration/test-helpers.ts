/**
 * Shared test helpers for integration tests.
 *
 * Provides a spy for the simulation's renderer calls (SimSink), its frame
 * (SimCoords) and mocks of Angular services that are not under test.
 */
import { vi, type Mock } from 'vitest';
import { GeoPosition } from '../models/game.types';
import { GameEventBus } from '../game-engine/game-event-bus';
import { EnemyManager } from '../managers/enemy.manager';
import { TowerManager } from '../managers/tower.manager';
import { ProjectileManager } from '../managers/projectile.manager';
import { WaveManager, SpawnPoint, WaveConfig, SpawnEntry } from '../managers/wave.manager';
import { EnemyTypeId, ENEMY_TYPES } from '../configs/enemy-types.config';
import { GlobalRouteGridService } from '../services/world/global-route-grid.service';
import { SpatialGridService } from '../services/world/spatial-grid.service';
import { GameObject } from '../core/game-object';
import { Tower } from '../entities/tower.entity';
import { OriginSync, SimCoords, type SimSync } from '../sim/core/sim-coords';
import type { SimOps, SimSink } from '../sim/core/sim-sink';

// ─── vi.mock('@angular/core') helper ───────────────────────────────

/** Any property the test does not set is a vi.fn(). */
export function withAutoStubs<T extends object>(target: T): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (!(prop in obj)) Reflect.set(obj, prop, vi.fn());
      return Reflect.get(obj, prop, receiver);
    },
  });
}

// ─── Test Path Data ───────────────────────────────────────────────

/** Simple straight-line path for testing (≈111m long, ~1 second at 100 m/s) */
export const TEST_PATH: GeoPosition[] = [
  { lat: 48.7758, lon: 9.1829, height: 300 },
  { lat: 48.7759, lon: 9.1829, height: 300 },
  { lat: 48.7760, lon: 9.1829, height: 300 },
  { lat: 48.7761, lon: 9.1829, height: 300 },
  { lat: 48.7762, lon: 9.1829, height: 300 },
  { lat: 48.7763, lon: 9.1829, height: 300 },
  { lat: 48.7764, lon: 9.1829, height: 300 },
  { lat: 48.7765, lon: 9.1829, height: 300 },
  { lat: 48.7766, lon: 9.1829, height: 300 },
  { lat: 48.7767, lon: 9.1829, height: 300 },
  { lat: 48.7768, lon: 9.1829, height: 300 },
];

/** Tower position — close to path midpoint, within range of enemies */
export const TEST_TOWER_POSITION: GeoPosition = {
  lat: 48.7763,
  lon: 9.1830, // Slightly east of path (≈7m away)
  height: 300,
};

/**
 * Tower position right next to the spawn point (TEST_PATH[0]) — ≈7m away.
 * Keeps a freshly-spawned enemy in range of any tower regardless of
 * per-tower range tuning. Use this for findTarget tests; TEST_TOWER_POSITION
 * sits at the path midpoint (≈56m from the spawn).
 */
export const TEST_TOWER_NEAR_SPAWN: GeoPosition = {
  lat: 48.7758,
  lon: 9.1830, // ≈7m east of TEST_PATH[0]
  height: 300,
};

/** Spawn points for wave manager */
export const TEST_SPAWN_POINTS: SpawnPoint[] = [
  {
    id: 'spawn-1',
    name: 'Test Spawn 1',
    lat: 48.7758,
    lon: 9.1829,
    height: 300,
  },
];

/**
 * A Missile Silo in the tower manager's list, as a placed one stands: the
 * launch site of the nuclear strike (AbilityConfig.launchFrom). Added past
 * TowerLifecycle, so it takes no credits and needs no research.
 */
export function addMissileSilo(towerManager: Pick<TowerManager, 'add'>, at: GeoPosition = TEST_TOWER_POSITION): Tower {
  const silo = new Tower(at, 'missile-silo');
  towerManager.add(silo);
  return silo;
}

/** Cached paths mapping spawn → path */
export function createTestCachedPaths(): Map<string, GeoPosition[]> {
  const map = new Map<string, GeoPosition[]>();
  map.set('spawn-1', TEST_PATH);
  return map;
}

/**
 * Build a single-enemy-type WaveConfig from familiar legacy knobs.
 *
 * The WaveManager is now schedule-only — this helper synthesises a schedule
 * with one entry per enemy so integration tests keep reading naturally.
 */
export function makeSingleTypeWaveConfig(opts: {
  count: number;
  type: EnemyTypeId;
  speed?: number;
  health?: number;
  spawnDelay?: number;
  spawnMode?: 'each' | 'random';
}): WaveConfig {
  const baseSpeed = ENEMY_TYPES[opts.type]?.baseSpeed ?? 5;
  const speed = opts.speed ?? baseSpeed;
  const entries: SpawnEntry[] = [];
  for (let i = 0; i < opts.count; i++) {
    entries.push({ enemyType: opts.type, speed, health: opts.health });
  }
  return {
    schedule: {
      entries,
      baseDelay: opts.spawnDelay ?? 100,
      spawnMode: opts.spawnMode ?? 'each',
    },
  };
}

// ─── The simulation's sink and frame ──────────────────────────────

/** A SimSink whose every member is a vi.fn, by the engine member path (`sink.effects.spawnFloatingText`). */
export type SinkSpy = { readonly [K in keyof SimSink]: { readonly [M in keyof SimSink[K]]: Mock } };

/** A spy for the simulation's renderer calls: every member of every renderer a vi.fn on first use. */
export function createSinkSpy(): SinkSpy {
  const members = new Map<PropertyKey, object>();
  return new Proxy({}, {
    get(_obj, prop) {
      let member = members.get(prop);
      if (!member) {
        member = withAutoStubs({});
        members.set(prop, member);
      }
      return member;
    },
  }) as SinkSpy;
}

/** SimOps over a sink spy: the calls go to the spy, nothing is recorded. */
export function createTestOps(sink: SinkSpy = createSinkSpy()): SimOps {
  return {
    sink: sink as unknown as SimSink,
    setShowMuted: () => undefined,
    take: () => [],
    pending: 0,
  } as unknown as SimOps;
}

/** The frame of TEST_PATH: EllipsoidSync's simple frame around the old mock engine's origin */
export const TEST_ORIGIN = { lat: 48.776, lon: 9.183, height: 300 };

export function createTestCoords(sync: SimSync = new OriginSync(TEST_ORIGIN.lat, TEST_ORIGIN.lon, TEST_ORIGIN.height)): SimCoords {
  const coords = new SimCoords();
  coords.use(sync);
  return coords;
}

/**
 * Put the simulation's frame and a sink spy into the record a spec's
 * mocked `inject()` reads (by class name): what GameStateManager and the
 * combat services inject besides the services the spec provides.
 */
export function provideSimServices(
  services: Record<string, unknown>,
  options: { sync?: SimSync; sink?: SinkSpy } = {},
): { sink: SinkSpy; coords: SimCoords } {
  const sink = options.sink ?? createSinkSpy();
  const coords = createTestCoords(options.sync);
  services['SimCoords'] = coords;
  services['SimOps'] = createTestOps(sink);
  return { sink, coords };
}

// ─── Mock Angular Services ────────────────────────────────────────

/** Creates a mock GlobalRouteGridService */
export function createMockGlobalRouteGrid(): GlobalRouteGridService {
  return {
    isInitialized: vi.fn(() => false),
    updateEnemyPosition: vi.fn(),
    removeEnemy: vi.fn(),
    addBodyEnemy: vi.fn(),
    removeBodyEnemy: vi.fn(),
    getGroundLocalYAt: vi.fn(() => null),
    getEnemiesInRadiusGeo: vi.fn(() => []),
    getStats: vi.fn(() => ({ trackedEnemies: 0, occupiedCells: 0 })),
    clear: vi.fn(),
  } as unknown as GlobalRouteGridService;
}

// ─── Factory: create wired-up managers ────────────────────────────

export interface TestManagers {
  eventBus: GameEventBus;
  enemyManager: EnemyManager;
  towerManager: TowerManager;
  projectileManager: ProjectileManager;
  waveManager: WaveManager;
  /** The renderer calls the managers made */
  sink: SinkSpy;
  coords: SimCoords;
}

/**
 * Create a full set of real managers wired together with mocked rendering.
 * Resets GameObject IDs so tests are deterministic.
 */
export function createTestManagers(): TestManagers {
  GameObject.resetIdCounter();

  const eventBus = new GameEventBus();
  const globalRouteGrid = createMockGlobalRouteGrid();
  const spatialGrid = new SpatialGridService();

  const sink = createSinkSpy();
  const coords = createTestCoords();
  const simSink = sink as unknown as SimSink;
  const enemyManager = new EnemyManager(eventBus, globalRouteGrid, spatialGrid, coords, simSink);
  const towerManager = new TowerManager(eventBus, coords, simSink);
  const projectileManager = new ProjectileManager(eventBus, simSink);
  const waveManager = new WaveManager(eventBus, enemyManager);

  // The enemy debugger's cheats, run as GameCommandsHandler and
  // GameStateManager.debugKillAll & co. run them in the game
  eventBus.on('debug:kill-all', () => {
    waveManager.killAll();
    eventBus.emit({ type: 'wave:cleared' });
  });
  eventBus.on('debug:spawn-enemy', (event) => enemyManager.debugSpawn(event));
  eventBus.on('debug:remove-enemy', (event) => enemyManager.debugRemove(event.enemyId));

  return {
    eventBus,
    enemyManager,
    towerManager,
    projectileManager,
    waveManager,
    sink,
    coords,
  };
}

/**
 * Helper that ticks the engine sub-step loop by `gameTimeMs` of game-time,
 * driving wave-spawn + enemy-manager pending-deaths/starts. Replaces the
 * old `vi.advanceTimersByTime` pattern that relied on setTimeout chains.
 *
 * `clock` is a mutable cursor of accumulated game-time so callers can keep
 * updating without manually tracking it.
 */
export function tickEngine(
  m: TestManagers,
  gameTimeMs: number,
  clock: { now: number } = { now: 0 },
): { now: number } {
  const STEP = 16;
  let remaining = gameTimeMs;
  while (remaining > 0) {
    const step = Math.min(STEP, remaining);
    clock.now += step;
    m.waveManager.tickSpawn(step);
    if (m.enemyManager.getAll().length > 0) {
      m.enemyManager.update(step, clock.now);
    } else {
      // Still tick pending death/start delays on empty rosters
      m.enemyManager.update(step, clock.now);
    }
    remaining -= step;
  }
  return clock;
}
