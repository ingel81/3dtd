import { Injectable, inject, Injector } from '@angular/core';
import { SubscriptionBag } from '../game-engine/game-event-bus';
import { OsmStreetService } from './osm-street.service';
import { TowerPlacementService } from './tower-placement.service';
import { EngineInitializationService } from './engine-initialization.service';
import { ConfigService } from '../core/services/config.service';
import { DevWorldService } from '../devworld/devworld.service';
import { WaveDebugService } from './wave-debug.service';
import { SoundDebugService } from './sound-debug.service';
import { DebugFacadeService } from './debug-facade.service';
import { EntityPoolService } from './entity-pool.service';
import { ModelPreviewService } from './model-preview.service';
import { StrategicPlacementService } from './strategic-placement.service';
import { GameStateManager } from '../managers/game-state.manager';
import { TrainingClientService } from '../ai/training/training-client.service';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { GameStateSyncService } from './game-state-sync.service';
import { ThreeTilesEngine } from '../three-engine';
import { Tower } from '../entities/tower.entity';
import { UpgradeId } from '../configs/tower-types.config';
import { Vector3 } from 'three';
import { StreetNetwork } from './osm-street.service';
import { DevStreetProvider } from '../devworld/dev-street.provider';
import { DevTerrainProvider } from '../devworld/dev-terrain.provider';

// Sub-facades
import { GameLoopFacadeService } from './game-loop-facade.service';
import { LocationFacadeService } from './location-facade.service';
import { VisualizationFacadeService } from './visualization-facade.service';

/**
 * Minimal bridge for engine/canvas references that cannot live in the Store.
 *
 * All UI state signals have been migrated to TowerDefenseStore.
 * The bridge only carries mutable engine infrastructure references
 * and component-level callbacks (click handlers, etc.).
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

  /** Canvas element for input handler */
  getCanvasElement: () => HTMLCanvasElement;

  /** Callbacks that remain in the component */
  onTerrainClick: (lat: number, lon: number, height: number) => void;
  onMouseMove: (lat: number, lon: number, hitPoint: Vector3) => void;
  exitBuildMode: () => void;
  handleEnemyPlacement: (lat: number, lon: number, height: number) => void;
}

/**
 * Main facade service — orchestrates initialization, dispose, and delegates
 * domain-specific work to sub-facades:
 *
 * - GameLoopFacadeService: Wave management, game loop, lifecycle, upgrades
 * - LocationFacadeService: Location detection, DevWorld, spawns, streets
 * - VisualizationFacadeService: Rendering, camera, DPS viz, height updates
 */
@Injectable({ providedIn: 'root' })
export class TowerDefenseFacadeService {
  // Store — single source of truth for UI state
  private readonly store = inject(TowerDefenseStore);

  // Sub-facades
  private readonly gameLoopFacade = inject(GameLoopFacadeService);
  private readonly locationFacade = inject(LocationFacadeService);
  private readonly vizFacade = inject(VisualizationFacadeService);

  // Services needed only by the main facade for orchestration
  private readonly osmService = inject(OsmStreetService);
  private readonly towerPlacement = inject(TowerPlacementService);
  private readonly engineInit = inject(EngineInitializationService);
  private readonly configService = inject(ConfigService);
  private readonly devWorld = inject(DevWorldService);
  private readonly waveDebug = inject(WaveDebugService);
  private readonly soundDebug = inject(SoundDebugService);
  private readonly debugFacade = inject(DebugFacadeService);
  private readonly entityPool = inject(EntityPoolService);
  private readonly modelPreview = inject(ModelPreviewService);
  private readonly strategicPlacement = inject(StrategicPlacementService);
  private readonly trainingClient = inject(TrainingClientService);
  private readonly gameStateSync = inject(GameStateSyncService);

  /** Component bridge - set via initialize(). Non-null after initEffects(). */
  private bridge!: FacadeComponentBridge;

  /** Game state manager — component-provided, set via initialize(). */
  private gameState!: GameStateManager;

  /** Whether the facade has been initialized via initEffects() */
  private initialized = false;

  /** EventBus subscription bag — cleaned up in dispose() */
  private readonly eventBusSubs = new SubscriptionBag();

  /**
   * Initialize the facade with component bridge, game state, and injector.
   */
  private initialize(bridge: FacadeComponentBridge, gameState: GameStateManager, injector: Injector): void {
    this.bridge = bridge;
    this.gameState = gameState;
    this.initialized = true;

    // Initialize sub-facades
    this.gameLoopFacade.initialize(bridge, gameState);
    this.locationFacade.initialize(bridge, gameState, injector);
    this.vizFacade.initialize(bridge, gameState);
  }

