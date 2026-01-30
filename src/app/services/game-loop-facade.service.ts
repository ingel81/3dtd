import { Injectable, inject, NgZone } from '@angular/core';
import { SubscriptionBag } from '../game-engine/game-event-bus';
import { GameUIStateService } from './game-ui-state.service';
import { CameraControlService } from './camera-control.service';
import { TowerPlacementService } from './tower-placement.service';
import { KeyboardPanService } from './keyboard-pan.service';
import { MarkerVisualizationService } from './marker-visualization.service';
import { RouteAnimationService } from './route-animation.service';
import { WaveDebugService } from './wave-debug.service';
import { SoundDebugService } from './sound-debug.service';
import { DebugWindowService } from './debug-window.service';
import { WaveDirectorService } from '../ai/core/wave-director.service';
import { AIDataCollectorService } from '../ai/core/ai-data-collector.service';
import { TrainingClientService } from '../ai/training/training-client.service';
import { adaptAIWaveConfigSingle } from '../ai/core/wave-config-adapter';
import { GameStateManager } from '../managers/game-state.manager';
import { WaveConfig } from '../managers/wave.manager';
import { Tower } from '../entities/tower.entity';
import { UpgradeId } from '../configs/tower-types.config';
import { FacadeComponentBridge } from './tower-defense-facade.service';
import { SoundPoolStats } from '../managers/spatial-audio.manager';

/**
 * Sub-facade for game loop, wave management, game lifecycle, and tower upgrades.
 *
 * Responsibilities:
 * - Wave start (manual + AI-directed)
 * - Per-frame engine update loop (onEngineUpdate)
 * - Game over handling
 * - Game restart
 * - Tower upgrades
 * - AI Director toggle
 */
@Injectable({ providedIn: 'root' })
export class GameLoopFacadeService {
  private readonly uiState = inject(GameUIStateService);
  private readonly cameraControl = inject(CameraControlService);
  private readonly towerPlacement = inject(TowerPlacementService);
  private readonly keyboardPan = inject(KeyboardPanService);
  private readonly markerViz = inject(MarkerVisualizationService);
  private readonly routeAnimation = inject(RouteAnimationService);
  private readonly waveDebug = inject(WaveDebugService);
  private readonly soundDebug = inject(SoundDebugService);
  private readonly debugWindows = inject(DebugWindowService);
  private readonly waveDirector = inject(WaveDirectorService);
  private readonly aiDataCollector = inject(AIDataCollectorService);
  private readonly trainingClient = inject(TrainingClientService);
  private readonly ngZone = inject(NgZone);

  /** Component bridge — set via initialize() */
  private bridge!: FacadeComponentBridge;

  /** Game state manager — set via initialize() */
  private gameState!: GameStateManager;

  /** Whether this sub-facade has been initialized */
  private initialized = false;

  /** Flag to prevent concurrent AI wave requests */
  private pendingAIWaveRequest = false;

  /** Throttle: last UI stats update timestamp */
  private lastStatsUpdate = 0;

  /** Throttle interval for UI stats (ms) — ~10Hz */
  private static readonly STATS_THROTTLE_MS = 100;

  /** Max retries for AI wave fallback to prevent infinite recursion */
  private static readonly MAX_AI_RETRY = 1;

  /** EventBus subscription bag — cleaned up in dispose() */
  readonly eventBusSubs = new SubscriptionBag();

  /**
   * Initialize sub-facade with bridge and game state.
   */
  initialize(bridge: FacadeComponentBridge, gameState: GameStateManager): void {
    this.bridge = bridge;
    this.gameState = gameState;
    this.initialized = true;
  }

  /**
   * Reset state on dispose.
   */
  dispose(): void {
    this.eventBusSubs.disposeAll();
    this.pendingAIWaveRequest = false;
    this.lastStatsUpdate = 0;
    this.initialized = false;
  }

  // ══════════════════════════════════════════════════════════════
  // Wave Orchestration
  // ══════════════════════════════════════════════════════════════

