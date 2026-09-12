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
 * Every knob of the corridor, in one place. Lengths in metres. The values in
 * use are {@link corridorConfig}; routes and grid read them when they are
 * built, so a change needs a rebuild to show.
 */
export interface CorridorConfig {
  /**
   * Smallest corridor half width. Two 2 m cells across: towers only see
   * enemies that stand in a cell, so the corridor never shrinks to a single
   * file.
   */
  minHalfWidth: number;
  /** Largest corridor half width. */
  maxHalfWidth: number;
  /**
   * Half width for a route stretch nothing is known about (paths built
   * outside the route service, tests).
   */
  defaultHalfWidth: number;
  /**
   * Distance an enemy keeps from the corridor edge. At least half the
   * diagonal of a 2 m route cell (1.41 m): an enemy within
   * `halfWidth - edgeMargin` of the centre line stands in a cell whose
   * centre is within `halfWidth`, and those are exactly the cells the grid
   * creates.
   */
  edgeMargin: number;
  /**
   * How fast the lateral room may change along the route, metres sideways
   * per metre walked. Where the street narrows, enemies start moving in
   * before the narrow stretch instead of jumping sideways at its first
   * waypoint.
   */
  taper: number;
  /** Spacing of the clearance stations along a route segment. */
  stationSpacing: number;
  /**
   * Height of the clearance rays over the ground: over parked cars, into
   * facades and into tree crowns that reach down to the street.
   */
  rayHeight: number;
  /**
   * Tiles coarser than this (geometric error) do not count for the clearance
   * rays. During refinement a coarse ancestor hull stays active and averages
   * street and facades into one lump, which a horizontal ray would hit right
   * away. The route corridor refines its tiles to 5 m.
   */
  maxTileError: number;
  /**
   * Measured free space is rounded down to this step, so a ragged facade
   * does not split the segment at every station.
   */
  widthStep: number;
  /**
   * A dip in the measured free space up to about this long is closed: a
   * lamp post, a sign, a van. Rounded up to whole stations either side, see
   * {@link closeShortDips}.
   */
  dipLength: number;
  /**
   * Typical carriageway width per `highway` class. Used when a way has
   * neither `width` nor `lanes`, which is most of them. Motorways are mapped
   * per direction, so the value is one carriageway.
   */
  highwayWidths: Record<string, number>;
  /** Width for a `highway` class the table does not know. */
  unknownHighwayWidth: number;
  /** Width of one lane, for ways with a `lanes` tag. */
  laneWidth: number;
  /** Share of kerb and markings added to `lanes` × `laneWidth`. */
  laneExtra: number;
}

/** The corridor as built, see {@link CorridorConfig}. */
export const CORRIDOR_DEFAULTS: Readonly<CorridorConfig> = Object.freeze({
  minHalfWidth: 2,
  maxHalfWidth: 7,
  defaultHalfWidth: 4.5,
  edgeMargin: 1.5,
  taper: 0.5,
  stationSpacing: 2,
  rayHeight: 2,
  maxTileError: 5,
  widthStep: 0.5,
  dipLength: 4,
  highwayWidths: Object.freeze({
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
  }),
  unknownHighwayWidth: 5,
  laneWidth: 3,
  laneExtra: 1,
});

function copyConfig(config: Readonly<CorridorConfig>): CorridorConfig {
  return { ...config, highwayWidths: { ...config.highwayWidths } };
}

/** The values in use. Start as {@link CORRIDOR_DEFAULTS}. */
export const corridorConfig: CorridorConfig = copyConfig(CORRIDOR_DEFAULTS);

/** Back to {@link CORRIDOR_DEFAULTS}. */
export function resetCorridorConfig(): void {
  Object.assign(corridorConfig, copyConfig(CORRIDOR_DEFAULTS));
}

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
 * Carriageway width of a street: the `width` tag, else `lanes` × lane width
 * plus kerb, else a typical value for its `highway` class.
 */
export function estimateStreetWidth(street: StreetWidthTags): StreetWidthEstimate {
  if (street.width !== undefined && street.width > 0) {
    return { widthM: street.width, source: 'width' };
  }
  if (street.lanes !== undefined && street.lanes > 0) {
    return { widthM: street.lanes * corridorConfig.laneWidth + corridorConfig.laneExtra, source: 'lanes' };
  }
  return {
    widthM: corridorConfig.highwayWidths[street.type] ?? corridorConfig.unknownHighwayWidth,
    source: 'highway',
  };
}

/** Corridor half width for a street or free-space width, clamped to the configured range. */
export function corridorHalfWidth(widthM: number): number {
  return Math.min(corridorConfig.maxHalfWidth, Math.max(corridorConfig.minHalfWidth, widthM / 2));
}

/**
 * Corridor half width per route segment, from the street each one runs
 * over. A segment off the network (the leg to the HQ) keeps the width of the
 * street it leaves; one with no street before it gets the default.
 */
