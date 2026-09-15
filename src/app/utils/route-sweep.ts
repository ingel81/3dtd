/**
 * Route sweeps: a stretch of an enemy route that something runs along, from
 * a point on the route back toward the route's start (the spawn portal).
 * The orbital laser's beam follows one.
 *
 * Pure geometry on the route polylines, in metres of a flat frame around
 * the point asked for (longitude scaled by cos(latitude)), like
 * geoDistanceFast. Nothing random, nothing cached: the same routes and the
 * same point give the same sweep.
 */

import type { GeoPosition } from '../models/game.types';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from './geo-utils';

/** A route stretch with the distance along it to every point, m. */
export interface RouteSweep {
  /** From the start point on, toward the route's start */
  readonly points: readonly GeoPosition[];
  /** Metres from points[0] to each point */
  readonly cumulative: readonly number[];
  /** Metres from the first point to the last */
  readonly length: number;
}

interface Projection {
  route: readonly GeoPosition[];
  /** Segment index: the point lies between route[segment] and route[segment + 1] */
  segment: number;
  /** Share of the segment from route[segment], 0-1 */
  t: number;
  distanceM: number;
}

function lerpHeight(a: GeoPosition, b: GeoPosition, t: number): number | undefined {
  if (a.height === undefined || b.height === undefined) return a.height ?? b.height;
  return a.height + (b.height - a.height) * t;
}

/**
 * The point nearest to `target` on any of `routes`, if it is within
 * `maxDistanceM` (2D). Ties keep the route and segment found first.
 */
function project(routes: Iterable<readonly GeoPosition[]>, target: GeoPosition, maxDistanceM: number): Projection | null {
  const mPerLat = METERS_PER_DEGREE_LAT;
  const mPerLon = METERS_PER_DEGREE_LAT * Math.cos(target.lat * DEG_TO_RAD);
  let best: Projection | null = null;
  for (const route of routes) {
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i];
      const b = route[i + 1];
      const ax = (a.lon - target.lon) * mPerLon;
      const az = (a.lat - target.lat) * mPerLat;
      const dx = (b.lon - a.lon) * mPerLon;
      const dz = (b.lat - a.lat) * mPerLat;
      const lengthSq = dx * dx + dz * dz;
      const t = lengthSq > 0 ? Math.min(1, Math.max(0, -(ax * dx + az * dz) / lengthSq)) : 0;
      const px = ax + dx * t;
      const pz = az + dz * t;
      const distanceM = Math.sqrt(px * px + pz * pz);
      if (distanceM <= maxDistanceM && (best === null || distanceM < best.distanceM)) {
        best = { route, segment: i, t, distanceM };
      }
    }
  }
  return best;
}

/**
 * The stretch of the route nearest to `target` (within `maxDistanceM`) from
 * the point on it nearest to the target back toward the route's start, at
 * most `lengthM` long; shorter where the route begins sooner. Null when no
 * route comes within `maxDistanceM`.
 */
export function routeSweepToward(
  routes: Iterable<readonly GeoPosition[]>,
  target: GeoPosition,
  maxDistanceM: number,
  lengthM: number,
): RouteSweep | null {
  const hit = project(routes, target, maxDistanceM);
  if (!hit) return null;

  const { route, segment, t } = hit;
  const a = route[segment];
  const b = route[segment + 1];
  const start: GeoPosition = {
    lat: a.lat + (b.lat - a.lat) * t,
    lon: a.lon + (b.lon - a.lon) * t,
    height: lerpHeight(a, b, t),
  };
  const points: GeoPosition[] = [start];
  const cumulative = [0];
  let covered = 0;
  let from = start;
  for (let i = segment; i >= 0 && covered < lengthM; i--) {
    const next = route[i];
    const step = flatDistance(from, next);
    if (step <= 0) continue;
    if (covered + step >= lengthM) {
      const share = (lengthM - covered) / step;
      points.push({
        lat: from.lat + (next.lat - from.lat) * share,
        lon: from.lon + (next.lon - from.lon) * share,
        height: lerpHeight(from, next, share),
      });
      covered = lengthM;
      cumulative.push(covered);
      break;
    }
    covered += step;
    points.push({ lat: next.lat, lon: next.lon, height: next.height });
    cumulative.push(covered);
    from = next;
  }
  return { points, cumulative, length: covered };
}

/** Where a point lies against a sweep. */
export interface SweepOffset {
  /** Metres along the sweep from points[0] to the sweep point nearest the point */
  alongM: number;
  /** Metres from that sweep point to the point, 2D */
  offM: number;
}

/**
 * Where `target` lies against `sweep`: the sweep point nearest to it, if it
 * is within `maxDistanceM` (2D). A target beyond an end of the sweep
 * measures from that end. Null farther off.
 */
export function sweepOffset(sweep: RouteSweep, target: GeoPosition, maxDistanceM: number): SweepOffset | null {
  const hit = project([sweep.points], target, maxDistanceM);
  if (!hit) return null;
  const { cumulative } = sweep;
  const span = cumulative[hit.segment + 1] - cumulative[hit.segment];
  return { alongM: cumulative[hit.segment] + span * hit.t, offM: hit.distanceM };
}

/**
 * The point `distanceM` along `sweep` (clamped to its ends), written into
 * `out`.
 */
export function pointAlongSweep(sweep: RouteSweep, distanceM: number, out: GeoPosition): GeoPosition {
  const { points, cumulative } = sweep;
  const last = points.length - 1;
  if (last <= 0 || distanceM <= 0) return copyInto(points[0], out);
  if (distanceM >= sweep.length) return copyInto(points[last], out);
  let i = 1;
  while (i < last && cumulative[i] < distanceM) i++;
  const span = cumulative[i] - cumulative[i - 1];
  const t = span > 0 ? (distanceM - cumulative[i - 1]) / span : 0;
  const a = points[i - 1];
  const b = points[i];
  out.lat = a.lat + (b.lat - a.lat) * t;
  out.lon = a.lon + (b.lon - a.lon) * t;
  out.height = lerpHeight(a, b, t);
  return out;
}

function copyInto(p: GeoPosition, out: GeoPosition): GeoPosition {
  out.lat = p.lat;
  out.lon = p.lon;
  out.height = p.height;
  return out;
}

/** Metres between two points in the flat frame of `a`. */
function flatDistance(a: GeoPosition, b: GeoPosition): number {
  const dz = (b.lat - a.lat) * METERS_PER_DEGREE_LAT;
  const dx = (b.lon - a.lon) * METERS_PER_DEGREE_LAT * Math.cos(a.lat * DEG_TO_RAD);
  return Math.sqrt(dx * dx + dz * dz);
}
