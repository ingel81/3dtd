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
 * (MainWorldService.corridorPending, sent to the simulation). Since the
 * simulation runs in a worker it stands on the world the freeze handed it
 * (MainWorldService.sendToSim); a tile batch sends it nothing new.
 *
 * Real: the main thread's MainWorldService and GlobalRouteGridService (cells
 * from the route and their heights), CorridorBuild and the fingerprint over
 * what came out; the simulation behind the SimClient in one thread (SimCore:
 * towers, waves, combat) with the real SimMirror. Fake: the route service (a
 * measurement that finds the free space `tiles.halfWidth` shows, the route
 * built with it), the tile LOD handle (a level the build sets and columns
 * that answer differently per level), the GPU line of sight (every cell in
 * range visible, the answer the main thread sends as command:los-mask for a
 * clear view), the animation frames.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Injector } from '@angular/core';
import { withAutoStubs, TEST_PATH, TEST_SPAWN_POINTS } from './test-helpers';
import { GlobalRouteGridService } from '../services/world/global-route-grid.service';
import { MainWorldService } from '../services/world/main-world.service';
import { RouteGridVizService } from '../services/world/route-grid-viz.service';
import { PathAndRouteService } from '../services/world/path-route.service';
import { CorridorBuild, type CorridorBuildDeps, type CorridorMeasurement } from '../services/world/corridor-build';
import { corridorFingerprint, type CorridorFingerprint } from '../services/debug/corridor-fingerprint';
import { ROUTE_CORRIDOR_COARSE_ERROR_TARGET, ROUTE_CORRIDOR_ERROR_TARGET } from '../three-engine/route-corridor-region';
import type { CorridorState } from '../services/world/path-route.service';
import { SimClient } from '../sim/client/sim-client.service';
import { InlineTransport } from '../sim/client/transport';
import { SimMirror } from '../sim/client/mirror/sim-mirror';
import { SimCore } from '../sim/core/sim-core';
import { OriginSync } from '../sim/core/sim-coords';
import { GameStore } from '../store/game.store';
import { losMaskToJson } from '../utils/los-mask';
import type { ThreeTilesEngine } from '../three-engine';
import type { ViewEvent } from '../sim/client/view-events';
import type { Tower } from '../entities/tower.entity';
import type { GeoPosition, RouteWaypoint } from '../models/game.types';

/** The origin of the location */
const ORIGIN = { lat: 48.776, lon: 9.183, height: 300 };

