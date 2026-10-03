import { Injectable, inject, Injector } from '@angular/core';
import { RouteGridVizService } from '../world/route-grid-viz.service';
import { SubscriptionBag } from '../../game-engine/game-event-bus';
import { BackgroundMusicService } from '../../game-engine/background-music.service';
import { TowerPlacementService } from '../tower-placement.service';
import { EngineInitializationService } from '../infrastructure/engine-initialization.service';
import { ConfigService } from '../../core/services/config.service';
import { DevWorldService } from '../../devworld/devworld.service';
import { SoundDebugService } from '../debug/sound-debug.service';
import { DebugFacadeService } from '../debug/debug-facade.service';
import { PerformanceProfilerService } from '../debug/performance-profiler.service';
import { ModelPreviewService } from '../infrastructure/model-preview.service';
import { StrategicPlacementService } from '../world/strategic-placement.service';
import { SimClient } from '../../sim/client/sim-client.service';
import { SimMirror } from '../../sim/client/mirror/sim-mirror';
import { PresentationHost } from '../../presentation/presentation-host';
import { PresentationService } from '../../presentation/presentation.service';
import { TowerLosRegistry } from '../tower-los-registry';
import { GlobalRouteGridService } from '../world/global-route-grid.service';
import { MainWorldService } from '../world/main-world.service';
import { BotClientService } from '../../bots/bot-client.service';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { UIStore } from '../../store/ui.store';
import { GameStateSyncService } from '../infrastructure/game-state-sync.service';
import { RunLogFacade } from '../../run-log/run-log.facade';
import { WaveDirector } from '../../director/wave-director';
import { RefusalHintService } from '../refusal-hint.service';
import { uiSound } from '../ui-sound';
import { OnboardingService } from '../onboarding/onboarding.service';
import { BestWaveService } from '../location/best-wave.service';
import { ThreeTilesEngine } from '../../three-engine';
import { Tower } from '../../entities/tower.entity';
import { UpgradeId } from '../../configs/tower-types.config';
import { researchSnapshotOf, type ResearchSnapshot } from '../../managers/research-snapshot';
import { watchResearchOf } from '../../sim/client/mirror/mirror-research';
import { Vector3 } from 'three';
import { StreetNetwork } from '../location/osm-street.service';
import { DevStreetProvider } from '../../devworld/dev-street.provider';
import { DevTerrainProvider } from '../../devworld/dev-terrain.provider';
import { isBenchmarkSearch } from '../../benchmark/benchmark-report';

// Sub-facades
import { GameLoopFacadeService } from './game-loop-facade.service';
import { LocationFacadeService } from './location-facade.service';
import { installPreviewSheetHook } from '../infrastructure/preview-sheets';
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

  /** Map placement callbacks (HQ/Spawn click-to-place) */
  onMapPlacementClick: (lat: number, lon: number, height: number) => void;
  onMapPlacementMove: (lat: number, lon: number, hitPoint: Vector3) => void;
  exitMapPlacement: () => void;
}

/** The notice when the map's tile server could not be reached (not a refused key) */
export const TILES_UNREACHABLE = 'The map server could not be reached. Check the connection and reload.';

/**
 * Main facade service, orchestrates initialization, dispose, and delegates
 * domain-specific work to sub-facades:
 *
 * - GameLoopFacadeService: Wave management, game loop, lifecycle, upgrades
 * - LocationFacadeService: Location detection, DevWorld, spawns, streets
 * - VisualizationFacadeService: Rendering, camera, DPS viz, height updates
 */
@Injectable()
export class TowerDefenseFacadeService {
  // Store, single source of truth for UI state
  private readonly store = inject(TowerDefenseStore);
  private readonly uiStore = inject(UIStore);

  // Sub-facades
  private readonly gameLoopFacade = inject(GameLoopFacadeService);
  private readonly locationFacade = inject(LocationFacadeService);
  private readonly vizFacade = inject(VisualizationFacadeService);

