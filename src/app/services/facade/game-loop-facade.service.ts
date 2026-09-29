import { Injectable, inject, Injector, NgZone, effect, untracked } from '@angular/core';
import { RouteGridVizService } from '../world/route-grid-viz.service';
import { SubscriptionBag } from '../../game-engine/game-event-bus';
import { waveButtonAction } from '../../coop/room-options';
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
import { SimClient } from '../../sim/client/sim-client.service';
import { SimMirror } from '../../sim/client/mirror/sim-mirror';
import { MainWorldService } from '../world/main-world.service';
import { GlobalRouteGridService } from '../world/global-route-grid.service';
import { TowerSelectionService } from '../tower-selection.service';
import { PresentationService } from '../../presentation/presentation.service';
import { GameStore } from '../../store/game.store';
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
import { COOP } from '../coop.token';
import { newRunSeed } from '../../utils/game-rng';

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
  private readonly sim = inject(SimClient);
  private readonly mirror = inject(SimMirror);
  private readonly world = inject(MainWorldService);
  private readonly grid = inject(GlobalRouteGridService);
  private readonly gridViz = inject(RouteGridVizService);
  private readonly selection = inject(TowerSelectionService);
  private readonly presentation = inject(PresentationService);
  private readonly gameStore = inject(GameStore);
  /** Coop, where the game runs one (component scope); the wave button means "ready" there */
  private readonly coop = inject(COOP, { optional: true });

  /** Component bridge — set via initialize() */
  private bridge!: FacadeComponentBridge;

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

  /** Game time of the packet the bot saw last, for its decision clock */
  private botGameTimeMs: number | null = null;
  /** The pause as the presentation holds it (loops, dimmed music), see onEngineUpdate */
  private presentedPause: string | null = null;

  /**
   * Initialize sub-facade with bridge and game state.
   */
  initialize(bridge: FacadeComponentBridge): void {
    this.bridge = bridge;
    this.initialized = true;
    // The run's director stream, drawn on this thread from the run's seed
    // (the mirror follows the simulation's seed): the same numbers as when the
    // simulation served it. GameRng keeps a stream's function across a reset.
    this.waveDirector.useRandomSource(() => this.mirror.rng.stream('director'));
    // The load runner's handle (e2e/perf/sim-load.ts): a command, the speed, the numbers it measures
    (globalThis as Record<string, unknown>)['__load'] = {
      emit: (command: { type: string }) => this.sim.bus.emit(command as Parameters<SimClient['bus']['emit']>[0]),
      speed: (value: number) => this.gameStore.gameSpeed.set(value),
      // Answers once the simulation's worker takes a call: whether it is alive
      ping: () => this.sim.rpc('worldKey'),
      tickProfile: () => this.sim.rpc('tickProfile'),
      // The ground under a spot as the placement UI samples it (geo height), null where the tiles have none
      groundAt: (lat: number, lon: number) => {
        const engine = this.bridge.getEngine();
        const localY = engine?.getTerrainHeightAtGeo(lat, lon) ?? null;
        return engine && localY !== null ? localY + engine.sync.getOrigin().height : null;
      },
      state: () => ({
        enemies: this.mirror.scalars.enemiesAlive,
        towers: this.mirror.scalars.towerCount,
        phase: this.mirror.scalars.phase,
        gameTimeMs: this.mirror.scalars.gameTimeMs,
        tickMs: this.mirror.scalars.tickMs,
        apply: this.sim.applyTimes,
        subStep: this.mirror.scalars.subStep,
        paths: this.world.routes().map((path) => path.map((w) => [w.lat, w.lon])),
      }),
    };
    // Coop: the host starts the wave once everyone is ready (D15)
    this.coop?.setWaveStarter(() => this.startWaveNow());
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
      const speedMps = this.waveDebug.enemySpeed();
      untracked(() => {
        if (this.sim.started) this.sim.bus.emit({ type: 'debug:enemy-speed', speedMps });
      });
    }, { injector });

    // Effect: the simulation stopped with an error; the game stands, the banner says why
    effect(() => {
      const failure = this.sim.failure();
      if (failure === null) return;
      untracked(() => this.uiStore.notice.set(`The simulation stopped with an error (${failure}). Reload the page to play on.`));
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
        untracked(() => {
          for (const de of this.enemyDebug.debugEnemies()) {
            if (!de.enemy.alive) continue;
            this.sim.bus.emit({ type: 'debug:enemy-move', enemyId: de.id, action: 'start' });
            this.bridge.getEngine()?.enemies.startWalkAnimation(de.id);
          }
        });
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

    // Effect: the selected tower's line-of-sight view follows the filter
    effect(() => {
      const mode = this.uiStore.perTowerLosFilter();
      this.selection.applyLosFilter(mode);
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
      const speedMps = selected.overrides.baseSpeed;
      untracked(() => this.sim.bus.emit({ type: 'debug:enemy-speed', enemyId: selected.id, speedMps }));
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
    const eventBus = this.sim.bus;

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
    // A bot starts its own waves, a training run must not change behind it.
    // In coop the room's rule says (D38, D44): with "Auto 10 s" every client
    // counts on the lockstep game clock alike, and the host starts the wave
    const coop = this.coop?.inGame() ? this.coop : null;
    if (coop ? coop.options().wave !== 'auto' : !this.uiStore.autoStartWaves() || this.botClient.botEnabled()) return;
    if (this.store.phase() === 'gameover') return;
    const now = this.mirror.scalars.gameTimeMs;
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
    const now = this.mirror.scalars.gameTimeMs;
    if (this.autoWave.tick(now)) {
      this.showAutoWaveSeconds(null);
      // Coop: the host's client starts it for the room; a guest's only counted along
      const coop = this.coop?.inGame() ? this.coop : null;
      if (!coop) this.ngZone.run(() => this.startWave());
      else if (coop.isHost()) this.ngZone.run(() => this.startWaveNow());
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
   * Start the wave the debug panel describes. Sent as the source's wave, not
   * as a schedule: the schedule draws from the run's spawn stream where the
   * command acts, so every coop client draws alike (docs/COOP_PLAN.md, C0).
   */
  private emitDebugPanelWave(): void {
    this.store.waveExplanation.set(null);
    this.sim.bus.emit({
      type: 'command:start-wave',
      director: this.waveDebug.toAIWaveConfig(),
    });
  }

  /**
   * Start a new wave (manual or AI-directed). The start button, the hotkey
   * and the auto-start come here; each lifts the pause.
   */
  startWave(): void {
    // Coop: the button says "ready"; the host starts once everyone is, or at
    // once where the room says the host starts the waves (D38)
    const coop = this.coop?.inGame() ? this.coop : null;
    if (coop && waveButtonAction(coop.options(), coop.isHost()) === 'ready') {
      coop.toggleReady();
      return;
    }
    this.startWaveNow();
  }

  /**
   * The wave button without its toggle, for the bot: in coop ready (never
   * taken back) or, where the room lets this host start, the start.
   */
  readyOrStartWave(): void {
    const coop = this.coop?.inGame() ? this.coop : null;
    if (coop && waveButtonAction(coop.options(), coop.isHost()) === 'ready') {
      coop.sayReady();
      return;
    }
    this.startWaveNow();
  }

  /** Start the next wave: the button in the single player game, the host in coop once all are ready. */
  private startWaveNow(): void {
    if (!this.initialized) return;
    if (!this.bridge.getEngine() || this.store.phase() === 'wave' || this.store.phase() === 'gameover') return;
    if (this.store.spawnPoints().length === 0) return;
    // The corridor of a new location or a move is still being built (CorridorBuild).
    if (this.world.corridorPending()) return;
    this.store.paused.set(false);

    // Source priority for the wave config:
    //   1. Wave Director (production default).
    //   2. Debug panel's custom-wave settings (last fallback).
    if (this.store.directorEnabled()) {
      if (this.pendingAIWaveRequest) return;
      this.startWaveWithAI(0);
      return;
    }

    this.emitDebugPanelWave();
  }

  /**
   * Start wave using AI Wave Director.
   * Guarded against infinite recursion via retry counter.
   */
  private async startWaveWithAI(retryCount: number): Promise<void> {
    if (retryCount >= GameLoopFacadeService.MAX_AI_RETRY) {
      console.error('[AI] Max retries reached, falling back to manual wave config');
      this.emitDebugPanelWave();
      return;
    }

    this.pendingAIWaveRequest = true;

    try {
      // The source owns everything about the wave, boss waves included:
      // "which wave comes next" is decided in one place
      // (docs/WAVE_SOURCE_PLAN.md).
      const planned = await this.waveDirector.getNextWave(this.store.waveNumber() + 1);
      const aiConfig = planned.config;

      this.store.waveExplanation.set(planned.explanation);
      // The spawn schedule is built where the command acts: it draws from
      // the spawn stream, which has to move on every coop client alike. The
      // plan goes along for the run log of every client (wave:planned); its
      // numbers come from the plan, so they belong to the wave that ships
      // rather than to whatever the service happens to hold now.
      this.sim.bus.emit({
        type: 'command:start-wave',
        director: aiConfig,
        plan: { waveSource: this.waveDirector.source.id, log: planned.log },
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
    if (this.world.corridorPending()) return;
    this.store.paused.set(false);
    this.emitDebugPanelWave();
  }

  // ══════════════════════════════════════════════════════════════
  // Game Lifecycle
  // ══════════════════════════════════════════════════════════════

  /**
   * Handle game over.
   */
  onGameOver(): void {
    // The simulation ended the wave and its spawning itself
    this.pendingAIWaveRequest = false;
  }

  /**
   * Restart game.
   * @param cleanupDpsViz Callback to clean up DPS visualization (owned by VisualizationFacade)
   */
  restartGame(cleanupDpsViz: () => void): void {
    // Coop without a connection: the restart would go to a closed socket; the run goes on alone (TODO E40)
    if (this.coop?.lostInGame()) this.coop.continueAlone();
    // Coop: only the host restarts, with a seed for every client (docs/COOP_PLAN.md, R1)
    const coop = this.coop?.inGame() ? this.coop : null;
    if (coop && !coop.isHost()) return;
    // NOTE: Do NOT dispose the spatial grid visualization here. The grid itself
    // is preserved across restart (it's bound to the location), and the viz
    // mesh self-updates from live cell state. Disposing it here made the
    // overlay disappear after game-over until the user toggled it off/on.

    // Cleanup DPS profile visualization (delegated to VisualizationFacade)
    cleanupDpsViz();

    this.sim.bus.emit(coop ? { type: 'command:restart-game', seed: newRunSeed() } : { type: 'command:restart-game' });

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

    this.sim.bus.emit({
      type: 'command:upgrade-tower',
      towerId: tower.id,
      upgradeId,
    });

    return true;
  }

  /**
   * What the simulation's look follows on this thread (was the
   * GameStateManager's store effects): the renderers' clock (the replay's
   * speed, 0 in the pause), their on/off switch, and the pause of the sound
   * loops and the music.
   */
  private syncPresentation(): void {
    const engine = this.bridge.getEngine();
    if (!engine) return;
    const paused = this.gameStore.paused();
    const replayScale = this.replay.timescale();
    engine.setTimescale(replayScale ?? (paused ? 0 : this.gameStore.gameSpeed()));
    const rendering = this.gameStore.renderingEnabled();
    if (engine.renderingEnabled !== rendering) engine.setRenderingEnabled(rendering);
    const keepLoops = this.gameStore.pauseKeepsLoops();
    const pause = `${paused}|${keepLoops}`;
    const host = this.presentation.host;
    if (host && pause !== this.presentedPause) {
      this.presentedPause = pause;
      host.setPaused(paused, keepLoops);
    }
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
    this.markerViz.animateMarkers(deltaTime, this.gameStore.paused());
    this.routeAnimation.update(deltaTime);
    // After keyboardPan so a scripted flight wins the frame if both run.
    this.introFlight.update(deltaTime);
    // The mouse look of this frame, as a command before the sub-steps
    this.towerControl.flushAim();

    // The simulation (docs/SIM_WORKER.md): apply the packet that came back
    // from the worker (mirror, renderers, events), then send this frame's
    // tick with the commands given since. The worker runs the sub-steps
    // while this thread renders.
    this.world.syncPending();
    this.syncPresentation();
    this.sim.frame(performance.now());

    // Bot decision tick once per frame, on the game time the packet moved
    // (the bot's reaction cooldown runs in game time). The snapshot is passed
    // as a thunk so it is only built on the ticks where the cooldown has
    // actually elapsed. Its commands go with the next tick.
    const gameTimeMs = this.mirror.scalars.gameTimeMs;
    const botDelta = this.botGameTimeMs === null ? 0 : gameTimeMs - this.botGameTimeMs;
    this.botGameTimeMs = gameTimeMs;
    if (botDelta > 0 && this.botClient.botEnabled()) {
      this.botClient.updateBot(() => this.stateSnapshots.getStateSnapshot(), botDelta);
    }

    // After the sub-steps: a boss that stepped out of its portal in them
    // cuts the camera in this frame. Its pose wins over pan and jumps above.
    this.bossIntro.update(deltaTime);
    // The wave replay's bar and a replay that waited for a quiet field
    this.replay.update();
    // The view from the manned tower, after the sub-steps turned it to the aim
    this.towerControl.update(deltaTime);

    // One sample a second of game time, after the sub-steps of this frame.
    // Not while a replay re-simulates: the clock is the replay's then
    if (!this.sim.replay) {
      this.runLog.tick();
      this.tickAutoWave();
    }

    // Performance profiler tick (console log timer)
    this.profiler.tick(deltaTime);

    // Route grid visualization — both ground- and air-layer share the
    // same cell-state buffer, so a single updateVisualization() call
    // refreshes whichever of the two meshes is currently shown.
    const gridViz = this.gridViz;
    if (gridViz.isSpatialGridVizVisible() || gridViz.isAirSpatialGridVizVisible()) {
      gridViz.updateVisualization();
    }
    gridViz.updateAnimation(deltaTime);

    // The line-of-sight views of the build preview and of the selected
    // tower pulse on one time base
    const losTimeSec = performance.now() * 0.001;
    this.towerPlacement.tickBuildPreviewViz(losTimeSec);
    this.selection.tick(losTimeSec);

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
