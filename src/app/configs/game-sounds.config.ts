/**
 * Sounds of game events that are not a tower's shot, an ability's impact or
 * an enemy's walk: deaths and hits of enemies, tower upgrades, splits,
 * footsteps, the casts of abilities, the hero, the moments of a run (wave,
 * blood moon, research, game over) and the UI cues. GameSoundsService plays
 * the ones in the world and the moments, uiSound (services/ui-sound.ts) the UI cues.
 * Generated with ElevenLabs (docs/SOUND_PLAN.md, Phase 2), each peak
 * normalised; `volume` sets the mix.
 */
import type { AbilityId } from './abilities.config';
import type { ProjectileTypeId } from './projectile-types.config';

/** A sample and how it plays; an unset field keeps the spatial audio's default. */
export interface GameSoundSample {
  id: string;
  url: string;
  volume: number;
  refDistance?: number;
  rolloffFactor?: number;
  /** Anti-flood window of the sample (ms, wall clock, stretched by the game speed) */
  minIntervalMs?: number;
  /** Instances of the sample at once */
  maxInstances?: number;
  /** Not stolen by other one-shots when the voices run out */
  priority?: boolean;
  audibleDistance?: number;
  /** Below 1 the sample plays lower and slower (and above 1 higher); default 1 */
  playbackRate?: number;
  /** A feedback cue, not a sound of the fight: damped when the camera is close (SpatialSoundConfig.feedback) */
  feedback?: boolean;
}

const DEATH = 'assets/sounds/deaths/';

/** A small enemy's death: many at once in a wave, so short and throttled */
const smallDeath = (name: string, volume = 0.5): GameSoundSample => ({
  id: `death_${name}`, url: `${DEATH}${name}.mp3`, volume, refDistance: 35, rolloffFactor: 1.2,
  minIntervalMs: 60, maxInstances: 3,
});

/** A big enemy's death: rarer, heard further */
const bigDeath = (name: string, volume = 0.8): GameSoundSample => ({
  id: `death_${name}`, url: `${DEATH}${name}.mp3`, volume, refDistance: 60, rolloffFactor: 1,
  minIntervalMs: 150, maxInstances: 2,
});

/** A boss's death: once, over everything, not stolen */
const bossDeath = (name: string): GameSoundSample => ({
  id: `death_${name}`, url: `${DEATH}${name}.mp3`, volume: 1.1, refDistance: 120, rolloffFactor: 0.8,
  maxInstances: 1, priority: true, audibleDistance: 900,
});

/** Death sound per enemy (EnemyTypeConfig.deathSound). */
export const DEATH_SOUNDS = {
  zombie: smallDeath('zombie'),
  zombie_soldier: smallDeath('zombie_soldier'),
  ghost: smallDeath('ghost'),
  wraith: smallDeath('wraith'),
  bone: smallDeath('bone'),
  slime: smallDeath('slime', 0.4),
  // Rats die in swarms: quiet and one at a time, or they chatter (playtest 2026-09-23)
  rat: { ...smallDeath('rat', 0.2), minIntervalMs: 250, maxInstances: 1 },
  penguin: smallDeath('penguin', 0.45),
  spider: smallDeath('spider'),
  bat: smallDeath('bat', 0.45),
  hornet: smallDeath('hornet', 0.45),
  bear: bigDeath('bear', 0.7),
  mammoth: bigDeath('mammoth'),
  dragon: bigDeath('dragon'),
  golem: bigDeath('golem'),
  // A long roar: quieter and one at a time (playtest 2026-09-23)
  wallsmasher: { ...bigDeath('wallsmasher', 0.45), minIntervalMs: 400, maxInstances: 1 },
  mech: bigDeath('mech', 0.7),
  skarnax: bossDeath('skarnax'),
  ooze: bossDeath('ooze'),
  herbert: bossDeath('herbert'),
} as const satisfies Record<string, GameSoundSample>;

export type DeathSoundId = keyof typeof DEATH_SOUNDS;

const hit = (name: string, volume: number): GameSoundSample => ({
  id: `hit_${name}`, url: `assets/sounds/hits/${name}.mp3`, volume, refDistance: 30, rolloffFactor: 1.3,
  minIntervalMs: 70, maxInstances: 3,
});

