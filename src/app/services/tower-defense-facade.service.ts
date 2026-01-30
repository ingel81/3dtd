import { Injectable, inject, Injector, NgZone, DestroyRef, Signal, WritableSignal, effect } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { SubscriptionBag } from '../game-engine/game-event-bus';
import { OsmStreetService, StreetNetwork } from '../services/osm-street.service';
import { GameUIStateService } from '../services/game-ui-state.service';
import { CameraControlService } from '../services/camera-control.service';
import { MarkerVisualizationService, SpawnPoint } from '../services/marker-visualization.service';
import { PathAndRouteService } from '../services/path-route.service';
import { InputHandlerService } from '../services/input-handler.service';
import { TowerPlacementService } from '../services/tower-placement.service';
import { LocationManagementService } from '../services/location-management.service';
import { HeightUpdateService } from '../services/height-update.service';
import { EngineInitializationService } from '../services/engine-initialization.service';
import { ConfigService } from '../core/services/config.service';
import { GeolocationService } from '../services/geolocation.service';
import { UrlLocationService } from '../services/url-location.service';
import { DevWorldService, DEV_WORLD_ORIGIN } from '../devworld/devworld.service';
import { DevStreetProvider } from '../devworld/dev-street.provider';
import { CameraFramingService, GeoPoint } from '../services/camera-framing.service';
import { RouteAnimationService } from '../services/route-animation.service';
import { KeyboardPanService } from '../services/keyboard-pan.service';
import { StreetRenderingService } from '../services/street-rendering.service';
import { StrategicPlacementService } from '../services/strategic-placement.service';
import { WaveDebugService } from '../services/wave-debug.service';
import { EnemyDebugService } from '../services/enemy-debug.service';
import { TowerDebugService } from '../services/tower-debug.service';
import { SoundDebugService } from '../services/sound-debug.service';
import { DebugFacadeService } from '../services/debug-facade.service';
import { DebugWindowService } from '../services/debug-window.service';
import { EntityPoolService } from '../services/entity-pool.service';
import { ModelPreviewService } from '../services/model-preview.service';
import { LocationChangeCoordinatorService, LocationFlowDelegate, LocationChangeCallbacks } from '../services/location-change-coordinator.service';
import { LocationDialogComponent } from '../components/location-dialog/location-dialog.component';
import { LocationDialogData, LocationDialogResult } from '../models/location.types';
import { GameStateManager } from '../managers/game-state.manager';
import { SpawnPoint as WaveSpawnPoint, WaveConfig } from '../managers/wave.manager';
import { WaveDirectorService } from '../ai/core/wave-director.service';
import { AIDataCollectorService } from '../ai/core/ai-data-collector.service';
import { TrainingClientService } from '../ai/training/training-client.service';
import { adaptAIWaveConfigSingle } from '../ai/core/wave-config-adapter';
import { DpsProfileVisualizer } from '../ai/core/dps-profile-visualizer';
import { ThreeTilesEngine } from '../three-engine';
import { Tower } from '../entities/tower.entity';
import { TowerTypeId, UpgradeId } from '../configs/tower-types.config';
import { Vector3 } from 'three';
import { DevTerrainProvider } from '../devworld/dev-terrain.provider';
import { SoundPoolStats } from '../managers/spatial-audio.manager';

/**
 * Context object passed from the component during initialization.
 * Contains component-owned state that the facade needs to read/write.
 */
export interface FacadeComponentBridge {
  /** Engine reference (component-owned, may be null early) */
  getEngine: () => ThreeTilesEngine | null;
  setEngine: (e: ThreeTilesEngine | null) => void;

  /** Street network state (component-owned) */
  getStreetNetwork: () => StreetNetwork | null;
  setStreetNetwork: (n: StreetNetwork | null) => void;
  getDevStreetProvider: () => DevStreetProvider | null;
  setDevStreetProvider: (p: DevStreetProvider | null) => void;
  getFilteredStreetNetwork: () => StreetNetwork | null;
  setFilteredStreetNetwork: (n: StreetNetwork | null) => void;
  getStreetNetworkLocation: () => { lat: number; lon: number } | null;
  setStreetNetworkLocation: (l: { lat: number; lon: number } | null) => void;

  /** Signals owned by the component */
  spawnPoints: WritableSignal<SpawnPoint[]>;
  baseCoords: WritableSignal<{ lat: number; lon: number }>;
  centerCoords: WritableSignal<{ lat: number; lon: number; height: number }>;
  isDevWorldRegenerating: WritableSignal<boolean>;
  useAIDirector: WritableSignal<boolean>;
  aiExplanation: WritableSignal<string | null>;
  cameraFramingDebug: WritableSignal<boolean>;
  debugLog: WritableSignal<string>;

  /** Read-only signals */
  waveActive: Signal<boolean>;
  isGameOver: Signal<boolean>;
  streetsVisible: Signal<boolean>;
  heightDebugVisible: WritableSignal<boolean>;

  /** Canvas element for input handler */
  getCanvasElement: () => HTMLCanvasElement;

  /** Callbacks that remain in the component */
  onTerrainClick: (lat: number, lon: number, height: number) => void;
  onMouseMove: (lat: number, lon: number, hitPoint: Vector3) => void;
  exitBuildMode: () => void;
  handleEnemyPlacement: (lat: number, lon: number, height: number) => void;
}

/**
 * Facade service that absorbs orchestration logic from TowerDefenseComponent.
 *
 * This service owns:
 * - Game state initialization and lifecycle (start wave, game over, restart)
 * - Visualization service initialization
 * - Input handler setup
 * - Camera management (save initial position, debug toggles)
 * - Street filtering for route corridors
 * - Height update scheduling
 * - DevWorld regeneration orchestration
 * - Spawn point management
 * - DPS visualization
 * - Tower upgrades
 */
