import { ProjectileTypeId } from './tower-types.config';

// Re-export ProjectileTypeId for convenience
export type { ProjectileTypeId } from './tower-types.config';

export type ProjectileVisualType = 'arrow' | 'cannonball' | 'magic' | 'ice' | 'bullet' | 'rocket' | 'poison';

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

  // Trail type: 'default' (random dispersion) or 'spiral' (railgun-style rotating)
  trailType?: 'default' | 'spiral';

  // Spiral-specific settings (only used when trailType === 'spiral')
  spiralRadius?: number; // Distance from center (default: 1.0)
  spiralSpeed?: number; // Rotations per second (default: 3.0)
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
    splashRadius: 10,
    splashDamageFalloff: true,
    // Phase 5.16: cannon shoots slow + uses normal pool (4000) → can afford
    // generous smoke. Bigger, longer-lived puffs sell the heavy-shell feel.
    trailParticles: {
      enabled: true,
      spawnChance: 0.5,                       // was 0.3
      countPerSpawn: 2,                       // was 1
      colorMin: { r: 0.06, g: 0.06, b: 0.06 }, // Near black
      colorMax: { r: 0.28, g: 0.28, b: 0.28 }, // Medium grey
      sizeMin: 0.5,                           // was 0.4
      sizeMax: 1.4,                           // was 0.8 — fatter smoke clouds
      lifetimeMin: 0.5,                       // was 0.3
      lifetimeMax: 1.2,                       // was 0.7 — smoke lingers
      velocityX: { min: -1.0, max: 1.0 },     // was ±1.5
      velocityY: { min: 0.3, max: 1.0 },      // was 0.5..1.5 — gentler upward drift
      velocityZ: { min: -1.0, max: 1.0 },
      spawnOffset: 0.4,
      blending: 'normal',
    },
  },
  fireball: {
    id: 'fireball',
    speed: 100,
    visualType: 'magic',
    scale: 0.4,
    // Phase 5.16: streak shrunk → spiral particles compensate. Bigger,
    // longer-lived spiral arcs carry the magical-trail look without the
    // streak's wedge artifact. Pool impact: ~600 active at 10 simultaneous
    // fireballs, comfortable.
    trailParticles: {
      enabled: true,
      spawnChance: 1.0,
      countPerSpawn: 2,
      colorMin: { r: 0.8, g: 0.1, b: 0.0 },  // Deep red
      colorMax: { r: 1.0, g: 0.4, b: 0.0 },  // Orange
      sizeMin: 0.5,                          // was 0.4
      sizeMax: 1.1,                          // was 0.8 — spiral arcs more visible
      lifetimeMin: 0.3,                      // was 0.2
      lifetimeMax: 0.7,                      // was 0.4 — arcs trail longer
      velocityX: { min: 0, max: 0 },
      velocityY: { min: 0, max: 0 },
      velocityZ: { min: 0, max: 0 },
      spawnOffset: 0,
      blending: 'additive',
      trailType: 'spiral',
      spiralRadius: 1.5,
      spiralSpeed: 8.0,
    },
  },
  'ice-shard': {
    id: 'ice-shard',
    speed: 90,
    visualType: 'ice',
    scale: 0.4,
    splashRadius: 8,
    splashDamageFalloff: true,
    // Phase 5.16: ice slow-rate (0.33/s) — pool cost negligible even at
    // larger sizes/lifetimes.
    trailParticles: {
      enabled: true,
      spawnChance: 0.8,
      countPerSpawn: 2,
      colorMin: { r: 0.85, g: 0.95, b: 1.0 }, // very light blue/white
      colorMax: { r: 1.0, g: 1.0, b: 1.0 },   // pure white
      sizeMin: 0.5,                          // was 0.4
      sizeMax: 1.1,                          // was 0.8 — frost puffs more visible
      lifetimeMin: 0.4,                      // was 0.3
      lifetimeMax: 0.9,                      // was 0.6 — drift longer
      velocityX: { min: -1.0, max: 1.0 },    // was ±1.5 — gentler dispersal
      velocityY: { min: -0.3, max: 0.8 },    // was -0.5..1.0 — slightly more upward drift
      velocityZ: { min: -1.0, max: 1.0 },
      spawnOffset: 0.4,                      // was 0.3
      blending: 'additive',
    },
  },
  bullet: {
    id: 'bullet',
    speed: 150,
    visualType: 'bullet',
    scale: 0.15,
    // Phase 5.16: slightly longer-lived tracer puffs + an extra particle per
    // spawn so the gatling burst reads as a stream of glowing dots, not a
    // single thin beam. Pool cost negligible — bullet lifetime stays
    // < 200ms, count modest.
    trailParticles: {
      enabled: true,
      spawnChance: 0.5,
      countPerSpawn: 2,                       // was 1
      colorMin: { r: 1.0, g: 0.7, b: 0.05 },  // warmer yellow
      colorMax: { r: 1.0, g: 0.85, b: 0.25 }, // golden
      sizeMin: 0.4,                           // was 0.3
      sizeMax: 0.85,                          // was 0.5 — visible tracer puff
      lifetimeMin: 0.08,                      // was 0.03
      lifetimeMax: 0.20,                      // was 0.06 — tracer trail readable
      velocityX: { min: -0.4, max: 0.4 },     // was ±0.2 — slight spread
      velocityY: { min: -0.4, max: 0.4 },
      velocityZ: { min: -0.4, max: 0.4 },
      spawnOffset: 0.15,                      // was 0.05
    },
  },
  rocket: {
    id: 'rocket',
    speed: 120,
    visualType: 'rocket',
    scale: 1.0,
    // Phase 5.16: bumped lifetime + count + size so the trail reads as a
    // diffusing exhaust cloud, not a thin yellow line. Colour range pulled
    // toward red-orange (away from yellow) and dimmed at the cool end so
    // additive blending mixes to a warm volume instead of saturating to
    // white. velocityY no longer drops aggressively — a real rocket exhaust
    // hangs in the air briefly, doesn't fall like rain. Pool budget audited:
    // ~65% utilisation at 30 simultaneous rockets, safe.
    trailParticles: {
      enabled: true,
      spawnChance: 1.0,        // every spawn-tick (gated to ~30Hz upstream)
      countPerSpawn: 3,        // was 2 — denser puff per spawn
      colorMin: { r: 0.50, g: 0.20, b: 0.05 }, // dim red-brown — older smoke
      colorMax: { r: 1.00, g: 0.55, b: 0.10 }, // warm orange — fresh exhaust
      sizeMin: 1.0,
      sizeMax: 2.6,            // was 2.0 — fatter puffs
      lifetimeMin: 0.45,       // was 0.3
      lifetimeMax: 1.0,        // was 0.6 — trail lingers
      velocityX: { min: -1.2, max: 1.2 }, // less fan-out
      velocityY: { min: -0.5, max: 0.8 }, // gentle drift, slight upward bias
      velocityZ: { min: -1.2, max: 1.2 },
      spawnOffset: 0.7,        // was 0.5 — wider seed area for diffusion
    },
  },
  'poison-glob': {
    id: 'poison-glob',
    speed: 70,
    visualType: 'poison',
    scale: 0.5,
    splashRadius: 8,
    splashDamageFalloff: true,
    trailParticles: {
      enabled: true,
      spawnChance: 0.8,
      countPerSpawn: 2,
      colorMin: { r: 0.1, g: 0.5, b: 0.0 }, // Dark green
      colorMax: { r: 0.2, g: 0.8, b: 0.1 }, // Bright green
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
    url: '/assets/sounds/towers/archer/shoot.mp3',
    refDistance: 50,
    rolloffFactor: 1,
    volume: 0.5,
  },
  bullet: {
    url: '/assets/sounds/towers/gatling/shoot.mp3',
    refDistance: 40,
    rolloffFactor: 1.2,
    volume: 0.25,
  },
  rocket: {
    url: '/assets/sounds/towers/rocket/launch.mp3',
    refDistance: 60,
    rolloffFactor: 1,
    volume: 0.7,
  },
  cannonball: {
    url: '/assets/sounds/towers/cannon/shoot.mp3',
    refDistance: 70,
    rolloffFactor: 1,
    volume: 0.6,
  },
  'ice-shard': {
    url: '/assets/sounds/towers/ice/cast.mp3',
    refDistance: 50,
    rolloffFactor: 1,
    volume: 0.4,
  },
  fireball: {
    url: '/assets/sounds/towers/magic/cast.mp3',
    refDistance: 55,
    rolloffFactor: 1.1,
    volume: 0.45,
  },
  'poison-glob': {
    url: '/assets/sounds/towers/poison/poison_spit.mp3',
    refDistance: 50,
    rolloffFactor: 1,
    volume: 0.4,
  },
} as const;
