import { Object3D, PositionalAudio, Vector3 } from 'three';
import { AudioPoolManager } from './audio-pool.manager';
import { RegisteredSound, SpatialAudioPlayback } from './spatial-audio-playback';
import { EnemySoundBudget, isEnemySoundId } from './enemy-sound-budget';

/**
 * Addresses a loop. A number rather than a string: SpiderMonkey atomizes a
 * string on every Map lookup, and a moving enemy looks its loop up once per
 * sub-step (Firefox profile 2026-09-19, 5000 enemies: about 55 ms/s in the
 * atoms table along the loop updates; numbers hash directly).
 */
export type LoopHandle = number;

/** The audio of a loop that has played, in its container in the scene */
interface LoopVoice {
  audio: PositionalAudio;
  container: Object3D;
}

/**
 * Active looping sound (managed centrally)
 */
interface ActiveLoop {
  handle: LoopHandle;
  soundId: string;
  buffer: AudioBuffer;
  config: RegisteredSound['config'];
  /** Where the loop is; the container follows once there is one */
  position: Vector3;
  /** Made the first time the loop plays; null while it waits to join */
  voice: LoopVoice | null;
  isEnemySound: boolean;
  paused: boolean;
  baseVolume: number;
  randomStart: boolean;
}

/**
 * Looping positional sounds (walk cycles, fire, engines), addressed by
 * handle. A loop plays within earshot; an enemy loop also needs a slot of
 * the enemy budget. One that cannot play yet (out of earshot, budget full,
 * game paused) waits paused, without audio, and joins on a later position
 * update. A loop that leaves the audible range pauses and gives its
 * enemy-budget slot back; coming back into range resumes it if a slot is
 * free. While the game is paused every loop stands (hold).
 */
export class SpatialAudioLoops {
  private activeLoops = new Map<LoopHandle, ActiveLoop>();
  private loopHandleCounter = 0;
  private masterVolume = 1.0;
  /** The game is paused, see hold() */
  private held = false;

  constructor(
    private readonly pool: AudioPoolManager,
    private readonly playback: SpatialAudioPlayback,
    private readonly sounds: Map<string, RegisteredSound>,
    private readonly enemyBudget: EnemySoundBudget,
  ) {}

  /** Number of loops, running, paused or waiting to join. */
  get size(): number {
    return this.activeLoops.size;
  }

  /** Sound id and pause state of every loop, for the debug log. */
  describe(): { id: string; paused: boolean }[] {
    return Array.from(this.activeLoops.values()).map(l => ({ id: l.soundId, paused: l.paused }));
  }

  /** Master SFX volume (0-1, already clamped). Applies to running loops now. */
  setMasterVolume(vol: number): void {
    this.masterVolume = vol;
    for (const loop of this.activeLoops.values()) {
      if (!loop.paused) {
        loop.voice?.audio.setVolume(loop.baseVolume * this.masterVolume);
      }
    }
  }

  /**
   * A loop of `soundId` at `position`. It plays at once within earshot, while
   * not held and, for an enemy sound, with a free budget slot. Otherwise it
   * waits paused and joins on a later updatePosition() in earshot with a
   * free slot, or on hold(false). Null only for an unknown sound or one
   * without a buffer.
   */
  async create(
    soundId: string,
    position: Vector3,
    config?: { volumeMultiplier?: number; randomStart?: boolean }
  ): Promise<LoopHandle | null> {
    const sound = this.sounds.get(soundId);
    if (!sound) {
      console.warn(`[SpatialAudio] Sound not registered: ${soundId}`);
      return null;
    }
    // The caller may reuse its vector while the awaits below run
    const at = position.clone();

    await this.playback.resumeContext();

    if (sound.loading) {
      await sound.loading;
    }
    if (!sound.buffer) {
      console.warn(`[SpatialAudio] No buffer for: ${soundId}`);
      return null;
    }

    const handle: LoopHandle = ++this.loopHandleCounter;
    const loop: ActiveLoop = {
      handle,
      soundId,
      buffer: sound.buffer,
      config: sound.config,
      position: at,
      voice: null,
      isEnemySound: isEnemySoundId(soundId),
      paused: true,
      baseVolume: sound.config.volume * (config?.volumeMultiplier ?? 1.0),
      randomStart: config?.randomStart ?? false,
    };
    this.activeLoops.set(handle, loop);

    // Nothing awaits between this check and the slot resumeLoop takes, so
    // parallel creates cannot overbook the enemy budget
    if (!this.held && this.playback.isWithinAudibleDistance(at)) {
      this.resumeLoop(loop);
    }

    return handle;
  }

