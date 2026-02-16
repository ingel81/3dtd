import { Audio, AudioListener, AudioLoader } from 'three';
import { GameEventBus, SubscriptionBag } from './game-event-bus';
import { ThreeTilesEngine } from '../three-engine';
import { BACKGROUND_MUSIC, MusicTrack } from '../configs/background-music.config';

const STORAGE_KEY = 'td_music_enabled';

/**
 * Represents one of two crossfade audio channels.
 * Each channel holds a Three.js non-positional Audio instance.
 */
interface AudioChannel {
  audio: Audio;
  /** The AudioBuffer currently loaded on this channel */
  buffer: AudioBuffer | null;
  /** Target volume for this channel (before master) */
  targetVolume: number;
  /** Current volume during fade (before master) */
  currentVolume: number;
  /** Timer for scheduling loop-crossfade before track end */
  loopTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * BackgroundMusicService — Event-driven background music with crossfade
 *
 * Two playback layers:
 * 1. **Main theme** — played via HTMLAudioElement BEFORE Three.js engine exists.
 *    Call `BackgroundMusicService.playMainTheme()` as early as possible (static).
 *    Crossfaded out when the service is constructed and build music starts.
 *
 * 2. **Game music** — uses two Three.js Audio channels (A/B) for seamless crossfading:
 *    - Phase transitions (build↔wave): fade out active, fade in new track
 *    - Loop crossfade: before a track ends, replay on other channel
 *    - New wave = new random track (avoids repeating previous)
 *
 * Framework-agnostic — same pattern as ScreenShakeService, VFXService.
 */
export class BackgroundMusicService {
  private readonly subs = new SubscriptionBag();
  private readonly listener: AudioListener;
  private readonly loader = new AudioLoader();

  // Two-channel crossfade system
  private channelA!: AudioChannel;
  private channelB!: AudioChannel;
  private activeChannel: 'A' | 'B' = 'A';

  // Buffer cache: url → AudioBuffer (avoids reloading)
  private readonly bufferCache = new Map<string, AudioBuffer>();
  private readonly loadingPromises = new Map<string, Promise<AudioBuffer>>();

  // Track selection state
  private lastBuildTrackId: string | null = null;
  private lastWaveTrackId: string | null = null;
  private currentPhase: 'main' | 'build' | 'wave' | 'stopped' = 'stopped';

  // Fade animation
  private fadeRafId: number | null = null;
  private fadeStartTime = 0;
  private fadeDuration = 0;
  private fadeOutChannel: AudioChannel | null = null;
  private fadeInChannel: AudioChannel | null = null;
  private fadeOutStartVol = 0;
  private fadeInTargetVol = 0;

  // Main theme HTMLAudioElement fade-out (running concurrently with channel fade-in)
  private mainThemeFadeRafId: number | null = null;

  // Enable/disable
  private _enabled: boolean;

  // User-controlled volume multiplier (0-1), applied on top of track + master volume
  private _userVolume = 1.0;

  // =====================================================
  // STATIC: Early main theme (before Three.js exists)
  // =====================================================

  private static mainThemeAudio: HTMLAudioElement | null = null;

  /**
   * Start the main theme as early as possible (during loading).
   * Uses plain HTMLAudioElement — no Three.js dependency.
   * Call this from the facade/component before the engine is initialized.
   * The service constructor will crossfade it out when build music starts.
   */
  static playMainTheme(): void {
    // Respect stored preference
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'false') return;
    } catch { /* ignore */ }

    if (BackgroundMusicService.mainThemeAudio) return;
    const track = BACKGROUND_MUSIC.main[0];
    if (!track) return;

