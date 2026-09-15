import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';

// InputHandlerService imports MatDialog; the real module is partially compiled
// and needs the JIT compiler.
vi.mock('@angular/material/dialog', () => ({ MatDialog: class MatDialog {} }));

// The visualizer builds an InstancedMesh from the profile; the fake records
// what the facade asks of it.
const dpsViz = vi.hoisted(() => ({
  instances: [] as {
    sync: unknown;
    mesh: { parent: unknown };
    updates: unknown[];
    visible: boolean | null;
    disposed: boolean;
  }[],
}));
vi.mock('../../ai/core/dps-profile-visualizer', () => ({
  DpsProfileVisualizer: class {
    mesh = { parent: null as unknown };
    updates: unknown[] = [];
    visible: boolean | null = null;
    disposed = false;
    constructor(public sync: unknown) {
      dpsViz.instances.push(this);
    }
    update(profile: unknown) { this.updates.push(profile); }
    setVisible(visible: boolean) { this.visible = visible; }
    getMesh() { return this.mesh; }
    dispose() { this.disposed = true; }
  },
}));

import { VisualizationFacadeService } from './visualization-facade.service';
import { CorridorRefit } from '../world/corridor-refit';
import { OsmStreetService } from '../location/osm-street.service';
import { UIStore } from '../../store/ui.store';
import { CameraControlService, type CameraView } from '../camera-control.service';
import { MarkerVisualizationService, SpawnPoint } from '../world/marker-visualization.service';
import { PathAndRouteService } from '../world/path-route.service';
import { InputHandlerService } from '../input-handler.service';
import { TowerPlacementService } from '../tower-placement.service';
import { AbilityTargetingService } from '../ability-targeting.service';
import { HeroControlService } from '../hero-control.service';
import { MapPlacementService } from '../world/map-placement.service';
import { MEASURING_STEP, RelocationStatusService } from '../world/relocation-status.service';
import { HeightUpdateService } from '../world/height-update.service';
import { EngineInitializationService } from '../infrastructure/engine-initialization.service';
import { DevWorldService } from '../../devworld/devworld.service';
import { CameraFramingService } from '../camera-framing.service';
import { IntroCameraFlightService } from '../world/intro-camera-flight.service';
import { RouteAnimationService } from '../world/route-animation.service';
import { KeyboardPanService } from '../keyboard-pan.service';
import { StreetRenderingService } from '../world/street-rendering.service';
import { BuildingRenderingService } from '../world/building-rendering.service';
import { StrategicPlacementService } from '../world/strategic-placement.service';
import { EnemyDebugService } from '../debug/enemy-debug.service';
import { TowerDebugService } from '../debug/tower-debug.service';
import { DebugFacadeService } from '../debug/debug-facade.service';
import { CellReportService } from '../debug/cell-report.service';
import { LosDebugService } from '../debug/los-debug.service';
import { GlobalRouteGridService } from '../world/global-route-grid.service';
import { LocationManagementService } from '../location/location-management.service';
import { AIDataCollectorService } from '../../ai/core/ai-data-collector.service';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { EngineStore } from '../../store/engine.store';
import { GameEventBus } from '../../game-engine/game-event-bus';
import {
  CAMERA_ANGLE, CAMERA_MARKER_RADIUS, CAMERA_PADDING, STREET_FILTER_RADIUS, SPAWN_COLORS,
} from '../../configs/map-constants.config';
import { INTRO_GATE_SAMPLES_PER_FRAME, INTRO_GATE_TIMEOUT_MS } from '../../utils/flight-gate';
import type { FacadeComponentBridge } from './tower-defense-facade.service';
import type { GameStateManager } from '../../managers/game-state.manager';
import type { CameraFrame } from '../camera-framing.service';

/**
 * The visualization sub-facade wires the world services to a loaded
 * location, holds the loading screen for the intro flight, keeps baked
 * heights (route line, markers) in step with streaming tiles and owns camera
 * framing, the building and DPS overlays. These tests pin those paths against
 * fakes; the corridor rules themselves live in CorridorRefit.
 */

const HQ = { lat: 48.7758, lon: 9.1829 };
const SPAWN: SpawnPoint = { id: 'spawn-1', name: 'Spawn', lat: 48.78, lon: 9.19, color: SPAWN_COLORS[0] };
const ROUTE = [{ ...HQ, height: 1 }, { lat: SPAWN.lat, lon: SPAWN.lon, height: 2 }];
const FRAME = { camX: 1, camY: 2, camZ: 3, lookAtX: 4, lookAtY: 5, lookAtZ: 6 } as CameraFrame;
const VIEW: CameraView = { position: { x: 1, y: 2, z: 3 }, target: { x: 4, y: 5, z: 6 } };

