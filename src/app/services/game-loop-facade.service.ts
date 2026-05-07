import { Injectable, inject, Injector, NgZone, effect } from '@angular/core';
import { SubscriptionBag } from '../game-engine/game-event-bus';
import { CameraControlService } from './camera-control.service';
import { TowerPlacementService } from './tower-placement.service';
import { KeyboardPanService } from './keyboard-pan.service';
import { MarkerVisualizationService } from './marker-visualization.service';
import { RouteAnimationService } from './route-animation.service';
import { WaveDebugService } from './wave-debug.service';
import { SoundDebugService } from './sound-debug.service';
import { DebugWindowService } from './debug-window.service';
import { EnemyDebugService } from './enemy-debug.service';
import { WaveDirectorService } from '../ai/core/wave-director.service';
import { AIDataCollectorService } from '../ai/core/ai-data-collector.service';
import { TrainingClientService } from '../ai/training/training-client.service';
import { adaptAIWaveConfigMixed } from '../ai/core/wave-config-adapter';
import { GameStateManager } from '../managers/game-state.manager';
import { WaveConfig } from '../managers/wave.manager';
import { Tower } from '../entities/tower.entity';
import { UpgradeId } from '../configs/tower-types.config';
import { FacadeComponentBridge } from './tower-defense-facade.service';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { EngineStore } from '../store/engine.store';
import { SoundPoolStats } from '../managers/audio/spatial-audio.manager';
import { PerformanceProfilerService } from './performance-profiler.service';
import { StreetRenderingService } from './street-rendering.service';

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
@Injectable()
export class GameLoopFacadeService {
  private readonly engineStore = inject(EngineStore);
  private readonly cameraControl = inject(CameraControlService);
  private readonly towerPlacement = inject(TowerPlacementService);
  private readonly keyboardPan = inject(KeyboardPanService);
  private readonly markerViz = inject(MarkerVisualizationService);
  private readonly routeAnimation = inject(RouteAnimationService);
  private readonly waveDebug = inject(WaveDebugService);
  private readonly soundDebug = inject(SoundDebugService);
  private readonly debugWindows = inject(DebugWindowService);
  private readonly enemyDebug = inject(EnemyDebugService);
  private readonly waveDirector = inject(WaveDirectorService);
  private readonly aiDataCollector = inject(AIDataCollectorService);
  private readonly trainingClient = inject(TrainingClientService);
  private readonly ngZone = inject(NgZone);
  private readonly store = inject(TowerDefenseStore);
  private readonly profiler = inject(PerformanceProfilerService);
  private readonly streetRendering = inject(StreetRenderingService);

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
  private readonly eventBusSubs = new SubscriptionBag();

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

  /**
   * Create Angular effects owned by this sub-facade.
   * Called from the main facade during initEffects().
   */
  initEffects(injector: Injector): void {
    // Effect: Update all existing enemies when speed changes
    effect(() => {
      const speed = this.waveDebug.enemySpeed();
      for (const enemy of this.gameState.enemyManager.getAll()) {
        enemy.movement.speedMps = speed;
      }
    }, { injector });

    // Effect: Sync wave debug state with store
    effect(() => {
      const waveActive = this.store.waveActive();
      const baseHealth = this.store.baseHealth();
      const enemiesAlive = this.store.enemiesAlive();
      this.waveDebug.syncWaveState(waveActive, baseHealth, enemiesAlive);
    }, { injector });

    // Effect: Auto-enable AI Director when ONNX model loads successfully
    effect(() => {
      const state = this.waveDirector.modelState();
      if (state === 'ready' && !this.store.useAIDirector()) {
        this.store.useAIDirector.set(true);
      }
    }, { injector });

    // Effect: Start paused debug enemies when wave starts
    effect(() => {
      const phase = this.store.phase();
      if (phase === 'wave') {
        for (const de of this.enemyDebug.debugEnemies()) {
          if (de.enemy.movement.paused && de.enemy.alive) {
            de.enemy.startMoving();
            this.bridge.getEngine()?.enemies.startWalkAnimation(de.id);
          }
        }
      }
    }, { injector });

    // Effect: Apply debug overrides to selected enemy (live update)
    effect(() => {
      const selected = this.enemyDebug.selectedDebugEnemy();
      const engine = this.bridge.getEngine();
      if (!selected || !engine) return;
      engine.enemies.applyDebugOverrides(selected.id, {
        scale: selected.overrides.scale,
        heightOffset: selected.overrides.heightOffset,
        healthBarOffset: selected.overrides.healthBarOffset,
        rotation: selected.overrides.rotation,
        animationSpeed: selected.overrides.animationSpeed,
      });
      selected.enemy.movement.speedMps = selected.overrides.baseSpeed;
    }, { injector });
  }

