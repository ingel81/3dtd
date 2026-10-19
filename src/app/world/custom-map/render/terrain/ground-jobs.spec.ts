import { describe, expect, it } from 'vitest';
import { HeightField } from '../height-field';
import { groundJobMap, readRows, runGroundJob } from './ground-jobs';
import { shapePatch, type ShapePatch } from './ground-shape';
import { rasterizePathMask } from '../paths/path-mask';
import { GridNormalTexture } from './terrain-textures';
import type { GridNormalTexels } from './ground-shape';

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

  it('paint the path mask as the map paints it in place', () => {
    const terrain = { width: 64, depth: 64, grid: { columns: 2, rows: 2, cellSize: 64, heights: new Float32Array(4) }, water: null, waterBodies: [], rivers: [] };
    const paths = {
      nodes: [{ id: 'a', x: -20, y: -10 }, { id: 'b', x: 25, y: 12 }],
      edges: [{ id: 'e', a: 'a', b: 'b', kind: 'path', width: 6 }],
    } as never;
    const input = { paths, width: 64, depth: 64, resolution: 128, rivers: [], covers: [], surfaces: [] };
    const painted = runGroundJob(groundJobMap(terrain), { kind: 'pathMask', input }) as Uint8Array;
    expect(painted).toEqual(rasterizePathMask(paths, 64, 64, 128));
    expect(painted.some((v) => v > 0)).toBe(true);
  });

  it('work the ground normals and wet banks out as the normal texture does in place', () => {
    const n = 33;
    const heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = Math.sin(i * 0.4) * 3 + j * 0.2;
    const mask = new Uint8Array(n * n);
    for (let j = 10; j < 18; j++) for (let i = 8; i < 20; i++) mask[j * n + i] = 1;
    const grid = { columns: n, rows: n, cellSize: 2, heights };
    const terrain = { width: 64, depth: 64, grid, water: null, waterBodies: [], rivers: [] };
    const worked = runGroundJob(groundJobMap(terrain), { kind: 'normals', mask }) as GridNormalTexels;
    const inPlace = new GridNormalTexture(new HeightField(grid, 64, 64), mask);
    expect(worked.pixels).toEqual(inPlace.texture.image.data);
    expect(worked.wet!.some((v) => v > 0)).toBe(true);
  });
});
