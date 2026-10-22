import { describe, expect, it } from 'vitest';
import { gridHeightAt } from '../height-field';
import { conformDraped, mergeDraped, REFINE_TOLERANCE, refineDraped, takeSplitting, triangleBuckets, type DrapedGeometry, type DrapeGround } from './draped-refine';

/** A 64 m square in two triangles from (0, 0), with an attribute per vertex (its x) */
function square(): DrapedGeometry {
  const position = Float32Array.from([0, 0, 64, 0, 64, 64, 0, 64]);
  return { position, attributes: { aX: { array: Float32Array.from([0, 64, 64, 0]), itemSize: 1 } }, index: Uint32Array.from([0, 1, 2, 0, 2, 3]) };
}

/** A grid of 2 m cells over 0 to 128 m with heights from `f` */
function ground(f: (x: number, y: number) => number): DrapeGround {
  const columns = 65;
  const heights = new Float32Array(columns * columns);
  for (let j = 0; j < columns; j++) for (let i = 0; i < columns; i++) heights[j * columns + i] = f(i * 2, j * 2);
  const grid = { columns, rows: columns, cellSize: 2, heights };
  return { grid, originX: 0, originY: 0, heightAt: (x, y) => gridHeightAt(grid, 0, 0, x, y) };
}

/** Flat ground with a pit 4 m deep, 6 m wide, at (20, 30) */
const pit = ground((x, y) => -4 * Math.max(0, 1 - Math.hypot(x - 20, y - 30) / 6));
/** A crest along y = 32: up 1 m in 10 m either side */
const crest = ground((_x, y) => 1 - Math.abs(y - 32) / 10);
const rect = { minX: 12, minY: 22, maxX: 28, maxY: 38 };

/** The most the ground stands off any triangle of a geometry (looked at on a fine net in each) */
function mostOff(g: DrapedGeometry, at: DrapeGround): number {
  let most = 0;
  const p = g.position;
  for (let t = 0; t < g.index.length; t += 3) {
    const [a, b, c] = [g.index[t], g.index[t + 1], g.index[t + 2]];
    const h = [a, b, c].map((v) => at.heightAt(p[v * 2], p[v * 2 + 1]));
    const n = 12;
    for (let i = 0; i <= n; i++) {
      for (let j = 0; i + j <= n; j++) {
        const u = i / n;
        const v = j / n;
        const w = 1 - u - v;
        const x = p[a * 2] * w + p[b * 2] * u + p[c * 2] * v;
        const y = p[a * 2 + 1] * w + p[b * 2 + 1] * u + p[c * 2 + 1] * v;
        most = Math.max(most, Math.abs(at.heightAt(x, y) - (h[0] * w + h[1] * u + h[2] * v)));
      }
    }
  }
  return most;
}

/** The vertices of a geometry on the segment p-q, strictly between its ends, as "x,y" */
function onSegment(g: DrapedGeometry, px: number, py: number, qx: number, qy: number): Set<string> {
  const out = new Set<string>();
  const len = Math.hypot(qx - px, qy - py);
  for (let k = 0; k < g.position.length; k += 2) {
    const x = g.position[k];
    const y = g.position[k + 1];
    if (Math.abs((x - px) * (qy - py) - (y - py) * (qx - px)) > 1e-3 * len) continue;
    const t = ((x - px) * (qx - px) + (y - py) * (qy - py)) / (len * len);
    if (t > 1e-4 && t < 1 - 1e-4) out.add(`${x},${y}`);
  }
  return out;
}

