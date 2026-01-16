import { ProjectileTypeId } from './tower-types.config';

// Re-export ProjectileTypeId for convenience
export type { ProjectileTypeId } from './tower-types.config';

export type ProjectileVisualType = 'arrow' | 'cannonball' | 'magic' | 'bullet' | 'rocket';

/**
 * Trail particle configuration for projectiles
 */
export interface TrailParticleConfig {
  enabled: boolean;
  spawnChance: number; // 0-1, chance per frame to spawn particles
  countPerSpawn: number; // Particles per spawn event

  // Color (RGB 0-1)
  colorMin: { r: number; g: number; b: number };
  colorMax: { r: number; g: number; b: number };

  // Size
  sizeMin: number;
  sizeMax: number;

  // Lifetime in seconds
  lifetimeMin: number;
  lifetimeMax: number;

  // Velocity
  velocityX: { min: number; max: number };
  velocityY: { min: number; max: number };
  velocityZ: { min: number; max: number };

  // Spawn offset from projectile center
  spawnOffset: number;

  // Blending mode: 'additive' (default, good for fire/glow) or 'normal' (good for smoke)
  blending?: 'additive' | 'normal';
}

export interface ProjectileTypeConfig {
  id: ProjectileTypeId;
  speed: number; // m/s
  visualType: ProjectileVisualType;
  scale: number;

  // Splash damage (optional)
  splashRadius?: number; // Radius in meters (0 or undefined = no splash)
  splashDamageFalloff?: boolean; // Damage decreases with distance (default: true)

  // Trail particles (optional)
  trailParticles?: TrailParticleConfig;
}

export const PROJECTILE_TYPES: Record<ProjectileTypeId, ProjectileTypeConfig> = {
  arrow: {
    id: 'arrow',
    speed: 80,
    visualType: 'arrow',
    scale: 8, // Model is tiny (~0.8m), scale up significantly
  },
  cannonball: {
    id: 'cannonball',
    speed: 50,
    visualType: 'cannonball',
    scale: 0.5,
    splashRadius: 16,
    splashDamageFalloff: true,
    trailParticles: {
      enabled: true,
      spawnChance: 0.3,
      countPerSpawn: 1,
      colorMin: { r: 0.05, g: 0.05, b: 0.05 }, // Near black
      colorMax: { r: 0.2, g: 0.2, b: 0.2 }, // Dark grey
      sizeMin: 0.4,
      sizeMax: 0.8,
      lifetimeMin: 0.3,
      lifetimeMax: 0.7,
      velocityX: { min: -1.5, max: 1.5 },
      velocityY: { min: 0.5, max: 1.5 }, // Drift upward
      velocityZ: { min: -1.5, max: 1.5 },
      spawnOffset: 0.3,
      blending: 'normal', // Use normal blending for opaque smoke
    },
  },
  fireball: {
    id: 'fireball',
    speed: 100,
    visualType: 'magic',
    scale: 0.4,
  },
  'ice-shard': {
    id: 'ice-shard',
    speed: 90,
    visualType: 'magic',
    scale: 0.4,
    splashRadius: 12,
    splashDamageFalloff: true,
    trailParticles: {
      enabled: true,
      spawnChance: 0.8,
      countPerSpawn: 2,
      colorMin: { r: 0.85, g: 0.95, b: 1.0 }, // Sehr hellblau/weiß
      colorMax: { r: 1.0, g: 1.0, b: 1.0 }, // Reines Weiß
      sizeMin: 0.4,
      sizeMax: 0.8,
      lifetimeMin: 0.3,
      lifetimeMax: 0.6,
      velocityX: { min: -1.5, max: 1.5 },
      velocityY: { min: -0.5, max: 1.0 },
      velocityZ: { min: -1.5, max: 1.5 },
      spawnOffset: 0.3,
      blending: 'additive',
    },
  },
  bullet: {
    id: 'bullet',
    speed: 150,
    visualType: 'bullet',
    scale: 0.15,
    trailParticles: {
      enabled: true,
      spawnChance: 0.5, // Every other frame for less density
      countPerSpawn: 1,
      colorMin: { r: 1.0, g: 0.8, b: 0.0 }, // Pure yellow
      colorMax: { r: 1.0, g: 0.9, b: 0.1 }, // Slightly lighter yellow
      sizeMin: 0.3,
      sizeMax: 0.5,
      lifetimeMin: 0.03,
      lifetimeMax: 0.06, // Very short tracer
      velocityX: { min: -0.2, max: 0.2 },
      velocityY: { min: -0.2, max: 0.2 },
      velocityZ: { min: -0.2, max: 0.2 },
      spawnOffset: 0.05,
    },
  },
  rocket: {
    id: 'rocket',
    speed: 120,
    visualType: 'rocket',
    scale: 1.0,
    trailParticles: {
      enabled: true,
      spawnChance: 1.0, // Every frame
      countPerSpawn: 2,
      colorMin: { r: 1.0, g: 0.4, b: 0.1 }, // Orange
      colorMax: { r: 1.0, g: 0.8, b: 0.2 }, // Yellow-orange
      sizeMin: 1.0,
      sizeMax: 2.0,
      lifetimeMin: 0.3,
      lifetimeMax: 0.6,
      velocityX: { min: -2, max: 2 },
      velocityY: { min: -3, max: -1 }, // Drift downward
      velocityZ: { min: -2, max: 2 },
      spawnOffset: 0.5,
    },
  },
};

export function getProjectileType(id: ProjectileTypeId): ProjectileTypeConfig {
  return PROJECTILE_TYPES[id];
}

export function getAllProjectileTypes(): ProjectileTypeConfig[] {
  return Object.values(PROJECTILE_TYPES);
}

/**
 * Sound configuration for projectile types
 * Used by ProjectileManager for spatial audio
 */
export interface ProjectileSoundConfig {
  url: string;
  refDistance: number;
  rolloffFactor: number;
  volume: number;
}

export const PROJECTILE_SOUNDS: Record<string, ProjectileSoundConfig> = {
  arrow: {
    url: '/assets/sounds/arrow_01.mp3',
    refDistance: 50,
    rolloffFactor: 1,
    volume: 0.5,
  },
  bullet: {
    url: '/assets/sounds/gatling_0.mp3',
    refDistance: 40,
    rolloffFactor: 1.2,
    volume: 0.25,
  },
  rocket: {
    url: '/assets/sounds/rocket_launch.mp3',
    refDistance: 60,
    rolloffFactor: 1,
    volume: 0.7,
  },
  cannonball: {
    url: '/assets/sounds/cannon_01.mp3',
    refDistance: 70,
    rolloffFactor: 1,
    volume: 0.6,
  },
  'ice-shard': {
    url: '/assets/sounds/ice_cast.mp3',
    refDistance: 50,
    rolloffFactor: 1,
    volume: 0.4,
  },
} as const;
