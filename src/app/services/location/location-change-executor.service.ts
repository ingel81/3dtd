import { Injectable, inject, WritableSignal } from '@angular/core';
import { ThreeTilesEngine } from '../../three-engine';
import { GameStateManager } from '../../managers/game-state.manager';
import { SPAWN_COLORS } from '../../configs/map-constants.config';
import { SpawnPoint as WaveSpawnPoint } from '../../managers/wave.manager';
import { StreetNetwork, OsmStreetService } from './osm-street.service';
import { EngineInitializationService } from '../infrastructure/engine-initialization.service';
import { HeightUpdateService } from '../world/height-update.service';
import { MarkerVisualizationService, SpawnPoint } from '../world/marker-visualization.service';
import { PathAndRouteService } from '../world/path-route.service';
import { CameraControlService } from '../camera-control.service';
import { CameraFramingService, GeoPoint } from '../camera-framing.service';
import { IntroCameraFlightService } from '../world/intro-camera-flight.service';
import { RouteAnimationService } from '../world/route-animation.service';
import { KeyboardPanService } from '../keyboard-pan.service';
import { LocationManagementService } from './location-management.service';
import { UIStore } from '../../store/ui.store';
import { LocationConfig, SavedSpawn } from '../../models/location.types';
import { GeoPosition } from '../../models/game.types';
import { corridorTrace } from '../../utils/corridor-trace';

/**
 * Input data for location change
 */
export interface LocationChangeInput {
  hq: LocationConfig;
  /** With the bearing of its portal where the player turned it (a favorite, a retry), see SavedSpawn */
  spawn: LocationConfig & Pick<SavedSpawn, 'portalBearing'>;
}

/**
 * Runtime context provided by the component
 */
export interface LocationChangeContext {
  engine: ThreeTilesEngine;
  gameState: GameStateManager;
  streetNetwork: StreetNetwork | null;
  streetNetworkLocation: { lat: number; lon: number } | null;
  heightDebugVisible: WritableSignal<boolean>;
}

/**
 * Callbacks for component-specific actions
 * The coordinator orchestrates, but the component handles state updates
 */
export interface LocationChangeCallbacks {
  // Signal updates
  setBaseCoords(coords: GeoPosition): void;
  setCenterCoords(coords: GeoPosition & { height: number }): void; // height required for camera
  setSpawnPoints(points: SpawnPoint[]): void;
  /** @param portalBearing Which way its portal faces, see SavedSpawn; along its route without one */
  addSpawnPoint(id: string, name: string, lat: number, lon: number, color: number, portalBearing?: number): void;
  setStreetCount(count: number): void;
  setStreetNetwork(network: StreetNetwork | null): void;
  setStreetNetworkLocation(loc: GeoPosition | null): void;

  // Actions
  syncUrlWithLocation(): void;
  clearMapEntities(): void;
  appendDebugLog(msg: string): void;
  initializeTowerPlacement(): void;
  filterStreetNetworkToRoutes(): void;
  scheduleOverlayHeightUpdate(): Promise<void>;

  // Current state accessors
  getSpawnPoints(): SpawnPoint[];
  getBaseCoords(): GeoPosition;
}

/**
 * LocationChangeExecutorService - runs the location change sequence
 *
 * The 7 Steps:
 * 1. Initialize - Set loading flags, reset steps
 * 2. Reset - Stop updates, reset game state, update engine origin
 * 3. Load Streets - Load OSM data (with cache check)
 * 4. Place HQ - Initialize visualization services, add base marker
 * 5. Place Spawn - Add spawn point with marker and path
 * 6. Calculate Routes - Initialize game state, validate paths, setup grid
 * 7. Finalize - Height updates, save location, start animation
 *
 * Throws when a step fails (e.g. no route between HQ and spawn); the
 * LocationChangeCoordinatorService guards against concurrent changes and
 * unwinds the loading flags on error.
 */
