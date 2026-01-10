import * as THREE from 'three';
import { Component, ComponentType } from '../core/component';
import { GameObject } from '../core/game-object';
import { SpatialAudioManager } from '../managers/spatial-audio.manager';
import { TransformComponent } from './transform.component';

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
 * Active looping sound
 */
interface ActiveLoop {
  audio: THREE.PositionalAudio;
  container: THREE.Object3D;
  isEnemySound: boolean; // Track if this counts against enemy sound budget
}

/**
 * AudioComponent - Manages 3D positioned sounds for a GameObject
 *
 * Thin wrapper around SpatialAudioManager that:
 * - Tracks sounds per GameObject
 * - Updates loop positions to follow the GameObject
 * - Cleans up on destroy
 */
export class AudioComponent extends Component {
  private spatialAudio: SpatialAudioManager | null = null;
  private sounds = new Map<string, { url: string; config: AudioConfig }>();
  private activeLoops = new Map<string, ActiveLoop>();
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
   * @param volumeMultiplier Volume multiplier for one-shot sounds (0.0-1.0)
   */
  async play(id: string, forceLoop?: boolean, volumeMultiplier?: number): Promise<void> {
    const sound = this.sounds.get(id);
    if (!sound || !this.spatialAudio) return;

    const pos = this.getPosition();
    if (!pos) return;

    const isLoop = forceLoop ?? sound.config.loop ?? false;

    if (isLoop) {
      // Stop existing loop
      this.stop(id);
      await this.playLoop(id, sound.url, sound.config);
    } else {
      // One-shot: fire and forget
      const globalId = this.getGlobalId(id);
      await this.spatialAudio.playAtGeo(globalId, pos.lat, pos.lon, pos.height ?? 0, volumeMultiplier ?? 1.0);
    }
  }

  /**
   * Play a looping sound that follows the GameObject
   */
  private async playLoop(id: string, _url: string, config: AudioConfig): Promise<void> {
    if (this.destroyed || !this.spatialAudio) return;

    // Get the global sound ID (registered earlier)
    const globalId = this.getGlobalId(id);

    // Check if this is an enemy sound and if we have budget
    const isEnemySound = this.isEnemySound(globalId);
    if (isEnemySound && !this.spatialAudio.canPlayEnemySound()) {
      // Budget exceeded - skip this sound silently
      return;
    }

    const pos = this.getPosition();
    if (!pos) return;

    await this.spatialAudio.resumeContext();

    // Check if destroyed during await
    if (this.destroyed) return;

    // Register enemy sound BEFORE creating audio
    if (isEnemySound) {
      if (!this.spatialAudio.registerEnemySound()) {
        return; // Race condition - budget filled while we were waiting
      }
    }

    // Get cached buffer from SpatialAudioManager (already loaded at registration)
    const buffer = await this.spatialAudio.getBuffer(globalId);

    // Check if destroyed during await - cleanup enemy budget if needed
    if (this.destroyed) {
      if (isEnemySound && this.spatialAudio) {
        this.spatialAudio.unregisterEnemySound();
      }
      return;
    }

    if (!buffer) {
      console.error(`[AudioComponent] No cached buffer for: ${globalId}`);
      if (isEnemySound) {
        this.spatialAudio.unregisterEnemySound();
      }
      return;
    }

    const listener = this.spatialAudio.getListener();
    const scene = this.spatialAudio.getScene();

    // Create positional audio using cached buffer
    const audio = new THREE.PositionalAudio(listener);
    audio.setBuffer(buffer);
    audio.setRefDistance(config.refDistance ?? 30);
    audio.setRolloffFactor(config.rolloffFactor ?? 1);
    audio.setVolume(config.volume ?? 0.5);
    audio.setLoop(true);

    // Random start for variety
    if (config.randomStart && buffer.duration > 0) {
      audio.offset = Math.random() * buffer.duration;
    }

    // Create container at position
    const container = new THREE.Object3D();
    const localPos = this.spatialAudio.geoToLocalPosition(pos.lat, pos.lon, pos.height ?? 0);
    if (localPos) {
      container.position.copy(localPos);
    }

    container.add(audio);
    scene.add(container);

    // Final check before starting - if destroyed during sync setup, cleanup and abort
    if (this.destroyed) {
      console.log(`[AudioComponent] playLoop('${id}') - destroyed during setup, aborting`);
      audio.disconnect();
      scene.remove(container);
      if (isEnemySound && this.spatialAudio) {
        this.spatialAudio.unregisterEnemySound();
      }
      return;
    }

    this.activeLoops.set(id, { audio, container, isEnemySound });
    console.log(`[AudioComponent] playLoop('${id}') - starting audio for ${this.gameObject.id}`);
    audio.play();
  }

  /**
   * Check if a sound ID represents an enemy sound
   */
  private isEnemySound(soundId: string): boolean {
    const lowerId = soundId.toLowerCase();
    return (
      lowerId.includes('zombie') ||
      lowerId.includes('tank') ||
      lowerId.includes('enemy') ||
      lowerId.includes('wallsmasher') ||
      lowerId.includes('big_arm')
    );
  }

  /**
   * Stop a sound
   */
  stop(id: string): void {
    const loop = this.activeLoops.get(id);
    if (loop) {
      console.log(`[AudioComponent] stop('${id}') - isPlaying:`, loop.audio.isPlaying);

      // Unregister enemy sound from budget
      if (loop.isEnemySound && this.spatialAudio) {
        this.spatialAudio.unregisterEnemySound();
      }

      // Always try to stop, regardless of isPlaying state
      try {
        loop.audio.stop();
      } catch (e) {
        console.warn(`[AudioComponent] stop('${id}') failed:`, e);
      }
      loop.audio.disconnect();
      this.spatialAudio?.getScene().remove(loop.container);
      this.activeLoops.delete(id);
    }
  }

  /**
   * Stop all sounds
   */
  stopAll(): void {
    console.log('[AudioComponent] stopAll() called, activeLoops:', this.activeLoops.size);
    // Copy keys to array to avoid iteration issues during deletion
    const ids = Array.from(this.activeLoops.keys());
    for (const id of ids) {
      this.stop(id);
    }
  }

  /**
   * Set volume for a playing loop
   */
  setVolume(id: string, volume: number): void {
    this.activeLoops.get(id)?.audio.setVolume(volume);
  }

  /**
   * Update loop positions to follow GameObject
   */
  update(_deltaTime: number): void {
    if (this.activeLoops.size === 0 || !this.spatialAudio) return;

    const pos = this.getPosition();
    if (!pos) return;

    const localPos = this.spatialAudio.geoToLocalPosition(pos.lat, pos.lon, pos.height ?? 0);
    if (!localPos) return;

    for (const loop of this.activeLoops.values()) {
      loop.container.position.copy(localPos);
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
    console.log('[AudioComponent] onDestroy() called for', this.gameObject.id);
    this.destroyed = true; // Prevent any pending async playLoop from adding new sounds
    this.stopAll();
  }
}
