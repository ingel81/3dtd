import { describe, it, expect } from 'vitest';
import { pointAlongSweep, routeSweepToward } from './route-sweep';
import { geoDistanceFast, METERS_PER_DEGREE_LAT } from './geo-utils';
import type { GeoPosition } from '../models/game.types';

const LAT = 48.7758;
const LON = 9.1829;
const M_PER_LON = METERS_PER_DEGREE_LAT * Math.cos((LAT * Math.PI) / 180);

/** A point `north` and `east` metres from the origin */
const at = (north: number, east = 0, height?: number): GeoPosition =>
  ({ lat: LAT + north / METERS_PER_DEGREE_LAT, lon: LON + east / M_PER_LON, height });

/** Straight north, a waypoint every 10 m, 100 m long, heights rising 1 m per waypoint */
const STRAIGHT = Array.from({ length: 11 }, (_, i) => at(i * 10, 0, 300 + i));

describe('routeSweepToward', () => {
  it('starts where the route passes the target and runs back toward the route start', () => {
    const sweep = routeSweepToward([STRAIGHT], at(35, 4), 30, 1000)!;
    expect(geoDistanceFast(sweep.points[0], at(35))).toBeLessThan(0.01);
    expect(sweep.points[0].height).toBeCloseTo(303.5);
    expect(sweep.points[sweep.points.length - 1]).toEqual(STRAIGHT[0]);
    expect(sweep.length).toBeCloseTo(35, 1);
    // Waypoints on the way, nearest first
    expect(sweep.points.slice(1, 3)).toEqual([STRAIGHT[3], STRAIGHT[2]]);
    for (let i = 1; i < sweep.cumulative.length; i++) {
      expect(sweep.cumulative[i]).toBeGreaterThan(sweep.cumulative[i - 1]);
    }
  });

  it('stops after the length asked for, part-way along a segment', () => {
    const sweep = routeSweepToward([STRAIGHT], at(55), 30, 18)!;
    expect(sweep.length).toBeCloseTo(18, 6);
    expect(geoDistanceFast(sweep.points[sweep.points.length - 1], at(37))).toBeLessThan(0.01);
  });

  it('finds no sweep when no route comes within reach', () => {
    expect(routeSweepToward([STRAIGHT], at(50, 31), 30, 50)).toBeNull();
    expect(routeSweepToward([], at(50), 30, 50)).toBeNull();
  });

  it('takes the nearest of several routes', () => {
    const east = STRAIGHT.map((p) => ({ ...p, lon: p.lon + 20 / M_PER_LON }));
    const sweep = routeSweepToward([STRAIGHT, east], at(50, 14), 30, 30)!;
    expect(geoDistanceFast(sweep.points[0], at(50, 20))).toBeLessThan(0.01);
  });

  it('follows the route round a corner', () => {
    const corner = [at(0, 40), at(0, 0), at(60, 0)]; // east to west, then north
    const sweep = routeSweepToward([corner], at(20), 10, 50)!;
    expect(sweep.length).toBeCloseTo(50, 4);
    // 20 m back to the corner, then 30 m back east along the first leg
    expect(geoDistanceFast(sweep.points[1], at(0, 0))).toBeLessThan(0.01);
    expect(geoDistanceFast(sweep.points[2], at(0, 30))).toBeLessThan(0.01);
  });
});

describe('pointAlongSweep', () => {
  it('interpolates along the stretch and clamps at its ends', () => {
    const sweep = routeSweepToward([STRAIGHT], at(40), 5, 30)!;
    const out: GeoPosition = { lat: 0, lon: 0 };
    expect(geoDistanceFast(pointAlongSweep(sweep, 0, out), at(40))).toBeLessThan(0.01);
    expect(geoDistanceFast(pointAlongSweep(sweep, 12.5, out), at(27.5))).toBeLessThan(0.01);
    expect(out.height).toBeCloseTo(302.75);
    expect(geoDistanceFast(pointAlongSweep(sweep, 999, out), at(10))).toBeLessThan(0.01);
    expect(geoDistanceFast(pointAlongSweep(sweep, -5, out), at(40))).toBeLessThan(0.01);
  });
});
