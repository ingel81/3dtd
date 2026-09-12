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

/** Fire intensity presets */
export const FIRE_INTENSITY = {
  tiny:    { count: 10,  radius: 1, duration: 3000 },
  small:   { count: 30,  radius: 2, duration: 5000 },
  medium:  { count: 60,  radius: 3, duration: 8000 },
  large:   { count: 100, radius: 5, duration: 10000 },
  inferno: { count: 200, radius: 8, duration: -1 },  // -1 = infinite
} as const;

/** Explosion presets for different projectile types */
export const EXPLOSION_PRESETS = {
  rocket:   { particles: 50,  radius: 8 },
  // Until 2026-09-12 a cannon hit spawned two explosions, 35 particles from
  // the impact event and 30 more from a second splash event one metre lower.
  // One explosion now, with most of the second one's particles folded in.
  cannon:   { particles: 50,  radius: 6 },
  hq:       { particles: 150, radius: 15 },
  small:    { particles: 8,   radius: 3 },
  bullet:   { particles: 2,   radius: 1 },
  poison:   { particles: 6,   radius: 2 },
  arcane:   { particles: 14,  radius: 3 },
} as const;

/** RGB colour, channels 0-1 (linear, as the particle pools store it). */
export interface EffectRgb {
  r: number;
  g: number;
  b: number;
}

/** Spark-burst palette: 40 % of the particles get the first colour, 30 % each the other two. */
export type BurstPalette = readonly [EffectRgb, EffectRgb, EffectRgb];

/** Palettes for the round-particle spark bursts (ice hit, arcane orb hit). */
export const BURST_PALETTES = {
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
export type ExplosionPreset = keyof typeof EXPLOSION_PRESETS;
