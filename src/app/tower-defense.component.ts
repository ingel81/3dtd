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
import { QuickActionsComponent } from './components/quick-actions/quick-actions.component';
import { InfoOverlayComponent } from './components/info-overlay/info-overlay.component';
import { ContextHintComponent, HintItem } from './components/context-hint/context-hint.component';
import { DebugWindowService } from './services/debug-window.service';
import { WaveDebugService } from './services/wave-debug.service';
import { SoundDebugService } from './services/sound-debug.service';
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
import { CameraFramingService, GeoPoint } from './services/camera-framing.service';
import { RouteAnimationService } from './services/route-animation.service';
import { KeyboardPanService } from './services/keyboard-pan.service';
import { StreetRenderingService } from './services/street-rendering.service';
import { LocationChangeCoordinatorService, LocationChangeInput, LocationChangeContext, LocationChangeCallbacks } from './services/location-change-coordinator.service';
// New OO Game Engine imports
import { GameStateManager } from './managers/game-state.manager';
import { SpawnPoint as WaveSpawnPoint, WaveConfig } from './managers/wave.manager';
// Three.js Engine (new 3DTilesRendererJS-based)
import { ThreeTilesEngine } from './three-engine';
import { Vector3, InstancedMesh } from 'three';
// Theme
import { TD_CSS_VARS } from './styles/td-theme';
// Tower config
import { TOWER_TYPES, getAllTowerTypes, TowerTypeId, UpgradeId } from './configs/tower-types.config';
import { Tower } from './entities/tower.entity';

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
    QuickActionsComponent,
    InfoOverlayComponent,
    ContextHintComponent,
  ],
  providers: [
    GameStateManager,
    EntityPoolService,
    ModelPreviewService,
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

  // Debug services
  readonly debugWindows = inject(DebugWindowService);
  readonly waveDebug = inject(WaveDebugService);
  readonly soundDebug = inject(SoundDebugService);

  // Cleanup
  private readonly destroyRef = inject(DestroyRef);

  // Expose Math and tower config for template
  readonly Math = Math;
  readonly archerTowerConfig = TOWER_TYPES.archer;
  // Filter out inactive tower types (sniper)
  readonly towerTypes = getAllTowerTypes().filter(
    t => t.id !== 'sniper'
  );

  private engine: ThreeTilesEngine | null = null;
  private streetNetwork: StreetNetwork | null = null;
  private devStreetProvider: DevStreetProvider | null = null;
  private filteredStreetNetwork: StreetNetwork | null = null; // Filtered to route corridor for rendering
  private streetNetworkLocation: { lat: number; lon: number } | null = null; // Tracks loaded location to avoid double-loading
  private readonly COORD_EPSILON = 0.0001; // ~11m tolerance for coordinate comparison

  // Three.js object for spatial grid debug visualization
  private spatialGridVizMesh: InstancedMesh | null = null;

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
  readonly towerDebugVisible = this.uiState.towerDebugVisible;
  readonly debugMode = this.uiState.debugMode;
  readonly heightDebugVisible = this.uiState.heightDebugVisible;
  readonly spatialGridDebugVisible = this.uiState.spatialGridDebugVisible;
  readonly fps = this.uiState.fps;
  readonly tileStats = this.uiState.tileStats;
  readonly mapAttribution = signal('Map data ©2024 Google');
  readonly debugLog = this.uiState.debugLog;
  readonly buildMode = this.towerPlacement.buildMode;
  readonly selectedTowerType = this.towerPlacement.selectedTowerType;
  readonly editableHqLocation = this.locationMgmt.editableHqLocation;
  readonly editableSpawnLocations = this.locationMgmt.editableSpawnLocations;
  readonly isApplyingLocation = this.locationMgmt.isApplyingLocation;
  readonly favorites = this.locationMgmt.favorites;
  readonly favoriteNamesMap = signal<Record<string, string>>({});
  // Component-local signals (not moved to services)
  readonly cameraHeading = signal(0); // Compass heading: 0=N, 90=E, 180=S, 270=W
  readonly compassRotation = signal(0); // Accumulated rotation for smooth compass (avoids 0°/360° flip)
  readonly cameraFramingDebug = signal(false); // Debug visualization for camera framing
  readonly cameraDebugEnabled = signal(false); // Camera debug overlay
  readonly cameraDebugInfo = signal<{
    posX: number; posY: number; posZ: number;
    rotX: number; rotY: number; rotZ: number;
    heading: number; pitch: number; altitude: number;
    distanceToCenter: number; fov: number; terrainHeight: number;
  } | null>(null);
  // Wave debug settings (proxied from WaveDebugService for backwards compatibility)
  readonly enemySpeed = this.waveDebug.enemySpeed;
  readonly enemyHealth = this.waveDebug.enemyHealth;
  readonly streetCount = this.waveDebug.streetCount;
  readonly enemyCount = this.waveDebug.enemyCount;
  readonly enemyType = this.waveDebug.enemyType;
  readonly enemyTypes = getAllEnemyTypes();
  readonly spawnMode = this.waveDebug.spawnMode;
  readonly spawnDelay = this.waveDebug.spawnDelay;
  readonly useGathering = this.waveDebug.useGathering;
  readonly spawnPoints = signal<SpawnPoint[]>([]);
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
  // Gathering phase signal - delegated to WaveManager
  readonly gatheringPhase = computed(() => this.gameState.waveManager.gatheringPhase());
  readonly activeSounds = signal(0);
  readonly gatheringCountdown = signal(0);

  private tileStatsIntervalId: number | null = null; // Polling for tile stats during loading

  // UI update throttling (avoid updating signals every frame)
  private lastUIUpdateTime = 0;
  private readonly UI_UPDATE_INTERVAL = 100; // ms - update UI stats ~10x per second instead of 60x
  private lastFps = 0;
  private lastActiveSounds = 0;

  constructor() {
    // Effect: Update all existing enemies when speed changes
    effect(() => {
      const speed = this.enemySpeed();
      for (const enemy of this.gameState.enemies()) {
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
  }

  ngOnInit(): void {
    // Resolve favorite names (async, doesn't block)
    this.resolveFavoriteNames();

    // Auto-open DevWorld debug panel when DevWorld is active
    if (this.devWorld.isActive) {
      this.debugWindows.open('devworld');
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

  /**
   * Resolve display names for all favorites
   */
  private async resolveFavoriteNames(): Promise<void> {
    const favs = this.locationMgmt.favorites();
    const names: Record<string, string> = {};

    for (const fav of favs) {
      names[fav.id] = await this.locationMgmt.getFavoriteDisplayName(fav);
    }

    this.favoriteNamesMap.set(names);
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
   * Handle keyboard events for build mode and camera panning
   * R (hold) = Rotate tower preview continuously
   * Escape = Cancel build mode
   * WASD / Arrow keys = Pan camera
   */
  @HostListener('window:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    // Don't intercept keyboard events when user is typing in an input field
    if (this.isTypingInInputField(event)) {
      return;
    }

    // Camera panning (WASD / Arrow keys) - works always
    if (this.keyboardPan.onKeyDown(event)) {
      event.preventDefault();
      return;
    }

    // Debug: Toggle 3D tiles visibility with 'T' key
    if (event.key === 't' || event.key === 'T') {
      if (this.engine) {
        const currentlyVisible = this.engine.areTilesVisible();
        this.engine.setTilesVisible(!currentlyVisible);
        event.preventDefault();
        return;
      }
    }

    // Debug: Toggle ShaderMaterial for particles with 'P' key
    // Tests per-particle size support with logarithmic depth buffer
    if (event.key === 'p' || event.key === 'P') {
      if (this.engine) {
        const currentlyUsingShader = this.engine.effects.isUsingShaderMaterial();
        this.engine.effects.setUseShaderMaterial(!currentlyUsingShader);
        event.preventDefault();
        return;
      }
    }

    // Build mode keys
    if (!this.towerPlacement.buildMode()) return;

    if (event.key === 'r' || event.key === 'R') {
      event.preventDefault();
      this.towerPlacement.startRotating();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.exitBuildMode();
    }
  }

  @HostListener('window:keyup', ['$event'])
  onKeyUp(event: KeyboardEvent): void {
    // Don't intercept keyboard events when user is typing in an input field
    if (this.isTypingInInputField(event)) {
      return;
    }

    // Camera panning key release
    this.keyboardPan.onKeyUp(event);

    if (event.key === 'r' || event.key === 'R') {
      this.towerPlacement.stopRotating();
    }
  }

  @HostListener('window:blur')
  onWindowBlur(): void {
    // Clear pan keys when window loses focus
    this.keyboardPan.clearKeys();
  }

  /**
   * Check if the user is typing in an input field (input, textarea, select, contenteditable).
   * Game keyboard shortcuts should not interfere with text input.
   */
  private isTypingInInputField(event: KeyboardEvent): boolean {
    const target = event.target as HTMLElement;
    if (!target) return false;

    const tagName = target.tagName.toLowerCase();
    const isInputField = tagName === 'input' || tagName === 'textarea' || tagName === 'select';
    const isContentEditable = target.isContentEditable;

    return isInputField || isContentEditable;
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
    if (this.spatialGridVizMesh) {
      this.engine?.getScene().remove(this.spatialGridVizMesh);
      this.gameState.getGlobalRouteGrid().disposeVisualization();
      this.spatialGridVizMesh = null;
    }

    if (this.engine) {
      this.engine.dispose();
      this.engine = null;
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

      // Register callbacks
      if (this.engine) {
        this.engine.setOnTilesLoadCallback(() => this.onTilesLoaded());
        this.engine.setOnUpdateCallback((deltaTime) => this.onEngineUpdate(deltaTime));

        // Connect sound debug service via EventBus
        const eventBus = this.gameState.getEventBus();
        this.engine.spatialAudio.setEventBus(eventBus);
        this.soundDebug.subscribeToEventBus(eventBus);
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

    // Check if we need to start/stop tile stats polling
    const tiles = this.tilesLoading();

    // Get engine reference (may not be set on this.engine yet during init)
    const engine = this.engine ?? this.engineInit.getEngine();

    // Start polling when tiles still loading (shows stats in loading screen)
    if (tiles && !this.tileStatsIntervalId && engine) {
      this.startTileStatsPolling();
    }

    // Stop polling when tiles are done
    if (!tiles && this.tileStatsIntervalId) {
      this.stopTileStatsPolling();
    }

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
   * Start polling tile stats to show loading progress
   */
  private startTileStatsPolling(): void {
    if (this.tileStatsIntervalId) return;

    this.tileStatsIntervalId = window.setInterval(() => {
      // Get engine reference (may not be set on this.engine yet during init)
      const engine = this.engine ?? this.engineInit.getEngine();
      if (!engine) return;

      const stats = engine.getTileStats();
      const pending = stats.downloading + stats.parsing;
      const detail = pending > 0
        ? `${stats.visible} loaded, ${pending} pending`
        : `${stats.visible} tiles loaded`;
      this.engineInit.updateStepDetail('tiles', detail);
    }, 500);
  }

  /**
   * Stop polling tile stats
   */
  private stopTileStatsPolling(): void {
    if (this.tileStatsIntervalId) {
      clearInterval(this.tileStatsIntervalId);
      this.tileStatsIntervalId = null;
    }
  }

  /**
   * Initialize visualization services (markerViz, pathRoute)
   * Must be called after engine and streets are loaded, before markers/spawns are added
   */
  private initializeVisualizationServices(): void {
    const engine = this.engineInit.getEngine();
    if (!engine || !this.streetNetwork) {
      console.warn('[TD] Cannot initialize visualization services - engine or streetNetwork not available');
      return;
    }

    const base = this.baseCoords();
    const baseCoords = { lat: base.lat, lon: base.lon };

    // Initialize marker visualization service
    this.markerViz.initialize(engine, baseCoords, this.heightDebugVisible);

    // Initialize path and route service
    // Use DevStreetProvider for pathfinding in DevWorld mode, otherwise OsmStreetService
    const pathfindingService = this.devWorld.isActive && this.devStreetProvider
      ? this.devStreetProvider
      : this.osmService;
    this.pathRoute.initialize(
      engine,
      this.streetNetwork,
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
   * Setup click handler - delegates to InputHandlerService
   */
  private setupClickHandler(): void {
    // Use engine from service if component's engine reference not yet set
    const engine = this.engine || this.engineInit.getEngine();
    if (!engine) return;

    this.inputHandler.initialize(
      this.gameCanvas.nativeElement,
      engine,
      this.gameState,
      this.towerPlacement.buildMode,
      (lat: number, lon: number, height: number) => this.onTerrainClick(lat, lon, height),
      (lat: number, lon: number, hitPoint: Vector3) => this.onMouseMove(lat, lon, hitPoint)
    );
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
   * Create build preview callback (called early in initialization)
   * Actual initialization happens in initializeTowerPlacement() after all dependencies are ready
   */
  private createBuildPreview(): void {
    // No-op: TowerPlacementService is initialized in initializeTowerPlacement()
    // which is called after game state and spawn points are set up
  }

  /**
   * Initialize TowerPlacementService with all required dependencies
   * Must be called after engine, streets, spawns, and game state are ready
   */
  private initializeTowerPlacement(): void {
    // Use engine from service if component's engine reference not yet set
    const engine = this.engine || this.engineInit.getEngine();
    if (!engine || !this.streetNetwork) {
      console.warn('[TD] Cannot initialize TowerPlacement - engine or streetNetwork not available');
      return;
    }

    const base = this.baseCoords();
    const spawnPointsForPlacement = this.spawnPoints().map(sp => ({
      id: sp.id,
      name: sp.name,
      lat: sp.lat,
      lon: sp.lon,
      color: sp.color,
    }));

    this.towerPlacement.initialize(
      engine,
      this.streetNetwork,
      this.osmService,
      { lat: base.lat, lon: base.lon },
      spawnPointsForPlacement,
      this.gameState
    );
  }

  /**
   * Load street network (OSM for real world, DevStreetProvider for DevWorld)
   * @returns Street count
   */
  private async loadStreets(): Promise<number> {
    try {
      const center = this.centerCoords();

      // DevWorld mode: Use DevStreetProvider with generated streets from terrain
      if (this.devWorld.isActive) {
        console.log('[TowerDefense] DevWorld mode - using DevStreetProvider');
        const devStreetProvider = new DevStreetProvider(this.devWorld);

        // Get generated streets from terrain provider
        const engine = this.engine || this.engineInit.getEngine();
        const devTerrainProvider = engine?.getDevTerrainProvider();

        if (devTerrainProvider) {
          // Set initial streets from terrain provider
          const segments = devTerrainProvider.getStreetSegments();
          const spawns = devTerrainProvider.getSpawnPoints();
          devStreetProvider.setGeneratedStreets(segments, spawns);

          // Set up refresh callback for live terrain regeneration
          devTerrainProvider.setStreetRefreshCallback((newSegments, newSpawns) => {
            console.log('[TowerDefense] Terrain regenerated - updating streets');
            devStreetProvider.setGeneratedStreets(newSegments, newSpawns);
            // Reload street network
            devStreetProvider.loadStreets(center.lat, center.lon, 500).then((network) => {
              this.streetNetwork = network;
              this.streetCount.set(network.streets.length);
            });
          });
        }

        this.streetNetwork = await devStreetProvider.loadStreets(center.lat, center.lon, 500);
        this.devStreetProvider = devStreetProvider; // Store for route calculations
        this.streetCount.set(this.streetNetwork.streets.length);
        return this.streetNetwork.streets.length;
      }

      // Real world: Use OSM
      this.streetNetwork = await this.osmService.loadStreets(
        center.lat,
        center.lon,
        2000 // 2km radius
      );

      this.streetCount.set(this.streetNetwork.streets.length);
      // NOTE: renderStreets() is called later in Height-Update-Loop AFTER filterStreetNetworkToRoutes()

      return this.streetNetwork.streets.length;
    } catch (err) {
      console.error('Failed to load streets:', err);
      return 0;
    }
  }

  /**
   * Initialize game state with routes
   * @returns Route detail string
   */
  private initializeGameState(): string | undefined {
    // Use engine from service if component's engine reference not yet set
    const engine = this.engine || this.engineInit.getEngine();
    if (!engine || !this.streetNetwork) return undefined;

    const base = this.baseCoords();
    const waveSpawnPoints: WaveSpawnPoint[] = this.spawnPoints().map((sp) => ({
      id: sp.id,
      name: sp.name,
      lat: sp.lat,
      lon: sp.lon,
    }));

    this.gameState.initialize(
      engine,
      this.streetNetwork,
      { lat: base.lat, lon: base.lon },
      waveSpawnPoints,
      this.pathRoute.getCachedPaths()
    );

    // Subscribe to game:over event
    this.gameState.getEventBus().on('game:over', () => {
      this.onGameOver();
    });

    // Validate that routes were found
    const paths = this.pathRoute.getCachedPaths();
    if (paths.size === 0) {
      console.error('[TD] No routes found - spawn and HQ may not be connected by streets');
      // Don't throw here as this is initial load - game will still be playable but enemies can't reach HQ
    }

    // Initialize GlobalRouteGrid after routes are computed
    // (setStepActive/Done are async but we fire-and-forget for UI update)
    void this.engineInit.setStepActive('grid');
    this.engineInit.updateStepDetail('grid', 'Calculating grid...');
    this.gameState.initializeGlobalRouteGrid();
    void this.engineInit.setStepDone('grid');

    // Initialize tower placement service (now that all dependencies are ready)
    this.initializeTowerPlacement();

    // Filter street network to only include streets near the calculated routes
    // This dramatically reduces rendering time in dense cities (Berlin: 50k → 500 nodes)
    this.filterStreetNetworkToRoutes();

    // Reframe camera to include all route waypoints (routes may curve away from spawn-HQ line)
    this.reframeCameraWithRoutes();

    return this.pathRoute.getRouteDetail();
  }

  /**
   * Filter street network to only include streets near calculated routes.
   * This reduces rendering time dramatically in dense cities.
   * Note: DevWorld skips filtering - all generated streets are needed.
   */
  private filterStreetNetworkToRoutes(): void {
    if (!this.streetNetwork) return;

    // DevWorld: Don't filter - all streets are intentionally placed and buildings depend on them
    if (this.devWorld.isActive) {
      this.filteredStreetNetwork = this.streetNetwork;
      return;
    }

    // Collect all route paths
    const cachedPaths = this.pathRoute.getCachedPaths();
    const routes: { lat: number; lon: number }[][] = [];

    cachedPaths.forEach((path) => {
      routes.push(path.map(p => ({ lat: p.lat, lon: p.lon })));
    });

    if (routes.length === 0) {
      // No routes calculated, use full network
      this.filteredStreetNetwork = this.streetNetwork;
      return;
    }

    // Filter to 100m corridor around routes
    this.filteredStreetNetwork = this.osmService.filterStreetsNearRoutes(
      this.streetNetwork,
      routes,
      100 // 100m corridor width
    );
  }

  /**
   * Schedule overlay height updates
   */
  private async scheduleOverlayHeightUpdate(): Promise<void> {
    // Get engine from service (this.engine may not be set yet during init)
    const engine = this.engineInit.getEngine();
    if (!engine) {
      console.warn('[TD] scheduleOverlayHeightUpdate - no engine from service!');
      return;
    }

    const base = this.baseCoords();

    // Initialize height update service with callbacks
    this.heightUpdate.initialize(
      engine,
      { lat: base.lat, lon: base.lon },
      this.engineInit.loadingStatus,
      () => {
        // Update marker heights
        const spawnPointsForMarkers = this.spawnPoints().map(sp => ({
          id: sp.id,
          name: sp.name,
          lat: sp.lat,
          lon: sp.lon,
          color: sp.color,
        }));
        this.markerViz.updateMarkerHeights(spawnPointsForMarkers);

        // Update GlobalRouteGrid terrain heights now that terrain is loaded
        this.gameState.getGlobalRouteGrid().updateTerrainHeights();
      },
      () => this.renderStreets(),
      (detail: string) => this.engineInit.setStepDone('finalize', detail),
      (detail: string) => this.engineInit.updateStepDetail('finalize', detail),
      () => this.checkAllLoaded(),
      // Camera correction callback - runs BEFORE overlay hides
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
   * Save current camera position as initial position for reset
   * NOTE: Framing is now done by CameraFramingService after routes are calculated
   * This method only saves the (already correct) position, no re-framing
   */
  private saveInitialCameraPosition(): void {
    // Show debug visualization if enabled (including routes)
    const hq = this.baseCoords();
    const spawns = this.spawnPoints();

    // Extract all route waypoints from cached paths
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

    // Get target from last computed frame
    const lastFrame = this.cameraFraming.getLastFrame();
    const target = lastFrame
      ? { x: lastFrame.lookAtX, y: lastFrame.lookAtY, z: lastFrame.lookAtZ }
      : undefined;

    // Save current position and target as the initial position
    this.cameraControl.saveInitialPosition(target);
  }

  /**
   * Render streets using StreetRenderingService
   */
  private renderStreets(): void {
    const engine = this.engine || this.engineInit.getEngine();
    if (!engine) return;

    const base = this.baseCoords();
    this.streetRendering.renderStreets(
      engine,
      this.filteredStreetNetwork,
      this.streetNetwork,
      { lat: base.lat, lon: base.lon },
      this.streetsVisible()
    );
  }



  /**
   * Toggle height debug visualization (just visibility, no re-render)
   */
  toggleHeightDebug(): void {
    this.heightDebugVisible.update((v) => !v);
    this.markerViz.toggleHeightDebug(this.heightDebugVisible());
  }

  /**
   * Manually refresh terrain heights (re-raycast all overlays)
   * Useful when 3D tiles have loaded more detail since initial setup
   *
   * In DevWorld mode: Regenerates entire world with current config
   */
  refreshTerrainHeights(): void {
    if (!this.engine) return;

    console.log('[TowerDefense] Manual terrain height refresh triggered');

    // DevWorld mode: Regenerate entire world
    if (this.devWorld.isActive) {
      const devTerrainProvider = this.engine.getDevTerrainProvider();
      if (devTerrainProvider) {
        console.log('[TowerDefense] DevWorld: Regenerating world...');
        // Show loading state FIRST
        this.isDevWorldRegenerating.set(true);

        // Give browser TWO frames to render the loading state before heavy work
        // (one for layout/style, one for paint)
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            // Clear engine height cache before regeneration
            this.engine!.clearHeightCache();
            devTerrainProvider.regenerate().then(() => {
              // Streets are updated via the refresh callback set in loadStreets()
              // Full re-initialization of spawns, routes, and grid
              this.onDevWorldRegenerated(devTerrainProvider);
              // Hide loading state
              this.isDevWorldRegenerating.set(false);
            });
          });
        });
        return;
      }
    }

    // Real world: Just clear height cache
    this.engine.clearHeightCache();

    // Re-run the tiles loaded logic (streets, markers, routes)
    this.onTilesLoaded();
  }

  /**
   * Called after DevWorld terrain regeneration.
   * Performs a full cleanup and re-initialization similar to location change.
   */
  private onDevWorldRegenerated(devTerrainProvider: import('./devworld/dev-terrain.provider').DevTerrainProvider): void {
    console.log('[TowerDefense] DevWorld regenerated - full re-initialization');
    if (!this.engine) return;

    const overlayGroup = this.engine.getOverlayGroup();

    // ══════════════════════════════════════════════════════════════
    // PHASE 1: Stop everything
    // ══════════════════════════════════════════════════════════════
    this.routeAnimation.stopAnimation();
    this.heightUpdate.stopHeightUpdates();

    // ══════════════════════════════════════════════════════════════
    // PHASE 2: Clear all visual elements
    // ══════════════════════════════════════════════════════════════
    // Clear ALL markers (HQ + spawns)
    this.markerViz.clearAllMarkers();

    // Clear route lines
    this.pathRoute.clearAllRoutes();
    this.pathRoute.clearCachedPaths();

    // Clear street rendering
    this.streetRendering.dispose(overlayGroup);

    // Clear spawn points signal
    this.spawnPoints.set([]);

    // Clear global route grid visualization
    this.gameState.getGlobalRouteGrid().disposeVisualization();
    this.gameState.getGlobalRouteGrid().clear();

    // ══════════════════════════════════════════════════════════════
    // PHASE 3: Re-create base/HQ marker
    // ══════════════════════════════════════════════════════════════
    this.markerViz.addBaseMarker();

    // ══════════════════════════════════════════════════════════════
    // PHASE 4: Create new spawn point from terrain provider
    // (Use only first spawn, same as initial load in addPredefinedSpawns)
    // ══════════════════════════════════════════════════════════════
    const generatedSpawns = devTerrainProvider.getSpawnPoints();
    const colors = [0xef4444, 0xf97316, 0x00bcd4, 0xff00ff]; // Same as addPredefinedSpawns

    if (generatedSpawns.length > 0) {
      const spawn = generatedSpawns[0];
      const spawnGeo = this.devWorld.localToGeo(spawn.position.x, spawn.position.z);
      this.addSpawnPoint(spawn.id, spawn.name, spawnGeo.lat, spawnGeo.lon, colors[0]);
    }

    // Update spawn markers reference in pathRoute service
    this.pathRoute.updateSpawnMarkers(this.markerViz.getSpawnMarkers());

    // ══════════════════════════════════════════════════════════════
    // PHASE 5: Re-filter and render streets
    // ══════════════════════════════════════════════════════════════
    this.filteredStreetNetwork = this.streetNetwork;
    this.renderStreets();

    // ══════════════════════════════════════════════════════════════
    // PHASE 6: Update marker heights and render routes
    // ══════════════════════════════════════════════════════════════
    const spawnPointsForMarkers = this.spawnPoints().map(sp => ({
      id: sp.id,
      name: sp.name,
      lat: sp.lat,
      lon: sp.lon,
      color: sp.color,
    }));
    this.markerViz.updateMarkerHeights(spawnPointsForMarkers);

    // Refresh route lines (this also caches paths)
    this.pathRoute.refreshRouteLines(this.spawnPoints());

    // ══════════════════════════════════════════════════════════════
    // PHASE 7: Re-initialize game state with new routes
    // ══════════════════════════════════════════════════════════════
    this.gameState.initializeGlobalRouteGrid();

    // Update HQ terrain height
    this.gameState.onTilesLoaded();

    // ══════════════════════════════════════════════════════════════
    // PHASE 8: Start route animation
    // ══════════════════════════════════════════════════════════════
    const cachedPaths = this.pathRoute.getCachedPaths();
    if (cachedPaths.size > 0) {
      this.routeAnimation.startAnimation(cachedPaths, this.spawnPoints());
    }

    console.log(`[TowerDefense] DevWorld re-initialized: ${generatedSpawns.length} spawns, ${cachedPaths.size} routes`);
  }

  /**
   * Called automatically when tiles finish loading (LOD changes)
   * Re-renders terrain-following elements with updated geometry
   */
  private onTilesLoaded(): void {
    if (!this.engine || !this.filteredStreetNetwork) return;

    // Re-render streets with new terrain data
    this.renderStreets();

    // Update marker heights via service
    const spawnPointsForMarkers = this.spawnPoints().map(sp => ({
      id: sp.id,
      name: sp.name,
      lat: sp.lat,
      lon: sp.lon,
      color: sp.color,
    }));
    this.markerViz.updateMarkerHeights(spawnPointsForMarkers);

    // Re-render route lines (clear and re-create)
    this.pathRoute.refreshRouteLines(this.spawnPoints());

    // Update HQ terrain height and debug points in game state
    this.gameState.onTilesLoaded();

    // Initialize spatial grid visualization if persisted state was enabled
    // Must be done after tiles loaded so terrain heights are correct
    this.initSpatialGridVisualizationIfEnabled();
  }

  /**
   * Called each frame for animations (runs outside Angular zone)
   */
  private onEngineUpdate(deltaTime: number): void {
    // Update tower placement rotation (R key held) - deltaTime is in ms, convert to seconds
    this.towerPlacement.updateRotation(deltaTime / 1000);

    // Continue progressive LOS preview building (spreads work across frames)
    this.towerPlacement.updatePreviewBuild();

    // Update keyboard panning - deltaTime is in ms, convert to seconds
    this.keyboardPan.update(deltaTime / 1000);

    // Animate markers (HQ rotation, spawn pulse) - no signals, pure Three.js
    this.markerViz.animateMarkers(deltaTime);

    // Animate route visualization (Knight Rider effect) - no signals, pure Three.js
    this.routeAnimation.update(deltaTime);

    // ══════════════════════════════════════════════════════════════
    // GAME LOGIC UPDATE - runs EVERY frame, phase controls behavior
    // ══════════════════════════════════════════════════════════════
    const currentTime = performance.now();
    this.gameState.update(currentTime);

    // Update global route grid visualization
    const grid = this.gameState.getGlobalRouteGrid();
    if (this.spatialGridDebugVisible() && this.spatialGridVizMesh) {
      grid.updateVisualization();
    }
    grid.updateAnimation(deltaTime);

    // Update selected tower's LOS visualization animation
    const selectedTower = this.gameState.towerManager.getSelected();
    if (selectedTower?.losVisualization?.visible) {
      grid.updateTowerVisualizationTime(selectedTower.losVisualization);
    }

    // Throttle UI signal updates to reduce Angular change detection overhead
    const now = performance.now();
    if (now - this.lastUIUpdateTime < this.UI_UPDATE_INTERVAL) {
      return; // Skip UI updates this frame
    }
    this.lastUIUpdateTime = now;

    // Update UI signals only when values changed (runs inside Angular zone for change detection)
    if (this.engine) {
      this.ngZone.run(() => {
        // FPS - only update if changed
        const newFps = this.engine!.getFPS();
        if (newFps !== this.lastFps) {
          this.lastFps = newFps;
          this.fps.set(newFps);
        }

        // Tile stats - only update if changed (compare by reference is fine, engine returns same object if unchanged)
        const newTileStats = this.engine!.getTileStats();
        this.tileStats.set(newTileStats);

        // Active sounds - only update if changed
        const newActiveSounds = this.engine!.spatialAudio.getActiveSoundCount();
        if (newActiveSounds !== this.lastActiveSounds) {
          this.lastActiveSounds = newActiveSounds;
          this.activeSounds.set(newActiveSounds);
        }

        // Sound debug stats - only when panel is open
        if (this.debugWindows.soundWindow().isOpen) {
          this.soundDebug.updateStats(this.engine!.spatialAudio.getSoundPoolStats());
        }

        // Attributions - only update if changed
        const attr = this.engine!.getAttributions();
        if (attr && attr !== this.mapAttribution()) {
          this.mapAttribution.set(attr || 'Map data ©2024 Google');
        }

        // Compass heading - only update if changed
        const heading = Math.round(this.cameraControl.getCameraHeading());
        if (heading !== this.cameraHeading()) {
          const oldHeading = this.cameraHeading();
          this.cameraHeading.set(heading);

          // Calculate shortest rotation delta (handles 0°/360° wrap-around)
          let delta = heading - oldHeading;
          if (delta > 180) delta -= 360;
          if (delta < -180) delta += 360;

          // Accumulate rotation for smooth compass animation
          this.compassRotation.update(rot => rot + delta);
        }

        // Camera debug info - only when debug overlay is enabled
        if (this.cameraDebugEnabled()) {
          this.cameraDebugInfo.set(this.cameraControl.getCameraDebugInfo());
        }
      });
    }
  }


  /**
   * Reframe camera to include all calculated routes.
   * Routes may curve significantly due to rivers, bridges, or street layout,
   * so the initial frame (based only on spawns + HQ) may not show all waypoints.
   */
  private reframeCameraWithRoutes(): void {
    const base = this.baseCoords();
    const hq: GeoPoint = { lat: base.lat, lon: base.lon };

    // Get spawn coordinates
    const spawns: GeoPoint[] = this.spawnPoints().map(sp => ({
      lat: sp.lat,
      lon: sp.lon,
    }));

    // Extract all route waypoints from cached paths
    const routePoints: GeoPoint[] = [];
    const cachedPaths = this.pathRoute.getCachedPaths();
    cachedPaths.forEach((path) => {
      for (const pos of path) {
        routePoints.push({ lat: pos.lat, lon: pos.lon });
      }
    });

    // Only reframe if we have route points
    if (routePoints.length > 0) {
      this.cameraFraming.reframeWithRoutes(hq, spawns, routePoints, {
        padding: 0.1,
        angle: 70,
        markerRadius: 8,
      });
    }
  }

  private addPredefinedSpawns(): number {
    const colors = [0xef4444, 0xf97316, 0x00bcd4, 0xff00ff]; // red, orange, cyan, magenta
    const hq = this.locationMgmt.hq();

    // No location set - should not happen, but handle gracefully
    if (!hq) {
      console.warn('[addPredefinedSpawns] No HQ location set');
      return 0;
    }

    // Check if we need to generate a spawn (URL had no spawn parameter)
    if (this.locationMgmt.needsRandomSpawn() && this.streetNetwork) {
      // DevWorld mode: Use dynamically generated spawn points from terrain provider
      if (this.devWorld.isActive) {
        const engine = this.engine || this.engineInit.getEngine();
        const devTerrainProvider = engine?.getDevTerrainProvider();

        if (devTerrainProvider) {
          const generatedSpawns = devTerrainProvider.getSpawnPoints();
          if (generatedSpawns.length > 0) {
            // Use first generated spawn (it's guaranteed to be on a street)
            const spawn = generatedSpawns[0];
            const spawnGeo = this.devWorld.localToGeo(spawn.position.x, spawn.position.z);
            console.log(`[addPredefinedSpawns] DevWorld spawn: ${spawn.name} at (${spawn.position.x.toFixed(0)}, ${spawn.position.z.toFixed(0)})`);
            this.locationMgmt.setGeneratedSpawns([{ lat: spawnGeo.lat, lon: spawnGeo.lon }]);
            this.addSpawnPoint(spawn.id, spawn.name, spawnGeo.lat, spawnGeo.lon, colors[0]);
            return 1;
          }
        }

        // Fallback to fixed spawn if terrain provider not ready
        const spawnConfig = this.devWorld.config.spawn;
        const spawnPos = this.devWorld.getSpawnPosition();
        const spawnGeo = this.devWorld.localToGeo(spawnPos.x, spawnPos.z);
        console.log(`[addPredefinedSpawns] DevWorld spawn (fallback): ${spawnConfig} at (${spawnPos.x}, ${spawnPos.z})`);
        this.locationMgmt.setGeneratedSpawns([{ lat: spawnGeo.lat, lon: spawnGeo.lon }]);
        this.addSpawnPoint(`spawn-${spawnConfig}`, `Spawn ${spawnConfig}`, spawnGeo.lat, spawnGeo.lon, colors[0]);
        return 1;
      }

      // Real world: Find random spawn on OSM streets
      const randomSpawn = this.osmService.findRandomStreetPoint(this.streetNetwork, hq.lat, hq.lon, 500, 1000);

      if (randomSpawn) {
        console.log(`[addPredefinedSpawns] Generated random spawn: ${randomSpawn.streetName || 'Unknown'} (${Math.round(randomSpawn.distance)}m)`);
        // Update location service with generated spawn
        this.locationMgmt.setGeneratedSpawns([{ lat: randomSpawn.lat, lon: randomSpawn.lon }]);
        // Sync to URL so it can be shared
        this.syncUrlWithLocation();
        // Add the spawn point
        this.addSpawnPoint('spawn-1', randomSpawn.streetName || 'Spawn', randomSpawn.lat, randomSpawn.lon, colors[0]);
        return 1;
      } else {
        console.warn('[addPredefinedSpawns] No valid random spawn found');
        return 0;
      }
    }

    // Use spawn locations from URL/service
    const spawns = this.editableSpawnLocations();
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
   * Add a spawn point (delegates to services)
   */
  addSpawnPoint(id: string, name: string, lat: number, lon: number, color: number): void {
    // Use engine from service if component's engine reference not yet set
    const engine = this.engine || this.engineInit.getEngine();
    if (!engine || !this.streetNetwork) return;

    const spawn: SpawnPoint = { id, name, lat, lon, color };
    this.spawnPoints.update((points) => [...points, spawn]);

    // Add visual marker via service
    this.markerViz.addSpawnMarker(id, name, lat, lon, color);

    // Update spawn markers reference in pathRoute service
    this.pathRoute.updateSpawnMarkers(this.markerViz.getSpawnMarkers());

    // Calculate and render path via service
    this.pathRoute.showPathFromSpawn(spawn);
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
      this.gameState.sellTower(tower);
    }
  }

  /**
   * Upgrade a tower with the specified upgrade
   */
  upgradeTower(tower: Tower, upgradeId: UpgradeId): void {
    const upgrade = tower.typeConfig.upgrades.find(u => u.id === upgradeId);
    if (!upgrade) return;

    // Check if we can afford it
    if (this.gameState.credits() < upgrade.cost) {
      return;
    }

    // Check if upgrade can be applied
    if (!tower.canUpgrade(upgradeId)) {
      return;
    }

    // Deduct credits and apply upgrade
    this.gameState.spendCredits(upgrade.cost);
    tower.applyUpgrade(upgradeId);
  }

  /**
   * Starts a new wave with the 2-phase system:
   *
   * PHASE 1 - GATHERING (approx. N * 100ms):
   * - Enemies spawn one after another (100ms delay)
   * - Stand still at spawn point (paused=true)
   * - Models are loaded asynchronously → distributes GPU load
   *
   * PHASE 2 - ATTACK (after 500ms pause):
   * - Enemies start moving one by one (300ms delay between each)
   * - Walk animation starts
   * - Game loop begins
   */
  startWave(): void {
    if (!this.engine || this.waveActive() || this.isGameOver()) return;
    if (this.spawnPoints().length === 0) return;

    // Snapshot of debug settings - WaveManager handles spawning
    // Note: getSpawnDelay allows live delay changes during wave (from Debug Panel)
    const waveConfig: WaveConfig = {
      enemyCount: this.enemyCount(),
      enemyType: this.enemyType(),
      enemySpeed: this.enemySpeed(),
      enemyHealth: this.enemyHealth(),
      spawnMode: this.spawnMode(),
      spawnDelay: this.spawnDelay(),
      getSpawnDelay: this.spawnDelay, // Signal getter for live updates
      useGathering: this.useGathering(),
    };

    this.gameState.startWave(waveConfig);
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
    this.streetRendering.setVisibility(this.uiState.streetsVisible());
  }

  /**
   * Handle routes toggle side effect (visibility already toggled by QuickActionsComponent)
   */
  onRoutesToggled(): void {
    this.pathRoute.setRouteLinesVisible(this.uiState.routesVisible());
  }

  /**
   * Handle tower debug toggle side effect (visibility already toggled by QuickActionsComponent)
   */
  onTowerDebugToggled(): void {
    if (this.engine) {
      this.engine.towers.setDebugMode(this.uiState.towerDebugVisible());
    }
  }

  /**
   * Toggle special points debug (fire position markers, etc.)
   */
  onSpecialPointsDebugToggled(): void {
    this.uiState.toggleSpecialPointsDebug();
    const visible = this.uiState.specialPointsDebugVisible();

    if (this.engine) {
      this.engine.effects.setDebugSpheresVisible(visible);

      // Spawn HQ debug point if enabled and not yet spawned
      if (visible) {
        this.gameState.spawnHQDebugPoint();
      }
    }
  }

  /**
   * Toggle global route grid debug visualization
   * Shows cells along routes with color-coded LOS and enemy presence
   */
  onSpatialGridDebugToggled(): void {
    this.uiState.toggleSpatialGridDebug();
    this.updateSpatialGridVisualization();
  }

  /**
   * Initialize spatial grid visualization if persisted state was enabled
   * Called after grid is initialized to restore persisted visibility
   */
  private initSpatialGridVisualizationIfEnabled(): void {
    if (this.uiState.spatialGridDebugVisible()) {
      this.updateSpatialGridVisualization();
    }
  }

  /**
   * Update spatial grid visualization based on current state
   */
  private updateSpatialGridVisualization(): void {
    const visible = this.uiState.spatialGridDebugVisible();
    const grid = this.gameState.getGlobalRouteGrid();
    // Use engine from service if component's engine reference not yet set
    const engine = this.engine || this.engineInit.getEngine();

    if (visible) {
      // Create and add visualization mesh to scene
      if (!this.spatialGridVizMesh && engine && grid.isInitialized()) {
        this.spatialGridVizMesh = grid.createVisualization();
        engine.getScene().add(this.spatialGridVizMesh);
      }
      if (this.spatialGridVizMesh) {
        this.spatialGridVizMesh.visible = true;
      }
    } else {
      // Hide visualization (don't dispose - may toggle again)
      if (this.spatialGridVizMesh) {
        this.spatialGridVizMesh.visible = false;
      }
    }
  }

  /**
   * Manually trigger route animation playback
   */
  onPlayRouteAnimation(): void {
    const cachedPaths = this.pathRoute.getCachedPaths();
    if (cachedPaths.size > 0) {
      this.routeAnimation.startAnimation(cachedPaths, this.spawnPoints());
    }
  }

  /**
   * Toggle camera framing debug visualization
   * Shows bounding boxes for HQ+spawns+routes framing algorithm
   */
  toggleCameraFramingDebug(): void {
    const enabled = this.cameraControl.toggleDebugFraming();
    this.cameraFramingDebug.set(enabled);

    if (enabled) {
      // Show current framing visualization (including routes)
      const hq = this.baseCoords();
      const spawns = this.spawnPoints();

      // Extract all route waypoints from cached paths
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
   * Toggle camera debug overlay
   * Shows real-time camera position, angles, and other stats
   */
  toggleCameraDebug(): void {
    const enabled = !this.cameraDebugEnabled();
    this.cameraDebugEnabled.set(enabled);

    if (enabled) {
      // Immediately update debug info
      this.cameraDebugInfo.set(this.cameraControl.getCameraDebugInfo());
    } else {
      this.cameraDebugInfo.set(null);
    }
  }

  logCameraPosition(): void {
    if (!this.engine) return;

    const camera = this.engine.getCamera();

    const data = {
      position: {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      },
      hq: this.baseCoords(),
      tiltAngle: 45, // fixed
    };

    const output = JSON.stringify(data, null, 2);

    // Log to debug textarea
    this.appendDebugLog('=== CAMERA ===\n' + output);
  }


  killAllEnemies(): void {
    // Stop spawning new enemies (clears pending timeouts in WaveManager)
    this.gameState.stopSpawning();

    // Kill all living enemies
    const enemies = this.gameState.enemies();
    for (const enemy of enemies) {
      if (enemy.alive) {
        this.gameState.killEnemy(enemy);
      }
    }

    // Wave ends automatically via checkWaveComplete() when aliveCount === 0
    // Death animations, projectiles, and effects continue running
  }

  healHq(): void {
    // Heal HQ to 100 HP and stop fire
    this.gameState.healBase();
    this.appendDebugLog('HQ healed (100 HP)');
  }

  addDebugCredits(): void {
    this.gameState.credits.update((c) => c + 1000);
    this.appendDebugLog('+1000 Credits (Debug)');
  }

  addDebugHealth(): void {
    this.gameState.baseHealth.update((h) => h + 1000);
    this.appendDebugLog('+1000 HP (Debug)');
  }

  clearDebugLog(): void {
    this.debugLog.set('');
  }

  appendDebugLog(message: string): void {
    this.debugLog.update((log) => {
      const lines = log.split('\n');
      // Max 50 Zeilen behalten
      if (lines.length > 50) {
        lines.shift();
      }
      return [...lines, message].join('\n');
    });
  }

  close(): void {
    this.dialogRef?.close();
  }

  get isDialog(): boolean {
    return !!this.dialogRef;
  }

  private onGameOver(): void {
    // Stop spawning new enemies (clears pending timeouts in WaveManager)
    this.gameState.stopSpawning();

    // NOTE: Do NOT stop the game loop here!
    // The engine's render loop continues independently and needs to
    // keep running to show the HQ explosion and fire effects.
    // The game loop will stop naturally when it sees phase === 'gameover'
  }

  restartGame(): void {
    // Cleanup old debug visualization before reset (grid will be cleared)
    if (this.spatialGridVizMesh) {
      this.engine?.getScene().remove(this.spatialGridVizMesh);
      this.gameState.getGlobalRouteGrid().disposeVisualization();
      this.spatialGridVizMesh = null;
    }

    this.gameState.reset();

    // Re-initialize GlobalRouteGrid (was cleared in reset)
    this.gameState.initializeGlobalRouteGrid();
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


  // ==================== Location Settings Methods ====================

  /**
   * Apply new location - delegates to LocationChangeCoordinatorService
   * Shows loading overlay and waits for tiles + streets to load
   */
  async onApplyNewLocation(data: { hq: LocationConfig; spawn: LocationConfig }): Promise<void> {
    if (!this.engine) {
      console.error('[Location] No engine available');
      return;
    }

    const input: LocationChangeInput = {
      hq: data.hq,
      spawn: data.spawn,
    };

    const context: LocationChangeContext = {
      engine: this.engine,
      gameState: this.gameState,
      streetNetwork: this.streetNetwork,
      streetNetworkLocation: this.streetNetworkLocation,
      heightDebugVisible: this.heightDebugVisible,
    };

    const callbacks: LocationChangeCallbacks = {
      // Signal updates
      setBaseCoords: (c) => this.baseCoords.set(c),
      setCenterCoords: (c) => this.centerCoords.set(c),
      setSpawnPoints: (p) => this.spawnPoints.set(p),
      addSpawnPoint: (id, name, lat, lon, color) => this.addSpawnPoint(id, name, lat, lon, color),
      setStreetCount: (c) => this.streetCount.set(c),
      setStreetNetwork: (n) => { this.streetNetwork = n; },
      setStreetNetworkLocation: (l) => { this.streetNetworkLocation = l; },

      // Actions
      syncUrlWithLocation: () => this.syncUrlWithLocation(),
      clearMapEntities: () => this.clearMapEntities(),
      appendDebugLog: (msg) => this.appendDebugLog(msg),
      initializeTowerPlacement: () => this.initializeTowerPlacement(),
      filterStreetNetworkToRoutes: () => this.filterStreetNetworkToRoutes(),
      scheduleOverlayHeightUpdate: () => this.scheduleOverlayHeightUpdate(),

      // Current state accessors
      getSpawnPoints: () => this.spawnPoints(),
      getBaseCoords: () => this.baseCoords(),
    };

    try {
      await this.locationCoordinator.executeLocationChange(input, context, callbacks);
    } catch (err) {
      console.error('[Location] Failed to apply location:', err);
      this.appendDebugLog(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
      this.engineInit.setError(err instanceof Error ? err.message : 'Error changing location');

      // Reset loading flags on error
      this.tilesLoading.set(false);
      this.osmLoading.set(false);
      this.heightsLoading.set(false);
      this.isApplyingLocation.set(false);
    }
  }

  /**
   * Open location dialog to change HQ and spawn point
   */
  openLocationDialog(): void {
    const hq = this.editableHqLocation();
    const spawn = this.editableSpawnLocations()[0];

    const dialogData: LocationDialogData = {
      currentLocation: hq
        ? {
            lat: hq.lat,
            lon: hq.lon,
            name: this.currentLocationName(),
            displayName: hq.name || '',
          }
        : null,
      currentSpawn: spawn
        ? {
            id: spawn.id,
            lat: spawn.lat,
            lon: spawn.lon,
            name: spawn.name,
          }
        : null,
      isGameInProgress: this.gameState.phase() !== 'setup' || this.gameState.waveNumber() > 0,
    };

    const dialogRef = this.dialog.open(LocationDialogComponent, {
      data: dialogData,
      panelClass: 'td-dialog-panel',
      disableClose: false,
    });

    dialogRef.afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(async (result: LocationDialogResult | null) => {
      if (!result?.confirmed) return;

      // Show loading overlay IMMEDIATELY before any async operations
      this.loading.set(true);
      this.engineInit.resetLoadingSteps();

      let spawnLat = result.spawn.lat;
      let spawnLon = result.spawn.lon;
      let spawnName = result.spawn.name;

      // Generate random spawn if requested
      if (result.spawn.isRandom) {
        // Load streets for the new location to find spawn (reused in onApplyNewLocation)
        const newNetwork = await this.osmService.loadStreets(result.hq.lat, result.hq.lon, 2000);
        // Store for reuse in onApplyNewLocation to avoid double-loading
        this.streetNetwork = newNetwork;
        this.streetNetworkLocation = { lat: result.hq.lat, lon: result.hq.lon };

        const randomSpawn = this.osmService.findRandomStreetPoint(newNetwork, result.hq.lat, result.hq.lon, 500, 1000);

        if (randomSpawn) {
          spawnLat = randomSpawn.lat;
          spawnLon = randomSpawn.lon;
          spawnName = randomSpawn.streetName || 'Random Spawn';
          this.appendDebugLog(`Random spawn: ${Math.round(randomSpawn.distance)}m away`);
        } else {
          this.appendDebugLog('No valid spawn found, using fallback');
          // Fallback: use a point 700m north
          spawnLat = result.hq.lat + 0.0063; // ~700m north
          spawnLon = result.hq.lon;
          spawnName = 'Fallback Spawn';
        }
      }

      // Apply the new location
      await this.onApplyNewLocation({
        hq: {
          lat: result.hq.lat,
          lon: result.hq.lon,
          name: result.hq.displayName,
          address: result.hq.address,
        },
        spawn: {
          lat: spawnLat,
          lon: spawnLon,
          name: spawnName,
        },
      });
    });
  }

  // ==================== Location Sharing & Favorites ====================

  /**
   * Copy shareable URL to clipboard (URL already reflects current location)
   */
  onShareLocation(): void {
    const url = this.urlLocation.getShareUrl();
    navigator.clipboard.writeText(url);
    this.appendDebugLog('Link copied: ' + url);
  }

  /**
   * Roll for a random city from Wikidata and navigate there
   */
  async onWorldDice(): Promise<void> {
    this.appendDebugLog('World Dice: Rolling random city...');

    // Show loading overlay with World Dice step
    this.engineInit.startWorldDiceLoading();

    // Connect step detail callback
    this.worldDice.onStepDetail = (detail) => {
      this.engineInit.updateWorldDiceDetail(detail);
    };

    const city = await this.worldDice.rollRandomCity();

    // Cleanup callback
    this.worldDice.onStepDetail = null;

    if (!city) {
      this.appendDebugLog('World Dice: Failed - ' + (this.worldDice.error() || 'Unknown error'));
      // Hide loading overlay on error
      this.engineInit.setLoading(false);
      return;
    }

    const displayName = city.country ? `${city.name}, ${city.country}` : city.name;
    this.appendDebugLog(`World Dice: ${displayName} (${city.lat.toFixed(4)}, ${city.lon.toFixed(4)})`);

    // Show "Loading Map..." step before reload
    this.engineInit.finishWorldDiceLoading(displayName);

    // Update URL with only HQ (l=), no spawn (s=) -> randomizer will create spawn
    const url = new URL(window.location.href);
    url.searchParams.set('l', `${city.lat.toFixed(5)},${city.lon.toFixed(5)}`);
    url.searchParams.delete('s'); // Remove spawn so randomizer kicks in

    // Small delay so user sees the "Loading Map..." step
    await new Promise(resolve => setTimeout(resolve, 300));

    // Navigate to new location (full reload for clean state)
    window.location.href = url.toString();
  }

  /**
   * Save current location as favorite
   */
  onAddFavorite(): void {
    this.locationMgmt.saveFavorite();
    this.resolveFavoriteNames(); // Refresh names
    this.appendDebugLog('Favorite saved');
  }

  /**
   * Apply a favorite location
   */
  async onSelectFavorite(fav: FavoriteLocation): Promise<void> {
    const spawn = fav.spawns[0] || { lat: fav.hq.lat + 0.005, lon: fav.hq.lon };

    // Update service and URL
    this.locationMgmt.setLocation(fav.hq, fav.spawns);
    this.syncUrlWithLocation();

    // Apply to game
    await this.onApplyNewLocation({
      hq: { lat: fav.hq.lat, lon: fav.hq.lon, name: 'Loading...' },
      spawn: { lat: spawn.lat, lon: spawn.lon, name: 'Spawn' },
    });
  }

  /**
   * Delete a favorite
   */
  onDeleteFavorite(id: string): void {
    this.locationMgmt.deleteFavorite(id);
    this.favoriteNamesMap.update(m => {
      const copy = { ...m };
      delete copy[id];
      return copy;
    });
    this.appendDebugLog('Favorite deleted');
  }

  /**
   * Check if street network is already loaded for the given coordinates
   * Used to avoid double-loading when random spawn uses same location
   */
  private isSameStreetNetworkLocation(lat: number, lon: number): boolean {
    if (!this.streetNetworkLocation || !this.streetNetwork) return false;
    return Math.abs(this.streetNetworkLocation.lat - lat) < this.COORD_EPSILON &&
           Math.abs(this.streetNetworkLocation.lon - lon) < this.COORD_EPSILON;
  }

  private clearMapEntities(): void {
    if (!this.engine) return;

    const overlayGroup = this.engine.getOverlayGroup();

    // Clear markers via service
    this.markerViz.clearAllMarkers();

    // Clear routes via service
    this.pathRoute.clearAllRoutes();

    // Clear street mesh via service
    this.streetRendering.dispose(overlayGroup);

    // Clear spawn points signal
    this.spawnPoints.set([]);

    // Clear cached paths via service
    this.pathRoute.clearCachedPaths();

    // Clear filtered street network and location tracking
    this.filteredStreetNetwork = null;
    this.streetNetworkLocation = null;

    // Stop tile stats polling if running
    this.stopTileStatsPolling();
  }
}
