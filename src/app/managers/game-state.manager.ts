import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { Vector3 } from 'three';
import { EnemyManager } from './enemy.manager';
import { TowerManager } from './tower.manager';
import { ProjectileManager } from './projectile.manager';
import { WaveManager, SpawnPoint, WaveConfig } from './wave.manager';
import { UIStore } from '../store/ui.store';
import { GameStore } from '../store/game.store';
import { PathAndRouteService } from '../services/world/path-route.service';
import { GlobalRouteGridService } from '../services/world/global-route-grid.service';
import { SpatialGridService } from '../services/world/spatial-grid.service';
import { CombatEffectService } from '../services/combat/combat-effect.service';
import { StatusEffectService } from '../services/combat/status-effect.service';
import { HQDamageService } from '../services/combat/hq-damage.service';
import { TowerCombatService } from '../services/combat/tower-combat.service';
import { WaveDebugService } from '../services/debug/wave-debug.service';
import { EnemyDebugService } from '../services/debug/enemy-debug.service';
import { MarkerVisualizationService } from '../services/world/marker-visualization.service';
import { TowerPlacementService } from '../services/tower-placement.service';
import { GeoPosition, RouteWaypoint } from '../models/game.types';
import { GameObject } from '../core/game-object';
import { TowerTypeId, UpgradeId } from '../configs/tower-types.config';
import { TIMING } from '../configs/timing.config';
import { Tower } from '../entities/tower.entity';
import { raycastStats } from '../utils/raycast-stats';
import { EconomyService, skippedWavesGold } from '../services/economy.service';
import { GameCommandsHandler } from './game-commands.handler';
import { ThreeTilesEngine } from '../three-engine';
import { GameEventBus, IGameManager, VFXService, AudioService, ScreenShakeService, BackgroundMusicService, BloodMoonService, SubscriptionBag } from '../game-engine';
import { PerformanceProfilerService } from '../services/debug/performance-profiler.service';
import { ResearchManager } from './research.manager';
import { AbilityManager } from './ability.manager';
import { HeroManager } from './hero.manager';
import { HERO_SOURCE_ID } from '../configs/hero.config';
import { heroBodyContact } from '../utils/hero-body-contact';
import { ResearchStore } from '../store/research.store';
import { GameClock } from './game-state/game-clock';
import { CreditsLedger } from './game-state/credits-ledger';
import { BaseHealthLedger } from './game-state/base-health-ledger';
import { TowerLifecycle } from './game-state/tower-lifecycle';
import { summarizeWaveGroups } from './game-state/wave-preview';
import { routeSweepToward } from '../utils/route-sweep';
import { ReplayRecorder } from '../replay/replay-recorder';

/**
 * Main game state orchestrator - coordinates all entity managers
 *
 * Handles game lifecycle, wave progression, and provides a unified API
 * for the game component to interact with.
 */
@Injectable()
export class GameStateManager {
  // Angular-injected services (UI & coordination)
  private readonly uiStore = inject(UIStore);
  private readonly pathRouteService = inject(PathAndRouteService);
  private readonly globalRouteGrid = inject(GlobalRouteGridService);
  private readonly combatEffect = inject(CombatEffectService);
  private readonly statusEffectService = inject(StatusEffectService);
  private readonly hqDamage = inject(HQDamageService);
  private readonly towerCombat = inject(TowerCombatService);
  private readonly waveDebug = inject(WaveDebugService);
  private readonly enemyDebug = inject(EnemyDebugService);
  private readonly markerViz = inject(MarkerVisualizationService);
  private readonly towerPlacement = inject(TowerPlacementService);
  private readonly gameStore = inject(GameStore);
  private readonly spatialGrid = inject(SpatialGridService);
  private readonly economy = inject(EconomyService);

