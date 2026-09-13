/**
 * Enemy Type Configuration System
 *
 * Central registry for all enemy types.
 * Add new types here - no code changes needed elsewhere.
 */

import { ArmorType } from '../configs/combat/combat.types';

/**
 * What an enemy splits into when a tower kills it (EnemyManager.kill). A leak
 * at the HQ and the debug kill-all do not split. The children join the
 * parent's path where it died and scale with its HP and speed multipliers.
 */
export interface SplitOnDeath {
  /** Enemy type of the children */
  type: EnemyTypeId;
  /** Children per kill */
  count: number;
  /** Lateral spread between the children, a share of the corridor room around the parent's lane (0-1) */
  spread: number;
}

export interface EnemyTypeConfig {
  id: string;
  name: string;
  modelUrl: string;
  scale: number;
  minimumPixelSize: number;

  // Combat
  armorType: ArmorType; // Armor type for the damage matrix

  // Stats
  baseHp: number;
  baseSpeed: number; // m/s
  reward: number; // Credits on kill (only used without AI - AI uses dynamic reward calculation)

  // Animation
  hasAnimations: boolean;
  walkAnimation?: string;
  runAnimation?: string; // Alternative to walk animation (variation)
  deathAnimation?: string;
  /** Optional pool of death animations — one is picked at random per kill. Falls back to `deathAnimation` if empty/unset. */
  deathAnimations?: string[];
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
  immunityPercent?: number; // Damage immunity in % (0-100, displayed as "Immune X%")
  /**
   * A boss unit: the boss bar at the top centre shows it under its `name`,
   * its death shakes the screen (bossDeath preset), and abilities take a
   * smaller share of its max HP (bossMaxHpFraction in abilities.config.ts).
   * Per type, so only types that appear as the boss and nowhere else carry it.
   */
  isBoss?: boolean;

  // Randomness
  randomAnimationStart?: boolean; // Start animation at random frame
  randomSoundStart?: boolean; // Start sound at random position
  lateralSpread?: number; // Share of the lateral room the route corridor leaves (0 = centre line, 1 = up to the edge margin)
  heightVariation?: number; // Max random height deviation in meters (for waves)

  // Air Unit
  isAirUnit?: boolean; // true = air unit, only attackable by air towers

  // Spawning
  spawnStartDelay?: number; // Delay in ms between spawning enemies of this type (default: 300)
  splitOnDeath?: SplitOnDeath; // What a kill splits this enemy into (none on a leak)

  // Preview
  previewScale?: number; // Override scale for model preview (sidebar)
  previewCameraDistance?: number; // Camera distance for preview (default: 7)
  previewCameraAngle?: number; // Camera pitch angle in radians for preview (default: Math.PI / 12)
  previewOffsetY?: number; // Vertical offset for preview camera target (default: 0)
}