/** Hit sound per body (EnemyTypeConfig.hitSound; a type without one takes hits silently, the ghosts). */
export const HIT_SOUNDS = {
  flesh: hit('flesh', 0.35),
  metal: hit('metal', 0.3),
  bone: hit('bone', 0.35),
  stone: hit('stone', 0.35),
  slime: hit('slime', 0.3),
} as const satisfies Record<string, GameSoundSample>;

export type HitSoundId = keyof typeof HIT_SOUNDS;

/**
 * Projectiles whose hits sound: the single shots (archer, cannon, the hero).
 * Rapid fire (gatling), streams (flame, poison) and orbs would make a hit
 * sound a constant hiss. Add a projectile here to give its hits a sound.
 */
export const HIT_SOUND_PROJECTILES: ReadonlySet<ProjectileTypeId> = new Set<ProjectileTypeId>([
  'arrow',
  'cannonball',
  'hero-round',
  'hero-shell',
  'hero-rune',
]);

/** Sounds in the world, at the place of their event. */
export const WORLD_SOUNDS = {
  towerUpgrade: {
    id: 'tower_upgrade', url: 'assets/sounds/effects/tower_upgrade.mp3', volume: 0.7, refDistance: 60,
    rolloffFactor: 1, minIntervalMs: 120, maxInstances: 2,
  },
  /** A skeleton falls apart into its minions (EnemyTypeConfig.splitSound) */
  skeletonSplit: {
    id: 'skeleton_split', url: 'assets/sounds/enemies/skeleton/split.mp3', volume: 0.6, refDistance: 40,
    rolloffFactor: 1.2, minIntervalMs: 80, maxInstances: 3,
  },
  /** A worm segment is destroyed while the worm lives on */
  wormSegment: {
    id: 'worm_segment', url: 'assets/sounds/enemies/skarnax/split.mp3', volume: 0.8, refDistance: 70,
    rolloffFactor: 1, minIntervalMs: 200, maxInstances: 2,
  },
  /** Kill gold, at the enemy: a clink, thinned out hard; a feedback cue, quiet in a manned tower */
  coin: {
    id: 'coin_bounty', url: 'assets/sounds/game/coin.mp3', volume: 0.25, refDistance: 30, rolloffFactor: 1.5,
    minIntervalMs: 140, maxInstances: 2, feedback: true,
  },
  heroLevelUp: {
    id: 'hero_levelup', url: 'assets/sounds/hero/levelup.mp3', volume: 0.8, refDistance: 80, rolloffFactor: 1,
    maxInstances: 1,
  },
} as const satisfies Record<string, GameSoundSample>;

export type WorldSoundId = keyof typeof WORLD_SOUNDS;

/**
 * An enemy's heavy steps (EnemyTypeConfig.footstep), in step with its walk
 * clip: the renderer reports a step where the clip's phase passes one of
 * `phases` (EnemyInstanceManager.onFootstep), so the sound falls on the foot
 * that lands. Nothing while the clip stands (pause, frozen, headless).
 */
export interface FootstepConfig {
  sound: GameSoundSample;
  /** Phases of the walk clip (0-1) where a foot touches down */
  phases: readonly number[];
  /** Shakes the camera near it (ScreenShakeService, SCREEN_SHAKE_CONFIG.presets.footstep) */
  shake: boolean;
}

export const GOLEM_FOOTSTEP: FootstepConfig = {
  sound: {
    id: 'golem_footstep', url: 'assets/sounds/enemies/golem/footstep.mp3', volume: 0.75, refDistance: 45,
    rolloffFactor: 1.1, minIntervalMs: 120, maxInstances: 3,
    // Deeper, as heavy as the golem looks (playtest 2026-09-23)
    playbackRate: 0.75,
  },
  // Heels down in Casual_Walk (1.33 s): right at 0.34, left at 0.85, measured
  // from the lowest point of the foot bones (three AnimationMixer over the GLB, 2026-09-23)
  phases: [0.34, 0.85],
  shake: true,
};

