/**
 * What the fight does to a destructible world (docs/DESTRUCTION_PLAN.md):
 * the stages a structure goes through, what the abilities do to structures
 * and ground, the craters, the rubble a fall leaves, and the wear of the
 * enemies passing by. A projectile type's own share is on the type
 * (ProjectileTypeConfig.structureDamage, craterRadius).
 *
 * Every value here, on the projectile types and of the enemies' siege guns
 * (EnemyTypeConfig.siege) acts in the simulation and goes into the world key
 * of a world that can be damaged
 * (destructionKeyParts), never into the balance hash: the tiles, DevWorld
 * and a custom map without destruction play and hash as before.
 */
import type { AbilityId } from './abilities.config';
import { PROJECTILE_TYPES } from './projectile-types.config';
import { ENEMY_TYPES } from './enemy-types.config';

/** 0 standing, 1 battered, 2 heavily damaged, 3 fallen (a ruin with its rubble) */
export type StructureStage = 0 | 1 | 2 | 3;

/** Above these percent of its HP a structure is still standing (stage 0) and still only battered (stage 1) */
export const STRUCTURE_STAGE_PERCENT = { standing: 75, battered: 40 } as const;

/** The stage of a structure at `hp` of `maxHp`, whole numbers only */
export function structureStage(hp: number, maxHp: number): StructureStage {
  if (hp <= 0) return 3;
  if (hp * 100 > maxHp * STRUCTURE_STAGE_PERCENT.standing) return 0;
  if (hp * 100 > maxHp * STRUCTURE_STAGE_PERCENT.battered) return 1;
  return 2;
}

/**
 * Steps of a turn a structure's heading comes in (StructureLedger): the way
 * the hit that brought its stage pushed it, from the hit to its middle, so
 * it gives way to that side. -1 where no hit is known (the map's damage
 * beforehand, a hit on its middle): the look rolls it from the id then
 */
export const STRUCTURE_HEADING_STEPS = 256;

/** The heading step of a push along map metres (`dx`, `dy`), -1 for none */
export function structureHeading(dx: number, dy: number, atan2: (y: number, x: number) => number): number {
  if (dx === 0 && dy === 0) return -1;
  const turn = atan2(dy, dx) / (Math.PI * 2);
  return ((Math.round(turn * STRUCTURE_HEADING_STEPS) % STRUCTURE_HEADING_STEPS) + STRUCTURE_HEADING_STEPS) % STRUCTURE_HEADING_STEPS;
}

/**
 * The holes heavy hits leave in a structure (E259): the last HOLE_SLOTS per
 * structure, HOLE_STRIDE whole numbers each (StructureLedger.holes): the
 * offset from its middle in map dm (x, y), the height over its ground in
 * dm, the radius in dm, the number of the hole that made or last grew it.
 * A hit makes one when its structure damage is HOLE_LEAST_DAMAGE or more
 * (the hero's grenade 25, the cannon 30, the rocket 45, a siege shell; not
 * the bullets, flak or magic); one within HOLE_MERGE_DM of a hole there
 * grows that one by HOLE_GROW_DM, up to HOLE_MAX_DM
 */
export const HOLE_SLOTS = 6;
export const HOLE_STRIDE = 5;
export const HOLE_LEAST_DAMAGE = 25;
export const HOLE_MERGE_DM = 15;
export const HOLE_GROW_DM = 6;
export const HOLE_MAX_DM = 60;
/** The ground radius (m) a hole has the size of its damage at; smaller structures get larger holes, larger smaller ones */
export const HOLE_SIZE_RADIUS_M = 6;
/**
 * How far past its hole's radius a hit still opens a wall, m: the hole sits
 * on the structure's ground plan where the hit came nearest (or at the
 * struck point itself), a hit farther off only takes HP (a house behind the
 * one struck keeps its walls)
 */
export const HOLE_REACH_M = 1.5;
/** A hit at the ground opens the wall from its foot: the hole's middle this share of its radius up, plus up to as much again by its roll */
export const HOLE_FOOT_SHARE = 0.4;

/**
 * A hole's radius in dm for a hit of `amount` structure damage on a
 * structure of ground radius `radiusM`: 1 m plus a quarter of the root of
 * the damage (cannon 2.4 m, rocket 2.7 m), times HOLE_SIZE_RADIUS_M over
 * the radius within 0.6 to 1.4 (a cottage of 4 m: a rocket's 3.7 m; a
 * block of 12 m: 1.6 m), 0.8 m to 5 m. IEEE square root and division:
 * the same on every client
 */
export function holeRadiusDm(amount: number, radiusM: number): number {
  const size = Math.min(1.4, Math.max(0.6, HOLE_SIZE_RADIUS_M / Math.max(0.5, radiusM)));
  return Math.min(50, Math.max(8, Math.round(10 * (1 + 0.25 * Math.sqrt(amount)) * size)));
}

/** A fallen structure's line of sight is worked out anew at every WEAR_SIGHT_EVERY-th hole from its second: a wall gone */
export const WEAR_SIGHT_EVERY = 4;

/** The share of its HP a structure the map damaged beforehand starts with (MapObject.damage), per stage */
const PRESET_HP_SHARE: Record<StructureStage, number> = { 0: 1, 1: 0.6, 2: 0.2, 3: 0 };

/** The HP of a structure of `maxHp` that starts at `stage`, in the middle of the stage */
export function presetHp(maxHp: number, stage: StructureStage): number {
  return Math.round(maxHp * PRESET_HP_SHARE[stage]);
}

