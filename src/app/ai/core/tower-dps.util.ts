/**
 * Tower DPS Utilities
 *
 * Zentrale Helfer für Tower-DPS-Berechnung und effektive Air-Targeting-Logik.
 * Beide Konsumenten (AI-Snapshot und spatial DPS-Profil) verwenden diese Funktionen,
 * damit keine Drift zwischen skalaren und spatialen Defense-Metriken entsteht.
 */

import { Tower } from '../../entities/tower.entity';
import { PROJECTILE_TYPES } from '../../configs/projectile-types.config';
import { DamageType, ArmorType, ARMOR_TYPES } from '../../configs/combat/combat.types';
import { DAMAGE_MATRIX } from '../../configs/combat/damage-matrix.config';
import { GAME_BALANCE } from '../../configs/game-balance.config';

// Re-export so existing AI consumers keep their import path working.
export { canTargetAirEffective } from '../../entities/tower-targeting.util';

/** Divisor used to turn splashRadius into a soft multiplier (radius 10 -> 2x, capped). */
const SPLASH_NORM = 10;
const SPLASH_MULT_CAP = 2.0;

/**
 * Raw per-tower DPS used as the AI-facing approximation of a tower's throughput.
 * Combines:
 *   - Beam damagePerSecond (Fire)
 *   - Projectile damage × fireRate (default)
 *   - Additive DoT component (Poison, via GAME_BALANCE config)
 *   - Multiplicative splash/AoE factor (cannon/ice/poison via projectile splashRadius,
 *     fire via beamWidth)
 *   - Passive buildings → 0
 */
export function computeTowerDPS(tower: Tower): number {
  const cfg = tower.typeConfig;
  if (cfg.attackType === 'passive') return 0;

  let base: number;
  if (cfg.attackType === 'beam') {
    // Beam towers (Fire) keep damagePerSecond in config because applyUpgrade()
    // multiplies _combat.damage (starts at 0) — the real combat path uses
    // getEffectiveDPS(). Replicate its scaling here so the NN sees upgrades.
    base = cfg.damagePerSecond ?? 0;
    const damageUpgrade = cfg.upgrades.find(u => u.effect.stat === 'damage');
    if (damageUpgrade) {
      const level = tower.getUpgradeLevel(damageUpgrade.id);
      if (level > 0) base *= Math.pow(damageUpgrade.effect.multiplier, level);
    }
  } else {
    base = tower.combat.damage * tower.combat.fireRate;
  }

  if (cfg.id === 'poison') {
    base += GAME_BALANCE.effects.poison.dotDamagePerSecond;
  }

  const projectileSplash = PROJECTILE_TYPES[cfg.projectileType]?.splashRadius ?? 0;
  let beamSplash = 0;
  if (cfg.attackType === 'beam') {
    beamSplash = cfg.beamWidth ?? 0;
    // Replicate getEffectiveBeamWidth() upgrade scaling for the same reason.
    const beamWidthUpgrade = cfg.upgrades.find(u => u.effect.stat === 'beamWidth');
    if (beamWidthUpgrade) {
      const level = tower.getUpgradeLevel(beamWidthUpgrade.id);
      if (level > 0) beamSplash *= Math.pow(beamWidthUpgrade.effect.multiplier, level);
    }
  }
  const splashRadius = Math.max(projectileSplash, beamSplash);
  if (splashRadius > 0) {
    const mult = Math.min(SPLASH_MULT_CAP, 1 + splashRadius / SPLASH_NORM);
    base *= mult;
  }

  return base;
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
