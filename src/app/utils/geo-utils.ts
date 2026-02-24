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

/**
 * Fast distance calculation with GeoPosition-like objects
 * Uses flat-earth approximation - accurate for distances <200m
 */
export function geoDistanceFast(
  pos1: { lat: number; lon: number },
  pos2: { lat: number; lon: number }
): number {
  return fastDistance(pos1.lat, pos1.lon, pos2.lat, pos2.lon);
}

/**
 * Fast flat-earth distance SQUARED approximation
 * Use for range comparisons: fastDistanceSq(...) <= range * range
 * Avoids the Math.sqrt() call in fastDistance()
 */
export function fastDistanceSq(
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
  return dx * dx + dy * dy;
}

/**
 * Fast distance squared with GeoPosition-like objects
 * Use for range comparisons without sqrt
 */
export function geoDistanceFastSq(
  pos1: { lat: number; lon: number },
  pos2: { lat: number; lon: number }
): number {
  return fastDistanceSq(pos1.lat, pos1.lon, pos2.lat, pos2.lon);
}

/**
 * Find the minimum distance from a point to any segment on the given routes.
 * Checks distance to line segments between consecutive route points, not just nodes.
 *
 * @param routes Array of route paths (each route is an array of {lat, lon} points)
 * @param lat Latitude of the query point
 * @param lon Longitude of the query point
 * @returns Distance in meters to the nearest route segment, or Infinity if no routes
 */
export function findNearestRouteDistance(
  routes: { lat: number; lon: number }[][],
  lat: number,
  lon: number
): number {
  let minDist = Infinity;

  for (const route of routes) {
    for (let i = 0; i < route.length - 1; i++) {
      const dist = distanceToSegment(
        lat, lon,
        route[i].lat, route[i].lon,
        route[i + 1].lat, route[i + 1].lon
      );
      if (dist < minDist) {
        minDist = dist;
      }
    }
    // Also check distance to the last point (single-point routes)
    if (route.length === 1) {
      const dist = haversineDistance(lat, lon, route[0].lat, route[0].lon);
      if (dist < minDist) {
        minDist = dist;
      }
    }
  }

  return minDist;
}

/**
 * Calculate perpendicular distance from a point to a line segment in geo coordinates.
 * Projects the point onto the segment and clamps to endpoints.
 */
function distanceToSegment(
  pLat: number, pLon: number,
  aLat: number, aLon: number,
  bLat: number, bLon: number
): number {
  // Scale longitude by cos(latitude) to get approximately equal-distance units
  const midLat = (aLat + bLat) * 0.5;
  const lonScale = Math.cos(midLat * DEG_TO_RAD);

  const dxSeg = (bLon - aLon) * lonScale;
  const dySeg = bLat - aLat;
  const lengthSq = dxSeg * dxSeg + dySeg * dySeg;

  if (lengthSq === 0) {
    return haversineDistance(pLat, pLon, aLat, aLon);
  }

  const dxPoint = (pLon - aLon) * lonScale;
  const dyPoint = pLat - aLat;

  // Parameter t: projection of point onto segment line, clamped to [0,1]
  const t = Math.max(0, Math.min(1,
    (dxPoint * dxSeg + dyPoint * dySeg) / lengthSq
  ));

  // Interpolate in original coordinates for haversine
  const closestLat = aLat + t * (bLat - aLat);
  const closestLon = aLon + t * (bLon - aLon);

  return haversineDistance(pLat, pLon, closestLat, closestLon);
}
