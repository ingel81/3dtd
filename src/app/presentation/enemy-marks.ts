import { EF_ELITE, EF_ENRAGED } from '../sim/protocol/packet';
import { ELITE_SIZE } from '../configs/enemy-types.config';

/** How an enemy the simulation marks looks: a scale on its model and a tint under the status tints */
export interface EnemyMarkLook {
  readonly scale: number;
  readonly tint: readonly [number, number, number] | null;
}

/** No mark */
export const NO_MARK = 0;
/** A boss in its rage (EF_ENRAGED): red */
export const MARK_ENRAGED = 1;
/** An elite (EF_ELITE): a quarter bigger, gold */
export const MARK_ELITE = 2;

export const MARK_LOOKS: Readonly<Record<number, EnemyMarkLook>> = {
  [NO_MARK]: { scale: 1, tint: null },
  [MARK_ENRAGED]: { scale: 1, tint: [1, 0.15, 0.08] },
  [MARK_ELITE]: { scale: ELITE_SIZE, tint: [1, 0.78, 0.22] },
};

/** The mark the enemy table's flags (E_FLAGS) ask for, the rage over the elite */
export function enemyMarkOf(flags: number): number {
  if ((flags & EF_ENRAGED) !== 0) return MARK_ENRAGED;
  return (flags & EF_ELITE) !== 0 ? MARK_ELITE : NO_MARK;
}
