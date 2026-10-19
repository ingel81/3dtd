import type { Material } from 'three';
import type { CatalogObject } from '../asset-catalog';

/**
 * The damage of a destructible map's buildings (docs/DESTRUCTION_PLAN.md): which assets carry it, and how a
 * material of theirs and the far boxes' draw it (the DAMAGE branch, a key of its own for the program)
 */
export interface ObjectDamage {
  destructible(entry: CatalogObject): boolean;
  material(m: Material): void;
  key: string;
}

/** An object without damage: stage 0, seed 0, direction 0, no fall under way (negative start) */
export const NO_DAMAGE: readonly number[] = [0, 0, 0, -1];
