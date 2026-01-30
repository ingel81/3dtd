import {
  Component,
  OnDestroy,
  AfterViewInit,
  ElementRef,
  ViewChild,
  Injector,
  signal,
  inject,
  computed,
  HostListener,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { StreetNetwork } from './services/osm-street.service';
import { EntityPoolService } from './services/entity-pool.service';
import { ModelPreviewService } from './services/model-preview.service';
import { getAllEnemyTypes } from './models/enemy-types';
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
import { WaveDebugService } from './services/wave-debug.service';
import { SoundDebugService } from './services/sound-debug.service';
import { EnemyDebugService } from './services/enemy-debug.service';
import { DebugFacadeService } from './services/debug-facade.service';
import { LocationConfig, FavoriteLocation } from './models/location.types';
// Refactoring services
import { GameUIStateService } from './services/game-ui-state.service';
import { CameraControlService } from './services/camera-control.service';
import { MarkerVisualizationService, SpawnPoint } from './services/marker-visualization.service';
import { PathAndRouteService } from './services/path-route.service';
import { InputHandlerService } from './services/input-handler.service';
import { TowerPlacementService } from './services/tower-placement.service';
import { LocationManagementService } from './services/location-management.service';
import { HeightUpdateService } from './services/height-update.service';
import { EngineInitializationService } from './services/engine-initialization.service';
import { DevStreetProvider } from './devworld/dev-street.provider';
import { RouteAnimationService } from './services/route-animation.service';
import { StreetRenderingService } from './services/street-rendering.service';
import { LocationChangeCoordinatorService } from './services/location-change-coordinator.service';
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
export class TowerDefenseComponent implements AfterViewInit, OnDestroy {
  @ViewChild('gameCanvas') gameCanvas!: ElementRef<HTMLCanvasElement>;

  private readonly dialogRef = inject(MatDialogRef<TowerDefenseComponent>, { optional: true });
  readonly gameState = inject(GameStateManager);

  readonly injector = inject(Injector);

  // Refactoring services
  private readonly uiState = inject(GameUIStateService);
  private readonly cameraControl = inject(CameraControlService);
  private readonly markerViz = inject(MarkerVisualizationService);
  private readonly pathRoute = inject(PathAndRouteService);
  private readonly inputHandler = inject(InputHandlerService);
  private readonly towerPlacement = inject(TowerPlacementService);
  private readonly locationMgmt = inject(LocationManagementService);
  private readonly heightUpdate = inject(HeightUpdateService);
  private readonly engineInit = inject(EngineInitializationService);
  private readonly routeAnimation = inject(RouteAnimationService);
  private readonly streetRendering = inject(StreetRenderingService);
  private readonly locationCoordinator = inject(LocationChangeCoordinatorService);
  readonly facade = inject(TowerDefenseFacadeService);

  // Debug services
  readonly waveDebug = inject(WaveDebugService);
  readonly soundDebug = inject(SoundDebugService);
  readonly enemyDebug = inject(EnemyDebugService);
  readonly debugFacade = inject(DebugFacadeService);

  // AI Bot Training (delegated to TrainingClientService)
  private readonly trainingClient = inject(TrainingClientService);
  // Expose bot signals from service for template bindings
  readonly botEnabled = this.trainingClient.botEnabled;
  readonly botSkillLevel = this.trainingClient.botSkillLevel;
  readonly botStats = this.trainingClient.botStats;
  readonly botAutoMode = this.trainingClient.botAutoMode;

  // Expose Math and tower config for template
  readonly Math = Math;
  readonly archerTowerConfig = TOWER_TYPES.archer;
  readonly towerTypes = getAllTowerTypes();

  private engine: ThreeTilesEngine | null = null;
  private streetNetwork: StreetNetwork | null = null;
  private devStreetProvider: DevStreetProvider | null = null;
  private filteredStreetNetwork: StreetNetwork | null = null; // Filtered to route corridor for rendering
  private streetNetworkLocation: { lat: number; lon: number } | null = null; // Tracks loaded location to avoid double-loading

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
    this.facade.initEffects(this);
  }

  async ngAfterViewInit(): Promise<void> {
    await this.facade.startGame(this.gameCanvas.nativeElement);
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
    this.facade.dispose();
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

  close(): void {
    this.dialogRef?.close();
  }

  get isDialog(): boolean {
    return !!this.dialogRef;
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
  getFacadeBridge(): FacadeComponentBridge {
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
    };
  }

}
