import { inject, Injectable, NgZone, signal, WritableSignal } from '@angular/core';
import { ThreeTilesEngine } from '../three-engine';
import { GeoPosition } from '../models/game.types';
import { CameraFramingService } from './camera-framing.service';
import { AssetManagerService } from './asset-manager.service';
import { OsmStreetService, StreetNetwork } from './osm-street.service';
import { DevWorldService } from '../devworld/devworld.service';
import { DevStreetProvider } from '../devworld/dev-street.provider';

/**
 * Loading step status
 */
export type LoadingStepStatus = 'pending' | 'active' | 'done';

/**
 * Loading step definition
 */
export interface LoadingStep {
  id: string;
  label: string;
  status: LoadingStepStatus;
  detail?: string;
}

/**
 * EngineInitializationService
 *
 * Manages the initialization sequence for the Tower Defense game engine.
 * Orchestrates 6-step loading process with detailed progress tracking.
 */
@Injectable({ providedIn: 'root' })
export class EngineInitializationService {
  // ========================================
  // INJECTED SERVICES
  // ========================================

  private readonly ngZone = inject(NgZone);
  private readonly cameraFraming = inject(CameraFramingService);
  private readonly assetManager = inject(AssetManagerService);
  private readonly osmService = inject(OsmStreetService);
  private readonly devWorld = inject(DevWorldService);

  // ========================================
  // SIGNALS
  // ========================================

  /** Overall loading state */
  readonly loading = signal(true);

  /** Tiles loading state */
  readonly tilesLoading = signal(true);

  /** OSM streets loading state */
  readonly osmLoading = signal(true);

  /** Loading status text */
  readonly loadingStatus = signal('Initializing...');

  /** Error message (if any) */
  readonly error = signal<string | null>(null);

  /** Loading steps for detailed progress display */
  readonly loadingSteps = signal<LoadingStep[]>([
    { id: 'location', label: 'Determining Location', status: 'pending' },
    { id: 'init', label: 'Initializing Engine', status: 'pending' },
    { id: 'streets', label: 'Loading Street Network', status: 'pending' },
    { id: 'hq', label: 'Placing Headquarters', status: 'pending' },
    { id: 'spawn', label: 'Placing Spawns', status: 'pending' },
    { id: 'route', label: 'Calculating Routes', status: 'pending' },
    { id: 'grid', label: 'Generating Route Grid', status: 'pending' },
    { id: 'finalize', label: 'Finalizing 3D View', status: 'pending' },
    { id: 'tiles', label: 'Waiting for 3D Tiles', status: 'pending' },
  ]);

  // ========================================
  // STATE
  // ========================================

  /** Reference to the 3D engine */
  private engine: ThreeTilesEngine | null = null;

  /** Base coordinates for engine origin */
  private baseCoords: GeoPosition | null = null;

  /** Canvas element reference */
  private canvas: HTMLCanvasElement | null = null;

  /** Cesium Ion token */
  private cesiumToken: string | null = null;

  /** Cesium Ion asset ID */
  private cesiumAssetId: string | null = null;

  /** Tile stats polling interval ID */
  private tileStatsIntervalId: number | null = null;

  // ========================================
  // INITIALIZATION
  // ========================================

  /**
   * Initialize the service with configuration
   * @param canvas Canvas element for rendering
   * @param cesiumToken Cesium Ion access token
   * @param cesiumAssetId Cesium Ion asset ID
   * @param baseCoords Base/HQ coordinates for engine origin
   */
  configure(canvas: HTMLCanvasElement, cesiumToken: string, cesiumAssetId: string, baseCoords: GeoPosition): void {
    this.canvas = canvas;
    this.cesiumToken = cesiumToken;
    this.cesiumAssetId = cesiumAssetId;
    this.baseCoords = baseCoords;
  }

  /**
   * Get the initialized engine instance
   */
  getEngine(): ThreeTilesEngine | null {
    return this.engine;
  }

  /**
   * Set engine instance (if initialized externally)
   * @param engine ThreeTilesEngine instance
   */
  setEngine(engine: ThreeTilesEngine): void {
    this.engine = engine;
  }

  // ========================================
  // LOADING STEP MANAGEMENT
  // ========================================

  /**
   * Set a loading step to 'active' status and update loadingStatus text
   * @param stepId Step identifier
   */
  async setStepActive(stepId: string): Promise<void> {
    this.loadingSteps.update((steps) =>
      steps.map((s) => ({
        ...s,
        status: s.id === stepId ? ('active' as const) : s.status === 'active' ? ('pending' as const) : s.status,
      }))
    );
    const step = this.loadingSteps().find((s) => s.id === stepId);
    if (step) {
      this.loadingStatus.set(step.label + '...');
    }
    await this.tick();
  }