  // Game Engine (framework-agnostic)
  private readonly eventBus = new GameEventBus();
  private vfxService!: VFXService;
  private audioService!: AudioService;
  screenShakeService!: ScreenShakeService;
  backgroundMusic!: BackgroundMusicService;
  private bloodMoonService: BloodMoonService | null = null;
  private readonly researchStore = inject(ResearchStore);
  readonly towerManager = (() => {
    const mgr = new TowerManager(this.eventBus, this.researchStore);
    mgr.setGlobalRouteGrid(this.globalRouteGrid);
    return mgr;
  })();
  readonly enemyManager = new EnemyManager(this.eventBus, this.globalRouteGrid, this.spatialGrid);
  readonly projectileManager = new ProjectileManager(this.eventBus);
  readonly waveManager = new WaveManager(this.eventBus, this.enemyManager);
  readonly researchManager = new ResearchManager(this.eventBus);
  readonly abilityManager = new AbilityManager(this.eventBus, {
    snapToRoute: (target, maxDistanceM) => this.globalRouteGrid.snapToRouteCell(target, maxDistanceM),
    enemiesInRadius: (center, radiusM, out) =>
      this.globalRouteGrid.getEnemiesInRadiusGeo(center, radiusM, undefined, out),
    strike: (targets, fractionOf) => this.combatEffect.applyAbilityStrike(targets, fractionOf),
    showDamage: (enemy, fraction, damageType) => this.combatEffect.showAbilityDamage(enemy, fraction, damageType),
    halt: (targets, status, durationMsOf, sourceId) =>
      this.combatEffect.applyAbilityHalt(targets, status, durationMsOf, sourceId),
    routeSweep: (target, maxDistanceM, lengthM) =>
      routeSweepToward(this.waveManager.getPaths(), target, maxDistanceM, lengthM),
  });
  // The hero's measure on bodies along the route (HeroWorld.bodyContact)
  private readonly heroLocal = new Vector3();
  private readonly routeGroundY = (x: number, z: number): number | null => this.globalRouteGrid.getGroundLocalYAt(x, z);
  readonly heroManager = new HeroManager(this.eventBus, {
    routes: () => this.pathRouteService.getCachedPaths(),
    base: () => this.basePosition,
    enemiesInRadius: (center, radiusM, out) =>
      this.globalRouteGrid.getEnemiesInRadiusGeo(center, radiusM, undefined, out),
    bodyContact: (enemy, from, out) => {
      const body = enemy.body;
      const engine = this.tilesEngine;
      if (!body || !engine) return null;
      const local = engine.sync.geoToLocalSimpleInto(from.lat, from.lon, 0, this.heroLocal);
      return heroBodyContact(
        body, local.x, local.z, this.routeGroundY,
        enemy.transform.terrainHeight - body.stations.originHeight, out,
      );
    },
    groundHeight: (lat, lon) => this.groundHeightAt(lat, lon),
    fire: (shot) => {
      this.projectileManager.spawnShot(
        shot.origin, shot.originHeight, shot.target,
        shot.ammo.projectileType, shot.damage, shot.ammo.damageType, HERO_SOURCE_ID,
        shot.aimPoint ?? undefined,
      );
    },
    spend: (cost) => this.creditsLedger.spend(cost),
  });

  /**
   * Records the running wave for the replay (docs/REPLAY.md). Starts on
   * wave:started by itself; update() hands it the sub-steps, the wave end
   * and game over close it.
   */
  readonly replayRecorder = new ReplayRecorder(this.eventBus, {
    enemies: () => this.enemyManager.getAllActive(),
    projectiles: () => this.projectileManager.getAllActive(),
    towers: () => this.towerManager.getAll(),
    hero: () => this.heroManager.getPresentation(),
    engine: () => this.tilesEngine,
    gameTimeMs: () => this.clock.gameTimeMs,
    baseHealth: () => this.baseHealth(),
    credits: () => this.credits(),
  });

  /**
   * Canonical list of sub-managers that implement IGameManager. Used for the
   * polymorphic teardown loop in dispose() — destroy() is parameterless and
   * is therefore the only lifecycle call that iterates cleanly off this array.
   *
   * initialize(), reset() and the per-frame update() sequence stay hardcoded
   * on purpose and are deliberately NOT driven off this array:
   *  - initialize(): the managers take different arguments (WaveManager
   *    takes spawnPoints + paths, EnemyManager needs follow-up provider
   *    wiring, ResearchManager has no lifecycle initialize at all). A
   *    uniform forEach would require unsafe
   *    `...unknown[]` casts and lose all per-manager type-checking.
   *  - update(): runSubStep() interleaves the managers with
   *    eventBus.processQueue() and conditional towerCombat — the order is
   *    load-bearing and not safely expressed as a simple forEach.
   */
  private readonly subManagers: IGameManager[] = [
    this.towerManager,
    this.enemyManager,
    this.projectileManager,
    this.waveManager,
    this.researchManager,
    this.abilityManager,
    this.heroManager,
  ];

  // Game state signals, owned by their ledgers
  private readonly healthLedger = new BaseHealthLedger(this.eventBus);
  readonly baseHealth = this.healthLedger.baseHealth;
  private readonly creditsLedger = new CreditsLedger(this.eventBus);
  readonly credits = this.creditsLedger.credits;

  /** Place, sell and upgrade rules, range refresh and guard heading of the towers */
  private readonly towerLifecycle = new TowerLifecycle(
    this.towerManager,
    this.researchManager,
    this.waveManager,
    this.enemyManager,
    this.towerPlacement,
    this.towerCombat,
    this.researchStore,
    this.creditsLedger,
    this.eventBus,
    () => this.tilesEngine,
    () => this.corridorPending(),
  );
  /** Game over screen signal - delegated to HQDamageService */
  readonly showGameOverScreen = computed(() => this.hqDamage.showGameOverScreen());

  /** Training mode timescale (1.0 = normal, 3.0 = 3x speed) */
  readonly trainingTimescale = signal<number>(1.0);

  /** Command-Bus-Adapter — registriert sich bei initialize(). */
  private commandsHandler: GameCommandsHandler | null = null;

  /**
   * A wave has started in this run; `game:started` goes out before the first.
   * Not read off the counter: the dev wave jump moves it before any wave ran.
   */
  private runStarted = false;

  /** Sync timescale from GameStore (UI source of truth) → local signal */
  private readonly timescaleSyncEffect = effect(() => {
    const storeValue = this.gameStore.trainingTimescale();
    this.trainingTimescale.set(storeValue);
  });

  /** Game time stands still, see GameStore.paused. */
  readonly paused = signal<boolean>(false);

  /** Sync pause from GameStore (UI source of truth) → local signal */
  private readonly pauseSyncEffect = effect(() => {
    const paused = this.gameStore.paused();
    this.paused.set(paused);
    // No sub-step runs while paused; every loop (walk cycles, flames, the
    // ooze's bubbling) stands with the game
    this.tilesEngine?.spatialAudio.holdLoops(paused);
  });

