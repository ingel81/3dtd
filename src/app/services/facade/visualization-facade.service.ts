import { Injectable, inject, Injector, effect } from '@angular/core';
import { OsmStreetService } from '../location/osm-street.service';
import { UIStore } from '../../store/ui.store';
import { CameraControlService } from '../camera-control.service';
import { MarkerVisualizationService } from '../world/marker-visualization.service';
import { PathAndRouteService } from '../world/path-route.service';
import { InputHandlerService } from '../input-handler.service';
import { TowerPlacementService } from '../tower-placement.service';
import { AbilityTargetingService } from '../ability-targeting.service';
import { HeroControlService } from '../hero-control.service';
import { MapPlacementService } from '../world/map-placement.service';
import { RelocationStatusService } from '../world/relocation-status.service';
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
import { LosDebugService } from '../debug/los-debug.service';
import { GlobalRouteGridService } from '../world/global-route-grid.service';
import { LocationManagementService } from '../location/location-management.service';
import { SubscriptionBag } from '../../game-engine/game-event-bus';
import { AIDataCollectorService } from '../../ai/core/ai-data-collector.service';
import { GameStateManager } from '../../managers/game-state.manager';
import { SpawnPoint as WaveSpawnPoint } from '../../managers/wave.manager';
import { TowerTypeId } from '../../configs/tower-types.config';
import { Vector3 } from 'three';
import { FacadeComponentBridge } from './tower-defense-facade.service';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { EngineStore } from '../../store/engine.store';
import { STREET_FILTER_RADIUS } from '../../configs/map-constants.config';
import { CorridorBuild, type CorridorBuildResult, type CorridorProgress } from '../world/corridor-build';
import { CorridorConsole } from '../debug/corridor-console';
import { CorridorLodProbe } from '../debug/corridor-lod-probe';
import { TilesConsole } from '../debug/tiles-console';
import { CellReportService } from '../debug/cell-report.service';
import { TowerTargetConsole } from '../debug/tower-target-console';
import { IntroLoadingGate } from '../world/intro-loading-gate';
import { CameraOverview } from '../camera-overview';
import { DpsBinsOverlay } from '../debug/dps-bins-overlay';
import { BuildingOverlay } from '../world/building-overlay';
import { cameraTimeline } from '../../utils/camera-timeline';
import { corridorTrace } from '../../utils/corridor-trace';
import { perfTrace } from '../../utils/perf-trace';

/**
 * Sub-facade for visualization, camera, rendering, and height updates.
 *
 * Responsibilities:
 * - Visualization service initialization
 * - Street rendering and filtering
 * - Height update scheduling
 * - Route animations
 * - Tiles loaded handling
 * - Click handler setup
 * - Game state initialization (routes, tower placement)
 *
 * Owned helpers (plain classes, built in the field initializers below):
 * - CorridorBuild: the route corridor, built once per route set
 * - CorridorConsole: `__corridor` in DevTools
 * - CorridorLodProbe: `__corridor.probeLod()` and `fingerprint()`
 * - TilesConsole: `__tiles` in DevTools
 * - TowerTargetConsole: `__towerTargets` in DevTools
 * - IntroLoadingGate: loading screen held for the intro flight
 * - CameraOverview: overview frame, initial view, camera debug toggles
 * - DpsBinsOverlay: DPS profile bins
 * - BuildingOverlay: OSM building footprints
 */
@Injectable()
export class VisualizationFacadeService {
  private readonly osmService = inject(OsmStreetService);
  private readonly uiStore = inject(UIStore);
  private readonly cameraControl = inject(CameraControlService);
  private readonly markerViz = inject(MarkerVisualizationService);
  private readonly pathRoute = inject(PathAndRouteService);
  private readonly inputHandler = inject(InputHandlerService);
  private readonly towerPlacement = inject(TowerPlacementService);
  private readonly abilityTargeting = inject(AbilityTargetingService);
  private readonly heroControl = inject(HeroControlService);
  private readonly heightUpdate = inject(HeightUpdateService);
  private readonly engineInit = inject(EngineInitializationService);
  private readonly devWorld = inject(DevWorldService);
  private readonly cameraFraming = inject(CameraFramingService);
  private readonly routeAnimation = inject(RouteAnimationService);
  private readonly introFlight = inject(IntroCameraFlightService);

