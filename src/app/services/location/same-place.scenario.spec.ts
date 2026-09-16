import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Injector, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Group, Vector2 } from 'three';
import { Subject } from 'rxjs';

// The real dialog and material modules are partially compiled and need the JIT
// compiler; the coordinator only opens the dialog, each test gives its result.
vi.mock('@angular/material/dialog', () => ({ MatDialog: class MatDialog {} }));
vi.mock('../../components/location-dialog/location-dialog.component', () => ({
  LocationDialogComponent: class LocationDialogComponent {},
}));

import { UrlLocationService } from './url-location.service';
import { LocationManagementService } from './location-management.service';
import { LocationChangeCoordinatorService } from './location-change-coordinator.service';
import { LocationChangeExecutorService } from './location-change-executor.service';
import { GeocodingService } from './geocoding.service';
import { GeolocationService } from './geolocation.service';
import { OsmStreetService, StreetNetwork } from './osm-street.service';
import { WorldDiceService } from './world-dice.service';
import { FAVORITES_KEY } from './favorite-locations';
import { RECENT_LOCATIONS_KEY, loadRecentLocations } from './recent-locations';
import { LocationFacadeService, VizCallbacks } from '../facade/location-facade.service';
import { MapRelocationService } from '../facade/map-relocation.service';
import { MapPlacementService } from '../world/map-placement.service';
import { MarkerVisualizationService, SpawnPoint } from '../world/marker-visualization.service';
import { PathAndRouteService } from '../world/path-route.service';
import { HeightUpdateService } from '../world/height-update.service';
import { RouteAnimationService } from '../world/route-animation.service';
import { IntroCameraFlightService } from '../world/intro-camera-flight.service';
import { StreetRenderingService } from '../world/street-rendering.service';
import { RelocationStatusService } from '../world/relocation-status.service';
import { EngineInitializationService } from '../infrastructure/engine-initialization.service';
import { CameraControlService } from '../camera-control.service';
import { CameraFramingService } from '../camera-framing.service';
import { KeyboardPanService } from '../keyboard-pan.service';
import { DebugFacadeService } from '../debug/debug-facade.service';
import { DevWorldService } from '../../devworld/devworld.service';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { UIStore } from '../../store/ui.store';
import { haversineDistance } from '../../utils/geo-utils';
import { makeGeoToLocal, fakePortalPreview } from '../../../test/portal-preview-fixture';
import type { FacadeComponentBridge } from '../facade/tower-defense-facade.service';
import type { GameStateManager } from '../../managers/game-state.manager';
import type { ThreeTilesEngine } from '../../three-engine';
import type { FavoriteLocation, LocationDialogResult } from '../../models/location.types';
import type { CorridorBuildResult } from '../world/corridor-build';

/**
 * Playtest 747 (a): Rothenburg ob der Tauber loaded cold from its URL stood
 * at HQ 49.37721, 10.17904; loaded again after a trip to Binswangen, with
 * every digit, at 49.377211325234484, 10.179041659717791.
 * 0.19 m (the spawn 0.16 m) moved the cell grid against the world, and the
 * same tiles gave another corridor (fingerprint af3f120a against 1ead05fb).
 * Expected: every way into the place gives the engine origin, the HQ, the
 * spawn, the location and the URL exactly as the URL does.
 *
 * Real: the location services from the URL, the stored places, the dialog
 * result and the map click to the origin and the spawn (UrlLocationService,
 * LocationManagementService, LocationFacadeService, the coordinator and the
 * executor of a location change, MapPlacementService, MapRelocationService).
 * Fakes: engine, streets (one street from the spawn to the HQ), routes,
 * markers, loading screen, game state.
 */

/** The cold load's URL, and HQ and spawn as it gives them */
const URL_SEARCH = '?l=49.37721,10.17904&s=49.37944,10.18365';
const HQ = { lat: 49.37721, lon: 10.17904 };
const SPAWN = { lat: 49.37944, lon: 10.18365 };
/** HQ and spawn of the load after the trip, with every digit */
const FULL_HQ = { lat: 49.377211325234484, lon: 10.179041659717791 };
const FULL_SPAWN = { lat: 49.379440871377206, lon: 10.18365173337133 };
/** Binswangen, where the player came from */
const ELSEWHERE_SEARCH = '?l=49.17337,9.26851&s=49.17555,9.26387';
/** Another HQ and spawn in Rothenburg's streets, where the clicks start from */
const NEARBY_SEARCH = '?l=49.37800,10.18000&s=49.38100,10.18600';

/** Rothenburg as the URL loads it: see place() */
const AS_FROM_URL = {
  origin: HQ,
  hq: HQ,
  spawns: [SPAWN],
  location: { hq: HQ, spawns: [SPAWN] },
  url: URL_SEARCH,
};

