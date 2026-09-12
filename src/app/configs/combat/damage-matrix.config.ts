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
 *
 * Balance 2026-09: Spreizung pro Rüstung von 1,5× bis 11,7× auf 3× bis 20×
 * (unarmored 3,0, light 3,2, heavy 5,0, fortified 6,4, ethereal 20). Regeln:
 * jede Schadensart hat eine Paarung ≤ 0,5, jede außer physical eine ≥ 1,3,
 * jede Rüstung mindestens zwei Konter ≥ 1,2. Damit das Fairness-Gate die
 * Spreizung nicht wegrechnet, zählt es schlechte Boden-Paarungen mit
 * FAIRNESS_MATCHUP_FLOOR (templates.ts).
 *
 * Chaos ist die eine bewusste Ausnahme von den ersten beiden Regeln: 1,0 gegen
 * alles, keine Schwäche und keine Stärke. Der Generalist bezahlt dafür mit
 * Preis und Forschungstiefe, nicht mit einer Matrix-Lücke. Auch gegen Ethereal
 * 1,0: Magic (2,0), Ice und Lightning (1,5) bleiben die besseren Konter, und
 * die Chaos-Forschung setzt Arcane Studies voraus.
 */
export const DAMAGE_MATRIX: DamageMatrix = {
  //                 unarmored  light   heavy   fortified  ethereal
  physical:        { unarmored: 1.0,  light: 1.0,  heavy: 0.5,  fortified: 0.3,  ethereal: 0.1 },
  pierce:          { unarmored: 1.25, light: 1.6,  heavy: 0.35, fortified: 0.25, ethereal: 0.1 },
  siege:           { unarmored: 0.5,  light: 0.5,  heavy: 1.75, fortified: 1.6,  ethereal: 0.3 },
  magic:           { unarmored: 0.9,  light: 0.5,  heavy: 0.9,  fortified: 1.3,  ethereal: 2.0 },
  fire:            { unarmored: 1.5,  light: 1.2,  heavy: 0.6,  fortified: 0.25, ethereal: 0.1 },
  ice:             { unarmored: 1.0,  light: 1.3,  heavy: 0.8,  fortified: 0.5,  ethereal: 1.5 },
  poison:          { unarmored: 1.4,  light: 1.2,  heavy: 0.4,  fortified: 0.3,  ethereal: 0.2 },
  lightning:       { unarmored: 1.0,  light: 1.5,  heavy: 1.2,  fortified: 0.3,  ethereal: 1.5 },
  chaos:           { unarmored: 1.0,  light: 1.0,  heavy: 1.0,  fortified: 1.0,  ethereal: 1.0 },
};

// ==================== Effectiveness Thresholds ====================

/**
 * Thresholds for DamageEffectiveness tiers (based on final multiplier).
 * Tuneable — adjust these to change when damage numbers change color/size.
 */
export const EFFECTIVENESS_THRESHOLDS = {
  /** multiplier < weak → 'weak' (grey, smaller text). Every pairing ≤ 0.5 reads weak. */
  weak: 0.6,
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

/**
 * Scale multiplier for floating damage numbers, keyed by effectiveness tier.
 * Phase 5.16: widened spread so matchup differences are obvious mid-fight.
 *   weak hits → tiny grey numbers (almost a hint that you should reposition)
 *   devastating hits → big gold numbers (clear "this is the right tower")
 */
export const EFFECTIVENESS_SCALES: Record<DamageEffectiveness, number> = {
  weak:         0.55,  // Significantly smaller — visually communicates "barely doing anything"
  normal:       1.0,   // Standard
  strong:       1.35,  // Clearly bigger
  devastating:  1.75,  // Huge — instant feedback that this matchup is great
};
