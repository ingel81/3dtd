/**
 * Damage Calculator — Pure Function
 *
 * No Angular service, no DI, no state.
 * Takes inputs, returns a DamageResult.
 *
 * This is the single place where the damage matrix lookup happens.
 */

import { DamageType, ArmorType, DamageResult } from '../configs/combat/combat.types';
import { getEffectiveness, matrixMultiplier } from '../configs/combat/damage-matrix.config';

/**
 * Calculate effective damage using the damage matrix.
 *
 * Formula: finalDamage = baseDamage * DAMAGE_MATRIX[damageType][armorType] * bonusMultiplier
 *
 * @param baseDamage      Raw damage from tower (after upgrades)
 * @param damageType      Type of damage being dealt
 * @param armorType       Current armor type of the target (may be overridden by Armor Break)
 * @param bonusMultiplier Additional multiplier from future effects like Mark (default: 1.0)
 * @param corroded        The target is corroded (status `corrode`) or the hit pierces armor (TowerPath.armorPiercing):
 *                        the better of its armor and the next lighter
 */
export function calculateDamage(
  baseDamage: number,
  damageType: DamageType,
  armorType: ArmorType,
  bonusMultiplier = 1.0,
  corroded = false,
): DamageResult {
  const totalMultiplier = matrixMultiplier(damageType, armorType, corroded) * bonusMultiplier;
  const finalDamage = baseDamage * totalMultiplier;

  return {
    finalDamage,
    baseDamage,
    multiplier: totalMultiplier,
    effectiveness: getEffectiveness(totalMultiplier),
    damageType,
    armorType,
  };
}
