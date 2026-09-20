/**
 * What happened during the running wave, for its WaveResult: enemy counts,
 * HP actually lost, the lowest health, per-enemy path progress and
 * lifetimes, and a per-enemy-type breakdown.
 *
 * Fed by the AI data collector's event handlers; finalize() turns it into a
 * WaveOutcome. Times are wall-clock ms handed in by the caller, so the
 * tracker never reads a clock itself.
 */

import { WaveOutcome } from './models/wave-result';
import { GAME_BALANCE } from '../configs/game-balance.config';

/** Close call threshold (health percentage) */
const CLOSE_CALL_THRESHOLD = 0.3;

/** How a wave ended: its enemies are gone, or the base fell during it. */
export type WaveEnd = 'completed' | 'base-destroyed';

export class WaveOutcomeTracker {
  private outcome: Partial<WaveOutcome> = {};
  private startTime = 0;
  private lowestHealth = 100;
  /** Spawn time of every enemy still on the field this wave. */
  private spawnTimes = new Map<string, number>();
  /** Summed lifetime of the enemies that already died or reached the base. */
  private endedLifetimeTotalMs = 0;
  private endedLifetimeCount = 0;
  private pathProgress = new Map<string, number>();
  /** Oozes already booked as leaks while they flow in, see enemyLeaking(). */
  private leaking = new Set<string>();

  /** A wave with `enemyCount` enemies started at `now`, the base at `baseHealth`. */
  start(enemyCount: number, baseHealth: number, now: number): void {
    this.startTime = now;
    this.lowestHealth = baseHealth;

    // Reset outcome tracking
    this.outcome = {
      enemiesSpawned: enemyCount,
      enemiesKilled: 0,
      enemiesReachedBase: 0,
      abilityKills: 0,
      damageToPlayer: 0,
      damagePercent: 0,
      waveDurationMs: 0,
      avgEnemyLifetimeMs: 0,
      avgPathProgressPercent: 0,
      lowestPlayerHealth: this.lowestHealth,
      wasCloseCall: false,
      playerSurvived: true,
      // Set from wave:completed by the collector; the fatal wave keeps false
      perfect: false,
      enemyPerformance: {},
    };

    this.clearEnemies();
  }

  /** Forget the running wave. The wave clock keeps its start. */
  reset(): void {
    this.outcome = {};
    this.lowestHealth = 100;
    this.clearEnemies();
  }

  /** Start the wave clock without a wave, as a new game does. */
  restartClock(now: number): void {
    this.startTime = now;
  }

  enemySpawned(enemyId: string, enemyType: string, now: number): void {
    // Track spawn time for lifetime calculation
    this.spawnTimes.set(enemyId, now);

    // Update per-enemy-type spawn count
    this.performanceOf(enemyType).spawned++;
  }

  /**
   * `progress` is the path progress at death, if the enemy had a movement
   * component. An ooze killed while it flows in was booked as a leak
   * (enemyLeaking) and is no kill.
   */
  enemyDied(enemyId: string, enemyType: string, progress: number | undefined, now: number): void {
    if (this.leaking.delete(enemyId)) return;
    this.outcome.enemiesKilled = (this.outcome.enemiesKilled || 0) + 1;

    // Track per-enemy-type performance
    this.performanceOf(enemyType).killed++;

    // Calculate lifetime
    const spawnTime = this.spawnTimes.get(enemyId);
    if (spawnTime) {
      this.updateTypeLifetime(enemyType, now - spawnTime);
    }
    this.endLifetime(enemyId, now);

    if (progress !== undefined) {
      this.pathProgress.set(enemyId, progress);
    }
  }

  /**
   * Split children count as spawned. `enemiesSpawned` starts at the wave's
   * announced size and is the backend's count of bodies, like the per-enemy
   * progress list the leak share is read from: every body the wave put on the
   * route, children included, so a leaked minion is a leak like any other.
   */
  enemiesSplit(childCount: number): void {
    this.outcome.enemiesSpawned = (this.outcome.enemiesSpawned || 0) + childCount;
  }

  /**
   * Enemies a player ability killed. The fairness gate books them as leaks
   * (leakRatio); their deaths already counted them as killed.
   */
  abilityKilled(kills: number): void {
    this.outcome.abilityKills = (this.outcome.abilityKills || 0) + kills;
  }

  /**
   * An ooze lost its first HP point into the base (enemy:leaking): it
   * reached the base and counts as a leak from here on, once. Its arrival
   * as a whole (enemy:reached-base) or its death halfway in adds nothing.
   */
  enemyLeaking(enemyId: string, enemyType: string, now: number): void {
    if (this.leaking.has(enemyId)) return;
    this.enemyReachedBase(enemyId, enemyType, now);
    this.leaking.add(enemyId);
  }