@Injectable({ providedIn: 'root' })
export class TowerDefenseFacadeService {
  // Injected services
  private readonly osmService = inject(OsmStreetService);
  private readonly uiState = inject(GameUIStateService);
  private readonly cameraControl = inject(CameraControlService);
  private readonly markerViz = inject(MarkerVisualizationService);
  private readonly pathRoute = inject(PathAndRouteService);
  private readonly inputHandler = inject(InputHandlerService);
  private readonly towerPlacement = inject(TowerPlacementService);
  private readonly locationMgmt = inject(LocationManagementService);
  private readonly heightUpdate = inject(HeightUpdateService);
  private readonly engineInit = inject(EngineInitializationService);
  private readonly configService = inject(ConfigService);
  private readonly geolocation = inject(GeolocationService);
  private readonly urlLocation = inject(UrlLocationService);
  private readonly cameraFraming = inject(CameraFramingService);
  private readonly routeAnimation = inject(RouteAnimationService);
  private readonly keyboardPan = inject(KeyboardPanService);
  private readonly streetRendering = inject(StreetRenderingService);
  private readonly devWorld = inject(DevWorldService);
  private readonly waveDebug = inject(WaveDebugService);
  private readonly enemyDebug = inject(EnemyDebugService);
  private readonly towerDebug = inject(TowerDebugService);
  private readonly soundDebug = inject(SoundDebugService);
  private readonly debugFacade = inject(DebugFacadeService);
  private readonly debugWindows = inject(DebugWindowService);
  private readonly entityPool = inject(EntityPoolService);
  private readonly modelPreview = inject(ModelPreviewService);
  private readonly locationCoordinator = inject(LocationChangeCoordinatorService);
  private readonly strategicPlacement = inject(StrategicPlacementService);
  private readonly waveDirector = inject(WaveDirectorService);
  private readonly aiDataCollector = inject(AIDataCollectorService);
  private readonly trainingClient = inject(TrainingClientService);
  private readonly ngZone = inject(NgZone);
  private readonly dialog = inject(MatDialog);

  /** Component bridge - set via initialize(). Non-null after initEffects(). */
  private bridge!: FacadeComponentBridge;

  /** Game state manager — component-provided, set via initialize(). Non-null after initEffects(). */
  private gameState!: GameStateManager;

  /** Component injector — needed for effects and takeUntilDestroyed */
  private componentInjector!: Injector;

  /** Whether the facade has been initialized via initEffects() */
  private initialized = false;

  /** DPS profile visualization along path */
  private dpsProfileViz: DpsProfileVisualizer | null = null;
  private dpsVizUnsubscribes: (() => void)[] = [];

  /** EventBus subscription bag — cleaned up in dispose() */
  private readonly eventBusSubs = new SubscriptionBag();

  /** Flag to prevent concurrent AI wave requests */
  private pendingAIWaveRequest = false;

  /** Throttle: last UI stats update timestamp */
  private lastStatsUpdate = 0;
  /** Throttle interval for UI stats (ms) — ~10Hz */
  private static readonly STATS_THROTTLE_MS = 100;

  /**
   * Initialize the facade with component bridge, game state, and injector.
   */
  private initialize(bridge: FacadeComponentBridge, gameState: GameStateManager, injector: Injector): void {
    this.bridge = bridge;
    this.gameState = gameState;
    this.componentInjector = injector;
    this.initialized = true;
  }

  /**
   * Guard: check if facade is initialized.
   * Use at public entry points to prevent calls before initEffects().
   */
  private assertInitialized(): boolean {
    if (!this.initialized) {
      console.warn('[Facade] Not initialized — call initEffects() first');
      return false;
    }
    return true;
  }

  // ══════════════════════════════════════════════════════════════
  // Effects & Game Startup
  // ══════════════════════════════════════════════════════════════

  /**
   * Create Angular effects that were previously in the component constructor.
   * Called from the component constructor (injection context active).
   */
  initEffects(component: { getFacadeBridge: () => FacadeComponentBridge; gameState: GameStateManager; injector: Injector }): void {
    this.initialize(component.getFacadeBridge(), component.gameState, component.injector);

    const injector = this.componentInjector;

    // Effect: Update all existing enemies when speed changes
    effect(() => {
      const speed = this.waveDebug.enemySpeed();
      for (const enemy of this.gameState.enemyManager.getAll()) {
        enemy.movement.speedMps = speed;
      }
    }, { injector });

    // Effect: Sync wave debug state with game state
    effect(() => {
      const waveActive = this.bridge.waveActive();
      const baseHealth = this.gameState.baseHealth();
      const enemiesAlive = this.gameState.enemiesAlive();
      this.waveDebug.syncWaveState(waveActive, baseHealth, enemiesAlive);
    }, { injector });

    // Effect: Auto-enable AI Director when ONNX model loads successfully
    effect(() => {
      const state = this.waveDirector.modelState();
      if (state === 'ready' && !this.bridge.useAIDirector()) {
        this.bridge.useAIDirector.set(true);
        console.log('[AI] AI Director auto-enabled (model loaded)');
      }
    }, { injector });

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

    // Effect: Start paused debug enemies when wave starts
    effect(() => {
      const phase = this.gameState.phase();
      if (phase === 'wave') {
        for (const de of this.enemyDebug.debugEnemies()) {
          if (de.enemy.movement.paused && de.enemy.alive) {
            de.enemy.startMoving();
            this.bridge.getEngine()?.enemies.startWalkAnimation(de.id);
          }
        }
      }
    }, { injector });

    // Effect: Apply debug overrides to selected enemy (live update)
    effect(() => {
      const selected = this.enemyDebug.selectedDebugEnemy();
      const engine = this.bridge.getEngine();
      if (!selected || !engine) return;
      engine.enemies.applyDebugOverrides(selected.id, {
        scale: selected.overrides.scale,
        heightOffset: selected.overrides.heightOffset,
        healthBarOffset: selected.overrides.healthBarOffset,
        rotation: selected.overrides.rotation,
        animationSpeed: selected.overrides.animationSpeed,
      });
      selected.enemy.movement.speedMps = selected.overrides.baseSpeed;
    }, { injector });
  }

  /**
   * Main game startup sequence: location detection + engine initialization.
   * Called from ngAfterViewInit. Also handles former ngOnInit logic.
   */
  async startGame(canvas: HTMLCanvasElement): Promise<void> {
    if (!this.assertInitialized()) return;

    // --- Former ngOnInit logic ---
    this.locationCoordinator.initializeFlow(this.buildLocationFlowDelegate());

    this.trainingClient.initialize({
      gameState: this.gameState,
      towerPlacement: this.towerPlacement,
      strategicPlacement: this.strategicPlacement,
      osmService: this.osmService,
      callbacks: {
        startWave: () => this.startWave(this.gameState),
        upgradeTower: (tower: Tower, upgradeId: UpgradeId) => this.upgradeTower(tower, upgradeId, this.gameState),
        restartGame: () => this.restartGame(this.gameState),
      }
    });

    const params = new URLSearchParams(window.location.search);
    if (params.has('bot')) {
      const botMode = params.get('bot');
      if (botMode === 'auto') {
        this.trainingClient.botAutoMode.set(true);
        console.log('[Bot] Auto-mode enabled from URL parameter (will auto-start waves)');
      }
    }

    if (this.devWorld.isActive) {
      this.bridge.useAIDirector.set(true);
      console.log('[AI] AI Director enabled for DevWorld');
      this.trainingClient.connectToBackend();
    }

    // --- Location detection ---
    await this.initializeLocation();

    // --- Engine initialization ---
    await this.initEngineSequence(canvas);
  }

