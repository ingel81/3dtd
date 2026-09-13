import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Subject } from 'rxjs';

// The real dialog and material modules are partially compiled and need the JIT
// compiler; the coordinator only uses them as DI token and dialog type.
vi.mock('@angular/material/dialog', () => ({ MatDialog: class MatDialog {} }));
// With `fails` set, the dialog's lazy chunk does not load.
const chunk = vi.hoisted(() => ({ fails: false, component: class LocationDialogComponent {} }));
vi.mock('../../components/location-dialog/location-dialog.component', () => ({
  get LocationDialogComponent() {
    if (chunk.fails) throw new TypeError('Failed to fetch dynamically imported module');
    return chunk.component;
  },
}));

import { LocationChangeCoordinatorService, LocationFlowDelegate } from './location-change-coordinator.service';
import {
  LocationChangeExecutorService,
  LocationChangeCallbacks,
  LocationChangeContext,
} from './location-change-executor.service';
import { EngineInitializationService } from '../infrastructure/engine-initialization.service';
import { OsmStreetService } from './osm-street.service';
import { HeightUpdateService } from '../world/height-update.service';
import { MarkerVisualizationService } from '../world/marker-visualization.service';
import { PathAndRouteService } from '../world/path-route.service';
import { CameraControlService } from '../camera-control.service';
import { CameraFramingService } from '../camera-framing.service';
import { RouteAnimationService } from '../world/route-animation.service';
import { IntroCameraFlightService } from '../world/intro-camera-flight.service';
import { KeyboardPanService } from '../keyboard-pan.service';
import { LocationManagementService } from './location-management.service';
import { UrlLocationService } from './url-location.service';
import { WorldDiceService } from './world-dice.service';
import { UIStore } from '../../store/ui.store';
import { LocationDialogComponent } from '../../components/location-dialog/location-dialog.component';
import {
  LOCATION_DIALOG_LOAD_FAILED,
  LOCATION_DIALOG_OPEN_FAILED,
  LocationDialogLoadError,
} from '../../components/location-dialog/open-location-dialog';
import { SPAWN_COLORS } from '../../configs/map-constants.config';
import type { FavoriteLocation, LocationDialogResult } from '../../models/location.types';
import type { StreetNetwork } from './osm-street.service';

/**
 * The coordinator runs the 7-step location change and the location UI flows
 * (dialog, favorites, world dice, share). These tests pin what each step does
 * to its collaborators, the order the loading steps are reported in, and how
 * a failure unwinds the loading flags.
 */

const HQ = { lat: 48.7758, lon: 9.1829 };
const SPAWN = { lat: 48.78, lon: 9.19 };

function network(streets = 3): StreetNetwork {
  return {
    streets: Array.from({ length: streets }, (_, i) => ({ id: i })),
    nodes: new Map(),
    bounds: { minLat: 48.7, maxLat: 48.9, minLon: 9.1, maxLon: 9.3 },
  } as unknown as StreetNetwork;
}

function makeEngineInit() {
  return {
    loading: signal(false),
    tilesLoading: signal(false),
    osmLoading: signal(false),
    resetLoadingSteps: vi.fn(),
    setStepCurrent: vi.fn(async (_id: string) => undefined),
    setStepDone: vi.fn(async (_id: string, _meta?: string) => undefined),
    updateStepMeta: vi.fn(),
    setError: vi.fn(),
    setLoading: vi.fn(),
    startWorldDiceLoading: vi.fn(),
    updateWorldDiceDetail: vi.fn(),
    finishWorldDiceLoading: vi.fn(),
  };
}

function makeLocationMgmt() {
  return {
    isApplyingLocation: signal(false),
    editableHqLocation: signal<{ lat: number; lon: number; name?: string } | null>(null),
    editableSpawnLocations: signal<{ id: string; lat: number; lon: number; name: string }[]>([]),
    favorites: signal<FavoriteLocation[]>([]),
    getFavoriteDisplayName: vi.fn(async (fav: FavoriteLocation) => `name-${fav.id}`),
    saveFavorite: vi.fn(),
    deleteFavorite: vi.fn(),
    setLocation: vi.fn(),
    saveLocationsToStorage: vi.fn(),
  };
}

