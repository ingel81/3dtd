import { ProjectileTypeId } from './tower-types.config';

// Re-export ProjectileTypeId for convenience
export type { ProjectileTypeId } from './tower-types.config';

export type ProjectileVisualType = 'arrow' | 'cannonball' | 'magic' | 'ice' | 'bullet' | 'rocket' | 'poison' | 'chaos';

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
  splashMaxTargets?: number; // Most splash victims per hit, nearest first (undefined = all)

  // Trail particles (optional)
  trailParticles?: TrailParticleConfig;

  // Meters behind the mesh centre where trail particles and the trail streak
  // start (the rocket's nozzle). Visual only; default 0 = centre.
  tailOffset?: number;
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
    // Balance 2026-09: war 10 m ohne Zielcap. Im Pulk (0,5 bis 3 m Abstand)
    // traf ein Schuss so 3 bis 10 volle Treffer. 6 m und höchstens 8 Opfer
    // lassen im selben Pulk 1,5 bis 5,7 übrig.
    splashRadius: 6,
    splashMaxTargets: 8,
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
  'arcane-orb': {
    id: 'arcane-orb',
    speed: 100,
    visualType: 'magic',
    scale: 0.4,
    // Playtest 2026-09-10: the red-to-orange spiral read as a fireball, not
    // as magic. Same spiral, now violet-to-cyan sparks: smaller and shorter
    // lived so they flicker past instead of glowing like embers. Count and
    // spawn rate are unchanged and the lifetime drops, so the additive pool
    // carries fewer particles than before (was ~600 at 10 orbs in flight).
    trailParticles: {
      enabled: true,
      spawnChance: 1.0,
      countPerSpawn: 2,
      colorMin: { r: 0.45, g: 0.15, b: 1.0 }, // Violet
      colorMax: { r: 0.6, g: 0.9, b: 1.0 },   // Pale cyan
      sizeMin: 0.35,
      sizeMax: 0.9,
      lifetimeMin: 0.25,
      lifetimeMax: 0.6,
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
    // The nozzle of the 4.2 m rocket mesh (createRocketGeometry) sits 2.1 m
    // behind its centre; smoke and streak start there, not mid-body.
    tailOffset: 2.1,
    // Playtest 2026-09-10: too little rocket, too much fire trail. The
    // flame is now only the short streak at the nozzle (TRAIL_STYLES.rocket);
    // the particles are a thin grey smoke line in the normal pool. At
    // 120 m/s the 0.5 m trail gate fires 240 times a second, so 0.5 x 1
    // particle x ~0.45 s keeps ~55 alive per rocket, down from ~520
    // additive ones (3 per gate, size up to 2.6, up to 1 s).
    trailParticles: {
      enabled: true,
      spawnChance: 0.5,
      countPerSpawn: 1,
      colorMin: { r: 0.5, g: 0.5, b: 0.5 },    // Grey smoke
      colorMax: { r: 0.78, g: 0.76, b: 0.72 }, // Light, slightly warm grey
      sizeMin: 0.45,
      sizeMax: 1.0,
      lifetimeMin: 0.3,
      lifetimeMax: 0.6,
      velocityX: { min: -0.4, max: 0.4 },
      velocityY: { min: 0.0, max: 0.6 },       // Drifts up a little
      velocityZ: { min: -0.4, max: 0.4 },
      spawnOffset: 0.2,
      blending: 'normal',
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
  'chaos-orb': {
    id: 'chaos-orb',
    speed: 90,
    visualType: 'chaos',
    scale: 0.4,
    // Chaos Tower: magenta orb trailing a black-violet smoke line. Normal
    // blending, because an additive trail can brighten but never darken.
    // At 90 m/s the 0.5 m trail gate fires 180 times a second, so
    // 0.4 x 1 particle x ~0.45 s keeps ~30 alive per orb in the normal pool.
    trailParticles: {
      enabled: true,
      spawnChance: 0.4,
      countPerSpawn: 1,
      colorMin: { r: 0.04, g: 0.0, b: 0.07 },  // Near black
      colorMax: { r: 0.32, g: 0.04, b: 0.45 }, // Dark violet
      sizeMin: 0.5,
      sizeMax: 1.1,
      lifetimeMin: 0.3,
      lifetimeMax: 0.6,
      velocityX: { min: -0.4, max: 0.4 },
      velocityY: { min: -0.2, max: 0.4 },
      velocityZ: { min: -0.4, max: 0.4 },
      spawnOffset: 0.3,
      blending: 'normal',
    },
  },
  // The hero's standard rounds (HERO_AMMO.standard): a slimmer, faster
  // tracer than the gatling's, one puff per gate instead of two. At 180 m/s
  // and 3 shots a second over at most 18 m there is rarely more than one in
  // the air.
  'hero-round': {
    id: 'hero-round',
    speed: 180,
    visualType: 'bullet',
    scale: 0.12,
    trailParticles: {
      enabled: true,
      spawnChance: 0.5,
      countPerSpawn: 1,
      colorMin: { r: 1.0, g: 0.75, b: 0.1 },
      colorMax: { r: 1.0, g: 0.9, b: 0.35 },
      sizeMin: 0.3,
      sizeMax: 0.6,
      lifetimeMin: 0.06,
      lifetimeMax: 0.15,
      velocityX: { min: -0.3, max: 0.3 },
      velocityY: { min: -0.3, max: 0.3 },
      velocityZ: { min: -0.3, max: 0.3 },
      spawnOffset: 0.1,
    },
  },
};

export function getProjectileType(id: ProjectileTypeId): ProjectileTypeConfig {
  return PROJECTILE_TYPES[id];
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

export const PROJECTILE_SOUNDS: Record<ProjectileTypeId, ProjectileSoundConfig> = {
  arrow: {
    url: 'assets/sounds/towers/archer/shoot.mp3',
    refDistance: 50,
    rolloffFactor: 1,
    volume: 0.5,
  },
  bullet: {
    url: 'assets/sounds/towers/gatling/shoot.mp3',
    refDistance: 40,
    rolloffFactor: 1.2,
    volume: 0.25,
  },
  rocket: {
    url: 'assets/sounds/towers/rocket/launch.mp3',
    refDistance: 60,
    rolloffFactor: 1,
    volume: 0.7,
  },
  cannonball: {
    url: 'assets/sounds/towers/cannon/shoot.mp3',
    refDistance: 70,
    rolloffFactor: 1,
    volume: 0.6,
  },
  'ice-shard': {
    url: 'assets/sounds/towers/ice/cast.mp3',
    refDistance: 50,
    rolloffFactor: 1,
    volume: 0.4,
  },
  'arcane-orb': {
    url: 'assets/sounds/towers/magic/cast.mp3',
    refDistance: 55,
    rolloffFactor: 1.1,
    volume: 0.45,
  },
  'poison-glob': {
    url: 'assets/sounds/towers/poison/poison_spit.mp3',
    refDistance: 50,
    rolloffFactor: 1,
    volume: 0.4,
  },
  // Chaos Tower: the magic cast until it has a sound of its own.
  'chaos-orb': {
    url: 'assets/sounds/towers/magic/cast.mp3',
    refDistance: 55,
    rolloffFactor: 1.1,
    volume: 0.5,
  },
  // The hero's rifle: the gatling sample, quieter, it fires three times a second
  'hero-round': {
    url: 'assets/sounds/towers/gatling/shoot.mp3',
    refDistance: 35,
    rolloffFactor: 1.2,
    volume: 0.22,
  },
} as const;
