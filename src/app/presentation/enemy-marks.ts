import { EF_ENRAGED } from '../sim/protocol/packet';

/** How an enemy the simulation marks looks: a scale on its model and a tint under the status tints */
export interface EnemyMarkLook {
  readonly scale: number;
  readonly tint: readonly [number, number, number] | null;
}

/** No mark */
export const NO_MARK = 0;
/** A boss in its rage (EF_ENRAGED): red */
export const MARK_ENRAGED = 1;

export const MARK_LOOKS: Readonly<Record<number, EnemyMarkLook>> = {
  [NO_MARK]: { scale: 1, tint: null },
  [MARK_ENRAGED]: { scale: 1, tint: [1, 0.15, 0.08] },
};

/** The mark the enemy table's flags (E_FLAGS) ask for */
export function enemyMarkOf(flags: number): number {
  return (flags & EF_ENRAGED) !== 0 ? MARK_ENRAGED : NO_MARK;
}
