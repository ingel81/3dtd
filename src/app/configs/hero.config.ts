/**
 * The hero: a mercenary the player hires once and sends along the enemy
 * routes. Design: docs/game-design/PLAYER_AGENCY_CONCEPT.md section 7 (stage one:
 * routes only, invulnerable); how it is built and why the numbers are what
 * they are: docs/HERO.md.
 *
 * A research unlocks him by granting the global perk `perkId`; the player
 * then hires him once for `cost`. He fights on his own within `rangeM`,
 * holds the spot he was sent to and chases enemies up to `leashM` along the
 * route. He levels up through kills, not gold.
 */

import type { DamageType } from './combat/combat.types';
import type { ProjectileTypeId } from './tower-types.config';

/** Source id of the hero's shots in the damage path (DamageApplicationService). */
export const HERO_SOURCE_ID = 'hero';

export const HERO = {
  /** UI label; the game UI is English */
  name: 'Mercenary',
  /** Research that unlocks the hire */
  researchId: 'mercenary-contract',
  /** Global perk that research grants; the manager unlocks on it */
  perkId: 'mercenary',
  /** One-time price of the hire, credits */
  cost: 1000,
  /** Walking speed, m/s. Faster than most ground enemies, slower than rats and bats */
  speedMps: 8,
  /** Firing range, 2D like the towers', ground and air, no line of sight */
  rangeM: 18,
  /** How far along the route he chases from the spot he holds, metres */
  leashM: 20,
  /** A move order lands on the route point nearest to the click within this distance, or is refused */
  orderSnapM: 30,
  /** While he holds a spot, how often he picks what to chase, game-time ms */
  pursuitReplanMs: 250,
  /**
   * Muzzle relative to his feet as he faces forward, metres: where his shots
   * start. Measured on mercenary.glb at HERO_MODEL.heightM in the aim pose
   * (hero.renderer.spec.ts checks it against the file). The sim uses these
   * numbers, never the rendered model, so a shot leaves the same way at
   * every timescale and headless.
   */
  muzzle: { forwardM: 2.4, rightM: 0.36, upM: 3.45 },
  /**
   * Share of his damage the fairness gate counts: he is one unit and cannot
   * be everywhere on the route at once (docs/HERO.md, fairness gate).
   */
  gatePresence: 0.5,
} as const;

/**
 * Muzzle offset east and north of his feet, metres, for a heading in
 * TransformComponent's convention (scene rotation.y: 0 north, PI/2 west).
 * The model faces +Z, its right hand is -X.
 */
export function heroMuzzleOffset(heading: number): { eastM: number; northM: number } {
  const { forwardM, rightM } = HERO.muzzle;
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  return { eastM: rightM * cos - forwardM * sin, northM: rightM * sin + forwardM * cos };
}

// ==================== Ammo ====================

/**
 * Ammo is his damage type: standard rounds physical, explosive rounds siege,
 * rune rounds magic. Every kind does the same damage per second before the
 * matrix; the choice is which armor it works against.
 */
export type HeroAmmoId = 'standard' | 'explosive' | 'rune';

export interface HeroAmmoConfig {
  id: HeroAmmoId;
  /** UI label */
  name: string;
  damageType: DamageType;
  /** Damage per shot at level 1, before the damage matrix */
  damage: number;
  /** Shots per second */
  fireRate: number;
  /** What flies: tracer, trail and shot sound come with the projectile type */
  projectileType: ProjectileTypeId;
}

export const HERO_AMMO: Record<HeroAmmoId, HeroAmmoConfig> = {
  standard: {
    id: 'standard',
    name: 'Standard rounds',
    damageType: 'physical',
    damage: 16,
    fireRate: 3,
    projectileType: 'hero-round',
  },
  explosive: {
    id: 'explosive',
    name: 'Explosive rounds',
    damageType: 'siege',
    damage: 32,
    fireRate: 1.5,
    projectileType: 'hero-shell',
  },
  rune: {
    id: 'rune',
    name: 'Rune rounds',
    damageType: 'magic',
    damage: 24,
    fireRate: 2,
    projectileType: 'hero-rune',
  },
};

