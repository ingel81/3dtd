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
   */
  async play(id: string, forceLoop?: boolean): Promise<void> {
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
      await this.spatialAudio.playAtGeo(globalId, pos.lat, pos.lon, pos.height ?? 0);
    }
  }

  /**
   * Play a looping sound that follows the GameObject
   */
  private async playLoop(id: string, url: string, config: AudioConfig): Promise<void> {
    if (!this.spatialAudio) return;

    // Check if this is an enemy sound and if we have budget
    const isEnemySound = this.isEnemySound(url);
    if (isEnemySound && !this.spatialAudio.canPlayEnemySound()) {
      // Budget exceeded - skip this sound silently
      return;
    }

    const pos = this.getPosition();
    if (!pos) return;

    await this.spatialAudio.resumeContext();

    // Register enemy sound BEFORE creating audio
    if (isEnemySound) {
      if (!this.spatialAudio.registerEnemySound()) {
        return; // Race condition - budget filled while we were waiting
      }
    }

    const listener = this.spatialAudio.getListener();
    const scene = this.spatialAudio.getScene();

    // Load audio buffer
    const loader = new THREE.AudioLoader();
    let buffer: AudioBuffer;

    try {
      buffer = await new Promise<AudioBuffer>((resolve, reject) => {
        loader.load(url, resolve, undefined, reject);
      });
    } catch {
      console.error(`[AudioComponent] Failed to load: ${url}`);
      // Unregister if we registered
      if (isEnemySound) {
        this.spatialAudio.unregisterEnemySound();
      }
      return;
    }

    // Create positional audio
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

    this.activeLoops.set(id, { audio, container, isEnemySound });
    audio.play();
  }

  /**
   * Check if a URL is an enemy sound
   */
  private isEnemySound(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    return lowerUrl.includes('zombie') || lowerUrl.includes('tank') || lowerUrl.includes('enemy');
  }

  /**
   * Stop a sound
   */
  stop(id: string): void {
    const loop = this.activeLoops.get(id);
    if (loop) {
      // Unregister enemy sound from budget
      if (loop.isEnemySound && this.spatialAudio) {
        this.spatialAudio.unregisterEnemySound();
      }

      if (loop.audio.isPlaying) {
        loop.audio.stop();
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
    for (const id of this.activeLoops.keys()) {
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
    this.stopAll();
  }
}
