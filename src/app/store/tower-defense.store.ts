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

import { Injectable, Signal, computed, inject } from '@angular/core';
import { EngineStore } from './engine.store';
import { GameStore } from './game.store';
import { LocationStore } from './location.store';
import { UIStore } from './ui.store';
import { CameraDebugInfo, TileStats } from './tower-defense.store.types';

export * from './tower-defense.store.types';

// ═══════════════════════════════════════════════════════════════
// Store — Root Aggregate Facade
// ═══════════════════════════════════════════════════════════════

@Injectable({ providedIn: 'root' })
export class TowerDefenseStore {
  private readonly gameStore = inject(GameStore);
  private readonly uiStore = inject(UIStore);
  private readonly engineStore = inject(EngineStore);
  private readonly locationStore = inject(LocationStore);

  // ════════════════════════════════════════════════════════════
  // GAME STATE
  // ════════════════════════════════════════════════════════════

  /** Player credits (gold) */
  readonly credits = this.gameStore.credits;

  /** Base health points */
  readonly baseHealth = this.gameStore.baseHealth;

  /** Current game phase */
  readonly phase = this.gameStore.phase;

  /** Current wave number (0 = no wave started yet) */
  readonly waveNumber = this.gameStore.waveNumber;

  /** Number of enemies currently alive */
  readonly enemiesAlive = this.gameStore.enemiesAlive;

  /** Currently selected tower (for info panel / upgrades) */
  readonly selectedTower = this.gameStore.selectedTower;

  /** Selected tower ID shortcut */
  readonly selectedTowerId = this.gameStore.selectedTowerId;

  /** Total placed tower count */
  readonly towerCount = this.gameStore.towerCount;

  /** Show game over overlay screen */
  readonly showGameOverScreen = this.gameStore.showGameOverScreen;

  /** Training mode timescale (1.0 = normal, up to 75x) */
  readonly trainingTimescale = this.gameStore.trainingTimescale;

  // ════════════════════════════════════════════════════════════
  // LOADING / INIT STATE
  // ════════════════════════════════════════════════════════════

  /** Global loading flag */
  readonly loading = this.engineStore.loading;

  // NOTE: tilesLoading, osmLoading owned by EngineInitializationService;
  // heightsLoading, heightProgress owned by HeightUpdateService.
  // Component reads directly from those services (they are the signal owners).

  /** Error message (null = no error) */
  readonly error = this.engineStore.error;

  /** Loading status string for progress UI */
  readonly loadingStatus = this.engineStore.loadingStatus;

  /** Ordered loading steps */
  readonly loadingSteps = this.engineStore.loadingSteps;

  // ════════════════════════════════════════════════════════════
  // UI STATE (debug flags, layer toggles, menu state)
  // ════════════════════════════════════════════════════════════

  /** Debug panel visibility */
  readonly debugMode = this.uiStore.debugMode;

  /** Layer menu expanded */
  readonly layerMenuExpanded = this.uiStore.layerMenuExpanded;

  /** Developer menu expanded */
  readonly devMenuExpanded = this.uiStore.devMenuExpanded;

  /** Street network layer visibility */
  readonly streetsVisible = this.uiStore.streetsVisible;

  /** Route paths visibility */
  readonly routesVisible = this.uiStore.routesVisible;

  /** Height debug markers visibility */
  readonly heightDebugVisible = this.uiStore.heightDebugVisible;

  /** Special points debug visibility */
  readonly specialPointsDebugVisible = this.uiStore.specialPointsDebugVisible;

  /** Info overlay (FPS, tiles, enemies, sounds) */
  readonly infoOverlayVisible = this.uiStore.infoOverlayVisible;

  /** Spatial grid debug */
  readonly spatialGridDebugVisible = this.uiStore.spatialGridDebugVisible;

  /** DPS bins visualization */
  readonly dpsBinsVisible = this.uiStore.dpsBinsVisible;

  /** Debug log output */
  readonly debugLog = this.uiStore.debugLog;

  // ════════════════════════════════════════════════════════════
  // BUILD MODE
  // ════════════════════════════════════════════════════════════

  /** Build mode active */
  readonly buildMode = this.uiStore.buildMode;

  /** Selected tower type for placement */
  readonly selectedTowerType = this.uiStore.selectedTowerType;

  /** Build validation reason (why placement is invalid) */
  readonly buildValidationReason = this.uiStore.buildValidationReason;

  /** Location being applied (disables certain UI) */
  readonly isApplyingLocation = this.locationStore.isApplyingLocation;

  // ════════════════════════════════════════════════════════════
  // LOCATION (persistent state)
  // ════════════════════════════════════════════════════════════

  /** HQ / base coordinates */
  readonly baseCoords = this.locationStore.baseCoords;

  /** Camera center coordinates (with height) */
  readonly centerCoords = this.locationStore.centerCoords;

  /** Active spawn points */
  readonly spawnPoints = this.locationStore.spawnPoints;

  /** Current location display name */
  readonly currentLocationName = this.locationStore.currentLocationName;

