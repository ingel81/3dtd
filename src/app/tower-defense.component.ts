import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ElementRef,
  ViewChild,
  NgZone,
  signal,
  inject,
  computed,
  effect,
  HostListener,
  DestroyRef,
  ChangeDetectionStrategy,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ConfigService } from './core/services/config.service';
import { OsmStreetService, StreetNetwork } from './services/osm-street.service';
import { EntityPoolService } from './services/entity-pool.service';
import { ModelPreviewService } from './services/model-preview.service';
import { getAllEnemyTypes } from './models/enemy-types';
import { LocationDialogComponent } from './components/location-dialog/location-dialog.component';
import { GameSidebarComponent } from './components/game-sidebar/game-sidebar.component';
import { CompassComponent } from './components/compass/compass.component';
import { GameHeaderComponent } from './components/game-header/game-header.component';
import { CameraDebuggerComponent } from './components/debug-window/camera-debugger.component';
import { WaveDebuggerComponent } from './components/debug-window/wave-debugger.component';
import { SoundDebuggerComponent } from './components/debug-window/sound-debugger.component';
import { EventDebuggerComponent } from './components/debug-window/event-debugger.component';
import { DevWorldDebuggerComponent } from './devworld/devworld-debugger.component';
import { TrainingDebuggerComponent } from './components/debug-window/training-debugger.component';
import { TowerDebuggerComponent } from './components/debug-window/tower-debugger.component';
import { EnemyDebuggerComponent } from './components/debug-window/enemy-debugger.component';
import { DisplayOptionsComponent } from './components/debug-window/display-options.component';
import { QuickActionsComponent } from './components/quick-actions/quick-actions.component';
import { InfoOverlayComponent } from './components/info-overlay/info-overlay.component';
import { ContextHintComponent, HintItem } from './components/context-hint/context-hint.component';
import { DebugWindowService } from './services/debug-window.service';
import { WaveDebugService } from './services/wave-debug.service';
import { SoundDebugService } from './services/sound-debug.service';
import { TowerDebugService } from './services/tower-debug.service';
import { EnemyDebugService } from './services/enemy-debug.service';
import { DebugFacadeService } from './services/debug-facade.service';
import { LocationDialogData, LocationDialogResult, LocationConfig, FavoriteLocation } from './models/location.types';
// Refactoring services
import { GameUIStateService } from './services/game-ui-state.service';
import { CameraControlService } from './services/camera-control.service';
import { MarkerVisualizationService, SpawnPoint } from './services/marker-visualization.service';
import { PathAndRouteService } from './services/path-route.service';
import { InputHandlerService } from './services/input-handler.service';
import { TowerPlacementService } from './services/tower-placement.service';
import { LocationManagementService } from './services/location-management.service';
import { UrlLocationService } from './services/url-location.service';
import { HeightUpdateService } from './services/height-update.service';
import { EngineInitializationService } from './services/engine-initialization.service';
import { GeolocationService } from './services/geolocation.service';
import { WorldDiceService } from './services/world-dice.service';
import { DevWorldService, DEV_WORLD_ORIGIN } from './devworld/devworld.service';
import { DevStreetProvider } from './devworld/dev-street.provider';
import { CameraFramingService } from './services/camera-framing.service';
import { RouteAnimationService } from './services/route-animation.service';
import { KeyboardPanService } from './services/keyboard-pan.service';
import { StreetRenderingService } from './services/street-rendering.service';
import { LocationChangeCoordinatorService, LocationFlowDelegate, LocationChangeCallbacks } from './services/location-change-coordinator.service';
import { TowerDefenseFacadeService, FacadeComponentBridge } from './services/tower-defense-facade.service';
// New OO Game Engine imports
import { GameStateManager } from './managers/game-state.manager';
// Three.js Engine (new 3DTilesRendererJS-based)
import { ThreeTilesEngine } from './three-engine';
import { Vector3 } from 'three';
// Theme
import { TD_CSS_VARS } from './styles/td-theme';
// Tower config
import { TOWER_TYPES, getAllTowerTypes, TowerTypeId, UpgradeId } from './configs/tower-types.config';
import { Tower } from './entities/tower.entity';
// AI Wave Director (optional)
import { WaveDirectorService } from './ai/core/wave-director.service';
import { AIDataCollectorService } from './ai/core/ai-data-collector.service';
import { TrainingClientService } from './ai/training/training-client.service';
// AI Bot Training
import { BotSkillLevel } from './ai/training/bots/tower-bot.interface';
import { StrategicPlacementService } from './services/strategic-placement.service';

// Initial empty coords - will be set when location is loaded (using GeoPosition format)
const EMPTY_COORDS = {
  lat: 0,
  lon: 0,
};

const EMPTY_CENTER_COORDS = {
  lat: 0,
  lon: 0,
  height: 400,
};

