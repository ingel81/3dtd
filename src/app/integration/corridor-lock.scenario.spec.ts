/**
 * Playtest 2026-09-15: towers stood, their turrets did not turn, and
 * `__towerTargets()` said "no target, asleep". Between waves the console
 * showed `[Corridor] rebuild` with the towers standing, after the camera had
 * moved (G to the hero): a tile batch let the corridor be measured and
 * rebuilt under them, and the towers' visibleCells were left in the grid it
 * replaced.
 *
 * Since 2026-09-16 the corridor is built once per route set (CorridorBuild),
 * on the finest tile level, and is then frozen: no tile batch and no camera
 * move measures a station, samples a cell or rebuilds a route line again.
 * Only a new build does, and towers and waves wait for it
 * (GameStateManager.corridorPending).
 *
 * Real: GameStateManager (towerCount, placeTower, sellTower, beginWave,
 * onTilesLoaded and the sub-step loop), GlobalRouteGridService (cells from the
 * route and their heights, enemies in their cells), SpatialGridService,
 * TowerCombatService, CombatEffectService, DamageApplicationService,
 * CorridorBuild and the fingerprint over what came out. Fake: the route
 * service (a measurement that finds the free space `tiles.halfWidth` shows,
 * the route built with it), the tile LOD handle (a level the build sets and
 * columns that answer differently per level), the GPU line of sight (every
 * cell in range visible, as TowerLosRegistry.register writes it for a clear
 * view), the renderer and the animation frames.
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
import { corridorFingerprint, type CorridorFingerprint } from '../services/debug/corridor-fingerprint';
import { ROUTE_CORRIDOR_COARSE_ERROR_TARGET, ROUTE_CORRIDOR_ERROR_TARGET } from '../three-engine/route-corridor-region';
import type { CorridorState } from '../services/world/path-route.service';
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
/** The whole grid, as `__corridor.fingerprint()` reads it */
const WHOLE_GRID = { xMin: -Infinity, xMax: Infinity, zMin: -Infinity, zMax: Infinity };
/** Between two frames of the build, ms: two of them reach the tiles' QUIET_MS */
const FRAME_MS = 250;

