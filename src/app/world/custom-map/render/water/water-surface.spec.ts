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
    // Water taken away empties its tile: the mesh goes
    fill(170, 170, 180, 180, 0);
    surface.set(water, null, { i0: 170, j0: 170, i1: 180, j1: 180 });
    expect(surface.meshes()).toHaveLength(before.size);
    surface.dispose();
    whole.dispose();
  });
});
