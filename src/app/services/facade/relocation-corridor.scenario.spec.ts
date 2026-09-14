import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, Vector3 } from 'three';

/**
 * Playtest 543 (fix session 2026-09-14): the HQ is moved within the loaded
 * streets and, while "Measuring the corridor" runs, a tower is built or a
 * zombie is placed through Enemy Debug. The hint goes, the corridor log says
 * how the measurement ended, then `[Relocation] HQ done ... ended=`.
 *
 * Real: MapRelocationService (the move), RelocationStatusService (the hint),
 * CorridorController with its CorridorRefit (slices, flush, cancel) and
 * PathAndRouteService (route, clearance run, its log). Fakes: the game
 * state, the engine (each station costs 1.7 ms on a fake clock, as in the
 * city-centre playtest), the animation frames. inject() hands out by class
 * name, as in path-route.service.spec.
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
import { RelocationStatusService, MEASURING_STEP } from '../world/relocation-status.service';
import { CorridorController, type CorridorControllerDeps } from '../world/corridor-controller';
import { OsmStreetService, StreetNetwork, StreetNode } from '../location/osm-street.service';
import type { SpawnPoint } from '../world/marker-visualization.service';
import { METERS_PER_DEGREE_LAT, DEG_TO_RAD } from '../../utils/geo-utils';
import type { ThreeTilesEngine } from '../../three-engine';
import type { StationProbe } from '../../utils/route-corridor';

const ORIGIN = { lat: 48.0, lon: 9.0 };
const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(ORIGIN.lat * DEG_TO_RAD);
const HQ = { lat: 48.0011, lon: 9.0025 };
const SPAWN: SpawnPoint = { id: 'spawn-1', name: 'Spawn', color: 0xff0000, lat: 47.9993, lon: 9.0 };

/** The L-shaped street of path-route.service.spec: south to north, then east. */
function makeNetwork(): StreetNetwork {
  const n10 = { id: 10, lat: 47.999, lon: 9.0 };
  const n1 = { id: 1, lat: 48.0, lon: 9.0 };
  const n2 = { id: 2, lat: 48.001, lon: 9.0 };
  const n3 = { id: 3, lat: 48.001, lon: 9.0015 };
  const n30 = { id: 30, lat: 48.001, lon: 9.003 };
  const streets = [
    { id: 100, nodes: [n10, n1] },
    { id: 200, nodes: [n1, n2, n3] },
    { id: 300, nodes: [n3, n30] },
  ];
  const nodes = new Map<number, StreetNode>();
  for (const s of streets) for (const n of s.nodes) nodes.set(n.id, n);
  return {
    streets: streets.map((s) => ({ ...s, name: `Way ${s.id}`, type: 'residential' })),
    nodes,
    bounds: { minLat: 47.99, maxLat: 48.01, minLon: 8.99, maxLon: 9.01 },
  } as StreetNetwork;
}

