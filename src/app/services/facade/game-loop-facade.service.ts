import { Injectable, inject, Injector, NgZone, effect, untracked } from '@angular/core';
import { SubscriptionBag } from '../../game-engine/game-event-bus';
import { CameraControlService } from '../camera-control.service';
import { TowerPlacementService } from '../tower-placement.service';
import { MapPlacementService } from '../world/map-placement.service';
import { KeyboardPanService } from '../keyboard-pan.service';
import { MarkerVisualizationService } from '../world/marker-visualization.service';
import { IntroCameraFlightService } from '../world/intro-camera-flight.service';
import { RouteAnimationService } from '../world/route-animation.service';
import { WaveDebugService } from '../debug/wave-debug.service';
import { SoundDebugService } from '../debug/sound-debug.service';
import { DebugWindowService } from '../debug/debug-window.service';
import { EnemyDebugService } from '../debug/enemy-debug.service';
import { WaveDirector } from '../../director/wave-director';
import { StateSnapshotService } from '../../director/state-snapshot.service';
import { BotClientService } from '../../bots/bot-client.service';
import { RunLogFacade } from '../../run-log/run-log.facade';
import { adaptDirectorWave } from '../../director/wave-config-adapter';
import { GameStateManager } from '../../managers/game-state.manager';
import { WaveConfig } from '../../managers/wave.manager';
import { Tower } from '../../entities/tower.entity';
import { UpgradeId } from '../../configs/tower-types.config';
import { FacadeComponentBridge } from './tower-defense-facade.service';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { EngineStore } from '../../store/engine.store';
import { SoundPoolStats } from '../../managers/audio/spatial-audio.manager';
import { PerformanceProfilerService } from '../debug/performance-profiler.service';
import { StreetRenderingService } from '../world/street-rendering.service';
import { UIStore } from '../../store/ui.store';
import { AutoWaveCountdown } from '../../utils/auto-wave-countdown';
import { BossIntroService } from '../boss-intro.service';
import { ReplayService } from '../replay.service';
import { TowerControlService } from '../tower-control.service';

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
  private readonly mapPlacement = inject(MapPlacementService);
  private readonly keyboardPan = inject(KeyboardPanService);
  private readonly markerViz = inject(MarkerVisualizationService);
  private readonly routeAnimation = inject(RouteAnimationService);
  private readonly introFlight = inject(IntroCameraFlightService);
  private readonly waveDebug = inject(WaveDebugService);
  private readonly soundDebug = inject(SoundDebugService);
  private readonly debugWindows = inject(DebugWindowService);
  private readonly enemyDebug = inject(EnemyDebugService);
  private readonly waveDirector = inject(WaveDirector);
  private readonly runLog = inject(RunLogFacade);
  private readonly stateSnapshots = inject(StateSnapshotService);
  private readonly botClient = inject(BotClientService);
  private readonly ngZone = inject(NgZone);
  private readonly store = inject(TowerDefenseStore);
  private readonly profiler = inject(PerformanceProfilerService);
  private readonly streetRendering = inject(StreetRenderingService);
  private readonly uiStore = inject(UIStore);
  private readonly bossIntro = inject(BossIntroService);
  private readonly replay = inject(ReplayService);
  private readonly towerControl = inject(TowerControlService);

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

  /** Auto-start of the next wave, on the game clock, see AutoWaveCountdown */
  private readonly autoWave = new AutoWaveCountdown();

  /**
   * Initialize sub-facade with bridge and game state.
   */
  initialize(bridge: FacadeComponentBridge, gameState: GameStateManager): void {
    this.bridge = bridge;
    this.gameState = gameState;
    this.initialized = true;
    // The run's director stream; GameRng keeps a stream's function across a
    // reset, so asking per plan and holding it come to the same.
    this.waveDirector.useRandomSource(() => gameState.rng.stream('director'));
  }

  /**
   * Reset state on dispose.
   */
  dispose(): void {
    this.eventBusSubs.disposeAll();
    this.autoWave.cancel();
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

    // No auto-enable effect here any more.
    //
    // It existed to switch the director on once a model had loaded, and it
    // read `directorEnabled()` as well as the model state. With the rule
    // director always available that condition is permanently true, so the
    // effect re-fired on its own write and forced the flag back on: the UI
    // toggle became inert, the error path could not disable the director, and
    // a store reset was immediately overridden. `directorEnabled` now simply
    // defaults to on.

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

    // Effect: the auto-start toggle. Switched on between waves it starts
    // counting at once, switched off it stops a running countdown.
    effect(() => {
      const on = this.uiStore.autoStartWaves();
      untracked(() => {
        if (!on) {
          this.cancelAutoWave();
        } else if (this.store.phase() === 'setup' && this.store.waveNumber() > 0) {
          this.armAutoWave();
        }
      });
    }, { injector });

    // Effect: Bridge UIStore.perTowerLosFilter → TowerManager selection
    // viz. TowerManager is framework-agnostic, so we push the change
    // in from this Angular facade rather than letting the manager
    // subscribe.
    effect(() => {
      const mode = this.uiStore.perTowerLosFilter();
      this.gameState?.towerManager?.applyLosFilter(mode);
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
    // Defensive: clear any prior subscriptions so a future re-init path can't
    // double-subscribe (consistent with combat-effect/hq-damage/game-state).
    this.eventBusSubs.disposeAll();
    const eventBus = this.gameState.getEventBus();

    // Subscribe to debug:start-custom-wave event
    this.eventBusSubs.add(
      eventBus.onLive('debug:start-custom-wave', () => {
        this.startCustomWave();
      })
    );

    // Subscribe to game:over event
    this.eventBusSubs.add(
      eventBus.onLive('game:over', () => {
        this.onGameOver();
        callbacks.onGameOverExtra();
      })
    );

    // Auto-start of the next wave: counts down after a completed wave. Any
    // start ends it, the auto-start itself included, and so do game over
    // and a restart.
    this.eventBusSubs.add(eventBus.onLive('wave:completed', () => this.armAutoWave()));
    this.eventBusSubs.add(eventBus.onLive('wave:started', () => this.cancelAutoWave()));
    this.eventBusSubs.add(eventBus.onLive('game:over', () => this.cancelAutoWave()));
    this.eventBusSubs.add(eventBus.onLive('game:reset', () => this.cancelAutoWave()));

    // Every new run resets the wave director, the restart button as well as a
    // location change, which resets the game without going through
    // restartGame. The fairness gate's multiplier is a per-RUN correction;
    // carrying it into the next game made it a ratchet that opened fresh runs
    // against waves sized for a defense that no longer existed (median run
    // length 6 waves against a target of 80). A wave source switched in the
    // debug window also takes effect here.
    this.eventBusSubs.add(eventBus.onLive('game:reset', () => this.waveDirector.resetForNewGame()));
    // The first run of a session starts without a game:reset: a source that
    // plans at wave end commits wave 1 now, before any tower stands. A later
    // reset plans it again.
    this.waveDirector.resetForNewGame();
  }

  // ══════════════════════════════════════════════════════════════
  // Auto-start of the next wave
  // ══════════════════════════════════════════════════════════════

  private armAutoWave(): void {
    // A bot starts its own waves, a training run must not change behind it
    if (!this.uiStore.autoStartWaves() || this.botClient.botEnabled()) return;
    if (this.store.phase() === 'gameover') return;
    const now = this.gameState.gameTimeMs;
    this.autoWave.arm(now);
    this.showAutoWaveSeconds(this.autoWave.secondsLeft(now));
  }

  private cancelAutoWave(): void {
    this.autoWave.cancel();
    this.showAutoWaveSeconds(null);
  }

  /**
   * Per frame: run the countdown on the game clock and start the wave once
   * it is due, the same way the button does. While the game is paused the
   * clock stands, and the countdown with it.
   */
  tickAutoWave(): void {
    if (!this.autoWave.armed) return;
    const now = this.gameState.gameTimeMs;
    if (this.autoWave.tick(now)) {
      this.showAutoWaveSeconds(null);
      this.ngZone.run(() => this.startWave());
      return;
    }
    this.showAutoWaveSeconds(this.autoWave.secondsLeft(now));
  }

  /** Written only on change, so about once a second while counting. */
  private showAutoWaveSeconds(seconds: number | null): void {
    if (this.store.autoWaveSecondsLeft() === seconds) return;
    this.ngZone.run(() => this.store.autoWaveSecondsLeft.set(seconds));
  }

  // ══════════════════════════════════════════════════════════════
  // Wave Orchestration
  // ══════════════════════════════════════════════════════════════

  /**
   * Build a WaveConfig from current debug settings.
   * Shared helper to avoid duplication between startWave() and startCustomWave().
   */
  buildWaveConfig(): WaveConfig {
    return adaptDirectorWave(this.waveDebug.toAIWaveConfig(), this.gameState.rng.stream('spawn'));
  }

  /**
   * Start a new wave (manual or AI-directed). The start button, the hotkey
   * and the auto-start come here; each lifts the pause.
   */
  startWave(): void {
    if (!this.initialized) return;
    if (!this.bridge.getEngine() || this.store.phase() === 'wave' || this.store.phase() === 'gameover') return;
    if (this.store.spawnPoints().length === 0) return;
    // The corridor of a new location or a move is still being built (CorridorBuild).
    if (this.gameState.corridorPending()) return;
    this.store.paused.set(false);

    // Source priority for the wave config:
    //   1. Wave Director (production default).
    //   2. Debug panel's custom-wave settings (last fallback).
    if (this.store.directorEnabled()) {
      if (this.pendingAIWaveRequest) return;
      this.startWaveWithAI(0);
      return;
    }

    const waveConfig = this.buildWaveConfig();
    this.store.waveExplanation.set(null);
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
      this.store.waveExplanation.set(null);
      this.gameState.getEventBus().emit({
        type: 'command:start-wave',
        config: waveConfig,
      });
      return;
    }

    this.pendingAIWaveRequest = true;

    try {
      // The source owns everything about the wave, the boss variants of the
      // rotation past the campaign included: "which wave comes next" is
      // decided in one place (docs/WAVE_SOURCE_PLAN.md).
      const planned = await this.waveDirector.getNextWave(this.store.waveNumber() + 1);
      const aiConfig = planned.config;

      this.store.waveExplanation.set(planned.explanation);
      // What the source decided, for the wave block of the run log. The three
      // numbers come from the plan, so they belong to the wave that ships
      // rather than to whatever the service happens to hold now.
      this.runLog.collector.noteDirectorDecision({
        waveSource: this.waveDirector.source.id,
        template: aiConfig.templateName,
        reason: planned.explanation?.reasons,
        composition: aiConfig.enemies.map((group) => ({
          type: group.type,
          count: group.count,
          hp: group.healthMultiplier ?? 1,
        })),
        ...planned.log,
      });
      // The spawn schedule is built where the command acts: it draws from
      // the spawn stream, which has to move on every coop client alike
      this.gameState.getEventBus().emit({
        type: 'command:start-wave',
        director: aiConfig,
      });
    } catch (error) {
      console.error('[AI] Failed to generate wave', error);
      // The rule director needs nothing to load, so anything that reaches
      // here is a real bug: surface it rather than silently dropping to
      // manual waves.
      this.store.directorError.set(
        'Could not generate a wave. Falling back to manual waves; see the console '
        + 'for details.'
      );
      this.store.directorEnabled.set(false);
      this.pendingAIWaveRequest = false;
      this.startWaveWithAI(retryCount + 1);
      return;
    } finally {
      this.pendingAIWaveRequest = false;
    }
  }

  /**
   * Start a custom wave using debug panel settings only. Lifts the pause
   * like startWave().
   */
  startCustomWave(): void {
    if (!this.initialized) return;
    if (!this.bridge.getEngine() || this.store.phase() === 'wave' || this.store.phase() === 'gameover') return;
    if (this.store.spawnPoints().length === 0) return;
    // The corridor of a new location or a move is still being built (CorridorBuild).
    if (this.gameState.corridorPending()) return;
    this.store.paused.set(false);

    const waveConfig = this.buildWaveConfig();

    this.store.waveExplanation.set(null);
    this.gameState.getEventBus().emit({
      type: 'command:start-wave',
      config: waveConfig,
    });
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

    // The wave director resets on the game:reset the restart emits (subscribeToEventBus).

    // Reset bot state
    this.botClient.resetBot();
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
    this.mapPlacement.updatePreview(dtSec);
    this.streetRendering.continueStreetRender();
    this.keyboardPan.update(dtSec);
    // Quick jumps (Home, N) add to what keyboard pan did this frame
    this.cameraControl.update(deltaTime);
    this.markerViz.animateMarkers(deltaTime, this.gameState.paused());
    this.routeAnimation.update(deltaTime);
    // After keyboardPan so a scripted flight wins the frame if both run.
    this.introFlight.update(deltaTime);
    // The mouse look of this frame, as a command before the sub-steps
    this.towerControl.flushAim();

    // Game logic tick — sub-step loop runs gameplay at fixed game-time
    // granularity. Bot decisions are per-sub-step so they stay
    // framerate-independent at any training speed.
    this.gameState.update(performance.now(), (gameTimeStepMs) => {
      // Bot decision tick per sub-step (game-time). The snapshot is passed as
      // a thunk so it is only built on the ticks where the bot's reaction
      // cooldown has actually elapsed.
      if (this.botClient.botEnabled()) {
        this.botClient.updateBot(
          () => this.stateSnapshots.getStateSnapshot(),
          gameTimeStepMs,
        );
      }
    });

    // After the sub-steps: a boss that stepped out of its portal in them
    // cuts the camera in this frame. Its pose wins over pan and jumps above.
    this.bossIntro.update(deltaTime);
    // The wave replay, while it is on. After the game's update: its pause
    // set the renderers' timescale to 0, the replay sets its own speed
    this.replay.update(deltaTime);
    // The view from the manned tower, after the sub-steps turned it to the aim
    this.towerControl.update(deltaTime);

    // One sample a second of game time, after the sub-steps of this frame.
    // Not while a replay re-simulates: the clock is the replay's then
    if (!this.gameState.isReplaying) {
      this.runLog.tick();
      this.tickAutoWave();
    }

    // Performance profiler tick (console log timer)
    this.profiler.tick(deltaTime);

    // Route grid visualization — both ground- and air-layer share the
    // same cell-state buffer, so a single updateVisualization() call
    // refreshes whichever of the two meshes is currently shown.
    const grid = this.gameState.getGlobalRouteGrid();
    if (grid.isSpatialGridVizVisible() || grid.isAirSpatialGridVizVisible()) {
      grid.updateVisualization();
    }
    grid.updateAnimation(deltaTime);

    // GPU-LOS-Viz: Build-Preview (TowerPlacementService) und Selection
    // (TowerManager) ticken pulse-uniform mit gemeinsamer Zeitbasis.
    const losTimeSec = performance.now() * 0.001;
    this.towerPlacement.tickBuildPreviewViz(losTimeSec);
    this.gameState.towerManager.tickSelectionViz(losTimeSec);

    // Veteran badges follow the towers' kill counts (cosmetic)
    this.gameState.towerManager.syncVeteranBadges();

    // Throttled UI stats (~10Hz)
    const now = performance.now();
    if (now - this.lastStatsUpdate < GameLoopFacadeService.STATS_THROTTLE_MS) return;
    this.lastStatsUpdate = now;

    const engine = this.bridge.getEngine();
    if (engine) {
      const soundDebugOpen = this.debugWindows.soundWindow().isOpen;
      this.ngZone.run(() => {
        this.engineStore.updateEngineStats({
          fps: engine.renderLoop.getFPS(),
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