  /** Phase 5.14: sync renderingEnabled signal → ThreeTilesEngine. Gameplay
   *  runs unaffected; only per-frame visual work is skipped when disabled. */
  private readonly renderingSyncEffect = effect(() => {
    const enabled = this.gameStore.renderingEnabled();
    this.tilesEngine?.setRenderingEnabled(enabled);
  });

  // Computed signals for UI bindings
  readonly phase = computed(() => this.waveManager.phase());
  readonly waveNumber = computed(() => this.waveManager.waveNumber());
  readonly enemiesAlive = computed(() => this.enemyManager.aliveCount());
  readonly selectedTowerId = computed(() => this.towerManager.getSelectedId());
  readonly selectedTower = computed(() => this.towerManager.getSelected());

  /**
   * Towers standing now. A plain method: towerManager.getAll() reads no
   * signal, so as a computed it kept the count of its first read. The
   * corridor lock reads it when a location loads (CorridorBuild.rebuildBlocker),
   * with no tower standing yet, and from then on let corridor rebuilds
   * through under standing towers; their visibleCells stayed in the old grid.
   */
  towerCount(): number {
    return this.towerManager.getAll().length;
  }

  // Engine reference (public so visual hooks like turret-aim can access it).
  tilesEngine: ThreeTilesEngine | null = null;
  private basePosition: GeoPosition | null = null;

  /** Sub-step accounting: accumulator, catch-up cap, game time. */
  private readonly clock = new GameClock();

  /** Read-only access to the game-clock for any consumer that needs
   *  game-time (status effects, sleep checks, AI bot ticks, etc). */
  get gameTimeMs(): number {
    return this.clock.gameTimeMs;
  }

  // Performance profiler (optional, set via setProfiler())
  private profiler: PerformanceProfilerService | null = null;
  /** Profiler sums of one frame, filled by runSubStep() */
  private readonly stepTimings = { tProjectile: 0, tCombat: 0, tEvents: 0 };

  /**
   * The route corridor is being built (CorridorBuild), set by
   * VisualizationFacadeService.initialize; see corridorPending.
   */
  private corridorBuilding: (() => boolean) | null = null;

  /** EventBus subscription bag — cleaned up in initialize() (re-init) and dispose() */
  private readonly eventBusSubs = new SubscriptionBag();

  /** Bound once for the research queue, which runs every sub-step (ResearchManager.startQueued) */
  private readonly creditsNow = (): number => this.credits();
  private readonly spendForResearch = (cost: number): boolean => this.creditsLedger.spend(cost);

  /**
   * Set performance profiler for frame timing instrumentation.
   */
  setProfiler(profiler: PerformanceProfilerService | null): void {
    this.profiler = profiler;
  }

  /** See corridorPending. */
  setCorridorPending(pending: (() => boolean) | null): void {
    this.corridorBuilding = pending;
  }

  /**
   * The route corridor of a new location or of a move is still being built
   * (CorridorBuild): no tower is placed and no wave starts until it is done.
   * Both would stand on the cells the build replaces. Holds for every way in:
   * click, hotkey, auto start, wave director and the training bot.
   */
  corridorPending(): boolean {
    return this.corridorBuilding?.() ?? false;
  }

