import { describe, it, expect, vi, afterEach } from 'vitest';
import { Vector3 } from 'three';
import { OpPlayer, revive } from './op-player';
import { createOpRecorder, type PresentationOp } from '../sim/protocol/ops';

function makeEngine() {
  return {
    effects: { spawnFloatingText: vi.fn(), markScorch: vi.fn() },
    towers: { create: vi.fn(), setPartShown: vi.fn() },
    lightningBolts: { spawnBolt: vi.fn() },
    spatialAudio: { playAt: vi.fn(() => Promise.reject(new Error('no buffer'))) },
  };
}

describe('OpPlayer', () => {
  afterEach(() => vi.restoreAllMocks());

  it('calls the engine member at each path with the arguments, in order, on its own object', () => {
    const engine = makeEngine();
    const player = new OpPlayer(engine);
    const ops: PresentationOp[] = [];
    const sink = createOpRecorder(ops);
    sink['effects']['spawnFloatingText']('+5', 1, 2, 3, { color: '#fff', duration: 900 });
    sink['towers']['setPartShown']('silo', 'missile', true);
    player.play(ops);

    expect(engine.effects.spawnFloatingText).toHaveBeenCalledWith('+5', 1, 2, 3, { color: '#fff', duration: 900 });
    expect(engine.effects.spawnFloatingText.mock.contexts[0]).toBe(engine.effects);
    expect(engine.towers.setPartShown).toHaveBeenCalledWith('silo', 'missile', true);
  });

  it('revives every plain {x, y, z} into a Vector3, in arrays and objects too, and leaves the rest alone', () => {
    const engine = makeEngine();
    const player = new OpPlayer(engine);
    player.play([['lightningBolts.spawnBolt', { x: 1, y: 2, z: 3 }, [{ x: 4, y: 5, z: 6 }], { at: { x: 7, y: 8, z: 9 }, n: 1 }]]);
    const [a, list, opts] = engine.lightningBolts.spawnBolt.mock.calls[0] as unknown as [Vector3, Vector3[], { at: Vector3; n: number }];
    expect(a).toBeInstanceOf(Vector3);
    expect(a.toArray()).toEqual([1, 2, 3]);
    expect(list[0]).toBeInstanceOf(Vector3);
    expect(opts.at.toArray()).toEqual([7, 8, 9]);
    expect(opts.n).toBe(1);

    const plain = { color: 1, size: 2 };
    expect(revive(plain)).toBe(plain);
    const four = { x: 1, y: 2, z: 3, w: 4 };
    expect(revive(four)).toBe(four);
    expect(revive({ x: 1, y: 2, z: 'a' })).not.toBeInstanceOf(Vector3);
  });

  it('hands an overridden path to its override, which may call the engine with changed arguments', () => {
    const engine = makeEngine();
    const player = new OpPlayer(engine);
    const aim = { current: 1, pitch: 0 };
    player.override('towers.create', (args, call) => {
      args[6] = aim;
      call(...args);
    });
    player.play([['towers.create', 'tower-1', 'archer', 1, 2, 3, 0, { current: 0, pitch: 0 }]]);
    expect(engine.towers.create.mock.calls[0][6]).toBe(aim);
  });

  it('reports an unknown path once and plays on', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const engine = makeEngine();
    const player = new OpPlayer(engine);
    player.play([
      ['nothing.here', 1],
      ['effects.missing', 2],
      ['nothing.here', 3],
      ['effects.markScorch', 1, 2, 3, 'rocket'],
    ]);
    expect(error).toHaveBeenCalledTimes(2);
    expect(engine.effects.markScorch).toHaveBeenCalledWith(1, 2, 3, 'rocket');
  });

  it('never throws: a failing call is reported, a rejected promise caught', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = makeEngine();
    engine.effects.markScorch.mockImplementation(() => {
      throw new Error('boom');
    });
    const player = new OpPlayer(engine);
    expect(() => player.play([
      ['effects.markScorch', 1, 2, 3, 'rocket'],
      ['spatialAudio.playAt', 'tentacle-grab', { x: 0, y: 0, z: 0 }],
      ['effects.spawnFloatingText', '+1', 0, 0, 0],
    ])).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(engine.effects.spawnFloatingText).toHaveBeenCalled();
  });
});
