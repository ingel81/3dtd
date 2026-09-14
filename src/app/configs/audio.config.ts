/**
 * Audio Configuration
 *
 * Centralized audio settings for spatial sound system.
 * Previously hardcoded in spatial-audio.manager.ts and game-state.manager.ts
 */

import type { AbilityId } from './abilities.config';
import { nukeSoundUrls } from '../utils/nuke-sound';

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
  'hero-round',
  'hero-shell',
  'hero-rune',
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

/**
 * Spatial settings the pieces of the nuclear strike's sound share: heard as
 * far as the strike shakes the camera (SCREEN_SHAKE_CONFIG.strikeFarDistance),
 * where the common limit would cull it at 500 m, and with priority, so the
 * hits and deaths of the wave it lands on do not steal its voices. Two of
 * each at once, for two strikes in a row.
 */
const NUKE_SPATIAL = {
  refDistance: 150,
  rolloffFactor: 0.6,
  volume: 1.6,
  maxInstances: 2,
  priority: true,
  audibleDistance: 1500,
} as const;

/** Roll `roll` of the nuclear strike's rumble (utils/nuke-sound.ts) */
const nukeRumble = (roll: number) =>
  ({ id: `nuclear_strike_rumble_${roll + 1}`, url: () => nukeSoundUrls().rumble[roll], ...NUKE_SPATIAL }) as const;

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
   * Nuclear strike, synthesised (utils/nuke-sound.ts): the blast at the
   * impact, a crack over a sub-bass boom and the fireball's roar (2.4 s),
   * then three rolls of rumble (3 s each, fading into one another), about
   * 8 s in all. Pieces rather than one long sample: they start in game time
   * (AudioService.update), so a pause holds the rumble still to come and a
   * higher game speed shortens it; a piece already playing plays out.
   */
  nuclearStrike: {
    id: 'nuclear_strike',
    url: () => nukeSoundUrls().blast,
    ...NUKE_SPATIAL,
    tail: [
      { delayMs: 450, volume: 0.85, sample: nukeRumble(0) },
      { delayMs: 2600, volume: 0.65, sample: nukeRumble(1) },
      { delayMs: 4800, volume: 0.45, sample: nukeRumble(2) },
    ],
  },
  /**
   * Frost bomb burst: the ice tower's cast (0.8 s), louder and further, and
   * two quick quieter repeats that break it up into a crackle of ice.
   */
  frostBomb: {
    id: 'frost_bomb',
    url: 'assets/sounds/towers/ice/cast.mp3',
    refDistance: 90,
    rolloffFactor: 0.8,
    volume: 1.5,
    maxInstances: 4,
    tail: [
      { delayMs: 110, volume: 0.6 },
      { delayMs: 260, volume: 0.35 },
    ],
  },
  /**
   * EMP pulse: the lightning tower's chain crack (1.2 s), louder and
   * further, with two quieter repeats as the fronts run out.
   */
  emp: {
    id: 'emp',
    url: 'assets/sounds/towers/lightning/lightning_chain.mp3',
    refDistance: 110,
    rolloffFactor: 0.7,
    volume: 1.5,
    maxInstances: 4,
    tail: [
      { delayMs: 180, volume: 0.5 },
      { delayMs: 420, volume: 0.3 },
    ],
  },
  /**
   * Orbital laser: the lightning tower's bolt (2.3 s) where the beam comes
   * down, played again twice more quietly so the crackle lasts about as
   * long as the beam burns (4 s).
   */
  orbitalLaser: {
    id: 'orbital_laser',
    url: 'assets/sounds/towers/lightning/bolt.mp3',
    refDistance: 130,
    rolloffFactor: 0.7,
    volume: 1.4,
    maxInstances: 3,
    tail: [
      { delayMs: 1300, volume: 0.7 },
      { delayMs: 2500, volume: 0.45 },
    ],
  },
} as const;

/**
 * The ooze's sounds (managers/ooze-sounds.ts), synthesised in code
 * (utils/ooze-sound.ts), no asset behind them. The bubbling loop sits on the
 * body point nearest the listener and stands while the game is paused; its id
 * matches no ENEMY_SOUND_PATTERNS entry, so twelve zombies cannot silence the
 * boss (one loop per ooze). The slurp plays every `everyM` metres of body
 * that flow into the HQ, in game time; `minIntervalMs` (wall clock) keeps a
 * fast game speed from stacking them.
 */
export const OOZE_SOUNDS = {
  bubble: { id: 'ooze_bubble', refDistance: 35, rolloffFactor: 1, volume: 0.6 },
  splat: { id: 'ooze_splat', refDistance: 45, rolloffFactor: 1, volume: 1 },
  slurp: { id: 'ooze_slurp', refDistance: 40, rolloffFactor: 1, volume: 0.8, everyM: 3, minIntervalMs: 600 },
} as const;

/** A sample an ability's impact plays */
export interface AbilityImpactSample {
  id: string;
  /** Asset path, or a function that synthesises the sample as a WAV data URL (called once, on registration) */
  url: string | (() => string);
  refDistance: number;
  rolloffFactor: number;
  volume: number;
  maxInstances?: number;
  /** SpatialSoundConfig.priority */
  priority?: boolean;
  /** SpatialSoundConfig.audibleDistance, m */
  audibleDistance?: number;
}

/** A sound an ability plays where it lands */
export interface AbilityImpactSound extends AbilityImpactSample {
  /**
   * Played after each delay (game-time ms, AudioService.update) at that
   * share of the volume: the impact's own sample again, or `sample`
   */
  tail: readonly { readonly delayMs: number; readonly volume: number; readonly sample?: AbilityImpactSample }[];
}

/**
 * Sound per ability on `ability:impact` (AudioService registers and plays
 * them), null for a silent one. Complete per AbilityId, so a new ability
 * decides here.
 */
export const ABILITY_IMPACT_SOUNDS: Record<AbilityId, AbilityImpactSound | null> = {
  'nuclear-strike': GAME_SOUNDS.nuclearStrike,
  'frost-bomb': GAME_SOUNDS.frostBomb,
  emp: GAME_SOUNDS.emp,
  'orbital-laser': GAME_SOUNDS.orbitalLaser,
};
