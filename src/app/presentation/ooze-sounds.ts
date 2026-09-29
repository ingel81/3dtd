import { Vector3 } from 'three';
import type { LoopHandle } from '../managers/audio/spatial-audio-loops';
import type { SpatialAudioManager } from '../managers/audio/spatial-audio.manager';
import { OOZE_SOUNDS } from '../configs/audio.config';
import { oozeSoundUrls } from '../utils/ooze-sound';

/** The bubbling loop of one ooze */
interface OozeLoop {
  handle: LoopHandle | null;
  /** createLoop is still in flight */
  pending: boolean;
  /** createLoop gave nothing (no buffer): not asked again */
  failed: boolean;
}

/**
 * The oozes' sounds, for OozePresenter: a bubbling loop per ooze that moves
 * once per frame to the body point nearest the listener, and a splat when
 * one breaks up (OOZE_SOUNDS). The slurp while one flows into the HQ comes
 * from the simulation as audio:play; it is registered here with the others.
 */
export class OozeSounds {
  private registeredWith: SpatialAudioManager | null = null;
  private readonly loops = new Map<string, OozeLoop>();
  private readonly at = new Vector3();

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
   * Once per frame: the loop of ooze `id` moves to local (x, y, z). The
   * first call asks for the loop; out of earshot it waits in
   * SpatialAudioLoops and joins once the point comes within earshot.
   */
  follow(id: string, audio: SpatialAudioManager, x: number, y: number, z: number): void {
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
    if (loop.pending || loop.failed) return;

    loop.pending = true;
    const started = loop;
    // createLoop copies the position before it awaits
    void audio.createLoop(OOZE_SOUNDS.bubble.id, this.at, { randomStart: true }).then((handle) => {
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
    });
  }

  /** The splat of a breaking ooze at a geo point, `height` on the ground. */
  splat(audio: SpatialAudioManager, lat: number, lon: number, height: number): void {
    audio.playAtGeo(OOZE_SOUNDS.splat.id, lat, lon, height).catch(() => undefined);
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
