/**
 * Shared test helpers for integration tests.
 *
 * Provides mock factories for Three.js rendering layer (ThreeTilesEngine)
 * and Angular services that are not under test.
 */
import { vi } from 'vitest';
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
import type { ThreeTilesEngine } from '../three-engine';
import type { ResearchStore } from '../store/research.store';

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

// ─── Mock ThreeTilesEngine ────────────────────────────────────────

/** Creates a mock ThreeTilesEngine that stubs all rendering calls */
export function createMockTilesEngine() {
  return {
    getScene: vi.fn(() => ({})),
    getTerrainHeightAtGeo: vi.fn(() => 0),
    setTimescale: vi.fn(),
    sync: {
      getOrigin: vi.fn(() => ({ lat: 48.776, lon: 9.183, height: 300 })),
      geoToLocalSimple: vi.fn((_lat: number, _lon: number, _h: number) => ({
        x: 0,
        y: 0,
        z: 0,
      })),
      geoToLocal: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
      geoToLocalSimpleInto: vi.fn((_lat: number, _lon: number, _h: number, target: unknown) => target),
    },
    spatialAudio: {
      registerSound: vi.fn(),
      playAt: vi.fn(),
      geoToLocalPosition: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
      createLoop: vi.fn(() => Promise.resolve({ stop: vi.fn() })),
      playOneShot: vi.fn(() => Promise.resolve()),
      stopLoop: vi.fn(),
      updateLoopPosition: vi.fn(),
      pauseLoop: vi.fn(),
      resumeLoop: vi.fn(),
      holdLoops: vi.fn(),
      isWithinAudibleDistance: vi.fn(() => true),
      getListener: vi.fn(() => ({
        getWorldPosition: (target: { set: (x: number, y: number, z: number) => unknown }) => target.set(0, 0, 0),
      })),
    },
    trailStreaks: {
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
      pushPosition: vi.fn(),
    },
    towers: {
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
      select: vi.fn(),
      deselect: vi.fn(),
    },
    towerBadges: {
      setRank: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
    },
    searchlights: {
      add: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
    },
    tentacles: {
      create: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
      setVisible: vi.fn(),
      startStrike: vi.fn(),
      resetAllToIdle: vi.fn(),
      getStrikeTarget: vi.fn(() => null),
      captureStrike: vi.fn(() => null),
      restoreStrike: vi.fn(),
    },
    plinths: {
      create: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
      setVisible: vi.fn(),
    },
    enemies: {
      create: vi.fn(() => Promise.resolve({})),
      remove: vi.fn(),
      clear: vi.fn(),
      startWalkAnimation: vi.fn(),
      playDeathAnimation: vi.fn(),
      startRunAnimation: vi.fn(),
      resolveSlot: vi.fn(() => null),
      updateSlot: vi.fn(),
      setFreezeVisual: vi.fn(),
      setRenderType: vi.fn(),
      setIcedVisual: vi.fn(),
      setStunVisual: vi.fn(),
    },
    oozes: {
      add: vi.fn(),
      setFrame: vi.fn(),
      remove: vi.fn(),
      collapse: vi.fn(),
      discard: vi.fn(),
      clear: vi.fn(),
    },
    projectiles: {
      create: vi.fn(),
      update: vi.fn(),
      updateWithRotation: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
    },
    effects: {
      spawnFloatingText: vi.fn(),
      spawnTowerInnerFire: vi.fn(),
      stopTowerInnerFire: vi.fn(),
      stopAllTowerFires: vi.fn(),
      spawnIceExplosionAtGeo: vi.fn(),
      spawnIceDecal: vi.fn(),
      spawnConfigurableTrail: vi.fn(),
      spawnFrostAura: vi.fn(),
      updateFrostAuraPosition: vi.fn(),
      stopFrostAura: vi.fn(),
      hasFrostAura: vi.fn(() => false),
      spawnIceCrystals: vi.fn(),
      spawnBurstAtGeo: vi.fn(),
      updateIceCrystalsPosition: vi.fn(),
      stopIceCrystals: vi.fn(),
      spawnMuzzleFlash: vi.fn(),
      setScorchGround: vi.fn(),
      markScorch: vi.fn(),
      groundMarksEnabled: true,
      clear: vi.fn(),
    },
    orbitalBeams: { setGround: vi.fn(), fire: vi.fn(), clear: vi.fn() },
    triggerScreenShake: vi.fn(),
  };
}

export type MockTilesEngine = ReturnType<typeof createMockTilesEngine>;

/**
 * The engine an ability integration spec hands to GameStateManager.initialize:
 * a mock tiles engine with the members the sub-step loop reaches stubbed, plus
 * an auto-stubbed catch-all for anything else it touches.
 */
export function createAbilityTestEngine(): never {
  // The helper's engine is typed; the loop reaches a few members it does not declare
  const engine = createMockTilesEngine() as unknown as Record<string, Record<string, unknown>>;
  for (const key of ['effects', 'towers', 'enemies', 'projectiles', 'trailStreaks', 'spatialAudio', 'sync']) {
    engine[key] = withAutoStubs(engine[key]);
  }
  engine['enemies']['create'] = vi.fn(() => Promise.resolve(null));
  engine['hero'] = withAutoStubs({});
  // BackgroundMusicService resumes the audio context on wave:started
  engine['spatialAudio']['getListener'] = () => ({ context: { state: 'running', resume: () => Promise.resolve() } });
  // Headless, like a training tab: no presentFrame
  (engine as Record<string, unknown>)['renderingEnabled'] = false;
  return withAutoStubs(engine) as never;
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
    initDebugViz: vi.fn(),
    clear: vi.fn(),
  } as unknown as GlobalRouteGridService;
}

export function createMockResearchStore(): ResearchStore {
  return {
    airTargetingUnlocked: vi.fn(() => false),
  } as unknown as ResearchStore;
}

// ─── Factory: create wired-up managers ────────────────────────────

export interface TestManagers {
  eventBus: GameEventBus;
  enemyManager: EnemyManager;
  towerManager: TowerManager;
  projectileManager: ProjectileManager;
  waveManager: WaveManager;
  tilesEngine: MockTilesEngine;
  /** The same mock typed as the engine, for passing to initialize(). */
  engine: ThreeTilesEngine;
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

  const enemyManager = new EnemyManager(eventBus, globalRouteGrid, spatialGrid);
  const towerManager = new TowerManager(eventBus, createMockResearchStore());
  const projectileManager = new ProjectileManager(eventBus);
  const waveManager = new WaveManager(eventBus, enemyManager);

  const tilesEngine = createMockTilesEngine();
  const engine = tilesEngine as unknown as ThreeTilesEngine;

  // Initialize with mock engine
  enemyManager.initialize(engine);
  projectileManager.initialize(engine);

  return {
    eventBus,
    enemyManager,
    towerManager,
    projectileManager,
    waveManager,
    tilesEngine,
    engine,
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
