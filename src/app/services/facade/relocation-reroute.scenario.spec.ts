import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, Vector3 } from 'three';

/**
 * Playtest 542 (fix session 2026-09-14, not reached there): the HQ moves
 * within the loaded streets so far that the kept spawn has no route to it,
 * as to the other side of the Seine without a bridge among the loaded ways.
 * Expected: `[Relocation] HQ in place: ... random=` above 0 with
 * `spawnFrom=random`, and the new spawn has a route to the new HQ. How long
 * the steps take on the real map is a measurement and not part of this test.
 *
 * Real: MapRelocationService (the move), OsmStreetService (A*, the random
 * spawn), PathAndRouteService (routes), RelocationStatusService (the hint),
 * CorridorController with its CorridorRefit. Fakes as in
 * relocation-corridor.scenario.spec: the game state, the engine (each
 * corridor station costs 1.7 ms on a fake clock), the animation frames. Each
 * A* run (findPath) costs 1 ms on that clock, so the step times of the log
 * say which steps ran. inject() hands out by class name.
 */
const di = vi.hoisted(() => ({ stubs: {} as Record<string, unknown> }));
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return { ...actual, inject: (token: { name?: string }) => di.stubs[token?.name ?? ''] ?? {} };
});
// The coordinator pulls in the dialog and material modules; not used here.
vi.mock('@angular/material/dialog', () => ({ MatDialog: class MatDialog {} }));
vi.mock('../../components/location-dialog/location-dialog.component', () => ({
  LocationDialogComponent: class LocationDialogComponent {},
}));

import { signal } from '@angular/core';
import { MapRelocationService, type RelocationHost } from './map-relocation.service';
import { PathAndRouteService } from '../world/path-route.service';
import { RelocationStatusService } from '../world/relocation-status.service';
import { CorridorBuild, type CorridorBuildDeps } from '../world/corridor-build';
import { OsmStreetService, StreetNetwork, StreetNode } from '../location/osm-street.service';
import type { SpawnPoint } from '../world/marker-visualization.service';
import { METERS_PER_DEGREE_LAT, DEG_TO_RAD } from '../../utils/geo-utils';
import { MIN_SPAWN_DISTANCE, MAX_SPAWN_DISTANCE } from '../../configs/map-constants.config';
import type { ThreeTilesEngine } from '../../three-engine';
import type { StationProbe } from '../../utils/route-corridor';

const ORIGIN = { lat: 48.0, lon: 9.0 };
const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(ORIGIN.lat * DEG_TO_RAD);
/** The point `x` m east and `z` m north of the origin */
const at = (x: number, z: number) => ({ lat: ORIGIN.lat + z / METERS_PER_DEGREE_LAT, lon: ORIGIN.lon + x / M_PER_DEG_LON });
/** Metres east and north of the origin */
const local = (p: { lat: number; lon: number }) => ({
  x: (p.lon - ORIGIN.lon) * M_PER_DEG_LON,
  z: (p.lat - ORIGIN.lat) * METERS_PER_DEGREE_LAT,
});
const metres = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const p = local(a);
  const q = local(b);
  return Math.hypot(p.x - q.x, p.z - q.z);
};

/** The HQ as loaded, on the south bank */
const HQ_START = at(30, 20);
/** The kept spawn, 600 m south of the river on the south bank's street */
const SPAWN: SpawnPoint = { id: 'spawn-1', name: 'Spawn', color: 0xff0000, ...at(0, -600) };
/** North bank: no way from the kept spawn leads here */
const HQ_ACROSS = at(30, 430);
/** South bank, by the quay: the kept spawn still has a route (as in 541) */
const HQ_QUAY = at(320, 30);

/**
 * South bank: a street from the spawn north to the river and the quay east
 * along it. North bank, 400 m north: a quay along the bank and a street
 * north from it. No way crosses the river.
 */
