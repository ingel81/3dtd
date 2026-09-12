import { DEG_TO_RAD, METERS_PER_DEGREE_LAT, geoHeading } from './geo-utils';

interface LatLon {
  lat: number;
  lon: number;
}

/** Where a route first comes into a tower's range. */
export interface RouteEntry {
  lat: number;
  lon: number;
  /** Meters along the route from its start (the spawn) to the entry point. */
  distanceAlongRoute: number;
}

/**
 * First point on `route`, walked from its start (the spawn), that lies within
 * `range` meters of `tower`, or null if the route never comes that close.
 *
 * Measured in flat-earth meters around the tower, the same measure
 * Tower.findTarget uses for its range: this is where an enemy on the route
 * becomes a target by distance. Line of sight is not considered.
 */
export function findRouteEntry(
  tower: LatLon,
  range: number,
  route: readonly LatLon[],
): RouteEntry | null {
  if (route.length === 0) return null;

  const mPerDegLon = METERS_PER_DEGREE_LAT * Math.cos(tower.lat * DEG_TO_RAD);
  const rangeSq = range * range;

  // Route points relative to the tower, in meters (x east, y north).
  let ax = (route[0].lon - tower.lon) * mPerDegLon;
  let ay = (route[0].lat - tower.lat) * METERS_PER_DEGREE_LAT;
  if (ax * ax + ay * ay <= rangeSq) {
    return { lat: route[0].lat, lon: route[0].lon, distanceAlongRoute: 0 };
  }

  let walked = 0;
  for (let i = 1; i < route.length; i++) {
    const bx = (route[i].lon - tower.lon) * mPerDegLon;
    const by = (route[i].lat - tower.lat) * METERS_PER_DEGREE_LAT;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;

    if (lengthSq > 0) {
      // |A + t·d|² = range². A lies outside the range (otherwise the walk
      // would have stopped earlier), so both roots share a sign and the
      // smaller one is where the segment crosses into the range.
      const halfB = ax * dx + ay * dy;
      const c = ax * ax + ay * ay - rangeSq;
      const disc = halfB * halfB - lengthSq * c;
      if (disc >= 0) {
        const t = (-halfB - Math.sqrt(disc)) / lengthSq;
        if (t >= 0 && t <= 1) {
          const from = route[i - 1];
          return {
            lat: from.lat + (route[i].lat - from.lat) * t,
            lon: from.lon + (route[i].lon - from.lon) * t,
            distanceAlongRoute: walked + t * Math.sqrt(lengthSq),
          };
        }
      }
      walked += Math.sqrt(lengthSq);
    }

    ax = bx;
    ay = by;
  }

  return null;
}

/**
 * Heading (geoHeading convention) a tower watches between waves: towards the
 * point where a route first enters its range, i.e. where the next enemy will
 * turn up.
 *
 * With several routes the entry that lies earliest along its route wins. The
 * wave hands its enemies to the spawns in turn, so the first ones leave all
 * spawns within a few spawn delays of each other, and the shortest walk to
 * the range is the one that gets an enemy there first.
 *
 * null when no route reaches the range; the turret then keeps its heading.
 */
export function computeGuardHeading(
  tower: LatLon,
  range: number,
  routes: readonly (readonly LatLon[])[],
): number | null {
  let best: RouteEntry | null = null;
  for (const route of routes) {
    const entry = findRouteEntry(tower, range, route);
    if (entry && (!best || entry.distanceAlongRoute < best.distanceAlongRoute)) {
      best = entry;
    }
  }
  return best ? geoHeading(tower, best) : null;
}
