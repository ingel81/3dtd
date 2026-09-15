/**
 * Playtest 2026-09-15: towers stood, their turrets did not turn, and
 * `__towerTargets()` said "no target, asleep". Between waves the console
 * showed `[Corridor] rebuild` with the towers standing, after the camera had
 * moved (G to the hero). The corridor lock (CorridorRefit.rebuildBlocker)
 * read GameStateManager.towerCount, a computed over a plain array that kept
 * its first value, 0 from the location load; so it let the rebuild through,
 * and the towers' visibleCells were left in the grid it replaced.
 *
 * Real: GameStateManager (towerCount, placeTower, sellTower, beginWave and the
 * sub-step loop), GlobalRouteGridService (cells from the route, enemies in
 * their cells), SpatialGridService, TowerCombatService, CombatEffectService,
 * DamageApplicationService, CorridorController with its CorridorRefit, and
 * RouteGridConvergence, whose settled tile batch calls remeasure. Fake: the
 * route service (stations waiting for finer tiles; a measurement that finds
 * the free space `tiles.halfWidth` shows, the route built with it), the GPU
 * line of sight (every cell in range visible, as TowerLosRegistry.register
 * writes it for a clear view), the renderer and the animation frames.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('three', async () => await import('@/test/mocks/three.mock'));

const mockServices: Record<string, unknown> = {};
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
    effect: vi.fn(),
    inject: (token: { name?: string }) => {
      const name = token?.name ?? 'unknown';
      if (!mockServices[name]) mockServices[name] = withAutoStubs({});
      return mockServices[name];
    },
  };
});

import { Vector3 } from 'three';
import { createMockTilesEngine, withAutoStubs, TEST_PATH, TEST_SPAWN_POINTS } from './test-helpers';
import { GameStateManager } from '../managers/game-state.manager';
import { CombatEffectService } from '../services/combat/combat-effect.service';
import { DamageApplicationService } from '../services/combat/damage-application.service';
import { TowerCombatService } from '../services/combat/tower-combat.service';
import { GlobalRouteGridService } from '../services/world/global-route-grid.service';
import { SpatialGridService } from '../services/world/spatial-grid.service';
import { CorridorController, type CorridorControllerDeps } from '../services/world/corridor-controller';
import { RouteGridConvergence, type RouteGridConvergenceDeps } from '../services/world/route-grid-convergence';
import { CorridorRefit } from '../services/world/corridor-refit';
import { GameObject } from '../core/game-object';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from '../utils/geo-utils';
import type { Tower } from '../entities/tower.entity';
import type { CorridorMeasurement } from '../services/world/corridor-refit';
import type { GeoPosition, RouteWaypoint } from '../models/game.types';

/** The origin of the helper's engine */
const ORIGIN = { lat: 48.776, lon: 9.183, height: 300 };
const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(ORIGIN.lat * DEG_TO_RAD);
/** Geo to local on a flat frame around the origin, as the engine's sync near it */
const flatSync = {
  getOrigin: () => ({ ...ORIGIN }),
  geoToLocalSimple: (lat: number, lon: number, height: number) =>
    new Vector3((lon - ORIGIN.lon) * M_PER_DEG_LON, height - ORIGIN.height, -(lat - ORIGIN.lat) * METERS_PER_DEGREE_LAT),
  geoToLocalSimpleInto: (lat: number, lon: number, height: number, target: Vector3): Vector3 =>
    target.set((lon - ORIGIN.lon) * M_PER_DEG_LON, height - ORIGIN.height, -(lat - ORIGIN.lat) * METERS_PER_DEGREE_LAT),
};

/** HQ at the north end of the 111 m test path */
const BASE: GeoPosition = TEST_PATH[TEST_PATH.length - 1];
/** An Archer some 7 m east of the middle of the route */
const TOWER_AT: GeoPosition = { lat: 48.7763, lon: 9.183, height: ORIGIN.height };
/** Speeds of one wave's zombies, all spawned at its start */
const WAVE = [2.5, 3, 3.5, 4, 2.5, 3];
/** Longest a wave may take, frames of 16 ms */
const WAVE_FRAMES = 90_000 / 16;

