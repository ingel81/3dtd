import * as THREE from 'three';
import { AUDIO_LIMITS, ENEMY_SOUND_PATTERNS, SPATIAL_AUDIO_DEFAULTS } from '../configs/audio.config';

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
 * Registered sound definition
 */
interface RegisteredSound {
  buffer: AudioBuffer | null;
  config: Required<SpatialSoundConfig>;
  loading: Promise<AudioBuffer> | null;
}

/**
 * Active sound instance
 */
interface ActiveSound {
  audio: THREE.PositionalAudio;
  soundId: string;
  container?: THREE.Object3D;
  ownerId?: string; // ID of the owner (e.g., enemy ID)
  timer?: ReturnType<typeof setTimeout>; // Cleanup timer for non-looping sounds
}

// Sound budget uses centralized config from audio.config.ts

/**
 * SpatialAudioManager - 3D positioned audio using Three.js Audio system
 *
 * Features:
 * - Distance-based volume (natural falloff, no hard cutoff)
 * - Stereo panning based on position relative to camera
 * - Efficient buffer caching and reuse
 * - Pool of PositionalAudio objects for performance
 *
 * Usage:
 *   manager.registerSound('arrow', '/assets/sounds/arrow.mp3', { refDistance: 30 });
 *   manager.playAt('arrow', position); // THREE.Vector3
 *   manager.playAtGeo('arrow', lat, lon, height); // Geographic coords
 */
export class SpatialAudioManager {
  private listener: THREE.AudioListener;
  private loader: THREE.AudioLoader;
  private scene: THREE.Scene;

  // Registered sounds (id -> buffer + config)
  private sounds = new Map<string, RegisteredSound>();

  // URL to buffer cache (shared across all sound IDs with same URL)
  private bufferCache = new Map<string, { buffer: AudioBuffer | null; loading: Promise<AudioBuffer> | null }>();

  // Active sound instances
  private activeSounds: ActiveSound[] = [];

  // Track enemy sounds separately for budget management
  private enemySoundCount = 0;

  // Audio context state
  private contextResumed = false;

  // Coordinate converter (set by engine)
  private geoToLocal: ((lat: number, lon: number, height: number) => THREE.Vector3) | null = null;

  // PositionalAudio pool for performance
  private audioPool: THREE.PositionalAudio[] = [];
  private readonly INITIAL_POOL_SIZE = 20;
  private readonly MAX_POOL_SIZE = 50;

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    this.scene = scene;