function makeNetwork(): StreetNetwork {
  const nodes = new Map<number, StreetNode>();
  const byPoint = new Map<string, StreetNode>();
  const node = (x: number, z: number): StreetNode => {
    const key = `${x},${z}`;
    let n = byPoint.get(key);
    if (!n) {
      n = { id: byPoint.size + 1, ...at(x, z) };
      byPoint.set(key, n);
      nodes.set(n.id, n);
    }
    return n;
  };
  const way = (id: number, name: string, points: [number, number][]) =>
    ({ id, name, type: 'residential', nodes: points.map(([x, z]) => node(x, z)) });
  const streets = [
    way(100, 'Rue du Sud', [[0, -900], [0, -600], [0, -300], [0, 0]]),
    way(200, 'Quai Sud', [[0, 0], [300, 0], [600, 0]]),
    way(300, 'Quai Nord', [[-1000, 400], [-750, 400], [-500, 400], [-250, 400], [0, 400], [250, 400], [500, 400], [750, 400], [1000, 400]]),
    way(400, 'Rue du Nord', [[0, 400], [0, 650], [0, 900], [0, 1150], [0, 1400]]),
  ];
  const south = at(-1100, -1000);
  const north = at(1100, 1500);
  return {
    streets,
    nodes,
    bounds: { minLat: south.lat, maxLat: north.lat, minLon: south.lon, maxLon: north.lon },
  } as StreetNetwork;
}

