import { afterEach, describe, expect, it } from 'vitest';
import { corridorConfig, getRouteProfile, lateralLimit, resetCorridorConfig, sizeRouteCorners } from './route-corridor';
import { ARC_SHAVE_M } from './route-corners';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from './geo-utils';
import type { RouteWaypoint } from '../models/game.types';

afterEach(() => resetCorridorConfig());

describe('route corners', () => {
  /** Waypoints through `points` (metres east, north of 0, 0), half widths per segment left and right. */
  function through(points: [number, number][], left: (number | undefined)[] = [], right = left): RouteWaypoint[] {
    return points.map(([e, n], i) => ({
      lat: n / METERS_PER_DEGREE_LAT,
      lon: e / METERS_PER_DEGREE_LAT,
      corridorLeft: left[i],
      corridorRight: right[i],
    }));
  }

  /** Points from (east, north) on, `lengths` apart, each turning `turns` degrees (right positive) from the heading before. */
  function polyline(lengths: number[], turns: number[]): [number, number][] {
    const points: [number, number][] = [[0, 0]];
    let [east, north, heading] = [0, 0, 0];
    lengths.forEach((length, i) => {
      heading += (turns[i] ?? 0) * DEG_TO_RAD;
      east += length * Math.sin(heading);
      north += length * Math.cos(heading);
      points.push([east, north]);
    });
    return points;
  }

  /** The waypoints on arc `arc`, first and last. */
  const waypointsOf = (arcOf: Int32Array, arc: number) => [arcOf.indexOf(arc), arcOf.lastIndexOf(arc)];

  const room = () => lateralLimit(corridorConfig.defaultHalfWidth);

  it('rounds a right angle with the inner limit as its radius, inside on the side it turns to', () => {
    const right = getRouteProfile(through([[0, 0], [0, 40], [40, 40]])).corners;
    expect(Array.from(right.arcOf)).toEqual([-1, 0, -1]);
    expect(right.turn[0]).toBeCloseTo(Math.PI / 2, 9);
    expect(right.inside[0]).toBe(1);
    expect(right.radius[0]).toBeCloseTo(room(), 6);

    const left = getRouteProfile(through([[0, 0], [0, 40], [-40, 40]])).corners;
    expect(left.inside[0]).toBe(-1);
    expect(left.radius[0]).toBeCloseTo(room(), 6);
  });

  it('takes the radius from the inside, however wide the outside', () => {
    // Right 2 m (0.5 m of room), left 7 m (5.5 m)
    const turningRight = getRouteProfile(through([[0, 0], [0, 40], [40, 40]], [7, 7], [2, 2])).corners;
    expect(turningRight.radius[0]).toBeCloseTo(lateralLimit(2), 6);
    const turningLeft = getRouteProfile(through([[0, 0], [0, 40], [-40, 40]], [7, 7], [2, 2])).corners;
    expect(turningLeft.radius[0]).toBeCloseTo(lateralLimit(7), 6);
  });

  it('leaves a corner sharp without room inside, where the route barely turns, or where it doubles back', () => {
    const sharp = (path: RouteWaypoint[]) => Array.from(getRouteProfile(path).corners.arcOf);
    expect(sharp(through([[0, 0], [0, 40], [40, 40]], [7, 7], [1.5, 1.5]))).toEqual([-1, -1, -1]);
    expect(sharp(through([[0, 0], [0, 40], [0.001, 80]]))).toEqual([-1, -1, -1]);
    expect(sharp(through([[0, 0], [0, 40], [0.01, 0]]))).toEqual([-1, -1, -1]);
  });

  it('rounds a corner the band lays, with pieces of 1 m and small wiggles around it, on one arc over the pieces', () => {
    // Stations every 2 m wiggling by half a degree either way, 1 m from the
    // corner to the stations beside it (bandPath)
    const wiggles = (n: number) => Array.from({ length: n }, (_, i) => (i % 2 ? 0.5 : -0.5));
    const path = through(polyline([...new Array(15).fill(2), 1, 1, ...new Array(15).fill(2)], [...wiggles(15), 0, 90, ...wiggles(15)]));
    const { corners } = getRouteProfile(path);
    const arc = corners.arcOf[16];
    const [first, last] = waypointsOf(corners.arcOf, arc);
    expect(first).toBeLessThan(16);
    expect(last).toBeGreaterThan(16);
    // The arc turns by the sum of its knicks
    expect(corners.turn[arc]).toBeCloseTo(Math.PI / 2, 1);
    // One waypoint alone may take half of each 1 m piece: a radius of 0.5 m
    expect(corners.radius[arc]).toBeGreaterThan(4 * 0.5);
  });

  it('follows a curve of small kinks on arcs about as wide as the curve', () => {
    // 90 degrees to the right in twelve kinks of 7.5 degrees, 4 m apart: a
    // curve of about 30 m radius. Arcs that meet halfway along the pieces
    // follow it as well as one over all of them.
    const path = through(polyline([20, ...new Array(12).fill(4), 20], [0, ...new Array(12).fill(7.5), 0]), new Array(14).fill(4), new Array(14).fill(6));
    const { corners } = getRouteProfile(path);
    expect(corners.radius.length).toBeGreaterThan(0);
    expect(corners.radius.length).toBeLessThanOrEqual(12);
    expect(Math.min(...corners.radius)).toBeGreaterThan(4 * lateralLimit(6));
    // Every kink lies on an arc
    expect(Array.from(corners.arcOf).slice(1, 13).every((arc) => arc >= 0)).toBe(true);
  });

  it('keeps the knicks of an S-bend on arcs of their own, apart', () => {
    // 45 degrees right, 3 m on, 45 degrees left
    const { corners } = getRouteProfile(through(polyline([30, 3, 30], [0, 45, -45])));
    const [right, left] = [corners.arcOf[1], corners.arcOf[2]];
    expect(corners.radius.length).toBe(2);
    expect(corners.inside[right]).toBe(1);
    expect(corners.inside[left]).toBe(-1);
    expect(corners.to[right]).toBeLessThanOrEqual(corners.from[left] + 1e-9);
  });

  it('shares a short segment between the arcs at its ends', () => {
    // North 30 m, 2 m east, north again: a right and a left turn
    const profile = getRouteProfile(through([[0, 0], [0, 30], [2, 30], [2, 60]]));
    const { corners, segmentLengths } = profile;
    expect(corners.arcIn[1] + corners.arcOut[1]).toBeLessThanOrEqual(segmentLengths[1] + 1e-9);
    expect(corners.arcIn[1]).toBeGreaterThan(0);
    expect(corners.arcOut[1]).toBeGreaterThan(0);
  });

  it('caps the lanes inside an arc at its radius and lets the limit rise from the ends of the arc by the taper', () => {
    // 2 m wide on the right, then 6 m for 6 m to a right turn: the limit
    // rises from 0.5 m by the taper towards the corner
    const profile = getRouteProfile(through([[0, -40], [0, 0], [0, 6], [30, 6]], [6, 6, 6], [2, 6, 6]));
    const { corners, taper, segmentLengths, right, left } = profile;
    const arc = corners.arcOf[2];
    const radius = corners.radius[arc];
    expect(corners.capRight[arc]).toBe(radius);
    expect(corners.capLeft[arc]).toBe(Infinity);
    // At the waypoint no more than the radius, and the sharp route's limit where that is less
    expect(corners.right.arc[2]).toBeCloseTo(Math.min(radius, right.node[2]), 9);
    // Where the arc starts on the segment before, the sharp route's limit there
    const before = segmentLengths[1] - corners.arcOut[1];
    expect(corners.right.exit[1]).toBeCloseTo(Math.min(right.node[1] + taper * before, radius), 9);
    // The outside keeps the sharp route's limit
    expect(Array.from(corners.left.arc)).toEqual(Array.from(left.node));
    // Every value rises by at most the taper per metre from its neighbours
    for (let k = 1; k < 4; k++) {
      expect(Math.abs(corners.right.arc[k] - corners.right.arc[k - 1])).toBeLessThanOrEqual(taper * segmentLengths[k - 1] + 1e-9);
    }
  });

  it('gives up at most ARC_SHAVE_M of a lane in the middle of an arc', () => {
    const wiggles = (n: number) => Array.from({ length: n }, (_, i) => (i % 2 ? 3 : -3));
    const path = through(polyline(new Array(40).fill(1.5), [0, ...wiggles(39)].map((w, i) => w + (i % 5 === 0 ? 12 : 0))));
    const { corners } = getRouteProfile(path);
    expect(corners.radius.length).toBeGreaterThan(0);
    for (let arc = 0; arc < corners.radius.length; arc++) {
      expect(corners.shaveLeft[arc]).toBeLessThanOrEqual(ARC_SHAVE_M);
      expect(corners.shaveRight[arc]).toBeLessThanOrEqual(ARC_SHAVE_M);
    }
  });

  it('is the sharp route on a route that does not turn', () => {
    const profile = getRouteProfile(through([[0, 0], [0, 50], [0, 100]], [6, 2], [6, 2]));
    expect(profile.corners.radius.length).toBe(0);
    expect(profile.corners.right.arc).toBe(profile.right.node);
    expect(profile.corners.left.arc).toBe(profile.left.node);
  });

  it('sizes the arcs once per path, the same for the same waypoints', () => {
    const points = polyline([10, 3, 3, 3, 10], [0, 30, 30, -20, 0]);
    const profile = getRouteProfile(through(points));
    expect(profile.corners).toBe(profile.corners);
    expect(getRouteProfile(through(points)).corners).toEqual(profile.corners);
  });

  it('sizes the same arcs an arc at a time as at once, and says when they stand', () => {
    const points = polyline([20, ...new Array(12).fill(4), 3, 3, 20], [0, ...new Array(12).fill(7.5), 40, -60, 0]);
    const sliced = through(points);
    let steps = 1;
    while (!sizeRouteCorners(sliced, -1)) steps++;
    expect(steps).toBeGreaterThan(10);
    expect(sizeRouteCorners(sliced, -1)).toBe(true);
    expect(getRouteProfile(sliced).corners).toEqual(getRouteProfile(through(points)).corners);
  });
});
