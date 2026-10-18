import type { MapPaths, MapSurface } from '../../map-document';
import { PathMaskRaster, rasterizePathMask, type RoadCover } from './path-mask';

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