  /**
   * Full cleanup: dispose engine, pool, preview, animations, DPS viz, EventBus subs.
   * Called from component's ngOnDestroy.
   */
  dispose(): void {
    // Clean up EventBus subscriptions to prevent memory leaks
    this.eventBusSubs.disposeAll();

    this.entityPool.destroy();
    this.modelPreview.dispose();
    this.routeAnimation.dispose();

    if (this.initialized) {
      this.gameState.getGlobalRouteGrid().cleanupSpatialGridVisualization();

      const engine = this.bridge.getEngine();
      this.disposeDpsVisualization(engine);

      if (engine) {
        engine.dispose();
        this.bridge.setEngine(null);
        this.trainingClient.setEngine(null);
      }
    }

    // Reset state
    this.initialized = false;
    this.pendingAIWaveRequest = false;
    this.lastStatsUpdate = 0;
  }

  // ══════════════════════════════════════════════════════════════
  // Location Detection (moved from component)
  // ══════════════════════════════════════════════════════════════

  /**
   * Initialize location from URL or geolocation cascade.
   * Shows as first loading step: "Determining Location".
   */
  private async initializeLocation(): Promise<void> {
    await this.engineInit.setStepActive('location');

    // DevWorld mode: Use fake origin, skip real location
    if (this.devWorld.isActive) {
      console.log('[TowerDefense] DevWorld mode - using fake origin');
      this.locationMgmt.setLocation(
        { lat: DEV_WORLD_ORIGIN.lat, lon: DEV_WORLD_ORIGIN.lon },
        []
      );
      this.bridge.baseCoords.set({ lat: DEV_WORLD_ORIGIN.lat, lon: DEV_WORLD_ORIGIN.lon });
      this.bridge.centerCoords.set({ lat: DEV_WORLD_ORIGIN.lat, lon: DEV_WORLD_ORIGIN.lon, height: 400 });
      await this.engineInit.setStepDone('location', 'DevWorld');
      return;
    }

    // URL is source of truth
    const urlData = this.urlLocation.parseFromUrl();

    if (urlData) {
      this.locationMgmt.setLocation(urlData.hq, urlData.spawns);
      await this.engineInit.setStepDone('location', 'from URL');
    } else {
      // No URL params → try geolocation cascade
      this.geolocation.onStepDetail = (detail) => this.engineInit.updateStepDetail('location', detail);
      const detected = await this.geolocation.detectLocation();

      if (detected) {
        this.locationMgmt.setLocation(detected, []);
        const sourceLabel = detected.source === 'browser' ? 'Browser' : 'IP-based';
        await this.engineInit.setStepDone('location', sourceLabel);
      } else {
        this.engineInit.updateStepDetail('location', 'Select location...');
        await this.waitForLocationFromDialog();
        await this.engineInit.setStepDone('location', 'manually selected');
      }
    }

    // Sync URL with current location
    const hq = this.locationMgmt.hq();
    if (hq) {
      this.syncUrlWithLocation();
      this.bridge.baseCoords.set({ lat: hq.lat, lon: hq.lon });
      this.bridge.centerCoords.set({ lat: hq.lat, lon: hq.lon, height: 400 });
    }
  }

  /**
   * Open location dialog and wait for user to select a location.
   */
  private waitForLocationFromDialog(): Promise<void> {
    return new Promise((resolve) => {
      const dialogRef = this.dialog.open(LocationDialogComponent, {
        data: {
          currentLocation: null,
          currentSpawn: null,
          isGameInProgress: false,
        } as LocationDialogData,
        panelClass: 'td-dialog-panel',
        disableClose: true,
      });

      const destroyRef = this.componentInjector.get(DestroyRef);
      dialogRef.afterClosed()
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe((result: LocationDialogResult | null) => {
          if (result?.confirmed) {
            this.locationMgmt.setLocation(
              { lat: result.hq.lat, lon: result.hq.lon },
              result.spawn.isRandom ? [] : [{ lat: result.spawn.lat, lon: result.spawn.lon }]
            );
          }
          resolve();
        });
    });
  }

  /**
   * Sync URL with current location (without reload).
   * Skipped in DevWorld mode to preserve devworld URL parameters.
   */
  private syncUrlWithLocation(): void {
    if (this.devWorld.isActive) return;
    const hq = this.locationMgmt.hq();
    if (!hq) return;
    const spawns = this.locationMgmt.spawns();
    this.urlLocation.updateUrl(hq, spawns);
  }

  // ══════════════════════════════════════════════════════════════
  // Engine Initialization (moved from component)
  // ══════════════════════════════════════════════════════════════

  /**
   * Initialize Three.js rendering engine with full callback wiring.
   */
  private async initEngineSequence(canvas: HTMLCanvasElement): Promise<void> {
    if (!this.assertInitialized()) {
      this.engineInit.setError('Facade not initialized');
      this.engineInit.setLoading(false);
      return;
    }

    try {
      const cesiumToken = this.configService.cesiumIonToken();
      const cesiumAssetId = this.configService.cesiumAssetId();
      if (!cesiumToken) {
        this.engineInit.setError('Please configure your Cesium Ion Token in environment.ts.');
        this.engineInit.setLoading(false);
        return;
      }

      const base = this.bridge.baseCoords();
      this.engineInit.configure(canvas, cesiumToken, cesiumAssetId, { lat: base.lat, lon: base.lon });

      await this.engineInit.initEngine({
        onLoadStreets: () => this.loadStreetsInternal(),
        onInitializeServices: () => this.initializeVisualizationServices(),
        onAddBaseMarker: () => this.markerViz.addBaseMarker(),
        onAddPredefinedSpawns: () => this.addPredefinedSpawns(),
        onInitializeGameState: () => this.initializeGameStateInternal(),
        onScheduleHeightUpdate: () => this.scheduleOverlayHeightUpdate(this.gameState),
        onSetupClickHandler: () => this.setupClickHandlerWithGameState(this.gameState),
        onCreateBuildPreview: () => { /* no-op: TowerPlacementService handles this */ },
        onSaveInitialCameraPosition: () => this.saveInitialCameraPosition(),
        onCheckAllLoaded: () => this.checkAllLoaded(),
      });

      const engine = this.engineInit.getEngine();
      this.bridge.setEngine(engine);
      this.trainingClient.setEngine(engine);

      if (engine) {
        engine.setOnTilesLoadCallback(() => this.onTilesLoaded(this.gameState));
        engine.setOnUpdateCallback((deltaTime) => this.onEngineUpdate(deltaTime));

        const eventBus = this.gameState.getEventBus();
        engine.spatialAudio.setEventBus(eventBus);
        this.soundDebug.subscribeToEventBus(eventBus);

        this.debugFacade.setEngine(engine, this.gameState);
        this.debugFacade.applyDisplayOptions();
      }
    } catch (err) {
      console.error('[TD] Engine init error:', err);
      this.engineInit.setError(err instanceof Error ? err.message : 'Error loading 3D map');
      this.engineInit.setLoading(false);
    }
  }

