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
 * animation frames (see vat-baker.ts) and registers the geometric centre
 * here. Combat code reads it via getEnemyAimOffsetY().
 */

/** typeId → vertical model centre in unscaled bake/root space. */
const modelCenterY = new Map<string, number>();

/**
 * Fallback aim offset (world metres above the model origin) used only
 * before a type has been baked — defensive, in practice every targetable
 * enemy is already rendered and therefore baked.
 */
export const DEFAULT_AIM_OFFSET_Y = 2;

/**
 * Register the measured vertical centre of an enemy model. Called once
 * per type by the VAT baker pipeline. `centerY` is in the same unscaled
 * model/root space as the baked VAT positions.
 */
export function registerEnemyModelCenterY(typeId: string, centerY: number): void {
  modelCenterY.set(typeId, centerY);
}

/**
 * Vertical offset (world metres) from an enemy's model origin to its
 * visual centre — where projectiles, beams and chain bolts should aim.
 *
 * The per-type centre is measured unscaled, so multiplying by the enemy's
 * scale keeps the aim point correct even if enemies of one type ever vary
 * in size.
 */
export function getEnemyAimOffsetY(enemy: Enemy): number {
  const centerY = modelCenterY.get(enemy.typeConfig.id);
  if (centerY === undefined) return DEFAULT_AIM_OFFSET_Y;
  return centerY * enemy.typeConfig.scale;
}
