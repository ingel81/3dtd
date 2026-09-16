import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import type { RouteWaypoint } from '../models/game.types';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from './geo-utils';
import {
  ROUTE_BODY_COVER,
  ROUTE_BODY_STATION_M,
  RouteBody,
  RouteBodyStations,
  routeBodyStations,
  type RouteBodyContact,
} from './route-body';

const LAT0 = 48.7758;
const LON0 = 9.1829;
const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(LAT0 * DEG_TO_RAD);

/**
 * Flat local frame at (LAT0, LON0): x east, z south, the engine's frame (x west,
 * z north) turned by 180 degrees, which keeps distances and sides.
 */
const flatSync = {
  geoToLocalSimpleInto: (lat: number, lon: number, height: number, target: Vector3): Vector3 =>
    target.set((lon - LON0) * M_PER_DEG_LON, height, -(lat - LAT0) * METERS_PER_DEGREE_LAT),
};

/** Straight north from (LAT0, LON0), `metres` long, 3 m of corridor to each side. */
function northPath(metres: number): RouteWaypoint[] {
  return [
    { lat: LAT0, lon: LON0, corridorLeft: 3, corridorRight: 3 },
    { lat: LAT0 + metres / METERS_PER_DEGREE_LAT, lon: LON0, corridorLeft: 3, corridorRight: 3 },
  ];
}

const contact = (): RouteBodyContact => ({ station: -1, offset: 0, distance: 0 });

describe('RouteBodyStations', () => {
  it('puts a station every two metres along the centre line, the last on the end', () => {
    const st = new RouteBodyStations(northPath(21), flatSync, 0);
    expect(st.count).toBe(Math.ceil(st.length / ROUTE_BODY_STATION_M) + 1);
    expect(st.s[0]).toBe(0);
    expect(st.s[1]).toBe(2);
    expect(st.s[st.count - 1]).toBeCloseTo(st.length, 9);
    // North in the flat frame is -z, the route stays on x = 0
    expect(st.x[5]).toBeCloseTo(0, 6);
    expect(st.z[5]).toBeCloseTo(-10, 1);
    expect(st.segment[5]).toBe(0);
    expect(st.progress[5]).toBeCloseTo(10 / st.length, 3);
  });

  it('points across to the right of travel: east for a route going north', () => {
    const st = new RouteBodyStations(northPath(20), flatSync, 0);
    expect(st.rightX[3]).toBeCloseTo(1, 3);
    expect(st.rightZ[3]).toBeCloseTo(0, 3);
    expect(st.lonPerRight[3] * M_PER_DEG_LON).toBeCloseTo(1, 3);
    expect(st.latPerRight[3]).toBeCloseTo(0, 9);
    expect(st.left[3]).toBe(3);
    expect(st.right[3]).toBe(3);
  });

  it('finds the segment and the progress on it for a distance along the route', () => {
    const path: RouteWaypoint[] = [
      { lat: LAT0, lon: LON0 },
      { lat: LAT0 + 10 / METERS_PER_DEGREE_LAT, lon: LON0 },
      { lat: LAT0 + 30 / METERS_PER_DEGREE_LAT, lon: LON0 },
    ];
    const st = new RouteBodyStations(path, flatSync, 0);
    const out = { segmentIndex: -1, segmentProgress: -1 };
    st.locate(st.length * 0.2, out);
    expect(out.segmentIndex).toBe(0);
    expect(out.segmentProgress).toBeCloseTo(0.6, 3);
    st.locate(st.length * 0.5, out);
    expect(out.segmentIndex).toBe(1);
    expect(out.segmentProgress).toBeCloseTo(0.25, 3);
    st.locate(st.length + 5, out);
    expect(out.segmentIndex).toBe(1);
    expect(out.segmentProgress).toBeCloseTo(1, 9);
  });

  it('is built once per path array', () => {
    const path = northPath(30);
    expect(routeBodyStations(path, flatSync, 0)).toBe(routeBodyStations(path, flatSync, 0));
    expect(routeBodyStations(northPath(30), flatSync, 0)).not.toBe(routeBodyStations(path, flatSync, 0));
  });
});

describe('RouteBody', () => {
  const stations = new RouteBodyStations(northPath(100), flatSync, 250);
  const bodyBetween = (tail: number, tip: number): RouteBody => {
    const body = new RouteBody(stations);
    body.tailM = tail;
    body.tipM = tip;
    return body;
  };

  it('covers the stations between tail and tip', () => {
    const body = bodyBetween(10, 30);
    expect(body.firstStation()).toBe(5);
    expect(body.lastStation()).toBe(15);
    expect(body.covers(4)).toBe(false);
    expect(body.covers(10)).toBe(true);
    expect(body.covers(16)).toBe(false);
  });

  it('finds the nearest point across the corridor and along the body', () => {
    const body = bodyBetween(10, 30);
    // Beside the body, inside the covered half width: on it
    const inside = body.nearest(2, -20, contact());
    expect(inside.station).toBe(10);
    // Haversine metres along the route and flat metres across differ by cm
    expect(inside.offset).toBeCloseTo(2, 3);
    expect(inside.distance).toBeCloseTo(0, 1);
    // 10 m to the east: the edge of the body is 3 m * cover off the centre line
    const beside = body.nearest(10, -20, contact());
    expect(beside.offset).toBeCloseTo(3 * ROUTE_BODY_COVER, 6);
    expect(beside.distance).toBeCloseTo(10 - 3 * ROUTE_BODY_COVER, 1);
    // Ahead of the tip on the centre line: from the tip station
    const ahead = body.nearest(0, -40, contact());
    expect(ahead.station).toBe(15);
    expect(ahead.distance).toBeCloseTo(10, 1);
  });

  it('touches a circle that reaches it and no other', () => {
    const body = bodyBetween(10, 30);
    expect(body.touches(0, -45, 16, contact())).toBe(true);
    expect(body.touches(0, -45, 14, contact())).toBe(false);
    expect(body.touches(0, 5, 14, contact())).toBe(false);
  });

  it('puts the hit on the point in geo, on the ground', () => {
    const body = bodyBetween(10, 30);
    const c = body.nearest(10, -20, contact());
    body.setHit(c.station, c.offset, 2);
    expect((body.hit.lon - LON0) * M_PER_DEG_LON).toBeCloseTo(3 * ROUTE_BODY_COVER, 3);
    expect((body.hit.lat - LAT0) * METERS_PER_DEGREE_LAT).toBeCloseTo(20, 1);
    expect(body.hit.height).toBe(252);
  });
});
