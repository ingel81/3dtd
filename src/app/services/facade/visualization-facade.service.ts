import { Injectable, inject, Injector, effect } from '@angular/core';
import { OsmStreetService } from '../location/osm-street.service';
import { UIStore } from '../../store/ui.store';
import { CameraControlService } from '../camera-control.service';
import { MarkerVisualizationService } from '../world/marker-visualization.service';
import { PathAndRouteService } from '../world/path-route.service';
import { InputHandlerService } from '../input-handler.service';
import { TowerPlacementService } from '../tower-placement.service';
import { MapPlacementService } from '../world/map-placement.service';
import { HeightUpdateService } from '../world/height-update.service';
import { EngineInitializationService } from '../infrastructure/engine-initialization.service';
import { DevWorldService } from '../../devworld/devworld.service';
import { CameraFramingService, GeoPoint } from '../camera-framing.service';
import { RouteAnimationService } from '../world/route-animation.service';
import { KeyboardPanService } from '../keyboard-pan.service';
import { StreetRenderingService } from '../world/street-rendering.service';
import { BuildingRenderingService } from '../world/building-rendering.service';
import { BuildingFootprint } from '../location/osm-street.service';
import { StrategicPlacementService } from '../world/strategic-placement.service';
import { EnemyDebugService } from '../debug/enemy-debug.service';
import { TowerDebugService } from '../debug/tower-debug.service';
import { DebugFacadeService } from '../debug/debug-facade.service';
import { LosDebugService } from '../debug/los-debug.service';
import { GlobalRouteGridService } from '../world/global-route-grid.service';
import { LocationManagementService } from '../location/location-management.service';
import { SubscriptionBag } from '../../game-engine/game-event-bus';
import { AIDataCollectorService } from '../../ai/core/ai-data-collector.service';
import { DpsProfileVisualizer } from '../../ai/core/dps-profile-visualizer';
import { GameStateManager } from '../../managers/game-state.manager';
import { SpawnPoint as WaveSpawnPoint } from '../../managers/wave.manager';
import { TowerTypeId } from '../../configs/tower-types.config';
import { ThreeTilesEngine } from '../../three-engine';
import { Vector3 } from 'three';
import { FacadeComponentBridge } from './tower-defense-facade.service';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { EngineStore } from '../../store/engine.store';
import { STREET_FILTER_RADIUS, CAMERA_PADDING, CAMERA_ANGLE, CAMERA_MARKER_RADIUS } from '../../configs/map-constants.config';

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
  private readonly losDebug = inject(LosDebugService);
  private readonly globalRouteGridService = inject(GlobalRouteGridService);
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
    if (this.routeGridConvergenceRaf !== null) {
      cancelAnimationFrame(this.routeGridConvergenceRaf);
      this.routeGridConvergenceRaf = null;
    }
    this.routeGridConvergenceScheduled = false;
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
    // Defensive: clear any prior subscriptions so a future re-init path can't
    // double-subscribe (consistent with combat-effect/hq-damage/game-state).
    this.eventBusSubs.disposeAll();
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
      (detail: string) => this.engineInit.setStepDone('view', detail),
      (detail: string) => this.engineInit.updateStepMeta('view', detail),
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
          this.routeAnimation.startAnimation(cachedPaths, this.store.spawnPoints(), this.pathRoute.getCachedOriginTerrainY());
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

    // Refresh cell terrain heights against the just-streamed tile geometry
    // BEFORE the route-line / route-animation rebuild reads from them.
    // Cells are now the single source of truth for ground Y (red line,
    // enemy feet, tower-LOS), so the line snap-up after a tile-load
    // depends on this refresh happening first.
    //
    // This also drives per-tower LOS: updateTerrainHeights fires the
    // cells-changed listener for every promoted/refreshed cell, and the
    // tower-placement handler re-resolves LOS for just those cells on the
    // towers that cover them. When no cell changed LOD (the common
    // pan/zoom case) the listener never fires — so the cost shown in the
    // `terrainHeights` PerfTrace term stays at a few ms instead of the
    // multi-second cubemap-readback spike the old full sweep produced.
    // Kick off a FRAME-BUDGETED refresh instead of the old synchronous full
    // sweep. The sweep used to raycast all ~3600 cells in one blocking call
    // (~900ms main-thread freeze on every tile-load = the pan/zoom stutter).
    // `scheduleRouteGridConvergence` below now drives the sweep across rAF
    // ticks at ~5ms/frame, then falls back to unsampled self-heal. The route
    // lines / animation below read the current (for refresh-cases already
    // usable) cell heights; the small LOD deltas snap in over the next frames.
    this.gameState.getGlobalRouteGrid().beginTerrainHeightRefresh();
    const tTerrainHeights = performance.now();

    // Immediate refresh: lines read cell heights live, which at this instant
    // are still last-load's values (the budgeted sweep above hasn't sampled
    // yet). That keeps the lines visible / topology-correct right away; the
    // convergence loop re-runs this ONCE more after the sweep finishes so the
    // heights snap to the freshly-streamed tiles (otherwise the red line /
    // animation sit a few metres inside the terrain until the next tile-load).
    this.refreshRoutesAndAnimation();
    const tRoutes = performance.now();
    const tRouteAnim = performance.now();

    this.gameState.onTilesLoaded();
    const tGameState = performance.now();

    // Self-heal cells that were `unsampled` either because tiles weren't
    // streamed yet OR because the strict sampleCellY rejected a fallback
    // hit / sanity-outlier in an earlier pass. Tile-mesh decoding is
    // asynchronous to the load-end event, so we keep retrying across rAF
    // ticks until two consecutive frames promote nothing (= converged)
    // or a safety cap is hit. No magic-number timeout — the loop
    // self-adjusts to hardware and cache state.
    this.scheduleRouteGridConvergence();
    const tConvergence = performance.now();

    // Per-tower LOS is no longer re-resolved here. It used to run a full
    // sweep (clear every tower's visibility cache, then re-raycast every
    // in-range cell via per-cell GPU readPixels) on every tile-load — a
    // multi-second main-thread stall even when no cell had actually
    // changed LOD. The cells-changed listener wired up in updateTerrainHeights
    // now covers both promoted and refreshed cells incrementally, so a
    // tile-load with no LOD change costs nothing.

    this.gameState.getGlobalRouteGrid().initSpatialGridVisualizationIfEnabled();
    this.gameState.getGlobalRouteGrid().initAirSpatialGridVisualizationIfEnabled();
    this.gameState.getGlobalRouteGrid().initAirRouteLayerIfEnabled();
    const tDebugViz = performance.now();

    console.warn(
      `[PerfTrace] onTilesLoaded: ${(tDebugViz - t0).toFixed(1)}ms total | ` +
      `streets=${(tStreets - t0).toFixed(1)} ` +
      `buildings=${(tBuildings - tStreets).toFixed(1)} ` +
      `markers=${(tMarkers - tBuildings).toFixed(1)} ` +
      `terrainHeights=${(tTerrainHeights - tMarkers).toFixed(1)} ` +
      `refreshRoutes=${(tRoutes - tTerrainHeights).toFixed(1)} ` +
      `routeAnim=${(tRouteAnim - tRoutes).toFixed(1)} ` +
      `gameState=${(tGameState - tRouteAnim).toFixed(1)} ` +
      `convergence=${(tConvergence - tGameState).toFixed(1)} ` +
      `debugViz=${(tDebugViz - tConvergence).toFixed(1)}ms`
    );
  }

  // ══════════════════════════════════════════════════════════════
  // Private Helpers (deduplication)
  // ══════════════════════════════════════════════════════════════

  private routeGridConvergenceScheduled = false;
  /** rAF handle for the convergence loop — cancelled in dispose(). */
  private routeGridConvergenceRaf: number | null = null;

  /** Per-frame time budget (ms) for the budgeted terrain-refresh sweep.
   * ~5ms keeps frames at ~55fps while ~1300 raycasts converge over ~1.5–2s
   * in the background, instead of one ~900ms blocking sweep. Central tuning
   * knob: smaller = smoother but slower convergence. */
  private readonly TERRAIN_REFRESH_BUDGET_MS = 5;

  /**
   * Unified rAF refresh loop. Each tick first advances the frame-budgeted
   * terrain-refresh sweep (kicked off by `beginTerrainHeightRefresh` in
   * `onTilesLoaded`); once that sweep is done it falls back to
   * `retryUnsampledCells` self-heal until convergence — i.e. two consecutive
   * frames promote zero cells, or the safety cap is hit.
   *
   * A single loop (rather than two competing rAF loops) avoids two raycast
   * passes racing each frame. The retry phase handles cells whose tile mesh
   * decodes asynchronously AFTER the budgeted sweep already passed them
   * (tile-mesh decoding is async to the tile-load-end event; cf. cases
   * 2/5/6/10/12/14 in the bug hunt).
   *
   * `MAX_FRAMES = 120` (~2s at 60fps) is purely a safety guard against
   * pathological loops; on normal hardware the loop exits within a
   * handful of frames once the engine has decoded the mesh.
   */
  private scheduleRouteGridConvergence(): void {
    if (this.routeGridConvergenceScheduled) return;
    this.routeGridConvergenceScheduled = true;
    const MAX_FRAMES = 120;
    const grid = this.gameState.getGlobalRouteGrid();
    let frames = 0;
    let zeroFrames = 0;
    // Did any cell height actually move during this convergence session? If
    // so, re-snap the route lines + animation once at the end — they read
    // cell heights live but have no per-cell change listener, so without this
    // the red line / animated route stay at their stale pre-sweep heights
    // (a few metres inside the terrain) until the next tile-load.
    let anyChanged = false;

    const finish = () => {
      this.routeGridConvergenceScheduled = false;
      if (anyChanged) {
        this.refreshRoutesAndAnimation();
      }
    };

    const tick = () => {
      this.routeGridConvergenceRaf = null;
      // dispose() may have torn down the engine/grid between frames.
      if (!this.routeGridConvergenceScheduled) return;
      if (frames++ >= MAX_FRAMES) {
        finish();
        return;
      }

      // Phase 1: advance the budgeted terrain-refresh sweep. While it's in
      // flight, keep ticking and skip the unsampled-retry (the sweep already
      // covers promotion + refresh for every cell).
      if (grid.isTerrainRefreshActive()) {
        const { changed } = grid.stepTerrainHeightRefresh(this.TERRAIN_REFRESH_BUDGET_MS);
        if (changed > 0) anyChanged = true;
        // The MAX_FRAMES cap guards the unsampled-retry tail only — don't let
        // it abandon an in-flight (or panning-restarted) sweep.
        frames = 0;
        zeroFrames = 0;
        this.routeGridConvergenceRaf = requestAnimationFrame(tick);
        return;
      }

      // Phase 2: self-heal cells whose mesh decoded after the sweep passed.
      const { promoted } = grid.retryUnsampledCells();
      if (promoted > 0) {
        anyChanged = true;
        zeroFrames = 0;
        this.routeGridConvergenceRaf = requestAnimationFrame(tick);
      } else if (zeroFrames < 1) {
        // One empty frame may just be the gap between tile-decode bursts —
        // give it one more chance before declaring convergence.
        zeroFrames++;
        this.routeGridConvergenceRaf = requestAnimationFrame(tick);
      } else {
        finish();
      }
    };
    this.routeGridConvergenceRaf = requestAnimationFrame(tick);
  }

  /**
   * Rebuild the route lines (system 3) and restart the route animation
   * (system 4) from the current cell-grid heights. Both read ground Y live
   * via `getGroundLocalYAt`, so calling this after terrain heights settle
   * snaps them onto the freshly-streamed tile surface. Shared by the
   * immediate refresh in `onTilesLoaded` and the post-convergence re-snap.
   */
  private refreshRoutesAndAnimation(): void {
    this.pathRoute.refreshRouteLines(this.store.spawnPoints());
    if (this.routeAnimation.isRunning()) {
      const cachedPaths = this.pathRoute.getCachedPaths();
      if (cachedPaths.size > 0) {
        this.routeAnimation.startAnimation(
          cachedPaths,
          this.store.spawnPoints(),
          this.pathRoute.getCachedOriginTerrainY(),
        );
      }
    }
  }

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
      this.routeAnimation.startAnimation(cachedPaths, this.store.spawnPoints(), this.pathRoute.getCachedOriginTerrainY());
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