  private readonly keyboardPan = inject(KeyboardPanService);
  private readonly streetRendering = inject(StreetRenderingService);
  private readonly buildingRendering = inject(BuildingRenderingService);
  private readonly strategicPlacement = inject(StrategicPlacementService);
  private readonly enemyDebug = inject(EnemyDebugService);
  private readonly towerDebug = inject(TowerDebugService);
  private readonly losDebug = inject(LosDebugService);
  private readonly globalRouteGridService = inject(GlobalRouteGridService);
  private readonly locationMgmt = inject(LocationManagementService);
  private readonly aiDataCollector = inject(AIDataCollectorService);
  private readonly mapPlacement = inject(MapPlacementService);
  private readonly store = inject(TowerDefenseStore);
  private readonly engineStore = inject(EngineStore);
  private readonly relocationStatus = inject(RelocationStatusService);
  private readonly cellReport = inject(CellReportService);

  /** The one owner of the route corridor, built once per route set (CorridorBuild). */
  private readonly corridor = new CorridorBuild({
    gameState: () => this.gameState,
    engineInit: this.engineInit,
    pathRoute: this.pathRoute,
    routeAnimation: this.routeAnimation,
    store: this.store,
  });

  /** `__corridor.probeLod()` and `fingerprint()`, see CorridorLodProbe. */
  private readonly lodProbe = new CorridorLodProbe({
    gameState: () => this.gameState,
    engineInit: this.engineInit,
    introFlight: this.introFlight,
    pathRoute: this.pathRoute,
    corridorBuilding: () => this.corridor.pending(),
  });

  /** `__corridor` in DevTools, see CorridorConsole. */
  private readonly corridorConsole = new CorridorConsole({
    gameState: () => this.gameState,
    engineInit: this.engineInit,
    inputHandler: this.inputHandler,
    pathRoute: this.pathRoute,
    // A probe holds the tiles at another LOD: a change now would measure on them.
    change: (apply) => (this.lodProbe.running
      ? Promise.resolve('Not changed: __corridor.probeLod() is running.')
      : this.corridor.change(apply)),
    cellReport: this.cellReport,
    lodProbe: this.lodProbe,
  });

  /** `__tiles` in DevTools, see TilesConsole. */
  private readonly tilesConsole = new TilesConsole({ engineInit: this.engineInit });

  /** `__towerTargets` in DevTools, see TowerTargetConsole. */
  private readonly towerTargetConsole = new TowerTargetConsole({
    gameState: () => this.gameState,
    engineInit: this.engineInit,
  });

  /** Loading screen held for the intro flight on the first load, see IntroLoadingGate. */
  private readonly introGate = new IntroLoadingGate({
    engineInit: this.engineInit,
    heightUpdate: this.heightUpdate,
    pathRoute: this.pathRoute,
    introFlight: this.introFlight,
    recheck: () => this.checkAllLoaded(),
  });

  /** Overview frame and camera debug toggles, see CameraOverview. */
  private readonly overview = new CameraOverview({
    store: this.store,
    engineStore: this.engineStore,
    cameraControl: this.cameraControl,
    cameraFraming: this.cameraFraming,
    pathRoute: this.pathRoute,
    introFlight: this.introFlight,
    grid: () => this.gameState.getGlobalRouteGrid(),
  });

  /** DPS profile bins along the path, see DpsBinsOverlay. */
  private readonly dpsBins = new DpsBinsOverlay({
    gameState: () => this.gameState,
    aiDataCollector: this.aiDataCollector,
  });

  /** OSM building footprints near the routes, see BuildingOverlay. */
  private readonly buildings = new BuildingOverlay({
    osm: this.osmService,
    pathRoute: this.pathRoute,
    buildingRendering: this.buildingRendering,
    uiStore: this.uiStore,
    store: this.store,
    engine: () => this.bridge.getEngine() || this.engineInit.getEngine(),
  });

