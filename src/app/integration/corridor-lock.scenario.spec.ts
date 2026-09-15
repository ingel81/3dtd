/**
 * Playtest 2026-09-15: towers stood, their turrets did not turn, and
 * `__towerTargets()` said "no target, asleep". Between waves the console
 * showed `[Corridor] rebuild` with the towers standing, after the camera had
 * moved (G to the hero): a tile batch let the corridor be measured and
 * rebuilt under them, and the towers' visibleCells were left in the grid it
 * replaced. Since 2026-09-16 the corridor is built once per route set
 * (CorridorBuild) and no tile batch measures or rebuilds it; towers wait for
 * that build (GameStateManager.corridorPending).
 *
 * Real: GameStateManager (towerCount, placeTower, sellTower, beginWave and the
 * sub-step loop), GlobalRouteGridService (cells from the route, enemies in
 * their cells), SpatialGridService, TowerCombatService, CombatEffectService,
 * DamageApplicationService, CorridorBuild, and RouteGridConvergence for the
 * tile batches. Fake: the route service (a measurement that finds the free
 * space `tiles.halfWidth` shows, the route built with it), the GPU line of
 * sight (every cell in range visible, as TowerLosRegistry.register writes it
 * for a clear view), the renderer, the tiles and the animation frames.
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
import { CorridorBuild, type CorridorBuildDeps, type CorridorMeasurement } from '../services/world/corridor-build';
import { RouteGridConvergence, type RouteGridConvergenceDeps } from '../services/world/route-grid-convergence';
import { GameObject } from '../core/game-object';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from '../utils/geo-utils';
import type { Tower } from '../entities/tower.entity';
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
  /** Plain console lines: `[Corridor] build` is one. */
  let log: ReturnType<typeof vi.spyOn>;
  /** What the tiles show on each side of the route (m); a push of finer tiles changes it */
  let tiles: { halfWidth: number };
  /** Slices the next measurement takes, one per frame the build waits for */
  let slices: number;
  /** Frames the build waits for, resolved by buildFrame() */
  let buildFrames: (() => void)[];
  let gsm: GameStateManager;
  let grid: GlobalRouteGridService;
  let corridor: CorridorBuild;
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
  const builds = (): number => log.mock.calls.filter((call: unknown[]) => String(call[0]).startsWith('[Corridor] build:')).length;
  /** One frame of the corridor build and the promise chains it resolves. */
  const buildFrame = async () => {
    buildFrames.shift()?.();
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

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

  beforeEach(async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // centre line
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
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
    slices = 1;
    buildFrames = [];
    let halfWidth = 3;
    const route = (): RouteWaypoint[] => TEST_PATH.map((p) => ({ ...p, corridorLeft: halfWidth, corridorRight: halfWidth }));
    const paths = new Map<string, RouteWaypoint[]>([['spawn-1', route()]]);
    // A run measures every station in `slices` slices and finds what the tiles show
    measurements = vi.fn((): CorridorMeasurement => {
      let open = true;
      let left = slices;
      return {
        get open() { return open; },
        get progress() { return { done: slices - left, total: slices }; },
        step: () => --left <= 0,
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
      routesEpoch: () => 1,
      beginClearanceMeasurement: measurements,
      unmeasuredStations: () => 0,
      walkState: () => '',
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

    corridor = new CorridorBuild({
      gameState: () => gsm,
      // No 3D tiles to load: the build measures on what the fake route service finds
      engineInit: { getEngine: () => ({ tilesLodDebug: () => null, terrain: { clearHeightCache: () => undefined } }) },
      pathRoute,
      routeAnimation: { isRunning: () => false, startAnimation: vi.fn() },
      store: { spawnPoints: () => TEST_SPAWN_POINTS },
      nextFrame: () => new Promise<void>((resolve) => buildFrames.push(resolve)),
    } as unknown as CorridorBuildDeps);
    // As VisualizationFacadeService.initialize wires it
    gsm.setCorridorPending(() => corridor.pending());
    convergence = new RouteGridConvergence({
      grid: () => gsm.getGlobalRouteGrid(),
      store: { spawnPoints: () => TEST_SPAWN_POINTS },
      pathRoute,
      markerViz: { updateMarkerHeights: vi.fn() },
      routeAnimation: { isRunning: () => false, startAnimation: vi.fn() },
    } as unknown as RouteGridConvergenceDeps);

    towerShots = new Map();
    const spawn = gsm.projectileManager.spawn.bind(gsm.projectileManager);
    vi.spyOn(gsm.projectileManager, 'spawn').mockImplementation((...args: Parameters<typeof spawn>) => {
      const id = args[0].id;
      towerShots.set(id, (towerShots.get(id) ?? 0) + 1);
      return spawn(...args);
    });
    now = 1000;

    // The location loads: the corridor is built once, no tower yet
    await corridor.build('location load');
    expect(builds()).toBe(1);
  });

  afterEach(() => {
    corridor.dispose();
    convergence.dispose();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a tile batch between waves measures and rebuilds nothing under the tower, and the tower keeps firing', () => {
    const tower = buildArcher();
    expect(runWave(tower)).toBeGreaterThan(0);

    // The camera flies off and back (G to the hero): finer tiles show more room beside the route
    tiles.halfWidth = 5;
    tileBatch();

    expect(measurements).toHaveBeenCalledTimes(1);
    expect(builds()).toBe(1);
    expect(orphaned(tower)).toEqual([]);
    expect(runWave(tower)).toBeGreaterThan(0);
  });

  it('nothing measures or rebuilds after the tower is sold either: the corridor stays until the next build', () => {
    const tower = buildArcher();
    tiles.halfWidth = 5;
    tileBatch();
    gsm.sellTower(tower);
    expect(gsm.towerCount()).toBe(0);

    tileBatch();
    runFrames();
    expect(measurements).toHaveBeenCalledTimes(1);
    expect(builds()).toBe(1);
  });

  it('a tower and a wave wait for the corridor build, then stand on its cells', async () => {
    slices = 3;
    tiles.halfWidth = 5;
    const building = corridor.build('spawn moved in place');
    await buildFrame();

    expect(corridor.pending()).toBe(true);
    expect(gsm.placeTower(TOWER_AT, 'archer')).toBeNull();
    gsm.beginWave();
    expect(gsm.waveManager.phase()).toBe('setup');

    while (corridor.pending()) await buildFrame();
    expect(await building).not.toBeNull();
    expect(builds()).toBe(2);
    const tower = buildArcher();
    expect(orphaned(tower)).toEqual([]);
    expect(runWave(tower)).toBeGreaterThan(0);
  });
});