/** How far past its splash radius (none: 0) a projectile's impact still reaches a structure, m, plus the structure's radius */
export const IMPACT_REACH_M = 1;

/** What an ability does to the structures and the ground where it lands */
export interface AbilityDestruction {
  /** Every structure in the ability's radius falls */
  fells?: boolean;
  /** HP per second a beam takes off every structure in its radius as it passes */
  structureHpPerSecond?: number;
  /** The crater it leaves, m and cm */
  crater?: { radiusM: number; depthCm: number };
}

/** Decided 2026-10-18: the nuke fells, the orbital laser damages, frost and EMP leave the world as it was */
export const ABILITY_DESTRUCTION: Record<AbilityId, AbilityDestruction> = {
  'nuclear-strike': { fells: true, crater: { radiusM: 25, depthCm: 400 } },
  'orbital-laser': { structureHpPerSecond: 150 },
  'frost-bomb': {},
  emp: {},
};

/** The craters of a run (CraterLedger) */
export const CRATERS = {
  /**
   * A guard far beyond any run, not a limit to play against: the list grows as the run needs it. Reached, a new
   * crater takes the place of the smallest (radius squared times depth, the first of equals), which goes into its
   * nearest neighbour; nothing a hit digs is lost
   */
  max: 65536,
  /** A hit this close to a crater's middle deepens it instead of making another, m */
  mergeM: 2,
  /**
   * A hit near a crater as deep as its radius allows widens it instead: by this share of the hit's radius, up to
   * `widenTo` times the hit's radius
   */
  widenShare: 0.25,
  widenTo: 2,
  /** Centimetres a hit digs per metre of its crater radius, and the most a crater gets per metre of its radius */
  depthPerRadiusCm: 14,
  maxDepthPerRadiusCm: 40,
} as const;

/** The heap of rubble a fallen structure leaves (StampField) */
export const RUBBLE = {
  /**
   * Its top as a share of the structure's height, held in cm: what is left of the floors, a storey's slab or two
   * deep in its stump (a house of 8 m 1 m, a block of 20 m 2.4 m), not a hill over it
   */
  heightShare: 0.12,
  minPeakCm: 30,
  maxPeakCm: 250,
  /** With a ground plan (box): the share of it the full height covers, the rest runs out over the falloff */
  core: 0.6,
  /** How far it runs out past the ground plan, m; without one, the ground radius times `spill` */
  spillM: 2,
  spill: 1.35,
  /** On rubble at least this high an enemy walks at `brake` of its pace */
  brakeFromCm: 30,
  brake: 0.85,
} as const;

/** The wear of the enemies passing a structure (a map's `gameplay.wear`), every `intervalMs` of game time */
export const WEAR = {
  intervalMs: 1000,
  /** An enemy on the ground within this of a structure (plus its radius) wears it, m */
  reachM: 6,
  /** HP per interval and enemy, a boss's */
  hp: 1,
  bossHp: 10,
} as const;

/**
 * What the dev tools' destruction tool sets off (debug:blast): a projectile
 * type's impact or the nuclear strike, through the same damage as the real
 * one. Not a value of the fight, so not in the world key
 */
export const DEBUG_BLASTS = ['cannonball', 'rocket', 'nuclear-strike'] as const;
export type DebugBlast = (typeof DEBUG_BLASTS)[number];

/**
 * The radius the destruction tool may give its nuclear strike (debug:blast `radius`, E284), m: what it fells,
 * its crater (radius and depth in the real strike's proportion) and its cloud scale with it. Without one the
 * strike's own (ABILITIES radiusM, 25 m). From 5 m, about one house, to 100 m, four times the real strike and
 * the largest crater the other dev tool digs (debug:dig-crater). Whole metres, so a command carries no stray
 * fraction of the slider
 */
export const DEBUG_BLAST_RADIUS = { min: 5, max: 100, step: 1 } as const;

/** The most the destruction tool's blast may have struck over the ground (debug:blast `up`), whole dm: a high-rise's roof */
export const DEBUG_BLAST_UP_DM = 3000;

/** The blasts a radius applies to: the nuclear strike only, a projectile's impact keeps its type's */
export const DEBUG_RADIUS_BLASTS: readonly DebugBlast[] = ['nuclear-strike'];

/** `radius` within DEBUG_BLAST_RADIUS, rounded to its step (the tool's slider and number field) */
export function clampDebugBlastRadius(radius: number): number {
  const { min, max, step } = DEBUG_BLAST_RADIUS;
  if (!Number.isFinite(radius)) return min;
  return Math.min(max, Math.max(min, Math.round(radius / step) * step));
}

/** Every value above, of the projectile types and of the siege guns as text, for the world key of a world that can be damaged */
export function destructionKeyParts(): string[] {
  const projectiles = Object.values(PROJECTILE_TYPES).map((p) => `${p.id}:${p.structureDamage}:${p.craterRadius ?? 0}:${p.splashRadius ?? 0}`);
  const guns = Object.values(ENEMY_TYPES).flatMap((t) => (t.siege ? [`${t.id}:${JSON.stringify(t.siege)}:${t.turret?.pivotHeight ?? 0}`] : []));
  return [
    JSON.stringify(STRUCTURE_STAGE_PERCENT),
    JSON.stringify(PRESET_HP_SHARE),
    String(IMPACT_REACH_M),
    `${HOLE_REACH_M}:${HOLE_FOOT_SHARE}`,
    JSON.stringify(ABILITY_DESTRUCTION),
    JSON.stringify(CRATERS),
    JSON.stringify(RUBBLE),
    JSON.stringify(WEAR),
    ...projectiles,
    ...guns,
  ];
}
