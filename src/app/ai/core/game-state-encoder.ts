/**
 * Game State Encoder
 *
 * Converts GameStateSnapshot to Float32Array for neural network input.
 * All values are normalized to 0-1 range.
 *
 * Feature Vector (156 features, Gap-5 Fix — +10 armor-matrix features):
 * [0-3]    Player state: credits, lives%, wave, time (4)
 * [4]      towerCount (1)
 * [5]      avgTowerLevel (1)
 * [6-14]   Tower Type Counts: 9 types (archer, cannon, magic, dual-gatling, rocket, ice, fire, tentacle, poison) (9)
 * [15-19]  History Damage: last 5 waves (5)
 * [20-24]  History Progress: last 5 waves avg_progress (5)
 * [25-29]  Wave Signals: momentum, avgDmg, duration, episodeProgress, variance (5)
 * [30-34]  Context: wave, trend, skill, lastThreat, winStreak (5)
 * [35-41]  DPS by Damage Type: physical, pierce, siege, magic, fire, ice, poison (7)
 * [42-46]  Enemy Armor Distribution: unarmored, light, heavy, fortified, ethereal (5)
 * [47-51]  Research State: completedRatio, centerLevel/3, slotsUsed/maxSlots, airTargeting, maxTier/3 (5)
 * [52]     Reserved/Padding (1)
 * === PHASE 5.6 awareness block ===
 * [53-68]  Types-History: frequency of each of 16 enemy types in last 5 waves (16)
 * [69-73]  Armor-History: frequency of each armor category in last 5 waves (5)
 * [74-78]  Damage-Pct-History: explicit last 5 damage percentages (5)
 * [79-87]  Tower-Type Avg-Levels: avg upgrade level per tower type (9)
 * [88-91]  Defense-Capabilities: hasAntiAir, hasSplash, hasSlow, hasDoT (4)
 * [92-100] Tower-Unlock-Status: which tower types are researched (9)
 * [101-105] Near-Miss-History: last 5 near-miss-ratios (5)
 * === NEW (Gap-5): armor-matrix weighted effective DPS ===
 * [106-110] Effective DPS vs armor (ground) per category (5)
 * [111-115] Effective DPS vs armor (air)    per category (5)
 * === SPATIAL (shifted by +10) ===
 * [116-135] Ground DPS Profile: 20 bins (20)
 * [136-155] Air DPS Profile: 20 bins (20)
 *
 * NOTE: The Python training backend encodes a different schema (181 features)
 * that also includes a Phase-5.7 backend-only awareness block [116-140]. The
 * frontend encoder is only consumed by the ONNX client path and does not need
 * to match the training-time server schema.
 */

import { GameStateSnapshot, RecentHistory } from './models/game-state-snapshot';
import { WaveConfig } from './models/wave-config';
import { NUM_BINS } from './dps-profile';
import { DamageType, ArmorType, DAMAGE_TYPES, ARMOR_TYPES } from '../../configs/combat/combat.types';
import { TowerTypeId, TOWER_TYPES } from '../../configs/tower-types.config';

/** Total number of features in the encoded state (Gap-5 Fix: 146 → 156) */
export const ENCODED_STATE_SIZE = 156;

/** Number of scalar features (before spatial DPS profile) */
export const NUM_SCALAR_FEATURES = 116;

/** Normalization constant for effective DPS per armor class. */
const MAX_EFFECTIVE_DPS_PER_ARMOR = 500;

/** Enemy type order — 16 entries. Must match backend ENEMY_TYPES. */
const ENEMY_TYPE_ORDER = [
  'zombie', 'rat', 'penguin',
  'wallsmasher', 'bat', 'hornet', 'spider',
  'zombie-soldier', 'tank', 'bear', 'dragon', 'mech',
  'mammoth', 'herbert',
  'ghost', 'wraith',
];

/** Enemy → armor category mapping (must match backend ENEMY_ARMOR). */
const ENEMY_ARMOR_MAP: Record<string, ArmorType> = {
  zombie: 'unarmored', rat: 'unarmored', penguin: 'unarmored',
  wallsmasher: 'light', bat: 'light', hornet: 'light', spider: 'light',
  'zombie-soldier': 'heavy', tank: 'heavy', bear: 'heavy',
  dragon: 'heavy', mech: 'heavy',
  mammoth: 'fortified', herbert: 'fortified',
  ghost: 'ethereal', wraith: 'ethereal',
};

/** Tower types in fixed order for encoding. Phase 5.5: expanded from 7 to 9 (+fire, +tentacle). */
const TOWER_TYPE_ORDER: TowerTypeId[] = [
  'archer', 'cannon', 'magic', 'dual-gatling', 'rocket', 'ice', 'fire', 'tentacle', 'poison',
];

