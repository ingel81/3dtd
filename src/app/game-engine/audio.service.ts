import { GameEventBus, SubscriptionBag } from '../game-engine';
import { ThreeTilesEngine } from '../three-engine';
import { ABILITY_IMPACT_SOUNDS } from '../configs/audio.config';

/** A repeat of an impact sound still to come (AbilityImpactSound.tail) */
interface PendingRepeat {
  sound: string;
  /** Game time (ms) until it plays */
  remainingMs: number;
  volume: number;
  lat: number;
  lon: number;
  height: number;
}

/**
 * Audio Service - Handles spatial audio via events
 *
 * Framework-agnostic service that subscribes to audio events
 * and plays sounds using ThreeTilesEngine's SpatialAudioManager.
 *
 * Event-driven: Subscribes to `audio:play` events from GameEventBus, and
 * plays each ability's impact sound (ABILITY_IMPACT_SOUNDS) on
 * `ability:impact`, its tail in game time (update())
 */
export class AudioService {
  private readonly subs = new SubscriptionBag();
  private readonly pendingTail: PendingRepeat[] = [];

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
    // quieter repeats (the nuclear strike rumbles), see update()
    this.subs.add(this.eventBus.on('ability:impact', ({ abilityId, target }) => {
      const sound = ABILITY_IMPACT_SOUNDS[abilityId];
      if (!sound) return;
      const { lat, lon } = target;
      const height = target.height ?? 0;
      this.handleAudioPlay({ sound: sound.id, lat, lon, height, volume: 1 });
      for (const { delayMs, volume } of sound.tail) {
        this.pendingTail.push({ sound: sound.id, remainingMs: delayMs, volume, lat, lon, height });
      }
    }));
    // A restart drops the repeats still to come
    this.subs.add(this.eventBus.on('game:reset', () => this.clearTail()));
  }

  /**
   * One gameplay sub-step (GameStateManager.runSubStep): plays the repeats
   * of impact sounds whose time has come. In game time like the ability
   * itself, so a pause holds the tail and a higher game speed shortens it.
   */
  update(stepMs: number): void {
    if (this.pendingTail.length === 0) return;
    let kept = 0;
    for (const repeat of this.pendingTail) {
      repeat.remainingMs -= stepMs;
      if (repeat.remainingMs <= 0) {
        const { sound, lat, lon, height, volume } = repeat;
        this.handleAudioPlay({ sound, lat, lon, height, volume });
      } else {
        this.pendingTail[kept++] = repeat;
      }
    }
    this.pendingTail.length = kept;
  }

  private clearTail(): void {
    this.pendingTail.length = 0;
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
