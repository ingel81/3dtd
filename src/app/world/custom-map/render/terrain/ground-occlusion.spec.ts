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
});
