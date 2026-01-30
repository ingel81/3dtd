/**
 * TowerDefenseStore — Central Signal Store for all game state
 *
 * ARCHITECTURE DESIGN — NOT YET WIRED IN
 *
 * This store consolidates ALL scattered signals from:
 *   - TowerDefenseComponent (30+ proxy signals, writable signals, computed)
 *   - GameUIStateService (debug, layer toggles, perf stats)
 *   - GameStateManager (credits, health, phase, wave, enemies)
 *   - TowerDefenseFacadeService (bridge pattern with WritableSignal pass-through)
 *   - WaveDebugService, EnemyDebugService, TowerDebugService (debug overrides)
 *   - TrainingClientService (bot signals)
 *
 * WHY THIS IS BETTER:
 *   1. Single Source of Truth — No more "proxy signals" that just re-export
 *      another service's signal. Currently the component has 40+ lines like:
 *        readonly fps = this.uiState.fps;
 *        readonly buildMode = this.towerPlacement.buildMode;
 *      These are not proxies — they ARE the state. The store owns them.
 *
 *   2. No more FacadeComponentBridge — The current FacadeComponentBridge passes
 *      WritableSignals from the component INTO a service via initialize().
 *      This is a code smell: the service mutates component-owned state.
 *      With the store, both component and facade READ from the same store.
 *
 *   3. Testable — Inject TowerDefenseStore, set signals, assert computed values.
 *      No need to instantiate a 500-line component to test game logic.
 *
 *   4. Component becomes pure view — The component reads signals and calls
 *      action methods. Zero state management in the component itself.
 *
 *   5. DevTools-friendly — All state in one place = easy console debugging.
 *      `inject(TowerDefenseStore)` in browser console shows everything.
 *
 * MIGRATION PLAN: See docs/SIGNAL-STORE-ARCHITECTURE.md
 */

import { Injectable, signal, computed, Signal } from '@angular/core';
import { TowerTypeId } from '../configs/tower-types.config';
import { GAME_BALANCE } from '../configs/game-balance.config';
import { Tower } from '../entities/tower.entity';
import { BotSkillLevel } from '../ai/training/bots/tower-bot.interface';

// ═══════════════════════════════════════════════════════════════
// Type Definitions
// ═══════════════════════════════════════════════════════════════

/** Game phase lifecycle */
export type GamePhase = 'setup' | 'wave' | 'paused' | 'gameover';

/** Geo coordinate (minimal) */
export interface GeoCoord {
  lat: number;
  lon: number;
}

/** Geo coordinate with height */
export interface GeoCoordWithHeight extends GeoCoord {
  height: number;
}

/** Spawn point definition */
export interface StoreSpawnPoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  color: number;
}

/** Favorite location */
export interface StoreFavoriteLocation {
  id: string;
  name: string;
  hq: GeoCoord;
  spawns: GeoCoord[];
}

/** Tile loading statistics */
export interface TileStats {
  parsing: number;
  downloading: number;
  total: number;
  visible: number;
}

/** Camera debug info */
export interface CameraDebugInfo {
  posX: number; posY: number; posZ: number;
  rotX: number; rotY: number; rotZ: number;
  heading: number; pitch: number; altitude: number;
  distanceToCenter: number; fov: number; terrainHeight: number;
}

/** Loading step for init sequence */
export interface LoadingStep {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'done' | 'error';
  detail?: string;
}

// ═══════════════════════════════════════════════════════════════
// Store
// ═══════════════════════════════════════════════════════════════

@Injectable({ providedIn: 'root' })
export class TowerDefenseStore {

  // ════════════════════════════════════════════════════════════
  // GAME STATE — currently in GameStateManager
  // ════════════════════════════════════════════════════════════

  /** Player credits (gold) */
  readonly credits = signal<number>(GAME_BALANCE.player.startCredits);

  /** Base health points */
  readonly baseHealth = signal<number>(GAME_BALANCE.player.startHealth);

  /** Current game phase */
  readonly phase = signal<GamePhase>('setup');

  /** Current wave number (0 = no wave started yet) */
  readonly waveNumber = signal<number>(0);

  /** Number of enemies currently alive */
  readonly enemiesAlive = signal<number>(0);

  /** Currently selected tower (for info panel / upgrades) */
  readonly selectedTower = signal<Tower | null>(null);

  /** Selected tower ID shortcut */
  readonly selectedTowerId = computed(() => this.selectedTower()?.id ?? null);

  /** Total placed tower count */
  readonly towerCount = signal<number>(0);

  /** Show game over overlay screen */
  readonly showGameOverScreen = signal<boolean>(false);