  /**
   * Load street network wrapper (used as initEngine callback).
   */
  private async loadStreetsInternal(): Promise<number> {
    const center = this.bridge.centerCoords();
    const result = await this.engineInit.loadStreets(
      center.lat,
      center.lon,
      (network, count) => {
        this.bridge.setStreetNetwork(network);
        this.waveDebug.streetCount.set(count);
      },
    );
    this.bridge.setStreetNetwork(result.network);
    this.bridge.setDevStreetProvider(result.devStreetProvider);
    this.waveDebug.streetCount.set(result.count);
    return result.count;
  }

  /**
   * Initialize game state with routes AND subscribe to tower:selected.
   */
  private initializeGameStateInternal(): string | undefined {
    if (!this.assertInitialized()) return undefined;

    const result = this.initializeGameState(this.gameState);

    // Subscribe to tower:selected event - sync debug panel dropdown
    // Track subscription for cleanup in dispose()
    const eventBus = this.gameState.getEventBus();
    this.eventBusSubs.add(
      eventBus.on('tower:selected', (event) => {
        this.towerDebug.selectTower(event.tower.typeConfig.id);
      })
    );

    return result;
  }

  /**
   * Called each frame for animations (runs outside Angular zone).
   * Moved from component — orchestrates per-frame game logic.
   */
  private onEngineUpdate(deltaTime: number): void {
    if (!this.initialized) return;

    const dtSec = deltaTime / 1000;

    // Per-frame delegation calls
    this.towerPlacement.updateRotation(dtSec);
    this.towerPlacement.updatePreviewBuild();
    this.keyboardPan.update(dtSec);
    this.markerViz.animateMarkers(deltaTime);
    this.routeAnimation.update(deltaTime);

    // Game logic tick
    this.gameState.update(performance.now());

    // Bot update (if enabled)
    if (this.trainingClient.botEnabled()) {
      this.trainingClient.updateBot(this.aiDataCollector.getStateSnapshot(), deltaTime);
    }

    // Route grid visualization
    const grid = this.gameState.getGlobalRouteGrid();
    if (grid.isSpatialGridVizVisible()) {
      grid.updateVisualization();
    }
    grid.updateAnimation(deltaTime);

    // Selected tower LOS animation
    const selectedTower = this.gameState.towerManager.getSelected();
    if (selectedTower?.losVisualization?.visible) {
      grid.updateTowerVisualizationTime(selectedTower.losVisualization);
    }

    // Throttled UI stats (~10Hz) — throttle BEFORE zone entry to avoid unnecessary zone ticks
    const now = performance.now();
    if (now - this.lastStatsUpdate < TowerDefenseFacadeService.STATS_THROTTLE_MS) return;
    this.lastStatsUpdate = now;

    const engine = this.bridge.getEngine();
    if (engine) {
      const soundDebugOpen = this.debugWindows.soundWindow().isOpen;
      // Collect stats outside zone, then enter zone only for signal writes
      const stats = {
        fps: engine.getFPS(),
        tileStats: engine.getTileStats(),
        activeSoundCount: engine.spatialAudio.getActiveSoundCount(),
        attribution: engine.getAttributions(),
        cameraHeading: this.cameraControl.getCameraHeading(),
        cameraDebugInfo: this.cameraControl.getCameraDebugInfo(),
        soundPoolStats: soundDebugOpen ? engine.spatialAudio.getSoundPoolStats() : undefined,
      };
      this.ngZone.run(() => {
        this.uiState.updateThrottledStats({
          ...stats,
          onSoundDebugUpdate: soundDebugOpen
            ? (poolStats: unknown) => this.soundDebug.updateStats(poolStats as SoundPoolStats)
            : undefined,
        });
      });
    }
  }

  /**
   * Build the LocationFlowDelegate for the coordinator service.
   * Provides state access for location flow operations.
   */
  private buildLocationFlowDelegate(): LocationFlowDelegate {
    return {
      getChangeContext: () => {
        const engine = this.bridge.getEngine();
        if (!engine) return null;
        return {
          engine,
          gameState: this.gameState,
          streetNetwork: this.bridge.getStreetNetwork(),
          streetNetworkLocation: this.bridge.getStreetNetworkLocation(),
          heightDebugVisible: this.bridge.heightDebugVisible,
        };
      },
      getChangeCallbacks: (): LocationChangeCallbacks => ({
        setBaseCoords: (c) => this.bridge.baseCoords.set(c),
        setCenterCoords: (c) => this.bridge.centerCoords.set(c),
        setSpawnPoints: (p) => this.bridge.spawnPoints.set(p),
        addSpawnPoint: (id, name, lat, lon, color) => this.addSpawnPoint(id, name, lat, lon, color),
        setStreetCount: (c) => this.waveDebug.streetCount.set(c),
        setStreetNetwork: (n) => this.bridge.setStreetNetwork(n),
        setStreetNetworkLocation: (l) => this.bridge.setStreetNetworkLocation(l),
        syncUrlWithLocation: () => this.syncUrlWithLocation(),
        clearMapEntities: () => this.clearMapEntities(),
        appendDebugLog: (msg) => this.debugFacade.appendDebugLog(msg),
        initializeTowerPlacement: () => this.initializeTowerPlacement(this.gameState),
        filterStreetNetworkToRoutes: () => this.filterStreetNetworkToRoutes(),
        scheduleOverlayHeightUpdate: () => this.scheduleOverlayHeightUpdate(this.gameState),
        getSpawnPoints: () => this.bridge.spawnPoints(),
        getBaseCoords: () => this.bridge.baseCoords(),
      }),
      isGameInProgress: () => this.gameState.phase() !== 'setup' || this.gameState.waveNumber() > 0,
      getCurrentLocationName: () => this.locationMgmt.getLocationDisplayName(),
    };
  }

  // ══════════════════════════════════════════════════════════════
  // Visualization & Service Initialization
  // ══════════════════════════════════════════════════════════════

