/**
 * Enemy Type Configuration System
 *
 * Central registry for all enemy types.
 * Add new types here - no code changes needed elsewhere.
 */

import { ArmorType } from '../configs/combat/combat.types';
import { TIMING } from './timing.config';

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

/**
 * A boss that walks as a chain of segments, Skarnax (managers/worm).
 * Every segment is an enemy of the chained type with its own HP; the type's
 * own model draws the head, `segmentModel` the body. One spawn of the type
 * puts the whole chain on the route, the segments coming out one after
 * another.
 */
export interface EnemyChain {
  /** Type whose VAT pool draws the body segments (only its model is used) */
  segmentModel: EnemyTypeId;
  /** Type whose VAT pool draws the last segment of each worm once it is out (only its model is used) */
  tailModel: EnemyTypeId;
  /** Distance between two segments along the route centre line (m) */
  spacing: number;
  /** As many segments as fit the route, at least this many ... */
  minSegments: number;
  /** ... and at most this many, see WORM_MAX_SEGMENTS */
  maxSegments: number;
  /** Sideways sway, a share of the corridor room (0-1) */
  sway: number;
  /** Length of one sway along the route (m) */
  swayWavelength: number;
}

/**
 * An enemy whose body lies along the route instead of standing on it (the
 * ooze boss): its tip walks the path like any enemy, the tail stays at the
 * portal until the body is `maxLengthM` long and follows the tip from then
 * on. See entities/ooze-body.ts and managers/ooze-bodies.ts.
 */
export interface OozeConfig {
  /** Longest the body grows along the route (m) */
  maxLengthM: number;
  /**
   * What a whole body costs flowing into the HQ, in leaks of the wave
   * (enemyBaseDamageForWave), spread over maxLengthM: each metre that
   * enters costs its share, so a shorter body costs less. Capped per wave
   * like every leak (maxLeakDamagePerWave).
   */
  leakDamageFactor: number;
}

export interface EnemyTypeConfig {
  id: string;
  name: string;
  /**
   * A boss's honorific, shown only on the intro card (smaller, under `name`)
   * and nowhere `name` alone is already tight on space (boss bar, debug
   * lists, tooltips, wave preview).
   */
  epithet?: string;
  modelUrl: string;
  scale: number;

  // Combat
  armorType: ArmorType; // Armor type for the damage matrix

  // Stats
  baseHp: number;
  baseSpeed: number; // m/s

  // Animation
  hasAnimations: boolean;
  walkAnimation?: string;
  runAnimation?: string; // Alternative to walk animation (variation)
  deathAnimation?: string;
  /** Optional pool of death animations — one is picked at random per kill. Falls back to `deathAnimation` if empty/unset. */
  deathAnimations?: string[];
  /**
   * Time from the kill to the removal in ms, while the death clip plays
   * (enemyDeathDuration). Default TIMING.deathAnimationDuration; longer where
   * a death clip is still moving then (tools/model-budget/death-rest.spec.ts).
   */
  deathDuration?: number;
  animationSpeed?: number;
  animationVariation?: boolean; // Switches between walk and run animation
  runSpeedMultiplier?: number; // Speed multiplier for run animation (default: 1.0)
  /**
   * Metres of ground per loop of the walk clip. Set, the clip follows the
   * distance the instance moves instead of the clock
   * (EnemyInstanceManager.updateAnimations): the worm's legs step with the
   * ground at any speed and timescale and stand still in the pause and while
   * the worm stands. animationSpeed and randomAnimationStart do not apply.
   */
  gaitStride?: number;

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
  bloodColor?: string; // Colour of its blood and blood decals as hex (default: dark red)
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
   * smaller share of its max HP (the bossFraction of an effect in
   * abilities.config.ts).
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

  /**
   * A machine, not a creature: electric effects that knock out machines
   * (an EMP) hit it harder. Per type, like isBoss.
   */
  mechanical?: boolean;

  // Spawning
  spawnStartDelay?: number; // Delay in ms between spawning enemies of this type (default: 300)
  splitOnDeath?: SplitOnDeath; // What a kill splits this enemy into (none on a leak)
  chain?: EnemyChain; // Walks as a chain of segments, each an enemy of this type (worm)
  /** A body along the route instead of a model instance (the ooze), see OozeConfig */
  ooze?: OozeConfig;
  /**
   * Left out of the enemy lists of Custom Wave and Enemy Debug
   * (getDebugEnemyTypes): a model of another type's body that is no use to
   * spawn on its own.
   */
  debugUnlisted?: boolean;

