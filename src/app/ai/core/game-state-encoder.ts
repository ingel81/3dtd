/**
 * Game State Encoder
 *
 * Converts GameStateSnapshot to Float32Array for neural network input.
 * All values are normalized to 0-1 range.
 *
 * Feature Vector (74 features):
 * [0-3]   Player state: credits, lives%, wave, time (4)
 * [4]     towerCount (1)
 * [5]     avgTowerLevel (1)
 * [6-11]  Tower Type Counts: 6 types, normalized (6)
 * [12-16] History Damage: last 5 waves (5)
 * [17-21] History Progress: last 5 waves avg_progress (5)
 * [22-26] Wave Signals: momentum, avgDmg, duration, episodeProgress, variance (5)
 * [27-31] Context: wave, trend, skill, lastThreat, winStreak (5)
 * [32-33] Reserved/Padding (2)
 * [34-53] Ground DPS Profile: 20 bins (20)
 * [54-73] Air DPS Profile: 20 bins (20)
 */

import { GameStateSnapshot, RecentHistory } from './models/game-state-snapshot';
import { WaveConfig } from './models/wave-config';
import { NUM_BINS } from './dps-profile';

/** Total number of features in the encoded state */
export const ENCODED_STATE_SIZE = 74;

/** Number of scalar features (before spatial DPS profile) */
export const NUM_SCALAR_FEATURES = 34;

/** Tower types in fixed order for encoding */
const TOWER_TYPE_ORDER = ['archer', 'cannon', 'magic', 'dual-gatling', 'rocket', 'ice', 'poison'];

/**
 * Enemy threat ratings (relative to Zombie = 1.0).
 * Used for wave history aggregation — NOT for reward shaping.
 * Phase 5.5: expanded from 5 to all 16 enemies for full armor-type coverage.
 */
export const ENEMY_THREAT_RATING: Record<string, number> = {
  // Unarmored
  zombie: 1.0,              // Baseline: 80 HP, 5 m/s
  rat: 0.5,                 // Swarm, very low HP (5)
  penguin: 0.8,             // Very fast (9 m/s), fragile
  // Light
  wallsmasher: 3.5,         // High HP (200), fast
  bat: 1.5,                 // Air, low HP
  hornet: 2.0,              // Air + swarm
  spider: 2.0,              // Camo-teaser (no camo yet)
  // Heavy
  'zombie-soldier': 3.0,    // Heavy ground, fast
  tank: 4.0,                // Armored tank, 250 HP
  bear: 3.5,                // Tanky ground
  dragon: 8.0,              // Air-elite, 450 HP
  mech: 6.0,                // Heavy + future shielded
  // Fortified
  mammoth: 5.0,             // Very high HP (400), slow
  herbert: 50.0,            // Boss: 500 HP, 100% immunity
  // Ethereal
  ghost: 6.0,               // Ethereal, requires magic/ice
  wraith: 7.0,              // Ethereal-fast
};

/** Max values for normalization */
const MAX_VALUES = {
  credits: 5000,
  lives: 100,
  wave: 50,
  gameTime: 3600, // 1 hour
  towerCount: 30,
  towerLevel: 5,
  waveDuration: 300, // 5 minutes
  winStreak: 10,
  waveThreat: 100, // Max threat: 50 (Herbert) * 2 (multipliers)
};

/**
 * Calculate threat rating for a wave configuration
 *
 * @param waveConfig Wave configuration
 * @returns Threat rating (1.0 = baseline Zombie wave, 2.5 = Tank wave, 50.0 = Herbert)
 */
export function calculateWaveThreat(waveConfig: WaveConfig): number {
  if (!waveConfig?.enemies || waveConfig.enemies.length === 0) {
    return 0;
  }

  // Calculate weighted average threat based on enemy counts
  let totalThreat = 0;
  let totalCount = 0;

  for (const group of waveConfig.enemies) {
    const baseThreat = ENEMY_THREAT_RATING[group.type] || 1.0;

    // Apply multipliers to threat
    const healthMult = group.healthMultiplier || 1.0;
    const speedMult = group.speedMultiplier || 1.0;

    // Threat scales with HP and speed (HP more important)
    const adjustedThreat = baseThreat * (healthMult * 0.7 + speedMult * 0.3);

    totalThreat += adjustedThreat * group.count;
    totalCount += group.count;
  }

  return totalCount > 0 ? totalThreat / totalCount : 0;
}

/**
 * Encode game state to normalized Float32Array (74 features)
 */
