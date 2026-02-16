import {
  PositionalAudio,
  AudioListener,
  AudioLoader,
  Scene,
  Camera,
  Object3D,
  Vector3,
  Audio,
} from 'three';
import { AUDIO_LIMITS, ENEMY_SOUND_PATTERNS, SPATIAL_AUDIO_DEFAULTS } from '../../configs/audio.config';
import { GameEventBus } from '../../game-engine';
import { AudioBufferCache } from './audio-buffer-cache';
import { AudioPoolManager } from './audio-pool.manager';
import { SpatialAudioPlayback, RegisteredSound, SoundDebugEvent } from './spatial-audio-playback';

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
}

const DEFAULT_CONFIG: Required<SpatialSoundConfig> = {
  refDistance: SPATIAL_AUDIO_DEFAULTS.refDistance,
  rolloffFactor: SPATIAL_AUDIO_DEFAULTS.rolloffFactor,
  maxDistance: SPATIAL_AUDIO_DEFAULTS.maxDistance,
  distanceModel: SPATIAL_AUDIO_DEFAULTS.distanceModel,
  volume: SPATIAL_AUDIO_DEFAULTS.volume,
  loop: SPATIAL_AUDIO_DEFAULTS.loop,
};

/**
 * Active looping sound (managed centrally)
 */
interface ActiveLoop {
  handle: string;
  soundId: string;
  audio: PositionalAudio;
  container: Object3D;
  isEnemySound: boolean;
  paused: boolean;
  baseVolume: number;
}

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
 *
 * This class handles: sound registration, loops, enemy budget, EventBus wiring.
 */
export class SpatialAudioManager {
  private pool: AudioPoolManager;
  private bufferCache: AudioBufferCache;
  private playback: SpatialAudioPlayback;

  // Registered sounds (id -> buffer + config)
  private sounds = new Map<string, RegisteredSound>();

  // Active looping sounds
  private activeLoops = new Map<string, ActiveLoop>();
  private loopHandleCounter = 0;

  // Master SFX volume (0-1)
  private _masterVolume = 1.0;

  // Enemy sound budget
  private enemySoundCount = 0;

  constructor(scene: Scene, camera: Camera) {
    // Create audio listener and attach to camera
    const listener = new AudioListener();
    camera.add(listener);

    const loader = new AudioLoader();

    this.pool = new AudioPoolManager(listener, scene);
    this.bufferCache = new AudioBufferCache(loader);
    this.playback = new SpatialAudioPlayback(this.pool, this.sounds, camera);
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
    const lowerSoundId = soundId.toLowerCase();
    return ENEMY_SOUND_PATTERNS.some((pattern) => lowerSoundId.includes(pattern));
  }

  canPlayEnemySound(): boolean {
    return this.enemySoundCount < AUDIO_LIMITS.maxEnemySounds;
  }

  getEnemySoundStats(): { current: number; max: number } {
    return { current: this.enemySoundCount, max: AUDIO_LIMITS.maxEnemySounds };
  }

  registerEnemySound(): boolean {
    if (this.enemySoundCount >= AUDIO_LIMITS.maxEnemySounds) {
      return false;
    }
    this.enemySoundCount++;
    return true;
  }

  unregisterEnemySound(): void {
    if (this.enemySoundCount > 0) {
      this.enemySoundCount--;
    }
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
    return this.playback.getActiveSoundCount() + this.activeLoops.size;
  }

  // ─── Debug ───────────────────────────────────────────────