export const ENEMY_TYPES: Record<string, EnemyTypeConfig> = {
  zombie: {
    id: 'zombie',
    name: 'Zombie',
    modelUrl: 'assets/models/enemies/zombie.glb',
    scale: 0.984,
    minimumPixelSize: 0, // 0 = real size, no pixel clamping when zooming
    armorType: 'unarmored',
    baseHp: 80,
    baseSpeed: 5,
    reward: 3, // Only without AI
    hasAnimations: true,
    walkAnimation: 'Armature|Walk',
    deathAnimation: 'Armature|Die',
    animationSpeed: 4.11,
    movingSound: 'assets/sounds/enemies/zombie/ambient.mp3',
    movingSoundVolume: 0.4,
    movingSoundRefDistance: 25, // Zombies are quieter from distance
    heightOffset: 0.5,
    healthBarOffset: 5.5,
    canBleed: true, // Zombies bleed
    headingOffset: -0.349, // -20° rotation offset
    randomAnimationStart: true, // Start animation at random frame
    randomSoundStart: true, // Start sound at random position
    lateralSpread: 1.0, // Up to the edge of the corridor
    previewScale: 1
  },

  'zombie-v2': {
    id: 'zombie-v2',
    name: 'Zombie v2',
    modelUrl: 'assets/models/enemies/zombie_v2.glb',
    scale: 2.432,
    minimumPixelSize: 0,
    armorType: 'unarmored',
    baseHp: 80,
    baseSpeed: 3,
    reward: 3,
    hasAnimations: true,
    walkAnimation: 'Unsteady_Walk',
    // Electrocuted_Fall stays out: its fall starts after 3 s, the enemy is gone after 2.
    deathAnimations: ['Dead', 'dying_backwards'],
    animationSpeed: 1,
    movingSound: 'assets/sounds/enemies/zombie/ambient.mp3',
    movingSoundVolume: 0.4,
    movingSoundRefDistance: 25,
    heightOffset: 0.0,
    healthBarOffset: 5.5,
    canBleed: true,
    headingOffset: 0,
    randomAnimationStart: true,
    randomSoundStart: true,
    lateralSpread: 1.0,
    previewScale: 1,
    previewCameraDistance: 7,
    previewCameraAngle: 0.26,
    previewOffsetY: 0,
  },

  tank: {
    id: 'tank',
    name: 'Tank',
    modelUrl: 'assets/models/enemies/tank.glb',
    scale: 2.009,
    minimumPixelSize: 0, // 0 = real size, no pixel clamping
    armorType: 'heavy',
    baseHp: 250, // Heavily armored (reduced from 500 for better early game balance)
    baseSpeed: 3,
    reward: 5, // Only without AI
    hasAnimations: false,
    animationSpeed: 1,
    movingSound: 'assets/sounds/enemies/tank/moving.mp3',
    movingSoundVolume: 0.3,
    movingSoundRefDistance: 50, // Tanks are louder (larger refDistance range)
    heightOffset: 0,
    healthBarOffset: 5.5,
    canBleed: false, // Tanks don't bleed
    headingOffset: -0.122, // ~-7° rotation offset
    randomSoundStart: true, // Start sound at random position
    lateralSpread: 0.85,
    spawnStartDelay: 800, // Larger gap between tanks (800ms instead of 300ms)
    previewScale: 1.073,
    previewCameraDistance: 7,
    previewCameraAngle: 0.26,
    previewOffsetY: 0,
  },

  wallsmasher: {
    id: 'wallsmasher',
    name: 'Wallsmasher',
    modelUrl: 'assets/models/enemies/wallsmasher.fbx',
    scale: 0.037,
    minimumPixelSize: 0,
    armorType: 'light',
    baseHp: 200,
    // Walks 4, runs 10 m/s half the time (rush): mean 7 m/s, the speed the
    // wave curriculum was tuned with while the rush was lost.
    baseSpeed: 4,
    reward: 5, // Only without AI
    hasAnimations: true,
    walkAnimation: 'CharacterArmature|Walk',
    runAnimation: 'CharacterArmature|Run',
    deathAnimation: 'CharacterArmature|Death',
    animationSpeed: 0.75, // 1.31 at 7 m/s, scaled by 4/7 so the stride still matches the ground speed
    animationVariation: true,
    runSpeedMultiplier: 2.5, // 2.5x speed when running
    // No spawn sound (gameplay decision — wallsmasher rush should be visual surprise)
    // Random sound while moving
    randomSound: 'assets/sounds/enemies/wallsmasher/attack.mp3',
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
    lateralSpread: 0.65,
    spawnStartDelay: 500,
    previewScale: 0.015,
    previewCameraDistance: 4,
    previewCameraAngle: 0.26,
    previewOffsetY: 0,
  },

  'stone-golem': {
    id: 'stone-golem',
    name: 'Stone Golem',
    modelUrl: 'assets/models/enemies/stone_golem.glb',
    scale: 7.312,
    minimumPixelSize: 0,

    armorType: 'fortified',
    baseHp: 480,
    baseSpeed: 2.5,
    reward: 12,

    hasAnimations: true,
    walkAnimation: 'Casual_Walk',
    deathAnimation: 'dying_backwards',
    animationSpeed: 0.75,

    // Audio (Spatial) — heavy stone footstep loop while moving
    movingSound: 'assets/sounds/enemies/golem/golem_walk_loop.mp3',
    movingSoundVolume: 0.4,
    movingSoundRefDistance: 45,

    heightOffset: 0,
    healthBarOffset: 15,
    canBleed: false,
    headingOffset: 0,

    randomAnimationStart: true,
    lateralSpread: 0.65,
    spawnStartDelay: 1200,

    previewScale: 2.149,
    previewCameraDistance: 6,
    previewCameraAngle: 0.26,
    previewOffsetY: 1.9,
  },

  bat: {
    id: 'bat',
    name: 'Bat',
    modelUrl: 'assets/models/enemies/bat.glb',
    scale: 3.958,
    minimumPixelSize: 0,
    armorType: 'light',
    baseHp: 25,
    baseSpeed: 8,
    reward: 2, // Only without AI
    hasAnimations: true,
    walkAnimation: 'fly.001',
    animationSpeed: 2.79,
    heightOffset: 15, // 15m above terrain
    healthBarOffset: 3.5,
    canBleed: true,
    headingOffset: 0,
    isAirUnit: true, // Only attackable by air towers
    heightVariation: 3, // ±3m variation between enemies
    lateralSpread: 0.65,
    randomAnimationStart: true,
    previewScale: 2.908,
    previewCameraDistance: 7,
    previewCameraAngle: 0.26,
    previewOffsetY: 0,
  },

  penguin: {
    id: 'penguin',
    name: 'Penguin',
    modelUrl: 'assets/models/enemies/penguin.glb',
    scale: 0.005,
    minimumPixelSize: 0,
    armorType: 'unarmored',
    baseHp: 30,
    baseSpeed: 9,
    reward: 2, // Only without AI
    hasAnimations: true,
    walkAnimation: 'Walk',
    deathAnimation: 'Fall',
    animationSpeed: 5.6,
    heightOffset: 0.5,
    healthBarOffset: 4.5,
    canBleed: true,
    unlit: true,
    headingOffset: 0,
    randomAnimationStart: true,
    lateralSpread: 0.85,
    previewScale: 0.008,
    previewCameraDistance: 7,
    previewCameraAngle: 0,
    previewOffsetY: 1.8,
  },

  herbert: {
    id: 'herbert',
    name: 'Herbert',
    modelUrl: 'assets/models/enemies/herbert_optimized.glb',
    scale: 2.625,
    minimumPixelSize: 0,
    armorType: 'fortified',
    baseHp: 500,
    baseSpeed: 4,
    reward: 15, // Only without AI
    hasAnimations: true,
    walkAnimation: 'Armature|walking_man|baselayer',
    animationSpeed: 1.0,
    // Spawn Sound (once) - DISABLED: speech files temporarily disabled
    // spawnSound: 'assets/sounds/enemies/herbert/spawn.mp3',
    // spawnSoundVolume: 0.6,
    // spawnSoundRefDistance: 40,
    // Random Sounds Pool (shuffle without repetition) - DISABLED: speech files temporarily disabled
    // randomSounds: [
    //   'assets/sounds/enemies/herbert/random-01.mp3',
    //   'assets/sounds/enemies/herbert/random-02.mp3',
    //   'assets/sounds/enemies/herbert/random-03.mp3',
    //   'assets/sounds/enemies/herbert/random-04.mp3',
    //   'assets/sounds/enemies/herbert/random-05.mp3',
    //   'assets/sounds/enemies/herbert/random-06.mp3',
    //   'assets/sounds/enemies/herbert/random-07.mp3',
    //   'assets/sounds/enemies/herbert/random-08.mp3',
    //   'assets/sounds/enemies/herbert/random-09.mp3',
    //   'assets/sounds/enemies/herbert/random-10.mp3',
    //   'assets/sounds/enemies/herbert/random-11.mp3',
    //   'assets/sounds/enemies/herbert/random-12.mp3',
    //   'assets/sounds/enemies/herbert/random-13.mp3',
    // ],
    // randomSoundsMinInterval: 10000,
    // randomSoundsMaxInterval: 25000,
    // randomSoundsVolume: 0.6,
    // randomSoundsRefDistance: 40,
    heightOffset: 0.5,
    healthBarOffset: 7,
    immunityPercent: 100,
    // Only in boss_herbert. Stone golem and dragon lead the later boss waves
    // but also march in golem_squad and dragon_elite, so they stay regular.
    isBoss: true,
    canBleed: true,
    headingOffset: -0.192, // ~-11° rotation offset
    randomAnimationStart: true,
    lateralSpread: 0.65,
    previewScale: 1.05,
    previewCameraDistance: 3,
    previewCameraAngle: 0,
    previewOffsetY: 0.8,
  },

  'zombie-soldier': {
    id: 'zombie-soldier',
    name: 'Zombie Soldier',
    modelUrl: 'assets/models/enemies/zombie_soldier.glb',
    scale: 2.492,
    minimumPixelSize: 0,
    armorType: 'heavy',
    baseHp: 160,
    baseSpeed: 6,
    reward: 5,
    hasAnimations: true,
    walkAnimation: 'zombie_02_Run',
    deathAnimation: 'zombie_02_Death',
    animationSpeed: 1.38,
    movingSound: 'assets/sounds/enemies/zombie/ambient.mp3',
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
    lateralSpread: 0.85,
    previewScale: 2.571,
    previewCameraDistance: 7,
    previewCameraAngle: 0.26,
    previewOffsetY: 2.4,
  },

  rat: {
    id: 'rat',
    name: 'Rat',
    modelUrl: 'assets/models/enemies/rat.glb',
    scale: 1.5,
    minimumPixelSize: 0,
    armorType: 'unarmored',
    baseHp: 5,
    baseSpeed: 10,
    reward: 1,
    hasAnimations: true,
    walkAnimation: 'Run',
    animationSpeed: 2.0,
    // Audio (Spatial) — swarm chittering loop while moving
    movingSound: 'assets/sounds/enemies/rat/rat_swarm.mp3',
    movingSoundVolume: 0.3,
    movingSoundRefDistance: 25,
    heightOffset: 0.3,
    healthBarOffset: 2.5,
    canBleed: true,
    headingOffset: 1.449,
    emissiveIntensity: 0.2,
    randomAnimationStart: true,
    randomSoundStart: true,
    lateralSpread: 1.0,
    spawnStartDelay: 150,
    previewScale: 3.473,
    previewCameraDistance: 6,
    previewCameraAngle: 0,
    previewOffsetY: -0.2,
  },

  skeleton: {
    id: 'skeleton',
    name: 'Skeleton',
    // Kenney "character-skeleton" (CC0, Graveyard Kit): six rigid parts moved
    // by node animation, baked through bakeObjectAnimVAT like mech and hornet.
    // 0.70 units tall, about 2.8 m at scale 4 (the zombie stands about 4.4 m).
    modelUrl: 'assets/models/enemies/skeleton.glb',
    scale: 4,
    minimumPixelSize: 0,
    armorType: 'unarmored',
    // Swarm between the rat (5 HP, 10 m/s) and the zombie (80 HP, 5 m/s).
    baseHp: 20,
    baseSpeed: 6,
    reward: 1,
    hasAnimations: true,
    walkAnimation: 'sprint',
    // 0.33 s, clamped on its last frame; removal after
    // TIMING.deathAnimationDuration (2 s) leaves the bones lying for 1.7 s.
    deathAnimation: 'die',
    // Sprint swings the legs ±90° (hip to sole 0.8 m at scale 4), about 3.2 m
    // of stride per 0.5 s cycle: 0.93 puts the feet at the 6 m/s ground speed.
    // Worked out from the model file; 1.25 ran them at about 8 m/s.
    animationSpeed: 0.93,
    heightOffset: 0,
    healthBarOffset: 3.8,
    canBleed: false, // Bones
    headingOffset: 0,
    emissiveIntensity: 0.15,
    randomAnimationStart: true,
    lateralSpread: 1.0, // Swarm: up to the edge of the corridor
    spawnStartDelay: 150,
    // A kill (not a leak) splits it into two minions where it died
    splitOnDeath: { type: 'skeleton-minion', count: 2, spread: 0.3 },
    previewScale: 2.5,
    previewCameraDistance: 6,
    previewCameraAngle: 0.2,
  },

  'skeleton-minion': {
    id: 'skeleton-minion',
    name: 'Skeleton Minion',
    // What a killed skeleton splits into (splitOnDeath): the same Kenney model
    // at 0.6 of its size, about 1.7 m tall, in a VAT pool of its own.
    modelUrl: 'assets/models/enemies/skeleton.glb',
    scale: 2.4,
    minimumPixelSize: 0,
    armorType: 'unarmored',
    // 30 % of the skeleton's HP and a bit faster. The split scales both by the
    // parent's multipliers, so a wave's hpMult reaches the minions too. No
    // splitOnDeath of its own: a minion does not split again.
    baseHp: 6,
    baseSpeed: 7,
    reward: 1,
    hasAnimations: true,
    walkAnimation: 'sprint',
    deathAnimation: 'die',
    // The skeleton's stride at 0.6 of its size, 1.92 m per 0.5 s cycle: 1.82
    // puts the feet at 7 m/s (the skeleton's 0.9375 × 7/6 / 0.6).
    animationSpeed: 1.82,
    heightOffset: 0,
    healthBarOffset: 2.3,
    canBleed: false, // Bones
    headingOffset: 0,
    emissiveIntensity: 0.15,
    randomAnimationStart: true,
    lateralSpread: 1.0,
    // Framed like the skeleton: the portrait is not a size comparison
    previewScale: 2.5,
    previewCameraDistance: 6,
    previewCameraAngle: 0.2,
  },

  spider: {
    id: 'spider',
    name: 'Spider',
    modelUrl: 'assets/models/enemies/spider.glb',
    scale: 1.5,
    minimumPixelSize: 0,
    armorType: 'light',
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
    lateralSpread: 0.5,
    spawnStartDelay: 200,
    previewScale: 1.901,
    previewCameraDistance: 7,
    previewCameraAngle: 0.26,
    previewOffsetY: 1,
  },

  mammoth: {
    id: 'mammoth',
    name: 'Mammoth',
    modelUrl: 'assets/models/enemies/mammoth.glb',
    scale: 2.206,
    minimumPixelSize: 0,
    armorType: 'fortified',
    baseHp: 400,
    baseSpeed: 3,
    reward: 10,
    hasAnimations: true,
    walkAnimation: 'Walk',
    deathAnimation: 'Die',
    animationSpeed: 2.85,
    // Random mammoth call — rare, every 15-40s
    randomSound: 'assets/sounds/enemies/mammouth/mammouth01.mp3',
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
    lateralSpread: 0.85,
    spawnStartDelay: 1000,
    previewScale: 0.882,
    previewCameraDistance: 6,
    previewCameraAngle: 0.26,
    previewOffsetY: 1,
  },

  bear: {
    id: 'bear',
    name: 'Bear',
    modelUrl: 'assets/models/enemies/bear.glb',
    scale: 0.1,
    minimumPixelSize: 0,
    armorType: 'heavy',
    baseHp: 300,
    baseSpeed: 8,
    reward: 8,
    hasAnimations: true,
    walkAnimation: 'GltfAnimation 0',
    animationSpeed: 2.0,
    // Random bear growl — every 10-30s
    randomSound: 'assets/sounds/enemies/bear/bear01.mp3',
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
    lateralSpread: 0.65,
    spawnStartDelay: 600,
    previewScale: 0.075,
    previewCameraDistance: 6,
    previewCameraAngle: 0.26,
    previewOffsetY: 1,
  },

  dragon: {
    id: 'dragon',
    name: 'Dragon',
    modelUrl: 'assets/models/enemies/dragon.glb',
    scale: 2.5,
    minimumPixelSize: 0,
    armorType: 'heavy',
    baseHp: 450,
    baseSpeed: 6,
    reward: 12,
    hasAnimations: true,
    walkAnimation: 'flying',
    animationSpeed: 1.46,
    // Rare dragon roar — every 12-35s
    randomSound: 'assets/sounds/enemies/dragon/dragon01.mp3',
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
    lateralSpread: 1.0,
    spawnStartDelay: 1200,
    previewScale: 1,
    previewCameraDistance: 7,
    previewCameraAngle: 0.26,
    previewOffsetY: 3,
  },

  ghost: {
    id: 'ghost',
    name: 'Ghost',
    modelUrl: 'assets/models/enemies/ghost.glb',
    scale: 0.099,
    minimumPixelSize: 0,
    armorType: 'ethereal',
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
    lateralSpread: 0.65,
    spawnStartDelay: 400,
    previewScale: 0.312,
    previewCameraDistance: 15,
    previewCameraAngle: 0,
    previewOffsetY: 7,
  },

  hornet: {
    id: 'hornet',
    name: 'Hornet',
    modelUrl: 'assets/models/enemies/hornet.glb',
    scale: 0.063,
    minimumPixelSize: 0,
    armorType: 'light',
    baseHp: 80,
    baseSpeed: 9,
    reward: 4,
    hasAnimations: true,
    walkAnimation: 'Take 001',
    animationSpeed: 4.07,
    // Audio (Spatial) — buzzing loop while flying
    movingSound: 'assets/sounds/enemies/hornet/hornet.mp3',
    movingSoundVolume: 0.45,
    movingSoundRefDistance: 30,
    heightOffset: 18,
    heightVariation: 3,
    healthBarOffset: 4.5,
    canBleed: true,
    headingOffset: 0,
    isAirUnit: true,
    colorMultiplier: 1.2,
    randomAnimationStart: true,
    lateralSpread: 0.85,
    spawnStartDelay: 300,
    previewScale: 0.122,
    previewCameraDistance: 7,
    previewCameraAngle: 0.26,
    previewOffsetY: 0,
  },

  mech: {
    id: 'mech',
    name: 'Mech',
    modelUrl: 'assets/models/enemies/mech.glb',
    scale: 0.885,
    minimumPixelSize: 0,
    armorType: 'heavy',
    baseHp: 500,
    baseSpeed: 3,
    reward: 12,
    hasAnimations: true,
    walkAnimation: 'Armature|Walk',
    animationSpeed: 0.7,
    heightOffset: 0.5,
    healthBarOffset: 14,
    canBleed: false,
    headingOffset: 0,
    emissiveIntensity: 0.1,
    emissiveColor: '#ffaa44',
    randomAnimationStart: true,
    lateralSpread: 0.65,
    spawnStartDelay: 1000,
  },

  wraith: {
    id: 'wraith',
    name: 'Wraith',
    modelUrl: 'assets/models/enemies/wraith.glb',
    scale: 2.0,
    minimumPixelSize: 0,
    armorType: 'ethereal',
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
    lateralSpread: 0.65,
    spawnStartDelay: 400,
    previewScale: 2.732,
    previewCameraDistance: 6.5,
    previewCameraAngle: 0,
    previewOffsetY: 1.9,
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

/** Guard against a split cycle in the config (a type splitting into itself). */
const MAX_SPLIT_DEPTH = 4;

/**
 * Bodies one enemy of `id` can put on the route: itself plus everything a
 * kill splits it into, recursively. 1 for a type without splitOnDeath.
 */
export function splitBodyCount(id: EnemyTypeId, depth = 0): number {
  const split = ENEMY_TYPES[id]?.splitOnDeath;
  if (!split || depth >= MAX_SPLIT_DEPTH) return 1;
  return 1 + split.count * splitBodyCount(split.type, depth + 1);
}

/**
 * Most bodies one enemy of `id` can put through the base: the ends of its
 * split tree. A skeleton killed just before the HQ sends both minions on,
 * and each leaks for the full wave damage, so it can cost two leaks where
 * an unsplit one costs one. 1 for a type without splitOnDeath.
 */
export function splitLeafCount(id: EnemyTypeId, depth = 0): number {
  const split = ENEMY_TYPES[id]?.splitOnDeath;
  if (!split || depth >= MAX_SPLIT_DEPTH) return 1;
  return split.count * splitLeafCount(split.type, depth + 1);
}

/**
 * HP it takes to clear one enemy of `id` and everything a kill splits it
 * into, at HP multiplier 1. Split children scale with their parent's
 * multiplier, so the whole lineage scales with it. 80 for an unknown id,
 * the fallback the fairness gate always used.
 */
export function lineageHp(id: EnemyTypeId, depth = 0): number {
  const type = ENEMY_TYPES[id];
  if (!type) return 80;
  const split = type.splitOnDeath;
  if (!split || depth >= MAX_SPLIT_DEPTH) return type.baseHp;
  return type.baseHp + split.count * lineageHp(split.type, depth + 1);
}