@Injectable({ providedIn: 'root' })
export class LocationChangeExecutorService {
  private readonly engineInit = inject(EngineInitializationService);
  private readonly osmService = inject(OsmStreetService);
  private readonly heightUpdate = inject(HeightUpdateService);
  private readonly markerViz = inject(MarkerVisualizationService);
  private readonly pathRoute = inject(PathAndRouteService);
  private readonly cameraControl = inject(CameraControlService);
  private readonly cameraFraming = inject(CameraFramingService);
  private readonly routeAnimation = inject(RouteAnimationService);
  private readonly introFlight = inject(IntroCameraFlightService);
  private readonly keyboardPan = inject(KeyboardPanService);
  private readonly locationMgmt = inject(LocationManagementService);
  private readonly uiStore = inject(UIStore);

  /**
   * Execute the complete location change sequence
   */
  async executeLocationChange(
    input: LocationChangeInput,
    ctx: LocationChangeContext,
    callbacks: LocationChangeCallbacks
  ): Promise<void> {
    // STEP 1: Initialize loading state
    await this.step1_InitializeLoadingState();

    // STEP 2: Reset and configure engine
    await this.step2_ResetAndConfigureEngine(input, ctx, callbacks);

    // STEP 3: Load streets (with cache check)
    const streetNetwork = await this.step3_LoadStreets(input, ctx, callbacks);

    // Wait for tiles with timeout
    await this.waitForTilesWithTimeout(ctx);

    // STEP 4: Place HQ marker and initialize services
    await this.step4_PlaceHQMarker(input, ctx, streetNetwork);

    // STEP 5: Place spawn point
    await this.step5_PlaceSpawnPoint(input, callbacks);

    // STEP 6: Calculate routes and initialize grid
    await this.step6_CalculateRoutes(ctx, callbacks);

    // STEP 7: Finalize (heights, save, animation)
    await this.step7_Finalize(ctx, callbacks);
  }

  /**
   * STEP 1: Initialize loading state
   */
  private async step1_InitializeLoadingState(): Promise<void> {
    // The corridor trace counts the seconds of this location load from here.
    corridorTrace.begin('location change');
    this.engineInit.loading.set(true);
    this.engineInit.tilesLoading.set(true);
    this.engineInit.osmLoading.set(true);
    this.heightUpdate.heightsLoading.set(true);
    this.locationMgmt.isApplyingLocation.set(true);
    this.heightUpdate.heightProgress.set(0);
    this.engineInit.resetLoadingSteps();
  }

  /**
   * STEP 2: Reset game state and configure engine for new location
   */
  private async step2_ResetAndConfigureEngine(
    input: LocationChangeInput,
    ctx: LocationChangeContext,
    callbacks: LocationChangeCallbacks
  ): Promise<void> {
    await this.engineInit.setStepCurrent('engine');
    this.engineInit.updateStepMeta('engine', 'Resetting game state...');

    // Stop running updates
    this.heightUpdate.stopHeightUpdates();
    this.routeAnimation.stopAnimation();
    this.introFlight.stop();

    // Reset game state (handles stopping spawns via waveManager.reset())
    ctx.gameState.reset();
    callbacks.appendDebugLog('Game state reset');
    callbacks.clearMapEntities();
    this.pathRoute.clearCache();
    callbacks.setSpawnPoints([]);

    // Update engine origin
    ctx.engine.setOrigin(input.hq.lat, input.hq.lon);

    // Update coordinates
    callbacks.setBaseCoords({ lat: input.hq.lat, lon: input.hq.lon });
    callbacks.setCenterCoords({ lat: input.hq.lat, lon: input.hq.lon, height: 400 });

    // Update location service and URL, the bearing of the spawn's portal with it
    this.locationMgmt.setLocation(
      { lat: input.hq.lat, lon: input.hq.lon },
      [{ lat: input.spawn.lat, lon: input.spawn.lon, portalBearing: input.spawn.portalBearing }]
    );
    callbacks.syncUrlWithLocation();

    // Compute and apply optimal camera framing IMMEDIATELY (before tiles load)
    this.engineInit.updateStepMeta('engine', 'Positioning camera...');
    const hqCoord: GeoPoint = { lat: input.hq.lat, lon: input.hq.lon };
    const spawnCoords: GeoPoint[] = [{ lat: input.spawn.lat, lon: input.spawn.lon }];

    const camera = ctx.engine.getCamera();
    const initialFrame = this.cameraFraming.computeInitialFrame(hqCoord, spawnCoords, {
      padding: 0.1,
      angle: 70,
      markerRadius: 8,
      estimatedTerrainY: 0,
      aspectRatio: camera.aspect,
      fov: camera.fov,
    });
    this.cameraFraming.setEngine(ctx.engine);
    this.cameraFraming.applyFrame(initialFrame);

    await this.engineInit.setStepDone('engine');
  }

