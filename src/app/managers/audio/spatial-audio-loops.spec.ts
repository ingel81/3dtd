import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Vector3 } from 'three';
import { SpatialAudioLoops } from './spatial-audio-loops';
import { EnemySoundBudget } from './enemy-sound-budget';
import type { AudioPoolManager } from './audio-pool.manager';
import type { RegisteredSound, SpatialAudioPlayback } from './spatial-audio-playback';
import { AUDIO_LIMITS, SPATIAL_AUDIO_DEFAULTS } from '../../configs/audio.config';

/**
 * Loops against a fake pool and playback: the enemy-budget bookkeeping
 * across create, pause, resume and stop, and the master volume. The manager
 * spec runs the same paths through the real pool with fake Web Audio.
 */

class FakeAudio {
  isPlaying = false;
  volume = 1;
  loop = false;
  offset = 0;
  setBuffer() { return this; }
  setRefDistance() { return this; }
  setRolloffFactor() { return this; }
  setDistanceModel() { return this; }
  setMaxDistance() { return this; }
  setVolume(v: number) { this.volume = v; return this; }
  setLoop(l: boolean) { this.loop = l; return this; }
  play() { this.isPlaying = true; return this; }
  pause() { this.isPlaying = false; return this; }
}

const HERE = new Vector3(1, 0, 0);

function registered(volume = 1, buffer: AudioBuffer | null = { duration: 4 } as AudioBuffer): RegisteredSound {
  return {
    buffer,
    loading: null,
    config: {
      refDistance: SPATIAL_AUDIO_DEFAULTS.refDistance,
      rolloffFactor: SPATIAL_AUDIO_DEFAULTS.rolloffFactor,
      maxDistance: 0,
      distanceModel: SPATIAL_AUDIO_DEFAULTS.distanceModel,
      volume,
      loop: true,
      minIntervalMs: -1,
      maxInstances: -1,
    },
  };
}

describe('SpatialAudioLoops', () => {
  let audible: boolean;
  let audios: FakeAudio[];
  let pool: Record<
    'createAudio' | 'createContainerAtPosition' | 'cleanupAudio' | 'removeContainer' | 'updatePannerPosition',
    ReturnType<typeof vi.fn>
  >;
  let sounds: Map<string, RegisteredSound>;
  let budget: EnemySoundBudget;
  let loops: SpatialAudioLoops;

  beforeEach(() => {
    audible = true;
    audios = [];
    pool = {
      createAudio: vi.fn(() => {
        const audio = new FakeAudio();
        audios.push(audio);
        return audio;
      }),
      createContainerAtPosition: vi.fn((_audio: unknown, position: Vector3) => ({
        position: position.clone(),
        updateMatrixWorld: vi.fn(),
      })),
      cleanupAudio: vi.fn(),
      removeContainer: vi.fn(),
      updatePannerPosition: vi.fn(),
    };
    const playback = {
      isWithinAudibleDistance: () => audible,
      resumeContext: vi.fn(async () => undefined),
    };
    sounds = new Map([['zombie_walk', registered()], ['fire', registered(0.8)]]);
    budget = new EnemySoundBudget();
    loops = new SpatialAudioLoops(
      pool as unknown as AudioPoolManager,
      playback as unknown as SpatialAudioPlayback,
      sounds,
      budget,
    );
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('takes an enemy slot for an enemy loop and gives it back on stop', async () => {
    const handle = await loops.create('zombie_walk', HERE);
    await loops.create('fire', HERE);

    expect(budget.stats().current).toBe(1);
    expect(loops.size).toBe(2);
    expect(audios[0].isPlaying).toBe(true);
    expect(audios[0].loop).toBe(true);

    loops.stop(handle!);
    loops.stop(handle!);
    expect(budget.stats().current).toBe(0);
    expect(loops.size).toBe(1);
    expect(pool.cleanupAudio).toHaveBeenCalledTimes(1);
  });

  it('refuses a loop out of range or without a buffer, and returns the slot', async () => {
    audible = false;
    expect(await loops.create('zombie_walk', HERE)).toBeNull();

    audible = true;
    sounds.set('zombie_walk', registered(1, null));
    expect(await loops.create('zombie_walk', HERE)).toBeNull();

    expect(await loops.create('nope', HERE)).toBeNull();
    expect(budget.stats().current).toBe(0);
    expect(pool.createAudio).not.toHaveBeenCalled();
  });

  it('waits for a buffer that is still loading', async () => {
    const pending = registered(1, null);
    let finish!: () => void;
    pending.loading = new Promise((resolve) => {
      finish = () => {
        pending.buffer = { duration: 2 } as AudioBuffer;
        resolve(pending.buffer);
      };
    });
    sounds.set('engine', pending);

    const created = loops.create('engine', HERE);
    await Promise.resolve();
    expect(pool.createAudio).not.toHaveBeenCalled();
    finish();

    expect(await created).not.toBeNull();
  });

  it('gives the slot back while paused out of range and takes it again on return', async () => {
    const handle = (await loops.create('zombie_walk', HERE))!;

    audible = false;
    loops.updatePosition(handle, new Vector3(9, 0, 0));
    expect(loops.isPaused(handle)).toBe(true);
    expect(budget.stats().current).toBe(0);

    audible = true;
    loops.updatePosition(handle, HERE);
    expect(loops.isPaused(handle)).toBe(false);
    expect(budget.stats().current).toBe(1);
    expect(pool.updatePannerPosition).toHaveBeenCalledWith(audios[0]);
  });

  it('keeps a paused enemy loop paused while the budget is full', async () => {
    const handle = (await loops.create('zombie_walk', HERE))!;
    loops.pause(handle);
    for (let i = 0; i < AUDIO_LIMITS.maxEnemySounds; i++) budget.reserve();

    expect(loops.resume(handle)).toBe(false);
    expect(loops.isPaused(handle)).toBe(true);
  });

  it('applies the master volume to running loops only, and to new ones', async () => {
    const running = (await loops.create('fire', HERE))!;
    const paused = (await loops.create('fire', HERE))!;
    loops.pause(paused);

    loops.setMasterVolume(0.5);
    expect(audios[0].volume).toBeCloseTo(0.4);
    expect(audios[1].volume).toBeCloseTo(0.8);

    await loops.create('fire', HERE, { volumeMultiplier: 0.5 });
    expect(audios[2].volume).toBeCloseTo(0.2);
    expect(loops.isPaused(running)).toBe(false);
  });

  it('stops every loop and returns their slots', async () => {
    await loops.create('zombie_walk', HERE);
    await loops.create('zombie_walk', HERE);
    await loops.create('fire', HERE);

    loops.stopAll();

    expect(loops.size).toBe(0);
    expect(budget.stats().current).toBe(0);
    expect(loops.describe()).toEqual([]);
  });
});
