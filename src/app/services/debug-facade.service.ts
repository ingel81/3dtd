import { Injectable, inject, signal } from '@angular/core';
import { UIStore } from '../store/ui.store';
import { EnemyDebugService } from './enemy-debug.service';
import { MarkerVisualizationService } from './marker-visualization.service';
import { CombatEffectService } from './combat-effect.service';
import { GameStateManager } from '../managers/game-state.manager';

/**
 * DebugFacadeService
 *
 * Thin orchestrator that consolidates all debug-related operations
 * from TowerDefenseComponent. Delegates to specialized services:
 * - UIStore: debug log, height debug toggle
 * - EnemyDebugService: enemy debug operations
 * - MarkerVisualizationService: height debug marker visualization
 * - GameStateManager: game state cheats (credits, health)
 *
 * Also manages display option persistence (localStorage) and
 * engine-level display toggles (enemies, health bars, animations, movement).
 */
@Injectable({ providedIn: 'root' })
export class DebugFacadeService {
  private readonly uiStore = inject(UIStore);
  private readonly enemyDebug = inject(EnemyDebugService);
  private readonly markerViz = inject(MarkerVisualizationService);
  private readonly combatEffect = inject(CombatEffectService);

  /** LocalStorage key for display options */
  private static readonly DISPLAY_OPTIONS_KEY = 'td_display_options';

  // ========================================
  // Shared display option signals (single source of truth for UI sync)
  // Both QuickActions and DisplayOptions read from these.
  // ========================================
  readonly healthBarsVisible = signal(true);
  readonly screenShakeEnabled = signal(true);
  readonly damageNumbersVisible = signal(true);

  // ========================================
  // Proxy signals from UIStore
  // ========================================

  /** Debug log signal (readonly) */
  readonly debugLog = this.uiStore.debugLog;

  /** Height debug visibility signal (readonly) */
  readonly heightDebugVisible = this.uiStore.heightDebugVisible;

  // ========================================
  // Debug Log Management
  // ========================================

  /**
   * Append message to debug log (max 50 lines)
   */
  appendDebugLog(message: string): void {
    this.uiStore.appendDebugLog(message);
  }

  /**
   * Clear the debug log
   */
  clearDebugLog(): void {
    this.uiStore.clearDebugLog();
  }

  // ========================================
  // Debug Cheat Actions
  // ========================================

  /**
   * Add 1000 debug credits via EventBus command
   */
  addDebugCredits(gameState: GameStateManager): void {
    gameState.getEventBus().emit({ type: 'debug:add-credits', amount: 1000 });
    this.appendDebugLog('+1000 Credits (Debug)');
  }

  /**
   * Add 1000 debug health via EventBus command
   */
  addDebugHealth(gameState: GameStateManager): void {
    gameState.getEventBus().emit({ type: 'debug:add-health', amount: 1000 });
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
    this.uiStore.toggleHeightDebug();
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
    this.healthBarsVisible.set(visible);
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

  /**
   * Toggle texture rendering and persist (Performance Debug)
   */
  onTexturesToggled(enabled: boolean): void {
    this.engine?.enemies.setTexturesEnabled(enabled);
    this.persistDisplayOption('textures', enabled);
  }

  /**
   * Toggle skeleton cloning for new enemies and persist (Performance Debug)
   */
  onSkeletonCloningToggled(enabled: boolean): void {
    this.engine?.enemies.setSkeletonCloningEnabled(enabled);
    this.persistDisplayOption('skeletonCloning', enabled);
  }

  /**
   * Toggle alpha blending and persist (Performance Debug)
   */
  onAlphaBlendToggled(enabled: boolean): void {
    this.engine?.enemies.setAlphaBlendEnabled(enabled);
    this.persistDisplayOption('alphaBlend', enabled);
  }

  /**
   * Change color grading preset (persisted by display-options component)
   */
  onColorGradingChanged(preset: string): void {
    this.engine?.setColorGradingPreset(preset as import('../three-engine/post-processing/color-grading').ColorGradingPreset);
  }

  /**
   * Toggle damage numbers and persist
   */
  onDamageNumbersToggled(visible: boolean): void {
    this.damageNumbersVisible.set(visible);
    this.combatEffect.damageNumbersEnabled = visible;
    this.persistDisplayOption('damageNumbers', visible);
  }

  /**
   * Toggle screen shake and persist
   */
  onScreenShakeToggled(enabled: boolean): void {
    this.screenShakeEnabled.set(enabled);
    if (this.gameState) {
      if (enabled) {
        this.gameState.screenShakeService.enable();
      } else {
        this.gameState.screenShakeService.disable();
      }
    }
    this.persistDisplayOption('screenShake', enabled);
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
        if (opts.healthBars === false) {
          this.healthBarsVisible.set(false);
          this.engine?.enemies.setHealthBarsVisible(false);
        }
        if (opts.animations === false) this.engine?.enemies.setAnimationsEnabled(false);
        if (opts.movement === false && this.gameState) {
          this.gameState.enemyManager.movementEnabled = false;
        }
        if (opts.textures === false) this.engine?.enemies.setTexturesEnabled(false);
        if (opts.skeletonCloning === false) this.engine?.enemies.setSkeletonCloningEnabled(false);
        if (opts.alphaBlend === false) this.engine?.enemies.setAlphaBlendEnabled(false);
        if (opts.colorGrading && opts.colorGrading !== 'none') {
          this.engine?.setColorGradingPreset(opts.colorGrading);
        }
        if (opts.screenShake === false) {
          this.screenShakeEnabled.set(false);
          if (this.gameState) this.gameState.screenShakeService.disable();
        }
        if (opts.damageNumbers === false) {
          this.damageNumbersVisible.set(false);
          this.combatEffect.damageNumbersEnabled = false;
        }
      }
    } catch { /* ignore corrupt localStorage */ }
  }

  /**
   * Persist a single display option to localStorage
   */
  persistDisplayOption(key: string, value: boolean): void {
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
