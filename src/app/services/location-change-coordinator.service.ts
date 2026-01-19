import { Injectable, inject, WritableSignal } from '@angular/core';
import { ThreeTilesEngine } from '../three-engine';
import { GameStateManager } from '../managers/game-state.manager';
import { SpawnPoint as WaveSpawnPoint } from '../managers/wave.manager';
import { StreetNetwork, OsmStreetService } from './osm-street.service';
import { EngineInitializationService } from './engine-initialization.service';
import { HeightUpdateService } from './height-update.service';
import { MarkerVisualizationService, SpawnPoint } from './marker-visualization.service';
import { PathAndRouteService } from './path-route.service';
import { CameraControlService } from './camera-control.service';
import { CameraFramingService, GeoPoint } from './camera-framing.service';
import { RouteAnimationService } from './route-animation.service';
import { KeyboardPanService } from './keyboard-pan.service';
import { LocationManagementService } from './location-management.service';
import { GameUIStateService } from './game-ui-state.service';
import { LocationConfig } from '../models/location.types';
import { GeoPosition } from '../models/game.types';

/**
 * Input data for location change
 */
export interface LocationChangeInput {
  hq: LocationConfig;
  spawn: LocationConfig;
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
  addSpawnPoint(id: string, name: string, lat: number, lon: number, color: number): void;
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
 * LocationChangeCoordinatorService - Orchestrates location change sequence
 *
 * Extracted from TowerDefenseComponent.onApplyNewLocation() to reduce god object complexity.
 *
 * The 7 Steps:
 * 1. Initialize - Set loading flags, reset steps
 * 2. Reset - Stop updates, reset game state, update engine origin
 * 3. Load Streets - Load OSM data (with cache check)
 * 4. Place HQ - Initialize visualization services, add base marker
 * 5. Place Spawn - Add spawn point with marker and path
 * 6. Calculate Routes - Initialize game state, validate paths, setup grid
 * 7. Finalize - Height updates, save location, start animation
 */
@Injectable({ providedIn: 'root' })
export class LocationChangeCoordinatorService {
  private readonly engineInit = inject(EngineInitializationService);
  private readonly osmService = inject(OsmStreetService);
  private readonly heightUpdate = inject(HeightUpdateService);
  private readonly markerViz = inject(MarkerVisualizationService);
  private readonly pathRoute = inject(PathAndRouteService);
  private readonly cameraControl = inject(CameraControlService);
  private readonly cameraFraming = inject(CameraFramingService);
  private readonly routeAnimation = inject(RouteAnimationService);
  private readonly keyboardPan = inject(KeyboardPanService);
  private readonly locationMgmt = inject(LocationManagementService);
  private readonly uiState = inject(GameUIStateService);

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
    await this.step6_CalculateRoutes(ctx, streetNetwork, callbacks);

    // STEP 7: Finalize (heights, save, animation)
    await this.step7_Finalize(ctx, callbacks);
  }

  /**
   * STEP 1: Initialize loading state
   */
  private async step1_InitializeLoadingState(): Promise<void> {
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
    await this.engineInit.setStepActive('init');
    this.engineInit.updateStepDetail('init', 'Resetting game state...');

    // Stop running updates
    this.heightUpdate.stopHeightUpdates();
    this.routeAnimation.stopAnimation();

    // Reset game state (handles stopping spawns via waveManager.reset())
    ctx.gameState.reset();
    callbacks.appendDebugLog('Game state reset');
    callbacks.clearMapEntities();
    this.pathRoute.clearCache();
    callbacks.setSpawnPoints([]);

    // Update engine origin
    ctx.engine.setOrigin(input.hq.lat, input.hq.lon);
    ctx.engine.clearDebugHelpers();

    // Update coordinates
    callbacks.setBaseCoords({ lat: input.hq.lat, lon: input.hq.lon });
    callbacks.setCenterCoords({ lat: input.hq.lat, lon: input.hq.lon, height: 400 });

    // Update location service and URL
    this.locationMgmt.setLocation(
      { lat: input.hq.lat, lon: input.hq.lon },
      [{ lat: input.spawn.lat, lon: input.spawn.lon }]
    );
    callbacks.syncUrlWithLocation();

    // Compute and apply optimal camera framing IMMEDIATELY (before tiles load)
    this.engineInit.updateStepDetail('init', 'Positioning camera...');
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

    await this.engineInit.setStepDone('init');
  }

