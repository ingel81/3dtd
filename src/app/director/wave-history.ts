/**
 * The last completed waves and the per-wave series the director reads from
 * them (damage, progress, near misses, enemy types), trimmed together.
 */

import { WaveResult } from './models/wave-result';
import { RecentHistory } from './models/game-state-snapshot';

/** Maximum number of waves to keep in history */
const MAX_HISTORY_SIZE = 10;

/** Path progress above which an enemy counts as a near miss. */
const NEAR_MISS_PROGRESS = 0.8;

export class WaveHistory {
  private waves: WaveResult[] = [];
  private damage: number[] = [];
  private progress: number[] = [];
  private nearMiss: number[] = [];
  private enemyTypes: string[][] = [];

  add(result: WaveResult): void {
    this.waves.push(result);
    this.damage.push(result.outcome.damagePercent);
    this.progress.push(result.outcome.avgPathProgressPercent);
    // Derive near-miss ratio from enemyProgressValues: fraction reaching >0.8
    const progressValues = result.outcome.enemyProgressValues ?? [];
    const nearMissRatio = progressValues.length > 0
      ? progressValues.filter((p) => p > NEAR_MISS_PROGRESS).length / progressValues.length
      : 0;
    this.nearMiss.push(nearMissRatio);
    this.enemyTypes.push(result.config.enemies.map((e) => e.type));

    // Trim to max size
    if (this.waves.length > MAX_HISTORY_SIZE) {
      this.waves.shift();
      this.damage.shift();
      this.progress.shift();
      this.nearMiss.shift();
      this.enemyTypes.shift();
    }
  }

  clear(): void {
    this.waves = [];
    this.damage = [];
    this.progress = [];
    this.nearMiss = [];
    this.enemyTypes = [];
  }

  /** Copy of the kept waves, oldest first. */
  all(): WaveResult[] {
    return [...this.waves];
  }

  /** The last `count` waves, oldest first. */
  recent(count: number): WaveResult[] {
    return this.waves.slice(-count);
  }

  /** The series and streaks the state snapshot carries. */
  summary(): RecentHistory {
    // Count win streak (consecutive waves with 0 damage)
    let winStreak = 0;
    for (let i = this.damage.length - 1; i >= 0; i--) {
      if (this.damage[i] === 0) {
        winStreak++;
      } else {
        break;
      }
    }

    // Count close call streak
    let closeCallStreak = 0;
    for (let i = this.waves.length - 1; i >= 0; i--) {
      if (this.waves[i].outcome.wasCloseCall) {
        closeCallStreak++;
      } else {
        break;
      }
    }

    // Average wave duration
    let avgDuration = 0;
    if (this.waves.length > 0) {
      const totalDuration = this.waves.reduce(
        (sum, w) => sum + w.outcome.waveDurationMs,
        0
      );
      avgDuration = totalDuration / this.waves.length / 1000; // Convert to seconds
    }

    return {
      damagePerWave: [...this.damage],
      progressPerWave: [...this.progress],
      nearMissPerWave: [...this.nearMiss],
      enemyTypesUsed: [...this.enemyTypes],
      avgWaveDuration: avgDuration,
      winStreak,
      closeCallStreak,
    };
  }
}