  // Preview
  previewScale?: number; // Override scale for model preview (sidebar)
  previewCameraDistance?: number; // Camera distance for preview (default: 7)
  previewCameraAngle?: number; // Camera pitch angle in radians for preview (default: Math.PI / 12)
  previewOffsetY?: number; // Vertical offset for preview camera target (default: 0)
}

/** What a worm head, segment or tail model sets; the rest of the type is shared. */
type WormModel = Pick<
  EnemyTypeConfig,
  | 'modelUrl' | 'scale' | 'hasAnimations' | 'walkAnimation' | 'gaitStride'
  | 'headingOffset' | 'heightOffset' | 'healthBarOffset'
  | 'previewScale' | 'previewCameraDistance' | 'previewCameraAngle' | 'previewOffsetY'
>;

interface WormModels {
  head: WormModel;
  segment: WormModel;
  tail: WormModel;
  /** Chain spacing: segment length along the route less the overlap of the rings (m) */
  spacing: number;
}

/**
 * Metres per model unit of the worm: 7.2 m wide with the legs, 4.5 m high
 * with the dorsal spikes, one ring every 2.5 m.
 */
const WORM_SCALE = 2.5;

/**
 * Metres a ring walks per loop of its Crawl clip. In the clip a leg steps
 * WAVE = 0.25 of a loop after the leg one model unit in front of it
 * (tools/blender/worm_boss.py), so the ring behind, 2.5 m further back, has
 * to be 1 - 0.25 loops behind: 2.5 m / 0.75. Then the legs of the whole worm
 * step as one wave from the tail to the head, four rings long, and a foot on
 * the ground goes back about as fast as the ring walks.
 */
const WORM_GAIT_STRIDE = WORM_SCALE / 0.75;

/** What segment and tail share: the ring with its legs */
const WORM_RING = {
  scale: WORM_SCALE,
  hasAnimations: true,
  walkAnimation: 'Crawl',
  gaitStride: WORM_GAIT_STRIDE,
  headingOffset: 0,
  heightOffset: 0,
  // Dorsal spikes up to 1.78 units, 4.45 m
  healthBarOffset: 5.5,
  previewScale: 2,
  previewCameraDistance: 7,
  previewCameraAngle: 0.26,
  previewOffsetY: 1,
} satisfies Omit<WormModel, 'modelUrl'>;

/**
 * The chitin head, ring and tail (tools/blender/worm_boss.py): skinned
 * meshes with one base colour each (the head 1024², the others 512²),
 * looking along +z, pivot on the ground under the ring centre. The rings
 * follow each other at 1.0 model units (0.10 of overlap); the head sits on
 * the front node of the chain like a ring, its collar over the first ring
 * behind it, and the tail on the last node, its plates and cerci trailing
 * 2.2 units behind its ring. Their clips follow the distance walked
 * (gaitStride): the rings' legs step, the head's mandibles bite. Everything
 * that depends on the models is here.
 */
const WORM_MODELS: WormModels = {
  head: {
    modelUrl: 'assets/models/enemies/worm_head.glb',
    scale: WORM_SCALE,
    hasAnimations: true,
    // One bite of the mandibles, 1.6 s at the base speed of 4.5 m/s
    walkAnimation: 'Jaws',
    gaitStride: 7.2,
    headingOffset: 0,
    heightOffset: 0,
    // Top of the head at 2.02 units, 5.05 m
    healthBarOffset: 6,
    previewScale: 2,
    previewCameraDistance: 7,
    previewCameraAngle: 0.26,
    previewOffsetY: 1,
  },
  segment: { modelUrl: 'assets/models/enemies/worm_segment.glb', ...WORM_RING },
  tail: { modelUrl: 'assets/models/enemies/worm_tail.glb', ...WORM_RING },
  // PITCH in worm_boss.py, 1.0 model units
  spacing: WORM_SCALE,
};

/**
 * Most segments one worm has. At 2.5 m that is 600 m of worm, which fills a
 * route up to that length; a longer route gets a worm of this length. Each
 * segment is a whole enemy (targeting, health bar, kill-gold slot, a VAT
 * instance of 634 vertices) and the worm takes 240 × 2.5 m / 4.5 m/s = 133 s
 * to come out of the portal, near the director's 3-minute cap on a wave's
 * spawn window.
 */
