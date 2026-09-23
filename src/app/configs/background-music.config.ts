/**
 * Background Music Configuration
 *
 * Central config for all background music tracks.
 * Add new tracks here — the BackgroundMusicService picks randomly per phase.
 */

export interface MusicTrack {
  /** Unique identifier */
  id: string;
  /** URL to the audio file */
  url: string;
  /** Per-track volume multiplier 0-1 (default: 0.5) */
  volume?: number;
  /**
   * Start playback at this offset in seconds (main theme only).
   * Build/wave tracks always start at 0. Default: 0.
   */
  startOffset?: number;
  /**
   * Whether the track loops (main theme only).
   * Build/wave tracks use the crossfade loop engine regardless. Default: true.
   */
  loop?: boolean;
}

export interface BackgroundMusicConfig {
  /** Main theme — played during loading, looped until game is ready. */
  main: MusicTrack[];
  /** Tracks for build phase (between waves). Random selection. */
  build: MusicTrack[];
  /** Tracks for wave phase (combat). New random track per wave. */
  wave: MusicTrack[];
  /** Instead of `wave` on a boss wave (isBossWave) */
  boss: MusicTrack[];
  /** Instead of `wave` on a blood-moon wave that is no boss wave */
  bloodMoon: MusicTrack[];
  /** After a lost game, under the run summary */
  gameOver: MusicTrack[];
  /** Game over: the game-over track comes in this long after the wave music faded (ms), after the stinger */
  gameOverMusicDelayMs: number;
  /**
   * End of a wave: the wave music fades out over `fadeOutMs` under the
   * wave-end horn (MOMENT_SOUNDS.waveComplete, 2.5 s), the horn rings out on
   * its own, and the build music fades in over `buildFadeInMs` from
   * `buildDelayMs` on. Until 2026-09-23 wave music crossfaded straight into
   * build music with the horn in the middle of it: too abrupt.
   */
  waveEnd: { fadeOutMs: number; buildDelayMs: number; buildFadeInMs: number };
  /** Share of the volume while the game is paused */
  pauseDim: number;
  /**
   * The music ducks under big sounds (MusicMixer.duck): to `factor` of its
   * volume for `holdMs`, then back over `releaseMs`
   */
  duck: {
    nuclearStrike: { factor: number; holdMs: number };
    abilityImpact: { factor: number; holdMs: number };
    hqDamage: { factor: number; holdMs: number };
    releaseMs: number;
  };
  /** Crossfade duration in ms when looping the same track */
  loopCrossfadeDuration: number;
  /** Fade duration in ms when switching phases (wave<->build) */
  phaseFadeDuration: number;
  /** Main theme → build: slow fade-out duration of the main theme (ms) */
  mainThemeFadeOutDuration: number;
  /** Main theme → build: silent mini-pause before the build track fades in (ms) */
  mainThemeGapDuration: number;
  /** Master music volume multiplier (applied on top of per-track volume) */
  masterVolume: number;
}

export const BACKGROUND_MUSIC: BackgroundMusicConfig = {
  main: [
    { id: 'music-main-03', url: 'assets/music/main/main03.mp3', volume: 0.5, startOffset: 20, loop: false },
  ],
  build: [
    { id: 'music-build-04', url: 'assets/music/build/build04.mp3', volume: 0.5 },
  ],
  wave: [
    { id: 'music-wave-01', url: 'assets/music/wave/wave01.mp3' },
    { id: 'music-wave-02', url: 'assets/music/wave/wave02.mp3' },
    { id: 'music-wave-03', url: 'assets/music/wave/wave03.mp3' },
    { id: 'music-wave-04', url: 'assets/music/wave/wave04.mp3' },
  ],
  // Eleven Music, 2026-09-23 (docs/SOUND_PLAN.md), -13 to -15 LUFS like the wave tracks
  boss: [{ id: 'music-boss-01', url: 'assets/music/boss/boss01.mp3' }],
  bloodMoon: [{ id: 'music-blood-moon-01', url: 'assets/music/blood_moon/blood_moon01.mp3' }],
  gameOver: [{ id: 'music-game-over-01', url: 'assets/music/game_over/game_over01.mp3', volume: 0.35 }],
  gameOverMusicDelayMs: 4000,
  waveEnd: { fadeOutMs: 1200, buildDelayMs: 2800, buildFadeInMs: 3000 },
  pauseDim: 0.35,
  duck: {
    nuclearStrike: { factor: 0.35, holdMs: 3000 },
    abilityImpact: { factor: 0.6, holdMs: 1200 },
    hqDamage: { factor: 0.65, holdMs: 600 },
    releaseMs: 800,
  },
  loopCrossfadeDuration: 2000,
  phaseFadeDuration: 1500,
  mainThemeFadeOutDuration: 3000,
  mainThemeGapDuration: 600,
  masterVolume: 0.4,
};