  enemyReachedBase(enemyId: string, enemyType: string, now: number): void {
    if (this.leaking.delete(enemyId)) return;
    this.outcome.enemiesReachedBase = (this.outcome.enemiesReachedBase || 0) + 1;

    // Track per-enemy-type performance
    this.performanceOf(enemyType).reachedBase++;

    // Enemies that reached base completed 100% of path
    this.pathProgress.set(enemyId, 1.0);
    this.endLifetime(enemyId, now);
  }

  /**
   * Health changed by `delta`. Only losses count as damage: this is the HP
   * actually lost, the figure the analysis is computed from.
   */
  healthChanged(health: number, delta: number): void {
    if (delta < 0) {
      this.outcome.damageToPlayer = (this.outcome.damageToPlayer || 0) - delta;
      this.outcome.damagePercent = (this.outcome.damageToPlayer || 0) / GAME_BALANCE.player.startHealth;
    }

    if (health < this.lowestHealth) {
      this.lowestHealth = health;
    }
  }

  /**
   * The outcome of the running wave at `now`, time metrics divided by the
   * training timescale. A normal end is a close call below 30% of the start
   * health; a wave that destroyed the base is one by definition and did not
   * leave the player alive.
   *
   * Returns the tracker's own outcome object, which reset() and start()
   * replace rather than clear.
   */
  finalize(end: WaveEnd, now: number, timescale: number): WaveOutcome {
    const outcome = this.outcome;

    outcome.waveDurationMs = (now - this.startTime) / timescale;
    outcome.lowestPlayerHealth = this.lowestHealth;
    if (end === 'base-destroyed') {
      outcome.playerSurvived = false;
      outcome.wasCloseCall = this.lowestHealth <= 0;
    } else {
      outcome.wasCloseCall = this.lowestHealth / GAME_BALANCE.player.startHealth < CLOSE_CALL_THRESHOLD;
    }

    outcome.avgEnemyLifetimeMs = this.averageLifetimeMs(now) / timescale;

    // Calculate path progress metrics. The per-enemy list matters as much as
    // the average: the bot server derives its near-miss ratio and
    // progress spread from it, and without it a fatal wave arrives with a
    // synthesised single-value distribution.
    if (this.pathProgress.size > 0) {
      const progressValues = Array.from(this.pathProgress.values());
      let totalProgress = 0;
      for (const progress of progressValues) {
        totalProgress += progress;
      }
      outcome.avgPathProgressPercent = totalProgress / progressValues.length;
      outcome.enemyProgressValues = progressValues;
    } else {
      outcome.avgPathProgressPercent = 0;
      outcome.enemyProgressValues = [];
    }

    // Normalize per-enemy-type lifetimes
    if (outcome.enemyPerformance) {
      for (const enemyType in outcome.enemyPerformance) {
        const perf = outcome.enemyPerformance[enemyType];
        if (perf.avgLifetimeMs > 0) {
          perf.avgLifetimeMs = perf.avgLifetimeMs / timescale;
        }
      }
    }

    return outcome as WaveOutcome;
  }

  private performanceOf(enemyType: string): WaveOutcome['enemyPerformance'][string] {
    const perf = this.outcome.enemyPerformance || {};
    if (!perf[enemyType]) {
      perf[enemyType] = {
        spawned: 0,
        killed: 0,
        reachedBase: 0,
        avgLifetimeMs: 0,
        totalDamageDealt: 0,
      };
    }
    this.outcome.enemyPerformance = perf;
    return perf[enemyType];
  }

  /** Running average over the killed enemies of this type. */
  private updateTypeLifetime(enemyType: string, lifetimeMs: number): void {
    const perf = this.outcome.enemyPerformance?.[enemyType];
    if (perf) {
      perf.avgLifetimeMs = (perf.avgLifetimeMs * (perf.killed - 1) + lifetimeMs) / perf.killed;
    }
  }

  /** An enemy left the field (died or reached the base): its lifetime is final. */
  private endLifetime(enemyId: string, now: number): void {
    const spawnTime = this.spawnTimes.get(enemyId);
    if (spawnTime === undefined) return;
    this.endedLifetimeTotalMs += now - spawnTime;
    this.endedLifetimeCount++;
    this.spawnTimes.delete(enemyId);
  }

  /**
   * Mean time from spawn to death or base arrival over this wave's enemies,
   * in wall-clock ms. Enemies still on the field count up to `now`. 0 for a
   * wave nothing spawned in.
   */
  private averageLifetimeMs(now: number): number {
    let total = this.endedLifetimeTotalMs;
    for (const spawnTime of this.spawnTimes.values()) {
      total += now - spawnTime;
    }
    const count = this.endedLifetimeCount + this.spawnTimes.size;
    return count > 0 ? total / count : 0;
  }

  private clearEnemies(): void {
    this.spawnTimes.clear();
    this.endedLifetimeTotalMs = 0;
    this.endedLifetimeCount = 0;
    this.pathProgress.clear();
    this.leaking.clear();
  }
}
