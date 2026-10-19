import { describe, expect, it } from 'vitest';
import type { CatalogObject } from '../asset-catalog';
import { HeightField } from '../height-field';
import { COVER_RIM, CoverMap } from './cover-map';

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

  it('holds the distance to the nearest building, standing wall or rock, by its rectangle where it has one', () => {
    const n = 21;
    const field = new HeightField({ columns: n, rows: n, cellSize: 1, heights: new Float32Array(n * n) }, 20, 20);
    const cover = new CoverMap(field);
    // A house 4 x 2 m on the ground (its box), turned by nothing; a fence lets the grass grow
    const house = { id: 'house', category: 'building', footprint: 3, height: 6, box: [0, 0, 2, 1] } as CatalogObject;
    const fence = { id: 'fence', category: 'wall', footprint: 2, height: 1, box: [0, 0, 2, 0.1] } as CatalogObject;
    cover.set(
      [
        { id: 'h', asset: 'house', x: 0, y: 0, z: 0, rotation: 0, scale: 1 },
        { id: 'f', asset: 'fence', x: -8, y: -8, z: 0, rotation: 0, scale: 1 },
      ],
      new Map([
        ['house', house],
        ['fence', fence],
      ]),
    );
    // Map (x, y) sits at sample (x + 10, y + 10)
    const rim = (x: number, y: number): number => ((cover.rim.image.data as Uint8Array)[(y + 10) * n + x + 10] / 255) * COVER_RIM;
    expect(rim(0, 0)).toBe(0);
    expect(rim(0, 2)).toBeCloseTo(1, 1); // a metre off the long side
    expect(rim(4, 0)).toBeCloseTo(2, 1); // two off the short side
    expect(rim(0, 9)).toBe(COVER_RIM); // further than the rim reaches
    expect(rim(-8, -8)).toBe(COVER_RIM); // a fence keeps no rim
    cover.dispose();
  });
});
