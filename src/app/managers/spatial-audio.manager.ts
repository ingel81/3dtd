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
import { AUDIO_LIMITS, ENEMY_SOUND_PATTERNS, PROJECTILE_SOUND_IDS, SPATIAL_AUDIO_DEFAULTS } from '../configs/audio.config';
import { GameEventBus } from '../game-engine';

/** Reusable Vector3 for distance calculations (avoid GC pressure) */
const _tempVec3 = new Vector3();

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
 * Active sound instance (one-shot)
 */
interface ActiveSound {
  audio: PositionalAudio;
  soundId: string;
  container?: Object3D;
  ownerId?: string; // ID of the owner (e.g., enemy ID)
  timer?: ReturnType<typeof setTimeout>; // Cleanup timer for non-looping sounds
  isProjectileSound?: boolean; // Track for budget management
}

/**
 * Active looping sound (managed centrally)
 */
interface ActiveLoop {
  handle: string;           // Unique ID for this loop instance
  soundId: string;          // Registered sound ID
  audio: PositionalAudio;
  container: Object3D;
  isEnemySound: boolean;
  paused: boolean;
}

// Sound budget uses centralized config from audio.config.ts

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
 * Debug event for sound system monitoring
 */
export interface SoundDebugEvent {
  type: 'play' | 'stop' | 'budget_exceeded' | 'pool_exhausted' | 'distance_culled';
  soundId: string;
  timestamp: number;
  details?: string;
}

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
 *   manager.playAt('arrow', position); // Vector3
 *   manager.playAtGeo('arrow', lat, lon, height); // Geographic coords
 */
export class SpatialAudioManager {
  private listener: AudioListener;
  private loader: AudioLoader;
  private scene: Scene;
  private camera: Camera;

  // Registered sounds (id -> buffer + config)
  private sounds = new Map<string, RegisteredSound>();

  // URL to buffer cache with LRU eviction (shared across all sound IDs with same URL)
  private bufferCache = new Map<string, { buffer: AudioBuffer | null; loading: Promise<AudioBuffer> | null }>();
  private bufferAccessOrder: string[] = []; // LRU tracking: oldest first
  private readonly MAX_CACHED_BUFFERS = 50;  // Buffer cache limit (generous - buffers are shared)

  // Active sound instances (one-shots)
  private activeSounds: ActiveSound[] = [];

  // Active looping sounds (managed centrally)
  private activeLoops = new Map<string, ActiveLoop>();
  private loopHandleCounter = 0;

  // Track enemy sounds separately for budget management
  private enemySoundCount = 0;

  // Track projectile sounds for budget management
  private projectileSoundCount = 0;

  // Event bus for debug events (optional - set via setEventBus)
  private eventBus: GameEventBus | null = null;

  // Audio context state
  private contextResumed = false;

  // Coordinate converter (set by engine)
  private geoToLocal: ((lat: number, lon: number, height: number) => Vector3) | null = null;

  // PositionalAudio pool for performance
  private audioPool: PositionalAudio[] = [];
  private readonly INITIAL_POOL_SIZE = 20;
  private readonly MAX_POOL_SIZE = 50;

  constructor(scene: Scene, camera: Camera) {
    this.scene = scene;
    this.camera = camera;

    // Create audio listener and attach to camera
    this.listener = new AudioListener();
    camera.add(this.listener);

    // Create audio loader
    this.loader = new AudioLoader();

    // Pre-create initial pool of PositionalAudio objects
    for (let i = 0; i < this.INITIAL_POOL_SIZE; i++) {
      this.audioPool.push(new PositionalAudio(this.listener));
    }
  }

  /**
   * Get a PositionalAudio object from the pool (or create new if pool is empty)
   *
   * NOTE: PositionalAudio pooling is DISABLED because Three.js Audio objects
   * don't properly support reuse after play/stop cycles. The internal WebAudio
   * node connections can get into inconsistent states.
   *
   * Instead, we always create fresh PositionalAudio objects (they're lightweight)
   * and properly disconnect+cleanup when done.
   */
  private getAudioFromPool(): PositionalAudio {
    // PositionalAudio objects don't reliably support reuse - always create fresh
    // The pool is kept for potential future optimization but not used
    return new PositionalAudio(this.listener);
  }