  /**
   * Initialize game state with ThreeTilesEngine
   */
  initialize(
    tilesEngine: ThreeTilesEngine,
    basePosition: GeoPosition,
    spawnPoints: SpawnPoint[],
    cachedPaths: Map<string, GeoPosition[]>
  ): void {
    // Clean up previous subscriptions to prevent duplicate event handlers on re-init
    this.eventBusSubs.disposeAll();

    // Destroy old game-engine service instances (they register event handlers in constructors)
    this.vfxService?.destroy();
    this.audioService?.destroy();
    this.screenShakeService?.destroy();
    this.backgroundMusic?.destroy();
    this.bloodMoonService?.destroy();
    // Dispose previous command-bus adapter — otherwise its subscriptions on
    // command:* / debug:* events stack on top of the new handler below,
    // causing every command (place-tower, sell-tower, restart-game, …) to
    // run N times after N in-app location changes. This was the cause of
    // duplicate tower placements + duplicate placement sounds, which in
    // turn left half the towers stuck at losReady=false because
    // pendingTowerReg is a single slot and gets overwritten by the second
    // placeTower call.
    this.commandsHandler?.dispose();

    // A replay of the previous place is in the previous place's coordinates
    this.replayRecorder.clear();

    this.tilesEngine = tilesEngine;
    this.basePosition = basePosition;
    // The pause sync above only reaches an engine that is already here
    tilesEngine.spatialAudio.holdLoops(this.paused());

    // Initialize defense-reach debug visualization (orange marker)
    this.globalRouteGrid.initDebugViz(tilesEngine.getScene(), tilesEngine.portalClip);

    // Initialize entity managers (no callbacks - use events)
    this.enemyManager.initialize(tilesEngine);
    // Wire wave-number + wave-size providers for the kill-reward formula
    this.enemyManager.setWaveNumberProvider(() => this.waveManager.waveNumber());
    this.enemyManager.setWaveSizeProvider(() => this.waveManager.getExpectedBodyCount());
    // Abilities fire during a wave only
    this.abilityManager.setPhaseProvider(() => this.waveManager.phase());

    this.towerManager.initialize(tilesEngine);
    this.towerManager.setActiveRoutesGetter(() =>
      Array.from(this.pathRouteService.getCachedPaths().values())
    );

    // Wire the engine game-clock into StatusEffectService (breaks DI cycle —
    // StatusEffectService can't directly inject GameStateManager).
    this.statusEffectService.setGameClockProvider(() => this.clock.gameTimeMs);

    // Initialize combat effect service (subscribes to projectile:hit events)
    this.combatEffect.initialize(
      tilesEngine,
      this.eventBus,
      this.towerManager,
      this.enemyManager,
    );

    // Initialize HQ damage service (handles fire, sounds, game over effects)
    this.hqDamage.initialize(tilesEngine, basePosition, this.eventBus);

    // Initialize tower combat service (handles targeting, rotation, shooting)
    this.towerCombat.initialize(tilesEngine);

    // Initialize VFX service (subscribes to vfx events)
    this.vfxService = new VFXService(this.eventBus, tilesEngine);
    // Scorch marks sit on route cells, one per cell, at the grid's ground height
    tilesEngine.effects.setScorchGround(this.globalRouteGrid);
    // The hero stands on the route grid's ground like the enemies
    tilesEngine.hero.setGround(this.globalRouteGrid);
    this.heroManager.setView(tilesEngine.hero);
    // The foot of the orbital laser's beam as well
    tilesEngine.orbitalBeams.setGround(this.globalRouteGrid);

    // Initialize Audio service (subscribes to audio events)
    this.audioService = new AudioService(this.eventBus, tilesEngine);
    // Its ability loops (the siren) stand on the route grid's ground
    this.audioService.setGround(this.globalRouteGrid);

    // Initialize Screen Shake service (subscribes to explosion/impact events)
    this.screenShakeService = new ScreenShakeService(this.eventBus, tilesEngine);

    // Initialize Background Music service (subscribes to wave/game events)
    this.backgroundMusic = new BackgroundMusicService(this.eventBus, tilesEngine);

    // Blood moon look on every seventh wave from W14 (subscribes to wave/game events)
    this.bloodMoonService = new BloodMoonService(this.eventBus, tilesEngine.bloodMoon);

    // Register event handlers (tracked via SubscriptionBag for cleanup in reset())
    // Leaks cost HP, capped per wave; emits health:changed (HQDamageService)
    this.eventBusSubs.add(this.eventBus.on('enemy:reached-base', (event) => {
      this.healthLedger.applyLeak(event.damage);
    }));
    // An ooze flowing in costs HP before it reaches the base as a whole
    this.eventBusSubs.add(this.eventBus.on('enemy:leaking', (event) => {
      this.healthLedger.applyLeak(event.damage);
    }));


    // AA-Retrofit: towers that just gained air targeting get their air LOS
    // resolved (queued, see TowerLifecycle.scheduleAirRetrofit)
    this.eventBusSubs.add(this.eventBus.on('research:completed', (event) => {
      this.towerLifecycle.scheduleAirRetrofit(event.effects);
    }));

    // Once a wave is over, turn the towers to where the route enters their
    // range. During the wave a tower keeps the heading of its last target.
    this.eventBusSubs.add(this.eventBus.on('wave:completed', () => {
      this.towerLifecycle.turnAllToGuard();
    }));

    // Outside a wave the last enemy leaving turns them as well
    // (see TowerLifecycle.turnToGuardIfClear)
    this.eventBusSubs.add(this.eventBus.on('enemy:died', (event) => this.towerLifecycle.turnToGuardIfClear(event.enemy)));
    this.eventBusSubs.add(this.eventBus.on('enemy:reached-base', (event) => this.towerLifecycle.turnToGuardIfClear(event.enemy)));
    // EnemyManager subscribed first and has removed the enemy by now
    this.eventBusSubs.add(this.eventBus.on('debug:remove-enemy', () => this.towerLifecycle.turnToGuardIfClear()));
    // WaveManager subscribed first and has killed them all by now, splitting types included
    this.eventBusSubs.add(this.eventBus.on('debug:kill-all', () => this.towerLifecycle.turnToGuardIfClear()));

    this.eventBusSubs.add(this.eventBus.on('enemy:died', (event) => {
      if (event.credits > 0) {
        this.creditsLedger.add(event.credits);

        // Show reward popup with actual dynamic credits (not static typeConfig.reward)
        if (this.tilesEngine) {
          this.tilesEngine.effects.spawnFloatingText(
            `+${event.credits}`,
            event.enemy.position.lat,
            event.enemy.position.lon,
            event.enemy.transform.terrainHeight + event.enemy.heightOffset + 5,
            {
              color: '#FFD700',
              duration: TIMING.rewardPopupDuration,
              floatSpeed: 1.5,
              scale: 0.75,
              lateralOffset: 1.2,
              lateralDrift: 1.0,
            }
          );
        }
      }
    }));

    // ══════════════════════════════════════════════════════════════
    // Command-Bus-Adapter (UI → Game Engine) — extrahiert in eigene Klasse.
    // ══════════════════════════════════════════════════════════════
    this.commandsHandler = new GameCommandsHandler(this, this.eventBus);

    // Initialize projectile manager (no callback - uses events)
    this.projectileManager.initialize(tilesEngine);

    this.waveManager.initialize(spawnPoints, cachedPaths);
    // Wire health-provider for CloseCall detection at wave end
    this.waveManager.setCurrentHealthProvider(() => this.baseHealth());
  }

