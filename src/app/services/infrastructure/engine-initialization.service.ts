import { inject, Injectable, NgZone, signal, WritableSignal } from '@angular/core';
import { ThreeTilesEngine } from '../../three-engine';
import { readVfxSettings } from '../../three-engine/vfx-settings';
import { settleContexts } from '../../three-engine/context-release';
import { loadDisplayOptions } from '../../utils/display-options.storage';
import { GeoPosition } from '../../models/game.types';
import { AssetManagerService } from './asset-manager.service';
import { RenderQualityService, qualityWorldOf } from './render-quality.service';
import { RendererHostService } from './renderer-host.service';
import { STREET_RADIUS_M, StreetNetwork } from '../location/osm-street.service';
import { GLOBE_LINK } from '../world/globe-link';
import type { WorldProvider } from '../../world/world-provider';
import { isOverpassCancelled } from '../../world/osm/overpass-client';
import { afterNextPaint } from '../../three-engine/tiles-lod-debug';
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
  { id: 'shaders', title: 'Compiling Shaders', status: 'pending' },
  { id: 'flight', title: 'Preparing Intro Flight', status: 'pending' },
];

/** How often the loading screen reads the count of programs compiled while it waits for them, ms */
const COMPILE_POLL_MS = 250;

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
  private readonly quality = inject(RenderQualityService);
  private readonly rendererHost = inject(RendererHostService);
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

  /** Models loaded and every program the game can draw built (ThreeTilesEngine.preloadModels) */
  readonly warmupLoading = signal(true);

  /** Error message (if any) */
  readonly error = signal<string | null>(null);

  /** Loading steps for detailed progress display */
  readonly loadingSteps = signal<BootStep[]>([...BOOT_STEPS]);

  /** performance.now() of the first tiles-loaded callback of this load, for the intro boot gate. */
  private firstTilesLoadedAt: number | null = null;
  /** The next read of the programs compiled ahead (compilingAhead), and who asks whether loading is done then */
  private compilePoll: ReturnType<typeof setTimeout> | null = null;
  private recheck: (() => void) | null = null;

  // ========================================
  // STATE
  // ========================================

  /** Reference to the 3D engine */
  private engine: ThreeTilesEngine | null = null;
  /** The engine a load is building, until the load hands it over (abandon frees it) */
  private building: ThreeTilesEngine | null = null;
  /** Counts the loads given up (abandon): a load of an earlier count stops at its next step */
  private run = 0;

  /** Base coordinates for engine origin */
  private baseCoords: GeoPosition | null = null;

  /** Where the page's canvas goes for this world (configure) */
  private slot: HTMLElement | null = null;

  /** The world the next engine draws (WorldContext.open), with its credentials and streets */
  private world: WorldProvider | null = null;

  // ========================================
  // INITIALIZATION
  // ========================================

  /**
   * Initialize the service with configuration
   * @param slot Where the page's canvas goes (RendererHost), sized like the game's area
   * @param baseCoords Base/HQ coordinates for engine origin
   * @param world The world the engine draws, made around `baseCoords`
   */
  configure(slot: HTMLElement, baseCoords: GeoPosition, world: WorldProvider): void {
    this.slot = slot;
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
    const changed = this.changeSteps((s) => ({
      ...s,
      status: s.id === stepId ? ('current' as const) : s.status === 'current' ? ('pending' as const) : s.status,
    }));
    if (changed) loadMark(`${stepId}:start`);
    await this.tick(changed);
  }

  /**
   * Set a loading step to 'done' status with optional meta text
   * @param stepId Step identifier
   * @param meta Optional meta text (e.g., "5 Streets")
   */
  async setStepDone(stepId: string, meta?: string): Promise<void> {
    const changed = this.changeSteps((s) => (s.id === stepId ? { ...s, status: 'done' as const, meta } : s));
    if (changed) loadMark(`${stepId}:done`);
    await this.tick(changed);
  }

  /**
   * Whether programs compile ahead of the first frame (the engine's models,
   * a custom map's scene): the loading screen shows it under its own step
   * meanwhile, with the count of programs ready; once they are in the step
   * is done. Before a compile began the step waits.
   */
  compilingAhead(): boolean {
    const progress = this.engine?.compileProgress() ?? null;
    const step = this.loadingSteps().find((s) => s.id === 'shaders');
    if (progress) {
      if (step?.status !== 'current') void this.setStepCurrent('shaders');
      this.updateStepMeta('shaders', `${progress.ready} / ${progress.total}`);
      return true;
    }
    if (step?.status === 'current') void this.setStepDone('shaders', step.meta);
    return false;
  }

  /**
   * While the world loads, compilingAhead every COMPILE_POLL_MS: a compile
   * begins and ends without a call of its own (the map's after its assets,
   * the models' after the first ground), and once one ended loading is asked
   * about again (initEngine's onCheckAllLoaded)
   */
  private watchCompile(): void {
    if (this.compilePoll !== null) clearTimeout(this.compilePoll);
    const tick = (): void => {
      this.compilePoll = null;
      if (!this.loading() || !this.engine) return;
      const was = this.loadingSteps().find((s) => s.id === 'shaders')?.status === 'current';
      if (!this.compilingAhead() && was) this.recheck?.();
      this.compilePoll = setTimeout(tick, COMPILE_POLL_MS);
    };
    this.compilePoll = setTimeout(tick, COMPILE_POLL_MS);
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

  /** The steps changed by `change`; false when they stay as they were (nothing new to show) */
  private changeSteps(change: (step: BootStep) => BootStep): boolean {
    const before = this.loadingSteps();
    const after = before.map(change);
    if (after.every((s, k) => s.status === before[k].status && s.meta === before[k].meta)) return false;
    this.loadingSteps.set(after);
    return true;
  }

  /** A changed step shows before the load goes on: after the next painted frame, not after a fixed wait */
  private tick(changed: boolean): Promise<void> {
    return changed ? afterNextPaint() : Promise.resolve();
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
    // The load this call makes; a world taken down meanwhile (abandon) leaves it behind
    const run = this.run;
    const gone = () => run !== this.run;
    try {
      // Reset loading steps for fresh start
      this.resetLoadingSteps();

      if (!this.slot || !this.baseCoords || !this.world) {
        this.error.set('Engine not configured. Please call configure() first.');
        this.loading.set(false);
        return;
      }

      // Step 1: Initialize Engine
      await this.setStepCurrent('engine');
      this.updateStepMeta('engine', 'Three.js Engine...');

      // The page's renderer, its canvas in the game's place at its size: the context of the world before stays
      // (RendererHost). Its MSAA is fixed with the context; the rest of the quality level follows (attach)
      const rect = this.slot.getBoundingClientRect();
      const lease = this.rendererHost.acquire(this.slot, qualityWorldOf(this.world.ref));
      lease.renderer.domElement.width = rect.width;
      lease.renderer.domElement.height = rect.height;

      // Engine starts with default camera on HQ - final framing happens after routes are calculated
      try {
        this.engine = new ThreeTilesEngine(lease, this.world, this.assetManager);
      } catch (err) {
        lease.release();
        throw err;
      }
      // Not yet the game's (the facade takes it when this returns): abandon() frees it until then
      this.building = this.engine;
      // The game's sound files once the world stands (checkAllLoaded), or as a sound plays before
      this.engine.spatialAudio.holdLoads();
      this.watchCompile();
      this.quality.attach(this.engine, this.world.ref);
      // Behind the menu globe the game draws nothing, not even its first frame
      if (this.globe?.coversGame()) this.engine.setDrawSuppressed(true);
      // The stored bloom and grading before the world compiles its shaders: frames through the
      // post-processing need other programs (WorldAttachContext.drawsToTarget); the debug facade
      // applies all display options again once the game stands
      this.engine.applyVfxSettings(readVfxSettings(loadDisplayOptions()));

      this.updateStepMeta('engine', 'World...');

      // Put the world into the scene: tiles or terrain, camera controls
      await this.engine.initialize();
      if (gone()) return;
      this.engine.resize(rect.width, rect.height);

      await this.setStepDone('engine');
      if (gone()) return;

      this.recheck = callbacks.onCheckAllLoaded;
      // Register callback for first tiles loaded
      this.engine.setOnFirstTilesLoadedCallback(() => {
        this.firstTilesLoadedAt = performance.now();
        this.tilesLoading.set(false);
        callbacks.onCheckAllLoaded();
      });

      // Preload 3D models in background; a failure (a shader that does not compile,
      // a lost context) is said in the console instead of an unhandled rejection
      // The loading screen waits for it: a program built in a frame holds the picture for seconds
      this.engine
        .preloadModels()
        .catch((err: unknown) => console.error('[Engine] preloading the models failed', err))
        .finally(() => {
          if (gone()) return;
          this.warmupLoading.set(false);
          callbacks.onCheckAllLoaded();
        });

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
      if (gone()) return;
      await this.setStepDone('streets', streetCnt > 0 ? `${streetCnt} Streets` : undefined);
      if (gone()) return;

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
      if (gone()) return;

      // Final check (heights should trigger hiding overlay)
      callbacks.onCheckAllLoaded();
    } catch (err) {
      // A load left behind fails in the half taken down: no word of it on the next world
      if (gone()) return;
      console.error('[EngineInit] Engine init error:', err);
      this.error.set(err instanceof Error ? err.message : 'Error loading 3D map');
      this.loading.set(false);
    } finally {
      if (!gone()) this.building = null;
    }
  }

  /**
   * The world goes (its game is taken down, TowerDefenseFacadeService.dispose):
   * a load still under way is left behind and writes nothing more, and an
   * engine it was still building is freed here, the facade never got it
   * (docs/WORLDS_NAVIGATION_PLAN.md, 4.4: Esc cancels a load).
   */
  abandon(): void {
    this.run++;
    if (this.engine) this.quality.detach(this.engine);
    const building = this.building;
    this.building = null;
    building?.dispose();
    this.engine = null;
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
   * @returns the network and its street count; `failed` when it did not
   *   load, `cancelled` when its load was ended (the world went, a place was
   *   chosen instead: WorldStreetSource.cancelLoads), which is nobody's failure
   */
  async loadStreets(
    centerLat: number,
    centerLon: number,
  ): Promise<{ network: StreetNetwork; count: number; failed: boolean; cancelled: boolean }> {
    try {
      const world = this.engine?.world ?? this.world;
      if (!world) throw new Error('No world to load streets from');
      const network = await world.streets.loadStreets(centerLat, centerLon, STREET_RADIUS_M);
      return { network, count: network.streets.length, failed: false, cancelled: false };
    } catch (err) {
      const cancelled = isOverpassCancelled(err);
      if (!cancelled) console.error('[EngineInit] Failed to load streets:', err);
      const emptyNetwork: StreetNetwork = {
        streets: [],
        nodes: new Map(),
        bounds: { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 },
      };
      // The map loads without streets; `failed` lets the caller say so
      return { network: emptyNetwork, count: 0, failed: !cancelled, cancelled };
    }
  }

  // ========================================
  // LOADING STATE
  // ========================================

  /**
   * End loading once tiles, OSM, the warm-up and heights are all done.
   * @param heightsLoading Heights loading signal
   */
  checkAllLoaded(heightsLoading: WritableSignal<boolean>): void {
    if (!this.tilesLoading() && !this.osmLoading() && !this.warmupLoading() && !heightsLoading()) {
      if (this.loading()) {
        loadMark('ready');
        // A compile too short for a look of the poll: its step is done all the same
        if (this.loadingSteps().find((s) => s.id === 'shaders')?.status !== 'done') void this.setStepDone('shaders');
        this.engine?.spatialAudio.releaseLoads();
        if (this.engine) this.quality.worldStood(this.engine);
        // The world stands: the context of the view before it (the editor, the world before) goes now
        settleContexts();
      }
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
    this.run++;
    if (this.compilePoll !== null) clearTimeout(this.compilePoll);
    this.compilePoll = null;
    this.recheck = null;
    if (this.engine) this.quality.detach(this.engine);
    this.engine = null;
    this.baseCoords = null;
    this.slot = null;
    this.world = null;
  }

  /**
   * Reset service state
   */
  reset(): void {
    if (this.compilePoll !== null) clearTimeout(this.compilePoll);
    this.compilePoll = null;
    this.loading.set(true);
    this.tilesLoading.set(true);
    this.osmLoading.set(true);
    this.warmupLoading.set(true);
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