/** DamageType order for encoding (must be stable) */
const DAMAGE_TYPE_ORDER: readonly DamageType[] = DAMAGE_TYPES;

/** ArmorType order for encoding (must be stable) */
const ARMOR_TYPE_ORDER: readonly ArmorType[] = ARMOR_TYPES;

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

  // === TOWER TYPE COUNTS (9 features) [6-14] ===
  for (const towerType of TOWER_TYPE_ORDER) {
    const stats = snapshot.defense.towerDistribution[towerType];
    encoded[idx++] = stats ? normalize(stats.count, 10) : 0;
  }

  // === HISTORY DAMAGE (5 features) [15-19] ===
  const history = snapshot.recentHistory;
  const damages = history.damagePerWave;
  for (let i = 0; i < 5; i++) {
    encoded[idx++] = damages[damages.length - 5 + i] ?? 0;
  }

  // === HISTORY PROGRESS (5 features) [20-24] ===
  const progresses = history.progressPerWave;
  for (let i = 0; i < 5; i++) {
    encoded[idx++] = progresses[progresses.length - 5 + i] ?? 0;
  }

  // === WAVE SIGNALS (5 features) [25-29] ===
  // [25] Damage momentum (positive = getting harder)
  const momentum = damages.length >= 2
    ? (damages[damages.length - 1] - damages[damages.length - 2]) * 10
    : 0;
  encoded[idx++] = Math.max(-1, Math.min(1, momentum));

  // [26] Average recent damage (last 5)
  const recent5 = damages.slice(-5);
  const avgRecent = recent5.length > 0 ? recent5.reduce((a, b) => a + b, 0) / recent5.length : 0;
  encoded[idx++] = Math.min(1, avgRecent);

  // [27] Wave duration (avg)
  encoded[idx++] = normalize(history.avgWaveDuration, MAX_VALUES.waveDuration);

  // [28] Episode progress (max 20 waves)
  encoded[idx++] = normalize(snapshot.waveNumber, 20);

  // [29] Damage variance (consistency signal)
  let damageVariance = 0;
  if (recent5.length >= 2) {
    const mean = avgRecent;
    const variance = recent5.reduce((sum, d) => sum + (d - mean) ** 2, 0) / recent5.length;
    damageVariance = Math.min(1, Math.sqrt(variance) * 10);
  }
  encoded[idx++] = damageVariance;

  // === CONTEXT (5 features) [30-34] ===
  encoded[idx++] = normalize(snapshot.waveNumber, MAX_VALUES.wave);
  encoded[idx++] = calculateDifficultyTrend(history);
  encoded[idx++] = estimatePlayerSkill(history);
  encoded[idx++] = normalize(history.lastWaveThreat, MAX_VALUES.waveThreat);
  encoded[idx++] = normalize(history.winStreak, MAX_VALUES.winStreak);

  // === DPS BY DAMAGE TYPE (7 features) [35-41] === (Phase 5.5 NEW)
  // Prefer pre-computed value from snapshot (ensures sync with backend);
  // fall back to local computation if not provided (e.g. in tests).
  const dpsByType = snapshot.dpsByDamageType ?? computeDpsByDamageType(snapshot);
  for (const dt of DAMAGE_TYPE_ORDER) {
    encoded[idx++] = dpsByType[dt] ?? 0;
  }

  // === ENEMY ARMOR DISTRIBUTION (5 features) [42-46] === (Phase 5.5 NEW)
  const armorDist = snapshot.expectedArmorDistribution ?? uniformArmorDist();
  for (const a of ARMOR_TYPE_ORDER) {
    encoded[idx++] = armorDist[a] ?? 0;
  }

  // === RESEARCH STATE (5 features) [47-51] === (Phase 5.5 NEW)
  const r = snapshot.research;
  encoded[idx++] = r && r.totalCount > 0 ? r.completedCount / r.totalCount : 0;
  encoded[idx++] = r ? r.centerLevel / 3 : 0;
  encoded[idx++] = r && r.maxSlots > 0 ? r.slotsUsed / r.maxSlots : 0;
  encoded[idx++] = r && r.airTargetingUnlocked ? 1 : 0;
  encoded[idx++] = r ? r.maxUpgradeTier / 3 : 1 / 3;

  // === RESERVED/PADDING (1 feature) [52] ===
  encoded[idx++] = 0;

  // ─── PHASE 5.6 AWARENESS BLOCK ───────────────────────────────────────

  // === TYPES-HISTORY (16 features) [53-68] ===
  // For each enemy type: frequency (count / 5) across the last 5 waves.
  // Last wave counted as 1 if dominant type matches. Mixed-waves: all group
  // types count.
  const typesHistory = computeTypesHistory(history.enemyTypesUsed, 5);
  for (const t of ENEMY_TYPE_ORDER) {
    encoded[idx++] = typesHistory[t] ?? 0;
  }

  // === ARMOR-HISTORY (5 features) [69-73] ===
  // Frequency of each armor category across the last 5 waves.
  const armorHistory = computeArmorHistory(history.enemyTypesUsed, 5);
  for (const a of ARMOR_TYPE_ORDER) {
    encoded[idx++] = armorHistory[a] ?? 0;
  }

  // === DAMAGE-PCT-HISTORY (5 features) [74-78] ===
  // Explicit last 5 damage-percentages. Parallel to [15-19] but semantically
  // tied to the awareness block.
  const dmgHist = history.damagePerWave;
  for (let i = 0; i < 5; i++) {
    encoded[idx++] = dmgHist[dmgHist.length - 5 + i] ?? 0;
  }

  // === TOWER-TYPE AVG-LEVELS (9 features) [79-87] ===
  // Average upgrade level per tower type (0-5 range, normalized by 5).
  for (const towerType of TOWER_TYPE_ORDER) {
    const stats = snapshot.defense.towerDistribution[towerType];
    encoded[idx++] = stats ? Math.min(1, (stats.avgLevel ?? 0) / 5) : 0;
  }

  // === DEFENSE CAPABILITIES (4 features) [88-91] ===
  const cap = snapshot.defense.capabilities;
  encoded[idx++] = cap.hasAntiAir ? 1 : 0;
  encoded[idx++] = cap.hasSplash ? 1 : 0;
  encoded[idx++] = cap.hasSlow ? 1 : 0;
  encoded[idx++] = cap.hasDoT ? 1 : 0;

  // === TOWER UNLOCK STATUS (9 features) [92-100] ===
  // Which tower types has the bot researched (flags 0/1).
  const unlocked = snapshot.research?.towerUnlocked ?? {};
  for (const towerType of TOWER_TYPE_ORDER) {
    encoded[idx++] = unlocked[towerType] ? 1 : 0;
  }

  // === NEAR-MISS HISTORY (5 features) [101-105] ===
  const nmHist = history.nearMissPerWave ?? [];
  for (let i = 0; i < 5; i++) {
    encoded[idx++] = nmHist[nmHist.length - 5 + i] ?? 0;
  }

  // ─── GAP-5: armor-matrix weighted effective DPS ──────────────────────

  // === EFFECTIVE DPS vs ARMOR, GROUND (5 features) [106-110] ===
  const eff = snapshot.defense.effectiveDPSPerArmor;
  for (const a of ARMOR_TYPE_ORDER) {
    encoded[idx++] = normalize(eff?.ground?.[a] ?? 0, MAX_EFFECTIVE_DPS_PER_ARMOR);
  }
  // === EFFECTIVE DPS vs ARMOR, AIR (5 features) [111-115] ===
  for (const a of ARMOR_TYPE_ORDER) {
    encoded[idx++] = normalize(eff?.air?.[a] ?? 0, MAX_EFFECTIVE_DPS_PER_ARMOR);
  }

  // ─── ORIGINAL SPATIAL BLOCK ──────────────────────────────────────────

  // === DPS PROFILE: GROUND (20 features) [116-135] ===
  const profile = snapshot.dpsProfile;
  for (let i = 0; i < NUM_BINS; i++) {
    encoded[idx++] = profile.groundDPS[i] ?? 0;
  }

  // === DPS PROFILE: AIR (20 features) [136-155] ===
  for (let i = 0; i < NUM_BINS; i++) {
    encoded[idx++] = profile.airDPS[i] ?? 0;
  }

  return encoded;
}

