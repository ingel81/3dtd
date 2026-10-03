/**
 * Bot Perception
 *
 * What a player learns from watching the last waves, kept for the bot
 * (docs/BOT_PLAYER_PLAN.md, B1): where on its routes enemies die, where they
 * get through and what they wear when they do, and what each of its towers
 * did. The session feeds it from the main thread's event bus; the
 * strategies read it through BotWorld.perception. Plain logic, no Angular, so
 * a spec drives it with made-up enemies.
 *
 * In coop the bot sees its own lanes only (`isOwnRoute`), like the rest of
 * its world (bot-world.ts).
 */

import type { ArmorType } from '../../configs/combat/combat.types';

/** Path stretches a route is cut into: 0 = spawn, LEAK_BINS - 1 = the stretch before the HQ */
export const LEAK_BINS = 10;

/** How many finished waves the bot remembers */
export const PERCEPTION_WAVES = 3;

/** The part of an enemy (EnemyView on the main thread) perception reads at its event */
export interface SeenEnemy {
  readonly id: string;
  readonly movement: { readonly routeId: string; getPathProgress(): number };
  readonly typeConfig: { readonly isAirUnit?: boolean };
  readonly health: { readonly maxHp: number };
  getEffectiveArmorType(): ArmorType;
}

/** The part of a tower perception reads at the end of a wave */
export interface SeenTower {
  readonly id: string;
  readonly combat: { readonly kills: number; readonly damageDealt: number };
}

/** One route in one wave */
export interface RouteWaveRecord {
  /** Kills per path stretch (LEAK_BINS) */
  readonly deaths: number[];
  /** Enemies that reached the HQ on this route */
  leaks: number;
}

/** One wave as the bot saw it */
export interface WaveRecord {
  readonly wave: number;
  /** Per route id (the spawn id) */
  readonly routes: Map<string, RouteWaveRecord>;
  kills: number;
  leaks: number;
  leakedAir: number;
  /** Coop: leaks on the partners' routes, per route id */
  readonly leaksElsewhere: Map<string, number>;
  /** Max HP of what got through, by the armor it wore */
  readonly leakedHpByArmor: Partial<Record<ArmorType, number>>;
}

/** What a tower did in the waves the bot remembers */
export interface TowerRecord {
  /** The first wave that ended with it standing */
  readonly firstWave: number;
  /** Kills and damage per finished wave, newest last, at most PERCEPTION_WAVES */
  readonly waves: { kills: number; damage: number }[];
}

/** A route that leaked in the remembered waves */
export interface LeakingRoute {
  readonly routeId: string;
  readonly leaks: number;
  /**
   * The path stretch (0 to 1) behind which the kills thin out: the start of
   * the first bin, counted from the HQ end, that holds a tenth of the route's
   * kills. Defense behind it is what the leaks were missing.
   */
  readonly thinFrom: number;
}

export class BotPerception {
  private readonly records: WaveRecord[] = [];
  private current: WaveRecord | null = null;
  private readonly towers = new Map<string, TowerRecord & { kills: number; damage: number }>();
  /** Ids counted as a leak already: an ooze leaks while it flows in and arrives later */
  private readonly leaked = new Set<string>();

  /** @param isOwnRoute whether an enemy on this route is the bot's to stop (coop: its lanes) */
  constructor(private readonly isOwnRoute: (routeId: string) => boolean = () => true) {}

  /** The finished waves, oldest first, at most PERCEPTION_WAVES */
  get waves(): readonly WaveRecord[] {
    return this.records;
  }

  /** The last finished wave, null before the first */
  get lastWave(): WaveRecord | null {
    return this.records.at(-1) ?? null;
  }

  /** What a tower did, null for one that has not seen a wave end */
  tower(id: string): TowerRecord | null {
    return this.towers.get(id) ?? null;
  }

  /** A new run: forget everything */
  reset(): void {
    this.records.length = 0;
    this.current = null;
    this.towers.clear();
    this.leaked.clear();
  }

  onWaveStarted(wave: number): void {
    // A restart or a wave jump back: what came before belongs to another run
    if (this.records.length > 0 && wave <= this.records.at(-1)!.wave) this.reset();
    this.current = {
      wave, routes: new Map(), kills: 0, leaks: 0, leakedAir: 0, leakedHpByArmor: {}, leaksElsewhere: new Map(),
    };
  }