    // Create audio listener and attach to camera
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);

    // Create audio loader
    this.loader = new THREE.AudioLoader();

    // Pre-create initial pool of PositionalAudio objects
    for (let i = 0; i < this.INITIAL_POOL_SIZE; i++) {
      this.audioPool.push(new THREE.PositionalAudio(this.listener));
    }
  }

  /**
   * Get a PositionalAudio object from the pool (or create new if pool is empty)
   */
  private getAudioFromPool(): THREE.PositionalAudio {
    if (this.audioPool.length > 0) {
      return this.audioPool.pop()!;
    }
    // Pool exhausted - create new audio object
    return new THREE.PositionalAudio(this.listener);
  }

  /**
   * Return a PositionalAudio object to the pool for reuse
   */
  private returnAudioToPool(audio: THREE.PositionalAudio): void {
    // Reset audio state before returning to pool
    if (audio.isPlaying) {
      audio.stop();
    }
    audio.disconnect();

    // Only return to pool if we haven't exceeded max size
    if (this.audioPool.length < this.MAX_POOL_SIZE) {
      this.audioPool.push(audio);
    }
    // If pool is full, let it be garbage collected
  }

  /**
   * Set the geo-to-local coordinate converter
   * Must be called before using playAtGeo()
   */
  setGeoToLocal(fn: (lat: number, lon: number, height: number) => THREE.Vector3): void {
    this.geoToLocal = fn;
  }

  /**
   * Convert geo coordinates to local THREE.Vector3
   * Public method for use by AudioComponent
   */
  geoToLocalPosition(lat: number, lon: number, height: number): THREE.Vector3 | null {
    if (!this.geoToLocal) return null;
    return this.geoToLocal(lat, lon, height);
  }

  /**
   * Check if a sound ID is an enemy sound (subject to budget limits)
   * Public method for use by AudioComponent
   */
  isEnemySound(soundId: string): boolean {
    const lowerSoundId = soundId.toLowerCase();
    return ENEMY_SOUND_PATTERNS.some((pattern) => lowerSoundId.includes(pattern));
  }

  /**
   * Check if we can play a new enemy sound (within budget)
   * Call this before creating a new enemy loop sound
   */
  canPlayEnemySound(): boolean {
    return this.enemySoundCount < AUDIO_LIMITS.maxEnemySounds;
  }

  /**
   * Get current enemy sound count and limit for debugging
   */
  getEnemySoundStats(): { current: number; max: number } {
    return { current: this.enemySoundCount, max: AUDIO_LIMITS.maxEnemySounds };
  }

  /**
   * Get count of active sounds for debugging
   */
  getActiveSoundCount(): number {
    return this.activeSounds.length;
  }

  /**
   * Debug: Log all active sounds
   */
  debugLogActiveSounds(): void {
    // Debug method - no-op in production
  }

  /**
   * Register an enemy sound (called when AudioComponent starts a loop)
   * Returns false if budget exceeded
   */
  registerEnemySound(): boolean {
    if (this.enemySoundCount >= AUDIO_LIMITS.maxEnemySounds) {
      return false;
    }
    this.enemySoundCount++;
    return true;
  }

  /**
   * Unregister an enemy sound (called when AudioComponent stops a loop)
   */
  unregisterEnemySound(): void {
    if (this.enemySoundCount > 0) {
      this.enemySoundCount--;
    }
  }

  /**
   * Get the Three.js scene
   */
  getScene(): THREE.Scene {
    return this.scene;
  }

  /**
   * Resume audio context (required after user interaction)
   */
  async resumeContext(): Promise<void> {
    if (this.contextResumed) return;

    const context = this.listener.context;
    if (context.state === 'suspended') {
      await context.resume();
    }
    this.contextResumed = true;
  }

  /**
   * Register a sound for later playback
   * Uses URL-based caching to avoid reloading the same audio file
   */
  registerSound(id: string, url: string, config: SpatialSoundConfig = {}): void {
    const fullConfig = { ...DEFAULT_CONFIG, ...config };

    const sound: RegisteredSound = {
      buffer: null,
      config: fullConfig,
      loading: null,
    };

    this.sounds.set(id, sound);

    // Check if buffer is already cached or loading for this URL
    let cached = this.bufferCache.get(url);

    if (!cached) {
      // First time loading this URL - start loading and cache it
      cached = { buffer: null, loading: null };
      cached.loading = this.loadBuffer(url).then((buffer) => {
        cached!.buffer = buffer;
        cached!.loading = null;
        return buffer;
      });
      this.bufferCache.set(url, cached);
    }

    // Link this sound to the cached buffer
    if (cached.buffer) {
      // Already loaded
      sound.buffer = cached.buffer;
    } else if (cached.loading) {
      // Still loading - wait for it
      sound.loading = cached.loading.then((buffer) => {
        sound.buffer = buffer;
        sound.loading = null;
        return buffer;
      });
    }
  }

  /**
   * Load an audio buffer with retry logic
   */
  private loadBuffer(url: string, retries = 3): Promise<AudioBuffer> {
    return new Promise((resolve, reject) => {
      const attemptLoad = (attemptsLeft: number) => {
        this.loader.load(
          url,
          (buffer) => resolve(buffer),
          undefined,
          (error) => {
            if (attemptsLeft > 0) {
              console.warn(`[SpatialAudio] Failed to load ${url}, retrying... (${attemptsLeft} attempts left)`);
              setTimeout(() => attemptLoad(attemptsLeft - 1), 1000);
            } else {
              console.error('[SpatialAudio] Failed to load after all retries:', url, error);
              reject(error);
            }
          }
        );
      };
      attemptLoad(retries);
    });
  }

  /**
   * Get cached buffer for a registered sound
   * Returns null if not registered or not yet loaded
   */
  async getBuffer(soundId: string): Promise<AudioBuffer | null> {
    const sound = this.sounds.get(soundId);
    if (!sound) return null;

    // Wait for loading to complete if in progress
    if (sound.loading) {
      await sound.loading;
    }

    return sound.buffer;
  }

  /**
   * Get sound config for a registered sound
   */
  getSoundConfig(soundId: string): Required<SpatialSoundConfig> | null {
    return this.sounds.get(soundId)?.config ?? null;
  }

  /**
   * Play a sound at a 3D position (local coordinates)
   */
  async playAt(
    soundId: string,
    position: THREE.Vector3,
    volumeMultiplier = 1.0
  ): Promise<THREE.PositionalAudio | null> {
    const sound = this.sounds.get(soundId);
    if (!sound) {
      console.warn(`[SpatialAudio] Sound not registered: ${soundId}`);
      return null;
    }

    // Ensure context is resumed
    await this.resumeContext();

    // Wait for buffer if still loading
    if (sound.loading) {
      await sound.loading;
    }

    if (!sound.buffer) {
      console.warn(`[SpatialAudio] No buffer for: ${soundId}`);
      return null;
    }

    // Get positional audio from pool (or create new if pool exhausted)
    const audio = this.getAudioFromPool();
    audio.setBuffer(sound.buffer);
    audio.setRefDistance(sound.config.refDistance);
    audio.setRolloffFactor(sound.config.rolloffFactor);
    audio.setDistanceModel(sound.config.distanceModel);
    audio.setVolume(sound.config.volume * volumeMultiplier);
    audio.setLoop(sound.config.loop);

    if (sound.config.maxDistance > 0) {
      audio.setMaxDistance(sound.config.maxDistance);
    }

    // Create a container object at the position
    const container = new THREE.Object3D();
    container.position.copy(position);
    container.add(audio);
    this.scene.add(container);

    // Track active sound (with container reference)
    const activeSound: ActiveSound = { audio, soundId, container };
    this.activeSounds.push(activeSound);

    // Play
    audio.play();

    // Cleanup after playback (if not looping)
    if (!sound.config.loop) {
      const duration = sound.buffer.duration * 1000;
      const timer = setTimeout(() => {
        this.cleanupActiveSound(activeSound);
      }, duration + 100);
      activeSound.timer = timer;
    }

    return audio;
  }

  /**
   * Play a sound at geographic coordinates
   */
  async playAtGeo(
    soundId: string,
    lat: number,
    lon: number,
    height: number,
    volumeMultiplier = 1.0
  ): Promise<THREE.PositionalAudio | null> {
    if (!this.geoToLocal) {
      console.warn('[SpatialAudio] geoToLocal not set - use setGeoToLocal() first');
      return null;
    }

    const position = this.geoToLocal(lat, lon, height);
    return this.playAt(soundId, position, volumeMultiplier);
  }

  /**
   * Play a non-positional (global) sound
   * Uses regular THREE.Audio instead of PositionalAudio
   */
  async playGlobal(soundId: string, volumeMultiplier = 1.0): Promise<THREE.Audio | null> {
    const sound = this.sounds.get(soundId);
    if (!sound) {
      console.warn(`[SpatialAudio] Sound not registered: ${soundId}`);
      return null;
    }

    await this.resumeContext();

    if (sound.loading) {
      await sound.loading;
    }

    if (!sound.buffer) {
      return null;
    }

    const audio = new THREE.Audio(this.listener);
    audio.setBuffer(sound.buffer);
    audio.setVolume(sound.config.volume * volumeMultiplier);
    audio.setLoop(sound.config.loop);
    audio.play();

    // Note: Global sounds are not tracked in activeSounds since they don't have containers
    // They auto-cleanup after playback
    if (!sound.config.loop) {
      const duration = sound.buffer.duration * 1000;
      setTimeout(() => {
        audio.disconnect();
      }, duration + 100);
    }

    return audio;
  }

  /**
   * Stop all instances of a sound
   */
  stop(soundId: string): void {
    // Filter out matching sounds and cleanup remaining sounds (O(n) instead of O(n²))
    const remaining: ActiveSound[] = [];
    for (const active of this.activeSounds) {
      if (active.soundId === soundId) {
        this.cleanupActiveSound(active);
      } else {
        remaining.push(active);
      }
    }
    this.activeSounds = remaining;
  }

  /**
   * Stop all sounds
   */
  stopAll(): void {
    // Cleanup all active sounds properly
    for (const active of this.activeSounds) {
      this.cleanupActiveSound(active);
    }
    this.activeSounds = [];
  }

  /**
   * Check if a sound is currently playing
   */
  isPlaying(soundId: string): boolean {
    return this.activeSounds.some((s) => s.soundId === soundId && s.audio.isPlaying);
  }

  /**
   * Get listener for external access
   */
  getListener(): THREE.AudioListener {
    return this.listener;
  }

  /**
   * Cleanup an active sound (stop, disconnect, remove from scene, clear timer, return to pool)
   */
  private cleanupActiveSound(active: ActiveSound): void {
    // Clear timer if exists
    if (active.timer) {
      clearTimeout(active.timer);
      active.timer = undefined;
    }

    // Return audio to pool (handles stop and disconnect internally)
    this.returnAudioToPool(active.audio);

    // Remove container from scene
    if (active.container) {
      this.scene.remove(active.container);
    }
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.stopAll();

    // Remove listener from camera
    if (this.listener.parent) {
      this.listener.parent.remove(this.listener);
    }

    this.sounds.clear();
  }
}
