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
    { id: 'music-main-03', url: '/assets/music/main/main03.mp3', volume: 0.5, startOffset: 20, loop: false },
  ],
  build: [
    { id: 'music-build-04', url: '/assets/music/build/build04.mp3', volume: 0.5 },
  ],
  wave: [
    { id: 'music-wave-01', url: '/assets/music/wave/wave01.mp3' },
    { id: 'music-wave-02', url: '/assets/music/wave/wave02.mp3' },
    { id: 'music-wave-03', url: '/assets/music/wave/wave03.mp3' },
    { id: 'music-wave-04', url: '/assets/music/wave/wave04.mp3' },
  ],
  loopCrossfadeDuration: 2000,
  phaseFadeDuration: 1500,
  mainThemeFadeOutDuration: 3000,
  mainThemeGapDuration: 600,
  masterVolume: 0.4,
};
