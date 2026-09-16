import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import type { RouteWaypoint } from '../models/game.types';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from './geo-utils';
import { ROUTE_BODY_COVER, RouteBody, RouteBodyStations } from './route-body';
import { heroBodyContact, type HeroBodyContact } from './hero-body-contact';

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

/** 100 m straight north from (LAT0, LON0), 3 m of corridor to each side. */
const PATH: RouteWaypoint[] = [
  { lat: LAT0, lon: LON0, corridorLeft: 3, corridorRight: 3 },
  { lat: LAT0 + 100 / METERS_PER_DEGREE_LAT, lon: LON0, corridorLeft: 3, corridorRight: 3 },
];

/** An ooze from 20 m to 80 m along the path, its tip at 80 m. */
function ooze(): RouteBody {
  const body = new RouteBody(new RouteBodyStations(PATH, flatSync, 0));
  body.tailM = 20;
  body.tipM = 80;
  return body;
}

const out = (): HeroBodyContact => ({ lat: 0, lon: 0, height: 0, distanceM: 0 });
const groundAt7 = () => 7;

describe('heroBodyContact', () => {
  // The stations sit on the path's own length, a few centimetres off the
  // flat frame here: expectations read their positions instead of 50 or 80 m

  it('measures to the nearest point of the body, not to its tip', () => {
    // 5 m east of the centre line at 50 m (station 25), 30 m behind the tip
    const body = ooze();
    const st = body.stations;
    const contact = heroBodyContact(body, 5, -50, groundAt7, 0, out());
    const cover = 3 * ROUTE_BODY_COVER;
    expect(contact.distanceM).toBeLessThan(3);
    expect(contact.distanceM).toBeCloseTo(Math.hypot(5 - cover, -50 - st.z[25]), 6);
    expect(contact.lat).toBeCloseTo(st.lat[25] + st.latPerRight[25] * cover, 9);
    expect(contact.lon).toBeCloseTo(st.lon[25] + st.lonPerRight[25] * cover, 9);
    expect(contact.lon).toBeGreaterThan(LON0); // across to the east, toward the spot
    expect(contact.height).toBe(7);
  });

  it('takes the tip beyond it and the tail behind it', () => {
    const body = ooze();
    const st = body.stations;
    const tip = body.lastStation();
    const tail = body.firstStation();

    const ahead = heroBodyContact(body, 0, -95, groundAt7, 0, out());
    expect(ahead.lat).toBe(st.lat[tip]);
    expect(ahead.distanceM).toBeCloseTo(95 + st.z[tip], 6);
    expect(ahead.lat).toBeCloseTo(LAT0 + 80 / METERS_PER_DEGREE_LAT, 5);

    const behind = heroBodyContact(body, 0, -5, groundAt7, 0, out());
    expect(behind.lat).toBe(st.lat[tail]);
    expect(behind.distanceM).toBeCloseTo(-5 - st.z[tail], 6);
  });

  it('takes the fallback ground where the grid has none and puts the body\'s hit there', () => {
    const body = ooze();
    const contact = heroBodyContact(body, 0, -50, () => null, 3, out());
    expect(contact.height).toBe(3);
    expect(body.hit).toEqual({ lat: contact.lat, lon: contact.lon, height: 3 });
  });
});