  /** Component bridge — set via initialize() */
  private bridge!: FacadeComponentBridge;

  /** Game state manager — set via initialize() */
  private gameState!: GameStateManager;

  /** Whether this sub-facade has been initialized */
  private initialized = false;

  /** EventBus subscription bag — cleaned up in dispose() */
  private readonly eventBusSubs = new SubscriptionBag();

  /** The page was shown or hidden, see rebuildAfterBlindBuild(). */
  private readonly onVisibilityChange = (): void => {
    void this.rebuildAfterBlindBuild();
  };

  /**
   * Initialize sub-facade with bridge and game state.
   */
  initialize(bridge: FacadeComponentBridge, gameState: GameStateManager): void {
    this.bridge = bridge;
    this.gameState = gameState;
    this.initialized = true;

    // Towers and waves wait while the corridor is built.
    gameState.setCorridorPending(() => this.corridor.pending());
    // A location that loads in a hidden tab gets no tiles at all, and the
    // corridor freezes on nothing; build again when the page is shown.
    // Adding the same listener twice (a location change) does nothing.
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.corridorConsole.install();
    this.tilesConsole.install();
    this.towerTargetConsole.install();
  }

  /**
   * The page became visible. A location that loaded in a hidden tab loaded
   * no tiles: the browser stops rAF there, so the tiles renderer never
   * traverses and never asks for any. The build then measured on nothing and
   * froze the OSM street widths (CorridorBuild.frozeBlind). Nothing
   * re-measures after a freeze, so build once more, now that tiles can load.
   *
   * Not while towers stand, a wave runs or enemies walk (rebuildBlocker):
   * their LOS answers, cells and routes stand on the corridor in use. The
   * warning of the blind build stays in the log for that case.
   */
  private async rebuildAfterBlindBuild(): Promise<void> {
    if (!this.initialized || document.hidden) return;
    if (!this.corridor.frozeBlind() || this.corridor.pending()) return;
    if (this.corridor.rebuildBlocker()) return;
    console.log('[Corridor] the page is visible again and the corridor was built without tiles: building it again.');
    await this.corridor.build('page visible after a build without tiles');
  }

  /**
   * Reset state and cleanup on dispose.
   */
  dispose(): void {
    this.eventBusSubs.disposeAll();
    if (this.initialized) this.gameState.setCorridorPending(null);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.corridor.dispose();
    this.corridorConsole.uninstall();
    this.tilesConsole.uninstall();
    this.towerTargetConsole.uninstall();
    this.introGate.dispose();
    const engine = this.initialized ? this.bridge.getEngine() : null;
    this.dpsBins.dispose(engine);
    this.buildings.reset();
    this.initialized = false;
  }

  /**
   * Create Angular effects owned by this sub-facade.
   * Called from the main facade during initEffects().
   */
  initEffects(injector: Injector): void {
    // Effect: Sync tower debug "Show Shoot Height" to renderer
    effect(() => {
      const showShootHeight = this.towerDebug.showShootHeight();
      const engine = this.bridge.getEngine();
      if (engine) {
        engine.towers.setShowShootHeight(showShootHeight);
      }
    }, { injector });

    // Effect: Apply tower debug overrides to renderer (live updates)
    effect(() => {
      const allOverrides = this.towerDebug.allOverrides();
      const engine = this.bridge.getEngine();
      if (!engine) return;
      for (const typeId of Object.keys(allOverrides) as TowerTypeId[]) {
        const overrides = allOverrides[typeId];
        engine.towers.applyDebugOverrides(typeId, overrides);
      }
    }, { injector });
  }

