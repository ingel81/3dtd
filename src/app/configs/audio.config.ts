/**
 * Audio Configuration
 *
 * Centralized audio settings for spatial sound system.
 * Previously hardcoded in spatial-audio.manager.ts and game-state.manager.ts
 */

import type { AbilityId } from './abilities.config';
import { nukeSoundUrls } from '../utils/nuke-sound';
import { laserSoundUrls } from '../utils/laser-sound';

/**
 * Gain in front of the master bus's soft limiter (listener.gain → pre-gain →
 * limiter, SpatialAudioManager): -4.4 dB of headroom. The main theme plays
 * outside that graph and is scaled by it instead (BackgroundMusicService).
 */
export const MASTER_BUS_PRE_GAIN = 0.6;

/** Sound budget limits to prevent audio overload */
export const AUDIO_LIMITS = {
  /** Loop-only budget for enemy ambient sounds (walk/roar). */
  maxEnemySounds: 12,
  /**
   * How often the enemy loop slots go to the nearest enemies again (ms, wall
   * clock), see SpatialAudioLoops.rebalanceEnemyLoops().
   */
  enemyLoopRebalanceMs: 250,
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
  /** A shot of the manned tower hit (docs/TOWER_CONTROL.md): one short high tick */
  towerHit: {
    id: 'ui_tower_hit',
    notes: [{ freq: 1760, ms: 35 }],
    volume: 0.3,
  },
  /** A shot of the manned tower killed: two rising ticks */
  towerKill: {
    id: 'ui_tower_kill',
    notes: [
      { freq: 1319, ms: 45 },
      { freq: 1976, ms: 90 },
    ],
    volume: 0.4,
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

/**
 * Spatial settings of the orbital laser's strike, with priority: the beam
 * kills a stretch of the wave within a few seconds, and their deaths would
 * steal its voice otherwise. Two at once, for two beams in a row.
 */
const LASER_SPATIAL = {
  refDistance: 130,
  rolloffFactor: 0.7,
  volume: 1.4,
  maxInstances: 2,
  priority: true,
} as const;

/** Game state sounds configuration */
export const GAME_SOUNDS = {
  /**
   * The HQ taking a hit, which is an enemy leaking in: an alarm blip over a
   * heavy impact (ElevenLabs, 2026-09-23; until then a generic explosion).
   * Heard up to 1500 m like the nuclear strike, where the common limit would
   * cull it at 500 m: it has to reach the wide overview too, as its shake
   * does. The rolloff keeps it quiet out there, at 1000 m 4 % of its level
   * at 40 m.
   */
  hqDamage: {
    id: 'hq_damage',
    url: 'assets/sounds/game/leak.mp3',
    refDistance: 40,
    rolloffFactor: 1,
    volume: 1.1,
    audibleDistance: 1500,
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
    /**
     * Air raid siren through the warning (6.5 s), at the target where the
     * marker shows it; generated with ElevenLabs (2 s, a rising wail). Ends
     * with the impact, the blast covers the cut. Rolls off like the blast.
     */
    warning: {
      id: 'nuclear_strike_siren',
      url: 'assets/sounds/abilities/nuke_siren.mp3',
      refDistance: NUKE_SPATIAL.refDistance,
      rolloffFactor: NUKE_SPATIAL.rolloffFactor,
      volume: 1,
    },
    /**
     * The missile from its silo, all three generated with ElevenLabs and
     * rolling off like the blast. The ignition at the silo (5 s: a boom and
     * the crackling roar of the engine, fading from about 3.5 s), heard as
     * far as the blast, with priority. The engine as a loop at the missile
     * through its flight (3 s, a steady roar), fading in over 2 s under the
     * ignition. The dive at the target, starting 2.5 s before the impact
     * (2.55 s: a falling whistle that swells and drops in pitch, cut at its
     * loudest), heard as far as the blast, with priority.
     */
    launch: {
      ignition: {
        id: 'nuclear_strike_launch',
        url: 'assets/sounds/abilities/missile_launch.mp3',
        ...NUKE_SPATIAL,
        volume: 1.3,
      },
      engine: {
        id: 'nuclear_strike_engine',
        url: 'assets/sounds/abilities/missile_engine.mp3',
        refDistance: NUKE_SPATIAL.refDistance,
        rolloffFactor: NUKE_SPATIAL.rolloffFactor,
        volume: 0.8,
        fadeInMs: 2000,
      },
      dive: {
        id: 'nuclear_strike_dive',
        url: 'assets/sounds/abilities/missile_dive.mp3',
        ...NUKE_SPATIAL,
        volume: 1,
        leadMs: 2500,
      },
    },
  },
  /**
   * Frost bomb burst, its own sample (generated with ElevenLabs, 2.5 s): an
   * icy crack and burst, then ice crackling and freezing outward with a
   * glassy shimmer, dying away over about 2 s.
   */
  frostBomb: {
    id: 'frost_bomb',
    url: 'assets/sounds/abilities/frost_bomb.mp3',
    refDistance: 90,
    rolloffFactor: 0.8,
    volume: 1.5,
    maxInstances: 2,
    tail: [],
  },
  /**
   * EMP pulse, its own sample (generated with ElevenLabs, 2.5 s): an electric
   * blast with a high-voltage zap, then crackling discharge dying away.
   */
  emp: {
    id: 'emp',
    url: 'assets/sounds/abilities/emp.mp3',
    refDistance: 110,
    rolloffFactor: 0.7,
    volume: 1.5,
    maxInstances: 2,
    tail: [],
  },
  /**
   * Orbital laser. The strike where the beam comes down, synthesised
   * (utils/laser-sound.ts): a zap, a crack and a thump with the burn setting
   * in (1.8 s). Then the burn, generated with ElevenLabs (4 s: it ignites
   * over 0.7 s, then hums and sizzles): a loop that follows the beam's foot
   * along its path in game time (AudioService) and fades out where the beam
   * ends, about 4.45 s in all.
   */
  orbitalLaser: {
    id: 'orbital_laser',
    url: () => laserSoundUrls().strike,
    ...LASER_SPATIAL,
    tail: [],
    beam: {
      id: 'orbital_laser_beam',
      url: 'assets/sounds/abilities/orbital_laser_beam.mp3',
      refDistance: LASER_SPATIAL.refDistance,
      rolloffFactor: LASER_SPATIAL.rolloffFactor,
      volume: 1.3,
      fadeOutMs: 450,
    },
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

/**
 * Skarnax's voice (managers/worm/worm-sounds.ts): now and then a growl or a
 * clack of its legs at the head, one-shots cut from a sound generated with
 * ElevenLabs. The first comes `firstMs` of game time after the worm
 * appears, then one every `gapMs`; each a sample drawn at random, at a
 * random share of the volume and a random playback rate (pitch), all drawn
 * from a seed per worm, so a run repeats. `gain` evens out the samples (the
 * clack is quieter). At the head nearest the listener, `liftM` above the
 * ground.
 *
 * `slither`: the worm's body grinding through the dirt, one loop per worm at
 * the same head (ElevenLabs, 2026-09-23), not one per segment: 240 loops
 * would fill the enemy budget. Its id matches no ENEMY_SOUND_PATTERNS entry,
 * so it stays out of that budget like the ooze's bubbling.
 */
export const WORM_SOUNDS = {
  slither: {
    id: 'worm_slither',
    url: 'assets/sounds/enemies/skarnax/slither_loop.mp3',
    refDistance: 50,
    rolloffFactor: 1,
    volume: 0.6,
  },
  voice: {
    samples: [
      { id: 'skarnax_growl_1', url: 'assets/sounds/enemies/skarnax/growl_1.mp3', gain: 1 },
      { id: 'skarnax_growl_2', url: 'assets/sounds/enemies/skarnax/growl_2.mp3', gain: 1 },
      { id: 'skarnax_clack', url: 'assets/sounds/enemies/skarnax/clack.mp3', gain: 1.5 },
    ],
    refDistance: 40,
    rolloffFactor: 1,
    volume: 1.1,
    firstMs: { min: 1500, max: 4000 },
    gapMs: { min: 6000, max: 15000 },
    volumeShare: { min: 0.75, max: 1 },
    playbackRate: { min: 0.9, max: 1.1 },
    liftM: 2,
  },
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

/** A loop an ability plays (SpatialAudioManager.createLoop), registered with `loop: true` */
export interface AbilityLoopSample {
  id: string;
  /** Asset path */
  url: string;
  refDistance: number;
  rolloffFactor: number;
  volume: number;
}

/** A sound an ability plays where it lands */
export interface AbilityImpactSound extends AbilityImpactSample {
  /**
   * Played after each delay (game-time ms, AudioService.update) at that
   * share of the volume: the impact's own sample again, or `sample`
   */
  tail: readonly { readonly delayMs: number; readonly volume: number; readonly sample?: AbilityImpactSample }[];
  /**
   * A loop at the target from `ability:used` to `ability:impact`, through
   * the warning (the nuclear strike's siren). It stands while the game is
   * paused like every loop; a restart ends it.
   */
  warning?: AbilityLoopSample;
  /**
   * A strike fired from a building (the nuclear strike's missile), played on
   * `ability:used` when it carries a launch site, see AbilityLaunchSound.
   */
  launch?: AbilityLaunchSound;
  /**
   * A beam's burn (the orbital laser): a loop from `ability:impact` on that
   * follows the beam's foot along the event's `path` in game time, as fast
   * and as long as the beam burns (ABILITIES, abilityBeamBurnMs), then fades
   * out where the beam ended. Stands while the game is paused; a restart
   * ends it.
   */
  beam?: AbilityBeamSound;
}

/**
 * The sounds of a strike on its way from its launch site to the target:
 * `ignition` at the launch site on `ability:used`; `engine`, a loop that
 * follows the missile along its flight in game time (MissileFlight, as the
 * renderer flies it), fading in over `fadeInMs` of game time, until the
 * impact; `dive` at the target, `leadMs` of game time before the impact,
 * stopped at the impact if it still plays (a higher game speed shortens the
 * flight, not the sample). Held by a pause like the flight; a restart ends
 * them.
 */
export interface AbilityLaunchSound {
  ignition: AbilityImpactSample;
  engine: AbilityLoopSample & { fadeInMs: number };
  dive: AbilityImpactSample & { leadMs: number };
}

/** A beam's burn, see AbilityImpactSound.beam */
export interface AbilityBeamSound extends AbilityLoopSample {
  /** Game ms it fades out over once the beam is done */
  fadeOutMs: number;
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
