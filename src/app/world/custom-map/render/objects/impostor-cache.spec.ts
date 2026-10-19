import type { WebGLRenderer } from 'three';
import type { ObjectModel } from '../map-asset-library';
import { ImpostorCache } from './impostor-cache';

const model = (category: string, height: number, placeholder = false): ObjectModel =>
  ({ id: `${category}-${height}`, entry: { id: `${category}-${height}`, category, height }, parts: [], height, placeholder }) as unknown as ObjectModel;

describe('impostor cache', () => {
  it('bakes far levels for trees and big rocks only, never for placeholders', () => {
    const cache = new ImpostorCache({} as WebGLRenderer);
    expect(cache.wants(model('tree', 12))).toBe(true);
    expect(cache.wants(model('rock', 2))).toBe(true);
    expect(cache.wants(model('rock', 1))).toBe(false);
    expect(cache.wants(model('building', 9))).toBe(false);
    expect(cache.wants(model('tree', 12, true))).toBe(false);
    // Nothing to bake: no impostor, and none asked for twice
    expect(cache.get(model('building', 9))).toBeNull();
    // A tree without parts bakes nothing: no place in the arrays, and no second bake
    const empty = new ImpostorCache({} as WebGLRenderer);
    const tree = model('tree', 12);
    expect(empty.get(tree)).toBeNull();
    expect(empty.get(tree)).toBeNull();
  });

  it('bakes ahead only once the lights of the map stand', async () => {
    const order: string[] = [];
    let release!: () => void;
    const lit = new Promise<void>((resolve) => (release = resolve)).then(() => order.push('lit'));
    const cache = new ImpostorCache({} as WebGLRenderer, () => undefined, () => lit);
    const job = cache.prepare(model('tree', 12)).then(() => order.push('baked'));
    await Promise.resolve();
    expect(order).toEqual([]);
    release();
    await job;
    expect(order).toEqual(['lit', 'baked']);
  });
});
