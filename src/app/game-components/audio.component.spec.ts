import { describe, it, expect, vi } from 'vitest';
import { AudioComponent, LoopFlagSink } from './audio.component';
import { TransformComponent } from './transform.component';
import { GameObject } from '../core/game-object';
import { ComponentType } from '../core/component';
import type { SpatialAudioManager } from '../managers/audio/spatial-audio.manager';

class TestGameObject extends GameObject {
  constructor() {
    super('enemy');
    this.addComponent(new TransformComponent(this), ComponentType.TRANSFORM);
  }
}

/** AudioComponent with a loop sound and a stubbed SpatialAudioManager handing out `handle`. */
function createAudio(handle: string | null) {
  const spatial = {
    registerSound: vi.fn(),
    geoToLocalPosition: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
    createLoop: vi.fn(() => Promise.resolve(handle)),
    stopLoop: vi.fn(),
    updateLoopPosition: vi.fn(),
    playAtGeo: vi.fn(() => Promise.resolve(null)),
  };
  const sink: LoopFlagSink = { hasAudioLoops: false };
  const audio = new AudioComponent(new TestGameObject(), sink);
  audio.initialize(spatial as unknown as SpatialAudioManager);
  audio.registerSound('moving', 'moving.mp3', { loop: true });
  return { audio, sink, spatial };
}

describe('AudioComponent loop flag', () => {
  it('rises once the async loop handle arrives and falls on stop', async () => {
    const { audio, sink, spatial } = createAudio('loop_1');
    const pending = audio.play('moving', true);
    expect(sink.hasAudioLoops).toBe(false); // createLoop has not resolved yet
    await pending;
    expect(sink.hasAudioLoops).toBe(true);

    audio.update(16);
    expect(spatial.updateLoopPosition).toHaveBeenCalledTimes(1);

    audio.stop('moving');
    expect(sink.hasAudioLoops).toBe(false);
    audio.update(16);
    expect(spatial.updateLoopPosition).toHaveBeenCalledTimes(1);
  });

  it('stays down when no loop could be created (budget, distance)', async () => {
    const { audio, sink } = createAudio(null);
    await audio.play('moving', true);
    expect(sink.hasAudioLoops).toBe(false);
  });

  it('falls on stopAll and on destroy', async () => {
    const a = createAudio('loop_1');
    await a.audio.play('moving', true);
    a.audio.stopAll();
    expect(a.sink.hasAudioLoops).toBe(false);

    const b = createAudio('loop_2');
    await b.audio.play('moving', true);
    b.audio.onDestroy();
    expect(b.sink.hasAudioLoops).toBe(false);
  });
});