  /**
   * Initialize visualization services (markerViz, pathRoute, camera, animation, keyboard)
   * Must be called after engine and streets are loaded.
   */
  initializeVisualizationServices(): void {
    const engine = this.engineInit.getEngine();
    const streetNetwork = this.bridge.getStreetNetwork();
    if (!engine || !streetNetwork) {
      console.warn('[Facade] Cannot initialize visualization services - engine or streetNetwork not available');
      return;
    }

    const base = this.bridge.baseCoords();
    const baseCoords = { lat: base.lat, lon: base.lon };

    // Initialize marker visualization service
    this.markerViz.initialize(engine, baseCoords, this.bridge.heightDebugVisible);

    // Initialize path and route service
    const pathfindingService = this.devWorld.isActive && this.bridge.getDevStreetProvider()
      ? this.bridge.getDevStreetProvider()!
      : this.osmService;
    this.pathRoute.initialize(
      engine,
      streetNetwork,
      baseCoords,
      this.uiState.routesVisible,
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
   * Setup click handler with explicit gameState reference.
   */
  setupClickHandlerWithGameState(gameState: GameStateManager): void {
    const engine = this.bridge.getEngine() || this.engineInit.getEngine();
    if (!engine) return;

    this.inputHandler.initialize(
      this.bridge.getCanvasElement(),
      engine,
      gameState,
      this.towerPlacement.buildMode,
      (lat: number, lon: number, height: number) => this.bridge.onTerrainClick(lat, lon, height),
      (lat: number, lon: number, hitPoint: Vector3) => this.bridge.onMouseMove(lat, lon, hitPoint)
    );

    this.inputHandler.setEnemyPlacementCallback(
      () => this.enemyDebug.placementMode(),
      (lat: number, lon: number, height: number) => this.bridge.handleEnemyPlacement(lat, lon, height)
    );

    this.inputHandler.initKeyboard({
      exitBuildMode: () => this.bridge.exitBuildMode(),
    });
  }

  // ══════════════════════════════════════════════════════════════
  // Game State Initialization
  // ══════════════════════════════════════════════════════════════

  /**
   * Initialize game state with routes.
   * @returns Route detail string
   */
  initializeGameState(gameState: GameStateManager): string | undefined {
    const engine = this.bridge.getEngine() || this.engineInit.getEngine();
    const streetNetwork = this.bridge.getStreetNetwork();
    if (!engine || !streetNetwork) return undefined;

    const base = this.bridge.baseCoords();
    const waveSpawnPoints: WaveSpawnPoint[] = this.bridge.spawnPoints().map((sp) => ({
      id: sp.id,
      name: sp.name,
      lat: sp.lat,
      lon: sp.lon,
    }));

    gameState.initialize(
      engine,
      streetNetwork,
      { lat: base.lat, lon: base.lon },
      waveSpawnPoints,
      this.pathRoute.getCachedPaths()
    );

    // Initialize strategic placement service with street network
    this.strategicPlacement.initialize(streetNetwork);

    // Initialize enemy debug service
    this.enemyDebug.initialize(gameState, engine, this.bridge.spawnPoints);

    const eventBus = gameState.getEventBus();

    // Subscribe to debug:start-custom-wave event — tracked for cleanup
    this.eventBusSubs.add(
      eventBus.on('debug:start-custom-wave', () => {
        this.startCustomWave(gameState);
      })
    );

    // Subscribe to game:over event — tracked for cleanup
    this.eventBusSubs.add(
      eventBus.on('game:over', () => {
        this.onGameOver(gameState);
        this.trainingClient.resetBot();
        if (this.trainingClient.botEnabled()) {
          console.log('[Bot] Reset for new game');
        }

        if (this.trainingClient.botAutoMode()) {
          console.log('[Bot] Auto-restarting game in 2 seconds...');
          setTimeout(() => {
            this.restartGame(gameState);
          }, 2000);
        }
      })
    );

    // Validate routes
    const paths = this.pathRoute.getCachedPaths();
    if (paths.size === 0) {
      console.error('[Facade] No routes found - spawn and HQ may not be connected by streets');
    }

    // Initialize GlobalRouteGrid
    void this.engineInit.setStepActive('grid');
    this.engineInit.updateStepDetail('grid', 'Calculating grid...');
    gameState.initializeGlobalRouteGrid();
    void this.engineInit.setStepDone('grid');

    // Initialize tower placement
    this.initializeTowerPlacement(gameState);

    // Filter street network to route corridor
    this.filterStreetNetworkToRoutes();

    // Reframe camera
    this.reframeCameraWithRoutes();

    return this.pathRoute.getRouteDetail();
  }

  /**
   * Initialize TowerPlacementService with all required dependencies.
   */
  initializeTowerPlacement(gameState: GameStateManager): void {
    const engine = this.bridge.getEngine() || this.engineInit.getEngine();
    const streetNetwork = this.bridge.getStreetNetwork();
    if (!engine || !streetNetwork) {
      console.warn('[Facade] Cannot initialize TowerPlacement - engine or streetNetwork not available');
      return;
    }

    const base = this.bridge.baseCoords();
    const spawnPointsForPlacement = this.bridge.spawnPoints().map(sp => ({
      id: sp.id,
      name: sp.name,
      lat: sp.lat,
      lon: sp.lon,
      color: sp.color,
    }));

    this.towerPlacement.initialize(
      engine,
      streetNetwork,
      this.osmService,
      { lat: base.lat, lon: base.lon },
      spawnPointsForPlacement,
      gameState
    );
  }

  // ══════════════════════════════════════════════════════════════
  // Street Filtering
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
      100
    );
    this.bridge.setFilteredStreetNetwork(filtered);
  }

  // ══════════════════════════════════════════════════════════════
  // Height Updates
  // ══════════════════════════════════════════════════════════════

