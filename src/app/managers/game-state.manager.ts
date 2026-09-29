import { Injectable, inject, signal, computed } from '@angular/core';
import { Vector3 } from 'three';
import { EnemyManager } from './enemy.manager';
import { TowerManager } from './tower.manager';
import { ProjectileManager } from './projectile.manager';
import { WaveManager, SpawnPoint, WaveConfig, laneSchedule } from './wave.manager';
import { GlobalRouteGridService } from '../services/world/global-route-grid.service';
import { SpatialGridService } from '../services/world/spatial-grid.service';
import { CombatEffectService } from '../services/combat/combat-effect.service';
import { StatusEffectService } from '../services/combat/status-effect.service';
import { TowerCombatService } from '../services/combat/tower-combat.service';
import { GeoPosition, RouteWaypoint } from '../models/game.types';
import { GameObject } from '../core/game-object';
import { TowerTypeId, UpgradeId } from '../configs/tower-types.config';
import { TIMING } from '../configs/timing.config';
import { Tower } from '../entities/tower.entity';
import { EconomyService, skippedWavesGold } from '../services/economy.service';
import { GameCommandsHandler } from './game-commands.handler';
import { GameEventBus, SubscriptionBag } from '../game-engine/game-event-bus';
import type { IGameManager } from '../game-engine/game-manager.interface';
import { ResearchManager, type SimResearch } from './research.manager';
import { LOCAL_OWNER, type PlayerOwner } from './game-state/player-owner';
import { AbilityManager } from './ability.manager';
import { HeroManager } from './hero.manager';
import { HERO_SOURCE_ID, heroSourceIdFor } from '../configs/hero.config';
import { heroBodyContact } from '../utils/hero-body-contact';
import { GameClock } from './game-state/game-clock';
import { GameRng } from '../utils/game-rng';
import type { CreditsSource, GameEvent, KilledBy, WaveGoldBreakdown } from '../game-engine/game-event-bus';
import { waveGoldTotal } from '../services/economy.service';
import { CreditsLedger } from './game-state/credits-ledger';
import { BaseHealthLedger } from './game-state/base-health-ledger';
import { TowerLifecycle } from './game-state/tower-lifecycle';
import { CommandLog, LOCAL_PLAYER_ID, toPlainData, type CommandLogEntry } from './game-state/command-log';
import { summarizeWaveGroups } from './game-state/wave-preview';
import { routeSweepToward } from '../utils/route-sweep';
import { SimRecorder } from '../simulator/sim-recorder';
import { StateHasher, type HashBreakdown, type StateHashSource } from '../simulator/state-hash';
import type { SimSnapshot, SnapshotRefusal } from '../simulator/sim-snapshot';
import type { WaveSnapshot, WaveSnapshotRefusal } from '../simulator/wave-snapshot';
import { SimSnapshots } from './game-state/sim-snapshots';
import { RouteWorld } from './game-state/route-world';
import { CoopRoom } from './game-state/coop-room';
import type { ResimHost } from '../simulator/resimulation';
import { losMaskFromJson, type LosMaskJson } from '../utils/los-mask';
import { stepTowerAim } from '../entities/tower-aim';
import type { LockstepLink } from '../coop/lockstep';
import { LockstepPacer } from './game-state/lockstep-pacer';
import { OWNER_ONLY, type TowerPolicy } from '../coop/tower-policy';
import { SimCoords } from '../sim/core/sim-coords';
import { SimOps } from '../sim/core/sim-sink';
import type { SimWorld } from '../sim/protocol/messages';
import { TowerLos } from './game-state/tower-los';
import { DebugEnemies } from './game-state/debug-enemies';

/** What the GameStateManager reports per frame to a profiler (PerformanceProfilerService) */
export interface SimProfiler {
  accumulateFrameTiming(towerMs: number, projectileMs: number, combatMs: number, eventsMs: number, totalMs: number, subSteps: number): void;
}

/** A player's research and their credits for its queue, see GameStateManager.researchSeats */
interface ResearchSeat {
  research: ResearchManager;
  credits: () => number;
  spend: (cost: number) => boolean;
}

/**
 * The simulation's orchestrator - coordinates all entity managers
 * (docs/SIM_WORKER.md). Runs without engine, renderer or UI stores: its
 * world comes as a SimWorld (loadWorld), its show goes out as ops (SimOps)
 * and events, the frame packet is written after update() (SimCore).
 */
@Injectable()
export class GameStateManager {
  private readonly globalRouteGrid = inject(GlobalRouteGridService);
  private readonly combatEffect = inject(CombatEffectService);
  private readonly statusEffectService = inject(StatusEffectService);
  private readonly towerCombat = inject(TowerCombatService);
  private readonly spatialGrid = inject(SpatialGridService);
  private readonly economy = inject(EconomyService);
  /** The simulation's frame, set with its world */
  readonly coords = inject(SimCoords);
  /** The simulation's renderer calls, taken by the packet writer */
  readonly ops = inject(SimOps);
  private readonly sink = this.ops.sink;

