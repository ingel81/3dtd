import { inject, Injectable, signal, WritableSignal } from '@angular/core';
import { ThreeTilesEngine } from '../three-engine';
import { GeoPosition } from '../models/game.types';
import { CameraFramingService, GeoPoint } from './camera-framing.service';

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

  private readonly cameraFraming = inject(CameraFramingService);

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

  /** Cesium Ion token */
  private cesiumToken: string | null = null;

  /** Cesium Ion asset ID */
  private cesiumAssetId: string | null = null;

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
    /** NEW: Get spawn coordinates BEFORE engine init for optimal initial framing */
    getSpawnCoordinates: () => GeoPoint[];
  }): Promise<void> {
    try {
      // Reset loading steps for fresh start
      this.resetLoadingSteps();

      if (!this.canvas || !this.cesiumToken || !this.cesiumAssetId || !this.baseCoords) {
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

      // Get spawn coordinates BEFORE engine init for optimal initial camera framing
      const spawnCoords = callbacks.getSpawnCoordinates();
      const hqCoord: GeoPoint = { lat: this.baseCoords.lat, lon: this.baseCoords.lon };

      // Compute initial camera frame using actual canvas aspect ratio
      const canvasAspect = rect.width / rect.height;
      let initialFrame = null;
      if (spawnCoords.length > 0) {
        initialFrame = this.cameraFraming.computeInitialFrame(hqCoord, spawnCoords, {
          padding: 0.1, // 10% margin around bounding box
          angle: 70,
          markerRadius: 8,
          estimatedTerrainY: 0, // Will be corrected after terrain loads
          aspectRatio: canvasAspect, // Use actual canvas aspect ratio
          fov: 60, // Must match THREE.PerspectiveCamera FOV in three-tiles-engine.ts!
        });
      }

      this.engine = new ThreeTilesEngine(
        this.canvas,
        this.cesiumToken,
        this.cesiumAssetId,
        this.baseCoords.lat,
        this.baseCoords.lon,
        0
      );

      // Set pre-computed camera position BEFORE initialize() for optimal initial view
      if (initialFrame) {
        this.engine.setInitialCameraPosition({
          x: initialFrame.camX,
          y: initialFrame.camY,
          z: initialFrame.camZ,
          lookAtX: initialFrame.lookAtX,
          lookAtY: initialFrame.lookAtY,
          lookAtZ: initialFrame.lookAtZ,
        });
      }

      await this.setStepDone('init');

      // Initialize 3D Tiles (camera position is now set optimally)
      await this.engine.initialize();
      this.engine.resize(rect.width, rect.height);

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

      // Step 6: Finalize 3D view (waits for tiles + height sync)
      await this.setStepActive('finalize');
      await callbacks.onScheduleHeightUpdate();

      // After tiles stabilize: correct camera Y based on actual terrain height
      // and save the corrected position as initial
      setTimeout(() => {
        // Set engine reference for terrain height queries
        this.cameraFraming.setEngine(this.engine);

        // Correct Y position based on actual terrain height
        if (initialFrame && this.engine) {
          const realTerrainY = this.engine.getTerrainHeightAtGeo(hqCoord.lat, hqCoord.lon) ?? 0;
          if (Math.abs(realTerrainY) > 1) {
            this.cameraFraming.correctTerrainHeight(realTerrainY, 0);
          }
        }

        // Save the corrected position
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

    if (!tiles && !osm && !heights) {
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
    this.loadingStatus.set('Initialisiere...');
    this.error.set(null);
    this.resetLoadingSteps();
  }
}