function makeEngine() {
  return {
    setOrigin: vi.fn(),
    getCamera: vi.fn(() => ({ aspect: 1.5, fov: 50 })),
    // Tiles are "loaded" the moment the coordinator waits for them.
    setOnFirstTilesLoadedCallback: vi.fn((cb: () => void) => cb()),
  };
}

function makeCallbacks(state: { spawnPoints: { id: string; name: string; lat: number; lon: number; color: number }[] }) {
  const cb = {
    setBaseCoords: vi.fn(),
    setCenterCoords: vi.fn(),
    setSpawnPoints: vi.fn((p: typeof state.spawnPoints) => { state.spawnPoints = p; }),
    addSpawnPoint: vi.fn((id: string, name: string, lat: number, lon: number, color: number) => {
      state.spawnPoints = [...state.spawnPoints, { id, name, lat, lon, color }];
    }),
    setStreetCount: vi.fn(),
    setStreetNetwork: vi.fn(),
    setStreetNetworkLocation: vi.fn(),
    syncUrlWithLocation: vi.fn(),
    clearMapEntities: vi.fn(),
    appendDebugLog: vi.fn(),
    initializeTowerPlacement: vi.fn(),
    filterStreetNetworkToRoutes: vi.fn(),
    scheduleOverlayHeightUpdate: vi.fn(async () => undefined),
    getSpawnPoints: vi.fn(() => state.spawnPoints),
    getBaseCoords: vi.fn(() => ({ ...HQ })),
  };
  return cb satisfies LocationChangeCallbacks;
}

