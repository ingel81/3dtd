import {
  PositionalAudio,
  AudioListener,
  AudioLoader,
  Scene,
  Camera,
  Vector3,
  Audio,
} from 'three';
import { AUDIO_LIMITS, MASTER_BUS_PRE_GAIN, SPATIAL_AUDIO_DEFAULTS } from '../../configs/audio.config';
import { GameEventBus } from '../../game-engine';
import { AudioBufferCache } from './audio-buffer-cache';
import { PositionalVoiceFactory } from './positional-voice-factory';
import { SpatialAudioPlayback, RegisteredSound, SoundDebugEvent } from './spatial-audio-playback';
import { SpatialAudioLoops, type LoopHandle } from './spatial-audio-loops';
import { EnemySoundBudget, isEnemySoundId } from './enemy-sound-budget';

export type { SoundDebugEvent };

/**
 * Sound configuration
 */
export interface SpatialSoundConfig {
  /** Reference distance - sound is at full volume at this distance (meters) */
  refDistance?: number;
  /** Rolloff factor - how fast sound fades with distance (higher = faster fade) */
  rolloffFactor?: number;
  /** Maximum distance - sound is silent beyond this (0 = no max) */
  maxDistance?: number;
  /** Distance model: 'linear' | 'inverse' | 'exponential' */
  distanceModel?: 'linear' | 'inverse' | 'exponential';
  /** Base volume (0-1) */
  volume?: number;
  /** Loop the sound */
  loop?: boolean;
  /**
   * Anti-flood window for this sound (ms). Triggers within the window
   * are dropped. Default: heuristic from buffer duration (5%, clamped
   * to 10–80 ms).
   */
  minIntervalMs?: number;
  /**
   * Polyphony cap: max concurrent instances of this sound. Default:
   * heuristic from buffer duration (short=8, medium=4, long=2).
   */
  maxInstances?: number;
  /**
   * Kept when every one-shot voice is busy: voice stealing takes the oldest
   * one-shot without priority, one with it only when all have it. For the
   * few sounds a moment rests on (the nuclear strike). Default false.
   */
  priority?: boolean;
  /**
   * A one-shot of this sound further from the listener than this (m) is not
   * played. Default AUDIO_LIMITS.maxAudibleDistance; loops keep that one.
   */
  audibleDistance?: number;
  /**
   * A feedback cue rather than a sound of the fight (the kill gold): while
   * the listener is close to the ground, in a manned tower
   * (setFeedbackMinDistance), it is heard as from at least that far off
   * instead of at full volume. Default false.
   */
  feedback?: boolean;
}

const DEFAULT_CONFIG: Required<SpatialSoundConfig> = {
  refDistance: SPATIAL_AUDIO_DEFAULTS.refDistance,
  rolloffFactor: SPATIAL_AUDIO_DEFAULTS.rolloffFactor,
  maxDistance: SPATIAL_AUDIO_DEFAULTS.maxDistance,
  distanceModel: SPATIAL_AUDIO_DEFAULTS.distanceModel,
  volume: SPATIAL_AUDIO_DEFAULTS.volume,
  loop: SPATIAL_AUDIO_DEFAULTS.loop,
  // -1 sentinel: derive from buffer duration at play time.
  minIntervalMs: -1,
  maxInstances: -1,
  priority: false,
  audibleDistance: AUDIO_LIMITS.maxAudibleDistance,
  feedback: false,
};

/**
 * Sound pool statistics for debugging
 */
export interface SoundPoolStats {
  poolAvailable: number;
  poolMax: number;
  activeOneShots: number;
  activeLoops: number;
  enemyBudget: { current: number; max: number };
  projectileBudget: { current: number; max: number };
  cachedBuffers: number;
}

/**
 * SpatialAudioManager - 3D positioned audio using Three.js Audio system
 *
 * Facade that delegates to:
 * - AudioBufferCache: LRU buffer caching and loading
 * - PositionalVoiceFactory: PositionalAudio lifecycle and panner updates
 * - SpatialAudioPlayback: playAt, playAtGeo, playGlobal, one-shot management
 * - SpatialAudioLoops: looping sounds by handle, paused out of range
 * - EnemySoundBudget: cap on audible enemy sounds
 *
 * This class handles: the master bus, sound registration, master volume,
 * context recovery and EventBus wiring.
 */
