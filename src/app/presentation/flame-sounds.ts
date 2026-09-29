import { Vector3 } from 'three';
import type { SpatialAudioManager } from '../managers/audio/spatial-audio.manager';
import type { LoopHandle } from '../managers/audio/spatial-audio-loops';

/** A flame loop whose createLoop is still in flight */
const PENDING: LoopHandle = -1; // real handles count up from 1

/**
 * The fire towers' flame loops, driven by the flame beam ops the simulation
 * sends (OpPlayer hooks): `flameBeams.startBeam` starts the loop at the
 * tower or moves it there, `flameBeams.stopBeam` ends it, `flameBeams.clear`
 * ends them all. The loops stand in a pause like every loop (holdLoops).
 */
export class FlameSounds {
  private readonly loops = new Map<string, LoopHandle>();
  private readonly at = new Vector3();

  constructor(private readonly audio: () => SpatialAudioManager | null) {}

  /** The beam of `towerId` burns, its tower at local `position`. */
  burn(towerId: string, position: { x: number; y: number; z: number }): void {
    const audio = this.audio();
    if (!audio) return;
    this.at.set(position.x, position.y, position.z);
    const handle = this.loops.get(towerId);
    if (handle === undefined) {
      this.loops.set(towerId, PENDING);
      // createLoop copies the position before it awaits
      void audio.createLoop('flame-loop', this.at, { volumeMultiplier: 1 }).then((created) => {
        if (created === null) {
          if (this.loops.get(towerId) === PENDING) this.loops.delete(towerId);
          return;
        }
        // Stopped while it was loading: the loop would play into the void
        if (this.loops.get(towerId) === PENDING) this.loops.set(towerId, created);
        else audio.stopLoop(created);
      });
      return;
    }
    if (handle !== PENDING) audio.updateLoopPosition(handle, this.at);
  }

  /** The beam of `towerId` went out. */
  stop(towerId: string): void {
    const handle = this.loops.get(towerId);
    if (handle === undefined) return;
    this.loops.delete(towerId);
    if (handle !== PENDING) this.audio()?.stopLoop(handle);
  }

  /** Every beam went out. */
  clear(): void {
    for (const towerId of [...this.loops.keys()]) this.stop(towerId);
  }

  get size(): number {
    return this.loops.size;
  }
}