/** Frequency of each enemy type across last N waves (0-1, capped at 1). */
function computeTypesHistory(enemyTypesUsed: string[][], window: number): Record<string, number> {
  const result: Record<string, number> = {};
  const recent = enemyTypesUsed.slice(-window);
  if (recent.length === 0) return result;
  for (const waveTypes of recent) {
    for (const t of waveTypes) {
      result[t] = (result[t] ?? 0) + 1;
    }
  }
  // Normalize by window size so each feature is in 0-1 range (each type can
  // appear in at most `window` waves → fraction of waves).
  for (const k in result) {
    result[k] = Math.min(1, result[k] / window);
  }
  return result;
}

/** Frequency of each armor category across last N waves (0-1). */
function computeArmorHistory(enemyTypesUsed: string[][], window: number): Record<string, number> {
  const result: Record<string, number> = {};
  const recent = enemyTypesUsed.slice(-window);
  if (recent.length === 0) return result;
  for (const waveTypes of recent) {
    // Dedupe armors within a single wave so mixed-wave doesn't double-count
    const waveArmors = new Set<string>();
    for (const t of waveTypes) {
      const a = ENEMY_ARMOR_MAP[t];
      if (a) waveArmors.add(a);
    }
    for (const a of waveArmors) {
      result[a] = (result[a] ?? 0) + 1;
    }
  }
  for (const k in result) {
    result[k] = Math.min(1, result[k] / window);
  }
  return result;
}