describe('conformDraped (a surface lies on the ground between its vertices)', () => {
  it('cuts the triangles over a crest along the ground, every one within twice the tolerance', () => {
    expect(mostOff(square(), crest)).toBeGreaterThan(0.5);
    const out = conformDraped([square()], crest)[0]!;
    expect(out).not.toBeNull();
    expect(mostOff(out, crest)).toBeLessThanOrEqual(2 * REFINE_TOLERANCE + 1e-4);
    // A crest is one line: a handful of triangles, not a grid
    expect(out.index.length / 3).toBeLessThan(16);
    // The attribute is linear: a new vertex's value is its x
    const ax = out.attributes['aX'].array;
    for (let k = 0; k < ax.length; k++) expect(ax[k]).toBeCloseTo(out.position[k * 2], 3);
    // Faces stay up
    const p = out.position;
    for (let t = 0; t < out.index.length; t += 3) {
      const [a, b, c] = [out.index[t], out.index[t + 1], out.index[t + 2]];
      expect((p[b * 2] - p[a * 2]) * (p[c * 2 + 1] - p[a * 2 + 1]) - (p[c * 2] - p[a * 2]) * (p[b * 2 + 1] - p[a * 2 + 1])).toBeGreaterThan(0);
    }
  });

  it('leaves a surface over ground that is one plane as it is', () => {
    expect(conformDraped([square()], ground((x, y) => 3 + 0.1 * x - 0.05 * y))).toEqual([null]);
  });

  it('gives two geometries the same points on the edge they share: no crack', () => {
    // Two triangles over the crest sharing the edge (0, 0) to (64, 64), each a geometry of its own
    const left: DrapedGeometry = { position: Float32Array.from([0, 0, 64, 64, 0, 64]), attributes: {}, index: Uint32Array.from([0, 1, 2]) };
    const right: DrapedGeometry = { position: Float32Array.from([0, 0, 64, 0, 64, 64]), attributes: {}, index: Uint32Array.from([0, 1, 2]) };
    const [a, b] = conformDraped([left, right], crest);
    expect(a && b).toBeTruthy();
    const onA = onSegment(a!, 0, 0, 64, 64);
    expect(onA.size).toBeGreaterThan(0);
    expect([...onSegment(b!, 0, 0, 64, 64)].sort()).toEqual([...onA].sort());
  });

  it('puts the crossings of a forced edge on it, though nothing there needs cutting', () => {
    const out = conformDraped([square()], ground(() => 2), { forced: [0, 0, 64, 0] })[0]!;
    // The grid's lines every 2 m and a diagonal in each cell
    expect(onSegment(out, 0, 0, 64, 0).size).toBeGreaterThanOrEqual(31);
  });
});

describe('refineDraped (a surface follows a crater)', () => {
  it('cuts the triangles over a pit along the ground, so they follow it into it', () => {
    const out = refineDraped(square(), rect, pit)!;
    expect(out).not.toBeNull();
    expect(out.index.length / 3).toBeGreaterThan(20);
    // Some vertex near the pit's middle, deep in it
    let best = Infinity;
    for (let k = 0; k < out.position.length; k += 2) best = Math.min(best, Math.hypot(out.position[k] - 20, out.position[k + 1] - 30));
    expect(best).toBeLessThan(2);
    expect(mostOff(out, pit)).toBeLessThanOrEqual(2 * REFINE_TOLERANCE + 1e-4);
    // The attribute is linear: a new vertex's value is its x
    const ax = out.attributes['aX'].array;
    for (let k = 0; k < ax.length; k++) expect(ax[k]).toBeCloseTo(out.position[k * 2], 3);
    // Every triangle still refers to vertices that exist
    for (const i of out.index) expect(i).toBeLessThan(out.position.length / 2);
  });

  it('leaves a tile over flat ground, or a pit outside the rectangle, as it is', () => {
    expect(refineDraped(square(), rect, ground(() => 3))).toBeNull();
    expect(refineDraped(square(), { minX: 100, minY: 100, maxX: 110, maxY: 110 }, pit)).toBeNull();
  });

  it('stops cutting at its most triangles', () => {
    // Over the crest both triangles need cutting; past the most, the second stays as it is
    const all = conformDraped([square()], crest)[0]!;
    const some = conformDraped([square()], crest, { maxTriangles: 3 })[0]!;
    expect(some.index.length).toBeLessThan(all.index.length);
  });
});

describe('takeSplitting (the triangles over a pit leave their tile for its patch)', () => {
  it('takes the triangles that need it out, drawn as nothing in the tile, its buffers kept', () => {
    const tile = square();
    const length = tile.index.length;
    const taken = takeSplitting(tile, rect, pit)!;
    expect(taken.index.length).toBeGreaterThan(0);
    expect(tile.index.length).toBe(length);
    // Taken ones degenerate: their three corners on one vertex
    let degenerate = 0;
    for (let t = 0; t < tile.index.length; t += 3) if (tile.index[t] === tile.index[t + 1] && tile.index[t + 1] === tile.index[t + 2]) degenerate++;
    expect(degenerate).toBe(taken.index.length / 3);
    // Their vertices and attributes came along
    expect(taken.attributes['aX'].array.length).toBe(taken.position.length / 2);
    // Nothing more to take the next time
    expect(takeSplitting(tile, rect, pit)).toBeNull();
  });

  it('finds the same triangles through its buckets as by looking at all', () => {
    const a = square();
    const b = square();
    const all = takeSplitting(a, rect, pit)!;
    const near = takeSplitting(b, rect, pit, triangleBuckets(b, 16))!;
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
