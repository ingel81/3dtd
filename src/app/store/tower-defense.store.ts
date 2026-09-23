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
import { ResearchStore } from './research.store';
import { CameraDebugInfo, TileStats } from './tower-defense.store.types';
import { EngineInitializationService } from '../services/infrastructure/engine-initialization.service';

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
  private readonly researchStore = inject(ResearchStore);
  private readonly engineInit = inject(EngineInitializationService);

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

  /** Enemies the running wave brings in total (0 = none or not announced) */
  readonly waveEnemyTotal = this.gameStore.waveEnemyTotal;

  /** Enemies of the running wave not yet killed or through */
  readonly waveEnemiesLeft = this.gameStore.waveEnemiesLeft;

  /** Player abilities by id (charges, recharge, strike on its way) */
  readonly abilities = this.gameStore.abilities;

  /** The hero (unlocked, hired, level, kills, ammo) */
  readonly hero = this.gameStore.hero;

  /** Currently selected tower (for info panel / upgrades) */
  readonly selectedTower = this.gameStore.selectedTower;

  /** Selected tower ID shortcut */
  readonly selectedTowerId = this.gameStore.selectedTowerId;

  /** The tower the player sits in, null when none (see GameStore) */
  readonly mannedTowerId = this.gameStore.mannedTowerId;

  /** Revision of the selected tower's kills and stats (see GameStore) */
  readonly selectedTowerRevision = this.gameStore.selectedTowerRevision;

  /** Upgrades of any tower so far (see GameStore) */
  readonly towerUpgrades = this.gameStore.towerUpgrades;

  /** Total placed tower count */
  readonly towerCount = this.gameStore.towerCount;

  /** The one-per-map buildings standing on the map (see GameStore) */
  readonly placedUniqueTypes = this.gameStore.placedUniqueTypes;

  /** Show game over overlay screen */
  readonly showGameOverScreen = this.gameStore.showGameOverScreen;

  /** Numbers of the run that just ended (game-over screen) */
  readonly runSummary = this.gameStore.runSummary;

  /** Training mode timescale (1.0 = normal, up to 75x) */
  readonly gameSpeed = this.gameStore.gameSpeed;

  /** Game time stands still, see GameStore.paused */
  readonly paused = this.gameStore.paused;

  /** Headless training mode: skip per-frame 3D rendering */
  readonly renderingEnabled = this.gameStore.renderingEnabled;

  /** Seconds until the auto-started next wave, null while none counts down */
  readonly autoWaveSecondsLeft = this.gameStore.autoWaveSecondsLeft;

  // ════════════════════════════════════════════════════════════
  // LOADING / INIT STATE
  // ════════════════════════════════════════════════════════════

  /** Global loading flag — owned by EngineInitializationService */
  readonly loading = this.engineInit.loading;

  // NOTE: tilesLoading, osmLoading owned by EngineInitializationService;
  // heightsLoading owned by HeightUpdateService.
  // Component reads directly from those services (they are the signal owners).

  /** Error message (null = no error) — owned by EngineInitializationService */
  readonly error = this.engineInit.error;

  /** Ordered loading steps — owned by EngineInitializationService */
  readonly loadingSteps = this.engineInit.loadingSteps;

  // ════════════════════════════════════════════════════════════
  // UI STATE (debug flags, layer toggles, menu state)
  // ════════════════════════════════════════════════════════════

  /** Debug panel visibility */
  readonly debugMode = this.uiStore.debugMode;

  /** Layer menu expanded */
  readonly layerMenuExpanded = this.uiStore.layerMenuExpanded;

  /** Developer menu expanded */
  readonly devMenuExpanded = this.uiStore.devMenuExpanded;

  /** Display settings menu expanded */
  readonly displayMenuExpanded = this.uiStore.displayMenuExpanded;

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

  // ════════════════════════════════════════════════════════════
  // BUILD MODE
  // ════════════════════════════════════════════════════════════

  /** Build mode active */
  readonly buildMode = this.uiStore.buildMode;

  /** Selected tower type for placement */
  readonly selectedTowerType = this.uiStore.selectedTowerType;

  /** Build validation reason (why placement is invalid) */
  readonly buildValidationReason = this.uiStore.buildValidationReason;

  // ════════════════════════════════════════════════════════════
  // LOCATION (persistent state)
  // ════════════════════════════════════════════════════════════

  /** HQ / base coordinates */
  readonly baseCoords = this.locationStore.baseCoords;

  /** Camera center coordinates (with height) */
  readonly centerCoords = this.locationStore.centerCoords;

  /** Active spawn points */
  readonly spawnPoints = this.locationStore.spawnPoints;

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

  /** Accumulated compass rotation (avoids 0°/360° flip) */
  readonly compassRotation = this.engineStore.compassRotation;

  /** Camera framing debug visualization */
  readonly cameraFramingDebug = this.engineStore.cameraFramingDebug;

  /** Street count in loaded network */
  readonly streetCount = this.locationStore.streetCount;

  // ════════════════════════════════════════════════════════════
  // BOT / AI
  // ════════════════════════════════════════════════════════════

  // NOTE: botEnabled, botSkillLevel, botAutoMode owned by BotClientService.
  // Component reads directly from that service (it is the signal owner).

  /** AI Wave Director enabled */
  readonly directorEnabled = this.gameStore.directorEnabled;

  /** Static campaign fallback (debug toggle; used when AI is off). */

  /** Why the director planned the current wave (wave debug window) */
  readonly waveExplanation = this.gameStore.waveExplanation;

  /** Fatal wave-director error (blocking banner) */
  readonly directorError = this.gameStore.directorError;

  // ════════════════════════════════════════════════════════════
  // DEVWORLD
  // ════════════════════════════════════════════════════════════

  /** DevWorld is regenerating terrain */
  readonly isDevWorldRegenerating = this.gameStore.isDevWorldRegenerating;

  // ════════════════════════════════════════════════════════════
  // RESEARCH STATE
  // ════════════════════════════════════════════════════════════

  /** Active researches with progress */
  readonly activeResearches = this.researchStore.activeResearches;

  /** Maximum concurrent research slots */
  readonly researchSlots = this.researchStore.researchSlots;

  /** Available (free) research slots */
  readonly availableResearchSlots = this.researchStore.availableSlots;

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
    this.researchStore.resetResearchState();
  }

  /**
   * Full reset including UI state.
   * Used for complete teardown.
   */
  resetAll(): void {
    this.gameStore.resetAll();
    this.uiStore.resetAll();
    this.engineStore.resetAll();
    this.engineInit.reset();
    this.locationStore.resetAll();
  }
}
