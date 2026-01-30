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
import { WaveManager, SpawnPoint } from '../managers/wave.manager';
import { EntityPoolService } from '../services/entity-pool.service';
import { OsmStreetService } from '../services/osm-street.service';
import { GlobalRouteGridService } from '../services/global-route-grid.service';
import { SpatialGridService } from '../services/spatial-grid.service';
import { GameObject } from '../core/game-object';

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

/** Base position (near the end of path) */
export const TEST_BASE_POSITION: GeoPosition = {
  lat: 48.7768,
  lon: 9.1829,
  height: 300,
};

/** Tower position — close to path midpoint, within range of enemies */
export const TEST_TOWER_POSITION: GeoPosition = {
  lat: 48.7763,
  lon: 9.1830, // Slightly east of path (≈7m away)
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

// ─── Mock ThreeTilesEngine ────────────────────────────────────────

/** Creates a mock ThreeTilesEngine that stubs all rendering calls */
export function createMockTilesEngine(): any {
  return {
    getScene: vi.fn(() => ({})),
    getTerrainHeightAtGeo: vi.fn(() => 0),
    getTerrainHeightAtLocal: vi.fn(() => 0),
    setTimescale: vi.fn(),
    sync: {
      getOrigin: vi.fn(() => ({ lat: 48.776, lon: 9.183, height: 300 })),
      geoToLocalSimple: vi.fn((_lat: number, _lon: number, _h: number) => ({
        x: 0,
        y: 0,
        z: 0,
      })),
    },
    spatialAudio: {
      registerSound: vi.fn(),
      playAt: vi.fn(),
      geoToLocalPosition: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
    },
    trailStreaks: {
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
    },
    towers: {
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
      select: vi.fn(),
      deselect: vi.fn(),
    },
    enemies: {
      create: vi.fn(() => Promise.resolve({})),
      update: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
      startWalkAnimation: vi.fn(),
      playDeathAnimation: vi.fn(),
      getSpeedMultiplier: vi.fn(() => 1.0),
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
      spawnConfigurableTrailAtGeo: vi.fn(),
      clear: vi.fn(),
    },
  };
}

// ─── Mock Angular Services ────────────────────────────────────────

/** Creates a mock OsmStreetService */
export function createMockOsmService(): OsmStreetService {
  return {
    findNearestStreetPoint: vi.fn(() => ({ distance: 20, lat: 0, lon: 0 })),
  } as any;
}

/** Creates a mock GlobalRouteGridService */
export function createMockGlobalRouteGrid(): GlobalRouteGridService {
  return {
    isInitialized: vi.fn(() => false),
    updateEnemyPosition: vi.fn(),
    removeEnemy: vi.fn(),
    getEnemiesInRadiusGeo: vi.fn(() => []),
    getStats: vi.fn(() => ({ trackedEnemies: 0, occupiedCells: 0 })),
    initDebugViz: vi.fn(),
    clear: vi.fn(),
  } as any;
}

// ─── Factory: create wired-up managers ────────────────────────────

export interface TestManagers {
  eventBus: GameEventBus;
  enemyManager: EnemyManager;
  towerManager: TowerManager;
  projectileManager: ProjectileManager;
  waveManager: WaveManager;
  tilesEngine: any;
}

/**
 * Create a full set of real managers wired together with mocked rendering.
 * Resets GameObject IDs so tests are deterministic.
 */
export function createTestManagers(): TestManagers {
  GameObject.resetIdCounter();

  const eventBus = new GameEventBus();
  const entityPool = new EntityPoolService();
  const osmService = createMockOsmService();
  const globalRouteGrid = createMockGlobalRouteGrid();
  const spatialGrid = new SpatialGridService();

  const enemyManager = new EnemyManager(eventBus, entityPool, globalRouteGrid, spatialGrid);
  const towerManager = new TowerManager(eventBus, osmService);
  const projectileManager = new ProjectileManager(eventBus, entityPool);
  const waveManager = new WaveManager(eventBus, enemyManager);

  const tilesEngine = createMockTilesEngine();

  // Initialize with mock engine
  enemyManager.initialize(tilesEngine);
  projectileManager.initialize(tilesEngine);

  return {
    eventBus,
    enemyManager,
    towerManager,
    projectileManager,
    waveManager,
    tilesEngine,
  };
}