  /**
   * Set a loading step to 'done' status with optional detail
   * @param stepId Step identifier
   * @param detail Optional detail text (e.g., "5 Streets")
   */
  async setStepDone(stepId: string, detail?: string): Promise<void> {
    this.loadingSteps.update((steps) => steps.map((s) => (s.id === stepId ? { ...s, status: 'done' as const, detail } : s)));
    await this.tick();
  }

  /**
   * Update the detail text for a step without changing its status
   * Useful for showing live progress during an 'active' step
   * @param stepId Step identifier
   * @param detail Detail text to display
   */
  updateStepDetail(stepId: string, detail: string): void {
    this.loadingSteps.update((steps) => steps.map((s) => (s.id === stepId ? { ...s, detail } : s)));
  }

  /**
   * Add World Dice step at the beginning and show loading overlay
   * Used when user clicks World Dice button
   */
  startWorldDiceLoading(): void {
    this.loading.set(true);
    this.loadingStatus.set('Rolling random city...');
    this.loadingSteps.set([
      { id: 'dice-city', label: 'Rolling City', status: 'active', detail: 'Loading city pool...' },
    ]);
  }

  /**
   * Update World Dice loading step detail
   */
  updateWorldDiceDetail(detail: string): void {
    this.updateStepDetail('dice-city', detail);
  }

  /**
   * Mark World Dice step as done and show "Loading Map..." before reload
   */
  finishWorldDiceLoading(cityName: string): void {
    this.loadingSteps.update(steps => steps.map(s =>
      s.id === 'dice-city' ? { ...s, status: 'done' as const, detail: cityName } : s
    ));
    // Add "loading map" step that will be visible until page reloads
    this.loadingSteps.update(steps => [
      ...steps,
      { id: 'dice-reload', label: 'Loading Map', status: 'active' as const }
    ]);
    this.loadingStatus.set('Loading map...');
  }

  /**
   * Reset all loading steps to 'pending' for a fresh start
   * Preserves 'location' step if already done (runs before initEngine)
   */
  resetLoadingSteps(): void {
    const currentLocationStep = this.loadingSteps().find(s => s.id === 'location');
    const locationStep = currentLocationStep?.status === 'done'
      ? currentLocationStep
      : { id: 'location', label: 'Determining Location', status: 'pending' as const };

    this.loadingSteps.set([
      locationStep,
      { id: 'init', label: 'Initializing Engine', status: 'pending' },
      { id: 'streets', label: 'Loading Street Network', status: 'pending' },
      { id: 'hq', label: 'Placing Headquarters', status: 'pending' },
      { id: 'spawn', label: 'Placing Spawns', status: 'pending' },
      { id: 'route', label: 'Calculating Routes', status: 'pending' },
      { id: 'grid', label: 'Generating Route Grid', status: 'pending' },
      { id: 'finalize', label: 'Finalizing 3D View', status: 'pending' },
      { id: 'tiles', label: 'Waiting for 3D Tiles', status: 'pending' },
    ]);
  }

