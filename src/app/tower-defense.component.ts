import {
  Component,
  OnDestroy,
  AfterViewInit,
  ElementRef,
  ViewChild,
  Injector,
  inject,
  computed,
  signal,
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
import { PerformanceDebuggerComponent } from './components/debug-window/performance-debugger.component';
import { QuickActionsComponent } from './components/quick-actions/quick-actions.component';
import { InfoOverlayComponent } from './components/info-overlay/info-overlay.component';
import { ContextHintComponent, HintItem } from './components/context-hint/context-hint.component';
import { GameSpeedComponent } from './components/game-speed/game-speed.component';
import { WaveDebugService } from './services/wave-debug.service';
import { EnemyDebugService } from './services/enemy-debug.service';
import { DebugFacadeService } from './services/debug-facade.service';
import { LocationConfig, FavoriteLocation } from './models/location.types';
// Refactoring services
import { CameraControlService } from './services/camera-control.service';
import { InputHandlerService } from './services/input-handler.service';
import { TowerPlacementService } from './services/tower-placement.service';
import { MapPlacementService } from './services/map-placement.service';
import { LocationManagementService } from './services/location-management.service';
import { HeightUpdateService } from './services/height-update.service';
import { EngineInitializationService } from './services/engine-initialization.service';
import { DevStreetProvider } from './devworld/dev-street.provider';
import { LocationChangeCoordinatorService } from './services/location-change-coordinator.service';
import { TowerDefenseFacadeService, FacadeComponentBridge } from './services/tower-defense-facade.service';
import { GameLoopFacadeService } from './services/game-loop-facade.service';
import { VisualizationFacadeService } from './services/visualization-facade.service';
import { TowerDefenseStore } from './store/tower-defense.store';
import { UIStore } from './store/ui.store';
// New OO Game Engine imports
import { GameStateManager } from './managers/game-state.manager';
// Three.js Engine (new 3DTilesRendererJS-based)
import { ThreeTilesEngine } from './three-engine';
import { Vector3 } from 'three';
// Theme
import { TD_CSS_VARS } from './styles/td-theme';
// Tower config
import { TOWER_TYPES, getAllTowerTypes, TowerTypeId, UpgradeId, TargetingStrategy, AirSubStrategy } from './configs/tower-types.config';
import { Tower } from './entities/tower.entity';
// AI Wave Director (optional)
import { WaveDirectorService } from './ai/core/wave-director.service';
import { AIDataCollectorService } from './ai/core/ai-data-collector.service';
import { TrainingClientService } from './ai/training/training-client.service';
// AI Bot Training
import { BotSkillLevel } from './ai/training/bots/tower-bot.interface';

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
    PerformanceDebuggerComponent,
    QuickActionsComponent,
    InfoOverlayComponent,
    ContextHintComponent,
    GameSpeedComponent,
  ],
  providers: [
    GameStateManager,
    EntityPoolService,
    ModelPreviewService,
    // AI services (optional - game works without them)
    AIDataCollectorService,
    WaveDirectorService,
    TrainingClientService,
    // Facade services (depend on component-scoped providers above)
    TowerDefenseFacadeService,
    GameLoopFacadeService,
    VisualizationFacadeService,
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
  private readonly uiStore = inject(UIStore);

  readonly injector = inject(Injector);

  // Refactoring services
  private readonly cameraControl = inject(CameraControlService);
  private readonly inputHandler = inject(InputHandlerService);
  private readonly towerPlacement = inject(TowerPlacementService);
  private readonly mapPlacement = inject(MapPlacementService);
  private readonly locationMgmt = inject(LocationManagementService);
  private readonly heightUpdate = inject(HeightUpdateService);
  private readonly engineInit = inject(EngineInitializationService);
  private readonly locationCoordinator = inject(LocationChangeCoordinatorService);
  readonly facade = inject(TowerDefenseFacadeService);
  readonly store = inject(TowerDefenseStore);

  // Debug services
  readonly waveDebug = inject(WaveDebugService);
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

  // ═══════════════════════════════════════════════════════════
  // Signal proxies — mostly from Store (single source of truth)
  // A few remain from services not yet consolidated into Store
  // ═══════════════════════════════════════════════════════════

  // Loading / Engine — from Store
  readonly loading = this.store.loading;
  readonly error = this.store.error;
  readonly loadingStatus = this.store.loadingStatus;
  readonly loadingSteps = this.store.loadingSteps;

  // Loading sub-states — owned by services (signal writers)
  readonly tilesLoading = this.engineInit.tilesLoading;
  readonly osmLoading = this.engineInit.osmLoading;
  readonly heightsLoading = this.heightUpdate.heightsLoading;
  readonly heightProgress = this.heightUpdate.heightProgress;

  // UI State — from Store
  readonly streetsVisible = this.store.streetsVisible;
  readonly routesVisible = this.store.routesVisible;
  readonly debugMode = this.store.debugMode;
  readonly debugLog = this.store.debugLog;
  readonly buildMode = this.store.buildMode;
  readonly selectedTowerType = this.store.selectedTowerType;

  // Debug / Height — from services (specialized)
  readonly heightDebugVisible = this.debugFacade.heightDebugVisible;

  // Location — from Store
  readonly editableHqLocation = this.locationMgmt.editableHqLocation;
  readonly editableSpawnLocations = this.locationMgmt.editableSpawnLocations;
  readonly isApplyingLocation = this.store.isApplyingLocation;
  readonly favorites = this.locationMgmt.favorites;
  readonly favoriteNamesMap = this.locationCoordinator.favoriteNamesMap;
  readonly spawnPoints = this.store.spawnPoints;
  readonly baseCoords = this.store.baseCoords;
  readonly centerCoords = this.store.centerCoords;
  readonly streetCount = this.store.streetCount;

  // Engine stats — from Store
  readonly fps = this.store.fps;
  readonly tileStats = this.store.tileStats;
  readonly mapAttribution = this.store.mapAttribution;
  readonly activeSounds = this.store.activeSounds;

  // Camera & debug — from Store
  readonly cameraHeading = this.store.cameraHeading;
  readonly compassRotation = this.store.compassRotation;
  readonly cameraFramingDebug = this.store.cameraFramingDebug;
  readonly cameraDebugEnabled = this.store.cameraDebugEnabled;
  readonly cameraDebugInfo = this.store.cameraDebugInfo;

  // Wave debug settings — from Store
  readonly enemySpeed = this.store.enemySpeed;
  readonly enemyHealth = this.store.enemyHealth;
  readonly enemyCount = this.store.enemyCount;
  readonly enemyType = this.store.enemyType;
  readonly enemyTypes = getAllEnemyTypes();
  readonly spawnMode = this.store.spawnMode;
  readonly spawnDelay = this.store.spawnDelay;

  // AI Director — from Store
  readonly useAIDirector = this.store.useAIDirector;
  readonly aiExplanation = this.store.aiExplanation;

  /** DevWorld regeneration in progress — from Store */
  readonly isDevWorldRegenerating = this.store.isDevWorldRegenerating;

  // Game state signals — sourced from Store (single source of truth via GSM→Store sync)
  readonly waveActive = this.store.waveActive;
  readonly isGameOver = this.store.isGameOver;
  readonly currentEnemyConfig = this.waveDebug.currentEnemyConfig;

  // Build mode hints for context hint box
  readonly buildModeHints: HintItem[] = [
    { key: 'R', description: 'Rotate' },
    { key: 'Click', description: 'Build' },
    { key: 'ESC', description: 'Cancel' },
    { key: 'Wait', description: 'Line of Sight' },
  ];
  readonly buildModeWarning = computed(() => this.towerPlacement.validationReason());

  // Map placement hints for context hint box
  readonly placementModeHints: HintItem[] = [
    { key: 'Click', description: 'Platzieren' },
    { key: 'ESC', description: 'Abbrechen' },
  ];
  readonly placementModeWarning = computed(() => this.mapPlacement.validationReason());

  // Map placement mode (HQ/Spawn)
  readonly mapPlacementMode = computed(() => this.uiStore.mapPlacementMode());
  readonly canPlaceOnMap = computed(() =>
    this.store.phase() === 'setup' && !this.engineInit.loading(),
  );

  // Controls hint auto-hide
  readonly controlsHintVisible = signal(true);
  private controlsHintTimer: ReturnType<typeof setTimeout> | null = null;

  // Location name for header display - delegates to service for consistent formatting
  readonly currentLocationName = computed(() => this.locationMgmt.getLocationDisplayName());

  // Tile stats polling is managed by EngineInitializationService

  constructor() {
    this.facade.initEffects(this);
  }

  async ngAfterViewInit(): Promise<void> {
    await this.facade.startGame(this.gameCanvas.nativeElement);
    this.applyPersistedAudioSettings();
    this.controlsHintTimer = setTimeout(() => this.controlsHintVisible.set(false), 15000);
  }

  /** Apply persisted audio volume/mute settings after engine init */
  private applyPersistedAudioSettings(): void {
    const musicVol = this.uiStore.musicMuted() ? 0 : this.uiStore.musicVolume();
    const sfxVol = this.uiStore.sfxMuted() ? 0 : this.uiStore.sfxVolume();
    this.gameState.backgroundMusic?.setVolume(musicVol);
    this.engine?.spatialAudio.setMasterVolume(sfxVol);
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
    if (this.controlsHintTimer) clearTimeout(this.controlsHintTimer);
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
    this.facade.refreshTerrainHeights();
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
   * Sell the currently selected tower — delegates to facade
   */
  sellSelectedTower(): void {
    this.facade.sellSelectedTower();
  }

  /**
   * Upgrade a tower — delegates to facade
   */
  upgradeTower(tower: Tower, upgradeId: UpgradeId): boolean {
    return this.facade.upgradeTower(tower, upgradeId);
  }

  /**
   * Change tower targeting strategy — direct property set
   */
  changeTargeting(tower: Tower, strategy: TargetingStrategy): void {
    tower.targetingStrategy = strategy;
  }

  /**
   * Change air-priority sub-strategy — direct property set
   */
  changeAirSubStrategy(tower: Tower, strategy: AirSubStrategy): void {
    tower.airSubStrategy = strategy;
  }

  /**
   * Start a new wave — delegates to facade
   */
  startWave(): void {
    this.facade.startWave();
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
    this.facade.startCustomWave();
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
   * Handle buildings toggle side effect (visibility already toggled by QuickActionsComponent)
   */
  onBuildingsToggled(): void {
    this.facade.onBuildingsToggled();
  }

  /**
   * Handle streets toggle side effect (visibility already toggled by QuickActionsComponent)
   */
  onStreetsToggled(): void {
    this.facade.onStreetsToggled();
  }

  /**
   * Handle routes toggle side effect (visibility already toggled by QuickActionsComponent)
   */
  onRoutesToggled(): void {
    this.facade.onRoutesToggled();
  }

  /**
   * Toggle special points debug (fire position markers, etc.)
   */
  onSpecialPointsDebugToggled(): void {
    this.facade.onSpecialPointsDebugToggled();
  }

  /**
   * Toggle global route grid debug visualization
   * Shows cells along routes with color-coded LOS and enemy presence
   */
  onSpatialGridDebugToggled(): void {
    this.facade.toggleSpatialGridDebug();
  }

  /**
   * Manually trigger route animation playback
   */
  onDpsBinsToggled(visible: boolean): void {
    this.facade.onDpsBinsToggled(visible);
  }

  onDamageNumbersToggled(visible: boolean): void {
    this.debugFacade.onDamageNumbersToggled(visible);
  }

  onMusicVolumeChanged(volume: number): void {
    this.gameState.backgroundMusic?.setVolume(volume);
  }

  onSfxVolumeChanged(volume: number): void {
    this.engine?.spatialAudio.setMasterVolume(volume);
  }

  onPlayRouteAnimation(): void {
    this.facade.onPlayRouteAnimation();
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
    this.facade.restartGame();
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

  /** Enter HQ placement mode */
  onPlaceHq(): void {
    this.facade.startMapPlacement('hq');
  }

  /** Enter spawn placement mode */
  onPlaceSpawn(): void {
    this.facade.startMapPlacement('spawn');
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
      getCanvasElement: () => this.gameCanvas.nativeElement,
      onTerrainClick: (lat, lon, height) => this.onTerrainClick(lat, lon, height),
      onMouseMove: (lat, lon, hitPoint) => this.onMouseMove(lat, lon, hitPoint),
      exitBuildMode: () => this.exitBuildMode(),
      handleEnemyPlacement: (lat, lon, height) => this.handleEnemyPlacement(lat, lon, height),
      onMapPlacementClick: (lat, lon, height) => this.facade.handleMapPlacementClick(lat, lon, height),
      onMapPlacementMove: (lat, lon, hitPoint) => {
        const h = this.engine?.getTerrainHeightAtGeo(lat, lon) ?? hitPoint.y;
        this.mapPlacement.updatePreviewPosition(lat, lon, h);
      },
      exitMapPlacement: () => this.mapPlacement.exitPlacementMode(),
    };
  }

}
