import { describe, it, expect, vi } from 'vitest';
import { Vector3 } from 'three';
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
function createAudio(handle: number | null) {
  return createAudioWith(() => Promise.resolve(handle));
}

function createAudioWith(createLoop: () => Promise<number | null>) {
  const spatial = {
    registerSound: vi.fn(),
    geoToLocalPosition: vi.fn((_lat: number, _lon: number, _h: number, target?: Vector3) => target ?? new Vector3()),
    createLoop: vi.fn(createLoop),
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
    const { audio, sink, spatial } = createAudio(1);
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

  it('stays down when no loop could be created (unknown sound, no buffer)', async () => {
    const { audio, sink } = createAudio(null);
    await audio.play('moving', true);
    expect(sink.hasAudioLoops).toBe(false);
  });

  it('moves its loop through one vector of its own, none per update', async () => {
    const { audio, spatial } = createAudio(1);
    await audio.play('moving', true);
    audio.update(16);
    audio.update(16);

    const [first, second] = spatial.updateLoopPosition.mock.calls.map((call) => call[1]);
    expect(first).toBeInstanceOf(Vector3);
    expect(second).toBe(first);
  });

  it('falls on stopAll and on destroy', async () => {
    const a = createAudio(1);
    await a.audio.play('moving', true);
    a.audio.stopAll();
    expect(a.sink.hasAudioLoops).toBe(false);

    const b = createAudio(2);
    await b.audio.play('moving', true);
    b.audio.onDestroy();
    expect(b.sink.hasAudioLoops).toBe(false);
  });
});

/** A promise the test resolves by hand, to hold createLoop in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('AudioComponent loop that resolves after its owner let go', () => {
  it('stops the loop when the component is destroyed while createLoop is pending', async () => {
    const loop = deferred<number | null>();
    const { audio, sink, spatial } = createAudioWith(() => loop.promise);

    const pending = audio.play('moving', true);
    audio.onDestroy();
    loop.resolve(1);
    await pending;

    expect(spatial.stopLoop).toHaveBeenCalledWith(1);
    expect(sink.hasAudioLoops).toBe(false);
    audio.update(16);
    expect(spatial.updateLoopPosition).not.toHaveBeenCalled();
  });

  it('stops the loop when stop() ran while createLoop was pending', async () => {
    const loop = deferred<number | null>();
    const { audio, sink, spatial } = createAudioWith(() => loop.promise);

    const pending = audio.play('moving', true);
    audio.stop('moving');
    loop.resolve(1);
    await pending;

    expect(spatial.stopLoop).toHaveBeenCalledWith(1);
    expect(sink.hasAudioLoops).toBe(false);
  });

  it('keeps only the newer of two overlapping plays', async () => {
    const loops = [deferred<number | null>(), deferred<number | null>()];
    let call = 0;
    const { audio, sink, spatial } = createAudioWith(() => loops[call++].promise);

    const first = audio.play('moving', true);
    const second = audio.play('moving', true);
    loops[0].resolve(1);
    loops[1].resolve(2);
    await Promise.all([first, second]);

    expect(spatial.stopLoop).toHaveBeenCalledTimes(1);
    expect(spatial.stopLoop).toHaveBeenCalledWith(1);
    expect(sink.hasAudioLoops).toBe(true);

    audio.stop('moving');
    expect(spatial.stopLoop).toHaveBeenLastCalledWith(2);
  });
});
