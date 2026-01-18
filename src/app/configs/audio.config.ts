/**
 * Audio Configuration
 *
 * Centralized audio settings for spatial sound system.
 * Previously hardcoded in spatial-audio.manager.ts and game-state.manager.ts
 */

/** Sound budget limits to prevent audio overload */
export const AUDIO_LIMITS = {
  maxEnemySounds: 12,
  maxProjectileSounds: 20,
  maxEffectSounds: 10,
  /** Maximum distance at which sounds are played (meters) - saves CPU for distant sounds */
  maxAudibleDistance: 500,
} as const;

/** Enemy sound pattern matching for budget management */
export const ENEMY_SOUND_PATTERNS = [
  'zombie',
  'tank',
  'enemy',
  'wallsmasher',
  'big_arm',
  'herbert',
] as const;

/** Default spatial audio settings */
export const SPATIAL_AUDIO_DEFAULTS = {
  refDistance: 50,
  rolloffFactor: 1.5,
  maxDistance: 0,
  distanceModel: 'inverse' as const,
  volume: 1.0,
  loop: false,
} as const;

/** Game state sounds configuration */
export const GAME_SOUNDS = {
  hqDamage: {
    id: 'hq_damage',
    url: '/assets/sounds/effects/explosion.mp3',
    refDistance: 40,
    rolloffFactor: 1,
    volume: 1.4,
  },
} as const;

/** Type exports */
export type SpatialAudioDefaults = typeof SPATIAL_AUDIO_DEFAULTS;