  // ══════════════════════════════════════════════════════════════
  // Effects & Game Startup
  // ══════════════════════════════════════════════════════════════

  /**
   * Create Angular effects that were previously in the component constructor.
   * Delegates effect creation to sub-facades.
   */
  initEffects(component: { getFacadeBridge: () => FacadeComponentBridge; gameState: GameStateManager; injector: Injector }): void {
    this.initialize(component.getFacadeBridge(), component.gameState, component.injector);

    const injector = component.injector;
    this.gameLoopFacade.initEffects(injector);
    this.vizFacade.initEffects(injector);
  }

  /**
   * Main game startup sequence: location detection + engine initialization.
   */
  async startGame(canvas: HTMLCanvasElement): Promise<void> {
    if (!this.initialized) return;

    // Initialize location coordinator flow
    this.locationFacade.initializeCoordinator({
      initializeTowerPlacement: () => this.vizFacade.initializeTowerPlacement(),
      filterStreetNetworkToRoutes: () => this.vizFacade.filterStreetNetworkToRoutes(),
      scheduleOverlayHeightUpdate: () => this.vizFacade.scheduleOverlayHeightUpdate(),
    });

    // Initialize training client
    this.trainingClient.initialize({
      gameState: this.gameState,
      towerPlacement: this.towerPlacement,
      strategicPlacement: this.strategicPlacement,
      osmService: this.osmService,
      callbacks: {
        startWave: () => this.startWave(),
        upgradeTower: (tower: Tower, upgradeId: UpgradeId) => this.upgradeTower(tower, upgradeId),
        restartGame: () => this.restartGame(),
      }
    });

    const params = new URLSearchParams(window.location.search);
    if (params.has('bot')) {
      const botMode = params.get('bot');
      if (botMode === 'auto') {
        this.trainingClient.botAutoMode.set(true);
      }
    }

    if (this.devWorld.isActive) {
      this.store.useAIDirector.set(true);
      this.trainingClient.connectToBackend();
    }

    // Location detection (delegated to LocationFacade)
    await this.locationFacade.initializeLocation();

    // Engine initialization
    await this.initEngineSequence(canvas);
  }

  /**
   * Full cleanup: dispose engine, pool, preview, animations, sub-facades, EventBus subs.
   */
  dispose(): void {
    this.eventBusSubs.disposeAll();
    this.gameStateSync.dispose();
    this.gameLoopFacade.dispose();
    this.locationFacade.dispose();
    this.vizFacade.dispose();

    this.entityPool.destroy();
    this.modelPreview.dispose();

    if (this.initialized) {
      this.gameState.getGlobalRouteGrid().cleanupSpatialGridVisualization();

      const engine = this.bridge.getEngine();
      if (engine) {
        engine.dispose();
        this.bridge.setEngine(null);
        this.trainingClient.setEngine(null);
      }
    }

    this.initialized = false;
  }

  // ══════════════════════════════════════════════════════════════
  // Engine Initialization
  // ══════════════════════════════════════════════════════════════

