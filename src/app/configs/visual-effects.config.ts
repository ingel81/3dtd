/**
 * Visual Effects Configuration
 *
 * Centralized particle, decal, and effect settings.
 * Previously hardcoded in three-effects.renderer.ts
 */

import type { TowerTypeId } from './tower-types.config';

/** Particle pool limits */
export const PARTICLE_LIMITS = {
  /** Trail additive pool serves: fire, explosions, rockets, bullets, flame beams - needs capacity for HQ explosion (~700) + inferno (300) */
  maxTrailParticlesPerPool: 3000,
  /** Trail normal pool serves: smoke, cannon trails, blood splatter */
  maxTrailNormalParticlesPerPool: 4000,
} as const;

/** Blood decal configuration */
export const BLOOD_DECAL_CONFIG = {
  maxDecals: 100,
  fadeDelay: 20000,    // ms before fade starts
  fadeDuration: 10000, // ms fade duration
  baseOpacity: 0.7,
  baseColor: { r: 0.55, g: 0, b: 0 },  // Dark red
  colorVariation: 0.2,  // Random variation range for r channel
  heightOffset: 0.12,   // Above ground to avoid z-fighting
} as const;

/** Ice decal configuration */
export const ICE_DECAL_CONFIG = {
  maxDecals: 150,
  fadeDelay: 4000,
  fadeDuration: 3000,
  baseOpacity: 0.6,
  baseColor: { r: 0.75, g: 0.94, b: 1.0 },  // Light cyan/white
  colorVariation: 0.1,  // Random variation range
  heightOffset: 0.12,   // Above ground to avoid z-fighting
} as const;

/**
 * Scorch marks, layer 1 of COMBAT_HEATMAP_STUDY.md: dark burn marks where
 * cannon shells and rockets land and where flame beams hit. At most one per
 * route-grid cell: another hit in the same cell darkens the mark and starts
 * its fade over instead of adding one, so the zones that see the most
 * fighting turn dark and the pool does not fill up with duplicates. Only
 * on route cells, only near the ground (air hits leave none).
 */
export const SCORCH_DECAL_CONFIG = {
  maxDecals: 200,
  fadeDelay: 60000,    // ms before fade starts (wall clock, like blood)
  fadeDuration: 30000, // ms fade duration
  /** Cap for the darkening by repeated hits */
  maxOpacity: 0.8,
  baseColor: { r: 0.07, g: 0.05, b: 0.035 },  // Soot, brownish black
  colorVariation: 0.03,
  heightOffset: 0.1,   // Above ground, below blood and ice (0.12)
  /** A hit further above the cell's ground than this (air units) leaves no mark, m */
  maxHeightAboveGround: 6,
  /** Per source: decal radius (m), opacity of a new mark, opacity added per further hit */
  sources: {
    cannon: { size: 2.2, opacity: 0.5, opacityStep: 0.1 },
    rocket: { size: 2.6, opacity: 0.55, opacityStep: 0.12 },
    fire:   { size: 1.6, opacity: 0.3, opacityStep: 0.05 },
  },
  /** A burning flame beam marks its target this often, ms */
  fireIntervalMs: 400,
} as const;

export type ScorchSource = keyof typeof SCORCH_DECAL_CONFIG.sources;

/** Peak and length of one screen shake */
export interface ScreenShakePreset {
  /** Peak offset as a share of the view height (0.005 = about 5 px at 1080p) */
  amplitude: number;
  /** ms until the offset is back to 0, falling linearly */
  duration: number;
}

/**
 * Screen shake (ScreenShakeService picks, ThreeTilesEngine draws it as a
 * screen-space offset of the projection). Impacts only shake near the
 * camera: full strength up to nearDistance, none from farDistance on. HQ
 * damage and boss deaths are game events rather than places and shake
 * wherever they happen.
 *
 * Calibrated on the camera-offset shake used until 2026-09-12 (metres, so
 * its size on screen shrank with the camera distance): impacts match it
 * seen from 150 m, HQ damage and boss deaths from the 425 m start camera.
 */
export const SCREEN_SHAKE_CONFIG = {
  nearDistance: 150, // m, camera to impact
  farDistance: 450,  // m
  presets: {
    cannon:    { amplitude: 0.0025, duration: 150 },
    rocket:    { amplitude: 0.005,  duration: 200 },
    /** Times 0.5 to 2 for 5 to 20 HP lost */
    hqDamage:  { amplitude: 0.0025, duration: 300 },
    bossDeath: { amplitude: 0.004,  duration: 400 },
  },
} as const satisfies { nearDistance: number; farDistance: number; presets: Record<string, ScreenShakePreset> };

