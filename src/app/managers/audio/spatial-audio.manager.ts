import {
  PositionalAudio,
  AudioListener,
  AudioLoader,
  Scene,
  Camera,
  Vector3,
  Audio,
} from 'three';
import { AUDIO_LIMITS, SPATIAL_AUDIO_DEFAULTS } from '../../configs/audio.config';
import { GameEventBus } from '../../game-engine';
import { AudioBufferCache } from './audio-buffer-cache';
import { AudioPoolManager } from './audio-pool.manager';
import { SpatialAudioPlayback, RegisteredSound, SoundDebugEvent } from './spatial-audio-playback';
import { SpatialAudioLoops } from './spatial-audio-loops';
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
 * - AudioPoolManager: PositionalAudio lifecycle and panner updates
 * - SpatialAudioPlayback: playAt, playAtGeo, playGlobal, one-shot management
 * - SpatialAudioLoops: looping sounds by handle, paused out of range
 * - EnemySoundBudget: cap on audible enemy sounds
 *
 * This class handles: the master bus, sound registration, master volume,
 * context recovery and EventBus wiring.
 */
export class SpatialAudioManager {
  private pool: AudioPoolManager;
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
    preGain.gain.setValueAtTime(0.6, ctx.currentTime); // -4.4 dB headroom
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

    this.pool = new AudioPoolManager(listener, scene);
    this.bufferCache = new AudioBufferCache(loader);
    this.playback = new SpatialAudioPlayback(this.pool, this.sounds, camera);
    this.loops = new SpatialAudioLoops(this.pool, this.playback, this.sounds, this.enemyBudget);
  }

  // ─── Geo converter ───────────────────────────────────────

  setGeoToLocal(fn: (lat: number, lon: number, height: number) => Vector3): void {
    this.playback.setGeoToLocal(fn);
  }

  geoToLocalPosition(lat: number, lon: number, height: number): Vector3 | null {
    return this.playback.geoToLocalPosition(lat, lon, height);
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

  // ─── Debug ───────────────────────────────────────────────

  debugLogActiveSounds(): void {
    const enemy = this.enemyBudget.stats();
    console.log('[SpatialAudio] Active sounds:', {
      oneShots: this.playback.getActiveSounds().map(s => s.soundId),
      loops: this.loops.describe(),
      enemyBudget: `${enemy.current}/${enemy.max}`,
      projectileBudget: `${this.playback.getProjectileSoundStats().current}/${AUDIO_LIMITS.maxProjectileSounds}`,
      poolAvailable: 0,
    });
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
    return this.pool.getScene();
  }

  getListener(): AudioListener {
    return this.pool.getListener();
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

  async playAt(soundId: string, position: Vector3, volumeMultiplier = 1.0): Promise<PositionalAudio | null> {
    return this.playback.playAt(soundId, position, volumeMultiplier);
  }

  async playAtGeo(soundId: string, lat: number, lon: number, height: number, volumeMultiplier = 1.0): Promise<PositionalAudio | null> {
    return this.playback.playAtGeo(soundId, lat, lon, height, volumeMultiplier);
  }

  async playGlobal(soundId: string, volumeMultiplier = 1.0): Promise<Audio | null> {
    return this.playback.playGlobal(soundId, volumeMultiplier);
  }

  // ─── Loop management (delegated) ────────────────────────

  async createLoop(
    soundId: string,
    position: Vector3,
    config?: { volumeMultiplier?: number; randomStart?: boolean }
  ): Promise<string | null> {
    return this.loops.create(soundId, position, config);
  }

  updateLoopPosition(handle: string, position: Vector3): void {
    this.loops.updatePosition(handle, position);
  }

  pauseLoop(handle: string): void {
    this.loops.pause(handle);
  }

  resumeLoop(handle: string): boolean {
    return this.loops.resume(handle);
  }

  stopLoop(handle: string): void {
    this.loops.stop(handle);
  }

  isLoopPaused(handle: string): boolean {
    return this.loops.isPaused(handle);
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
    const listener = this.pool.getListener();
    if (listener.parent) {
      listener.parent.remove(listener);
    }
    this.sounds.clear();
  }
}
