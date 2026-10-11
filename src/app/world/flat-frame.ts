import { METERS_PER_DEGREE_LAT } from '../utils/geo-utils';

/**
 * The frame of the synthetic worlds (DevWorld, custom maps): lat/lon around
 * a fixed origin at (0, 0). At latitude 0 the cosine in
 * `EllipsoidSync.geoToLocalSimple` is 1, so these two functions are exactly
 * its conversion and its inverse there: a metre in the scene is a metre on
 * the map in both directions. Main thread only; the simulation keeps its own
 * (sim-coords.ts), which the replays' checksums depend on.
 *
 * Scene convention as everywhere: -X is east, +Z is north.
 */
export const FLAT_WORLD_ORIGIN = { lat: 0, lon: 0, height: 0 } as const;

/** Scene (x, z) to lat/lon in the synthetic frame */
export function flatLocalToGeo(x: number, z: number): { lat: number; lon: number } {
  return {
    lat: FLAT_WORLD_ORIGIN.lat + z / METERS_PER_DEGREE_LAT,
    lon: FLAT_WORLD_ORIGIN.lon - x / METERS_PER_DEGREE_LAT, // -X = East = +lon
  };
}

/** Lat/lon in the synthetic frame to scene (x, z) */
export function flatGeoToLocal(lat: number, lon: number): { x: number; z: number } {
  return {
    x: -(lon - FLAT_WORLD_ORIGIN.lon) * METERS_PER_DEGREE_LAT, // +lon = East = -X
    z: (lat - FLAT_WORLD_ORIGIN.lat) * METERS_PER_DEGREE_LAT,
  };
}