  /**
   * Subscribe to EventBus events owned by this sub-facade.
   * Called from the main facade after game state is initialized.
   */
  subscribeToEventBus(): void {
    // Defensive: clear any prior subscriptions so a future re-init path can't
    // double-subscribe (consistent with combat-effect/hq-damage/game-state).
    this.eventBusSubs.disposeAll();
    const eventBus = this.gameState.getEventBus();

    // Spawn portals surge at wave start and calm down after the wave
    this.markerViz.subscribeToEventBus(eventBus);

    // Subscribe to tower:selected event — sync debug panel dropdown
    this.eventBusSubs.add(
      eventBus.on('tower:selected', (event) => {
        this.towerDebug.selectTower(event.tower.typeConfig.id);
      })
    );
  }

  // ══════════════════════════════════════════════════════════════
  // Visualization & Service Initialization
  // ══════════════════════════════════════════════════════════════

  /**
   * Initialize visualization services (markerViz, pathRoute, camera, animation, keyboard).
   * Must be called after engine and streets are loaded.
   */
  initializeVisualizationServices(): void {
    const engine = this.engineInit.getEngine();
    const streetNetwork = this.bridge.getStreetNetwork();
    if (!engine || !streetNetwork) {
      console.warn('[VisualizationFacade] Cannot initialize - engine or streetNetwork not available');
      return;
    }

    const base = this.store.baseCoords();
    const baseCoords = { lat: base.lat, lon: base.lon };

    // Initialize marker visualization service
    this.markerViz.initialize(engine, baseCoords, this.store.heightDebugVisible);

    // Initialize path and route service
    const pathfindingService = this.devWorld.isActive && this.bridge.getDevStreetProvider()
      ? this.bridge.getDevStreetProvider()!
      : this.osmService;
    this.pathRoute.initialize(
      engine,
      streetNetwork,
      baseCoords,
      this.uiStore.routesVisible,
      pathfindingService,
      (spawnId, route, startGroundY) => this.markerViz.placeSpawnPortal(spawnId, route, startGroundY)
    );

    // Initialize camera control service
    this.cameraControl.initialize(engine, { lat: baseCoords.lat, lon: baseCoords.lon });
    // Overview frame on the camera's real lens, computed fresh for Reset
    // Camera and the intro (CameraOverview).
    this.overview.initialize(engine);

    // Initialize route animation service
    this.routeAnimation.initialize(engine);

    // Initialize intro camera flight (spike)
    this.introFlight.initialize(engine);

    // Initialize keyboard panning service
    this.keyboardPan.initialize(engine);
  }

  /**
   * Add base marker to the map.
   */
  addBaseMarker(): void {
    this.markerViz.addBaseMarker();
  }

  /**
   * Setup click handler with explicit gameState reference.
   */
  setupClickHandlerWithGameState(): void {
    const engine = this.bridge.getEngine() || this.engineInit.getEngine();
    if (!engine) return;

    this.inputHandler.initialize(
      this.bridge.getCanvasElement(),
      engine,
      this.gameState,
      this.towerPlacement.buildMode,
      (lat: number, lon: number, height: number) => this.bridge.onTerrainClick(lat, lon, height),
      (lat: number, lon: number, hitPoint: Vector3) => this.bridge.onMouseMove(lat, lon, hitPoint)
    );

    this.inputHandler.setEnemyPlacementCallback(
      () => this.enemyDebug.placementMode(),
      (lat: number, lon: number, height: number) => this.bridge.handleEnemyPlacement(lat, lon, height)
    );

    this.inputHandler.setMapPlacementCallback(
      () => this.mapPlacement.placementMode(),
      (lat: number, lon: number, height: number) => this.bridge.onMapPlacementClick(lat, lon, height),
      (lat: number, lon: number, hitPoint: Vector3) => this.bridge.onMapPlacementMove(lat, lon, hitPoint),
    );

    this.inputHandler.setAbilityTargetingCallback(
      () => this.abilityTargeting.targeting(),
      (lat: number, lon: number, height: number) => this.abilityTargeting.click(lat, lon, height),
      (lat: number, lon: number, hitPoint: Vector3) => this.abilityTargeting.hover(lat, lon, hitPoint),
      () => this.abilityTargeting.cancel(),
    );

    this.inputHandler.setHeroCallbacks({
      selected: () => this.heroControl.selected(),
      pick: (screenX: number, screenY: number) => this.heroControl.pick(screenX, screenY),
      toggle: () => this.heroControl.toggle(),
      click: (lat: number, lon: number, height: number) => this.heroControl.click(lat, lon, height),
      move: (lat: number, lon: number, hitPoint: Vector3) => this.heroControl.hover(lat, lon, hitPoint),
      cancel: () => this.heroControl.deselect(),
    });

    this.inputHandler.setCellReportCallbacks({
      active: () => this.cellReport.active(),
      click: (hitPoint: Vector3) => this.cellReport.click(hitPoint),
      drag: (rect) => this.cellReport.box.set(rect),
      select: (rect) => this.cellReport.select(rect),
      end: () => this.cellReport.stop(),
    });

    this.inputHandler.initKeyboard({
      exitBuildMode: () => this.bridge.exitBuildMode(),
      exitMapPlacement: () => this.bridge.exitMapPlacement(),
    });
  }

