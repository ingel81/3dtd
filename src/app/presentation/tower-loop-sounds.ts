import { Vector3 } from 'three';
import type { SpatialAudioManager } from '../managers/audio/spatial-audio.manager';
import type { LoopHandle } from '../managers/audio/spatial-audio-loops';

/** A loop whose createLoop is still in flight */
const PENDING: LoopHandle = -1; // real handles count up from 1
/** A loop's level changes less than this: not set again (it is set every frame otherwise) */
const LEVEL_STEP = 0.01;

/** What a tower that works sounds like (registered in combat-sounds.ts) */
export interface TowerLoopSound {
  /** Runs while the tower works */
  loop: string;
  /** Once at the tower as it starts working from rest (a spin-up, the beam's ignition) */
  start?: string;
  /** Seconds the loop fades in over after a start, so the start is heard first; 0 or none: at once */
  ramp?: number;
  /** A second loop while it bites (the saws under load), at the place it bites */
  load?: string;
  /** Seconds of game time the loop runs on, idling, after the work stops; a start within it is no new start */
  linger?: number;
}

interface Running {
  loop: LoopHandle;
  load: LoopHandle | null;
  /** Seconds since the start, for the ramp */
  age: number;
  /** Seconds since the work stopped, null while it works */
  idle: number | null;
  drive: number;
  level: number;
  loadLevel: number;
}

/**
 * The working sound of towers that run rather than shoot, driven by the ops
 * the simulation sends (PresentationHost hooks): the fire towers' flame loop,
 * the Sentinel Laser's beam, the Chainsaw's motors and saws, the Shawarma
 * Slicer's machine. `work` every frame a tower works (the first one from rest
 * plays the start and starts the loop), `rest` when it stops (the loop ends,
 * or idles on for `linger`), `advance` steps ramp and linger in game time.
 * The loops stand in a pause like every loop (holdLoops).
 */
export class TowerLoopSounds {
  private readonly running = new Map<string, Running>();
  private readonly at = new Vector3();

  constructor(
    private readonly audio: () => SpatialAudioManager | null,
    private readonly sound: TowerLoopSound,
  ) {}

  /**
   * `towerId` works this frame, its sound at local `position`. `drive` (0..1)
   * scales the loop (a machine spinning up or down); `load` (0..1) the load
   * loop at `loadAt`, 0 stops it.
   */
  work(
    towerId: string,
    position: { x: number; y: number; z: number },
    drive = 1,
    load = 0,
    loadAt: { x: number; y: number; z: number } = position,
  ): void {
    const audio = this.audio();
    if (!audio) return;
    this.at.set(position.x, position.y, position.z);
    let r = this.running.get(towerId);
    if (!r) {
      r = { loop: PENDING, load: null, age: 0, idle: null, drive, level: -1, loadLevel: 0 };
      this.running.set(towerId, r);
      if (this.sound.start) audio.playAt(this.sound.start, this.at.clone()).catch(() => undefined);
      this.create(towerId, r, this.sound.loop, this.at, (handle) => (r!.loop = handle));
    } else if (r.loop !== PENDING) audio.updateLoopPosition(r.loop, this.at);
    r.idle = null;
    r.drive = drive;
    this.setLevel(r);
    this.setLoad(towerId, r, load, loadAt);
  }

  /** `towerId` stopped working: its load at once, its loop now or after `linger`. */
  rest(towerId: string): void {
    const r = this.running.get(towerId);
    if (!r) return;
    this.setLoad(towerId, r, 0, this.at);
    if (this.sound.linger) {
      r.idle ??= 0;
      return;
    }
    this.end(towerId);
  }

  /** Every frame in game time: the ramps and the lingering loops. */
  advance(gameTimeDeltaMs: number): void {
    const dt = gameTimeDeltaMs / 1000;
    if (dt <= 0) return;
    for (const [towerId, r] of this.running) {
      r.age += dt;
      if (r.idle !== null) {
        r.idle += dt;
        if (r.idle >= (this.sound.linger ?? 0)) {
          this.end(towerId);
          continue;
        }
      }
      this.setLevel(r);
    }
  }

  /** Every tower stopped, at once. */
  clear(): void {
    for (const towerId of [...this.running.keys()]) this.end(towerId);
  }

  get size(): number {
    return this.running.size;
  }

  /** The loop at its ramp times its drive, quieter while it idles */
  private setLevel(r: Running): void {
    if (r.loop === PENDING) return;
    const ramp = this.sound.ramp ? Math.min(1, r.age / this.sound.ramp) : 1;
    const level = ramp * r.drive * (r.idle === null ? 1 : 0.6);
    if (Math.abs(level - r.level) < LEVEL_STEP) return;
    r.level = level;
    this.audio()?.setLoopVolume(r.loop, level);
  }

  private setLoad(towerId: string, r: Running, load: number, at: { x: number; y: number; z: number }): void {
    if (!this.sound.load) return;
    const audio = this.audio();
    if (!audio) return;
    if (load <= 0) {
      if (r.load !== null && r.load !== PENDING) audio.stopLoop(r.load);
      r.load = null;
      r.loadLevel = 0;
      return;
    }
    const position = new Vector3(at.x, at.y, at.z);
    if (r.load === null) {
      r.load = PENDING;
      r.loadLevel = load;
      this.create(towerId, r, this.sound.load, position, (handle) => (r.load = handle), load);
      return;
    }
    if (r.load === PENDING) {
      r.loadLevel = load;
      return;
    }
    audio.updateLoopPosition(r.load, position);
    if (Math.abs(load - r.loadLevel) >= LEVEL_STEP) {
      r.loadLevel = load;
      audio.setLoopVolume(r.load, load);
    }
  }

  /**
   * A loop of `soundId` for `r`; `assign` takes the handle unless the tower
   * stopped (or its load did) while it loaded, then the loop ends at once
   */
  private create(towerId: string, r: Running, soundId: string, position: Vector3, assign: (h: LoopHandle) => void, volume = 0): void {
    const audio = this.audio();
    if (!audio) return;
    const isLoad = soundId === this.sound.load && soundId !== this.sound.loop;
    // createLoop copies the position before it awaits; a ramp starts silent
    void audio.createLoop(soundId, position, { volumeMultiplier: isLoad ? volume : this.sound.ramp ? 0 : r.drive }).then((created) => {
      const still = this.running.get(towerId) === r && (isLoad ? r.load === PENDING : r.loop === PENDING);
      if (created === null) {
        if (still) {
          if (isLoad) r.load = null;
          else this.running.delete(towerId);
        }
        return;
      }
      if (!still) {
        audio.stopLoop(created);
        return;
      }
      assign(created);
      if (isLoad) {
        if (r.loadLevel !== volume) audio.setLoopVolume(created, r.loadLevel);
      } else {
        r.level = -1;
        this.setLevel(r);
      }
    });
  }

  private end(towerId: string): void {
    const r = this.running.get(towerId);
    if (!r) return;
    this.running.delete(towerId);
    const audio = this.audio();
    if (r.loop !== PENDING) audio?.stopLoop(r.loop);
    if (r.load !== null && r.load !== PENDING) audio?.stopLoop(r.load);
  }
}