/** Ammo in the order the switch runs through it */
export const HERO_AMMO_ORDER: readonly HeroAmmoId[] = ['standard', 'explosive', 'rune'];

/** The ammo after `ammo` in HERO_AMMO_ORDER, round the list. */
export function nextHeroAmmo(ammo: HeroAmmoId): HeroAmmoId {
  const i = HERO_AMMO_ORDER.indexOf(ammo);
  return HERO_AMMO_ORDER[(i + 1) % HERO_AMMO_ORDER.length];
}

// ==================== Levels ====================

export interface HeroLevel {
  level: number;
  /** Kills that reach this level */
  kills: number;
  /** Multiplier on the damage of every shot */
  damageMultiplier: number;
}

/**
 * Five levels, +15% damage each, reached by kills. Range, speed and fire
 * rate stay. Docs/HERO.md has the curve against the wave sizes.
 */
export const HERO_LEVELS: readonly HeroLevel[] = [
  { level: 1, kills: 0, damageMultiplier: 1.0 },
  { level: 2, kills: 30, damageMultiplier: 1.15 },
  { level: 3, kills: 100, damageMultiplier: 1.3 },
  { level: 4, kills: 250, damageMultiplier: 1.45 },
  { level: 5, kills: 500, damageMultiplier: 1.6 },
];

/** The level `kills` reach. */
export function heroLevelFor(kills: number): HeroLevel {
  let reached = HERO_LEVELS[0];
  for (const level of HERO_LEVELS) {
    if (kills >= level.kills) reached = level;
  }
  return reached;
}

// ==================== Fairness gate ====================

/**
 * The hero as the fairness gate reads him (analyzeDefense): a virtual tower
 * with his damage per second and shots per second for each ammo, counted at
 * `presence`. The gate takes the best ammo per armor, since the player can
 * switch any time.
 */
export interface HeroDefenseProfile {
  ammo: readonly { damageType: DamageType; dps: number; shotsPerSecond: number }[];
  /** Share the gate counts, HERO.gatePresence */
  presence: number;
}

/** The profile of a hero with `kills`, his level's damage included. */
export function heroDefenseProfile(kills: number): HeroDefenseProfile {
  const multiplier = heroLevelFor(kills).damageMultiplier;
  return {
    ammo: HERO_AMMO_ORDER.map((id) => {
      const ammo = HERO_AMMO[id];
      return { damageType: ammo.damageType, dps: ammo.damage * multiplier * ammo.fireRate, shotsPerSecond: ammo.fireRate };
    }),
    presence: HERO.gatePresence,
  };
}

// ==================== Status ====================

/** What the UI shows of the hero: the HeroManager's snapshot. */
export interface HeroStatus {
  /** The research is done: he can be hired */
  unlocked: boolean;
  hired: boolean;
  level: number;
  maxLevel: number;
  kills: number;
  /** Kills since the current level began */
  xp: number;
  /** Kills the current level takes to the next, null at the top level */
  xpToNext: number | null;
  ammo: HeroAmmoId;
  /** 'travel' on his way to an ordered spot, 'hold' at it or on the leash around it */
  mode: 'travel' | 'hold';
}

/** Why a hero command was refused. */
export type HeroRejectReason = 'locked' | 'hired' | 'credits' | 'no-hero' | 'no-route' | 'unknown-ammo';

/** Status before the research, as at the start of a run. */
export function initialHeroStatus(): HeroStatus {
  return heroStatus(false, false, 0, 'standard', 'hold');
}

/** Snapshot of a hero with `kills`; level and experience follow from them. */
export function heroStatus(
  unlocked: boolean,
  hired: boolean,
  kills: number,
  ammo: HeroAmmoId,
  mode: 'travel' | 'hold',
): HeroStatus {
  const current = heroLevelFor(kills);
  const next = HERO_LEVELS.find((l) => l.level === current.level + 1) ?? null;
  return {
    unlocked,
    hired,
    level: current.level,
    maxLevel: HERO_LEVELS[HERO_LEVELS.length - 1].level,
    kills,
    xp: kills - current.kills,
    xpToNext: next ? next.kills - current.kills : null,
    ammo,
    mode,
  };
}