  /**
   * Re-seat the wave pipeline with new spawn points and routes.
   *
   * Needed after a DevWorld regeneration, which builds an entirely new map but
   * does not re-run {@link initialize}. `WaveManager.reset()` deliberately
   * keeps its spawn points (a normal game restart reuses the same map), so
   * without this the next wave still spawned at the previous world's
   * coordinates and walked the previous world's path.
   */
  reseatWavePipeline(spawnPoints: SpawnPoint[], cachedPaths: Map<string, GeoPosition[]>): void {
    this.waveManager.initialize(spawnPoints, cachedPaths);
    // The last wave ran through the previous world
    this.replayRecorder.clear();
  }

  /**
   * Main update loop — called EVERY FRAME by the renderer.
   *
   * Architecture: outer wrapper handles wall-clock → game-time conversion and
   * once-per-frame visual chores; inner sub-step loop runs all gameplay logic
   * at a FIXED 16.667ms game-time granularity, identical to a single 1× tick.
   *
   * `onSubStep` is invoked once per sub-step with the step length in game-time
   * ms — used by AI bots so their decision cadence matches game-time rather
   * than wall-clock at high training timescales.
   */
  update(currentTime: number, onSubStep?: (gameTimeStepMs: number) => void): void {
    // Paused: no sub-step runs, so nothing in the simulation moves and the
    // game clock stands. The wall clock is still taken, otherwise the first
    // frame after the pause would try to catch up the whole pause. The
    // remainder stays as it was, the resume continues where the pause began.
    // The renderer clock goes to 0 so walk cycles freeze with their enemies.
    if (this.paused()) {
      this.clock.holdFrame(currentTime);
      this.tilesEngine?.setTimescale(0);
      return;
    }

    const frameStart = performance.now();
    const profiling = this.profiler !== null;

    // Clamped wall-clock delta × timescale plus the carried remainder,
    // see GameClock.beginFrame().
    const timescale = this.trainingTimescale();
    this.clock.beginFrame(currentTime, timescale);

    // Sync timescale to renderer (turret-pulse / hover / shader-time only —
    // gameplay rotation now flows through sub-step game-time).
    this.tilesEngine?.setTimescale(timescale);

    // ══════════════════════════════════════════════════════════════
    // SUB-STEP LOOP (gameplay)
    // ══════════════════════════════════════════════════════════════
    const timings = this.stepTimings;
    timings.tProjectile = 0;
    timings.tCombat = 0;
    timings.tEvents = 0;
    const stepMs = GameClock.FIXED_STEP_MS;

    // nextSubStep() advances the game clock before the step runs
    while (this.clock.nextSubStep()) {
      this.runSubStep(stepMs, profiling);

      // Notify per-sub-step listeners (AI bot, etc.)
      onSubStep?.(stepMs);

      // After the turret aim above, so a frame shows where the turrets point
      this.replayRecorder.onSubStep();

      // Wave-completion / game-over checks belong INSIDE the sub-step loop
      // so they catch state transitions mid-frame (otherwise a wave might
      // visibly run for "one extra frame" at high timescales).
      const isWavePhase = this.waveManager.phase() === 'wave';
      // A pending strike lands in its own wave, never in the setup or the next one
      if (isWavePhase && !this.abilityManager.hasPendingStrikes() && this.waveManager.checkWaveComplete()) {
        const result = this.waveManager.endWave();
        this.replayRecorder.finish('completed');
        this.towerCombat.stopAllBeams();
        this.towerCombat.stopAllMelee();
        this.enemyDebug.clearDebugEnemies();
        this.applyWaveCompletionBonus(result);
      }
      if (this.baseHealth() <= 0 && this.waveManager.phase() !== 'gameover') {
        this.triggerGameOver();
        break; // no point running more sub-steps after game-over
      }
    }
    this.clock.endFrame();
    const stepsExecuted = this.clock.stepsThisFrame;

    // ══════════════════════════════════════════════════════════════
    // ONCE PER RENDER-FRAME (visuals + UI sync)
    // ══════════════════════════════════════════════════════════════

    // Push enemy state to the renderer once, after the sub-step loop.
    //
    // Only when a sub-step actually ran: above 60 FPS the simulation ticks
    // less often than the frame rate, and the visuals should keep following
    // the simulation rather than re-pushing unchanged state. Skipped entirely
    // when rendering is off, which is what headless training runs at — the
    // per-enemy matrix work used to happen there too, for a frame that is
    // never drawn.
    if (stepsExecuted > 0 && this.tilesEngine?.renderingEnabled) {
      this.enemyManager.presentFrame(this.clock.gameTimeMs);
      this.projectileManager.presentFrame();
      this.heroManager.presentFrame();
    }

    // Sync active research progress to store for UI (cheap, batched once/frame)
    if (this.researchManager.usedSlots > 0) {
      this.researchStore.activeResearches.set(this.researchManager.getActiveResearches());
    }

    if (profiling) {
      this.profiler!.accumulateFrameTiming(
        0, timings.tProjectile, timings.tCombat, timings.tEvents,
        performance.now() - frameStart,
        stepsExecuted,
      );
    }
  }

