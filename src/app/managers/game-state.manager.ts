import { Injectable, inject, signal, computed, effect } from '@angular/core';
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
import { OsmStreetService, StreetNetwork } from '../services/location/osm-street.service';
import { WaveDebugService } from '../services/debug/wave-debug.service';
import { EnemyDebugService } from '../services/debug/enemy-debug.service';
import { MarkerVisualizationService } from '../services/world/marker-visualization.service';
import { TowerPlacementService } from '../services/tower-placement.service';
import { GeoPosition } from '../models/game.types';
import { GameObject } from '../core/game-object';
import { ENEMY_TYPES } from '../configs/enemy-types.config';
import { TowerTypeId, TOWER_TYPES } from '../configs/tower-types.config';
import { GAME_BALANCE } from '../configs/game-balance.config';
import { TIMING } from '../configs/timing.config';
import { Tower } from '../entities/tower.entity';
import { METERS_PER_DEGREE_LAT, DEG_TO_RAD } from '../utils/geo-utils';
import { EconomyService } from '../services/economy.service';
import { GameCommandsHandler } from './game-commands.handler';
import { ThreeTilesEngine } from '../three-engine';
import { GameEventBus, IGameManager, VFXService, AudioService, ScreenShakeService, BackgroundMusicService, SubscriptionBag } from '../game-engine';
import { PerformanceProfilerService } from '../services/debug/performance-profiler.service';
import { ResearchManager } from './research.manager';
import { ResearchStore } from '../store/research.store';

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
  private readonly osmService = inject(OsmStreetService);
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
  private readonly researchStore = inject(ResearchStore);
  readonly towerManager = (() => {
    const mgr = new TowerManager(this.eventBus, this.osmService, this.researchStore);
    mgr.setGlobalRouteGrid(this.globalRouteGrid);
    return mgr;
  })();
  readonly enemyManager = new EnemyManager(this.eventBus, this.globalRouteGrid, this.spatialGrid);
  readonly projectileManager = new ProjectileManager(this.eventBus);
  readonly waveManager = new WaveManager(this.eventBus, this.enemyManager);
  readonly researchManager = new ResearchManager(this.eventBus);

  /**
   * Canonical list of sub-managers that implement IGameManager. Used for the
   * polymorphic teardown loop in dispose() — destroy() is parameterless and
   * is therefore the only lifecycle call that iterates cleanly off this array.
   *
   * initialize(), reset() and the per-frame update() sequence stay hardcoded
   * on purpose and are deliberately NOT driven off this array:
   *  - initialize(): every manager takes a different signature (TowerManager
   *    uses initializeWithContext(), WaveManager takes spawnPoints + paths,
   *    EnemyManager needs follow-up provider wiring, ResearchManager has no
   *    lifecycle initialize at all). A uniform forEach would require unsafe
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
  ];

  // Game state signals
  readonly baseHealth = signal<number>(GAME_BALANCE.player.startHealth);
  readonly credits = signal<number>(GAME_BALANCE.player.startCredits);
  /** Game over screen signal - delegated to HQDamageService */
  readonly showGameOverScreen = computed(() => this.hqDamage.showGameOverScreen());

  /** Training mode timescale (1.0 = normal, 3.0 = 3x speed) */
  readonly trainingTimescale = signal<number>(1.0);

  /** Command-Bus-Adapter — registriert sich bei initialize(). */
  private commandsHandler: GameCommandsHandler | null = null;

  /** Sync timescale from GameStore (UI source of truth) → local signal */
  private readonly timescaleSyncEffect = effect(() => {
    const storeValue = this.gameStore.trainingTimescale();
    this.trainingTimescale.set(storeValue);
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
  readonly towerCount = computed(() => this.towerManager.getAll().length);
  readonly enemiesAlive = computed(() => this.enemyManager.aliveCount());
  readonly selectedTowerId = computed(() => this.towerManager.getSelectedId());
  readonly selectedTower = computed(() => this.towerManager.getSelected());

  // Engine reference (public so visual hooks like turret-aim can access it).
  tilesEngine: ThreeTilesEngine | null = null;
  private lastUpdateTime = 0;
  private basePosition: GeoPosition | null = null;

  // ──────────────────────────────────────────────────────────────────
  // Game-Clock — single source of truth for ALL gameplay timing.
  // Advances by FIXED_STEP_MS per sub-step. Sub-stepping ensures the
  // simulation runs identically at every training timescale: at 75× a
  // single render-frame splits into ~75 sub-steps, each behaving like
  // one 1× tick. No /timescale compensation anywhere.
  // ──────────────────────────────────────────────────────────────────
  private _gameTimeMs = 0;
  private subStepRemainderMs = 0;
  /** Fixed game-time per sub-step (~60Hz game-time granularity). */
  private static readonly FIXED_STEP_MS = 16.667;
  /** Max sub-steps per real-frame. At 75× training and 10fps real-time
   *  we need ~450 sub-steps to keep up; 600 gives headroom for heavier
   *  scenes before the simulation falls behind wall-clock-timescale. */
  private static readonly MAX_SUBSTEPS_PER_FRAME = 600;
  /** Cap on unprocessed game-time debt. Without a cap, frame-drops cause
   *  `subStepRemainderMs` to grow unboundedly — the sim trails further
   *  behind every frame and never catches up. Capping at one real-frame
   *  worth of timescale lets spikes recover but bounds the debt. */
  private static readonly MAX_REMAINDER_MS = 2000;

  /** Read-only access to the game-clock for any consumer that needs
   *  game-time (status effects, sleep checks, AI bot ticks, etc). */
  get gameTimeMs(): number {
    return this._gameTimeMs;
  }

  // Performance profiler (optional, set via setProfiler())
  private profiler: PerformanceProfilerService | null = null;

  /** EventBus subscription bag — cleaned up in initialize() (re-init) and dispose() */
  private readonly eventBusSubs = new SubscriptionBag();

  /**
   * Set performance profiler for frame timing instrumentation.
   */
  setProfiler(profiler: PerformanceProfilerService | null): void {
    this.profiler = profiler;
  }

  /**
   * Initialize game state with ThreeTilesEngine
   */
  initialize(
    tilesEngine: ThreeTilesEngine,
    streetNetwork: StreetNetwork,
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
    // Dispose previous command-bus adapter — otherwise its subscriptions on
    // command:* / debug:* events stack on top of the new handler below,
    // causing every command (place-tower, sell-tower, restart-game, …) to
    // run N times after N in-app location changes. This was the cause of
    // duplicate tower placements + duplicate placement sounds, which in
    // turn left half the towers stuck at losReady=false because
    // pendingTowerReg is a single slot and gets overwritten by the second
    // placeTower call.
    this.commandsHandler?.dispose();

    this.tilesEngine = tilesEngine;
    this.basePosition = basePosition;

    // Initialize defense-reach debug visualization (orange marker)
    this.globalRouteGrid.initDebugViz(tilesEngine.getScene());

    // Initialize entity managers (no callbacks - use events)
    this.enemyManager.initialize(tilesEngine);
    // Wire wave-number + wave-size providers for the kill-reward formula
    this.enemyManager.setWaveNumberProvider(() => this.waveManager.waveNumber());
    this.enemyManager.setWaveSizeProvider(() => this.waveManager.getExpectedEnemyCount());

    this.towerManager.initializeWithContext(
      tilesEngine,
      streetNetwork,
      basePosition,
      spawnPoints.map((s) => ({ lat: s.lat, lon: s.lon }))
    );
    this.towerManager.setActiveRoutesGetter(() =>
      Array.from(this.pathRouteService.getCachedPaths().values())
    );

    // Wire the engine game-clock into StatusEffectService (breaks DI cycle —
    // StatusEffectService can't directly inject GameStateManager).
    this.statusEffectService.setGameClockProvider(() => this._gameTimeMs);

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

    // Initialize Audio service (subscribes to audio events)
    this.audioService = new AudioService(this.eventBus, tilesEngine);

    // Initialize Screen Shake service (subscribes to explosion/impact events)
    this.screenShakeService = new ScreenShakeService(this.eventBus, tilesEngine);

    // Initialize Background Music service (subscribes to wave/game events)
    this.backgroundMusic = new BackgroundMusicService(this.eventBus, tilesEngine);

    // Register event handlers (tracked via SubscriptionBag for cleanup in reset())
    this.eventBusSubs.add(this.eventBus.on('enemy:reached-base', (event) => {
      const oldHealth = this.baseHealth();
      const newHealth = Math.max(0, oldHealth - event.damage);
      this.baseHealth.set(newHealth);

      // Emit health:changed - HQDamageService subscribes
      this.eventBus.emit({
        type: 'health:changed',
        health: newHealth,
        delta: newHealth - oldHealth,
      });
    }));

    this.eventBusSubs.add(this.eventBus.on('enemy:died', (event) => {
      if (event.credits > 0) {
        this.updateCredits(event.credits);

        // Show reward popup with actual dynamic credits (not static typeConfig.reward)
        if (this.tilesEngine) {
          this.tilesEngine.effects.spawnFloatingText(
            `+${event.credits}`,
            event.enemy.position.lat,
            event.enemy.position.lon,
            event.enemy.transform.terrainHeight + (event.enemy.typeConfig.heightOffset ?? 0) + 5,
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
    const frameStart = performance.now();
    const profiling = this.profiler !== null;

    const rawDeltaTime = this.lastUpdateTime ? currentTime - this.lastUpdateTime : 16;
    this.lastUpdateTime = currentTime;

    const timescale = this.trainingTimescale();
    const frameGameTimeMs = rawDeltaTime * timescale;

    // Sync timescale to renderer (turret-pulse / hover / shader-time only —
    // gameplay rotation now flows through sub-step game-time).
    this.tilesEngine?.setTimescale(timescale);

    // ══════════════════════════════════════════════════════════════
    // SUB-STEP LOOP (gameplay)
    // ══════════════════════════════════════════════════════════════
    // Cap accumulated game-time so a slow real-frame (heavy rendering /
    // massive waves) doesn't grow the sim debt without bound. Excess is
    // dropped — simulation stays ≤ MAX_REMAINDER_MS behind wall-clock
    // × timescale but never more.
    let pendingMs = this.subStepRemainderMs + frameGameTimeMs;
    const maxBudget =
      GameStateManager.MAX_SUBSTEPS_PER_FRAME * GameStateManager.FIXED_STEP_MS
      + GameStateManager.MAX_REMAINDER_MS;
    if (pendingMs > maxBudget) pendingMs = maxBudget;
    let stepsExecuted = 0;
    let tProjectile = 0, tCombat = 0, tEvents = 0, tTower = 0;

    while (
      pendingMs >= GameStateManager.FIXED_STEP_MS &&
      stepsExecuted < GameStateManager.MAX_SUBSTEPS_PER_FRAME
    ) {
      const stepMs = GameStateManager.FIXED_STEP_MS;
      const step = this.runSubStep(stepMs, profiling);
      tProjectile += step.tProjectile;
      tCombat += step.tCombat;
      tEvents += step.tEvents;
      tTower += step.tTower;

      // Notify per-sub-step listeners (AI bot, etc.)
      onSubStep?.(stepMs);

      pendingMs -= stepMs;
      stepsExecuted++;

      // Wave-completion / game-over checks belong INSIDE the sub-step loop
      // so they catch state transitions mid-frame (otherwise a wave might
      // visibly run for "one extra frame" at high timescales).
      const isWavePhase = this.waveManager.phase() === 'wave';
      if (isWavePhase && this.waveManager.checkWaveComplete()) {
        const result = this.waveManager.endWave();
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
    this.subStepRemainderMs = pendingMs;

    // ══════════════════════════════════════════════════════════════
    // ONCE PER RENDER-FRAME (visuals + UI sync)
    // ══════════════════════════════════════════════════════════════

    // Sync active research progress to store for UI (cheap, batched once/frame)
    if (this.researchManager.usedSlots > 0) {
      this.researchStore.activeResearches.set(this.researchManager.getActiveResearches());
    }

    // Tower idle-rotation visual (smooth return) when no combat is running
    const isWavePhase = this.waveManager.phase() === 'wave';
    const hasDebugEnemies = this.enemyDebug.debugEnemies().length > 0;
    if (!(isWavePhase || hasDebugEnemies)) {
      this.towerCombat.updateTowerIdleRotations(this.towerManager);
    }

    if (profiling) {
      this.profiler!.accumulateFrameTiming(
        tTower, tProjectile, tCombat, tEvents,
        performance.now() - frameStart,
        stepsExecuted,
      );
    }
  }

  /**
   * Execute one fixed game-time sub-step. Called repeatedly from update()
   * so the simulation always runs at ~60Hz game-time regardless of timescale.
   */
  private runSubStep(stepMs: number, profiling: boolean): {
    tProjectile: number; tCombat: number; tEvents: number; tTower: number;
  } {
    this._gameTimeMs += stepMs;

    let t0 = profiling ? performance.now() : 0;
    this.projectileManager.update(stepMs);
    const tProjectile = profiling ? performance.now() - t0 : 0;

    this.researchManager.update(stepMs);

    t0 = profiling ? performance.now() : 0;
    this.eventBus.processQueue();
    const tEvents = profiling ? performance.now() - t0 : 0;

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
    this.enemyManager.update(stepMs, this._gameTimeMs);

    let tCombat = 0;
    if (shouldRunCombat) {
      t0 = profiling ? performance.now() : 0;
      this.towerCombat.updateTowerShooting(
        this._gameTimeMs,
        stepMs,
        this.towerManager,
        this.enemyManager,
        this.projectileManager,
      );
      this.towerCombat.updateBeamTowers(
        stepMs,
        this.towerManager,
        this.enemyManager,
      );
      this.towerCombat.updateMeleeTowers(
        stepMs,
        this.towerManager,
        this.enemyManager,
        this._gameTimeMs,
      );
      this.towerCombat.updateChainTowers(
        stepMs,
        this.towerManager,
        this.enemyManager,
        this._gameTimeMs,
      );
      tCombat = profiling ? performance.now() - t0 : 0;
    }

    return { tProjectile, tCombat, tEvents, tTower: 0 };
  }

  /**
   * Trigger game over state
   */
  private triggerGameOver(): void {
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
    // Update wave preview in sidebar with actual values (NOT timescaled).
    // Aggregate schedule entries by enemy type so the sidebar shows the
    // composition the player is about to face.
    const entries = config.schedule.entries;
    if (entries.length > 0) {
      const groupMap = new Map<string, { count: number; health: number; speed: number }>();
      for (const e of entries) {
        const existing = groupMap.get(e.enemyType);
        if (existing) {
          existing.count++;
        } else {
          groupMap.set(e.enemyType, { count: 1, health: e.health ?? 0, speed: e.speed });
        }
      }

      const groups = Array.from(groupMap.entries()).map(([typeId, data]) => {
        const enemyConfig = ENEMY_TYPES[typeId as keyof typeof ENEMY_TYPES];
        const baseHp = enemyConfig.baseHp;
        const baseSpeed = enemyConfig.baseSpeed;
        const actualHp = data.health || baseHp;
        const actualSpeed = data.speed;
        return {
          enemyType: typeId as keyof typeof ENEMY_TYPES,
          name: enemyConfig.name,
          count: data.count,
          baseHp,
          actualHp,
          baseSpeed,
          actualSpeed,
          healthMultiplier: actualHp / baseHp,
          speedMultiplier: actualSpeed / baseSpeed,
          spawnDelay: config.schedule.baseDelay,
        };
      });

      this.waveDebug.setCurrentWaveGroups(groups);
    }

    const isFirstWave = this.waveManager.waveNumber() === 0;

    // Emit lifecycle event BEFORE startWave() so that AIDataCollector.clearHistory()
    // runs before wave:started sets up tracking (prevents NaN in wave history)
    if (isFirstWave) {
      this.eventBus.emit({ type: 'game:started' });
    }

    this.waveManager.startWave(config);
  }

  /**
   * Begin wave phase without auto-spawning
   */
  beginWave(): void {
    const isFirstWave = this.waveManager.waveNumber() === 0;

    // Emit lifecycle event BEFORE beginWave() so that AIDataCollector.clearHistory()
    // runs before wave:started sets up tracking (prevents NaN in wave history)
    if (isFirstWave) {
      this.eventBus.emit({ type: 'game:started' });
    }

    this.waveManager.beginWave();
  }

  /**
   * Heal base to full health
   */
  healBase(): void {
    this.baseHealth.set(GAME_BALANCE.player.startHealth);
    this.hqDamage.healBase();
  }

  /**
   * Full dispose — called when the component is destroyed.
   * Cleans up EventBus subscriptions that were registered in initialize().
   */
  dispose(): void {
    this.eventBusSubs.disposeAll();
    this.commandsHandler?.dispose();
    this.commandsHandler = null;

    // Destroy game-engine service instances (they hold EventBus subscriptions)
    this.combatEffect.destroy();
    this.vfxService?.destroy();
    this.audioService?.destroy();
    this.screenShakeService?.destroy();
    this.backgroundMusic?.destroy();

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
    this.clearAllTowerOverlays();

    // Stop all active beams/melee before clearing towers
    this.towerCombat.stopAllBeams();
    this.towerCombat.stopAllMelee();

    this.enemyManager.clear();
    this.enemyDebug.clearDebugEnemies(); // Clear orphaned debug enemy references
    this.towerManager.clear();
    this.projectileManager.clear();
    this.waveManager.reset();
    this.researchManager.reset();

    // NOTE: Do NOT clear GlobalRouteGrid here — it's bound to the location
    // and won't be re-initialized on a game-over restart. Tower visibility
    // has already been cleaned up per-tower via clearAllTowerOverlays above.

    if (this.tilesEngine) {
      this.tilesEngine.effects.clear();
    }

    this.baseHealth.set(GAME_BALANCE.player.startHealth);
    this.updateCredits(GAME_BALANCE.player.startCredits - this.credits());
    this.lastUpdateTime = 0;
    this._gameTimeMs = 0;
    this.subStepRemainderMs = 0;
    this.economy.reset();

    GameObject.resetIdCounter();

    // Emit game:reset so downstream services (e.g. GameStateSyncService) can react
    this.eventBus.emit({ type: 'game:reset' });
  }

  private updateCredits(delta: number): void {
    const newCredits = this.credits() + delta;
    this.credits.set(newCredits);
    this.eventBus.emit({
      type: 'credits:changed',
      credits: newCredits,
      delta,
    });
  }

  /** Apply Wave-Completion-Bonus via EconomyService (delegates the math). */
  private applyWaveCompletionBonus(result: { wave: number; perfect: boolean; closeCall: boolean; hpLost: number }): void {
    const total = this.economy.computeWaveCompletionBonus(result);
    this.updateCredits(total);
  }

  /** Add credits to the player account (delta). Public for GameCommandsHandler. */
  addCredits(amount: number): void {
    this.updateCredits(amount);
  }

  /**
   * After a range-stat upgrade (manual or debug-max-upgrade), refresh the
   * tower's LOS cells, geo-degree-squared range cache, and visual range disc.
   * Pulled out of the upgrade-handler so the command handler can call it.
   */
  recomputeTowerRangeAfterUpgrade(tower: Tower): void {
    this.towerPlacement.recomputeTowerLOS(tower);
    const pos = tower.position;
    const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos(pos.lat * DEG_TO_RAD);
    const avgMetersPerDegree = (METERS_PER_DEGREE_LAT + metersPerDegreeLon) / 2;
    const rangeInDegrees = tower.combat.range / avgMetersPerDegree;
    tower.rangeSquaredGeo = rangeInDegrees * rangeInDegrees;
    this.tilesEngine?.towers.updateRangeIndicatorTerrain(tower.id, tower.combat.range);
  }

  /**
   * Clear all tower overlays (LOS visualizations + GlobalRouteGrid registrations)
   * Called on reset to cleanup before starting fresh
   */
  private clearAllTowerOverlays(): void {
    // First deselect any selected tower (hides its LOS visualization)
    this.towerManager.selectTower(null);

    // Delegate to TowerPlacementService
    this.towerPlacement.clearAllTowerOverlays(this.towerManager.getAll());
  }

  /**
   * Sell a tower and refund 50% of its cost
   */
  sellTower(tower: Tower): number {
    // Unregister from grid + dispose LOS visualization
    this.towerPlacement.unregisterTowerFromGrid(tower);

    this.towerManager.selectTower(null);

    // Stop flame beam if fire tower
    if (tower.typeConfig.id === 'fire') {
      this.towerCombat.stopTowerBeam(tower.id);
    }

    // Notify ResearchManager when Research Center is sold
    if (tower.typeConfig.id === 'research-center') {
      this.researchManager.onCenterRemoved();
    }

    // Sell tower (emits tower:sold event, returns refund)
    const refund = this.towerManager.sell(tower);
    this.updateCredits(refund);
    return refund;
  }

  /**
   * Spend credits (for upgrades etc.)
   * @returns true if credits were spent, false if not enough
   */
  spendCredits(amount: number): boolean {
    if (this.credits() < amount) return false;
    this.updateCredits(-amount);
    return true;
  }

  /**
   * Place a new tower
   * @param position Geo position
   * @param typeId Tower type ID
   * @param customRotation Custom rotation set by user (radians)
   */
  placeTower(position: GeoPosition, typeId: TowerTypeId = 'archer', customRotation = 0): Tower | null {
    const config = TOWER_TYPES[typeId];
    if (!config) return null;

    // Research-gate: tower must be unlocked. Defense-in-depth against bots
    // or commands that bypass the UI's isTowerUnlocked() check.
    if (!this.researchStore.isTowerUnlocked(typeId)) {
      return null;
    }

    // Research Center: only one allowed
    if (typeId === 'research-center') {
      const existing = this.towerManager.getAll().find(t => t.typeConfig.id === 'research-center');
      if (existing) return null;
    }

    // Check if player has enough credits
    if (this.credits() < config.cost) {
      return null;
    }

    const tower = this.towerManager.placeTower(position, typeId, customRotation);

    if (tower) {
      // Deduct cost
      this.updateCredits(-config.cost);

      // Register tower on grid (LOS raycasting + grid registration + visualization)
      // Skip grid registration for passive buildings (no targeting/LOS needed)
      if (config.attackType !== 'passive') {
        this.towerPlacement.registerTowerOnGrid(tower, position, typeId);
      }

      // Notify ResearchManager when Research Center is placed
      if (typeId === 'research-center') {
        this.researchManager.onCenterPlaced();
      }
    }
    return tower;
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
  getCachedRoutes(): GeoPosition[][] {
    return Array.from(this.pathRouteService.getCachedPaths().values());
  }

  /**
   * Initialize GlobalRouteGrid after routes are computed
   * Should be called after engine and routes are ready
   */
  initializeGlobalRouteGrid(): void {
    if (!this.tilesEngine) {
      console.warn('[GameStateManager] Cannot initialize GlobalRouteGrid - no engine');
      return;
    }

    // One terrain probe for the grid: ground plus the tile LOD it came from,
    // which `sampleCellY` uses so a coarse streaming pass cannot overwrite a
    // finer sample. The engine caches per column, so repeated cells are free.
    const columnSampler = (x: number, z: number) => this.tilesEngine!.sampleColumn(x, z);
    // Cheap LOD-probe used by the route-grid full-sweep to skip stable
    // cells whose tile-LOD has not improved (Option C, perf/route-grid-
    // tile-aware-update).
    const terrainPeekLOD = (x: number, z: number) =>
      this.tilesEngine!.peekBestTileLODAtLocal(x, z);
    this.globalRouteGrid.initialize(
      columnSampler,
      this.tilesEngine.sync,
      terrainPeekLOD,
    );

    // Generate cells from routes
    const routes = this.getCachedRoutes();
    if (routes.length > 0) {
      this.globalRouteGrid.generateFromRoutes(routes);
    }
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
