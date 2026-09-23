import { GameEventBus, SubscriptionBag } from './game-event-bus';
import { ThreeTilesEngine } from '../three-engine';
import { BACKGROUND_MUSIC, MusicTrack } from '../configs/background-music.config';
import { MusicBufferLoader } from './music-buffer-loader';
import { MusicMixer } from './music-mixer';
import { MASTER_BUS_PRE_GAIN } from '../configs/audio.config';

/**
 * BackgroundMusicService — Event-driven background music with crossfade
 *
 * Two playback layers:
 * 1. **Main theme** — played via HTMLAudioElement BEFORE Three.js engine exists.
 *    Call `BackgroundMusicService.playMainTheme()` as early as possible (static).
 *    Crossfaded out when the service is constructed and build music starts.
 *
 * 2. **Game music**: the two Three.js channels of MusicMixer, for seamless
 *    crossfading:
 *    - Phase transitions (build↔wave): fade out active, fade in new track
 *    - Loop crossfade: before a track ends, replay on other channel
 *    - New wave = new random track (avoids repeating previous)
 *
 * This class decides what plays when; MusicMixer does the fading and
 * MusicBufferLoader the loading.
 *
 * Framework-agnostic — same pattern as ScreenShakeService, VFXService.
 */
export class BackgroundMusicService {
  private readonly subs = new SubscriptionBag();
  private readonly buffers = new MusicBufferLoader();
  private readonly mixer: MusicMixer;

  // Track selection state
  private lastBuildTrackId: string | null = null;
  private lastWaveTrackId: string | null = null;
  private currentPhase: 'main' | 'build' | 'wave' | 'stopped' = 'stopped';

  // Main theme HTMLAudioElement slow fade-out before the build phase starts
  private mainThemeFadeRafId: number | null = null;
  // Mini-pause timer between the main-theme fade-out and the build fade-in
  private mainThemeGapTimer: ReturnType<typeof setTimeout> | null = null;

  // User-controlled volume multiplier (0-1), applied on top of track + master volume
  private _userVolume = 1.0;

  // =====================================================
  // STATIC: Early main theme (before Three.js exists)
  // =====================================================

  private static mainThemeAudio: HTMLAudioElement | null = null;
  /** The main theme's volume at user volume 1, see playMainTheme(). */
  private static mainThemeBaseVolume = 0;

  /**
   * Start the main theme as early as possible (during loading), at the
   * player's music volume `userVolume` (0 when muted).
   * Uses plain HTMLAudioElement — no Three.js dependency.
   * Call this from the facade/component before the engine is initialized.
   * onLoadingComplete() fades it out when build music starts.
   *
   * The element plays outside the Web Audio graph, so it does not pass the
   * master bus's pre-gain that the build and wave tracks get; it is scaled
   * by that gain here to sit at their level. A browser that refuses
   * autoplay starts it on the first click or key instead.
   */
  static playMainTheme(userVolume = 1): void {
    if (BackgroundMusicService.mainThemeAudio) return;
    const track = BACKGROUND_MUSIC.main[0];
    if (!track) return;

    const audio = new window.Audio(track.url);
    audio.loop = track.loop ?? true;
    BackgroundMusicService.mainThemeBaseVolume =
      (track.volume ?? 0.5) * BACKGROUND_MUSIC.masterVolume * MASTER_BUS_PRE_GAIN;
    audio.volume = BackgroundMusicService.mainThemeBaseVolume * userVolume;

    const startOffset = track.startOffset ?? 0;
    const begin = () => {
      if (startOffset > 0) {
        try {
          audio.currentTime = startOffset;
        } catch {
          /* seek not ready — falls back to start */
        }
      }
      audio.play().catch(() => BackgroundMusicService.retryOnGesture(audio));
    };

    // Seeking needs the duration metadata. Wait for it so we don't briefly
    // play from 0:00 before jumping to the offset.
    if (startOffset > 0 && audio.readyState < HTMLMediaElement.HAVE_METADATA) {
      audio.addEventListener('loadedmetadata', begin, { once: true });
    } else {
      begin();
    }

    BackgroundMusicService.mainThemeAudio = audio;
  }

  /**
   * Autoplay was refused: play `audio` on the first click or key, unless the
   * main theme was stopped or replaced by then.
   */
  private static retryOnGesture(audio: HTMLAudioElement): void {
    const events = ['pointerdown', 'keydown'] as const;
    const retry = () => {
      events.forEach((e) => window.removeEventListener(e, retry, true));
      if (BackgroundMusicService.mainThemeAudio === audio) audio.play().catch(() => undefined);
    };
    events.forEach((e) => window.addEventListener(e, retry, true));
  }

