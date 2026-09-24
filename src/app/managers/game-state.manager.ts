import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { Vector3 } from 'three';
import { EnemyManager } from './enemy.manager';
import { TowerManager } from './tower.manager';
import { ProjectileManager } from './projectile.manager';
import { WaveManager, SpawnPoint, WaveConfig, laneSchedule } from './wave.manager';
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
import { GameEventBus, IGameManager, VFXService, AudioService, GameSoundsService, ScreenShakeService, BackgroundMusicService, BloodMoonService, SubscriptionBag } from '../game-engine';
import { PerformanceProfilerService } from '../services/debug/performance-profiler.service';
import { ResearchManager, type SimResearch } from './research.manager';
import { LOCAL_OWNER, type PlayerOwner } from './game-state/player-owner';
import { AbilityManager } from './ability.manager';
import { HeroManager, type HeroView } from './hero.manager';
import { HERO_SOURCE_ID, heroSourceIdFor } from '../configs/hero.config';
import { heroBodyContact } from '../utils/hero-body-contact';
import { ResearchStore } from '../store/research.store';
import { GameClock } from './game-state/game-clock';
import { GameRng } from '../utils/game-rng';
import type { CreditsSource, KilledBy, LosResolveReason, WaveGoldBreakdown } from '../game-engine/game-event-bus';
import { waveGoldTotal } from '../services/economy.service';
import { CreditsLedger } from './game-state/credits-ledger';
import { BaseHealthLedger } from './game-state/base-health-ledger';
import { TowerLifecycle } from './game-state/tower-lifecycle';
import { CommandLog, LOCAL_PLAYER_ID, toPlainData, type CommandLogEntry } from './game-state/command-log';
import { summarizeWaveGroups } from './game-state/wave-preview';
import { routeSweepToward } from '../utils/route-sweep';
import { SimRecorder } from '../simulator/sim-recorder';
import { StateHasher, type StateHashSource } from '../simulator/state-hash';
import { SIM_SNAPSHOT_VERSION, type SavedTower, type SimSnapshot, type SnapshotRefusal } from '../simulator/sim-snapshot';
import type { ResimHost } from '../simulator/resimulation';
import { losMaskFromJson, losMaskToJson, type LosMask, type LosMaskJson } from '../utils/los-mask';
import { fnv1a } from '../utils/fnv1a';
import { clearStrikeEffects } from '../three-engine/strike-effects';
import { stepTowerAim } from '../entities/tower-aim';
import { tickAtBoundary, tickNeededAfter, type LockstepLink } from '../coop/lockstep';
import type { WorldSource } from '../coop/world-package';
import { OWNER_ONLY, type TowerPolicy } from '../coop/tower-policy';

/**
 * Main game state orchestrator - coordinates all entity managers
 *
 * Handles game lifecycle, wave progression, and provides a unified API
 * for the game component to interact with.
 */