  /**
   * Schedule overlay height updates.
   */
  async scheduleOverlayHeightUpdate(gameState: GameStateManager): Promise<void> {
    const engine = this.engineInit.getEngine();
    if (!engine) {
      console.warn('[Facade] scheduleOverlayHeightUpdate - no engine!');
      return;
    }

    const base = this.bridge.baseCoords();

    this.heightUpdate.initialize(
      engine,
      { lat: base.lat, lon: base.lon },
      this.engineInit.loadingStatus,
      () => {
        const spawnPointsForMarkers = this.bridge.spawnPoints().map(sp => ({
          id: sp.id,
          name: sp.name,
          lat: sp.lat,
          lon: sp.lon,
          color: sp.color,
        }));
        this.markerViz.updateMarkerHeights(spawnPointsForMarkers);
        gameState.getGlobalRouteGrid().updateTerrainHeights();
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

    if (wasLoading && !isNowLoading && !this.routeAnimation.isRunning() && !isApplying) {
      const cachedPaths = this.pathRoute.getCachedPaths();
      if (cachedPaths.size > 0) {
        this.routeAnimation.startAnimation(cachedPaths, this.bridge.spawnPoints());
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
    const hq = this.bridge.baseCoords();
    const spawns = this.bridge.spawnPoints();

    const routePoints: { lat: number; lon: number }[] = [];
    const cachedPaths = this.pathRoute.getCachedPaths();
    cachedPaths.forEach((path) => {
      for (const pos of path) {
        routePoints.push({ lat: pos.lat, lon: pos.lon });
      }
    });

    if (spawns.length > 0) {
      const hqCoord = { lat: hq.lat, lon: hq.lon };
      const spawnCoords = spawns.map(s => ({ lat: s.lat, lon: s.lon }));
      this.cameraControl.showDebugVisualization(hqCoord, spawnCoords, 0.1, routePoints);
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
    this.bridge.cameraFramingDebug.set(enabled);

    if (enabled) {
      const hq = this.bridge.baseCoords();
      const spawns = this.bridge.spawnPoints();

      const routePoints: { lat: number; lon: number }[] = [];
      const cachedPaths = this.pathRoute.getCachedPaths();
      cachedPaths.forEach((path) => {
        for (const pos of path) {
          routePoints.push({ lat: pos.lat, lon: pos.lon });
        }
      });

      if (spawns.length > 0) {
        this.cameraControl.showDebugVisualization(
          { lat: hq.lat, lon: hq.lon },
          spawns.map(s => ({ lat: s.lat, lon: s.lon })),
          0.1,
          routePoints
        );
      }
    }
  }

  /**
   * Toggle camera debug overlay.
   */
  toggleCameraDebug(): void {
    const enabled = !this.uiState.cameraDebugEnabled();
    this.uiState.cameraDebugEnabled.set(enabled);

    if (enabled) {
      this.uiState.cameraDebugInfo.set(this.cameraControl.getCameraDebugInfo());
    } else {
      this.uiState.cameraDebugInfo.set(null);
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
      hq: this.bridge.baseCoords(),
      tiltAngle: 45,
    };

    const output = JSON.stringify(data, null, 2);
    this.debugFacade.appendDebugLog('=== CAMERA ===\n' + output);
  }

  // ══════════════════════════════════════════════════════════════
  // Wave Orchestration
  // ══════════════════════════════════════════════════════════════

  /**
   * Start a new wave (manual or AI-directed).
   */
  startWave(gameState: GameStateManager): void {
    if (!this.bridge.getEngine() || this.bridge.waveActive() || this.bridge.isGameOver()) return;
    if (this.bridge.spawnPoints().length === 0) return;

    if (this.bridge.useAIDirector()) {
      if (this.pendingAIWaveRequest) {
        console.log('[AI] Wave request already pending, ignoring duplicate call');
        return;
      }
      this.startWaveWithAI(gameState);
      return;
    }

    const waveConfig: WaveConfig = {
      enemyCount: this.waveDebug.enemyCount(),
      enemyType: this.waveDebug.enemyType(),
      enemySpeed: this.waveDebug.enemySpeed(),
      enemyHealth: this.waveDebug.enemyHealth(),
      spawnMode: this.waveDebug.spawnMode(),
      spawnDelay: this.waveDebug.spawnDelay(),
      getSpawnDelay: this.waveDebug.spawnDelay,
    };

    this.bridge.aiExplanation.set(null);
    gameState.getEventBus().emit({
      type: 'command:start-wave',
      config: waveConfig,
    });
  }

  /**
   * Start wave using AI Wave Director.
   */
  private async startWaveWithAI(gameState: GameStateManager): Promise<void> {
    this.pendingAIWaveRequest = true;

    try {
      let aiConfig;

      if (this.trainingClient.isConnected()) {
        console.log('[AI] Requesting wave from training backend...');
        const state = this.aiDataCollector.getStateSnapshot();
        aiConfig = await this.trainingClient.requestWaveConfig(state);
        console.log('[AI] Received wave from backend:', aiConfig);
      } else {
        aiConfig = await this.waveDirector.getNextWave();
      }

      this.bridge.aiExplanation.set(aiConfig.explanation ?? null);

      const waveConfig = adaptAIWaveConfigSingle(aiConfig);

      console.log('[AI] Wave config:', {
        archetype: aiConfig.archetype,
        enemies: aiConfig.enemies,
        totalCount: aiConfig.totalCount,
        explanation: aiConfig.explanation,
      });

      gameState.getEventBus().emit({
        type: 'command:start-wave',
        config: waveConfig,
      });
    } catch (error) {
      console.error('[AI] Failed to generate wave, using fallback', error);
      this.bridge.useAIDirector.set(false);
      this.startWave(gameState);
    } finally {
      this.pendingAIWaveRequest = false;
    }
  }

  /**
   * Toggle AI Director mode.
   */
  toggleAIDirector(): void {
    const newValue = !this.bridge.useAIDirector();
    this.bridge.useAIDirector.set(newValue);
    console.log(`[AI] AI Director ${newValue ? 'enabled' : 'disabled'}`);
  }

  /**
   * Start a custom wave using debug panel settings only.
   */
  startCustomWave(gameState: GameStateManager): void {
    if (!this.bridge.getEngine() || this.bridge.waveActive() || this.bridge.isGameOver()) return;
    if (this.bridge.spawnPoints().length === 0) return;

    const waveConfig: WaveConfig = {
      enemyCount: this.waveDebug.enemyCount(),
      enemyType: this.waveDebug.enemyType(),
      enemySpeed: this.waveDebug.enemySpeed(),
      enemyHealth: this.waveDebug.enemyHealth(),
      spawnMode: this.waveDebug.spawnMode(),
      spawnDelay: this.waveDebug.spawnDelay(),
      getSpawnDelay: this.waveDebug.spawnDelay,
    };

    console.log('[Debug] Starting custom wave:', waveConfig);
    this.bridge.aiExplanation.set(null);
    gameState.getEventBus().emit({
      type: 'command:start-wave',
      config: waveConfig,
    });
  }

  /**
   * Get AI Director status text.
   */
  getAIStatusText(): string {
    if (!this.bridge.useAIDirector()) return 'AI deaktiviert';
    return this.waveDirector.statusText();
  }

  // ══════════════════════════════════════════════════════════════
  // Game Lifecycle
  // ══════════════════════════════════════════════════════════════

  /**
   * Handle game over.
   */
  onGameOver(gameState: GameStateManager): void {
    gameState.waveManager.stopSpawning();
  }

  /**
   * Restart game.
   */
  restartGame(gameState: GameStateManager): void {
    const engine = this.bridge.getEngine();

    // Cleanup old debug visualization before reset
    gameState.getGlobalRouteGrid().cleanupSpatialGridVisualization();

    // Cleanup DPS profile visualization
    this.dpsVizUnsubscribes.forEach(fn => fn());
    this.dpsVizUnsubscribes = [];
    if (this.dpsProfileViz) {
      const mesh = this.dpsProfileViz.getMesh();
      if (mesh) engine?.getScene().remove(mesh);
      this.dpsProfileViz.dispose();
      this.dpsProfileViz = null;
    }

    gameState.getEventBus().emit({ type: 'command:restart-game' });

    // Reset pending AI wave request flag
    this.pendingAIWaveRequest = false;

    // Reset bot state
    this.trainingClient.resetBot();
  }

  // ══════════════════════════════════════════════════════════════
  // Tower Upgrades
  // ══════════════════════════════════════════════════════════════

  /**
   * Upgrade a tower with the specified upgrade.
   * @returns true if upgrade was successful
   */
  upgradeTower(tower: Tower, upgradeId: UpgradeId, gameState: GameStateManager): boolean {
    const upgrade = tower.typeConfig.upgrades.find(u => u.id === upgradeId);
    if (!upgrade) {
      console.warn('[Upgrade] Upgrade not found:', upgradeId);
      return false;
    }

    // Pre-validate before emitting command
    const cost = tower.getNextUpgradeCost(upgradeId);
    if (gameState.credits() < cost) {
      console.warn(`[Upgrade] Not enough credits: ${gameState.credits()}/${cost}`);
      return false;
    }
    if (!tower.canUpgrade(upgradeId)) {
      console.warn(`[Upgrade] Tower cannot upgrade ${upgradeId} (already max level)`);
      return false;
    }

    // Emit command event — GSM handler applies upgrade + deducts credits
    gameState.getEventBus().emit({
      type: 'command:upgrade-tower',
      towerId: tower.id,
      upgradeId,
    });

    return true;
  }

  // ══════════════════════════════════════════════════════════════
  // DevWorld
  // ══════════════════════════════════════════════════════════════

  /**
   * Refresh terrain heights. In DevWorld: regenerates entire world.
   */
  refreshTerrainHeights(gameState: GameStateManager): void {
    const engine = this.bridge.getEngine();
    if (!engine) return;

    console.log('[Facade] Manual terrain height refresh triggered');

    if (this.devWorld.isActive) {
      const devTerrainProvider = engine.getDevTerrainProvider();
      if (devTerrainProvider) {
        console.log('[Facade] DevWorld: Regenerating world...');
        this.bridge.isDevWorldRegenerating.set(true);

        this.clearDevWorldVisuals(gameState);
        engine.clearHeightCache();

        devTerrainProvider.regenerate().then(() => {
          this.onDevWorldRegenerated(devTerrainProvider, gameState);
          this.bridge.isDevWorldRegenerating.set(false);
        });
        return;
      }
    }

    engine.clearHeightCache();
    this.onTilesLoaded(gameState);
  }

  /**
   * Clear all DevWorld visuals before regeneration.
   */
  clearDevWorldVisuals(gameState: GameStateManager): void {
    const engine = this.bridge.getEngine();
    if (!engine) return;

    const overlayGroup = engine.getOverlayGroup();

    this.routeAnimation.stopAnimation();
    this.heightUpdate.stopHeightUpdates();

    gameState.reset();
    gameState.getGlobalRouteGrid().disposeVisualization();

    this.markerViz.clearAllMarkers();
    this.pathRoute.clearAllRoutes();
    this.pathRoute.clearCachedPaths();
    this.streetRendering.dispose(overlayGroup);

    this.bridge.spawnPoints.set([]);

    console.log('[Facade] DevWorld visuals cleared');
  }

  /**
   * Called after DevWorld terrain regeneration.
   */
  onDevWorldRegenerated(devTerrainProvider: DevTerrainProvider, gameState: GameStateManager): void {
    console.log('[Facade] DevWorld regenerated - re-creating visuals');
    const engine = this.bridge.getEngine();
    if (!engine) return;

    // Re-create base marker
    this.markerViz.addBaseMarker();

    // Create new spawn from terrain provider
    const generatedSpawns = devTerrainProvider.getSpawnPoints();
    const colors = [0xef4444, 0xf97316, 0x00bcd4, 0xff00ff];

    if (generatedSpawns.length > 0) {
      const spawn = generatedSpawns[0];
      const spawnGeo = this.devWorld.localToGeo(spawn.position.x, spawn.position.z);
      this.addSpawnPoint(spawn.id, spawn.name, spawnGeo.lat, spawnGeo.lon, colors[0]);
    }

    this.pathRoute.updateSpawnMarkers(this.markerViz.getSpawnMarkers());

    // Re-filter and render streets
    this.bridge.setFilteredStreetNetwork(this.bridge.getStreetNetwork());
    this.renderStreets();

    // Update marker heights and render routes
    const spawnPointsForMarkers = this.bridge.spawnPoints().map(sp => ({
      id: sp.id,
      name: sp.name,
      lat: sp.lat,
      lon: sp.lon,
      color: sp.color,
    }));
    this.markerViz.updateMarkerHeights(spawnPointsForMarkers);
    this.pathRoute.refreshRouteLines(this.bridge.spawnPoints());

    // Re-initialize game state
    gameState.initializeGlobalRouteGrid();
    gameState.onTilesLoaded();

    // Start route animation
    const cachedPaths = this.pathRoute.getCachedPaths();
    if (cachedPaths.size > 0) {
      this.routeAnimation.startAnimation(cachedPaths, this.bridge.spawnPoints());
    }

    console.log(`[Facade] DevWorld re-initialized: ${generatedSpawns.length} spawns, ${cachedPaths.size} routes`);
  }

  // ══════════════════════════════════════════════════════════════
  // Tiles & Spawns
  // ══════════════════════════════════════════════════════════════

  /**
   * Called when tiles finish loading (LOD changes).
   */
  onTilesLoaded(gameState: GameStateManager): void {
    const engine = this.bridge.getEngine();
    if (!engine || !this.bridge.getFilteredStreetNetwork()) return;

    this.renderStreets();

    const spawnPointsForMarkers = this.bridge.spawnPoints().map(sp => ({
      id: sp.id,
      name: sp.name,
      lat: sp.lat,
      lon: sp.lon,
      color: sp.color,
    }));
    this.markerViz.updateMarkerHeights(spawnPointsForMarkers);
    this.pathRoute.refreshRouteLines(this.bridge.spawnPoints());

    gameState.onTilesLoaded();
    gameState.getGlobalRouteGrid().initSpatialGridVisualizationIfEnabled();
  }

  /**
   * Add predefined spawn points.
   */
  addPredefinedSpawns(): number {
    const colors = [0xef4444, 0xf97316, 0x00bcd4, 0xff00ff];
    const hq = this.locationMgmt.hq();
    const streetNetwork = this.bridge.getStreetNetwork();

    if (!hq) {
      console.warn('[addPredefinedSpawns] No HQ location set');
      return 0;
    }

    if (this.locationMgmt.needsRandomSpawn() && streetNetwork) {
      // DevWorld mode
      if (this.devWorld.isActive) {
        const engine = this.bridge.getEngine() || this.engineInit.getEngine();
        const devTerrainProvider = engine?.getDevTerrainProvider();

        if (devTerrainProvider) {
          const generatedSpawns = devTerrainProvider.getSpawnPoints();
          if (generatedSpawns.length > 0) {
            const spawn = generatedSpawns[0];
            const spawnGeo = this.devWorld.localToGeo(spawn.position.x, spawn.position.z);
            console.log(`[addPredefinedSpawns] DevWorld spawn: ${spawn.name} at (${spawn.position.x.toFixed(0)}, ${spawn.position.z.toFixed(0)})`);
            this.locationMgmt.setGeneratedSpawns([{ lat: spawnGeo.lat, lon: spawnGeo.lon }]);
            this.addSpawnPoint(spawn.id, spawn.name, spawnGeo.lat, spawnGeo.lon, colors[0]);
            return 1;
          }
        }

        // Fallback
        const spawnConfig = this.devWorld.config.spawn;
        const spawnPos = this.devWorld.getSpawnPosition();
        const spawnGeo = this.devWorld.localToGeo(spawnPos.x, spawnPos.z);
        console.log(`[addPredefinedSpawns] DevWorld spawn (fallback): ${spawnConfig} at (${spawnPos.x}, ${spawnPos.z})`);
        this.locationMgmt.setGeneratedSpawns([{ lat: spawnGeo.lat, lon: spawnGeo.lon }]);
        this.addSpawnPoint(`spawn-${spawnConfig}`, `Spawn ${spawnConfig}`, spawnGeo.lat, spawnGeo.lon, colors[0]);
        return 1;
      }

      // Real world: random spawn
      const randomSpawn = this.osmService.findRandomStreetPoint(streetNetwork, hq.lat, hq.lon, 500, 1000);
      if (randomSpawn) {
        console.log(`[addPredefinedSpawns] Generated random spawn: ${randomSpawn.streetName || 'Unknown'} (${Math.round(randomSpawn.distance)}m)`);
        this.locationMgmt.setGeneratedSpawns([{ lat: randomSpawn.lat, lon: randomSpawn.lon }]);
        this.syncUrlWithLocation();
        this.addSpawnPoint('spawn-1', randomSpawn.streetName || 'Spawn', randomSpawn.lat, randomSpawn.lon, colors[0]);
        return 1;
      } else {
        console.warn('[addPredefinedSpawns] No valid random spawn found');
        return 0;
      }
    }

    // Use spawn locations from URL/service
    const spawns = this.locationMgmt.editableSpawnLocations();
    let count = 0;
    if (spawns.length > 0 && spawns.every(s => s.lat !== 0 && s.lon !== 0)) {
      spawns.forEach((spawn, index) => {
        this.addSpawnPoint(spawn.id, spawn.name || `Spawn ${index + 1}`, spawn.lat, spawn.lon, colors[index % colors.length]);
        count++;
      });
    }
    return count;
  }

  /**
   * Add a spawn point (delegates to services).
   */
  addSpawnPoint(id: string, name: string, lat: number, lon: number, color: number): void {
    const engine = this.bridge.getEngine() || this.engineInit.getEngine();
    const streetNetwork = this.bridge.getStreetNetwork();
    if (!engine || !streetNetwork) return;

    const spawn: SpawnPoint = { id, name, lat, lon, color };
    this.bridge.spawnPoints.update((points) => [...points, spawn]);

    this.markerViz.addSpawnMarker(id, name, lat, lon, color);
    this.pathRoute.updateSpawnMarkers(this.markerViz.getSpawnMarkers());
    this.pathRoute.showPathFromSpawn(spawn);
  }

  // ══════════════════════════════════════════════════════════════
  // Map Cleanup
  // ══════════════════════════════════════════════════════════════

  /**
   * Clear all map entities (markers, routes, streets, spawns).
   */
  clearMapEntities(): void {
    const engine = this.bridge.getEngine();
    if (!engine) return;

    const overlayGroup = engine.getOverlayGroup();

    this.markerViz.clearAllMarkers();
    this.pathRoute.clearAllRoutes();
    this.streetRendering.dispose(overlayGroup);

    this.bridge.spawnPoints.set([]);
    this.pathRoute.clearCachedPaths();

    this.bridge.setFilteredStreetNetwork(null);
    this.bridge.setStreetNetworkLocation(null);

    this.engineInit.stopTileStatsPolling();
  }

  // ══════════════════════════════════════════════════════════════
  // DPS Visualization
  // ══════════════════════════════════════════════════════════════

  /**
   * Toggle DPS profile bins visualization.
   */
  onDpsBinsToggled(visible: boolean, gameState: GameStateManager): void {
    const engine = this.bridge.getEngine() || this.engineInit.getEngine();
    if (!engine) return;

    if (visible) {
      const grid = gameState.getGlobalRouteGrid();
      const coordSync = grid.getCoordinateSync();
      if (!coordSync) return;

      if (!this.dpsProfileViz) {
        this.dpsProfileViz = new DpsProfileVisualizer(coordSync);
      }

      this.updateDpsViz(engine);

      const eventBus = gameState.getEventBus();
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

  // ══════════════════════════════════════════════════════════════
  // Street Rendering
  // ══════════════════════════════════════════════════════════════

  renderStreets(): void {
    const engine = this.bridge.getEngine() || this.engineInit.getEngine();
    if (!engine) return;

    const base = this.bridge.baseCoords();
    this.streetRendering.renderStreets(
      engine,
      this.bridge.getFilteredStreetNetwork(),
      this.bridge.getStreetNetwork(),
      { lat: base.lat, lon: base.lon },
      this.bridge.streetsVisible()
    );
  }

  /**
   * Reframe camera to include all calculated routes.
   */
  reframeCameraWithRoutes(): void {
    const base = this.bridge.baseCoords();
    const hq: GeoPoint = { lat: base.lat, lon: base.lon };

    const spawns: GeoPoint[] = this.bridge.spawnPoints().map(sp => ({
      lat: sp.lat,
      lon: sp.lon,
    }));

    const routePoints: GeoPoint[] = [];
    const cachedPaths = this.pathRoute.getCachedPaths();
    cachedPaths.forEach((path) => {
      for (const pos of path) {
        routePoints.push({ lat: pos.lat, lon: pos.lon });
      }
    });

    if (routePoints.length > 0) {
      this.cameraFraming.reframeWithRoutes(hq, spawns, routePoints, {
        padding: 0.1,
        angle: 70,
        markerRadius: 8,
      });
    }
  }

  // ══════════════════════════════════════════════════════════════
  // Cleanup
  // ══════════════════════════════════════════════════════════════

  /**
   * Dispose DPS visualization resources.
   * Called from component's ngOnDestroy.
   */
  disposeDpsVisualization(engine: ThreeTilesEngine | null): void {
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
