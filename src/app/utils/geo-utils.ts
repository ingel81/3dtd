/**
 * Geo utilities for distance calculations
 *
 * Centralized geo calculations to avoid code duplication.
 * Previously duplicated in 5 files:
 * - enemy.manager.ts
 * - tower.manager.ts
 * - game-state.manager.ts
 * - projectile.entity.ts
 * - movement.component.ts
 */

/** Earth radius in meters (WGS84) */
const EARTH_RADIUS = 6371000;

/** Meters per degree latitude (constant) */
const METERS_PER_DEGREE_LAT = 111320;

/** Degrees to radians conversion factor */
const DEG_TO_RAD = Math.PI / 180;

/**
 * Calculate distance between two geo positions using Haversine formula
 * Accurate for any distance on Earth's surface
 *
 * @param lat1 Latitude of first point in degrees
 * @param lon1 Longitude of first point in degrees
 * @param lat2 Latitude of second point in degrees
 * @param lon2 Longitude of second point in degrees
 * @returns Distance in meters
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * DEG_TO_RAD) *
      Math.cos(lat2 * DEG_TO_RAD) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS * c;
}

/**
 * Fast flat-earth distance approximation
 * More efficient than Haversine (no trig in hot path), accurate for distances < 200m
 *
 * @param lat1 Latitude of first point in degrees
 * @param lon1 Longitude of first point in degrees
 * @param lat2 Latitude of second point in degrees
 * @param lon2 Longitude of second point in degrees
 * @returns Distance in meters (approximate)
 */
export function fastDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos(lat1 * DEG_TO_RAD);
  const dx = dLon * metersPerDegreeLon;
  const dy = dLat * METERS_PER_DEGREE_LAT;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Distance calculation with GeoPosition-like objects
 * Convenience wrapper for haversineDistance
 */
export function geoDistance(
  pos1: { lat: number; lon: number },
  pos2: { lat: number; lon: number }
): number {
  return haversineDistance(pos1.lat, pos1.lon, pos2.lat, pos2.lon);
}