  /**
   * Initialize Three.js rendering engine with full callback wiring.
   */
  private async initEngineSequence(canvas: HTMLCanvasElement): Promise<void> {
    try {
      const cesiumToken = this.configService.cesiumIonToken();
      const cesiumAssetId = this.configService.cesiumAssetId();
      if (!cesiumToken) {
        this.engineInit.setError('Please configure your Cesium Ion Token in environment.ts.');
        this.engineInit.setLoading(false);
        return;
      }

      const base = this.store.baseCoords();
      this.engineInit.configure(canvas, cesiumToken, cesiumAssetId, { lat: base.lat, lon: base.lon });

      await this.engineInit.initEngine({
        onLoadStreets: () => this.loadStreetsInternal(),
        onInitializeServices: () => this.vizFacade.initializeVisualizationServices(),
        onAddBaseMarker: () => this.vizFacade.addBaseMarker(),
        onAddPredefinedSpawns: () => this.locationFacade.addPredefinedSpawns(),
        onInitializeGameState: () => this.initializeGameStateInternal(),
        onScheduleHeightUpdate: () => this.vizFacade.scheduleOverlayHeightUpdate(),
        onSetupClickHandler: () => this.vizFacade.setupClickHandlerWithGameState(),
        onCreateBuildPreview: () => { /* no-op: TowerPlacementService handles this */ },
        onSaveInitialCameraPosition: () => this.vizFacade.saveInitialCameraPosition(),
        onCheckAllLoaded: () => this.vizFacade.checkAllLoaded(),
      });

      const engine = this.engineInit.getEngine();
      this.bridge.setEngine(engine);
      this.trainingClient.setEngine(engine);

      if (engine) {
        engine.setOnTilesLoadCallback(() => this.vizFacade.onTilesLoaded());
        engine.setOnUpdateCallback((deltaTime) => this.gameLoopFacade.onEngineUpdate(deltaTime));

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
    const center = this.store.centerCoords();
    const result = await this.engineInit.loadStreets(
      center.lat,
      center.lon,
      (network, count) => {
        this.bridge.setStreetNetwork(network);
        this.store.streetCount.set(count);
      },
    );
    this.bridge.setStreetNetwork(result.network);
    this.bridge.setDevStreetProvider(result.devStreetProvider);
    this.store.streetCount.set(result.count);
    return result.count;
  }

  /**
   * Initialize game state with routes AND subscribe to events.
   */
  private initializeGameStateInternal(): string | undefined {
    if (!this.initialized) return undefined;

    const result = this.vizFacade.initializeGameState();

    // Initialize GSM→Store sync (EventBus events → Store signals)
    this.gameStateSync.initialize(this.gameState.getEventBus());

    // Let sub-facades subscribe to their own EventBus events
    this.vizFacade.subscribeToEventBus();
    this.gameLoopFacade.subscribeToEventBus({
      onGameOverExtra: () => {
        this.trainingClient.resetBot();
        if (this.trainingClient.botAutoMode()) {
          setTimeout(() => {
            this.restartGame();
          }, 2000);
        }
      },
    });

    return result;
  }

  // ══════════════════════════════════════════════════════════════
  // Public API — Delegates to sub-facades
  // ══════════════════════════════════════════════════════════════

  /** Start a new wave (manual or AI-directed). */
  startWave(): void {
    this.gameLoopFacade.startWave();
  }

  /** Start a custom wave using debug panel settings. */
  startCustomWave(): void {
    this.gameLoopFacade.startCustomWave();
  }

  /** Toggle AI Director mode. */
  toggleAIDirector(): void {
    this.gameLoopFacade.toggleAIDirector();
  }

  /** Get AI Director status text. */
  getAIStatusText(): string {
    return this.gameLoopFacade.getAIStatusText();
  }

  /** Upgrade a tower with the specified upgrade. */
  upgradeTower(tower: Tower, upgradeId: UpgradeId): boolean {
    return this.gameLoopFacade.upgradeTower(tower, upgradeId);
  }

  /** Restart game. */
  restartGame(): void {
    this.gameLoopFacade.restartGame(() => this.vizFacade.cleanupDpsVisualization());
  }

  /** Refresh terrain heights. In DevWorld: regenerates entire world. */
  refreshTerrainHeights(): void {
    this.locationFacade.refreshTerrainHeights(() => this.vizFacade.onTilesLoaded());
  }

  /** Clear DevWorld visuals. */
  clearDevWorldVisuals(): void {
    this.locationFacade.clearDevWorldVisuals();
  }

  /** DevWorld regenerated callback. */
  onDevWorldRegenerated(devTerrainProvider: DevTerrainProvider): void {
    this.locationFacade.onDevWorldRegenerated(devTerrainProvider);
  }

  /** Called when tiles finish loading. */
  onTilesLoaded(): void {
    this.vizFacade.onTilesLoaded();
  }

  /** Add predefined spawn points. */
  addPredefinedSpawns(): number {
    return this.locationFacade.addPredefinedSpawns();
  }

  /** Add a spawn point. */
  addSpawnPoint(id: string, name: string, lat: number, lon: number, color: number): void {
    this.locationFacade.addSpawnPoint(id, name, lat, lon, color);
  }

  /** Toggle DPS profile bins visualization. */
  onDpsBinsToggled(visible: boolean): void {
    this.vizFacade.onDpsBinsToggled(visible);
  }

  /** Reframe camera with routes. */
  reframeCameraWithRoutes(): void {
    this.vizFacade.reframeCameraWithRoutes();
  }

  /** Toggle camera framing debug. */
  toggleCameraFramingDebug(): void {
    this.vizFacade.toggleCameraFramingDebug();
  }

  /** Toggle camera debug overlay. */
  toggleCameraDebug(): void {
    this.vizFacade.toggleCameraDebug();
  }

  /** Log camera position. */
  logCameraPosition(): void {
    this.vizFacade.logCameraPosition();
  }
}
