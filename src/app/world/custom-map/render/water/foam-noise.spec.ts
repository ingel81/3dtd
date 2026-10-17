import { describe, expect, it } from 'vitest';
import { foamLace, foamNoiseTexture, prepareFoamNoise } from './foam-noise';

describe('foamLace', () => {
  it('runs from 0 on the bubbles walls to 1 in their middles, with bubbles of more than one size', () => {
    const lace = foamLace(64);
    expect(lace.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(Math.min(...lace)).toBeLessThan(0.05);
    expect(Math.max(...lace)).toBeGreaterThan(0.9);
    // Walls of both grids: a good share of texels lies near a wall, but not most
    const nearWall = lace.filter((v) => v < 0.25).length / lace.length;
    expect(nearWall).toBeGreaterThan(0.15);
    expect(nearWall).toBeLessThan(0.7);
  });

  it('tiles: the lace continues across its edges', () => {
    const size = 64;
    const lace = foamLace(size);
    let inside = 0;
    let across = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size - 1; x++) inside = Math.max(inside, Math.abs(lace[y * size + x] - lace[y * size + x + 1]));
      across = Math.max(across, Math.abs(lace[y * size + size - 1] - lace[y * size]));
    }
    expect(across).toBeLessThanOrEqual(inside);
  });
});

describe('foamNoiseTexture', () => {
  it('holds no foam until its bake is in, then the lace', async () => {
    const texture = foamNoiseTexture();
    const data = texture.image.data as Uint8Array;
    expect(data[0]).toBe(255);
    expect(data[4 * 1000]).toBe(255);
    await prepareFoamNoise();
    expect(foamNoiseTexture()).toBe(texture);
    let walls = 0;
    for (let k = 0; k < data.length; k += 4) if (data[k] < 64) walls++;
    expect(walls).toBeGreaterThan(data.length / 4 / 10);
  });
});
