import { Injectable, inject, signal, WritableSignal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { take } from 'rxjs';
import { ThreeTilesEngine } from '../three-engine';
import { GameStateManager } from '../managers/game-state.manager';
import { SPAWN_COLORS } from '../configs/map-constants.config';
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
import { UrlLocationService } from './url-location.service';
import { WorldDiceService } from './world-dice.service';
import { UIStore } from '../store/ui.store';
import { LocationDialogComponent } from '../components/location-dialog/location-dialog.component';
import { LocationConfig, LocationDialogData, LocationDialogResult, FavoriteLocation } from '../models/location.types';
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
 * Delegate interface for component-specific state the coordinator needs
 * for location flow methods (dialog, favorites, etc.)
 */
export interface LocationFlowDelegate {
  /** Build the LocationChangeContext from current component state */
  getChangeContext(): LocationChangeContext | null;
  /** Build the LocationChangeCallbacks from component methods */
  getChangeCallbacks(): LocationChangeCallbacks;
  /** Whether a game is in progress (for dialog warning) */
  isGameInProgress(): boolean;
  /** Get the current location display name */
  getCurrentLocationName(): string;
}

/**
 * LocationChangeCoordinatorService - Orchestrates location change sequence
 *
 * Extracted from TowerDefenseComponent to reduce god object complexity.
 * Handles both the 7-step location change AND the location flow UI
 * (dialog, world dice, favorites, share).
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
  private readonly dialog = inject(MatDialog);
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
  private readonly urlLocation = inject(UrlLocationService);
  private readonly worldDice = inject(WorldDiceService);
  private readonly uiStore = inject(UIStore);

  /** Favorite display names (resolved via geocoding) */
  readonly favoriteNamesMap = signal<Record<string, string>>({});

  /** Delegate for component-specific state access */
  private delegate: LocationFlowDelegate | null = null;

  // ==================== Initialization ====================

  /**
   * Register the component delegate for location flow operations.
   * Must be called before using dialog/favorites/worldDice methods.
   */
  initializeFlow(delegate: LocationFlowDelegate): void {
    this.delegate = delegate;
    this.resolveFavoriteNames();
  }

  // ==================== Location Flow Methods ====================

  /**
   * Open location dialog to change HQ and spawn point
   */
  openLocationDialog(): void {
    if (!this.delegate) {
      console.error('[LocationCoordinator] No delegate registered');
      return;
    }

    const hq = this.locationMgmt.editableHqLocation();
    const spawn = this.locationMgmt.editableSpawnLocations()[0];

    const dialogData: LocationDialogData = {
      currentLocation: hq
        ? {
            lat: hq.lat,
            lon: hq.lon,
            name: this.delegate.getCurrentLocationName(),
            displayName: hq.name || '',
          }
        : null,
      currentSpawn: spawn
        ? {
            id: spawn.id,
            lat: spawn.lat,
            lon: spawn.lon,
            name: spawn.name,
          }
        : null,
      isGameInProgress: this.delegate.isGameInProgress(),
    };

    const dialogRef = this.dialog.open(LocationDialogComponent, {
      data: dialogData,
      panelClass: 'td-dialog-panel',
      disableClose: false,
    });

    dialogRef.afterClosed()
      .pipe(take(1))
      .subscribe(async (result: LocationDialogResult | null) => {
      if (!result?.confirmed) return;

      // Show loading overlay IMMEDIATELY before any async operations
      this.engineInit.loading.set(true);
      this.engineInit.resetLoadingSteps();

      let spawnLat = result.spawn.lat;
      let spawnLon = result.spawn.lon;
      let spawnName = result.spawn.name;

      // Generate random spawn if requested
      if (result.spawn.isRandom) {
        // Load streets for the new location to find spawn
        const newNetwork = await this.osmService.loadStreets(result.hq.lat, result.hq.lon, 2000);

        // Store for reuse in executeLocationChange to avoid double-loading
        const callbacks = this.delegate!.getChangeCallbacks();
        callbacks.setStreetNetwork(newNetwork);
        callbacks.setStreetNetworkLocation({ lat: result.hq.lat, lon: result.hq.lon });

        const randomSpawn = this.osmService.findRandomStreetPoint(newNetwork, result.hq.lat, result.hq.lon, 500, 1000);

        if (randomSpawn) {
          spawnLat = randomSpawn.lat;
          spawnLon = randomSpawn.lon;
          spawnName = randomSpawn.streetName || 'Random Spawn';
          callbacks.appendDebugLog(`Random spawn: ${Math.round(randomSpawn.distance)}m away`);
        } else {
          callbacks.appendDebugLog('No valid spawn found, using fallback');
          // Fallback: use a point 700m north
          spawnLat = result.hq.lat + 0.0063; // ~700m north
          spawnLon = result.hq.lon;
          spawnName = 'Fallback Spawn';
        }
      }

      // Apply the new location
      await this.applyNewLocation({
        hq: {
          lat: result.hq.lat,
          lon: result.hq.lon,
          name: result.hq.displayName,
          address: result.hq.address,
        },
        spawn: {
          lat: spawnLat,
          lon: spawnLon,
          name: spawnName,
        },
      });
    });
  }

  /**
   * Copy shareable URL to clipboard (URL already reflects current location)
   */
  onShareLocation(): void {
    const url = this.urlLocation.getShareUrl();
    navigator.clipboard.writeText(url);
    this.delegate?.getChangeCallbacks().appendDebugLog('Link copied: ' + url);
  }

  /**
   * Roll for a random city from Wikidata and navigate there
   */
  async onWorldDice(): Promise<void> {
    const callbacks = this.delegate?.getChangeCallbacks();
    callbacks?.appendDebugLog('World Dice: Rolling random city...');

    // Show loading overlay with World Dice step
    this.engineInit.startWorldDiceLoading();

    // Connect step detail callback
    this.worldDice.onStepDetail = (detail: string) => {
      this.engineInit.updateWorldDiceDetail(detail);
    };

    const city = await this.worldDice.rollRandomCity();

    // Cleanup callback
    this.worldDice.onStepDetail = null;

    if (!city) {
      callbacks?.appendDebugLog('World Dice: Failed - ' + (this.worldDice.error() || 'Unknown error'));
      // Hide loading overlay on error
      this.engineInit.setLoading(false);
      return;
    }

    const displayName = city.country ? `${city.name}, ${city.country}` : city.name;
    callbacks?.appendDebugLog(`World Dice: ${displayName} (${city.lat.toFixed(4)}, ${city.lon.toFixed(4)})`);

    // Show "Loading Map..." step before reload
    this.engineInit.finishWorldDiceLoading(displayName);

    // Update URL with only HQ (l=), no spawn (s=) -> randomizer will create spawn
    const url = new URL(window.location.href);
    url.searchParams.set('l', `${city.lat.toFixed(5)},${city.lon.toFixed(5)}`);
    url.searchParams.delete('s'); // Remove spawn so randomizer kicks in

    // Small delay so user sees the "Loading Map..." step
    await new Promise(resolve => setTimeout(resolve, 300));

    // Navigate to new location (full reload for clean state)
    window.location.href = url.toString();
  }

  /**
   * Save current location as favorite
   */
  onAddFavorite(): void {
    this.locationMgmt.saveFavorite();
    this.resolveFavoriteNames(); // Refresh names
    this.delegate?.getChangeCallbacks().appendDebugLog('Favorite saved');
  }

  /**
   * Apply a favorite location
   */
  async onSelectFavorite(fav: FavoriteLocation): Promise<void> {
    const spawn = fav.spawns[0] || { lat: fav.hq.lat + 0.005, lon: fav.hq.lon };

    // Update service and URL
    this.locationMgmt.setLocation(fav.hq, fav.spawns);
    this.delegate?.getChangeCallbacks().syncUrlWithLocation();

    // Apply to game
    await this.applyNewLocation({
      hq: { lat: fav.hq.lat, lon: fav.hq.lon, name: 'Loading...' },
      spawn: { lat: spawn.lat, lon: spawn.lon, name: 'Spawn' },
    });
  }

  /**
   * Delete a favorite
   */
  onDeleteFavorite(id: string): void {
    this.locationMgmt.deleteFavorite(id);
    this.favoriteNamesMap.update(m => {
      const copy = { ...m };
      delete copy[id];
      return copy;
    });
    this.delegate?.getChangeCallbacks().appendDebugLog('Favorite deleted');
  }

  /**
   * Resolve display names for all favorites
   */
  async resolveFavoriteNames(): Promise<void> {
    const favs = this.locationMgmt.favorites();
    const names: Record<string, string> = {};

    for (const fav of favs) {
      names[fav.id] = await this.locationMgmt.getFavoriteDisplayName(fav);
    }

    this.favoriteNamesMap.set(names);
  }

  // ==================== Core Location Change ====================

  /**
   * Apply new location - builds context from delegate and executes change
   */
  async applyNewLocation(data: { hq: LocationConfig; spawn: LocationConfig }): Promise<void> {
    if (!this.delegate) {
      console.error('[LocationCoordinator] No delegate registered');
      return;
    }

    const ctx = this.delegate.getChangeContext();
    if (!ctx) {
      console.error('[LocationCoordinator] No engine available');
      return;
    }

    const callbacks = this.delegate.getChangeCallbacks();
    const input: LocationChangeInput = { hq: data.hq, spawn: data.spawn };

    try {
      await this.executeLocationChange(input, ctx, callbacks);
    } catch (err) {
      console.error('[Location] Failed to apply location:', err);
      callbacks.appendDebugLog(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
      this.engineInit.setError(err instanceof Error ? err.message : 'Error changing location');

      // Reset loading flags on error
      this.engineInit.tilesLoading.set(false);
      this.engineInit.osmLoading.set(false);
      this.heightUpdate.heightsLoading.set(false);
      this.locationMgmt.isApplyingLocation.set(false);
    }
  }

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
      this.uiStore.routesVisible,
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
    callbacks.addSpawnPoint('spawn-1', spawnName, input.spawn.lat, input.spawn.lon, SPAWN_COLORS[0]);

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
