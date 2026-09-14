import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Vector3 } from 'three';
import { GameEventBus } from '../game-engine';
import { OozeSounds } from './ooze-sounds';
import { OOZE_SOUNDS } from '../configs/audio.config';
import type { SpatialAudioManager } from './audio/spatial-audio.manager';

/** The facade calls OozeSounds makes; createLoop resolves when `arrive` is called. */
function mockAudio() {
  let arrive: ((handle: string | null) => void) | null = null;
  const audio = {
    registerSound: vi.fn(),
    createLoop: vi.fn(() => new Promise<string | null>((resolve) => { arrive = resolve; })),
    updateLoopPosition: vi.fn(),
    stopLoop: vi.fn(),
  };
  return {
    audio,
    manager: audio as unknown as SpatialAudioManager,
    arrive: async (handle: string | null) => {
      arrive?.(handle);
      await Promise.resolve();
    },
  };
}

describe('OozeSounds', () => {
  let bus: GameEventBus;
  let sounds: OozeSounds;

  beforeEach(() => {
    bus = new GameEventBus();
    sounds = new OozeSounds(bus);
  });

  it('registers the three sounds once per audio manager, the bubbling as a loop', () => {
    const { audio, manager } = mockAudio();
    sounds.register(manager);
    sounds.register(manager);
    expect(audio.registerSound).toHaveBeenCalledTimes(3);
    expect(audio.registerSound).toHaveBeenCalledWith(
      OOZE_SOUNDS.bubble.id,
      expect.stringMatching(/^data:audio\/wav;base64,/),
      expect.objectContaining({ loop: true }),
    );
    expect(audio.registerSound).toHaveBeenCalledWith(
      OOZE_SOUNDS.slurp.id,
      expect.any(String),
      expect.objectContaining({ minIntervalMs: OOZE_SOUNDS.slurp.minIntervalMs }),
    );
  });

  it('asks for its loop on the first frame, in earshot or not, and moves it from then on', async () => {
    const { audio, manager, arrive } = mockAudio();
    // 600 m away: SpatialAudioLoops lets the loop wait until it is in earshot
    sounds.follow('ooze-1', manager, 600, 0, 0);
    expect(audio.createLoop).toHaveBeenCalledWith(OOZE_SOUNDS.bubble.id, new Vector3(600, 0, 0), { randomStart: true });
    sounds.follow('ooze-1', manager, 11, 0, 0); // still loading: no second loop
    expect(audio.createLoop).toHaveBeenCalledTimes(1);

    await arrive('loop_1');
    sounds.follow('ooze-1', manager, 12, 1, 3);
    expect(audio.updateLoopPosition).toHaveBeenCalledWith('loop_1', new Vector3(12, 1, 3));
  });

  it('stops a loop that arrives after its ooze went', async () => {
    const { audio, manager, arrive } = mockAudio();
    sounds.follow('ooze-1', manager, 0, 0, 0);
    sounds.stop('ooze-1', manager);
    await arrive('loop_1');
    expect(audio.stopLoop).toHaveBeenCalledWith('loop_1');
  });

  it('does not ask again for a loop that got nothing in range', async () => {
    const { audio, manager, arrive } = mockAudio();
    sounds.follow('ooze-1', manager, 0, 0, 0);
    await arrive(null);
    sounds.follow('ooze-1', manager, 0, 0, 0);
    expect(audio.createLoop).toHaveBeenCalledTimes(1);
  });

  it('ends every loop on clear', async () => {
    const { audio, manager, arrive } = mockAudio();
    sounds.follow('ooze-1', manager, 0, 0, 0);
    await arrive('loop_1');
    sounds.clear(manager);
    expect(audio.stopLoop).toHaveBeenCalledWith('loop_1');
  });

  it('sends splat and slurp as deferred audio:play', () => {
    const deferred = vi.spyOn(bus, 'emitDeferred');
    sounds.splat(48.1, 9.1, 300);
    sounds.slurp(48.2, 9.2, 301);
    expect(deferred).toHaveBeenCalledWith({ type: 'audio:play', sound: OOZE_SOUNDS.splat.id, lat: 48.1, lon: 9.1, height: 300 });
    expect(deferred).toHaveBeenCalledWith({ type: 'audio:play', sound: OOZE_SOUNDS.slurp.id, lat: 48.2, lon: 9.2, height: 301 });
  });
});