  debugLogActiveSounds(): void {
    console.log('[SpatialAudio] Active sounds:', {
      oneShots: this.playback.getActiveSounds().map(s => s.soundId),
      loops: Array.from(this.activeLoops.values()).map(l => ({ id: l.soundId, paused: l.paused })),
      enemyBudget: `${this.enemySoundCount}/${AUDIO_LIMITS.maxEnemySounds}`,
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
      activeLoops: this.activeLoops.size,
      enemyBudget: {
        current: this.enemySoundCount,
        max: AUDIO_LIMITS.maxEnemySounds,
      },
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
    // Update active loops
    for (const loop of this.activeLoops.values()) {
      if (!loop.paused) {
        loop.audio.setVolume(loop.baseVolume * this._masterVolume);
      }
    }
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

  // ─── Loop management ────────────────────────────────────

  async createLoop(
    soundId: string,
    position: Vector3,
    config?: { volumeMultiplier?: number; randomStart?: boolean }
  ): Promise<string | null> {
    const sound = this.sounds.get(soundId);
    if (!sound) {
      console.warn(`[SpatialAudio] Sound not registered: ${soundId}`);
      return null;
    }

    const isEnemySound = this.isEnemySound(soundId);
    if (isEnemySound) {
      if (!this.registerEnemySound()) {
        return null;
      }
    }

    if (!this.playback.isWithinAudibleDistance(position)) {
      if (isEnemySound) {
        this.unregisterEnemySound();
      }
      return null;
    }

    await this.playback.resumeContext();

    if (sound.loading) {
      await sound.loading;
    }
    if (!sound.buffer) {
      console.warn(`[SpatialAudio] No buffer for: ${soundId}`);
      if (isEnemySound) {
        this.unregisterEnemySound();
      }
      return null;
    }

    const audio = this.pool.createAudio();
    audio.setBuffer(sound.buffer);
    audio.setRefDistance(sound.config.refDistance);
    audio.setRolloffFactor(sound.config.rolloffFactor);
    audio.setDistanceModel(sound.config.distanceModel);
    const baseVolume = sound.config.volume * (config?.volumeMultiplier ?? 1.0);
    audio.setVolume(baseVolume * this._masterVolume);
    audio.setLoop(true);

    if (sound.config.maxDistance > 0) {
      audio.setMaxDistance(sound.config.maxDistance);
    }

    if (config?.randomStart && sound.buffer.duration > 0) {
      audio.offset = Math.random() * sound.buffer.duration;
    }

    const container = this.pool.createContainerAtPosition(audio, position);

    const handle = `loop_${++this.loopHandleCounter}`;

    const activeLoop: ActiveLoop = {
      handle,
      soundId,
      audio,
      container,
      isEnemySound,
      paused: false,
      baseVolume,
    };
    this.activeLoops.set(handle, activeLoop);

    audio.play();

    return handle;
  }

  updateLoopPosition(handle: string, position: Vector3): void {
    const loop = this.activeLoops.get(handle);
    if (!loop) return;

    loop.container.position.copy(position);

    const isInRange = this.playback.isWithinAudibleDistance(position);

    if (!isInRange && !loop.paused) {
      this.pauseLoopInternal(loop);
    } else if (isInRange && loop.paused) {
      this.resumeLoopInternal(loop);
    }
  }

  pauseLoop(handle: string): void {
    const loop = this.activeLoops.get(handle);
    if (loop && !loop.paused) {
      this.pauseLoopInternal(loop);
    }
  }

  resumeLoop(handle: string): boolean {
    const loop = this.activeLoops.get(handle);
    if (!loop || !loop.paused) return true;
    return this.resumeLoopInternal(loop);
  }

  stopLoop(handle: string): void {
    const loop = this.activeLoops.get(handle);
    if (!loop) return;

    if (loop.isEnemySound && !loop.paused) {
      this.unregisterEnemySound();
    }

    this.pool.cleanupAudio(loop.audio);
    this.pool.removeContainer(loop.container);
    this.activeLoops.delete(handle);
  }

  isLoopPaused(handle: string): boolean {
    return this.activeLoops.get(handle)?.paused ?? false;
  }

  private pauseLoopInternal(loop: ActiveLoop): void {
    try {
      loop.audio.pause();
      loop.paused = true;
      if (loop.isEnemySound) {
        this.unregisterEnemySound();
      }
    } catch (e) {
      console.warn(`[SpatialAudio] pauseLoop failed:`, e);
    }
  }

  private resumeLoopInternal(loop: ActiveLoop): boolean {
    if (loop.isEnemySound) {
      if (!this.registerEnemySound()) {
        return false;
      }
    }

    try {
      loop.container.updateMatrixWorld(true);
      this.pool.updatePannerPosition(loop.audio);

      loop.audio.play();
      loop.paused = false;
      return true;
    } catch (e) {
      console.warn(`[SpatialAudio] resumeLoop failed:`, e);
      if (loop.isEnemySound) {
        this.unregisterEnemySound();
      }
      return false;
    }
  }

  // ─── Stop / cleanup ─────────────────────────────────────

  stop(soundId: string): void {
    this.playback.stop(soundId);
  }

  stopAll(): void {
    this.playback.stopAllOneShots();
    const loopHandles = Array.from(this.activeLoops.keys());
    for (const handle of loopHandles) {
      this.stopLoop(handle);
    }
  }

  isPlaying(soundId: string): boolean {
    return this.playback.isPlaying(soundId);
  }

  // ─── Dispose ─────────────────────────────────────────────

  dispose(): void {
    this.stopAll();
    const listener = this.pool.getListener();
    if (listener.parent) {
      listener.parent.remove(listener);
    }
    this.sounds.clear();
  }
}