  /**
   * Clean up a PositionalAudio object after use
   *
   * NOTE: We don't actually pool PositionalAudio objects because they don't
   * reliably support reuse. This method just ensures proper cleanup.
   */
  private returnAudioToPool(audio: PositionalAudio): void {
    // Stop playback if still playing
    if (audio.isPlaying) {
      audio.stop();
    }

    // Detach from parent container
    if (audio.parent) {
      audio.parent.remove(audio);
    }

    // Disconnect WebAudio nodes for proper cleanup
    audio.disconnect();

    // Let garbage collector clean up the object
  }

  /**
   * Manually update panner position from audio's matrixWorld
   * This is needed because PositionalAudio.updateMatrixWorld() only updates
   * the panner when isPlaying=true, but we need the correct position BEFORE play()
   */
  private updatePannerPosition(audio: PositionalAudio): void {
    // Access internal panner and context (Three.js doesn't expose these publicly)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const panner = (audio as any).panner as PannerNode;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = (audio as any).context as AudioContext;

    if (!panner || !ctx) return;

    // Get world position from matrixWorld (which was just computed by updateMatrixWorld)
    _tempVec3.setFromMatrixPosition(audio.matrixWorld);

    // Set panner position
    panner.positionX.setValueAtTime(_tempVec3.x, ctx.currentTime);
    panner.positionY.setValueAtTime(_tempVec3.y, ctx.currentTime);
    panner.positionZ.setValueAtTime(_tempVec3.z, ctx.currentTime);
  }

  /**
   * Set the geo-to-local coordinate converter
   * Must be called before using playAtGeo()
   */
  setGeoToLocal(fn: (lat: number, lon: number, height: number) => Vector3): void {
    this.geoToLocal = fn;
  }

  /**
   * Convert geo coordinates to local Vector3
   * Public method for use by AudioComponent
   */
  geoToLocalPosition(lat: number, lon: number, height: number): Vector3 | null {
    if (!this.geoToLocal) return null;
    return this.geoToLocal(lat, lon, height);
  }

  /**
   * Check if a position is within audible distance from camera
   * Used for distance-based audio culling to save CPU
   */
  isWithinAudibleDistance(position: Vector3): boolean {
    this.camera.getWorldPosition(_tempVec3);
    const distance = _tempVec3.distanceTo(position);
    return distance <= AUDIO_LIMITS.maxAudibleDistance;
  }