  // ══════════════════════════════════════════════════════════════
  // Game State Initialization
  // ══════════════════════════════════════════════════════════════

  /**
   * Initialize game state with routes.
   * @returns Route detail string
   */
  initializeGameState(): string | undefined {
    if (!this.initialized) return undefined;

    const engine = this.bridge.getEngine() || this.engineInit.getEngine();
    const streetNetwork = this.bridge.getStreetNetwork();
    if (!engine || !streetNetwork) return undefined;

    const base = this.store.baseCoords();
    const waveSpawnPoints: WaveSpawnPoint[] = this.store.spawnPoints().map((sp) => ({
      id: sp.id,
      name: sp.name,
      lat: sp.lat,
      lon: sp.lon,
    }));

    this.gameState.initialize(
      engine,
      { lat: base.lat, lon: base.lon },
      waveSpawnPoints,
      this.pathRoute.getCachedPaths()
    );

    // Initialize strategic placement service with street network
    this.strategicPlacement.initialize(streetNetwork);

    // Initialize enemy debug service
    this.enemyDebug.initialize(this.gameState, engine, this.store.spawnPoints);

    // Validate routes
    const paths = this.pathRoute.getCachedPaths();
    if (paths.size === 0) {
      console.error('[VisualizationFacade] No routes found - spawn and HQ may not be connected by streets');
    }

    // Initialize GlobalRouteGrid
    void this.engineInit.setStepCurrent('grid');
    this.engineInit.updateStepMeta('grid', 'Calculating grid...');
    this.gameState.initializeGlobalRouteGrid();
    void this.engineInit.setStepDone('grid');

    // Initialize tower placement
    this.initializeTowerPlacement();

    // Filter street network to route corridor
    this.filterStreetNetworkToRoutes();

    // Reframe camera
    this.reframeCameraWithRoutes();

    return this.pathRoute.getRouteDetail();
  }

  /**
   * Initialize TowerPlacementService with all required dependencies.
   */
  initializeTowerPlacement(): void {
    const engine = this.bridge.getEngine() || this.engineInit.getEngine();
    const streetNetwork = this.bridge.getStreetNetwork();
    if (!engine || !streetNetwork) {
      console.warn('[VisualizationFacade] Cannot initialize TowerPlacement - engine or streetNetwork not available');
      return;
    }

    const base = this.store.baseCoords();

    this.towerPlacement.initialize(
      engine,
      streetNetwork,
      this.osmService,
      { lat: base.lat, lon: base.lon },
      this.gameState
    );

    // Initialize map placement service (HQ/Spawn click-to-place)
    this.mapPlacement.initialize(engine, streetNetwork, { lat: base.lat, lon: base.lon });

    // Ability targeting (Nuclear Strike): aims with the engine, fires through the game state
    this.abilityTargeting.initialize(engine, this.gameState);

    // Hero: selection rings and the move preview with the engine, orders through the game state
    this.heroControl.initialize(engine, this.gameState);

    // LOS-Debug-Panel — beobachtet TowerManager-Selection + Cubemap
    this.losDebug.initialize(
      engine,
      this.gameState.towerManager,
      this.gameState.getEventBus(),
      this.globalRouteGridService,
    );
  }