  /** Saved favorite locations */
  readonly favorites = this.locationStore.favorites;

  /** Favorite names lookup map */
  readonly favoriteNamesMap = this.locationStore.favoriteNamesMap;

  // ════════════════════════════════════════════════════════════
  // ENGINE / PERFORMANCE
  // ════════════════════════════════════════════════════════════

  /** Frames per second */
  readonly fps = this.engineStore.fps;

  /** Tile loading statistics */
  readonly tileStats = this.engineStore.tileStats;

  /** Active spatial audio sound count */
  readonly activeSounds = this.engineStore.activeSounds;

  /** Map attribution text */
  readonly mapAttribution = this.engineStore.mapAttribution;

  /** Camera compass heading (0=N, 90=E, 180=S, 270=W) */
  readonly cameraHeading = this.engineStore.cameraHeading;

  /** Accumulated compass rotation (avoids 0°/360° flip) */
  readonly compassRotation = this.engineStore.compassRotation;

  /** Camera debug overlay enabled */
  readonly cameraDebugEnabled = this.engineStore.cameraDebugEnabled;

  /** Camera debug info */
  readonly cameraDebugInfo = this.engineStore.cameraDebugInfo;

  /** Camera framing debug visualization */
  readonly cameraFramingDebug = this.engineStore.cameraFramingDebug;

  /** Street count in loaded network */
  readonly streetCount = this.locationStore.streetCount;

  // ════════════════════════════════════════════════════════════
  // BOT / AI
  // ════════════════════════════════════════════════════════════

  // NOTE: botEnabled, botSkillLevel, botAutoMode owned by TrainingClientService.
  // Component reads directly from that service (it is the signal owner).

  /** AI Wave Director enabled */
  readonly useAIDirector = this.gameStore.useAIDirector;

  /** AI explanation text for current wave */
  readonly aiExplanation = this.gameStore.aiExplanation;

  // ════════════════════════════════════════════════════════════
  // DEVWORLD
  // ════════════════════════════════════════════════════════════

  /** DevWorld is regenerating terrain */
  readonly isDevWorldRegenerating = this.gameStore.isDevWorldRegenerating;

  // ════════════════════════════════════════════════════════════
  // WAVE DEBUG OVERRIDES
  // ════════════════════════════════════════════════════════════

  /** Debug: enemy speed override */
  readonly enemySpeed = this.uiStore.enemySpeed;

  /** Debug: enemy health override */
  readonly enemyHealth = this.uiStore.enemyHealth;

  /** Debug: enemy count per wave */
  readonly enemyCount = this.uiStore.enemyCount;

  /** Debug: enemy type */
  readonly enemyType = this.uiStore.enemyType;

  /** Debug: spawn mode (sequential / random / all) */
  readonly spawnMode = this.uiStore.spawnMode;

  /** Debug: spawn delay in ms */
  readonly spawnDelay = this.uiStore.spawnDelay;

  // ════════════════════════════════════════════════════════════
  // COMPUTED VALUES — derived from signals above
  // ════════════════════════════════════════════════════════════

  /** Whether a wave is currently active */
  readonly waveActive: Signal<boolean> = this.gameStore.waveActive;

  /** Whether the game is over */
  readonly isGameOver: Signal<boolean> = this.gameStore.isGameOver;

  /** Whether the game has started (at least one wave played) */
  readonly gameStarted: Signal<boolean> = this.gameStore.gameStarted;

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
  readonly healthPercent: Signal<number> = this.gameStore.healthPercent;

  /** Health is critical (≤ 25%) */
  readonly healthCritical: Signal<boolean> = this.gameStore.healthCritical;

  /** Build mode warning text */
  readonly buildModeWarning: Signal<string | null> = computed(() => this.buildValidationReason());

  // ════════════════════════════════════════════════════════════
  // STATE MUTATION HELPERS (pure state changes, no side effects)
  // ════════════════════════════════════════════════════════════

  /** Append to debug log (max 50 lines) */
  appendDebugLog(message: string): void {
    this.uiStore.appendDebugLog(message);
  }

  /** Clear debug log */
  clearDebugLog(): void {
    this.uiStore.clearDebugLog();
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
    this.engineStore.updateEngineStats(snapshot);
  }

  // ════════════════════════════════════════════════════════════
  // RESET
  // ════════════════════════════════════════════════════════════

  /**
   * Reset game state to initial values.
   * Called on game restart (triggered by command:restart-game EventBus event).
   *
   * Resets: credits, health, phase, wave number, enemies, towers, game over screen.
   * Does NOT reset: UI preferences (debugMode, layer visibility, bot settings, etc.)
   * Those are user choices that persist across games.
   */
  resetGameState(): void {
    this.gameStore.resetGameState();
    this.uiStore.resetBuildState();
  }

  /**
   * Full reset including UI state.
   * Used for complete teardown.
   */
  resetAll(): void {
    this.gameStore.resetAll();
    this.uiStore.resetAll();
    this.engineStore.resetAll();
    this.locationStore.resetAll();
  }
}