export class SpatialAudioManager {
  private voices: PositionalVoiceFactory;
  private bufferCache: AudioBufferCache;
  private playback: SpatialAudioPlayback;
  private loops: SpatialAudioLoops;
  private readonly enemyBudget = new EnemySoundBudget();

  // Registered sounds (id -> buffer + config)
  private sounds = new Map<string, RegisteredSound>();

  // Master SFX volume (0-1)
  private _masterVolume = 1.0;

  /** Document listener from the constructor, removed again in dispose(). */
  private readonly onVisibilityChange: () => void;

  constructor(scene: Scene, camera: Camera) {
    // Create audio listener and attach to camera
    const listener = new AudioListener();
    camera.add(listener);

    // Master bus: listener.gain → preGain → limiter → destination
    //
    // Three.js wires listener.gain directly to destination, so simultaneous
    // sounds sum past ±1.0 and Web Audio hard-clips into harsh distortion.
    // The pre-gain leaves headroom for polyphony; the compressor acts as a
    // soft limiter that tames residual peaks without pumping perceptibly.
    const ctx = listener.context;
    const preGain = ctx.createGain();
    preGain.gain.setValueAtTime(MASTER_BUS_PRE_GAIN, ctx.currentTime);
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.setValueAtTime(-6, ctx.currentTime);
    limiter.knee.setValueAtTime(6, ctx.currentTime);
    limiter.ratio.setValueAtTime(12, ctx.currentTime);
    limiter.attack.setValueAtTime(0.001, ctx.currentTime);
    limiter.release.setValueAtTime(0.1, ctx.currentTime);
    listener.gain.disconnect();
    listener.gain.connect(preGain);
    preGain.connect(limiter);
    limiter.connect(ctx.destination);

    // Recover from browser-side context suspension (tab-switch, audio focus
    // loss, idle policies). Three.js' single resumeContext() is a one-shot —
    // if the context is suspended *again* later, no playback wakes it up.
    // visibilitychange fires when the tab comes back, document.click as a
    // last-resort if user gesture is required to resume.
    const tryResume = () => {
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => { /* user gesture required, try again later */ });
      }
    };
    this.onVisibilityChange = () => {
      if (!document.hidden) {
        tryResume();
        // Drop any active one-shots that the browser cleared while the tab
        // was throttled. Their setTimeout cleanup may not have fired in
        // time (background-tab throttling caps timers at ~1Hz), so the
        // active list and counters can be stale on return. Revalidating
        // here avoids playing into a saturated bookkeeping state.
        this.revalidateActiveSounds();
      }
    };
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    const loader = new AudioLoader();

    this.voices = new PositionalVoiceFactory(listener, scene);
    this.bufferCache = new AudioBufferCache(loader);
    this.playback = new SpatialAudioPlayback(this.voices, this.sounds, camera);
    this.loops = new SpatialAudioLoops(this.voices, this.playback, this.sounds, this.enemyBudget);
  }

  // ─── Geo converter ───────────────────────────────────────

  /** `fn` writes the local position into `target` and returns it. */
  setGeoToLocal(fn: (lat: number, lon: number, height: number, target: Vector3) => Vector3): void {
    this.playback.setGeoToLocal(fn);
  }

  /** Into `target` when given (a caller that runs every sub-step), else a new vector. */
  geoToLocalPosition(lat: number, lon: number, height: number, target?: Vector3): Vector3 | null {
    return this.playback.geoToLocalPosition(lat, lon, height, target);
  }

  // ─── Distance helpers ────────────────────────────────────

  isWithinAudibleDistance(position: Vector3): boolean {
    return this.playback.isWithinAudibleDistance(position);
  }

  getDistanceToCamera(position: Vector3): number {
    return this.playback.getDistanceToCamera(position);
  }

  // ─── Enemy sound budget ──────────────────────────────────

  isEnemySound(soundId: string): boolean {
    return isEnemySoundId(soundId);
  }

  canPlayEnemySound(): boolean {
    return this.enemyBudget.canReserve();
  }

  getEnemySoundStats(): { current: number; max: number } {
    return this.enemyBudget.stats();
  }

  registerEnemySound(): boolean {
    return this.enemyBudget.reserve();
  }

  unregisterEnemySound(): void {
    this.enemyBudget.release();
  }

  // ─── Projectile helpers ──────────────────────────────────

  isProjectileSound(soundId: string): boolean {
    return this.playback.isProjectileSound(soundId);
  }

  getProjectileSoundStats(): { current: number; max: number } {
    return this.playback.getProjectileSoundStats();
  }

  // ─── Active sound counts ─────────────────────────────────

  getActiveSoundCount(): number {
    return this.playback.getActiveSoundCount() + this.loops.size;
  }

  setEventBus(eventBus: GameEventBus): void {
    this.playback.setEventBus(eventBus);
  }

  getSoundPoolStats(): SoundPoolStats {
    const projStats = this.playback.getProjectileSoundStats();
    return {
      poolAvailable: 0,
      poolMax: 0,
      activeOneShots: this.playback.getActiveSoundCount(),
      activeLoops: this.loops.size,
      enemyBudget: this.enemyBudget.stats(),
      projectileBudget: {
        current: projStats.current,
        max: projStats.max,
      },
      cachedBuffers: this.bufferCache.size,
    };
  }

  // ─── Scene / Listener access ─────────────────────────────

  getScene(): Scene {
    return this.voices.getScene();
  }

  getListener(): AudioListener {
    return this.voices.getListener();
  }

  // ─── Audio context ───────────────────────────────────────

  async resumeContext(): Promise<void> {
    await this.playback.resumeContext();
  }

  // ─── Master volume ─────────────────────────────────────

  get masterVolume(): number {
    return this._masterVolume;
  }

  /** Set master SFX volume (0-1). Updates active loops immediately. */
  setMasterVolume(vol: number): void {
    this._masterVolume = Math.max(0, Math.min(1, vol));
    this.playback.setMasterVolume(this._masterVolume);
    this.loops.setMasterVolume(this._masterVolume);
  }

  /** Game speed: one-shots thin out with it (SpatialAudioPlayback.setTimescale). */
  setTimescale(scale: number): void {
    this.playback.setTimescale(scale);
  }

  /**
   * Feedback cues (SpatialSoundConfig.feedback) sound as from at least
   * `meters` off, 0 for their real distance. Set while the player sits in a
   * tower (TowerControlService): the camera is a few metres over the kills,
   * where it looks down from hundreds otherwise.
   */
  setFeedbackMinDistance(meters: number): void {
    this.playback.setFeedbackMinDistance(meters);
  }

  // ─── Sound registration ──────────────────────────────────

  registerSound(id: string, url: string, config: SpatialSoundConfig = {}): void {
    const fullConfig = { ...DEFAULT_CONFIG, ...config };

    const sound: RegisteredSound = {
      buffer: null,
      config: fullConfig,
      loading: null,
    };

    this.sounds.set(id, sound);

    const cached = this.bufferCache.getOrLoad(url);

    if (cached.buffer) {
      sound.buffer = cached.buffer;
    } else if (cached.loading) {
      // A file that failed all retries loads as null and leaves the sound
      // without a buffer; every player of it treats that as "cannot play".
      sound.loading = cached.loading.then((buffer) => {
        sound.buffer = buffer;
        sound.loading = null;
        return buffer;
      });
    }
  }

  async getBuffer(soundId: string): Promise<AudioBuffer | null> {
    const sound = this.sounds.get(soundId);
    if (!sound) return null;
    if (sound.loading) {
      await sound.loading;
    }
    return sound.buffer;
  }

  getSoundConfig(soundId: string): Required<SpatialSoundConfig> | null {
    return this.sounds.get(soundId)?.config ?? null;
  }

  // ─── One-shot playback (delegated) ──────────────────────

  /** `playbackRate` above 1 plays the sample faster and higher, below 1 slower and lower. */
  async playAt(soundId: string, position: Vector3, volumeMultiplier = 1.0, playbackRate = 1): Promise<PositionalAudio | null> {
    return this.playback.playAt(soundId, position, volumeMultiplier, playbackRate);
  }

  /** Stop the one-shot `audio` (what playAt gave) now; nothing if it is over already. */
  stopOneShot(audio: PositionalAudio): void {
    this.playback.stopOneShot(audio);
  }

  async playAtGeo(soundId: string, lat: number, lon: number, height: number, volumeMultiplier = 1.0): Promise<PositionalAudio | null> {
    return this.playback.playAtGeo(soundId, lat, lon, height, volumeMultiplier);
  }

  /** A one-shot at the listener: no direction, the limits of playAt (SpatialAudioPlayback.playAtListener). */
  async playAtListener(soundId: string, volumeMultiplier = 1.0): Promise<PositionalAudio | null> {
    return this.playback.playAtListener(soundId, volumeMultiplier);
  }

  async playGlobal(soundId: string, volumeMultiplier = 1.0): Promise<Audio | null> {
    return this.playback.playGlobal(soundId, volumeMultiplier);
  }

  /** A UI cue, at the UI volume (setUiVolume). */
  async playUi(soundId: string, volumeMultiplier = 1.0): Promise<Audio | null> {
    return this.playback.playUi(soundId, volumeMultiplier);
  }

  /** Volume of the UI cues (0-1), apart from the sound effects'. */
  setUiVolume(vol: number): void {
    this.playback.setUiVolume(vol);
  }

  // ─── Loop management (delegated) ────────────────────────

  async createLoop(
    soundId: string,
    position: Vector3,
    config?: { volumeMultiplier?: number; randomStart?: boolean }
  ): Promise<LoopHandle | null> {
    return this.loops.create(soundId, position, config);
  }

  /** Move a loop, see SpatialAudioLoops.updatePosition; true while it plays. */
  updateLoopPosition(handle: LoopHandle, position: Vector3): boolean {
    return this.loops.updatePosition(handle, position);
  }

  pauseLoop(handle: LoopHandle): void {
    this.loops.pause(handle);
  }

  resumeLoop(handle: LoopHandle): boolean {
    return this.loops.resume(handle);
  }

  stopLoop(handle: LoopHandle): void {
    this.loops.stop(handle);
  }

  /** Loop `handle` at `volumeMultiplier` times its sound's volume from now on, see SpatialAudioLoops.setVolume(). */
  setLoopVolume(handle: LoopHandle, volumeMultiplier: number): void {
    this.loops.setVolume(handle, volumeMultiplier);
  }

  isLoopPaused(handle: LoopHandle): boolean {
    return this.loops.isPaused(handle);
  }

  /** Enemy loop slots to the nearest enemies, throttled (SpatialAudioLoops.rebalanceEnemyLoops). */
  rebalanceEnemyLoops(nowMs = performance.now()): void {
    this.loops.rebalanceEnemyLoops(nowMs);
  }

  /** The game paused (true) or went on: every loop stands with it, see SpatialAudioLoops.hold(). */
  holdLoops(held: boolean): void {
    this.loops.hold(held);
  }

  // ─── Stop / cleanup ─────────────────────────────────────

  stop(soundId: string): void {
    this.playback.stop(soundId);
  }

  stopAll(): void {
    this.playback.stopAllOneShots();
    this.loops.stopAll();
  }

  /** Drop active one-shots that already finished playing (used on tab return). */
  revalidateActiveSounds(): void {
    this.playback.revalidateActiveSounds();
  }

  isPlaying(soundId: string): boolean {
    return this.playback.isPlaying(soundId);
  }

  // ─── Dispose ─────────────────────────────────────────────

  dispose(): void {
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.stopAll();
    const listener = this.voices.getListener();
    if (listener.parent) {
      listener.parent.remove(listener);
    }
    this.sounds.clear();
  }
}