  // ══════════════════════════════════════════════════════════════
  // Street Filtering & Rendering
  // ══════════════════════════════════════════════════════════════

  /**
   * Filter street network to only include streets near calculated routes.
   */
  filterStreetNetworkToRoutes(): void {
    const streetNetwork = this.bridge.getStreetNetwork();
    if (!streetNetwork) return;

    // DevWorld: Don't filter
    if (this.devWorld.isActive) {
      this.bridge.setFilteredStreetNetwork(streetNetwork);
      return;
    }

    const cachedPaths = this.pathRoute.getCachedPaths();
    const routes: { lat: number; lon: number }[][] = [];

    cachedPaths.forEach((path) => {
      routes.push(path.map(p => ({ lat: p.lat, lon: p.lon })));
    });

    if (routes.length === 0) {
      this.bridge.setFilteredStreetNetwork(streetNetwork);
      return;
    }

    const filtered = this.osmService.filterStreetsNearRoutes(
      streetNetwork,
      routes,
      STREET_FILTER_RADIUS
    );
    this.bridge.setFilteredStreetNetwork(filtered);
  }

  /**
   * Render streets on map.
   */
  renderStreets(): void {
    const engine = this.bridge.getEngine() || this.engineInit.getEngine();
    if (!engine) return;

    const base = this.store.baseCoords();
    this.streetRendering.renderStreets(
      engine,
      this.bridge.getFilteredStreetNetwork(),
      this.bridge.getStreetNetwork(),
      { lat: base.lat, lon: base.lon },
      this.store.streetsVisible()
    );
  }

  // ══════════════════════════════════════════════════════════════
  // Height Updates
  // ══════════════════════════════════════════════════════════════

  /**
   * Schedule overlay height updates, then build the route corridor behind
   * the loading screen (CorridorBuild): the first load and a location change
   * wait for both. The loading screen stays until the corridor is frozen
   * (checkAllLoaded).
   */
  async scheduleOverlayHeightUpdate(): Promise<void> {
    const engine = this.engineInit.getEngine();
    if (!engine) {
      console.warn('[VisualizationFacade] scheduleOverlayHeightUpdate - no engine!');
      return;
    }

    // From now on towers, waves and the end of the loading screen wait for the corridor.
    const ticket = this.corridor.expect();
    this.heightUpdate.initialize(
      engine,
      this.engineInit.loadingStatus,
      // The markers only: the cells get their heights from the corridor build.
      () => this.markerViz.updateMarkerHeights(),
      () => this.renderStreets(),
      (detail: string) => this.engineInit.setStepDone('view', detail),
      (detail: string) => this.engineInit.updateStepMeta('view', detail),
      () => this.checkAllLoaded(),
      () => {
        // Heights are known now: frame the overview on the real ground and
        // store it as the view the intro lands in and Reset Camera returns to.
        cameraTimeline.record('heights.cameraCorrection', { introRunning: this.introFlight.isRunning() });
        this.reframeCameraWithRoutes();
        this.saveInitialCameraPosition();
      }
    );

    await this.heightUpdate.scheduleOverlayHeightUpdate();
    await corridorTrace.within('heightUpdate.done', () => this.buildCorridorBehindLoadingScreen(ticket));
  }

  /**
   * The corridor build of a location load, as the loading step "corridor":
   * its steps as the step's meta, then the next check whether loading is
   * done. A build another load or move superseded ends without a word; that
   * one asks again.
   */
  private async buildCorridorBehindLoadingScreen(ticket: number): Promise<void> {
    void this.engineInit.setStepCurrent('corridor');
    const result = await this.corridor.build(
      'location load',
      ({ step, percent }) => this.engineInit.updateStepMeta('corridor', percent === null ? step : `${step} ${percent} %`),
      ticket,
    );
    if (!result) return;
    void this.engineInit.setStepDone('corridor', `${result.stations} stations, ${result.cells} cells${result.timedOut ? ', tiles timed out' : ''}`);
    this.checkAllLoaded();
  }

