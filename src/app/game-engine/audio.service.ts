import { Vector3 } from 'three';
import { GameEventBus, SubscriptionBag } from '../game-engine';
import { ThreeTilesEngine } from '../three-engine';
import { ABILITY_IMPACT_SOUNDS, type AbilityImpactSample } from '../configs/audio.config';
import type { SpatialSoundConfig } from '../managers/audio/spatial-audio.manager';
import type { GeoPosition } from '../models/game.types';

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

/** A loop this service runs for an ability (AbilityImpactSound.warning) */
interface AbilityLoop {
  /** Set once createLoop gave it */
  handle: string | null;
  /** Ended before createLoop came back: stopped as soon as it arrives */
  ended: boolean;
}

/** Ground the ability loops stand on: the route grid (GameStateManager). */
export interface AbilitySoundGround {
  getGroundLocalYAt(localX: number, localZ: number): number | null;
}

/**
 * Audio Service - Handles spatial audio via events
 *
 * Framework-agnostic service that subscribes to audio events
 * and plays sounds using ThreeTilesEngine's SpatialAudioManager.
 *
 * Event-driven: Subscribes to `audio:play` events from GameEventBus, and
 * plays each ability's sounds (ABILITY_IMPACT_SOUNDS): its warning loop from
 * `ability:used` to `ability:impact`, its impact sound on `ability:impact`
 * and its tail in game time (update())
 */
export class AudioService {
  private readonly subs = new SubscriptionBag();
  private readonly pendingTail: PendingRepeat[] = [];
  /** Warning loops by strike id, see AbilityImpactSound.warning */
  private readonly warnings = new Map<number, AbilityLoop>();
  private ground: AbilitySoundGround | null = null;
  private readonly local = new Vector3();

  constructor(
    private eventBus: GameEventBus,
    private tilesEngine: ThreeTilesEngine
  ) {
    this.registerSounds();
    this.setupEventHandlers();
  }

  /** Ground under the ability loops; without it they stand at the height of their target. */
  setGround(ground: AbilitySoundGround | null): void {
    this.ground = ground;
  }

  /**
   * Sounds this service plays for game events of its own: the abilities'
   * impacts, the samples of their tails and their loops, each id once. A
   * synthesised sample is built here, on the first registration.
   */
  private registerSounds(): void {
    const audio = this.tilesEngine.spatialAudio;
    if (!audio) return;
    const registered = new Set<string>();
    for (const sound of Object.values(ABILITY_IMPACT_SOUNDS)) {
      if (!sound) continue;
      for (const sample of [sound, ...sound.tail.map((repeat) => repeat.sample ?? sound)]) {
        if (registered.has(sample.id)) continue;
        registered.add(sample.id);
        const url = typeof sample.url === 'string' ? sample.url : sample.url();
        audio.registerSound(sample.id, url, spatialConfig(sample));
      }
      const loop = sound.warning;
      if (loop && !registered.has(loop.id)) {
        registered.add(loop.id);
        const { refDistance, rolloffFactor, volume } = loop;
        audio.registerSound(loop.id, loop.url, { refDistance, rolloffFactor, volume, loop: true });
      }
    }
  }

  /**
   * Setup event handlers for audio events
   */
  private setupEventHandlers(): void {
    this.subs.add(this.eventBus.on('audio:play', (event) => {
      this.handleAudioPlay(event);
    }));

    // The warning of a strike on its way (the nuclear strike's siren), at
    // its target until it lands
    this.subs.add(this.eventBus.on('ability:used', ({ abilityId, strikeId, target }) => {
      const warning = ABILITY_IMPACT_SOUNDS[abilityId]?.warning;
      if (warning) this.warnings.set(strikeId, this.startLoop(warning.id, target));
    }));

    // The ability's own impact sound at the impact point, then its tail
    // (the nuclear strike's rolls of rumble), see update()
    this.subs.add(this.eventBus.on('ability:impact', ({ abilityId, strikeId, target }) => {
      this.endWarning(strikeId);
      const sound = ABILITY_IMPACT_SOUNDS[abilityId];
      if (!sound) return;
      const { lat, lon } = target;
      const height = target.height ?? 0;
      this.handleAudioPlay({ sound: sound.id, lat, lon, height, volume: 1 });
      for (const { delayMs, volume, sample } of sound.tail) {
        this.pendingTail.push({ sound: (sample ?? sound).id, remainingMs: delayMs, volume, lat, lon, height });
      }
    }));
    // A restart drops what is still to come and ends the loops
    this.subs.add(this.eventBus.on('game:reset', () => this.clearAbilitySounds()));
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

  /**
   * Drop the repeats still to come and end the ability loops: a restart, and
   * the wave replay when it jumps or runs too fast for sound.
   */
  clearAbilitySounds(): void {
    this.pendingTail.length = 0;
    for (const strikeId of [...this.warnings.keys()]) this.endWarning(strikeId);
  }

  /** A loop of `soundId` at `at`, on the ground; one that cannot start comes back ended. */
  private startLoop(soundId: string, at: GeoPosition): AbilityLoop {
    const loop: AbilityLoop = { handle: null, ended: false };
    const audio = this.tilesEngine.spatialAudio;
    const position = audio ? this.localOnGround(at) : null;
    if (!audio || !position) {
      loop.ended = true;
      return loop;
    }
    // createLoop copies the position before it awaits
    void audio.createLoop(soundId, position).then((handle) => {
      if (handle === null) return;
      if (loop.ended) audio.stopLoop(handle);
      else loop.handle = handle;
    });
    return loop;
  }

  private endWarning(strikeId: number): void {
    const loop = this.warnings.get(strikeId);
    if (!loop) return;
    this.warnings.delete(strikeId);
    loop.ended = true;
    if (loop.handle !== null) this.tilesEngine.spatialAudio?.stopLoop(loop.handle);
    loop.handle = null;
  }

  /** `at` in local coordinates on the route grid's ground, or at its own height without one. Reuses one vector. */
  private localOnGround(at: GeoPosition): Vector3 | null {
    const p = this.tilesEngine.spatialAudio?.geoToLocalPosition(at.lat, at.lon, at.height ?? 0, this.local) ?? null;
    if (!p) return null;
    const groundY = this.ground?.getGroundLocalYAt(p.x, p.z) ?? null;
    if (groundY !== null) p.y = groundY;
    return p;
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
    this.clearAbilitySounds();
  }
}

/** The spatial settings of an impact sample; one it leaves unset keeps the manager's default. */
function spatialConfig(sample: AbilityImpactSample): SpatialSoundConfig {
  const { refDistance, rolloffFactor, volume, maxInstances, priority, audibleDistance } = sample;
  const config: SpatialSoundConfig = { refDistance, rolloffFactor, volume };
  if (maxInstances !== undefined) config.maxInstances = maxInstances;
  if (priority !== undefined) config.priority = priority;
  if (audibleDistance !== undefined) config.audibleDistance = audibleDistance;
  return config;
}
