import { Audio, Object3D, PositionalAudio, Vector3 } from 'three';
import { AUDIO_LIMITS, PROJECTILE_SOUND_IDS } from '../../configs/audio.config';
import { GameEventBus } from '../../game-engine';
import { AudioPoolManager } from './audio-pool.manager';
import { SpatialSoundConfig } from './spatial-audio.manager';

/** Reusable Vector3 for distance calculations (avoid GC pressure) */
const _tempVec3 = new Vector3();

/**
 * Active sound instance (one-shot)
 */
export interface ActiveSound {
  audio: PositionalAudio;
  soundId: string;
  container?: Object3D;
  ownerId?: string;
  timer?: ReturnType<typeof setTimeout>;
  isProjectileSound?: boolean;
}

/**
 * Registered sound definition (internal)
 */
export interface RegisteredSound {
  buffer: AudioBuffer | null;
  config: Required<SpatialSoundConfig>;
  loading: Promise<AudioBuffer> | null;
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
 * Handles playAt, playAtGeo, playGlobal, and panner update logic.
 */
export class SpatialAudioPlayback {
  private pool: AudioPoolManager;
  private sounds: Map<string, RegisteredSound>;
  private activeSounds: ActiveSound[] = [];
  private projectileSoundCount = 0;
  private eventBus: GameEventBus | null = null;
  private contextResumed = false;
  private geoToLocal: ((lat: number, lon: number, height: number) => Vector3) | null = null;
  private camera: { getWorldPosition: (target: Vector3) => Vector3 };
  private _masterVolume = 1.0;

  constructor(
    pool: AudioPoolManager,
    sounds: Map<string, RegisteredSound>,
    camera: { getWorldPosition: (target: Vector3) => Vector3 }
  ) {
    this.pool = pool;
    this.sounds = sounds;
    this.camera = camera;
  }

  setMasterVolume(vol: number): void {
    this._masterVolume = Math.max(0, Math.min(1, vol));
  }

  // --- Event bus ---

  setEventBus(eventBus: GameEventBus): void {
    this.eventBus = eventBus;
  }

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

  // --- Geo converter ---

  setGeoToLocal(fn: (lat: number, lon: number, height: number) => Vector3): void {
    this.geoToLocal = fn;
  }

  geoToLocalPosition(lat: number, lon: number, height: number): Vector3 | null {
    if (!this.geoToLocal) return null;
    return this.geoToLocal(lat, lon, height);
  }

  // --- Distance helpers ---

  isWithinAudibleDistance(position: Vector3): boolean {
    this.camera.getWorldPosition(_tempVec3);
    const distance = _tempVec3.distanceTo(position);
    return distance <= AUDIO_LIMITS.maxAudibleDistance;
  }

  getDistanceToCamera(position: Vector3): number {
    this.camera.getWorldPosition(_tempVec3);
    return _tempVec3.distanceTo(position);
  }

  // --- Projectile budget ---

  isProjectileSound(soundId: string): boolean {
    return (PROJECTILE_SOUND_IDS as readonly string[]).includes(soundId);
  }

  getProjectileSoundStats(): { current: number; max: number } {
    return { current: this.projectileSoundCount, max: AUDIO_LIMITS.maxProjectileSounds };
  }

  // --- Audio context ---

  async resumeContext(): Promise<void> {
    if (this.contextResumed) return;
    const context = this.pool.getListener().context;
    if (context.state === 'suspended') {
      await context.resume();
    }
    this.contextResumed = true;
  }

  // --- Active sounds accessors ---

  getActiveSounds(): ActiveSound[] {
    return this.activeSounds;
  }

  getActiveSoundCount(): number {
    return this.activeSounds.length;
  }

  // --- Playback ---

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

    await this.resumeContext();

    if (sound.loading) {
      await sound.loading;
    }
    if (!sound.buffer) {
      console.warn(`[SpatialAudio] No buffer for: ${soundId}`);
      return null;
    }

    // Distance-based culling
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
        return null;
      }
      this.projectileSoundCount++;
    }

    // Create audio + container
    const audio = this.pool.createAudio();
    audio.setBuffer(sound.buffer);
    audio.setRefDistance(sound.config.refDistance);
    audio.setRolloffFactor(sound.config.rolloffFactor);
    audio.setDistanceModel(sound.config.distanceModel);
    audio.setVolume(sound.config.volume * volumeMultiplier * this._masterVolume);
    audio.setLoop(sound.config.loop);

    if (sound.config.maxDistance > 0) {
      audio.setMaxDistance(sound.config.maxDistance);
    }

    const container = this.pool.createContainerAtPosition(audio, position);

    // Track active sound
    const activeSound: ActiveSound = { audio, soundId, container, isProjectileSound: isProjectile };
    this.activeSounds.push(activeSound);

    // Play
    try {
      audio.play();
      if (!audio.isPlaying) {
        console.warn(`[SpatialAudio] audio.play() called but isPlaying=false for '${soundId}'`);
        this.emitDebug('budget_exceeded', soundId, 'play() silent fail');
      } else {
        this.emitDebug('play', soundId, isProjectile ? 'projectile' : 'one-shot');
      }
    } catch (e) {
      console.error(`[SpatialAudio] audio.play() failed for '${soundId}':`, e);
      this.emitDebug('budget_exceeded', soundId, `play() error: ${e}`);
      if (isProjectile) {
        this.projectileSoundCount = Math.max(0, this.projectileSoundCount - 1);
      }
      this.pool.cleanupAudio(audio);
      this.pool.removeContainer(container);
      return null;
    }

    // Cleanup after playback (if not looping)
    if (!sound.config.loop) {
      const duration = sound.buffer.duration * 1000;
      const timer = setTimeout(() => {
        this.emitDebug('stop', soundId);
        this.cleanupActiveSound(activeSound);
        const index = this.activeSounds.indexOf(activeSound);
        if (index !== -1) {
          this.activeSounds.splice(index, 1);
        }
      }, duration + 100);
      activeSound.timer = timer;
    }

    return audio;
  }

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

    const audio = new Audio(this.pool.getListener());
    audio.setBuffer(sound.buffer);
    audio.setVolume(sound.config.volume * volumeMultiplier * this._masterVolume);
    audio.setLoop(sound.config.loop);
    audio.play();

    if (!sound.config.loop) {
      const duration = sound.buffer.duration * 1000;
      setTimeout(() => {
        audio.disconnect();
      }, duration + 100);
    }

    return audio;
  }

  // --- Stop / cleanup ---

  stop(soundId: string): void {
    for (let i = this.activeSounds.length - 1; i >= 0; i--) {
      if (this.activeSounds[i].soundId === soundId) {
        this.cleanupActiveSound(this.activeSounds[i]);
        this.activeSounds.splice(i, 1);
      }
    }
  }

  stopAllOneShots(): void {
    for (const active of this.activeSounds) {
      this.cleanupActiveSound(active);
    }
    this.activeSounds = [];
  }

  isPlaying(soundId: string): boolean {
    return this.activeSounds.some((s) => s.soundId === soundId && s.audio.isPlaying);
  }

  private cleanupActiveSound(active: ActiveSound): void {
    if (active.timer) {
      clearTimeout(active.timer);
      active.timer = undefined;
    }
    if (active.isProjectileSound) {
      this.projectileSoundCount = Math.max(0, this.projectileSoundCount - 1);
    }
    this.pool.cleanupAudio(active.audio);
    if (active.container) {
      this.pool.removeContainer(active.container);
    }
  }
}
