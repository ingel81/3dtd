import { Injectable, computed, signal } from '@angular/core';
import { GAME_BALANCE } from '../configs/game-balance.config';
import { Tower } from '../entities/tower.entity';
import { GamePhase } from './tower-defense.store.types';

@Injectable({ providedIn: 'root' })
export class GameStore {
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

  /**
   * Phase 5.14: Skip 3D rendering to free CPU/GPU for more parallel training
   * clients. Gameplay simulation still runs (sub-step loop is decoupled from
   * render loop), but `renderer.render()` + `tilesRenderer.update()` + all
   * per-frame visual updates are no-ops. Angular UI continues to update.
   */
  readonly renderingEnabled = signal<boolean>(true);

  // NOTE: botEnabled, botSkillLevel, botAutoMode are owned by TrainingClientService
  // (the writer). Component reads them directly from that service.

  /** AI Wave Director enabled */
  readonly useAIDirector = signal<boolean>(false);

  /** AI explanation text for current wave */
  readonly aiExplanation = signal<string | null>(null);

  /** Fatal AI error message (shown as blocking banner, typically ONNX load fail) */
  readonly aiError = signal<string | null>(null);

  /** DevWorld is regenerating terrain */
  readonly isDevWorldRegenerating = signal<boolean>(false);

  /** Whether a wave is currently active */
  readonly waveActive = computed(() => this.phase() === 'wave');

  /** Whether the game is over */
  readonly isGameOver = computed(() => this.phase() === 'gameover');

  /** Whether the game has started (at least one wave played) */
  readonly gameStarted = computed(() => this.waveNumber() > 0 || this.phase() !== 'setup');

  /** Health percentage (0..100) */
  readonly healthPercent = computed(() =>
    Math.round((this.baseHealth() / GAME_BALANCE.player.startHealth) * 100)
  );

  /** Health is critical — same threshold the close-call bonus uses */
  readonly healthCritical = computed(
    () => this.healthPercent() <= GAME_BALANCE.economy.closeCallHpThreshold
  );

  /**
   * Reset game state to initial values.
   * Called on game restart.
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
    this.aiExplanation.set(null);
  }

  /**
   * Full reset including UI state.
   * Used for complete teardown.
   */
  resetAll(): void {
    this.resetGameState();
    this.trainingTimescale.set(1.0);
    this.useAIDirector.set(false);
    this.isDevWorldRegenerating.set(false);
  }
}
