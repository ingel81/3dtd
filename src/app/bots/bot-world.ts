/**
 * Bot World
 *
 * What the bot strategies read from the game besides the snapshot: towers,
 * enemies, spawns and routes, the own hero and abilities, the dice. The bot
 * runs on the main thread and reads the mirror of the simulation
 * (docs/SIM_WORKER.md): shadow towers, enemy views, the statuses the events
 * carried; spawns and routes are the main thread's. In the single player
 * game that is the whole game. In coop a bot is one player (docs/COOP_PLAN.md,
 * D6, D7): its own towers, its own lane and the enemies on it, its own gold,
 * and dice of its own, seeded from the run seed and the player.
 */

import type { SpawnPoint } from '../managers/wave.manager';
import type { Tower } from '../entities/tower.entity';
import type { EnemyView } from '../sim/client/views';
import type { SimMirror } from '../sim/client/mirror/sim-mirror';
import type { RouteQueriesService } from '../services/route-queries.service';
import type { AbilityId, AbilityRejectReason } from '../configs/abilities.config';
import type { HeroStatus } from '../configs/hero.config';
import type { RouteSweep } from '../utils/route-sweep';
import type { GeoPosition } from '../models/game.types';
import type { GameStateSnapshot } from '../director/models/game-state-snapshot';
import type { WavePeekFacts, WavePeekRequest } from '../director/wave-source';
import { BotPerception } from './perception/bot-perception';
import { analyzeDefense, analyzeVulnerabilities } from '../director/defense-analyzer';
import { mulberry32 } from '../utils/game-rng';

/** The part of the game the strategies read. */
export interface BotWorld {
  readonly rng: { stream(name: 'bot'): () => number };
  readonly towerManager: { getAll(): Tower[] };
  readonly enemyManager: { getAlive(): EnemyView[] };
  readonly abilityManager: {
    /** Why a use would be refused now (the mirror's ability status), null when it would go through */
    checkUse(id: AbilityId): AbilityRejectReason | null;
    /** The route stretch a beam would burn along (RouteQueriesService.previewSweep) */
    previewSweep(id: AbilityId, target: GeoPosition, lengthM?: number): RouteSweep | null;
  };
  readonly heroManager: {
    getStatus(): HeroStatus;
    /** The spot he was sent to and holds, null until hired */
    getAnchor(): GeoPosition | null;
  };
  readonly gameTimeMs: number;
  /** What the bot learned from the last waves: leaks, kills by stretch, tower records (B1) */
  readonly perception: BotPerception;
  /** The coming waves as the wave panel shows them (WaveDirector.peek) */
  peekWaves(fromWave: number, count: number): readonly WavePeekFacts[];
  /** Metres of the own routes each tower has under fire, ground and air, averaged over them (metersUnderFire) */
  metresByTower(): ReadonlyMap<string, { ground: number; air: number }>;
  getSpawnPoints(): SpawnPoint[];
  getCachedPaths(): Map<string, GeoPosition[]>;
}

/** What PlayerBotWorld reads: the mirror, the main thread's spawns and routes, the route queries */
export interface PlayerBotWorldSource {
  mirror: Pick<SimMirror,
    'players' | 'localPlayerId' | 'rng' | 'scalars' | 'towers' | 'aliveEnemies' | 'checkUse' | 'heroStatus'
    | 'heroAnchor' | 'laneSpawnsOf' | 'researchOf' | 'heroDefenseProfile' | 'creditsOf' | 'gameTimeMs'>;
  spawnPoints(): SpawnPoint[];
  paths(): Map<string, GeoPosition[]>;
  routes: Pick<RouteQueriesService, 'previewSweep'>;
  /** The wave source's look ahead, the wave panel's NEXT (WaveDirector.peek) */
  peek(request: WavePeekRequest): WavePeekFacts[];
  /** Metres under fire per tower on these routes (GlobalRouteGridService.metersUnderFire) */
  metresUnderFire(routes: GeoPosition[][]): ReadonlyMap<string, { ground: number; air: number }>;
}

/**
 * The game as the bot of the player at this client sees it. Read on every
 * call, so one bot plays the single player game and, after a coop start in
 * the same tab, its own lane. With one player everything passes through.
 */
export class PlayerBotWorld implements BotWorld {
  /** Coop dice: seeded from the run seed and the player, redrawn with a new run */
  private coopDice: { seed: number; player: string; next: () => number } | null = null;
  private readonly coopStream = { stream: (_name: 'bot') => this.dice() };
  /** Its own lanes only in coop, read at each event: a coop start in the same tab narrows it */
  readonly perception = new BotPerception((routeId) => this.ownLanes()?.has(routeId) ?? true);

  constructor(private readonly source: PlayerBotWorldSource) {}