  /**
   * Build the corridor of routes built again without a location load (spawn
   * or HQ moved in place), under the hint of the move (CorridorBuild.build).
   */
  buildCorridor(reason: string, report: (progress: CorridorProgress) => void): Promise<CorridorBuildResult | null> {
    return this.corridor.build(reason, report);
  }

  /**
   * Check if all loading is complete.
   */
  checkAllLoaded(): void {
    const wasLoading = this.engineInit.loading();
    const isApplying = this.locationMgmt.isApplyingLocation();

    // Once tiles, streets and heights are there, the loading screen waits for
    // the corridor build; its end asks again (buildCorridorBehindLoadingScreen).
    const settled = !this.engineInit.tilesLoading() && !this.engineInit.osmLoading() && !this.heightUpdate.heightsLoading();
    if (wasLoading && settled && this.corridor.pending()) return;

    // First load only; a location change starts its flight from its own step 7.
    if (wasLoading && !isApplying && this.introGate.hold()) return;

    this.engineInit.checkAllLoaded(this.heightUpdate.heightsLoading);
    const isNowLoading = this.engineInit.loading();

    if (wasLoading && !isNowLoading) {
      cameraTimeline.record('loading.done', { isApplying });
      // Transition from opening music → build phase music now that loading screen is gone
      this.gameState.backgroundMusic?.onLoadingComplete();

      if (!this.routeAnimation.isRunning() && !isApplying) {
        const cachedPaths = this.pathRoute.getCachedPaths();
        if (cachedPaths.size > 0) {
          this.routeAnimation.startAnimation(cachedPaths, this.store.spawnPoints());
        }
      }

      // Spike: intro camera flight HQ → spawn. Doubles as a tile prewarm for
      // the route corridor. Guarded separately from the route animation —
      // that one is often already running by the time loading completes
      // (started from one of the spawn/location paths), and sharing its
      // guard would silently swallow the flight.
      // Toggle in DevTools via `__flight.setEnabled(false)`.
      if (!this.introFlight.isRunning() && !isApplying) {
        const cachedPaths = this.pathRoute.getCachedPaths();
        if (cachedPaths.size > 0) {
          this.introFlight.start(cachedPaths);
        }
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // Camera
  // ══════════════════════════════════════════════════════════════

  /**
   * Store the last computed overview frame as the initial view (intro
   * landing, Reset Camera, intro cancel), see CameraOverview.
   */
  saveInitialCameraPosition(): void {
    this.overview.saveInitialPosition();
  }

  /**
   * Toggle camera framing debug visualization.
   */
  toggleCameraFramingDebug(): void {
    this.overview.toggleFramingDebug();
  }

  /**
   * Toggle camera debug overlay.
   */
  toggleCameraDebug(): void {
    this.overview.toggleCameraDebug();
  }

  /**
   * Compute the overview frame around HQ, spawns and all routes and move the
   * camera there, unless the intro flight has the camera; it lands in the
   * overview anyway.
   */
  reframeCameraWithRoutes(): void {
    this.overview.reframe();
  }

  // ══════════════════════════════════════════════════════════════
  // Tiles Loaded
  // ══════════════════════════════════════════════════════════════

  /**
   * Called when tiles finish loading (LOD changes).
   */
  onTilesLoaded(): void {
    const engine = this.bridge.getEngine();
    if (!engine || !this.bridge.getFilteredStreetNetwork()) return;

    const t0 = performance.now();
    // Everything below, and the frames it schedules, runs under this tile batch in the corridor trace.
    const lodVersion = engine.terrain.lodVersion;
    const trace = corridorTrace.enter(`tilesLoaded lod=${lodVersion}`);
    corridorTrace.tiles(lodVersion, () => engine.routeCorridorLod());

    this.renderStreets();
    const tStreets = performance.now();

    // Re-render buildings if loaded
    this.buildings.rerender(engine);
    const tBuildings = performance.now();

    this.markerViz.updateMarkerHeights();
    const tMarkers = performance.now();

    // The cells, their heights, the route line and the corridor stay as the
    // corridor build left them (CorridorBuild): a tile batch neither samples
    // a cell nor rebuilds a line. Before it, the loading screen stands and
    // the build measures on the tiles it waits for itself.
    const tTerrainHeights = performance.now();
    const tRoutes = performance.now();
    const tRouteAnim = performance.now();

    this.gameState.onTilesLoaded();
    const tGameState = performance.now();
    const tConvergence = performance.now();

    // Per-tower LOS is no longer re-resolved here. It used to run a full
    // sweep (clear every tower's visibility cache, then re-raycast every
    // in-range cell via per-cell GPU readPixels) on every tile-load — a
    // multi-second main-thread stall even when no cell had actually
    // changed LOD. The cells-changed listener, fired by each slice of the
    // sweep, now covers both promoted and refreshed cells incrementally, so a
    // tile-load with no LOD change costs nothing.

    this.gameState.getGlobalRouteGrid().initSpatialGridVisualizationIfEnabled();
    this.gameState.getGlobalRouteGrid().initAirSpatialGridVisualizationIfEnabled();
    this.gameState.getGlobalRouteGrid().initAirRouteLayerIfEnabled();
    const tDebugViz = performance.now();

    perfTrace.log(() =>
      `[PerfTrace] onTilesLoaded: ${(tDebugViz - t0).toFixed(1)}ms total | ` +
      `streets=${(tStreets - t0).toFixed(1)} ` +
      `buildings=${(tBuildings - tStreets).toFixed(1)} ` +
      `markers=${(tMarkers - tBuildings).toFixed(1)} ` +
      `terrainHeights=${(tTerrainHeights - tMarkers).toFixed(1)} ` +
      `refreshRoutes=${(tRoutes - tTerrainHeights).toFixed(1)} ` +
      `routeAnim=${(tRouteAnim - tRoutes).toFixed(1)} ` +
      `gameState=${(tGameState - tRouteAnim).toFixed(1)} ` +
      `convergence=${(tConvergence - tGameState).toFixed(1)} ` +
      `debugViz=${(tDebugViz - tConvergence).toFixed(1)}ms`,
    );
    corridorTrace.cost('tilesLoaded', tDebugViz - t0);
    corridorTrace.exit(trace);
  }

  // ══════════════════════════════════════════════════════════════
  // Toggle Delegations
  // ══════════════════════════════════════════════════════════════

  /**
   * Toggle street rendering visibility.
   */
  onStreetsToggled(): void {
    this.streetRendering.toggleVisibility();
  }

  /**
   * Toggle building footprints visibility.
   * Loads buildings on first toggle-on.
   */
  onBuildingsToggled(): void {
    this.buildings.toggled();
  }

  /**
   * Toggle route lines visibility.
   */
  onRoutesToggled(): void {
    this.pathRoute.toggleRouteLinesVisibility();
  }

  /**
   * Toggle special points debug (fire position markers, etc.).
   */
  onSpecialPointsDebugToggled(): void {
    this.markerViz.toggleSpecialPointsDebug();
  }

  /**
   * Play route animation for all cached paths.
   */
  onPlayRouteAnimation(): void {
    const cachedPaths = this.pathRoute.getCachedPaths();
    if (cachedPaths.size > 0) {
      this.routeAnimation.startAnimation(cachedPaths, this.store.spawnPoints());
    }
  }

  // ══════════════════════════════════════════════════════════════
  // DPS Visualization
  // ══════════════════════════════════════════════════════════════

  /**
   * Toggle DPS profile bins visualization.
   */
  onDpsBinsToggled(visible: boolean): void {
    const engine = this.bridge.getEngine() || this.engineInit.getEngine();
    if (!engine) return;
    this.dpsBins.setVisible(visible, engine);
  }

  /**
   * Clean up DPS visualization resources.
   * Called on restart and dispose.
   */
  cleanupDpsVisualization(): void {
    const engine = this.initialized ? this.bridge.getEngine() : null;
    this.dpsBins.dispose(engine);
  }
}