  /**
   * STEP 3: Load OSM street data (with cache check)
   */
  private async step3_LoadStreets(
    input: LocationChangeInput,
    ctx: LocationChangeContext,
    callbacks: LocationChangeCallbacks
  ): Promise<StreetNetwork> {
    await this.engineInit.setStepCurrent('streets');

    let streetNetwork: StreetNetwork;

    // Check if we can reuse cached street network
    if (!this.isSameStreetNetworkLocation(ctx, input.hq.lat, input.hq.lon)) {
      this.engineInit.updateStepMeta('streets', 'Loading OSM data...');
      streetNetwork = await this.osmService.loadStreets(input.hq.lat, input.hq.lon, 2000);
      callbacks.setStreetNetwork(streetNetwork);
      callbacks.setStreetNetworkLocation({ lat: input.hq.lat, lon: input.hq.lon });
    } else {
      this.engineInit.updateStepMeta('streets', 'Using cache...');
      streetNetwork = ctx.streetNetwork!;
    }

    callbacks.setStreetCount(streetNetwork.streets.length);
    this.engineInit.osmLoading.set(false);

    const streetCnt = streetNetwork.streets.length;
    await this.engineInit.setStepDone('streets', streetCnt > 0 ? `${streetCnt} Streets` : undefined);

    return streetNetwork;
  }

  /**
   * Wait for tiles to load with timeout fallback
   */
  private async waitForTilesWithTimeout(ctx: LocationChangeContext): Promise<void> {
    const tilesLoadedPromise = new Promise<void>((resolve) => {
      ctx.engine.setOnFirstTilesLoadedCallback(() => {
        this.engineInit.tilesLoading.set(false);
        resolve();
      });
    });

    let tilesLoaded = false;
    const timeoutId = setTimeout(() => {
      if (!tilesLoaded) {
        console.warn('[LocationCoordinator] Tiles loading timed out after 15s - continuing');
        this.engineInit.tilesLoading.set(false);
      }
    }, 15000);

    await Promise.race([
      tilesLoadedPromise.then(() => { tilesLoaded = true; }),
      new Promise<void>(resolve => setTimeout(resolve, 15000))
    ]);

    clearTimeout(timeoutId);
  }

  /**
   * STEP 4: Place HQ marker and initialize visualization services
   */
  private async step4_PlaceHQMarker(
    input: LocationChangeInput,
    ctx: LocationChangeContext,
    streetNetwork: StreetNetwork
  ): Promise<void> {
    await this.engineInit.setStepCurrent('hq');

    // Initialize visualization services (ORDER IS CRITICAL!)
    this.markerViz.initialize(
      ctx.engine,
      { lat: input.hq.lat, lon: input.hq.lon },
      ctx.heightDebugVisible
    );

    this.pathRoute.initialize(
      ctx.engine,
      streetNetwork,
      { lat: input.hq.lat, lon: input.hq.lon },
      this.uiStore.routesVisible,
      this.osmService,
      (spawnId, route, startGroundY) => this.markerViz.placeSpawnPortal(spawnId, route, startGroundY)
    );

    this.cameraControl.initialize(ctx.engine, { lat: input.hq.lat, lon: input.hq.lon });
    this.routeAnimation.initialize(ctx.engine);
    this.introFlight.initialize(ctx.engine);
    this.keyboardPan.initialize(ctx.engine);

    // Add HQ marker
    this.markerViz.addBaseMarker();

    await this.engineInit.setStepDone('hq');
  }

  /**
   * STEP 5: Place spawn point with marker and path
   */
  private async step5_PlaceSpawnPoint(
    input: LocationChangeInput,
    callbacks: LocationChangeCallbacks
  ): Promise<void> {
    await this.engineInit.setStepCurrent('spawns');

    // Add spawn point (component handles signal update and visualization)
    const spawnName = input.spawn.name?.split(',')[0] || 'Spawn';
    callbacks.addSpawnPoint(
      'spawn-1', spawnName, input.spawn.lat, input.spawn.lon, SPAWN_COLORS[0], input.spawn.portalBearing,
    );

    await this.engineInit.setStepDone('spawns', '1 point');
  }