  /**
   * Allow Angular to update the UI between steps
   */
  private tick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 50));
  }

  // ========================================
  // ENGINE INITIALIZATION
  // ========================================

  /**
   * Initialize Three.js rendering engine
   * This is the main initialization sequence that orchestrates all steps
   * @param callbacks Callbacks for various initialization steps
   */
  async initEngine(callbacks: {
    onLoadStreets: () => Promise<number>;
    onInitializeServices: () => void;
    onAddBaseMarker: () => void;
    onAddPredefinedSpawns: () => number;
    onInitializeGameState: () => string | undefined;
    onScheduleHeightUpdate: () => Promise<void>;
    onSetupClickHandler: () => void;
    onCreateBuildPreview: () => void;
    onSaveInitialCameraPosition: () => void;
    onCheckAllLoaded: () => void;
  }): Promise<void> {
    try {
      // Reset loading steps for fresh start
      this.resetLoadingSteps();

      if (!this.canvas || !this.cesiumToken || !this.cesiumAssetId || !this.baseCoords) {
        this.error.set('Engine not configured. Please call configure() first.');
        this.loading.set(false);
        return;
      }

      // Set canvas size
      const container = this.canvas.parentElement!;
      const rect = container.getBoundingClientRect();
      this.canvas.width = rect.width;
      this.canvas.height = rect.height;

      // Step 1: Initialize Engine
      await this.setStepActive('init');
      this.updateStepDetail('init', 'Three.js Engine...');

      // Engine starts with default camera on HQ - final framing happens after routes are calculated
      this.engine = new ThreeTilesEngine(
        this.canvas,
        this.cesiumToken,
        this.cesiumAssetId,
        this.baseCoords.lat,
        this.baseCoords.lon,
        0,
        this.assetManager,
        this.devWorld
      );

      this.updateStepDetail('init', '3D-Tiles Renderer...');

      // Initialize 3D Tiles (camera position is now set optimally)
      await this.engine.initialize();
      this.engine.resize(rect.width, rect.height);

      await this.setStepDone('init');

      // Register callback for first tiles loaded
      this.engine.setOnFirstTilesLoadedCallback(() => {
        this.tilesLoading.set(false);
        callbacks.onCheckAllLoaded();
      });

      // Preload 3D models in background
      this.engine.preloadModels();

      // Setup click handler and build preview
      callbacks.onSetupClickHandler();
      callbacks.onCreateBuildPreview();

      // Start render loop outside Angular zone to avoid triggering change detection on every frame
      const engine = this.engine;
      this.ngZone.runOutsideAngular(() => {
        engine.startRenderLoop();
      });

      // Step 2: Load OSM streets
      await this.setStepActive('streets');
      this.updateStepDetail('streets', 'Loading OSM data...');
      const streetCnt = await callbacks.onLoadStreets();
      await this.setStepDone('streets', streetCnt > 0 ? `${streetCnt} Streets` : undefined);

      // Initialize services that depend on engine and street network
      // Must be called before adding markers/spawns
      callbacks.onInitializeServices();

      // Step 3: Place HQ marker
      await this.setStepActive('hq');
      callbacks.onAddBaseMarker();
      await this.setStepDone('hq');

      // Step 4: Place spawn points
      await this.setStepActive('spawn');
      const spawnCnt = callbacks.onAddPredefinedSpawns();
      await this.setStepDone('spawn', spawnCnt > 0 ? `${spawnCnt} Point${spawnCnt > 1 ? 's' : ''}` : undefined);

      // Step 5: Calculate routes
      await this.setStepActive('route');
      this.updateStepDetail('route', 'A* Pathfinding...');
      const routeDetail = callbacks.onInitializeGameState();
      await this.setStepDone('route', routeDetail);

      // OSM loading done (streets + routes calculated)
      this.osmLoading.set(false);

      // Step 6: Finalize 3D view (waits for tiles + height sync)
      // Camera correction and saveInitialCameraPosition are now handled by
      // HeightUpdateService callback (runs BEFORE overlay hides)
      await this.setStepActive('finalize');
      await callbacks.onScheduleHeightUpdate();
      await this.setStepDone('finalize');

      // Step 7: Wait for 3D tiles (if still loading)
      if (this.tilesLoading()) {
        await this.setStepActive('tiles');
      }

      // Final check (heights should trigger hiding overlay)
      callbacks.onCheckAllLoaded();
    } catch (err) {
      console.error('[EngineInit] Engine init error:', err);
      this.error.set(err instanceof Error ? err.message : 'Error loading 3D map');
      this.loading.set(false);
    }
  }

  // ========================================
  // TILE STATS POLLING
  // ========================================

  /**
   * Start polling tile stats to show loading progress in the tiles step.
   * Automatically manages polling lifecycle based on tilesLoading state.
   */
  startTileStatsPolling(): void {
    if (this.tileStatsIntervalId) return;

    this.tileStatsIntervalId = window.setInterval(() => {
      if (!this.engine) return;

      const stats = this.engine.getTileStats();
      const pending = stats.downloading + stats.parsing;
      const detail = pending > 0
        ? `${stats.visible} loaded, ${pending} pending`
        : `${stats.visible} tiles loaded`;
      this.updateStepDetail('tiles', detail);
    }, 500);
  }

  /**
   * Stop polling tile stats
   */
  stopTileStatsPolling(): void {
    if (this.tileStatsIntervalId) {
      clearInterval(this.tileStatsIntervalId);
      this.tileStatsIntervalId = null;
    }
  }

  // ========================================
  // STREET LOADING
  // ========================================

  /**
   * Load street network for the given center coordinates.
   * Handles both DevWorld (generated streets) and real-world (OSM) modes.
   *
   * @param centerLat Center latitude
   * @param centerLon Center longitude
   * @param onStreetNetworkRefreshed Callback when DevWorld streets are regenerated
   * @returns Object with streetNetwork, streetCount, and optional devStreetProvider
   */
  async loadStreets(
    centerLat: number,
    centerLon: number,
    onStreetNetworkRefreshed?: (network: StreetNetwork, count: number) => void,
  ): Promise<{ network: StreetNetwork; count: number; devStreetProvider: DevStreetProvider | null }> {
    try {
      // DevWorld mode: Use DevStreetProvider with generated streets from terrain
      if (this.devWorld.isActive) {
        const devStreetProvider = new DevStreetProvider(this.devWorld);

        // Get generated streets from terrain provider
        const devTerrainProvider = this.engine?.getDevTerrainProvider();

        if (devTerrainProvider) {
          // Set initial streets from terrain provider
          const segments = devTerrainProvider.getStreetSegments();
          const spawns = devTerrainProvider.getSpawnPoints();
          devStreetProvider.setGeneratedStreets(segments, spawns);

          // Set up refresh callback for live terrain regeneration
          devTerrainProvider.setStreetRefreshCallback((newSegments, newSpawns) => {
            devStreetProvider.setGeneratedStreets(newSegments, newSpawns);
            // Reload street network
            devStreetProvider.loadStreets(centerLat, centerLon, 500).then((network) => {
              onStreetNetworkRefreshed?.(network, network.streets.length);
            });
          });
        }

        const network = await devStreetProvider.loadStreets(centerLat, centerLon, 500);
        return { network, count: network.streets.length, devStreetProvider };
      }

      // Real world: Use OSM
      const network = await this.osmService.loadStreets(centerLat, centerLon, 2000);
      return { network, count: network.streets.length, devStreetProvider: null };
    } catch (err) {
      console.error('[EngineInit] Failed to load streets:', err);
      const emptyNetwork: StreetNetwork = {
        streets: [],
        nodes: new Map(),
        bounds: { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 },
      };
      return { network: emptyNetwork, count: 0, devStreetProvider: null };
    }
  }

  // ========================================
  // LOADING STATE
  // ========================================

  /**
   * Check if all loading is complete (tiles + OSM + heights)
   * Manages tile stats polling lifecycle automatically.
   * @param heightsLoading Heights loading signal
   */
  checkAllLoaded(heightsLoading: WritableSignal<boolean>): void {
    const now = performance.now();
    const tiles = this.tilesLoading();
    const osm = this.osmLoading();
    const heights = heightsLoading();


    // Manage tile stats polling lifecycle
    if (tiles && !this.tileStatsIntervalId && this.engine) {
      this.startTileStatsPolling();
    }
    if (!tiles && this.tileStatsIntervalId) {
      this.stopTileStatsPolling();
    }

    // If heights are done but tiles still loading, show the tiles step
    if (!heights && !osm && tiles) {
      void this.setStepActive('tiles');
    }

    if (!tiles && !osm && !heights) {
      // Mark tiles step as done before hiding
      void this.setStepDone('tiles');
      this.loading.set(false);
    } else {
      const waiting = [tiles && 'tiles', osm && 'osm', heights && 'heights'].filter(Boolean);
    }
  }

  /**
   * Set loading state
   * @param isLoading Loading state
   */
  setLoading(isLoading: boolean): void {
    this.loading.set(isLoading);
  }

  /**
   * Set tiles loading state
   * @param isLoading Loading state
   */
  setTilesLoading(isLoading: boolean): void {
    this.tilesLoading.set(isLoading);
  }

  /**
   * Set OSM loading state
   * @param isLoading Loading state
   */
  setOsmLoading(isLoading: boolean): void {
    this.osmLoading.set(isLoading);
  }

  /**
   * Set error message
   * @param errorMsg Error message
   */
  setError(errorMsg: string | null): void {
    this.error.set(errorMsg);
  }

  // ========================================
  // CLEANUP
  // ========================================

  /**
   * Dispose engine and cleanup
   */
  dispose(): void {
    this.stopTileStatsPolling();
    this.engine = null;
    this.baseCoords = null;
    this.canvas = null;
    this.cesiumToken = null;
    this.cesiumAssetId = null;
  }

  /**
   * Reset service state
   */
  reset(): void {
    this.loading.set(true);
    this.tilesLoading.set(true);
    this.osmLoading.set(true);
    this.loadingStatus.set('Initializing...');
    this.error.set(null);
    this.resetLoadingSteps();
  }
}
