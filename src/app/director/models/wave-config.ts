/**
 * Wave Config — AI Output (Phase 5.10 Template-Based)
 *
 * Defines how a wave should be configured. This is what the Wave Director AI
 * produces after expanding a Template into concrete enemy groups.
 *
 * WaveArchetype was removed in Phase 5.10 — each Template is self-describing
 * (see src/app/director/templates.ts).
 */

import type { DecisionExplanation } from '../decision-explainer';

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

  // === METADATA ===

  /** AI confidence in this configuration (0-1) */
  confidence?: number;

  /** Why the director planned this wave. Absent for waves it did not plan. */
  explanation?: DecisionExplanation;

  /** Spawn pattern (from template.spawnPattern) */
  pattern?: import('../spawn-schedule-builder').SpawnPattern;

  // === PHASE 5.10 TEMPLATE METADATA ===

  /** Index of the chosen template (0..NUM_ACTIVE_TEMPLATES-1) */
  templateIdx?: number;

  /** Template name for UI/dashboard display */
  templateName?: string;

  /** Strength multiplier applied to the template (0.5..2.0) */
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