  // Game Engine (framework-agnostic)
  private readonly eventBus = new GameEventBus();
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
  readonly towerManager = new TowerManager(this.eventBus, this.coords, this.sink);
  readonly enemyManager = new EnemyManager(this.eventBus, this.globalRouteGrid, this.spatialGrid, this.coords, this.sink);
  readonly projectileManager = new ProjectileManager(this.eventBus, this.sink);
  readonly waveManager = new WaveManager(this.eventBus, this.enemyManager);
  /**
   * One set of abilities per player (docs/COOP_PLAN.md, D11), in roster
   * order: charges, strikes, the player's own launch site. The single player
   * game has one.
   */
  private readonly abilitySeats: AbilityManager[] = [this.abilitiesFor(LOCAL_OWNER)];

  /** The enemies the dev tools placed, see DebugEnemies */
  readonly debugEnemies = new DebugEnemies();

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

  /** HP the abilities of `playerId` took from enemies so far, for the run log (TODO E44) */
  abilityDamageOf(playerId: string): number {
    return this.combatEffect.abilityDamageOf(playerId);
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
      routes: () => this.routeWorld.cachedPaths(),
      base: () => this.basePosition,
      enemiesInRadius: (center, radiusM, out) =>
        this.globalRouteGrid.getEnemiesInRadiusGeo(center, radiusM, undefined, out),
      bodyContact: (enemy, from, out) => {
        const body = enemy.body;
        if (!body) return null;
        const local = this.coords.sync.geoToLocalSimpleInto(from.lat, from.lon, 0, this.heroLocal);
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

  /** Every player's hero in roster order (the packet's heroes) */
  get heroes(): readonly HeroManager[] {
    return this.heroSeats;
  }

  /**
   * Canonical list of sub-managers that implement IGameManager. Used for the
   * polymorphic teardown loop in dispose() — destroy() is parameterless and
   * is therefore the only lifecycle call that iterates cleanly off this array.
   *
   * initialize(), reset() and the per-frame update() sequence stay hardcoded
   * on purpose and are deliberately NOT driven off this array:
   *  - initialize(): the managers take different arguments (WaveManager
   *    takes spawnPoints + paths, ResearchManager has no lifecycle
   *    initialize at all).
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

  /** The towers' line of sight as request and answer, see TowerLos */
  readonly towerLos = new TowerLos(
    this.globalRouteGrid, this.coords, this.eventBus, (playerId) => this.simResearch.airTargetingFor(playerId),
  );

  /** Place, sell and upgrade rules, range refresh and guard heading of the towers */
  private readonly towerLifecycle = new TowerLifecycle(
    this.towerManager,
    (playerId: string) => this.researchOf(playerId),
    (playerId: string) => this.abilityOf(playerId),
    this.waveManager,
    this.enemyManager,
    this.towerLos,
    this.towerCombat,
    this.creditsLedger,
    this.eventBus,
    this.sink,
    () => this.corridorPending(),
    () => this.actingPlayerId,
  );

  /** Game speed (1.0 = normal, 75 at most), per frame from the main thread (SimTickInput.gameSpeed) */
  readonly gameSpeed = signal<number>(1.0);

  /** Command-Bus-Adapter — registriert sich bei initialize(). */
  private commandsHandler: GameCommandsHandler | null = null;

  /** Coop: the relay link, its ticks, pace and barrier, see setLockstep() */
  private readonly lockstep = new LockstepPacer({
    hashBreakdown: () => this.stateHasher.breakdown(this.hashSource),
    runTick: (tick) => this.commandsHandler?.runTick(tick),
  });

  /**
   * A wave has started in this run; `game:started` goes out before the first.
   * Not read off the counter: the dev wave jump moves it before any wave ran.
   */
  private runStarted = false;

  /** Game time stands still, per frame from the main thread (SimTickInput.paused). */
  readonly paused = signal<boolean>(false);

  // Computed signals for UI bindings
  readonly phase = computed(() => this.waveManager.phase());
  readonly waveNumber = computed(() => this.waveManager.waveNumber());
  readonly enemiesAlive = computed(() => this.enemyManager.aliveCount());

  /**
   * Towers standing now. A plain method: towerManager.getAll() reads no
   * signal, so as a computed it kept the count of its first read.
   */
  towerCount(): number {
    return this.towerManager.getAll().length;
  }

  private basePosition: GeoPosition | null = null;

  /** The routes and the route grid's cells, see RouteWorld */
  private readonly routeWorld = new RouteWorld({
    grid: this.globalRouteGrid,
    coords: this.coords,
    routesChanged: () => this.towerLifecycle.refreshGuardHeadings(),
  });

  /** A world stands (initialize ran): before it no tower is placed and no wave starts */
  private worldReady = false;

  /** Sub-step accounting: accumulator, catch-up cap, game time. */
  private readonly clock = new GameClock();

  /**
   * The run's random source. One seed per run, one stream per system, so a
   * different bot decision cannot shift the enemies (BALANCING_PLAN.md,
   * section 5). Reset gives the next run a fresh seed. The wave source and
   * the bot draw from their own GameRng on the main thread.
   */
  readonly rng = new GameRng();

  /** Read-only access to the game-clock for any consumer that needs
   *  game-time (status effects, sleep checks, etc). */
  get gameTimeMs(): number {
    return this.clock.gameTimeMs;
  }

  /** Sub-steps since the run started; the stamp for every logged command. */
  get subStep(): number {
    return this.clock.subStep;
  }

  /** Sub-steps the last update() ran */
  get stepsThisFrame(): number {
    return this.clock.stepsThisFrame;
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

  /** Between waves and mid-wave, see SimSnapshots */
  private readonly snapshots = new SimSnapshots({
    eventBus: this.eventBus,
    clock: this.clock,
    rng: this.rng,
    creditsLedger: this.creditsLedger,
    healthLedger: this.healthLedger,
    economy: this.economy,
    waveManager: this.waveManager,
    enemyManager: this.enemyManager,
    projectileManager: this.projectileManager,
    towerManager: this.towerManager,
    towerLifecycle: this.towerLifecycle,
    towerLos: this.towerLos,
    towerCombat: this.towerCombat,
    debugEnemies: this.debugEnemies,
    sink: this.sink,
    research: () => this.researchSeats.map((seat) => seat.research),
    abilities: () => this.abilitySeats,
    heroes: () => this.heroSeats,
    researchOf: (playerId) => this.researchOf(playerId),
    abilityOf: (playerId) => this.abilityOf(playerId),
    heroOf: (playerId) => this.heroOf(playerId),
    players: () => this.players,
    runStarted: () => this.runStarted,
    setRunStarted: (started) => { this.runStarted = started; },
  });

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
    perfectStreak: () => this.economy.perfectStreak,
    baseHealth: () => this.baseHealth(),
    waveNumber: () => this.waveManager.waveNumber(),
    idCounter: () => GameObject.getIdCounter(),
    rngState: () => this.rng.getState(),
    enemies: () => this.enemyManager.getAll(),
    towers: () => this.towerManager.getAll(),
    projectiles: () => this.projectileManager.getAll(),
    heroes: () => this.heroSeats,
    research: () => this.researchSeats.map((seat) => seat.research),
    abilities: () => this.abilitySeats,
  };
  /** The state hash now (StateHasher), for the recorder and the re-simulation */
  readonly stateHash = (): number => this.stateHasher.hash(this.hashSource);
  /** The state hash now with its parts and entities (StateHasher.breakdown), for finding a divergence */
  readonly stateHashBreakdown = (): HashBreakdown => this.stateHasher.breakdown(this.hashSource);

  /** Coop: the breakdown reported for `tick`, while it is kept (LockstepPacer). */
  hashBreakdownAt(tick: number): HashBreakdown | null {
    return this.lockstep.breakdownAt(tick);
  }

  /**
   * Execute a logged command again, the same way as the live one (boundary,
   * log, handler). For a re-simulation that has reached `entry.step`.
   */
  replayCommand(entry: CommandLogEntry): void {
    this.commandsHandler?.replay(entry);
  }

  /**
   * A command from the main thread's bus, given by `playerId`, at the
   * boundary before the next sub-step (SimCore.tick): the same path as one
   * emitted on the simulation's own bus.
   */
  receiveCommand(command: GameEvent, playerId: string): void {
    this.commandsHandler?.receiveFrom(command, playerId);
  }

  // Performance profiler (optional, set via setProfiler())
  private profiler: SimProfiler | null = null;
  /** Profiler sums of one frame, filled by runSubStep() */
  private readonly stepTimings = { tProjectile: 0, tCombat: 0, tEvents: 0 };

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
    this.room.newRoster();
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
  }

  /**
   * The line of sight the main thread rendered for a tower waiting for it
   * (command:los-mask), at the boundary it came in; see TowerLos.applyMask.
   */
  applyLosMask(towerId: string, mask: LosMaskJson, generation?: number): void {
    const tower = this.towerManager.getById(towerId);
    if (tower) this.towerLos.applyMask(tower, losMaskFromJson(mask), generation);
  }

  /** Coop: lanes, readiness, who left, gifts, see CoopRoom */
  private readonly room = new CoopRoom({
    eventBus: this.eventBus,
    creditsLedger: this.creditsLedger,
    players: () => this.players,
    localPlayerId: () => this.localPlayerId,
    leaveTowers: (playerId) => this.towerLifecycle.leave(playerId),
  });

  /** Coop: which spawn point is whose lane (D1), see CoopRoom.setLanes */
  setLanes(lanes: ReadonlyMap<string, string>): void {
    this.room.setLanes(lanes);
  }

  /** The spawn point ids of the lanes, roster order. */
  get laneSpawns(): readonly string[] {
    return this.room.laneSpawns;
  }

  /** Coop: the spawn point id of `playerId`'s lane; null without one */
  laneSpawnOf(playerId: string): string | null {
    return this.room.laneSpawnOf(playerId);
  }

  /** A player is ready for the next wave, or no longer (command:set-ready), see CoopRoom.setReady */
  setReady(playerId: string, ready: boolean): void {
    this.room.setReady(playerId, ready);
  }

  /** Coop: `from` sends `amount` of their gold to `to` (command:give-credits), see CoopRoom.giveCredits */
  giveCredits(from: string, to: string, amount: number): boolean {
    return this.room.giveCredits(from, to, amount);
  }

  /** Coop: `playerId` said ready for the next wave (setReady) */
  isReady(playerId: string): boolean {
    return this.room.isReady(playerId);
  }

  /** Every player still in the run is ready for the next wave. */
  allReady(): boolean {
    return this.room.allReady();
  }

  /** Coop: `playerId` left the game (command:leave-game), see CoopRoom.playerLeft */
  playerLeft(playerId: string): void {
    this.room.playerLeft(playerId);
  }

  /** The wave phase, for the abilities (they fire only during a wave) */
  private readonly phaseNow = () => this.waveManager.phase();

  /** Coop: who may use the dev tools' commands (debug:*), see CoopRoom.setCheatRule */
  setCheatRule(rule: ((playerId: string) => boolean) | null): void {
    this.room.setCheatRule(rule);
  }

  /** `playerId` may use a cheat (see setCheatRule) */
  mayCheat(playerId: string): boolean {
    return this.room.mayCheat(playerId);
  }

  /** What a player may do with a tower (D7); swap it to loosen the rule. */
  towerPolicy: TowerPolicy = OWNER_ONLY;

  /** The player at this client: whose credits `credits` shows. */
  get localPlayerId(): string {
    return this.creditsLedger.localPlayer;
  }

  /**
   * Whether the player at this client may act on `tower` (upgrade, sell,
   * targeting, man it): a partner's tower can be selected but only looked at.
   */
  mayManage(tower: { readonly ownerId: string }): boolean {
    return this.towerPolicy.may(this.localPlayerId, tower, 'upgrade');
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
  setProfiler(profiler: SimProfiler | null): void {
    this.profiler = profiler;
  }

  /** The main thread rebuilds the route corridor (SimConfig.corridorPending) */
  private corridorBuilding = false;

  /**
   * No world yet (loadWorld), or the main thread rebuilds its corridor: no
   * tower is placed and no wave starts. Holds for every way in: click,
   * hotkey, auto start, wave director and the bot.
   */
  corridorPending(): boolean {
    return !this.worldReady || this.corridorBuilding;
  }

  /** See corridorPending (SimConfig.corridorPending) */
  setCorridorPending(pending: boolean): void {
    this.corridorBuilding = pending;
  }

  /** Damage numbers on hits (display option, SimConfig.damageNumbers) */
  setDamageNumbers(enabled: boolean): void {
    this.combatEffect.damageNumbersEnabled = enabled;
  }

  /** Enemies stand still (display option `movement`, SimConfig.movementEnabled) */
  setMovementEnabled(enabled: boolean): void {
    this.enemyManager.movementEnabled = enabled;
  }

  /**
   * Stand on `world` (docs/SIM_WORKER.md, "Welt"): its frame, routes and
   * cells (RouteWorld), then the game on it (initialize). The world key must
   * come out as the main thread's, or the world is refused. A new world
   * after a run: reset first.
   */
  loadWorld(world: SimWorld): void {
    this.routeWorld.load(world);
    const key = this.routeWorld.key();
    if (key !== world.worldKey) {
      this.worldReady = false;
      throw new Error(`SimWorld: world key ${key}, the main thread has ${world.worldKey}`);
    }
    this.initialize(world.hq, world.spawns, this.routeWorld.cachedPaths());
    const ground = new Map(world.spawns.map((spawn) => [spawn.id, world.spawnGround[spawn.id] ?? null]));
    this.enemyManager.setSpawnGround((at) => {
      for (const spawn of world.spawns) {
        if (spawn.lat === at.lat && spawn.lon === at.lon) return ground.get(spawn.id) ?? null;
      }
      return null;
    });
  }

  /**
   * Set the game up on a world whose frame (SimCoords) and route grid stand:
   * managers, listeners, commands. loadWorld calls it; a spec that builds its
   * own grid calls it directly (integration/sim-world.ts).
   */
  initialize(
    basePosition: GeoPosition,
    spawnPoints: SpawnPoint[],
    cachedPaths: Map<string, RouteWaypoint[]>,
  ): void {
    // Clean up previous subscriptions to prevent duplicate event handlers on re-init
    this.eventBusSubs.disposeAll();
    // Dispose previous command-bus adapter — otherwise its subscriptions on
    // command:* / debug:* events stack on top of the new handler below,
    // causing every command to run N times after N re-inits.
    this.commandsHandler?.dispose();

    // A replay of the previous place is in the previous place's coordinates
    this.commandLog.clear();
    this.simRecorder.clear();

    this.basePosition = basePosition;
    this.worldReady = true;

    // Wire wave-number + wave-weight providers for the kill-reward formula
    this.enemyManager.setWaveNumberProvider(() => this.waveManager.waveNumber());
    this.enemyManager.setWaveWeightProvider(() => this.waveManager.getExpectedBodyWeight());
    this.enemyManager.setWaveLaneCountProvider(() => this.waveManager.getWaveLaneCount());
    // Abilities fire during a wave only
    for (const seat of this.abilitySeats) seat.setPhaseProvider(this.phaseNow);

    this.towerManager.setActiveRoutesGetter(() => this.routeWorld.routes());

    // Wire the engine game-clock into StatusEffectService (breaks DI cycle —
    // StatusEffectService can't directly inject GameStateManager).
    this.statusEffectService.setGameClockProvider(() => this.clock.gameTimeMs);

    // Initialize combat effect service (subscribes to projectile:hit events)
    this.combatEffect.initialize(
      this.eventBus,
      this.towerManager,
      this.enemyManager,
      this.simResearch,
    );

    // Initialize tower combat service (handles targeting, rotation, shooting)
    this.towerCombat.initialize(this.simResearch);

    // Register event handlers (tracked via SubscriptionBag for cleanup in reset())
    // Leaks cost HP in full, no cap per wave (9cae86cc): the survivability cap
    // sizes a wave before it walks. Emits health:changed
    this.eventBusSubs.add(this.eventBus.on('enemy:reached-base', (event) => {
      this.healthLedger.applyLeak(event.damage);
    }));
    // An ooze flowing in costs HP before it reaches the base as a whole
    this.eventBusSubs.add(this.eventBus.on('enemy:leaking', (event) => {
      this.healthLedger.applyLeak(event.damage);
    }));

    // A tower's line of sight goes into the log with the boundary it came
    // in at: a re-simulation applies it at that boundary (TowerLos)
    this.eventBusSubs.add(this.eventBus.on('tower:los-resolved', (event) => {
      (this.replayLog ?? this.commandLog).recordLos(event.towerId, event.mask, event.reason);
    }));

    // AA-Retrofit: towers that just gained air targeting ask for their air LOS
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

    this.eventBusSubs.add(this.eventBus.on('enemy:died', (event) => {
      if (event.credits > 0) {
        this.creditsLedger.add(event.credits, 'kill', this.killCreditPlayer(event.killedBy));

        // Show reward popup with actual dynamic credits (not static typeConfig.reward)
        this.sink.effects.spawnFloatingText(
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
    }));

    // ══════════════════════════════════════════════════════════════
    // Command-Bus-Adapter (UI → Game Engine) — extrahiert in eigene Klasse.
    // ══════════════════════════════════════════════════════════════
    this.commandsHandler = new GameCommandsHandler(this, this.eventBus, this.commandLog);
    this.commandsHandler.setLockstep(this.lockstep.current);

    this.waveManager.initialize(spawnPoints, cachedPaths);
    // Wire health-provider for CloseCall detection at wave end
    this.waveManager.setCurrentHealthProvider(() => this.baseHealth());
    // The wave books its completion gold through here, so wave:completed can
    // carry the real amount and its parts.
    this.waveManager.setWaveGoldProvider((result) => this.applyWaveCompletionBonus(result));
    // Seeded streams for the spawn point and the enemies' lane and altitude.
    this.waveManager.setRandom(this.rng.stream('spawn'));
    this.enemyManager.setRandom(this.rng.stream('enemy'));

    // The routes of this world: hero graph, guard headings
    this.routeWorld.adopt(cachedPaths);
  }

  /**
   * Main update loop — called once per frame of the main thread (SimCore.tick).
   *
   * Architecture: outer wrapper handles wall-clock → game-time conversion;
   * inner sub-step loop runs all gameplay logic at a FIXED 16.667ms game-time
   * granularity, identical to a single 1× tick.
   *
   * `onSubStep` is invoked once per sub-step with the step length in game-time
   * ms. It runs at the boundary after the step and its checks, so a command
   * it emits takes effect at once; after the step that ends the game it does
   * not run.
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
    if (this.paused()) {
      this.clock.holdFrame(currentTime);
      return;
    }

    const frameStart = performance.now();
    const profiling = this.profiler !== null;

    // Clamped wall-clock delta × timescale plus the carried remainder,
    // see GameClock.beginFrame().
    const timescale = this.gameSpeed();
    this.clock.beginFrame(currentTime, timescale * this.lockstep.pace(this.clock.subStep));

    const timings = this.stepTimings;
    timings.tProjectile = 0;
    timings.tCombat = 0;
    timings.tEvents = 0;
    const stepMs = GameClock.FIXED_STEP_MS;

    // nextSubStep() advances the game clock before the step runs
    let open: boolean;
    while ((open = this.lockstep.open(() => this.clock.subStep)) && this.clock.nextSubStep()) {
      const gameOver = this.simulateStep(stepMs, profiling);
      if (gameOver) break; // no point running more sub-steps after game-over

      // Per-sub-step listeners at the boundary: one decides on the state
      // after the checks, its command acts at once
      onSubStep?.(stepMs);
    }
    // Coop: how smoothly this client runs (PLAYTEST T19)
    const link = this.lockstep.current;
    if (link?.noteFrame) {
      const behind = this.lockstep.ticksInHand(link, this.clock.subStep);
      link.noteFrame(this.clock.stepsThisFrame, !open && this.clock.hasDueStep(), Math.max(0, behind));
    }
    this.clock.endFrame();

    if (profiling) {
      this.profiler!.accumulateFrameTiming(
        0, timings.tProjectile, timings.tCombat, timings.tEvents,
        performance.now() - frameStart,
        this.clock.stepsThisFrame,
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
      this.debugEnemies.clear();
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

  /** Coop: commands run at the relay's ticks (setLockstep) */
  get lockstepActive(): boolean {
    return this.lockstep.current !== null;
  }

  /**
   * Coop (docs/COOP_PLAN.md, C0): run commands from the relay into the
   * simulation and follow the relay's pace. Every command from the bus goes
   * to `link` and acts when its tick comes back; a sub-step runs only once
   * the tick before it is closed. Null goes back to the single player game.
   */
  setLockstep(link: LockstepLink | null, hashEvery?: number): void {
    this.lockstep.set(link, hashEvery);
    this.commandsHandler?.setLockstep(link);
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
    // Strike countdowns and impacts, in game time like the research
    for (const seat of this.abilitySeats) seat.update(stepMs);

    t0 = profiling ? performance.now() : 0;
    this.eventBus.processQueue();
    if (profiling) timings.tEvents += performance.now() - t0;

    const hasDebugEnemies = this.debugEnemies.size > 0;
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
        this.projectileManager,
      );
      this.towerCombat.updateBeamTowers(stepMs, this.towerManager, now);
      this.towerCombat.updateMeleeTowers(stepMs, this.towerManager, now);
      this.towerCombat.updateChainTowers(stepMs, this.towerManager, now);
      if (profiling) timings.tCombat += performance.now() - t0;
    }

    // The towers the players sit in: turn to the aim and fire, in and between waves
    for (const [, manned] of this.towerLifecycle.mannedTowers()) {
      const shot = this.towerCombat.updateMannedTower(manned, now, stepMs, this.projectileManager);
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
    return this.snapshots.refusal();
  }

  /** The simulation as plain data between waves (SimSnapshot), see SimSnapshots.capture */
  captureSnapshot(): SimSnapshot {
    return this.snapshots.capture();
  }

  /** Put the simulation back to `snapshot`, see SimSnapshots.restore */
  restoreSnapshot(snapshot: SimSnapshot, reason: 'replay' | 'live' = 'replay'): void {
    this.snapshots.restore(snapshot, reason);
  }

  /** Why the state now cannot be a wave snapshot, null when it can (wave-snapshot.ts) */
  waveSnapshotRefusal(): WaveSnapshotRefusal | null {
    return this.snapshots.waveRefusal();
  }

  /** The simulation at this sub-step boundary, a running wave included, see SimSnapshots.captureWave */
  captureWaveSnapshot(): WaveSnapshot {
    return this.snapshots.captureWave();
  }

  /** Put the simulation back to a wave snapshot, see SimSnapshots.restoreWave */
  restoreWaveSnapshot(snapshot: WaveSnapshot, reason: 'replay' | 'live' = 'live'): void {
    this.snapshots.restoreWave(snapshot, reason);
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
    setReplayMode: (on) => this.setReplayMode(on),
    replayCommand: (entry) => this.commandsHandler?.replay(entry),
    // Exact: a keyframe must not change the run it is taken from (HeroManager.captureState)
    captureWaveSnapshot: () => (this.snapshots.waveRefusal() === null ? this.snapshots.captureWave(true) : null),
    restoreWaveSnapshot: (snapshot) => this.snapshots.restoreWave(snapshot, 'replay'),
    applyLosMask: (towerId, mask) => {
      const tower = this.towerManager.getById(towerId);
      if (tower) this.towerLos.replayMask(tower, mask);
    },
    setBoundaryListener: (listener) => {
      this.boundaryListener = listener;
    },
  };

  /**
   * Take the show of the state before off the field (op `show.clear`): before
   * a snapshot restore, and after a replay's seek, whose skipped stretch
   * would otherwise play its numbers and strikes at once.
   */
  clearShow(): void {
    this.sink.show.clear();
  }

  /**
   * Announce what the simulation holds now, after a snapshot restore or a
   * replay's seek, which change it without the events that normally bring
   * its look and sound: the fire towers' furnaces (ops), the abilities'
   * state, and `sim:presented` with the numbers the main thread shows the
   * rest from (HQ fire, music and blood moon of the phase, status looks).
   */
  resyncPresentation(): void {
    this.towerManager.refreshInnerFires();
    const phase = this.waveManager.phase();
    const wave = this.waveManager.waveNumber();
    for (const seat of this.abilitySeats) seat.announceState();
    const alive = this.enemyManager.getAliveCount();
    this.eventBus.emit({
      type: 'sim:presented',
      phase,
      wave,
      credits: this.creditsOf(this.localPlayerId),
      baseHealth: this.baseHealth(),
      enemiesAlive: alive,
      waveEnemiesLeft: phase === 'wave'
        ? alive + this.enemyManager.getPendingSpawnCount() + this.waveManager.getEnemiesToSpawn()
        : 0,
    });
  }

  /** A key of the world the simulation runs on, see RouteWorld.key */
  worldKey(): string {
    return this.routeWorld.key();
  }

  /**
   * Re-simulation on or off: commands only from the log, the live listeners
   * muted (GameEventBus.onLive), a log of its own. Towers wait for their line
   * of sight as live; the logged masks answer them (TowerLos.replayMask).
   */
  private setReplayMode(on: boolean): void {
    this.replaying = on;
    // What records or mirrors the run stays out (GameEventBus.onLive)
    this.eventBus.setLiveMuted(on);
    this.replayLog = on ? new CommandLog(() => this.clock.subStep) : null;
    this.commandsHandler?.setReplaying(on);
    this.commandsHandler?.setLog(this.replayLog ?? this.commandLog);
  }

  /** Geo height of the ground under a position, from the route grid like the enemies' feet; 0 without it. */
  private groundHeightAt(lat: number, lon: number): number {
    if (!this.globalRouteGrid.isInitialized()) return 0;
    const sync = this.coords.sync;
    const local = sync.geoToLocalSimple(lat, lon, 0);
    const y = this.globalRouteGrid.getGroundLocalYAt(local.x, local.z);
    return y === null ? 0 : y + sync.getOrigin().height;
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
    // Nothing more comes out of the portals
    this.waveManager.stopSpawning();

    this.enemyManager.clear();
    this.debugEnemies.clear(); // Clear orphaned debug enemy references
    this.towerLifecycle.leaveAll();
  }

  // ============================================
  // Public API
  // ============================================

  /**
   * Start a new wave with config
   */
  startWave(config: WaveConfig): void {
    if (this.corridorPending()) return;
    // The preview shows one lane's wave and how many lanes get it (TODO E34)
    const perLane = config;
    let laneCount = 1;
    // Coop: the wave on every lane (D13). A config that already names its
    // spawn points (a replayed one) is laid out already.
    const lanes = this.room.laneSpawns;
    if (lanes.length > 0 && !config.schedule.entries.some((entry) => entry.spawnPointId !== undefined)) {
      config = { ...config, schedule: laneSchedule(config.schedule, lanes) };
      laneCount = lanes.length;
    }
    this.room.clearReady();
    if (!this.replaying && config.schedule.entries.length > 0) this.recordWaveStart(config);

    // Wave preview in the sidebar, see summarizeWaveGroups(); the live wave's only
    const groups = this.replaying ? [] : summarizeWaveGroups(laneCount > 1 ? perLane : config, laneCount, this.waveManager.waveNumber() + 1);
    if (groups.length > 0) {
      this.eventBus.emit({ type: 'wave:groups', groups });
    }

    // Emit lifecycle event BEFORE startWave() so that StateSnapshotService.clearHistory()
    // runs before wave:started sets up tracking (prevents NaN in wave history)
    if (!this.runStarted) {
      this.runStarted = true;
      this.eventBus.emit({ type: 'game:started' });
    }

    this.snapshots.waveStarted(config);
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

    // A wave without a plan: nothing spawns by itself, the wave snapshot carries no spawner
    this.snapshots.waveStarted({ schedule: { entries: [], baseDelay: 0 } });
    this.waveManager.beginWave();
  }

  /**
   * Heal base to full health
   */
  healBase(): void {
    this.healthLedger.resetToStart();
  }

  /** Debug: add (or take) base HP, emits health:changed. */
  adjustBaseHealth(amount: number): void {
    this.healthLedger.adjust(amount);
  }

  /**
   * The enemy debugger's cheats (debug:* commands, GameCommandsHandler), so
   * in coop they act at their tick on every client. Each changes the
   * simulation past the command log: the running wave does not re-simulate
   * any more.
   */
  debugKillAll(): void {
    this.taintByCheat('debug:kill-all');
    this.waveManager.killAll();
    this.eventBus.emit({ type: 'wave:cleared' });
    // All dead by now, splitting types included
    this.towerLifecycle.turnToGuardIfClear();
  }

  debugSpawnEnemy(event: Extract<GameEvent, { type: 'debug:spawn-enemy' }>): void {
    this.taintByCheat(event.type);
    for (const enemy of this.enemyManager.debugSpawn(event)) this.debugEnemies.add(enemy);
  }

  debugRemoveEnemy(enemyId: string): void {
    this.taintByCheat('debug:remove-enemy');
    this.enemyManager.debugRemove(enemyId);
    this.debugEnemies.remove(enemyId);
    this.towerLifecycle.turnToGuardIfClear();
  }

  /** Enemy Debug: walk, run, start or stop one enemy (debug:enemy-move); the main thread shows the clip */
  debugEnemyMove(enemyId: string, action: 'walk' | 'run' | 'start' | 'stop'): void {
    this.taintByCheat('debug:enemy-move');
    const enemy = this.enemyManager.getById(enemyId);
    if (!enemy) return;
    switch (action) {
      case 'walk':
      case 'run':
        enemy.setRunning(action === 'run');
        return;
      case 'start':
        if (enemy.alive) enemy.startMoving();
        return;
      case 'stop':
        enemy.stopMoving();
        return;
    }
  }

  /** Display option as a cheat: enemies stand still (debug:movement) */
  debugMovement(enabled: boolean): void {
    this.taintByCheat('debug:movement');
    this.setMovementEnabled(enabled);
  }

  /** Enemy Debug: the speed of one enemy, or of every enemy on the map (debug:enemy-speed) */
  debugEnemySpeed(enemyId: string | undefined, speedMps: number): void {
    this.taintByCheat('debug:enemy-speed');
    if (enemyId === undefined) {
      for (const enemy of this.enemyManager.getAll()) enemy.movement.speedMps = speedMps;
      return;
    }
    const enemy = this.enemyManager.getById(enemyId);
    if (enemy) enemy.movement.speedMps = speedMps;
  }

  private taintByCheat(type: string): void {
    if (!this.replaying) this.simRecorder.taint(type);
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
   * Full dispose — the simulation goes away.
   * Cleans up EventBus subscriptions that were registered in initialize().
   */
  dispose(): void {
    this.eventBusSubs.disposeAll();
    this.commandsHandler?.dispose();
    this.commandsHandler = null;

    this.combatEffect.destroy();

    // Polymorphic teardown: every sub-manager implements IGameManager.destroy.
    for (const m of this.subManagers) {
      m.destroy();
    }
    for (const seat of this.abilitySeats) seat.destroy();
    for (const seat of this.heroSeats) seat.destroy();
    this.globalRouteGrid.clear();
    this.worldReady = false;
    this.sink.effects.clear();
  }

  /**
   * Reset game to initial state (restart).
   * Does NOT dispose EventBus subscriptions — handlers stay active for the next game.
   * @param seed The run seed; a coop room hands every client the same one. A new one by default.
   */
  reset(seed?: number): void {
    // Take every tower off the grid before clearing towers
    this.towerLifecycle.clearAllOverlays();
    this.towerLos.newRun();

    // Stop all active beams/melee before clearing towers
    this.towerCombat.stopAllBeams();
    this.towerCombat.stopAllMelee();

    this.enemyManager.clear();
    this.debugEnemies.clear(); // Clear orphaned debug enemy references
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
    // has already been cleaned up per-tower via clearAllOverlays above.

    this.sink.effects.clear();
    // A killed ooze's collapsing band and debris outlive EnemyManager.clear(),
    // which every wave end runs as well; a restart or location change takes them
    this.sink.oozes.clear();

    this.healthLedger.resetToStart();
    this.creditsLedger.reset();
    this.clock.reset();
    // Coop: the new run goes on at the relay's next tick
    this.lockstep.newRun();
    // A new run is a new seed: leaving the streams running would make the
    // second run of a batch a different experiment than the first.
    this.rng.reset(seed);
    // Who left the room stays gone; a new roster (setPlayers) clears it
    this.room.clearReady();
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
  killCreditPlayer(killedBy: KilledBy | null): string {
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
   * After a range-stat upgrade (manual or debug-max-upgrade), ask for the
   * tower's LOS cells, refresh its range cache, range disc and guard heading.
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

  /** The tower `playerId` sits in, null when none (the packet's scalars). */
  mannedTowerOf(playerId: string): Tower | null {
    return this.towerLifecycle.mannedTower(playerId);
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
   * The enemy routes in use
   */
  getCachedRoutes(): RouteWaypoint[][] {
    return this.routeWorld.routes();
  }

  /**
   * Get EventBus for external subscriptions (e.g., game:over in UI components)
   */
  getEventBus(): GameEventBus {
    return this.eventBus;
  }

  /**
   * Get spawn points
   */
  getSpawnPoints(): SpawnPoint[] {
    return this.waveManager.spawnPoints;
  }

  /**
   * The enemy routes by spawn point id
   */
  getCachedPaths(): Map<string, GeoPosition[]> {
    return this.routeWorld.cachedPaths();
  }

  /**
   * Set the timescale
   * @param scale Timescale multiplier (1.0 = normal, 75.0 = 75x speed)
   */
  setGameSpeed(scale: number): void {
    this.gameSpeed.set(Math.max(0.1, Math.min(75, scale)));
  }
}
