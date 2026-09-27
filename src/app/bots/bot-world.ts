/**
 * Bot World
 *
 * What the bot strategies read from the game besides the snapshot: towers,
 * enemies, spawns and routes, the own hero and abilities, the dice. In the
 * single player game that is the whole game. In coop a bot is one player
 * (docs/COOP_PLAN.md, D6, D7): its own towers, its own lane and the enemies
 * on it, its own gold, and dice of its own, because every client draws the
 * run's `bot` stream into the state hash (C5) and only this client's bot
 * draws here.
 */

import type { GameStateManager } from '../managers/game-state.manager';
import type { SpawnPoint } from '../managers/wave.manager';
import type { Tower } from '../entities/tower.entity';
import type { Enemy } from '../entities/enemy.entity';
import type { AbilityManager } from '../managers/ability.manager';
import type { HeroManager } from '../managers/hero.manager';
import type { GeoPosition } from '../models/game.types';
import type { GameStateSnapshot } from '../director/models/game-state-snapshot';
import { analyzeDefense, analyzeVulnerabilities } from '../director/defense-analyzer';
import { mulberry32 } from '../utils/game-rng';

/** The part of the game the strategies read; the GameStateManager is one. */
export interface BotWorld {
  readonly rng: { stream(name: 'bot'): () => number };
  readonly towerManager: { getAll(): Tower[] };
  readonly enemyManager: { getAlive(): Enemy[] };
  readonly abilityManager: Pick<AbilityManager, 'checkUse' | 'previewSweep'>;
  readonly heroManager: Pick<HeroManager, 'getStatus' | 'getAnchor'>;
  readonly gameTimeMs: number;
  getSpawnPoints(): SpawnPoint[];
  getCachedPaths(): Map<string, GeoPosition[]>;
}

/** Two route starts closer than this, in degrees, are the same spawn (about 1 m) */
const SAME_POINT_DEG = 1e-5;

/**
 * The game as the bot of the player at this client sees it. Read on every
 * call, so one bot plays the single player game and, after a coop start in
 * the same tab, its own lane. With one player everything passes through.
 */
export class PlayerBotWorld implements BotWorld {
  /** Coop dice: seeded from the run seed and the player, redrawn with a new run */
  private coopDice: { seed: number; player: string; next: () => number } | null = null;
  private readonly coopStream = { stream: (_name: 'bot') => this.dice() };

  constructor(private readonly game: GameStateManager) {}

  /** More than one player in the run: a coop game */
  get coop(): boolean {
    return this.game.players.length > 1;
  }

  get rng(): { stream(name: 'bot'): () => number } {
    return this.coop ? this.coopStream : this.game.rng;
  }

  get towerManager(): { getAll(): Tower[] } {
    if (!this.coop) return this.game.towerManager;
    return { getAll: () => this.ownTowers() };
  }

  get enemyManager(): { getAlive(): Enemy[] } {
    if (!this.coop) return this.game.enemyManager;
    return { getAlive: () => this.enemiesOnOwnLane() };
  }

  /** The abilities and the hero of the player at this client, as the UI shows them */
  get abilityManager(): Pick<AbilityManager, 'checkUse' | 'previewSweep'> {
    return this.game.abilityManager;
  }

  get heroManager(): Pick<HeroManager, 'getStatus' | 'getAnchor'> {
    return this.game.heroManager;
  }

  get gameTimeMs(): number {
    return this.game.gameTimeMs;
  }

  /** Coop: the spawn of the own lane only; all spawns otherwise, or when this player has no lane */
  getSpawnPoints(): SpawnPoint[] {
    const all = this.game.getSpawnPoints();
    const lane = this.ownLane();
    return lane === null ? all : all.filter((spawn) => spawn.id === lane);
  }

  /** Coop: the route of the own lane only */
  getCachedPaths(): Map<string, GeoPosition[]> {
    const all = this.game.getCachedPaths();
    const lane = this.ownLane();
    if (lane === null) return all;
    const path = all.get(lane);
    return path ? new Map([[lane, path]]) : new Map();
  }

  /** The towers of the player at this client */
  ownTowers(): Tower[] {
    const me = this.game.localPlayerId;
    return this.game.towerManager.getAll().filter((tower) => tower.ownerId === me);
  }

  /** The spawn id of this player's lane; null outside coop or without a lane */
  private ownLane(): string | null {
    if (!this.coop) return null;
    return this.game.laneSpawnOf(this.game.localPlayerId);
  }

  /** Enemies whose route starts at the own lane's spawn; all of them without a lane */
  private enemiesOnOwnLane(): Enemy[] {
    const alive = this.game.enemyManager.getAlive();
    const lane = this.ownLane();
    const start = lane === null ? undefined : this.game.getCachedPaths().get(lane)?.[0];
    if (!start) return alive;
    return alive.filter((enemy) => {
      const first = enemy.movement.path[0];
      return first !== undefined
        && Math.abs(first.lat - start.lat) < SAME_POINT_DEG
        && Math.abs(first.lon - start.lon) < SAME_POINT_DEG;
    });
  }

  private dice(): () => number {
    const seed = this.game.rng.seed;
    const player = this.game.localPlayerId;
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
    const me = this.game.localPlayerId;
    const towers = this.ownTowers();
    const research = this.game.researchOf(me);
    const hero = this.game.heroOf(me).getDefenseProfile();
    const defense = analyzeDefense(towers, research.airTargetingUnlocked, hero);
    const credits = this.game.creditsOf(me);
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
