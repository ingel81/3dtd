/**
 * Tower paths (TODO E101): a one-click upgrade a tower buys once, one per tower. A research opens a path for
 * its type; each tower of the type then buys it at `cost` and shows it on its model. A tower takes one path,
 * and keeps it until it is sold.
 */

import { getTowerType, type TowerTypeConfig, type TowerTypeId } from './tower-types.config';
import type { ResearchId } from './research/research.types';

export type TowerPathId = 'scout' | 'incendiary' | 'multirole' | 'seal' | 'corrode' | 'sniper';

/**
 * What a path that swaps the tower's model replaces in its type's config (TowerPath.swap): the model and how
 * it stands and aims, and the base stats its upgrade tracks multiply. The swap keeps the muzzle height
 * (heightOffset + shootHeight) and stands within the type's footprint, so the tower's sight and plinth stay as
 * they are (tower-model.spec.ts checks both).
 */
export type TowerSwap = Pick<TowerTypeConfig,
  'modelUrl' | 'scale' | 'heightOffset' | 'shootHeight' | 'modelTop' | 'turnsTurret'>
  & Partial<Pick<TowerTypeConfig,
    'rotationY' | 'turretBarrelOffset' | 'turretNode' | 'turretRestY' | 'pitchNodes' | 'pitchRange' | 'firePoints'
    | 'hasAnimations' | 'animationPingPong' | 'damage' | 'range' | 'fireRate' | 'defaultTargeting' | 'projectileType'>>;

export interface TowerPath {
  readonly id: TowerPathId;
  /** The tower type that can take it */
  readonly towerId: TowerTypeId;
  readonly name: string;
  /** False: in dev builds only, hidden in production until it is released (configs/release.ts). Default true */
  readonly released?: boolean;
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
  /**
   * Game ms a direct hit corrodes its target for (StatusEffectService.applyCorrode): one armor class lighter
   * where that hurts more, never stacked, not on bosses; absent for none
   */
  readonly corrodeMs?: number;
  /**
   * Its direct hits count against the better of the target's armor and the next lighter one (LIGHTER_ARMOR,
   * as a corroded target's), bosses included; absent for none
   */
  readonly armorPiercing?: boolean;
  /** The tower becomes another model with other base stats (towerConfigOf), absent for none */
  readonly swap?: TowerSwap;
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
    released: false, // Dev builds only until it is released (configs/release.ts)
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
    released: false, // Dev builds only until it is released (configs/release.ts)
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
    released: false, // Dev builds only until it is released (configs/release.ts)
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
  corrode: {
    id: 'corrode',
    released: false, // Dev builds only until it is released (configs/release.ts)
    towerId: 'poison',
    name: 'Caustic',
    description: 'Each hit corrodes its target for 3 s: it counts one armor class lighter (bosses are immune).',
    cost: 250,
    research: 'caustic-compounds',
    // Direct hit only, one class at most: a poison tower keeps about three targets corroded (docs/TOWER_CREATION.md, Pfade)
    corrodeMs: 3000,
    // tools/blender/path_attachments.py
    attachment: { modelUrl: 'assets/models/towers/attachments/corrode.glb' },
  },
  sniper: {
    id: 'sniper',
    towerId: 'archer',
    name: 'Sniper',
    description: 'Rebuilt as a heavy ballista: twice the range, one armor-piercing bolt every 4 s, aimed at the strongest enemy.',
    cost: 300,
    research: 'ballista-bolts',
    released: false, // Dev builds only until it is released (configs/release.ts)
    // Archer L0: 35 physical a second in bolts of 140 against its 30, out to 60 m; through the armor 2.3 times the
    // archer against heavy, 1.9 times against fortified (docs/TOWER_CREATION.md, Pfade)
    armorPiercing: true,
    // Meshy "Ironclad Ballista", cut and reduced by tools/blender/build_tower.py (towers/ballista.json): nodes
    // base, turret_top (the yaw axis on the origin) and weapon (origin on the rear joint, the bolt level along
    // -X). 1.23 units high, the base's widest vertex 0.632 from the axis, the bolt 0.95 up and its tip 1.095
    // out: at scale 5.69 within the archer's footprint (3.6 m), the bolt 5.4 m up, its tip 6.2 m out.
    swap: {
      modelUrl: 'assets/models/towers/ballista.glb',
      scale: 5.69,
      heightOffset: 0, // The base's lowest point is the model origin
      shootHeight: 5.55, // The archer's muzzle height, 0.13 m above the bolt: the sight stays the archer's
      modelTop: 7.0,
      rotationY: -1.5708, // The bolt along -X in the file: turned so it faces north at rest, as the bastion
      turretBarrelOffset: -1.5708,
      turnsTurret: true,
      // The bolt leaves near its tip, not from the turret's middle
      firePoints: [{ x: 0, z: 6 }],
      // The weapon tilts on its rear joint, up to 40° for flyers
      pitchNodes: ['weapon'],
      pitchRange: { min: -0.15, max: 0.7 },
      hasAnimations: false,
      damage: 140,
      range: 60,
      fireRate: 0.25,
      defaultTargeting: 'highest-hp',
      // A heavy bolt on a flat path and its own string slap instead of the archer's arrow (PROJECTILE_TYPES.bolt)
      projectileType: 'bolt',
    },
  },
};

/** Type configs with a path's swap, one object per path, built on first use */
const swapped = new Map<TowerPathId, TowerTypeConfig>();

/**
 * The config a tower of `typeId` with path `pathId` runs on: its type's, or for a path with a swap that config
 * with the swap laid over it. Pure and the same object for the same path, so the simulation and every client
 * read the same model, muzzle and stats from the path alone.
 */
export function towerConfigOf(typeId: TowerTypeId, pathId: string | null | undefined): TowerTypeConfig {
  const base = getTowerType(typeId);
  const path = getTowerPath(pathId);
  if (!path?.swap || path.towerId !== typeId) return base;
  let config = swapped.get(path.id);
  if (!config) {
    config = { ...base, ...path.swap };
    swapped.set(path.id, config);
  }
  return config;
}

export function getTowerPath(id: string | null | undefined): TowerPath | null {
  return id ? TOWER_PATHS[id as TowerPathId] ?? null : null;
}