  /**
   * Subscribe to EventBus events owned by this sub-facade.
   * Called from the main facade after game state is initialized.
   */
  subscribeToEventBus(callbacks: { onGameOverExtra: () => void }): void {
    const eventBus = this.gameState.getEventBus();

    // Subscribe to debug:start-custom-wave event
    this.eventBusSubs.add(
      eventBus.on('debug:start-custom-wave', () => {
        this.startCustomWave();
      })
    );

    // Subscribe to game:over event
    this.eventBusSubs.add(
      eventBus.on('game:over', () => {
        this.onGameOver();
        callbacks.onGameOverExtra();
      })
    );
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
    if (!this.bridge.getEngine() || this.store.phase() === 'wave' || this.store.phase() === 'gameover') return;
    if (this.store.spawnPoints().length === 0) return;

    if (this.store.useAIDirector()) {
      if (this.pendingAIWaveRequest) return;
      this.startWaveWithAI(0);
      return;
    }

    const waveConfig = this.buildWaveConfig();
    this.store.aiExplanation.set(null);
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
      this.store.aiExplanation.set(null);
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

      this.store.aiExplanation.set(aiConfig.explanation ?? null);
      const waveConfig = adaptAIWaveConfigMixed(aiConfig);

      this.gameState.getEventBus().emit({
        type: 'command:start-wave',
        config: waveConfig,
      });
    } catch (error) {
      console.error('[AI] Failed to generate wave', error);
      const msg = error instanceof Error ? error.message : String(error);
      // Phase 5.10: ONNX model missing is a hard-fail. Set a user-visible error
      // banner and disable AI so the manual wave path kicks in on the next call.
      if (msg.includes('model is not available') || msg.includes('Model not loaded')) {
        this.store.aiError.set(
          'AI-Model konnte nicht geladen werden. Training läuft weiter über den '
          + 'Server-Backend-Pfad; für Standalone-Play bitte die Seite neu laden.'
        );
      }
      this.store.useAIDirector.set(false);
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
    if (!this.bridge.getEngine() || this.store.phase() === 'wave' || this.store.phase() === 'gameover') return;
    if (this.store.spawnPoints().length === 0) return;

    const waveConfig = this.waveDebug.mixedMode()
      ? this.waveDebug.buildMixedWaveConfig()
      : this.buildWaveConfig();

    this.store.aiExplanation.set(null);
    this.gameState.getEventBus().emit({
      type: 'command:start-wave',
      config: waveConfig,
    });
  }

  /**
   * Toggle AI Director mode.
   */
  toggleAIDirector(): void {
    const newValue = !this.store.useAIDirector();
    this.store.useAIDirector.set(newValue);
  }

  /**
   * Get AI Director status text.
   */
  getAIStatusText(): string {
    if (!this.store.useAIDirector()) return 'AI deaktiviert';
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
    // NOTE: Do NOT dispose the spatial grid visualization here. The grid itself
    // is preserved across restart (it's bound to the location), and the viz
    // mesh self-updates from live cell state. Disposing it here made the
    // overlay disappear after game-over until the user toggled it off/on.

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
    if (this.store.credits() < cost) {
      console.warn(`[Upgrade] Not enough credits: ${this.store.credits()}/${cost}`);
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
    this.towerPlacement.updateTowerRegistration();
    this.towerPlacement.updatePreviewBuild();
    this.streetRendering.continueStreetRender();
    this.keyboardPan.update(dtSec);
    this.markerViz.animateMarkers(deltaTime);
    this.routeAnimation.update(deltaTime);

    // Game logic tick — sub-step loop runs gameplay at fixed game-time
    // granularity. Bot decisions and turret aim are per-sub-step so they
    // stay framerate-independent at any training speed.
    const tilesEngine = this.gameState.tilesEngine;
    this.gameState.update(performance.now(), (gameTimeStepMs) => {
      // Turret aim advances per sub-step in game-time (gameplay-relevant —
      // alignment gates firing).
      tilesEngine?.towers.advanceTurretAim(gameTimeStepMs);

      // Bot decision tick per sub-step (game-time)
      if (this.trainingClient.botEnabled()) {
        this.trainingClient.updateBot(
          this.aiDataCollector.getStateSnapshot(),
          gameTimeStepMs,
        );
      }
    });

    // Performance profiler tick (console log timer)
    this.profiler.tick(deltaTime);

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
      this.ngZone.run(() => {
        this.engineStore.updateEngineStats({
          fps: engine.getFPS(),
          tileStats: engine.getTileStats(),
          activeSoundCount: engine.spatialAudio.getActiveSoundCount(),
          attribution: engine.getAttributions(),
          cameraHeading: this.cameraControl.getCameraHeading(),
          cameraDebugInfo: this.cameraControl.getCameraDebugInfo(),
        });
        // Sound debug stats (separate from engine store)
        if (soundDebugOpen) {
          this.soundDebug.updateStats(engine.spatialAudio.getSoundPoolStats() as SoundPoolStats);
        }
      });
    }
  }
}