/** A street from the spawn to the HQ */
const STREET = [
  { id: 1, ...SPAWN },
  { id: 2, lat: 49.3783, lon: 10.1813 },
  { id: 3, ...HQ },
];
const STREET_WAY = { id: 70, name: 'Galgengasse', type: 'residential', nodes: STREET };
const NETWORK = {
  streets: [STREET_WAY],
  nodes: new Map(STREET.map((node) => [node.id, node])),
  bounds: { minLat: 49.36, maxLat: 49.4, minLon: 10.16, maxLon: 10.2 },
} as unknown as StreetNetwork;

describe('One place, one set of coordinates (playtest 747 a)', () => {
  let facade: LocationFacadeService;
  let coordinator: LocationChangeCoordinatorService;
  let locationMgmt: LocationManagementService;
  let mapPlacement: MapPlacementService;
  let origins: { lat: number; lon: number }[];
  let cachedPaths: Map<string, unknown[]>;
  let streetNetwork: StreetNetwork | null;
  let streetNetworkLocation: { lat: number; lon: number } | null;
  let dialogClosed: Subject<LocationDialogResult | null>;
  let randomSpawn: { lat: number; lon: number } | null;
  let store: {
    baseCoords: ReturnType<typeof signal<{ lat: number; lon: number }>>;
    centerCoords: ReturnType<typeof signal<{ lat: number; lon: number; height: number }>>;
    spawnPoints: ReturnType<typeof signal<SpawnPoint[]>>;
    streetCount: ReturnType<typeof signal<number>>;
    heightDebugVisible: ReturnType<typeof signal<boolean>>;
    phase: ReturnType<typeof signal<string>>;
    waveNumber: ReturnType<typeof signal<number>>;
  };

  const point = ({ lat, lon }: { lat: number; lon: number }) => ({ lat, lon });

  /** Where the place stands: engine origin, base and spawns in the store, the location service, the URL */
  const place = () => ({
    origin: origins.at(-1),
    hq: point(store.baseCoords()),
    spawns: store.spawnPoints().map(point),
    location: { hq: locationMgmt.hq() && point(locationMgmt.hq()!), spawns: locationMgmt.spawns().map(point) },
    url: window.location.search,
  });

  /**
   * A page load on `search`, as TowerDefenseFacadeService boots: the location,
   * the engine on the base coords, the streets around them, the spawns, the
   * map placement on the new HQ.
   */
  const loadPage = async (search: string) => {
    window.history.replaceState({}, '', `/${search}`);
    expect(await facade.initializeLocation()).toBe(true);
    origins.push(point(store.baseCoords()));
    streetNetwork = NETWORK;
    facade.addPredefinedSpawns();
    mapPlacement.initialize(engine as unknown as ThreeTilesEngine, NETWORK, store.baseCoords());
  };

  /** A click in map placement mode at (lat, lon), after the cursor moved there. */
  const click = async (mode: 'hq' | 'spawn', at: { lat: number; lon: number }) => {
    facade.startMapPlacement(mode);
    mapPlacement.updatePreviewPosition(at.lat, at.lon, 0);
    await facade.handleMapPlacementClick(at.lat, at.lon, 0);
  };

  const overlay = new Group();
  const engine = {
    setOrigin: vi.fn((lat: number, lon: number) => origins.push({ lat, lon })),
    getCamera: () => ({ aspect: 1.5, fov: 50 }),
    // Tiles are "loaded" the moment the change waits for them
    setOnFirstTilesLoadedCallback: (cb: () => void) => cb(),
    getOverlayGroup: () => overlay,
    getTerrainHeightAtGeo: () => 0,
    getRenderer: () => ({ getSize: (target: Vector2) => target.set(1600, 900) }),
    sync: { geoToLocalSimple: makeGeoToLocal(HQ) },
    getDevTerrainProvider: () => null,
  };
  const bridge = {
    getEngine: () => engine,
    getStreetNetwork: () => streetNetwork,
    setStreetNetwork: (network: StreetNetwork | null) => { streetNetwork = network; },
    getStreetNetworkLocation: () => streetNetworkLocation,
    setStreetNetworkLocation: (at: { lat: number; lon: number } | null) => { streetNetworkLocation = at; },
    setFilteredStreetNetwork: vi.fn(),
  };
  const routeGrid = {
    clear: vi.fn(),
    initSpatialGridVisualizationIfEnabled: vi.fn(),
    initAirSpatialGridVisualizationIfEnabled: vi.fn(),
    initAirRouteLayerIfEnabled: vi.fn(),
  };
  const gameState = {
    reset: vi.fn(),
    initialize: vi.fn(),
    initializeGlobalRouteGrid: vi.fn(),
    getGlobalRouteGrid: () => routeGrid,
  };
  const vizCallbacks: VizCallbacks = {
    initializeTowerPlacement: vi.fn(),
    filterStreetNetworkToRoutes: vi.fn(),
    scheduleOverlayHeightUpdate: vi.fn(async () => undefined),
    initializeVisualizationServices: vi.fn(),
    reframeCameraWithRoutes: vi.fn(),
    renderStreets: vi.fn(),
    saveInitialCameraPosition: vi.fn(),
    // Built and frozen; what it built does not matter here
    buildCorridor: vi.fn(async () => ({}) as CorridorBuildResult),
  };

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    localStorage.clear();
    origins = [];
    cachedPaths = new Map();
    streetNetwork = null;
    streetNetworkLocation = null;
    dialogClosed = new Subject();
    randomSpawn = null;
    store = {
      baseCoords: signal({ lat: 0, lon: 0 }),
      centerCoords: signal({ lat: 0, lon: 0, height: 400 }),
      spawnPoints: signal<SpawnPoint[]>([]),
      streetCount: signal(0),
      heightDebugVisible: signal(false),
      phase: signal('setup'),
      waveNumber: signal(0),
    };

    const osm = {
      loadStreets: vi.fn(async () => NETWORK),
      findRandomStreetPoint: vi.fn(() => randomSpawn && { ...randomSpawn, distance: 416, streetName: 'Galgengasse', nodeId: 1 }),
      findPath: vi.fn(() => STREET),
      haversineDistance: (lat1: number, lon1: number, lat2: number, lon2: number) => haversineDistance(lat1, lon1, lat2, lon2),
      findNearestStreetPoint: vi.fn(() => ({ distance: 2, street: STREET_WAY, nodeIndex: 0 })),
      // The route from a spawn at (lat, lon): from there along the street to the HQ
      segmentRoutes: vi.fn(() => ({ routeFrom: (lat: number, lon: number) => [{ id: -1, lat, lon }, ...STREET.slice(1)] })),
    };
    const pathRoute = {
      initialize: vi.fn(),
      clearCache: vi.fn(() => cachedPaths.clear()),
      clearAllRoutes: vi.fn(),
      clearCachedPaths: vi.fn(() => cachedPaths.clear()),
      showPathFromSpawn: vi.fn((spawn: SpawnPoint) => cachedPaths.set(spawn.id, STREET)),
      getCachedPaths: () => cachedPaths,
      getRouteDetail: () => '0.4 km',
      hasRoutes: () => cachedPaths.size > 0,
    };
    const markerViz = {
      initialize: vi.fn(),
      addBaseMarker: vi.fn(),
      addSpawnMarker: vi.fn(),
      clearAllMarkers: vi.fn(),
      clearSpawnMarkers: vi.fn(),
      setPortalHeading: vi.fn(),
      placeSpawnPortal: vi.fn(),
      createDiamondMarker: vi.fn(({ color }: { color: number }) => fakePortalPreview(color)),
      createPortalPreview: vi.fn(fakePortalPreview),
      disposePreviewMarker: vi.fn(),
    };
    const engineInit = {
      loading: signal(false),
      tilesLoading: signal(false),
      osmLoading: signal(false),
      resetLoadingSteps: vi.fn(),
      setStepCurrent: vi.fn(async () => undefined),
      setStepDone: vi.fn(async () => undefined),
      updateStepMeta: vi.fn(),
      setError: vi.fn(),
      setLoading: vi.fn(),
      getEngine: () => engine,
    };
    const dialog = { open: vi.fn(() => ({ afterClosed: () => dialogClosed.asObservable(), close: vi.fn() })) };

    const injector: Injector = Injector.create({
      providers: [
        { provide: OsmStreetService, useValue: osm },
        { provide: PathAndRouteService, useValue: pathRoute },
        { provide: MarkerVisualizationService, useValue: markerViz },
        { provide: EngineInitializationService, useValue: engineInit },
        { provide: HeightUpdateService, useValue: { heightsLoading: signal(false), stopHeightUpdates: vi.fn() } },
        { provide: CameraControlService, useValue: { initialize: vi.fn() } },
        { provide: CameraFramingService, useValue: { computeInitialFrame: vi.fn(), setEngine: vi.fn(), applyFrame: vi.fn() } },
        { provide: RouteAnimationService, useValue: { initialize: vi.fn(), stopAnimation: vi.fn(), startAnimation: vi.fn(), isRunning: () => false } },
        { provide: IntroCameraFlightService, useValue: { initialize: vi.fn(), stop: vi.fn(), start: vi.fn(), isRunning: () => false } },
        { provide: KeyboardPanService, useValue: { initialize: vi.fn() } },
        { provide: GeocodingService, useValue: { reverseGeocodeDetailed: async () => null, reverseGeocodeWithCache: async () => 'Rothenburg' } },
        { provide: GeolocationService, useValue: { detectLocation: async () => null } },
        { provide: WorldDiceService, useValue: {} },
        { provide: DevWorldService, useValue: { isActive: false } },
        { provide: StreetRenderingService, useValue: { dispose: vi.fn() } },
        { provide: DebugFacadeService, useValue: { appendDebugLog: vi.fn() } },
        {
          provide: RelocationStatusService,
          useValue: { show: vi.fn(), clear: vi.fn(), painted: async () => undefined, follow: () => ({ report: vi.fn(), end: vi.fn() }) },
        },
        { provide: MatDialog, useValue: dialog },
        { provide: TowerDefenseStore, useValue: store },
        { provide: UIStore, useValue: { routesVisible: signal(true), notice: signal(null), mapPlacementMode: signal(null) } },
        // The real services, as factories: a class provider would need the JIT compiler
        { provide: UrlLocationService, useFactory: () => new UrlLocationService() },
        { provide: LocationManagementService, useFactory: () => new LocationManagementService() },
        { provide: LocationChangeExecutorService, useFactory: () => new LocationChangeExecutorService() },
        { provide: LocationChangeCoordinatorService, useFactory: () => new LocationChangeCoordinatorService() },
        { provide: MapPlacementService, useFactory: () => new MapPlacementService() },
        { provide: MapRelocationService, useFactory: () => new MapRelocationService() },
        { provide: LocationFacadeService, useFactory: () => new LocationFacadeService() },
      ],
    });
    facade = injector.get(LocationFacadeService);
    coordinator = injector.get(LocationChangeCoordinatorService);
    locationMgmt = injector.get(LocationManagementService);
    mapPlacement = injector.get(MapPlacementService);
    facade.initialize(bridge as unknown as FacadeComponentBridge, gameState as unknown as GameStateManager, injector);
    facade.initializeCoordinator(vizCallbacks);
  });

  afterEach(() => {
    window.history.replaceState({}, '', '/');
    vi.restoreAllMocks();
  });

  it('747: the URL loads Rothenburg on its own digits', async () => {
    await loadPage(URL_SEARCH);
    expect(place()).toEqual(AS_FROM_URL);
  });

  it('747: a favorite saved with every digit loads Rothenburg as its URL does', async () => {
    const favorite: FavoriteLocation = { id: 'rothenburg', hq: FULL_HQ, spawns: [FULL_SPAWN], createdAt: 1 };
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([favorite]));
    locationMgmt.loadFavorites();
    await loadPage(ELSEWHERE_SEARCH);

    await coordinator.onSelectFavorite(locationMgmt.favorites()[0]);

    expect(place()).toEqual(AS_FROM_URL);
  });

  it('747: a recent place stored with every digit, picked in the dialog, loads Rothenburg as its URL does', async () => {
    localStorage.setItem(RECENT_LOCATIONS_KEY, JSON.stringify([
      { hq: FULL_HQ, spawns: [FULL_SPAWN], name: 'Rothenburg ob der Tauber', visitedAt: 1 },
    ]));
    await loadPage(ELSEWHERE_SEARCH);

    await coordinator.openLocationDialog();
    // What the dialog closes with for that row (LocationDialogComponent.loadRecent), the world map alike
    const recent = loadRecentLocations()[0];
    dialogClosed.next({
      hq: { lat: recent.hq.lat, lon: recent.hq.lon, name: recent.name, displayName: recent.name },
      spawn: { id: 'spawn_recent', lat: recent.spawns[0].lat, lon: recent.spawns[0].lon, isRandom: false },
      confirmed: true,
    });
    // The change moved the origin, then ran to its end
    await vi.waitFor(() => expect(origins).toHaveLength(2));
    await vi.waitFor(() => expect(locationMgmt.isApplyingLocation()).toBe(false));

    expect(place()).toEqual(AS_FROM_URL);
  });

  it('747: a spawn drawn at random on a street node stands where its URL puts it after a reload', async () => {
    randomSpawn = FULL_SPAWN;
    await loadPage('?l=49.37721,10.17904');

    expect(place()).toEqual(AS_FROM_URL);
  });

  it('747: HQ and spawn clicked on the map on those points stand where the URL puts them', async () => {
    await loadPage(NEARBY_SEARCH);

    await click('hq', FULL_HQ);
    await click('spawn', FULL_SPAWN);

    expect(place()).toEqual(AS_FROM_URL);
  });
});
