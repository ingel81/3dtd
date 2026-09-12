import { GameEventBus, SubscriptionBag } from '../game-engine';
import { ThreeTilesEngine } from '../three-engine';
import { GAME_SOUNDS } from '../configs/audio.config';

/**
 * Audio Service - Handles spatial audio via events
 *
 * Framework-agnostic service that subscribes to audio events
 * and plays sounds using ThreeTilesEngine's SpatialAudioManager.
 *
 * Event-driven: Subscribes to `audio:play` events from GameEventBus, and
 * plays the nuclear strike on `ability:impact`
 */
export class AudioService {
  private readonly subs = new SubscriptionBag();

  constructor(
    private eventBus: GameEventBus,
    private tilesEngine: ThreeTilesEngine
  ) {
    this.registerSounds();
    this.setupEventHandlers();
  }

  /** Sounds this service plays for game events of its own */
  private registerSounds(): void {
    const { id, url, refDistance, rolloffFactor, volume } = GAME_SOUNDS.nuclearStrike;
    this.tilesEngine.spatialAudio?.registerSound(id, url, { refDistance, rolloffFactor, volume });
  }

  /**
   * Setup event handlers for audio events
   */
  private setupEventHandlers(): void {
    this.subs.add(this.eventBus.on('audio:play', (event) => {
      this.handleAudioPlay(event);
    }));

    // Nuclear strike, at the impact point
    this.subs.add(this.eventBus.on('ability:impact', (event) => {
      this.handleAudioPlay({
        sound: GAME_SOUNDS.nuclearStrike.id,
        lat: event.target.lat,
        lon: event.target.lon,
        height: event.target.height ?? 0,
      });
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
