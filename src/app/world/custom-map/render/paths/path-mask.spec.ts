import type { MapPaths } from '../../map-document';
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