  /**
   * STEP 3: Load OSM street data (with cache check)
   */
  private async step3_LoadStreets(
    input: LocationChangeInput,
    ctx: LocationChangeContext,
    callbacks: LocationChangeCallbacks
  ): Promise<StreetNetwork> {
    await this.engineInit.setStepActive('streets');

    let streetNetwork: StreetNetwork;

    // Check if we can reuse cached street network
    if (!this.isSameStreetNetworkLocation(ctx, input.hq.lat, input.hq.lon)) {
      this.engineInit.updateStepDetail('streets', 'Loading OSM data...');
      streetNetwork = await this.osmService.loadStreets(input.hq.lat, input.hq.lon, 2000);
      callbacks.setStreetNetwork(streetNetwork);
      callbacks.setStreetNetworkLocation({ lat: input.hq.lat, lon: input.hq.lon });
    } else {
      this.engineInit.updateStepDetail('streets', 'Using cache...');
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
    await this.engineInit.setStepActive('hq');

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
      this.uiState.routesVisible,
      this.osmService,
      this.markerViz.getSpawnMarkers()
    );

    this.cameraControl.initialize(ctx.engine, { lat: input.hq.lat, lon: input.hq.lon });
    this.routeAnimation.initialize(ctx.engine);
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
    await this.engineInit.setStepActive('spawn');

    // Add spawn point (component handles signal update and visualization)
    const spawnName = input.spawn.name?.split(',')[0] || 'Spawn';
    callbacks.addSpawnPoint('spawn-1', spawnName, input.spawn.lat, input.spawn.lon, 0xef4444);

    await this.engineInit.setStepDone('spawn', '1 point');
  }

  /**
   * STEP 6: Calculate routes and initialize GlobalRouteGrid
   */
  private async step6_CalculateRoutes(
    ctx: LocationChangeContext,
    streetNetwork: StreetNetwork,
    callbacks: LocationChangeCallbacks
  ): Promise<void> {
    await this.engineInit.setStepActive('route');
    this.engineInit.updateStepDetail('route', 'A* Pathfinding...');

    const base = callbacks.getBaseCoords();
    const waveSpawnPoints: WaveSpawnPoint[] = callbacks.getSpawnPoints().map((sp) => ({
      id: sp.id,
      name: sp.name,
      lat: sp.lat,
      lon: sp.lon,
    }));

    ctx.gameState.initialize(
      ctx.engine,
      streetNetwork,
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
    await this.engineInit.setStepActive('grid');
    this.engineInit.updateStepDetail('grid', 'Calculating grid...');
    ctx.gameState.initializeGlobalRouteGrid();
    await this.engineInit.setStepDone('grid');

    // Re-initialize TowerPlacementService with new location data
    callbacks.initializeTowerPlacement();

    // Filter street network to route corridor
    callbacks.filterStreetNetworkToRoutes();

    // Get route details for display
    const routeDetail = this.pathRoute.getRouteDetail();
    await this.engineInit.setStepDone('route', routeDetail);
  }

  /**
   * STEP 7: Finalize - height updates, save location, start animation
   */
  private async step7_Finalize(
    ctx: LocationChangeContext,
    callbacks: LocationChangeCallbacks
  ): Promise<void> {
    await this.engineInit.setStepActive('finalize');

    // CRITICAL: Must await height updates to complete
    await callbacks.scheduleOverlayHeightUpdate();

    // Save to localStorage
    this.locationMgmt.saveLocationsToStorage();

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
