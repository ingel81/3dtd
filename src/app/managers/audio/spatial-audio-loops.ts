import { Object3D, PositionalAudio, Vector3 } from 'three';
import { AudioPoolManager } from './audio-pool.manager';
import { RegisteredSound, SpatialAudioPlayback } from './spatial-audio-playback';
import { EnemySoundBudget, isEnemySoundId } from './enemy-sound-budget';

/**
 * Active looping sound (managed centrally)
 */
interface ActiveLoop {
  handle: string;
  soundId: string;
  audio: PositionalAudio;
  container: Object3D;
  isEnemySound: boolean;
  paused: boolean;
  baseVolume: number;
}

/**
 * Looping positional sounds (walk cycles, fire, engines), addressed by
 * handle. A loop that leaves the audible range pauses and gives its
 * enemy-budget slot back; coming back into range resumes it if a slot is
 * free.
 */
export class SpatialAudioLoops {
  private activeLoops = new Map<string, ActiveLoop>();
  private loopHandleCounter = 0;
  private masterVolume = 1.0;

  constructor(
    private readonly pool: AudioPoolManager,
    private readonly playback: SpatialAudioPlayback,
    private readonly sounds: Map<string, RegisteredSound>,
    private readonly enemyBudget: EnemySoundBudget,
  ) {}

  /** Number of loops, running or paused. */
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
        loop.audio.setVolume(loop.baseVolume * this.masterVolume);
      }
    }
  }

  async create(
    soundId: string,
    position: Vector3,
    config?: { volumeMultiplier?: number; randomStart?: boolean }
  ): Promise<string | null> {
    const sound = this.sounds.get(soundId);
    if (!sound) {
      console.warn(`[SpatialAudio] Sound not registered: ${soundId}`);
      return null;
    }

    const isEnemySound = isEnemySoundId(soundId);
    if (isEnemySound) {
      if (!this.enemyBudget.reserve()) {
        return null;
      }
    }

    if (!this.playback.isWithinAudibleDistance(position)) {
      if (isEnemySound) {
        this.enemyBudget.release();
      }
      return null;
    }

    await this.playback.resumeContext();

    if (sound.loading) {
      await sound.loading;
    }
    if (!sound.buffer) {
      console.warn(`[SpatialAudio] No buffer for: ${soundId}`);
      if (isEnemySound) {
        this.enemyBudget.release();
      }
      return null;
    }

    const audio = this.pool.createAudio();
    audio.setBuffer(sound.buffer);
    audio.setRefDistance(sound.config.refDistance);
    audio.setRolloffFactor(sound.config.rolloffFactor);
    audio.setDistanceModel(sound.config.distanceModel);
    const baseVolume = sound.config.volume * (config?.volumeMultiplier ?? 1.0);
    audio.setVolume(baseVolume * this.masterVolume);
    audio.setLoop(true);

    if (sound.config.maxDistance > 0) {
      audio.setMaxDistance(sound.config.maxDistance);
    }

    if (config?.randomStart && sound.buffer.duration > 0) {
      audio.offset = Math.random() * sound.buffer.duration;
    }

    const container = this.pool.createContainerAtPosition(audio, position);

    const handle = `loop_${++this.loopHandleCounter}`;

    const activeLoop: ActiveLoop = {
      handle,
      soundId,
      audio,
      container,
      isEnemySound,
      paused: false,
      baseVolume,
    };
    this.activeLoops.set(handle, activeLoop);

    audio.play();

    return handle;
  }

  updatePosition(handle: string, position: Vector3): void {
    const loop = this.activeLoops.get(handle);
    if (!loop) return;

    loop.container.position.copy(position);

    const isInRange = this.playback.isWithinAudibleDistance(position);

    if (!isInRange && !loop.paused) {
      this.pauseLoop(loop);
    } else if (isInRange && loop.paused) {
      this.resumeLoop(loop);
    }
  }

  pause(handle: string): void {
    const loop = this.activeLoops.get(handle);
    if (loop && !loop.paused) {
      this.pauseLoop(loop);
    }
  }

  resume(handle: string): boolean {
    const loop = this.activeLoops.get(handle);
    if (!loop || !loop.paused) return true;
    return this.resumeLoop(loop);
  }

  stop(handle: string): void {
    const loop = this.activeLoops.get(handle);
    if (!loop) return;

    if (loop.isEnemySound && !loop.paused) {
      this.enemyBudget.release();
    }

    this.pool.cleanupAudio(loop.audio);
    this.pool.removeContainer(loop.container);
    this.activeLoops.delete(handle);
  }

  stopAll(): void {
    const loopHandles = Array.from(this.activeLoops.keys());
    for (const handle of loopHandles) {
      this.stop(handle);
    }
  }

  isPaused(handle: string): boolean {
    return this.activeLoops.get(handle)?.paused ?? false;
  }

  private pauseLoop(loop: ActiveLoop): void {
    try {
      loop.audio.pause();
      loop.paused = true;
      if (loop.isEnemySound) {
        this.enemyBudget.release();
      }
    } catch (e) {
      console.warn(`[SpatialAudio] pauseLoop failed:`, e);
    }
  }

  private resumeLoop(loop: ActiveLoop): boolean {
    if (loop.isEnemySound) {
      if (!this.enemyBudget.reserve()) {
        return false;
      }
    }

    try {
      loop.container.updateMatrixWorld(true);
      this.pool.updatePannerPosition(loop.audio);

      loop.audio.play();
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
}