function createEngine(terrain: Record<string, unknown>): never {
  const engine = createMockTilesEngine() as unknown as Record<string, Record<string, unknown>>;
  for (const key of ['effects', 'towers', 'enemies', 'projectiles', 'trailStreaks', 'spatialAudio', 'oozes']) {
    engine[key] = withAutoStubs(engine[key]);
  }
  engine['sync'] = withAutoStubs({ ...engine['sync'], ...flatSync });
  engine['terrain'] = withAutoStubs(terrain);
  engine['enemies']['create'] = vi.fn(() => Promise.resolve(null));
  // No model data
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

describe('The corridor frozen after its build, playtest 2026-09-15', () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  /** Plain console lines: `[Corridor] build` is one. */
  let log: ReturnType<typeof vi.spyOn>;
  /** What the tiles show on each side of the route (m); a batch of finer tiles changes it */
  let tiles: { halfWidth: number };
  /** What a column finds under the route (m); a car at the kerb raises it */
  let ground: { y: number };
  /** No column at the finest level, as at the 4 Paris stations of phase 0 */
  let gap: boolean;
  /** Error target of the corridor region (m), as the build sets it */
  let level: number;
  /** Error target of the camera (px), muted by the build */
  let cameraTarget: number;
  /** Slices the next measurement takes, one per frame the build waits for */
  let slices: number;
  /** Stations the level in use found no column for */
  let unmeasured: number;
  /** Frames the build waits for, resolved by pumping */
  let buildFrames: (() => void)[];
  let clock: number;
  let gsm: GameStateManager;
  let grid: GlobalRouteGridService;
  let corridor: CorridorBuild;
  let pathRoute: Record<string, unknown> & {
    refreshRouteLines: ReturnType<typeof vi.fn>;
    corridorState: () => CorridorState;
  };
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

  /** Pump the build's frames and the promise chains they resolve until it is done. */
  const untilDone = async <T>(promise: Promise<T>): Promise<T> => {
    let done = false;
    const settled = promise.then((value) => { done = true; return value; });
    for (let i = 0; i < 400 && !done; i++) {
      const frame = buildFrames.shift();
      if (frame) {
        clock += FRAME_MS;
        frame();
      }
      for (let j = 0; j < 10; j++) await Promise.resolve();
    }
    return settled;
  };

  /**
   * A batch of tiles loads and settles: all that is left of what used to
   * measure and rebuild the corridor here (VisualizationFacadeService.onTilesLoaded).
   */
  const tileBatch = () => {
    gsm.onTilesLoaded();
    runFrames();
  };

  /** `__corridor.fingerprint()`: the corridor in use, stored state only. */
  const fingerprint = (): CorridorFingerprint =>
    corridorFingerprint(pathRoute.corridorState(), grid.getGrid().dumpCellsInBox(WHOLE_GRID));
  /** Every cell by its centre with the height it holds. */
  const cellHeights = () =>
    grid.getGrid().dumpCellsInBox(WHOLE_GRID).map((c) => `${c.x},${c.z}:${c.terrainHeight}`).sort();

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
    ground = { y: 0 };
    gap = false;
    level = ROUTE_CORRIDOR_ERROR_TARGET;
    cameraTarget = 16;
    slices = 1;
    unmeasured = 0;
    buildFrames = [];
    clock = 0;
    let halfWidth = 3;
    const route = (): RouteWaypoint[] => TEST_PATH.map((p) => ({ ...p, corridorLeft: halfWidth, corridorRight: halfWidth }));
    const paths = new Map<string, RouteWaypoint[]>([['spawn-1', route()]]);

    /** The finest level finds no column while `gap`; the fallback level always does. */
    const onFinestLevel = () => level <= ROUTE_CORRIDOR_ERROR_TARGET;
    const terrain = {
      sampleColumn: () =>
        (gap && onFinestLevel() ? null : { groundY: ground.y, topY: ground.y, tileDepth: 20, tileGeometricError: 1 }),
      peekBestTileLODAtLocal: () => ({ depth: 20, geometricError: 1 }),
      clearHeightCache: () => undefined,
    };
    // The LOD handle the build drives: it sets the region level and mutes the camera.
    const tilesLod = {
      snapshot: () => ({ regionErrorTarget: level, cameraErrorTarget: cameraTarget }),
      busy: () => false,
      setRegionErrorTarget: (metres: number) => { level = metres; return true; },
      setCameraErrorTarget: (px: number) => { cameraTarget = px; },
      holdSettled: () => undefined,
    };

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
          // What this level could measure: on the fallback level the gaps close.
          unmeasured = gap && onFinestLevel() ? 2 : 0;
          const changed = tiles.halfWidth !== halfWidth;
          halfWidth = tiles.halfWidth;
          return changed;
        },
        cancel: () => { open = false; },
      };
    });
    pathRoute = withAutoStubs({
      getCachedPaths: () => paths,
      routesEpoch: () => 1,
      beginClearanceMeasurement: measurements,
      unmeasuredStations: () => unmeasured,
      buildBands: () => ({ routes: 1, stations: 30, passages: 0, maxSlopeM: 0, maxCurvature: 0 }),
      refreshRouteLines: vi.fn(() => { paths.set('spawn-1', route()); }),
      // The part of the state the fingerprint hashes of the routes: the band
      // in use per station. Nothing here measures stations.
      corridorState: () => ({
        routes: [{
          key: 'spawn-1',
          band: [{
            segment: 0, k: 0, n: 1, s: 1, x: 0, z: 0, rx: 0, rz: 1,
            kind: 'band', backbone: { offset: 0, y: 0 }, street: 0, left: -halfWidth, right: halfWidth, centre: 0,
          }],
        }],
        stations: [],
      }) as unknown as CorridorState,
    }) as typeof pathRoute;

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
    gsm.initialize(createEngine(terrain), BASE, TEST_SPAWN_POINTS, paths);
    gsm.initializeGlobalRouteGrid();

    corridor = new CorridorBuild({
      gameState: () => gsm,
      engineInit: {
        getEngine: () => ({
          tilesLodDebug: () => tilesLod,
          routeCorridorLod: () => ({ errorTarget: level }),
          terrain,
        }),
      },
      pathRoute,
      routeAnimation: { isRunning: () => false, startAnimation: vi.fn() },
      store: { spawnPoints: () => TEST_SPAWN_POINTS },
      nextFrame: () => new Promise<void>((resolve) => buildFrames.push(resolve)),
      now: () => clock,
    } as unknown as CorridorBuildDeps);
    // As VisualizationFacadeService.initialize wires it
    gsm.setCorridorPending(() => corridor.pending());

    towerShots = new Map();
    const spawn = gsm.projectileManager.spawn.bind(gsm.projectileManager);
    vi.spyOn(gsm.projectileManager, 'spawn').mockImplementation((...args: Parameters<typeof spawn>) => {
      const id = args[0].id;
      towerShots.set(id, (towerShots.get(id) ?? 0) + 1);
      return spawn(...args);
    });
    now = 1000;
  });

  afterEach(() => {
    corridor.dispose();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** The location loads: the corridor is built once, no tower yet. */
  const loadLocation = async () => {
    const result = await untilDone(corridor.build('location load'));
    expect(result).not.toBeNull();
    expect(builds()).toBe(1);
    return result!;
  };

  it('builds on the finest level with the camera muted, and gives both back when it freezes', async () => {
    const result = await loadLocation();

    expect(result.timedOut).toBe(false);
    expect(result.cells).toBeGreaterThan(0);
    // The camera refines again, and the region rests at the coarse level:
    // the frozen corridor samples nothing, so the fine tiles need not stay
    // active for the rest of the session.
    expect(level).toBe(ROUTE_CORRIDOR_COARSE_ERROR_TARGET);
    expect(cameraTarget).toBe(16);
  });

  it('takes the fallback level for the stations and cells the finest level has no column for', async () => {
    gap = true;

    const result = await loadLocation();

    expect(result.fallbackStations).toBe(2);
    expect(result.fallbackCells).toBeGreaterThan(0);
    expect(result.unmeasured).toBe(0);
    // Every cell has a height, though the finest level gave none of them one.
    expect(grid.getGrid().cellsWithoutHeight()).toBe(0);
    expect(level).toBe(ROUTE_CORRIDOR_COARSE_ERROR_TARGET);
  });

  it('measures, samples and rebuilds nothing when finer tiles arrive after the freeze', async () => {
    await loadLocation();
    const before = fingerprint();
    const heights = cellHeights();
    const lines = pathRoute.refreshRouteLines.mock.calls.length;

    // The camera flies off and back (G to the hero): the tiles now show more
    // room beside the route and a car at the kerb under it.
    tiles.halfWidth = 5;
    ground.y = 1.5;
    tileBatch();
    tileBatch();

    expect(fingerprint().hash).toBe(before.hash);
    expect(cellHeights()).toEqual(heights);
    expect(measurements).toHaveBeenCalledTimes(1);
    // The line the build baked is the one still on the map.
    expect(pathRoute.refreshRouteLines).toHaveBeenCalledTimes(lines);
    expect(builds()).toBe(1);
  });

  it('a tile batch between waves rebuilds nothing under the tower, and the tower keeps firing', async () => {
    await loadLocation();
    const tower = buildArcher();
    expect(runWave(tower)).toBeGreaterThan(0);

    tiles.halfWidth = 5;
    tileBatch();

    expect(measurements).toHaveBeenCalledTimes(1);
    expect(builds()).toBe(1);
    expect(orphaned(tower)).toEqual([]);
    expect(runWave(tower)).toBeGreaterThan(0);
  });

  it('nothing rebuilds after the tower is sold either: the corridor stays until the next build', async () => {
    await loadLocation();
    const tower = buildArcher();
    tiles.halfWidth = 5;
    tileBatch();
    gsm.sellTower(tower);
    expect(gsm.towerCount()).toBe(0);

    tileBatch();

    expect(measurements).toHaveBeenCalledTimes(1);
    expect(builds()).toBe(1);
  });

  it('a relocation builds once and takes the tiles that arrived since', async () => {
    await loadLocation();
    const before = fingerprint();
    tiles.halfWidth = 5;
    ground.y = 1.5;
    tileBatch();

    // The HQ is moved: the one path that builds the corridor again.
    const result = await untilDone(corridor.build('HQ moved'));

    expect(result).not.toBeNull();
    expect(builds()).toBe(2);
    expect(measurements).toHaveBeenCalledTimes(2);
    // The batch really did carry other tiles: the new build shows it.
    const after = fingerprint();
    expect(after.hash).not.toBe(before.hash);
    expect(after.parts.band.hash).not.toBe(before.parts.band.hash);
    expect(after.parts.heights.hash).not.toBe(before.parts.heights.hash);
  });

  it('a tower and a wave wait for the corridor build, then stand on its cells', async () => {
    await loadLocation();
    slices = 3;
    tiles.halfWidth = 5;
    const building = corridor.build('spawn moved in place');
    for (let i = 0; i < 3; i++) {
      buildFrames.shift()?.();
      clock += FRAME_MS;
      for (let j = 0; j < 10; j++) await Promise.resolve();
    }

    expect(corridor.pending()).toBe(true);
    expect(gsm.placeTower(TOWER_AT, 'archer')).toBeNull();
    gsm.beginWave();
    expect(gsm.waveManager.phase()).toBe('setup');

    expect(await untilDone(building)).not.toBeNull();
    expect(builds()).toBe(2);
    const tower = buildArcher();
    expect(orphaned(tower)).toEqual([]);
    expect(runWave(tower)).toBeGreaterThan(0);
  });
});
