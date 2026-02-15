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
  /** Master music volume multiplier (applied on top of per-track volume) */
  masterVolume: number;
}

export const BACKGROUND_MUSIC: BackgroundMusicConfig = {
  main: [
    { id: 'music-main-01', url: '/assets/music/main/main01.mp3', volume: 0.5 },
  ],
  build: [
    { id: 'music-build-01', url: '/assets/music/build/build01.mp3', volume: 0.5 },
    { id: 'music-build-02', url: '/assets/music/build/build02.mp3', volume: 0.5 },
  ],
  wave: [
    { id: 'music-wave-01', url: '/assets/music/wave/wave01.mp3' },
    { id: 'music-wave-02', url: '/assets/music/wave/wave02.mp3' },
    { id: 'music-wave-03', url: '/assets/music/wave/wave03.mp3' },
    { id: 'music-wave-04', url: '/assets/music/wave/wave04.mp3' },
    { id: 'music-wave-05', url: '/assets/music/wave/wave05.mp3' },
    { id: 'music-wave-06', url: '/assets/music/wave/wave06.mp3' },
    { id: 'music-wave-07', url: '/assets/music/wave/wave07.mp3' },
    { id: 'music-wave-08', url: '/assets/music/wave/wave08.mp3' },
    { id: 'music-wave-09', url: '/assets/music/wave/wave09.mp3' },
    { id: 'music-wave-10', url: '/assets/music/wave/wave10.mp3' },
    { id: 'music-wave-11', url: '/assets/music/wave/wave11.mp3' },
    { id: 'music-wave-12', url: '/assets/music/wave/wave12.mp3' },
    { id: 'music-wave-13', url: '/assets/music/wave/wave13.mp3' },
  ],
  loopCrossfadeDuration: 2000,
  phaseFadeDuration: 1500,
  masterVolume: 0.4,
};
