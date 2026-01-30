import { Injectable, inject, Signal, WritableSignal } from '@angular/core';
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
import { DevWorldService } from '../devworld/devworld.service';
import { DevStreetProvider } from '../devworld/dev-street.provider';
import { CameraFramingService, GeoPoint } from '../services/camera-framing.service';
import { RouteAnimationService } from '../services/route-animation.service';
import { KeyboardPanService } from '../services/keyboard-pan.service';
import { StreetRenderingService } from '../services/street-rendering.service';
import { StrategicPlacementService } from '../services/strategic-placement.service';
import { WaveDebugService } from '../services/wave-debug.service';
import { EnemyDebugService } from '../services/enemy-debug.service';
import { GameStateManager } from '../managers/game-state.manager';
import { SpawnPoint as WaveSpawnPoint, WaveConfig } from '../managers/wave.manager';
import { WaveDirectorService } from '../ai/core/wave-director.service';
import { AIDataCollectorService } from '../ai/core/ai-data-collector.service';
import { TrainingClientService } from '../ai/training/training-client.service';
import { adaptAIWaveConfigSingle } from '../ai/core/wave-config-adapter';
import { DpsProfileVisualizer } from '../ai/core/dps-profile-visualizer';
import { ThreeTilesEngine } from '../three-engine';
import { Tower } from '../entities/tower.entity';
import { UpgradeId } from '../configs/tower-types.config';
import { Vector3 } from 'three';
import { DevTerrainProvider } from '../devworld/dev-terrain.provider';

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
  syncUrlWithLocation: () => void;
  appendDebugLog: (msg: string) => void;
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
  private readonly cameraFraming = inject(CameraFramingService);
  private readonly routeAnimation = inject(RouteAnimationService);
  private readonly keyboardPan = inject(KeyboardPanService);
  private readonly streetRendering = inject(StreetRenderingService);
  private readonly devWorld = inject(DevWorldService);
  private readonly waveDebug = inject(WaveDebugService);
  private readonly enemyDebug = inject(EnemyDebugService);
  private readonly strategicPlacement = inject(StrategicPlacementService);
  private readonly waveDirector = inject(WaveDirectorService);
  private readonly aiDataCollector = inject(AIDataCollectorService);
  private readonly trainingClient = inject(TrainingClientService);

  /** Component bridge - set via initialize() */
  private bridge!: FacadeComponentBridge;

  /** DPS profile visualization along path */
  private dpsProfileViz: DpsProfileVisualizer | null = null;
  private dpsVizUnsubscribes: (() => void)[] = [];

  /** Flag to prevent concurrent AI wave requests */
  private pendingAIWaveRequest = false;

  /**
   * Initialize the facade with component bridge.
   * Must be called before any other method.
   */
  initialize(bridge: FacadeComponentBridge): void {
    this.bridge = bridge;
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

    // Subscribe to debug:start-custom-wave event
    eventBus.on('debug:start-custom-wave', () => {
      this.startCustomWave(gameState);
    });

    // Subscribe to game:over event
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
    });

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
    this.bridge.appendDebugLog('=== CAMERA ===\n' + output);
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
        this.bridge.syncUrlWithLocation();
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
