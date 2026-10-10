import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { arcDegrees, blendShot, headingFromMatrix, shotPose, slerpLatLon, type GlobeShot } from './globe-flight';
import { ecefOf, upOf } from './globe-geo';
import { regionTilesAround, type RegionIndex } from './globe-textures';
import { ellipsoidGeometry, starColor } from './globe-view';
import { Color } from 'three';

const pose = () => ({ position: new Vector3(), target: new Vector3(), up: new Vector3() });

describe('globe-flight', () => {
  it('goes along the great circle, also across the date line', () => {
    const mid = slerpLatLon({ lat: 0, lon: 170 }, { lat: 0, lon: -170 }, 0.5);
    expect(Math.abs(mid.lon)).toBeCloseTo(180, 6);
    expect(arcDegrees({ lat: 0, lon: 170 }, { lat: 0, lon: -170 })).toBeCloseTo(20, 6);
  });

  it('looks straight down at the point below with aim 1', () => {
    const out = pose();
    shotPose({ over: { lat: 48.8, lon: 9.2 }, altitude: 500_000, aim: 1, shift: 0, roll: 0 }, null, out);
    const down = out.target.clone().sub(out.position).normalize();
    expect(down.dot(upOf(48.8, 9.2, new Vector3()))).toBeCloseTo(-1, 9);
    expect(out.target.distanceTo(ecefOf(48.8, 9.2, 0, new Vector3()))).toBeLessThan(1e-6);
  });

  it('rolls the screen top from north to the heading, the short way', () => {
    const over = { lat: 48.8, lon: 9.2 };
    const normal = upOf(over.lat, over.lon, new Vector3());
    const east = new Vector3(-Math.sin((9.2 * Math.PI) / 180), Math.cos((9.2 * Math.PI) / 180), 0);
    const shot: GlobeShot = { over, altitude: 500_000, aim: 1, shift: 0, roll: 1 };
    const out = pose();
    shotPose(shot, east, out);
    expect(out.up.dot(east)).toBeCloseTo(1, 6);
    shotPose({ ...shot, roll: 0.5 }, east, out);
    // Half way between north and east: 45 degrees off each, flat on the ground
    expect(out.up.dot(east)).toBeCloseTo(Math.SQRT1_2, 6);
    expect(out.up.dot(normal)).toBeCloseTo(0, 6);
  });

  it('blends altitudes evenly in their logarithm', () => {
    const a: GlobeShot = { over: { lat: 0, lon: 0 }, altitude: 1000, aim: 0, shift: 0.2, roll: 0 };
    const b: GlobeShot = { over: { lat: 0, lon: 0 }, altitude: 100_000, aim: 1, shift: 0, roll: 1 };
    const mid = blendShot(a, b, 0.5);
    expect(mid.altitude).toBeCloseTo(10_000, 6);
    expect(mid.shift).toBeCloseTo(0.1, 9);
  });

  it('reads the screen top from a camera matrix', () => {
    const m = new Matrix4().lookAt(new Vector3(0, 0, 10), new Vector3(0, 0, 0), new Vector3(1, 0, 0));
    expect(headingFromMatrix(m, new Vector3()).x).toBeCloseTo(1, 9);
  });
});

describe('regionTilesAround', () => {
  const all: RegionIndex = {
    deg: 9,
    tiles: Array.from({ length: 20 * 40 }, (_, i) => `${Math.floor(i / 40)}_${i % 40}`),
  };

  it('takes the 2x2 block whose corner is nearest, the place well inside', () => {
    // Stuttgart: row 4 (54..45 N), column 21 (9..18 E), in the tile's south-west quarter
    const tiles = regionTilesAround(48.78, 9.18, all);
    expect(tiles.map((t) => t.key).sort()).toEqual(['4_20', '4_21', '5_20', '5_21']);
    const u = (9.18 + 180) / 360;
    const v = (90 - 48.78) / 180;
    const inside = tiles.filter(({ rect }) => u >= rect[0] && u <= rect[2] && v >= rect[1] && v <= rect[3]);
    expect(inside).toHaveLength(1);
  });

  it('wraps at the date line and leaves out tiles of water only', () => {
    const tiles = regionTilesAround(0, 179.5, { deg: 9, tiles: ['9_39', '9_0', '10_39'] });
    expect(tiles.map((t) => t.key).sort()).toEqual(['10_39', '9_0', '9_39']);
  });
});

describe('globe-view geometry', () => {
  it('lays the grid on the ellipsoid with the north pole at v 0', () => {
    const g = ellipsoidGeometry(8, 4);
    const pos = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    expect(uv.getY(0)).toBe(0);
    // Float32 positions: half a metre at earth radius
    expect(Math.abs(pos.getZ(0) - 6356752.31)).toBeLessThan(0.5);
    // Triangles face outward: the first one's normal points away from the centre
    const index = g.getIndex()!;
    const p = (i: number) => new Vector3().fromBufferAttribute(pos, index.getX(i));
    const [a, b, c] = [p(0), p(1), p(2)];
    const normal = b.clone().sub(a).cross(c.clone().sub(a));
    expect(normal.dot(a)).toBeGreaterThan(0);
  });

  it('colours hot stars blue and cool ones red', () => {
    const blue = starColor(-0.3, new Color());
    const red = starColor(1.6, new Color());
    expect(blue.b).toBeGreaterThan(blue.r);
    expect(red.r).toBeGreaterThan(red.b);
  });
});