describe('VisualizationFacadeService', () => {
  let facade: VisualizationFacadeService;
  let bus: GameEventBus;
  let streetNetwork: object | null;
  let filteredNetwork: object | null;
  let cachedPaths: Map<string, typeof ROUTE>;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;
  let cellsChanged: (() => void) | null;
  let towerCount: number;
  let sweepFrames: number;

  type Fn = ReturnType<typeof vi.fn>;
  /** The corridor measurement fake: slices a run takes, whether it changes a corridor, the runs so far. */
  let corridor: { slices: number; changed: boolean; runs: { open: boolean; step: Fn; commit: Fn; cancel: Fn }[] };
  function corridorRun() {
    let left = corridor.slices;
    const run = {
      open: true,
      step: vi.fn(() => !run.open || --left <= 0),
      commit: vi.fn(() => {
        const changed = run.open && corridor.changed;
        run.open = false;
        return changed;
      }),
      cancel: vi.fn(() => {
        run.open = false;
      }),
    };
    corridor.runs.push(run);
    return run;
  }

  const scene = {
    add: vi.fn((m: { parent: unknown }) => { m.parent = scene; }),
    remove: vi.fn((m: { parent: unknown }) => { m.parent = null; }),
  };
  const engine = {
    getScene: () => scene,
    towers: { setShowShootHeight: vi.fn(), applyDebugOverrides: vi.fn() },
    terrain: { lodVersion: 0 },
    routeCorridorLod: () => null,
  };
  const canvas = { id: 'canvas' };
  const bridge = {
    getEngine: vi.fn((): unknown => engine),
    getStreetNetwork: vi.fn(() => streetNetwork),
    getDevStreetProvider: vi.fn((): unknown => null),
    getFilteredStreetNetwork: vi.fn(() => filteredNetwork),
    setFilteredStreetNetwork: vi.fn(),
    getCanvasElement: vi.fn(() => canvas),
    onTerrainClick: vi.fn(),
    onMouseMove: vi.fn(),
    exitBuildMode: vi.fn(),
    handleEnemyPlacement: vi.fn(),
    onMapPlacementClick: vi.fn(),
    onMapPlacementMove: vi.fn(),
    exitMapPlacement: vi.fn(),
  };
  const cellsOff = vi.fn();
  const grid = {
    addCellsChangedListener: vi.fn((listener: () => void) => {
      cellsChanged = listener;
      return cellsOff;
    }),
    isTerrainRefreshActive: vi.fn(() => sweepFrames > 0),
    stepTerrainHeightRefresh: vi.fn(() => { sweepFrames--; }),
    beginTerrainHeightRefresh: vi.fn(),
    retryUnsampledCells: vi.fn(() => ({ promoted: 0 })),
    updateTerrainHeights: vi.fn(),
    initSpatialGridVisualizationIfEnabled: vi.fn(),
    initAirSpatialGridVisualizationIfEnabled: vi.fn(),
    initAirRouteLayerIfEnabled: vi.fn(),
    getStats: vi.fn(() => ({ totalCells: 42 })),
    clear: vi.fn(),
    isInitialized: vi.fn(() => false),
    getGrid: vi.fn((): unknown => null),
    getCoordinateSync: vi.fn((): unknown => ({ sync: true })),
  };
  const music = { onLoadingComplete: vi.fn() };
  const towerManager = { getSelected: vi.fn(() => null), getById: vi.fn(() => null) };
  const gameState = {
    initialize: vi.fn(),
    initializeGlobalRouteGrid: vi.fn(),
    getGlobalRouteGrid: () => grid,
    getEventBus: () => bus,
    towerCount: () => towerCount,
    enemyManager: { getAliveCount: () => 0 },
    waveManager: { phase: () => 'setup' },
    onTilesLoaded: vi.fn(),
    backgroundMusic: music,
    towerManager,
    setBeforeCorridorLock: vi.fn(),
  };

  const osm = {
    filterStreetsNearRoutes: vi.fn(() => ({ filtered: true })),
    loadBuildings: vi.fn(),
    filterBuildingsNearRoutes: vi.fn(() => ['near']),
  };
  const uiStore = { routesVisible: signal(true), buildingsVisible: signal(false) };
  const cameraControl = {
    initialize: vi.fn(),
    setOverviewProvider: vi.fn(),
    showDebugVisualization: vi.fn(),
    saveInitialPosition: vi.fn(),
    toggleDebugFraming: vi.fn(() => true),
    getCameraDebugInfo: vi.fn(() => ({ pitch: 45 })),
  };
  const markerViz = {
    initialize: vi.fn(),
    placeSpawnPortal: vi.fn(),
    subscribeToEventBus: vi.fn(),
    addBaseMarker: vi.fn(),
    updateMarkerHeights: vi.fn(),
    toggleSpecialPointsDebug: vi.fn(),
  };
  const pathRoute = {
    initialize: vi.fn(),
    getCachedPaths: vi.fn(() => cachedPaths),
    getRouteDetail: vi.fn(() => '1.2 km'),
    refreshRouteLines: vi.fn(),
    toggleRouteLinesVisibility: vi.fn(),
    beginClearanceMeasurement: vi.fn(() => corridorRun()),
    hasUnmeasuredStations: vi.fn(() => false),
    hasUnwalkableCells: vi.fn(() => false),
    narrowToWalkable: vi.fn(() => false),
    clearCorridorMeasurements: vi.fn(),
    explainCorridorAt: vi.fn(() => null),
  };
  const inputHandler = {
    initialize: vi.fn(),
    setEnemyPlacementCallback: vi.fn(),
    setMapPlacementCallback: vi.fn(),
    setAbilityTargetingCallback: vi.fn(),
    setHeroCallbacks: vi.fn(),
    initKeyboard: vi.fn(),
    armPick: vi.fn(),
    setCellReportCallbacks: vi.fn(),
  };
  const cellReport = {
    active: signal(false),
    box: signal<unknown>(null),
    start: vi.fn(() => 'Cell report on'),
    stop: vi.fn(),
    click: vi.fn(),
    select: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const towerPlacement = { buildMode: signal(false), initialize: vi.fn() };
  const abilityTargeting = {
    targeting: vi.fn(() => null),
    click: vi.fn(),
    hover: vi.fn(),
    cancel: vi.fn(),
    initialize: vi.fn(),
  };
  const heroControl = {
    selected: vi.fn(() => true),
    pick: vi.fn(() => false),
    toggle: vi.fn(),
    click: vi.fn(),
    hover: vi.fn(),
    deselect: vi.fn(),
    initialize: vi.fn(),
  };
  const heightUpdate = { initialize: vi.fn(), scheduleOverlayHeightUpdate: vi.fn(async () => undefined), heightsLoading: signal(false) };
  const engineInit = {
    getEngine: vi.fn((): unknown => engine),
    setStepCurrent: vi.fn(async (_id: string) => undefined),
    setStepDone: vi.fn(async (_id: string, _meta?: string) => undefined),
    updateStepMeta: vi.fn(),
    loadingStatus: signal('status'),
    loading: signal(false),
    tilesLoading: signal(false),
    osmLoading: signal(false),
    checkAllLoaded: vi.fn(() => engineInit.loading.set(false)),
    getFirstTilesLoadedAt: vi.fn((): number | null => performance.now()),
  };
  const devWorld = { isActive: false };
  const cameraFraming = {
    setEngine: vi.fn(),
    getLastFrame: vi.fn((): CameraFrame | null => null),
    applyFrame: vi.fn(),
    computeFrameWithEngine: vi.fn((_hq: unknown, _spawns: unknown, _options: unknown): CameraFrame | null => FRAME),
  };
  const routeAnimation = { initialize: vi.fn(), isRunning: vi.fn(() => false), startAnimation: vi.fn() };
  const introFlight = {
    initialize: vi.fn(),
    isRunning: vi.fn(() => false),
    start: vi.fn(),
    prepare: vi.fn(() => true),
    readiness: vi.fn(() => 0),
    prepareTick: vi.fn(),
  };
  const keyboardPan = { initialize: vi.fn() };
  const streetRendering = { renderStreets: vi.fn(), toggleVisibility: vi.fn() };
  const buildingRendering = { reset: vi.fn(), renderBuildings: vi.fn(), toggleVisibility: vi.fn() };
  const strategicPlacement = { initialize: vi.fn() };
  const enemyDebug = { initialize: vi.fn(), placementMode: vi.fn(() => false) };
  const towerDebug = { showShootHeight: signal(false), allOverrides: signal({}), selectTower: vi.fn() };
  const losDebug = { initialize: vi.fn() };
  const gridService = { name: 'grid service' };
  const locationMgmt = { isApplyingLocation: signal(false) };
  const aiDataCollector = { getCurrentDPSProfile: vi.fn(() => ({ profile: 1 })) };
  const mapPlacement = { initialize: vi.fn(), placementMode: vi.fn(() => null) };
  const engineStore = { cameraDebugEnabled: signal(false), cameraDebugInfo: signal<unknown>(null) };
  const relocationStatus = { status: signal<{ title: string; step: string; percent: number | null } | null>(null) };
  let store: {
    baseCoords: ReturnType<typeof signal<{ lat: number; lon: number }>>;
    centerCoords: ReturnType<typeof signal<{ lat: number; lon: number; height: number }>>;
    spawnPoints: ReturnType<typeof signal<SpawnPoint[]>>;
    heightDebugVisible: ReturnType<typeof signal<boolean>>;
    streetsVisible: ReturnType<typeof signal<boolean>>;
    cameraFramingDebug: ReturnType<typeof signal<boolean>>;
  };

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  /** Run the animation frames that are due now; frames they request wait for the next call. */
  const runFrames = (times = 1) => {
    for (let i = 0; i < times; i++) {
      const due = [...frames.values()];
      frames.clear();
      for (const callback of due) callback(0);
    }
  };

  function create(): VisualizationFacadeService {
    const injector = Injector.create({
      providers: [
        { provide: OsmStreetService, useValue: osm },
        { provide: UIStore, useValue: uiStore },
        { provide: CameraControlService, useValue: cameraControl },
        { provide: MarkerVisualizationService, useValue: markerViz },
        { provide: PathAndRouteService, useValue: pathRoute },
        { provide: InputHandlerService, useValue: inputHandler },
        { provide: TowerPlacementService, useValue: towerPlacement },
        { provide: AbilityTargetingService, useValue: abilityTargeting },
        { provide: HeroControlService, useValue: heroControl },
        { provide: HeightUpdateService, useValue: heightUpdate },
        { provide: EngineInitializationService, useValue: engineInit },
        { provide: DevWorldService, useValue: devWorld },
        { provide: CameraFramingService, useValue: cameraFraming },
        { provide: RouteAnimationService, useValue: routeAnimation },
        { provide: IntroCameraFlightService, useValue: introFlight },
        { provide: KeyboardPanService, useValue: keyboardPan },
        { provide: StreetRenderingService, useValue: streetRendering },
        { provide: BuildingRenderingService, useValue: buildingRendering },
        { provide: StrategicPlacementService, useValue: strategicPlacement },
        { provide: EnemyDebugService, useValue: enemyDebug },
        { provide: TowerDebugService, useValue: towerDebug },
        { provide: DebugFacadeService, useValue: {} },
        { provide: LosDebugService, useValue: losDebug },
        { provide: GlobalRouteGridService, useValue: gridService },
        { provide: LocationManagementService, useValue: locationMgmt },
        { provide: AIDataCollectorService, useValue: aiDataCollector },
        { provide: MapPlacementService, useValue: mapPlacement },
        { provide: TowerDefenseStore, useValue: store },
        { provide: EngineStore, useValue: engineStore },
        { provide: RelocationStatusService, useValue: relocationStatus },
        { provide: CellReportService, useValue: cellReport },
      ],
    });
    return runInInjectionContext(injector, () => new VisualizationFacadeService());
  }

  beforeEach(() => {
    vi.clearAllMocks();
    for (const method of ['log', 'warn', 'error', 'table'] as const) {
      vi.spyOn(console, method).mockImplementation(() => undefined);
    }
    frames = new Map();
    nextFrameId = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));

    bus = new GameEventBus();
    streetNetwork = { streets: [{}] };
    filteredNetwork = { streets: [{}], filtered: true };
    cachedPaths = new Map([['spawn-1', ROUTE]]);
    cellsChanged = null;
    towerCount = 0;
    sweepFrames = 0;
    dpsViz.instances.length = 0;
    devWorld.isActive = false;
    bridge.getEngine.mockImplementation(() => engine);
    bridge.getDevStreetProvider.mockImplementation(() => null);
    engineInit.getEngine.mockImplementation(() => engine);
    engineInit.loading.set(false);
    engineInit.tilesLoading.set(false);
    engineInit.osmLoading.set(false);
    engineInit.getFirstTilesLoadedAt.mockImplementation(() => performance.now());
    heightUpdate.heightsLoading.set(false);
    locationMgmt.isApplyingLocation.set(false);
    uiStore.buildingsVisible.set(false);
    engineStore.cameraDebugEnabled.set(false);
    engineStore.cameraDebugInfo.set(null);
    relocationStatus.status.set(null);
    grid.isInitialized.mockReturnValue(false);
    grid.getCoordinateSync.mockReturnValue({ sync: true });
    grid.retryUnsampledCells.mockReturnValue({ promoted: 0 });
    introFlight.isRunning.mockReturnValue(false);
    introFlight.prepare.mockReturnValue(true);
    introFlight.readiness.mockReturnValue(0);
    routeAnimation.isRunning.mockReturnValue(false);
    cameraFraming.getLastFrame.mockReturnValue(null);
    cameraFraming.computeFrameWithEngine.mockReturnValue(FRAME);
    corridor = { slices: 1, changed: false, runs: [] };
    pathRoute.hasUnmeasuredStations.mockReturnValue(false);
    cameraControl.toggleDebugFraming.mockReturnValue(true);

    store = {
      baseCoords: signal({ ...HQ }),
      centerCoords: signal({ lat: 48.777, lon: 9.185, height: 400 }),
      spawnPoints: signal<SpawnPoint[]>([SPAWN]),
      heightDebugVisible: signal(false),
      streetsVisible: signal(true),
      cameraFramingDebug: signal(false),
    };

    facade = create();
    facade.initialize(bridge as unknown as FacadeComponentBridge, gameState as unknown as GameStateManager);
  });

  afterEach(() => {
    facade.dispose();
    delete (globalThis as Record<string, unknown>)['__corridor'];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('initializeVisualizationServices', () => {
    it('does nothing without an engine or without streets', () => {
      engineInit.getEngine.mockReturnValue(null);
      facade.initializeVisualizationServices();
      engineInit.getEngine.mockReturnValue(engine);
      streetNetwork = null;
      facade.initializeVisualizationServices();

      expect(markerViz.initialize).not.toHaveBeenCalled();
      expect(pathRoute.initialize).not.toHaveBeenCalled();
    });

    it('initialises the world services on the base', () => {
      facade.initializeVisualizationServices();

      expect(markerViz.initialize).toHaveBeenCalledWith(engine, HQ, store.heightDebugVisible);
      expect(pathRoute.initialize).toHaveBeenCalledWith(
        engine, streetNetwork, HQ, uiStore.routesVisible, osm, expect.any(Function),
      );
      // Every built route puts its spawn's portal on the route start
      const route = [{ lat: 1, lon: 2 }];
      pathRoute.initialize.mock.calls[0][5]('spawn-1', route, 12);
      expect(markerViz.placeSpawnPortal).toHaveBeenCalledWith('spawn-1', route, 12);
      expect(cameraControl.initialize).toHaveBeenCalledWith(engine, HQ);
      expect(cameraFraming.setEngine).toHaveBeenCalledWith(engine);
      expect(routeAnimation.initialize).toHaveBeenCalledWith(engine);
      expect(introFlight.initialize).toHaveBeenCalledWith(engine);
      expect(keyboardPan.initialize).toHaveBeenCalledWith(engine);
    });

    it('routes pathfinding through the DevWorld street provider in DevWorld', () => {
      const devStreets = { dev: true };
      devWorld.isActive = true;
      bridge.getDevStreetProvider.mockReturnValue(devStreets);

      facade.initializeVisualizationServices();

      expect(pathRoute.initialize.mock.calls[0][4]).toBe(devStreets);
    });

    it('hands the camera an overview that is computed fresh on each request', () => {
      facade.initializeVisualizationServices();
      const provider = cameraControl.setOverviewProvider.mock.calls[0][0] as () => CameraView | null;

      expect(provider()).toEqual(VIEW);
      const [hq, spawns, options] = cameraFraming.computeFrameWithEngine.mock.calls[0] as unknown as [
        unknown, unknown, Record<string, unknown>,
      ];
      expect(hq).toEqual(HQ);
      expect(spawns).toEqual([{ lat: SPAWN.lat, lon: SPAWN.lon }]);
      expect(options).toMatchObject({
        padding: CAMERA_PADDING,
        angle: CAMERA_ANGLE,
        markerRadius: CAMERA_MARKER_RADIUS,
        routePoints: ROUTE.map(({ lat, lon }) => ({ lat, lon })),
      });
      expect(options['groundAt']).toBeUndefined();

      cachedPaths = new Map();
      expect(provider()).toBeNull();
      expect(cameraFraming.computeFrameWithEngine).toHaveBeenCalledTimes(1);
    });

    it('frames on cell ground and trusts it up to a tile error of 20 m', () => {
      grid.isInitialized.mockReturnValue(true);
      grid.getGrid.mockReturnValue({
        getGroundSampleAt: (x: number) =>
          x === 0 ? { y: 12, tileError: 20 } : x === 1 ? { y: 30, tileError: 21 } : null,
      });
      facade.reframeCameraWithRoutes();

      const options = cameraFraming.computeFrameWithEngine.mock.calls[0][2] as unknown as {
        groundAt: (x: number, z: number) => unknown;
      };
      expect(options.groundAt(0, 0)).toEqual({ y: 12, reliable: true });
      expect(options.groundAt(1, 0)).toEqual({ y: 30, reliable: false });
      expect(options.groundAt(2, 0)).toBeNull();
    });

    it('re-bakes route line and markers once per frame when cells change', () => {
      routeAnimation.isRunning.mockReturnValue(true);
      facade.initializeVisualizationServices();

      cellsChanged!();
      cellsChanged!();
      expect(pathRoute.refreshRouteLines).not.toHaveBeenCalled();
      runFrames();

      expect(pathRoute.refreshRouteLines).toHaveBeenCalledTimes(1);
      expect(pathRoute.refreshRouteLines).toHaveBeenCalledWith([SPAWN]);
      expect(markerViz.updateMarkerHeights).toHaveBeenCalledWith();
      expect(routeAnimation.startAnimation).toHaveBeenCalledWith(cachedPaths, [SPAWN]);
    });

    it('does not restart an animation that is not running', () => {
      facade.initializeVisualizationServices();
      cellsChanged!();
      runFrames();
      expect(routeAnimation.startAnimation).not.toHaveBeenCalled();
    });

    it('keeps one cells-changed subscription across location changes', () => {
      facade.initializeVisualizationServices();
      facade.initializeVisualizationServices();

      expect(grid.addCellsChangedListener).toHaveBeenCalledTimes(2);
      expect(cellsOff).toHaveBeenCalledTimes(1);
    });
  });

  describe('setupClickHandlerWithGameState', () => {
    it('does nothing without an engine', () => {
      bridge.getEngine.mockReturnValue(null);
      engineInit.getEngine.mockReturnValue(null);
      facade.setupClickHandlerWithGameState();
      expect(inputHandler.initialize).not.toHaveBeenCalled();
    });

    it('wires clicks, moves and keys to the component bridge', () => {
      facade.setupClickHandlerWithGameState();

      const [canvasArg, engineArg, gameStateArg, buildMode, onClick, onMove] = inputHandler.initialize.mock.calls[0];
      expect([canvasArg, engineArg, gameStateArg, buildMode]).toEqual([canvas, engine, gameState, towerPlacement.buildMode]);
      onClick(1, 2, 3);
      onMove(1, 2, 'hit');
      expect(bridge.onTerrainClick).toHaveBeenCalledWith(1, 2, 3);
      expect(bridge.onMouseMove).toHaveBeenCalledWith(1, 2, 'hit');

      const [enemyMode, onEnemy] = inputHandler.setEnemyPlacementCallback.mock.calls[0];
      enemyMode();
      onEnemy(4, 5, 6);
      expect(enemyDebug.placementMode).toHaveBeenCalled();
      expect(bridge.handleEnemyPlacement).toHaveBeenCalledWith(4, 5, 6);

      const [mapMode, onMapClick, onMapMove] = inputHandler.setMapPlacementCallback.mock.calls[0];
      mapMode();
      onMapClick(7, 8, 9);
      onMapMove(7, 8, 'hit');
      expect(mapPlacement.placementMode).toHaveBeenCalled();
      expect(bridge.onMapPlacementClick).toHaveBeenCalledWith(7, 8, 9);
      expect(bridge.onMapPlacementMove).toHaveBeenCalledWith(7, 8, 'hit');

      const [aimMode, onAim, onAimMove, onAimCancel] = inputHandler.setAbilityTargetingCallback.mock.calls[0];
      aimMode();
      onAim(10, 11, 12);
      onAimMove(10, 11, 'hit');
      onAimCancel();
      expect(abilityTargeting.targeting).toHaveBeenCalled();
      expect(abilityTargeting.click).toHaveBeenCalledWith(10, 11, 12);
      expect(abilityTargeting.hover).toHaveBeenCalledWith(10, 11, 'hit');
      expect(abilityTargeting.cancel).toHaveBeenCalled();

      const hero = inputHandler.setHeroCallbacks.mock.calls[0][0];
      expect(hero.selected()).toBe(true);
      expect(hero.pick(1, 2)).toBe(false);
      hero.toggle();
      hero.click(13, 14, 15);
      hero.move(13, 14, 'hit');
      hero.cancel();
      expect(heroControl.pick).toHaveBeenCalledWith(1, 2);
      expect(heroControl.toggle).toHaveBeenCalled();
      expect(heroControl.click).toHaveBeenCalledWith(13, 14, 15);
      expect(heroControl.hover).toHaveBeenCalledWith(13, 14, 'hit');
      expect(heroControl.deselect).toHaveBeenCalled();

      const report = inputHandler.setCellReportCallbacks.mock.calls[0][0];
      cellReport.active.set(true);
      expect(report.active()).toBe(true);
      report.click('hit');
      report.drag({ left: 1, top: 2, right: 3, bottom: 4 });
      report.select({ left: 1, top: 2, right: 3, bottom: 4 });
      report.end();
      expect(cellReport.click).toHaveBeenCalledWith('hit');
      expect(cellReport.box()).toEqual({ left: 1, top: 2, right: 3, bottom: 4 });
      expect(cellReport.select).toHaveBeenCalledWith({ left: 1, top: 2, right: 3, bottom: 4 });
      expect(cellReport.stop).toHaveBeenCalled();
      cellReport.active.set(false);
      cellReport.box.set(null);

      const keys = inputHandler.initKeyboard.mock.calls[0][0];
      keys.exitBuildMode();
      keys.exitMapPlacement();
      expect(bridge.exitBuildMode).toHaveBeenCalled();
      expect(bridge.exitMapPlacement).toHaveBeenCalled();
    });
  });

  describe('initializeGameState', () => {
    it('returns nothing before initialize', () => {
      const fresh = create();
      expect(fresh.initializeGameState()).toBeUndefined();
      expect(gameState.initialize).not.toHaveBeenCalled();
      fresh.dispose();
    });

    it('returns nothing without streets', () => {
      streetNetwork = null;
      expect(facade.initializeGameState()).toBeUndefined();
      expect(gameState.initialize).not.toHaveBeenCalled();
    });

    it('starts the game on the routes and returns the route detail', () => {
      expect(facade.initializeGameState()).toBe('1.2 km');

      expect(gameState.initialize).toHaveBeenCalledWith(
        engine, HQ, [{ id: SPAWN.id, name: SPAWN.name, lat: SPAWN.lat, lon: SPAWN.lon }], cachedPaths,
      );
      expect(strategicPlacement.initialize).toHaveBeenCalledWith(streetNetwork);
      expect(enemyDebug.initialize).toHaveBeenCalledWith(gameState, engine, store.spawnPoints);
      expect(engineInit.setStepCurrent).toHaveBeenCalledWith('grid');
      expect(gameState.initializeGlobalRouteGrid).toHaveBeenCalled();
      expect(engineInit.setStepDone).toHaveBeenCalledWith('grid');
      expect(towerPlacement.initialize).toHaveBeenCalled();
      expect(osm.filterStreetsNearRoutes).toHaveBeenCalled();
      expect(cameraFraming.applyFrame).toHaveBeenCalledWith(FRAME);
    });

    it('carries on without routes and only logs the problem', () => {
      cachedPaths = new Map();
      facade.initializeGameState();
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('No routes found'));
      expect(gameState.initializeGlobalRouteGrid).toHaveBeenCalled();
    });
  });

  describe('initializeTowerPlacement', () => {
    it('hands the location to tower placement, map placement and the LOS debug panel', () => {
      facade.initializeTowerPlacement();

      expect(towerPlacement.initialize).toHaveBeenCalledWith(engine, streetNetwork, osm, HQ, gameState);
      expect(mapPlacement.initialize).toHaveBeenCalledWith(engine, streetNetwork, HQ);
      expect(abilityTargeting.initialize).toHaveBeenCalledWith(engine, gameState);
      expect(heroControl.initialize).toHaveBeenCalledWith(engine, gameState);
      expect(losDebug.initialize).toHaveBeenCalledWith(engine, towerManager, bus, gridService);
    });

    it('does nothing without streets', () => {
      streetNetwork = null;
      facade.initializeTowerPlacement();
      expect(towerPlacement.initialize).not.toHaveBeenCalled();
      expect(mapPlacement.initialize).not.toHaveBeenCalled();
    });
  });

  describe('streets', () => {
    it('keeps the streets within the filter radius of the routes', () => {
      facade.filterStreetNetworkToRoutes();

      expect(osm.filterStreetsNearRoutes).toHaveBeenCalledWith(
        streetNetwork, [ROUTE.map(({ lat, lon }) => ({ lat, lon }))], STREET_FILTER_RADIUS,
      );
      expect(bridge.setFilteredStreetNetwork).toHaveBeenCalledWith({ filtered: true });
    });

    it('keeps every street without routes and in DevWorld', () => {
      cachedPaths = new Map();
      facade.filterStreetNetworkToRoutes();
      cachedPaths = new Map([['spawn-1', ROUTE]]);
      devWorld.isActive = true;
      facade.filterStreetNetworkToRoutes();

      expect(osm.filterStreetsNearRoutes).not.toHaveBeenCalled();
      expect(bridge.setFilteredStreetNetwork.mock.calls).toEqual([[streetNetwork], [streetNetwork]]);
    });

    it('filters nothing without a street network', () => {
      streetNetwork = null;
      facade.filterStreetNetworkToRoutes();
      expect(bridge.setFilteredStreetNetwork).not.toHaveBeenCalled();
    });

    it('renders the filtered and the full network with the store visibility', () => {
      store.streetsVisible.set(false);
      facade.renderStreets();
      expect(streetRendering.renderStreets).toHaveBeenCalledWith(engine, filteredNetwork, streetNetwork, HQ, false);
    });
  });

  describe('scheduleOverlayHeightUpdate', () => {
    it('does nothing without an engine', async () => {
      engineInit.getEngine.mockReturnValue(null);
      await facade.scheduleOverlayHeightUpdate();
      expect(heightUpdate.initialize).not.toHaveBeenCalled();
    });

    it('hands the height update its callbacks and waits for it', async () => {
      await facade.scheduleOverlayHeightUpdate();

      expect(heightUpdate.scheduleOverlayHeightUpdate).toHaveBeenCalled();
      const [engineArg, status, onHeights, onStreets, onDone, onMeta, onCheck, onCamera] =
        heightUpdate.initialize.mock.calls[0];
      expect([engineArg, status]).toEqual([engine, engineInit.loadingStatus]);

      onHeights();
      expect(markerViz.updateMarkerHeights).toHaveBeenCalledWith();
      expect(grid.updateTerrainHeights).toHaveBeenCalled();
      onStreets();
      expect(streetRendering.renderStreets).toHaveBeenCalled();
      onDone('3 of 3');
      expect(engineInit.setStepDone).toHaveBeenCalledWith('view', '3 of 3');
      onMeta('2 of 3');
      expect(engineInit.updateStepMeta).toHaveBeenCalledWith('view', '2 of 3');
      onCheck();
      expect(engineInit.checkAllLoaded).toHaveBeenCalled();

      cameraFraming.getLastFrame.mockReturnValue(FRAME);
      onCamera();
      expect(cameraFraming.applyFrame).toHaveBeenCalledWith(FRAME);
      expect(cameraControl.saveInitialPosition).toHaveBeenCalledWith(VIEW);
    });

    it('rebuilds routes and cells when the first corridor fit changes a width', async () => {
      corridor.changed = true;

      await facade.scheduleOverlayHeightUpdate();

      expect(grid.clear).toHaveBeenCalled();
      expect(gameState.initializeGlobalRouteGrid).toHaveBeenCalled();
      // Once for the routes, once more on the heights of the new cells.
      expect(pathRoute.refreshRouteLines).toHaveBeenCalledTimes(2);
      expect(grid.clear.mock.invocationCallOrder[0])
        .toBeLessThan(gameState.initializeGlobalRouteGrid.mock.invocationCallOrder[0]);
      expect(grid.initAirRouteLayerIfEnabled).toHaveBeenCalled();
    });

    it('does not rebuild when the fit changes nothing or towers stand', async () => {
      await facade.scheduleOverlayHeightUpdate();
      expect(pathRoute.beginClearanceMeasurement).toHaveBeenCalledTimes(1);
      expect(grid.clear).not.toHaveBeenCalled();

      towerCount = 1;
      corridor.changed = true;
      await facade.scheduleOverlayHeightUpdate();
      expect(pathRoute.beginClearanceMeasurement).toHaveBeenCalledTimes(1);
      expect(grid.clear).not.toHaveBeenCalled();
    });

    it('measures the corridor a slice per frame and rebuilds once it is done', async () => {
      corridor.slices = 3;
      corridor.changed = true;

      await facade.scheduleOverlayHeightUpdate();
      expect(corridor.runs[0].step).toHaveBeenCalledTimes(1);
      runFrames();
      expect(grid.clear).not.toHaveBeenCalled();
      runFrames();

      expect(corridor.runs[0].step).toHaveBeenCalledTimes(3);
      expect(grid.clear).toHaveBeenCalledTimes(1);
      expect(frames.size).toBe(0);
    });

    it('drops a measurement under way on dispose', async () => {
      corridor.slices = 3;
      corridor.changed = true;
      await facade.scheduleOverlayHeightUpdate();

      facade.dispose();
      runFrames(3);

      expect(corridor.runs[0].cancel).toHaveBeenCalledWith('disposed');
      expect(grid.clear).not.toHaveBeenCalled();
      expect(frames.size).toBe(0);
    });

    it('fits routes rebuilt in place the same way, under the same locks', () => {
      corridor.slices = 2;
      corridor.changed = true;

      facade.fitCorridorToTiles();
      runFrames();
      expect(pathRoute.beginClearanceMeasurement).toHaveBeenCalledTimes(1);
      expect(grid.clear).toHaveBeenCalledTimes(1);

      towerCount = 1;
      facade.fitCorridorToTiles();
      expect(pathRoute.beginClearanceMeasurement).toHaveBeenCalledTimes(1);
    });

    it('measures in the larger slices while the hint shows the measurement of a moving HQ', () => {
      corridor.slices = 2;
      relocationStatus.status.set({ title: 'Moving HQ', step: MEASURING_STEP, percent: 0 });

      facade.fitCorridorToTiles();

      expect(corridor.runs[0].step).toHaveBeenCalledWith(CorridorRefit.HURRIED_BUDGET_MS);
    });

    it('lets the game state finish a measurement under way before a tower or a wave', async () => {
      corridor.slices = 3;
      corridor.changed = true;
      await facade.scheduleOverlayHeightUpdate();
      const beforeLock = gameState.setBeforeCorridorLock.mock.calls[0][0] as (reason: string) => void;

      beforeLock('tower');

      expect(corridor.runs[0].step).toHaveBeenLastCalledWith(Infinity);
      expect(corridor.runs[0].commit).toHaveBeenCalledWith('tower');
      expect(grid.clear).toHaveBeenCalledTimes(1);
      expect(frames.size).toBe(0);
    });
  });

  describe('checkAllLoaded', () => {
    beforeEach(() => engineInit.loading.set(true));

    it('holds the loading screen on the first load until the intro route is ready', () => {
      introFlight.readiness.mockReturnValue(0.5);

      facade.checkAllLoaded();

      expect(introFlight.prepare).toHaveBeenCalledWith(cachedPaths);
      expect(engineInit.setStepDone).toHaveBeenCalledWith('tiles');
      expect(engineInit.setStepCurrent).toHaveBeenCalledWith('flight');
      expect(engineInit.updateStepMeta).toHaveBeenCalledWith('flight', '50 % of the route');
      expect(engineInit.checkAllLoaded).not.toHaveBeenCalled();
      expect(frames.size).toBe(1);

      runFrames();
      expect(introFlight.prepareTick).toHaveBeenCalledWith(INTRO_GATE_SAMPLES_PER_FRAME);
      expect(engineInit.checkAllLoaded).not.toHaveBeenCalled();

      introFlight.readiness.mockReturnValue(0.95);
      runFrames();
      expect(engineInit.setStepDone).toHaveBeenCalledWith('flight', '95 % of the route');
      expect(engineInit.checkAllLoaded).toHaveBeenCalledTimes(1);
      expect(introFlight.prepare).toHaveBeenCalledTimes(1);
    });

    it('lets the loading screen go at the timeout after the first tiles', () => {
      engineInit.getFirstTilesLoadedAt.mockReturnValue(performance.now() - INTRO_GATE_TIMEOUT_MS);

      facade.checkAllLoaded();

      expect(engineInit.setStepDone).toHaveBeenCalledWith('flight', '0 % of the route');
      expect(engineInit.checkAllLoaded).toHaveBeenCalled();
    });

    it('skips the gate when the intro has no route to prepare', () => {
      introFlight.prepare.mockReturnValue(false);
      facade.checkAllLoaded();
      expect(engineInit.setStepDone).toHaveBeenCalledWith('flight');
      expect(engineInit.checkAllLoaded).toHaveBeenCalled();
    });

    it('does not hold while tiles, streets or heights are still loading', () => {
      engineInit.tilesLoading.set(true);
      facade.checkAllLoaded();
      expect(introFlight.prepare).not.toHaveBeenCalled();
      expect(engineInit.checkAllLoaded).toHaveBeenCalledWith(heightUpdate.heightsLoading);
    });

    it('starts music, route animation and intro flight once loading is over', () => {
      introFlight.readiness.mockReturnValue(1);
      facade.checkAllLoaded();

      expect(music.onLoadingComplete).toHaveBeenCalled();
      expect(routeAnimation.startAnimation).toHaveBeenCalledWith(cachedPaths, [SPAWN]);
      expect(introFlight.start).toHaveBeenCalledWith(cachedPaths);
    });

    it('leaves a running animation and a running flight alone', () => {
      introFlight.readiness.mockReturnValue(1);
      routeAnimation.isRunning.mockReturnValue(true);
      introFlight.isRunning.mockReturnValue(true);

      facade.checkAllLoaded();

      expect(music.onLoadingComplete).toHaveBeenCalled();
      expect(routeAnimation.startAnimation).not.toHaveBeenCalled();
      expect(introFlight.start).not.toHaveBeenCalled();
    });

    it('neither gates nor starts anything during a location change', () => {
      locationMgmt.isApplyingLocation.set(true);
      facade.checkAllLoaded();

      expect(introFlight.prepare).not.toHaveBeenCalled();
      expect(music.onLoadingComplete).toHaveBeenCalled();
      expect(routeAnimation.startAnimation).not.toHaveBeenCalled();
      expect(introFlight.start).not.toHaveBeenCalled();
    });

    it('starts nothing when loading was already over', () => {
      engineInit.loading.set(false);
      facade.checkAllLoaded();
      expect(engineInit.checkAllLoaded).toHaveBeenCalled();
      expect(music.onLoadingComplete).not.toHaveBeenCalled();
    });
  });

  describe('camera', () => {
    it('saves the last overview frame as the initial view and draws the framing debug', () => {
      cameraFraming.getLastFrame.mockReturnValue(FRAME);
      facade.saveInitialCameraPosition();

      expect(cameraControl.showDebugVisualization).toHaveBeenCalledWith(
        HQ, [{ lat: SPAWN.lat, lon: SPAWN.lon }], CAMERA_PADDING, ROUTE.map(({ lat, lon }) => ({ lat, lon })),
      );
      expect(cameraControl.saveInitialPosition).toHaveBeenCalledWith(VIEW);
    });

    it('saves nothing before a frame exists and draws nothing without spawns', () => {
      store.spawnPoints.set([]);
      facade.saveInitialCameraPosition();
      expect(cameraControl.showDebugVisualization).not.toHaveBeenCalled();
      expect(cameraControl.saveInitialPosition).not.toHaveBeenCalled();
    });

    it('mirrors the framing debug toggle into the store and draws only when on', () => {
      facade.toggleCameraFramingDebug();
      expect(store.cameraFramingDebug()).toBe(true);
      expect(cameraControl.showDebugVisualization).toHaveBeenCalledTimes(1);

      cameraControl.toggleDebugFraming.mockReturnValue(false);
      facade.toggleCameraFramingDebug();
      expect(store.cameraFramingDebug()).toBe(false);
      expect(cameraControl.showDebugVisualization).toHaveBeenCalledTimes(1);
    });

    it('toggles the camera debug overlay with a fresh debug info', () => {
      facade.toggleCameraDebug();
      expect(engineStore.cameraDebugEnabled()).toBe(true);
      expect(engineStore.cameraDebugInfo()).toEqual({ pitch: 45 });

      facade.toggleCameraDebug();
      expect(engineStore.cameraDebugEnabled()).toBe(false);
      expect(engineStore.cameraDebugInfo()).toBeNull();
    });

    it('reframes on the routes unless the intro flight has the camera', () => {
      facade.reframeCameraWithRoutes();
      expect(cameraFraming.applyFrame).toHaveBeenCalledWith(FRAME);

      introFlight.isRunning.mockReturnValue(true);
      facade.reframeCameraWithRoutes();
      expect(cameraFraming.applyFrame).toHaveBeenCalledTimes(1);
    });

    it('does not frame without routes', () => {
      cachedPaths = new Map();
      facade.reframeCameraWithRoutes();
      expect(cameraFraming.computeFrameWithEngine).not.toHaveBeenCalled();
      expect(cameraFraming.applyFrame).not.toHaveBeenCalled();
    });
  });

  describe('onTilesLoaded', () => {
    it('does nothing without an engine or before the streets are filtered', () => {
      filteredNetwork = null;
      facade.onTilesLoaded();
      filteredNetwork = {};
      bridge.getEngine.mockReturnValue(null);
      facade.onTilesLoaded();
      expect(grid.beginTerrainHeightRefresh).not.toHaveBeenCalled();
    });

    it('refreshes streets, markers, cell heights and the debug overlays', () => {
      facade.onTilesLoaded();

      expect(streetRendering.renderStreets).toHaveBeenCalled();
      expect(buildingRendering.renderBuildings).not.toHaveBeenCalled();
      expect(markerViz.updateMarkerHeights).toHaveBeenCalledWith();
      expect(grid.beginTerrainHeightRefresh).toHaveBeenCalled();
      expect(gameState.onTilesLoaded).toHaveBeenCalled();
      expect(grid.initSpatialGridVisualizationIfEnabled).toHaveBeenCalled();
      expect(grid.initAirSpatialGridVisualizationIfEnabled).toHaveBeenCalled();
      expect(grid.initAirRouteLayerIfEnabled).toHaveBeenCalled();
    });

    it('steps the height sweep, then retries unsampled cells until two empty frames', () => {
      sweepFrames = 2;
      grid.retryUnsampledCells
        .mockReturnValueOnce({ promoted: 3 })
        .mockReturnValueOnce({ promoted: 0 })
        .mockReturnValueOnce({ promoted: 0 });

      facade.onTilesLoaded();
      runFrames(2);
      expect(grid.stepTerrainHeightRefresh.mock.calls).toEqual([[5], [5]]);
      expect(grid.retryUnsampledCells).not.toHaveBeenCalled();
      // The rebuild requested during the sweep waits for its end.
      expect(pathRoute.refreshRouteLines).not.toHaveBeenCalled();

      runFrames(3);
      expect(grid.retryUnsampledCells).toHaveBeenCalledTimes(3);
      expect(pathRoute.refreshRouteLines).not.toHaveBeenCalled();

      runFrames();
      expect(pathRoute.refreshRouteLines).toHaveBeenCalledTimes(1);
      runFrames(5);
      expect(grid.retryUnsampledCells).toHaveBeenCalledTimes(3);
      expect(pathRoute.refreshRouteLines).toHaveBeenCalledTimes(1);
    });

    it('gives up retrying after 120 frames that keep promoting cells', () => {
      grid.retryUnsampledCells.mockReturnValue({ promoted: 1 });

      facade.onTilesLoaded();
      runFrames(125);

      expect(grid.retryUnsampledCells).toHaveBeenCalledTimes(120);
      expect(frames.size).toBe(0);
    });

    it('runs one convergence loop however many tile loads arrive', () => {
      facade.onTilesLoaded();
      facade.onTilesLoaded();
      runFrames();
      expect(grid.retryUnsampledCells).toHaveBeenCalledTimes(1);
    });

    it('re-measures the corridor once a batch has settled', () => {
      pathRoute.hasUnmeasuredStations.mockReturnValue(true);
      corridor.changed = true;

      facade.onTilesLoaded();
      runFrames(2);

      expect(pathRoute.beginClearanceMeasurement).toHaveBeenCalledTimes(1);
      expect(grid.clear).toHaveBeenCalled();
    });

    it('stops the loop on dispose', () => {
      grid.retryUnsampledCells.mockReturnValue({ promoted: 1 });
      facade.onTilesLoaded();
      runFrames(3);

      facade.dispose();
      runFrames(3);

      expect(grid.retryUnsampledCells).toHaveBeenCalledTimes(3);
    });
  });

  describe('overlay toggles', () => {
    it('forwards streets, routes and special points toggles', () => {
      facade.onStreetsToggled();
      facade.onRoutesToggled();
      facade.onSpecialPointsDebugToggled();
      expect(streetRendering.toggleVisibility).toHaveBeenCalled();
      expect(pathRoute.toggleRouteLinesVisibility).toHaveBeenCalled();
      expect(markerViz.toggleSpecialPointsDebug).toHaveBeenCalled();
    });

    it('plays the route animation only with routes', () => {
      facade.onPlayRouteAnimation();
      expect(routeAnimation.startAnimation).toHaveBeenCalledWith(cachedPaths, [SPAWN]);
      cachedPaths = new Map();
      facade.onPlayRouteAnimation();
      expect(routeAnimation.startAnimation).toHaveBeenCalledTimes(1);
    });

    it('loads the buildings near the routes on the first toggle, then only toggles', async () => {
      osm.loadBuildings.mockResolvedValue({ buildings: ['near', 'far'] });
      uiStore.buildingsVisible.set(true);

      facade.onBuildingsToggled();
      await settle();

      expect(osm.loadBuildings).toHaveBeenCalledWith(48.777, 9.185);
      expect(osm.filterBuildingsNearRoutes).toHaveBeenCalledWith(
        ['near', 'far'], [ROUTE.map(({ lat, lon }) => ({ lat, lon }))], STREET_FILTER_RADIUS,
      );
      expect(buildingRendering.renderBuildings).toHaveBeenCalledWith(engine, ['near'], HQ, true);

      facade.onBuildingsToggled();
      expect(osm.loadBuildings).toHaveBeenCalledTimes(1);
      expect(buildingRendering.toggleVisibility).toHaveBeenCalled();

      // Once loaded, tile loads re-render them.
      facade.onTilesLoaded();
      expect(buildingRendering.renderBuildings).toHaveBeenCalledTimes(2);
    });

    it('keeps every building without routes', async () => {
      cachedPaths = new Map();
      osm.loadBuildings.mockResolvedValue({ buildings: ['a', 'b'] });
      uiStore.buildingsVisible.set(true);

      facade.onBuildingsToggled();
      await settle();

      expect(osm.filterBuildingsNearRoutes).not.toHaveBeenCalled();
      expect(buildingRendering.renderBuildings).toHaveBeenCalledWith(engine, ['a', 'b'], HQ, true);
    });

    it('tries to load again on the next toggle after a failed load', async () => {
      osm.loadBuildings.mockRejectedValueOnce(new Error('Overpass down'));
      uiStore.buildingsVisible.set(true);

      facade.onBuildingsToggled();
      await settle();
      expect(console.error).toHaveBeenCalledWith('[Buildings] Failed to load:', expect.any(Error));

      osm.loadBuildings.mockResolvedValue({ buildings: [] });
      facade.onBuildingsToggled();
      await settle();
      expect(osm.loadBuildings).toHaveBeenCalledTimes(2);
    });

    it('only toggles while the buildings are hidden and not loaded', () => {
      facade.onBuildingsToggled();
      expect(osm.loadBuildings).not.toHaveBeenCalled();
      expect(buildingRendering.toggleVisibility).toHaveBeenCalled();
    });
  });

  describe('DPS profile bins', () => {
    it('shows the current profile and follows tower changes until toggled off', () => {
      facade.onDpsBinsToggled(true);

      const [viz] = dpsViz.instances;
      expect(viz.sync).toEqual({ sync: true });
      expect(viz.updates).toEqual([{ profile: 1 }]);
      expect(viz.visible).toBe(true);
      expect(scene.add).toHaveBeenCalledWith(viz.mesh);

      for (const type of ['tower:placed', 'tower:sold', 'tower:upgraded']) bus.emit({ type } as never);
      expect(viz.updates).toHaveLength(4);
      expect(scene.add).toHaveBeenCalledTimes(1);

      facade.onDpsBinsToggled(false);
      expect(viz.visible).toBe(false);
      bus.emit({ type: 'tower:placed' } as never);
      expect(viz.updates).toHaveLength(4);
    });

    it('reuses the visualizer when shown again', () => {
      facade.onDpsBinsToggled(true);
      facade.onDpsBinsToggled(false);
      facade.onDpsBinsToggled(true);
      expect(dpsViz.instances).toHaveLength(1);
    });

    it('shows nothing without a coordinate sync or an engine', () => {
      grid.getCoordinateSync.mockReturnValue(null);
      facade.onDpsBinsToggled(true);
      bridge.getEngine.mockReturnValue(null);
      engineInit.getEngine.mockReturnValue(null);
      grid.getCoordinateSync.mockReturnValue({ sync: true });
      facade.onDpsBinsToggled(true);
      expect(dpsViz.instances).toHaveLength(0);
    });

    it('takes the bins out of the scene and disposes them on cleanup', () => {
      facade.onDpsBinsToggled(true);
      const [viz] = dpsViz.instances;

      facade.cleanupDpsVisualization();

      expect(scene.remove).toHaveBeenCalledWith(viz.mesh);
      expect(viz.disposed).toBe(true);
      bus.emit({ type: 'tower:placed' } as never);
      expect(viz.updates).toHaveLength(1);
      facade.onDpsBinsToggled(true);
      expect(dpsViz.instances).toHaveLength(2);
    });
  });

  describe('event bus and dispose', () => {
    const selected = { type: 'tower:selected', tower: { typeConfig: { id: 'cannon' } } } as never;

    it('lets the spawn portals follow the game events', () => {
      facade.subscribeToEventBus();
      expect(markerViz.subscribeToEventBus).toHaveBeenCalledWith(bus);
    });

    it('selects the tower type in the debug panel when a tower is selected', () => {
      facade.subscribeToEventBus();
      facade.subscribeToEventBus();
      bus.emit(selected);
      expect(towerDebug.selectTower).toHaveBeenCalledTimes(1);
      expect(towerDebug.selectTower).toHaveBeenCalledWith('cannon');
    });

    it('drops subscriptions, the cells listener, the DPS bins and the buildings on dispose', () => {
      facade.initializeVisualizationServices();
      facade.subscribeToEventBus();
      facade.onDpsBinsToggled(true);
      const [viz] = dpsViz.instances;

      facade.dispose();

      expect(bus.getListenerCount()).toBe(0);
      expect(cellsOff).toHaveBeenCalled();
      expect(viz.disposed).toBe(true);
      expect(scene.remove).toHaveBeenCalledWith(viz.mesh);
      expect(buildingRendering.reset).toHaveBeenCalled();
    });

    it('cancels a held loading screen frame on dispose', () => {
      engineInit.loading.set(true);
      introFlight.readiness.mockReturnValue(0.5);
      facade.checkAllLoaded();
      expect(frames.size).toBe(1);

      facade.dispose();

      expect(frames.size).toBe(0);
    });
  });

  describe('__corridor console API', () => {
    const api = () => (globalThis as Record<string, unknown>)['__corridor'] as {
      get: () => Record<string, unknown>;
      set: (patch: object) => string;
      reset: () => string;
      towerCells: (id?: string) => unknown;
      pick: (radius?: number) => string;
      report: () => string;
    };

    it('starts the cell report and hands it the cells until dispose', () => {
      expect(api().report()).toBe('Cell report on');
      expect(cellReport.start).toHaveBeenCalledTimes(1);
      const source = cellReport.connect.mock.calls[0][0];

      facade.dispose();

      expect(cellReport.disconnect).toHaveBeenCalledWith(source);
    });

    it('refuses to change the corridor while towers stand or before a location is loaded', () => {
      towerCount = 1;
      expect(api().set({ maxHalfWidth: 8 })).toBe('Not changed: towers stand on the map, sell them first.');
      towerCount = 0;
      engineInit.getEngine.mockReturnValue(null);
      expect(api().reset()).toBe('Not changed: no location loaded.');
      expect(grid.clear).not.toHaveBeenCalled();
    });

    it('hands out a copy of the corridor config', () => {
      const config = api().get();
      config['maxHalfWidth'] = -1;
      expect(api().get()['maxHalfWidth']).not.toBe(-1);
    });

    it('arms a cell pick on the next click only with a location', () => {
      expect(api().pick()).toMatch(/within 4 m/);
      expect(inputHandler.armPick).toHaveBeenCalledTimes(1);

      engineInit.getEngine.mockReturnValue(null);
      expect(api().pick()).toBe('No location loaded.');
      expect(inputHandler.armPick).toHaveBeenCalledTimes(1);
    });

    it('asks for a tower when none is selected', () => {
      expect(api().towerCells()).toBe('No tower: select one or pass its id.');
    });

    it('is gone after dispose', () => {
      facade.dispose();
      expect('__corridor' in globalThis).toBe(false);
    });
  });
});
