/**
 * Audio Configuration
 *
 * Centralized audio settings for spatial sound system.
 * Previously hardcoded in spatial-audio.manager.ts and game-state.manager.ts
 */

/** Sound budget limits to prevent audio overload */
export const AUDIO_LIMITS = {
  /** Loop-only budget for enemy ambient sounds (walk/roar). */
  maxEnemySounds: 12,
  /**
   * Per-category cap for projectile-class one-shots
   * (arrow/bullet/rocket/...). Tightened from 40 → 25.
   */
  maxProjectileSounds: 25,
  /**
   * Global cap across ALL one-shots (projectile + enemy hits/deaths +
   * tower-fire + impact + spell + UI). Once reached, voice-stealing
   * stops the oldest active one-shot to make room for the new one,
   * which sounds smoother than rejecting the new sound.
   *
   * Tightened from 40 → 30: with longer-tailed sounds (spawn 1–2 s)
   * stacking up to 40 still produced audible distortion despite the
   * master limiter. 30 is still rich enough for combat density.
   */
  maxConcurrentOneShots: 30,
  maxEffectSounds: 10,
  /**
   * Per-sound anti-flood window AND polyphony cap are now derived per
   * buffer from its duration (short combat samples = loose, long spawn
   * samples = strict) inside SpatialAudioPlayback. Override per sound
   * via `SpatialSoundConfig.minIntervalMs` / `maxInstances` when calling
   * registerSound.
   */
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
  'mammouth',
] as const;

/** Projectile sound IDs for budget management */
export const PROJECTILE_SOUND_IDS = [
  'arrow',
  'bullet',
  'rocket',
  'cannonball',
  'ice-shard',
  'arcane-orb',
  'chaos-orb',
  'poison-glob',
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

/**
 * Cues that do not sit in the world: played with playGlobal, at the SFX
 * volume and silent when SFX is muted. The tones are synthesised
 * (utils/alert-tone.ts), no asset behind them.
 */
export const UI_SOUNDS = {
  /** Air two waves ahead (WAVE panel): two short falling notes */
  airAlert: {
    id: 'ui_air_alert',
    notes: [
      { freq: 880, ms: 90 },
      { freq: 587, ms: 170 },
    ],
    volume: 0.35,
  },
} as const;

/** Game state sounds configuration */
export const GAME_SOUNDS = {
  hqDamage: {
    id: 'hq_damage',
    url: 'assets/sounds/effects/explosion.mp3',
    refDistance: 40,
    rolloffFactor: 1,
    volume: 1.4,
  },
  /**
   * Nuclear strike impact: the same sample, louder and audible from further
   * away. Played again after each `tail` delay at that share of the volume,
   * a rumbling tail (wall-clock ms, like the sample itself; AudioService).
   * The 1.3 s sample then plays up to three times at once. `maxInstances`
   * pins the four the playback derives for a sample of that length, so a
   * longer sample would not drop the repeats. Every play of explosion.mp3,
   * HQ damage included, counts against it.
   */
  nuclearStrike: {
    id: 'nuclear_strike',
    url: 'assets/sounds/effects/explosion.mp3',
    refDistance: 150,
    rolloffFactor: 0.6,
    volume: 1.6,
    maxInstances: 4,
    tail: [
      { delayMs: 350, volume: 0.55 },
      { delayMs: 900, volume: 0.35 },
    ],
  },
} as const;