export function routeHalfWidths(ways: readonly (StreetWidthTags | null)[]): number[] {
  const halfWidths: number[] = [];
  let previous = corridorConfig.defaultHalfWidth;
  for (const way of ways) {
    if (way) previous = corridorHalfWidth(estimateStreetWidth(way).widthM);
    halfWidths.push(previous);
  }
  return halfWidths;
}

/**
 * Largest (or smallest) known value among station `k` and the `radius`
 * stations either side; NaN if none is known.
 */
function windowExtreme(values: readonly number[], k: number, radius: number, pick: (a: number, b: number) => number): number {
  let result = NaN;
  for (let j = Math.max(0, k - radius); j <= Math.min(values.length - 1, k + radius); j++) {
    const v = values[j];
    if (Number.isNaN(v)) continue;
    result = Number.isNaN(result) ? v : pick(result, v);
  }
  return result;
}

/** Stations either side a filter has to look at to catch features up to `lengthM` long. */
function stationRadius(lengthM: number): number {
  return Math.max(0, Math.ceil(lengthM / corridorConfig.stationSpacing / 2));
}

/**
 * Morphological closing over `radius` stations either side (by default
 * enough for `dipLength`). A dip in the clearance of up to `2 * radius`
 * stations (a lamp post, a sign, a van) goes, a longer narrowing keeps its
 * full length. NaN marks a station that could not be measured; it stays
 * unknown and does not count for its neighbours.
 */
export function closeShortDips(values: readonly number[], radius = stationRadius(corridorConfig.dipLength)): number[] {
  const dilated = values.map((_, k) => windowExtreme(values, k, radius, Math.max));
  return dilated.map((_, k) => (Number.isNaN(values[k]) ? NaN : windowExtreme(dilated, k, radius, Math.min)));
}

/** A stretch of a segment with its own half width, from `t` (0-1 along the segment) to the next piece. */
export interface CorridorPiece {
  t: number;
  halfWidth: number;
}

/**
 * Split a segment into stretches with the half width the tiles allow.
 *
 * `clearances` holds one measured free space per station, station `k` of
 * `n` standing for `[k/n, (k+1)/n]` of the segment. Each station gets the
 * street's half width, or the free space where that is less (after
 * closeShortDips), never below the minimum, rounded down to `widthStep` so
 * a ragged facade does not split the segment at every station. Runs of
 * equal width become one piece.
 */
export function clearancePieces(streetHalfWidth: number, clearances: readonly number[]): CorridorPiece[] {
  const n = clearances.length;
  const closed = closeShortDips(clearances);
  const step = corridorConfig.widthStep;
  const pieces: CorridorPiece[] = [];
  for (let k = 0; k < n; k++) {
    // A ray that hit nothing reports its full length, the street half width.
    const clearance = closed[k];
    const free = Number.isNaN(clearance) || clearance >= streetHalfWidth
      ? streetHalfWidth
      : Math.floor(clearance / step) * step;
    const halfWidth = Math.min(streetHalfWidth, Math.max(corridorConfig.minHalfWidth, free));
    if (pieces.length === 0 || pieces[pieces.length - 1].halfWidth !== halfWidth) {
      pieces.push({ t: k / n, halfWidth });
    }
  }
  return pieces;
}

/** Half width of the segment that starts at `waypoint`. */
export function segmentHalfWidth(waypoint: RouteWaypoint): number {
  return waypoint.corridorHalfWidth ?? corridorConfig.defaultHalfWidth;
}

/** How far off the centre line an enemy may walk on a segment of this half width. */
export function lateralLimit(halfWidth: number): number {
  return Math.max(0, halfWidth - corridorConfig.edgeMargin);
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
   * than an adjacent segment allows, and at most `taper` per metre above
   * any other point of the route.
   */
  nodeLimit: Float64Array;
  /** The taper the node limits were built with, metres sideways per metre. */
  taper: number;
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
  const taper = corridorConfig.taper;

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
    // by at most `taper` per metre. Inside a segment the envelope is
    // min(segment limit, start node + taper * s, end node + taper * rest),
    // because every other segment reaches it through one of the two nodes.
    for (let k = 0; k < path.length; k++) {
      const before = k > 0 ? segmentLimit[k - 1] : Infinity;
      const after = k < segments ? segmentLimit[k] : Infinity;
      nodeLimit[k] = Math.min(before, after);
    }
    for (let k = 1; k < path.length; k++) {
      nodeLimit[k] = Math.min(nodeLimit[k], nodeLimit[k - 1] + taper * segmentLengths[k - 1]);
    }
    for (let k = path.length - 2; k >= 0; k--) {
      nodeLimit[k] = Math.min(nodeLimit[k], nodeLimit[k + 1] + taper * segmentLengths[k]);
    }
  }

  return {
    segmentLengths,
    cumulativeLength,
    totalLength: cumulativeLength[segments],
    segmentLimit,
    nodeLimit,
    taper,
  };
}
