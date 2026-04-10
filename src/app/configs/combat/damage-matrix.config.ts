/**
 * Damage Matrix Configuration
 *
 * Pure data file — all multipliers, thresholds, and visual configs.
 * To add a new DamageType: add a row. To add a new ArmorType: add a column to each row.
 * TypeScript enforces completeness via the DamageMatrix mapped type.
 *
 * All values are tuneable without code changes.
 */

import { DamageMatrix, DamageEffectiveness } from './combat.types';

// ==================== Damage Multiplier Matrix ====================

/**
 * DAMAGE_MATRIX[damageType][armorType] = multiplier
 *
 * Values from MASTER_GAME_DESIGN.md Section 2.3.
 * 1.0 = neutral, <1.0 = reduced, >1.0 = bonus damage.
 */
export const DAMAGE_MATRIX: DamageMatrix = {
  //                 unarmored  light   heavy   fortified  ethereal
  physical:        { unarmored: 1.0,  light: 1.0,  heavy: 0.7,  fortified: 0.5,  ethereal: 0.15 },
  pierce:          { unarmored: 1.2,  light: 1.3,  heavy: 0.5,  fortified: 0.6,  ethereal: 0.15 },
  siege:           { unarmored: 0.8,  light: 0.7,  heavy: 1.5,  fortified: 1.25, ethereal: 0.75 },
  magic:           { unarmored: 1.0,  light: 1.0,  heavy: 0.85, fortified: 0.75, ethereal: 1.75 },
  fire:            { unarmored: 1.15, light: 1.0,  heavy: 0.9,  fortified: 0.6,  ethereal: 0.15 },
  ice:             { unarmored: 1.0,  light: 1.2,  heavy: 1.0,  fortified: 0.75, ethereal: 1.5  },
  poison:          { unarmored: 1.1,  light: 1.1,  heavy: 0.6,  fortified: 0.6,  ethereal: 0.5  },
};

// ==================== Effectiveness Thresholds ====================

/**
 * Thresholds for DamageEffectiveness tiers (based on final multiplier).
 * Tuneable — adjust these to change when damage numbers change color/size.
 */
export const EFFECTIVENESS_THRESHOLDS = {
  /** multiplier < weak → 'weak' (grey, smaller text) */
  weak: 0.7,
  /** multiplier >= strong → 'strong' (orange, larger text) */
  strong: 1.2,
  /** multiplier >= devastating → 'devastating' (gold, largest text) */
  devastating: 1.5,
} as const;

/** Derive effectiveness tier from a multiplier value. */
export function getEffectiveness(multiplier: number): DamageEffectiveness {
  if (multiplier >= EFFECTIVENESS_THRESHOLDS.devastating) return 'devastating';
  if (multiplier >= EFFECTIVENESS_THRESHOLDS.strong) return 'strong';
  if (multiplier < EFFECTIVENESS_THRESHOLDS.weak) return 'weak';
  return 'normal';
}

// ==================== Visual Feedback Config ====================

/** Color for floating damage numbers, keyed by effectiveness tier. */
export const EFFECTIVENESS_COLORS: Record<DamageEffectiveness, string> = {
  weak:         '#888888',  // Grey — reduced damage
  normal:       '#FF4444',  // Red — standard (current behavior)
  strong:       '#FF8800',  // Orange — bonus damage
  devastating:  '#FFD700',  // Gold — massive bonus
};

/** Scale multiplier for floating damage numbers, keyed by effectiveness tier. */
export const EFFECTIVENESS_SCALES: Record<DamageEffectiveness, number> = {
  weak:         0.8,   // Smaller text for weak hits
  normal:       1.0,   // Standard
  strong:       1.15,  // Slightly larger
  devastating:  1.3,   // Noticeably larger
};
