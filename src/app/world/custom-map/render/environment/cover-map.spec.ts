import { describe, expect, it } from 'vitest';
import type { CatalogObject } from '../asset-catalog';
import { HeightField } from '../height-field';
import { CoverMap } from './cover-map';

describe('CoverMap', () => {
  it('is the terrain, raised to the roof inside building footprints', () => {
    const n = 21;
    const field = new HeightField({ columns: n, rows: n, cellSize: 2, heights: new Float32Array(n * n).fill(3) }, 40, 40);
    const cover = new CoverMap(field);
    const house = { id: 'house', category: 'building', footprint: 4, height: 8 } as CatalogObject;
    const tree = { id: 'tree', category: 'tree', footprint: 2, height: 12 } as CatalogObject;
    cover.set(
      [
        { id: 'h', asset: 'house', x: 0, y: 0, z: 0, rotation: 0, scale: 1 },
        { id: 't', asset: 'tree', x: 10, y: 10, z: 0, rotation: 0, scale: 1 },
      ],
      new Map([
        ['house', house],
        ['tree', tree],
      ]),
    );
    const top = (i: number, j: number): number => (cover.texture.image.data as Float32Array)[j * n + i];
    expect(top(10, 10)).toBe(11); // map (0, 0): ground 3 + roof 8
    expect(top(0, 0)).toBe(3);
    expect(top(15, 15)).toBe(3); // trees let rain through
    cover.dispose();
  });

  it('lies on water bodies, rivers and rocks, where grass then does not grow', () => {
    const n = 21;
    const field = new HeightField({ columns: n, rows: n, cellSize: 2, heights: new Float32Array(n * n).fill(3) }, 40, 40);
    const cover = new CoverMap(field);
    const mask = new Uint8Array(n * n);
    mask[2 * n + 2] = 255;
    const rock = { id: 'pool', category: 'rock', footprint: 2, height: 0.6 } as CatalogObject;
    cover.set([{ id: 'p', asset: 'pool', x: -14, y: 14, z: 0, rotation: 0, scale: 1 }], new Map([['pool', rock]]), {
      width: 40,
      depth: 40,
      grid: field.grid,
      layers: [],
      splat: { resolution: 1, maps: [new Uint8Array(4), new Uint8Array(4)] },
      water: { level: 4, mask, color: '' },
      waterBodies: [],
      rivers: [{ id: 'r', kind: 'water', points: [{ x: 10, y: -10, width: 4, height: 5 }, { x: 10, y: 10, width: 4, height: 5 }] }],
      cliffAngle: 40,
      cliffMaterial: 'rock',
    });
    const top = (i: number, j: number): number => (cover.texture.image.data as Float32Array)[j * n + i];
    expect(top(2, 2)).toBe(4); // the lake's sample
    expect(top(3, 3)).toBe(3);
    expect(top(15, 10)).toBe(5); // on the river line at map x 10
    expect(top(3, 17)).toBeCloseTo(3.6); // the pool at map (-14, 14)
    cover.dispose();
  });
});