/** Fire intensity presets */
export const FIRE_INTENSITY = {
  tiny:    { count: 10,  radius: 1, duration: 3000 },
  small:   { count: 30,  radius: 2, duration: 5000 },
  medium:  { count: 60,  radius: 3, duration: 8000 },
  large:   { count: 100, radius: 5, duration: 10000 },
  inferno: { count: 200, radius: 8, duration: -1 },  // -1 = infinite
} as const;

/**
 * Explosion presets for different projectile types. `radius` sizes the
 * fire-atlas explosion (EXPLOSION_LOOK), `smokePuffs` is its smoke stage.
 * The spark bursts (poison, arcane, chaos) only take a particle count, their
 * colours come from BURST_PALETTES.
 */
export const EXPLOSION_PRESETS = {
  // No splash: the radius is purely visual
  rocket:   { particles: 50,  radius: 8, smokePuffs: 6 },
  // Until 2026-09-12 a cannon hit spawned two explosions, 35 particles from
  // the impact event and 30 more from a second splash event one metre lower.
  // One explosion now, with most of the second one's particles folded in.
  // VFXService takes the radius from the cannonball's splashRadius.
  cannon:   { particles: 50,  radius: 6, smokePuffs: 5 },
  // Passes no radius: sized like the reference radius (EXPLOSION_LOOK)
  bullet:   { particles: 2 },
  // Green spark burst (BURST_PALETTES.poison). Until 2026-09-12 the glob hit
  // with 6 + 30 orange fire-atlas particles, which read as a fireball.
  poison:   { particles: 14 },
  arcane:   { particles: 14 },
  chaos:    { particles: 14 },
} as const;

/**
 * Look of the fire-atlas explosion (cannon, rocket and bullet impacts), in
 * two stages: a fireball of additive explosion-atlas sprites, then smoke
 * puffs from the smoke atlas in the normal pool that only show up once the
 * fireball's bright half is over.
 *
 * Speeds and sprite sizes are given for `referenceRadius` and scale with
 * the blast radius of the impact. The cannon (6 m splash) therefore keeps
 * the ranges every explosion used before 2026-09-12 and the rocket (8 m) is
 * a third larger; the bullet passes no radius and keeps them as well.
 *
 * Back to the old look: fire.sizeEnd 0 (sprites shrink to nothing again)
 * and smokePuffs 0 in EXPLOSION_PRESETS.
 */
export const EXPLOSION_LOOK = {
  referenceRadius: 6,
  fire: {
    /** Outward speed, m/s at the reference radius */
    speedMin: 5,
    speedMax: 20,
    /** Lifetime, s. The flash is the first quarter of the 16 atlas frames. */
    lifeMin: 0.3,
    lifeMax: 0.7,
    /** Sprite size at the reference radius */
    sizeMin: 2.5,
    sizeMax: 5.5,
    /**
     * Sprite scale at birth and at death. The atlas frames already grow the
     * fireball; shrinking the sprite to 0 (the old curve) halved it by the
     * time the fireball frames came up and collapsed it while it dissipated.
     */
    sizeStart: 1,
    sizeEnd: 0.4,
  },
  smoke: {
    /** Seconds before a puff shows: the fire sprites' bright half ends after 0.15-0.35 s */
    delayMin: 0.2,
    delayMax: 0.35,
    /** Lifetime after the delay, s */
    lifeMin: 1.2,
    lifeMax: 2.0,
    /** Sprite size at the reference radius */
    sizeMin: 2.5,
    sizeMax: 4.0,
    /** Puffs start at half size and billow out */
    sizeStart: 0.5,
    sizeEnd: 1,
    /** Horizontal scatter around the impact, share of the radius */
    spread: 0.3,
    /** Rise and sideways drift, m/s */
    riseMin: 1.0,
    riseMax: 2.5,
    drift: 0.5,
    /** Grey tint over the light smoke atlas: soot, not steam */
    greyMin: 0.3,
    greyMax: 0.45,
  },
} as const;

