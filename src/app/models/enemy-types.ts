/**
 * Enemy Type Configuration System
 *
 * Central registry for all enemy types.
 * Add new types here - no code changes needed elsewhere.
 */

export interface EnemyTypeConfig {
  id: string;
  name: string;
  modelUrl: string;
  scale: number;
  minimumPixelSize: number;

  // Stats
  baseHp: number;
  baseSpeed: number; // m/s
  reward: number; // Credits on kill (only used without AI - AI uses dynamic reward calculation)

  // Animation
  hasAnimations: boolean;
  idleAnimation?: string;
  walkAnimation?: string;
  runAnimation?: string; // Alternative to walk animation (variation)
  deathAnimation?: string;
  animationSpeed?: number;
  animationVariation?: boolean; // Switches between walk and run animation
  runSpeedMultiplier?: number; // Speed multiplier for run animation (default: 1.0)

  // Audio (Spatial)
  movingSound?: string; // Loop sound while moving (asset path)
  movingSoundVolume?: number; // 0.0 - 1.0
  movingSoundRefDistance?: number; // Distance for full volume (default: 30m)

  // Random Sound (instead of loop)
  randomSound?: string; // Sound played randomly
  randomSoundMinInterval?: number; // Min time between sounds (ms)
  randomSoundMaxInterval?: number; // Max time between sounds (ms)
  randomSoundVolumeMin?: number; // Min volume (0.0 - 1.0)
  randomSoundVolumeMax?: number; // Max volume (0.0 - 1.0)
  randomSoundRefDistance?: number; // Distance for full volume

  // Random Sounds Pool (shuffle without repetition)
  randomSounds?: string[]; // Array of sounds played randomly
  randomSoundsMinInterval?: number; // Min time between sounds (ms)
  randomSoundsMaxInterval?: number; // Max time between sounds (ms)
  randomSoundsVolume?: number; // Volume (0.0 - 1.0)
  randomSoundsRefDistance?: number; // Distance for full volume

  // Spawn Sound (once on spawn)
  spawnSound?: string; // Sound on spawn
  spawnSoundVolume?: number; // Volume (0.0 - 1.0)
  spawnSoundRefDistance?: number; // Distance for full volume

  // Visual
  heightOffset: number; // Model height above ground
  healthBarOffset: number; // Health bar height above model
  canBleed: boolean; // Whether blood effects are shown
  headingOffset?: number; // Rotation offset in radians (correct model orientation)
  emissiveIntensity?: number; // Glow effect strength (0 = off, 0.1-0.5 = subtle, 1+ = strong)
  emissiveColor?: string; // Glow color as hex (default: '#ffffff')
  unlit?: boolean; // No lighting - shows original colors (for cartoon models)

  // Boss / Special
  healthBarColor?: string; // Fixed health bar color as hex (e.g. '#ff0000' for boss)
  bossName?: string; // Name above health bar (e.g. 'Boss')
  immunityPercent?: number; // Damage immunity in % (0-100, displayed as "Immune X%")

  // Randomness
  randomAnimationStart?: boolean; // Start animation at random frame
  randomSoundStart?: boolean; // Start sound at random position
  lateralOffset?: number; // Max lateral offset in meters (0 = no deviation)
  heightVariation?: number; // Max random height deviation in meters (for waves)

  // Air Unit
  isAirUnit?: boolean; // true = air unit, only attackable by air towers

  // Spawning
  spawnStartDelay?: number; // Delay in ms between spawning enemies of this type (default: 300)

  // Preview
  previewScale?: number; // Override scale for model preview (sidebar)
}

