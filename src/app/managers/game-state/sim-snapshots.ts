import { GameObject } from '../../core/game-object';
import type { GameEventBus } from '../../game-engine';
import type { EnemyManager } from '../enemy.manager';
import type { ProjectileManager } from '../projectile.manager';
import type { TowerManager } from '../tower.manager';
import type { WaveConfig, WaveManager } from '../wave.manager';
import type { ResearchManager } from '../research.manager';
import type { AbilityManager } from '../ability.manager';
import type { HeroManager } from '../hero.manager';
import type { Tower } from '../../entities/tower.entity';
import type { Enemy } from '../../entities/enemy.entity';
import type { TowerTypeId } from '../../configs/tower-types.config';
import type { GeoPosition } from '../../models/game.types';
import type { EnemyDebugService } from '../../services/debug/enemy-debug.service';
import type { TowerCombatService } from '../../services/combat/tower-combat.service';
import type { TowerPlacementService } from '../../services/tower-placement.service';
import type { EconomyService } from '../../services/economy.service';
import type { ThreeTilesEngine } from '../../three-engine';
import type { GameClock } from './game-clock';
import type { GameRng } from '../../utils/game-rng';
import type { CreditsLedger } from './credits-ledger';
import type { BaseHealthLedger } from './base-health-ledger';
import type { TowerLifecycle } from './tower-lifecycle';
import { toPlainData } from './command-log';
import { SIM_SNAPSHOT_VERSION, type SavedTower, type SimSnapshot, type SnapshotRefusal } from '../../simulator/sim-snapshot';
import { WAVE_SNAPSHOT_VERSION, type WaveSnapshot, type WaveSnapshotRefusal } from '../../simulator/wave-snapshot';
import { losMaskToJson } from '../../utils/los-mask';

/** The parts of the GameStateManager a snapshot reads and writes */
export interface SnapshotWorld {
  readonly eventBus: GameEventBus;
  readonly clock: GameClock;
  readonly rng: GameRng;
  readonly creditsLedger: CreditsLedger;
  readonly healthLedger: BaseHealthLedger;
  readonly economy: EconomyService;
  readonly waveManager: WaveManager;
  readonly enemyManager: EnemyManager;
  readonly projectileManager: ProjectileManager;
  readonly towerManager: TowerManager;
  readonly towerLifecycle: TowerLifecycle;
  readonly towerPlacement: TowerPlacementService;
  readonly towerCombat: TowerCombatService;
  readonly enemyDebug: EnemyDebugService;
  /** Every player's research, abilities and hero in roster order */
  research(): readonly ResearchManager[];
  abilities(): readonly AbilityManager[];
  heroes(): readonly HeroManager[];
  researchOf(playerId: string): ResearchManager;
  abilityOf(playerId: string): AbilityManager;
  heroOf(playerId: string): HeroManager;
  players(): readonly string[];
  tilesEngine(): ThreeTilesEngine | null;
  /** A wave has started in this run (game:started went out) */
  runStarted(): boolean;
  setRunStarted(started: boolean): void;
}

/**
 * The snapshots of the GameStateManager: between waves (SimSnapshot, the
 * start of a re-simulated wave, docs/SIMULATOR_PLAN.md P4) and at any
 * sub-step boundary, a running wave included (WaveSnapshot, TODO E58).
 * Keeps the plan of the running wave, which only the wave snapshot reads.
 */
export class SimSnapshots {
  /** The config of the wave that started last, laid out on the lanes (the wave snapshot's plan) */
  private runningWaveConfig: WaveConfig | null = null;

  constructor(private readonly world: SnapshotWorld) {}

  /** A wave started with `config`; a plain wave (beginWave) with an empty schedule */
  waveStarted(config: WaveConfig): void {
    this.runningWaveConfig = toPlainData(config) as WaveConfig;
  }

  /** Why the state now cannot be a snapshot, null when it can: between waves, nothing in flight. */
  refusal(): SnapshotRefusal | null {
    const w = this.world;
    const phase = w.waveManager.phase();
    if (phase !== 'setup' && phase !== 'gameover') return 'not-setup';
    if (w.enemyManager.getAll().length > 0 || w.enemyDebug.debugEnemies().length > 0) return 'enemies';
    if (w.projectileManager.getAll().length > 0) return 'projectiles';
    if (w.abilities().some((seat) => seat.hasPendingStrikes())) return 'pending-strike';
    if (w.eventBus.hasDeferred) return 'pending-events';
    return null;
  }

