import type { Enemy } from '../entities/enemy.entity';

/**
 * Per-enemy-type aim metrics.
 *
 * Projectiles, beams and chain bolts must converge on an enemy's *visual
 * centre*, not its model origin. Model origins sit at wildly different
 * places — feet for humanoids, body centre for flyers — and models span
 * very different heights (a small bat vs. a giant dragon boss). A single
 * hard-coded "+Nm above origin" therefore aims too high for small models
 * and too low for large ones.
 *
 * Each type's config carries its model's vertical extent across all baked
 * animation frames (EnemyTypeConfig.modelRangeY, measured by the VAT bake
 * and checked against the models by enemy-model-range.spec.ts). Combat code
 * reads its centre via getEnemyAimOffsetY(); an air unit coming out of a
 * spawn portal centres the whole extent in the opening (EnemyManager).
 */

/**
 * Aim offset (world metres above the model origin) of a type without a
 * modelRangeY: the ooze, whose hits land on its body instead.
 */
export const DEFAULT_AIM_OFFSET_Y = 2;

/**
 * Vertical offset (world metres) from an enemy's model origin to its
 * visual centre — where projectiles, beams and chain bolts should aim.
 *
 * The per-type extent (EnemyTypeConfig.modelRangeY, a constant, the same
 * bits in every engine) is unscaled, so multiplying by the enemy's
 * scale keeps the aim point correct even if enemies of one type ever vary
 * in size.
 */
export function getEnemyAimOffsetY(enemy: Enemy): number {
  const range = enemy.typeConfig.modelRangeY;
  if (range === undefined) return DEFAULT_AIM_OFFSET_Y;
  return ((range.min + range.max) / 2) * enemy.sizeScale;
}
