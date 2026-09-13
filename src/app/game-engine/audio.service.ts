import { GameEventBus, SubscriptionBag } from '../game-engine';
import { ThreeTilesEngine } from '../three-engine';
import { ABILITY_IMPACT_SOUNDS } from '../configs/audio.config';

/**
 * Audio Service - Handles spatial audio via events
 *
 * Framework-agnostic service that subscribes to audio events
 * and plays sounds using ThreeTilesEngine's SpatialAudioManager.
 *
 * Event-driven: Subscribes to `audio:play` events from GameEventBus, and
 * plays each ability's impact sound (ABILITY_IMPACT_SOUNDS) on `ability:impact`
 */
export class AudioService {
  private readonly subs = new SubscriptionBag();
  /** Repeats of impact sounds still to come (AbilityImpactSound.tail) */
  private readonly tailTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private eventBus: GameEventBus,
    private tilesEngine: ThreeTilesEngine
  ) {
    this.registerSounds();
    this.setupEventHandlers();
  }

  /** Sounds this service plays for game events of its own: the abilities' impacts */
  private registerSounds(): void {
    for (const sound of Object.values(ABILITY_IMPACT_SOUNDS)) {
      if (!sound) continue;
      const { id, url, refDistance, rolloffFactor, volume, maxInstances } = sound;
      this.tilesEngine.spatialAudio?.registerSound(id, url, { refDistance, rolloffFactor, volume, maxInstances });
    }
  }

  /**
   * Setup event handlers for audio events
   */
  private setupEventHandlers(): void {
    this.subs.add(this.eventBus.on('audio:play', (event) => {
      this.handleAudioPlay(event);
    }));

    // The ability's own impact sound at the impact point, then its tail of
    // quieter repeats (the nuclear strike rumbles)
    this.subs.add(this.eventBus.on('ability:impact', ({ abilityId, target }) => {
      const sound = ABILITY_IMPACT_SOUNDS[abilityId];
      if (!sound) return;
      const play = (volume: number) =>
        this.handleAudioPlay({ sound: sound.id, lat: target.lat, lon: target.lon, height: target.height ?? 0, volume });
      play(1);
      for (const { delayMs, volume } of sound.tail) {
        const timer = setTimeout(() => {
          this.tailTimers.delete(timer);
          play(volume);
        }, delayMs);
        this.tailTimers.add(timer);
      }
    }));
    // A restart drops the repeats still to come
    this.subs.add(this.eventBus.on('game:reset', () => this.clearTail()));
  }

  private clearTail(): void {
    for (const timer of this.tailTimers) clearTimeout(timer);
    this.tailTimers.clear();
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
    this.clearTail();
  }
}
