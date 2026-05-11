/**
 * Combat Type Definitions
 *
 * Central definitions for all damage and armor types.
 * Adding a new type here forces TypeScript to flag all missing entries
 * in the damage matrix, UI metadata, and config assignments.
 *
 * Pattern: const array + derived union = runtime-iterable + compile-time safe.
 */

// ==================== Damage Types ====================

/** All damage types in the game. Add new types here — matrix/UI/configs must follow. */
export const DAMAGE_TYPES = ['physical', 'pierce', 'siege', 'magic', 'fire', 'ice', 'poison', 'lightning'] as const;
export type DamageType = typeof DAMAGE_TYPES[number];

// ==================== Armor Types ====================

/** All armor types in the game. Add new types here — matrix/UI/configs must follow. */
export const ARMOR_TYPES = ['unarmored', 'light', 'heavy', 'fortified', 'ethereal'] as const;
export type ArmorType = typeof ARMOR_TYPES[number];

// ==================== Damage Matrix Type ====================

/**
 * Mapped type that enforces every DamageType row has every ArmorType column.
 * Missing entries are compile-time errors.
 */
export type DamageMatrix = Readonly<Record<DamageType, Readonly<Record<ArmorType, number>>>>;

// ==================== Effectiveness ====================

/** Effectiveness tier — derived from the multiplier value for visual feedback. */
export type DamageEffectiveness = 'weak' | 'normal' | 'strong' | 'devastating';

// ==================== Damage Result ====================

/**
 * Result of a damage calculation.
 * Carries everything downstream consumers need for VFX, UI, and logging.
 */
export interface DamageResult {
  /** Final damage after all multipliers */
  finalDamage: number;
  /** Raw base damage before multipliers */
  baseDamage: number;
  /** Combined multiplier that was applied (matrix * bonus) */
  multiplier: number;
  /** Effectiveness category for visual feedback */
  effectiveness: DamageEffectiveness;
  /** The damage type that was dealt */
  damageType: DamageType;
  /** The armor type of the target */
  armorType: ArmorType;
}
