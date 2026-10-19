import { describe, expect, it } from 'vitest';
import type { MapWater } from '../../map-document';
import { HeightField } from '../height-field';
import { HeightTexture } from '../terrain/height-texture';
import { ApronProfile } from '../terrain/terrain-apron';
import { maskBounds, WaterSurface } from './water-surface';

/** 201 x 201 samples of 2 m, flat at 0; a lake in the south-west and one reaching the east border */
function setup() {
  const n = 201;
  const field = new HeightField({ columns: n, rows: n, cellSize: 2, heights: new Float32Array(n * n) }, 400, 400);
  const mask = new Uint8Array(n * n);
  const fill = (i0: number, j0: number, i1: number, j1: number, v = 255) => {
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) mask[j * n + i] = v;
  };
  fill(10, 10, 40, 40);
  fill(150, 90, 200, 110);
  const water: MapWater = { level: 1, mask, color: '#335577' };
  return { field, water, fill, n };
}

/** The mask and shore cut the surface's texture holds */
const maskData = (s: WaterSurface) => (s as unknown as { mask: { image: { data: Uint8Array } } }).mask.image.data;

const triangles = (s: WaterSurface) => s.meshes().reduce((t, m) => t + (m.geometry.index?.count ?? 0) / 3, 0);

describe('WaterSurface tiles', () => {
  it('rebuilds only the tiles a mask change reaches, and ends up as a whole rebuild would', async () => {
    const { field, water, fill } = setup();
    const heights = new HeightTexture(field);
    const apron = new ApronProfile(field, water);
    const surface = new WaterSurface(field, heights, water, apron);
    // The first bakes come from their workers
    await surface.settled;
    const before = new Set(surface.meshes());
    expect(before.size).toBeGreaterThan(2);
    // A brush adds water in the north-east tile only
    fill(170, 170, 180, 180);
    surface.set(water, null, { i0: 170, j0: 170, i1: 180, j1: 180 });
    const after = surface.meshes();
    const rebuilt = after.filter((m) => !before.has(m));
    expect(rebuilt).toHaveLength(1);
    // The south-west lake's tile is the same mesh as before
    expect(after.filter((m) => before.has(m)).length).toBe(before.size);
    const whole = new WaterSurface(field, heights, water, apron);
    await whole.settled;
    expect(triangles(surface)).toBe(triangles(whole));
    // Mask and cut agree wherever a surface can stand (outside the first bake's bounds the cut stays closed)
    const near = (s: WaterSurface) => Array.from({ length: 21 }, (_, j) => maskData(s).slice(((165 + j) * 201 + 165) * 2, ((165 + j) * 201 + 186) * 2));
    expect(near(surface)).toEqual(near(whole));
    // Water taken away empties its tile: the mesh goes
    fill(170, 170, 180, 180, 0);
    surface.set(water, null, { i0: 170, j0: 170, i1: 180, j1: 180 });
    expect(surface.meshes()).toHaveLength(before.size);
    surface.dispose();
    whole.dispose();
  });

  it('bakes the shore cut around a change of heights as a whole bake would', async () => {
    const { field, water } = setup();
    const heights = new HeightTexture(field);
    const surface = new WaterSurface(field, heights, water, null);
    await surface.settled;
    // A wall rises in the south-west lake
    for (let j = 20; j <= 24; j++) for (let i = 20; i <= 24; i++) field.grid.heights[j * 201 + i] = 6;
    surface.set(water, null, { i0: 20, j0: 20, i1: 24, j1: 24 });
    const whole = new WaterSurface(field, heights, water, null);
    await whole.settled;
    expect(maskData(surface)).toEqual(maskData(whole));
    surface.dispose();
    whole.dispose();
  });

  it('bakes a new level off the thread: the old cut until it is back, then the whole bake, a brush meanwhile kept', async () => {
    const { field, water, fill } = setup();
    const heights = new HeightTexture(field);
    // A slope across the south-west lake, so the level moves its shore
    for (let j = 0; j < 201; j++) for (let i = 0; i < 201; i++) field.grid.heights[j * 201 + i] = i * 0.05;
    const surface = new WaterSurface(field, heights, water, null);
    await surface.settled;
    const old = maskData(surface).slice();
    const raised = { ...water, level: 1.6 };
    surface.set(raised, null);
    expect(maskData(surface)).toEqual(old);
    // A brush adds water while the bake runs (within the lakes' bounds: past them a whole bake also writes the dry cut)
    fill(60, 60, 70, 70);
    surface.set(raised, null, { i0: 60, j0: 60, i1: 70, j1: 70 });
    await surface.settled;
    const whole = new WaterSurface(field, heights, raised, null);
    await whole.settled;
    expect(maskData(whole)).not.toEqual(old);
    expect(maskData(surface)).toEqual(maskData(whole));
    surface.dispose();
    whole.dispose();
  });
});

describe('maskBounds', () => {
  it('finds the samples a mask sets as a scan of every sample does, whatever the grid and the offset', () => {
    const scan = (mask: Uint8Array, cols: number, rows: number, grow: number) => {
      let i0 = cols, j0 = rows, i1 = -1, j1 = -1;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) if (mask[j * cols + i]) { i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); }
      return i1 < 0 ? null : { i0: Math.max(0, i0 - grow), j0: Math.max(0, j0 - grow), i1: Math.min(cols - 1, i1 + grow), j1: Math.min(rows - 1, j1 + grow) };
    };
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const [cols, rows] of [[1, 1], [7, 5], [33, 17], [1201, 3]]) {
      for (let t = 0; t < 20; t++) {
        // Some at an odd byte offset, so the word scan cannot take them
        const buffer = new Uint8Array(cols * rows + 1);
        const mask = t % 2 ? buffer.subarray(1) : buffer.subarray(0, cols * rows);
        const spots = Math.floor(rand() * 4);
        for (let s = 0; s < spots; s++) mask[Math.floor(rand() * cols * rows)] = 1 + Math.floor(rand() * 200);
        expect(maskBounds(mask, cols, rows, 2)).toEqual(scan(mask, cols, rows, 2));
      }
    }
  });
});