describe('Moving the HQ while the corridor is measured (playtest 543)', () => {
  let clock: number;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let game: { towers: number; enemies: number; phase: string };
  let lockCorridor: ((reason: 'tower' | 'wave') => void) | null;
  let status: RelocationStatusService;
  let relocation: MapRelocationService;
  let host: RelocationHost;
  let warn: ReturnType<typeof vi.spyOn>;

  /** One animation frame: what was requested before it runs, what it requests waits. */
  const runFrame = () => {
    const due = [...frames.values()];
    frames.clear();
    for (const callback of due) callback(clock);
  };
  const lines = (): string[] => warn.mock.calls.map((call: unknown[]) => String(call[0]));

  /** A click in map placement mode on the HQ spot; the hint paints first (two frames). */
  const moveHq = async () => {
    const moving = relocation.applyPlacementClick(host);
    runFrame();
    runFrame();
    await moving;
  };

  beforeEach(() => {
    clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
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
      terrain: {
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
      // RelocationStatusService's
      NgZone: { runOutsideAngular: (fn: () => unknown) => fn() },
      // MapRelocationService's
      OsmStreetService: { findPath: () => [SPAWN, HQ], findRandomStreetPoint: () => null, haversineDistance: () => 0 },
      MarkerVisualizationService: { clearAllMarkers: vi.fn(), clearSpawnMarkers: vi.fn(), addBaseMarker: vi.fn(), setPortalHeading: vi.fn() },
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

    // The game: towers, enemies (Enemy Debug places them idle, no wave) and the corridor lock
    game = { towers: 0, enemies: 0, phase: 'setup' };
    lockCorridor = null;
    const grid = {
      clear: vi.fn(),
      updateTerrainHeights: vi.fn(),
      getStats: () => ({ totalCells: 0 }),
      initSpatialGridVisualizationIfEnabled: vi.fn(),
      initAirSpatialGridVisualizationIfEnabled: vi.fn(),
      initAirRouteLayerIfEnabled: vi.fn(),
    };
    const controller = new CorridorController({
      gameState: () => ({
        towerCount: () => game.towers,
        enemyManager: { getAliveCount: () => game.enemies },
        waveManager: { phase: () => game.phase },
        getGlobalRouteGrid: () => grid,
        initializeGlobalRouteGrid: vi.fn(),
        // GameStateManager calls it right before a tower is placed (TowerLifecycle) or a wave starts
        setBeforeCorridorLock: (hook: ((reason: 'tower' | 'wave') => void) | null) => { lockCorridor = hook; },
      }),
      engineInit: { getEngine: () => engine },
      introFlight: { isRunning: () => false },
      pathRoute,
      routeAnimation: { isRunning: () => false, startAnimation: vi.fn() },
      store: { spawnPoints: store.spawnPoints },
      // The hint of the move: the run measures in the larger slices while it stands
      relocationStatus: status,
    } as unknown as CorridorControllerDeps);
    controller.attach();

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
        fitCorridorToTiles: () => controller.fitToTiles(),
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a tower built during the measurement: hint gone at once, "flushed=tower", then "ended=commit"', async () => {
    await moveHq();
    expect(status.status()).toMatchObject({ title: 'Moving HQ', step: MEASURING_STEP });
    runFrame();
    const measuring = status.status()!.percent!;
    expect(measuring).toBeGreaterThan(0);
    expect(measuring).toBeLessThan(100);

    // Build: the corridor lock comes first, then the tower stands
    lockCorridor!('tower');
    game.towers = 1;
    const flushed = lines().findIndex((l) => /^\[Corridor\] clearance: .* flushed=tower$/.test(l));
    expect(flushed).toBeGreaterThanOrEqual(0);

    runFrame();
    expect(status.status()).toBeNull();
    const done = lines().findIndex((l) => l.startsWith('[Relocation] HQ done:'));
    expect(lines()[done]).toMatch(/ ended=commit$/);
    expect(done).toBeGreaterThan(flushed);
    expect(lines().some((l) => l.startsWith('[Corridor] clearance cancelled'))).toBe(false);
  });

  it('a zombie placed through Enemy Debug during the measurement: hint gone, "cancelled (enemies are on the map)", "ended=cancel"', async () => {
    // A move before, its tower sold
    await moveHq();
    lockCorridor!('tower');
    runFrame();
    game.towers = 0;
    warn.mockClear();

    await moveHq();
    runFrame();
    expect(status.status()).toMatchObject({ step: MEASURING_STEP });

    // debug:spawn-enemy puts it idle on the route; no wave starts
    game.enemies = 1;
    runFrame();
    runFrame();

    expect(status.status()).toBeNull();
    const cancelled = lines().findIndex((l) => /^\[Corridor\] clearance cancelled \(enemies are on the map\): /.test(l));
    expect(cancelled).toBeGreaterThanOrEqual(0);
    const done = lines().findIndex((l) => l.startsWith('[Relocation] HQ done:'));
    expect(lines()[done]).toMatch(/ ended=cancel$/);
    expect(done).toBeGreaterThan(cancelled);
  });
});
