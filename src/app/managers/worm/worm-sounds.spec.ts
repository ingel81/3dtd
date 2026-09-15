import { describe, it, expect, vi } from 'vitest';
import { Vector3 } from 'three';
import { WormSounds } from './worm-sounds';
import { WORM_SOUNDS } from '../../configs/audio.config';
import { isEnemySoundId } from '../audio/enemy-sound-budget';
import type { WormGroup } from './worm-group';
import type { ThreeTilesEngine } from '../../three-engine';

const ORIGIN_HEIGHT = 100;
const { liftM } = WORM_SOUNDS.crawl;

/** A segment enemy at local (x, z): lon is x, lat is z in the stand-in conversion */
function segment(x: number, z: number, terrainHeight = ORIGIN_HEIGHT) {
  return { alive: true, position: { lat: z, lon: x }, transform: { terrainHeight }, heightOffset: 0 };
}

type Segment = ReturnType<typeof segment>;

/** A worm with one chain per [first, last] pair over `segments` */
function worm(segments: (Segment | null)[], chains: [number, number][] = [[0, segments.length - 1]]) {
  return {
    remaining: segments.filter((s) => s !== null).length,
    segments,
    chains: chains.map(([first, last]) => ({ first, last, front: 0 })),
  };
}

function setup(listener = new Vector3(0, 0, 0)) {
  let handles = 0;
  let holdNext = false;
  let held: ((handle: string | null) => void) | null = null;
  const audio = {
    registerSound: vi.fn(),
    createLoop: vi.fn((_id: string, _position: Vector3, _config?: { randomStart?: boolean }) => {
      if (!holdNext) return Promise.resolve(`loop_${++handles}`);
      holdNext = false;
      return new Promise<string | null>((resolve) => (held = resolve));
    }),
    updateLoopPosition: vi.fn((_handle: string, _position: Vector3) => undefined),
    stopLoop: vi.fn(),
    getListener: () => ({ getWorldPosition: (target: Vector3) => target.copy(listener) }),
  };
  const engine = {
    spatialAudio: audio,
    sync: {
      getOrigin: () => ({ lat: 0, lon: 0, height: ORIGIN_HEIGHT }),
      geoToLocalSimpleInto: (lat: number, lon: number, height: number, target: Vector3) => target.set(lon, height, lat),
    },
  } as unknown as ThreeTilesEngine;
  const sounds = new WormSounds();
  const present = (groups: unknown[]) => sounds.present(groups as WormGroup[], engine);
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  /** Let the next createLoop wait until `release` */
  const holdNextLoop = () => {
    holdNext = true;
    return (handle: string | null) => held!(handle);
  };
  /** Where the loop was put last */
  const lastMove = () => audio.updateLoopPosition.mock.calls.at(-1)![1];
  return { audio, sounds, present, settle, holdNextLoop, lastMove, listener };
}

describe('WormSounds', () => {
  it('registers the crawl once, as a loop outside the enemy budget', () => {
    const { audio, present } = setup();
    present([worm([segment(10, 0)])]);
    present([worm([segment(10, 0)])]);
    const { id, url, refDistance, rolloffFactor, volume } = WORM_SOUNDS.crawl;
    expect(audio.registerSound.mock.calls).toEqual([[id, url, { refDistance, rolloffFactor, volume, loop: true }]]);
    expect(isEnemySoundId(id)).toBe(false);
  });

  it('asks for no loop and registers nothing while there is no worm', () => {
    const { audio, present } = setup();
    present([]);
    expect(audio.registerSound).not.toHaveBeenCalled();
    expect(audio.createLoop).not.toHaveBeenCalled();
  });

  it('puts one loop at the head, above its ground, from a random point, and moves it with the head', async () => {
    const { audio, present, settle, lastMove } = setup();
    const head = segment(10, 5);
    const group = worm([head, segment(10, -2), segment(10, -9)]);
    present([group]);
    present([group]);
    await settle();
    expect(audio.createLoop.mock.calls).toEqual([[WORM_SOUNDS.crawl.id, new Vector3(10, liftM, 5), { randomStart: true }]]);

    head.position.lat = 12;
    present([group]);
    expect(lastMove()).toEqual(new Vector3(10, liftM, 12));
    expect(audio.createLoop).toHaveBeenCalledTimes(1);
  });

  it('sits on the head nearest the listener once the worm split', async () => {
    const { audio, present, settle, lastMove, listener } = setup(new Vector3(0, 0, 50));
    // Slot 2 died: the front part leads with slot 0, the rear part with slot 3
    const group = worm([segment(0, 60), segment(0, 53), null, segment(0, 20), segment(0, 13)], [[0, 1], [3, 4]]);
    present([group]);
    await settle();
    present([group]);
    expect(lastMove()).toEqual(new Vector3(0, liftM, 60));

    listener.set(0, 0, 15);
    present([group]);
    expect(lastMove()).toEqual(new Vector3(0, liftM, 20));
    expect(audio.createLoop).toHaveBeenCalledTimes(1);
  });

  it('never sits on a tail, however near the listener: the first segment of each chain leads it', async () => {
    const { present, settle, lastMove } = setup(new Vector3(0, 0, 53));
    // Slot 2 died: slot 1 ends the front part (its tail), slot 4 the rear part
    const group = worm([segment(0, 60), segment(0, 53), null, segment(0, 20), segment(0, 13)], [[0, 1], [3, 4]]);
    present([group]);
    await settle();
    present([group]);
    // On the tail at 53 the listener hears the front head at 60, 7 m off
    expect(lastMove()).toEqual(new Vector3(0, liftM, 60));
  });

  it('gives every worm its own loop and ends the loop of one that is gone', async () => {
    const { audio, present, settle } = setup();
    const a = worm([segment(10, 0)]);
    const b = worm([segment(-10, 0)]);
    present([a, b]);
    await settle();
    expect(audio.createLoop).toHaveBeenCalledTimes(2);

    // Beaten: still listed until the next tick, with nothing left
    a.remaining = 0;
    present([a, b]);
    expect(audio.stopLoop.mock.calls).toEqual([['loop_1']]);
    present([]);
    expect(audio.stopLoop.mock.calls).toEqual([['loop_1'], ['loop_2']]);
  });

  it('keeps the loop where it is while no head walks for a moment', async () => {
    const { audio, present, settle } = setup();
    const head = segment(10, 0);
    const group = worm([head, segment(10, -7)]);
    present([group]);
    await settle();
    head.alive = false;
    present([group]);
    expect(audio.stopLoop).not.toHaveBeenCalled();
    expect(audio.updateLoopPosition).not.toHaveBeenCalled();
  });

  it('stops a loop that arrives after its worm went, and ends all on clear', async () => {
    const { audio, sounds, present, settle, holdNextLoop } = setup();
    const release = holdNextLoop();
    const late = worm([segment(10, 0)]);
    present([late]);
    present([]);
    release('late');
    await settle();
    expect(audio.stopLoop.mock.calls).toEqual([['late']]);

    const kept = worm([segment(20, 0)]);
    present([kept]);
    await settle();
    sounds.clear(audio as never);
    expect(audio.stopLoop.mock.calls.at(-1)).toEqual([expect.stringMatching(/^loop_/)]);
    present([]);
    expect(audio.stopLoop).toHaveBeenCalledTimes(2);
  });

  it('does nothing without spatial audio', () => {
    const sounds = new WormSounds();
    expect(() => sounds.present([worm([segment(1, 1)])] as unknown as WormGroup[], {} as ThreeTilesEngine)).not.toThrow();
  });
});
