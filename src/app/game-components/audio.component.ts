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
  private destroyed = false;

  constructor(gameObject: GameObject) {
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

      // Create loop via SpatialAudioManager
      const handle = await this.spatialAudio.createLoop(globalId, localPos, {
        volumeMultiplier: volumeMultiplier ?? 1.0,
        randomStart: sound.config.randomStart,
      });

      if (handle) {
        this.loopHandles.set(id, handle);
      }
    } else {
      // One-shot: fire and forget
      await this.spatialAudio.playAtGeo(globalId, pos.lat, pos.lon, pos.height ?? 0, volumeMultiplier ?? 1.0);
    }
  }

  /**
   * Stop a sound
   */
  stop(id: string): void {
    const handle = this.loopHandles.get(id);
    if (handle && this.spatialAudio) {
      this.spatialAudio.stopLoop(handle);
      this.loopHandles.delete(id);
    }
  }

  /**
   * Stop all sounds
   */
  stopAll(): void {
    if (!this.spatialAudio) return;

    for (const handle of this.loopHandles.values()) {
      this.spatialAudio.stopLoop(handle);
    }
    this.loopHandles.clear();
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
   */
  update(_deltaTime: number): void {
    if (this.loopHandles.size === 0 || !this.spatialAudio) return;

    const pos = this.getPosition();
    if (!pos) return;

    const localPos = this.spatialAudio.geoToLocalPosition(pos.lat, pos.lon, pos.height ?? 0);
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
    this.destroyed = true; // Prevent any pending async play from adding new sounds
    this.stopAll();
  }
}