  /** enemy:died; `killed` false when nobody gets the kill (a leak that dies on arrival) */
  onEnemyDied(enemy: SeenEnemy, killed: boolean): void {
    // An ooze that dies while it flows in was counted as a leak already
    if (this.leaked.delete(enemy.id) || !killed) return;
    const wave = this.current;
    const routeId = enemy.movement.routeId;
    if (!wave || !this.isOwnRoute(routeId)) return;
    const bin = Math.min(LEAK_BINS - 1, Math.max(0, Math.floor(enemy.movement.getPathProgress() * LEAK_BINS)));
    this.route(wave, routeId).deaths[bin]++;
    wave.kills++;
  }

  /** enemy:leaking: an ooze flows in, one leak however many events it takes */
  onEnemyLeaking(enemy: SeenEnemy): void {
    if (this.leaked.has(enemy.id)) return;
    this.leaked.add(enemy.id);
    this.bookLeak(enemy);
  }

  /** enemy:reached-base: a leak, unless it is an ooze that leaked already */
  onEnemyArrived(enemy: SeenEnemy): void {
    if (this.leaked.delete(enemy.id)) return;
    this.bookLeak(enemy);
  }

  /** The wave ended: book it and what each standing tower did in it */
  onWaveCompleted(standing: readonly SeenTower[]): void {
    const wave = this.current;
    if (!wave) return;
    this.current = null;
    this.leaked.clear();
    this.records.push(wave);
    if (this.records.length > PERCEPTION_WAVES) this.records.shift();

    const present = new Set<string>();
    for (const tower of standing) {
      present.add(tower.id);
      const { kills, damageDealt } = tower.combat;
      let record = this.towers.get(tower.id);
      if (!record) {
        record = { firstWave: wave.wave, waves: [], kills: 0, damage: 0 };
        this.towers.set(tower.id, record);
      }
      record.waves.push({ kills: kills - record.kills, damage: damageDealt - record.damage });
      if (record.waves.length > PERCEPTION_WAVES) record.waves.shift();
      record.kills = kills;
      record.damage = damageDealt;
    }
    for (const id of [...this.towers.keys()]) if (!present.has(id)) this.towers.delete(id);
  }

  /** Routes that leaked in the remembered waves, most leaks first */
  leakingRoutes(): LeakingRoute[] {
    const sums = new Map<string, { leaks: number; deaths: number[] }>();
    for (const wave of this.records) {
      for (const [routeId, route] of wave.routes) {
        let sum = sums.get(routeId);
        if (!sum) sums.set(routeId, sum = { leaks: 0, deaths: new Array(LEAK_BINS).fill(0) });
        sum.leaks += route.leaks;
        route.deaths.forEach((n, i) => sum!.deaths[i] += n);
      }
    }
    const out: LeakingRoute[] = [];
    for (const [routeId, sum] of sums) {
      if (sum.leaks === 0) continue;
      out.push({ routeId, leaks: sum.leaks, thinFrom: thinFrom(sum.deaths) });
    }
    return out.sort((a, b) => b.leaks - a.leaks);
  }

  private bookLeak(enemy: SeenEnemy): void {
    const wave = this.current;
    if (!wave) return;
    const routeId = enemy.movement.routeId;
    if (!this.isOwnRoute(routeId)) {
      wave.leaksElsewhere.set(routeId, (wave.leaksElsewhere.get(routeId) ?? 0) + 1);
      return;
    }
    this.route(wave, enemy.movement.routeId).leaks++;
    wave.leaks++;
    if (enemy.typeConfig.isAirUnit) wave.leakedAir++;
    const armor = enemy.getEffectiveArmorType();
    wave.leakedHpByArmor[armor] = (wave.leakedHpByArmor[armor] ?? 0) + enemy.health.maxHp;
  }

  private route(wave: WaveRecord, routeId: string): RouteWaveRecord {
    let route = wave.routes.get(routeId);
    if (!route) wave.routes.set(routeId, route = { deaths: new Array(LEAK_BINS).fill(0), leaks: 0 });
    return route;
  }
}

/** Start (0 to 1) of the stretch before the HQ in which fewer than a tenth of the kills fall */
function thinFrom(deaths: readonly number[]): number {
  const total = deaths.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  for (let bin = LEAK_BINS - 1; bin >= 0; bin--) {
    if (deaths[bin] >= total * 0.1) return (bin + 1) / LEAK_BINS;
  }
  return 0;
}