/** The cast of an ability, at its target on `ability:used`; null where the ability has none (the missile's launch plays instead). */
export const ABILITY_CAST_SOUNDS: Record<AbilityId, GameSoundSample | null> = {
  'nuclear-strike': null,
  'frost-bomb': {
    id: 'frost_bomb_cast', url: 'assets/sounds/abilities/frost_bomb_cast.mp3', volume: 1, refDistance: 120,
    rolloffFactor: 0.8, maxInstances: 2, priority: true,
  },
  emp: {
    id: 'emp_charge', url: 'assets/sounds/abilities/emp_charge.mp3', volume: 1, refDistance: 120,
    rolloffFactor: 0.8, maxInstances: 2, priority: true,
  },
  'orbital-laser': {
    id: 'orbital_laser_charge', url: 'assets/sounds/abilities/orbital_laser_charge.mp3', volume: 1,
    refDistance: 130, rolloffFactor: 0.7, maxInstances: 2, priority: true,
  },
};

/** A cue that does not sit in the world (playGlobal): the moments of a run. At the SFX volume. */
export interface GlobalCue {
  id: string;
  url: string;
  volume: number;
}

export const MOMENT_SOUNDS = {
  waveStart: { id: 'wave_start', url: 'assets/sounds/game/wave_start.mp3', volume: 0.45 },
  waveComplete: { id: 'wave_complete', url: 'assets/sounds/game/wave_complete.mp3', volume: 0.4 },
  /** Instead of the horn at the start of a blood-moon wave */
  bloodMoon: { id: 'blood_moon', url: 'assets/sounds/game/blood_moon.mp3', volume: 0.9 },
  researchComplete: { id: 'research_complete', url: 'assets/sounds/game/research_complete.mp3', volume: 0.5 },
  abilityReady: { id: 'ability_ready', url: 'assets/sounds/game/ability_ready.mp3', volume: 0.45 },
  heroHire: { id: 'hero_hire', url: 'assets/sounds/hero/hire.mp3', volume: 0.6 },
  heroAmmo: { id: 'hero_ammo_switch', url: 'assets/sounds/hero/ammo_switch.mp3', volume: 0.5 },
  hqDestroyed: { id: 'hq_destroyed', url: 'assets/sounds/game/hq_destroyed.mp3', volume: 1 },
  gameOver: { id: 'game_over', url: 'assets/sounds/game/game_over.mp3', volume: 0.8 },
} as const satisfies Record<string, GlobalCue>;

/**
 * The boss's own sound in its intro (BossIntroService), per enemy type id:
 * who comes, not a boss roar for all. A combined intro plays the first
 * boss's. A boss without one is silent there.
 */
export const BOSS_INTRO_SOUNDS: Readonly<Record<string, GlobalCue>> = {
  worm: { id: 'boss_intro_skarnax', url: 'assets/sounds/bosses/skarnax.mp3', volume: 0.85 },
  ooze: { id: 'boss_intro_ooze', url: 'assets/sounds/bosses/ooze.mp3', volume: 0.85 },
  herbert: { id: 'boss_intro_herbert', url: 'assets/sounds/bosses/herbert.mp3', volume: 0.85 },
};

/**
 * The cheat buttons of the dev menu (kill all, research, max upgrade,
 * abilities, hero) make no sound: what follows from them within this many
 * ms of wall time stays silent (GameSoundsService), deferred events
 * included. Otherwise "complete all research" rang the research chime once
 * per research.
 */
export const CHEAT_QUIET_MS = 500;

/** The defeat stinger follows the HQ's destruction by this much (ms, wall clock). */
export const GAME_OVER_STINGER_DELAY_MS = 1200;

/** UI cues (uiSound, services/ui-sound.ts): at the UI volume. */
export const UI_CUES = {
  selectBuild: { id: 'ui_select_build', url: 'assets/sounds/ui/select_build.mp3', volume: 0.5 },
  dialogOpen: { id: 'ui_dialog_open', url: 'assets/sounds/ui/dialog_open.mp3', volume: 0.45 },
  dialogClose: { id: 'ui_dialog_close', url: 'assets/sounds/ui/dialog_close.mp3', volume: 0.45 },
  heroMove: { id: 'hero_move_ack', url: 'assets/sounds/hero/move_ack.mp3', volume: 0.5 },
  noMoney: { id: 'no_money', url: 'assets/sounds/game/no_money.mp3', volume: 0.6 },
  denied: { id: 'denied', url: 'assets/sounds/game/denied.mp3', volume: 0.6 },
} as const satisfies Record<string, GlobalCue>;

export type UiCueId = keyof typeof UI_CUES;
