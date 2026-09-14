import { Vector3 } from 'three';
import { Component } from '../core/component';
import { GameObject } from '../core/game-object';
import { SpatialAudioManager } from '../managers/audio/spatial-audio.manager';
import { TransformComponent } from './transform.component';
import { ComponentType } from '../core/component';

/**
 * Configuration for a spatial sound
 */
export interface AudioConfig {
  /** Reference distance - full volume at this distance (meters) */
  refDistance?: number;
  /** Rolloff factor - how fast sound fades (higher = faster) */
  rolloffFactor?: number;
  /** Base volume (0-1) */
  volume?: number;
  /** Loop the sound */
  loop?: boolean;
  /** Start at random position (for variety with loops) */
  randomStart?: boolean;
}

/**
 * Receives whether an AudioComponent currently holds loop handles. `update()`
 * has nothing to do without one, so an owner that keeps this flag can skip
 * the call without loading the component. EnemyManager would otherwise do
 * that for every enemy every sub-step while only a few carry a loop.
 */
export interface LoopFlagSink {
  hasAudioLoops: boolean;
}

/**
 * AudioComponent - Manages 3D positioned sounds for a GameObject
 *
 * Thin wrapper around SpatialAudioManager that:
 * - Tracks sounds per GameObject
 * - Updates loop positions to follow the GameObject
 * - Cleans up on destroy
 *
 * All loop management (audio pooling, distance culling, enemy budget)
 * is delegated to SpatialAudioManager.
 */
export class AudioComponent extends Component {
  private spatialAudio: SpatialAudioManager | null = null;
  private sounds = new Map<string, { url: string; config: AudioConfig }>();
  private loopHandles = new Map<string, string>(); // localId → SpatialAudioManager handle
  /**
   * localId → token of the loop whose `createLoop` is still in flight.
   * stop(), stopAll() and a newer play() of the same id drop or replace the
   * token; a loop that arrives under a stale token has no owner and is stopped
   * at once instead of looping forever.
   */
  private pendingLoops = new Map<string, number>();
  private loopRequestCounter = 0;
  private destroyed = false;
  /** Local position for update(), which runs every sub-step: no vector per call */
  private readonly localPos = new Vector3();

  constructor(
    gameObject: GameObject,
    private readonly loopSink: LoopFlagSink | null = null,
  ) {
    super(gameObject);
  }

  /**
   * Initialize with SpatialAudioManager
   * Registers all previously registered sounds
   */
  initialize(spatialAudio: SpatialAudioManager): void {
    this.spatialAudio = spatialAudio;

    // Register all sounds that were added before initialization
    for (const [id, { url, config }] of this.sounds) {
      const globalId = this.getGlobalId(id);
      spatialAudio.registerSound(globalId, url, {
        refDistance: config.refDistance ?? 30,
        rolloffFactor: config.rolloffFactor ?? 1,
        volume: config.volume ?? 0.5,
        loop: config.loop ?? false,
      });
    }
  }

  /**
   * Register a sound
   */
  registerSound(id: string, url: string, config: AudioConfig = {}): void {
    this.sounds.set(id, { url, config });

    // Pre-register in SpatialAudioManager for faster first play
    if (this.spatialAudio) {
      const globalId = this.getGlobalId(id);
      this.spatialAudio.registerSound(globalId, url, {
        refDistance: config.refDistance ?? 30,
        rolloffFactor: config.rolloffFactor ?? 1,
        volume: config.volume ?? 0.5,
        loop: config.loop ?? false,
      });
    }
  }

