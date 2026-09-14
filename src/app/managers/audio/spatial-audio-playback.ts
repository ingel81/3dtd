import { Audio, Matrix4, Object3D, PositionalAudio, Vector3 } from 'three';
import { AUDIO_LIMITS, PROJECTILE_SOUND_IDS } from '../../configs/audio.config';
import { GameEventBus } from '../../game-engine';
import { AudioPoolManager } from './audio-pool.manager';
import { SpatialSoundConfig } from './spatial-audio.manager';

/** AUDIO_LIMITS.maxAudibleDistance squared, for the distance checks */
const MAX_AUDIBLE_DISTANCE_SQ = AUDIO_LIMITS.maxAudibleDistance ** 2;

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
  /** Voice stealing takes it last (SpatialSoundConfig.priority) */
  priority?: boolean;
}

/**
 * Registered sound definition (internal)
 */
export interface RegisteredSound {
  buffer: AudioBuffer | null;
  config: Required<SpatialSoundConfig>;
  /** Pending load; resolves null when the file failed all retries. */
  loading: Promise<AudioBuffer | null> | null;
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
  /**
   * Global (non-positional) sounds that are still playing, with the timer
   * that disconnects a one-shot after its sample; null for a looping one.
   */
  private globalSounds = new Map<Audio, ReturnType<typeof setTimeout> | null>();
  private eventBus: GameEventBus | null = null;
  /**
   * Last play timestamp per AudioBuffer — used for anti-flood filtering.
   * Keyed by buffer reference (not soundId) because the same source file is
   * registered under unique IDs for every enemy/tower instance
   * (`enemy-9847_spawn`, `enemy-9848_spawn`, …). Per-soundId throttling
   * therefore never fires on a mass-spawn salvo, even though all those IDs
   * resolve to the same shared AudioBuffer. WeakMap so cached buffer
   * eviction doesn't leak entries.
   */
  private lastTriggerMsByBuffer = new WeakMap<AudioBuffer, number>();
  /**
   * Currently playing instances per AudioBuffer. Polyphony cap per sample
   * to avoid mushy overlap when long samples (spawn, boss roar) are
   * triggered repeatedly within their own duration.
   */
  private activeCountByBuffer = new WeakMap<AudioBuffer, number>();
  private geoToLocal: ((lat: number, lon: number, height: number, target: Vector3) => Vector3) | null = null;
  /** The camera, which carries the AudioListener; see distanceSqToListener() */
  private camera: { readonly matrixWorld: Matrix4 };
  private _masterVolume = 1.0;