@Component({
  selector: 'app-tower-defense',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    GameSidebarComponent,
    CompassComponent,
    GameHeaderComponent,
    CameraDebuggerComponent,
    WaveDebuggerComponent,
    SoundDebuggerComponent,
    EventDebuggerComponent,
    DevWorldDebuggerComponent,
    TrainingDebuggerComponent,
    TowerDebuggerComponent,
    EnemyDebuggerComponent,
    DisplayOptionsComponent,
    QuickActionsComponent,
    InfoOverlayComponent,
    ContextHintComponent,
  ],
  providers: [
    GameStateManager,
    EntityPoolService,
    ModelPreviewService,
    // AI services (optional - game works without them)
    AIDataCollectorService,
    WaveDirectorService,
    TrainingClientService,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tower-defense.component.html',
  styleUrls: ['./tower-defense.component.scss'],
  styles: [`
    :host {
      display: contents;
      ${TD_CSS_VARS}
    }
  `],
})
export class TowerDefenseComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('gameCanvas') gameCanvas!: ElementRef<HTMLCanvasElement>;

  private readonly dialogRef = inject(MatDialogRef<TowerDefenseComponent>, { optional: true });
  private readonly dialog = inject(MatDialog);
  private readonly ngZone = inject(NgZone);
  private readonly osmService = inject(OsmStreetService);
  private readonly configService = inject(ConfigService);
  readonly gameState = inject(GameStateManager);
  private readonly entityPool = inject(EntityPoolService);
  private readonly modelPreview = inject(ModelPreviewService);

  // Refactoring services
  private readonly uiState = inject(GameUIStateService);
  private readonly cameraControl = inject(CameraControlService);
  private readonly markerViz = inject(MarkerVisualizationService);
  private readonly pathRoute = inject(PathAndRouteService);
  private readonly inputHandler = inject(InputHandlerService);
  private readonly towerPlacement = inject(TowerPlacementService);
  private readonly locationMgmt = inject(LocationManagementService);
  private readonly urlLocation = inject(UrlLocationService);
  private readonly heightUpdate = inject(HeightUpdateService);
  private readonly engineInit = inject(EngineInitializationService);
  private readonly cameraFraming = inject(CameraFramingService);
  private readonly routeAnimation = inject(RouteAnimationService);
  private readonly keyboardPan = inject(KeyboardPanService);
  private readonly geolocation = inject(GeolocationService);
  private readonly worldDice = inject(WorldDiceService);
  private readonly streetRendering = inject(StreetRenderingService);
  private readonly locationCoordinator = inject(LocationChangeCoordinatorService);
  private readonly devWorld = inject(DevWorldService);
  readonly facade = inject(TowerDefenseFacadeService);

  // Debug services
  readonly debugWindows = inject(DebugWindowService);
  readonly waveDebug = inject(WaveDebugService);
  readonly soundDebug = inject(SoundDebugService);
  private readonly towerDebug = inject(TowerDebugService);
  readonly enemyDebug = inject(EnemyDebugService);
  readonly debugFacade = inject(DebugFacadeService);

  // AI Wave Director
  private readonly waveDirector = inject(WaveDirectorService);
  private readonly trainingClient = inject(TrainingClientService);
  private readonly aiDataCollector = inject(AIDataCollectorService);

  // AI Bot Training (delegated to TrainingClientService)
  private readonly strategicPlacement = inject(StrategicPlacementService);
  // Expose bot signals from service for template bindings
  readonly botEnabled = this.trainingClient.botEnabled;
  readonly botSkillLevel = this.trainingClient.botSkillLevel;
  readonly botStats = this.trainingClient.botStats;
  readonly botAutoMode = this.trainingClient.botAutoMode;

  // Cleanup
  private readonly destroyRef = inject(DestroyRef);

  // Expose Math and tower config for template
  readonly Math = Math;
  readonly archerTowerConfig = TOWER_TYPES.archer;
  readonly towerTypes = getAllTowerTypes();

  private engine: ThreeTilesEngine | null = null;
  private streetNetwork: StreetNetwork | null = null;
  private devStreetProvider: DevStreetProvider | null = null;
  private filteredStreetNetwork: StreetNetwork | null = null; // Filtered to route corridor for rendering
  private streetNetworkLocation: { lat: number; lon: number } | null = null; // Tracks loaded location to avoid double-loading
  private readonly COORD_EPSILON = 0.0001; // ~11m tolerance for coordinate comparison

  // Proxy signals from services for template compatibility
  readonly loading = this.engineInit.loading;
  readonly tilesLoading = this.engineInit.tilesLoading;
  readonly osmLoading = this.engineInit.osmLoading;
  readonly heightsLoading = this.heightUpdate.heightsLoading;
  readonly heightProgress = this.heightUpdate.heightProgress;
  readonly error = this.engineInit.error;
  readonly loadingStatus = this.engineInit.loadingStatus;
  readonly loadingSteps = this.engineInit.loadingSteps;
  readonly streetsVisible = this.uiState.streetsVisible;
  readonly routesVisible = this.uiState.routesVisible;
  readonly debugMode = this.uiState.debugMode;
  readonly heightDebugVisible = this.debugFacade.heightDebugVisible;
  readonly fps = this.uiState.fps;
  readonly tileStats = this.uiState.tileStats;
  readonly mapAttribution = this.uiState.mapAttribution;
  readonly debugLog = this.debugFacade.debugLog;
  readonly buildMode = this.towerPlacement.buildMode;
  readonly selectedTowerType = this.towerPlacement.selectedTowerType;
  readonly editableHqLocation = this.locationMgmt.editableHqLocation;
  readonly editableSpawnLocations = this.locationMgmt.editableSpawnLocations;
  readonly isApplyingLocation = this.locationMgmt.isApplyingLocation;
  readonly favorites = this.locationMgmt.favorites;
  readonly favoriteNamesMap = this.locationCoordinator.favoriteNamesMap;
  // Camera & debug signals (delegated to GameUIStateService)
  readonly cameraHeading = this.uiState.cameraHeading;
  readonly compassRotation = this.uiState.compassRotation;
  readonly cameraFramingDebug = signal(false); // Debug visualization for camera framing
  readonly cameraDebugEnabled = this.uiState.cameraDebugEnabled;
  readonly cameraDebugInfo = this.uiState.cameraDebugInfo;
  // Wave debug settings (proxied from WaveDebugService for backwards compatibility)
  readonly enemySpeed = this.waveDebug.enemySpeed;
  readonly enemyHealth = this.waveDebug.enemyHealth;
  readonly streetCount = this.waveDebug.streetCount;
  readonly enemyCount = this.waveDebug.enemyCount;
  readonly enemyType = this.waveDebug.enemyType;
  readonly enemyTypes = getAllEnemyTypes();
  readonly spawnMode = this.waveDebug.spawnMode;
  readonly spawnDelay = this.waveDebug.spawnDelay;
  readonly spawnPoints = signal<SpawnPoint[]>([]);
  // AI Director mode - uses AI to generate waves instead of debug settings
  readonly useAIDirector = signal(false);
  readonly aiExplanation = signal<string | null>(null);
  readonly baseCoords = signal(EMPTY_COORDS);
  readonly centerCoords = signal(EMPTY_CENTER_COORDS);
  readonly isDevWorldRegenerating = signal(false);

  readonly waveActive = computed(() => this.gameState.phase() === 'wave');
  readonly isGameOver = computed(() => this.gameState.phase() === 'gameover');
  readonly currentEnemyConfig = this.waveDebug.currentEnemyConfig;

  // Build mode hints for context hint box
  readonly buildModeHints: HintItem[] = [
    { key: 'R', description: 'Rotate' },
    { key: 'Click', description: 'Build' },
    { key: 'ESC', description: 'Cancel' },
    { key: 'Wait', description: 'Line of Sight' },
  ];
  readonly buildModeWarning = computed(() => this.towerPlacement.validationReason());

  // Location name for header display - delegates to service for consistent formatting
  readonly currentLocationName = computed(() => this.locationMgmt.getLocationDisplayName());
  readonly activeSounds = this.uiState.activeSounds;

  // Tile stats polling is managed by EngineInitializationService

  constructor() {
    // Effect: Update all existing enemies when speed changes
    effect(() => {
      const speed = this.enemySpeed();
      for (const enemy of this.gameState.enemyManager.getAll()) {
        enemy.movement.speedMps = speed;
      }
    });

    // Effect: Sync wave debug state with game state
    effect(() => {
      const waveActive = this.waveActive();
      const baseHealth = this.gameState.baseHealth();
      const enemiesAlive = this.gameState.enemiesAlive();
      this.waveDebug.syncWaveState(waveActive, baseHealth, enemiesAlive);
    });

    // Effect: Auto-enable AI Director when ONNX model loads successfully
    effect(() => {
      const state = this.waveDirector.modelState();
      if (state === 'ready' && !this.useAIDirector()) {
        this.useAIDirector.set(true);
        console.log('[AI] AI Director auto-enabled (model loaded)');
      }
    });

    // Effect: Sync tower debug "Show Shoot Height" to renderer
    effect(() => {
      const showShootHeight = this.towerDebug.showShootHeight();
      if (this.engine) {
        this.engine.towers.setShowShootHeight(showShootHeight);
      }
    });

    // Effect: Apply tower debug overrides to renderer (live updates)
    effect(() => {
      const allOverrides = this.towerDebug.allOverrides();
      if (!this.engine) return;

      // Apply overrides to all tower types
      for (const typeId of Object.keys(allOverrides) as TowerTypeId[]) {
        const overrides = allOverrides[typeId];
        this.engine.towers.applyDebugOverrides(typeId, overrides);
      }
    });

    // Effect: Start paused debug enemies when wave starts
    effect(() => {
      const phase = this.gameState.phase();
      if (phase === 'wave') {
        // Start all paused debug enemies
        for (const de of this.enemyDebug.debugEnemies()) {
          if (de.enemy.movement.paused && de.enemy.alive) {
            de.enemy.startMoving();
            this.engine?.enemies.startWalkAnimation(de.id);
          }
        }
      }
    });

    // Effect: Apply debug overrides to selected enemy (live update)
    effect(() => {
      const selected = this.enemyDebug.selectedDebugEnemy();
      if (!selected || !this.engine) return;

      // Apply visual overrides to renderer (including animationSpeed so update() respects it)
      this.engine.enemies.applyDebugOverrides(selected.id, {
        scale: selected.overrides.scale,
        heightOffset: selected.overrides.heightOffset,
        healthBarOffset: selected.overrides.healthBarOffset,
        rotation: selected.overrides.rotation,
        animationSpeed: selected.overrides.animationSpeed,
      });

      // Apply speed to enemy entity
      selected.enemy.movement.speedMps = selected.overrides.baseSpeed;
    });

  }

  ngOnInit(): void {
    // Initialize facade with component bridge
    this.facade.initialize(this.buildFacadeBridge());

    // Initialize location flow delegate (for dialog, favorites, world dice)
    this.locationCoordinator.initializeFlow(this.buildLocationFlowDelegate());

    // Initialize training client with dependencies
    this.trainingClient.initialize({
      gameState: this.gameState,
      towerPlacement: this.towerPlacement,
      strategicPlacement: this.strategicPlacement,
      osmService: this.osmService,
      callbacks: {
        startWave: () => this.startWave(),
        upgradeTower: (tower, upgradeId) => this.upgradeTower(tower, upgradeId),
        restartGame: () => this.restartGame(),
      }
    });

    // Check for bot=auto URL parameter BEFORE enabling features
    const params = new URLSearchParams(window.location.search);
    if (params.has('bot')) {
      const botMode = params.get('bot');
      if (botMode === 'auto') {
        this.trainingClient.botAutoMode.set(true);
        console.log('[Bot] Auto-mode enabled from URL parameter (will auto-start waves)');
      }
    }

    // Auto-enable AI features in DevWorld mode
    if (this.devWorld.isActive) {
      // Auto-enable AI Director in DevWorld mode
      this.useAIDirector.set(true);
      console.log('[AI] AI Director enabled for DevWorld');

      // Try to connect to training backend (non-blocking)
      this.trainingClient.connectToBackend();
    }
  }

  /**
   * Sync URL with current location (without reload)
   * Skipped in DevWorld mode to preserve devworld URL parameters
   */
  private syncUrlWithLocation(): void {
    // DevWorld: Don't modify URL (preserve ?devworld&terrain=... params)
    if (this.devWorld.isActive) return;

    const hq = this.locationMgmt.hq();
    if (!hq) return; // No location set yet
    const spawns = this.locationMgmt.spawns();
    this.urlLocation.updateUrl(hq, spawns);
  }

  async ngAfterViewInit(): Promise<void> {
    // First: Determine location (with geolocation cascade if no URL params)
    await this.initializeLocation();

    // Then: Initialize the 3D engine
    this.initEngine();
  }

  /**
   * Initialize location from URL or geolocation cascade
   * Shows as first loading step: "Determining Location"
   * Opens location dialog if no location can be determined
   */
  private async initializeLocation(): Promise<void> {
    await this.engineInit.setStepActive('location');

    // DevWorld mode: Use fake origin, skip real location
    if (this.devWorld.isActive) {
      console.log('[TowerDefense] DevWorld mode - using fake origin');
      this.locationMgmt.setLocation(
        { lat: DEV_WORLD_ORIGIN.lat, lon: DEV_WORLD_ORIGIN.lon },
        [] // Spawns will be added later from DevStreetProvider
      );
      this.baseCoords.set({ lat: DEV_WORLD_ORIGIN.lat, lon: DEV_WORLD_ORIGIN.lon });
      this.centerCoords.set({ lat: DEV_WORLD_ORIGIN.lat, lon: DEV_WORLD_ORIGIN.lon, height: 400 });
      await this.engineInit.setStepDone('location', 'DevWorld');
      return; // Skip URL sync - keep ?devworld in URL
    }

    // URL is source of truth
    const urlData = this.urlLocation.parseFromUrl();

    if (urlData) {
      // URL has location → use it (skip geolocation)
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
        // No location found - open dialog and wait for user selection
        this.engineInit.updateStepDetail('location', 'Select location...');
        await this.waitForLocationFromDialog();
        await this.engineInit.setStepDone('location', 'manually selected');
      }
    }

    // Sync URL with current location (only if location is set)
    const hq = this.locationMgmt.hq();
    if (hq) {
      this.syncUrlWithLocation();
      this.baseCoords.set({ lat: hq.lat, lon: hq.lon });
      this.centerCoords.set({ lat: hq.lat, lon: hq.lon, height: 400 });
    }
  }

  /**
   * Open location dialog and wait for user to select a location
   * Used when no location can be determined automatically
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
        disableClose: true, // User must select a location
      });

      dialogRef.afterClosed()
        .pipe(takeUntilDestroyed(this.destroyRef))
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
   * Keyboard event handlers - delegates to InputHandlerService.
   * @HostListener decorators must stay on the component (Angular requirement).
   */
  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    this.inputHandler.handleKeyDown(event);
  }

  @HostListener('window:keyup', ['$event'])
  onKeyUp(event: KeyboardEvent): void {
    this.inputHandler.handleKeyUp(event);
  }

  @HostListener('window:blur')
  onWindowBlur(): void {
    this.inputHandler.handleWindowBlur();
  }

  /**
   * Exit build mode cleanly - calls service method that handles all cleanup
   */
  private exitBuildMode(): void {
    this.towerPlacement.exitBuildMode();
  }

  ngOnDestroy(): void {
    this.entityPool.destroy();
    this.modelPreview.dispose();
    this.routeAnimation.dispose();

    // Cleanup global route grid visualization
    this.gameState.getGlobalRouteGrid().cleanupSpatialGridVisualization();

    // Cleanup DPS profile visualization (owned by facade)
    this.facade.disposeDpsVisualization(this.engine);

    if (this.engine) {
      this.engine.dispose();
      this.engine = null;
      this.trainingClient.setEngine(null);
    }
  }

  /**
   * Initialize Three.js rendering engine - delegates to EngineInitializationService
   */
  private async initEngine(): Promise<void> {
    try {
      // Get Cesium Ion credentials
      const cesiumToken = this.configService.cesiumIonToken();
      const cesiumAssetId = this.configService.cesiumAssetId();
      if (!cesiumToken) {
        this.engineInit.setError('Please configure your Cesium Ion Token in environment.ts.');
        this.engineInit.setLoading(false);
        return;
      }

      // Configure engine initialization service
      const canvas = this.gameCanvas.nativeElement;
      const base = this.baseCoords();
      this.engineInit.configure(canvas, cesiumToken, cesiumAssetId, { lat: base.lat, lon: base.lon });

      // Initialize engine via service
      await this.engineInit.initEngine({
        onLoadStreets: () => this.loadStreets(),
        onInitializeServices: () => this.initializeVisualizationServices(),
        onAddBaseMarker: () => this.markerViz.addBaseMarker(),
        onAddPredefinedSpawns: () => this.addPredefinedSpawns(),
        onInitializeGameState: () => this.initializeGameState(),
        onScheduleHeightUpdate: () => this.scheduleOverlayHeightUpdate(),
        onSetupClickHandler: () => this.setupClickHandler(),
        onCreateBuildPreview: () => this.createBuildPreview(),
        onSaveInitialCameraPosition: () => this.saveInitialCameraPosition(),
        onCheckAllLoaded: () => this.checkAllLoaded(),
      });

      // Get engine reference
      this.engine = this.engineInit.getEngine();
      this.trainingClient.setEngine(this.engine);

      // Register callbacks
      if (this.engine) {
        this.engine.setOnTilesLoadCallback(() => this.onTilesLoaded());
        this.engine.setOnUpdateCallback((deltaTime) => this.onEngineUpdate(deltaTime));

        // Connect sound debug service via EventBus
        const eventBus = this.gameState.getEventBus();
        this.engine.spatialAudio.setEventBus(eventBus);
        this.soundDebug.subscribeToEventBus(eventBus);

        // Set engine on debug facade and apply saved display options
        this.debugFacade.setEngine(this.engine, this.gameState);
        this.debugFacade.applyDisplayOptions();
      }

    } catch (err) {
      console.error('[TD] Engine init error:', err);
      this.engineInit.setError(err instanceof Error ? err.message : 'Error loading 3D map');
      this.engineInit.setLoading(false);
    }
  }

  /**
   * Check if all loading is complete - delegates to EngineInitializationService
   */
  private checkAllLoaded(): void {
    const wasLoading = this.loading();
    const isApplying = this.isApplyingLocation();

    this.engineInit.checkAllLoaded(this.heightUpdate.heightsLoading);
    const isNowLoading = this.loading();

    // Start route animation when loading completes (transition from true to false)
    // BUT NOT if we're in the middle of applying a new location!
    if (wasLoading && !isNowLoading && !this.routeAnimation.isRunning() && !isApplying) {
      const cachedPaths = this.pathRoute.getCachedPaths();
      if (cachedPaths.size > 0) {
        this.routeAnimation.startAnimation(cachedPaths, this.spawnPoints());
      }
    }
  }

  /**
   * Initialize visualization services — delegates to facade
   */
  private initializeVisualizationServices(): void {
    this.facade.initializeVisualizationServices();
  }

  /**
   * Setup click handler — delegates to facade
   */
  private setupClickHandler(): void {
    this.facade.setupClickHandlerWithGameState(this.gameState);
  }

  /**
   * Handle terrain click in build mode - directly places tower
   */
  private onTerrainClick(_lat: number, _lon: number, _height: number): void {
    // Position is already tracked internally by towerPlacement
    this.towerPlacement.handleBuildClick();
  }

  /**
   * Handle mouse move in build mode (for build preview)
   */
  private onMouseMove(lat: number, lon: number, hitPoint: Vector3): void {
    const terrainHeight = this.engine?.getTerrainHeightAtGeo(lat, lon) ?? hitPoint.y;
    this.towerPlacement.updatePreviewPosition(lat, lon, terrainHeight);
  }

  /**
   * Handle enemy placement from debug panel — delegated to EnemyDebugService
   */
  private handleEnemyPlacement(lat: number, lon: number, height: number): void {
    this.enemyDebug.handleEnemyPlacement(lat, lon, height);
  }

  /**
   * Remove a debug enemy — delegated to EnemyDebugService
   */
  onRemoveDebugEnemy(enemyId: string): void {
    this.enemyDebug.onRemoveDebugEnemy(enemyId);
  }

  /**
   * Clear all debug enemies — delegated to EnemyDebugService
   */
  onClearDebugEnemies(): void {
    this.enemyDebug.onClearDebugEnemies();
  }

  /**
   * Play idle animation for debug enemy — delegated to EnemyDebugService
   */
  onPlayIdleAnimation(enemyId: string): void {
    this.enemyDebug.onPlayIdleAnimation(enemyId);
  }

  /**
   * Play walk animation for debug enemy — delegated to EnemyDebugService
   */
  onPlayWalkAnimation(enemyId: string): void {
    this.enemyDebug.onPlayWalkAnimation(enemyId);
  }

  /**
   * Play run animation for debug enemy — delegated to EnemyDebugService
   */
  onPlayRunAnimation(enemyId: string): void {
    this.enemyDebug.onPlayRunAnimation(enemyId);
  }

  /**
   * Start movement for debug enemy — delegated to EnemyDebugService
   */
  onStartEnemyMovement(enemyId: string): void {
    this.enemyDebug.onStartEnemyMovement(enemyId);
  }

  /**
   * Stop movement for debug enemy — delegated to EnemyDebugService
   */
  onStopEnemyMovement(enemyId: string): void {
    this.enemyDebug.onStopEnemyMovement(enemyId);
  }

  onEnemiesToggled(visible: boolean): void {
    this.debugFacade.onEnemiesToggled(visible);
  }

  onHealthBarsToggled(visible: boolean): void {
    this.debugFacade.onHealthBarsToggled(visible);
  }

  onAnimationsToggled(enabled: boolean): void {
    this.debugFacade.onAnimationsToggled(enabled);
  }

  onMovementToggled(enabled: boolean): void {
    this.debugFacade.onMovementToggled(enabled);
  }

  /**
   * Create build preview callback (called early in initialization)
   * Actual initialization happens in initializeTowerPlacement() after all dependencies are ready
   */
  private createBuildPreview(): void {
    // No-op: TowerPlacementService is initialized in initializeTowerPlacement()
    // which is called after game state and spawn points are set up
  }

  /**
   * Initialize tower placement — delegates to facade
   */
  private initializeTowerPlacement(): void {
    this.facade.initializeTowerPlacement(this.gameState);
  }

  /**
   * Load street network (OSM for real world, DevStreetProvider for DevWorld)
   * @returns Street count
   */
  private async loadStreets(): Promise<number> {
    const center = this.centerCoords();
    const result = await this.engineInit.loadStreets(
      center.lat,
      center.lon,
      (network, count) => {
        this.streetNetwork = network;
        this.streetCount.set(count);
      },
    );
    this.streetNetwork = result.network;
    this.devStreetProvider = result.devStreetProvider;
    this.streetCount.set(result.count);
    return result.count;
  }

  /**
   * Initialize game state with routes — delegates to facade
   * @returns Route detail string
   */
  private initializeGameState(): string | undefined {
    // tower:selected event stays here (component-specific debug panel sync)
    const result = this.facade.initializeGameState(this.gameState);

    // Subscribe to tower:selected event - sync debug panel dropdown
    const eventBus = this.gameState.getEventBus();
    eventBus.on('tower:selected', (event) => {
      this.towerDebug.selectTower(event.tower.typeConfig.id);
    });

    return result;
  }

  /**
   * Filter street network to route corridor — delegates to facade
   */
  private filterStreetNetworkToRoutes(): void {
    this.facade.filterStreetNetworkToRoutes();
  }

  /**
   * Schedule overlay height updates — delegates to facade
   */
  private async scheduleOverlayHeightUpdate(): Promise<void> {
    await this.facade.scheduleOverlayHeightUpdate(this.gameState);
  }

  /**
   * Save initial camera position — delegates to facade
   */
  private saveInitialCameraPosition(): void {
    this.facade.saveInitialCameraPosition();
  }

  /**
   * Render streets — delegates to facade
   */
  private renderStreets(): void {
    this.facade.renderStreets();
  }



  /**
   * Toggle height debug visualization (just visibility, no re-render)
   */
  toggleHeightDebug(): void {
    this.debugFacade.toggleHeightDebug();
  }

  /**
   * Manually refresh terrain heights (re-raycast all overlays)
   * Useful when 3D tiles have loaded more detail since initial setup
   *
   * In DevWorld mode: Regenerates entire world with current config
   */
  refreshTerrainHeights(): void {
    this.facade.refreshTerrainHeights(this.gameState);
  }

  /**
   * Clear DevWorld visuals — delegates to facade
   */
  private clearDevWorldVisuals(): void {
    this.facade.clearDevWorldVisuals(this.gameState);
  }

  /**
   * DevWorld regenerated callback — delegates to facade
   */
  private onDevWorldRegenerated(devTerrainProvider: import('./devworld/dev-terrain.provider').DevTerrainProvider): void {
    this.facade.onDevWorldRegenerated(devTerrainProvider, this.gameState);
  }

  /**
   * Tiles loaded callback — delegates to facade
   */
  private onTilesLoaded(): void {
    this.facade.onTilesLoaded(this.gameState);
  }

  /**
   * Called each frame for animations (runs outside Angular zone)
   */
  private onEngineUpdate(deltaTime: number): void {
    const dtSec = deltaTime / 1000;

    // ── Per-frame delegation calls ──────────────────────────────
    this.towerPlacement.updateRotation(dtSec);
    this.towerPlacement.updatePreviewBuild();
    this.keyboardPan.update(dtSec);
    this.markerViz.animateMarkers(deltaTime);
    this.routeAnimation.update(deltaTime);

    // ── Game logic tick ─────────────────────────────────────────
    this.gameState.update(performance.now());

    // ── Bot update (if enabled) ─────────────────────────────────
    if (this.trainingClient.botEnabled()) {
      this.trainingClient.updateBot(this.aiDataCollector.getStateSnapshot(), deltaTime);
    }

    // ── Route grid visualization ────────────────────────────────
    const grid = this.gameState.getGlobalRouteGrid();
    if (grid.isSpatialGridVizVisible()) {
      grid.updateVisualization();
    }
    grid.updateAnimation(deltaTime);

    // ── Selected tower LOS animation ────────────────────────────
    const selectedTower = this.gameState.towerManager.getSelected();
    if (selectedTower?.losVisualization?.visible) {
      grid.updateTowerVisualizationTime(selectedTower.losVisualization);
    }

    // ── Throttled UI stats (~10Hz) ──────────────────────────────
    if (this.engine) {
      const soundDebugOpen = this.debugWindows.soundWindow().isOpen;
      this.ngZone.run(() => {
        this.uiState.updateThrottledStats({
          fps: this.engine!.getFPS(),
          tileStats: this.engine!.getTileStats(),
          activeSoundCount: this.engine!.spatialAudio.getActiveSoundCount(),
          attribution: this.engine!.getAttributions(),
          cameraHeading: this.cameraControl.getCameraHeading(),
          cameraDebugInfo: this.cameraControl.getCameraDebugInfo(),
          soundPoolStats: soundDebugOpen ? this.engine!.spatialAudio.getSoundPoolStats() : undefined,
          onSoundDebugUpdate: soundDebugOpen ? (stats: unknown) => this.soundDebug.updateStats(stats as any) : undefined,
        });
      });
    }
  }


  /**
   * Reframe camera with routes — delegates to facade
   */
  private reframeCameraWithRoutes(): void {
    this.facade.reframeCameraWithRoutes();
  }

  /**
   * Add predefined spawn points — delegates to facade
   */
  private addPredefinedSpawns(): number {
    return this.facade.addPredefinedSpawns();
  }

  /**
   * Add a spawn point — delegates to facade
   */
  addSpawnPoint(id: string, name: string, lat: number, lon: number, color: number): void {
    this.facade.addSpawnPoint(id, name, lat, lon, color);
  }

  /**
   * Toggle build mode - delegates to TowerPlacementService
   */
  toggleBuildMode(): void {
    this.towerPlacement.toggleBuildMode();
  }

  /**
   * Select a tower type and activate build mode - delegates to TowerPlacementService
   */
  selectTowerType(typeId: TowerTypeId): void {
    this.towerPlacement.selectTowerType(typeId);
  }

  /**
   * Sell the currently selected tower
   */
  sellSelectedTower(): void {
    const tower = this.gameState.selectedTower();
    if (tower) {
      this.gameState.getEventBus().emit({
        type: 'command:sell-tower',
        towerId: tower.id,
      });
    }
  }

  /**
   * Upgrade a tower — delegates to facade
   */
  upgradeTower(tower: Tower, upgradeId: UpgradeId): boolean {
    return this.facade.upgradeTower(tower, upgradeId, this.gameState);
  }

  /**
   * Start a new wave — delegates to facade
   */
  startWave(): void {
    this.facade.startWave(this.gameState);
  }

  /**
   * Toggle AI Director mode — delegates to facade
   */
  toggleAIDirector(): void {
    this.facade.toggleAIDirector();
  }

  /**
   * Start custom wave — delegates to facade
   */
  startCustomWave(): void {
    this.facade.startCustomWave(this.gameState);
  }

  /**
   * Get AI Director status text — delegates to facade
   */
  getAIStatusText(): string {
    return this.facade.getAIStatusText();
  }

  /**
   * Enable StrategyBot for automated training — delegates to TrainingClientService
   */
  enableBot(skillLevel: BotSkillLevel): void {
    this.trainingClient.enableBot(skillLevel);
  }

  /**
   * Disable StrategyBot — delegates to TrainingClientService
   */
  disableBot(): void {
    this.trainingClient.disableBot();
  }

  /**
   * Reset camera - delegates to CameraControlService
   */
  resetCamera(): void {
    this.cameraControl.resetCamera();
  }

  /**
   * Handle streets toggle side effect (visibility already toggled by QuickActionsComponent)
   */
  onStreetsToggled(): void {
    this.streetRendering.toggleVisibility();
  }

  /**
   * Handle routes toggle side effect (visibility already toggled by QuickActionsComponent)
   */
  onRoutesToggled(): void {
    this.pathRoute.toggleRouteLinesVisibility();
  }

  /**
   * Toggle special points debug (fire position markers, etc.)
   */
  onSpecialPointsDebugToggled(): void {
    this.markerViz.toggleSpecialPointsDebug();
  }

  /**
   * Toggle global route grid debug visualization
   * Shows cells along routes with color-coded LOS and enemy presence
   */
  onSpatialGridDebugToggled(): void {
    this.gameState.getGlobalRouteGrid().toggleSpatialGridDebug();
  }

  /**
   * Manually trigger route animation playback
   */
  onDpsBinsToggled(visible: boolean): void {
    this.facade.onDpsBinsToggled(visible, this.gameState);
  }

  onPlayRouteAnimation(): void {
    const cachedPaths = this.pathRoute.getCachedPaths();
    if (cachedPaths.size > 0) {
      this.routeAnimation.startAnimation(cachedPaths, this.spawnPoints());
    }
  }

  /**
   * Toggle camera framing debug — delegates to facade
   */
  toggleCameraFramingDebug(): void {
    this.facade.toggleCameraFramingDebug();
  }

  /**
   * Toggle camera debug — delegates to facade
   */
  toggleCameraDebug(): void {
    this.facade.toggleCameraDebug();
  }

  logCameraPosition(): void {
    if (!this.engine) return;
    this.debugFacade.logCameraPosition(this.engine, this.baseCoords());
  }


  killAllEnemies(): void {
    this.debugFacade.killAllEnemies(this.gameState);
  }

  addDebugCredits(): void {
    this.debugFacade.addDebugCredits(this.gameState);
  }

  addDebugHealth(): void {
    this.debugFacade.addDebugHealth(this.gameState);
  }

  clearDebugLog(): void {
    this.debugFacade.clearDebugLog();
  }

  appendDebugLog(message: string): void {
    this.debugFacade.appendDebugLog(message);
  }

  close(): void {
    this.dialogRef?.close();
  }

  get isDialog(): boolean {
    return !!this.dialogRef;
  }

  private onGameOver(): void {
    this.facade.onGameOver(this.gameState);
  }

  /**
   * Restart game — delegates to facade
   */
  restartGame(): void {
    this.facade.restartGame(this.gameState);
  }

  /**
   * Retry loading after an error during location change
   * Resets error state and retries with current coordinates
   */
  retryLoading(): void {
    // Clear error state
    this.engineInit.setError(null);

    // Clear cached network to force reload
    this.streetNetworkLocation = null;

    // Get current location from service
    const hq = this.editableHqLocation();
    const spawn = this.editableSpawnLocations()[0];

    if (hq && spawn) {
      // Retry with current location
      this.onApplyNewLocation({
        hq: { lat: hq.lat, lon: hq.lon, name: hq.name },
        spawn: { lat: spawn.lat, lon: spawn.lon, name: spawn.name },
      });
    } else {
      // No location - open location dialog
      this.openLocationDialog();
    }
  }


  // ==================== Location Settings Methods (delegates to LocationChangeCoordinatorService) ====================

  /** Apply new location - delegates to coordinator */
  async onApplyNewLocation(data: { hq: LocationConfig; spawn: LocationConfig }): Promise<void> {
    this.locationCoordinator.applyNewLocation(data);
  }

  /** Open location dialog */
  openLocationDialog(): void {
    this.locationCoordinator.openLocationDialog();
  }

  /** Copy shareable URL to clipboard */
  onShareLocation(): void {
    this.locationCoordinator.onShareLocation();
  }

  /** Roll for a random city */
  async onWorldDice(): Promise<void> {
    this.locationCoordinator.onWorldDice();
  }

  /** Save current location as favorite */
  onAddFavorite(): void {
    this.locationCoordinator.onAddFavorite();
  }

  /** Apply a favorite location */
  async onSelectFavorite(fav: FavoriteLocation): Promise<void> {
    this.locationCoordinator.onSelectFavorite(fav);
  }

  /** Delete a favorite */
  onDeleteFavorite(id: string): void {
    this.locationCoordinator.onDeleteFavorite(id);
  }

  /**
   * Build the FacadeComponentBridge for the TowerDefenseFacadeService.
   */
  private buildFacadeBridge(): FacadeComponentBridge {
    return {
      getEngine: () => this.engine,
      setEngine: (e) => { this.engine = e; },
      getStreetNetwork: () => this.streetNetwork,
      setStreetNetwork: (n) => { this.streetNetwork = n; },
      getDevStreetProvider: () => this.devStreetProvider,
      setDevStreetProvider: (p) => { this.devStreetProvider = p; },
      getFilteredStreetNetwork: () => this.filteredStreetNetwork,
      setFilteredStreetNetwork: (n) => { this.filteredStreetNetwork = n; },
      getStreetNetworkLocation: () => this.streetNetworkLocation,
      setStreetNetworkLocation: (l) => { this.streetNetworkLocation = l; },
      spawnPoints: this.spawnPoints,
      baseCoords: this.baseCoords,
      centerCoords: this.centerCoords,
      isDevWorldRegenerating: this.isDevWorldRegenerating,
      useAIDirector: this.useAIDirector,
      aiExplanation: this.aiExplanation,
      cameraFramingDebug: this.cameraFramingDebug,
      debugLog: this.debugLog,
      waveActive: this.waveActive,
      isGameOver: this.isGameOver,
      streetsVisible: this.streetsVisible,
      heightDebugVisible: this.heightDebugVisible,
      getCanvasElement: () => this.gameCanvas.nativeElement,
      onTerrainClick: (lat, lon, height) => this.onTerrainClick(lat, lon, height),
      onMouseMove: (lat, lon, hitPoint) => this.onMouseMove(lat, lon, hitPoint),
      exitBuildMode: () => this.exitBuildMode(),
      handleEnemyPlacement: (lat, lon, height) => this.handleEnemyPlacement(lat, lon, height),
      syncUrlWithLocation: () => this.syncUrlWithLocation(),
      appendDebugLog: (msg) => this.appendDebugLog(msg),
    };
  }

  /**
   * Build the LocationFlowDelegate for the coordinator service.
   * Provides component-specific state access for location flow operations.
   */
  private buildLocationFlowDelegate(): LocationFlowDelegate {
    return {
      getChangeContext: () => {
        if (!this.engine) return null;
        return {
          engine: this.engine,
          gameState: this.gameState,
          streetNetwork: this.streetNetwork,
          streetNetworkLocation: this.streetNetworkLocation,
          heightDebugVisible: this.heightDebugVisible,
        };
      },
      getChangeCallbacks: (): LocationChangeCallbacks => ({
        setBaseCoords: (c) => this.baseCoords.set(c),
        setCenterCoords: (c) => this.centerCoords.set(c),
        setSpawnPoints: (p) => this.spawnPoints.set(p),
        addSpawnPoint: (id, name, lat, lon, color) => this.addSpawnPoint(id, name, lat, lon, color),
        setStreetCount: (c) => this.streetCount.set(c),
        setStreetNetwork: (n) => { this.streetNetwork = n; },
        setStreetNetworkLocation: (l) => { this.streetNetworkLocation = l; },
        syncUrlWithLocation: () => this.syncUrlWithLocation(),
        clearMapEntities: () => this.clearMapEntities(),
        appendDebugLog: (msg) => this.appendDebugLog(msg),
        initializeTowerPlacement: () => this.initializeTowerPlacement(),
        filterStreetNetworkToRoutes: () => this.filterStreetNetworkToRoutes(),
        scheduleOverlayHeightUpdate: () => this.scheduleOverlayHeightUpdate(),
        getSpawnPoints: () => this.spawnPoints(),
        getBaseCoords: () => this.baseCoords(),
      }),
      isGameInProgress: () => this.gameState.phase() !== 'setup' || this.gameState.waveNumber() > 0,
      getCurrentLocationName: () => this.currentLocationName(),
    };
  }

  /**
   * Clear map entities — delegates to facade
   */
  private clearMapEntities(): void {
    this.facade.clearMapEntities();
  }
}
