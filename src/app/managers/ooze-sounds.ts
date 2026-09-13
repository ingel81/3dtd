import { Vector3 } from 'three';
import type { GameEventBus } from '../game-engine';
import type { SpatialAudioManager } from './audio/spatial-audio.manager';
import { OOZE_SOUNDS } from '../configs/audio.config';
import { oozeSoundUrls } from '../utils/ooze-sound';

/** The bubbling loop of one ooze */
interface OozeLoop {
  handle: string | null;
  /** createLoop is still in flight */
  pending: boolean;
  /** createLoop gave nothing although the ooze was in range (no buffer): not asked again */
  failed: boolean;
}

/**
 * The oozes' sounds, for OozeBodies: a bubbling loop per ooze that the
 * bodies move once per frame to the point nearest the listener, a splat
 * when one breaks up and a slurp while one flows into the HQ (OOZE_SOUNDS).
 * The loops stand while the game is paused (hold); the one-shots go out as
 * audio:play from the sub-step, so they keep to game time as well.
 */
export class OozeSounds {
  private registeredWith: SpatialAudioManager | null = null;
  private readonly loops = new Map<string, OozeLoop>();
  private held = false;
  private readonly at = new Vector3();

  constructor(private readonly eventBus: GameEventBus) {}

  /** Registers the sounds with `audio`, synthesising them the first time an ooze appears. */
  register(audio: SpatialAudioManager): void {
    if (this.registeredWith === audio) return;
    this.registeredWith = audio;
    const urls = oozeSoundUrls();
    const { bubble, splat, slurp } = OOZE_SOUNDS;
    audio.registerSound(bubble.id, urls.bubble, { ...config(bubble), loop: true });
    audio.registerSound(splat.id, urls.splat, config(splat));
    audio.registerSound(slurp.id, urls.slurp, { ...config(slurp), minIntervalMs: slurp.minIntervalMs });
  }

  /**
   * Once per render frame: the loop of ooze `id` moves to local (x, y, z).
   * One that has none yet starts there once the point is within earshot
   * (createLoop gives nothing beyond it). SpatialAudioLoops pauses it out of
   * range and resumes it back in range.
   */
  follow(id: string, audio: SpatialAudioManager, x: number, y: number, z: number): void {
    if (this.held) return;
    this.at.set(x, y, z);
    let loop = this.loops.get(id);
    if (loop === undefined) {
      loop = { handle: null, pending: false, failed: false };
      this.loops.set(id, loop);
    }
    if (loop.handle !== null) {
      audio.updateLoopPosition(loop.handle, this.at);
      return;
    }
    if (loop.pending || loop.failed || !audio.isWithinAudibleDistance(this.at)) return;

    loop.pending = true;
    const started = loop;
    void audio.createLoop(OOZE_SOUNDS.bubble.id, this.at.clone(), { randomStart: true }).then((handle) => {
      started.pending = false;
      // The ooze went while the loop was loading
      if (this.loops.get(id) !== started) {
        if (handle !== null) audio.stopLoop(handle);
        return;
      }
      if (handle === null) {
        started.failed = true;
        return;
      }
      started.handle = handle;
      if (this.held) audio.pauseLoop(handle);
    });
  }

  /** The game paused (true) or went on: the loops stand and go with the game time. */
  hold(held: boolean, audio: SpatialAudioManager | null): void {
    if (this.held === held) return;
    this.held = held;
    if (audio === null) return;
    for (const loop of this.loops.values()) {
      if (loop.handle === null) continue;
      if (held) audio.pauseLoop(loop.handle);
      else audio.resumeLoop(loop.handle);
    }
  }

  /** The splat of a breaking ooze at a geo point, `height` on the ground. */
  splat(lat: number, lon: number, height: number): void {
    this.eventBus.emitDeferred({ type: 'audio:play', sound: OOZE_SOUNDS.splat.id, lat, lon, height });
  }

  /** A slurp of body flowing into the HQ at a geo point. */
  slurp(lat: number, lon: number, height: number): void {
    this.eventBus.emitDeferred({ type: 'audio:play', sound: OOZE_SOUNDS.slurp.id, lat, lon, height });
  }

  /** Ooze `id` is gone: its loop ends, one still loading ends when it arrives. */
  stop(id: string, audio: SpatialAudioManager | null): void {
    const loop = this.loops.get(id);
    if (loop === undefined) return;
    this.loops.delete(id);
    if (loop.handle !== null) audio?.stopLoop(loop.handle);
  }

  /** Every loop ends (reset, game over). */
  clear(audio: SpatialAudioManager | null): void {
    for (const id of [...this.loops.keys()]) this.stop(id, audio);
  }
}

/** The spatial settings of an OOZE_SOUNDS entry */
function config(sound: { refDistance: number; rolloffFactor: number; volume: number }) {
  return { refDistance: sound.refDistance, rolloffFactor: sound.rolloffFactor, volume: sound.volume };
}