  /** Training mode timescale (1.0 = normal, up to 75x) */
  readonly trainingTimescale = signal<number>(1.0);

  // ════════════════════════════════════════════════════════════
  // LOADING / INIT STATE — currently in EngineInitializationService
  // ════════════════════════════════════════════════════════════

  /** Global loading flag */
  readonly loading = signal<boolean>(true);

  /** Tiles loading sub-state */
  readonly tilesLoading = signal<boolean>(true);

  /** OSM streets loading sub-state */
  readonly osmLoading = signal<boolean>(true);

  /** Heights loading sub-state */
  readonly heightsLoading = signal<boolean>(false);

  /** Height update progress (0..1) */
  readonly heightProgress = signal<number>(0);

  /** Error message (null = no error) */
  readonly error = signal<string | null>(null);

  /** Loading status string for progress UI */
  readonly loadingStatus = signal<string>('Initializing...');

  /** Ordered loading steps */
  readonly loadingSteps = signal<LoadingStep[]>([]);

  // ════════════════════════════════════════════════════════════
  // UI STATE — currently in GameUIStateService
  // ════════════════════════════════════════════════════════════

  /** Debug panel visibility */
  readonly debugMode = signal<boolean>(false);

  /** Layer menu expanded */
  readonly layerMenuExpanded = signal<boolean>(false);

  /** Developer menu expanded */
  readonly devMenuExpanded = signal<boolean>(false);

  /** Street network layer visibility */
  readonly streetsVisible = signal<boolean>(false);

  /** Route paths visibility */
  readonly routesVisible = signal<boolean>(false);

  /** Height debug markers visibility */
  readonly heightDebugVisible = signal<boolean>(false);

  /** Special points debug visibility */
  readonly specialPointsDebugVisible = signal<boolean>(false);

  /** Info overlay (FPS, tiles, enemies, sounds) */
  readonly infoOverlayVisible = signal<boolean>(false);

  /** Spatial grid debug */
  readonly spatialGridDebugVisible = signal<boolean>(false);

  /** DPS bins visualization */
  readonly dpsBinsVisible = signal<boolean>(false);

  /** Debug log output */
  readonly debugLog = signal<string>('');

  // ════════════════════════════════════════════════════════════
  // BUILD MODE — currently in TowerPlacementService
  // ════════════════════════════════════════════════════════════

  /** Build mode active */
  readonly buildMode = signal<boolean>(false);

  /** Selected tower type for placement */
  readonly selectedTowerType = signal<TowerTypeId | null>(null);

  /** Build validation reason (why placement is invalid) */
  readonly buildValidationReason = signal<string | null>(null);

  /** Location being applied (disables certain UI) */
  readonly isApplyingLocation = signal<boolean>(false);

  // ════════════════════════════════════════════════════════════
  // LOCATION — currently split across Component + LocationMgmt
  // ════════════════════════════════════════════════════════════

  /** HQ / base coordinates */
  readonly baseCoords = signal<GeoCoord>({ lat: 0, lon: 0 });

  /** Camera center coordinates (with height) */
  readonly centerCoords = signal<GeoCoordWithHeight>({ lat: 0, lon: 0, height: 400 });

  /** Active spawn points */
  readonly spawnPoints = signal<StoreSpawnPoint[]>([]);

  /** Current location display name */
  readonly currentLocationName = signal<string>('');

  /** Saved favorite locations */
  readonly favorites = signal<StoreFavoriteLocation[]>([]);

  /** Favorite names lookup map */
  readonly favoriteNamesMap = signal<Map<string, string>>(new Map());

  // ════════════════════════════════════════════════════════════
  // ENGINE / PERFORMANCE — currently in GameUIStateService
  // ════════════════════════════════════════════════════════════

  /** Frames per second */
  readonly fps = signal<number>(0);

  /** Tile loading statistics */
  readonly tileStats = signal<TileStats>({ parsing: 0, downloading: 0, total: 0, visible: 0 });

  /** Active spatial audio sound count */
  readonly activeSounds = signal<number>(0);

  /** Map attribution text */
  readonly mapAttribution = signal<string>('Map data ©2024 Google');

  /** Camera compass heading (0=N, 90=E, 180=S, 270=W) */
  readonly cameraHeading = signal<number>(0);

  /** Accumulated compass rotation (avoids 0°/360° flip) */
  readonly compassRotation = signal<number>(0);

  /** Camera debug overlay enabled */
  readonly cameraDebugEnabled = signal<boolean>(false);