  /**
   * Execute one fixed game-time sub-step. Called repeatedly from update()
   * so the simulation always runs at ~60Hz game-time regardless of timescale.
   * The game clock has already advanced for this step; profiler times add
   * up in `stepTimings`.
   */
  private runSubStep(stepMs: number, profiling: boolean): void {
    const now = this.clock.gameTimeMs;
    const timings = this.stepTimings;

    let t0 = profiling ? performance.now() : 0;
    this.projectileManager.update(stepMs);
    if (profiling) timings.tProjectile += performance.now() - t0;

    this.researchManager.update(stepMs);
    this.researchManager.startQueued(this.creditsNow, this.spendForResearch);
    // The rumbling tail of a strike that already hit, then strike countdowns
    // and impacts, in game time like the research
    this.audioService?.update(stepMs);
    this.abilityManager.update(stepMs);

    t0 = profiling ? performance.now() : 0;
    this.eventBus.processQueue();
    if (profiling) timings.tEvents += performance.now() - t0;

    const hasDebugEnemies = this.enemyDebug.debugEnemies().length > 0;
    const isWavePhase = this.waveManager.phase() === 'wave';
    const shouldRunCombat = isWavePhase || hasDebugEnemies;

    if (isWavePhase) {
      this.waveManager.tickSpawn(stepMs);
    }

    // Run enemyManager.update unconditionally — even with zero entities it
    // still needs to tick pending-death / pending-start accumulators, and
    // tickPendingDeaths is what finalises the removal of enemies whose
    // death animation just expired.
    this.enemyManager.update(stepMs, now);

    if (shouldRunCombat) {
      t0 = profiling ? performance.now() : 0;
      this.towerCombat.updateTowerShooting(
        now,
        stepMs,
        this.towerManager,
        this.enemyManager,
        this.projectileManager,
      );
      this.towerCombat.updateBeamTowers(
        stepMs,
        this.towerManager,
        this.enemyManager,
        now,
      );
      this.towerCombat.updateMeleeTowers(
        stepMs,
        this.towerManager,
        this.enemyManager,
        now,
      );
      this.towerCombat.updateChainTowers(
        stepMs,
        this.towerManager,
        this.enemyManager,
        now,
      );
      if (profiling) timings.tCombat += performance.now() - t0;
    }

    // Hero: walks and fires in game time, after the enemies moved
    this.heroManager.update(stepMs);
  }

  /** Geo height of the ground under a position, from the route grid like the enemies' feet; 0 without it. */
  private groundHeightAt(lat: number, lon: number): number {
    const engine = this.tilesEngine;
    if (!engine || !this.globalRouteGrid.isInitialized()) return 0;
    const local = engine.sync.geoToLocalSimple(lat, lon, 0);
    const y = this.globalRouteGrid.getGroundLocalYAt(local.x, local.z);
    return y === null ? 0 : y + engine.sync.getOrigin().height;
  }

  /**
   * Trigger game over state
   */
  private triggerGameOver(): void {
    // The last frame of the replay still has the enemies that broke through
    this.replayRecorder.finish('gameover');
    this.waveManager.phase.set('gameover');
    this.enemyManager.clear();
    this.enemyDebug.clearDebugEnemies(); // Clear orphaned debug enemy references
    this.towerManager.selectTower(null);

    // Delegate visual effects to HQDamageService
    this.hqDamage.triggerGameOverEffects();

    // Emit game:over event
    this.eventBus.emit({
      type: 'game:over',
      reason: 'base-destroyed',
    });
  }

  // ============================================
  // Public API
  // ============================================

  /**
   * Start a new wave with config
   */
  startWave(config: WaveConfig): void {
    if (this.corridorPending()) return;

    // Wave preview in the sidebar, see summarizeWaveGroups()
    const groups = summarizeWaveGroups(config);
    if (groups.length > 0) {
      this.waveDebug.setCurrentWaveGroups(groups);
    }

    // Emit lifecycle event BEFORE startWave() so that AIDataCollector.clearHistory()
    // runs before wave:started sets up tracking (prevents NaN in wave history)
    if (!this.runStarted) {
      this.runStarted = true;
      this.eventBus.emit({ type: 'game:started' });
    }

    this.healthLedger.refillLeakBudget();
    this.waveManager.startWave(config);
  }

  /**
   * Begin wave phase without auto-spawning
   */
  beginWave(): void {
    if (this.corridorPending()) return;

    // Emit lifecycle event BEFORE beginWave() so that AIDataCollector.clearHistory()
    // runs before wave:started sets up tracking (prevents NaN in wave history)
    if (!this.runStarted) {
      this.runStarted = true;
      this.eventBus.emit({ type: 'game:started' });
    }

    // A manual wave is a wave all the same: its leaks get their own budget.
    this.healthLedger.refillLeakBudget();
    this.waveManager.beginWave();
  }

  /**
   * Heal base to full health
   */
  healBase(): void {
    this.healthLedger.resetToStart();
    this.hqDamage.healBase();
  }

  /** Debug: add (or take) base HP outside the leak budget, emits health:changed. */
  adjustBaseHealth(amount: number): void {
    this.healthLedger.adjust(amount);
  }