/**
 * Compute DPS by damage type from the tower distribution in the snapshot.
 * Uses TOWER_TYPES config to map each tower to its damageType and DPS.
 * Normalized to 0-1 with a cap of MAX_DPS_PER_TYPE.
 *
 * Exported so AIDataCollectorService can pre-compute and include it in the snapshot
 * (ensures the Python backend gets the same values via WebSocket).
 */
export function computeDpsByDamageType(snapshot: GameStateSnapshot): Record<DamageType, number> {
  const MAX_DPS_PER_TYPE = 500;
  const result: Record<DamageType, number> = {} as Record<DamageType, number>;
  for (const dt of DAMAGE_TYPE_ORDER) result[dt] = 0;

  for (const [towerId, stats] of Object.entries(snapshot.defense.towerDistribution)) {
    const cfg = TOWER_TYPES[towerId as TowerTypeId];
    if (!cfg || cfg.attackType === 'passive') continue;
    const dt = cfg.damageType;
    // stats.totalDPS is pre-computed from damage * fireRate; for beams we fall back to damagePerSecond
    const dps = stats.totalDPS ?? 0;
    result[dt] += dps;
  }

  // Normalize
  for (const dt of DAMAGE_TYPE_ORDER) {
    result[dt] = Math.min(1, result[dt] / MAX_DPS_PER_TYPE);
  }
  return result;
}

function uniformArmorDist(): Record<ArmorType, number> {
  const share = 1 / ARMOR_TYPE_ORDER.length;
  const dist = {} as Record<ArmorType, number>;
  for (const a of ARMOR_TYPE_ORDER) dist[a] = share;
  return dist;
}

/**
 * Decode neural network output to feature names (for debugging).
 * MUST match encodeGameState() layout exactly.
 */
export function decodeFeatureNames(): string[] {
  const names: string[] = [];

  // Player state [0-3]
  names.push('credits', 'lives', 'wave', 'gameTime');

  // Tower stats [4-5]
  names.push('towerCount', 'avgLevel');

  // Tower type counts [6-14] (9 types)
  for (const type of TOWER_TYPE_ORDER) {
    names.push(`${type}_count`);
  }

  // History damage [15-19]
  for (let i = 1; i <= 5; i++) names.push(`damage_${i}`);

  // History progress [20-24]
  for (let i = 1; i <= 5; i++) names.push(`progress_${i}`);

  // Wave signals [25-29]
  names.push('momentum', 'avgDamage', 'duration', 'episodeProgress', 'variance');

  // Context [30-34]
  names.push('waveNorm', 'diffTrend', 'skill', 'lastWaveThreat', 'winStreak');

  // DPS by damage type [35-41]
  for (const dt of DAMAGE_TYPE_ORDER) names.push(`dps_${dt}`);

  // Armor distribution [42-46]
  for (const a of ARMOR_TYPE_ORDER) names.push(`armor_${a}`);

  // Research state [47-51]
  names.push('research_progress', 'center_level', 'slots_used', 'air_targeting', 'upgrade_tier');

  // Reserved [52]
  names.push('reserved_0');

  // Phase 5.6 awareness block [53-105]
  for (const t of ENEMY_TYPE_ORDER) names.push(`typehist_${t}`);
  for (const a of ARMOR_TYPE_ORDER) names.push(`armorhist_${a}`);
  for (let i = 1; i <= 5; i++) names.push(`dmgpct_${i}`);
  for (const t of TOWER_TYPE_ORDER) names.push(`avglvl_${t}`);
  names.push('has_antiair', 'has_splash', 'has_slow', 'has_dot');
  for (const t of TOWER_TYPE_ORDER) names.push(`unlocked_${t}`);
  for (let i = 1; i <= 5; i++) names.push(`nearmiss_${i}`);

  // Gap-5 effective DPS per armor [106-115]
  for (const a of ARMOR_TYPE_ORDER) names.push(`effdps_ground_${a}`);
  for (const a of ARMOR_TYPE_ORDER) names.push(`effdps_air_${a}`);

  // Ground DPS profile [116-135]
  for (let i = 0; i < NUM_BINS; i++) names.push(`ground_dps_${i}`);

  // Air DPS profile [136-155]
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
