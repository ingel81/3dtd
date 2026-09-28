import { describe, it, expect, vi } from 'vitest';
import { Scene, Texture, Vector3 } from 'three';
import { FloatingTextInstanceManager } from './floating-text-instance.manager';
import type { CoordinateSync } from '../index';

// The atlas paints on a 2D canvas, which jsdom does not have
vi.mock('./floating-text-atlas', () => ({
  FloatingTextAtlas: class {
    texture = new Texture();
    getOrCreate() {
      return { uvRect: [0, 0, 1, 1], textAspect: 1 };
    }
    release = () => undefined;
    clear = () => undefined;
    dispose = () => undefined;
  },
}));

interface Internals {
  activeInstances: Map<number, unknown>;
  freeIndices: number[];
}

describe('floating texts in a full pool (TODO E68)', () => {
  it('give up the slots in turn instead of searching the pool, and count it', () => {
    const sync = { geoToLocal: () => new Vector3() } as unknown as CoordinateSync;
    const texts = new FloatingTextInstanceManager(new Scene(), sync);
    const inside = texts as unknown as Internals;
    const size = inside.freeIndices.length;
    for (let i = 0; i < size; i++) texts.spawn(`${i}`, 0, 0, 0);
    expect(inside.activeInstances.size).toBe(size);
    expect(texts.evicted).toBe(0);

    texts.spawn('a', 0, 0, 0);
    texts.spawn('b', 0, 0, 0);
    expect(texts.evicted).toBe(2);
    expect(inside.activeInstances.size).toBe(size);
    expect(inside.freeIndices).toHaveLength(0);
  });
});
