import { signal } from '@angular/core';
import type { GameEventBus, SubscriptionBag } from '../game-engine';
import type { GameStateManager } from '../managers/game-state.manager';
import type { Enemy } from '../entities/enemy.entity';
import type { CoopSummaryRow } from './coop.service';

/** A player's counts over a coop run */
interface PlayerCounts {
  kills: number;
  towers: number;
  goldGiven: number;
  leaks: number;
}

/** What the run counts read of the CoopService */
export interface CoopRunCountsHost {
  readonly gameState: GameStateManager;
  inGame(): boolean;
  /** The players of the running game in roster order, with their lanes */
  roster(): readonly { id: string; name: string; spawnId: string | null }[];
  playerId(): string | null;
  leftIds(): ReadonlySet<string>;
  /** A player's lane colour as CSS */
  laneColorOf(playerId: string): string;
}

/**
 * Each player's part of a coop run (review R16, R15): kills, towers, gold
 * given and leaks through their lane, the leaks of the running wave per lane
 * and the table the game-over screen shows. Counted from the live events
 * every client runs alike.
 */
export class CoopRunCounts {
  /** The game-over table, null until the game is over */
  readonly summary = signal<CoopSummaryRow[] | null>(null);
  /** Enemies through each player's lane in the running wave (review R15) */
  readonly waveLeaks = signal<ReadonlyMap<string, number>>(new Map());
  private readonly counts = new Map<string, PlayerCounts>();

  constructor(private readonly host: CoopRunCountsHost) {}

  /** Count from the game's events into `subs` */
  wire(bus: GameEventBus, subs: SubscriptionBag): void {
    const host = this.host;
    subs.add(bus.onLive('enemy:died', ({ killedBy }) => {
      if (host.inGame() && killedBy && killedBy.kind !== 'debug') this.countFor(host.gameState.killCreditPlayer(killedBy)).kills++;
    }));
    subs.add(bus.onLive('tower:placed', ({ tower }) => {
      if (host.inGame()) this.countFor(tower.ownerId).towers++;
    }));
    // Pressure per lane (review R15): whose lane an enemy leaked from. An
    // ooze flows into the base point by point (enemy:leaking) and counts once,
    // as in the run log.
    const leaking = new Set<string>();
    const countLeak = (enemy: Enemy): void => {
      if (!host.inGame()) return;
      const owner = this.laneOwnerOf(enemy.movement.path);
      if (!owner) return;
      this.countFor(owner).leaks++;
      this.waveLeaks.update((leaks) => new Map(leaks).set(owner, (leaks.get(owner) ?? 0) + 1));
    };
    subs.add(bus.onLive('enemy:leaking', ({ enemy }) => {
      if (leaking.has(enemy.id)) return;
      leaking.add(enemy.id);
      countLeak(enemy);
    }));
    subs.add(bus.onLive('enemy:reached-base', ({ enemy }) => {
      if (leaking.delete(enemy.id)) return;
      countLeak(enemy);
    }));
    subs.add(bus.onLive('enemy:died', ({ enemy }) => { leaking.delete(enemy.id); }));
    subs.add(bus.onLive('wave:started', () => {
      if (this.waveLeaks().size > 0) this.waveLeaks.set(new Map());
    }));
    subs.add(bus.onLive('game:over', () => {
      if (!host.inGame()) return;
      this.summary.set(host.roster().map((p) => ({
        id: p.id,
        name: p.name,
        me: p.id === host.playerId(),
        left: host.leftIds().has(p.id),
        color: host.laneColorOf(p.id),
        gold: host.gameState.creditsOf(p.id),
        ...(this.counts.get(p.id) ?? { kills: 0, towers: 0, goldGiven: 0, leaks: 0 }),
      })));
    }));
  }

  /** `from` gave `amount` gold to a partner */
  giftGiven(from: string, amount: number): void {
    this.countFor(from).goldGiven += amount;
  }

  /** A new game or out of the room: the counts and the table go */
  clear(): void {
    this.counts.clear();
    this.summary.set(null);
  }

  /** A new run in the room (game:reset): the counts, the table and the wave's leaks go */
  newRun(): void {
    this.clear();
    this.waveLeaks.set(new Map());
  }

  private countFor(playerId: string): PlayerCounts {
    let count = this.counts.get(playerId);
    if (!count) {
      count = { kills: 0, towers: 0, goldGiven: 0, leaks: 0 };
      this.counts.set(playerId, count);
    }
    return count;
  }

  /**
   * The player whose lane `path` is: an enemy walks the route array of the
   * spawn it came out of (its children too), the lane of that spawn is theirs
   */
  private laneOwnerOf(path: readonly unknown[]): string | null {
    for (const [spawnId, route] of this.host.gameState.getCachedPaths()) {
      if (route !== path) continue;
      return this.host.roster().find((p) => p.spawnId === spawnId)?.id ?? null;
    }
    return null;
  }
}
