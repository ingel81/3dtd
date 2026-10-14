import { describe, expect, it } from 'vitest';
import type { MapWater } from '../../map-document';
import { HeightField } from '../height-field';
import { HeightTexture } from '../terrain/height-texture';
import { ApronProfile } from '../terrain/terrain-apron';
import { WaterSurface } from './water-surface';

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
  it('rebuilds only the tiles a mask change reaches, and ends up as a whole rebuild would', () => {
    const { field, water, fill } = setup();
    const heights = new HeightTexture(field);
    const apron = new ApronProfile(field, water);
    const surface = new WaterSurface(field, heights, water, apron);
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

  it('bakes the shore cut around a change of heights as a whole bake would', () => {
    const { field, water } = setup();
    const heights = new HeightTexture(field);
    const surface = new WaterSurface(field, heights, water, null);
    // A wall rises in the south-west lake
    for (let j = 20; j <= 24; j++) for (let i = 20; i <= 24; i++) field.grid.heights[j * 201 + i] = 6;
    surface.set(water, null, { i0: 20, j0: 20, i1: 24, j1: 24 });
    const whole = new WaterSurface(field, heights, water, null);
    expect(maskData(surface)).toEqual(maskData(whole));
    surface.dispose();
    whole.dispose();
  });
});