  private get mirror(): PlayerBotWorldSource['mirror'] {
    return this.source.mirror;
  }

  /** More than one player in the run: a coop game */
  get coop(): boolean {
    return this.mirror.players.length > 1;
  }

  /** The run's `bot` stream on the main thread (SimMirror.rng), in coop this player's own dice */
  get rng(): { stream(name: 'bot'): () => number } {
    return this.coop ? this.coopStream : this.mirror.rng;
  }

  get towerManager(): { getAll(): Tower[] } {
    if (!this.coop) return { getAll: () => [...this.mirror.towers()] };
    return { getAll: () => this.ownTowers() };
  }

  get enemyManager(): { getAlive(): EnemyView[] } {
    if (!this.coop) return { getAlive: () => [...this.mirror.aliveEnemies()] };
    return { getAlive: () => this.enemiesOnOwnLane() };
  }

  /** The abilities and the hero of the player at this client, as the UI shows them */
  get abilityManager(): BotWorld['abilityManager'] {
    return {
      checkUse: (id) => this.mirror.checkUse(id),
      previewSweep: (id, target, lengthM) => this.source.routes.previewSweep(id, target, lengthM),
    };
  }

  get heroManager(): BotWorld['heroManager'] {
    return {
      getStatus: () => this.mirror.heroStatus(),
      getAnchor: () => this.mirror.heroAnchor(),
    };
  }

  get gameTimeMs(): number {
    return this.mirror.gameTimeMs;
  }

  peekWaves(fromWave: number, count: number): readonly WavePeekFacts[] {
    return this.source.peek({ fromWave, count });
  }

  metresByTower(): ReadonlyMap<string, { ground: number; air: number }> {
    return this.source.metresUnderFire([...this.getCachedPaths().values()]);
  }

  /** Coop: the spawns of the own lanes only; all spawns otherwise, or when this player has no lane */
  getSpawnPoints(): SpawnPoint[] {
    const all = this.source.spawnPoints();
    const lanes = this.ownLanes();
    return lanes === null ? all : all.filter((spawn) => lanes.has(spawn.id));
  }

  /** Coop: the routes of the own lanes only */
  getCachedPaths(): Map<string, GeoPosition[]> {
    const all = this.source.paths();
    const lanes = this.ownLanes();
    if (lanes === null) return all;
    return new Map([...all].filter(([id]) => lanes.has(id)));
  }

  /** The towers of the player at this client */
  ownTowers(): Tower[] {
    const me = this.mirror.localPlayerId;
    return this.mirror.towers().filter((tower) => tower.ownerId === me);
  }

  /** The spawn ids of this player's lanes; null outside coop or without a lane */
  private ownLanes(): ReadonlySet<string> | null {
    if (!this.coop) return null;
    const lanes = this.mirror.laneSpawnsOf(this.mirror.localPlayerId);
    return lanes.length > 0 ? new Set(lanes) : null;
  }

  /** Enemies on the routes of the own lanes' spawns; all of them without a lane */
  private enemiesOnOwnLane(): EnemyView[] {
    const alive = [...this.mirror.aliveEnemies()];
    const lanes = this.ownLanes();
    if (lanes === null) return alive;
    return alive.filter((enemy) => lanes.has(enemy.movement.routeId));
  }

  private dice(): () => number {
    const seed = this.mirror.scalars.seed;
    const player = this.mirror.localPlayerId;
    if (!this.coopDice || this.coopDice.seed !== seed || this.coopDice.player !== player) {
      this.coopDice = { seed, player, next: mulberry32(seed ^ playerSalt(player)) };
    }
    return this.coopDice.next;
  }

  /**
   * The snapshot as this player's bot reads it. In coop the director's
   * snapshot has the credits of all players and the joint defense, shared out
   * per lane; a bot that read it spent gold it did not have and left its lane
   * to the partner's towers. Here: its own credits, and the defense and gaps
   * of its own towers and hero. Research is the own one already (the
   * ResearchStore follows the local player). The single player snapshot
   * passes through as it is.
   */
  view(snapshot: GameStateSnapshot): GameStateSnapshot {
    if (!this.coop) return snapshot;
    const me = this.mirror.localPlayerId;
    const towers = this.ownTowers();
    const research = this.mirror.researchOf(me);
    const hero = this.mirror.heroDefenseProfile(me);
    const defense = analyzeDefense(towers, research.airTargetingUnlocked, hero);
    const credits = this.mirror.creditsOf(me);
    return {
      ...snapshot,
      player: { ...snapshot.player, credits },
      defense,
      vulnerabilities: analyzeVulnerabilities(towers, defense.capabilities),
    };
  }
}

/** fnv1a over the player id: two bots of one run roll different dice */
function playerSalt(playerId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < playerId.length; i++) {
    h ^= playerId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
