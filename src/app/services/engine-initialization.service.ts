import { Injectable, signal, WritableSignal } from '@angular/core';
import { ThreeTilesEngine } from '../three-engine';
import { GeoPosition } from '../models/game.types';

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
  // SIGNALS
  // ========================================

  /** Overall loading state */
  readonly loading = signal(true);

  /** Tiles loading state */
  readonly tilesLoading = signal(true);

  /** OSM streets loading state */
  readonly osmLoading = signal(true);

  /** Loading status text */
  readonly loadingStatus = signal('Initialisiere...');

  /** Error message (if any) */
  readonly error = signal<string | null>(null);

  /** Loading steps for detailed progress display */
  readonly loadingSteps = signal<LoadingStep[]>([
    { id: 'init', label: 'Initialisiere Engine', status: 'pending' },
    { id: 'streets', label: 'Lade Straßennetz', status: 'pending' },
    { id: 'hq', label: 'Platziere Hauptquartier', status: 'pending' },
    { id: 'spawn', label: 'Platziere Spawns', status: 'pending' },
    { id: 'route', label: 'Berechne Routen', status: 'pending' },
    { id: 'finalize', label: 'Finalisiere 3D-Ansicht', status: 'pending' },
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

  /** Google Maps API key */
  private apiKey: string | null = null;

  // ========================================
  // INITIALIZATION
  // ========================================

  /**
   * Initialize the service with configuration
   * @param canvas Canvas element for rendering
   * @param apiKey Google Maps API key
   * @param baseCoords Base/HQ coordinates for engine origin
   */
  configure(canvas: HTMLCanvasElement, apiKey: string, baseCoords: GeoPosition): void {
    this.canvas = canvas;
    this.apiKey = apiKey;
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
   * Reset all loading steps to 'pending' for a fresh start
   */
  resetLoadingSteps(): void {
    this.loadingSteps.set([
      { id: 'init', label: 'Initialisiere Engine', status: 'pending' },
      { id: 'streets', label: 'Lade Straßennetz', status: 'pending' },
      { id: 'hq', label: 'Platziere Hauptquartier', status: 'pending' },
      { id: 'spawn', label: 'Platziere Spawns', status: 'pending' },
      { id: 'route', label: 'Berechne Routen', status: 'pending' },
      { id: 'finalize', label: 'Finalisiere 3D-Ansicht', status: 'pending' },
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

      if (!this.canvas || !this.apiKey || !this.baseCoords) {
        this.error.set('Engine nicht konfiguriert. Bitte configure() zuerst aufrufen.');
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
      this.engine = new ThreeTilesEngine(
        this.canvas,
        this.apiKey,
        this.baseCoords.lat,
        this.baseCoords.lon,
        0
      );
      await this.setStepDone('init');

      // Initialize 3D Tiles (runs in background)
      await this.engine.initialize();
      this.engine.resize(rect.width, rect.height);

      // Register callback for first tiles loaded
      this.engine.setOnFirstTilesLoadedCallback(() => {
        this.tilesLoading.set(false);
        console.log('[EngineInit] First tiles loaded');
        callbacks.onCheckAllLoaded();
      });

      // Preload 3D models in background
      this.engine.preloadModels().then(() => {
        console.log('[EngineInit] All Three.js models preloaded');
      });

      // Setup click handler and build preview
      callbacks.onSetupClickHandler();
      callbacks.onCreateBuildPreview();

      // Start render loop immediately (tiles load progressively in background)
      this.engine.startRenderLoop();

      // Step 2: Load OSM streets
      await this.setStepActive('streets');
      const streetCnt = await callbacks.onLoadStreets();
      await this.setStepDone('streets', streetCnt > 0 ? `${streetCnt} Straßen` : undefined);

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
      await this.setStepDone('spawn', spawnCnt > 0 ? `${spawnCnt} Punkt${spawnCnt > 1 ? 'e' : ''}` : undefined);

      // Step 5: Calculate routes
      await this.setStepActive('route');
      const routeDetail = callbacks.onInitializeGameState();
      await this.setStepDone('route', routeDetail);

      // OSM loading done (streets + routes calculated)
      this.osmLoading.set(false);
      console.log('[EngineInit] OSM streets loaded');

      // Step 6: Finalize 3D view (waits for tiles + height sync)
      await this.setStepActive('finalize');
      await callbacks.onScheduleHeightUpdate();

      // Capture initial camera position after tiles stabilize (2 seconds)
      setTimeout(() => {
        callbacks.onSaveInitialCameraPosition();
      }, 2000);

      // Final check (heights should trigger hiding overlay)
      callbacks.onCheckAllLoaded();
    } catch (err) {
      console.error('[EngineInit] Engine init error:', err);
      this.error.set(err instanceof Error ? err.message : 'Fehler beim Laden der 3D-Karte');
      this.loading.set(false);
    }
  }

  // ========================================
  // LOADING STATE
  // ========================================

  /**
   * Check if all loading is complete (tiles + OSM + heights)
   * @param heightsLoading Heights loading signal
   */
  checkAllLoaded(heightsLoading: WritableSignal<boolean>): void {
    const tiles = this.tilesLoading();
    const osm = this.osmLoading();
    const heights = heightsLoading();

    console.log(`[EngineInit] Check: tiles=${tiles}, osm=${osm}, heights=${heights}`);

    if (!tiles && !osm && !heights) {
      this.loading.set(false);
      console.log('[EngineInit] ✓ All resources loaded - hiding overlay');
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
    this.engine = null;
    this.baseCoords = null;
    this.canvas = null;
    this.apiKey = null;
  }

  /**
   * Reset service state
   */
  reset(): void {
    this.loading.set(true);
    this.tilesLoading.set(true);
    this.osmLoading.set(true);
    this.loadingStatus.set('Initialisiere...');
    this.error.set(null);
    this.resetLoadingSteps();
  }
}