  /** Camera debug info */
  readonly cameraDebugInfo = signal<CameraDebugInfo | null>(null);

  /** Camera framing debug visualization */
  readonly cameraFramingDebug = signal<boolean>(false);

  /** Street count in loaded network */
  readonly streetCount = signal<number>(0);

  // ════════════════════════════════════════════════════════════
  // BOT / AI — currently in TrainingClientService + Component
  // ════════════════════════════════════════════════════════════

  /** Strategy bot enabled */
  readonly botEnabled = signal<boolean>(false);

  /** Bot skill level */
  readonly botSkillLevel = signal<BotSkillLevel>('beginner');

  /** Bot auto mode (auto-start waves, auto-restart) */
  readonly botAutoMode = signal<boolean>(false);

  /** AI Wave Director enabled */
  readonly useAIDirector = signal<boolean>(false);

  /** AI explanation text for current wave */
  readonly aiExplanation = signal<string | null>(null);

  // ════════════════════════════════════════════════════════════
  // DEVWORLD — currently in Component
  // ════════════════════════════════════════════════════════════

  /** DevWorld is regenerating terrain */
  readonly isDevWorldRegenerating = signal<boolean>(false);

  // ════════════════════════════════════════════════════════════
  // WAVE DEBUG — currently in WaveDebugService
  // ════════════════════════════════════════════════════════════

  /** Debug: enemy speed override */
  readonly enemySpeed = signal<number>(2.0);

  /** Debug: enemy health override */
  readonly enemyHealth = signal<number>(100);

  /** Debug: enemy count per wave */
  readonly enemyCount = signal<number>(5);

  /** Debug: enemy type */
  readonly enemyType = signal<string>('basic');

  /** Debug: spawn mode (sequential / random / all) */
  readonly spawnMode = signal<string>('sequential');

  /** Debug: spawn delay in ms */
  readonly spawnDelay = signal<number>(1000);

  // ════════════════════════════════════════════════════════════
  // COMPUTED VALUES — derived from signals above
  // ════════════════════════════════════════════════════════════

  /** Whether a wave is currently active */
  readonly waveActive: Signal<boolean> = computed(() => this.phase() === 'wave');

  /** Whether the game is over */
  readonly isGameOver: Signal<boolean> = computed(() => this.phase() === 'gameover');

  /** Whether the game has started (at least one wave played) */
  readonly gameStarted: Signal<boolean> = computed(() => this.waveNumber() > 0 || this.phase() !== 'setup');

  /** Whether the player can start a wave */
  readonly canStartWave: Signal<boolean> = computed(() =>
    !this.waveActive() &&
    !this.isGameOver() &&
    !this.loading() &&
    this.spawnPoints().length > 0
  );

  /** Whether the player can place towers */
  readonly canPlaceTowers: Signal<boolean> = computed(() =>
    !this.isGameOver() &&
    !this.loading() &&
    this.buildMode()
  );

  /** Health percentage (0..100) */
  readonly healthPercent: Signal<number> = computed(() =>
    Math.round((this.baseHealth() / GAME_BALANCE.player.startHealth) * 100)
  );

  /** Health is critical (≤ 25%) */
  readonly healthCritical: Signal<boolean> = computed(() => this.healthPercent() <= 25);

  /** Build mode hint items (static, but exposed as signal-compatible) */
  readonly buildModeHints = [
    { key: 'R', description: 'Rotate' },
    { key: 'Click', description: 'Build' },
    { key: 'ESC', description: 'Cancel' },
    { key: 'Wait', description: 'Line of Sight' },
  ] as const;

  /** Build mode warning text */
  readonly buildModeWarning: Signal<string | null> = computed(() => this.buildValidationReason());

  // ════════════════════════════════════════════════════════════
  // ACTION METHODS — state mutations + side effects
  // ════════════════════════════════════════════════════════════

  // ── Game Actions ──────────────────────────────────────────

  /**
   * Place a tower at the current preview position.
   * Deducts credits, emits command:place-tower event.
   *
   * TODO: Delegate to GameStateManager.placeTower() or emit event.
   *       Validate credits >= cost, check placement validity.
   *       On success: update towerCount, deduct credits.
   */
  placeTower(_typeId: TowerTypeId, _lat: number, _lon: number, _height: number, _rotation: number): void {
    // TODO: Implement — emit 'command:place-tower' via EventBus
  }

  /**
   * Sell the currently selected tower.
   * Refunds 50% of total investment.
   *
   * TODO: Delegate to GameStateManager.sellTower().
   *       On success: update credits, clear selectedTower, update towerCount.
   */
  sellSelectedTower(): void {
    // TODO: Implement — emit 'command:sell-tower' via EventBus
  }

