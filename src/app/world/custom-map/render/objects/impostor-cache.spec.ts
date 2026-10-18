import type { WebGLRenderer } from 'three';
import type { ObjectModel } from '../map-asset-library';
import { ImpostorCache } from './impostor-cache';

const model = (category: string, height: number, placeholder = false): ObjectModel =>
  ({ id: `${category}-${height}`, entry: { id: `${category}-${height}`, category, height }, parts: [], height, placeholder }) as unknown as ObjectModel;

describe('impostor cache', () => {
  it('bakes far levels for trees and big rocks only, never for placeholders', () => {
    const cache = new ImpostorCache({} as WebGLRenderer, () => undefined);
    expect(cache.wants(model('tree', 12))).toBe(true);
    expect(cache.wants(model('rock', 2))).toBe(true);
    expect(cache.wants(model('rock', 1))).toBe(false);
    expect(cache.wants(model('building', 9))).toBe(false);
    expect(cache.wants(model('tree', 12, true))).toBe(false);
    // Nothing to bake: no impostor, and none asked for twice
    expect(cache.get(model('building', 9))).toBeNull();
    const finished: unknown[] = [];
    const empty = new ImpostorCache({} as WebGLRenderer, (imp) => finished.push(imp));
    const tree = model('tree', 12);
    expect(empty.get(tree)).toBeNull();
    expect(empty.get(tree)).toBeNull();
    expect(finished).toEqual([]);
  });
});
