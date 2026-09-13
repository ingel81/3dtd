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
 * The VAT baker measures each model's true vertical extent across all
 * animation frames (see vat-baker.ts) and registers it here. Combat code
 * reads its centre via getEnemyAimOffsetY(); an air unit coming out of a
 * spawn portal centres the whole extent in the opening (EnemyManager).
 */

/** typeId → vertical extent of the model in unscaled bake/root space. */
const modelRangeY = new Map<string, { min: number; max: number }>();

/**
 * Fallback aim offset (world metres above the model origin) used only
 * before a type has been baked — defensive, in practice every targetable
 * enemy is already rendered and therefore baked.
 */
export const DEFAULT_AIM_OFFSET_Y = 2;

/**
 * Register the measured vertical extent of an enemy model. Called once
 * per type by the VAT baker pipeline. `minY` and `maxY` are in the same
 * unscaled model/root space as the baked VAT positions.
 */
export function registerEnemyModelRangeY(typeId: string, minY: number, maxY: number): void {
  modelRangeY.set(typeId, { min: minY, max: maxY });
}

/**
 * Vertical extent of a type's model (unscaled, see
 * registerEnemyModelRangeY), undefined before its bake.
 */
export function getEnemyModelRangeY(typeId: string): Readonly<{ min: number; max: number }> | undefined {
  return modelRangeY.get(typeId);
}

/**
 * Vertical offset (world metres) from an enemy's model origin to its
 * visual centre — where projectiles, beams and chain bolts should aim.
 *
 * The per-type extent is measured unscaled, so multiplying by the enemy's
 * scale keeps the aim point correct even if enemies of one type ever vary
 * in size.
 */
export function getEnemyAimOffsetY(enemy: Enemy): number {
  const range = modelRangeY.get(enemy.typeConfig.id);
  if (range === undefined) return DEFAULT_AIM_OFFSET_Y;
  return ((range.min + range.max) / 2) * enemy.typeConfig.scale;
}