  /**
   * Get distance from camera to a position
   */
  getDistanceToCamera(position: Vector3): number {
    this.camera.getWorldPosition(_tempVec3);
    return _tempVec3.distanceTo(position);
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
   * Get count of active sounds (one-shots + loops)
   */
  getActiveSoundCount(): number {
    return this.activeSounds.length + this.activeLoops.size;
  }

  /**
   * Debug: Log all active sounds
   */
  debugLogActiveSounds(): void {
    console.log('[SpatialAudio] Active sounds:', {
      oneShots: this.activeSounds.map(s => s.soundId),
      loops: Array.from(this.activeLoops.values()).map(l => ({ id: l.soundId, paused: l.paused })),
      enemyBudget: `${this.enemySoundCount}/${AUDIO_LIMITS.maxEnemySounds}`,
      projectileBudget: `${this.projectileSoundCount}/${AUDIO_LIMITS.maxProjectileSounds}`,
      poolAvailable: this.audioPool.length,
    });
  }

  /**
   * Set event bus for emitting debug events
   */
  setEventBus(eventBus: GameEventBus): void {
    this.eventBus = eventBus;
  }

  /**
   * Emit a debug event via EventBus
   */
  private emitDebug(type: SoundDebugEvent['type'], soundId: string, details?: string): void {
    if (this.eventBus) {
      this.eventBus.emitDeferred({
        type: 'debug:sound',
        eventType: type,
        soundId,
        timestamp: Date.now(),
        details,
      });
    }
  }

  /**
   * Check if a sound ID is a projectile sound
   */
  isProjectileSound(soundId: string): boolean {
    return (PROJECTILE_SOUND_IDS as readonly string[]).includes(soundId);
  }

  /**
   * Get comprehensive sound pool statistics
   */
  getSoundPoolStats(): SoundPoolStats {
    return {
      // Pool is disabled - always shows 0/0 (PositionalAudio objects don't support reliable reuse)
      poolAvailable: 0,
      poolMax: 0,
      activeOneShots: this.activeSounds.length,
      activeLoops: this.activeLoops.size,
      enemyBudget: {
        current: this.enemySoundCount,
        max: AUDIO_LIMITS.maxEnemySounds,
      },
      projectileBudget: {
        current: this.projectileSoundCount,
        max: AUDIO_LIMITS.maxProjectileSounds,
      },
      cachedBuffers: this.bufferCache.size,
    };
  }

  /**
   * Get projectile sound stats
   */
  getProjectileSoundStats(): { current: number; max: number } {
    return { current: this.projectileSoundCount, max: AUDIO_LIMITS.maxProjectileSounds };
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
  getScene(): Scene {
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
        // LRU: Evict old buffers after loading completes
        this.evictOldestBuffers();
        return buffer;
      });
      this.bufferCache.set(url, cached);
      // LRU: Track new URL in access order
      this.touchBuffer(url);
    } else {
      // LRU: Touch existing buffer (move to end)
      this.touchBuffer(url);
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
   * LRU: Touch a buffer (move to end of access order)
   */
  private touchBuffer(url: string): void {
    const idx = this.bufferAccessOrder.indexOf(url);
    if (idx !== -1) {
      this.bufferAccessOrder.splice(idx, 1);
    }
    this.bufferAccessOrder.push(url);
  }

  /**
   * LRU: Evict oldest buffers if cache exceeds limit
   */
  private evictOldestBuffers(): void {
    while (this.bufferAccessOrder.length > this.MAX_CACHED_BUFFERS) {
      const oldest = this.bufferAccessOrder.shift();
      if (oldest) {
        const cached = this.bufferCache.get(oldest);
        // Only evict if not currently loading
        if (cached && !cached.loading) {
          this.bufferCache.delete(oldest);
        } else if (cached?.loading) {
          // Put it back at the end - can't evict while loading
          this.bufferAccessOrder.push(oldest);
          break; // Avoid infinite loop
        }
      }
    }
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
    position: Vector3,
    volumeMultiplier = 1.0
  ): Promise<PositionalAudio | null> {
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

    // Distance-based culling: skip sounds that are too far away
    if (!this.isWithinAudibleDistance(position)) {
      const distance = this.getDistanceToCamera(position);
      this.emitDebug('distance_culled', soundId, `distance ${distance.toFixed(0)}m exceeds max ${AUDIO_LIMITS.maxAudibleDistance}m`);
      return null;
    }

    // Budget check for projectile sounds
    const isProjectile = this.isProjectileSound(soundId);
    if (isProjectile) {
      if (this.projectileSoundCount >= AUDIO_LIMITS.maxProjectileSounds) {
        this.emitDebug('budget_exceeded', soundId, `projectile budget ${this.projectileSoundCount}/${AUDIO_LIMITS.maxProjectileSounds}`);
        console.warn(`[SpatialAudio] Projectile sound budget exceeded for '${soundId}' (${this.projectileSoundCount}/${AUDIO_LIMITS.maxProjectileSounds})`);
        return null;
      }
      this.projectileSoundCount++;
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
    const container = new Object3D();
    container.position.copy(position);
    container.add(audio);
    this.scene.add(container);

    // CRITICAL: Force compute matrixWorld and update panner position BEFORE play()
    // Three.js PositionalAudio.updateMatrixWorld() only updates panner when isPlaying=true,
    // but we need the correct position BEFORE play() starts.
    // Without this, reused pool audio would play at the OLD position (potentially culled/silent)!
    container.updateMatrixWorld(true);
    this.updatePannerPosition(audio);

    // Track active sound (with container reference)
    const activeSound: ActiveSound = { audio, soundId, container, isProjectileSound: isProjectile };
    this.activeSounds.push(activeSound);

    // Play and emit debug event
    try {
      audio.play();
      // Debug: verify play actually started
      if (!audio.isPlaying) {
        console.warn(`[SpatialAudio] audio.play() called but isPlaying=false for '${soundId}'`);
        this.emitDebug('budget_exceeded', soundId, 'play() silent fail');
      } else {
        this.emitDebug('play', soundId, isProjectile ? 'projectile' : 'one-shot');
      }
    } catch (e) {
      console.error(`[SpatialAudio] audio.play() failed for '${soundId}':`, e);
      this.emitDebug('budget_exceeded', soundId, `play() error: ${e}`);
      // Cleanup on error
      if (isProjectile) {
        this.projectileSoundCount = Math.max(0, this.projectileSoundCount - 1);
      }
      this.returnAudioToPool(audio);
      this.scene.remove(container);
      return null;
    }

    // Cleanup after playback (if not looping)
    if (!sound.config.loop) {
      const duration = sound.buffer.duration * 1000;
      const timer = setTimeout(() => {
        this.emitDebug('stop', soundId);
        this.cleanupActiveSound(activeSound);
        // Remove from activeSounds array
        const index = this.activeSounds.indexOf(activeSound);
        if (index !== -1) {
          this.activeSounds.splice(index, 1);
        }
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
  ): Promise<PositionalAudio | null> {
    if (!this.geoToLocal) {
      console.warn('[SpatialAudio] geoToLocal not set - use setGeoToLocal() first');
      return null;
    }

    const position = this.geoToLocal(lat, lon, height);
    return this.playAt(soundId, position, volumeMultiplier);
  }

  /**
   * Play a non-positional (global) sound
   * Uses regular Audio instead of PositionalAudio
   */
  async playGlobal(soundId: string, volumeMultiplier = 1.0): Promise<Audio | null> {
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

    const audio = new Audio(this.listener);
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
   * Create a looping sound at a position
   * Returns a handle to control the loop, or null if creation failed
   */
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

    // Check if this is an enemy sound and register IMMEDIATELY to prevent race conditions
    const isEnemySound = this.isEnemySound(soundId);
    if (isEnemySound) {
      if (!this.registerEnemySound()) {
        // Budget exceeded - skip this sound silently
        return null;
      }
    }

    // Distance culling check before starting loop
    if (!this.isWithinAudibleDistance(position)) {
      if (isEnemySound) {
        this.unregisterEnemySound();
      }
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
      if (isEnemySound) {
        this.unregisterEnemySound();
      }
      return null;
    }

    // Get positional audio from pool
    const audio = this.getAudioFromPool();
    audio.setBuffer(sound.buffer);
    audio.setRefDistance(sound.config.refDistance);
    audio.setRolloffFactor(sound.config.rolloffFactor);
    audio.setDistanceModel(sound.config.distanceModel);
    audio.setVolume(sound.config.volume * (config?.volumeMultiplier ?? 1.0));
    audio.setLoop(true);

    if (sound.config.maxDistance > 0) {
      audio.setMaxDistance(sound.config.maxDistance);
    }

    // Random start for variety
    if (config?.randomStart && sound.buffer.duration > 0) {
      audio.offset = Math.random() * sound.buffer.duration;
    }

    // Create a container object at the position
    const container = new Object3D();
    container.position.copy(position);
    container.add(audio);
    this.scene.add(container);

    // CRITICAL: Force compute matrixWorld and update panner position BEFORE play()
    container.updateMatrixWorld(true);
    this.updatePannerPosition(audio);

    // Generate unique handle
    const handle = `loop_${++this.loopHandleCounter}`;

    // Track active loop
    const activeLoop: ActiveLoop = {
      handle,
      soundId,
      audio,
      container,
      isEnemySound,
      paused: false,
    };
    this.activeLoops.set(handle, activeLoop);

    // Play
    audio.play();

    return handle;
  }

  /**
   * Update position of a looping sound
   * Also handles distance-based pause/resume
   */
  updateLoopPosition(handle: string, position: Vector3): void {
    const loop = this.activeLoops.get(handle);
    if (!loop) return;

    loop.container.position.copy(position);

    const isInRange = this.isWithinAudibleDistance(position);

    if (!isInRange && !loop.paused) {
      // Out of range and playing -> pause
      this.pauseLoopInternal(loop);
    } else if (isInRange && loop.paused) {
      // Back in range and paused -> resume
      this.resumeLoopInternal(loop);
    }
  }

  /**
   * Pause a loop by handle
   */
  pauseLoop(handle: string): void {
    const loop = this.activeLoops.get(handle);
    if (loop && !loop.paused) {
      this.pauseLoopInternal(loop);
    }
  }

  /**
   * Resume a paused loop by handle
   * Returns false if budget exceeded (loop stays paused)
   */
  resumeLoop(handle: string): boolean {
    const loop = this.activeLoops.get(handle);
    if (!loop || !loop.paused) return true;

    return this.resumeLoopInternal(loop);
  }

  /**
   * Stop and remove a loop by handle
   */
  stopLoop(handle: string): void {
    const loop = this.activeLoops.get(handle);
    if (!loop) return;

    // Unregister enemy sound from budget (only if not paused, as paused loops already released budget)
    if (loop.isEnemySound && !loop.paused) {
      this.unregisterEnemySound();
    }

    // Return audio to pool (handles stop and disconnect internally)
    this.returnAudioToPool(loop.audio);

    // Remove container from scene
    this.scene.remove(loop.container);

    // Remove from tracking
    this.activeLoops.delete(handle);
  }

  /**
   * Check if a loop is paused
   */
  isLoopPaused(handle: string): boolean {
    return this.activeLoops.get(handle)?.paused ?? false;
  }

  /**
   * Internal: Pause a loop
   */
  private pauseLoopInternal(loop: ActiveLoop): void {
    try {
      loop.audio.pause();
      loop.paused = true;

      // Release enemy sound budget while paused
      if (loop.isEnemySound) {
        this.unregisterEnemySound();
      }
    } catch (e) {
      console.warn(`[SpatialAudio] pauseLoop failed:`, e);
    }
  }

  /**
   * Internal: Resume a loop
   * Returns true if successful, false if budget exceeded
   */
  private resumeLoopInternal(loop: ActiveLoop): boolean {
    // Re-acquire enemy sound budget before resuming
    if (loop.isEnemySound) {
      if (!this.registerEnemySound()) {
        // Budget exceeded - stay paused
        return false;
      }
    }

    try {
      // Update panner position before resuming (container may have moved while paused)
      loop.container.updateMatrixWorld(true);
      this.updatePannerPosition(loop.audio);

      loop.audio.play();
      loop.paused = false;
      return true;
    } catch (e) {
      console.warn(`[SpatialAudio] resumeLoop failed:`, e);
      // If resume failed, release the budget we just acquired
      if (loop.isEnemySound) {
        this.unregisterEnemySound();
      }
      return false;
    }
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
   * Stop all sounds (one-shots and loops)
   */
  stopAll(): void {
    // Cleanup all active one-shot sounds
    for (const active of this.activeSounds) {
      this.cleanupActiveSound(active);
    }
    this.activeSounds = [];

    // Cleanup all active loops (copy keys to avoid mutation during iteration)
    const loopHandles = Array.from(this.activeLoops.keys());
    for (const handle of loopHandles) {
      this.stopLoop(handle);
    }
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
  getListener(): AudioListener {
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

    // Decrement projectile counter if applicable
    if (active.isProjectileSound) {
      this.projectileSoundCount = Math.max(0, this.projectileSoundCount - 1);
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