export const ENEMY_TYPES: Record<string, EnemyTypeConfig> = {
  zombie: {
    id: 'zombie',
    name: 'Zombie',
    modelUrl: '/assets/models/enemies/zombie.glb',
    scale: 0.984,
    minimumPixelSize: 0, // 0 = real size, no pixel clamping when zooming
    baseHp: 80,
    baseSpeed: 5,
    reward: 3, // Only without AI
    hasAnimations: true,
    idleAnimation: 'Armature|Idle',
    walkAnimation: 'Armature|Walk',
    deathAnimation: 'Armature|Die',
    animationSpeed: 4.11,
    movingSound: '/assets/sounds/enemies/zombie/ambient.mp3',
    movingSoundVolume: 0.4,
    movingSoundRefDistance: 25, // Zombies are quieter from distance
    heightOffset: 0.5,
    healthBarOffset: 5.5,
    canBleed: true, // Zombies bleed
    headingOffset: -0.349, // -20° rotation offset
    randomAnimationStart: true, // Start animation at random frame
    randomSoundStart: true, // Start sound at random position
    lateralOffset: 3.0, // Max 3m lateral offset,
    previewScale: 1
  },

  tank: {
    id: 'tank',
    name: 'Tank',
    modelUrl: '/assets/models/enemies/tank.glb',
    scale: 2.009,
    minimumPixelSize: 0, // 0 = real size, no pixel clamping
    baseHp: 250, // Heavily armored (reduced from 500 for better early game balance)
    baseSpeed: 3,
    reward: 5, // Only without AI
    hasAnimations: false,
    animationSpeed: 1,
    movingSound: '/assets/sounds/enemies/tank/moving.mp3',
    movingSoundVolume: 0.3,
    movingSoundRefDistance: 50, // Tanks are louder (larger refDistance range)
    heightOffset: 0,
    healthBarOffset: 5.5,
    canBleed: false, // Tanks don't bleed
    headingOffset: -0.122, // ~-7° rotation offset
    randomSoundStart: true, // Start sound at random position
    lateralOffset: 2.5, // Max 2.5m lateral offset
    spawnStartDelay: 800, // Larger gap between tanks (800ms instead of 300ms)
  },

  wallsmasher: {
    id: 'wallsmasher',
    name: 'Wallsmasher',
    modelUrl: '/assets/models/enemies/wallsmasher.fbx',
    scale: 0.037,
    minimumPixelSize: 0,
    baseHp: 200,
    baseSpeed: 7,
    reward: 5, // Only without AI
    hasAnimations: true,
    walkAnimation: 'CharacterArmature|Walk',
    runAnimation: 'CharacterArmature|Run',
    deathAnimation: 'CharacterArmature|Death',
    animationSpeed: 1.31,
    animationVariation: true,
    runSpeedMultiplier: 2.5, // 2.5x speed when running
    // Spawn Sound
    spawnSound: '/assets/sounds/enemies/wallsmasher/spawn.mp3',
    spawnSoundVolume: 0.7,
    spawnSoundRefDistance: 40,
    // Random sound while moving
    randomSound: '/assets/sounds/enemies/wallsmasher/attack.mp3',
    randomSoundMinInterval: 8000,
    randomSoundMaxInterval: 25000,
    randomSoundVolumeMin: 0.2,
    randomSoundVolumeMax: 0.6,
    randomSoundRefDistance: 35,
    heightOffset: 0,
    healthBarOffset: 9,
    canBleed: true,
    headingOffset: 0,
    randomAnimationStart: true,
    lateralOffset: 2.0,
    spawnStartDelay: 500,
  },

  bat: {
    id: 'bat',
    name: 'Bat',
    modelUrl: '/assets/models/enemies/bat.glb',
    scale: 3.958,
    minimumPixelSize: 0,
    baseHp: 25,
    baseSpeed: 8,
    reward: 2, // Only without AI
    hasAnimations: true,
    walkAnimation: 'fly.001',
    animationSpeed: 2.79,
    heightOffset: 15, // 15m above terrain
    healthBarOffset: 3.5,
    canBleed: false,
    headingOffset: 0,
    isAirUnit: true, // Only attackable by air towers
    heightVariation: 3, // ±3m variation between enemies
    lateralOffset: 2.0,
    randomAnimationStart: true,
  },

  penguin: {
    id: 'penguin',
    name: 'Penguin',
    modelUrl: '/assets/models/enemies/penguin.glb',
    scale: 0.005,
    minimumPixelSize: 0,
    baseHp: 30,
    baseSpeed: 9,
    reward: 2, // Only without AI
    hasAnimations: true,
    walkAnimation: 'Walk',
    deathAnimation: 'Fall',
    animationSpeed: 5.6,
    heightOffset: 0.5,
    healthBarOffset: 4.5,
    canBleed: false,
    unlit: true,
    headingOffset: 0,
    randomAnimationStart: true,
    lateralOffset: 2.5,
    previewScale: 0.008,
  },

  herbert: {
    id: 'herbert',
    name: 'Herbert',
    modelUrl: '/assets/models/enemies/herbert.glb',
    scale: 2.625,
    minimumPixelSize: 0,
    baseHp: 500,
    baseSpeed: 4,
    reward: 15, // Only without AI
    hasAnimations: true,
    walkAnimation: 'Armature|walking_man|baselayer',
    animationSpeed: 1.0,
    // Spawn Sound (once)
    spawnSound: '/assets/sounds/enemies/herbert/spawn.mp3',
    spawnSoundVolume: 0.6,
    spawnSoundRefDistance: 40,
    // Random Sounds Pool (shuffle without repetition)
    randomSounds: [
      '/assets/sounds/enemies/herbert/random-01.mp3',
      '/assets/sounds/enemies/herbert/random-02.mp3',
      '/assets/sounds/enemies/herbert/random-03.mp3',
      '/assets/sounds/enemies/herbert/random-04.mp3',
      '/assets/sounds/enemies/herbert/random-05.mp3',
      '/assets/sounds/enemies/herbert/random-06.mp3',
      '/assets/sounds/enemies/herbert/random-07.mp3',
      '/assets/sounds/enemies/herbert/random-08.mp3',
      '/assets/sounds/enemies/herbert/random-09.mp3',
      '/assets/sounds/enemies/herbert/random-10.mp3',
      '/assets/sounds/enemies/herbert/random-11.mp3',
      '/assets/sounds/enemies/herbert/random-12.mp3',
      '/assets/sounds/enemies/herbert/random-13.mp3',
    ],
    randomSoundsMinInterval: 10000,
    randomSoundsMaxInterval: 25000,
    randomSoundsVolume: 0.6,
    randomSoundsRefDistance: 40,
    heightOffset: 0.5,
    healthBarOffset: 7,
    healthBarColor: '#ef4444', // Red boss health bar
    bossName: 'Boss',
    immunityPercent: 100,
    canBleed: true,
    headingOffset: -0.192, // ~-11° rotation offset
    randomAnimationStart: true,
    lateralOffset: 2.0,
  },
};

export type EnemyTypeId = keyof typeof ENEMY_TYPES;

export function getEnemyType(id: EnemyTypeId): EnemyTypeConfig {
  const type = ENEMY_TYPES[id];
  if (!type) {
    console.warn(`Unknown enemy type: ${id}, falling back to zombie`);
    return ENEMY_TYPES['zombie'];
  }
  return type;
}

export function getAllEnemyTypes(): EnemyTypeConfig[] {
  return Object.values(ENEMY_TYPES);
}

export function getEnemyTypeIds(): EnemyTypeId[] {
  return Object.keys(ENEMY_TYPES) as EnemyTypeId[];
}