export function encodeGameState(snapshot: GameStateSnapshot): Float32Array {
  const encoded = new Float32Array(ENCODED_STATE_SIZE);
  let idx = 0;

  // === PLAYER STATE (4 features) [0-3] ===
  encoded[idx++] = normalize(snapshot.player.credits, MAX_VALUES.credits);
  encoded[idx++] = snapshot.player.livesPercent;
  encoded[idx++] = normalize(snapshot.waveNumber, MAX_VALUES.wave);
  encoded[idx++] = normalize(snapshot.gameTimeSeconds, MAX_VALUES.gameTime);

  // === TOWER STATS (2 features) [4-5] ===
  encoded[idx++] = normalize(snapshot.defense.towerCount, MAX_VALUES.towerCount);
  encoded[idx++] = normalize(snapshot.defense.avgTowerLevel, MAX_VALUES.towerLevel);

  // === TOWER TYPE COUNTS (6 features) [6-11] ===
  for (const towerType of TOWER_TYPE_ORDER) {
    const stats = snapshot.defense.towerDistribution[towerType];
    encoded[idx++] = stats ? normalize(stats.count, 10) : 0;
  }

  // === HISTORY DAMAGE (5 features) [12-16] ===
  const history = snapshot.recentHistory;
  const damages = history.damagePerWave;
  for (let i = 0; i < 5; i++) {
    encoded[idx++] = damages[damages.length - 5 + i] ?? 0;
  }

  // === HISTORY PROGRESS (5 features) [17-21] ===
  const progresses = history.progressPerWave;
  for (let i = 0; i < 5; i++) {
    encoded[idx++] = progresses[progresses.length - 5 + i] ?? 0;
  }

  // === WAVE SIGNALS (5 features) [22-26] ===
  // [22] Damage momentum (positive = getting harder)
  const momentum = damages.length >= 2
    ? (damages[damages.length - 1] - damages[damages.length - 2]) * 10
    : 0;
  encoded[idx++] = Math.max(-1, Math.min(1, momentum));

  // [23] Average recent damage (last 5)
  const recent5 = damages.slice(-5);
  const avgRecent = recent5.length > 0 ? recent5.reduce((a, b) => a + b, 0) / recent5.length : 0;
  encoded[idx++] = Math.min(1, avgRecent);

  // [24] Wave duration (avg)
  encoded[idx++] = normalize(history.avgWaveDuration, MAX_VALUES.waveDuration);

  // [25] Episode progress (max 20 waves)
  encoded[idx++] = normalize(snapshot.waveNumber, 20);

  // [26] Damage variance (consistency signal)
  let damageVariance = 0;
  if (recent5.length >= 2) {
    const mean = avgRecent;
    const variance = recent5.reduce((sum, d) => sum + (d - mean) ** 2, 0) / recent5.length;
    damageVariance = Math.min(1, Math.sqrt(variance) * 10);
  }
  encoded[idx++] = damageVariance;

  // === CONTEXT (5 features) [27-31] ===
  encoded[idx++] = normalize(snapshot.waveNumber, MAX_VALUES.wave);
  encoded[idx++] = calculateDifficultyTrend(history);
  encoded[idx++] = estimatePlayerSkill(history);
  encoded[idx++] = normalize(history.lastWaveThreat, MAX_VALUES.waveThreat);
  encoded[idx++] = normalize(history.winStreak, MAX_VALUES.winStreak);

  // === RESERVED/PADDING (2 features) [32-33] ===
  encoded[idx++] = 0;
  encoded[idx++] = 0;

  // === DPS PROFILE: GROUND (20 features) [34-53] ===
  const profile = snapshot.dpsProfile;
  for (let i = 0; i < NUM_BINS; i++) {
    encoded[idx++] = profile.groundDPS[i] ?? 0;
  }

  // === DPS PROFILE: AIR (20 features) [54-73] ===
  for (let i = 0; i < NUM_BINS; i++) {
    encoded[idx++] = profile.airDPS[i] ?? 0;
  }

  return encoded;
}

/**
 * Decode neural network output to feature names (for debugging)
 */
export function decodeFeatureNames(): string[] {
  const names: string[] = [];

  // Player state [0-3]
  names.push('credits', 'lives', 'wave', 'gameTime');

  // Tower stats [4-5]
  names.push('towerCount', 'avgLevel');

  // Tower type counts [6-11]
  for (const type of TOWER_TYPE_ORDER) {
    names.push(`${type}_count`);
  }

  // History damage [12-16]
  for (let i = 1; i <= 5; i++) names.push(`damage_${i}`);

  // History progress [17-21]
  for (let i = 1; i <= 5; i++) names.push(`progress_${i}`);

  // Wave signals [22-26]
  names.push('momentum', 'avgDamage', 'duration', 'episodeProgress', 'variance');

  // Context [27-31]
  names.push('waveNorm', 'diffTrend', 'skill', 'lastWaveThreat', 'winStreak');

  // Reserved [32-33]
  names.push('reserved_0', 'reserved_1');

  // Ground DPS profile [34-53]
  for (let i = 0; i < NUM_BINS; i++) names.push(`ground_dps_${i}`);

  // Air DPS profile [54-73]
  for (let i = 0; i < NUM_BINS; i++) names.push(`air_dps_${i}`);

  return names;
}

/**
 * Normalize value to 0-1 range
 */
function normalize(value: number, max: number): number {
  return Math.min(1, Math.max(0, value / max));
}

/**
 * Calculate difficulty trend from damage history
 * Returns 0-1 where 0.5 = stable, >0.5 = increasing difficulty
 */
function calculateDifficultyTrend(history: RecentHistory): number {
  const damages = history.damagePerWave;
  if (damages.length < 2) return 0.5;

  // Compare recent average to older average
  const recent = damages.slice(-3);
  const older = damages.slice(0, -3);

  if (older.length === 0) return 0.5;

  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;

  // Trend: positive = getting harder
  const trend = recentAvg - olderAvg;

  // Map to 0-1 where 0.5 = no trend (scaled for sensitivity)
  return Math.min(1, Math.max(0, 0.5 + trend * 5));
}

/**
 * Estimate player skill from performance history
 * Returns 0-1 where higher = better player
 */
function estimatePlayerSkill(history: RecentHistory): number {
  const damages = history.damagePerWave;
  if (damages.length === 0) return 0.5; // Unknown

  // Average damage taken (lower = better)
  const avgDamage = damages.reduce((a, b) => a + b, 0) / damages.length;

  // Win streak bonus
  const streakBonus = Math.min(0.2, history.winStreak * 0.04);

  // Skill = inverse of damage + streak bonus
  return Math.min(1, Math.max(0, 1 - avgDamage + streakBonus));
}
