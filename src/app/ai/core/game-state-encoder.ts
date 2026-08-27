/**
 * Game State Encoder
 *
 * Converts a GameStateSnapshot into the Float32Array the Wave-Director model
 * consumes. Every value is normalised into 0-1 (the damage-momentum feature is
 * the single deliberate exception and spans -1..1).
 *
 * The layout is defined by `ai-schema.ts`, which is also what generates the
 * Python backend's copy — so this encoder and `server.py::_encode_state`
 * cannot drift apart the way they used to. With schema v2 the vector is 162
 * features wide:
 *
 *   Player state: credits, lives%, wave, time                            (4)
 *   towerCount, avgTowerLevel                                            (2)
 *   Tower type counts                                    (AI_TOWER_ORDER, T)
 *   Damage history, last 5 waves                                         (5)
 *   Progress history, last 5 waves                                       (5)
 *   Wave signals: momentum, avgDmg, duration, episodeProgress, variance  (5)
 *   Context: wave, trend, skill, lastThreat, winStreak                   (5)
 *   DPS by damage type                             (AI_DAMAGE_TYPE_ORDER, D)
 *   Expected enemy armor distribution                    (AI_ARMOR_ORDER, A)
 *   Research: completedRatio, centerLevel, slotUse, airTargeting, maxTier (5)
 *   Reserved                                                             (1)
 *   --- awareness block ---
 *   Types-history: per-type frequency over last 5 waves  (AI_ENEMY_ORDER, E)
 *   Armor-history                                                        (A)
 *   Damage-pct history (deliberate repeat of the earlier block)          (5)
 *   Tower-type average levels                                            (T)
 *   Defense capabilities: antiAir, splash, slow, dot                     (4)
 *   Tower unlock status                                                  (T)
 *   Near-miss history                                                    (5)
 *   --- armor-matrix block ---
 *   Effective DPS vs armor, ground                                       (A)
 *   Effective DPS vs armor, air                                          (A)
 *   --- spatial block ---
 *   Ground DPS profile                                          (NUM_BINS)
 *   Air DPS profile                                             (NUM_BINS)
 */

import { GameStateSnapshot, RecentHistory } from './models/game-state-snapshot';
import { WaveConfig } from './models/wave-config';
import { DamageType, ArmorType } from '../../configs/combat/combat.types';
import { TowerTypeId, TOWER_TYPES } from '../../configs/tower-types.config';
import { ENEMY_TYPES, type EnemyTypeId } from '../../configs/enemy-types.config';
import {
  AI_ENEMY_ORDER,
  AI_TOWER_ORDER,
  AI_DAMAGE_TYPE_ORDER,
  AI_ARMOR_ORDER,
  AI_MAX_VALUES,
  ENEMY_THREAT_RATING,
  ENCODED_STATE_SIZE,
  NUM_SCALAR_FEATURES,
  NUM_DPS_BINS as NUM_BINS,
  AI_EPISODE_LENGTH,
} from './ai-schema';

export { ENCODED_STATE_SIZE, NUM_SCALAR_FEATURES, ENEMY_THREAT_RATING };

/** Enemy -> armor class, derived from the live enemy configs. */
const ENEMY_ARMOR_MAP: Record<string, ArmorType> = Object.fromEntries(
  AI_ENEMY_ORDER.map((id) => [id, ENEMY_TYPES[id as EnemyTypeId].armorType]),
) as Record<string, ArmorType>;

const ENEMY_TYPE_ORDER = AI_ENEMY_ORDER;
const TOWER_TYPE_ORDER = AI_TOWER_ORDER;
const DAMAGE_TYPE_ORDER = AI_DAMAGE_TYPE_ORDER;
const ARMOR_TYPE_ORDER = AI_ARMOR_ORDER;
const MAX_VALUES = AI_MAX_VALUES;

/** Normalization constant for effective DPS per armor class. */
const MAX_EFFECTIVE_DPS_PER_ARMOR = AI_MAX_VALUES.effectiveDpsPerArmor;

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
 * Encode a game state into the normalised model input.
 *
 * Block sizes come from `ai-schema.ts`; absolute indices are deliberately not
 * written here any more, because they shift with every schema bump and the
 * stale ones were actively misleading.
 */
