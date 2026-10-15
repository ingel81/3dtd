/**
 * Tower paths (TODO E101): a one-click upgrade a tower buys once, one per tower. A research opens a path for
 * its type; each tower of the type then buys it at `cost` and shows it on its model. A tower takes one path,
 * and keeps it until it is sold.
 */

import type { TowerTypeId } from './tower-types.config';
import type { ResearchId } from './research/research.types';

export type TowerPathId = 'scout' | 'incendiary' | 'multirole' | 'seal';

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
  /**
   * Share of a shot's damage that its direct hit sets burning (StatusEffectService.applyBurn, fire damage,
   * GAME_BALANCE.effects.burn.duration, one burn per tower refreshed by each hit), absent for none
   */
  readonly burnShare?: number;
  /**
   * An air-only tower also targets the ground, at this share of its damage (direct and splash), and keeps
   * to air targets while it has one (Tower.prefersAir); absent for none
   */
  readonly groundDamageShare?: number;
  /** Game ms a direct hit lifts its target's Phasing for (StatusEffectService.applySeal), absent for none */
  readonly sealMs?: number;
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
  incendiary: {
    id: 'incendiary',
    towerId: 'archer',
    name: 'Fire Arrows',
    description: 'Each hit sets its target burning for 3 s, a quarter of the arrow as fire damage a second; a burning enemy does not regenerate.',
    cost: 250,
    research: 'incendiary-arrows',
    // Archer L0: 30 physical a second plus 7.5 fire, +37 % against unarmored, +30 % against light and heavy
    // (docs/TOWER_CREATION.md, Pfade)
    burnShare: 0.25,
    // tools/blender/path_attachments.py
    attachment: { modelUrl: 'assets/models/towers/attachments/incendiary.glb' },
  },
  multirole: {
    id: 'multirole',
    towerId: 'rocket',
    name: 'Multirole',
    description: 'Fires at ground enemies too, at half damage, while no flyer is in range.',
    cost: 300,
    research: 'multirole-warheads',
    // Rocket L0 against the ground: 30 siege every 2 s with its 5 m splash, a third of a cannon (docs/TOWER_CREATION.md, Pfade)
    groundDamageShare: 0.5,
    // tools/blender/path_attachments.py
    attachment: { modelUrl: 'assets/models/towers/attachments/multirole.glb', sweepNode: 'multirole_radar' },
  },
  seal: {
    id: 'seal',
    towerId: 'magic',
    name: 'Binding Sigil',
    description: 'Each hit binds its target for 4 s: Phasing is lifted, ice slows take hold of wraiths.',
    cost: 250,
    research: 'binding-sigils',
    // Magic fires 1.5 a second: its target stays sealed while it is on it and 4 s after (docs/TOWER_CREATION.md, Pfade)
    sealMs: 4000,
    // tools/blender/path_attachments.py
    attachment: { modelUrl: 'assets/models/towers/attachments/seal.glb', sweepNode: 'seal_rings' },
  },
};

/** The paths a tower of `typeId` can take, in the order of TOWER_PATHS */
export function pathsOf(typeId: string): TowerPath[] {
  return Object.values(TOWER_PATHS).filter((path) => path.towerId === typeId);
}

export function getTowerPath(id: string | null | undefined): TowerPath | null {
  return id ? TOWER_PATHS[id as TowerPathId] ?? null : null;
}