export const WORM_MAX_SEGMENTS = 240;

/** Stats every worm segment has, head or body: one enemy type ('worm') for all of them. */
const WORM_STATS = {
  // Chitin: siege, lightning and magic get through, arrows and fire much less
  armorType: 'heavy',
  // Per segment, 14 HP per metre of worm; 240 segments are 8,400 HP at HP multiplier 1
  baseHp: 35,
  baseSpeed: 4.5,
  canBleed: true,
  // Only the worm, only in the boss rotation, Custom Wave and Enemy Debug
  isBoss: true,
  randomAnimationStart: true,
  // The chain sways the whole worm (EnemyChain.sway), no lane of its own
  lateralSpread: 0,
} satisfies Partial<EnemyTypeConfig>;

export const ENEMY_TYPES: Record<string, EnemyTypeConfig> = {
  zombie: {
    id: 'zombie',
    name: 'Zombie',
    modelUrl: 'assets/models/enemies/zombie.glb',
    scale: 0.984,
    armorType: 'unarmored',
    baseHp: 80,
    baseSpeed: 5,
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
    armorType: 'unarmored',
    baseHp: 80,
    baseSpeed: 3,
    hasAnimations: true,
    walkAnimation: 'Unsteady_Walk',
    // Electrocuted_Fall is cut to its fall, 3.0-5.0 s of the source clip.
    deathAnimations: ['Dead', 'dying_backwards', 'Electrocuted_Fall'],
    // Dead (2.96 s) hits the ground between 1.9 and 2.1 s and settles until
    // about 2.9 s; removed after the default 2 s it vanished in mid-fall. The
    // whole clip plays, the other two end or lie still before (read from the
    // clips, tools/model-budget/death-rest.spec.ts).
    deathDuration: 3000,
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
    // Tuned live in the Enemy Debugger (playtest 515). The preview measures
    // this model as 2 cm tall (mesh ahead of its bones, see MODEL_PREVIEW.md,
    // Zentrierung) and aims at its feet; the offset lifts the aim into the
    // figure, 8.5 m tall at preview scale 5. The debugger's Offset Y slider
    // ends at 3, its number field takes 5.
    previewScale: 5,
    previewCameraDistance: 12.5,
    previewCameraAngle: 0.12,
    previewOffsetY: 5,
  },

  tank: {
    id: 'tank',
    name: 'Tank',
    // Quaternius tank in metres, gun along +z, standing on the origin
    // (tools/blender/optimize_enemy.py, recipe `tank`)
    modelUrl: 'assets/models/enemies/tank.glb',
    scale: 1,
    armorType: 'heavy',
    baseHp: 250, // Heavily armored (reduced from 500 for better early game balance)
    baseSpeed: 3,
    hasAnimations: true,
    walkAnimation: 'TankArmature|Tank_Forward',
    // The lower track run moves 0.81 m per clip second, so the tracks keep
    // pace with the ground at 3 m/s
    animationSpeed: 3.72,
    randomAnimationStart: true,
    movingSound: 'assets/sounds/enemies/tank/moving.mp3',
    movingSoundVolume: 0.3,
    movingSoundRefDistance: 50, // Tanks are louder (larger refDistance range)
    heightOffset: 0,
    healthBarOffset: 5.5,
    canBleed: false, // Tanks don't bleed
    headingOffset: 0,
    mechanical: true,
    randomSoundStart: true, // Start sound at random position
    // 4.7 m wide (the old tank 3.7 m): 0.7 keeps it as far from the kerb of
    // a 10 m road as 0.85 kept the old one
    lateralSpread: 0.7,
    spawnStartDelay: 800, // Larger gap between tanks (800ms instead of 300ms)
    previewScale: 0.65,
    previewCameraDistance: 7,
    previewCameraAngle: 0.26,
    previewOffsetY: 0,
  },

  wallsmasher: {
    id: 'wallsmasher',
    name: 'Wallsmasher',
    // GLB in metres (the FBX was in centimetres, scale 0.037), only Walk, Run and Death.
    modelUrl: 'assets/models/enemies/wallsmasher.glb',
    scale: 3.7,
    armorType: 'light',
    baseHp: 200,
    // Walks 4, runs 10 m/s half the time (rush): mean 7 m/s, the speed the
    // wave curriculum was tuned with while the rush was lost.
    baseSpeed: 4,
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
    previewScale: 1.5,
    previewCameraDistance: 4,
    previewCameraAngle: 0.26,
    previewOffsetY: 0,
  },

  'stone-golem': {
    id: 'stone-golem',
    name: 'Stone Golem',
    modelUrl: 'assets/models/enemies/stone_golem.glb',
    scale: 7.312,

    armorType: 'fortified',
    baseHp: 480,
    baseSpeed: 2.5,

    hasAnimations: true,
    walkAnimation: 'Casual_Walk',
    deathAnimation: 'dying_backwards',
    // dying_backwards (2.21 s of clip, 2.94 s at 0.75) drops between 1.1 and
    // 1.4 s of clip time and settles its limbs until about 2 s; the default
    // 2 s (1.5 s of clip) took the golem away before that. The whole clip
    // plays (tools/model-budget/death-rest.spec.ts).
    deathDuration: 3000,
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
    armorType: 'light',
    baseHp: 25,
    baseSpeed: 8,
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
    armorType: 'unarmored',
    baseHp: 30,
    baseSpeed: 9,
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
    armorType: 'fortified',
    baseHp: 500,
    baseSpeed: 4,
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
    armorType: 'heavy',
    baseHp: 160,
    baseSpeed: 6,
    hasAnimations: true,
    walkAnimation: 'zombie_02_Run',
    deathAnimation: 'zombie_02_Death',
    // zombie_02_Death (4.5 s of clip, 3.26 s at 1.38) falls between 2.2 and
    // 3.7 s of clip time; the default 2 s (2.76 s of clip) took the soldier
    // away halfway down. The whole clip plays
    // (tools/model-budget/death-rest.spec.ts).
    deathDuration: 3300,
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
    armorType: 'unarmored',
    baseHp: 5,
    baseSpeed: 10,
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
    armorType: 'unarmored',
    // Swarm between the rat (5 HP, 10 m/s) and the zombie (80 HP, 5 m/s).
    baseHp: 20,
    baseSpeed: 6,
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
    armorType: 'unarmored',
    // 30 % of the skeleton's HP and a bit faster. The split scales both by the
    // parent's multipliers, so a wave's hpMult reaches the minions too. No
    // splitOnDeath of its own: a minion does not split again.
    baseHp: 6,
    baseSpeed: 7,
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
    armorType: 'light',
    baseHp: 60,
    baseSpeed: 9,
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
    armorType: 'fortified',
    baseHp: 400,
    baseSpeed: 3,
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
    armorType: 'heavy',
    baseHp: 300,
    baseSpeed: 8,
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
    // Darkened (playtest 2026-09-15: far too bright and yellow). Its texture
    // is a light orange brown, about 2.5 times the mammoth's of the same set;
    // 0.8 and a faint glow put it among the other creatures.
    colorMultiplier: 0.8,
    emissiveIntensity: 0.05,
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
    armorType: 'heavy',
    baseHp: 450,
    baseSpeed: 6,
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
    armorType: 'ethereal',
    baseHp: 120,
    baseSpeed: 5,
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
    armorType: 'light',
    baseHp: 80,
    baseSpeed: 9,
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
    armorType: 'heavy',
    baseHp: 500,
    baseSpeed: 3,
    hasAnimations: true,
    walkAnimation: 'Armature|Walk',
    animationSpeed: 0.7,
    heightOffset: 0.5,
    healthBarOffset: 14,
    canBleed: false,
    headingOffset: 0,
    mechanical: true,
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
    armorType: 'ethereal',
    baseHp: 100,
    baseSpeed: 8,
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

  worm: {
    id: 'worm',
    name: 'Skarnax',
    epithet: 'The Thousand-Legged Calamity',
    ...WORM_MODELS.head,
    ...WORM_STATS,
    // One spawn puts the whole worm on the route: as long as the route, one
    // enemy per segment, the head drawn with this model, the body with
    // worm-segment's (managers/worm)
    chain: {
      segmentModel: 'worm-segment',
      tailModel: 'worm-tail',
      spacing: WORM_MODELS.spacing,
      minSegments: 16,
      maxSegments: WORM_MAX_SEGMENTS,
      // Gentle: the rings keep overlapping at the body on the sway. Sharp
      // route corners can still open gaps on the outer side.
      sway: 0.35,
      swayWavelength: 40,
    },
  },

  'worm-segment': {
    // The body ring of the worm. The worm's segments are enemies of type
    // 'worm' drawn from this pool; spawned on its own (Custom Wave, Enemy
    // Debug) it is a single ring with the worm's stats, handy to tune the
    // model.
    id: 'worm-segment',
    name: 'Skarnax Segment',
    ...WORM_MODELS.segment,
    ...WORM_STATS,
  },

  'worm-tail': {
    // The last ring of a worm, with its tail plates and cerci: drawn from
    // this pool once the worm's last segment is out (chain.tailModel), and
    // for the segment in front of a gap. Not offered on its own in the
    // debug lists; worm-segment is the ring to tune there.
    id: 'worm-tail',
    name: 'Skarnax Tail',
    ...WORM_MODELS.tail,
    ...WORM_STATS,
    debugUnlisted: true,
  },

  ooze: {
    id: 'ooze',
    name: 'Ooze',
    // The body is a band of slime along the route, drawn by the engine's
    // ooze renderer; no model instance spawns. The procedural blob
    // (tools/slime-model) stands in for it in the sidebar preview.
    modelUrl: 'assets/models/enemies/slime.glb',
    scale: 1.6,
    armorType: 'unarmored',
    // One HP pool for the whole body, and every tower along it hits it at
    // once: six Herberts, pinned by no template (not in AI_ENEMY_ORDER).
    baseHp: 3000,
    baseSpeed: 3,
    hasAnimations: true,
    walkAnimation: 'Wobble',
    animationSpeed: 0.6,
    heightOffset: 0,
    healthBarOffset: 3,
    canBleed: true,
    bloodColor: '#6fe021', // Slime, not blood
    headingOffset: 0,
    emissiveIntensity: 0.25,
    emissiveColor: '#66ff22',
    // Appears only as the boss, never in a template
    isBoss: true,
    // The tip keeps to the centre line; the body fills the corridor
    lateralSpread: 0,
    // 80 m of body at the HQ cost ten leaks of the wave, 0.125 leaks a metre
    ooze: { maxLengthM: 80, leakDamageFactor: 10 },
    // A kill (not a leak) breaks it into clumps along its body, one per 4 m
    // of body left (OozeBodies.splitCount). Until 2026-09-14 ten clumps of
    // 30 HP; twenty of 15 hold the same HP and share the same wave gold.
    splitOnDeath: { type: 'slime-clump', count: 20, spread: 0.8 },
    previewScale: 1.4,
    previewCameraDistance: 6,
    previewCameraAngle: 0.35,
    previewOffsetY: 0.6,
  },

  'slime-clump': {
    id: 'slime-clump',
    name: 'Slime Clump',
    // What a killed ooze breaks into (splitOnDeath): the procedural slime
    // blob (tools/slime-model) hopping along, about 1.2 m tall at scale 0.9.
    modelUrl: 'assets/models/enemies/slime.glb',
    scale: 0.9,
    armorType: 'unarmored',
    // Twenty of them hold a tenth of the ooze's HP; the split scales them by
    // its HP multiplier. No template, not in AI_ENEMY_ORDER, no split of its own.
    baseHp: 15,
    baseSpeed: 4.5,
    hasAnimations: true,
    walkAnimation: 'Wobble',
    // 0.45 s, it lies flat until the removal after 2 s
    deathAnimation: 'Splat',
    // One hop per 0.8 s Wobble cycle: 3.6 m a hop at 4.5 m/s
    animationSpeed: 1.0,
    heightOffset: 0,
    healthBarOffset: 2.2,
    canBleed: true,
    bloodColor: '#6fe021',
    headingOffset: 0,
    emissiveIntensity: 0.3,
    emissiveColor: '#66ff22',
    randomAnimationStart: true,
    lateralSpread: 1.0,
    previewScale: 1.2,
    previewCameraDistance: 5,
    previewCameraAngle: 0.3,
    previewOffsetY: 0.5,
  },
};

export type EnemyTypeId = keyof typeof ENEMY_TYPES;

/** Time from the kill to the removal of an enemy in ms, see EnemyTypeConfig.deathDuration. */
export function enemyDeathDuration(config: Pick<EnemyTypeConfig, 'deathDuration'>): number {
  return config.deathDuration ?? TIMING.deathAnimationDuration;
}

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

/** The types Custom Wave and Enemy Debug offer: all but the `debugUnlisted` ones. */
export function getDebugEnemyTypes(): EnemyTypeConfig[] {
  return getAllEnemyTypes().filter((type) => !type.debugUnlisted);
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
