import type { Street } from '../interfaces/street-network-provider.interface';
import { METERS_PER_DEGREE_LAT, DEG_TO_RAD } from './geo-utils';

/**
 * Geo geometry of a spawn's route: where it leaves the street network for
 * the HQ, and the subdivision DevWorld needs on steep procedural terrain.
 * Used by PathAndRouteService when it builds a route.
 */

interface LatLon {
  lat: number;
  lon: number;
}

/** Great-circle distance in metres, as the pathfinding services give it. */
export interface GeoDistance {
  haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number;
}

/**
 * Find closest point on a line segment to a target point
 * @param a Segment start
 * @param b Segment end
 * @param target Target point
 * @returns Closest point on segment
 */
export function closestPointOnSegment(a: LatLon, b: LatLon, target: LatLon): LatLon {
  // Project in metre-proportional units: a degree of longitude is only
  // cos(lat) as long as a degree of latitude. Unscaled, the foot point
  // slides along the street (~6 m on a diagonal street at 48° N) and the
  // last leg to the HQ runs at a slant instead of straight across.
  const lonScale = Math.cos(((a.lat + b.lat) * 0.5) * DEG_TO_RAD);
  const dLon = b.lon - a.lon;
  const dLat = b.lat - a.lat;
  const dx = dLon * lonScale;
  const lengthSquared = dx * dx + dLat * dLat;

  if (lengthSquared === 0) {
    return { lat: a.lat, lon: a.lon };
  }

  // Project target onto the line, clamped to segment
  const t = Math.max(0, Math.min(1, ((target.lon - a.lon) * lonScale * dx + (target.lat - a.lat) * dLat) / lengthSquared));

  return {
    lat: a.lat + t * dLat,
    lon: a.lon + t * dLon,
  };
}

/**
 * Extend path along streets to find optimal 90° turn-off point to HQ
 * @param geoPath Current path
 * @param base Base coordinates
 * @param streets Streets of the network the path runs on
 * @param geo Distance function of the pathfinding service
 * @returns Extended path
 */
export function extendPathToOptimalTurnoff(
  geoPath: LatLon[],
  base: LatLon,
  streets: readonly Street[],
  geo: GeoDistance,
): LatLon[] {
  if (geoPath.length < 2) return geoPath;

  const lastPoint = geoPath[geoPath.length - 1];

  // Find streets that contain a node near the last point
  const TOLERANCE = 0.00001; // ~1m tolerance
  const matchingStreets: { street: Street; nodeIndex: number }[] = [];

  for (const street of streets) {
    for (let i = 0; i < street.nodes.length; i++) {
      const node = street.nodes[i];
      if (Math.abs(node.lat - lastPoint.lat) < TOLERANCE && Math.abs(node.lon - lastPoint.lon) < TOLERANCE) {
        matchingStreets.push({ street, nodeIndex: i });
      }
    }
  }

  if (matchingStreets.length === 0) return geoPath;

  // Find best extension
  let bestExtension: LatLon[] = [];
  let bestClosestDist = geo.haversineDistance(
    lastPoint.lat,
    lastPoint.lon,
    base.lat,
    base.lon
  );

  for (const { street, nodeIndex } of matchingStreets) {
    // Try extending in both directions
    for (const direction of [-1, 1]) {
      const extension: LatLon[] = [];
      let idx = nodeIndex + direction;
      let foundBetterPoint = false;

      // Extend up to 20 nodes in this direction
      while (idx >= 0 && idx < street.nodes.length && extension.length < 20) {
        const node = street.nodes[idx];

        const distToHQ = geo.haversineDistance(node.lat, node.lon, base.lat, base.lon);

        const prevPoint = extension.length > 0 ? extension[extension.length - 1] : lastPoint;
        const closestOnSeg = closestPointOnSegment(
          prevPoint,
          { lat: node.lat, lon: node.lon },
          { lat: base.lat, lon: base.lon }
        );
        const segDistToHQ = geo.haversineDistance(
          closestOnSeg.lat,
          closestOnSeg.lon,
          base.lat,
          base.lon
        );

        if (segDistToHQ < bestClosestDist || distToHQ < bestClosestDist) {
          foundBetterPoint = true;
          extension.push({ lat: node.lat, lon: node.lon });
          idx += direction;
        } else {
          break;
        }
      }

      if (foundBetterPoint && extension.length > 0) {
        let minDist = bestClosestDist;
        for (let i = 0; i < extension.length; i++) {
          const prev = i === 0 ? lastPoint : extension[i - 1];
          const curr = extension[i];
          const closest = closestPointOnSegment(prev, curr, {
            lat: base.lat,
            lon: base.lon,
          });
          const dist = geo.haversineDistance(closest.lat, closest.lon, base.lat, base.lon);
          if (dist < minDist) {
            minDist = dist;
          }
        }

        if (minDist < bestClosestDist) {
          bestClosestDist = minDist;
          bestExtension = extension;
        }
      }
    }
  }

  return [...geoPath, ...bestExtension];
}