  /**
   * STEP 6: Calculate routes and initialize GlobalRouteGrid
   */
  private async step6_CalculateRoutes(
    ctx: LocationChangeContext,
    callbacks: LocationChangeCallbacks
  ): Promise<void> {
    await this.engineInit.setStepCurrent('routes');
    this.engineInit.updateStepMeta('routes', 'A* Pathfinding...');

    const base = callbacks.getBaseCoords();
    const waveSpawnPoints: WaveSpawnPoint[] = callbacks.getSpawnPoints().map((sp) => ({
      id: sp.id,
      name: sp.name,
      lat: sp.lat,
      lon: sp.lon,
    }));

    ctx.gameState.initialize(
      ctx.engine,
      { lat: base.lat, lon: base.lon },
      waveSpawnPoints,
      this.pathRoute.getCachedPaths()
    );

    // Validate that routes were found
    const paths = this.pathRoute.getCachedPaths();
    if (paths.size === 0) {
      throw new Error('No route possible between HQ and spawn. The streets are not connected.');
    }

    // Initialize GlobalRouteGrid after routes are computed
    await this.engineInit.setStepCurrent('grid');
    this.engineInit.updateStepMeta('grid', 'Calculating grid...');
    ctx.gameState.initializeGlobalRouteGrid();
    // The overlays that are on (Route Grid, Air Route Grid, air route) went
    // with the old cells in STEP 2: draw them on the new cells now, as
    // CorridorController.rebuildCorridors does, not only at the next tile load.
    const routeGrid = ctx.gameState.getGlobalRouteGrid();
    routeGrid.initSpatialGridVisualizationIfEnabled();
    routeGrid.initAirSpatialGridVisualizationIfEnabled();
    routeGrid.initAirRouteLayerIfEnabled();
    await this.engineInit.setStepDone('grid');

    // Re-initialize TowerPlacementService with new location data
    callbacks.initializeTowerPlacement();

    // Filter street network to route corridor
    callbacks.filterStreetNetworkToRoutes();

    // Get route details for display
    const routeDetail = this.pathRoute.getRouteDetail();
    await this.engineInit.setStepDone('routes', routeDetail);
  }

  /**
   * STEP 7: Finalize - height updates, start animation
   */
  private async step7_Finalize(
    ctx: LocationChangeContext,
    callbacks: LocationChangeCallbacks
  ): Promise<void> {
    await this.engineInit.setStepCurrent('view');

    // CRITICAL: Must await height updates to complete
    await callbacks.scheduleOverlayHeightUpdate();

    callbacks.appendDebugLog(`Loaded: ${callbacks.getSpawnPoints().length} spawn points`);

    // Mark location change as complete
    this.locationMgmt.isApplyingLocation.set(false);

    // Start route animation
    if (!this.routeAnimation.isRunning()) {
      const cachedPaths = this.pathRoute.getCachedPaths();
      if (cachedPaths.size > 0) {
        this.routeAnimation.startAnimation(cachedPaths, callbacks.getSpawnPoints());
      }
    }

    // Spike: intro flight also runs on location change — it is a tile prewarm
    // for the new route corridor, not just an opening titles gag. Separate
    // guard, see the note in VisualizationFacadeService.checkAllLoaded().
    if (!this.introFlight.isRunning()) {
      const cachedPaths = this.pathRoute.getCachedPaths();
      if (cachedPaths.size > 0) {
        this.introFlight.start(cachedPaths);
      }
    }
  }

  /**
   * Check if the street network can be reused (same location)
   */
  private isSameStreetNetworkLocation(
    ctx: LocationChangeContext,
    lat: number,
    lon: number
  ): boolean {
    if (!ctx.streetNetworkLocation || !ctx.streetNetwork) {
      return false;
    }
    // Check if within ~100m (0.001 degrees)
    const THRESHOLD = 0.001;
    return (
      Math.abs(ctx.streetNetworkLocation.lat - lat) < THRESHOLD &&
      Math.abs(ctx.streetNetworkLocation.lon - lon) < THRESHOLD
    );
  }
}