    const audio = new window.Audio(track.url);
    audio.loop = true;
    audio.volume = (track.volume ?? 0.5) * BACKGROUND_MUSIC.masterVolume;
    audio.play().catch(() => {
      // Autoplay blocked — will be silent until user interaction
    });
    BackgroundMusicService.mainThemeAudio = audio;
  }

  /** Stop the main theme immediately (used on disable/destroy) */
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
    this.listener = tilesEngine.spatialAudio.getListener();
    this._enabled = this.loadPreference();
    this.initChannels();
    this.preloadAll();
    this.setupEventHandlers();

    // Transition from main theme → build music
    if (this._enabled) {
      this.transitionFromMainTheme();
    } else {
      BackgroundMusicService.stopMainTheme();
    }
  }

  // =====================================================
  // PUBLIC API
  // =====================================================

  get enabled(): boolean {
    return this._enabled;
  }

  enable(): void {
    this._enabled = true;
    this.savePreference(true);
  }

  disable(): void {
    this._enabled = false;
    this.savePreference(false);
    this.stop();
    BackgroundMusicService.stopMainTheme();
  }

  toggle(): boolean {
    if (this._enabled) {
      this.disable();
    } else {
      this.enable();
    }
    return this._enabled;
  }

  get volume(): number {
    return this._userVolume;
  }

  /** Set user volume (0-1). Immediately updates currently playing channels. */
  setVolume(vol: number): void {
    this._userVolume = Math.max(0, Math.min(1, vol));

    // Update fade target if a fade is in progress
    if (this.fadeInChannel) {
      this.fadeInTargetVol = this.fadeInChannel.targetVolume * this._userVolume;
    }

    // Update active channel volumes immediately
    const active = this.getActiveChannel();
    if (active.audio.isPlaying) {
      const v = active.targetVolume * this._userVolume;
      active.audio.setVolume(v);
      active.currentVolume = v;
    }
    const inactive = this.getInactiveChannel();
    if (inactive.audio.isPlaying) {
      const v = inactive.targetVolume * this._userVolume;
      inactive.audio.setVolume(v);
      inactive.currentVolume = v;
    }
  }

  /** Stop all music immediately (no fade) */
  stop(): void {
    this.cancelFade();
    this.cancelMainThemeFade();
    this.stopChannel(this.channelA);
    this.stopChannel(this.channelB);
    this.currentPhase = 'stopped';
  }

  destroy(): void {
    this.stop();
    BackgroundMusicService.stopMainTheme();
    this.subs.disposeAll();
    this.channelA.audio.disconnect();
    this.channelB.audio.disconnect();
  }

  // =====================================================
  // INITIALIZATION
  // =====================================================

  private initChannels(): void {
    this.channelA = this.createChannel();
    this.channelB = this.createChannel();
  }

  private createChannel(): AudioChannel {
    const audio = new Audio(this.listener);
    return {
      audio,
      buffer: null,
      targetVolume: 0,
      currentVolume: 0,
      loopTimer: null,
    };
  }

  /** Preload all music buffers in the background */
  private preloadAll(): void {
    const allTracks = [...BACKGROUND_MUSIC.build, ...BACKGROUND_MUSIC.wave];
    for (const track of allTracks) {
      this.loadBuffer(track.url);
    }
  }

  // =====================================================
  // MAIN THEME → BUILD TRANSITION
  // =====================================================

  /**
   * Crossfade from the static HTMLAudioElement main theme to build music.
   * If no main theme is playing, just start build music directly.
   */
  private transitionFromMainTheme(): void {
    const htmlAudio = BackgroundMusicService.mainThemeAudio;
    if (htmlAudio && !htmlAudio.paused) {
      // Start build music (will fade in via crossfadeToTrack)
      this.playBuildPhase();

      // Concurrently fade out the HTML audio element
      const startVol = htmlAudio.volume;
      const fadeStart = performance.now();
      const dur = BACKGROUND_MUSIC.phaseFadeDuration;

      const step = (now: number) => {
        const t = Math.min(1, (now - fadeStart) / dur);
        htmlAudio.volume = startVol * (1 - t);
        if (t < 1) {
          this.mainThemeFadeRafId = requestAnimationFrame(step);
        } else {
          BackgroundMusicService.stopMainTheme();
          this.mainThemeFadeRafId = null;
        }
      };
      this.mainThemeFadeRafId = requestAnimationFrame(step);
    } else {
      // No main theme playing — start build music directly
      BackgroundMusicService.stopMainTheme();
      this.playBuildPhase();
    }
  }

  private cancelMainThemeFade(): void {
    if (this.mainThemeFadeRafId !== null) {
      cancelAnimationFrame(this.mainThemeFadeRafId);
      this.mainThemeFadeRafId = null;
    }
    BackgroundMusicService.stopMainTheme();
  }

  // =====================================================
  // EVENT HANDLERS
  // =====================================================

  private setupEventHandlers(): void {
    // Wave started → new random wave track
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

    // Game reset → stop immediately
    this.subs.add(
      this.eventBus.on('game:reset', () => {
        this.stop();
      }),
    );
  }

  // =====================================================
  // PHASE TRANSITIONS
  // =====================================================

  private playBuildPhase(): void {
    if (!this._enabled) return;
    this.currentPhase = 'build';
    const track = this.pickRandom(BACKGROUND_MUSIC.build, this.lastBuildTrackId);
    if (!track) return;
    this.lastBuildTrackId = track.id;
    this.crossfadeToTrack(track, BACKGROUND_MUSIC.phaseFadeDuration);
  }

  private playWavePhase(): void {
    if (!this._enabled) return;
    this.currentPhase = 'wave';
    const track = this.pickRandom(BACKGROUND_MUSIC.wave, this.lastWaveTrackId);
    if (!track) return;
    this.lastWaveTrackId = track.id;
    this.crossfadeToTrack(track, BACKGROUND_MUSIC.phaseFadeDuration);
  }

  private fadeOutAndStop(): void {
    const active = this.getActiveChannel();
    if (!active.audio.isPlaying) {
      this.stop();
      return;
    }
    // Fade out active channel, don't start anything new
    this.cancelFade();
    this.fadeOutChannel = active;
    this.fadeInChannel = null;
    this.fadeOutStartVol = active.currentVolume;
    this.fadeInTargetVol = 0;
    this.fadeDuration = BACKGROUND_MUSIC.phaseFadeDuration;
    this.fadeStartTime = performance.now();
    this.fadeRafId = requestAnimationFrame(this.fadeStep);
  }

  // =====================================================
  // CROSSFADE ENGINE
  // =====================================================

  private async crossfadeToTrack(track: MusicTrack, duration: number): Promise<void> {
    const buffer = await this.loadBuffer(track.url);
    if (!buffer) return;

    // If phase changed while loading, abort
    if (this.currentPhase === 'stopped') return;

    const outChannel = this.getActiveChannel();
    const inChannel = this.getInactiveChannel();

    // Stop any pending loop timer on both channels
    this.clearLoopTimer(outChannel);
    this.clearLoopTimer(inChannel);

    // Cancel any ongoing fade
    this.cancelFade();

    // Prepare incoming channel
    this.stopChannel(inChannel);
    inChannel.buffer = buffer;
    inChannel.audio.setBuffer(buffer);
    inChannel.audio.setLoop(false);

    const trackVol = (track.volume ?? 0.5) * BACKGROUND_MUSIC.masterVolume;
    inChannel.targetVolume = trackVol;
    // fadeInTargetVol includes user volume for actual playback
    const effectiveVol = trackVol * this._userVolume;
    inChannel.currentVolume = 0;
    inChannel.audio.setVolume(0);

    // Resume audio context if needed
    const ctx = this.listener.context;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    inChannel.audio.play();

    // Swap active
    this.activeChannel = this.activeChannel === 'A' ? 'B' : 'A';

    // Schedule loop-crossfade for the new track
    this.scheduleLoopCrossfade(inChannel, track);

    // Start fade animation
    this.fadeOutChannel = outChannel.audio.isPlaying ? outChannel : null;
    this.fadeInChannel = inChannel;
    this.fadeOutStartVol = outChannel.currentVolume;
    this.fadeInTargetVol = effectiveVol;
    this.fadeDuration = duration;
    this.fadeStartTime = performance.now();
    this.fadeRafId = requestAnimationFrame(this.fadeStep);
  }

  /** Arrow function to preserve `this` in rAF callback */
  private fadeStep = (now: number): void => {
    const elapsed = now - this.fadeStartTime;
    const t = Math.min(1, elapsed / this.fadeDuration);

    // Fade out
    if (this.fadeOutChannel) {
      const vol = this.fadeOutStartVol * (1 - t);
      this.fadeOutChannel.currentVolume = vol;
      this.fadeOutChannel.audio.setVolume(vol);
    }

    // Fade in
    if (this.fadeInChannel) {
      const vol = this.fadeInTargetVol * t;
      this.fadeInChannel.currentVolume = vol;
      this.fadeInChannel.audio.setVolume(vol);
    }

    if (t < 1) {
      this.fadeRafId = requestAnimationFrame(this.fadeStep);
    } else {
      // Fade complete
      if (this.fadeOutChannel) {
        this.stopChannel(this.fadeOutChannel);
      }
      if (this.fadeInChannel) {
        this.fadeInChannel.currentVolume = this.fadeInTargetVol;
        this.fadeInChannel.audio.setVolume(this.fadeInTargetVol);
      }
      this.fadeRafId = null;
      this.fadeOutChannel = null;
      this.fadeInChannel = null;
    }
  };

  private cancelFade(): void {
    if (this.fadeRafId !== null) {
      cancelAnimationFrame(this.fadeRafId);
      this.fadeRafId = null;
    }
    this.fadeOutChannel = null;
    this.fadeInChannel = null;
  }

  // =====================================================
  // LOOP CROSSFADE
  // =====================================================

  /**
   * Schedule a crossfade to replay the same track before it ends.
   * This creates a seamless loop without the gap of native `loop: true`.
   */
  private scheduleLoopCrossfade(channel: AudioChannel, track: MusicTrack): void {
    if (!channel.buffer) return;

    const durationMs = channel.buffer.duration * 1000;
    const crossfadeDur = BACKGROUND_MUSIC.loopCrossfadeDuration;

    // Schedule crossfade to start `crossfadeDur` ms before the track ends
    const delay = Math.max(0, durationMs - crossfadeDur);

    channel.loopTimer = setTimeout(() => {
      // Only loop if still in the same phase and this channel is still active
      if (this.currentPhase === 'stopped') return;
      if (this.getActiveChannel() !== channel) return;

      this.crossfadeToTrack(track, crossfadeDur);
    }, delay);
  }

  private clearLoopTimer(channel: AudioChannel): void {
    if (channel.loopTimer !== null) {
      clearTimeout(channel.loopTimer);
      channel.loopTimer = null;
    }
  }

  // =====================================================
  // CHANNEL HELPERS
  // =====================================================

  private getActiveChannel(): AudioChannel {
    return this.activeChannel === 'A' ? this.channelA : this.channelB;
  }

  private getInactiveChannel(): AudioChannel {
    return this.activeChannel === 'A' ? this.channelB : this.channelA;
  }

  private stopChannel(channel: AudioChannel): void {
    this.clearLoopTimer(channel);
    if (channel.audio.isPlaying) {
      channel.audio.stop();
    }
    channel.currentVolume = 0;
    channel.targetVolume = 0;
    channel.buffer = null;
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

  // =====================================================
  // BUFFER LOADING
  // =====================================================

  private async loadBuffer(url: string): Promise<AudioBuffer | null> {
    const cached = this.bufferCache.get(url);
    if (cached) return cached;

    const existing = this.loadingPromises.get(url);
    if (existing) return existing;

    const promise = new Promise<AudioBuffer>((resolve, reject) => {
      this.loader.load(
        url,
        (buffer) => {
          this.bufferCache.set(url, buffer);
          this.loadingPromises.delete(url);
          resolve(buffer);
        },
        undefined,
        (err) => {
          console.warn(`[BackgroundMusic] Failed to load: ${url}`, err);
          this.loadingPromises.delete(url);
          reject(err);
        },
      );
    });

    this.loadingPromises.set(url, promise);

    try {
      return await promise;
    } catch {
      return null;
    }
  }

  // =====================================================
  // PERSISTENCE
  // =====================================================

  private loadPreference(): boolean {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored !== null ? stored === 'true' : true;
    } catch {
      return true;
    }
  }

  private savePreference(enabled: boolean): void {
    try {
      localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {
      /* ignore */
    }
  }
}
