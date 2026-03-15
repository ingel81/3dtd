import { Injectable, inject, Injector, effect } from '@angular/core';
import { OsmStreetService } from './osm-street.service';
import { UIStore } from '../store/ui.store';
import { CameraControlService } from './camera-control.service';
import { MarkerVisualizationService } from './marker-visualization.service';
import { PathAndRouteService } from './path-route.service';
import { InputHandlerService } from './input-handler.service';
import { TowerPlacementService } from './tower-placement.service';
import { MapPlacementService } from './map-placement.service';
import { HeightUpdateService } from './height-update.service';
import { EngineInitializationService } from './engine-initialization.service';
import { DevWorldService } from '../devworld/devworld.service';
import { CameraFramingService, GeoPoint } from './camera-framing.service';
import { RouteAnimationService } from './route-animation.service';
import { KeyboardPanService } from './keyboard-pan.service';
import { StreetRenderingService } from './street-rendering.service';
import { BuildingRenderingService } from './building-rendering.service';
import { BuildingFootprint } from './osm-street.service';
import { StrategicPlacementService } from './strategic-placement.service';
import { EnemyDebugService } from './enemy-debug.service';
import { TowerDebugService } from './tower-debug.service';
import { DebugFacadeService } from './debug-facade.service';
import { LocationManagementService } from './location-management.service';
import { SubscriptionBag } from '../game-engine/game-event-bus';
import { AIDataCollectorService } from '../ai/core/ai-data-collector.service';
import { DpsProfileVisualizer } from '../ai/core/dps-profile-visualizer';
import { GameStateManager } from '../managers/game-state.manager';
import { SpawnPoint as WaveSpawnPoint } from '../managers/wave.manager';
import { TowerTypeId } from '../configs/tower-types.config';
import { ThreeTilesEngine } from '../three-engine';
import { Vector3 } from 'three';
import { FacadeComponentBridge } from './tower-defense-facade.service';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { EngineStore } from '../store/engine.store';
import { STREET_FILTER_RADIUS, CAMERA_PADDING, CAMERA_ANGLE, CAMERA_MARKER_RADIUS } from '../configs/map-constants.config';

