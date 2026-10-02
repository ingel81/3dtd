/**
 * Wave Config: what a wave source ships.
 *
 * The concrete enemy groups of one wave, how they spawn, and what the wave
 * says about itself (director/sources/).
 */

import type { DecisionExplanation } from '../wave-explanation';

export type { SpawnPattern } from '../spawn-schedule-builder';

/**
 * Single enemy group in a wave.
 */
export interface WaveEnemyGroup {
  /** Enemy type to spawn */
  type: string;

  /** Number of this enemy type */
  count: number;

  /** Health multiplier (default 1.0) */
  healthMultiplier?: number;

  /** Speed multiplier (default 1.0) */
  speedMultiplier?: number;

  /** Per-group spawn delay override in ms (overrides global baseDelay) */
  spawnDelay?: number;

  /**
   * Elites of the group: how many and their health multiplier (budget.ts,
   * ELITE_SHARE); the spawn schedule draws which ones.
   */
  elite?: { count: number; healthMultiplier: number };

  /** Camouflaged ones of the group (Enemy.camo): how many; the spawn schedule spreads them (markCamo) */
  camo?: { count: number };
}

/**
 * Complete wave configuration.
 */
export interface WaveConfig {
  // === ENEMY COMPOSITION ===

  /** List of enemy groups to spawn */
  enemies: WaveEnemyGroup[];

  /** Total enemy count (sum of all groups) */
  totalCount: number;

  // === SPAWN BEHAVIOR ===

  /** Base milliseconds between spawns */
  spawnDelay: number;

  /** Spawn delay variation (+/- this percentage, 0-0.5) */
  spawnDelayVariation?: number;

  /** Which spawn point to use (if multiple exist) */
  spawnPointIndex?: number;

  /**
   * Spawn-point selection mode for the runtime schedule.
   * 'each' = round-robin across spawn points; 'random' = uniform pick.
   * Default 'random' (used by AI Director + static campaign).
   */
  spawnMode?: 'each' | 'random';

  /**
   * false: the gaps are the wave's own, without the spawn floor per enemy
   * type (spawnFloorMs, E50). The custom wave of the debug panel sends it, so
   * a delay of 20 ms spawns every 20 ms.
   */
  spawnFloor?: false;

  // === METADATA ===

  /** AI confidence in this configuration (0-1) */
  confidence?: number;

  /** Why the director planned this wave. Absent for waves it did not plan. */
  explanation?: DecisionExplanation;

  /** Spawn pattern */
  pattern?: import('../spawn-schedule-builder').SpawnPattern;

  // === NAME AND STRENGTH ===

  /** Wave name for UI/dashboard display */
  templateName?: string;

  /** HP multiplier most of the wave got, for display */
  templateStrength?: number;
}

/**
 * Create a simple single-type wave config (utility for debug/fallback paths).
 */
export function createSimpleWaveConfig(
  enemyType: string,
  count: number,
  spawnDelay = 800
): WaveConfig {
  return {
    enemies: [{ type: enemyType, count }],
    totalCount: count,
    spawnDelay,
  };
}
