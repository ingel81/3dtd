import { Injectable, inject, signal } from '@angular/core';
import { UIStore } from '../../store/ui.store';
import { EnemyDebugService } from './enemy-debug.service';
import { MarkerVisualizationService } from '../world/marker-visualization.service';
import { CombatEffectService } from '../combat/combat-effect.service';
import { GameStateManager } from '../../managers/game-state.manager';
import { loadDisplayOptions, persistDisplayOptions } from '../../utils/display-options.storage';
import { readVfxSettings, withVfxPreset, type VfxPreset, type VfxSettings } from '../../three-engine/vfx-settings';
import type { ColorGradingPreset } from '../../three-engine/post-processing/color-grading';

/** Frame caps the player can pick, in fps. 0 = unlimited. */
export const FPS_LIMITS = [0, 60, 30] as const;
export type FpsLimit = (typeof FPS_LIMITS)[number];

/** A stored frame cap; anything the menu does not offer means unlimited. */
function toFpsLimit(value: unknown): FpsLimit {
  return (FPS_LIMITS as readonly unknown[]).includes(value) ? (value as FpsLimit) : 0;
}

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
 * Also owns the display options (persisted in one object, see
 * utils/display-options.storage) and applies them to the engine.
 */
@Injectable({ providedIn: 'root' })
export class DebugFacadeService {
  private readonly uiStore = inject(UIStore);
  private readonly enemyDebug = inject(EnemyDebugService);
  private readonly markerViz = inject(MarkerVisualizationService);
  private readonly combatEffect = inject(CombatEffectService);

  /** Display options as stored at startup; the shared signals below start from them. */
  private readonly stored = loadDisplayOptions();

  // ========================================
  // Shared display option signals (single source of truth for UI sync)
  // Both QuickActions and DisplayOptions read from these.
  // ========================================
  readonly healthBarsVisible = signal(this.stored.healthBars !== false);
  readonly screenShakeEnabled = signal(this.stored.screenShake !== false);
  readonly damageNumbersVisible = signal(this.stored.damageNumbers !== false);
  /** Render-loop frame cap, see ThreeTilesEngine.setFpsLimit. */
  readonly fpsLimit = signal<FpsLimit>(toFpsLimit(this.stored.fpsLimit));
  /** Visual effects switched on or off, see VfxSettings. */
  readonly vfx = signal<VfxSettings>(readVfxSettings(this.stored));

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
   * Add debug credits via EventBus command. Default 1000; pass a custom
   * amount (e.g. 100000 for Shift+Click) to override.
   */
  addDebugCredits(gameState: GameStateManager, amount = 1000): void {
    gameState.getEventBus().emit({ type: 'debug:add-credits', amount });
    this.appendDebugLog(`+${amount.toLocaleString()} Credits (Debug)`);
  }

  /**
   * Add debug health via EventBus command. Default 1000; pass a custom
   * amount (e.g. 100000 for Shift+Click) to override.
   */
  addDebugHealth(gameState: GameStateManager, amount = 1000): void {
    gameState.getEventBus().emit({ type: 'debug:add-health', amount });
    this.appendDebugLog(`+${amount.toLocaleString()} HP (Debug)`);
  }

  /**
   * Kill all enemies (emits debug:kill-all event)
   */
  killAllEnemies(gameState: GameStateManager): void {
    gameState.getEventBus().emit({ type: 'debug:kill-all' });
  }

  /**
   * Complete all research instantly (emits debug:complete-all-research event).
   * Used to record gameplay trailers without waiting for the tech tree.
   * Player still needs gold to actually build/upgrade.
   */
  completeAllResearch(gameState: GameStateManager): void {
    gameState.getEventBus().emit({ type: 'debug:complete-all-research' });
    this.appendDebugLog('All research completed (Debug)');
  }

