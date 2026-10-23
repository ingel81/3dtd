import type { MapPaths, MapSurface } from '../../map-document';
import { EDGE_RANGE, PathMaskRaster, rasterizePathMask, rasterizeSurfaceEdges, type RoadCover } from './path-mask';

const none: MapPaths = { nodes: [], edges: [] };
/** A 200 m map at 1 m texels */
const at = (mask: Uint8Array, x: number, y: number) => mask.slice(((Math.floor(y + 100) * 200) + Math.floor(x + 100)) * 4, ((Math.floor(y + 100) * 200) + Math.floor(x + 100)) * 4 + 4);

describe('path mask covers', () => {
  const cover: RoadCover = { id: 'c', line: [{ x: -50, y: 0 }, { x: 50, y: 0 }], half: 3 };

  it('marks the ground a road surface hides with blue 255, square at its ends', () => {
    const mask = rasterizePathMask(none, 200, 200, 200, [], [cover]);
    expect(Array.from(at(mask, 0, 0))).toEqual([0, 0, 255, 0]);
    expect(Array.from(at(mask, 0, 2.2))).toEqual([0, 0, 255, 0]);
    expect(at(mask, 0, 4)[2]).toBe(0);
    // Not past the line's ends: no round cap where the road ends square
    expect(at(mask, 51.5, 0)[2]).toBe(0);
  });

  it('leaves a painted road its across position, which never reads as a cover', () => {
    const paths: MapPaths = { nodes: [{ id: 'a', x: 0, y: -50 }, { id: 'b', x: 0, y: 50 }], edges: [{ id: 'e', a: 'a', b: 'b', width: 6, kind: 'road' }] };
    const mask = rasterizePathMask(paths, 200, 200, 200, [], [cover]);
    expect(at(mask, 0, 0)[0]).toBe(255);
    expect(at(mask, 0, 0)[2]).toBeLessThan(254);
    for (let x = -4; x <= 4; x += 0.5) expect(at(mask, x, 20)[2]).toBeLessThanOrEqual(253);
  });

  it('paints a moved cover again in part as a whole raster would', () => {
    const raster = new PathMaskRaster(200, 200, 200);
    raster.update(none, [], [cover]);
    const moved = { ...cover, line: [{ x: -50, y: 10 }, { x: 50, y: 10 }] };
    expect(raster.update(none, [], [moved])).not.toBeNull();
    expect(Array.from(raster.data)).toEqual(Array.from(rasterizePathMask(none, 200, 200, 200, [], [moved])));
  });
});

describe('path mask under surfaces', () => {
  const square: MapSurface = {
    id: 's',
    material: 'paving',
    outer: [{ x: -20, y: -20 }, { x: 20, y: -20 }, { x: 20, y: 20 }, { x: -20, y: 20 }],
    holes: [[{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }]],
  };

  it('covers the ground inside a surface, short of its edge, not in its holes nor under a painted road', () => {
    const paths: MapPaths = { nodes: [{ id: 'a', x: 15, y: -50 }, { id: 'b', x: 15, y: 50 }], edges: [{ id: 'e', a: 'a', b: 'b', width: 4, kind: 'path' }] };
    const mask = rasterizePathMask(paths, 200, 200, 200, [], [], [square]);
    expect(at(mask, -12, 0)[2]).toBe(255);
    expect(at(mask, 0, 0)[2]).toBe(0);
    expect(at(mask, -25, 0)[2]).toBe(0);
    expect(at(mask, 15, 0)[2]).toBeLessThanOrEqual(253);
    // At a texel of 0.5 m the cover stops short of the edge, the edge's texel stays the ground's
    const fine = rasterizePathMask(none, 200, 200, 400, [], [], [square]);
    const atFine = (x: number, y: number) => fine[(Math.floor((y + 100) * 2) * 400 + Math.floor((x + 100) * 2)) * 4 + 2];
    expect(atFine(19.3, 10)).toBe(255);
    expect(atFine(19.8, 10)).toBe(0);
  });

  it('paints a moved surface again in part as a whole raster would', () => {
    const raster = new PathMaskRaster(200, 200, 200);
    raster.update(none, [], [], [square]);
    const moved: MapSurface = { ...square, outer: square.outer.map((p) => ({ x: p.x + 7, y: p.y })), holes: undefined };
    expect(raster.update(none, [], [], [moved])).not.toBeNull();
    expect(Array.from(raster.data)).toEqual(Array.from(rasterizePathMask(none, 200, 200, 200, [], [], [moved])));
    expect(raster.update(none, [], [], [])).not.toBeNull();
    expect(raster.data.some((v) => v !== 0)).toBe(false);
  });
});

