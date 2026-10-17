import { describe, expect, it, vi } from 'vitest';
import { TowerLoopSounds } from './tower-loop-sounds';
import type { SpatialAudioManager } from '../managers/audio/spatial-audio.manager';

function fakeAudio() {
  let handles = 0;
  let release: (() => void) | null = null;
  const audio = {
    gate: false,
    createLoop: vi.fn(() => {
      const handle = ++handles;
      if (!audio.gate) return Promise.resolve(handle);
      return new Promise<number>((resolve) => (release = () => resolve(handle)));
    }),
    updateLoopPosition: vi.fn(() => true),
    setLoopVolume: vi.fn(),
    stopLoop: vi.fn(),
    playAt: vi.fn(() => Promise.resolve(null)),
    release: () => release?.(),
  };
  return audio;
}

const settle = async () => {
  for (let k = 0; k < 3; k++) await Promise.resolve();
};
const at = { x: 1, y: 2, z: 3 };

describe('TowerLoopSounds', () => {
  it('plays the start once, ramps the loop in under it and follows the drive', async () => {
    const audio = fakeAudio();
    const sounds = new TowerLoopSounds(() => audio as unknown as SpatialAudioManager, { start: 's', loop: 'l', ramp: 1 });
    sounds.work('t', at);
    await settle();
    expect(audio.playAt).toHaveBeenCalledTimes(1);
    // A ramp starts silent
    expect((audio.createLoop.mock.calls[0] as unknown[])[2]).toEqual({ volumeMultiplier: 0 });
    sounds.advance(500);
    expect(audio.setLoopVolume).toHaveBeenLastCalledWith(1, 0.5);
    sounds.advance(800);
    sounds.work('t', at, 0.5);
    expect(audio.setLoopVolume).toHaveBeenLastCalledWith(1, 0.5);
    expect(audio.playAt).toHaveBeenCalledTimes(1);
    sounds.rest('t');
    expect(audio.stopLoop).toHaveBeenCalledWith(1);
    // From rest again: a new start
    sounds.work('t', at);
    expect(audio.playAt).toHaveBeenCalledTimes(2);
  });

  it('ends a loop that arrives after its tower stopped', async () => {
    const audio = fakeAudio();
    audio.gate = true;
    const sounds = new TowerLoopSounds(() => audio as unknown as SpatialAudioManager, { loop: 'l' });
    sounds.work('t', at);
    sounds.rest('t');
    audio.release();
    await settle();
    expect(audio.stopLoop).toHaveBeenCalledWith(1);
    expect(sounds.size).toBe(0);
  });

  it('idles on for its linger, quieter, and takes up work again within it without a new start', async () => {
    const audio = fakeAudio();
    const sounds = new TowerLoopSounds(() => audio as unknown as SpatialAudioManager, { start: 's', loop: 'l', load: 'c', linger: 2 });
    sounds.work('t', at, 1, 1, { x: 5, y: 0, z: 5 });
    await settle();
    expect(audio.createLoop.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['l', 'c']);
    sounds.rest('t');
    expect(audio.stopLoop).toHaveBeenCalledWith(2);
    sounds.advance(1000);
    expect(audio.setLoopVolume).toHaveBeenLastCalledWith(1, 0.6);
    sounds.work('t', at, 1, 0.6);
    expect(audio.playAt).toHaveBeenCalledTimes(1);
    expect(audio.setLoopVolume).toHaveBeenLastCalledWith(1, 1);
    sounds.rest('t');
    sounds.advance(2100);
    expect(audio.stopLoop).toHaveBeenCalledWith(1);
    expect(sounds.size).toBe(0);
  });
});
