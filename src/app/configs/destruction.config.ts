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
  /** At most this many per run; a hit beyond leaves only its scorch mark, which keeps no state */
  max: 256,
  /** A hit this close to a crater's middle deepens it instead of making another, m */
  mergeM: 2,
  /** Centimetres a hit digs per metre of its crater radius, and the most a crater gets per metre of its radius */
  depthPerRadiusCm: 14,
  maxDepthPerRadiusCm: 40,
} as const;

/** The heap of rubble a fallen structure leaves (StampField) */
export const RUBBLE = {
  /** Its top as a share of the structure's height, held in cm */
  heightShare: 0.3,
  minPeakCm: 40,
  maxPeakCm: 350,
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

/** Every value above, of the projectile types and of the siege guns as text, for the world key of a world that can be damaged */
export function destructionKeyParts(): string[] {
  const projectiles = Object.values(PROJECTILE_TYPES).map((p) => `${p.id}:${p.structureDamage}:${p.craterRadius ?? 0}:${p.splashRadius ?? 0}`);
  const guns = Object.values(ENEMY_TYPES).flatMap((t) => (t.siege ? [`${t.id}:${JSON.stringify(t.siege)}:${t.turret?.pivotHeight ?? 0}`] : []));
  return [
    JSON.stringify(STRUCTURE_STAGE_PERCENT),
    JSON.stringify(PRESET_HP_SHARE),
    String(IMPACT_REACH_M),
    JSON.stringify(ABILITY_DESTRUCTION),
    JSON.stringify(CRATERS),
    JSON.stringify(RUBBLE),
    JSON.stringify(WEAR),
    ...projectiles,
    ...guns,
  ];
}