describe('path mask edge field', () => {
  /** The field read between texels as the grass reads it (texel centres at half texels), as metres off the nearest edge */
  const metres = (edge: Uint8Array, res: number, size: number, x: number, y: number) => {
    const u = ((x + size / 2) / size) * res - 0.5;
    const v = ((y + size / 2) / size) * res - 0.5;
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fx = u - i;
    const fy = v - j;
    const b = (ii: number, jj: number) => edge[Math.min(res - 1, Math.max(0, jj)) * res + Math.min(res - 1, Math.max(0, ii))];
    const value = (b(i, j) * (1 - fx) + b(i + 1, j) * fx) * (1 - fy) + (b(i, j + 1) * (1 - fx) + b(i + 1, j + 1) * fx) * fy;
    return ((value - 128) / 127) * EDGE_RANGE;
  };

  it('finds a road surface edge between texels of 2 m to a few centimetres, square at its ends', () => {
    // A cover 3 m either side, its surface drawn out to 3.25 m; texels of 2 m
    const cover: RoadCover = { id: 'c', line: [{ x: -50, y: 0.3 }, { x: 50, y: 0.3 }], half: 3, edge: 3.25 };
    const edge = rasterizeSurfaceEdges(200, 200, 100, [cover], []);
    for (const x of [-20, -7.3, 0, 11.9]) {
      expect(metres(edge, 100, 200, x, 3.55)).toBeCloseTo(0, 1);
      expect(metres(edge, 100, 200, x, 3.45)).toBeLessThan(0);
      expect(metres(edge, 100, 200, x, 3.65)).toBeGreaterThan(0);
    }
    // Between texels across the centre line the distance's fold is read flat: still well inside
    expect(metres(edge, 100, 200, 0, 0.3)).toBeLessThan(-2);
    // Square past its end: 1 m beyond it is 1 m off
    expect(metres(edge, 100, 200, 51, 0.3)).toBeCloseTo(1, 0);
  });

  it('counts a ribbon too narrow for a cover, which paints no cover', () => {
    const narrow: RoadCover = { id: 'n', line: [{ x: -50, y: 0 }, { x: 50, y: 0 }], half: 0, edge: 0.5 };
    expect(rasterizePathMask(none, 200, 200, 200, [], [narrow]).some((v) => v !== 0)).toBe(false);
    // A metre wide: texels of half a metre find it (texels as wide as it read its middle as its edge)
    const edge = rasterizeSurfaceEdges(200, 200, 400, [narrow], []);
    expect(metres(edge, 400, 200, 0, 0.1)).toBeLessThan(0);
    expect(metres(edge, 400, 200, 0, 0.7)).toBeGreaterThan(0);
  });

  it('is negative inside a surface, positive in its holes and outside', () => {
    const square: MapSurface = {
      id: 's',
      material: 'paving',
      outer: [{ x: -20, y: -20 }, { x: 20, y: -20 }, { x: 20, y: 20 }, { x: -20, y: 20 }],
      holes: [[{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }]],
    };
    const edge = rasterizeSurfaceEdges(200, 200, 100, [], [square]);
    expect(metres(edge, 100, 200, -12, 0)).toBeLessThan(-2);
    expect(metres(edge, 100, 200, 0, 0)).toBeGreaterThan(2);
    expect(metres(edge, 100, 200, 20.3, 3)).toBeCloseTo(0.3, 1);
    expect(metres(edge, 100, 200, 19.7, 3)).toBeCloseTo(-0.3, 1);
  });

  it('paints a moved cover again in part as a whole field would', () => {
    const cover: RoadCover = { id: 'c', line: [{ x: -50, y: 0 }, { x: 50, y: 0 }], half: 3, edge: 3.25 };
    const raster = new PathMaskRaster(200, 200, 200);
    raster.update(none, [], [cover]);
    const moved = { ...cover, line: [{ x: -50, y: 10 }, { x: 40, y: 30 }] };
    expect(raster.update(none, [], [moved])).not.toBeNull();
    expect(Array.from(raster.edge)).toEqual(Array.from(rasterizeSurfaceEdges(200, 200, 200, [moved], [])));
  });
});