  /**
   * Upgrade a tower with a specific upgrade path.
   *
   * TODO: Validate credits >= upgrade cost, tower.canUpgrade().
   *       Emit 'command:upgrade-tower' via EventBus.
   */
  upgradeTower(_tower: Tower, _upgradeId: string): boolean {
    // TODO: Implement — emit 'command:upgrade-tower' via EventBus
    return false;
  }

  // ── Wave Actions ──────────────────────────────────────────

  /**
   * Start the next wave (manual or AI-directed).
   *
   * TODO: Check canStartWave(). If useAIDirector, request AI config.
   *       Otherwise build WaveConfig from debug signals.
   *       Emit 'command:start-wave' via EventBus.
   */
  startWave(): void {
    // TODO: Implement — delegate to facade or emit event directly
  }

  /**
   * Start a custom wave with current debug panel settings.
   *
   * TODO: Build WaveConfig from enemySpeed/health/count/type/spawnMode/spawnDelay.
   *       Emit 'command:start-wave' via EventBus.
   */
  startCustomWave(): void {
    // TODO: Implement
  }

  /**
   * Restart the game to initial state.
   *
   * TODO: Reset all game signals to defaults.
   *       Emit 'command:restart-game' via EventBus.
   *       Clear towers, enemies, projectiles.
   */
  restartGame(): void {
    // TODO: Implement — emit 'command:restart-game' via EventBus
  }

  // ── Build Mode Actions ────────────────────────────────────

  /**
   * Toggle build mode on/off.
   *
   * TODO: If entering: set buildMode=true, keep selectedTowerType.
   *       If exiting: set buildMode=false, clear preview.
   */
  toggleBuildMode(): void {
    this.buildMode.update(v => !v);
    if (!this.buildMode()) {
      this.selectedTowerType.set(null);
      this.buildValidationReason.set(null);
    }
  }

  /**
   * Select a tower type and enter build mode.
   *
   * TODO: Set selectedTowerType, activate buildMode, create preview mesh.
   */
  selectTowerType(typeId: TowerTypeId): void {
    this.selectedTowerType.set(typeId);
    this.buildMode.set(true);
  }

  // ── AI / Bot Actions ──────────────────────────────────────

  /**
   * Toggle AI Wave Director mode.
   *
   * TODO: Toggle useAIDirector signal.
   */
  toggleAIDirector(): void {
    this.useAIDirector.update(v => !v);
  }

  /**
   * Enable strategy bot with given skill level.
   *
   * TODO: Delegate to TrainingClientService.enableBot().
   */
  enableBot(_skillLevel: BotSkillLevel): void {
    // TODO: Implement
  }

  /**
   * Disable strategy bot.
   *
   * TODO: Delegate to TrainingClientService.disableBot().
   */
  disableBot(): void {
    // TODO: Implement
  }

  // ── UI Toggle Actions ─────────────────────────────────────

  /** Toggle debug panel */
  toggleDebugMode(): void {
    this.debugMode.update(v => !v);
  }

  /** Toggle street layer */
  toggleStreets(): void {
    this.streetsVisible.update(v => !v);
  }

  /** Toggle route layer */
  toggleRoutes(): void {
    this.routesVisible.update(v => !v);
  }

  /** Toggle info overlay (FPS, etc.) */
  toggleInfoOverlay(): void {
    this.infoOverlayVisible.update(v => !v);
  }

  /** Toggle height debug markers */
  toggleHeightDebug(): void {
    this.heightDebugVisible.update(v => !v);
  }

  /** Toggle camera debug overlay */
  toggleCameraDebug(): void {
    this.cameraDebugEnabled.update(v => !v);
  }

  /** Toggle spatial grid debug */
  toggleSpatialGridDebug(): void {
    this.spatialGridDebugVisible.update(v => !v);
  }

  /** Toggle DPS bins visualization */
  toggleDpsBins(): void {
    this.dpsBinsVisible.update(v => !v);
  }

  // ── Debug Actions ─────────────────────────────────────────

  /**
   * Add debug credits.
   *
   * TODO: Emit 'debug:add-credits' via EventBus.
   */
  addDebugCredits(amount = 500): void {
    this.credits.update(c => c + amount);
    // TODO: Also emit event for EventBus subscribers
  }

  /**
   * Add debug health.
   *
   * TODO: Emit 'debug:add-health' via EventBus.
   */
  addDebugHealth(amount = 25): void {
    this.baseHealth.update(h => Math.min(GAME_BALANCE.player.startHealth, h + amount));
    // TODO: Also emit event for EventBus subscribers
  }