  /**
   * Debug: the next wave to start is `wave`; the waves before it are skipped
   * without spawning. Between waves only and only forward. What counts
   * completed waves moves with the counter: the ability recharge, and with
   * `grantGold` the gold the skipped waves would have paid (skippedWavesGold).
   * What runs on game time (research, auto-start countdown) stays, as no game
   * time passes. The wave director keeps its state, see docs/WAVE_SYSTEM.md.
   * Announced as `wave:jumped`.
   * @returns false when refused: a wave running, game over, or `wave` not past the next wave
   */
  jumpToWave(wave: number, grantGold: boolean): boolean {
    const from = this.waveManager.waveNumber();
    if (this.waveManager.phase() !== 'setup' || !Number.isInteger(wave) || wave <= from + 1) return false;

    const skipped = wave - 1 - from;
    const credits = grantGold ? skippedWavesGold(from + 1, wave - 1) : 0;
    this.waveManager.jumpTo(wave - 1);
    if (credits > 0) this.creditsLedger.add(credits);
    this.abilityManager.advanceWaves(skipped);
    this.eventBus.emit({ type: 'wave:jumped', from, wave, skipped, credits });
    return true;
  }

  /**
   * Full dispose — called when the component is destroyed.
   * Cleans up EventBus subscriptions that were registered in initialize().
   */
  dispose(): void {
    this.eventBusSubs.disposeAll();
    this.commandsHandler?.dispose();
    this.commandsHandler = null;
    this.replayRecorder.dispose();

    // Destroy game-engine service instances (they hold EventBus subscriptions)
    this.combatEffect.destroy();
    this.vfxService?.destroy();
    this.audioService?.destroy();
    this.screenShakeService?.destroy();
    this.backgroundMusic?.destroy();
    this.bloodMoonService?.destroy();
    this.bloodMoonService = null;

    this.hqDamage.reset();

    // Polymorphic teardown: every sub-manager implements IGameManager.destroy.
    // EntityManager.destroy() clears entities + drops the tilesEngine ref;
    // Wave/ResearchManager.destroy() drops their state.
    for (const m of this.subManagers) {
      m.destroy();
    }
    this.globalRouteGrid.clear();

    if (this.tilesEngine) {
      this.tilesEngine.effects.clear();
    }
  }

  /**
   * Reset game to initial state (restart).
   * Does NOT dispose EventBus subscriptions — handlers stay active for the next game.
   */
  reset(): void {
    // Reset HQ damage service (clears fires, timeouts, game over screen)
    this.hqDamage.reset();

    // Clear tower overlays before clearing towers
    // (unregisters each tower from GlobalRouteGrid, disposes LOS meshes)
    this.towerLifecycle.clearAllOverlays();

    // Stop all active beams/melee before clearing towers
    this.towerCombat.stopAllBeams();
    this.towerCombat.stopAllMelee();

    this.enemyManager.clear();
    this.enemyDebug.clearDebugEnemies(); // Clear orphaned debug enemy references
    this.towerManager.clear();
    this.projectileManager.clear();
    this.waveManager.reset();
    this.researchManager.reset();
    this.abilityManager.reset();
    this.heroManager.reset();
    this.replayRecorder.clear();

    // NOTE: Do NOT clear GlobalRouteGrid here — it's bound to the location
    // and won't be re-initialized on a game-over restart. Tower visibility
    // has already been cleaned up per-tower via clearAllTowerOverlays above.

    if (this.tilesEngine) {
      this.tilesEngine.effects.clear();
      // A killed ooze's collapsing band and debris outlive EnemyManager.clear(),
      // which every wave end runs as well; a restart or location change takes them
      this.tilesEngine.oozes.clear();
    }

    this.healthLedger.resetToStart();
    this.creditsLedger.reset();
    this.clock.reset();
    this.economy.reset();
    this.runStarted = false;

    GameObject.resetIdCounter();

    // Emit game:reset so downstream services (e.g. GameStateSyncService) can react
    this.eventBus.emit({ type: 'game:reset' });
  }

  /** Apply Wave-Completion-Bonus via EconomyService (delegates the math). */
  private applyWaveCompletionBonus(result: { wave: number; perfect: boolean; closeCall: boolean; hpLost: number }): void {
    const total = this.economy.computeWaveCompletionBonus(result);
    this.creditsLedger.add(total);
  }

  /** Add credits to the player account (delta). Public for GameCommandsHandler. */
  addCredits(amount: number): void {
    this.creditsLedger.add(amount);
  }

  /**
   * After a range-stat upgrade (manual or debug-max-upgrade), refresh the
   * tower's LOS cells, range cache, range disc and guard heading.
   */
  recomputeTowerRangeAfterUpgrade(tower: Tower): void {
    this.towerLifecycle.recomputeRangeAfterUpgrade(tower);
  }

  /**
   * Sell a tower and refund 50% of its cost
   */
  sellTower(tower: Tower): number {
    return this.towerLifecycle.sell(tower);
  }

  /**
   * Upgrade one track of a tower: cost, research tier, emits tower:upgraded.
   * @returns false if refused (maxed out, tier locked, credits short)
   */
  upgradeTower(tower: Tower, upgradeId: UpgradeId): boolean {
    return this.towerLifecycle.upgrade(tower, upgradeId);
  }

  /** Debug: every track of every tower to its max level, free of charge. */
  maxUpgradeAllTowers(): void {
    this.towerLifecycle.maxUpgradeAll();
  }