  /**
   * Build a WaveConfig from current debug settings.
   * Shared helper to avoid duplication between startWave() and startCustomWave().
   */
  buildWaveConfig(): WaveConfig {
    return {
      enemyCount: this.waveDebug.enemyCount(),
      enemyType: this.waveDebug.enemyType(),
      enemySpeed: this.waveDebug.enemySpeed(),
      enemyHealth: this.waveDebug.enemyHealth(),
      spawnMode: this.waveDebug.spawnMode(),
      spawnDelay: this.waveDebug.spawnDelay(),
      getSpawnDelay: this.waveDebug.spawnDelay,
    };
  }

  /**
   * Start a new wave (manual or AI-directed).
   */
  startWave(): void {
    if (!this.initialized) return;
    if (!this.bridge.getEngine() || this.bridge.waveActive() || this.bridge.isGameOver()) return;
    if (this.bridge.spawnPoints().length === 0) return;

    if (this.bridge.useAIDirector()) {
      if (this.pendingAIWaveRequest) return;
      this.startWaveWithAI(0);
      return;
    }

    const waveConfig = this.buildWaveConfig();
    this.bridge.aiExplanation.set(null);
    this.gameState.getEventBus().emit({
      type: 'command:start-wave',
      config: waveConfig,
    });
  }

  /**
   * Start wave using AI Wave Director.
   * Guarded against infinite recursion via retry counter.
   */
  private async startWaveWithAI(retryCount: number): Promise<void> {
    if (retryCount >= GameLoopFacadeService.MAX_AI_RETRY) {
      console.error('[AI] Max retries reached, falling back to manual wave config');
      const waveConfig = this.buildWaveConfig();
      this.bridge.aiExplanation.set(null);
      this.gameState.getEventBus().emit({
        type: 'command:start-wave',
        config: waveConfig,
      });
      return;
    }

    this.pendingAIWaveRequest = true;

    try {
      let aiConfig;

      if (this.trainingClient.isConnected()) {
        const state = this.aiDataCollector.getStateSnapshot();
        aiConfig = await this.trainingClient.requestWaveConfig(state);
      } else {
        aiConfig = await this.waveDirector.getNextWave();
      }

      this.bridge.aiExplanation.set(aiConfig.explanation ?? null);
      const waveConfig = adaptAIWaveConfigSingle(aiConfig);

      this.gameState.getEventBus().emit({
        type: 'command:start-wave',
        config: waveConfig,
      });
    } catch (error) {
      console.error('[AI] Failed to generate wave, using fallback', error);
      this.bridge.useAIDirector.set(false);
      this.pendingAIWaveRequest = false;
      this.startWaveWithAI(retryCount + 1);
      return;
    } finally {
      this.pendingAIWaveRequest = false;
    }
  }

  /**
   * Start a custom wave using debug panel settings only.
   */
  startCustomWave(): void {
    if (!this.initialized) return;
    if (!this.bridge.getEngine() || this.bridge.waveActive() || this.bridge.isGameOver()) return;
    if (this.bridge.spawnPoints().length === 0) return;

    const waveConfig = this.buildWaveConfig();
    this.bridge.aiExplanation.set(null);
    this.gameState.getEventBus().emit({
      type: 'command:start-wave',
      config: waveConfig,
    });
  }

  /**
   * Toggle AI Director mode.
   */
  toggleAIDirector(): void {
    const newValue = !this.bridge.useAIDirector();
    this.bridge.useAIDirector.set(newValue);
  }

  /**
   * Get AI Director status text.
   */
  getAIStatusText(): string {
    if (!this.bridge.useAIDirector()) return 'AI deaktiviert';
    return this.waveDirector.statusText();
  }

  // ══════════════════════════════════════════════════════════════
  // Game Lifecycle
  // ══════════════════════════════════════════════════════════════

  /**
   * Handle game over.
   */
  onGameOver(): void {
    this.gameState.waveManager.stopSpawning();
  }