/** RGB colour, channels 0-1 (linear, as the particle pools store it). */
export interface EffectRgb {
  r: number;
  g: number;
  b: number;
}

/** Spark-burst palette: 40 % of the particles get the first colour, 30 % each the other two. */
export type BurstPalette = readonly [EffectRgb, EffectRgb, EffectRgb];

/** Palettes for the round-particle spark bursts (ice, arcane orb, chaos orb and poison glob hits). */
export const BURST_PALETTES = {
  poison: [
    { r: 0.55, g: 1.0, b: 0.2 },  // Bright toxic green core
    { r: 0.2, g: 0.8, b: 0.05 },  // Green
    { r: 0.1, g: 0.45, b: 0.0 },  // Dark green
  ],
  ice: [
    { r: 1.0, g: 1.0, b: 1.0 },   // White core
    { r: 0.9, g: 0.98, b: 1.0 },  // Very light cyan
    { r: 0.8, g: 0.95, b: 1.0 },  // Light ice blue
  ],
  arcane: [
    { r: 0.85, g: 0.9, b: 1.0 },  // White-lavender core
    { r: 0.55, g: 0.25, b: 1.0 }, // Violet
    { r: 0.3, g: 0.8, b: 1.0 },   // Cyan
  ],
  chaos: [
    { r: 1.0, g: 0.6, b: 1.0 },   // Pale magenta core
    { r: 0.6, g: 0.0, b: 1.0 },   // Violet
    { r: 0.95, g: 0.1, b: 0.65 }, // Magenta
  ],
} as const satisfies Record<string, BurstPalette>;

/** Muzzle flash of one tower type: particle burst at the shoot point plus the pooled flash light. */
export interface MuzzleFlashProfile {
  countMin: number;
  countMax: number;
  sizeMin: number;
  sizeMax: number;
  /** Particle lifetime in seconds */
  lifeMin: number;
  lifeMax: number;
  /** Intensity of the tower renderer's single muzzle PointLight (0 = no light) */
  lightIntensity: number;
}

/**
 * Muzzle flash per tower type. Only the towers listed here flash: the guns,
 * the launcher and (faintly) the bow. Ice, Magic and Poison also fire
 * projectiles but cast or spit them; Fire, Lightning and Tentacle never
 * spawn one. Until 2026-09-11 every projectile tower but Ice and Magic got
 * the same flash, Poison included.
 */
export const MUZZLE_FLASH_PROFILES: Partial<Record<TowerTypeId, MuzzleFlashProfile>> = {
  // A bow has no muzzle: a faint glint, no light
  archer: { countMin: 1, countMax: 2, sizeMin: 0.6, sizeMax: 1.2, lifeMin: 0.03, lifeMax: 0.05, lightIntensity: 0 },
  // 5 shots/s from two barrels: small and short, or the stream turns into a strobe
  'dual-gatling': { countMin: 2, countMax: 3, sizeMin: 1.0, sizeMax: 2.0, lifeMin: 0.03, lifeMax: 0.05, lightIntensity: 2 },
  // Launch flash: the values every tower shared before
  rocket: { countMin: 3, countMax: 5, sizeMin: 1.5, sizeMax: 3.0, lifeMin: 0.04, lifeMax: 0.06, lightIntensity: 3 },
  // Heavy gun at 0.5 shots/s: the biggest and longest flash
  cannon: { countMin: 6, countMax: 8, sizeMin: 2.5, sizeMax: 4.5, lifeMin: 0.06, lifeMax: 0.1, lightIntensity: 5 },
};

/** Effect color presets (RGB 0-1) */
export const EFFECT_COLORS = {
  blood: { r: 0.55, g: 0, b: 0 },
  fire: {
    core:  { r: 1, g: 0.9, b: 0.3 },
    mid:   { r: 1, g: 0.5, b: 0.1 },
    edge:  { r: 1, g: 0.2, b: 0.05 },
  },
  ice: {
    white: { r: 1.0, g: 1.0, b: 1.0 },
    cyan:  { r: 0.8, g: 0.95, b: 1.0 },
  },
  poison: {
    dark:   { r: 0.1, g: 0.4, b: 0.0 },
    mid:    { r: 0.2, g: 0.8, b: 0.05 },
    bright: { r: 0.8, g: 1.0, b: 0.2 },
  },
} as const;

/** Type exports */
export type FireIntensityLevel = keyof typeof FIRE_INTENSITY;
