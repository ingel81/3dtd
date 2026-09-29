import type { Vector3 } from 'three';
import type { SpatialAudioManager } from '../managers/audio/spatial-audio.manager';
import type { LoopHandle } from '../managers/audio/spatial-audio-loops';
import type { EnemyTypeConfig } from '../configs/enemy-types.config';

/**
 * Frames a voice skips after one in which its loop did not play: a waiting
 * loop gets its position every third frame and takes a free enemy-sound
 * slot, or the way back into earshot, up to two frames late. With thousands
 * of enemies nearly every loop waits for one of the few slots.
 */
const WAITING_LOOP_SKIPS = 2;

/** The sounds of one enemy while it walks */
interface EnemyVoice {
  /** The moving loop once createLoop gave it */
  loop: LoopHandle | null;
  /** The voice ended while createLoop was in flight: the loop stops as it arrives */
  ended: boolean;
  /** Game ms to the next random call, -1 for none */
  randomLeftMs: number;
  /** Frames the loop's position update still skips, see WAITING_LOOP_SKIPS */
  waitingSkips: number;
}

/** Sound ids of a type: one registration per type, not per enemy. They contain `enemy` for the enemy-sound budget. */
function movingId(type: EnemyTypeConfig): string {
  return `enemy-${type.id}_moving`;
}
function randomId(type: EnemyTypeConfig): string {
  return `enemy-${type.id}_randomSound`;
}

/**
 * The enemies' own sounds (FramePresenter): the moving loop of a type with
 * a movingSound while the enemy walks (E_FLAGS EF_MOVING), and the random
 * calls of a type with a randomSound, at random volume and interval in game
 * time. Sound only: the random draws here are Math.random, never the
 * simulation's.
 */
export class EnemySounds {
  private readonly voices = new Map<number, EnemyVoice>();
  private readonly registered = new Set<string>();
  private registeredWith: SpatialAudioManager | null = null;

  /**
   * One frame of enemy `num`: its loop starts when it walks, follows it to
   * `at` (local), stops when it stands; its random call counts `deltaMs` of
   * game time. `lat`, `lon`, `height` are where a random call plays.
   */
  present(
    num: number,
    type: EnemyTypeConfig,
    moving: boolean,
    at: Vector3,
    lat: number,
    lon: number,
    height: number,
    deltaMs: number,
    audio: SpatialAudioManager,
  ): void {
    let voice = this.voices.get(num);
    if (!moving) {
      if (voice !== undefined) this.forget(num, audio);
      return;
    }
    if (!type.movingSound && !type.randomSound) return;
    if (voice === undefined) {
      this.register(type, audio);
      voice = { loop: null, ended: false, randomLeftMs: -1, waitingSkips: 0 };
      this.voices.set(num, voice);
      if (type.movingSound) this.startLoop(voice, type, at, audio);
      if (type.randomSound) voice.randomLeftMs = nextRandomInterval(type);
      return;
    }
    if (voice.loop !== null) {
      if (voice.waitingSkips > 0) voice.waitingSkips--;
      else if (!audio.updateLoopPosition(voice.loop, at)) voice.waitingSkips = WAITING_LOOP_SKIPS;
    }
    if (voice.randomLeftMs >= 0) {
      voice.randomLeftMs -= deltaMs;
      if (voice.randomLeftMs <= 0) {
        const minVol = type.randomSoundVolumeMin ?? 0.2;
        const maxVol = type.randomSoundVolumeMax ?? 0.6;
        const volume = minVol + Math.random() * (maxVol - minVol);
        audio.playAtGeo(randomId(type), lat, lon, height, volume).catch(() => undefined);
        voice.randomLeftMs = nextRandomInterval(type);
      }
    }
  }

  /** Enemy `num` stopped or left: its loop ends, one still loading ends as it arrives. */
  forget(num: number, audio: SpatialAudioManager | null): void {
    const voice = this.voices.get(num);
    if (voice === undefined) return;
    this.voices.delete(num);
    voice.ended = true;
    if (voice.loop !== null) audio?.stopLoop(voice.loop);
    voice.loop = null;
  }

  /** The enemies with a voice, for the presenter's sweep of the gone ones. */
  has(num: number): boolean {
    return this.voices.has(num);
  }

  nums(): IterableIterator<number> {
    return this.voices.keys();
  }

  /** Every voice ends. */
  clear(audio: SpatialAudioManager | null): void {
    for (const num of [...this.voices.keys()]) this.forget(num, audio);
  }

  private register(type: EnemyTypeConfig, audio: SpatialAudioManager): void {
    if (this.registeredWith !== audio) {
      this.registeredWith = audio;
      this.registered.clear();
    }
    if (this.registered.has(type.id)) return;
    this.registered.add(type.id);
    if (type.movingSound) {
      audio.registerSound(movingId(type), type.movingSound, {
        refDistance: type.movingSoundRefDistance ?? 30,
        rolloffFactor: 1,
        volume: type.movingSoundVolume ?? 0.3,
        loop: true,
      });
    }
    // At volume 1: each call picks its own volume between randomSoundVolumeMin and Max
    if (type.randomSound) {
      audio.registerSound(randomId(type), type.randomSound, {
        refDistance: type.randomSoundRefDistance ?? 30,
        rolloffFactor: 1,
        volume: 1,
        loop: false,
      });
    }
  }

  private startLoop(voice: EnemyVoice, type: EnemyTypeConfig, at: Vector3, audio: SpatialAudioManager): void {
    // createLoop copies the position before it awaits
    void audio
      .createLoop(movingId(type), at, { volumeMultiplier: 1, randomStart: type.randomSoundStart ?? false })
      .then((handle) => {
        if (handle === null) return;
        if (voice.ended) audio.stopLoop(handle);
        else voice.loop = handle;
      });
  }
}

function nextRandomInterval(type: EnemyTypeConfig): number {
  const minInterval = type.randomSoundMinInterval ?? 2000;
  const maxInterval = type.randomSoundMaxInterval ?? 5000;
  return minInterval + Math.random() * (maxInterval - minInterval);
}