  /**
   * Play a sound at GameObject's current position
   * @param id Sound ID
   * @param forceLoop Force loop mode
   * @param volumeMultiplier Volume multiplier (0.0-1.0)
   */
  async play(id: string, forceLoop?: boolean, volumeMultiplier?: number): Promise<void> {
    const sound = this.sounds.get(id);
    if (!sound || !this.spatialAudio || this.destroyed) return;

    const pos = this.getPosition();
    if (!pos) return;

    const isLoop = forceLoop ?? sound.config.loop ?? false;
    const globalId = this.getGlobalId(id);

    if (isLoop) {
      // Stop existing loop for this sound
      this.stop(id);

      // Get local position
      const localPos = this.spatialAudio.geoToLocalPosition(pos.lat, pos.lon, pos.height ?? 0);
      if (!localPos) return;

      // Create loop via SpatialAudioManager. The await can span a context
      // resume and a buffer load, long enough for the enemy to die meanwhile.
      const token = ++this.loopRequestCounter;
      this.pendingLoops.set(id, token);
      const handle = await this.spatialAudio.createLoop(globalId, localPos, {
        volumeMultiplier: volumeMultiplier ?? 1.0,
        randomStart: sound.config.randomStart,
      });

      const stillWanted = !this.destroyed && this.pendingLoops.get(id) === token;
      if (stillWanted) this.pendingLoops.delete(id);
      if (!handle) return;

      if (!stillWanted) {
        this.spatialAudio.stopLoop(handle);
        return;
      }
      this.loopHandles.set(id, handle);
      this.syncLoopFlag();
    } else {
      // One-shot: fire and forget
      await this.spatialAudio.playAtGeo(globalId, pos.lat, pos.lon, pos.height ?? 0, volumeMultiplier ?? 1.0);
    }
  }

  /**
   * Stop a sound
   */
  stop(id: string): void {
    this.pendingLoops.delete(id);
    const handle = this.loopHandles.get(id);
    if (handle && this.spatialAudio) {
      this.spatialAudio.stopLoop(handle);
      this.loopHandles.delete(id);
      this.syncLoopFlag();
    }
  }

  /**
   * Stop all sounds
   */
  stopAll(): void {
    this.pendingLoops.clear();
    if (!this.spatialAudio) return;

    for (const handle of this.loopHandles.values()) {
      this.spatialAudio.stopLoop(handle);
    }
    this.loopHandles.clear();
    this.syncLoopFlag();
  }

  /**
   * Set volume for a playing loop
   * Note: Volume changes for loops must be done through the handle
   * This is a no-op in the new architecture (loops use initial volume only)
   */
  setVolume(_id: string, _volume: number): void {
    // No-op: Volume is set at loop creation time
    // Future enhancement: Add setLoopVolume to SpatialAudioManager if needed
  }

  /**
   * Update loop positions to follow the GameObject
   * Distance culling is handled by SpatialAudioManager.updateLoopPosition()
   * A no-op without loop handles, see LoopFlagSink.
   */
  update(_deltaTime: number): void {
    if (this.loopHandles.size === 0 || !this.spatialAudio) return;

    const pos = this.getPosition();
    if (!pos) return;

    const localPos = this.spatialAudio.geoToLocalPosition(pos.lat, pos.lon, pos.height ?? 0, this.localPos);
    if (!localPos) return;

    // Update position for all active loops (SpatialAudioManager handles pause/resume)
    for (const handle of this.loopHandles.values()) {
      this.spatialAudio.updateLoopPosition(handle, localPos);
    }
  }

  /**
   * Get GameObject's position via TransformComponent
   */
  private getPosition(): { lat: number; lon: number; height?: number } | null {
    const transform = this.gameObject.getComponent<TransformComponent>(ComponentType.TRANSFORM);
    return transform?.position ?? null;
  }

  /**
   * Get global sound ID (unique per GameObject)
   */
  private getGlobalId(localId: string): string {
    return `${this.gameObject.id}_${localId}`;
  }

  override onDestroy(): void {
    this.destroyed = true; // A pending loop play() stops its loop once createLoop resolves
    this.stopAll();
  }

  /** Runs after every `loopHandles` write, so the sink tracks `size > 0` exactly. */
  private syncLoopFlag(): void {
    if (this.loopSink !== null) this.loopSink.hasAudioLoops = this.loopHandles.size > 0;
  }
}
