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

  /**
   * Game state right after the wave resolved.
   *
   * The training backend treats this as the authoritative source for "did the
   * player survive" — `player.lives > 0`. It must be sent on the game-over path
   * too, otherwise the backend has to guess from the outcome alone.
   */
  stateAfter?: import('./game-state-snapshot').GameStateSnapshot;

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

  /**
   * Enemies a player ability killed (also counted in enemiesKilled). The
   * fairness gate books them as leaks, see gateLeakRatio.
   */
  abilityKills?: number;

  /** Total damage dealt to player lives */
  damageToPlayer: number;

  /** Damage as percentage of max lives (0-1) */
  damagePercent: number;

  // === TIMING ===

  /** How long the wave lasted in milliseconds */
  waveDurationMs: number;

  /**
   * Average time from spawn to death or base arrival, in milliseconds (game
   * time: divided by the training timescale). Enemies still alive when the
   * wave is finalised count up to that moment.
   */
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