/** HQ at the north end of the 111 m test path */
const BASE: GeoPosition = TEST_PATH[TEST_PATH.length - 1];
/** An Archer some 7 m east of the middle of the route */
const TOWER_AT: GeoPosition = { lat: 48.7763, lon: 9.183, height: ORIGIN.height };
/** One wave of zombies */
const WAVE_SIZE = 6;
/** Longest a wave may take, frames of 16 ms */
const WAVE_FRAMES = 90_000 / 16;
/** The whole grid, as `__corridor.fingerprint()` reads it */
const WHOLE_GRID = { xMin: -Infinity, xMax: Infinity, zMin: -Infinity, zMax: Infinity };
/** Between two frames of the build, ms: two of them reach the tiles' QUIET_MS */
const FRAME_MS = 250;

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
  let sync: OriginSync;
  let client: SimClient;
  let mirror: SimMirror;
  let world: MainWorldService;
  let grid: GlobalRouteGridService;
  let corridor: CorridorBuild;
  let pathRoute: Record<string, unknown> & {
    refreshRouteLines: ReturnType<typeof vi.fn>;
    corridorState: () => CorridorState;
  };
  let measurements: ReturnType<typeof vi.fn>;
  /** Worlds the simulation was handed */
  let worldsSent: ReturnType<typeof vi.spyOn>;
  let events: ViewEvent[];
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

  /** Frames of the game: the corridor's gate to the simulation, then its tick (GameLoopFacadeService.onEngineUpdate). */
  const gameFrames = (n: number) => {
    for (let i = 0; i < n; i++) {
      world.syncPending();
      client.frame((now += 16), false);
    }
  };

  /**
   * A batch of tiles loads and settles while the game runs. What used to
   * measure and rebuild the corridor here does neither any more
   * (VisualizationFacadeService.onTilesLoaded leaves cells, lines and the
   * simulation's world alone).
   */
  const tileBatch = () => {
    runFrames();
    gameFrames(2);
  };

  /** `__corridor.fingerprint()`: the corridor in use, stored state only. */
  const fingerprint = (): CorridorFingerprint =>
    corridorFingerprint(pathRoute.corridorState(), grid.getGrid().dumpCellsInBox(WHOLE_GRID));
  /** Every cell by its centre with the height it holds. */
  const cellHeights = () =>
    grid.getGrid().dumpCellsInBox(WHOLE_GRID).map((c) => `${c.x},${c.z}:${c.terrainHeight}`).sort();

  /** Build an Archer by command and answer its line of sight as the GPU does for a clear view; null when refused. */
  const buildArcher = (): Tower | null => {
    const before = new Set(mirror.towers().map((t) => t.id));
    client.bus.emit({ type: 'command:place-tower', position: TOWER_AT, typeId: 'archer' });
    gameFrames(2);
    const tower = mirror.towers().find((t) => !before.has(t.id)) ?? null;
    if (!tower) return null;
    const needed = events.find((e) => e.type === 'tower:los-needed' && e.towerId === tower.id) as
      Extract<ViewEvent, { type: 'tower:los-needed' }>;
    const local = sync.geoToLocalSimple(tower.position.lat, tower.position.lon, 0);
    for (const cell of grid.getCellsInRange(local.x, local.z, needed.range)) cell.towerVisibility.set(tower.id, true);
    const mask = grid.encodeLosMask(tower.id, local.x, local.z, needed.range, needed.canTargetGround, needed.canTargetAir);
    client.bus.emit({ type: 'command:los-mask', towerId: tower.id, reason: 'place', mask: losMaskToJson(mask) });
    gameFrames(2);
    expect(mirror.tower(tower.id)!.losReady).toBe(true);
    return tower;
  };

  /** Ask for one wave of zombies; the phase the game is in two frames later */
  const startWave = () => {
    client.bus.emit({
      type: 'command:start-wave',
      config: {
        schedule: {
          entries: Array.from({ length: WAVE_SIZE }, () => ({ enemyType: 'zombie', speed: 1, health: 0.5 })),
          baseDelay: 400,
          spawnMode: 'each',
        },
      },
    });
    gameFrames(2);
    return mirror.scalars.phase;
  };

  /** One wave, run until the simulation ends it; the kills of `tower` in it. */
  const runWave = (tower: Tower): number => {
    const before = mirror.tower(tower.id)!.combat.kills;
    expect(startWave()).toBe('wave');
    for (let i = 0; i < WAVE_FRAMES && mirror.scalars.phase === 'wave'; i++) gameFrames(1);
    expect(mirror.scalars.phase).toBe('setup');
    return mirror.tower(tower.id)!.combat.kills - before;
  };

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    frames = new Map();
    nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));

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
    now = 1000;
    events = [];
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
    const gridViz = withAutoStubs({}) as unknown as RouteGridVizService;
    const injector = Injector.create({
      providers: [
        { provide: GameStore, useFactory: () => new GameStore(), deps: [] },
        { provide: SimClient, useFactory: () => new SimClient(), deps: [] },
        { provide: SimMirror, useFactory: () => new SimMirror(), deps: [] },
        { provide: GlobalRouteGridService, useValue: grid },
        { provide: RouteGridVizService, useValue: gridViz },
        { provide: PathAndRouteService, useValue: pathRoute },
        { provide: MainWorldService, useFactory: () => new MainWorldService(), deps: [] },
      ],
    });
    client = injector.get(SimClient);
    mirror = injector.get(SimMirror);
    world = injector.get(MainWorldService);
    client.attach(mirror, null);
    client.start((handlers) => new InlineTransport(new SimCore(), handlers));
    client.bus.onAny((event) => events.push(event));
    worldsSent = vi.spyOn(client, 'loadWorld');

    // The location as it loads: engine, HQ and spawn, the cells of the route
    sync = new OriginSync(ORIGIN.lat, ORIGIN.lon, ORIGIN.height);
    const engine = {
      sync,
      terrain,
      getTerrainHeightAtGeo: () => ground.y,
      setRouteCorridor: vi.fn(),
    } as unknown as ThreeTilesEngine;
    world.attach(engine, BASE, TEST_SPAWN_POINTS);
    world.buildCells(true);

    corridor = new CorridorBuild({
      world,
      grid,
      gridViz,
      scalars: () => mirror.scalars,
      engineInit: {
        getEngine: () => ({
          tilesLodDebug: () => tilesLod,
          routeCorridorLod: () => ({ errorTarget: level }),
          refreshRouteCorridorFrame: () => false,
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
    world.setCorridorPending(() => corridor.pending());
  });

  afterEach(() => {
    corridor.dispose();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** The location loads: the corridor is built once and handed to the simulation, no tower yet. */
  const loadLocation = async () => {
    const result = await untilDone(corridor.build('location load'));
    expect(result).not.toBeNull();
    expect(builds()).toBe(1);
    expect(worldsSent).toHaveBeenCalledTimes(1);
    gameFrames(2);
    client.bus.emit({ type: 'debug:add-credits', amount: 5000 });
    gameFrames(1);
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
    expect(worldsSent).toHaveBeenCalledTimes(1);
  });

  it('a tile batch between waves rebuilds nothing under the tower, and the tower keeps firing', async () => {
    await loadLocation();
    const tower = buildArcher()!;
    expect(runWave(tower)).toBeGreaterThan(0);

    tiles.halfWidth = 5;
    tileBatch();

    expect(measurements).toHaveBeenCalledTimes(1);
    expect(builds()).toBe(1);
    // The simulation keeps the world its tower stands on
    expect(worldsSent).toHaveBeenCalledTimes(1);
    expect(runWave(tower)).toBeGreaterThan(0);
  });

  it('nothing rebuilds after the tower is sold either: the corridor stays until the next build', async () => {
    await loadLocation();
    const tower = buildArcher()!;
    tiles.halfWidth = 5;
    tileBatch();
    client.bus.emit({ type: 'command:sell-tower', towerId: tower.id });
    gameFrames(2);
    expect(mirror.scalars.towerCount).toBe(0);

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
    // The simulation gets the new world
    expect(worldsSent).toHaveBeenCalledTimes(2);
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

    expect(world.corridorPending()).toBe(true);
    expect(buildArcher()).toBeNull();
    expect(startWave()).toBe('setup');

    expect(await untilDone(building)).not.toBeNull();
    expect(builds()).toBe(2);
    gameFrames(1);
    const tower = buildArcher();
    expect(tower).not.toBeNull();
    expect(runWave(tower!)).toBeGreaterThan(0);
  });
});