/**
 * Sub-facade for visualization, camera, rendering, and height updates.
 *
 * Responsibilities:
 * - Visualization service initialization
 * - DPS profile visualization
 * - Street rendering and filtering
 * - Height update scheduling
 * - Camera management (save, debug, reframe)
 * - Route animations
 * - Tiles loaded handling
 * - Click handler setup
 * - Game state initialization (routes, tower placement)
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
  private readonly heightUpdate = inject(HeightUpdateService);
  private readonly engineInit = inject(EngineInitializationService);
  private readonly devWorld = inject(DevWorldService);
  private readonly cameraFraming = inject(CameraFramingService);
  private readonly routeAnimation = inject(RouteAnimationService);
  private readonly keyboardPan = inject(KeyboardPanService);
  private readonly streetRendering = inject(StreetRenderingService);
  private readonly buildingRendering = inject(BuildingRenderingService);
  private readonly strategicPlacement = inject(StrategicPlacementService);
  private readonly enemyDebug = inject(EnemyDebugService);
  private readonly towerDebug = inject(TowerDebugService);
  private readonly debugFacade = inject(DebugFacadeService);
  private readonly locationMgmt = inject(LocationManagementService);
  private readonly aiDataCollector = inject(AIDataCollectorService);
  private readonly mapPlacement = inject(MapPlacementService);
  private readonly store = inject(TowerDefenseStore);
  private readonly engineStore = inject(EngineStore);

  /** Component bridge — set via initialize() */
  private bridge!: FacadeComponentBridge;

  /** Game state manager — set via initialize() */
  private gameState!: GameStateManager;

  /** Whether this sub-facade has been initialized */
  private initialized = false;

  /** EventBus subscription bag — cleaned up in dispose() */
  private readonly eventBusSubs = new SubscriptionBag();

  /** DPS profile visualization along path */
  private dpsProfileViz: DpsProfileVisualizer | null = null;
  private dpsVizUnsubscribes: (() => void)[] = [];

  /** Cached building footprints (filtered to route corridor) */
  private cachedBuildings: BuildingFootprint[] | null = null;

  /**
   * Initialize sub-facade with bridge and game state.
   */
  initialize(bridge: FacadeComponentBridge, gameState: GameStateManager): void {
    this.bridge = bridge;
    this.gameState = gameState;
    this.initialized = true;
  }

  /**
   * Reset state and cleanup on dispose.
   */
  dispose(): void {
    this.eventBusSubs.disposeAll();
    const engine = this.initialized ? this.bridge.getEngine() : null;
    this.disposeDpsVisualization(engine);
    this.cachedBuildings = null;
    this.buildingRendering.reset();
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
    const eventBus = this.gameState.getEventBus();

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
      this.markerViz.getSpawnMarkers()
    );

    // Initialize camera control service
    this.cameraControl.initialize(engine, { lat: baseCoords.lat, lon: baseCoords.lon });

    // Initialize route animation service
    this.routeAnimation.initialize(engine);

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
      streetNetwork,
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
    void this.engineInit.setStepActive('grid');
    this.engineInit.updateStepDetail('grid', 'Calculating grid...');
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
   * Schedule overlay height updates.
   */
  async scheduleOverlayHeightUpdate(): Promise<void> {
    const engine = this.engineInit.getEngine();
    if (!engine) {
      console.warn('[VisualizationFacade] scheduleOverlayHeightUpdate - no engine!');
      return;
    }

    const base = this.store.baseCoords();

    this.heightUpdate.initialize(
      engine,
      { lat: base.lat, lon: base.lon },
      this.engineInit.loadingStatus,
      () => {
        this.markerViz.updateMarkerHeights(this.toSpawnPointDTOs());
        this.gameState.getGlobalRouteGrid().updateTerrainHeights();
      },
      () => this.renderStreets(),
      (detail: string) => this.engineInit.setStepDone('finalize', detail),
      (detail: string) => this.engineInit.updateStepDetail('finalize', detail),
      () => this.checkAllLoaded(),
      () => {
        this.cameraFraming.setEngine(engine);
        const realTerrainY = engine.getTerrainHeightAtGeo(base.lat, base.lon) ?? 0;
        if (Math.abs(realTerrainY) > 1) {
          this.cameraFraming.correctTerrainHeight(realTerrainY, 0);
        }
        this.saveInitialCameraPosition();
      }
    );

    await this.heightUpdate.scheduleOverlayHeightUpdate();
  }

  /**
   * Check if all loading is complete.
   */
  checkAllLoaded(): void {
    const wasLoading = this.engineInit.loading();
    const isApplying = this.locationMgmt.isApplyingLocation();

    this.engineInit.checkAllLoaded(this.heightUpdate.heightsLoading);
    const isNowLoading = this.engineInit.loading();

    if (wasLoading && !isNowLoading) {
      // Transition from opening music → build phase music now that loading screen is gone
      this.gameState.backgroundMusic?.onLoadingComplete();

      if (!this.routeAnimation.isRunning() && !isApplying) {
        const cachedPaths = this.pathRoute.getCachedPaths();
        if (cachedPaths.size > 0) {
          this.routeAnimation.startAnimation(cachedPaths, this.store.spawnPoints());
        }
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // Camera
  // ══════════════════════════════════════════════════════════════

  /**
   * Save current camera position as initial position for reset.
   */
  saveInitialCameraPosition(): void {
    const hq = this.store.baseCoords();
    const spawns = this.store.spawnPoints();

    const routePoints = this.collectRoutePoints();

    if (spawns.length > 0) {
      const hqCoord = { lat: hq.lat, lon: hq.lon };
      const spawnCoords = spawns.map(s => ({ lat: s.lat, lon: s.lon }));
      this.cameraControl.showDebugVisualization(hqCoord, spawnCoords, CAMERA_PADDING, routePoints);
    }

    const lastFrame = this.cameraFraming.getLastFrame();
    const target = lastFrame
      ? { x: lastFrame.lookAtX, y: lastFrame.lookAtY, z: lastFrame.lookAtZ }
      : undefined;

    this.cameraControl.saveInitialPosition(target);
  }

  /**
   * Toggle camera framing debug visualization.
   */
  toggleCameraFramingDebug(): void {
    const enabled = this.cameraControl.toggleDebugFraming();
    this.store.cameraFramingDebug.set(enabled);

    if (enabled) {
      const hq = this.store.baseCoords();
      const spawns = this.store.spawnPoints();

      const routePoints = this.collectRoutePoints();

      if (spawns.length > 0) {
        this.cameraControl.showDebugVisualization(
          { lat: hq.lat, lon: hq.lon },
          spawns.map(s => ({ lat: s.lat, lon: s.lon })),
          CAMERA_PADDING,
          routePoints
        );
      }
    }
  }

  /**
   * Toggle camera debug overlay.
   */
  toggleCameraDebug(): void {
    const enabled = !this.engineStore.cameraDebugEnabled();
    this.engineStore.cameraDebugEnabled.set(enabled);

    if (enabled) {
      this.engineStore.cameraDebugInfo.set(this.cameraControl.getCameraDebugInfo());
    } else {
      this.engineStore.cameraDebugInfo.set(null);
    }
  }

  /**
   * Log camera position to debug log.
   */
  logCameraPosition(): void {
    const engine = this.bridge.getEngine();
    if (!engine) return;

    const camera = engine.getCamera();
    const data = {
      position: {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      },
      hq: this.store.baseCoords(),
      tiltAngle: 45,
    };

    const output = JSON.stringify(data, null, 2);
    this.debugFacade.appendDebugLog('=== CAMERA ===\n' + output);
  }

  /**
   * Reframe camera to include all calculated routes.
   */
  reframeCameraWithRoutes(): void {
    const base = this.store.baseCoords();
    const hq: GeoPoint = { lat: base.lat, lon: base.lon };

    const spawns: GeoPoint[] = this.store.spawnPoints().map(sp => ({
      lat: sp.lat,
      lon: sp.lon,
    }));

    const routePoints = this.collectRoutePoints();

    if (routePoints.length > 0) {
      this.cameraFraming.reframeWithRoutes(hq, spawns, routePoints, {
        padding: CAMERA_PADDING,
        angle: CAMERA_ANGLE,
        markerRadius: CAMERA_MARKER_RADIUS,
      });
    }
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

    // Always update overlay base Y (must happen even if streets are still building progressively)
    const base = this.store.baseCoords();
    const originTerrainY = engine.getTerrainHeightAtGeo(base.lat, base.lon);
    if (originTerrainY !== null) {
      engine.setOverlayBaseY(originTerrainY);
    }

    const t0 = performance.now();

    this.renderStreets();
    const tStreets = performance.now();

    // Re-render buildings if loaded
    if (this.cachedBuildings && this.uiStore.buildingsVisible()) {
      const base = this.store.baseCoords();
      this.buildingRendering.renderBuildings(
        engine,
        this.cachedBuildings,
        { lat: base.lat, lon: base.lon },
        true
      );
    }
    const tBuildings = performance.now();

    this.markerViz.updateMarkerHeights(this.toSpawnPointDTOs());
    const tMarkers = performance.now();

    this.pathRoute.refreshRouteLines(this.store.spawnPoints());
    const tRoutes = performance.now();

    this.gameState.onTilesLoaded();
    this.gameState.getGlobalRouteGrid().initSpatialGridVisualizationIfEnabled();

    console.warn(
      `[PerfTrace] onTilesLoaded: ${(performance.now() - t0).toFixed(1)}ms total | streets=${(tStreets - t0).toFixed(1)}ms buildings=${(tBuildings - tStreets).toFixed(1)}ms markers=${(tMarkers - tBuildings).toFixed(1)}ms routes=${(tRoutes - tMarkers).toFixed(1)}ms`
    );
  }

  // ══════════════════════════════════════════════════════════════
  // Private Helpers (deduplication)
  // ══════════════════════════════════════════════════════════════

  /**
   * Map store spawn points to DTOs with color (for marker viz, tower placement, etc.).
   */
  private toSpawnPointDTOs(): { id: string; name: string; lat: number; lon: number; color: number }[] {
    return this.store.spawnPoints().map(sp => ({
      id: sp.id,
      name: sp.name,
      lat: sp.lat,
      lon: sp.lon,
      color: sp.color,
    }));
  }

  /**
   * Collect all route points from cached paths as GeoPoints.
   */
  private collectRoutePoints(): GeoPoint[] {
    const routePoints: GeoPoint[] = [];
    const cachedPaths = this.pathRoute.getCachedPaths();
    cachedPaths.forEach((path) => {
      for (const pos of path) {
        routePoints.push({ lat: pos.lat, lon: pos.lon });
      }
    });
    return routePoints;
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
    const visible = this.uiStore.buildingsVisible();

    if (visible && !this.cachedBuildings) {
      // First time: load and render buildings
      this.loadAndRenderBuildings();
    } else {
      this.buildingRendering.toggleVisibility();
    }
  }

  /**
   * Load building footprints from OSM and render them.
   */
  private async loadAndRenderBuildings(): Promise<void> {
    const engine = this.bridge.getEngine() || this.engineInit.getEngine();
    if (!engine) return;

    const base = this.store.baseCoords();
    const center = this.store.centerCoords();

    try {
      const buildingData = await this.osmService.loadBuildings(center.lat, center.lon);

      // Filter to route corridor
      const cachedPaths = this.pathRoute.getCachedPaths();
      const routes: { lat: number; lon: number }[][] = [];
      cachedPaths.forEach((path) => {
        routes.push(path.map(p => ({ lat: p.lat, lon: p.lon })));
      });

      this.cachedBuildings = routes.length > 0
        ? this.osmService.filterBuildingsNearRoutes(buildingData.buildings, routes, STREET_FILTER_RADIUS)
        : buildingData.buildings;

      this.buildingRendering.renderBuildings(
        engine,
        this.cachedBuildings,
        { lat: base.lat, lon: base.lon },
        this.uiStore.buildingsVisible()
      );
    } catch (err) {
      console.error('[Buildings] Failed to load:', err);
    }
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

    if (visible) {
      const grid = this.gameState.getGlobalRouteGrid();
      const coordSync = grid.getCoordinateSync();
      if (!coordSync) return;

      if (!this.dpsProfileViz) {
        this.dpsProfileViz = new DpsProfileVisualizer(coordSync);
      }

      this.updateDpsViz(engine);

      const eventBus = this.gameState.getEventBus();
      const updateHandler = () => this.updateDpsViz(engine);
      const sub1 = eventBus.on('tower:placed', updateHandler);
      const sub2 = eventBus.on('tower:sold', updateHandler);
      const sub3 = eventBus.on('tower:upgraded', updateHandler);
      this.dpsVizUnsubscribes = [
        () => sub1.dispose(),
        () => sub2.dispose(),
        () => sub3.dispose(),
      ];
    } else {
      if (this.dpsProfileViz) {
        this.dpsProfileViz.setVisible(false);
      }
      this.dpsVizUnsubscribes.forEach(fn => fn());
      this.dpsVizUnsubscribes = [];
    }
  }

  private updateDpsViz(engine: ThreeTilesEngine): void {
    if (!this.dpsProfileViz) return;
    const profile = this.aiDataCollector.getCurrentDPSProfile();
    this.dpsProfileViz.update(profile);
    this.dpsProfileViz.setVisible(true);
    const mesh = this.dpsProfileViz.getMesh();
    if (mesh && !mesh.parent) {
      engine.getScene().add(mesh);
    }
  }

  /**
   * Clean up DPS visualization resources.
   * Called on restart and dispose.
   */
  cleanupDpsVisualization(): void {
    const engine = this.initialized ? this.bridge.getEngine() : null;
    this.disposeDpsVisualization(engine);
  }

  /**
   * Dispose DPS visualization resources.
   */
  private disposeDpsVisualization(engine: ThreeTilesEngine | null): void {
    this.dpsVizUnsubscribes.forEach(fn => fn());
    this.dpsVizUnsubscribes = [];
    if (this.dpsProfileViz) {
      const mesh = this.dpsProfileViz.getMesh();
      if (mesh) engine?.getScene().remove(mesh);
      this.dpsProfileViz.dispose();
      this.dpsProfileViz = null;
    }
  }
}
