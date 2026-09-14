import type { GameEventBus, SubscriptionBag } from '../../game-engine/game-event-bus';
import type { Tower } from '../../entities/tower.entity';

/** Most towers the game-over summary lists */
export const RUN_TOP_TOWERS = 3;

/** One tower's share of a run */
export interface TowerRunStats {
  id: string;
  name: string;
  damageDealt: number;
  kills: number;
  /** Sold before the run ended; its numbers are from the moment of the sale */
  sold: boolean;
}

/** What a run came to, shown on the game-over screen */
export interface RunSummary {
  /** Wave the HQ fell in */
  waveReached: number;
  /** Enemies killed, by towers or anything else; an ooze killed while it flows into the HQ is a leak */
  kills: number;
  /** Kill rewards and wave bonuses; refunds and cheat credits left out */
  goldEarned: number;
  /** Towers, upgrades and research, minus what selling and cancelling gave back */
  goldSpent: number;
  /** Game time from the start of the run (build phase included) to the fall */
  durationMs: number;
  /**
   * Enemies that reached the HQ, index 0 = wave 1, one entry per wave up to
   * waveReached. An ooze counts once, from the first point that flows in.
   */
  leaksPerWave: number[];
  /** HP the HQ lost, same indexing as leaksPerWave */
  hqDamagePerWave: number[];
  /** Up to RUN_TOP_TOWERS towers with the most damage dealt, sold ones included */
  topTowers: TowerRunStats[];
}

/** Game time as m:ss, from an hour on as h:mm:ss */
export function formatRunTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const ss = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function towerStats(tower: Tower, sold: boolean): TowerRunStats {
  return {
    id: tower.id,
    name: tower.typeConfig.name,
    damageDealt: tower.combat.damageDealt,
    kills: tower.combat.kills,
    sold,
  };
}

/**
 * Collects a run's numbers from the event bus. Angular-free and cheap: a few
 * counters per event, no work per hit (the per-tower damage lives on the
 * tower, see CombatComponent.damageDealt). `game:reset` starts over, which
 * covers a restart and a location change.
 */
export class RunStatsTracker {
  private wave = 0;
  private kills = 0;
  private creditsIn = 0;
  private creditsOut = 0;
  private refunds = 0;
  private cheatCredits = 0;
  private leaks: number[] = [];
  private hqDamage: number[] = [];
  /** Oozes flowing into the HQ, counted as leaks at their first point */
  private readonly leaking = new Set<string>();
  private readonly liveTowers = new Map<string, Tower>();
  private soldTowers: TowerRunStats[] = [];

  /** Subscribe to the bus; the bag owns the subscriptions. */
  attach(bus: GameEventBus, bag: SubscriptionBag): void {
    bag.add(bus.on('wave:started', (e) => { this.wave = e.wave; }));
    // An ooze counts once: as a leak from its first point, not as a kill after it
    bag.add(bus.on('enemy:died', (e) => {
      if (!this.leaking.delete(e.enemy.id)) this.kills++;
    }));
    bag.add(bus.on('enemy:leaking', (e) => {
      if (this.leaking.has(e.enemy.id)) return;
      this.leaking.add(e.enemy.id);
      this.addToWave(this.leaks, 1);
    }));
    bag.add(bus.on('enemy:reached-base', (e) => {
      if (!this.leaking.delete(e.enemy.id)) this.addToWave(this.leaks, 1);
    }));
    bag.add(bus.on('health:changed', (e) => {
      if (e.delta < 0) this.addToWave(this.hqDamage, -e.delta);
    }));
    bag.add(bus.on('credits:changed', (e) => {
      if (e.delta > 0) this.creditsIn += e.delta;
      else this.creditsOut -= e.delta;
    }));
    bag.add(bus.on('research:cancelled', (e) => { this.refunds += e.refund; }));
    bag.add(bus.on('debug:add-credits', (e) => { this.cheatCredits += Math.max(0, e.amount); }));
    // The gold of the waves a dev jump skipped is cheat gold as well
    bag.add(bus.on('wave:jumped', (e) => { this.cheatCredits += e.credits; }));
    bag.add(bus.on('tower:placed', (e) => { this.liveTowers.set(e.tower.id, e.tower); }));
    bag.add(bus.on('tower:sold', (e) => {
      this.refunds += e.refund;
      this.soldTowers.push(towerStats(e.tower, true));
      this.liveTowers.delete(e.tower.id);
    }));
    bag.add(bus.on('game:reset', () => this.reset()));
  }

  reset(): void {
    this.wave = 0;
    this.kills = 0;
    this.creditsIn = 0;
    this.creditsOut = 0;
    this.refunds = 0;
    this.cheatCredits = 0;
    this.leaks = [];
    this.hqDamage = [];
    this.leaking.clear();
    this.liveTowers.clear();
    this.soldTowers = [];
  }

  /** The run so far. Towers still standing are read now. */
  summary(durationMs: number): RunSummary {
    const towers = [
      ...Array.from(this.liveTowers.values(), (t) => towerStats(t, false)),
      ...this.soldTowers,
    ]
      .filter((t) => t.damageDealt > 0 || t.kills > 0)
      .sort((a, b) => b.damageDealt - a.damageDealt || b.kills - a.kills);

    return {
      waveReached: this.wave,
      kills: this.kills,
      goldEarned: Math.max(0, this.creditsIn - this.refunds - this.cheatCredits),
      goldSpent: Math.max(0, this.creditsOut - this.refunds),
      durationMs,
      leaksPerWave: this.perWave(this.leaks),
      hqDamagePerWave: this.perWave(this.hqDamage),
      topTowers: towers.slice(0, RUN_TOP_TOWERS),
    };
  }

  /** Count into the running wave; outside any wave (debug enemies before wave 1) nothing is counted. */
  private addToWave(perWave: number[], amount: number): void {
    if (this.wave <= 0) return;
    perWave[this.wave - 1] = (perWave[this.wave - 1] ?? 0) + amount;
  }

  /** One entry per wave up to the current one, 0 where nothing happened */
  private perWave(perWave: number[]): number[] {
    return Array.from({ length: this.wave }, (_, i) => perWave[i] ?? 0);
  }
}