  /**
   * Spend credits (for upgrades etc.)
   * @returns true if credits were spent, false if not enough
   */
  spendCredits(amount: number): boolean {
    return this.creditsLedger.spend(amount);
  }

  /**
   * Place a new tower
   * @param position Geo position
   * @param typeId Tower type ID
   * @param customRotation Custom rotation set by user (radians)
   * @param plinthHeight Stone plinth below position.height (m), 0 = none
   * @param plinthOverhang Footprint probes the plinth hangs over a drop at, see Tower.plinthOverhang
   */
  placeTower(
    position: GeoPosition,
    typeId: TowerTypeId = 'archer',
    customRotation = 0,
    plinthHeight = 0,
    plinthOverhang: readonly number[] = [],
  ): Tower | null {
    return this.towerLifecycle.place(position, typeId, customRotation, plinthHeight, plinthOverhang);
  }

  /**
   * Called when tiles are loaded - notifies HQ damage service
   */
  onTilesLoaded(): void {
    this.hqDamage.onTilesLoaded();

    // Spawn debug point if debug option is enabled
    if (this.uiStore.specialPointsDebugVisible()) {
      this.markerViz.spawnHQDebugPoint();
    }
  }

  /**
   * Get cached enemy routes for LOS preview during tower placement
   */
  getCachedRoutes(): RouteWaypoint[][] {
    return Array.from(this.pathRouteService.getCachedPaths().values());
  }

  /**
   * Initialize GlobalRouteGrid after routes are computed, and keep the tiles
   * along them fine (the route corridor region). Should be called after
   * engine and routes are ready
   */
  initializeGlobalRouteGrid(): void {
    this.buildRouteCells(true);
  }

  /**
   * The cells of the routes in use built again from nothing, without setting
   * the tile region anew: the corridor build (CorridorBuild) narrows the
   * routes pass by pass, and the tiles it measures on stay the ones of the
   * street routes the location was loaded with.
   */
  rebuildRouteCells(): void {
    this.globalRouteGrid.clear();
    this.buildRouteCells(false);
  }

  /** Initialize the grid and generate the cells of the routes in use; with `region`, set the tile region to them as well. */
  private buildRouteCells(region: boolean): void {
    if (!this.tilesEngine) {
      console.warn('[GameStateManager] Cannot initialize GlobalRouteGrid - no engine');
      return;
    }

    // One terrain probe for the grid: ground plus the tile LOD it came from,
    // which `sampleCellY` uses so a coarse streaming pass cannot overwrite a
    // finer sample. The engine caches per column, so repeated cells are free.
    // Its rays are booked as routeGrid (`__raycastStats()`).
    const columnSampler = (x: number, z: number) => {
      const scope = raycastStats.enter('routeGrid');
      try {
        return this.tilesEngine!.terrain.sampleColumn(x, z);
      } finally {
        raycastStats.exit(scope);
      }
    };
    // Cheap LOD-probe used by the route-grid full-sweep to skip stable
    // cells whose tile-LOD has not improved (Option C, perf/route-grid-
    // tile-aware-update).
    const terrainPeekLOD = (x: number, z: number) =>
      this.tilesEngine!.terrain.peekBestTileLODAtLocal(x, z);
    this.globalRouteGrid.initialize(
      columnSampler,
      this.tilesEngine.sync,
      terrainPeekLOD,
    );

    // Generate cells from routes
    const routes = this.getCachedRoutes();
    // Fine tiles along the whole corridor, so the cells sample real ground
    // even where the camera does not look.
    if (region) this.tilesEngine.setRouteCorridor(routes);
    if (routes.length > 0) {
      this.globalRouteGrid.generateFromRoutes(routes);
    }

    // New routes enter the towers' ranges elsewhere.
    this.towerLifecycle.refreshGuardHeadings();
  }

  /**
   * Get GlobalRouteGrid service (for visualization access)
   */
  getGlobalRouteGrid(): GlobalRouteGridService {
    return this.globalRouteGrid;
  }

  /**
   * Calculate defense reach percent — delegates to GlobalRouteGridService.
   * @see GlobalRouteGridService.getDefenseReachPercent
   */
  getDefenseReachPercent(): number {
    return this.globalRouteGrid.getDefenseReachPercent(this.getCachedRoutes());
  }

  /**
   * Get EventBus for external subscriptions (e.g., game:over in UI components)
   */
  getEventBus(): GameEventBus {
    return this.eventBus;
  }

  /**
   * Get spawn points for bot/AI use
   */
  getSpawnPoints(): SpawnPoint[] {
    return this.waveManager.spawnPoints;
  }

  /**
   * Get cached paths for bot/AI use
   */
  getCachedPaths(): Map<string, GeoPosition[]> {
    return this.pathRouteService.getCachedPaths();
  }

  /**
   * Set training mode timescale
   * @param scale Timescale multiplier (1.0 = normal, 75.0 = 75x speed)
   * @param persist Whether to save to localStorage (default: true, set to false for automatic backend settings)
   */
  setTrainingTimescale(scale: number, persist = true): void {
    const clamped = Math.max(0.1, Math.min(75, scale));
    this.trainingTimescale.set(clamped);
    // Also update the global store so UI components stay in sync
    this.gameStore.trainingTimescale.set(clamped);
    if (persist) {
      localStorage.setItem('training-timescale', clamped.toString());
    }
  }
}