export function encodeGameState(snapshot: GameStateSnapshot): Float32Array {
  const encoded = new Float32Array(ENCODED_STATE_SIZE);
  let idx = 0;

  // === PLAYER STATE (4) ===
  encoded[idx++] = normalize(snapshot.player.credits, MAX_VALUES.credits);
  encoded[idx++] = snapshot.player.livesPercent;
  encoded[idx++] = normalize(snapshot.waveNumber, MAX_VALUES.wave);
  encoded[idx++] = normalize(snapshot.gameTimeSeconds, MAX_VALUES.gameTime);

  // === TOWER STATS (2) ===
  encoded[idx++] = normalize(snapshot.defense.towerCount, MAX_VALUES.towerCount);
  encoded[idx++] = normalize(snapshot.defense.avgTowerLevel, MAX_VALUES.towerLevel);

  // === TOWER TYPE COUNTS (AI_TOWER_ORDER) ===
  for (const towerType of TOWER_TYPE_ORDER) {
    const stats = snapshot.defense.towerDistribution[towerType];
    encoded[idx++] = stats ? normalize(stats.count, 10) : 0;
  }

  // === HISTORY DAMAGE, last 5 waves ===
  const history = snapshot.recentHistory;
  const damages = history.damagePerWave;
  for (let i = 0; i < 5; i++) {
    encoded[idx++] = damages[damages.length - 5 + i] ?? 0;
  }

  // === HISTORY PROGRESS, last 5 waves ===
  const progresses = history.progressPerWave;
  for (let i = 0; i < 5; i++) {
    encoded[idx++] = progresses[progresses.length - 5 + i] ?? 0;
  }

  // === WAVE SIGNALS (5) ===
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

  // [28] Episode progress, measured against the training episode length
  encoded[idx++] = normalize(snapshot.waveNumber, AI_EPISODE_LENGTH);

  // [29] Damage variance (consistency signal)
  let damageVariance = 0;
  if (recent5.length >= 2) {
    const mean = avgRecent;
    const variance = recent5.reduce((sum, d) => sum + (d - mean) ** 2, 0) / recent5.length;
    damageVariance = Math.min(1, Math.sqrt(variance) * 10);
  }
  encoded[idx++] = damageVariance;

  // === CONTEXT (5) ===
  encoded[idx++] = normalize(snapshot.waveNumber, MAX_VALUES.wave);
  encoded[idx++] = calculateDifficultyTrend(history);
  encoded[idx++] = estimatePlayerSkill(history);
  encoded[idx++] = normalize(history.lastWaveThreat, MAX_VALUES.waveThreat);
  encoded[idx++] = normalize(history.winStreak, MAX_VALUES.winStreak);

  // === DPS BY DAMAGE TYPE (AI_DAMAGE_TYPE_ORDER) ===
  // Prefer pre-computed value from snapshot (ensures sync with backend);
  // fall back to local computation if not provided (e.g. in tests).
  const dpsByType = snapshot.dpsByDamageType ?? computeDpsByDamageType(snapshot);
  for (const dt of DAMAGE_TYPE_ORDER) {
    encoded[idx++] = dpsByType[dt] ?? 0;
  }

  // === EXPECTED ENEMY ARMOR DISTRIBUTION (AI_ARMOR_ORDER) ===
  const armorDist = snapshot.expectedArmorDistribution ?? uniformArmorDist();
  for (const a of ARMOR_TYPE_ORDER) {
    encoded[idx++] = armorDist[a] ?? 0;
  }

  // === RESEARCH STATE (5) ===
  const r = snapshot.research;
  encoded[idx++] = r && r.totalCount > 0 ? r.completedCount / r.totalCount : 0;
  encoded[idx++] = r ? r.centerLevel / 3 : 0;
  encoded[idx++] = r && r.maxSlots > 0 ? r.slotsUsed / r.maxSlots : 0;
  encoded[idx++] = r && r.airTargetingUnlocked ? 1 : 0;
  encoded[idx++] = normalize(r ? r.maxUpgradeTier : 1, MAX_VALUES.upgradeTier);

  // === RESERVED/PADDING (1 feature) [52] ===
  encoded[idx++] = 0;

  // ─── PHASE 5.6 AWARENESS BLOCK ───────────────────────────────────────

  // === TYPES-HISTORY (AI_ENEMY_ORDER) ===
  // For each enemy type: frequency (count / 5) across the last 5 waves.
  // Last wave counted as 1 if dominant type matches. Mixed-waves: all group
  // types count.
  const typesHistory = computeTypesHistory(history.enemyTypesUsed, 5);
  for (const t of ENEMY_TYPE_ORDER) {
    encoded[idx++] = typesHistory[t] ?? 0;
  }

  // === ARMOR-HISTORY (AI_ARMOR_ORDER) ===
  // Frequency of each armor category across the last 5 waves.
  const armorHistory = computeArmorHistory(history.enemyTypesUsed, 5);
  for (const a of ARMOR_TYPE_ORDER) {
    encoded[idx++] = armorHistory[a] ?? 0;
  }

  // === DAMAGE-PCT-HISTORY — deliberate repeat; the backend mirrors it ===
  // Explicit last 5 damage-percentages. Parallel to [15-19] but semantically
  // tied to the awareness block.
  const dmgHist = history.damagePerWave;
  for (let i = 0; i < 5; i++) {
    encoded[idx++] = dmgHist[dmgHist.length - 5 + i] ?? 0;
  }

  // === TOWER-TYPE AVG-LEVELS (AI_TOWER_ORDER) ===
  // Average upgrade level per tower type (0-5 range, normalized by 5).
  for (const towerType of TOWER_TYPE_ORDER) {
    const stats = snapshot.defense.towerDistribution[towerType];
    encoded[idx++] = stats ? Math.min(1, (stats.avgLevel ?? 0) / 5) : 0;
  }

  // === DEFENSE CAPABILITIES (4) ===
  const cap = snapshot.defense.capabilities;
  encoded[idx++] = cap.hasAntiAir ? 1 : 0;
  encoded[idx++] = cap.hasSplash ? 1 : 0;
  encoded[idx++] = cap.hasSlow ? 1 : 0;
  encoded[idx++] = cap.hasDoT ? 1 : 0;

  // === TOWER UNLOCK STATUS (AI_TOWER_ORDER) ===
  // Which tower types has the bot researched (flags 0/1).
  const unlocked = snapshot.research?.towerUnlocked ?? {};
  for (const towerType of TOWER_TYPE_ORDER) {
    encoded[idx++] = unlocked[towerType] ? 1 : 0;
  }

  // === NEAR-MISS HISTORY, last 5 waves ===
  const nmHist = history.nearMissPerWave ?? [];
  for (let i = 0; i < 5; i++) {
    encoded[idx++] = nmHist[nmHist.length - 5 + i] ?? 0;
  }

  // ─── GAP-5: armor-matrix weighted effective DPS ──────────────────────

  // === EFFECTIVE DPS vs ARMOR, GROUND (AI_ARMOR_ORDER) ===
  const eff = snapshot.defense.effectiveDPSPerArmor;
  for (const a of ARMOR_TYPE_ORDER) {
    encoded[idx++] = normalize(eff?.ground?.[a] ?? 0, MAX_EFFECTIVE_DPS_PER_ARMOR);
  }
  // === EFFECTIVE DPS vs ARMOR, AIR (AI_ARMOR_ORDER) ===
  for (const a of ARMOR_TYPE_ORDER) {
    encoded[idx++] = normalize(eff?.air?.[a] ?? 0, MAX_EFFECTIVE_DPS_PER_ARMOR);
  }

  // ─── ORIGINAL SPATIAL BLOCK ──────────────────────────────────────────

  // === DPS PROFILE: GROUND (NUM_BINS) ===
  const profile = snapshot.dpsProfile;
  for (let i = 0; i < NUM_BINS; i++) {
    encoded[idx++] = profile.groundDPS[i] ?? 0;
  }

  // === DPS PROFILE: AIR (NUM_BINS) ===
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

  // Player state
  names.push('credits', 'lives', 'wave', 'gameTime');

  // Tower stats [4-5]
  names.push('towerCount', 'avgLevel');

  // Tower type counts
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

  // DPS by damage type
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

  // Ground DPS profile
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
