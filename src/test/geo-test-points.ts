// Shared local-plane origin and conversions for geo test fixtures, used by
// hero.manager.spec.ts, hero-input.scenario.spec.ts and route-graph.spec.ts.
// Not app code: import only from specs.

import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from '../app/utils/geo-utils';
import type { GeoPosition } from '../app/models/game.types';

export const LAT0 = 48.7758;
export const LON0 = 9.1829;
export const COS = Math.cos(LAT0 * DEG_TO_RAD);

/** Geo position `x` metres east and `z` metres north of the origin. */
export function at(x: number, z: number): GeoPosition {
  return {
    lat: LAT0 + z / METERS_PER_DEGREE_LAT,
    lon: LON0 + x / (METERS_PER_DEGREE_LAT * COS),
  };
}

/** Metres east and north of the origin, rounded to decimetres. */
export function local(p: GeoPosition) {
  return {
    x: Math.round((p.lon - LON0) * METERS_PER_DEGREE_LAT * COS * 10) / 10,
    z: Math.round((p.lat - LAT0) * METERS_PER_DEGREE_LAT * 10) / 10,
  };
}

export function line(...points: [number, number][]): GeoPosition[] {
  return points.map(([x, z]) => at(x, z));
}
