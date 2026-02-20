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
  colorMultiplier?: number; // Overall brightness multiplier (0.0-1.0 = darken, default 1.0)
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
    modelUrl: '/assets/models/enemies/herbert_optimized.glb',
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
    immunityPercent: 100,
    canBleed: true,
    headingOffset: -0.192, // ~-11° rotation offset
    randomAnimationStart: true,
    lateralOffset: 2.0,
  },

  'zombie-soldier': {
    id: 'zombie-soldier',
    name: 'Zombie Soldier',
    modelUrl: '/assets/models/enemies/zombie_soldier.glb',
    scale: 2.492,
    minimumPixelSize: 0,
    baseHp: 160,
    baseSpeed: 6,
    reward: 5,
    hasAnimations: true,
    walkAnimation: 'zombie_02_Run',
    deathAnimation: 'zombie_02_Death',
    animationSpeed: 1.38,
    movingSound: '/assets/sounds/enemies/zombie/ambient.mp3',
    movingSoundVolume: 0.4,
    movingSoundRefDistance: 25,
    heightOffset: 0,
    healthBarOffset: 5.5,
    canBleed: true,
    headingOffset: 0,
    colorMultiplier: 1.3,
    emissiveIntensity: 0.15,
    emissiveColor: '#ccddff',
    randomAnimationStart: true,
    randomSoundStart: true,
    lateralOffset: 2.5,
    previewScale: 1,
  },

  rat: {
    id: 'rat',
    name: 'Rat',
    modelUrl: '/assets/models/enemies/rat.glb',
    scale: 1.5,
    minimumPixelSize: 0,
    baseHp: 5,
    baseSpeed: 10,
    reward: 1,
    hasAnimations: true,
    walkAnimation: 'Run',
    animationSpeed: 2.0,
    heightOffset: 0.3,
    healthBarOffset: 2.5,
    canBleed: true,
    headingOffset: 1.449,
    emissiveIntensity: 0.2,
    randomAnimationStart: true,
    lateralOffset: 3.0,
    spawnStartDelay: 150,
    previewScale: 1.5,
  },

  spider: {
    id: 'spider',
    name: 'Spider',
    modelUrl: '/assets/models/enemies/spider.glb',
    scale: 1.5,
    minimumPixelSize: 0,
    baseHp: 60,
    baseSpeed: 9,
    reward: 2,
    hasAnimations: true,
    walkAnimation: 'Armature|Walk-Cycle-Basic',
    animationSpeed: 2.0,
    heightOffset: 0,
    healthBarOffset: 3.5,
    canBleed: true,
    headingOffset: 0,
    emissiveIntensity: 0.15,
    randomAnimationStart: true,
    lateralOffset: 1.5,
    spawnStartDelay: 200,
    previewScale: 1.5,
  },

  mammoth: {
    id: 'mammoth',
    name: 'Mammoth',
    modelUrl: '/assets/models/enemies/mammoth.glb',
    scale: 2.206,
    minimumPixelSize: 0,
    baseHp: 400,
    baseSpeed: 3,
    reward: 10,
    hasAnimations: true,
    walkAnimation: 'Walk',
    deathAnimation: 'Die',
    animationSpeed: 2.85,
    // Random mammoth call — rare, every 15-40s
    randomSound: '/assets/sounds/enemies/mammouth/mammouth01.mp3',
    randomSoundMinInterval: 15000,
    randomSoundMaxInterval: 40000,
    randomSoundVolumeMin: 0.3,
    randomSoundVolumeMax: 0.6,
    randomSoundRefDistance: 50,
    heightOffset: 0.5,
    healthBarOffset: 9,
    canBleed: true,
    headingOffset: -1.71,
    emissiveIntensity: 0.1,
    randomAnimationStart: true,
    lateralOffset: 2.5,
    spawnStartDelay: 1000,
  },

  bear: {
    id: 'bear',
    name: 'Bear',
    modelUrl: '/assets/models/enemies/bear.glb',
    scale: 0.1,
    minimumPixelSize: 0,
    baseHp: 300,
    baseSpeed: 8,
    reward: 8,
    hasAnimations: true,
    walkAnimation: 'GltfAnimation 0',
    animationSpeed: 2.0,
    // Random bear growl — every 10-30s
    randomSound: '/assets/sounds/enemies/bear/bear01.mp3',
    randomSoundMinInterval: 10000,
    randomSoundMaxInterval: 30000,
    randomSoundVolumeMin: 0.3,
    randomSoundVolumeMax: 0.7,
    randomSoundRefDistance: 40,
    heightOffset: 0.5,
    healthBarOffset: 5,
    canBleed: true,
    headingOffset: -1.658,
    colorMultiplier: 1.3,
    emissiveIntensity: 0.15,
    emissiveColor: '#ccddff',
    randomAnimationStart: true,
    lateralOffset: 2.0,
    spawnStartDelay: 600,
  },

  dragon: {
    id: 'dragon',
    name: 'Dragon',
    modelUrl: '/assets/models/enemies/dragon.glb',
    scale: 2.5,
    minimumPixelSize: 0,
    baseHp: 450,
    baseSpeed: 6,
    reward: 12,
    hasAnimations: true,
    walkAnimation: 'flying',
    animationSpeed: 1.46,
    // Rare dragon roar — every 12-35s
    randomSound: '/assets/sounds/enemies/dragon/dragon01.mp3',
    randomSoundMinInterval: 12000,
    randomSoundMaxInterval: 35000,
    randomSoundVolumeMin: 0.3,
    randomSoundVolumeMax: 0.7,
    randomSoundRefDistance: 50,
    heightOffset: 20,
    heightVariation: 4,
    healthBarOffset: 14,
    canBleed: true,
    headingOffset: 0,
    isAirUnit: true,
    colorMultiplier: 1.3,
    emissiveIntensity: 0.15,
    emissiveColor: '#ccddff',
    randomAnimationStart: true,
    lateralOffset: 3.0,
    spawnStartDelay: 1200,
  },

  ghost: {
    id: 'ghost',
    name: 'Ghost',
    modelUrl: '/assets/models/enemies/ghost.glb',
    scale: 0.099,
    minimumPixelSize: 0,
    baseHp: 120,
    baseSpeed: 5,
    reward: 6,
    hasAnimations: true,
    walkAnimation: 'Take 001',
    animationSpeed: 1.0,
    heightOffset: 1,
    healthBarOffset: 6.5,
    canBleed: false,
    headingOffset: 0,
    emissiveIntensity: 0.2,
    emissiveColor: '#ffffff',
    randomAnimationStart: true,
    lateralOffset: 2.0,
    spawnStartDelay: 400,
  },

  hornet: {
    id: 'hornet',
    name: 'Hornet',
    modelUrl: '/assets/models/enemies/hornet.glb',
    scale: 0.063,
    minimumPixelSize: 0,
    baseHp: 80,
    baseSpeed: 9,
    reward: 4,
    hasAnimations: true,
    walkAnimation: 'Take 001',
    animationSpeed: 4.07,
    heightOffset: 18,
    heightVariation: 3,
    healthBarOffset: 4.5,
    canBleed: true,
    headingOffset: 0,
    isAirUnit: true,
    colorMultiplier: 1.2,
    randomAnimationStart: true,
    lateralOffset: 2.5,
    spawnStartDelay: 300,
  },

  mech: {
    id: 'mech',
    name: 'Mech',
    modelUrl: '/assets/models/enemies/mech.glb',
    scale: 0.885,
    minimumPixelSize: 0,
    baseHp: 500,
    baseSpeed: 3,
    reward: 12,
    hasAnimations: true,
    idleAnimation: 'Armature|Idle',
    walkAnimation: 'Armature|Walk',
    animationSpeed: 0.7,
    heightOffset: 0.5,
    healthBarOffset: 14,
    canBleed: false,
    headingOffset: 0,
    emissiveIntensity: 0.1,
    emissiveColor: '#ffaa44',
    randomAnimationStart: true,
    lateralOffset: 2.0,
    spawnStartDelay: 1000,
  },

  wraith: {
    id: 'wraith',
    name: 'Wraith',
    modelUrl: '/assets/models/enemies/wraith.glb',
    scale: 2.0,
    minimumPixelSize: 0,
    baseHp: 100,
    baseSpeed: 8,
    reward: 7,
    hasAnimations: true,
    walkAnimation: 'Armature|RunFast|baselayer',
    animationSpeed: 0.69,
    heightOffset: 0.5,
    healthBarOffset: 6,
    canBleed: false,
    headingOffset: 0,
    emissiveIntensity: 0.15,
    emissiveColor: '#ffffff',
    randomAnimationStart: true,
    lateralOffset: 2.0,
    spawnStartDelay: 400,
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
