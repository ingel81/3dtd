import { describe, expect, it } from 'vitest';
import type { CatalogObject } from '../asset-catalog';
import { HeightField } from '../height-field';
import { GroundOcclusion } from './ground-occlusion';

function pit(): HeightField {
  // 41 x 41 samples, 2 m: flat at 10 with a pit of 0 in the middle
  const n = 41;
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = Math.hypot(i - 20, j - 20) < 4 ? 0 : 10;
  return new HeightField({ columns: n, rows: n, cellSize: 2, heights }, 80, 80);
}

describe('GroundOcclusion', () => {
  it('darkens hollows and leaves open ground open', () => {
    const ao = new GroundOcclusion(pit());
    expect(ao.at(20, 20)).toBeLessThan(0.6);
    expect(ao.at(5, 5)).toBeGreaterThan(0.95);
    ao.dispose();
  });

  it('puts a contact shadow under objects, strongest at their foot', () => {
    const field = pit();
    const ao = new GroundOcclusion(field);
    const tree = { id: 'tree', category: 'tree', footprint: 2 } as CatalogObject;
    // Map (−30, −30) is sample (5, 5)
    ao.setObjects([{ id: 'o', asset: 'tree', x: -30, y: -30, z: 0, rotation: 0, scale: 1 }], new Map([['tree', tree]]));
    expect(ao.at(5, 5)).toBeLessThan(0.7);
    expect(ao.at(6, 5)).toBeGreaterThan(ao.at(5, 5));
    expect(ao.at(10, 10)).toBeGreaterThan(0.95);
    ao.setObjects([], new Map());
    expect(ao.at(5, 5)).toBeGreaterThan(0.95);
    ao.dispose();
  });

  it('queued terrain occlusion comes out as the immediate one once flushed, slice by slice', () => {
    const field = pit();
    const ao = new GroundOcclusion(field);
    const ref = new GroundOcclusion(field);
    // The pit fills up: one sees the new ground at once, the other queued
    for (let j = 16; j <= 24; j++) for (let i = 16; i <= 24; i++) field.grid.heights[j * 41 + i] = 10;
    const rect = { i0: 18, j0: 18, i1: 22, j1: 22 };
    ref.updateTerrain(rect);
    ao.queueTerrain(rect, 1000);
    ao.queueTerrain({ i0: 2, j0: 2, i1: 3, j1: 3 }, 1050);
    // Changes still coming: it waits
    expect(ao.flush(5, 1100)).toBe(true);
    expect(ao.at(20, 20)).not.toBe(ref.at(20, 20));
    let now = 2000;
    while (ao.flush(0, now)) now += 600;
    for (let j = 0; j < 41; j++) for (let i = 0; i < 41; i++) expect(ao.at(i, j)).toBe(ref.at(i, j));
    expect(ao.flush(1)).toBe(false);
    ao.dispose();
    ref.dispose();
  });

  it('reads the heights as HeightField.heightAt does: the same occlusion as the search over heightAt', () => {
    const field = pit();
    for (let k = 0; k < field.grid.heights.length; k++) field.grid.heights[k] += Math.sin(k * 0.37) * 3;
    const ao = new GroundOcclusion(field);
    for (let j = 0; j < 41; j += 3) {
      for (let i = 0; i < 41; i += 3) {
        const x = field.originX + i * 2;
        const y = field.originY + j * 2;
        const h = field.sample(i, j);
        let occ = 0;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          let maxSin = 0;
          for (const d of [2, 4, 8, 16, 32]) {
            const rise = field.heightAt(x + Math.cos(a) * d, y + Math.sin(a) * d) - h;
            if (rise > 0) maxSin = Math.max(maxSin, rise / Math.hypot(rise, d));
          }
          occ += maxSin;
        }
        const expected = Math.max(0.25, 1 - (occ / 8) * 1.1);
        expect(Math.abs(ao.at(i, j) - expected)).toBeLessThanOrEqual(1 / 255 + 1e-6);
      }
    }
    ao.dispose();
  });

  it('bakes the shape: hollows below 0.5, a knoll above, a valley draining, closeness to lava', () => {
    // A valley along x (lowest at j = 20) with a knoll at (10, 30)
    const n = 41;
    const heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) heights[j * n + i] = Math.abs(j - 20) * 0.8 - i * 0.05 + 6 * Math.exp(-((i - 10) ** 2 + (j - 30) ** 2) / 8);
    }
    const ao = new GroundOcclusion(new HeightField({ columns: n, rows: n, cellSize: 2, heights }, 80, 80));
    expect(ao.shapeAt(20, 20).curvature).toBeLessThan(0.45);
    expect(ao.shapeAt(10, 30).curvature).toBeGreaterThan(0.55);
    expect(ao.shapeAt(30, 20).drainage).toBeGreaterThan(ao.shapeAt(30, 30).drainage + 0.3);
    const lava = new Uint8Array(n * n);
    lava[20 * n + 20] = 1;
    ao.setLava(lava);
    expect(ao.shapeAt(20, 20).lava).toBe(1);
    expect(ao.shapeAt(23, 20).lava).toBeGreaterThan(0.3);
    expect(ao.shapeAt(30, 20).lava).toBe(0);
    ao.dispose();
  });
});