/**
 * Cut the path at the point where it passes closest to the HQ, keep that
 * point (unless it lies within a metre of the last node kept) and end the
 * path at the HQ.
 * @param geoPath Path along the streets, at least two points
 * @param base Base coordinates
 * @param geo Distance function of the pathfinding service
 * @returns The path up to the turn-off, then the HQ
 */
export function leavePathForBase(geoPath: LatLon[], base: LatLon, geo: GeoDistance): LatLon[] {
  // Find the closest point to HQ on the path
  let closestSegmentIndex = geoPath.length - 2;
  let closestPoint: LatLon | null = null;
  let closestDist = Infinity;

  for (let i = 0; i < geoPath.length - 1; i++) {
    const a = geoPath[i];
    const b = geoPath[i + 1];

    const closest = closestPointOnSegment(a, b, {
      lat: base.lat,
      lon: base.lon,
    });
    const dist = geo.haversineDistance(
      closest.lat,
      closest.lon,
      base.lat,
      base.lon
    );

    if (dist < closestDist) {
      closestDist = dist;
      closestSegmentIndex = i;
      closestPoint = closest;
    }
  }

  // Cut path at the segment and insert the closest point
  const cut = geoPath.slice(0, closestSegmentIndex + 1);
  if (closestPoint) {
    const lastPoint = cut[cut.length - 1];
    const distToLast = geo.haversineDistance(
      closestPoint.lat,
      closestPoint.lon,
      lastPoint.lat,
      lastPoint.lon
    );
    if (distToLast > 1) {
      cut.push(closestPoint);
    }
  }

  // Add HQ as final destination
  cut.push({ lat: base.lat, lon: base.lon });
  return cut;
}

/**
 * Subdivide a geo path so no segment is longer than maxLength meters.
 * This ensures smooth terrain following on hilly terrain.
 *
 * @param path Original geo path
 * @param maxLength Maximum segment length in meters
 * @returns Subdivided path with more points
 */
export function subdivideGeoPath(path: LatLon[], maxLength: number): LatLon[] {
  if (path.length < 2) return path;

  const result: LatLon[] = [];

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];

    // Calculate distance
    const dLat = b.lat - a.lat;
    const dLon = b.lon - a.lon;
    const avgLat = (a.lat + b.lat) / 2;
    const dx = dLon * METERS_PER_DEGREE_LAT * Math.cos(avgLat * DEG_TO_RAD);
    const dy = dLat * METERS_PER_DEGREE_LAT;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Always add start point
    result.push(a);

    // Add intermediate points if segment is too long
    if (distance > maxLength) {
      const numSegments = Math.ceil(distance / maxLength);
      for (let j = 1; j < numSegments; j++) {
        const t = j / numSegments;
        result.push({
          lat: a.lat + t * dLat,
          lon: a.lon + t * dLon,
        });
      }
    }
  }

  // Add final point
  result.push(path[path.length - 1]);

  return result;
}