  constructor(
    pool: AudioPoolManager,
    sounds: Map<string, RegisteredSound>,
    camera: { readonly matrixWorld: Matrix4 }
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

  /** `fn` writes the local position into `target` and returns it. */
  setGeoToLocal(fn: (lat: number, lon: number, height: number, target: Vector3) => Vector3): void {
    this.geoToLocal = fn;
  }

  /** Into `target` when given (a caller that runs every sub-step), else a new vector. */
  geoToLocalPosition(lat: number, lon: number, height: number, target = new Vector3()): Vector3 | null {
    if (!this.geoToLocal) return null;
    return this.geoToLocal(lat, lon, height, target);
  }

  // --- Distance helpers ---

  isWithinAudibleDistance(position: Vector3): boolean {
    return this.distanceSqToListener(position) <= MAX_AUDIBLE_DISTANCE_SQ;
  }

  getDistanceToCamera(position: Vector3): number {
    return Math.sqrt(this.distanceSqToListener(position));
  }

  /**
   * Squared distance from the camera, which carries the listener, to
   * `position`. Reads the translation of the camera's world matrix as the
   * engine last updated it: once per drawn frame, in ThreeTilesEngine.render()
   * after the controls moved the camera, the same update that places the Web
   * Audio listener. While nothing draws (headless training) both stand.
   *
   * Not getWorldPosition(): that updates the world matrices of the camera
   * and its parents and, for a camera, decomposes and inverts the matrix on
   * every call. A waiting enemy loop checks each sub-step
   * (SpatialAudioLoops.updatePosition), so that was work per enemy per
   * sub-step for a position that changes once a frame.
   */
  private distanceSqToListener(position: Vector3): number {
    const e = this.camera.matrixWorld.elements;
    const dx = position.x - e[12];
    const dy = position.y - e[13];
    const dz = position.z - e[14];
    return dx * dx + dy * dy + dz * dz;
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
    // Always check current state. The browser can suspend the context
    // again later (tab-switch, audio focus loss, idle policies), so a
    // one-shot flag would leave us stuck silent on the second suspension.
    const context = this.pool.getListener().context;
    if (context.state === 'suspended') {
      await context.resume().catch(() => { /* needs user gesture */ });
    }
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

    // Distance-based culling, at the sound's own audible distance
    const audible = sound.config.audibleDistance;
    if (this.distanceSqToListener(position) > audible * audible) {
      const distance = this.getDistanceToCamera(position);
      this.emitDebug('distance_culled', soundId, `distance ${distance.toFixed(0)}m exceeds max ${audible}m`);
      return null;
    }

    // Per-buffer limits. Either taken from the sound's config, or derived
    // heuristically from buffer duration: short combat sounds (arrow,
    // bullet, hit) get loose throttling and high polyphony; long sounds
    // (spawn, boss roar) get strict throttling and low polyphony so they
    // can't pile up into mush.
    const durationMs = sound.buffer.duration * 1000;
    const minIntervalMs = sound.config.minIntervalMs >= 0
      ? sound.config.minIntervalMs
      : Math.min(80, Math.max(10, durationMs * 0.05));
    const maxInstances = sound.config.maxInstances >= 0
      ? sound.config.maxInstances
      : durationMs < 500 ? 8 : durationMs < 1500 ? 4 : 2;

    // Anti-flood: drop triggers if the SAME BUFFER fired more recently
    // than minIntervalMs. Keyed by buffer reference so per-instance soundIds
    // (`enemy-9847_spawn` …) are all throttled through one check.
    const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const lastMs = this.lastTriggerMsByBuffer.get(sound.buffer) ?? -Infinity;
    if (nowMs - lastMs < minIntervalMs) {
      this.emitDebug('budget_exceeded', soundId, `flood-drop ${(nowMs - lastMs).toFixed(0)}ms`);
      return null;
    }

    // Polyphony cap per buffer: drop if too many instances of this exact
    // sample are already playing. Anti-flood handles same-frame stacks;
    // this handles drawn-out overlap.
    const activeForBuffer = this.activeCountByBuffer.get(sound.buffer) ?? 0;
    if (activeForBuffer >= maxInstances) {
      this.emitDebug('budget_exceeded', soundId, `buffer-poly ${activeForBuffer}/${maxInstances}`);
      return null;
    }
    // Budget check for projectile sounds. It comes before the sample's
    // polyphony slot and flood timestamp are taken: a rejected trigger plays
    // nothing, so it must hold no slot and start no flood window.
    const isProjectile = this.isProjectileSound(soundId);
    if (isProjectile && this.projectileSoundCount >= AUDIO_LIMITS.maxProjectileSounds) {
      this.emitDebug('budget_exceeded', soundId, `projectile budget ${this.projectileSoundCount}/${AUDIO_LIMITS.maxProjectileSounds}`);
      return null;
    }
    this.lastTriggerMsByBuffer.set(sound.buffer, nowMs);
    this.activeCountByBuffer.set(sound.buffer, activeForBuffer + 1);
    if (isProjectile) {
      this.projectileSoundCount++;
    }

    // Global one-shot cap with voice-stealing: if we're at the limit,
    // stop the OLDEST active one-shot to make room, the oldest without
    // priority while there is one (the hits and deaths of a big wave must
    // not cut the nuclear strike). Sounds smoother than rejecting the new
    // sound, which would leave gaps in fast-paced combat audio.
    while (this.activeSounds.length >= AUDIO_LIMITS.maxConcurrentOneShots) {
      const victim = this.takeVoiceToSteal();
      if (!victim) break;
      this.emitDebug('budget_exceeded', victim.soundId, 'voice-stolen');
      this.cleanupActiveSound(victim);
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
    const activeSound: ActiveSound = {
      audio, soundId, container, isProjectileSound: isProjectile, priority: sound.config.priority,
    };
    this.activeSounds.push(activeSound);

    // Play
    try {
      audio.play();
      if (!audio.isPlaying) {
        // Silent fail: play() returned without throwing but the source did
        // not start (suspended context, exhausted node pool, etc.). Treat
        // it like a hard failure — otherwise the active-sounds list grows
        // forever and the projectile counter saturates at the limit.
        console.warn(`[SpatialAudio] audio.play() called but isPlaying=false for '${soundId}'`);
        this.emitDebug('budget_exceeded', soundId, 'play() silent fail');
        if (isProjectile) {
          this.projectileSoundCount = Math.max(0, this.projectileSoundCount - 1);
        }
        this.activeSounds.pop(); // we just pushed it on line above
        this.decrementActiveBuffer(sound.buffer);
        this.pool.cleanupAudio(audio);
        this.pool.removeContainer(container);
        return null;
      }
      this.emitDebug('play', soundId, isProjectile ? 'projectile' : 'one-shot');
    } catch (e) {
      console.error(`[SpatialAudio] audio.play() failed for '${soundId}':`, e);
      this.emitDebug('budget_exceeded', soundId, `play() error: ${e}`);
      if (isProjectile) {
        this.projectileSoundCount = Math.max(0, this.projectileSoundCount - 1);
      }
      this.activeSounds.pop();
      this.decrementActiveBuffer(sound.buffer);
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
    const position = this.geoToLocal(lat, lon, height, new Vector3());
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

    let timer: ReturnType<typeof setTimeout> | null = null;
    if (!sound.config.loop) {
      const duration = sound.buffer.duration * 1000;
      timer = setTimeout(() => {
        this.globalSounds.delete(audio);
        audio.disconnect();
      }, duration + 100);
    }
    this.globalSounds.set(audio, timer);

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
    for (const [audio, timer] of this.globalSounds) {
      if (timer !== null) clearTimeout(timer);
      if (audio.isPlaying) audio.stop();
      audio.disconnect();
    }
    this.globalSounds.clear();
  }

  /**
   * Drop any active one-shot whose audio is no longer playing. Used after
   * the tab returns to foreground: background-tab throttling can delay
   * setTimeout-driven cleanup, leaving the active-sounds list (and the
   * projectile counter) stale. Calling this on visibilitychange lets the
   * system start fresh instead of fighting a saturated bookkeeping state.
   */
  revalidateActiveSounds(): void {
    for (let i = this.activeSounds.length - 1; i >= 0; i--) {
      const a = this.activeSounds[i];
      if (!a.audio.isPlaying) {
        this.cleanupActiveSound(a);
        this.activeSounds.splice(i, 1);
      }
    }
  }

  isPlaying(soundId: string): boolean {
    return this.activeSounds.some((s) => s.soundId === soundId && s.audio.isPlaying);
  }

  /** The oldest one-shot without priority, else the oldest; taken out of the active list. */
  private takeVoiceToSteal(): ActiveSound | undefined {
    const index = this.activeSounds.findIndex((active) => !active.priority);
    return this.activeSounds.splice(index === -1 ? 0 : index, 1)[0];
  }

  private cleanupActiveSound(active: ActiveSound): void {
    if (active.timer) {
      clearTimeout(active.timer);
      active.timer = undefined;
    }
    if (active.isProjectileSound) {
      this.projectileSoundCount = Math.max(0, this.projectileSoundCount - 1);
    }
    if (active.audio.buffer) {
      this.decrementActiveBuffer(active.audio.buffer);
    }
    this.pool.cleanupAudio(active.audio);
    if (active.container) {
      this.pool.removeContainer(active.container);
    }
  }

  private decrementActiveBuffer(buffer: AudioBuffer): void {
    const cnt = this.activeCountByBuffer.get(buffer) ?? 0;
    if (cnt <= 1) this.activeCountByBuffer.delete(buffer);
    else this.activeCountByBuffer.set(buffer, cnt - 1);
  }
}