  /**
   * Kill all enemies (debug).
   *
   * TODO: Delegate to GameStateManager/EnemyManager.
   */
  killAllEnemies(): void {
    // TODO: Implement — iterate enemies, deal lethal damage
  }

  /** Append to debug log (max 50 lines) */
  appendDebugLog(message: string): void {
    this.debugLog.update(log => {
      const lines = log.split('\n');
      if (lines.length > 50) lines.shift();
      return [...lines, message].join('\n');
    });
  }

  /** Clear debug log */
  clearDebugLog(): void {
    this.debugLog.set('');
  }

  // ── Location Actions ──────────────────────────────────────

  /**
   * Set base coordinates (HQ position).
   *
   * TODO: Update baseCoords, centerCoords, sync URL.
   */
  setBaseCoords(coords: GeoCoord): void {
    this.baseCoords.set(coords);
    this.centerCoords.update(c => ({ ...c, lat: coords.lat, lon: coords.lon }));
  }

  /**
   * Add a spawn point.
   *
   * TODO: Append to spawnPoints signal, create marker visualization.
   */
  addSpawnPoint(spawn: StoreSpawnPoint): void {
    this.spawnPoints.update(points => [...points, spawn]);
  }

  /**
   * Clear all spawn points.
   */
  clearSpawnPoints(): void {
    this.spawnPoints.set([]);
  }

  // ── Engine Stats Update (throttled, called from game loop) ──

  /**
   * Update performance stats from engine.
   * Called ~10Hz from the game loop (outside Angular zone).
   *
   * TODO: Migrate throttling logic from GameUIStateService.updateThrottledStats().
   */
  updateEngineStats(snapshot: {
    fps: number;
    tileStats: TileStats;
    activeSoundCount: number;
    attribution?: string;
    cameraHeading: number;
    cameraDebugInfo?: CameraDebugInfo | null;
  }): void {
    this.fps.set(snapshot.fps);
    this.tileStats.set(snapshot.tileStats);
    this.activeSounds.set(snapshot.activeSoundCount);

    if (snapshot.attribution) {
      this.mapAttribution.set(snapshot.attribution);
    }

    // Compass heading with wrap-around
    const heading = Math.round(snapshot.cameraHeading);
    if (heading !== this.cameraHeading()) {
      const oldHeading = this.cameraHeading();
      this.cameraHeading.set(heading);

      let delta = heading - oldHeading;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      this.compassRotation.update(rot => rot + delta);
    }

    if (this.cameraDebugEnabled() && snapshot.cameraDebugInfo) {
      this.cameraDebugInfo.set(snapshot.cameraDebugInfo);
    }
  }

  // ════════════════════════════════════════════════════════════
  // RESET
  // ════════════════════════════════════════════════════════════

  /**
   * Reset all game state to initial values.
   * Called on game restart.
   *
   * NOTE: Does NOT reset UI preferences (debugMode, layer visibility, etc.)
   *       Those are user choices that persist across games.
   */
  resetGameState(): void {
    this.credits.set(GAME_BALANCE.player.startCredits);
    this.baseHealth.set(GAME_BALANCE.player.startHealth);
    this.phase.set('setup');
    this.waveNumber.set(0);
    this.enemiesAlive.set(0);
    this.selectedTower.set(null);
    this.towerCount.set(0);
    this.showGameOverScreen.set(false);
    this.buildMode.set(false);
    this.selectedTowerType.set(null);
    this.buildValidationReason.set(null);
    this.aiExplanation.set(null);
  }

  /**
   * Full reset including UI state.
   * Used for complete teardown.
   */
  resetAll(): void {
    this.resetGameState();
    this.debugMode.set(false);
    this.layerMenuExpanded.set(false);
    this.devMenuExpanded.set(false);
    this.streetsVisible.set(false);
    this.routesVisible.set(false);
    this.heightDebugVisible.set(false);
    this.specialPointsDebugVisible.set(false);
    this.infoOverlayVisible.set(false);
    this.spatialGridDebugVisible.set(false);
    this.dpsBinsVisible.set(false);
    this.fps.set(0);
    this.tileStats.set({ parsing: 0, downloading: 0, total: 0, visible: 0 });
    this.activeSounds.set(0);
    this.mapAttribution.set('Map data ©2024 Google');
    this.cameraHeading.set(0);
    this.compassRotation.set(0);
    this.cameraDebugEnabled.set(false);
    this.cameraDebugInfo.set(null);
    this.debugLog.set('');
  }
}