function createEngine(): never {
  const engine = createMockTilesEngine() as unknown as Record<string, Record<string, unknown>>;
  for (const key of ['effects', 'towers', 'enemies', 'projectiles', 'trailStreaks', 'spatialAudio', 'oozes']) {
    engine[key] = withAutoStubs(engine[key]);
  }
  engine['sync'] = withAutoStubs({ ...engine['sync'], ...flatSync });
  // Flat ground at the origin on fine tiles, for the cells a (re)build samples
  engine['terrain'] = withAutoStubs({
    sampleColumn: () => ({ groundY: 0, topY: 0, tileDepth: 20, tileGeometricError: 1 }),
    peekBestTileLODAtLocal: () => ({ depth: 20, geometricError: 1 }),
  });
  engine['enemies']['create'] = vi.fn(() => Promise.resolve(null));
  // Turrets on target at once; no model data; the CPU line of sight clear
  engine['towers']['isTurretAligned'] = () => true;
  engine['towers']['hasLineOfSight'] = () => true;
  engine['towers']['get'] = () => undefined;
  engine['hero'] = withAutoStubs({});
  engine['flameBeams'] = withAutoStubs({});
  engine['tentacles'] = withAutoStubs({});
  engine['bloodMoon'] = withAutoStubs({});
  engine['spatialAudio']['playAtGeo'] = () => Promise.resolve();
  engine['spatialAudio']['getListener'] = () => ({
    context: { state: 'running', resume: () => Promise.resolve() },
    getWorldPosition: (target: Vector3) => target.set(0, 0, 0),
  });
  (engine as Record<string, unknown>)['renderingEnabled'] = false;
  return withAutoStubs(engine) as never;
}

