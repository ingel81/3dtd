/**
 * Wave Result - Feedback for AI Training
 *
 * Captures what happened during a wave for reward calculation.
 * This is the "outcome" that the AI learns from.
 */

import { WaveConfig } from './wave-config';

export interface WaveResult {
  // === WAVE IDENTIFICATION ===
  waveNumber: number;
  timestamp: number;

  /** The wave configuration that was used */
  config: WaveConfig;

  /** The game state snapshot before the wave started */
  preWaveSnapshot?: import('./game-state-snapshot').GameStateSnapshot;

  // === OUTCOME METRICS ===
  outcome: WaveOutcome;

  // === COMPUTED REWARD (set by training backend or local) ===
  reward?: number;
}

export interface WaveOutcome {
  // === PRIMARY METRICS ===

  /** Total enemies spawned this wave */
  enemiesSpawned: number;

  /** Enemies killed by towers */
  enemiesKilled: number;

  /** Enemies that reached the base */
  enemiesReachedBase: number;

  /** Total damage dealt to player lives */
  damageToPlayer: number;

  /** Damage as percentage of max lives (0-1) */
  damagePercent: number;

  // === TIMING ===

  /** How long the wave lasted in milliseconds */
  waveDurationMs: number;

  /** Average enemy lifetime in milliseconds */
  avgEnemyLifetimeMs: number;

  /** Average path progress (0-1, where 1 = reached base) */
  avgPathProgressPercent: number;

  // === TENSION INDICATORS ===

  /** Lowest player health during the wave */
  lowestPlayerHealth: number;

  /** Player health dropped below 30% during wave */
  wasCloseCall: boolean;

  /** Player survived the wave */
  playerSurvived: boolean;

  // === PER-ENEMY PROGRESS DISTRIBUTION ===

  /** Raw path progress values for each enemy (0-1, where 1 = reached base) */
  enemyProgressValues: number[];

  // === PER-ENEMY-TYPE BREAKDOWN ===
  enemyPerformance: EnemyTypePerformance;

  // === TOWER PERFORMANCE ===
  towerPerformance?: TowerPerformance;
}

export type EnemyTypePerformance = Record<string, {
    spawned: number;
    killed: number;
    reachedBase: number;
    avgLifetimeMs: number;
    totalDamageDealt: number;
  }>;

export type TowerPerformance = Record<string, {
    towerType: string;
    kills: number;
    damageDealt: number;
    shotsFired: number;
    accuracy: number;
  }>;

/**
 * Create an empty wave result for initialization
 */
export function createEmptyWaveResult(waveNumber: number, config: WaveConfig): WaveResult {
  return {
    waveNumber,
    timestamp: Date.now(),
    config,
    outcome: {
      enemiesSpawned: 0,
      enemiesKilled: 0,
      enemiesReachedBase: 0,
      damageToPlayer: 0,
      damagePercent: 0,
      waveDurationMs: 0,
      avgEnemyLifetimeMs: 0,
      avgPathProgressPercent: 0,
      enemyProgressValues: [],
      lowestPlayerHealth: 100,
      wasCloseCall: false,
      playerSurvived: true,
      enemyPerformance: {},
    },
  };
}

/**
 * Calculate basic reward from wave result
 * This is a simplified version - full reward calculation happens in training backend
 */
export function calculateBasicReward(result: WaveResult): number {
  const { outcome } = result;
  let reward = 0;

  const damagePct = outcome.damagePercent;

  // Sweet spot: 10-30% damage
  if (damagePct >= 0.1 && damagePct <= 0.3) {
    reward = 1.0;
  } else if (damagePct < 0.1) {
    // Too easy
    reward = -0.5 * ((0.1 - damagePct) / 0.1);
  } else if (damagePct > 0.5) {
    // Too hard
    reward = -0.5 * ((damagePct - 0.5) / 0.5);
  } else {
    // Acceptable (0.3-0.5)
    reward = 0.5;
  }

  // Close call bonus
  if (outcome.wasCloseCall && outcome.playerSurvived) {
    reward += 0.3;
  }

  // Game over penalty
  if (!outcome.playerSurvived) {
    const earlyPenalty = Math.max(0, 1 - result.waveNumber / 10);
    reward -= 1.0 + earlyPenalty;
  }

  return reward;
}
