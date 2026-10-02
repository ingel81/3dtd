/**
 * Tower paths (TODO E101): a one-click upgrade a tower buys once, one per tower. A research opens a path for
 * its type; each tower of the type then buys it at `cost` and shows it on its model. A tower takes one path,
 * and keeps it until it is sold.
 */

import type { TowerTypeId } from './tower-types.config';
import type { ResearchId } from './research/research.types';

export type TowerPathId = 'scout';

export interface TowerPath {
  readonly id: TowerPathId;
  /** The tower type that can take it */
  readonly towerId: TowerTypeId;
  readonly name: string;
  /** One sentence for the tooltip */
  readonly description: string;
  /** Credits per tower */
  readonly cost: number;
  /** The research that opens it (its effect `unlock-path`) */
  readonly research: ResearchId;
  /**
   * Radius (m) within which the tower reveals camouflaged enemies (Enemy.camo) to every tower and the hero
   * (TODO E100), 0 or absent for none
   */
  readonly detectionRadius?: number;
  /** What the tower wears with it: a model in the tower model's own units, hung under its mesh */
  readonly attachment?: {
    readonly modelUrl: string;
    /** A node of it that sweeps slowly about its up axis (a lookout), absent for none */
    readonly sweepNode?: string;
  };
}

export const TOWER_PATHS: Readonly<Record<TowerPathId, TowerPath>> = {
  scout: {
    id: 'scout',
    towerId: 'archer',
    name: 'Scout',
    description: 'A lookout spots camouflaged enemies within 35 m: every tower can hit them there.',
    cost: 250,
    research: 'scouting',
    detectionRadius: 35,
    // tools/blender/scout_lookout.py
    attachment: { modelUrl: 'assets/models/towers/attachments/scout.glb', sweepNode: 'scout_nest' },
  },
};

/** The paths a tower of `typeId` can take, in the order of TOWER_PATHS */
export function pathsOf(typeId: string): TowerPath[] {
  return Object.values(TOWER_PATHS).filter((path) => path.towerId === typeId);
}

export function getTowerPath(id: string | null | undefined): TowerPath | null {
  return id ? TOWER_PATHS[id as TowerPathId] ?? null : null;
}
