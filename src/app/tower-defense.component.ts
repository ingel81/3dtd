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
import { MatTooltipModule } from '@angular/material/tooltip';
import { StreetNetwork } from './services/location/osm-street.service';
import { ModelPreviewService } from './services/infrastructure/model-preview.service';
import { getAllEnemyTypes } from './configs/enemy-types.config';
import { GameSidebarComponent } from './components/game-sidebar/game-sidebar.component';
import { CompassComponent } from './components/compass/compass.component';
import { GameHeaderComponent } from './components/game-header/game-header.component';
// Deferred as one chunk, see debugWindowsRequested and debug-windows.ts
import {
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
  LosDebuggerComponent,
} from './components/debug-window/debug-windows';
import { QuickActionsComponent } from './components/quick-actions/quick-actions.component';
import { InfoOverlayComponent } from './components/info-overlay/info-overlay.component';
import { ContextHintComponent, HintAction, HintItem } from './components/context-hint/context-hint.component';
import { GameSpeedComponent } from './components/game-speed/game-speed.component';
import { BossBarComponent } from './components/boss-bar/boss-bar.component';
import { LoadingScreenComponent } from './components/loading-screen/loading-screen.component';
import { DevWorldService } from './devworld/devworld.service';
import { WaveDebugService } from './services/debug/wave-debug.service';
import { EnemyDebugService } from './services/debug/enemy-debug.service';
import { DebugFacadeService } from './services/debug/debug-facade.service';
import { DebugWindowService } from './services/debug/debug-window.service';
import { LocationConfig, FavoriteLocation } from './models/location.types';
// Refactoring services
import { CameraControlService } from './services/camera-control.service';
import { InputHandlerService } from './services/input-handler.service';
import { HotkeyService } from './services/hotkey.service';
import { TowerPlacementService } from './services/tower-placement.service';
import { AbilityTargetingService } from './services/ability-targeting.service';
import { HeroControlService } from './services/hero-control.service';
import { heroBarView } from './components/ability-bar/hero-bar';
import { MapPlacementService } from './services/world/map-placement.service';
import { LocationManagementService } from './services/location/location-management.service';
import { HeightUpdateService } from './services/world/height-update.service';
import { EngineInitializationService } from './services/infrastructure/engine-initialization.service';
import { DevStreetProvider } from './devworld/dev-street.provider';
import { LocationChangeCoordinatorService } from './services/location/location-change-coordinator.service';
import { TowerDefenseFacadeService, FacadeComponentBridge } from './services/facade/tower-defense-facade.service';
import { GameLoopFacadeService } from './services/facade/game-loop-facade.service';
import { VisualizationFacadeService } from './services/facade/visualization-facade.service';
import { TowerDefenseStore } from './store/tower-defense.store';
import { UIStore } from './store/ui.store';
import { ConfigService } from './core/services/config.service';
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
import type { BotSkillLevel } from './ai/training/bots/tower-bot.interface';
import { TdIconComponent } from './components/icon/icon.component';
import { LosLegendComponent } from './components/los-legend/los-legend.component';
import { IntroSkipComponent } from './components/intro-skip/intro-skip.component';
// Deferred in the template, loaded the first time the screen shows
import { TokenSetupComponent } from './components/token-setup/token-setup.component';
import { LeakVignetteComponent } from './components/leak-vignette/leak-vignette.component';
import { OffscreenIndicatorsComponent } from './components/offscreen-indicators/offscreen-indicators.component';
import { BloodMoonBannerComponent } from './components/blood-moon-banner/blood-moon-banner.component';
import { RelocationStatusComponent } from './components/relocation-status/relocation-status.component';
import { AbilityBarComponent } from './components/ability-bar/ability-bar.component';
import { RunSummaryComponent } from './components/run-summary/run-summary.component';
import { WorldRecordComponent } from './components/world-globe/world-record.component';
import { BossIntroComponent } from './components/boss-intro/boss-intro.component';
import { BestWaveService } from './services/location/best-wave.service';
import { PhotoModeService } from './services/photo-mode.service';
import { BossIntroService } from './services/boss-intro.service';
import { ReplayService } from './services/replay.service';
import { ReplayBarComponent } from './components/replay-bar/replay-bar.component';
import { OnboardingService } from './services/onboarding/onboarding.service';
import { IntroCameraFlightService } from './services/world/intro-camera-flight.service';
import { canTargetAirEffective } from './entities/tower-targeting.util';
import { ResearchStore } from './store/research.store';
import { BUILD_VERSION } from './configs/build-info.config';
import { isLocationDialogFailure } from './components/location-dialog/open-location-dialog';
import { ABILITIES } from './configs/abilities.config';

