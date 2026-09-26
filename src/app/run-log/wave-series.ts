/**
 * Each player's run wave by wave, for the charts on the game-over screen
 * (TODO E46): kills, towers standing, gold earned, and the HQ's health.
 *
 * The run log is this player's run only; these series hold every player of
 * a coop run, as every client runs the same simulation.
 */

import type { GameEventBus, SubscriptionBag } from '../game-engine/game-event-bus';
import type { KilledBy } from '../game-engine/events/event-types';

/** One player's numbers at the end of a wave, counted from the start of the run */
export interface PlayerWaveNumbers {
  kills: number;
  /** Towers standing at that moment */
  towers: number;
  /** Kill gold and wave bonuses; gifts, refunds and cheats left out */
  goldEarned: number;
}

/** The end of a wave, or the fall of the HQ inside one */
export interface WaveSeriesPoint {
  wave: number;
  hqHealth: number;
  players: Readonly<Record<string, PlayerWaveNumbers>>;
}

/** What the recorder reads of the game */
export interface WaveSeriesWorld {
  players: () => readonly string[];
  /** Who a kill's gold went to (GameStateManager.killCreditPlayer) */
  killCredit: (killedBy: KilledBy) => string;
  towersOf: (playerId: string) => number;
  hqHealth: () => number;
}

/** Sources of credits:changed that count as earned (RunSummary.goldEarned uses the same) */
const EARNED = new Set(['kill', 'wave-bonus']);

export class WaveSeriesRecorder {
  private readonly kills = new Map<string, number>();
  private readonly earned = new Map<string, number>();
  private wave = 0;
  private list: WaveSeriesPoint[] = [];

  /** The points so far, one per finished wave, and the fall */
  get points(): readonly WaveSeriesPoint[] {
    return this.list;
  }

  attach(bus: GameEventBus, subs: SubscriptionBag, world: WaveSeriesWorld): void {
    subs.add(bus.onLive('enemy:died', ({ killedBy }) => {
      if (!killedBy || killedBy.kind === 'debug') return;
      const id = world.killCredit(killedBy);
      this.kills.set(id, (this.kills.get(id) ?? 0) + 1);
    }));
    subs.add(bus.onLive('credits:changed', ({ playerId, delta, source }) => {
      if (delta > 0 && EARNED.has(source)) this.earned.set(playerId, (this.earned.get(playerId) ?? 0) + delta);
    }));
    subs.add(bus.onLive('wave:started', ({ wave }) => { this.wave = wave; }));
    subs.add(bus.onLive('wave:completed', ({ wave }) => this.mark(wave, world)));
    // The wave the HQ fell in has no wave:completed
    subs.add(bus.onLive('game:over', () => {
      if (this.wave > 0 && this.list.at(-1)?.wave !== this.wave) this.mark(this.wave, world);
    }));
    subs.add(bus.onLive('game:reset', () => this.reset()));
  }

  reset(): void {
    this.kills.clear();
    this.earned.clear();
    this.wave = 0;
    this.list = [];
  }

  private mark(wave: number, world: WaveSeriesWorld): void {
    const players: Record<string, PlayerWaveNumbers> = {};
    for (const id of world.players()) {
      players[id] = { kills: this.kills.get(id) ?? 0, towers: world.towersOf(id), goldEarned: Math.round(this.earned.get(id) ?? 0) };
    }
    // A new array, so a signal holding it sees the change
    this.list = [...this.list, { wave, hqHealth: world.hqHealth(), players }];
  }
}
