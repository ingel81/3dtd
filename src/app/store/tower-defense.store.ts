/**
 * TowerDefenseStore — Central Signal Store for UI & persistent state
 *
 * ARCHITECTURE:
 *   Store = State Container (signals + computed + reset)
 *   Facade = Orchestration (commands via EventBus, reads/writes Store for UI state)
 *
 * The Store does NOT contain action methods (startWave, placeTower, etc.).
 * Those belong in the Facade, which delegates to the EventBus:
 *
 *   Component → Facade.startWave() → EventBus.emit('command:start-wave')
 *                                   → Engine reacts
 *                                   → EventBus.emit('wave:started')
 *                                   → Facade/Effect → Store.phase.set('wave')
 *
 * Store owns:
 *   - WritableSignals (state)
 *   - Computed values (derived state)
 *   - set/update convenience methods (pure state mutations, no side effects)
 *   - resetGameState() / resetAll()
 *
 * Store does NOT own:
 *   - Action methods (startWave, placeTower, upgradeTower, etc.)
 *   - EventBus interaction
 *   - Service orchestration
 *   - Side effects
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
// Store — Pure State Container
// ═══════════════════════════════════════════════════════════════

@Injectable({ providedIn: 'root' })
export class TowerDefenseStore {

  // ════════════════════════════════════════════════════════════
  // GAME STATE
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
  // LOADING / INIT STATE
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
  // UI STATE (debug flags, layer toggles, menu state)
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
  // BUILD MODE
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
  // LOCATION (persistent state)
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
  // ENGINE / PERFORMANCE
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
  // BOT / AI
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
  // DEVWORLD
  // ════════════════════════════════════════════════════════════

  /** DevWorld is regenerating terrain */
  readonly isDevWorldRegenerating = signal<boolean>(false);

  // ════════════════════════════════════════════════════════════
  // WAVE DEBUG OVERRIDES
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
  // STATE MUTATION HELPERS (pure state changes, no side effects)
  // ════════════════════════════════════════════════════════════

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

  /**
   * Update performance stats from engine.
   * Called ~10Hz from the game loop (outside Angular zone).
   * Pure state update — no side effects.
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
   * Reset game state to initial values.
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
