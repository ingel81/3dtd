import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { CONE_LENGTH_MARGIN_M, bodyPointInCone, coneContains, type Cone } from './body-cone';
import { METERS_PER_DEGREE_LAT } from './geo-utils';
import { RouteBody, RouteBodyStations, type RouteBodyContact } from './route-body';

// At the equator a degree of longitude is as long as one of latitude
const flatSync = {
  geoToLocalSimpleInto: (lat: number, lon: number, height: number, target: Vector3): Vector3 =>
    target.set(lon * METERS_PER_DEGREE_LAT, height, -lat * METERS_PER_DEGREE_LAT),
};
// 200 m north (-z), 3 m of corridor to each side, a station every 2 m
const stations = new RouteBodyStations(
  [
    { lat: 0, lon: 0, corridorLeft: 3, corridorRight: 3 },
    { lat: 200 / METERS_PER_DEGREE_LAT, lon: 0, corridorLeft: 3, corridorRight: 3 },
  ],
  flatSync,
  100,
);

const GROUND = 2;
const AIM = 1;
/** Fire tower 15 m east of the route at s = 100 m, flame level with the aim points */
const APEX = { x: 15, y: GROUND + AIM, z: -100 };
const ground = () => GROUND;

/** The flame from APEX at local (x, z), 8 m wide at its end. */
function flameAt(x: number, z: number): Cone {
  const dir = new Vector3(x - APEX.x, 0, z - APEX.z);
  const length = dir.length();
  dir.normalize();
  return {
    ...APEX,
    dirX: dir.x, dirY: dir.y, dirZ: dir.z,
    length,
    cosHalfAngle: Math.cos(Math.atan2(4, length)),
  };
}

function bodyBetween(tail: number, tip: number): RouteBody {
  const body = new RouteBody(stations);
  body.tailM = tail;
  body.tipM = tip;
  return body;
}

const contact = (): RouteBodyContact => ({ station: 0, offset: 0, distance: 0 });

describe('coneContains', () => {
  const cone = flameAt(15, -120); // 20 m due north of the apex

  it('takes a point on the axis up to the length plus the margin', () => {
    expect(coneContains(cone, 15, APEX.y, -110)).toBe(true);
    expect(coneContains(cone, 15, APEX.y, -100 - 20 - CONE_LENGTH_MARGIN_M + 0.01)).toBe(true);
    expect(coneContains(cone, 15, APEX.y, -100 - 20 - CONE_LENGTH_MARGIN_M - 0.01)).toBe(false);
  });

  it('leaves out what lies beside the opening, and the apex itself', () => {
    // 4 m off the axis at the end is the edge; 5 m is out
    expect(coneContains(cone, 18.9, APEX.y, -120)).toBe(true);
    expect(coneContains(cone, 20, APEX.y, -120)).toBe(false);
    expect(coneContains(cone, APEX.x, APEX.y, APEX.z)).toBe(false);
  });
});

describe('bodyPointInCone', () => {
  it('finds the body where a flame at another target crosses it, though the aim point is beside the flame', () => {
    // The body starts 20 m north of the tower's level; the flame points at
    // a zombie on the route 40 m north
    const body = bodyBetween(120, 200);
    const flame = flameAt(0, -140);
    // The tower's aim point, the body point nearest to it, lies outside
    const aim = body.nearest(APEX.x, APEX.z, contact());
    const aimX = stations.x[aim.station] + stations.rightX[aim.station] * aim.offset;
    expect(coneContains(flame, aimX, GROUND + AIM, stations.z[aim.station])).toBe(false);

    const out = contact();
    expect(bodyPointInCone(body, flame, ground, 0, AIM, out)).toBe(GROUND);
    expect(out.station).toBe(70);
    expect(out.offset).toBeCloseTo(0, 9);
  });

  it('falls back to the given ground where the grid has none', () => {
    const out = contact();
    expect(bodyPointInCone(bodyBetween(120, 200), flameAt(0, -140), () => null, GROUND, AIM, out)).toBe(GROUND);
  });

  it('finds nothing when the flame points away from the body', () => {
    expect(bodyPointInCone(bodyBetween(120, 200), flameAt(30, -100), ground, 0, AIM, contact())).toBeNull();
    // Across the route, but where the body has not got to yet
    expect(bodyPointInCone(bodyBetween(150, 200), flameAt(0, -100), ground, 0, AIM, contact())).toBeNull();
  });
});
