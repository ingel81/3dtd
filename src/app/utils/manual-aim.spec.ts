import { describe, expect, it } from 'vitest';
import { aimDirectionInto, eyeInto, headingOfLocal, rayHitDistance, type Vec3 } from './manual-aim';
import { geoHeading } from './geo-utils';

const v = (): Vec3 => ({ x: 0, y: 0, z: 0 });

describe('manual-aim', () => {
  it('heading 0 looks north (+Z), heading π/2 east (-X)', () => {
    const north = aimDirectionInto(0, 0, v());
    expect(north.z).toBeCloseTo(1);
    expect(north.x).toBeCloseTo(0);
    const east = aimDirectionInto(Math.PI / 2, 0, v());
    expect(east.x).toBeCloseTo(-1);
    expect(east.z).toBeCloseTo(0);
  });

  it('matches geoHeading of the same direction', () => {
    // 10 m east and 10 m north: geoHeading of the geo points, headingOfLocal of the local offset
    const from = { lat: 50, lon: 8 };
    const to = { lat: 50 + 10 / 111320, lon: 8 + 10 / (111320 * Math.cos((50 * Math.PI) / 180)) };
    expect(headingOfLocal(-10, 10)).toBeCloseTo(geoHeading(from, to), 3);
  });

  it('pitch tilts the direction up and keeps it a unit vector', () => {
    const d = aimDirectionInto(1, 0.5, v());
    expect(d.y).toBeCloseTo(Math.sin(0.5));
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1);
  });

  it('the eye sits above and behind the muzzle against the aim', () => {
    const eye = eyeInto({ x: 0, y: 10, z: 0 }, 0, 1.5, 2, v());
    expect(eye).toEqual({ x: 0, y: 11.5, z: -2 });
  });

  it('a ray hits a point within the radius at its distance along the ray', () => {
    const origin = { x: 0, y: 0, z: 0 };
    const dir = aimDirectionInto(0, 0, v());
    expect(rayHitDistance(origin, dir, { x: 0.5, y: 0, z: 20 }, 1)).toBeCloseTo(20);
    expect(rayHitDistance(origin, dir, { x: 1.5, y: 0, z: 20 }, 1)).toBe(Infinity);
    // Behind the eye
    expect(rayHitDistance(origin, dir, { x: 0, y: 0, z: -5 }, 1)).toBe(Infinity);
  });
});