  // Services needed only by the main facade for orchestration
  private readonly towerPlacement = inject(TowerPlacementService);
  private readonly engineInit = inject(EngineInitializationService);
  private readonly configService = inject(ConfigService);
  private readonly devWorld = inject(DevWorldService);
  private readonly soundDebug = inject(SoundDebugService);
  private readonly debugFacade = inject(DebugFacadeService);
  private readonly profiler = inject(PerformanceProfilerService);
  private readonly modelPreview = inject(ModelPreviewService);
  private readonly strategicPlacement = inject(StrategicPlacementService);
  private readonly botClient = inject(BotClientService);
  private readonly gameStateSync = inject(GameStateSyncService);
  private readonly runLog = inject(RunLogFacade);
  private readonly waveDirector = inject(WaveDirector);
  private readonly refusals = inject(RefusalHintService);
  private readonly onboarding = inject(OnboardingService);
  private readonly bestWaves = inject(BestWaveService);
  private readonly sim = inject(SimClient);
  private readonly mirror = inject(SimMirror);
  private readonly presentation = inject(PresentationService);
  private readonly los = inject(TowerLosRegistry);
  private readonly grid = inject(GlobalRouteGridService);
  private readonly world = inject(MainWorldService);
  private readonly gridViz = inject(RouteGridVizService);

  /** Component bridge - set via initialize(). Non-null after initEffects(). */
  private bridge!: FacadeComponentBridge;

  /** Whether the facade has been initialized via initEffects() */
  private initialized = false;

  /** EventBus subscription bag, cleaned up in dispose() */
  private readonly eventBusSubs = new SubscriptionBag();

  /** Pending auto-restart timeout (bot mode), cleared in dispose() */
  private autoRestartTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Initialize the facade with component bridge, game state, and injector.
   */
  private initialize(bridge: FacadeComponentBridge, injector: Injector): void {
    this.bridge = bridge;
    this.initialized = true;

    // The simulation's worker starts with the game (docs/SIM_WORKER.md); it
    // runs no sub-step until the first world is sent (MainWorldService)
    this.sim.attach(this.mirror, null);
    this.sim.start();

    // Initialize sub-facades
    this.gameLoopFacade.initialize(bridge);
    this.locationFacade.initialize(bridge, injector);
    this.vizFacade.initialize(bridge);
  }

  // ══════════════════════════════════════════════════════════════
  // Effects & Game Startup
  // ══════════════════════════════════════════════════════════════