  /** Stop the main theme immediately */
  private static stopMainTheme(): void {
    const audio = BackgroundMusicService.mainThemeAudio;
    if (audio) {
      audio.pause();
      audio.src = '';
      BackgroundMusicService.mainThemeAudio = null;
    }
  }

  // =====================================================
  // CONSTRUCTOR
  // =====================================================

  constructor(
    private readonly eventBus: GameEventBus,
    tilesEngine: ThreeTilesEngine,
  ) {
    this.mixer = new MusicMixer(tilesEngine.spatialAudio.getListener());
    this.preloadAll();
    this.setupEventHandlers();

    // NOTE: Do NOT transition from main theme here.
    // The main theme should keep playing until the loading screen is fully hidden.
    // Call onLoadingComplete() from outside when loading is done.
  }

  // =====================================================
  // PUBLIC API
  // =====================================================

  get volume(): number {
    return this._userVolume;
  }

  /** Set user volume (0-1). Immediately updates the playing channels and the main theme. */
  setVolume(vol: number): void {
    const wasSilent = this._userVolume === 0;
    this._userVolume = Math.max(0, Math.min(1, vol));
    this.mixer.setUserVolume(this._userVolume);
    // Silent, nothing plays (see crossfadeToTrack); audible again, the phase's
    // track comes back
    if (this._userVolume === 0) {
      this.mixer.stop();
    } else if (wasSilent && !this.mixer.playing) {
      if (this.currentPhase === 'build') this.playBuildPhase();
      else if (this.currentPhase === 'wave') this.playWavePhase();
    }
    const main = BackgroundMusicService.mainThemeAudio;
    // A running fade-out owns the element's volume
    if (main && this.mainThemeFadeRafId === null) {
      main.volume = BackgroundMusicService.mainThemeBaseVolume * this._userVolume;
    }
  }

  /**
   * Called when the loading screen has fully hidden.
   * Transitions from the static main theme to build phase music.
   */
  onLoadingComplete(): void {
    this.transitionFromMainTheme();
  }

  /** Stop all music immediately (no fade) */
  stop(): void {
    this.mixer.stop();
    this.cancelMainThemeFade();
    this.currentPhase = 'stopped';
  }

  destroy(): void {
    this.stop();
    BackgroundMusicService.stopMainTheme();
    this.subs.disposeAll();
    this.mixer.dispose();
  }

  // =====================================================
  // INITIALIZATION
  // =====================================================

  /** Preload all music buffers in the background */
  private preloadAll(): void {
    const allTracks = [...BACKGROUND_MUSIC.build, ...BACKGROUND_MUSIC.wave];
    for (const track of allTracks) {
      this.buffers.load(track.url);
    }
  }

  // =====================================================
  // MAIN THEME → BUILD TRANSITION
  // =====================================================

  /**
   * Transition from the static HTMLAudioElement main theme to build music.
   * Sequential — NOT an overlapping crossfade:
   *   1. slow fade-out of the main theme
   *   2. short silent mini-pause
   *   3. fade-in of the build track
   * If no main theme is playing, skip step 1 and start with the mini-pause.
   */
  private transitionFromMainTheme(): void {
    const htmlAudio = BackgroundMusicService.mainThemeAudio;

    // Steps 2+3: once the main theme is gone, wait the mini-pause, then build.
    const startBuildAfterGap = (): void => {
      BackgroundMusicService.stopMainTheme();
      this.mainThemeGapTimer = setTimeout(() => {
        this.mainThemeGapTimer = null;
        this.playBuildPhase();
      }, BACKGROUND_MUSIC.mainThemeGapDuration);
    };

    if (htmlAudio && !htmlAudio.paused) {
      // Step 1: slowly fade out the main theme HTML audio element.
      const startVol = htmlAudio.volume;
      const fadeStart = performance.now();
      const dur = BACKGROUND_MUSIC.mainThemeFadeOutDuration;

      const step = (now: number) => {
        const t = Math.min(1, (now - fadeStart) / dur);
        htmlAudio.volume = startVol * (1 - t);
        if (t < 1) {
          this.mainThemeFadeRafId = requestAnimationFrame(step);
        } else {
          this.mainThemeFadeRafId = null;
          startBuildAfterGap();
        }
      };
      this.mainThemeFadeRafId = requestAnimationFrame(step);
    } else {
      // Main theme already ended (loop: false) — just mini-pause, then build.
      startBuildAfterGap();
    }
  }

