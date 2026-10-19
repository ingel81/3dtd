import { describe, expect, it } from 'vitest';
import { HeightField } from '../height-field';
import { groundJobMap, readRows, runGroundJob } from './ground-jobs';
import { shapePatch, type ShapePatch } from './ground-shape';

describe('the ground jobs on a copy of the map', () => {
  it('take changed heights (a crater) and work the shape out on them, as on the map itself', () => {
    const n = 41;
    const heights = new Float32Array(n * n).fill(10);
    const terrain = { width: 80, depth: 80, grid: { columns: n, rows: n, cellSize: 2, heights }, water: null, waterBodies: [], rivers: [] };
    const copy = groundJobMap(terrain);
    // A crater in the map's own heights
    for (let j = 18; j <= 22; j++) for (let i = 18; i <= 22; i++) heights[j * n + i] = 4;
    const rect = { i0: 18, j0: 18, i1: 22, j1: 22 };
    runGroundJob(copy, { kind: 'heights', rect, rows: readRows(heights, n, rect) });
    const worked = runGroundJob(copy, { kind: 'shape', rect: null }) as ShapePatch;
    const expected = shapePatch(new HeightField(terrain.grid, 80, 80), null);
    expect(worked.terrain).toEqual(expected.terrain);
    expect(worked.curvature).toEqual(expected.curvature);
  });
});