/** A player's research and their credits for its queue, see GameStateManager.researchSeats */
interface ResearchSeat {
  research: ResearchManager;
  credits: () => number;
  spend: (cost: number) => boolean;
}

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
  private gameSounds: GameSoundsService | null = null;
  screenShakeService!: ScreenShakeService;
  backgroundMusic!: BackgroundMusicService;
  private bloodMoonService: BloodMoonService | null = null;
  private readonly researchStore = inject(ResearchStore);
  /**
   * One research per player (docs/COOP_PLAN.md, D20), in roster order, each
   * with its credits bound once for the queue that runs every sub-step
   * (ResearchManager.startQueued). The single player game has one.
   */
  private readonly researchSeats: ResearchSeat[] = [this.researchSeat(LOCAL_PLAYER_ID, LOCAL_OWNER)];
  /** What the towers and combat read: air targeting of a tower's owner */
  private readonly simResearch: SimResearch = {
    airTargetingFor: (playerId) => this.researchOf(playerId).airTargetingUnlocked,
  };
  readonly towerManager = (() => {
    const mgr = new TowerManager(this.eventBus, this.simResearch);
    mgr.setGlobalRouteGrid(this.globalRouteGrid);
    return mgr;
  })();
  readonly enemyManager = new EnemyManager(this.eventBus, this.globalRouteGrid, this.spatialGrid);
  readonly projectileManager = new ProjectileManager(this.eventBus);
  readonly waveManager = new WaveManager(this.eventBus, this.enemyManager);
  /**
   * One set of abilities per player (docs/COOP_PLAN.md, D11), in roster
   * order: charges, strikes, the player's own launch site. The single player
   * game has one.
   */
  private readonly abilitySeats: AbilityManager[] = [this.abilitiesFor(LOCAL_OWNER)];

  /** The abilities of `owner` on this game's world: their launch site, their kills. */
  private abilitiesFor(owner: PlayerOwner): AbilityManager {
    return new AbilityManager(this.eventBus, {
      launchSite: (typeId) => {
        const tower = this.towerManager.getAll().find((t) => t.typeConfig.id === typeId && t.ownerId === owner.playerId);
        return tower ? { towerId: tower.id, position: tower.position } : null;
      },
      snapToRoute: (target, maxDistanceM) => this.globalRouteGrid.snapToRouteCell(target, maxDistanceM),
      enemiesInRadius: (center, radiusM, out) =>
        this.globalRouteGrid.getEnemiesInRadiusGeo(center, radiusM, undefined, out),
      strike: (targets, fractionOf) => this.combatEffect.applyAbilityStrike(targets, fractionOf, owner.playerId),
      showDamage: (enemy, fraction, damageType) => this.combatEffect.showAbilityDamage(enemy, fraction, damageType),
      halt: (targets, status, durationMsOf, sourceId) =>
        this.combatEffect.applyAbilityHalt(targets, status, durationMsOf, sourceId),
      routeSweep: (target, maxDistanceM, lengthM) =>
        routeSweepToward(this.waveManager.getPaths(), target, maxDistanceM, lengthM),
    }, owner);
  }

  /** The abilities of `playerId`; a player not in the run reads as the first one. */
  abilityOf(playerId: string): AbilityManager {
    for (const seat of this.abilitySeats) if (seat.owner.playerId === playerId) return seat;
    return this.abilitySeats[0];
  }

  /** The abilities of the player at this client, the ones the UI shows. */
  get abilityManager(): AbilityManager {
    return this.abilityOf(this.localPlayerId);
  }

  /** A strike of any player is still on its way or burning. */
  private hasPendingStrikes(): boolean {
    return this.abilitySeats.some((seat) => seat.hasPendingStrikes());
  }
  // The hero's measure on bodies along the route (HeroWorld.bodyContact)
  private readonly heroLocal = new Vector3();
  private readonly routeGroundY = (x: number, z: number): number | null => this.globalRouteGrid.getGroundLocalYAt(x, z);
  /**
   * The heroes, one per player (docs/COOP_PLAN.md, D10), in roster order.
   * Each has its own id, so nothing stops a player from having several.
   */
  private readonly heroSeats: HeroManager[] = [this.heroFor(LOCAL_OWNER, HERO_SOURCE_ID)];

  /** A hero of `owner` on this game's world: their credits, shots under `heroId`. */
  private heroFor(owner: PlayerOwner, heroId: string): HeroManager {
    return new HeroManager(this.eventBus, {
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
          shot.ammo.projectileType, shot.damage, shot.ammo.damageType, heroId,
          shot.aimPoint ?? undefined,
        );
      },
      spend: (cost) => this.creditsLedger.spend(cost, 'hero', owner.playerId),
    }, owner, heroId);
  }

  /** The (first) hero of `playerId`; a player not in the run reads as the first one. */
  heroOf(playerId: string): HeroManager {
    for (const seat of this.heroSeats) if (seat.owner.playerId === playerId) return seat;
    return this.heroSeats[0];
  }

  /** The hero of the player at this client, the one the UI shows. */
  get heroManager(): HeroManager {
    return this.heroOf(this.localPlayerId);
  }

  /** Where the hero of the player at this client is drawn; the others have none yet (COOP_PLAN C6) */
  private heroView: HeroView | null = null;

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
  ];

  // Game state signals, owned by their ledgers
  private readonly healthLedger = new BaseHealthLedger(this.eventBus);
  readonly baseHealth = this.healthLedger.baseHealth;
  private readonly creditsLedger = new CreditsLedger(this.eventBus);
  readonly credits = this.creditsLedger.credits;

  /** Place, sell and upgrade rules, range refresh and guard heading of the towers */
  private readonly towerLifecycle = new TowerLifecycle(
    this.towerManager,
    (playerId: string) => this.researchOf(playerId),
    (playerId: string) => this.abilityOf(playerId),
    this.waveManager,
    this.enemyManager,
    this.towerPlacement,
    this.towerCombat,
    this.creditsLedger,
    this.eventBus,
    () => this.tilesEngine,
    () => this.corridorPending(),
    () => this.actingPlayerId,
  );
  /** Game over screen signal - delegated to HQDamageService */
  readonly showGameOverScreen = computed(() => this.hqDamage.showGameOverScreen());

  /** Training mode timescale (1.0 = normal, 3.0 = 3x speed) */
  readonly gameSpeed = signal<number>(1.0);

  /** Command-Bus-Adapter — registriert sich bei initialize(). */
  private commandsHandler: GameCommandsHandler | null = null;

  /** Coop: the relay link, see setLockstep(); null in the single player game */
  private lockstep: LockstepLink | null = null;
  /** Coop: the last tick whose commands ran */
  private lockstepTickRun = -1;

  /**
   * A wave has started in this run; `game:started` goes out before the first.
   * Not read off the counter: the dev wave jump moves it before any wave ran.
   */
  private runStarted = false;

  /** Sync timescale from GameStore (UI source of truth) → local signal */
  private readonly timescaleSyncEffect = effect(() => {
    const storeValue = this.gameStore.gameSpeed();
    this.gameSpeed.set(storeValue);
  });

  /** Game time stands still, see GameStore.paused. */
  readonly paused = signal<boolean>(false);

  /** Sync pause from GameStore (UI source of truth) → local signal */
  private readonly pauseSyncEffect = effect(() => {
    const paused = this.gameStore.paused();
    this.paused.set(paused);
    // No sub-step runs while paused; every loop (walk cycles, flames, the
    // ooze's bubbling) stands with the game, except in the boss intro
    this.tilesEngine?.spatialAudio.holdLoops(paused && !this.gameStore.pauseKeepsLoops());
    // The music goes down in the pause, not in the boss intro's
    this.backgroundMusic?.setDimmed(paused && !this.gameStore.pauseKeepsLoops());
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

  /**
   * The run's random source. One seed per run, one stream per system, so a
   * different bot decision cannot shift the enemies (BALANCING_PLAN.md,
   * section 5). Reset gives the next run a fresh seed.
   */
  readonly rng = new GameRng();

  /** Read-only access to the game-clock for any consumer that needs
   *  game-time (status effects, sleep checks, AI bot ticks, etc). */
  get gameTimeMs(): number {
    return this.clock.gameTimeMs;
  }

  /** Sub-steps since the run started; the stamp for every logged command. */
  get subStep(): number {
    return this.clock.subStep;
  }

  /**
   * Every command of the run with the sub-step boundary it took effect at,
   * written by the GameCommandsHandler (docs/EVENT_SYSTEM.md). Cleared with
   * a new run, a new place and a new DevWorld.
   */
  readonly commandLog = new CommandLog(() => this.clock.subStep);

  /**
   * Every wave of the run as a re-simulation needs it: the snapshot at its
   * start, its config, where its inputs start in the command log, the state
   * hashes along the way (docs/SIMULATOR_PLAN.md, P4 and P5).
   */
  readonly simRecorder = new SimRecorder();

  /** Re-simulating a wave (setReplayMode): the log only, masks from the log, nothing recorded */
  private replaying = false;
  /** What the re-simulation logs, so the run's own log stays as it was */
  private replayLog: CommandLog | null = null;
  /** A replay re-simulates a wave: the live clock stands, what reads it waits (auto start, run log) */
  get isReplaying(): boolean {
    return this.replaying;
  }

  /** See ResimHost.setBoundaryListener */
  private boundaryListener: ((boundaryStep: number, hash: () => number) => void) | null = null;

  private readonly stateHasher = new StateHasher();
  private readonly hashSource: StateHashSource = {
    subStep: () => this.clock.subStep,
    credits: () => this.creditsLedger.balances(),
    baseHealth: () => this.baseHealth(),
    waveNumber: () => this.waveManager.waveNumber(),
    idCounter: () => GameObject.getIdCounter(),
    rngState: () => this.rng.getState(),
    enemies: () => this.enemyManager.getAll(),
    towers: () => this.towerManager.getAll(),
    projectiles: () => this.projectileManager.getAll(),
    heroes: () => this.heroSeats.map((seat) => seat.getHero()),
  };
  /** The state hash now (StateHasher), for the recorder and the re-simulation */
  readonly stateHash = (): number => this.stateHasher.hash(this.hashSource);

  /**
   * Execute a logged command again, the same way as the live one (boundary,
   * log, handler). For a re-simulation that has reached `entry.step`.
   */
  replayCommand(entry: CommandLogEntry): void {
    this.commandsHandler?.replay(entry);
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

  /** A player's research with its credits bound once, see researchSeats */
  private researchSeat(playerId: string, owner: PlayerOwner): ResearchSeat {
    return {
      research: new ResearchManager(this.eventBus, owner),
      credits: () => this.creditsLedger.balance(playerId),
      spend: (cost) => this.creditsLedger.spend(cost, 'research', playerId),
    };
  }

  /** The research of `playerId`; a player not in the run reads as the first one. */
  researchOf(playerId: string): ResearchManager {
    for (const seat of this.researchSeats) if (seat.research.owner.playerId === playerId) return seat.research;
    return this.researchSeats[0].research;
  }

  /** The research of the player at this client, the one the UI shows. */
  get researchManager(): ResearchManager {
    return this.researchOf(this.localPlayerId);
  }

  /** The player whose command runs now, see runAs(); null outside a command */
  private acting: string | null = null;

  /**
   * The player a booking or a new tower belongs to: the one whose command
   * runs, else the first player of the run (the single player, the host).
   */
  get actingPlayerId(): string {
    return this.acting ?? this.creditsLedger.players[0];
  }

  /** The players of the run in roster order (docs/COOP_PLAN.md, C2). */
  get players(): readonly string[] {
    return this.creditsLedger.players;
  }

  /**
   * Coop: the players of the run and the one at this client. Every account
   * starts with the start credits. The single player game is one player,
   * LOCAL_PLAYER_ID, which is how the manager starts.
   */
  setPlayers(players: readonly string[], local: string): void {
    this.creditsLedger.setPlayers(players, local);
    this.researchSeats.length = 0;
    for (const seat of this.abilitySeats) seat.destroy();
    this.abilitySeats.length = 0;
    for (const seat of this.heroSeats) seat.destroy();
    this.heroSeats.length = 0;
    const single = players.length === 1;
    for (const id of players) {
      const owner: PlayerOwner = { playerId: id, local: () => id === this.localPlayerId };
      this.researchSeats.push(this.researchSeat(id, owner));
      const abilities = this.abilitiesFor(owner);
      abilities.setPhaseProvider(this.phaseNow);
      this.abilitySeats.push(abilities);
      this.heroSeats.push(this.heroFor(owner, heroSourceIdFor(id, single)));
    }
    // Only the local hero is drawn for now
    if (this.heroView) this.heroManager.setView(this.heroView);
  }

  /**
   * Coop (C3): whose GPU answers the lines of sight. The host renders every
   * tower's and sends the masks as command:los-mask; a guest renders none.
   * Null for the single player game, which renders its own at once.
   */
  setLosRole(role: 'host' | 'guest' | null): void {
    this.towerPlacement.setCoopLosRole(role);
  }

  /** Coop: the host's mask for a tower, at its tick (command:los-mask). */
  applyCoopLosMask(towerId: string, mask: LosMaskJson): void {
    const tower = this.towerManager.getById(towerId);
    if (tower) this.towerPlacement.applyCoopLosMask(tower, losMaskFromJson(mask));
  }

  /** Coop lanes: the spawn point of each player's lane, roster order; empty in the single player game */
  private lanes: string[] = [];
  /** Coop: the players who are ready for the next wave (D15) */
  private readonly ready = new Set<string>();

  /**
   * Coop: which spawn point is whose lane (D1). Every wave then runs once
   * on each lane (laneSchedule). An empty map is the single player game:
   * the wave spreads over the spawn points by its spawn mode.
   */
  setLanes(lanes: ReadonlyMap<string, string>): void {
    this.laneOf.clear();
    this.lanes = this.players.flatMap((playerId) => {
      const spawnId = lanes.get(playerId);
      if (spawnId === undefined) return [];
      this.laneOf.set(playerId, spawnId);
      return [spawnId];
    });
  }

  /** Coop: each player's lane spawn */
  private readonly laneOf = new Map<string, string>();

  /** The spawn point ids of the lanes, roster order. */
  get laneSpawns(): readonly string[] {
    return this.lanes;
  }

  /**
   * A player is ready for the next wave, or no longer (command:set-ready).
   * Cleared when a wave starts. Announced as coop:ready-changed; the host
   * starts the wave once allReady() (D15).
   */
  setReady(playerId: string, ready: boolean): void {
    if (!this.players.includes(playerId) || this.ready.has(playerId) === ready) return;
    if (ready) this.ready.add(playerId);
    else this.ready.delete(playerId);
    this.eventBus.emit({
      type: 'coop:ready-changed',
      playerId,
      ready,
      local: playerId === this.localPlayerId,
      allReady: this.allReady(),
    });
  }

  /** Every player still in the run is ready for the next wave. */
  allReady(): boolean {
    return this.players.every((playerId) => this.left.has(playerId) || this.ready.has(playerId));
  }

  /** Coop: players who left the game (command:leave-game) */
  private readonly left = new Set<string>();

  /**
   * Coop: `playerId` left the game (command:leave-game, put in a tick by
   * the relay). Their lane closes, no more spawns there (D22, lane
   * collapse); their towers stay and keep shooting, their hero and account
   * stay as they are. They get out of a manned tower and count as ready.
   */
  playerLeft(playerId: string): void {
    if (!this.players.includes(playerId) || this.left.has(playerId)) return;
    this.left.add(playerId);
    const index = this.players.indexOf(playerId);
    const lane = this.laneOf.get(playerId);
    if (lane !== undefined) {
      this.lanes = this.lanes.filter((spawnId) => spawnId !== lane);
      this.laneOf.delete(playerId);
    }
    this.towerLifecycle.leave(playerId);
    this.ready.delete(playerId);
    this.eventBus.emit({ type: 'coop:player-left', playerId, index, local: playerId === this.localPlayerId });
  }

  /** The wave phase, for the abilities (they fire only during a wave) */
  private readonly phaseNow = () => this.waveManager.phase();

  /** What a player may do with a tower (D7); swap it to loosen the rule. */
  towerPolicy: TowerPolicy = OWNER_ONLY;

  /** The player at this client: whose credits `credits` shows, whose towers the UI selects. */
  get localPlayerId(): string {
    return this.creditsLedger.localPlayer;
  }

  /**
   * `towerId` if the player at this client may select that tower
   * (TowerPolicy), else null: the UI's gate, the same rule the commands check.
   */
  selectableTower(towerId: string | null): string | null {
    if (!towerId) return null;
    const tower = this.towerManager.getById(towerId);
    return tower && this.towerPolicy.may(this.localPlayerId, tower, 'select') ? towerId : null;
  }

  /** Credits of one player; `credits` is the one at this client. */
  creditsOf(playerId: string): number {
    return this.creditsLedger.balance(playerId);
  }

  /**
   * Run `fn` as `playerId`'s command: what it books and builds is theirs.
   * The GameCommandsHandler wraps every command in it.
   */
  runAs<T>(playerId: string, fn: () => T): T {
    const before = this.acting;
    this.acting = playerId;
    try {
      return fn();
    } finally {
      this.acting = before;
    }
  }

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
    this.gameSounds?.destroy();
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
    this.commandLog.clear();
    this.simRecorder.clear();

    this.tilesEngine = tilesEngine;
    this.basePosition = basePosition;
    // The pause sync above only reaches an engine that is already here
    tilesEngine.spatialAudio.holdLoops(this.paused() && !this.gameStore.pauseKeepsLoops());
    // Same for the rendering sync, and it matters more: a bot client sets
    // renderingEnabled to false while connecting, long before the engine
    // exists, so the effect's `?.` swallowed it and the signal never changed
    // again. The tab then rendered the whole run at full cost, and only
    // toggling the switch twice by hand put it right.
    tilesEngine.setRenderingEnabled(this.gameStore.renderingEnabled());

    // Initialize defense-reach debug visualization (orange marker)
    this.globalRouteGrid.initDebugViz(tilesEngine.getScene(), tilesEngine.portalClip);

    // Initialize entity managers (no callbacks - use events)
    this.enemyManager.initialize(tilesEngine);
    // Wire wave-number + wave-weight providers for the kill-reward formula
    this.enemyManager.setWaveNumberProvider(() => this.waveManager.waveNumber());
    this.enemyManager.setWaveWeightProvider(() => this.waveManager.getExpectedBodyWeight());
    // Abilities fire during a wave only
    for (const seat of this.abilitySeats) seat.setPhaseProvider(this.phaseNow);

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
      this.simResearch,
    );

    // Initialize HQ damage service (handles fire, sounds, game over effects)
    this.hqDamage.initialize(tilesEngine, basePosition, this.eventBus);

    // Initialize tower combat service (handles targeting, rotation, shooting)
    this.towerCombat.initialize(tilesEngine, this.simResearch);

    // Initialize VFX service (subscribes to vfx events)
    this.vfxService = new VFXService(this.eventBus, tilesEngine);
    // Scorch marks sit on route cells, one per cell, at the grid's ground height
    tilesEngine.effects.setScorchGround(this.globalRouteGrid);
    // The hero stands on the route grid's ground like the enemies
    tilesEngine.hero.setGround(this.globalRouteGrid);
    this.heroView = tilesEngine.hero;
    this.heroManager.setView(this.heroView);
    // The foot of the orbital laser's beam as well
    tilesEngine.orbitalBeams.setGround(this.globalRouteGrid);

    // Initialize Audio service (subscribes to audio events)
    this.audioService = new AudioService(this.eventBus, tilesEngine);
    // Its ability loops (the siren) stand on the route grid's ground
    this.audioService.setGround(this.globalRouteGrid);
    // Deaths, hits, upgrades, the moments of a run (game-sounds.config.ts)
    this.gameSounds = new GameSoundsService(this.eventBus, tilesEngine);
    this.gameSounds.setGameSpeedSource(() => this.gameSpeed());

    // Initialize Screen Shake service (subscribes to explosion/impact events)
    this.screenShakeService = new ScreenShakeService(this.eventBus, tilesEngine);

    // Initialize Background Music service (subscribes to wave/game events)
    this.backgroundMusic = new BackgroundMusicService(this.eventBus, tilesEngine);
    this.backgroundMusic.setGameSpeedSource(() => this.gameSpeed());
    // The pause sync above only reaches music that is already here
    this.backgroundMusic.setDimmed(this.paused() && !this.gameStore.pauseKeepsLoops());

    // Blood moon look on every seventh wave from W14 (subscribes to wave/game events)
    this.bloodMoonService = new BloodMoonService(this.eventBus, tilesEngine.bloodMoon);

    // Register event handlers (tracked via SubscriptionBag for cleanup in reset())
    // Leaks cost HP in full, no cap per wave (9cae86cc): the survivability cap
    // sizes a wave before it walks. Emits health:changed (HQDamageService)
    this.eventBusSubs.add(this.eventBus.on('enemy:reached-base', (event) => {
      this.healthLedger.applyLeak(event.damage);
    }));
    // An ooze flowing in costs HP before it reaches the base as a whole
    this.eventBusSubs.add(this.eventBus.on('enemy:leaking', (event) => {
      this.healthLedger.applyLeak(event.damage);
    }));


    // AA-Retrofit: towers that just gained air targeting get their air LOS
    // resolved (queued, see TowerLifecycle.scheduleAirRetrofit)
    // A tower's line of sight goes into the log with the boundary it came
    // in at: a re-simulation applies it instead of rendering a cube again
    this.eventBusSubs.add(this.eventBus.on('tower:los-resolved', (event) => {
      (this.replayLog ?? this.commandLog).recordLos(event.towerId, event.mask, event.reason);
    }));
    // Cheats that change the simulation past the command log: the running
    // wave does not re-simulate any more
    for (const type of ['debug:spawn-enemy', 'debug:remove-enemy', 'debug:kill-all'] as const) {
      this.eventBusSubs.add(this.eventBus.on(type, () => {
        if (!this.replaying) this.simRecorder.taint(type);
      }));
    }

    this.eventBusSubs.add(this.eventBus.on('research:completed', (event) => {
      this.towerLifecycle.scheduleAirRetrofit(event.effects, event.playerId);
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
        this.creditsLedger.add(event.credits, 'kill', this.killCreditPlayer(event.killedBy));

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
    this.commandsHandler = new GameCommandsHandler(this, this.eventBus, this.commandLog);
    this.commandsHandler.setLockstep(this.lockstep);

    // Initialize projectile manager (no callback - uses events)
    this.projectileManager.initialize(tilesEngine);

    this.waveManager.initialize(spawnPoints, cachedPaths);
    // Wire health-provider for CloseCall detection at wave end
    this.waveManager.setCurrentHealthProvider(() => this.baseHealth());
    // The wave books its completion gold through here, so wave:completed can
    // carry the real amount and its parts.
    this.waveManager.setWaveGoldProvider((result) => this.applyWaveCompletionBonus(result));
    // Seeded streams for the spawn point and the enemies' lane and altitude.
    this.waveManager.setRandom(this.rng.stream('spawn'));
    this.enemyManager.setRandom(this.rng.stream('enemy'));
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
    this.commandLog.clear();
    this.simRecorder.clear();
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
   * than wall-clock at high training timescales. It runs at the boundary
   * after the step and its checks, so a command it emits takes effect at
   * once; after the step that ends the game it does not run.
   *
   * Commands take effect only between two complete sub-steps: one emitted
   * during a step (a listener reacting to a sim event) waits in the
   * GameCommandsHandler until the step and its wave-end and game-over checks
   * are done (docs/EVENT_SYSTEM.md, "Befehlsgrenze und Befehlslog").
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
    const timescale = this.gameSpeed();
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
    while (this.lockstepOpen() && this.clock.nextSubStep()) {
      const gameOver = this.simulateStep(stepMs, profiling);
      if (gameOver) break; // no point running more sub-steps after game-over

      // Per-sub-step listeners (AI bot) at the boundary: a bot decides on
      // the state after the checks, its command acts at once
      onSubStep?.(stepMs);
    }
    this.clock.endFrame();
    const stepsExecuted = this.clock.stepsThisFrame;

    // Queued LOS recomputes (air retrofit after research), one tower per
    // frame, between two sub-steps. Here rather than in a frame callback: the
    // heartbeat of a hidden tab ticks update() as well.
    this.towerPlacement.drainLosQueue();

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
      for (const seat of this.heroSeats) seat.presentFrame();
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
   * One sub-step with its checks and its boundary, after the clock advanced:
   * the step the live loop and a re-simulation (ResimHost.simulateStep)
   * share. Returns true when the game ended in it.
   */
  private simulateStep(stepMs: number, profiling: boolean): boolean {
    const commands = this.commandsHandler;
    // The boundary before this step: every input of it has gone in
    this.atBoundary(this.clock.subStep - 1);

    // From here to endStep() a command waits for the boundary
    commands?.beginStep();
    this.runSubStep(stepMs, profiling);

    // Wave-completion / game-over checks belong INSIDE the sub-step loop
    // so they catch state transitions mid-frame (otherwise a wave might
    // visibly run for "one extra frame" at high timescales).
    const isWavePhase = this.waveManager.phase() === 'wave';
    // A pending strike lands in its own wave, never in the setup or the next one
    if (isWavePhase && !this.hasPendingStrikes() && this.waveManager.checkWaveComplete()) {
      this.waveManager.endWave();
      if (!this.replaying) this.simRecorder.end(this.clock.subStep);
      this.towerCombat.stopAllBeams();
      this.towerCombat.stopAllMelee();
      this.enemyDebug.clearDebugEnemies();
    }
    const gameOver = this.baseHealth() <= 0 && this.waveManager.phase() !== 'gameover';
    if (gameOver) {
      if (!this.replaying) this.simRecorder.end(this.clock.subStep);
      this.triggerGameOver();
    }

    // The boundary: what came in during the step takes effect now
    commands?.endStep();
    return gameOver;
  }

  /**
   * Coop (docs/COOP_PLAN.md, C0): run commands from the relay into the
   * simulation and follow the relay's pace. Every command from the bus goes
   * to `link` and acts when its tick comes back; a sub-step runs only once
   * the tick before it is closed. Null goes back to the single player game.
   */
  setLockstep(link: LockstepLink | null): void {
    this.lockstep = link;
    this.lockstepTickRun = -1;
    this.commandsHandler?.setLockstep(link);
  }

  /**
   * The lockstep barrier at the boundary the clock stands at: false while
   * the relay has not closed the tick before the next sub-step. At a tick's
   * boundary its commands run first, once. Always true without a link.
   */
  private lockstepOpen(): boolean {
    const link = this.lockstep;
    if (!link) return true;
    const boundary = this.clock.subStep;
    if (tickNeededAfter(boundary) > link.confirmedTick()) return false;
    const tick = tickAtBoundary(boundary);
    if (tick > this.lockstepTickRun) {
      this.lockstepTickRun = tick;
      this.commandsHandler?.runTick(tick);
    }
    return true;
  }

  /** A boundary between two sub-steps: the re-simulation's check, else the recorder's hash. */
  private atBoundary(step: number): void {
    const listener = this.boundaryListener;
    if (listener) {
      listener(step, this.stateHash);
      return;
    }
    if (!this.replaying && this.simRecorder.wantsHash(step)) this.simRecorder.addHash(this.stateHash());
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

    for (const seat of this.researchSeats) {
      seat.research.update(stepMs);
      seat.research.startQueued(seat.credits, seat.spend);
    }
    // The rumbling tail of a strike that already hit, then strike countdowns
    // and impacts, in game time like the research
    this.audioService?.update(stepMs);
    for (const seat of this.abilitySeats) seat.update(stepMs);

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

    // The towers the players sit in: turn to the aim and fire, in and between waves
    for (const [, manned] of this.towerLifecycle.mannedTowers()) {
      const shot = this.towerCombat.updateMannedTower(manned, now, stepMs, this.enemyManager, this.projectileManager);
      if (shot) this.eventBus.emitDeferred({ type: 'tower:manual-shot', towerId: shot.tower.id, target: shot.target });
    }

    // Hero: walks and fires in game time, after the enemies moved
    for (const seat of this.heroSeats) seat.update(stepMs);

    // Turrets turn in game time towards where the combat above aims them;
    // alignment gates the next shot (isAimAligned)
    for (const tower of this.towerManager.getAll()) stepTowerAim(tower.aim, stepMs);
  }

  // ============================================
  // Snapshot and re-simulation (docs/SIMULATOR_PLAN.md, P4 to P6)
  // ============================================

  /**
   * A wave starts: keep what a re-simulation of it needs. The snapshot is
   * taken before the wave changes anything; a start that is not quiet (see
   * snapshotRefusal) is kept without one and does not re-simulate.
   */
  private recordWaveStart(config: WaveConfig): void {
    const refusal = this.snapshotRefusal();
    this.simRecorder.begin({
      wave: this.waveManager.waveNumber() + 1,
      snapshot: refusal ? null : this.captureSnapshot(),
      refusal,
      config: toPlainData(config) as WaveConfig,
      startStep: this.clock.subStep,
      logStart: this.commandLog.length,
    });
  }

  /** Why the state now cannot be a snapshot, null when it can: between waves, nothing in flight. */
  snapshotRefusal(): SnapshotRefusal | null {
    const phase = this.waveManager.phase();
    if (phase !== 'setup' && phase !== 'gameover') return 'not-setup';
    if (this.enemyManager.getAll().length > 0 || this.enemyDebug.debugEnemies().length > 0) return 'enemies';
    if (this.projectileManager.getAll().length > 0) return 'projectiles';
    if (this.hasPendingStrikes()) return 'pending-strike';
    if (this.eventBus.hasDeferred) return 'pending-events';
    return null;
  }

  /**
   * The simulation as plain data (SimSnapshot). Only between waves, see
   * snapshotRefusal. A hero on his way is put on a freshly planned path, the
   * one a restore plans too (HeroManager.captureState).
   */
  captureSnapshot(): SimSnapshot {
    return {
      version: SIM_SNAPSHOT_VERSION,
      clock: this.clock.getState(),
      rng: this.rng.getState(),
      idCounter: GameObject.getIdCounter(),
      credits: this.credits(),
      accounts: this.creditsLedger.saveAccounts(),
      baseHealth: this.baseHealth(),
      waveNumber: this.waveManager.waveNumber(),
      phase: this.waveManager.phase(),
      runStarted: this.runStarted,
      economyPerfectStreak: this.economy.perfectStreak,
      research: this.researchSeats[0].research.getState(),
      researchByPlayer: this.researchSeats.map((seat) => [seat.research.owner.playerId, seat.research.getState()]),
      abilities: this.abilitySeats[0].getState(),
      abilitiesByPlayer: this.abilitySeats.map((seat) => [seat.owner.playerId, seat.getState()]),
      hero: this.heroSeats[0].captureState(),
      heroesByPlayer: this.heroSeats.map((seat) => [seat.owner.playerId, seat.captureState()]),
      towers: this.towerManager.getAll().map((tower) => this.saveTower(tower)),
      mannedTowerId: this.towerLifecycle.mannedTower(this.players[0])?.id ?? null,
      mannedByPlayer: [...this.towerLifecycle.mannedTowers()].map(([playerId, tower]) => [playerId, tower.id]),
      losQueue: this.towerPlacement.queuedLosTowerIds(),
    };
  }

  private saveTower(tower: Tower): SavedTower {
    const position = tower.position;
    return {
      id: tower.id,
      ownerId: tower.ownerId,
      typeId: tower.typeConfig.id as TowerTypeId,
      lat: position.lat,
      lon: position.lon,
      height: position.height ?? 0,
      customRotation: tower.customRotation,
      plinthHeight: tower.plinthHeight,
      plinthOverhang: [...tower.plinthOverhang],
      upgrades: tower.getUpgradeLevels(),
      losMask: tower.losMask ? losMaskToJson(tower.losMask) : null,
      state: tower.getSimState(),
    };
  }

  /**
   * Put the simulation back to `snapshot`: towers with their line of sight
   * (no GPU), research, abilities, hero, credits, HQ, clock, random source
   * and id counter. What ran since goes: enemies, projectiles, a wave in
   * progress. No event of the way there goes out: the stores do not hear the
   * replay at all (GameEventBus.onLive), and what shows the state from events
   * (the HQ fire) reads it anew on `sim:restored`.
   */
  restoreSnapshot(snapshot: SimSnapshot, reason: 'replay' | 'live' = 'replay'): void {
    if (snapshot.version !== SIM_SNAPSHOT_VERSION) {
      throw new Error(`Snapshot version ${snapshot.version}, expected ${SIM_SNAPSHOT_VERSION}`);
    }
    // Nothing the state before sent may reach the state after (a replayed
    // wave's wave:completed in the live game)
    this.eventBus.clearDeferred();
    // Out of the tower and off the grid, then everything that moves
    this.towerLifecycle.clearAllOverlays();
    this.towerCombat.stopAllBeams();
    this.towerCombat.stopAllMelee();
    this.enemyManager.clear();
    this.enemyManager.resetKillRewards();
    this.enemyDebug.clearDebugEnemies();
    this.towerManager.clear();
    this.projectileManager.clear();
    this.waveManager.reset();
    for (const seat of this.abilitySeats) seat.reset();
    this.tilesEngine?.oozes.clear();

    // Towers keep their ids: the id counter is set before each is built
    for (const saved of snapshot.towers) {
      GameObject.setIdCounter(idNumber(saved.id) - 1);
      this.towerLifecycle.restore(saved);
    }
    // After the towers: a research center built above counts its slots anew
    if (snapshot.researchByPlayer) {
      for (const [id, state] of snapshot.researchByPlayer) this.researchOf(id).restoreState(state);
    } else {
      this.researchSeats[0].research.restoreState(snapshot.research);
    }
    if (snapshot.abilitiesByPlayer) {
      for (const [id, state] of snapshot.abilitiesByPlayer) this.abilityOf(id).restoreState(state);
    } else {
      this.abilitySeats[0].restoreState(snapshot.abilities);
    }
    if (snapshot.heroesByPlayer) {
      for (const [id, state] of snapshot.heroesByPlayer) this.heroOf(id).restoreState(state);
    } else {
      this.heroSeats[0].restoreState(snapshot.hero);
    }

    const mannedIds: [string, string][] = snapshot.mannedByPlayer
      ?? (snapshot.mannedTowerId ? [[this.players[0], snapshot.mannedTowerId]] : []);
    this.towerLifecycle.restoreManned(mannedIds.flatMap(([playerId, towerId]) => {
      const tower = this.towerManager.getById(towerId);
      return tower ? [[playerId, tower] as const] : [];
    }));
    this.towerPlacement.requeueLos(
      snapshot.losQueue.map((id) => this.towerManager.getById(id)).filter((tower): tower is Tower => !!tower),
    );

    this.creditsLedger.restore(snapshot.accounts ?? [[this.creditsLedger.players[0], snapshot.credits]]);
    this.healthLedger.restore(snapshot.baseHealth);
    this.economy.restorePerfectStreak(snapshot.economyPerfectStreak);
    this.waveManager.waveNumber.set(snapshot.waveNumber);
    this.waveManager.phase.set(snapshot.phase);
    this.runStarted = snapshot.runStarted;
    this.clock.setState(snapshot.clock);
    this.rng.setState(snapshot.rng);
    GameObject.setIdCounter(snapshot.idCounter);

    this.eventBus.emit({ type: 'sim:restored', reason });
  }

  /**
   * What a re-simulation drives (simulator/resimulation.ts). One sub-step
   * there is the live step by count: forceSubStep, then simulateStep.
   */
  readonly resimHost: ResimHost = {
    subStep: () => this.clock.subStep,
    restoreSnapshot: (snapshot) => this.restoreSnapshot(snapshot, 'replay'),
    startWave: (config) => this.startWave(config),
    simulateStep: () => {
      this.clock.forceSubStep();
      return this.simulateStep(GameClock.FIXED_STEP_MS, false);
    },
    waveRunning: () => this.waveManager.phase() === 'wave',
    setReplayMode: (masks) => this.setReplayMode(masks),
    replayCommand: (entry) => this.commandsHandler?.replay(entry),
    applyLosMask: (towerId, mask) => {
      const tower = this.towerManager.getById(towerId);
      if (tower) this.towerPlacement.registerTowerFromMask(tower, mask);
    },
    setBoundaryListener: (listener) => {
      this.boundaryListener = listener;
    },
  };

  /**
   * Take the show off the field before a snapshot restore or after a
   * replay's seek: particles, marks, damage numbers, ability strikes and
   * their sounds, the one-shot sounds. Loops stay with the entities they
   * belong to. resyncPresentation() then sets up what the state shows.
   */
  clearShow(): void {
    const engine = this.tilesEngine;
    if (!engine) return;
    engine.effects.clear();
    clearStrikeEffects(engine);
    this.audioService?.clearAbilitySounds();
    engine.spatialAudio.stopOneShots();
  }

  /**
   * Show what the simulation holds now, after a snapshot restore or a
   * replay's seek, which change it without the events that normally bring
   * its look and sound: the fire towers' furnaces, the HQ fire, the status
   * looks of the enemies, music and blood moon of the phase, the silo's
   * missile.
   */
  resyncPresentation(): void {
    this.towerManager.refreshInnerFires();
    this.hqDamage.updateFireIntensity(this.baseHealth());
    this.enemyManager.resetStatusVisuals();
    const phase = this.waveManager.phase();
    const wave = this.waveManager.waveNumber();
    this.backgroundMusic?.followPhase(phase, wave);
    this.bloodMoonService?.follow(phase, wave);
    for (const seat of this.abilitySeats) seat.announceState();
  }

  /**
   * A key of the world the simulation runs on: the frozen cell heights, the
   * routes and the local origin, hashed. A snapshot or a replay file only
   * re-simulates on the world with the same key (docs/SIMULATOR_PLAN.md,
   * P4). Walks every cell, a few ms: for export and import, not per frame.
   */
  worldKey(): string {
    const heights = [...this.globalRouteGrid.snapshotHeights()].sort((a, b) => a[0] - b[0]);
    const parts: string[] = heights.map(([key, height]) => `${key}:${height.toFixed(2)}`);
    for (const path of this.waveManager.getPaths()) {
      parts.push(path.map((p) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`).join(';'));
    }
    const origin = this.tilesEngine?.sync.getOrigin();
    if (origin) parts.push(`o=${origin.lat.toFixed(7)},${origin.lon.toFixed(7)}`);
    return fnv1a(parts.join('|'));
  }

  /**
   * The finished world as a coop host packs it (coop/world-package.ts): HQ,
   * spawns, the routes as the corridor build left them, the cells' heights
   * and the world key. Null before the world stands. Walks every cell.
   */
  worldSource(): WorldSource | null {
    const origin = this.tilesEngine?.sync.getOrigin();
    if (!origin || !this.basePosition) return null;
    return {
      origin: { lat: origin.lat, lon: origin.lon, height: origin.height },
      hq: this.basePosition,
      spawns: this.waveManager.spawnPoints,
      paths: this.pathRouteService.getCachedPaths(),
      heights: this.globalRouteGrid.exportHeights(),
      worldKey: this.worldKey(),
    };
  }

  /**
   * Hand the re-simulated state to the renderers, like the frame's present
   * after the live sub-steps (update()). The replay calls it after it
   * stepped; the live loop stands paused meanwhile.
   */
  presentReplayFrame(): void {
    if (!this.tilesEngine?.renderingEnabled) return;
    this.enemyManager.presentFrame(this.clock.gameTimeMs);
    this.projectileManager.presentFrame();
    for (const seat of this.heroSeats) seat.presentFrame();
  }

  private setReplayMode(masks: ((towerId: string, reason: LosResolveReason) => LosMask | null) | null): void {
    const on = masks !== null;
    this.replaying = on;
    // What records or mirrors the run stays out (GameEventBus.onLive)
    this.eventBus.setLiveMuted(on);
    this.replayLog = on ? new CommandLog(() => this.clock.subStep) : null;
    this.commandsHandler?.setReplaying(on);
    this.commandsHandler?.setLog(this.replayLog ?? this.commandLog);
    this.towerPlacement.setLosMaskSource(masks);
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
    this.waveManager.phase.set('gameover');

    // Before the field is cleared: the run log writes the block of the wave
    // the base fell in, and its bodies only add up while the enemies that
    // were standing can still be counted. `clear()` removes them without an
    // `enemy:died`, so a log that looked afterwards found dozens of enemies
    // vanished (docs/RUN_LOG.md, Die Abgleiche).
    this.eventBus.emit({
      type: 'game:over',
      reason: 'base-destroyed',
    });

    this.enemyManager.clear();
    this.enemyDebug.clearDebugEnemies(); // Clear orphaned debug enemy references
    this.towerManager.selectTower(null);
    this.towerLifecycle.leaveAll();

    // Delegate visual effects to HQDamageService
    this.hqDamage.triggerGameOverEffects();
  }

  // ============================================
  // Public API
  // ============================================

  /**
   * Start a new wave with config
   */
  startWave(config: WaveConfig): void {
    if (this.corridorPending()) return;
    // Coop: the wave on every lane (D13). A config that already names its
    // spawn points (a replayed one) is laid out already.
    if (this.lanes.length > 0 && !config.schedule.entries.some((entry) => entry.spawnPointId !== undefined)) {
      config = { ...config, schedule: laneSchedule(config.schedule, this.lanes) };
    }
    this.ready.clear();
    if (!this.replaying && config.schedule.entries.length > 0) this.recordWaveStart(config);

    // Wave preview in the sidebar, see summarizeWaveGroups(); the live wave's only
    const groups = this.replaying ? [] : summarizeWaveGroups(config);
    if (groups.length > 0) {
      this.waveDebug.setCurrentWaveGroups(groups);
    }

    // Emit lifecycle event BEFORE startWave() so that StateSnapshotService.clearHistory()
    // runs before wave:started sets up tracking (prevents NaN in wave history)
    if (!this.runStarted) {
      this.runStarted = true;
      this.eventBus.emit({ type: 'game:started' });
    }

    this.waveManager.startWave(config);
  }

  /**
   * Begin wave phase without auto-spawning
   */
  beginWave(): void {
    if (this.corridorPending()) return;

    // Emit lifecycle event BEFORE beginWave() so that StateSnapshotService.clearHistory()
    // runs before wave:started sets up tracking (prevents NaN in wave history)
    if (!this.runStarted) {
      this.runStarted = true;
      this.eventBus.emit({ type: 'game:started' });
    }

    this.waveManager.beginWave();
  }

  /**
   * Heal base to full health
   */
  healBase(): void {
    this.healthLedger.resetToStart();
    this.hqDamage.healBase();
  }

  /** Debug: add (or take) base HP, emits health:changed. */
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
    if (credits > 0) this.creditsLedger.addEach(credits, 'wave-jump');
    for (const seat of this.abilitySeats) seat.advanceWaves(skipped);
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

    // Destroy game-engine service instances (they hold EventBus subscriptions)
    this.combatEffect.destroy();
    this.vfxService?.destroy();
    this.audioService?.destroy();
    this.gameSounds?.destroy();
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
    for (const seat of this.abilitySeats) seat.destroy();
    for (const seat of this.heroSeats) seat.destroy();
    this.globalRouteGrid.clear();

    if (this.tilesEngine) {
      this.tilesEngine.effects.clear();
    }
  }

  /**
   * Reset game to initial state (restart).
   * Does NOT dispose EventBus subscriptions — handlers stay active for the next game.
   * @param seed The run seed; a coop room hands every client the same one. A new one by default.
   */
  reset(seed?: number): void {
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
    for (const seat of this.researchSeats) seat.research.reset();
    for (const seat of this.abilitySeats) seat.reset();
    for (const seat of this.heroSeats) seat.reset();
    this.commandLog.clear();
    this.simRecorder.clear();

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
    this.lockstepTickRun = -1;
    // A new run is a new seed: leaving the streams running would make the
    // second run of a batch a different experiment than the first.
    this.rng.reset(seed);
    this.left.clear();
    this.economy.reset();
    this.runStarted = false;

    GameObject.resetIdCounter();

    // Emit game:reset so downstream services (e.g. GameStateSyncService) can react
    this.eventBus.emit({ type: 'game:reset' });
  }

  /** Apply Wave-Completion-Bonus via EconomyService (delegates the math). */
  private applyWaveCompletionBonus(result: { wave: number; perfect: boolean; closeCall: boolean; hpLost: number }): WaveGoldBreakdown {
    const breakdown = this.economy.computeWaveCompletionBonus(result);
    this.creditsLedger.addEach(waveGoldTotal(breakdown), 'wave-bonus');
    return breakdown;
  }

  /**
   * Who gets a kill's gold (D9): the owner of the tower with the killing
   * hit, the owner of the hero or the ability. The dev tools book to the
   * first player; so does a tower sold before its shot landed.
   */
  private killCreditPlayer(killedBy: KilledBy | null): string {
    if (killedBy?.kind === 'tower') {
      const tower = this.towerManager.getById(killedBy.towerId);
      if (tower) return tower.ownerId;
    } else if (killedBy?.kind === 'hero') {
      const heroId = killedBy.heroId ?? HERO_SOURCE_ID;
      for (const seat of this.heroSeats) if (seat.heroId === heroId) return seat.owner.playerId;
    } else if (killedBy?.kind === 'ability' && killedBy.ownerId) {
      return killedBy.ownerId;
    }
    return this.creditsLedger.players[0];
  }

  /** Add credits to a player's account (delta), the acting player's by default. */
  addCredits(amount: number, source: CreditsSource, playerId: string = this.actingPlayerId): void {
    this.creditsLedger.add(amount, source, playerId);
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

  /**
   * Hold fire of a tower on or off, see TowerLifecycle.setHoldFire.
   * @returns false for a passive tower
   */
  setTowerHoldFire(tower: Tower, holdFire: boolean): boolean {
    return this.towerLifecycle.setHoldFire(tower, holdFire);
  }

  /**
   * The player gets into `tower` and aims it by hand, see TowerLifecycle.man.
   * Not after the game is over.
   * @returns false when it cannot be manned
   */
  manTower(tower: Tower): boolean {
    if (this.waveManager.phase() === 'gameover') return false;
    return this.towerLifecycle.man(tower);
  }

  /** The acting player out of their manned tower, see TowerLifecycle.leave. */
  leaveTower(): void {
    this.towerLifecycle.leave();
  }

  /** Trigger of the manned tower (command:tower-trigger). */
  setMannedTrigger(held: boolean): void {
    this.towerLifecycle.setTrigger(held);
  }

  /** The tower the player at this client sits in, null when none. */
  getMannedTower(): Tower | null {
    return this.towerLifecycle.mannedTower(this.localPlayerId);
  }

  /**
   * Where the player aims from the manned tower (Tower.manualAim), from
   * command:tower-aim (TowerControlService sends one a frame at most, only
   * when the mouse moved). The shot itself goes by the trigger command and
   * the tower's rules in the sub-step.
   */
  setMannedAim(heading: number, pitch: number): void {
    const tower = this.towerLifecycle.mannedTower(this.actingPlayerId);
    if (!tower) return;
    tower.manualAim.heading = heading;
    tower.manualAim.pitch = pitch;
  }

  /** Debug: every track of every tower to its max level, free of charge. */
  maxUpgradeAllTowers(): void {
    this.towerLifecycle.maxUpgradeAll();
  }

  /**
   * Spend credits (for upgrades etc.)
   * @returns true if credits were spent, false if not enough
   */
  spendCredits(amount: number, source: CreditsSource, playerId: string = this.actingPlayerId): boolean {
    return this.creditsLedger.spend(amount, source, playerId);
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
  setGameSpeed(scale: number, persist = true): void {
    const clamped = Math.max(0.1, Math.min(75, scale));
    this.gameSpeed.set(clamped);
    // Also update the global store so UI components stay in sync
    this.gameStore.gameSpeed.set(clamped);
    if (persist) {
      localStorage.setItem('game-speed', clamped.toString());
    }
  }
}

/** The number of an entity id (`tower-12` gives 12), see GameObject.generateId. */
function idNumber(id: string): number {
  return Number(id.slice(id.lastIndexOf('-') + 1));
}
