/**
 * Route corridor geometry: how wide the corridor of route cells is on each
 * stretch of a route, and how far an enemy may walk off the centre line.
 *
 * Kept free of Angular and Three.js so the rules can be unit tested; the grid
 * (`GlobalRouteGrid.generateFromRoutes`), the route build
 * (`PathAndRouteService`) and enemy movement (`MovementComponent`) all read
 * the same numbers from here.
 */
import { RouteWaypoint } from '../models/game.types';
import { haversineDistance } from './geo-utils';

/**
 * Smallest corridor half width. Two 2 m cells across: towers only see enemies
 * that stand in a cell, so the corridor never shrinks to a single file.
 */
export const CORRIDOR_MIN_HALF_WIDTH_M = 2;

/** Largest corridor half width, the radius of the old fixed corridor. */
export const CORRIDOR_MAX_HALF_WIDTH_M = 7;

/**
 * Half width for a route stretch nothing is known about (paths built outside
 * the route service, tests). Leaves 3 m of lateral room, the old maximum.
 */
export const CORRIDOR_DEFAULT_HALF_WIDTH_M = 4.5;

/**
 * Distance an enemy keeps from the corridor edge. At least half the diagonal
 * of a 2 m route cell (1.41 m): an enemy within `halfWidth - margin` of the
 * centre line stands in a cell whose centre is within `halfWidth`, and those
 * are exactly the cells the grid creates.
 */
export const LATERAL_EDGE_MARGIN_M = 1.5;

/**
 * How fast the lateral room may change along the route, metres sideways per
 * metre walked. Where the street narrows, enemies start moving in before the
 * narrow stretch instead of jumping sideways at its first waypoint.
 */
export const LATERAL_TAPER = 0.5;

/** Where a street width came from, for the diagnostics. */
export type StreetWidthSource = 'width' | 'lanes' | 'highway';

export interface StreetWidthEstimate {
  /** Full carriageway width in metres. */
  widthM: number;
  source: StreetWidthSource;
}

/** The OSM fields the width estimate reads. */
export interface StreetWidthTags {
  type: string;
  width?: number;
  lanes?: number;
}

/**
 * Typical carriageway width per `highway` class, metres. Used when a way has
 * neither `width` nor `lanes`, which is most of them. Motorways are mapped
 * per direction, so the value is one carriageway.
 */
const HIGHWAY_WIDTHS_M: Record<string, number> = {
  motorway: 11,
  trunk: 9,
  primary: 8,
  secondary: 7,
  tertiary: 6.5,
  motorway_link: 5,
  trunk_link: 5,
  primary_link: 5,
  secondary_link: 5,
  tertiary_link: 5,
  unclassified: 5.5,
  residential: 5.5,
  road: 5.5,
  pedestrian: 6,
  living_street: 4.5,
  busway: 4,
  service: 3.5,
  track: 3,
  cycleway: 2,
  footway: 2,
  path: 2,
  bridleway: 2,
  steps: 2,
};

/** Width for a `highway` class the table does not know. */
const UNKNOWN_HIGHWAY_WIDTH_M = 5;

/** Width of one lane plus the share of kerb and markings, metres. */
const LANE_WIDTH_M = 3;
const LANE_EXTRA_M = 1;

/**
 * Carriageway width of a street: the `width` tag, else `lanes` × 3 m + 1 m,
 * else a typical value for its `highway` class.
 */
export function estimateStreetWidth(street: StreetWidthTags): StreetWidthEstimate {
  if (street.width !== undefined && street.width > 0) {
    return { widthM: street.width, source: 'width' };
  }
  if (street.lanes !== undefined && street.lanes > 0) {
    return { widthM: street.lanes * LANE_WIDTH_M + LANE_EXTRA_M, source: 'lanes' };
  }
  return { widthM: HIGHWAY_WIDTHS_M[street.type] ?? UNKNOWN_HIGHWAY_WIDTH_M, source: 'highway' };
}

/** Corridor half width for a street or free-space width, clamped to [2 m, 7 m]. */
export function corridorHalfWidth(widthM: number): number {
  return Math.min(CORRIDOR_MAX_HALF_WIDTH_M, Math.max(CORRIDOR_MIN_HALF_WIDTH_M, widthM / 2));
}

