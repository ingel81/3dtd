import { describe, expect, it } from 'vitest';
import { mergeDraped, refineDraped, takeSplitting, triangleBuckets, type DrapedGeometry } from './draped-refine';

/** A 64 m square in two triangles from (0, 0), with an attribute per vertex (its x) */
function square(): DrapedGeometry {
  const position = Float32Array.from([0, 0, 64, 0, 64, 64, 0, 64]);
  return { position, attributes: { aX: { array: Float32Array.from([0, 64, 64, 0]), itemSize: 1 } }, index: Uint32Array.from([0, 1, 2, 0, 2, 3]) };
}

/** Flat ground with a pit 4 m deep, 6 m wide, at (20, 30) */
const pit = (x: number, y: number) => -4 * Math.max(0, 1 - Math.hypot(x - 20, y - 30) / 6);
const rect = { minX: 12, minY: 22, maxX: 28, maxY: 38 };

describe('refineDraped (a surface follows a crater)', () => {
  it('splits the triangles over a pit down to the ground cell, so a vertex lies in it', () => {
    const out = refineDraped(square(), rect, pit, 2)!;
    expect(out).not.toBeNull();
    expect(out.index.length / 3).toBeGreaterThan(20);
    // Some vertex near the pit's middle, deep in it
    let best = Infinity;
    for (let k = 0; k < out.position.length; k += 2) best = Math.min(best, Math.hypot(out.position[k] - 20, out.position[k + 1] - 30));
    expect(best).toBeLessThan(2);
    // The attribute is linear: a middle's value is its x
    const ax = out.attributes['aX'].array;
    for (let k = 0; k < ax.length; k++) expect(ax[k]).toBeCloseTo(out.position[k * 2], 4);
    // Every triangle still refers to vertices that exist
    for (const i of out.index) expect(i).toBeLessThan(out.position.length / 2);
  });

  it('leaves a tile over flat ground, or a pit outside the rectangle, as it is', () => {
    expect(refineDraped(square(), rect, () => 3, 2)).toBeNull();
    expect(refineDraped(square(), { minX: 200, minY: 200, maxX: 210, maxY: 210 }, pit, 2)).toBeNull();
  });

  it('settles: a second pass over its own result changes nothing', () => {
    const once = refineDraped(square(), rect, pit, 2)!;
    expect(refineDraped(once, rect, pit, 2)).toBeNull();
  });

  it('stops at its most triangles', () => {
    const out = refineDraped(square(), rect, pit, 2, 20)!;
    expect(out.index.length / 3).toBeLessThanOrEqual(20);
  });
});

describe('takeSplitting (the triangles over a pit leave their tile for its patch)', () => {
  it('takes the triangles that need it out, drawn as nothing in the tile, its buffers kept', () => {
    const tile = square();
    const length = tile.index.length;
    const taken = takeSplitting(tile, rect, pit, 2)!;
    expect(taken.index.length).toBeGreaterThan(0);
    expect(tile.index.length).toBe(length);
    // Taken ones degenerate: their three corners on one vertex
    let degenerate = 0;
    for (let t = 0; t < tile.index.length; t += 3) if (tile.index[t] === tile.index[t + 1] && tile.index[t + 1] === tile.index[t + 2]) degenerate++;
    expect(degenerate).toBe(taken.index.length / 3);
    // Their vertices and attributes came along
    expect(taken.attributes['aX'].array.length).toBe(taken.position.length / 2);
    // Nothing more to take the next time
    expect(takeSplitting(tile, rect, pit, 2)).toBeNull();
  });

  it('finds the same triangles through its buckets as by looking at all', () => {
    const a = square();
    const b = square();
    const all = takeSplitting(a, rect, pit, 2)!;
    const near = takeSplitting(b, rect, pit, 2, triangleBuckets(b, 16))!;
    expect(Array.from(near.index)).toEqual(Array.from(all.index));
    expect(Array.from(b.index)).toEqual(Array.from(a.index));
  });

  it('merges two geometries, the triangles of the second on their own vertices', () => {
    const one = square();
    const both = mergeDraped(one, square());
    expect(both.position.length).toBe(16);
    expect(Array.from(both.index.slice(6))).toEqual([4, 5, 6, 4, 6, 7]);
    expect(both.attributes['aX'].array.length).toBe(8);
  });
});
