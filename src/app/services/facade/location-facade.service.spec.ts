import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Subject } from 'rxjs';

// The real dialog and material modules are partially compiled and need the JIT
// compiler; the facade only uses them as DI token and dialog type.
vi.mock('@angular/material/dialog', () => ({ MatDialog: class MatDialog {} }));
// With `fails` set, the dialog's lazy chunk does not load.
const chunk = vi.hoisted(() => ({ fails: false, component: class LocationDialogComponent {} }));
vi.mock('../../components/location-dialog/location-dialog.component', () => ({
  get LocationDialogComponent() {
    if (chunk.fails) throw new TypeError('Failed to fetch dynamically imported module');
    return chunk.component;
  },
}));

// The street lookup has its own spec; the network here is a stub without real
// streets, so every real-map spawn reads as the street 'Damrak'.
vi.mock('../../utils/spawn-label', () => ({ spawnLabel: vi.fn(() => 'Damrak') }));

import { LocationFacadeService, VizCallbacks } from './location-facade.service';
import { MapRelocationService } from './map-relocation.service';
import { OsmStreetService } from '../location/osm-street.service';
import { MarkerVisualizationService, SpawnPoint } from '../world/marker-visualization.service';
import { PathAndRouteService } from '../world/path-route.service';
import { LocationManagementService } from '../location/location-management.service';
import { HeightUpdateService } from '../world/height-update.service';
import { EngineInitializationService } from '../infrastructure/engine-initialization.service';
import { GeolocationService } from '../location/geolocation.service';
import { UrlLocationService } from '../location/url-location.service';
import { DevWorldService, DEV_WORLD_ORIGIN } from '../../devworld/devworld.service';
import { RouteAnimationService } from '../world/route-animation.service';
import { StreetRenderingService } from '../world/street-rendering.service';
import { WaveDebugService } from '../debug/wave-debug.service';
import { DebugFacadeService } from '../debug/debug-facade.service';
import { LocationChangeCoordinatorService, LocationFlowDelegate } from '../location/location-change-coordinator.service';
import { MapPlacementService } from '../world/map-placement.service';
import { RelocationStatusService } from '../world/relocation-status.service';
import { TowerPlacementService } from '../tower-placement.service';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { LocationDialogComponent } from '../../components/location-dialog/location-dialog.component';
import {
  LOCATION_DIALOG_LOAD_FAILED,
  LOCATION_DIALOG_OPEN_FAILED,
  LocationDialogLoadError,
} from '../../components/location-dialog/open-location-dialog';
import { SPAWN_COLORS } from '../../configs/map-constants.config';
import type { FacadeComponentBridge } from './tower-defense-facade.service';
import type { GameStateManager } from '../../managers/game-state.manager';
import type { LocationDialogResult } from '../../models/location.types';
import type { DevTerrainProvider } from '../../devworld/dev-terrain.provider';

/**
 * The location sub-facade decides where the game starts (DevWorld, URL,
 * browser location, dialog), creates the spawns, moves HQ or spawn in place
 * when the click stays inside the loaded streets (a full location change via
 * the coordinator otherwise) and rebuilds the DevWorld after regeneration.
 * These tests pin those decisions and what each path does to the store and
 * its collaborators.
 */

const HQ = { lat: 48.7758, lon: 9.1829 };
const BOUNDS = { minLat: 48.7, maxLat: 48.9, minLon: 9.1, maxLon: 9.3 };
const INSIDE = { lat: 48.78, lon: 9.19 };
const OUTSIDE = { lat: 49.5, lon: 9.19 };
const OLD_SPAWN: SpawnPoint = { id: 'spawn-1', name: 'Damrak', lat: 48.79, lon: 9.2, color: SPAWN_COLORS[0] };

interface Spawn { lat: number; lon: number }