describe('The corridor lock with a tower standing, playtest 2026-09-15', () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let warn: ReturnType<typeof vi.spyOn>;
  /** What the tiles show on each side of the route (m); a push of finer tiles changes it */
  let tiles: { halfWidth: number };
  let gsm: GameStateManager;
  let grid: GlobalRouteGridService;
  let controller: CorridorController;
  let convergence: RouteGridConvergence;
  let measurements: ReturnType<typeof vi.fn>;
  let towerShots: Map<string, number>;
  let now: number;

  const runFrames = () => {
    for (let i = 0; i < 1000 && frames.size > 0; i++) {
      const due = [...frames.values()];
      frames.clear();
      for (const callback of due) callback(0);
    }
  };
  const rebuilds = (): number => warn.mock.calls.filter((call: unknown[]) => String(call[0]).startsWith('[Corridor] rebuild')).length;

  /** A tile batch loads and settles, as VisualizationFacadeService.onTilesLoaded drives it. */
  const tileBatch = () => {
    grid.beginTerrainHeightRefresh();
    convergence.schedule();
    runFrames();
  };

  /** Cells of `tower` that are no longer the live grid's cell at their place. */
  const orphaned = (tower: Tower) => tower.visibleCells.filter((cell) => grid.getCellAt(cell.x, cell.z) !== cell);

  const frame = () => {
    now += 16;
    gsm.update(now);
  };

  /** Build an Archer and give it the answers TowerLosRegistry.register writes for a clear view. */
  const buildArcher = (): Tower => {
    const tower = gsm.placeTower(TOWER_AT, 'archer')!;
    expect(tower).not.toBeNull();
    const local = flatSync.geoToLocalSimple(TOWER_AT.lat, TOWER_AT.lon, TOWER_AT.height ?? 0);
    const cells = grid.getCellsInRange(local.x, local.z, tower.combat.range);
    for (const cell of cells) cell.towerVisibility.set(tower.id, true);
    tower.visibleCells = cells;
    tower.losReady = true;
    return tower;
  };

  /** One wave of zombies along the route, run until the loop ends it; the tower's shots in it. */
  const runWave = (tower: Tower): number => {
    towerShots.clear();
    gsm.beginWave();
    for (const speed of WAVE) gsm.enemyManager.spawn(TEST_PATH, 'zombie', speed);
    for (let i = 0; i < WAVE_FRAMES && gsm.waveManager.phase() === 'wave'; i++) frame();
    expect(gsm.waveManager.phase()).toBe('setup');
    return towerShots.get(tower.id) ?? 0;
  };

  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // centre line
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    frames = new Map();
    nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));

    for (const key of Object.keys(mockServices)) delete mockServices[key];
    GameObject.resetIdCounter();

    // The route as the street width gives it until the first measurement
    tiles = { halfWidth: 4 };
    let halfWidth = 3;
    const route = (): RouteWaypoint[] => TEST_PATH.map((p) => ({ ...p, corridorLeft: halfWidth, corridorRight: halfWidth }));
    const paths = new Map<string, RouteWaypoint[]>([['spawn-1', route()]]);
    // One run measures every waiting station in its first slice; stations stay waiting for finer tiles
    measurements = vi.fn((): CorridorMeasurement => {
      let open = true;
      return {
        get open() { return open; },
        step: () => true,
        commit: () => {
          if (!open) return false;
          open = false;
          const changed = tiles.halfWidth !== halfWidth;
          halfWidth = tiles.halfWidth;
          return changed;
        },
        cancel: () => { open = false; },
      };
    });
    const pathRoute = withAutoStubs({
      getCachedPaths: () => paths,
      beginClearanceMeasurement: measurements,
      hasUnmeasuredStations: () => true,
      hasUnwalkableCells: () => false,
      narrowToWalkable: () => false,
      refreshRouteLines: () => { paths.set('spawn-1', route()); },
    });

    grid = new GlobalRouteGridService();
    mockServices['GlobalRouteGridService'] = grid;
    mockServices['SpatialGridService'] = new SpatialGridService();
    mockServices['ResearchStore'] = withAutoStubs({ airTargetingUnlocked: () => false, isTowerUnlocked: () => true });
    mockServices['PathAndRouteService'] = pathRoute;
    mockServices['EnemyDebugService'] = withAutoStubs({ debugEnemies: () => [] });
    mockServices['EconomyService'] = withAutoStubs({ computeWaveCompletionBonus: () => 0 });
    mockServices['DamageApplicationService'] = new DamageApplicationService();
    mockServices['CombatEffectService'] = new CombatEffectService();
    mockServices['TowerCombatService'] = new TowerCombatService();

    gsm = new GameStateManager();
    gsm.initialize(createEngine(), BASE, TEST_SPAWN_POINTS, paths);
    gsm.initializeGlobalRouteGrid();

    controller = new CorridorController({
      gameState: () => gsm,
      engineInit: { getEngine: () => ({}) },
      introFlight: { isRunning: () => false },
      pathRoute,
      routeAnimation: { isRunning: () => false, startAnimation: vi.fn() },
      store: { spawnPoints: () => TEST_SPAWN_POINTS },
      relocationStatus: { status: () => null },
    } as unknown as CorridorControllerDeps);
    controller.attach();
    convergence = new RouteGridConvergence({
      grid: () => gsm.getGlobalRouteGrid(),
      store: { spawnPoints: () => TEST_SPAWN_POINTS },
      pathRoute,
      markerViz: { updateMarkerHeights: vi.fn() },
      routeAnimation: { isRunning: () => false, startAnimation: vi.fn() },
      settled: () => controller.remeasure(),
    } as unknown as RouteGridConvergenceDeps);

    towerShots = new Map();
    const spawn = gsm.projectileManager.spawn.bind(gsm.projectileManager);
    vi.spyOn(gsm.projectileManager, 'spawn').mockImplementation((...args: Parameters<typeof spawn>) => {
      const id = args[0].id;
      towerShots.set(id, (towerShots.get(id) ?? 0) + 1);
      return spawn(...args);
    });
    now = 1000;

    // The location loads: the first fit, no tower yet (the lock reads the tower count here first)
    controller.fitToTiles();
    expect(rebuilds()).toBe(1);
  });

  afterEach(() => {
    controller.dispose();
    convergence.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a tile batch between waves rebuilds nothing under the tower, and the tower keeps firing', () => {
    const tower = buildArcher();
    expect(runWave(tower)).toBeGreaterThan(0);

    // The camera flies off and back (G to the hero): finer tiles show more room beside the route
    tiles.halfWidth = 5;
    tileBatch();

    expect(measurements).toHaveBeenCalledTimes(1);
    expect(rebuilds()).toBe(1);
    expect(orphaned(tower)).toEqual([]);
    expect(runWave(tower)).toBeGreaterThan(0);
  });

  it('drops a remeasure the tower blocks; the next tile batch after the tower is sold rebuilds', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const tower = buildArcher();
    tiles.halfWidth = 5;
    tileBatch();
    expect(measurements).toHaveBeenCalledTimes(1);

    // No retry of its own: neither the interval nor the sale brings it back
    vi.advanceTimersByTime(CorridorRefit.REMEASURE_INTERVAL_MS * 3);
    gsm.sellTower(tower);
    expect(gsm.towerCount()).toBe(0);
    vi.advanceTimersByTime(CorridorRefit.REMEASURE_INTERVAL_MS * 3);
    runFrames();
    expect(measurements).toHaveBeenCalledTimes(1);
    expect(rebuilds()).toBe(1);

    // The next settled batch measures the waiting stations and rebuilds with what they show
    tileBatch();
    expect(measurements).toHaveBeenCalledTimes(2);
    expect(rebuilds()).toBe(2);
  });
});
