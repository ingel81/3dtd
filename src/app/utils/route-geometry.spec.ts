import { describe, it, expect } from 'vitest';
import type { Street } from '../interfaces/street-network-provider.interface';
import { METERS_PER_DEGREE_LAT, DEG_TO_RAD } from './geo-utils';
import {
  closestPointOnSegment,
  extendPathToOptimalTurnoff,
  leavePathForBase,
  subdivideGeoPath,
} from './route-geometry';

const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(48 * DEG_TO_RAD);

/** Metres east and north of (48, 9). */
const metres = (p: { lat: number; lon: number }) => ({
  x: (p.lon - 9) * M_PER_DEG_LON,
  z: (p.lat - 48) * METERS_PER_DEGREE_LAT,
});

/** Flat-earth distance, precise enough over a few hundred metres. */
const flat = {
  haversineDistance: (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const a = metres({ lat: lat1, lon: lon1 });
    const b = metres({ lat: lat2, lon: lon2 });
    return Math.hypot(a.x - b.x, a.z - b.z);
  },
};

const street = (id: number, nodes: [number, number][]): Street =>
  ({ id, type: 'residential', name: '', nodes: nodes.map(([lat, lon], k) => ({ id: id * 100 + k, lat, lon })) }) as Street;

describe('closestPointOnSegment', () => {
  it('drops the perpendicular in metres, not in degrees', () => {
    const a = { lat: 48, lon: 9 };
    const b = { lat: 48.001, lon: 9.002 };
    const target = { lat: 48.000644, lon: 9.000841 };
    const foot = metres(closestPointOnSegment(a, b, target));
    const along = { x: metres(b).x - metres(a).x, z: metres(b).z - metres(a).z };
    const across = { x: metres(target).x - foot.x, z: metres(target).z - foot.z };
    expect(Math.abs(along.x * across.x + along.z * across.z) / Math.hypot(along.x, along.z)).toBeLessThan(0.01);
  });

  it('stays on the segment', () => {
    const a = { lat: 48, lon: 9 };
    const b = { lat: 48.001, lon: 9 };
    expect(closestPointOnSegment(a, b, { lat: 48.002, lon: 9.0001 })).toEqual(b);
    expect(closestPointOnSegment(a, a, b)).toEqual(a);
  });
});

describe('extendPathToOptimalTurnoff', () => {
  const path = [{ lat: 48, lon: 9 }, { lat: 48.001, lon: 9 }];

  it('follows the street on past the path end while that brings it closer to the HQ', () => {
    const streets = [street(1, [[48, 9], [48.001, 9], [48.002, 9], [48.003, 9]])];
    const hq = { lat: 48.0021, lon: 9.0002 };
    expect(extendPathToOptimalTurnoff(path, hq, streets, flat)).toEqual([
      ...path, { lat: 48.002, lon: 9 }, { lat: 48.003, lon: 9 },
    ]);
  });

  it('leaves the path as it is when the street leads away from the HQ', () => {
    // The way starts at the path end; walking it only moves away from the HQ.
    const streets = [street(1, [[48.001, 9], [48.002, 9]])];
    expect(extendPathToOptimalTurnoff(path, { lat: 48.0005, lon: 9.0003 }, streets, flat)).toEqual(path);
  });
});

describe('leavePathForBase', () => {
  it('turns off at the point nearest to the HQ and ends at the HQ', () => {
    const path = [{ lat: 48, lon: 9 }, { lat: 48.001, lon: 9 }, { lat: 48.002, lon: 9 }];
    const hq = { lat: 48.0015, lon: 9.0003 };
    const route = leavePathForBase(path, hq, flat);
    expect(route).toHaveLength(4);
    expect(route[2].lat).toBeCloseTo(48.0015, 9);
    expect(route[2].lon).toBeCloseTo(9, 9);
    expect(route[3]).toEqual(hq);
  });

  it('skips the turn-off point within a metre of the last node kept', () => {
    const path = [{ lat: 48, lon: 9 }, { lat: 48.001, lon: 9 }, { lat: 48.002, lon: 9 }];
    const hq = { lat: 48.001, lon: 9.0003 };
    expect(leavePathForBase(path, hq, flat)).toEqual([path[0], path[1], hq]);
  });
});

describe('subdivideGeoPath', () => {
  it('splits long segments into equal pieces no longer than the limit', () => {
    const a = { lat: 48, lon: 9 };
    const b = { lat: 48 + 9 / METERS_PER_DEGREE_LAT, lon: 9 }; // 9 m north
    const result = subdivideGeoPath([a, b], 2);
    expect(result).toHaveLength(6);
    expect(result[0]).toBe(a);
    expect(result[5]).toBe(b);
    expect(flat.haversineDistance(result[1].lat, result[1].lon, a.lat, a.lon)).toBeCloseTo(1.8, 6);
  });
});