@Component({
  selector: 'app-tower-defense',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
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
    LosDebuggerComponent,
    QuickActionsComponent,
    InfoOverlayComponent,
    ContextHintComponent,
    GameSpeedComponent,
    BossBarComponent,
    LoadingScreenComponent,
    TdIconComponent,
    LosLegendComponent,
    IntroSkipComponent,
    TokenSetupComponent,
    LeakVignetteComponent,
    OffscreenIndicatorsComponent,
    BloodMoonBannerComponent,
    RelocationStatusComponent,
    AbilityBarComponent,
    RunSummaryComponent,
    BossIntroComponent,
    ReplayBarComponent,
    // Used only inside @defer on the game-over screen, so it loads with the globe as a lazy chunk
    WorldRecordComponent,
  ],
  providers: [
    GameStateManager,
    ModelPreviewService,
    // AI services (optional - game works without them)
    AIDataCollectorService,
    WaveDirectorService,
    TrainingClientService,
    // Facade services (depend on component-scoped providers above)
    TowerDefenseFacadeService,
    GameLoopFacadeService,
    VisualizationFacadeService,
    // Game hotkeys drive the facade, so they live in the same scope
    HotkeyService,
    // Deselects through the component-scoped GameStateManager
    PhotoModeService,
    // Listens on the component-scoped GameStateManager's bus, ticked by the game loop
    BossIntroService,
    // Plays the GameStateManager's recording; the game loop and the hotkeys drive it
    ReplayService,
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
  protected readonly uiStore = inject(UIStore);
  readonly configService = inject(ConfigService);

  /** True while the token screen is up instead of the game. */
  readonly awaitingCredentials = signal(false);
  private gameStarted = false;

  readonly injector = inject(Injector);

  // Refactoring services
  private readonly cameraControl = inject(CameraControlService);
  private readonly inputHandler = inject(InputHandlerService);
  private readonly hotkeys = inject(HotkeyService);
  private readonly towerPlacement = inject(TowerPlacementService);
  private readonly mapPlacement = inject(MapPlacementService);
  private readonly abilityTargeting = inject(AbilityTargetingService);
  private readonly locationMgmt = inject(LocationManagementService);
  private readonly heightUpdate = inject(HeightUpdateService);
  private readonly engineInit = inject(EngineInitializationService);
  private readonly locationCoordinator = inject(LocationChangeCoordinatorService);
  private readonly devWorld = inject(DevWorldService);
  readonly facade = inject(TowerDefenseFacadeService);
  readonly store = inject(TowerDefenseStore);
  /** Best wave per place; a new record shows on the game-over screen */
  readonly bestWaves = inject(BestWaveService);
  /** HUD hidden, screenshot bar on top */
  readonly photoMode = inject(PhotoModeService);
  /** Camera cut to a wave's boss with its title card */
  readonly bossIntro = inject(BossIntroService);
  /** Replay of the last wave: HUD hidden, replay bar at the bottom */
  readonly replay = inject(ReplayService);

  // Build / tiles version chips shown in the loading screen corners.
  readonly buildVersion = BUILD_VERSION;
  readonly tilesVersionLabel = computed(
    () => this.configService.tileProvider() === 'cesium' ? 'cesium · v3' : 'google · v3'
  );
  readonly missionInfo = this.locationMgmt.missionInfo;
  readonly devWorldSeed = computed(() => this.devWorld.isActive ? this.devWorld.config.seed : null);
  // Flips true the moment ANY 3D-Tile is in the visible set, the loading
  // screen uses this to fade out its dark backdrop layers and reveal the
  // live map underneath while the boot panel finishes. We deliberately
  // don't gate on engineInit.tilesLoading because that flag only flips
  // after 50+ tiles or a successful terrain raycast, which is way past
  // the point where the user can already see something. The DevWorld
  // fallback path drops tilesLoading immediately so we OR both signals.
  readonly tilesReady = computed(
    () => this.tileStats().visible > 0 || !this.engineInit.tilesLoading()
  );

  // Debug services
  readonly waveDebug = inject(WaveDebugService);
  readonly enemyDebug = inject(EnemyDebugService);
  readonly debugFacade = inject(DebugFacadeService);
  private readonly debugWindows = inject(DebugWindowService);

  /**
   * The debug windows load as one lazy chunk once the dev menu opens or a
   * window is open, which includes one restored from storage after a reload.
   * A `when` trigger fires once, the windows stay loaded after that. Only the
   * window components are deferred; their services, and the debug hooks on
   * window, are part of the game chunk as before.
   */
  readonly debugWindowsRequested = computed(
    () => this.uiStore.devMenuExpanded() || this.debugWindows.hasOpenWindows()
  );

  // AI Bot Training (delegated to TrainingClientService)
  private readonly trainingClient = inject(TrainingClientService);
  // Expose bot signals from service for template bindings
  readonly botEnabled = this.trainingClient.botEnabled;
  readonly botSkillLevel = this.trainingClient.botSkillLevel;
  readonly botStats = this.trainingClient.botStats;

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
  // Signal proxies, mostly from Store (single source of truth)
  // A few remain from services not yet consolidated into Store
  // ═══════════════════════════════════════════════════════════

  // Loading / Engine, from Store
  readonly loading = this.store.loading;
  readonly error = this.store.error;
  /** The error screen's way out: a reload when the location dialog failed, else new tile credentials */
  readonly errorOffersReload = computed(() => isLocationDialogFailure(this.error()));
  readonly loadingSteps = this.store.loadingSteps;

  // UI State, from Store
  readonly buildMode = this.store.buildMode;

  // Location, from Store/Services (used in TS methods + template)
  readonly editableHqLocation = this.locationMgmt.editableHqLocation;
  readonly editableSpawnLocations = this.locationMgmt.editableSpawnLocations;
  readonly favorites = this.locationMgmt.favorites;
  readonly favoriteNamesMap = this.locationCoordinator.favoriteNamesMap;
  readonly baseCoords = this.store.baseCoords;
  readonly streetCount = this.store.streetCount;

  // Engine stats, from Store
  readonly fps = this.store.fps;
  readonly tileStats = this.store.tileStats;
  readonly mapAttribution = this.store.mapAttribution;
  readonly activeSounds = this.store.activeSounds;

  // Camera, from Store
  readonly compassRotation = this.store.compassRotation;
  readonly cameraFramingDebug = this.store.cameraFramingDebug;

  readonly enemyTypes = getAllEnemyTypes();

  /** DevWorld regeneration in progress, from Store */
  readonly isDevWorldRegenerating = this.store.isDevWorldRegenerating;

  // Game state signals, sourced from Store (single source of truth via GSM→Store sync)
  readonly waveActive = this.store.waveActive;
  readonly isGameOver = this.store.isGameOver;

  // LOS-Legend: sichtbar während Build-Mode ODER bei selektiertem Tower.
  // Capabilities aus dem jeweils relevanten Tower(-Type) gelesen, mit
  // AA-Retrofit-Research im Air-Bit (mixed Tower wie dual-gatling
  // werden erst nach Research zu canTargetAir=true).
  private readonly researchStore = inject(ResearchStore);
  /** Intro camera flight: takes Esc (skip) and holds the other game keys back, see onKeyDown */
  private readonly introFlight = inject(IntroCameraFlightService);
  /** Intro camera flight is playing, gates the Skip control. */
  readonly introFlightActive = this.introFlight.active;

  readonly losLegendVisible = computed(() => {
    if (this.buildMode() && this.store.selectedTowerType()) return true;
    if (this.store.selectedTower()) return true;
    return false;
  });
  readonly losLegendCanGround = computed(() => {
    const typeId = this.activeLosTowerTypeId();
    if (!typeId) return false;
    // canTargetGround ist optional und defaultet auf true (siehe Tower-Config).
    return TOWER_TYPES[typeId]?.canTargetGround ?? true;
  });
  readonly losLegendCanAir = computed(() => {
    const typeId = this.activeLosTowerTypeId();
    if (!typeId) return false;
    return canTargetAirEffective(typeId, this.researchStore.airTargetingUnlocked());
  });

  /** Tower-Type-Id für die LOS-Legende: Build-Mode-Type oder selektierter Tower-Type. */
  private activeLosTowerTypeId = computed<TowerTypeId | null>(() => {
    if (this.buildMode()) return this.store.selectedTowerType();
    const tower = this.store.selectedTower();
    return tower ? (tower.typeConfig.id as TowerTypeId) : null;
  });

  // Build mode hints for context hint box
  readonly buildModeHints: HintItem[] = [
    { key: 'R', description: 'Rotate' },
    { key: 'Click', description: 'Build' },
    { key: 'ESC', description: 'Cancel' },
    { key: 'Hover', description: 'Line of Sight' },
  ];
  readonly buildModeWarning = computed(() => this.towerPlacement.validationReason());

  // Map placement hints for context hint box: R turns a spawn portal
  readonly placementModeHints = computed((): HintItem[] => [
    ...(this.mapPlacementMode() === 'spawn' ? [{ key: 'R', description: 'Rotate' }] : []),
    { key: 'Click', description: 'Place' },
    { key: 'ESC', description: 'Cancel' },
  ]);
  readonly placementModeWarning = computed(() => this.mapPlacement.validationReason());

  // Ability targeting hints for context hint box: what a click does comes from the ability
  readonly abilityTargetingActive = computed(() => this.abilityTargeting.targeting() !== null);
  readonly abilityTargetingHints = computed((): HintItem[] => {
    const id = this.abilityTargeting.targeting();
    return [
      { key: 'Click', description: id ? ABILITIES[id].aimHint : '' },
      { key: 'ESC', description: 'Cancel' },
    ];
  });
  readonly abilityTargetingWarning = this.abilityTargeting.warning;

  // Hero selected: the next click on the route sends him
  private readonly heroControl = inject(HeroControlService);
  readonly heroSelected = this.heroControl.selected;
  readonly heroHints: HintItem[] = [
    { key: 'Click', description: 'Send' },
    { key: 'V', description: 'Ammo' },
    { key: 'G', description: 'Camera' },
    { key: 'ESC', description: 'Let go' },
  ];
  readonly heroWarning = this.heroControl.warning;
  /** His button at the top of the ability bar: the hire offer, then him */
  readonly heroBar = computed(() => heroBarView(this.store.hero(), this.heroSelected(), this.store.credits()));

  onHeroBarPressed(): void {
    const bar = this.heroBar();
    if (bar?.action === 'hire') this.heroControl.hire();
    else if (bar?.action === 'summon') this.heroControl.summon();
  }

  // First-run tips share the context hint box; build, placement and targeting hints come first
  private readonly onboarding = inject(OnboardingService);
  readonly onboardingActions: HintAction[] = [
    { id: 'skip', label: 'Skip' },
    { id: 'hide', label: 'Hide tips' },
  ];
  /** Tip on screen: only over the running game, not over the intro flight, game over, photo mode or the replay */
  readonly onboardingTip = computed(() => {
    if (this.loading() || this.error() || this.awaitingCredentials()) return null;
    if (this.introFlightActive() || this.isGameOver() || this.uiStore.viewOnly()) return null;
    return this.onboarding.tip();
  });

  onOnboardingAction(id: string): void {
    if (id === 'skip') this.onboarding.skip();
    else if (id === 'hide') this.onboarding.hide();
  }

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
    // `?tokensetup` forces the screen even when credentials are already there.
    // It is how you swap a key without clearing site data, and the only way to
    // reach the first-run flow on a dev machine that has a token in environment.ts.
    const forceTokenSetup = new URLSearchParams(window.location.search).has('tokensetup');

    // No tile credentials yet: ask for them before the engine starts, otherwise
    // the player lands on an error overlay telling them to edit a source file
    // they do not have. DevWorld needs no tiles and skips the whole question.
    if ((forceTokenSetup || this.configService.needsCredentials()) && !this.devWorld.isActive) {
      this.awaitingCredentials.set(true);
      return;
    }

    await this.startGameSequence();
  }

  /**
   * Credentials arrived from the token screen. Before the engine ever started we
   * can just start it; if it is already up (a token was rejected mid-flight) a
   * reload is the honest way to rebuild the whole tile pipeline.
   */
  async onCredentialsSaved(): Promise<void> {
    this.awaitingCredentials.set(false);

    if (this.gameStarted) {
      window.location.reload();
      return;
    }

    await this.startGameSequence();
  }

  /** The token screen's chunk did not load (@error of its @defer): a reload fetches it again. */
  reloadPage(): void {
    window.location.reload();
  }

  private async startGameSequence(): Promise<void> {
    this.gameStarted = true;
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
    // A running boss intro takes Esc (skip) and holds the other game keys back
    if (this.bossIntro.handleKeyDown(event)) return;
    // So does the intro flight
    if (this.introFlight.handleKeyDown(event)) return;
    // Photo mode and the replay keep Tab in their bar
    this.photoMode.trapTab(event);
    this.replay.trapTab(event);
    this.inputHandler.handleKeyDown(event);
    // Game hotkeys take what the input handler left alone (not defaultPrevented)
    this.hotkeys.handleKeyDown(event);
  }

  @HostListener('window:keyup', ['$event'])
  onKeyUp(event: KeyboardEvent): void {
    this.inputHandler.handleKeyUp(event);
    this.hotkeys.handleKeyUp(event);
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
    // The cursor ray already hit the exact surface the player is pointing at
    //, a rooftop, a bridge deck, the street. Use it.
    //
    // This used to re-derive the height with `getTerrainHeightAtGeo`, which
    // throws that away and answers for the column instead. That was tolerable
    // while the column returned its topmost hit, but it now returns the
    // walkable ground of the finest LOD, which is the right answer for where
    // enemies walk and the wrong one here: over a tall building the column's
    // ground is the street far below, so the preview sank to street level and
    // placing on rooftops stopped working. Low buildings still mostly worked
    // because the error was only a few metres.
    this.towerPlacement.updatePreviewPosition(lat, lon, hitPoint.y);
  }

  /**
   * Handle enemy placement from debug panel, delegated to EnemyDebugService
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
   * Add a spawn point, delegates to facade
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
   * Sell the currently selected tower, delegates to facade
   */
  sellSelectedTower(): void {
    this.facade.sellSelectedTower();
  }

  /**
   * Upgrade a tower, delegates to facade
   */
  upgradeTower(tower: Tower, upgradeId: UpgradeId): boolean {
    return this.facade.upgradeTower(tower, upgradeId);
  }

  /**
   * Change tower targeting strategy, through the command bus like every
   * other player action (the replay records it)
   */
  changeTargeting(tower: Tower, strategy: TargetingStrategy): void {
    this.facade.emitCommand({ type: 'command:set-targeting', towerId: tower.id, strategy });
  }

  /**
   * Change air-priority sub-strategy, through the command bus
   */
  changeAirSubStrategy(tower: Tower, strategy: AirSubStrategy): void {
    this.facade.emitCommand({ type: 'command:set-targeting', towerId: tower.id, airSubStrategy: strategy });
  }

  onStartResearch(researchId: string): void {
    this.facade.emitCommand({ type: 'command:start-research', researchId });
  }

  onCancelResearch(researchId: string): void {
    this.facade.emitCommand({ type: 'command:cancel-research', researchId });
  }

  onQueueResearch(researchId: string): void {
    this.facade.emitCommand({ type: 'command:queue-research', researchId });
  }

  onUnqueueResearch(researchId: string): void {
    this.facade.emitCommand({ type: 'command:unqueue-research', researchId });
  }

  /**
   * Start a new wave, delegates to facade
   */
  startWave(): void {
    this.facade.startWave();
  }

  /**
   * Toggle AI Director mode, delegates to facade
   */
  toggleAIDirector(): void {
    this.facade.toggleAIDirector();
  }

  /**
   * Toggle static-curriculum fallback (debug button in quick-actions).
   */
  onStaticCurriculumToggled(): void {
    this.facade.toggleStaticCurriculum();
  }

  /**
   * Start custom wave, delegates to facade
   */
  startCustomWave(): void {
    this.facade.startCustomWave();
  }

  /**
   * Get AI Director status text, delegates to facade
   */
  getAIStatusText(): string {
    return this.facade.getAIStatusText();
  }

  /**
   * Enable StrategyBot for automated training, delegates to TrainingClientService
   */
  enableBot(skillLevel: BotSkillLevel): void {
    this.trainingClient.enableBot(skillLevel);
  }

  /**
   * Disable StrategyBot, delegates to TrainingClientService
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
   * Toggle the air-route tube, magenta dashed tube at air flight
   * altitude along every enemy route. Persistent in UIStore.
   */
  onAirRouteToggled(): void {
    this.gameState.getGlobalRouteGrid().toggleAirRouteLayer();
  }

  /**
   * Toggle the global air-cell debug overlay, same cell set as the
   * spatial grid debug, but elevated to terrainY + airSampleYOffset
   * and drawn in the air-layer colour. Persistent in UIStore.
   */
  onAirSpatialGridDebugToggled(): void {
    this.gameState.getGlobalRouteGrid().toggleAirSpatialGridDebug();
  }

  /**
   * Cycle the per-tower LOS filter (Both → Ground only → Air only).
   * Pure UIStore mutation, TowerPlacementService and TowerManager
   * react via their own effects.
   */
  onPerTowerLosFilterCycled(): void {
    this.uiStore.cyclePerTowerLosFilter();
  }

  /**
   * Manually trigger route animation playback
   */
  onDpsBinsToggled(visible: boolean): void {
    this.facade.onDpsBinsToggled(visible);
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
   * Toggle camera framing debug, delegates to facade
   */
  toggleCameraFramingDebug(): void {
    this.facade.toggleCameraFramingDebug();
  }

  /**
   * Toggle camera debug, delegates to facade
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
  addDebugCredits(event: MouseEvent): void {
    this.debugFacade.addDebugCredits(this.gameState, event.shiftKey ? 100000 : 1000);
  }
  addDebugHealth(event: MouseEvent): void {
    // A right click takes HP instead, to walk the HQ fire through its stages
    const take = event.type === 'contextmenu';
    const amount = take ? (event.shiftKey ? -50 : -10) : (event.shiftKey ? 100000 : 1000);
    this.debugFacade.addDebugHealth(this.gameState, amount);
  }
  completeAllResearch(): void {
    this.debugFacade.completeAllResearch(this.gameState);
  }
  maxUpgradeAllTowers(): void {
    this.debugFacade.maxUpgradeAllTowers(this.gameState);
  }
  readyAbilities(): void {
    this.debugFacade.readyAbilities(this.gameState);
  }
  readyHero(): void {
    this.debugFacade.readyHero(this.gameState);
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
   * Restart game, delegates to facade
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

  /** Save current location as favorite, under the name from the header's field */
  onAddFavorite(name: string): void {
    this.locationCoordinator.onAddFavorite(name);
  }

  /** Rename a favorite; an empty name goes back to the geocoded one */
  onRenameFavorite(id: string, name: string): void {
    this.locationCoordinator.onRenameFavorite(id, name);
  }

  /** Move a favorite up (-1) or down (1) in the list */
  onMoveFavorite(id: string, offset: number): void {
    this.locationCoordinator.onMoveFavorite(id, offset);
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