  /**
   * The game paused (true) or went on. The loops keep to game time: while
   * held every loop stands and none resumes or joins, not on a position
   * update in range and not through resume(); one created meanwhile waits.
   * Going on resumes the loops within earshot, enemy loops as far as the
   * budget allows; the rest resume on a later position update as before.
   */
  hold(held: boolean): void {
    if (this.held === held) return;
    this.held = held;
    for (const loop of this.activeLoops.values()) {
      if (held) {
        if (!loop.paused) this.pauseLoop(loop);
      } else if (loop.paused && this.playback.isWithinAudibleDistance(loop.position)) {
        this.resumeLoop(loop);
      }
    }
  }

  /**
   * Move a loop; it pauses out of earshot and joins or resumes in earshot
   * (budget permitting). True while it plays afterwards, false while it
   * waits, which lets a caller update a waiting loop less often.
   */
  updatePosition(handle: LoopHandle, position: Vector3): boolean {
    const loop = this.activeLoops.get(handle);
    if (!loop) return false;

    loop.position.copy(position);
    loop.voice?.container.position.copy(position);
    if (this.held) return !loop.paused;

    if (loop.paused) {
      // No slot to take: the distance check can wait. The common case with
      // many enemies near the camera, every one of them asking each sub-step.
      if (loop.isEnemySound && !this.enemyBudget.canReserve()) return false;
      if (this.playback.isWithinAudibleDistance(position)) this.resumeLoop(loop);
    } else if (!this.playback.isWithinAudibleDistance(position)) {
      this.pauseLoop(loop);
    }
    return !loop.paused;
  }

  pause(handle: LoopHandle): void {
    const loop = this.activeLoops.get(handle);
    if (loop && !loop.paused) {
      this.pauseLoop(loop);
    }
  }

  /** False while held (see hold()) or the enemy budget is full. */
  resume(handle: LoopHandle): boolean {
    const loop = this.activeLoops.get(handle);
    if (!loop || !loop.paused) return true;
    if (this.held) return false;
    return this.resumeLoop(loop);
  }

  stop(handle: LoopHandle): void {
    const loop = this.activeLoops.get(handle);
    if (!loop) return;

    if (loop.isEnemySound && !loop.paused) {
      this.enemyBudget.release();
    }

    if (loop.voice !== null) {
      this.pool.cleanupAudio(loop.voice.audio);
      this.pool.removeContainer(loop.voice.container);
    }
    this.activeLoops.delete(handle);
  }

  stopAll(): void {
    const loopHandles = Array.from(this.activeLoops.keys());
    for (const handle of loopHandles) {
      this.stop(handle);
    }
  }

  isPaused(handle: LoopHandle): boolean {
    return this.activeLoops.get(handle)?.paused ?? false;
  }

  /**
   * Loop `handle` at `volumeMultiplier` times its sound's volume from now on
   * (a fade the caller steps). A paused loop takes it when it resumes.
   */
  setVolume(handle: LoopHandle, volumeMultiplier: number): void {
    const loop = this.activeLoops.get(handle);
    if (!loop) return;
    loop.baseVolume = loop.config.volume * volumeMultiplier;
    if (!loop.paused) loop.voice?.audio.setVolume(loop.baseVolume * this.masterVolume);
  }

  private pauseLoop(loop: ActiveLoop): void {
    try {
      loop.voice?.audio.pause();
      loop.paused = true;
      if (loop.isEnemySound) {
        this.enemyBudget.release();
      }
    } catch (e) {
      console.warn(`[SpatialAudio] pauseLoop failed:`, e);
    }
  }

  /** Plays a paused loop; the first time, its audio is made here. */
  private resumeLoop(loop: ActiveLoop): boolean {
    if (loop.isEnemySound) {
      if (!this.enemyBudget.reserve()) {
        return false;
      }
    }

    try {
      const voice = loop.voice ?? (loop.voice = this.makeVoice(loop));
      voice.container.updateMatrixWorld(true);
      this.pool.updatePannerPosition(voice.audio);
      // setMasterVolume() skips paused loops: one changed meanwhile applies now
      voice.audio.setVolume(loop.baseVolume * this.masterVolume);

      voice.audio.play();
      loop.paused = false;
      return true;
    } catch (e) {
      console.warn(`[SpatialAudio] resumeLoop failed:`, e);
      if (loop.isEnemySound) {
        this.enemyBudget.release();
      }
      return false;
    }
  }

  /** The audio of a loop about to play for the first time, at its position. */
  private makeVoice(loop: ActiveLoop): LoopVoice {
    const { buffer, config } = loop;
    const audio = this.pool.createAudio();
    audio.setBuffer(buffer);
    audio.setRefDistance(config.refDistance);
    audio.setRolloffFactor(config.rolloffFactor);
    audio.setDistanceModel(config.distanceModel);
    audio.setLoop(true);

    if (config.maxDistance > 0) {
      audio.setMaxDistance(config.maxDistance);
    }

    if (loop.randomStart && buffer.duration > 0) {
      audio.offset = Math.random() * buffer.duration;
    }

    return { audio, container: this.pool.createContainerAtPosition(audio, loop.position) };
  }
}
