import { describe, it, expect } from 'vitest';
import { computeGuardHeading, findRouteEntry } from './tower-guard-heading';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT, geoHeading } from './geo-utils';

const TOWER = { lat: 48.0, lon: 9.0 };
const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(TOWER.lat * DEG_TO_RAD);

/** Geo point `east` and `north` meters away from the tower. */
const at = (east: number, north: number) => ({
  lat: TOWER.lat + north / METERS_PER_DEGREE_LAT,
  lon: TOWER.lon + east / M_PER_DEG_LON,
});

/** Tower-relative meters of a geo point. */
const meters = (p: { lat: number; lon: number }) => ({
  east: (p.lon - TOWER.lon) * M_PER_DEG_LON,
  north: (p.lat - TOWER.lat) * METERS_PER_DEGREE_LAT,
});

describe('findRouteEntry', () => {
  it('finds where a route crosses into the range', () => {
    // North to south, 10 m east of the tower. With 26 m range it comes into
    // range 24 m north of the tower (10² + 24² = 26²), 76 m after its start.
    const entry = findRouteEntry(TOWER, 26, [at(10, 100), at(10, -100)])!;
    expect(meters(entry).east).toBeCloseTo(10, 6);
    expect(meters(entry).north).toBeCloseTo(24, 6);
    expect(entry.distanceAlongRoute).toBeCloseTo(76, 6);
  });

  it('reports the first entry along the route, not the closest pass', () => {
    // Eastwards 20 m north of the tower, then back westwards 20 m south of it.
    const route = [at(-100, 20), at(100, 20), at(100, -20), at(-100, -20)];
    const entry = findRouteEntry(TOWER, 30, route)!;
    const reach = Math.sqrt(30 * 30 - 20 * 20);
    expect(meters(entry).east).toBeCloseTo(-reach, 6);
    expect(meters(entry).north).toBeCloseTo(20, 6);
    expect(entry.distanceAlongRoute).toBeCloseTo(100 - reach, 6);
  });

  it('takes the start of a route that begins inside the range', () => {
    const entry = findRouteEntry(TOWER, 30, [at(5, 5), at(100, 5)])!;
    expect(entry.distanceAlongRoute).toBe(0);
    expect(meters(entry).east).toBeCloseTo(5, 6);
  });

  it('skips repeated points', () => {
    const entry = findRouteEntry(TOWER, 26, [at(10, 100), at(10, 100), at(10, -100)])!;
    expect(meters(entry).north).toBeCloseTo(24, 6);
  });

  it('returns null for a route that stays out of range', () => {
    expect(findRouteEntry(TOWER, 20, [at(-100, 30), at(100, 30)])).toBeNull();
    // Heads for the range but ends before it.
    expect(findRouteEntry(TOWER, 20, [at(0, 100), at(0, 40)])).toBeNull();
    expect(findRouteEntry(TOWER, 20, [])).toBeNull();
  });
});

describe('computeGuardHeading', () => {
  it('points at the entry: 0 for north, π/2 for east', () => {
    expect(computeGuardHeading(TOWER, 30, [[at(0, 200), at(0, -200)]])).toBeCloseTo(0, 9);
    expect(computeGuardHeading(TOWER, 30, [[at(200, 0), at(-200, 0)]])).toBeCloseTo(Math.PI / 2, 9);
  });

  it('matches the heading the turret aims at a target standing on the entry', () => {
    // Off-axis entries are where a different angle convention would show.
    const entry = at(10, 24);
    expect(computeGuardHeading(TOWER, 26, [[at(10, 100), at(10, -100)]]))
      .toBeCloseTo(geoHeading(TOWER, entry), 9);
  });

  it('with several routes, watches the entry that lies earliest along its route', () => {
    // A reaches the range after 470 m from the north, B after 100 m from the
    // east: B's enemies turn up first, whatever the order of the routes.
    const routeA = [at(0, 500), at(0, 0)];
    const routeB = [at(130, 0), at(0, 0)];
    expect(computeGuardHeading(TOWER, 30, [routeA, routeB])).toBeCloseTo(Math.PI / 2, 9);
    expect(computeGuardHeading(TOWER, 30, [routeB, routeA])).toBeCloseTo(Math.PI / 2, 9);
  });

  it('ignores routes that miss the range', () => {
    const miss = [at(-100, 50), at(100, 50)];
    const hit = [at(200, 0), at(-200, 0)];
    expect(computeGuardHeading(TOWER, 30, [miss, hit])).toBeCloseTo(Math.PI / 2, 9);
  });

  it('is null when no route reaches the range', () => {
    expect(computeGuardHeading(TOWER, 20, [[at(-100, 50), at(100, 50)]])).toBeNull();
    expect(computeGuardHeading(TOWER, 20, [])).toBeNull();
  });
});
