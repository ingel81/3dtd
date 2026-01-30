import { Injectable, inject } from '@angular/core';
import { GameUIStateService } from './game-ui-state.service';
import { EnemyDebugService } from './enemy-debug.service';
import { MarkerVisualizationService } from './marker-visualization.service';
import { GameStateManager } from '../managers/game-state.manager';

/**
 * DebugFacadeService
 *
 * Thin orchestrator that consolidates all debug-related operations
 * from TowerDefenseComponent. Delegates to specialized services:
 * - GameUIStateService: debug log, height debug toggle
 * - EnemyDebugService: enemy debug operations
 * - MarkerVisualizationService: height debug marker visualization
 * - GameStateManager: game state cheats (credits, health)
 *
 * Also manages display option persistence (localStorage) and
 * engine-level display toggles (enemies, health bars, animations, movement).
 */
@Injectable({ providedIn: 'root' })
export class DebugFacadeService {
  private readonly uiState = inject(GameUIStateService);
  private readonly enemyDebug = inject(EnemyDebugService);
  private readonly markerViz = inject(MarkerVisualizationService);

  /** LocalStorage key for display options */
  private static readonly DISPLAY_OPTIONS_KEY = 'td_display_options';

  // ========================================
  // Proxy signals from GameUIStateService
  // ========================================

  /** Debug log signal (readonly) */
  readonly debugLog = this.uiState.debugLog;

  /** Height debug visibility signal (readonly) */
  readonly heightDebugVisible = this.uiState.heightDebugVisible;

  // ========================================
  // Debug Log Management
  // ========================================

  /**
   * Append message to debug log (max 50 lines)
   */
  appendDebugLog(message: string): void {
    this.uiState.appendDebugLog(message);
  }

  /**
   * Clear the debug log
   */
  clearDebugLog(): void {
    this.uiState.clearDebugLog();
  }

  // ========================================
  // Debug Cheat Actions
  // ========================================

  /**
   * Add 1000 debug credits to the game state
   */
  addDebugCredits(gameState: GameStateManager): void {
    gameState.credits.update((c) => c + 1000);
    this.appendDebugLog('+1000 Credits (Debug)');
  }

  /**
   * Add 1000 debug health to the base
   */
  addDebugHealth(gameState: GameStateManager): void {
    gameState.baseHealth.update((h) => h + 1000);
    this.appendDebugLog('+1000 HP (Debug)');
  }

  /**
   * Kill all enemies (emits debug:kill-all event)
   */
  killAllEnemies(gameState: GameStateManager): void {
    gameState.getEventBus().emit({ type: 'debug:kill-all' });
  }

  // ========================================
  // Height Debug Toggle
  // ========================================

  /**
   * Toggle height debug visualization (signal + marker visibility)
   */
  toggleHeightDebug(): void {
    this.uiState.toggleHeightDebug();
    this.markerViz.toggleHeightDebug(this.heightDebugVisible());
  }

  // ========================================
  // Display Option Toggles
  // ========================================

  /**
   * Engine reference holder for display option toggles.
   * Set by the component after engine initialization.
   */
  private engine: import('../three-engine').ThreeTilesEngine | null = null;
  private gameState: GameStateManager | null = null;

  /**
   * Set engine reference for display option operations.
   * Must be called after engine initialization.
   */
  setEngine(engine: import('../three-engine').ThreeTilesEngine | null, gameState?: GameStateManager): void {
    this.engine = engine;
    if (gameState) this.gameState = gameState;
  }

  /**
   * Toggle enemy visibility and persist
   */
  onEnemiesToggled(visible: boolean): void {
    this.engine?.enemies.setEnemiesVisible(visible);
    this.persistDisplayOption('enemies', visible);
  }

  /**
   * Toggle health bar visibility and persist
   */
  onHealthBarsToggled(visible: boolean): void {
    this.engine?.enemies.setHealthBarsVisible(visible);
    this.persistDisplayOption('healthBars', visible);
  }

  /**
   * Toggle animation enabled state and persist
   */
  onAnimationsToggled(enabled: boolean): void {
    this.engine?.enemies.setAnimationsEnabled(enabled);
    this.persistDisplayOption('animations', enabled);
  }

  /**
   * Toggle movement enabled state and persist
   */
  onMovementToggled(enabled: boolean): void {
    if (this.gameState) {
      this.gameState.enemyManager.movementEnabled = enabled;
    }
    this.persistDisplayOption('movement', enabled);
  }

  // ========================================
  // Display Option Persistence
  // ========================================

  /**
   * Apply saved display options from localStorage.
   * Called after engine initialization to restore user preferences.
   */
  applyDisplayOptions(): void {
    try {
      const stored = localStorage.getItem(DebugFacadeService.DISPLAY_OPTIONS_KEY);
      if (stored) {
        const opts = JSON.parse(stored);
        if (opts.enemies === false) this.engine?.enemies.setEnemiesVisible(false);
        if (opts.healthBars === false) this.engine?.enemies.setHealthBarsVisible(false);
        if (opts.animations === false) this.engine?.enemies.setAnimationsEnabled(false);
        if (opts.movement === false && this.gameState) {
          this.gameState.enemyManager.movementEnabled = false;
        }
      }
    } catch { /* ignore corrupt localStorage */ }
  }

  /**
   * Persist a single display option to localStorage
   */
  private persistDisplayOption(key: string, value: boolean): void {
    try {
      const stored = localStorage.getItem(DebugFacadeService.DISPLAY_OPTIONS_KEY);
      const opts = stored ? JSON.parse(stored) : {};
      opts[key] = value;
      localStorage.setItem(DebugFacadeService.DISPLAY_OPTIONS_KEY, JSON.stringify(opts));
    } catch { /* ignore */ }
  }

  // ========================================
  // Camera Debug Log
  // ========================================

  /**
   * Log camera position to debug log
   */
  logCameraPosition(engine: import('../three-engine').ThreeTilesEngine, baseCoords: { lat: number; lon: number }): void {
    const camera = engine.getCamera();
    const data = {
      position: {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      },
      hq: baseCoords,
      tiltAngle: 45,
    };
    this.appendDebugLog('=== CAMERA ===\n' + JSON.stringify(data, null, 2));
  }
}