  /**
   * The simulation as plain data (SimSnapshot). Only between waves, see
   * refusal. A hero on his way is put on a freshly planned path, the
   * one a restore plans too (HeroManager.captureState).
   */
  capture(): SimSnapshot {
    const w = this.world;
    const research = w.research();
    const abilities = w.abilities();
    const heroes = w.heroes();
    return {
      version: SIM_SNAPSHOT_VERSION,
      clock: w.clock.getState(),
      rng: w.rng.getState(),
      idCounter: GameObject.getIdCounter(),
      credits: w.creditsLedger.credits(),
      accounts: w.creditsLedger.saveAccounts(),
      baseHealth: w.healthLedger.baseHealth(),
      waveNumber: w.waveManager.waveNumber(),
      phase: w.waveManager.phase(),
      runStarted: w.runStarted(),
      economyPerfectStreak: w.economy.perfectStreak,
      research: research[0].getState(),
      researchByPlayer: research.map((seat) => [seat.owner.playerId, seat.getState()]),
      abilities: abilities[0].getState(),
      abilitiesByPlayer: abilities.map((seat) => [seat.owner.playerId, seat.getState()]),
      hero: heroes[0].captureState(),
      heroesByPlayer: heroes.map((seat) => [seat.owner.playerId, seat.captureState()]),
      towers: w.towerManager.getAll().map((tower) => saveTower(tower)),
      mannedTowerId: w.towerLifecycle.mannedTower(w.players()[0])?.id ?? null,
      mannedByPlayer: [...w.towerLifecycle.mannedTowers()].map(([playerId, tower]) => [playerId, tower.id]),
      losQueue: w.towerPlacement.queuedLosTowerIds(),
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
  restore(snapshot: SimSnapshot, reason: 'replay' | 'live'): void {
    if (snapshot.version !== SIM_SNAPSHOT_VERSION) {
      throw new Error(`Snapshot version ${snapshot.version}, expected ${SIM_SNAPSHOT_VERSION}`);
    }
    const w = this.world;
    // Nothing the state before sent may reach the state after (a replayed
    // wave's wave:completed in the live game)
    w.eventBus.clearDeferred();
    // Out of the tower and off the grid, then everything that moves
    w.towerLifecycle.clearAllOverlays();
    w.towerCombat.stopAllBeams();
    w.towerCombat.stopAllMelee();
    w.enemyManager.clear();
    w.enemyManager.resetKillRewards();
    w.enemyDebug.clearDebugEnemies();
    w.towerManager.clear();
    w.projectileManager.clear();
    w.waveManager.reset();
    for (const seat of w.abilities()) seat.reset();
    w.tilesEngine()?.oozes.clear();

    // Towers keep their ids: the id counter is set before each is built
    for (const saved of snapshot.towers) {
      GameObject.setIdCounter(idNumber(saved.id) - 1);
      w.towerLifecycle.restore(saved);
    }
    // After the towers: a research center built above counts its slots anew
    if (snapshot.researchByPlayer) {
      for (const [id, state] of snapshot.researchByPlayer) w.researchOf(id).restoreState(state);
    } else {
      w.research()[0].restoreState(snapshot.research);
    }
    if (snapshot.abilitiesByPlayer) {
      for (const [id, state] of snapshot.abilitiesByPlayer) w.abilityOf(id).restoreState(state);
    } else {
      w.abilities()[0].restoreState(snapshot.abilities);
    }
    if (snapshot.heroesByPlayer) {
      for (const [id, state] of snapshot.heroesByPlayer) w.heroOf(id).restoreState(state);
    } else {
      w.heroes()[0].restoreState(snapshot.hero);
    }

    const mannedIds: [string, string][] = snapshot.mannedByPlayer
      ?? (snapshot.mannedTowerId ? [[w.players()[0], snapshot.mannedTowerId]] : []);
    w.towerLifecycle.restoreManned(mannedIds.flatMap(([playerId, towerId]) => {
      const tower = w.towerManager.getById(towerId);
      return tower ? [[playerId, tower] as const] : [];
    }));
    w.towerPlacement.requeueLos(
      snapshot.losQueue.map((id) => w.towerManager.getById(id)).filter((tower): tower is Tower => !!tower),
    );

    w.creditsLedger.restore(snapshot.accounts ?? [[w.creditsLedger.players[0], snapshot.credits]]);
    w.healthLedger.restore(snapshot.baseHealth);
    w.economy.restorePerfectStreak(snapshot.economyPerfectStreak);
    w.waveManager.waveNumber.set(snapshot.waveNumber);
    w.waveManager.phase.set(snapshot.phase);
    w.setRunStarted(snapshot.runStarted);
    w.clock.setState(snapshot.clock);
    w.rng.setState(snapshot.rng);
    GameObject.setIdCounter(snapshot.idCounter);

    w.eventBus.emit({ type: 'sim:restored', reason });
  }

  /**
   * Why the state now cannot be a wave snapshot, null when it can
   * (wave-snapshot.ts). Between waves the answer is refusal()'s, but
   * for events waiting and shots in flight, which the wave snapshot carries.
   */
  waveRefusal(): WaveSnapshotRefusal | null {
    if (this.world.enemyDebug.debugEnemies().length > 0) return 'debug-enemies';
    return null;
  }

  /**
   * The simulation at this sub-step boundary as plain data, a running wave
   * included (wave-snapshot.ts, TODO E58). Throws where waveRefusal() says no.
   */
  captureWave(): WaveSnapshot {
    const w = this.world;
    const refusal = this.waveRefusal();
    if (refusal) throw new Error(`No wave snapshot now: ${refusal}`);
    const running = w.waveManager.phase() === 'wave';
    if (running && !this.runningWaveConfig) throw new Error('No wave snapshot now: the wave has no plan');
    const paths = [...w.waveManager.spawnPoints].map((point) => [point.id, w.waveManager.pathOf(point.id)] as const);
    const pathId = (path: readonly GeoPosition[]) => paths.find(([, p]) => p === path)?.[0] ?? null;
    const enemies = w.enemyManager.captureWaveState(pathId);
    // Targets no longer in the manager (a leak, a death animation over) that shots and towers still hold
    const ghosts = new Map<string, Enemy>();
    const held = (enemy: Enemy | null) => {
      if (enemy && w.enemyManager.getById(enemy.id) !== enemy) ghosts.set(enemy.id, enemy);
    };
    for (const projectile of w.projectileManager.getAll()) held(projectile.targetEnemy);
    for (const tower of w.towerManager.getAll()) held(tower.currentTarget);
    for (const seat of w.heroes()) held(seat.getTarget());
    const wave = w.waveManager.captureWaveState();
    return {
      version: WAVE_SNAPSHOT_VERSION,
      base: this.capture(),
      wave: {
        config: running ? this.runningWaveConfig! : { schedule: { entries: [], baseDelay: 0 } },
        spawner: wave.spawner,
        counters: wave.counters,
        enemies: { ...enemies, ghosts: [...ghosts.values()].map((enemy) => w.enemyManager.saveEnemy(enemy, pathId)) },
        projectiles: w.projectileManager.captureWaveState(),
        towerTargets: w.towerManager.getAll().flatMap((tower) => tower.currentTarget ? [[tower.id, tower.currentTarget.id] as [string, string]] : []),
        heroTargets: w.heroes().flatMap((seat) => {
          const target = seat.getTarget();
          return target ? [[seat.owner.playerId, target.id] as [string, string]] : [];
        }),
        strikes: w.abilities().map((seat) => [seat.owner.playerId, seat.captureWaveState()]),
        awaitingLos: w.towerPlacement.awaitingLosEntries(),
        deferred: w.eventBus.deferred.filter(plainEvent).map((event) => toPlainData(event)),
      },
    };
  }

  /**
   * Put the simulation back to a wave snapshot: first as between waves
   * (restore), then the running wave with its enemies, shots, targets,
   * spawner and the events waiting for the next sub-step.
   */
  restoreWave(snapshot: WaveSnapshot, reason: 'replay' | 'live'): void {
    if (snapshot.version !== WAVE_SNAPSHOT_VERSION) {
      throw new Error(`Wave snapshot version ${snapshot.version}, expected ${WAVE_SNAPSHOT_VERSION}`);
    }
    const w = this.world;
    this.restore(snapshot.base, reason);
    const wave = snapshot.wave;
    if (!wave) return;
    const beforeEach = (id: string) => GameObject.setIdCounter(idNumber(id) - 1);
    const pathOf = (id: string) => {
      const path = w.waveManager.pathOf(id);
      if (!path) throw new Error(`Wave snapshot: no route for spawn point ${id}`);
      return path;
    };
    this.runningWaveConfig = snapshot.base.phase === 'wave' ? wave.config : null;
    w.waveManager.restoreWaveState(wave.config, wave.spawner, wave.counters, snapshot.base.phase === 'wave');
    w.enemyManager.restoreWaveState(wave.enemies, pathOf, beforeEach);
    const ghosts = new Map<string, Enemy>();
    for (const saved of wave.enemies.ghosts) {
      beforeEach(saved.id);
      ghosts.set(saved.id, w.enemyManager.loadEnemy(saved, pathOf(saved.pathId)));
    }
    const enemy = (id: string) => w.enemyManager.getById(id) ?? ghosts.get(id) ?? null;
    w.projectileManager.restoreWaveState(wave.projectiles, enemy, beforeEach);
    for (const [towerId, targetId] of wave.towerTargets) w.towerManager.getById(towerId)?.restoreTarget(enemy(targetId));
    for (const [playerId, targetId] of wave.heroTargets) w.heroOf(playerId).restoreTarget(enemy(targetId));
    for (const [playerId, strikes] of wave.strikes) w.abilityOf(playerId).restoreWaveState(strikes, enemy);
    w.towerPlacement.restoreAwaitingLos(wave.awaitingLos.flatMap(([towerId, reason]) => {
      const tower = w.towerManager.getById(towerId);
      return tower ? [[tower, reason] as const] : [];
    }));
    for (const event of wave.deferred) w.eventBus.emitDeferred(event as never);
    GameObject.setIdCounter(snapshot.base.idCounter);
  }
}

function saveTower(tower: Tower): SavedTower {
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

/** An event of plain data: no entity in it (a footstep's enemy), so a wave snapshot can carry it */
function plainEvent(event: object): boolean {
  const walk = (value: unknown): boolean => {
    if (value instanceof GameObject) return false;
    if (value === null || typeof value !== 'object') return typeof value !== 'function';
    return Object.values(value).every(walk);
  };
  return walk(event);
}

/** The number of an entity id (`tower-12` gives 12), see GameObject.generateId. */
function idNumber(id: string): number {
  return Number(id.slice(id.lastIndexOf('-') + 1));
}
