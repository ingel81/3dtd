import { GameEventBus, SubscriptionBag } from '../game-engine';
import { ThreeTilesEngine } from '../three-engine';

/**
 * Audio Service - Handles spatial audio via events
 *
 * Framework-agnostic service that subscribes to audio events
 * and plays sounds using ThreeTilesEngine's SpatialAudioManager.
 *
 * Event-driven: Subscribes to `audio:play` events from GameEventBus
 */
export class AudioService {
  private readonly subs = new SubscriptionBag();

  constructor(
    private eventBus: GameEventBus,
    private tilesEngine: ThreeTilesEngine
  ) {
    this.setupEventHandlers();
  }

  /**
   * Setup event handlers for audio events
   */
  private setupEventHandlers(): void {
    this.subs.add(this.eventBus.on('audio:play', (event) => {
      this.handleAudioPlay(event);
    }));
  }

  /**
   * Handle audio play event
   */
  private handleAudioPlay(event: {
    sound: string;
    lat: number;
    lon: number;
    height: number;
    volume?: number;
  }): void {
    const { sound, lat, lon, height, volume } = event;

    if (!this.tilesEngine.spatialAudio) {
      console.warn('[AudioService] SpatialAudio not available');
      return;
    }

    this.tilesEngine.spatialAudio
      .playAtGeo(sound, lat, lon, height, volume ?? 1.0)
      .catch((err) => {
        console.warn(`[AudioService] Failed to play sound '${sound}':`, err);
      });
  }

  /**
   * Cleanup (call on destroy)
   */
  destroy(): void {
    this.subs.disposeAll();
  }
}