  /**
   * Create Angular effects that were previously in the component constructor.
   * Delegates effect creation to sub-facades.
   */
  initEffects(component: { getFacadeBridge: () => FacadeComponentBridge; injector: Injector }): void {
    this.initialize(component.getFacadeBridge(), component.injector);

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
      initializeVisualizationServices: () => this.vizFacade.initializeVisualizationServices(),
      reframeCameraWithRoutes: () => this.vizFacade.reframeCameraWithRoutes(),
      renderStreets: () => this.vizFacade.renderStreets(),
      saveInitialCameraPosition: () => this.vizFacade.saveInitialCameraPosition(),
      buildCorridor: (reason, report) => this.vizFacade.buildCorridor(reason, report),
    });

    // Initialize the bot client
    this.botClient.initialize({
      towerPlacement: this.towerPlacement,
      strategicPlacement: this.strategicPlacement,
      // The bot sends its run log to the server; the log itself is the data
      runLog: {
        current: () => this.runLog.current(),
        drain: () => this.runLog.collector.drain(),
        endRun: () => this.runLog.endRun(),
      },
      callbacks: {
        startWave: () => this.gameLoopFacade.readyOrStartWave(),
        restartGame: (seed) => this.restartGame(seed),
      }
    });

    const params = new URLSearchParams(window.location.search);
    const botMode = params.get('bot');
    // The sheets rendered ahead are baked in this page (tools/preview-sheets/bake.ts, TODO E76)
    if (params.has('previewsheets')) installPreviewSheetHook(this.modelPreview);

    if (this.devWorld.isActive && botMode === 'coop') {
      // One seat of a coop room (e2e/coop-bots): no bot server, whose
      // controls and restarts belong to single player runs. The bot waits for
      // the room's game (BotSignals.botCoop).
      this.store.directorEnabled.set(true);
      this.botClient.botCoop.set(true);
      this.botClient.enableBot('expert');
    } else if (this.devWorld.isActive && isBenchmarkSearch(window.location.search)) {
      // The in-game benchmark (TODO E74): no bot, no bot server
    } else if (this.devWorld.isActive) {
      this.store.directorEnabled.set(true);
      this.botClient.connectToBackend();
      // DevWorld exists to train against the backend, so the bot runs waves on
      // its own unless explicitly told not to (`?bot=manual`). Requiring
      // `?bot=auto` on top of `?devworld` was a silent trap: the bot built
      // towers, never started a wave, and the run produced no training data at
      // all while still looking connected and healthy on the dashboard.
      this.botClient.botAutoMode.set(botMode !== 'manual');
      // ...and it plays on its own too. Waiting for the dashboard's `start`
      // meant a tab that reloaded, whether by hand or via the `reload` control
      // command, sat in setup forever: `start` had already been broadcast, and
      // nothing broadcasts it again. `enableBot` is safe to call before
      // `initialize()`; it queues the request until the factory exists.
      if (botMode !== 'manual') {
        this.botClient.enableBot('expert');
      }
    } else if (botMode === 'auto') {
      this.botClient.botAutoMode.set(true);
    }

    // Start main theme music as early as possible (uses HTMLAudioElement, no engine needed)
    BackgroundMusicService.playMainTheme(this.uiStore.effectiveMusicVolume());

    // Location detection (delegated to LocationFacade). Without a location
    // (component gone, location dialog did not load) there is nothing to start.
    if (!(await this.locationFacade.initializeLocation())) return;

    // Engine initialization
    await this.initEngineSequence(canvas);
  }

  /**
   * Full cleanup: dispose engine, pool, preview, animations, sub-facades, EventBus subs.
   */
  dispose(): void {
    if (this.autoRestartTimeout !== null) {
      clearTimeout(this.autoRestartTimeout);
      this.autoRestartTimeout = null;
    }
    this.eventBusSubs.disposeAll();
    this.gameStateSync.dispose();
    this.onboarding.disconnect();
    this.bestWaves.disconnect();
    this.refusals.disconnect();
    uiSound.disconnect();
    this.los.detach();
    this.sim.setPresenter(null);
    this.dropPresentation();
    this.sim.stop();
    this.mirror.clear();
    this.gameLoopFacade.dispose();
    this.locationFacade.dispose();
    this.vizFacade.dispose();

    this.modelPreview.dispose();

    if (this.initialized) {
      // Every overlay, the reach marker and the scene of this engine
      this.gridViz.dispose();

      const engine = this.bridge.getEngine();
      if (engine) {
        engine.dispose();
        this.bridge.setEngine(null);
      }
    }

    this.initialized = false;
  }

  /** The presentation of the engine going away: detached from the UI's handle, its services off the bus. */
  private dropPresentation(): void {
    const old = this.presentation.host;
    if (!old) return;
    this.presentation.detach(old);
    old.destroy();
  }

  // ══════════════════════════════════════════════════════════════
  // Engine Initialization
  // ══════════════════════════════════════════════════════════════

  /**
   * Initialize Three.js rendering engine with full callback wiring.
   */
  private async initEngineSequence(canvas: HTMLCanvasElement): Promise<void> {
    try {
      const tileProvider = this.configService.tileProvider();
      const cesiumToken = this.configService.cesiumIonToken();
      const cesiumAssetId = this.configService.cesiumAssetId();
      const googleMapsApiKey = this.configService.googleMapsApiKey();

      // Missing credentials are normally caught before startGame and answered
      // with the token screen. Reaching this branch means something started the
      // engine anyway, so fail loudly rather than into an endless loading state.
      if (tileProvider === 'google' && !googleMapsApiKey) {
        this.engineInit.setError('No Google Maps API key configured.');
        this.engineInit.setLoading(false);
        return;
      }
      if (tileProvider === 'cesium' && !cesiumToken) {
        this.engineInit.setError('No Cesium Ion token configured.');
        this.engineInit.setLoading(false);
        return;
      }

      const base = this.store.baseCoords();
      this.engineInit.configure(canvas, cesiumToken, cesiumAssetId, { lat: base.lat, lon: base.lon }, tileProvider, googleMapsApiKey);
      // The streets load while the engine is built and the tiles stream (TODO H13); onLoadStreets takes it
      const center = this.store.centerCoords();
      this.engineInit.prefetchStreets(center.lat, center.lon);

      await this.engineInit.initEngine({
        onLoadStreets: () => this.loadStreetsInternal(),
        onInitializeServices: () => this.vizFacade.initializeVisualizationServices(),
        onAddBaseMarker: () => this.vizFacade.addBaseMarker(),
        onAddPredefinedSpawns: () => this.locationFacade.addPredefinedSpawns(),
        onInitializeGameState: () => this.initializeGameStateInternal(),
        onScheduleHeightUpdate: () => this.vizFacade.scheduleOverlayHeightUpdate(),
        onSetupClickHandler: () => this.vizFacade.setupClickHandlerWithGameState(),
        onCheckAllLoaded: () => this.vizFacade.checkAllLoaded(),
      });

      const engine = this.engineInit.getEngine();
      this.bridge.setEngine(engine);

      if (engine) {
        engine.setOnTilesLoadCallback(() => this.vizFacade.onTilesLoaded());
        // A rejected token, or a tile server out of reach, surfaces here rather
        // than as a stuck loading screen; only the token goes to its screen
        engine.setOnAuthErrorCallback((failure) => {
          this.engineInit.setLoading(false);
          if (failure === 'credentials') this.configService.reportCredentialsRejected();
          else this.uiStore.notice.set({ text: TILES_UNREACHABLE, reload: true });
        });
        engine.setOnUpdateCallback((deltaTime) => this.gameLoopFacade.onEngineUpdate(deltaTime));

        // A training tab spends its life in the background. Chrome freezes
        // requestAnimationFrame in hidden tabs completely, so without this the
        // whole run stops the moment the window loses visibility, while the
        // once-a-second status push keeps reporting the client as healthy.
        // The normal game keeps the browser's throttling; it should not run
        // when nobody is watching.
        engine.renderLoop.setBackgroundLoopEnabled(this.devWorld.isActive);

        // Fix race condition: if tiles loaded during initEngine() before the
        // onTilesLoadCallback was set, the route refresh was skipped.
        // Trigger it manually now that everything is wired up.
        if (!this.engineInit.tilesLoading()) {
          this.vizFacade.onTilesLoaded();
        }

        // The look and sound of the simulation on this engine: the packets'
        // ops and tables, the main bus's events (docs/SIM_WORKER.md)
        this.dropPresentation();
        const host = new PresentationHost({ engine, bus: this.sim.bus, source: this.mirror, ground: this.grid });
        this.presentation.attach(host);
        this.sim.setPresenter(host);
        // Lines of sight render here on the simulation's request
        this.los.attach(engine);
        // The route grid's debug overlays (layer menu) and the defense reach
        // marker draw into this scene; the simulation's GameStateManager did
        // this before it moved into the worker
        this.gridViz.initDebugViz(engine.getScene(), engine.portalClip);

        const eventBus = this.sim.bus;
        engine.spatialAudio.setEventBus(eventBus);
        this.soundDebug.subscribeToEventBus(eventBus);

        this.debugFacade.setEngine(engine);
        this.debugFacade.applyDisplayOptions();
        // Its timers (worker parts, frame) run only while the perf panel is
        // open: PerformanceDebuggerComponent calls setProfilingActive
        this.profiler.setEngine(engine);
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

    // The simulation's events into the stores (SimClient.bus → Store signals)
    this.gameStateSync.initialize();
    // The run log listens to the same bus and opens the run (docs/RUN_LOG.md)
    // `botAutoMode` as well as `botEnabled`: the bot module loads on demand,
    // and until it is there `botEnabled` is still false although the tab was
    // opened to play bot runs. The first run of every tab was written as a
    // human one and would have landed in the players' numbers.
    this.runLog.initialize(() =>
      this.botClient.botEnabled() || this.botClient.botAutoMode()
        ? { player: 'bot', botSkill: this.botClient.botSkillLevel() }
        : { player: 'human' },
      () => this.waveDirector.source.id,
    );
    // First-run tips follow the same events
    this.onboarding.connect(this.sim.bus);
    // Best wave per place for the world map; runs the bot plays and coop runs (review R16) do not count,
    // nor one that went on alone after the relay was lost (the partner stays in the run, PLAYTEST T38)
    this.bestWaves.connect(this.sim.bus, () => !this.botClient.botEnabled() && this.mirror.scalars.players.length === 1);
    // Refused hires and abilities in the context hint box; the bot's commands get none
    this.refusals.connect(this.sim.bus, () => !this.botClient.botEnabled());
    uiSound.connect(() => this.bridge.getEngine()?.spatialAudio ?? null);

    // Let sub-facades subscribe to their own EventBus events
    this.vizFacade.subscribeToEventBus();
    this.gameLoopFacade.subscribeToEventBus({
      onGameOverExtra: () => {
        this.botClient.resetBot();
        if (this.botClient.botAutoMode()) {
          this.autoRestartTimeout = setTimeout(() => {
            this.autoRestartTimeout = null;
            this.restartGame();
          }, 2000);
        }
      },
    });

    return result;
  }

  // ══════════════════════════════════════════════════════════════
  // Public API, Delegates to sub-facades
  // ══════════════════════════════════════════════════════════════

  /** Start a new wave (manual or AI-directed). */
  startWave(): void {
    this.gameLoopFacade.startWave();
  }

  /** Start a custom wave using debug panel settings. */
  startCustomWave(): void {
    this.gameLoopFacade.startCustomWave();
  }

  /** Upgrade a tower with the specified upgrade. */
  upgradeTower(tower: Tower, upgradeId: UpgradeId): boolean {
    return this.gameLoopFacade.upgradeTower(tower, upgradeId);
  }

  /** Restart game; `seed` for the new run (a bot run's config), else a fresh one. */
  restartGame(seed?: number): void {
    this.gameLoopFacade.restartGame(() => this.vizFacade.cleanupDpsVisualization(), seed);
  }

  /** Start map placement mode for HQ or Spawn. */
  startMapPlacement(mode: 'hq' | 'spawn', add = false, move: number | null = null): void {
    this.towerPlacement.exitBuildMode();
    this.locationFacade.startMapPlacement(mode, add, move);
  }

  /** Handle map placement click (delegates to LocationFacade). */
  handleMapPlacementClick(lat: number, lon: number, height: number): void {
    this.locationFacade.handleMapPlacementClick(lat, lon, height);
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

  /** Toggle building footprints visibility. */
  onBuildingsToggled(): void {
    this.vizFacade.onBuildingsToggled();
  }

  /** Toggle street rendering visibility. */
  onStreetsToggled(): void {
    this.vizFacade.onStreetsToggled();
  }

  /** Toggle route lines visibility. */
  onRoutesToggled(): void {
    this.vizFacade.onRoutesToggled();
  }

  /** Toggle special points debug. */
  onSpecialPointsDebugToggled(): void {
    this.vizFacade.onSpecialPointsDebugToggled();
  }

  /** Play route animation. */
  onPlayRouteAnimation(): void {
    this.vizFacade.onPlayRouteAnimation();
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

  /** Sell the currently selected tower via EventBus command. */
  /** Whether this player may act on `tower`; a partner's is read only (TODO E39) */
  mayManage(tower: Tower): boolean {
    return this.mirror.mayManage(tower);
  }

  /** A player's research as it stands, for the coop view of a partner's tree (TODO E35) */
  researchSnapshotOf(playerId: string): ResearchSnapshot {
    return researchSnapshotOf(this.mirror.researchOf(playerId));
  }

  /** Calls `changed` whenever `playerId`'s research moves; returns the unsubscribe */
  watchResearchOf(playerId: string, changed: () => void): () => void {
    return watchResearchOf(this.sim.bus, playerId, changed);
  }

  sellSelectedTower(): void {
    const tower = this.store.selectedTower();
    if (tower) {
      this.sim.bus.emit({
        type: 'command:sell-tower',
        towerId: tower.id,
      });
    }
  }

  /** Toggle spatial grid debug visualization on the global route grid. */
  toggleSpatialGridDebug(): void {
    if (this.initialized) {
      this.gridViz.toggleSpatialGridDebug();
    }
  }

  /** Emit a command on the main bus; it goes to the simulation with the next tick. Used for research commands etc. */
  emitCommand(event: { type: string; [key: string]: unknown }): void {
    this.sim.bus.emit(event as Parameters<SimClient['bus']['emit']>[0]);
  }
}
