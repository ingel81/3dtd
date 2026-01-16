/**
 * Visual Effects Configuration
 *
 * Centralized particle, decal, and effect settings.
 * Previously hardcoded in three-effects.renderer.ts
 */

/** Particle pool limits */
export const PARTICLE_LIMITS = {
  maxBloodParticles: 1000,
  maxFireParticles: 2000,
  /** Trail pool serves: fire, explosions, rockets, bullets - needs capacity for HQ explosion (1350) + inferno (300) */
  maxTrailParticlesPerPool: 3000,
  maxFloatingTexts: 50,
} as const;

/** Blood decal configuration */
export const BLOOD_DECAL_CONFIG = {
  maxDecals: 100,
  fadeDelay: 20000,    // ms before fade starts
  fadeDuration: 10000, // ms fade duration
  baseOpacity: 0.7,
} as const;

/** Ice decal configuration */
export const ICE_DECAL_CONFIG = {
  maxDecals: 150,
  fadeDelay: 4000,
  fadeDuration: 3000,
  baseOpacity: 0.6,
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
  cannon:   { particles: 35,  radius: 6 },
  hq:       { particles: 150, radius: 15 },
  small:    { particles: 8,   radius: 3 },
  bullet:   { particles: 2,   radius: 1 },
} as const;

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
} as const;

/** Type exports */
export type FireIntensityLevel = keyof typeof FIRE_INTENSITY;
export type ExplosionPreset = keyof typeof EXPLOSION_PRESETS;