describe('LocationFacadeService', () => {
  let facade: LocationFacadeService;
  let streetNetwork: { streets: unknown[]; bounds: typeof BOUNDS } | null;
  let cachedPaths: Map<string, unknown[]>;
  let dialogClosed: Subject<LocationDialogResult | null>;
  let destroyCallbacks: (() => void)[];
  let destroyRef: { destroyed: boolean; onDestroy: (cb: () => void) => () => void };
  let vizCallbacks: { [K in keyof VizCallbacks]: ReturnType<typeof vi.fn> };

  const overlay = { name: 'overlay' };
  const engine = {
    getOverlayGroup: vi.fn(() => overlay),
    setOrigin: vi.fn(),
    getDevTerrainProvider: vi.fn((): unknown => null),
    terrain: { clearHeightCache: vi.fn() },
  };
  const bridge = {
    getEngine: vi.fn((): unknown => engine),
    getStreetNetwork: vi.fn(() => streetNetwork),
    getStreetNetworkLocation: vi.fn(() => ({ ...HQ })),
    setStreetNetwork: vi.fn(),
    setStreetNetworkLocation: vi.fn(),
    setFilteredStreetNetwork: vi.fn(),
  };
  const routeGrid = { disposeVisualization: vi.fn(), clear: vi.fn() };
  const gameState = {
    reset: vi.fn(),
    initialize: vi.fn(),
    initializeGlobalRouteGrid: vi.fn(),
    getGlobalRouteGrid: () => routeGrid,
    onTilesLoaded: vi.fn(),
    reseatWavePipeline: vi.fn(),
  };

  const osm = {
    loadStreets: vi.fn(),
    findRandomStreetPoint: vi.fn(),
    findPath: vi.fn(),
    haversineDistance: vi.fn(() => 0),
  };
  const markerViz = {
    addSpawnMarker: vi.fn(),
    clearAllMarkers: vi.fn(),
    clearSpawnMarkers: vi.fn(),
    addBaseMarker: vi.fn(),
    updateMarkerHeights: vi.fn(),
    setPortalHeading: vi.fn(),
  };
  const pathRoute = {
    showPathFromSpawn: vi.fn(),
    clearAllRoutes: vi.fn(),
    clearCachedPaths: vi.fn(),
    getCachedPaths: vi.fn(() => cachedPaths),
    refreshRouteLines: vi.fn(),
  };
  const locationMgmt = {
    hq: signal<Spawn | null>(null),
    spawns: signal<Spawn[]>([]),
    needsRandomSpawn: signal(false),
    editableSpawnLocations: signal<{ id: string; name: string; lat: number; lon: number; portalBearing?: number }[]>([]),
    setLocation: vi.fn((hq: Spawn, spawns: Spawn[]) => {
      locationMgmt.hq.set(hq);
      locationMgmt.spawns.set(spawns);
    }),
    setGeneratedSpawns: vi.fn(),
    getLocationDisplayName: vi.fn(() => 'Stuttgart'),
  };
  const heightUpdate = { stopHeightUpdates: vi.fn() };
  const engineInit = {
    setStepCurrent: vi.fn(async (_id: string) => undefined),
    setStepDone: vi.fn(async (_id: string, _meta?: string) => undefined),
    updateStepMeta: vi.fn(),
    getEngine: vi.fn((): unknown => null),
    setError: vi.fn(),
    setLoading: vi.fn(),
  };
  const geolocation = { onStepDetail: null as ((d: string) => void) | null, detectLocation: vi.fn() };
  const urlLocation = { parseFromUrl: vi.fn(), updateUrl: vi.fn() };
  const devWorld = {
    isActive: false,
    config: { spawn: 'north' },
    localToGeo: vi.fn((x: number, z: number) => ({ lat: z / 1000, lon: x / 1000 })),
    getSpawnPosition: vi.fn(() => ({ x: 10, z: 20 })),
  };
  const routeAnimation = { stopAnimation: vi.fn(), startAnimation: vi.fn() };
  const streetRendering = { dispose: vi.fn() };
  const debugFacade = { appendDebugLog: vi.fn() };
  const coordinator = { initializeFlow: vi.fn(), applyNewLocation: vi.fn(async () => undefined) };
  const mapPlacement = { startPlacement: vi.fn(), handlePlacementClick: vi.fn(), updateDependencies: vi.fn() };
  const dialog = { open: vi.fn() };
  const closeDialog = vi.fn();
  let store: {
    baseCoords: ReturnType<typeof signal<Spawn>>;
    centerCoords: ReturnType<typeof signal<Spawn & { height: number }>>;
    spawnPoints: ReturnType<typeof signal<SpawnPoint[]>>;
    streetCount: ReturnType<typeof signal<number>>;
    heightDebugVisible: ReturnType<typeof signal<boolean>>;
    phase: ReturnType<typeof signal<string>>;
    waveNumber: ReturnType<typeof signal<number>>;
    isDevWorldRegenerating: ReturnType<typeof signal<boolean>>;
  };

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  /** The dialog opens once its lazy chunk has loaded. */
  const dialogOpened = () => vi.waitFor(() => expect(dialog.open).toHaveBeenCalled());
  const delegate = (): LocationFlowDelegate => coordinator.initializeFlow.mock.calls[0][0];
  /** The spawn points the facade put into the store, by id. */
  const spawnIds = () => store.spawnPoints().map((s) => s.id);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    streetNetwork = { streets: [{}], bounds: BOUNDS };
    cachedPaths = new Map([['spawn-1', [HQ, OLD_SPAWN]]]);
    dialogClosed = new Subject();
    dialog.open.mockReturnValue({ afterClosed: () => dialogClosed.asObservable(), close: closeDialog });
    chunk.fails = false;
    destroyCallbacks = [];
    destroyRef = {
      destroyed: false,
      onDestroy: (cb) => {
        destroyCallbacks.push(cb);
        return () => { destroyCallbacks = destroyCallbacks.filter((c) => c !== cb); };
      },
    };
    bridge.getEngine.mockImplementation(() => engine);
    engineInit.getEngine.mockImplementation(() => null);
    engine.getDevTerrainProvider.mockImplementation(() => null);
    osm.findRandomStreetPoint.mockReturnValue(null);
    osm.findPath.mockReturnValue([OLD_SPAWN, HQ]);
    osm.haversineDistance.mockReturnValue(0);
    mapPlacement.handlePlacementClick.mockReturnValue(null);
    urlLocation.parseFromUrl.mockReturnValue(null);
    geolocation.onStepDetail = null;
    devWorld.isActive = false;
    locationMgmt.hq.set(null);
    locationMgmt.spawns.set([]);
    locationMgmt.needsRandomSpawn.set(false);
    locationMgmt.editableSpawnLocations.set([]);

    store = {
      baseCoords: signal({ ...HQ }),
      centerCoords: signal({ ...HQ, height: 400 }),
      spawnPoints: signal<SpawnPoint[]>([]),
      streetCount: signal(0),
      heightDebugVisible: signal(false),
      phase: signal('setup'),
      waveNumber: signal(0),
      isDevWorldRegenerating: signal(false),
    };
    vizCallbacks = {
      initializeTowerPlacement: vi.fn(),
      filterStreetNetworkToRoutes: vi.fn(),
      scheduleOverlayHeightUpdate: vi.fn(async () => undefined),
      initializeVisualizationServices: vi.fn(),
      reframeCameraWithRoutes: vi.fn(),
      renderStreets: vi.fn(),
      saveInitialCameraPosition: vi.fn(),
      buildCorridor: vi.fn(async () => ({ stations: 0, unmeasured: 0, passes: 1, timedOut: false, fallbackStations: 0, fallbackCells: 0, cells: 0, ms: 0 })),
    };

    const injector = Injector.create({
      providers: [
        { provide: OsmStreetService, useValue: osm },
        { provide: MarkerVisualizationService, useValue: markerViz },
        { provide: PathAndRouteService, useValue: pathRoute },
        { provide: LocationManagementService, useValue: locationMgmt },
        { provide: HeightUpdateService, useValue: heightUpdate },
        { provide: EngineInitializationService, useValue: engineInit },
        { provide: GeolocationService, useValue: geolocation },
        { provide: UrlLocationService, useValue: urlLocation },
        { provide: DevWorldService, useValue: devWorld },
        { provide: RouteAnimationService, useValue: routeAnimation },
        { provide: StreetRenderingService, useValue: streetRendering },
        { provide: WaveDebugService, useValue: {} },
        { provide: DebugFacadeService, useValue: debugFacade },
        { provide: LocationChangeCoordinatorService, useValue: coordinator },
        { provide: MapPlacementService, useValue: mapPlacement },
        // The hint while the HQ moves; map-relocation.service.spec.ts covers it
        {
          provide: RelocationStatusService,
          useValue: {
            show: vi.fn(), clear: vi.fn(), painted: vi.fn(async () => undefined),
            follow: vi.fn(() => ({ report: vi.fn(), end: vi.fn() })),
          },
        },
        { provide: TowerPlacementService, useValue: {} },
        { provide: MatDialog, useValue: dialog },
        { provide: TowerDefenseStore, useValue: store },
        // The real relocation flows, on the mocks above; a factory, since a
        // class provider would need the JIT compiler.
        { provide: MapRelocationService, useFactory: () => new MapRelocationService() },
      ],
    });
    facade = runInInjectionContext(injector, () => new LocationFacadeService());
    facade.initialize(
      bridge as unknown as FacadeComponentBridge,
      gameState as unknown as GameStateManager,
      { get: () => destroyRef } as unknown as Injector,
    );
  });

  afterEach(() => vi.restoreAllMocks());

  describe('coordinator delegate', () => {
    beforeEach(() => facade.initializeCoordinator(vizCallbacks as unknown as VizCallbacks));

    it('has no change context without an engine', () => {
      bridge.getEngine.mockReturnValue(null);
      expect(delegate().getChangeContext()).toBeNull();
    });

    it('builds the change context from the bridge and the store', () => {
      expect(delegate().getChangeContext()).toEqual({
        engine,
        gameState,
        streetNetwork,
        streetNetworkLocation: HQ,
        heightDebugVisible: store.heightDebugVisible,
      });
    });

    it('routes the change callbacks to the store, the bridge and the viz facade', async () => {
      const cb = delegate().getChangeCallbacks();

      cb.setBaseCoords(INSIDE);
      cb.setCenterCoords({ ...INSIDE, height: 400 });
      cb.setSpawnPoints([OLD_SPAWN]);
      cb.setStreetCount(12);
      cb.setStreetNetwork(null);
      cb.setStreetNetworkLocation(INSIDE);
      cb.appendDebugLog('hello');
      cb.initializeTowerPlacement();
      cb.filterStreetNetworkToRoutes();
      await cb.scheduleOverlayHeightUpdate();

      expect(store.baseCoords()).toEqual(INSIDE);
      expect(store.centerCoords()).toEqual({ ...INSIDE, height: 400 });
      expect(cb.getSpawnPoints()).toEqual([OLD_SPAWN]);
      expect(cb.getBaseCoords()).toEqual(INSIDE);
      expect(store.streetCount()).toBe(12);
      expect(bridge.setStreetNetwork).toHaveBeenCalledWith(null);
      expect(bridge.setStreetNetworkLocation).toHaveBeenCalledWith(INSIDE);
      expect(debugFacade.appendDebugLog).toHaveBeenCalledWith('hello');
      expect(vizCallbacks.initializeTowerPlacement).toHaveBeenCalled();
      expect(vizCallbacks.filterStreetNetworkToRoutes).toHaveBeenCalled();
      expect(vizCallbacks.scheduleOverlayHeightUpdate).toHaveBeenCalled();
    });

    it('counts a game as in progress once it left setup or played a wave', () => {
      expect(delegate().isGameInProgress()).toBe(false);
      store.waveNumber.set(3);
      expect(delegate().isGameInProgress()).toBe(true);
      store.waveNumber.set(0);
      store.phase.set('wave');
      expect(delegate().isGameInProgress()).toBe(true);
    });

    it('names the location through the location service', () => {
      expect(delegate().getCurrentLocationName()).toBe('Stuttgart');
    });
  });

  describe('initializeLocation', () => {
    it('uses the fake origin in DevWorld without reading the URL', async () => {
      devWorld.isActive = true;

      await facade.initializeLocation();

      const origin = { lat: DEV_WORLD_ORIGIN.lat, lon: DEV_WORLD_ORIGIN.lon };
      expect(locationMgmt.setLocation).toHaveBeenCalledWith(origin, []);
      expect(store.baseCoords()).toEqual(origin);
      expect(store.centerCoords()).toEqual({ ...origin, height: 400 });
      expect(engineInit.setStepDone).toHaveBeenCalledWith('location', 'DevWorld');
      expect(urlLocation.parseFromUrl).not.toHaveBeenCalled();
      expect(urlLocation.updateUrl).not.toHaveBeenCalled();
    });

    it('takes HQ and spawns from the URL first', async () => {
      urlLocation.parseFromUrl.mockReturnValue({ hq: INSIDE, spawns: [OUTSIDE] });

      await facade.initializeLocation();

      expect(engineInit.setStepCurrent).toHaveBeenCalledWith('location');
      expect(locationMgmt.setLocation).toHaveBeenCalledWith(INSIDE, [OUTSIDE]);
      expect(engineInit.setStepDone).toHaveBeenCalledWith('location', 'from URL');
      expect(geolocation.detectLocation).not.toHaveBeenCalled();
      expect(urlLocation.updateUrl).toHaveBeenCalledWith(INSIDE, [OUTSIDE]);
      expect(store.baseCoords()).toEqual(INSIDE);
      expect(store.centerCoords()).toEqual({ ...INSIDE, height: 400 });
    });

    it('falls back to the browser location and shows its progress', async () => {
      geolocation.detectLocation.mockImplementation(async () => {
        geolocation.onStepDetail?.('Asking the browser...');
        return INSIDE;
      });

      await facade.initializeLocation();

      expect(engineInit.updateStepMeta).toHaveBeenCalledWith('location', 'Asking the browser...');
      expect(locationMgmt.setLocation).toHaveBeenCalledWith(INSIDE, []);
      expect(engineInit.setStepDone).toHaveBeenCalledWith('location', 'Browser');
      expect(dialog.open).not.toHaveBeenCalled();
      expect(store.baseCoords()).toEqual(INSIDE);
    });

    it('asks the player when neither URL nor browser know a location', async () => {
      geolocation.detectLocation.mockResolvedValue(null);

      const done = facade.initializeLocation();
      await dialogOpened();
      expect(engineInit.updateStepMeta).toHaveBeenCalledWith('location', 'Select location...');
      expect(dialog.open.mock.calls[0][1]).toMatchObject({ disableClose: true, panelClass: 'td-dialog-panel' });

      dialogClosed.next({
        confirmed: true, hq: INSIDE, spawn: { ...OUTSIDE, isRandom: false },
      } as unknown as LocationDialogResult);
      await done;

      expect(engineInit.setStepDone).toHaveBeenCalledWith('location', 'manually selected');
      expect(store.baseCoords()).toEqual(INSIDE);
    });

    it('stops quietly when the component goes away while the dialog is open', async () => {
      geolocation.detectLocation.mockResolvedValue(null);

      const done = facade.initializeLocation();
      await dialogOpened();
      destroyCallbacks.forEach((cb) => cb());
      expect(await done).toBe(false);

      expect(engineInit.setStepDone).not.toHaveBeenCalled();
      expect(engineInit.setError).not.toHaveBeenCalled();
      expect(urlLocation.updateUrl).not.toHaveBeenCalled();
    });

    it('shows the error screen and stops the boot when the dialog does not load', async () => {
      geolocation.detectLocation.mockResolvedValue(null);
      chunk.fails = true;

      const done = facade.initializeLocation();
      await vi.waitFor(() => expect(engineInit.setError).toHaveBeenCalledWith(LOCATION_DIALOG_LOAD_FAILED));

      expect(await done).toBe(false);
      expect(engineInit.setLoading).toHaveBeenCalledWith(false);
      expect(engineInit.setStepDone).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('[LocationFacade] Location dialog failed:', expect.any(LocationDialogLoadError));
    });

    it('reports a dialog that loaded but failed to open as such, with its error in the console', async () => {
      geolocation.detectLocation.mockResolvedValue(null);
      const bug = new Error('NG0201: No provider found');
      dialog.open.mockImplementation(() => { throw bug; });

      expect(await facade.initializeLocation()).toBe(false);

      expect(engineInit.setError).toHaveBeenCalledWith(LOCATION_DIALOG_OPEN_FAILED);
      expect(engineInit.setLoading).toHaveBeenCalledWith(false);
      expect(console.error).toHaveBeenCalledWith('[LocationFacade] Location dialog failed:', bug);
    });
  });

  describe('waitForLocationFromDialog', () => {
    it('opens an empty dialog that cannot be dismissed by clicking outside', async () => {
      void facade.waitForLocationFromDialog();
      await dialogOpened();
      expect(dialog.open).toHaveBeenCalledWith(LocationDialogComponent, {
        data: { currentLocation: null, currentSpawn: null, isGameInProgress: false },
        panelClass: 'td-dialog-panel',
        disableClose: true,
      });
    });

    it('stores the confirmed HQ with its spawn', async () => {
      const done = facade.waitForLocationFromDialog();
      await dialogOpened();
      dialogClosed.next({ confirmed: true, hq: INSIDE, spawn: { ...OUTSIDE, isRandom: false } } as unknown as LocationDialogResult);
      await done;
      expect(locationMgmt.setLocation).toHaveBeenCalledWith(INSIDE, [OUTSIDE]);
    });

    it('stores no spawn when the player asked for a random one', async () => {
      const done = facade.waitForLocationFromDialog();
      await dialogOpened();
      dialogClosed.next({ confirmed: true, hq: INSIDE, spawn: { ...OUTSIDE, isRandom: true } } as unknown as LocationDialogResult);
      await done;
      expect(locationMgmt.setLocation).toHaveBeenCalledWith(INSIDE, []);
    });

    it('resolves without a location when the dialog closes unconfirmed', async () => {
      const done = facade.waitForLocationFromDialog();
      await dialogOpened();
      dialogClosed.next(null);
      await expect(done).resolves.toBeUndefined();
      expect(locationMgmt.setLocation).not.toHaveBeenCalled();
    });

    it('rejects with a load error when the dialog chunk does not load', async () => {
      chunk.fails = true;
      await expect(facade.waitForLocationFromDialog()).rejects.toBeInstanceOf(LocationDialogLoadError);
    });

    it('rejects with the error itself when the loaded dialog fails to open', async () => {
      const bug = new Error('NG0201: No provider found');
      dialog.open.mockImplementation(() => { throw bug; });
      await expect(facade.waitForLocationFromDialog()).rejects.toBe(bug);
    });

    it('rejects when the component is destroyed first and closes the dialog that opens late', async () => {
      const done = facade.waitForLocationFromDialog();
      destroyCallbacks.forEach((cb) => cb());
      await expect(done).rejects.toThrow('Component destroyed before location was selected');

      await dialogOpened();
      expect(closeDialog).toHaveBeenCalled();
      dialogClosed.next({ confirmed: true, hq: INSIDE, spawn: { ...OUTSIDE, isRandom: false } } as unknown as LocationDialogResult);
      expect(locationMgmt.setLocation).not.toHaveBeenCalled();
    });
  });

  describe('syncUrlWithLocation', () => {
    it('writes HQ and spawns into the URL', () => {
      locationMgmt.setLocation(INSIDE, [OUTSIDE]);
      facade.syncUrlWithLocation();
      expect(urlLocation.updateUrl).toHaveBeenCalledWith(INSIDE, [OUTSIDE]);
    });

    it('skips without an HQ and in DevWorld', () => {
      facade.syncUrlWithLocation();
      devWorld.isActive = true;
      locationMgmt.setLocation(INSIDE, []);
      facade.syncUrlWithLocation();
      expect(urlLocation.updateUrl).not.toHaveBeenCalled();
    });
  });

  describe('addSpawnPoint', () => {
    it('stores the spawn, named after its street, draws its marker and asks for its path', () => {
      facade.addSpawnPoint('s1', 'North', 48.8, 9.2, 0xff0000);

      const spawn = { id: 's1', name: 'Damrak', lat: 48.8, lon: 9.2, color: 0xff0000 };
      expect(store.spawnPoints()).toEqual([spawn]);
      expect(markerViz.addSpawnMarker).toHaveBeenCalledWith('s1', 'Damrak', 48.8, 9.2, 0xff0000);
      expect(pathRoute.showPathFromSpawn).toHaveBeenCalledWith(spawn);
    });

    it('keeps the name it was given in DevWorld, whose streets carry ids, not names', () => {
      devWorld.isActive = true;
      facade.addSpawnPoint('s1', 'North', 48.8, 9.2, 0xff0000);
      expect(markerViz.addSpawnMarker).toHaveBeenCalledWith('s1', 'North', 48.8, 9.2, 0xff0000);
    });

    it('falls back to the engine of the init service', () => {
      bridge.getEngine.mockReturnValue(null);
      engineInit.getEngine.mockReturnValue(engine);
      facade.addSpawnPoint('s1', 'North', 48.8, 9.2, 1);
      expect(spawnIds()).toEqual(['s1']);
    });

    it('turns the portal to a bearing it brought along once its route stands, and leaves it to the route otherwise', () => {
      facade.addSpawnPoint('s1', 'North', 48.8, 9.2, 1, 90);
      // Bearing 90 is east, -x: heading -PI/2
      expect(markerViz.setPortalHeading).toHaveBeenCalledWith('s1', expect.closeTo(-Math.PI / 2, 9));
      expect(pathRoute.showPathFromSpawn.mock.invocationCallOrder[0])
        .toBeLessThan(markerViz.setPortalHeading.mock.invocationCallOrder[0]);

      markerViz.setPortalHeading.mockClear();
      facade.addSpawnPoint('s2', 'South', 48.7, 9.2, 1);
      expect(markerViz.setPortalHeading).not.toHaveBeenCalled();
    });

    it('does nothing without an engine or without streets', () => {
      bridge.getEngine.mockReturnValue(null);
      facade.addSpawnPoint('s1', 'North', 48.8, 9.2, 1);
      bridge.getEngine.mockReturnValue(engine);
      streetNetwork = null;
      facade.addSpawnPoint('s2', 'South', 48.7, 9.2, 1);

      expect(store.spawnPoints()).toEqual([]);
      expect(markerViz.addSpawnMarker).not.toHaveBeenCalled();
    });
  });

  describe('addPredefinedSpawns', () => {
    it('creates none without an HQ', () => {
      expect(facade.addPredefinedSpawns()).toBe(0);
      expect(store.spawnPoints()).toEqual([]);
    });

    it('creates the spawns from the location service with cycling colours', () => {
      locationMgmt.setLocation(HQ, []);
      locationMgmt.editableSpawnLocations.set([
        { id: 'a', name: 'Alpha', lat: 48.8, lon: 9.2 },
        { id: 'b', name: '', lat: 48.81, lon: 9.21 },
      ]);

      expect(facade.addPredefinedSpawns()).toBe(2);
      expect(store.spawnPoints().map((s) => [s.id, s.name, s.color])).toEqual([
        ['a', 'Damrak', SPAWN_COLORS[0]],
        ['b', 'Damrak', SPAWN_COLORS[1]],
      ]);
    });

    it('turns a spawn from the URL the way its portal was saved', () => {
      locationMgmt.setLocation(HQ, []);
      locationMgmt.editableSpawnLocations.set([
        { id: 'spawn-1', name: '', lat: 48.8, lon: 9.2, portalBearing: 180 },
        { id: 'spawn-2', name: '', lat: 48.81, lon: 9.21 },
      ]);

      expect(facade.addPredefinedSpawns()).toBe(2);
      expect(markerViz.setPortalHeading).toHaveBeenCalledTimes(1);
      expect(markerViz.setPortalHeading).toHaveBeenCalledWith('spawn-1', expect.closeTo(-Math.PI, 9));
    });

    it('creates none when a stored spawn sits at 0/0', () => {
      locationMgmt.setLocation(HQ, []);
      locationMgmt.editableSpawnLocations.set([
        { id: 'a', name: 'Alpha', lat: 48.8, lon: 9.2 },
        { id: 'b', name: 'Null Island', lat: 0, lon: 9.2 },
      ]);
      expect(facade.addPredefinedSpawns()).toBe(0);
    });

    it('draws one random street spawn 500 to 1000 m away and writes it to the URL', () => {
      locationMgmt.setLocation(HQ, []);
      locationMgmt.needsRandomSpawn.set(true);
      osm.findRandomStreetPoint.mockReturnValue({ lat: 48.781, lon: 9.19, streetName: '' });

      expect(facade.addPredefinedSpawns()).toBe(1);

      expect(osm.findRandomStreetPoint).toHaveBeenCalledWith(streetNetwork, HQ.lat, HQ.lon, 500, 1000);
      expect(locationMgmt.setGeneratedSpawns).toHaveBeenCalledWith([{ lat: 48.781, lon: 9.19 }]);
      expect(urlLocation.updateUrl).toHaveBeenCalled();
      expect(store.spawnPoints()).toEqual([
        { id: 'spawn-1', name: 'Damrak', lat: 48.781, lon: 9.19, color: SPAWN_COLORS[0] },
      ]);
    });

    it('creates none when no random street point is found', () => {
      locationMgmt.setLocation(HQ, []);
      locationMgmt.needsRandomSpawn.set(true);
      expect(facade.addPredefinedSpawns()).toBe(0);
      expect(locationMgmt.setGeneratedSpawns).not.toHaveBeenCalled();
    });

    it('uses only the first spawn the DevWorld generator offers', () => {
      devWorld.isActive = true;
      locationMgmt.setLocation(HQ, []);
      locationMgmt.needsRandomSpawn.set(true);
      engine.getDevTerrainProvider.mockReturnValue({
        getSpawnPoints: () => [
          { id: 'dev-n', name: 'North', position: { x: 100, z: 400 } },
          { id: 'dev-s', name: 'South', position: { x: 100, z: -400 } },
        ],
      });

      expect(facade.addPredefinedSpawns()).toBe(1);

      expect(locationMgmt.setGeneratedSpawns).toHaveBeenCalledWith([{ lat: 0.4, lon: 0.1 }]);
      expect(store.spawnPoints()).toEqual([
        { id: 'dev-n', name: 'North', lat: 0.4, lon: 0.1, color: SPAWN_COLORS[0] },
      ]);
      expect(osm.findRandomStreetPoint).not.toHaveBeenCalled();
    });

    it('falls back to the configured DevWorld spawn when the generator has none', () => {
      devWorld.isActive = true;
      locationMgmt.setLocation(HQ, []);
      locationMgmt.needsRandomSpawn.set(true);

      expect(facade.addPredefinedSpawns()).toBe(1);
      expect(store.spawnPoints()).toEqual([
        { id: 'spawn-north', name: 'Spawn north', lat: 0.02, lon: 0.01, color: SPAWN_COLORS[0] },
      ]);
    });
  });

  describe('map placement', () => {
    const click = async (mode: 'hq' | 'spawn', at: Spawn) => {
      mapPlacement.handlePlacementClick.mockReturnValue({ mode, ...at });
      await facade.handleMapPlacementClick(at.lat, at.lon, 0);
    };

    it('starts the placement mode through the map placement service', () => {
      facade.startMapPlacement('spawn');
      expect(mapPlacement.startPlacement).toHaveBeenCalledWith('spawn', false, null);
    });

    it('does nothing when the placement service rejects the click', async () => {
      await facade.handleMapPlacementClick(INSIDE.lat, INSIDE.lon, 0);
      expect(gameState.reset).not.toHaveBeenCalled();
      expect(coordinator.applyNewLocation).not.toHaveBeenCalled();
    });

    describe('HQ inside the loaded streets', () => {
      beforeEach(() => {
        facade.initializeCoordinator(vizCallbacks as unknown as VizCallbacks);
        store.spawnPoints.set([OLD_SPAWN]);
      });

      it('moves the origin and rebuilds the world in place', async () => {
        await click('hq', INSIDE);

        expect(routeAnimation.stopAnimation).toHaveBeenCalled();
        expect(heightUpdate.stopHeightUpdates).toHaveBeenCalled();
        expect(gameState.reset).toHaveBeenCalled();
        expect(markerViz.clearAllMarkers).toHaveBeenCalled();
        expect(pathRoute.clearAllRoutes).toHaveBeenCalled();
        expect(pathRoute.clearCachedPaths).toHaveBeenCalled();
        expect(streetRendering.dispose).toHaveBeenCalledWith(overlay);
        expect(bridge.setFilteredStreetNetwork).toHaveBeenCalledWith(null);
        expect(engine.setOrigin).toHaveBeenCalledWith(INSIDE.lat, INSIDE.lon);
        expect(store.baseCoords()).toEqual(INSIDE);
        expect(store.centerCoords()).toEqual({ ...INSIDE, height: 400 });
        // The viz services are re-initialised on the new base before the HQ marker goes up.
        expect(vizCallbacks.initializeVisualizationServices.mock.invocationCallOrder[0])
          .toBeLessThan(markerViz.addBaseMarker.mock.invocationCallOrder[0]);
        expect(osm.loadStreets).not.toHaveBeenCalled();
        expect(coordinator.applyNewLocation).not.toHaveBeenCalled();
      });

      it('keeps a spawn that still has a route to the new HQ', async () => {
        await click('hq', INSIDE);

        expect(osm.findPath).toHaveBeenCalledWith(streetNetwork, OLD_SPAWN.lat, OLD_SPAWN.lon, INSIDE.lat, INSIDE.lon);
        expect(store.spawnPoints()).toEqual([OLD_SPAWN]);
        expect(osm.findRandomStreetPoint).not.toHaveBeenCalled();
        expect(gameState.initialize).toHaveBeenCalledWith(
          engine, INSIDE,
          [{ id: OLD_SPAWN.id, name: OLD_SPAWN.name, lat: OLD_SPAWN.lat, lon: OLD_SPAWN.lon }],
          cachedPaths,
        );
        expect(gameState.initializeGlobalRouteGrid).toHaveBeenCalled();
      });

      it('draws a new random spawn when the old one has no route', async () => {
        osm.findPath.mockReturnValue([OLD_SPAWN]);
        osm.findRandomStreetPoint.mockReturnValue({ lat: 48.785, lon: 9.195, streetName: 'Neckarstraße' });

        await click('hq', INSIDE);

        expect(osm.findRandomStreetPoint).toHaveBeenCalledWith(streetNetwork, INSIDE.lat, INSIDE.lon, 500, 1000);
        expect(store.spawnPoints()).toEqual([
          { id: 'spawn-1', name: 'Damrak', lat: 48.785, lon: 9.195, color: SPAWN_COLORS[0] },
        ]);
      });

      it('re-runs placement, streets and camera and saves the new location', async () => {
        await click('hq', INSIDE);

        expect(vizCallbacks.initializeTowerPlacement).toHaveBeenCalled();
        expect(vizCallbacks.filterStreetNetworkToRoutes).toHaveBeenCalled();
        expect(vizCallbacks.renderStreets).toHaveBeenCalled();
        expect(vizCallbacks.reframeCameraWithRoutes).toHaveBeenCalled();
        expect(vizCallbacks.saveInitialCameraPosition).toHaveBeenCalled();
        expect(locationMgmt.setLocation).toHaveBeenCalledWith(INSIDE, [{ lat: OLD_SPAWN.lat, lon: OLD_SPAWN.lon }]);
        expect(urlLocation.updateUrl).toHaveBeenCalledWith(INSIDE, [{ lat: OLD_SPAWN.lat, lon: OLD_SPAWN.lon }]);
        expect(routeAnimation.startAnimation).toHaveBeenCalledWith(cachedPaths, [OLD_SPAWN]);
        expect(mapPlacement.updateDependencies).toHaveBeenCalledWith(streetNetwork, INSIDE);
      });

      it('does not start the route animation without routes', async () => {
        cachedPaths = new Map();
        await click('hq', INSIDE);
        expect(routeAnimation.startAnimation).not.toHaveBeenCalled();
      });

      it('builds the corridor of the rebuilt routes once their grid stands, then starts the route animation', async () => {
        await click('hq', INSIDE);
        expect(vizCallbacks.buildCorridor).toHaveBeenCalledTimes(1);
        expect(gameState.initializeGlobalRouteGrid.mock.invocationCallOrder[0])
          .toBeLessThan(vizCallbacks.buildCorridor.mock.invocationCallOrder[0]);
        expect(vizCallbacks.buildCorridor.mock.invocationCallOrder[0])
          .toBeLessThan(routeAnimation.startAnimation.mock.invocationCallOrder[0]);
      });
    });

    it('moves nothing in place before the coordinator was initialised', async () => {
      await click('hq', INSIDE);
      expect(gameState.reset).not.toHaveBeenCalled();
      expect(engine.setOrigin).not.toHaveBeenCalled();
      expect(coordinator.applyNewLocation).not.toHaveBeenCalled();
    });

    describe('HQ outside the loaded streets', () => {
      it('keeps an old spawn up to 1500 m away and runs a full location change', async () => {
        store.spawnPoints.set([OLD_SPAWN]);
        osm.haversineDistance.mockReturnValue(1500);

        await click('hq', OUTSIDE);

        expect(osm.haversineDistance).toHaveBeenCalledWith(OLD_SPAWN.lat, OLD_SPAWN.lon, OUTSIDE.lat, OUTSIDE.lon);
        expect(osm.loadStreets).not.toHaveBeenCalled();
        expect(coordinator.applyNewLocation).toHaveBeenCalledWith({
          hq: { ...OUTSIDE, name: 'Loading...' },
          spawn: { lat: OLD_SPAWN.lat, lon: OLD_SPAWN.lon, name: OLD_SPAWN.name },
        });
        expect(gameState.reset).not.toHaveBeenCalled();
      });

      it('loads the new streets and draws a random spawn when the old one is farther', async () => {
        store.spawnPoints.set([OLD_SPAWN]);
        osm.haversineDistance.mockReturnValue(1501);
        const loaded = { streets: [{}], bounds: BOUNDS };
        osm.loadStreets.mockResolvedValue(loaded);
        osm.findRandomStreetPoint.mockReturnValue({ lat: 49.505, lon: 9.2, streetName: '' });

        await click('hq', OUTSIDE);

        expect(osm.loadStreets).toHaveBeenCalledWith(OUTSIDE.lat, OUTSIDE.lon, 2000);
        // Handed to the bridge so the coordinator's street step reuses them.
        expect(bridge.setStreetNetwork).toHaveBeenCalledWith(loaded);
        expect(bridge.setStreetNetworkLocation).toHaveBeenCalledWith(OUTSIDE);
        expect(osm.findRandomStreetPoint).toHaveBeenCalledWith(loaded, OUTSIDE.lat, OUTSIDE.lon, 500, 1000);
        expect(coordinator.applyNewLocation).toHaveBeenCalledWith({
          hq: { ...OUTSIDE, name: 'Loading...' },
          spawn: { lat: 49.505, lon: 9.2, name: 'Spawn' },
        });
      });

      it('treats a missing spawn like one that is too far', async () => {
        osm.loadStreets.mockResolvedValue({ streets: [], bounds: BOUNDS });

        await click('hq', OUTSIDE);

        expect(osm.loadStreets).toHaveBeenCalled();
        expect(coordinator.applyNewLocation).toHaveBeenCalledWith({
          hq: { ...OUTSIDE, name: 'Loading...' },
          spawn: { lat: OUTSIDE.lat + 0.0063, lon: OUTSIDE.lon, name: 'Fallback Spawn' },
        });
      });

      it('puts the spawn about 700 m north when the streets cannot be loaded', async () => {
        osm.loadStreets.mockRejectedValue(new Error('Overpass down'));

        await click('hq', OUTSIDE);

        expect(bridge.setStreetNetwork).not.toHaveBeenCalled();
        expect(coordinator.applyNewLocation).toHaveBeenCalledWith({
          hq: { ...OUTSIDE, name: 'Loading...' },
          spawn: { lat: OUTSIDE.lat + 0.0063, lon: OUTSIDE.lon, name: 'Spawn' },
        });
      });
    });

    describe('spawn', () => {
      it('builds the corridor of the new route once its grid stands, then starts the route animation', async () => {
        facade.initializeCoordinator(vizCallbacks as unknown as VizCallbacks);
        store.spawnPoints.set([OLD_SPAWN]);

        await click('spawn', INSIDE);

        expect(vizCallbacks.buildCorridor).toHaveBeenCalledTimes(1);
        expect(gameState.initializeGlobalRouteGrid.mock.invocationCallOrder[0])
          .toBeLessThan(vizCallbacks.buildCorridor.mock.invocationCallOrder[0]);
        expect(vizCallbacks.buildCorridor.mock.invocationCallOrder[0])
          .toBeLessThan(routeAnimation.startAnimation.mock.invocationCallOrder[0]);
      });

      it('moves one spawn and keeps the others with their ids (coop host, lobby)', async () => {
        facade.initializeCoordinator(vizCallbacks as unknown as VizCallbacks);
        const second = { lat: 48.77, lon: 9.17 };
        locationMgmt.setLocation(HQ, [{ lat: OLD_SPAWN.lat, lon: OLD_SPAWN.lon }, second]);
        mapPlacement.handlePlacementClick.mockReturnValue({ mode: 'spawn', move: 0, ...INSIDE });
        await facade.handleMapPlacementClick(INSIDE.lat, INSIDE.lon, 0);

        expect(locationMgmt.setLocation).toHaveBeenLastCalledWith(HQ, [{ ...INSIDE, portalBearing: undefined }, second]);
        expect(store.spawnPoints().map((s) => [s.id, s.lat, s.lon])).toEqual([
          ['spawn-1', INSIDE.lat, INSIDE.lon], ['spawn-2', second.lat, second.lon],
        ]);
        expect(vizCallbacks.buildCorridor).toHaveBeenCalledTimes(1);
      });

      it('takes one spawn away, the ones after it move up, never the last one', async () => {
        facade.initializeCoordinator(vizCallbacks as unknown as VizCallbacks);
        const second = { lat: 48.77, lon: 9.17 };
        locationMgmt.setLocation(HQ, [{ lat: OLD_SPAWN.lat, lon: OLD_SPAWN.lon }, second]);

        expect(await facade.removeSpawn(0)).toBe(true);
        expect(store.spawnPoints().map((s) => [s.id, s.lat, s.lon])).toEqual([['spawn-1', second.lat, second.lon]]);
        expect(await facade.removeSpawn(0)).toBe(false);
      });

      it('replaces the spawn in place when it has a route to the HQ', async () => {
        facade.initializeCoordinator(vizCallbacks as unknown as VizCallbacks);
        store.spawnPoints.set([OLD_SPAWN]);

        await click('spawn', INSIDE);

        expect(osm.findPath).toHaveBeenCalledWith(streetNetwork, INSIDE.lat, INSIDE.lon, HQ.lat, HQ.lon);
        expect(routeAnimation.stopAnimation).toHaveBeenCalled();
        expect(markerViz.clearSpawnMarkers).toHaveBeenCalled();
        expect(markerViz.clearAllMarkers).not.toHaveBeenCalled();
        expect(pathRoute.clearAllRoutes).toHaveBeenCalled();
        expect(pathRoute.clearCachedPaths).toHaveBeenCalled();
        expect(gameState.reset).toHaveBeenCalled();
        expect(store.spawnPoints()).toEqual([
          { id: 'spawn-1', name: 'Damrak', ...INSIDE, color: SPAWN_COLORS[0] },
        ]);
        expect(locationMgmt.setLocation).toHaveBeenCalledWith(HQ, [INSIDE]);
        expect(urlLocation.updateUrl).toHaveBeenCalledWith(HQ, [INSIDE]);
        expect(gameState.initialize).toHaveBeenCalledWith(
          engine, HQ, [{ id: 'spawn-1', name: 'Damrak', ...INSIDE }], cachedPaths,
        );
        expect(gameState.initializeGlobalRouteGrid).toHaveBeenCalled();
        expect(mapPlacement.updateDependencies).toHaveBeenCalledWith(streetNetwork, HQ);
        expect(routeAnimation.startAnimation).toHaveBeenCalledWith(cachedPaths, store.spawnPoints());
        expect(engine.setOrigin).not.toHaveBeenCalled();
      });

      it('rejects a spawn without a route and leaves the game as it was', async () => {
        store.spawnPoints.set([OLD_SPAWN]);
        osm.findPath.mockReturnValue(null);

        await click('spawn', INSIDE);

        expect(gameState.reset).not.toHaveBeenCalled();
        expect(markerViz.clearSpawnMarkers).not.toHaveBeenCalled();
        expect(store.spawnPoints()).toEqual([OLD_SPAWN]);
        expect(coordinator.applyNewLocation).not.toHaveBeenCalled();
      });

      it('replaces a spawn outside the loaded box in place as well, without reloading the streets', async () => {
        await click('spawn', OUTSIDE);

        expect(osm.findPath).toHaveBeenCalledWith(streetNetwork, OUTSIDE.lat, OUTSIDE.lon, HQ.lat, HQ.lon);
        expect(store.spawnPoints()).toEqual([
          { id: 'spawn-1', name: 'Damrak', ...OUTSIDE, color: SPAWN_COLORS[0] },
        ]);
        expect(osm.loadStreets).not.toHaveBeenCalled();
        expect(coordinator.applyNewLocation).not.toHaveBeenCalled();
      });
    });
  });

  describe('clearMapEntities', () => {
    it('removes markers, routes, streets, spawns and the route cells', () => {
      store.spawnPoints.set([OLD_SPAWN]);

      facade.clearMapEntities();

      expect(markerViz.clearAllMarkers).toHaveBeenCalled();
      expect(pathRoute.clearAllRoutes).toHaveBeenCalled();
      expect(streetRendering.dispose).toHaveBeenCalledWith(overlay);
      // The cells and their overlays of the old location, see GlobalRouteGridService.clear
      expect(routeGrid.clear).toHaveBeenCalled();
      expect(store.spawnPoints()).toEqual([]);
      expect(pathRoute.clearCachedPaths).toHaveBeenCalled();
      expect(bridge.setFilteredStreetNetwork).toHaveBeenCalledWith(null);
      expect(bridge.setStreetNetworkLocation).toHaveBeenCalledWith(null);
    });

    it('does nothing without an engine', () => {
      bridge.getEngine.mockReturnValue(null);
      facade.clearMapEntities();
      expect(markerViz.clearAllMarkers).not.toHaveBeenCalled();
      expect(bridge.setFilteredStreetNetwork).not.toHaveBeenCalled();
    });
  });

  describe('refreshTerrainHeights', () => {
    it('clears the height cache and reports the tiles as loaded in the real world', () => {
      const onTilesLoaded = vi.fn();
      facade.refreshTerrainHeights(onTilesLoaded);
      expect(engine.terrain.clearHeightCache).toHaveBeenCalled();
      expect(onTilesLoaded).toHaveBeenCalled();
    });

    it('does nothing without an engine', () => {
      bridge.getEngine.mockReturnValue(null);
      const onTilesLoaded = vi.fn();
      facade.refreshTerrainHeights(onTilesLoaded);
      expect(onTilesLoaded).not.toHaveBeenCalled();
    });

    it('regenerates the DevWorld and rebuilds on the new terrain', async () => {
      devWorld.isActive = true;
      let finish!: () => void;
      const provider = {
        regenerate: vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })),
        getSpawnPoints: () => [{ id: 'dev-n', name: 'North', position: { x: 100, z: 400 } }],
      };
      engine.getDevTerrainProvider.mockReturnValue(provider);
      store.spawnPoints.set([OLD_SPAWN]);
      const onTilesLoaded = vi.fn();

      facade.refreshTerrainHeights(onTilesLoaded);

      expect(store.isDevWorldRegenerating()).toBe(true);
      expect(gameState.reset).toHaveBeenCalled();
      expect(routeGrid.disposeVisualization).toHaveBeenCalled();
      expect(markerViz.clearAllMarkers).toHaveBeenCalled();
      expect(streetRendering.dispose).toHaveBeenCalledWith(overlay);
      expect(store.spawnPoints()).toEqual([]);
      expect(engine.terrain.clearHeightCache).toHaveBeenCalled();
      expect(onTilesLoaded).not.toHaveBeenCalled();

      finish();
      await settle();

      expect(store.isDevWorldRegenerating()).toBe(false);
      expect(spawnIds()).toEqual(['dev-n']);
      expect(gameState.reseatWavePipeline).toHaveBeenCalled();
    });

    it('clears the regenerating flag when the regeneration fails', async () => {
      devWorld.isActive = true;
      engine.getDevTerrainProvider.mockReturnValue({ regenerate: vi.fn(async () => { throw new Error('seed'); }) });

      facade.refreshTerrainHeights(vi.fn());
      await settle();

      expect(store.isDevWorldRegenerating()).toBe(false);
      expect(console.error).toHaveBeenCalledWith('[LocationFacade] DevWorld regeneration failed:', expect.any(Error));
      expect(gameState.reseatWavePipeline).not.toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    const initAgain = () => facade.initialize(
      bridge as unknown as FacadeComponentBridge,
      gameState as unknown as GameStateManager,
      { get: () => destroyRef } as unknown as Injector,
    );

    it('gives the coordinator no change context any more', () => {
      facade.initializeCoordinator(vizCallbacks as unknown as VizCallbacks);
      facade.dispose();

      expect(delegate().getChangeContext()).toBeNull();
      delegate().getChangeCallbacks().setStreetNetwork(null);
      expect(bridge.setStreetNetwork).not.toHaveBeenCalled();
    });

    it('moves nothing in place and draws no spawn', async () => {
      facade.initializeCoordinator(vizCallbacks as unknown as VizCallbacks);
      store.spawnPoints.set([OLD_SPAWN]);
      locationMgmt.setLocation(HQ, []);
      locationMgmt.editableSpawnLocations.set([{ id: 'a', name: 'Alpha', lat: 48.8, lon: 9.2 }]);
      facade.dispose();

      mapPlacement.handlePlacementClick.mockReturnValue({ mode: 'hq', ...INSIDE });
      await facade.handleMapPlacementClick(INSIDE.lat, INSIDE.lon, 0);
      facade.addSpawnPoint('s1', 'North', 48.8, 9.2, 1);
      facade.clearMapEntities();

      expect(facade.addPredefinedSpawns()).toBe(0);
      expect(gameState.reset).not.toHaveBeenCalled();
      expect(engine.setOrigin).not.toHaveBeenCalled();
      expect(markerViz.clearAllMarkers).not.toHaveBeenCalled();
      expect(store.spawnPoints()).toEqual([OLD_SPAWN]);
    });

    it('leaves the old game alone when a DevWorld regeneration finishes afterwards', async () => {
      devWorld.isActive = true;
      let finish!: () => void;
      engine.getDevTerrainProvider.mockReturnValue({
        regenerate: vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })),
        getSpawnPoints: () => [{ id: 'dev-n', name: 'North', position: { x: 100, z: 400 } }],
      });
      facade.refreshTerrainHeights(vi.fn());
      facade.dispose();

      finish();
      await settle();

      expect(store.isDevWorldRegenerating()).toBe(false);
      expect(markerViz.addBaseMarker).not.toHaveBeenCalled();
      expect(gameState.reseatWavePipeline).not.toHaveBeenCalled();
    });

    it('refuses the location dialog without a component', async () => {
      facade.dispose();
      await expect(facade.waitForLocationFromDialog()).rejects.toThrow('not initialized');
      expect(dialog.open).not.toHaveBeenCalled();
    });

    it('works again after the next initialize', () => {
      facade.dispose();
      initAgain();

      facade.addSpawnPoint('s1', 'North', 48.8, 9.2, 1);
      expect(spawnIds()).toEqual(['s1']);
    });
  });

  describe('onDevWorldRegenerated', () => {
    const provider = {
      getSpawnPoints: () => [
        { id: 'dev-n', name: 'North', position: { x: 100, z: 400 } },
        { id: 'dev-s', name: 'South', position: { x: 100, z: -400 } },
      ],
    } as unknown as DevTerrainProvider;

    it('re-creates HQ and the first generated spawn and hands them to the wave pipeline', () => {
      devWorld.isActive = true;
      facade.onDevWorldRegenerated(provider);

      const spawn = { id: 'dev-n', name: 'North', lat: 0.4, lon: 0.1, color: SPAWN_COLORS[0] };
      expect(markerViz.addBaseMarker).toHaveBeenCalled();
      expect(store.spawnPoints()).toEqual([spawn]);
      expect(bridge.setFilteredStreetNetwork).toHaveBeenCalledWith(streetNetwork);
      expect(markerViz.updateMarkerHeights).toHaveBeenCalledWith();
      expect(gameState.onTilesLoaded).toHaveBeenCalled();
      expect(gameState.reseatWavePipeline).toHaveBeenCalledWith([spawn], cachedPaths);
      expect(routeAnimation.startAnimation).toHaveBeenCalledWith(cachedPaths, [spawn]);
    });

    it('rebuilds the route grid before the route lines read their heights from it', () => {
      facade.onDevWorldRegenerated(provider);

      expect(gameState.initializeGlobalRouteGrid.mock.invocationCallOrder[0])
        .toBeLessThan(pathRoute.refreshRouteLines.mock.invocationCallOrder[0]);
      expect(pathRoute.refreshRouteLines).toHaveBeenCalledWith(store.spawnPoints());
    });

    it('does nothing without an engine', () => {
      bridge.getEngine.mockReturnValue(null);
      facade.onDevWorldRegenerated(provider);
      expect(markerViz.addBaseMarker).not.toHaveBeenCalled();
      expect(gameState.reseatWavePipeline).not.toHaveBeenCalled();
    });
  });
});