describe('LocationChangeCoordinatorService', () => {
  let coordinator: LocationChangeCoordinatorService;
  let executor: LocationChangeExecutorService;
  let engineInit: ReturnType<typeof makeEngineInit>;
  let locationMgmt: ReturnType<typeof makeLocationMgmt>;
  let engine: ReturnType<typeof makeEngine>;
  let callbacks: ReturnType<typeof makeCallbacks>;
  let ctx: LocationChangeContext;
  let delegate: LocationFlowDelegate & { getChangeContext: ReturnType<typeof vi.fn> };
  let dialogClosed: Subject<LocationDialogResult | null>;
  let cachedPaths: Map<string, unknown[]>;
  let state: { spawnPoints: { id: string; name: string; lat: number; lon: number; color: number }[] };

  const dialog = { open: vi.fn() };
  const osm = { loadStreets: vi.fn(), findRandomStreetPoint: vi.fn() };
  const heightUpdate = { heightsLoading: signal(false), heightProgress: signal(1), stopHeightUpdates: vi.fn() };
  const markerViz = { initialize: vi.fn(), placeSpawnPortal: vi.fn(), addBaseMarker: vi.fn() };
  const pathRoute = {
    clearCache: vi.fn(),
    initialize: vi.fn(),
    getCachedPaths: vi.fn(() => cachedPaths),
    getRouteDetail: vi.fn(() => '1.2 km'),
  };
  const cameraControl = { initialize: vi.fn() };
  const cameraFraming = { computeInitialFrame: vi.fn(() => ({ frame: 1 })), setEngine: vi.fn(), applyFrame: vi.fn() };
  const routeAnimation = { stopAnimation: vi.fn(), initialize: vi.fn(), isRunning: vi.fn(() => false), startAnimation: vi.fn() };
  const introFlight = { stop: vi.fn(), initialize: vi.fn(), isRunning: vi.fn(() => false), start: vi.fn() };
  const keyboardPan = { initialize: vi.fn() };
  const urlLocation = { getShareUrl: vi.fn(() => 'https://example.test/?l=1,2') };
  const worldDice = {
    onStepDetail: null as ((detail: string) => void) | null,
    rollRandomCity: vi.fn(),
    error: signal<string | null>(null),
  };
  const uiStore = { routesVisible: signal(true), notice: signal<string | null>(null) };
  const gameState = { reset: vi.fn(), initialize: vi.fn(), initializeGlobalRouteGrid: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    engineInit = makeEngineInit();
    locationMgmt = makeLocationMgmt();
    engine = makeEngine();
    state = { spawnPoints: [] };
    callbacks = makeCallbacks(state);
    cachedPaths = new Map([['spawn-1', [HQ, SPAWN]]]);
    dialogClosed = new Subject();
    dialog.open.mockReturnValue({ afterClosed: () => dialogClosed.asObservable() });
    chunk.fails = false;
    osm.loadStreets.mockResolvedValue(network());
    osm.findRandomStreetPoint.mockReturnValue(null);
    worldDice.onStepDetail = null;
    worldDice.error.set(null);
    uiStore.notice.set(null);
    routeAnimation.isRunning.mockReturnValue(false);
    introFlight.isRunning.mockReturnValue(false);

    ctx = {
      engine: engine as unknown as LocationChangeContext['engine'],
      gameState: gameState as unknown as LocationChangeContext['gameState'],
      streetNetwork: null,
      streetNetworkLocation: null,
      heightDebugVisible: signal(false),
    };
    delegate = {
      getChangeContext: vi.fn(() => ctx),
      getChangeCallbacks: () => callbacks,
      isGameInProgress: () => true,
      getCurrentLocationName: () => 'Stuttgart',
    };

    const injector = Injector.create({
      providers: [
        { provide: MatDialog, useValue: dialog },
        { provide: EngineInitializationService, useValue: engineInit },
        { provide: OsmStreetService, useValue: osm },
        { provide: HeightUpdateService, useValue: heightUpdate },
        { provide: MarkerVisualizationService, useValue: markerViz },
        { provide: PathAndRouteService, useValue: pathRoute },
        { provide: CameraControlService, useValue: cameraControl },
        { provide: CameraFramingService, useValue: cameraFraming },
        { provide: RouteAnimationService, useValue: routeAnimation },
        { provide: IntroCameraFlightService, useValue: introFlight },
        { provide: KeyboardPanService, useValue: keyboardPan },
        { provide: LocationManagementService, useValue: locationMgmt },
        { provide: UrlLocationService, useValue: urlLocation },
        { provide: WorldDiceService, useValue: worldDice },
        { provide: UIStore, useValue: uiStore },
        // A factory, like the coordinator below: a class provider would need the JIT compiler.
        { provide: LocationChangeExecutorService, useFactory: () => new LocationChangeExecutorService() },
      ],
    });
    coordinator = runInInjectionContext(injector, () => new LocationChangeCoordinatorService());
    executor = injector.get(LocationChangeExecutorService);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const input = () => ({ hq: { ...HQ, name: 'HQ' }, spawn: { ...SPAWN, name: 'Main Street, Stuttgart' } });

  describe('executeLocationChange (LocationChangeExecutorService)', () => {
    it('reports the loading steps in order and closes each one', async () => {
      await executor.executeLocationChange(input(), ctx, callbacks);

      expect(engineInit.setStepCurrent.mock.calls.map((c) => c[0])).toEqual([
        'engine', 'streets', 'hq', 'spawns', 'routes', 'grid', 'view',
      ]);
      expect(engineInit.setStepDone.mock.calls).toEqual([
        ['engine'],
        ['streets', '3 Streets'],
        ['hq'],
        ['spawns', '1 point'],
        ['grid'],
        ['routes', '1.2 km'],
      ]);
    });

    it('raises every loading flag first and clears them by the end', async () => {
      let flagsDuringReset: boolean[] = [];
      gameState.reset.mockImplementationOnce(() => {
        flagsDuringReset = [
          engineInit.loading(), engineInit.tilesLoading(), engineInit.osmLoading(),
          heightUpdate.heightsLoading(), locationMgmt.isApplyingLocation(),
        ];
      });

      await executor.executeLocationChange(input(), ctx, callbacks);

      expect(flagsDuringReset).toEqual([true, true, true, true, true]);
      expect(heightUpdate.heightProgress()).toBe(0);
      expect(engineInit.resetLoadingSteps).toHaveBeenCalled();
      expect(engineInit.tilesLoading()).toBe(false);
      expect(engineInit.osmLoading()).toBe(false);
      expect(locationMgmt.isApplyingLocation()).toBe(false);
    });

    it('stops the running world and moves the origin to the new HQ', async () => {
      await executor.executeLocationChange(input(), ctx, callbacks);

      expect(heightUpdate.stopHeightUpdates).toHaveBeenCalled();
      expect(routeAnimation.stopAnimation).toHaveBeenCalled();
      expect(introFlight.stop).toHaveBeenCalled();
      expect(gameState.reset).toHaveBeenCalled();
      expect(callbacks.clearMapEntities).toHaveBeenCalled();
      expect(pathRoute.clearCache).toHaveBeenCalled();
      expect(callbacks.setSpawnPoints).toHaveBeenCalledWith([]);
      expect(engine.setOrigin).toHaveBeenCalledWith(HQ.lat, HQ.lon);
      expect(callbacks.setBaseCoords).toHaveBeenCalledWith(HQ);
      expect(callbacks.setCenterCoords).toHaveBeenCalledWith({ ...HQ, height: 400 });
      expect(locationMgmt.setLocation).toHaveBeenCalledWith(HQ, [SPAWN]);
      expect(callbacks.syncUrlWithLocation).toHaveBeenCalled();
    });

    it('frames the camera on HQ and spawn with the lens of the live camera', async () => {
      await executor.executeLocationChange(input(), ctx, callbacks);

      expect(cameraFraming.computeInitialFrame).toHaveBeenCalledWith(HQ, [SPAWN], {
        padding: 0.1, angle: 70, markerRadius: 8, estimatedTerrainY: 0, aspectRatio: 1.5, fov: 50,
      });
      expect(cameraFraming.setEngine).toHaveBeenCalledWith(engine);
      expect(cameraFraming.applyFrame).toHaveBeenCalledWith({ frame: 1 });
    });

    it('loads streets for a new place and hands them to the component', async () => {
      const loaded = network(5);
      osm.loadStreets.mockResolvedValue(loaded);

      await executor.executeLocationChange(input(), ctx, callbacks);

      expect(osm.loadStreets).toHaveBeenCalledWith(HQ.lat, HQ.lon, 2000);
      expect(callbacks.setStreetNetwork).toHaveBeenCalledWith(loaded);
      expect(callbacks.setStreetNetworkLocation).toHaveBeenCalledWith(HQ);
      expect(callbacks.setStreetCount).toHaveBeenCalledWith(5);
      expect(pathRoute.initialize.mock.calls[0][1]).toBe(loaded);
    });

    it('reuses the loaded network when the HQ moved less than 0.001 degrees', async () => {
      const cached = network(7);
      ctx.streetNetwork = cached;
      ctx.streetNetworkLocation = { lat: HQ.lat + 0.0009, lon: HQ.lon - 0.0009 };

      await executor.executeLocationChange(input(), ctx, callbacks);

      expect(osm.loadStreets).not.toHaveBeenCalled();
      expect(engineInit.updateStepMeta).toHaveBeenCalledWith('streets', 'Using cache...');
      expect(callbacks.setStreetCount).toHaveBeenCalledWith(7);
      expect(pathRoute.initialize.mock.calls[0][1]).toBe(cached);
    });

    it('reloads when the cached network is farther away than the threshold', async () => {
      ctx.streetNetwork = network();
      ctx.streetNetworkLocation = { lat: HQ.lat + 0.0011, lon: HQ.lon };

      await executor.executeLocationChange(input(), ctx, callbacks);

      expect(osm.loadStreets).toHaveBeenCalledTimes(1);
    });

    it('closes the streets step without a count when no street was found', async () => {
      osm.loadStreets.mockResolvedValue(network(0));
      await executor.executeLocationChange(input(), ctx, callbacks);
      expect(engineInit.setStepDone).toHaveBeenCalledWith('streets', undefined);
    });

    it('initialises the world services on the new HQ and places its marker', async () => {
      await executor.executeLocationChange(input(), ctx, callbacks);

      expect(markerViz.initialize).toHaveBeenCalledWith(engine, HQ, ctx.heightDebugVisible);
      expect(pathRoute.initialize).toHaveBeenCalledWith(
        engine, expect.anything(), HQ, uiStore.routesVisible, osm, expect.any(Function),
      );
      // Every built route puts its spawn's portal on the route start
      const route = [{ lat: 1, lon: 2 }];
      pathRoute.initialize.mock.calls[0][5]('spawn-1', route, null);
      expect(markerViz.placeSpawnPortal).toHaveBeenCalledWith('spawn-1', route, null);
      expect(cameraControl.initialize).toHaveBeenCalledWith(engine, HQ);
      expect(routeAnimation.initialize).toHaveBeenCalledWith(engine);
      expect(introFlight.initialize).toHaveBeenCalledWith(engine);
      expect(keyboardPan.initialize).toHaveBeenCalledWith(engine);
      expect(markerViz.addBaseMarker).toHaveBeenCalled();
      // The marker service must be ready before the route service hands it the first route.
      expect(markerViz.initialize.mock.invocationCallOrder[0])
        .toBeLessThan(pathRoute.initialize.mock.invocationCallOrder[0]);
    });

    it('adds one spawn named after the part before the first comma', async () => {
      await executor.executeLocationChange(input(), ctx, callbacks);
      expect(callbacks.addSpawnPoint).toHaveBeenCalledWith('spawn-1', 'Main Street', SPAWN.lat, SPAWN.lon, SPAWN_COLORS[0]);
    });

    it('names the spawn "Spawn" when it has no name', async () => {
      await executor.executeLocationChange({ hq: HQ, spawn: { ...SPAWN, name: '' } }, ctx, callbacks);
      expect(callbacks.addSpawnPoint).toHaveBeenCalledWith('spawn-1', 'Spawn', SPAWN.lat, SPAWN.lon, SPAWN_COLORS[0]);
    });

    it('starts the game state on the spawns without their colour and builds the grid', async () => {
      await executor.executeLocationChange(input(), ctx, callbacks);

      expect(gameState.initialize).toHaveBeenCalledWith(
        engine, HQ, [{ id: 'spawn-1', name: 'Main Street', lat: SPAWN.lat, lon: SPAWN.lon }], cachedPaths,
      );
      expect(gameState.initializeGlobalRouteGrid).toHaveBeenCalled();
      const gridOrder = gameState.initializeGlobalRouteGrid.mock.invocationCallOrder[0];
      expect(callbacks.initializeTowerPlacement.mock.invocationCallOrder[0]).toBeGreaterThan(gridOrder);
      expect(callbacks.filterStreetNetworkToRoutes.mock.invocationCallOrder[0]).toBeGreaterThan(gridOrder);
    });

    it('throws when no route connects HQ and spawn, before the grid is built', async () => {
      cachedPaths = new Map();

      await expect(executor.executeLocationChange(input(), ctx, callbacks))
        .rejects.toThrow('No route possible between HQ and spawn');
      expect(gameState.initializeGlobalRouteGrid).not.toHaveBeenCalled();
      expect(callbacks.initializeTowerPlacement).not.toHaveBeenCalled();
    });

    it('saves the location only after the overlay heights are done', async () => {
      let releaseHeights!: () => void;
      callbacks.scheduleOverlayHeightUpdate.mockImplementation(
        () => new Promise<undefined>((resolve) => { releaseHeights = () => resolve(undefined); }),
      );

      const done = executor.executeLocationChange(input(), ctx, callbacks);
      await settle();
      expect(callbacks.scheduleOverlayHeightUpdate).toHaveBeenCalled();
      expect(locationMgmt.saveLocationsToStorage).not.toHaveBeenCalled();
      expect(locationMgmt.isApplyingLocation()).toBe(true);

      releaseHeights();
      await done;
      expect(locationMgmt.saveLocationsToStorage).toHaveBeenCalled();
      expect(locationMgmt.isApplyingLocation()).toBe(false);
      expect(callbacks.appendDebugLog).toHaveBeenCalledWith('Loaded: 1 spawn points');
    });

    it('starts the route animation and the intro flight on the new routes', async () => {
      await executor.executeLocationChange(input(), ctx, callbacks);

      expect(routeAnimation.startAnimation).toHaveBeenCalledWith(cachedPaths, state.spawnPoints);
      expect(introFlight.start).toHaveBeenCalledWith(cachedPaths);
    });

    it('leaves an animation or flight that is already running alone', async () => {
      routeAnimation.isRunning.mockReturnValue(true);
      introFlight.isRunning.mockReturnValue(true);

      await executor.executeLocationChange(input(), ctx, callbacks);

      expect(routeAnimation.startAnimation).not.toHaveBeenCalled();
      expect(introFlight.start).not.toHaveBeenCalled();
    });

    it('carries on after 15 s when the first tiles never arrive', async () => {
      vi.useFakeTimers();
      engine.setOnFirstTilesLoadedCallback.mockImplementation(() => undefined);

      const done = executor.executeLocationChange(input(), ctx, callbacks);
      await vi.advanceTimersByTimeAsync(14_999);
      expect(markerViz.initialize).not.toHaveBeenCalled();
      expect(engineInit.tilesLoading()).toBe(true);

      await vi.advanceTimersByTimeAsync(1);
      await done;
      expect(engineInit.tilesLoading()).toBe(false);
      expect(markerViz.initialize).toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('timed out'));
    });
  });

  describe('applyNewLocation', () => {
    it('does nothing without a registered delegate', async () => {
      await coordinator.applyNewLocation(input());
      expect(engine.setOrigin).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('[LocationCoordinator] No delegate registered');
    });

    it('ignores a second change while one is being applied', async () => {
      coordinator.initializeFlow(delegate);
      locationMgmt.isApplyingLocation.set(true);

      await coordinator.applyNewLocation(input());

      expect(delegate.getChangeContext).not.toHaveBeenCalled();
      expect(engine.setOrigin).not.toHaveBeenCalled();
    });

    it('does nothing while the delegate has no engine', async () => {
      coordinator.initializeFlow(delegate);
      delegate.getChangeContext.mockReturnValue(null);

      await coordinator.applyNewLocation(input());

      expect(engineInit.setStepCurrent).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('[LocationCoordinator] No engine available');
    });

    it('runs the full change with the context and callbacks of the delegate', async () => {
      coordinator.initializeFlow(delegate);
      await coordinator.applyNewLocation(input());

      expect(engine.setOrigin).toHaveBeenCalledWith(HQ.lat, HQ.lon);
      expect(callbacks.addSpawnPoint).toHaveBeenCalled();
      expect(engineInit.setError).not.toHaveBeenCalled();
    });

    it('reports a failed change and clears every loading flag', async () => {
      coordinator.initializeFlow(delegate);
      cachedPaths = new Map();

      await coordinator.applyNewLocation(input());

      const message = 'No route possible between HQ and spawn. The streets are not connected.';
      expect(engineInit.setError).toHaveBeenCalledWith(message);
      expect(callbacks.appendDebugLog).toHaveBeenCalledWith(`Error: ${message}`);
      expect(engineInit.tilesLoading()).toBe(false);
      expect(engineInit.osmLoading()).toBe(false);
      expect(heightUpdate.heightsLoading()).toBe(false);
      expect(locationMgmt.isApplyingLocation()).toBe(false);
    });

    it('falls back to a generic message for errors that are not Error objects', async () => {
      coordinator.initializeFlow(delegate);
      osm.loadStreets.mockRejectedValue('offline');

      await coordinator.applyNewLocation(input());

      expect(engineInit.setError).toHaveBeenCalledWith('Error changing location');
      expect(callbacks.appendDebugLog).toHaveBeenCalledWith('Error: Unknown');
      expect(locationMgmt.isApplyingLocation()).toBe(false);
    });
  });

  describe('openLocationDialog', () => {
    it('does not open without a delegate', async () => {
      await coordinator.openLocationDialog();
      expect(dialog.open).not.toHaveBeenCalled();
    });

    it('opens the dialog with the current HQ, spawn and game state', async () => {
      locationMgmt.editableHqLocation.set({ ...HQ, name: 'Schlossplatz' });
      locationMgmt.editableSpawnLocations.set([{ id: 's1', ...SPAWN, name: 'Spawn A' }]);
      coordinator.initializeFlow(delegate);

      await coordinator.openLocationDialog();

      expect(dialog.open).toHaveBeenCalledWith(LocationDialogComponent, {
        data: {
          currentLocation: { ...HQ, name: 'Stuttgart', displayName: 'Schlossplatz' },
          currentSpawn: { id: 's1', ...SPAWN, name: 'Spawn A' },
          isGameInProgress: true,
        },
        panelClass: 'td-dialog-panel',
        disableClose: false,
      });
    });

    it('passes null locations when none is set yet', async () => {
      coordinator.initializeFlow(delegate);
      await coordinator.openLocationDialog();
      const { data } = dialog.open.mock.calls[0][1];
      expect(data.currentLocation).toBeNull();
      expect(data.currentSpawn).toBeNull();
    });

    it('says so over the game when the dialog does not load', async () => {
      chunk.fails = true;
      coordinator.initializeFlow(delegate);

      await coordinator.openLocationDialog();

      expect(console.error).toHaveBeenCalledWith(
        '[LocationCoordinator] Location dialog did not load:', expect.any(LocationDialogLoadError),
      );
      expect(uiStore.notice()).toBe(LOCATION_DIALOG_LOAD_FAILED);
      expect(engineInit.loading()).toBe(false);
    });

    it('tells a dialog that loaded but failed to open apart from one that did not load', async () => {
      const bug = new Error('NG0201: No provider found');
      dialog.open.mockImplementation(() => { throw bug; });
      coordinator.initializeFlow(delegate);

      await coordinator.openLocationDialog();

      expect(console.error).toHaveBeenCalledWith('[LocationCoordinator] Location dialog failed to open:', bug);
      expect(uiStore.notice()).toBe(LOCATION_DIALOG_OPEN_FAILED);
      expect(engineInit.loading()).toBe(false);
    });

    it('does nothing when the dialog is dismissed', async () => {
      coordinator.initializeFlow(delegate);
      await coordinator.openLocationDialog();

      dialogClosed.next(null);
      await settle();

      expect(engineInit.loading()).toBe(false);
      expect(engine.setOrigin).not.toHaveBeenCalled();
    });

    it('applies a confirmed location with the chosen spawn', async () => {
      coordinator.initializeFlow(delegate);
      await coordinator.openLocationDialog();

      dialogClosed.next({
        confirmed: true,
        hq: { ...HQ, displayName: 'Schlossplatz', address: 'Stuttgart' },
        spawn: { ...SPAWN, name: 'Königstraße', isRandom: false },
      } as unknown as LocationDialogResult);
      await settle();

      expect(osm.findRandomStreetPoint).not.toHaveBeenCalled();
      expect(engine.setOrigin).toHaveBeenCalledWith(HQ.lat, HQ.lon);
      expect(callbacks.addSpawnPoint).toHaveBeenCalledWith('spawn-1', 'Königstraße', SPAWN.lat, SPAWN.lon, SPAWN_COLORS[0]);
    });

    it('draws a random street spawn 500 to 1000 m away and shares the loaded streets', async () => {
      const loaded = network();
      osm.loadStreets.mockResolvedValue(loaded);
      osm.findRandomStreetPoint.mockReturnValue({ lat: 48.781, lon: 9.191, distance: 742.4, streetName: 'Hauptstätter Str.' });
      coordinator.initializeFlow(delegate);
      await coordinator.openLocationDialog();

      dialogClosed.next({
        confirmed: true,
        hq: { ...HQ, displayName: 'HQ' },
        spawn: { lat: 0, lon: 0, name: '', isRandom: true },
      } as unknown as LocationDialogResult);
      await settle();

      expect(osm.findRandomStreetPoint).toHaveBeenCalledWith(loaded, HQ.lat, HQ.lon, 500, 1000);
      expect(callbacks.setStreetNetwork).toHaveBeenCalledWith(loaded);
      expect(callbacks.setStreetNetworkLocation).toHaveBeenCalledWith(HQ);
      expect(callbacks.appendDebugLog).toHaveBeenCalledWith('Random spawn: 742m away');
      expect(callbacks.addSpawnPoint).toHaveBeenCalledWith('spawn-1', 'Hauptstätter Str.', 48.781, 9.191, SPAWN_COLORS[0]);
    });

    it('falls back to a spawn about 700 m north when no street point is found', async () => {
      coordinator.initializeFlow(delegate);
      await coordinator.openLocationDialog();

      dialogClosed.next({
        confirmed: true,
        hq: { ...HQ, displayName: 'HQ' },
        spawn: { lat: 0, lon: 0, name: '', isRandom: true },
      } as unknown as LocationDialogResult);
      await settle();

      expect(callbacks.appendDebugLog).toHaveBeenCalledWith('No valid spawn found, using fallback');
      expect(callbacks.addSpawnPoint).toHaveBeenCalledWith(
        'spawn-1', 'Fallback Spawn', HQ.lat + 0.0063, HQ.lon, SPAWN_COLORS[0],
      );
    });
  });

  describe('favorites', () => {
    const favA: FavoriteLocation = { id: 'a', hq: HQ, spawns: [SPAWN] } as unknown as FavoriteLocation;
    const favB: FavoriteLocation = { id: 'b', hq: SPAWN, spawns: [] } as unknown as FavoriteLocation;

    it('resolves the display name of every favorite when the flow starts', async () => {
      locationMgmt.favorites.set([favA, favB]);
      coordinator.initializeFlow(delegate);
      await settle();
      expect(coordinator.favoriteNamesMap()).toEqual({ a: 'name-a', b: 'name-b' });
    });

    it('saves the current location and refreshes the names', async () => {
      coordinator.initializeFlow(delegate);
      await settle();
      locationMgmt.favorites.set([favA]);

      coordinator.onAddFavorite();
      await settle();

      expect(locationMgmt.saveFavorite).toHaveBeenCalled();
      expect(coordinator.favoriteNamesMap()).toEqual({ a: 'name-a' });
      expect(callbacks.appendDebugLog).toHaveBeenCalledWith('Favorite saved');
    });

    it('deletes one favorite and drops only its name', async () => {
      locationMgmt.favorites.set([favA, favB]);
      coordinator.initializeFlow(delegate);
      await settle();

      coordinator.onDeleteFavorite('a');

      expect(locationMgmt.deleteFavorite).toHaveBeenCalledWith('a');
      expect(coordinator.favoriteNamesMap()).toEqual({ b: 'name-b' });
      expect(callbacks.appendDebugLog).toHaveBeenCalledWith('Favorite deleted');
    });

    it('applies a favorite with its first spawn', async () => {
      coordinator.initializeFlow(delegate);
      await coordinator.onSelectFavorite(favA);

      expect(locationMgmt.setLocation).toHaveBeenCalledWith(HQ, [SPAWN]);
      expect(callbacks.syncUrlWithLocation).toHaveBeenCalled();
      expect(engine.setOrigin).toHaveBeenCalledWith(HQ.lat, HQ.lon);
      expect(callbacks.addSpawnPoint).toHaveBeenCalledWith('spawn-1', 'Spawn', SPAWN.lat, SPAWN.lon, SPAWN_COLORS[0]);
    });

    it('puts the spawn 0.005 degrees north of a favorite that has none', async () => {
      coordinator.initializeFlow(delegate);
      await coordinator.onSelectFavorite(favB);

      expect(callbacks.addSpawnPoint).toHaveBeenCalledWith(
        'spawn-1', 'Spawn', SPAWN.lat + 0.005, SPAWN.lon, SPAWN_COLORS[0],
      );
    });
  });

  describe('share and world dice', () => {
    it('copies the share URL to the clipboard', () => {
      const writeText = vi.fn();
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      coordinator.initializeFlow(delegate);

      coordinator.onShareLocation();

      expect(writeText).toHaveBeenCalledWith('https://example.test/?l=1,2');
      expect(callbacks.appendDebugLog).toHaveBeenCalledWith('Link copied: https://example.test/?l=1,2');
      vi.unstubAllGlobals();
    });

    it('hides the loading overlay and logs the reason when the dice roll fails', async () => {
      worldDice.rollRandomCity.mockImplementation(async () => {
        worldDice.onStepDetail?.('Querying Wikidata');
        worldDice.error.set('Timeout');
        return null;
      });
      coordinator.initializeFlow(delegate);

      await coordinator.onWorldDice();

      expect(engineInit.startWorldDiceLoading).toHaveBeenCalled();
      expect(engineInit.updateWorldDiceDetail).toHaveBeenCalledWith('Querying Wikidata');
      expect(worldDice.onStepDetail).toBeNull();
      expect(engineInit.setLoading).toHaveBeenCalledWith(false);
      expect(engineInit.finishWorldDiceLoading).not.toHaveBeenCalled();
      expect(callbacks.appendDebugLog).toHaveBeenCalledWith('World Dice: Failed - Timeout');
    });

    it('announces the rolled city before it navigates', async () => {
      vi.useFakeTimers();
      worldDice.rollRandomCity.mockResolvedValue({ name: 'Lyon', country: 'France', lat: 45.764, lon: 4.8357 });
      coordinator.initializeFlow(delegate);

      // Stops before the 300 ms delay that ends in a full page navigation.
      void coordinator.onWorldDice();
      await vi.advanceTimersByTimeAsync(0);

      expect(engineInit.finishWorldDiceLoading).toHaveBeenCalledWith('Lyon, France');
      expect(callbacks.appendDebugLog).toHaveBeenCalledWith('World Dice: Lyon, France (45.7640, 4.8357)');
      expect(engineInit.setLoading).not.toHaveBeenCalled();
    });
  });
});
