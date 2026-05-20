/**
 * Tower DPS Utilities
 *
 * Zentrale Helfer für Tower-DPS-Berechnung und effektive Air-Targeting-Logik.
 * Beide Konsumenten (AI-Snapshot und spatial DPS-Profil) verwenden diese Funktionen,
 * damit keine Drift zwischen skalaren und spatialen Defense-Metriken entsteht.
 */

import { Tower } from '../../entities/tower.entity';
import { TowerTypeConfig, UpgradeId } from '../../configs/tower-types.config';
import { PROJECTILE_TYPES } from '../../configs/projectile-types.config';
import { DamageType, ArmorType, ARMOR_TYPES } from '../../configs/combat/combat.types';
import { DAMAGE_MATRIX } from '../../configs/combat/damage-matrix.config';
import { GAME_BALANCE } from '../../configs/game-balance.config';

// Re-export so existing AI consumers keep their import path working.
export { canTargetAirEffective } from '../../entities/tower-targeting.util';

/** Divisor used to turn splashRadius into a soft multiplier (radius 10 -> 2x, capped). */
const SPLASH_NORM = 10;
const SPLASH_MULT_CAP = 2.0;

/** Per-upgrade-track levels, keyed by upgrade id. Missing entries → level 0. */
export type UpgradeLevels = Partial<Record<UpgradeId, number>>;

/** Effective stats of a tower config at a given uniform upgrade level. */
export interface TowerStatsAtLevel {
  /** Effective damage per hit (beam towers: effective damage-per-second). */
  damage: number;
  /** Effective fire rate in shots/sec (0 for beam towers — no fireRate track). */
  fireRate: number;
  /** Effective range in metres. */
  range: number;
  /** Effective beam width in metres (0 for non-beam towers). */
  beamWidth: number;
  /** Raw DPS — identical to computeTowerDPSFromLevels() at this uniform level. */
  dps: number;
}

/**
 * Compounded multiplier for one upgradeable stat at the given per-track levels.
 *
 * The upgrade is looked up by `effect.stat`, NOT by id — so tower-specific
 * upgrade variants (e.g. ARCHER_RANGE_UPGRADE) are honoured automatically
 * without hard-coding any multiplier here.
 */
function statMultiplier(
  cfg: TowerTypeConfig,
  stat: 'damage' | 'fireRate' | 'range' | 'beamWidth',
  levels: UpgradeLevels,
): number {
  const upgrade = cfg.upgrades.find(u => u.effect.stat === stat);
  if (!upgrade) return 1;
  const level = levels[upgrade.id] ?? 0;
  return level > 0 ? Math.pow(upgrade.effect.multiplier, level) : 1;
}

/**
 * Raw per-tower DPS for a config at explicit per-track upgrade levels.
 *
 * Pure (no Tower entity) — the single source of truth shared by the live
 * {@link computeTowerDPS} adapter and the offline tower-stats chart, so the
 * DPS formula is never maintained twice. Combines:
 *   - Beam damagePerSecond (Fire), scaled by the damage track
 *   - Projectile/melee damage × fireRate (default)
 *   - Chain geometric series 1 + f + f² + … + f^maxJumps (Lightning)
 *   - Additive DoT component (Poison, flat — AI approximation, intentionally
 *     unscaled by the damage track)
 *   - Multiplicative splash/AoE factor (projectile splashRadius, fire beamWidth)
 *   - Passive buildings → 0
 */
export function computeTowerDPSFromLevels(
  cfg: TowerTypeConfig,
  levels: UpgradeLevels,
): number {
  if (cfg.attackType === 'passive') return 0;

  let base: number;
  if (cfg.attackType === 'beam') {
    // Beam towers (Fire) keep damagePerSecond in config because applyUpgrade()
    // multiplies _combat.damage (which starts at 0); scale by the damage track.
    base = (cfg.damagePerSecond ?? 0) * statMultiplier(cfg, 'damage', levels);
  } else {
    const damage = cfg.damage * statMultiplier(cfg, 'damage', levels);
    const fireRate = cfg.fireRate * statMultiplier(cfg, 'fireRate', levels);
    base = damage * fireRate;
  }

  // Chain hitscan multiplies effective DPS via per-jump damage carryover.
  // Sum = 1 + f + f^2 + … + f^maxJumps (geometric series, primary + jumps).
  if (cfg.attackType === 'chain') {
    const maxJumps = cfg.maxJumps ?? 0;
    const falloff = cfg.chainFalloff ?? 1.0;
    let chainMult = 1;
    let term = 1;
    for (let i = 0; i < maxJumps; i++) {
      term *= falloff;
      chainMult += term;
    }
    base *= chainMult;
  }

  if (cfg.id === 'poison') {
    base += GAME_BALANCE.effects.poison.dotDamagePerSecond;
  }

  const projectileSplash = PROJECTILE_TYPES[cfg.projectileType]?.splashRadius ?? 0;
  let beamSplash = 0;
  if (cfg.attackType === 'beam') {
    beamSplash = (cfg.beamWidth ?? 0) * statMultiplier(cfg, 'beamWidth', levels);
  }
  const splashRadius = Math.max(projectileSplash, beamSplash);
  if (splashRadius > 0) {
    const mult = Math.min(SPLASH_MULT_CAP, 1 + splashRadius / SPLASH_NORM);
    base *= mult;
  }

  return base;
}

/**
 * Effective stats of a tower config with the SAME upgrade level applied to
 * every one of its upgrade tracks. Used by the offline tower-stats chart to
 * project a single comparable curve per tower over all 25 levels.
 */
export function computeTowerStatsAtLevel(
  cfg: TowerTypeConfig,
  level: number,
): TowerStatsAtLevel {
  const levels: UpgradeLevels = {};
  for (const u of cfg.upgrades) levels[u.id] = level;

  const isBeam = cfg.attackType === 'beam';
  return {
    damage: isBeam
      ? (cfg.damagePerSecond ?? 0) * statMultiplier(cfg, 'damage', levels)
      : cfg.damage * statMultiplier(cfg, 'damage', levels),
    fireRate: isBeam ? 0 : cfg.fireRate * statMultiplier(cfg, 'fireRate', levels),
    range: cfg.range * statMultiplier(cfg, 'range', levels),
    beamWidth: isBeam ? (cfg.beamWidth ?? 0) * statMultiplier(cfg, 'beamWidth', levels) : 0,
    dps: computeTowerDPSFromLevels(cfg, levels),
  };
}

/**
 * Raw per-tower DPS used as the AI-facing approximation of a tower's throughput.
 *
 * Thin adapter — reads the live per-track upgrade levels off the tower entity
 * and delegates to {@link computeTowerDPSFromLevels}.
 */
export function computeTowerDPS(tower: Tower): number {
  const cfg = tower.typeConfig;
  const levels: UpgradeLevels = {};
  for (const u of cfg.upgrades) levels[u.id] = tower.getUpgradeLevel(u.id);
  return computeTowerDPSFromLevels(cfg, levels);
}

/**
 * Returns the armor multiplier row for a given damage type.
 * Missing entries default to 1.0 neutral.
 */
export function armorMultipliersFor(damageType: DamageType): Record<ArmorType, number> {
  const row = DAMAGE_MATRIX[damageType];
  const result = {} as Record<ArmorType, number>;
  for (const armor of ARMOR_TYPES) {
    result[armor] = row?.[armor] ?? 1.0;
  }
  return result;
}