/**
 * Corridor half width per route segment, from the street each one runs
 * over. A segment off the network (the leg to the HQ) keeps the width of the
 * street it leaves; one with no street before it gets the default.
 */
export function routeHalfWidths(ways: readonly (StreetWidthTags | null)[]): number[] {
  const halfWidths: number[] = [];
  let previous = CORRIDOR_DEFAULT_HALF_WIDTH_M;
  for (const way of ways) {
    if (way) previous = corridorHalfWidth(estimateStreetWidth(way).widthM);
    halfWidths.push(previous);
  }
  return halfWidths;
}

/** Half width of the segment that starts at `waypoint`. */
export function segmentHalfWidth(waypoint: RouteWaypoint): number {
  return waypoint.corridorHalfWidth ?? CORRIDOR_DEFAULT_HALF_WIDTH_M;
}

/** How far off the centre line an enemy may walk on a segment of this half width. */
export function lateralLimit(halfWidth: number): number {
  return Math.max(0, halfWidth - LATERAL_EDGE_MARGIN_M);
}

/**
 * Per-route data movement needs on every sub-step, computed once per path
 * array and shared by every enemy walking it.
 */
export interface RouteProfile {
  /** Haversine length of each segment, metres. */
  segmentLengths: number[];
  /** Prefix sums: `cumulativeLength[i]` = length of segments `0..i-1`. */
  cumulativeLength: number[];
  totalLength: number;
  /** Lateral limit of each segment, from its half width. */
  segmentLimit: Float64Array;
  /**
   * Lateral limit at each waypoint once the taper is applied: never more
   * than an adjacent segment allows, and at most {@link LATERAL_TAPER} per
   * metre above any other point of the route.
   */
  nodeLimit: Float64Array;
}

const profiles = new WeakMap<readonly RouteWaypoint[], RouteProfile>();

/** The profile of `path`, computed on first use. The path must not change afterwards. */
export function getRouteProfile(path: readonly RouteWaypoint[]): RouteProfile {
  let profile = profiles.get(path);
  if (!profile) {
    profile = buildRouteProfile(path);
    profiles.set(path, profile);
  }
  return profile;
}

function buildRouteProfile(path: readonly RouteWaypoint[]): RouteProfile {
  const segments = Math.max(0, path.length - 1);
  const segmentLengths: number[] = new Array(segments);
  const cumulativeLength: number[] = new Array(segments + 1);
  const segmentLimit = new Float64Array(segments);
  const nodeLimit = new Float64Array(path.length);

  cumulativeLength[0] = 0;
  for (let i = 0; i < segments; i++) {
    const a = path[i];
    const b = path[i + 1];
    segmentLengths[i] = haversineDistance(a.lat, a.lon, b.lat, b.lon);
    cumulativeLength[i + 1] = cumulativeLength[i] + segmentLengths[i];
    segmentLimit[i] = lateralLimit(segmentHalfWidth(a));
  }

  if (segments > 0) {
    // A waypoint allows no more than the tighter of its two segments. Then
    // a min-plus distance transform, one pass each way: the limit may rise
    // by at most LATERAL_TAPER per metre. Inside a segment the envelope is
    // min(segment limit, start node + taper * s, end node + taper * rest),
    // because every other segment reaches it through one of the two nodes.
    for (let k = 0; k < path.length; k++) {
      const before = k > 0 ? segmentLimit[k - 1] : Infinity;
      const after = k < segments ? segmentLimit[k] : Infinity;
      nodeLimit[k] = Math.min(before, after);
    }
    for (let k = 1; k < path.length; k++) {
      nodeLimit[k] = Math.min(nodeLimit[k], nodeLimit[k - 1] + LATERAL_TAPER * segmentLengths[k - 1]);
    }
    for (let k = path.length - 2; k >= 0; k--) {
      nodeLimit[k] = Math.min(nodeLimit[k], nodeLimit[k + 1] + LATERAL_TAPER * segmentLengths[k]);
    }
  }

  return {
    segmentLengths,
    cumulativeLength,
    totalLength: cumulativeLength[segments],
    segmentLimit,
    nodeLimit,
  };
}