describe('Moving the HQ where the kept spawn has no route (playtest 542)', () => {
  let clock: number;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let status: RelocationStatusService;
  let relocation: MapRelocationService;
  let pathRoute: PathAndRouteService;
  let host: RelocationHost;
  let store: { baseCoords: ReturnType<typeof signal<{ lat: number; lon: number }>>; spawnPoints: ReturnType<typeof signal<SpawnPoint[]>> };
  let gameState: { reset: ReturnType<typeof vi.fn>; initialize: ReturnType<typeof vi.fn>; initializeGlobalRouteGrid: ReturnType<typeof vi.fn> };
  let placement: { lat: number; lon: number };
  let warn: ReturnType<typeof vi.spyOn>;

  /** One animation frame: what was requested before it runs, what it requests waits. */
  const runFrame = () => {
    const due = [...frames.values()];
    frames.clear();
    for (const callback of due) callback(clock);
  };
  const lines = (): string[] => warn.mock.calls.map((call: unknown[]) => String(call[0]));
  /** The time a step of the `[Relocation] HQ in place` line took, ms */
  const stepMs = (line: string, step: string): number => Number(new RegExp(` ${step}=([\\d.]+)`).exec(line)![1]);
  const inPlaceLine = () => lines().find((l) => l.startsWith('[Relocation] HQ in place:'))!;

  /**
   * A click in map placement mode on `placement`, and frames until the move
   * is done: the hint paints first (two frames), the corridor build runs over
   * the next ones.
   */
  const moveHq = async () => {
    let done = false;
    const moving = relocation.applyPlacementClick(host).finally(() => { done = true; });
    for (let i = 0; i < 1000 && !done; i++) {
      runFrame();
      for (let j = 0; j < 10; j++) await Promise.resolve();
    }
    await moving;
  };

  beforeEach(() => {
    clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    // findRandomStreetPoint shuffles its candidates; 0.5 keeps their order
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    frames = new Map();
    nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));

    const network = makeNetwork();
    const osm = new OsmStreetService();
    const findPath = osm.findPath.bind(osm);
    vi.spyOn(osm, 'findPath').mockImplementation((...args: Parameters<OsmStreetService['findPath']>) => {
      clock += 1;
      return findPath(...args);
    });
    const overlay = new Group();
    const engine = {
      setOrigin: vi.fn(),
      getOverlayGroup: () => overlay,
      getTerrainHeightAtGeo: () => 0,
      // No 3D tiles: the corridor build measures on what the fake terrain answers
      tilesLodDebug: () => null,
      terrain: {
        clearHeightCache: vi.fn(),
        getGroundHeightEstimate: () => 0,
        measureStreetClearance: (_x: number, _z: number, _ax: number, _az: number, heights: readonly number[]): StationProbe => {
          clock += 1.7;
          const free = heights.map(() => 5.2);
          return { unmeasured: null, tileError: 2, left: free, right: free };
        },
      },
      sync: {
        getOrigin: () => ({ ...ORIGIN, height: 0 }),
        geoToLocalSimple: (lat: number, lon: number, h: number) =>
          new Vector3((lon - ORIGIN.lon) * M_PER_DEG_LON, h, -(lat - ORIGIN.lat) * METERS_PER_DEGREE_LAT),
      },
    } as unknown as ThreeTilesEngine;
    store = {
      baseCoords: signal({ ...HQ_START }),
      spawnPoints: signal<SpawnPoint[]>([SPAWN]),
    };
    placement = HQ_ACROSS;

    di.stubs = {
      // PathAndRouteService's own
      DevWorldService: { isActive: false },
      UIStore: { routesVisible: () => false },
      PathfindingWorkerService: { isWorkerAvailable: false, dispose: () => undefined },
      GlobalRouteGridService: { isInitialized: () => false, getGroundLocalYAt: () => null },
      // RelocationStatusService's
      NgZone: { runOutsideAngular: (fn: () => unknown) => fn() },
      // MapRelocationService's
      OsmStreetService: osm,
      MarkerVisualizationService: { clearAllMarkers: vi.fn(), clearSpawnMarkers: vi.fn(), addBaseMarker: vi.fn() },
      LocationManagementService: { setLocation: vi.fn() },
      HeightUpdateService: { stopHeightUpdates: vi.fn() },
      RouteAnimationService: { stopAnimation: vi.fn(), startAnimation: vi.fn() },
      StreetRenderingService: { dispose: vi.fn() },
      LocationChangeCoordinatorService: { applyNewLocation: vi.fn() },
      MapPlacementService: { handlePlacementClick: () => ({ mode: 'hq', ...placement }), updateDependencies: vi.fn() },
      TowerDefenseStore: { ...store, centerCoords: signal({ ...HQ_START, height: 400 }) },
    };
    pathRoute = new PathAndRouteService();
    status = new RelocationStatusService();
    di.stubs['PathAndRouteService'] = pathRoute;
    di.stubs['RelocationStatusService'] = status;
    relocation = new MapRelocationService();

    // No towers, no enemies: the corridor build runs to its end
    const grid = {
      getStats: () => ({ totalCells: 0 }),
      snapshotHeights: () => new Map(),
      cellsWithoutHeight: () => 0,
      retryUnsampledCells: () => ({ promoted: 0 }),
      initSpatialGridVisualizationIfEnabled: vi.fn(),
      initAirSpatialGridVisualizationIfEnabled: vi.fn(),
      initAirRouteLayerIfEnabled: vi.fn(),
    };
    const corridor = new CorridorBuild({
      gameState: () => ({
        towerCount: () => 0,
        enemyManager: { getAliveCount: () => 0 },
        waveManager: { phase: () => 'setup' },
        getGlobalRouteGrid: () => grid,
        rebuildRouteCells: vi.fn(),
      }),
      engineInit: { getEngine: () => engine },
      pathRoute,
      routeAnimation: { isRunning: () => false, startAnimation: vi.fn() },
      store: { spawnPoints: store.spawnPoints },
      nextFrame: () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
      now: () => clock,
    } as unknown as CorridorBuildDeps);

    gameState = { reset: vi.fn(), initialize: vi.fn(), initializeGlobalRouteGrid: vi.fn() };
    const initRoutes = () => pathRoute.initialize(engine, network, store.baseCoords(), (() => false) as never, osm, null);
    host = {
      context: () => ({
        bridge: {
          getEngine: () => engine,
          getStreetNetwork: () => network,
          setStreetNetwork: vi.fn(),
          setStreetNetworkLocation: vi.fn(),
          setFilteredStreetNetwork: vi.fn(),
        },
        gameState,
      }) as never,
      vizCallbacks: () => ({
        initializeVisualizationServices: initRoutes,
        buildCorridor: (reason, report) => corridor.build(reason, report),
        initializeTowerPlacement: vi.fn(),
        filterStreetNetworkToRoutes: vi.fn(),
        scheduleOverlayHeightUpdate: vi.fn(),
        reframeCameraWithRoutes: vi.fn(),
        renderStreets: vi.fn(),
        saveInitialCameraPosition: vi.fn(),
      }),
      addSpawnPoint: (id, name, lat, lon, color) => {
        store.spawnPoints.update((points) => [...points, { id, name, lat, lon, color }]);
        pathRoute.showPathFromSpawn({ id, name, lat, lon, color });
      },
      syncUrlWithLocation: vi.fn(),
    };
    // The location as loaded: the spawn's route runs to the HQ on the south bank
    initRoutes();
    pathRoute.showPathFromSpawn(SPAWN);
    expect(pathRoute.getCachedPaths().get(SPAWN.id)?.length).toBeGreaterThanOrEqual(2);
    warn.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('542: across the river the kept spawn has no route: "spawnFrom=random", "random=" above 0, the new spawn has a route to the new HQ', async () => {
    await moveHq();

    const line = inPlaceLine();
    expect(line).toMatch(/ spawnFrom=random spawns=1$/);
    expect(stepMs(line, 'paths')).toBeGreaterThan(0); // A* from the kept spawn ran ...
    expect(stepMs(line, 'route')).toBe(0);            // ... and gave it no route
    expect(stepMs(line, 'random')).toBeGreaterThan(0);

    // One spawn, a new one on the north bank, in the distance a random spawn keeps from the HQ
    const spawns = store.spawnPoints();
    expect(spawns).toHaveLength(1);
    const spawn = spawns[0];
    // On the north bank street, its node rounded to canonical coordinates
    expect(Math.abs(local(spawn).z - 400)).toBeLessThan(1);
    expect(metres(spawn, HQ_ACROSS)).toBeGreaterThanOrEqual(MIN_SPAWN_DISTANCE);
    expect(metres(spawn, HQ_ACROSS)).toBeLessThanOrEqual(MAX_SPAWN_DISTANCE);

    // Its route: from it to the new HQ, all on the north bank; the kept spawn's is gone
    const paths = pathRoute.getCachedPaths();
    expect([...paths.keys()]).toEqual([spawn.id]);
    const route = paths.get(spawn.id)!;
    expect(route.length).toBeGreaterThanOrEqual(2);
    expect(metres(route[0], spawn)).toBeLessThan(1);
    expect(metres(route.at(-1)!, HQ_ACROSS)).toBeLessThan(1);
    expect(route.every((p) => local(p).z > 200)).toBe(true);

    // The game starts over on it
    expect(gameState.initialize).toHaveBeenLastCalledWith(
      expect.anything(),
      { lat: HQ_ACROSS.lat, lon: HQ_ACROSS.lon },
      [{ id: spawn.id, name: spawn.name, lat: spawn.lat, lon: spawn.lon }],
      paths,
    );

    // The measurement of its corridor ends as after any move
    expect(lines().find((l) => l.startsWith('[Relocation] HQ done:'))).toMatch(/ ended=frozen$/);
  });

  it('541 counter-check: along the south bank the kept spawn keeps its route: "spawnFrom=old", "random=0.0"', async () => {
    placement = HQ_QUAY;
    await moveHq();

    const line = inPlaceLine();
    expect(line).toMatch(/ spawnFrom=old spawns=1$/);
    expect(stepMs(line, 'route')).toBeGreaterThan(0);
    expect(stepMs(line, 'random')).toBe(0);

    expect(store.spawnPoints()).toEqual([expect.objectContaining({ lat: SPAWN.lat, lon: SPAWN.lon })]);
    const route = pathRoute.getCachedPaths().get(SPAWN.id)!;
    expect(metres(route[0], SPAWN)).toBeLessThan(1);
    expect(metres(route.at(-1)!, HQ_QUAY)).toBeLessThan(1);
    expect(lines().find((l) => l.startsWith('[Relocation] HQ done:'))).toMatch(/ ended=frozen$/);
  });
});