  /**
   * Restart game.
   * @param cleanupDpsViz Callback to clean up DPS visualization (owned by VisualizationFacade)
   */
  restartGame(cleanupDpsViz: () => void): void {
    // Cleanup old debug visualization before reset
    this.gameState.getGlobalRouteGrid().cleanupSpatialGridVisualization();

    // Cleanup DPS profile visualization (delegated to VisualizationFacade)
    cleanupDpsViz();

    this.gameState.getEventBus().emit({ type: 'command:restart-game' });

    // Reset pending AI wave request flag
    this.pendingAIWaveRequest = false;

    // Reset bot state
    this.trainingClient.resetBot();
  }

  // ══════════════════════════════════════════════════════════════
  // Tower Upgrades
  // ══════════════════════════════════════════════════════════════

  /**
   * Upgrade a tower with the specified upgrade.
   * @returns true if upgrade was successful
   */
  upgradeTower(tower: Tower, upgradeId: UpgradeId): boolean {
    const upgrade = tower.typeConfig.upgrades.find(u => u.id === upgradeId);
    if (!upgrade) {
      console.warn('[Upgrade] Upgrade not found:', upgradeId);
      return false;
    }

    const cost = tower.getNextUpgradeCost(upgradeId);
    if (this.gameState.credits() < cost) {
      console.warn(`[Upgrade] Not enough credits: ${this.gameState.credits()}/${cost}`);
      return false;
    }
    if (!tower.canUpgrade(upgradeId)) {
      console.warn(`[Upgrade] Tower cannot upgrade ${upgradeId} (already max level)`);
      return false;
    }

    this.gameState.getEventBus().emit({
      type: 'command:upgrade-tower',
      towerId: tower.id,
      upgradeId,
    });

    return true;
  }

  // ══════════════════════════════════════════════════════════════
  // Engine Update Loop (per-frame)
  // ══════════════════════════════════════════════════════════════

  /**
   * Called each frame for animations (runs outside Angular zone).
   * Orchestrates per-frame game logic.
   */
  onEngineUpdate(deltaTime: number): void {
    if (!this.initialized) return;

    const dtSec = deltaTime / 1000;

    // Per-frame delegation calls
    this.towerPlacement.updateRotation(dtSec);
    this.towerPlacement.updatePreviewBuild();
    this.keyboardPan.update(dtSec);
    this.markerViz.animateMarkers(deltaTime);
    this.routeAnimation.update(deltaTime);

    // Game logic tick
    this.gameState.update(performance.now());

    // Bot update (if enabled)
    if (this.trainingClient.botEnabled()) {
      this.trainingClient.updateBot(this.aiDataCollector.getStateSnapshot(), deltaTime);
    }

    // Route grid visualization
    const grid = this.gameState.getGlobalRouteGrid();
    if (grid.isSpatialGridVizVisible()) {
      grid.updateVisualization();
    }
    grid.updateAnimation(deltaTime);

    // Selected tower LOS animation
    const selectedTower = this.gameState.towerManager.getSelected();
    if (selectedTower?.losVisualization?.visible) {
      grid.updateTowerVisualizationTime(selectedTower.losVisualization);
    }

    // Throttled UI stats (~10Hz)
    const now = performance.now();
    if (now - this.lastStatsUpdate < GameLoopFacadeService.STATS_THROTTLE_MS) return;
    this.lastStatsUpdate = now;

    const engine = this.bridge.getEngine();
    if (engine) {
      const soundDebugOpen = this.debugWindows.soundWindow().isOpen;
      const stats = {
        fps: engine.getFPS(),
        tileStats: engine.getTileStats(),
        activeSoundCount: engine.spatialAudio.getActiveSoundCount(),
        attribution: engine.getAttributions(),
        cameraHeading: this.cameraControl.getCameraHeading(),
        cameraDebugInfo: this.cameraControl.getCameraDebugInfo(),
        soundPoolStats: soundDebugOpen ? engine.spatialAudio.getSoundPoolStats() : undefined,
      };
      this.ngZone.run(() => {
        this.uiState.updateThrottledStats({
          ...stats,
          onSoundDebugUpdate: soundDebugOpen
            ? (poolStats: unknown) => this.soundDebug.updateStats(poolStats as SoundPoolStats)
            : undefined,
        });
      });
    }
  }
}