  private cancelMainThemeFade(): void {
    if (this.mainThemeFadeRafId !== null) {
      cancelAnimationFrame(this.mainThemeFadeRafId);
      this.mainThemeFadeRafId = null;
    }
    if (this.mainThemeGapTimer !== null) {
      clearTimeout(this.mainThemeGapTimer);
      this.mainThemeGapTimer = null;
    }
    BackgroundMusicService.stopMainTheme();
  }

  // =====================================================
  // EVENT HANDLERS
  // =====================================================

  private setupEventHandlers(): void {
    // Wave started → switch to a wave-phase track
    this.subs.add(
      this.eventBus.on('wave:started', () => {
        this.playWavePhase();
      }),
    );

    // Wave completed → back to build music
    this.subs.add(
      this.eventBus.on('wave:completed', () => {
        this.playBuildPhase();
      }),
    );

    // Game over → fade out
    this.subs.add(
      this.eventBus.on('game:over', () => {
        this.fadeOutAndStop();
      }),
    );

    // Game reset (restart, new location) → back to build music. Not while
    // the main theme is still up: the end of loading hands over from it.
    this.subs.add(
      this.eventBus.on('game:reset', () => {
        if (this.mainThemePending()) return;
        this.playBuildPhase();
      }),
    );
  }

  // =====================================================
  // PHASE TRANSITIONS
  // =====================================================

  /** Whether the main theme still plays, fades out or waits for the gap before build. */
  private mainThemePending(): boolean {
    return BackgroundMusicService.mainThemeAudio !== null
      || this.mainThemeFadeRafId !== null
      || this.mainThemeGapTimer !== null;
  }

  private playBuildPhase(): void {
    // A phase change ends the hand-over from the main theme: its pending
    // gap timer would otherwise start build music over this track later
    this.cancelMainThemeFade();
    this.currentPhase = 'build';
    const track = this.pickRandom(BACKGROUND_MUSIC.build, this.lastBuildTrackId);
    if (!track) return;
    this.lastBuildTrackId = track.id;
    this.crossfadeToTrack(track, BACKGROUND_MUSIC.phaseFadeDuration);
  }

  private playWavePhase(): void {
    this.cancelMainThemeFade();
    this.currentPhase = 'wave';
    const track = this.pickRandom(BACKGROUND_MUSIC.wave, this.lastWaveTrackId);
    if (!track) return;
    this.lastWaveTrackId = track.id;
    this.crossfadeToTrack(track, BACKGROUND_MUSIC.phaseFadeDuration);
  }

  private fadeOutAndStop(): void {
    // Fade out the active track, don't start anything new
    if (!this.mixer.fadeOut(BACKGROUND_MUSIC.phaseFadeDuration)) {
      this.stop();
    }
  }

  /**
   * Crossfade to `track` over `duration` ms once its buffer is there, and
   * loop it by crossfading it into itself shortly before it ends.
   */
  private async crossfadeToTrack(track: MusicTrack, duration: number): Promise<void> {
    const buffer = await this.buffers.load(track.url);
    if (!buffer) return;

    // If phase changed while loading, abort. At volume 0 nothing starts: a
    // muted player or a bot at 75x would otherwise crossfade every few
    // seconds into silence; setVolume() brings the phase's track back.
    if (this.currentPhase === 'stopped' || this._userVolume === 0) return;

    const trackVol = (track.volume ?? 0.5) * BACKGROUND_MUSIC.masterVolume;
    const loopFade = BACKGROUND_MUSIC.loopCrossfadeDuration;
    await this.mixer.crossfadeTo(buffer, trackVol, duration, {
      leadMs: loopFade,
      onNearEnd: () => {
        // Only loop while music is still running
        if (this.currentPhase === 'stopped') return;
        this.crossfadeToTrack(track, loopFade);
      },
    });
  }

  // =====================================================
  // TRACK SELECTION
  // =====================================================

  /**
   * Pick a random track from the list, avoiding the last played track.
   */
  private pickRandom(tracks: MusicTrack[], lastId: string | null): MusicTrack | null {
    if (tracks.length === 0) return null;
    if (tracks.length === 1) return tracks[0];

    const candidates = tracks.filter(t => t.id !== lastId);
    const pool = candidates.length > 0 ? candidates : tracks;
    return pool[Math.floor(Math.random() * pool.length)];
  }
}