  /**
   * Max-upgrade every placed tower (free, ignores tier-gating).
   * Used to skip the tedious manual upgrade clicks when setting up
   * performance / stress-test scenarios.
   */
  maxUpgradeAllTowers(gameState: GameStateManager): void {
    gameState.getEventBus().emit({ type: 'debug:max-upgrade-all-towers' });
    this.appendDebugLog('All towers max upgraded (Debug)');
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
  private engine: import('../../three-engine').ThreeTilesEngine | null = null;
  private gameState: GameStateManager | null = null;

  /**
   * Set engine reference for display option operations.
   * Must be called after engine initialization.
   */
  setEngine(engine: import('../../three-engine').ThreeTilesEngine | null, gameState?: GameStateManager): void {
    this.engine = engine;
    if (gameState) this.gameState = gameState;
  }

  /**
   * Toggle enemy visibility and persist
   */
  onEnemiesToggled(visible: boolean): void {
    this.engine?.enemies.setEnemiesVisible(visible);
    persistDisplayOptions({ enemies: visible });
  }

  /**
   * Toggle health bar visibility and persist
   */
  onHealthBarsToggled(visible: boolean): void {
    this.healthBarsVisible.set(visible);
    this.engine?.enemies.setHealthBarsVisible(visible);
    persistDisplayOptions({ healthBars: visible });
  }

  /**
   * Toggle animation enabled state and persist
   */
  onAnimationsToggled(enabled: boolean): void {
    this.engine?.enemies.setAnimationsEnabled(enabled);
    persistDisplayOptions({ animations: enabled });
  }

  /**
   * Toggle movement enabled state and persist
   */
  onMovementToggled(enabled: boolean): void {
    if (this.gameState) {
      this.gameState.enemyManager.movementEnabled = enabled;
    }
    persistDisplayOptions({ movement: enabled });
  }

  /**
   * Toggle texture rendering and persist (Performance Debug)
   */
  onTexturesToggled(enabled: boolean): void {
    this.engine?.enemies.setTexturesEnabled(enabled);
    persistDisplayOptions({ textures: enabled });
  }

  /**
   * Toggle skeleton cloning for new enemies and persist (Performance Debug)
   */
  onSkeletonCloningToggled(enabled: boolean): void {
    this.engine?.enemies.setSkeletonCloningEnabled(enabled);
    persistDisplayOptions({ skeletonCloning: enabled });
  }

  /**
   * Toggle alpha blending and persist (Performance Debug)
   */
  onAlphaBlendToggled(enabled: boolean): void {
    this.engine?.enemies.setAlphaBlendEnabled(enabled);
    persistDisplayOptions({ alphaBlend: enabled });
  }

  /**
   * Color grading preset from the debug window; one of the VFX settings.
   */
  onColorGradingChanged(preset: ColorGradingPreset): void {
    this.onVfxSettingsChanged({ colorGrading: preset });
  }

  /**
   * Change VFX settings: the engine takes them at once, no reload, and
   * they are persisted with the other display options.
   */
  onVfxSettingsChanged(change: Partial<VfxSettings>): void {
    const settings = { ...this.vfx(), ...change };
    this.vfx.set(settings);
    this.engine?.applyVfxSettings(settings);
    persistDisplayOptions(settings);
  }

  /** Apply an effect quality preset. The switches stay adjustable one by one. */
  onVfxPresetSelected(preset: VfxPreset): void {
    this.onVfxSettingsChanged(withVfxPreset(this.vfx(), preset));
  }

  /**
   * Toggle damage numbers and persist
   */
  onDamageNumbersToggled(visible: boolean): void {
    this.damageNumbersVisible.set(visible);
    this.combatEffect.damageNumbersEnabled = visible;
    persistDisplayOptions({ damageNumbers: visible });
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
    persistDisplayOptions({ screenShake: enabled });
  }

  /**
   * Paint tiles by LOD. Not persisted on purpose: a colored map after a
   * reload would read as a rendering bug.
   */
  onTileLodDebugToggled(enabled: boolean): void {
    this.engine?.setTileLodDebugEnabled(enabled);
  }

  /**
   * Cap the render loop and persist the choice
   */
  onFpsLimitChanged(fps: FpsLimit): void {
    this.fpsLimit.set(fps);
    this.engine?.setFpsLimit(fps);
    persistDisplayOptions({ fpsLimit: fps });
  }

  // ========================================
  // Display Option Persistence
  // ========================================

  /**
   * Apply the display options to the engine and the game state.
   * Called after engine initialization to restore user preferences.
   */
  applyDisplayOptions(): void {
    this.engine?.setFpsLimit(this.fpsLimit());
    this.engine?.applyVfxSettings(this.vfx());
    if (!this.healthBarsVisible()) this.engine?.enemies.setHealthBarsVisible(false);
    if (!this.damageNumbersVisible()) this.combatEffect.damageNumbersEnabled = false;
    if (!this.screenShakeEnabled()) this.gameState?.screenShakeService.disable();

    // Debug window options, not held in signals here
    const opts = loadDisplayOptions();
    if (opts.enemies === false) this.engine?.enemies.setEnemiesVisible(false);
    if (opts.animations === false) this.engine?.enemies.setAnimationsEnabled(false);
    if (opts.movement === false && this.gameState) {
      this.gameState.enemyManager.movementEnabled = false;
    }
    if (opts.textures === false) this.engine?.enemies.setTexturesEnabled(false);
    if (opts.skeletonCloning === false) this.engine?.enemies.setSkeletonCloningEnabled(false);
    if (opts.alphaBlend === false) this.engine?.enemies.setAlphaBlendEnabled(false);
  }

  // ========================================
  // Camera Debug Log
  // ========================================

  /**
   * Log camera position to debug log
   */
  logCameraPosition(engine: import('../../three-engine').ThreeTilesEngine, baseCoords: { lat: number; lon: number }): void {
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
