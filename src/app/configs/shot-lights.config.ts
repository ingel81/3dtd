import type { ProjectileVisualType } from './projectile-types.config';
import type { TowerTypeId } from './tower-types.config';

/**
 * Light that shots throw on the land around them (docs/SHOT_LIGHTS.md,
 * E242): muzzle flashes, glowing projectiles in flight, impacts and
 * explosions, beams and the abilities' blasts. ShotLights gathers them per
 * frame and hands the strongest in view to the materials that take them: a
 * custom map's ground and objects, the towers, plinths, the hero and the
 * enemies (the 3D tiles ignore every dynamic light).
 *
 * `color` is linear RGB, `intensity` the light it adds at its centre (the
 * map's lamps give about 2.4 at the foot of a street lamp), `radius` where
 * it has faded to nothing, metres. A pulse lasts `durationS` and fades from
 * its full strength, squared, its colour cooling to `fade` (a blast white
 * hot, then orange, then deep red); `jitter` varies its strength by chance,
 * so no two flashes of a gatling are alike.
 */
export interface ShotLightLook {
  color: readonly [number, number, number];
  intensity: number;
  radius: number;
}

export interface ShotLightPulseLook extends ShotLightLook {
  durationS: number;
  fade?: readonly [number, number, number];
  jitter?: number;
}

/**
 * Muzzle flashes per tower type, at the barrel (VFXService.handleMuzzleFlash,
 * the towers with a MUZZLE_FLASH_PROFILES entry). The bow throws none.
 * Short: the gatling fires ten rounds a second from two barrels, a longer
 * flash would stand as a steady glow instead of a stutter.
 */
export const MUZZLE_LIGHTS: Partial<Record<TowerTypeId, ShotLightPulseLook>> = {
  'dual-gatling': { color: [1.0, 0.78, 0.45], fade: [1.0, 0.42, 0.12], intensity: 5, radius: 16, durationS: 0.06, jitter: 0.35 },
  rocket: { color: [1.0, 0.8, 0.5], fade: [1.0, 0.4, 0.12], intensity: 6, radius: 18, durationS: 0.14, jitter: 0.15 },
  cannon: { color: [1.0, 0.82, 0.55], fade: [0.95, 0.35, 0.08], intensity: 9, radius: 24, durationS: 0.12, jitter: 0.15 },
  bastion: { color: [1.0, 0.8, 0.52], fade: [0.95, 0.38, 0.1], intensity: 8, radius: 22, durationS: 0.1, jitter: 0.2 },
};

/**
 * Projectiles in flight that glow, by their look (the projectile renderer's
 * pools): tracers, shells, orbs, the rocket's exhaust. Arrows, bolts and
 * cannonballs do not glow.
 */
export const FLIGHT_LIGHTS: Partial<Record<ProjectileVisualType, ShotLightLook>> = {
  bullet: { color: [1.0, 0.68, 0.22], intensity: 1.4, radius: 10 },
  shell: { color: [1.0, 0.42, 0.12], intensity: 1.8, radius: 10 },
  magic: { color: [0.52, 0.32, 1.0], intensity: 2.4, radius: 12 },
  chaos: { color: [0.85, 0.14, 0.9], intensity: 2.2, radius: 12 },
  poison: { color: [0.32, 0.9, 0.14], intensity: 1.4, radius: 9 },
  ice: { color: [0.55, 0.82, 1.0], intensity: 1.4, radius: 9 },
  rocket: { color: [1.0, 0.55, 0.2], intensity: 2.8, radius: 13 },
};

/** Impacts by projectile type (VFXService.handleProjectileImpact); the bigger blasts as wide as their splash */
export const IMPACT_LIGHTS: Partial<Record<string, ShotLightPulseLook>> = {
  rocket: { color: [1.0, 0.85, 0.6], fade: [0.85, 0.24, 0.05], intensity: 12, radius: 26, durationS: 0.45, jitter: 0.1 },
  cannonball: { color: [1.0, 0.82, 0.58], fade: [0.85, 0.26, 0.06], intensity: 10, radius: 22, durationS: 0.4, jitter: 0.1 },
  'flak-shell': { color: [1.0, 0.85, 0.6], fade: [0.9, 0.3, 0.07], intensity: 9, radius: 20, durationS: 0.32, jitter: 0.15 },
  'hero-shell': { color: [1.0, 0.8, 0.55], fade: [0.9, 0.3, 0.08], intensity: 6, radius: 14, durationS: 0.28, jitter: 0.15 },
  bullet: { color: [1.0, 0.85, 0.55], fade: [1.0, 0.5, 0.15], intensity: 1.6, radius: 5, durationS: 0.06, jitter: 0.4 },
  'hero-round': { color: [1.0, 0.85, 0.55], fade: [1.0, 0.5, 0.15], intensity: 1.4, radius: 5, durationS: 0.06, jitter: 0.4 },
  'arcane-orb': { color: [0.78, 0.62, 1.0], fade: [0.35, 0.16, 1.0], intensity: 4, radius: 13, durationS: 0.25 },
  'hero-rune': { color: [0.78, 0.65, 1.0], fade: [0.35, 0.18, 1.0], intensity: 3, radius: 10, durationS: 0.2 },
  'chaos-orb': { color: [1.0, 0.5, 1.0], fade: [0.55, 0.04, 0.7], intensity: 4, radius: 13, durationS: 0.25 },
  'poison-glob': { color: [0.62, 1.0, 0.4], fade: [0.12, 0.65, 0.04], intensity: 3, radius: 11, durationS: 0.28 },
  'ice-shard': { color: [0.85, 0.95, 1.0], fade: [0.32, 0.62, 1.0], intensity: 4, radius: 14, durationS: 0.32 },
};

/** Continuous lights of beams, set each frame they burn */
export const BEAM_LIGHTS = {
  /** The fire tower's flame, where it lands and halfway along it */
  flame: { color: [1.0, 0.48, 0.14], intensity: 4.5, radius: 15 },
  /** The sentinel's laser at its target, cold (hot: 2.4 times as bright) */
  laser: { color: [1.0, 0.45, 0.22], intensity: 3, radius: 14 },
  /** The orbital laser where its column meets the ground */
  orbital: { color: [1.0, 0.45, 0.22], intensity: 14, radius: 32 },
  /** The nuclear strike's missile at its nozzle, by the engine's thrust: the silo and the land under its climb */
  missile: { color: [1.0, 0.62, 0.28], intensity: 9, radius: 30 },
} as const satisfies Record<string, ShotLightLook>;

/** A chain lightning bolt, at each end of a segment */
export const LIGHTNING_LIGHT: ShotLightPulseLook = {
  color: [0.9, 0.95, 1.0], fade: [0.42, 0.58, 1.0], intensity: 7, radius: 18, durationS: 0.18, jitter: 0.45,
};

/** The abilities' blasts; their radius is a share of the ability's own */
export const BLAST_LIGHTS = {
  /** The nuclear strike's flash, over three times its radius */
  nuke: { color: [1.0, 0.96, 0.88], fade: [1.0, 0.38, 0.08], intensity: 30, radius: 3, durationS: 1.6 },
  emp: { color: [0.8, 0.9, 1.0], fade: [0.3, 0.5, 1.0], intensity: 12, radius: 1.3, durationS: 0.7 },
  frost: { color: [0.9, 0.97, 1.0], fade: [0.45, 0.75, 1.0], intensity: 8, radius: 1.2, durationS: 0.6 },
} as const satisfies Record<string, ShotLightPulseLook>;
