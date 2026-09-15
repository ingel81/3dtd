import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, Vector3 } from 'three';

/**
 * Playtest 543 (fix session 2026-09-14): the HQ is moved within the loaded
 * streets and, while the corridor is measured, a tower is built or a zombie
 * placed through Enemy Debug. Since 2026-09-16 the corridor of the new routes
 * is built once under the hint (CorridorBuild) and then frozen: towers and
 * waves wait for it (GameStateManager.corridorPending, its own spec), enemies
 * change nothing of it. The hint shows the build's steps and goes at its end,
 * then `[Relocation] HQ done ... ended=`.
 *
 * Real: MapRelocationService (the move), RelocationStatusService (the hint),
 * CorridorBuild and PathAndRouteService (route, clearance run, their logs).
 * Fakes: the game state, the engine (no tiles, each station costs 1.7 ms on
 * a fake clock, as in the city-centre playtest), the animation frames.
 * inject() hands out by class name, as in path-route.service.spec.
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
import { OsmStreetService } from '../location/osm-street.service';
import type { SpawnPoint } from '../world/marker-visualization.service';
import { METERS_PER_DEGREE_LAT, DEG_TO_RAD } from '../../utils/geo-utils';
import { makeNetwork } from '../../../test/route-network-fixture';
import type { ThreeTilesEngine } from '../../three-engine';
import type { StationProbe } from '../../utils/route-corridor';

const ORIGIN = { lat: 48.0, lon: 9.0 };
const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(ORIGIN.lat * DEG_TO_RAD);
const HQ = { lat: 48.0011, lon: 9.0025 };
const SPAWN: SpawnPoint = { id: 'spawn-1', name: 'Spawn', color: 0xff0000, lat: 47.9993, lon: 9.0 };

describe('Moving the HQ while the corridor is built (playtest 543)', () => {
  let clock: number;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let game: { towers: number; enemies: number; phase: string };
  let status: RelocationStatusService;
  let relocation: MapRelocationService;
  let corridor: CorridorBuild;
  let host: RelocationHost;
  /** What the move wrote to the console, warnings and plain lines in their order. */
  let logged: string[];

  /** One animation frame: what was requested before it runs, what it requests waits. */
  const runFrame = () => {
    const due = [...frames.values()];
    frames.clear();
    for (const callback of due) callback(clock);
  };
  /** The promise chains a frame resolved. */
  const settle = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  const lines = (): string[] => logged;
  const lineIndex = (pattern: RegExp) => lines().findIndex((l) => pattern.test(l));

  /** A click in map placement mode on the HQ spot; the hint paints first (two frames), the build runs over the next. */
  const startMove = () => {
    const move = { done: false, promise: Promise.resolve() };
    move.promise = relocation.applyPlacementClick(host).finally(() => { move.done = true; });
    return move;
  };
  /** Frames until `until` holds, at most `limit`. */
  const framesUntil = async (until: () => boolean, limit = 1000) => {
    for (let i = 0; i < limit && !until(); i++) {
      runFrame();
      await settle();
    }
  };

  beforeEach(() => {
    clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    logged = [];
    vi.spyOn(console, 'warn').mockImplementation((line: unknown) => { logged.push(String(line)); });
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => { logged.push(String(line)); });
    frames = new Map();
    nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));

    const network = makeNetwork();
    const overlay = new Group();
    const engine = {
      setOrigin: vi.fn(),
      getOverlayGroup: () => overlay,
      getTerrainHeightAtGeo: () => 0,
      // No 3D tiles: the build measures on what the fake terrain answers
      tilesLodDebug: () => null,
      terrain: {
        clearHeightCache: vi.fn(),
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
    const store = {
      baseCoords: signal({ ...HQ }),
      centerCoords: signal({ ...HQ, height: 400 }),
      spawnPoints: signal<SpawnPoint[]>([SPAWN]),
    };

    di.stubs = {
      // PathAndRouteService's own
      DevWorldService: { isActive: false },
      UIStore: { routesVisible: () => false },
      PathfindingWorkerService: { isWorkerAvailable: false, dispose: () => undefined },
      GlobalRouteGridService: { isInitialized: () => false, getGroundLocalYAt: () => null },
      // MapRelocationService's
      OsmStreetService: { findPath: () => [SPAWN, HQ], findRandomStreetPoint: () => null, haversineDistance: () => 0 },
      MarkerVisualizationService: { clearAllMarkers: vi.fn(), clearSpawnMarkers: vi.fn(), addBaseMarker: vi.fn() },
      LocationManagementService: { setLocation: vi.fn() },
      HeightUpdateService: { stopHeightUpdates: vi.fn() },
      RouteAnimationService: { stopAnimation: vi.fn(), startAnimation: vi.fn() },
      StreetRenderingService: { dispose: vi.fn() },
      LocationChangeCoordinatorService: { applyNewLocation: vi.fn() },
      MapPlacementService: { handlePlacementClick: () => ({ mode: 'hq', ...HQ }), updateDependencies: vi.fn() },
      TowerDefenseStore: store,
    };
    const pathRoute = new PathAndRouteService();
    status = new RelocationStatusService();
    di.stubs['PathAndRouteService'] = pathRoute;
    di.stubs['RelocationStatusService'] = status;
    relocation = new MapRelocationService();

    // The game: towers, enemies (Enemy Debug places them idle, no wave)
    game = { towers: 0, enemies: 0, phase: 'setup' };
    const grid = {
      getStats: () => ({ totalCells: 0 }),
      snapshotHeights: () => new Map(),
      cellsWithoutHeight: () => 0,
      retryUnsampledCells: () => ({ promoted: 0 }),
      initSpatialGridVisualizationIfEnabled: vi.fn(),
      initAirSpatialGridVisualizationIfEnabled: vi.fn(),
      initAirRouteLayerIfEnabled: vi.fn(),
    };
    corridor = new CorridorBuild({
      gameState: () => ({
        towerCount: () => game.towers,
        enemyManager: { getAliveCount: () => game.enemies },
        waveManager: { phase: () => game.phase },
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

    const initRoutes = () =>
      pathRoute.initialize(engine, network, store.baseCoords(), (() => false) as never, new OsmStreetService(), null);
    host = {
      context: () => ({
        bridge: {
          getEngine: () => engine,
          getStreetNetwork: () => network,
          setStreetNetwork: vi.fn(),
          setStreetNetworkLocation: vi.fn(),
          setFilteredStreetNetwork: vi.fn(),
        },
        gameState: { reset: vi.fn(), initialize: vi.fn(), initializeGlobalRouteGrid: vi.fn() },
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
    // The location as loaded
    initRoutes();
    pathRoute.showPathFromSpawn(SPAWN);
  });

  afterEach(() => {
    corridor.dispose();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('builds the corridor under the hint, towers and waves wait until it is frozen, then "ended=frozen"', async () => {
    const move = startMove();
    await framesUntil(() => status.status()?.percent !== undefined && status.status()?.percent !== null);
    expect(status.status()).toMatchObject({ title: 'Moving HQ', step: 'Measuring the corridor' });
    const measuring = status.status()!.percent!;
    expect(measuring).toBeGreaterThan(0);
    expect(measuring).toBeLessThan(100);
    // What GameStateManager.corridorPending reads: no tower, no wave meanwhile
    expect(corridor.pending()).toBe(true);

    // An enemy placed through Enemy Debug meanwhile changes nothing of the build
    game.enemies = 1;
    await framesUntil(() => move.done);
    await move.promise;

    expect(status.status()).toBeNull();
    expect(corridor.pending()).toBe(false);
    const built = lineIndex(/^\[Corridor\] build: reason=HQ moved in place /);
    const done = lineIndex(/^\[Relocation\] HQ done:/);
    expect(built).toBeGreaterThanOrEqual(0);
    expect(lines()[done]).toMatch(/ ended=frozen$/);
    expect(done).toBeGreaterThan(built);
    expect(lines().some((l) => l.startsWith('[Corridor] clearance cancelled'))).toBe(false);
  });

  it('a second move while the first builds stops the first, "ended=stopped", and builds its own', async () => {
    const first = startMove();
    await framesUntil(() => status.status()?.step === 'Measuring the corridor');

    const second = startMove();
    await framesUntil(() => first.done && second.done);
    await Promise.all([first.promise, second.promise]);

    const done = lines().filter((l) => l.startsWith('[Relocation] HQ done:'));
    expect(done).toHaveLength(2);
    expect(done[0]).toMatch(/ ended=stopped$/);
    expect(done[1]).toMatch(/ ended=frozen$/);
    expect(lines().filter((l) => l.startsWith('[Corridor] build:'))).toHaveLength(1);
    // The first move's end took the second move's hint not away before its time
    expect(status.status()).toBeNull();
    expect(corridor.pending()).toBe(false);
  });
});
