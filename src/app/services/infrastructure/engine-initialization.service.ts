import { inject, Injectable, NgZone, signal, WritableSignal } from '@angular/core';
import { ThreeTilesEngine } from '../../three-engine';
import { GeoPosition } from '../../models/game.types';
import { AssetManagerService } from './asset-manager.service';
import { STREET_RADIUS_M, StreetNetwork } from '../location/osm-street.service';
import { GLOBE_LINK } from '../world/globe-link';
import type { WorldProvider } from '../../world/world-provider';
import { BootStep } from '../../components/main-menu/loading/boot-step.model';

/**
 * The steps of the loading screen, in order. A first load and a location
 * change both run through them; `location`, `grid`, `corridor` and `flight`
 * are reported by other services.
 */
const BOOT_STEPS: readonly BootStep[] = [
  { id: 'location', title: 'Determining Location', status: 'pending' },
  { id: 'engine', title: 'Initializing Engine', status: 'pending' },
  { id: 'streets', title: 'Loading Street Network', status: 'pending' },
  { id: 'hq', title: 'Placing Headquarters', status: 'pending' },
  { id: 'spawns', title: 'Placing Spawns', status: 'pending' },
  { id: 'routes', title: 'Calculating Routes', status: 'pending' },
  { id: 'grid', title: 'Generating Route Grid', status: 'pending' },
  { id: 'view', title: 'Finalizing 3D View', status: 'pending' },
  { id: 'corridor', title: 'Measuring the Corridor', status: 'pending' },
  { id: 'flight', title: 'Preparing Intro Flight', status: 'pending' },
];

/**
 * EngineInitializationService
 *
 * Manages the initialization sequence for the Tower Defense game engine:
 * the loading steps (BOOT_STEPS) with detailed progress tracking.
 */
@Injectable({ providedIn: 'root' })
export class EngineInitializationService {
  // ========================================
  // INJECTED SERVICES
  // ========================================

  private readonly ngZone = inject(NgZone);
  private readonly assetManager = inject(AssetManagerService);
  private readonly globe = inject(GLOBE_LINK, { optional: true });

  // ========================================
  // SIGNALS
  // ========================================

  /** Overall loading state */
  readonly loading = signal(true);

  /** Tiles loading state */
  readonly tilesLoading = signal(true);

  /** OSM streets loading state */
  readonly osmLoading = signal(true);

  /** Error message (if any) */
  readonly error = signal<string | null>(null);

  /** Loading steps for detailed progress display */
  readonly loadingSteps = signal<BootStep[]>([...BOOT_STEPS]);

  /** performance.now() of the first tiles-loaded callback of this load, for the intro boot gate. */
  private firstTilesLoadedAt: number | null = null;

  // ========================================
  // STATE
  // ========================================

  /** Reference to the 3D engine */
  private engine: ThreeTilesEngine | null = null;

  /** Base coordinates for engine origin */
  private baseCoords: GeoPosition | null = null;

  /** Canvas element reference */
  private canvas: HTMLCanvasElement | null = null;

  /** The world the next engine draws (WorldContext.open), with its credentials and streets */
  private world: WorldProvider | null = null;

  // ========================================
  // INITIALIZATION
  // ========================================

  /**
   * Initialize the service with configuration
   * @param canvas Canvas element for rendering
   * @param baseCoords Base/HQ coordinates for engine origin
   * @param world The world the engine draws, made around `baseCoords`
   */
  configure(canvas: HTMLCanvasElement, baseCoords: GeoPosition, world: WorldProvider): void {
    this.canvas = canvas;
    this.baseCoords = baseCoords;
    this.world = world;
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
   * Set a loading step to 'current' status.
   * Any previously-current step that wasn't this one is rolled back to
   * 'pending' so only one step is ever 'current' at a time.
   * @param stepId Step identifier
   */
  async setStepCurrent(stepId: string): Promise<void> {
    loadMark(`${stepId}:start`);
    this.loadingSteps.update((steps) =>
      steps.map((s) => ({
        ...s,
        status: s.id === stepId ? ('current' as const) : s.status === 'current' ? ('pending' as const) : s.status,
      }))
    );
    await this.tick();
  }

  /**
   * Set a loading step to 'done' status with optional meta text
   * @param stepId Step identifier
   * @param meta Optional meta text (e.g., "5 Streets")
   */
  async setStepDone(stepId: string, meta?: string): Promise<void> {
    loadMark(`${stepId}:done`);
    this.loadingSteps.update((steps) => steps.map((s) => (s.id === stepId ? { ...s, status: 'done' as const, meta } : s)));
    await this.tick();
  }

  /**
   * Update the meta text for a step without changing its status.
   * Useful for showing live progress during a 'current' step.
   * @param stepId Step identifier
   * @param meta Meta text to display
   */
  updateStepMeta(stepId: string, meta: string): void {
    this.loadingSteps.update((steps) => steps.map((s) => (s.id === stepId ? { ...s, meta } : s)));
  }

  /**
   * Add World Dice step at the beginning and show loading overlay
   * Used when user clicks World Dice button
   */
  startWorldDiceLoading(): void {
    this.loading.set(true);
    this.loadingSteps.set([
      { id: 'dice-city', title: 'Rolling City', status: 'current', meta: 'Loading city pool...' },
    ]);
  }

  /**
   * Update World Dice loading step meta
   */
  updateWorldDiceDetail(meta: string): void {
    this.updateStepMeta('dice-city', meta);
  }

  /**
   * Reset all loading steps to 'pending' for a fresh start
   * Preserves 'location' step if already done (runs before initEngine)
   */
  resetLoadingSteps(): void {
    const [pendingLocation, ...rest] = BOOT_STEPS;
    const currentLocationStep = this.loadingSteps().find(s => s.id === 'location');
    const locationStep = currentLocationStep?.status === 'done' ? currentLocationStep : pendingLocation;

    this.loadingSteps.set([locationStep, ...rest]);
  }

  /** performance.now() of the first tiles-loaded callback of this load, null before. */
  getFirstTilesLoadedAt(): number | null {
    return this.firstTilesLoadedAt;
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
    onCheckAllLoaded: () => void;
  }): Promise<void> {
    try {
      // Reset loading steps for fresh start
      this.resetLoadingSteps();

      if (!this.canvas || !this.baseCoords || !this.world) {
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
      await this.setStepCurrent('engine');
      this.updateStepMeta('engine', 'Three.js Engine...');

      // Engine starts with default camera on HQ - final framing happens after routes are calculated
      this.engine = new ThreeTilesEngine(this.canvas, this.world, this.assetManager);
      // Behind the menu globe the game draws nothing, not even its first frame
      if (this.globe?.coversGame()) this.engine.setDrawSuppressed(true);

      this.updateStepMeta('engine', 'World...');

      // Put the world into the scene: tiles or terrain, camera controls
      await this.engine.initialize();
      this.engine.resize(rect.width, rect.height);

      await this.setStepDone('engine');

      // Register callback for first tiles loaded
      this.engine.setOnFirstTilesLoadedCallback(() => {
        this.firstTilesLoadedAt = performance.now();
        this.tilesLoading.set(false);
        callbacks.onCheckAllLoaded();
      });

      // Preload 3D models in background; a failure (a shader that does not compile,
      // a lost context) is said in the console instead of an unhandled rejection
      this.engine.preloadModels().catch((err: unknown) => console.error('[Engine] preloading the models failed', err));

      // Setup click handler
      callbacks.onSetupClickHandler();

      // Start render loop outside Angular zone to avoid triggering change detection on every frame
      const engine = this.engine;
      this.ngZone.runOutsideAngular(() => {
        engine.renderLoop.start();
      });

      // Step 2: Load OSM streets
      await this.setStepCurrent('streets');
      this.updateStepMeta('streets', 'Loading OSM data...');
      const streetCnt = await callbacks.onLoadStreets();
      await this.setStepDone('streets', streetCnt > 0 ? `${streetCnt} Streets` : undefined);

      // Initialize services that depend on engine and street network
      // Must be called before adding markers/spawns
      callbacks.onInitializeServices();

      // Step 3: Place HQ marker
      await this.setStepCurrent('hq');
      callbacks.onAddBaseMarker();
      await this.setStepDone('hq');

      // Step 4: Place spawn points
      await this.setStepCurrent('spawns');
      const spawnCnt = callbacks.onAddPredefinedSpawns();
      await this.setStepDone('spawns', spawnCnt > 0 ? `${spawnCnt} Point${spawnCnt > 1 ? 's' : ''}` : undefined);

      // Step 5: Calculate routes
      await this.setStepCurrent('routes');
      this.updateStepMeta('routes', 'A* Pathfinding...');
      const routeDetail = callbacks.onInitializeGameState();
      await this.setStepDone('routes', routeDetail);

      // OSM loading done (streets + routes calculated)
      this.osmLoading.set(false);

      // Step 6: Finalize 3D view. The height update marks this step done
      // itself, with its meta; then the corridor is built under its own
      // step, and the overview framed on the frozen cells
      // (VisualizationFacadeService.scheduleOverlayHeightUpdate).
      await this.setStepCurrent('view');
      await callbacks.onScheduleHeightUpdate();

      // Final check (heights should trigger hiding overlay)
      callbacks.onCheckAllLoaded();
    } catch (err) {
      console.error('[EngineInit] Engine init error:', err);
      this.error.set(err instanceof Error ? err.message : 'Error loading 3D map');
      this.loading.set(false);
    }
  }

  // ========================================
  // STREET LOADING
  // ========================================

  /**
   * Begin the street load of loadStreets() now, before the engine is built
   * and the tiles stream, so both load side by side (TODO H13);
   * loadStreets() with the same place takes it. A world whose streets come
   * with its ground (DevWorld) has nothing to begin.
   */
  prefetchStreets(world: WorldProvider, centerLat: number, centerLon: number): void {
    world.streets.prefetchStreets(centerLat, centerLon, STREET_RADIUS_M);
  }

  /**
   * Load the street network of the engine's world around the given centre:
   * OSM on the tiles, the generated streets in DevWorld.
   * @returns the network and its street count; `failed` when it did not load
   */
  async loadStreets(
    centerLat: number,
    centerLon: number,
  ): Promise<{ network: StreetNetwork; count: number; failed: boolean }> {
    try {
      const world = this.engine?.world ?? this.world;
      if (!world) throw new Error('No world to load streets from');
      const network = await world.streets.loadStreets(centerLat, centerLon, STREET_RADIUS_M);
      return { network, count: network.streets.length, failed: false };
    } catch (err) {
      console.error('[EngineInit] Failed to load streets:', err);
      const emptyNetwork: StreetNetwork = {
        streets: [],
        nodes: new Map(),
        bounds: { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 },
      };
      // The map loads without streets; `failed` lets the caller say so
      return { network: emptyNetwork, count: 0, failed: true };
    }
  }

  // ========================================
  // LOADING STATE
  // ========================================

  /**
   * End loading once tiles, OSM and heights are all done.
   * @param heightsLoading Heights loading signal
   */
  checkAllLoaded(heightsLoading: WritableSignal<boolean>): void {
    if (!this.tilesLoading() && !this.osmLoading() && !heightsLoading()) {
      if (this.loading()) loadMark('ready');
      this.loading.set(false);
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
    this.engine = null;
    this.baseCoords = null;
    this.canvas = null;
    this.world = null;
  }

  /**
   * Reset service state
   */
  reset(): void {
    this.loading.set(true);
    this.tilesLoading.set(true);
    this.osmLoading.set(true);
    this.error.set(null);
    this.resetLoadingSteps();
  }
}

/**
 * A performance mark `load:<name>` per loading step, read by load
 * measurements (e2e/perf/map-load.ts) in production builds as well
 */
function loadMark(name: string): void {
  if (typeof performance !== 'undefined' && typeof performance.mark === 'function') performance.mark(`load:${name}`);
}
