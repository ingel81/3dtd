/**
 * Route corridor geometry: how wide the corridor of route cells is on each
 * stretch of a route, either side of the centre line, and how far an enemy
 * may walk off it.
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
 * built, so a change needs a rebuild to show (`__corridor.set()` does that).
 */
export interface CorridorConfig {
  /**
   * Smallest corridor half width, per side. Half a cell: at a bottleneck the
   * corridor is the file of cells the centre line runs through (the grid
   * claims those in any case), and enemies there walk the centre line,
   * since `lateralLimit` is 0 below `edgeMargin`.
   */
  minHalfWidth: number;
  /**
   * Largest corridor half width, per side. Also how far the clearance rays
   * reach: where they hit nothing, the corridor gets this much.
   */
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
   * Heights of the low and the high clearance ray over the ground. Only
   * what blocks both counts as a wall: a facade, a wall, a trunk. What
   * stops only the low ray (a parked car or van, a hedge, a fence) or only
   * the high one (a tree crown, an eave, a balcony) does not narrow the
   * corridor; a cell that ends up under a crown or an eave is put back on
   * the ground by the roof check (`roofRise`).
   */
  rayHeightLow: number;
  rayHeightHigh: number;
  /**
   * Distance kept from a wall the rays found, taken off the free space, so
   * the cells next to a facade stay out from under balconies and canopies.
   * Not taken off where the rays hit nothing.
   */
  wallMargin: number;
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
   * lamp post, a sign, a van, a single tree trunk. Rounded up to whole
   * stations either side, see {@link closeShortDips}.
   */
  dipLength: number;
  /**
   * A bulge in the measured free space up to about this long is cut: a
   * driveway, a gap between two houses, the mouth of a narrow side street.
   * Rounded up to whole stations either side, see {@link cutShortBulges}.
   */
  bulgeLength: number;
  /**
   * A route cell whose column comes down more than this above the ground
   * on the route centre line beside it takes that ground instead: the
   * column hit a roof, an eave or a tree crown over the street, with no
   * ground under it in the photogrammetry (RouteCellSampler.sampleCellY).
   */
  roofRise: number;
  /**
   * Typical carriageway width per `highway` class, for stations the tiles
   * cannot measure. Used when a way has neither `width` nor `lanes`, which
   * is most of them. Motorways are mapped per direction, so the value is
   * one carriageway.
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
  minHalfWidth: 1,
  maxHalfWidth: 7,
  defaultHalfWidth: 4.5,
  edgeMargin: 1.5,
  taper: 0.5,
  stationSpacing: 2,
  rayHeightLow: 1,
  rayHeightHigh: 3.5,
  wallMargin: 0.5,
  maxTileError: 5,
  widthStep: 0.5,
  dipLength: 4,
  bulgeLength: 8,
  roofRise: 2.5,
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

/**
 * Settings whose change moves the clearance stations or what the rays see:
 * changing one means measuring again. The others only reshape what was
 * measured.
 */
export const MEASUREMENT_KEYS: readonly (keyof CorridorConfig)[] = [
  'stationSpacing',
  'rayHeightLow',
  'rayHeightHigh',
  'maxHalfWidth',
  'maxTileError',
];

/** Allowed range per numeric setting, inclusive. */
const SETTING_RANGES: Record<Exclude<keyof CorridorConfig, 'highwayWidths'>, [number, number]> = {
  // The cells the centre line runs through belong to the corridor at any width.
  minHalfWidth: [0, 15],
  // The route corridor loads fine tiles 20 m either side.
  maxHalfWidth: [1, 15],
  defaultHalfWidth: [1, 15],
  // Half a cell diagonal at least, or enemies at the edge stand outside the cells.
  edgeMargin: [1.42, 5],
  taper: [0.05, 5],
  stationSpacing: [0.5, 10],
  rayHeightLow: [0.3, 10],
  rayHeightHigh: [0.3, 20],
  wallMargin: [0, 5],
  maxTileError: [0.1, 100],
  widthStep: [0.1, 2],
  dipLength: [0, 100],
  bulgeLength: [0, 100],
  roofRise: [0.5, 50],
  unknownHighwayWidth: [1, 50],
  laneWidth: [1, 10],
  laneExtra: [0, 10],
};

/**
 * Change settings in {@link corridorConfig}. A `highwayWidths` patch adds to
 * the table instead of replacing it. A default half width the new range
 * leaves out is moved into it, unless the patch sets it itself. Nothing
 * changes if a key is unknown, a value out of range or the minimum above
 * the maximum.
 *
 * @returns the problems; empty when the patch was applied
 */
export function setCorridorConfig(patch: Partial<CorridorConfig>): string[] {
  const next = copyConfig(corridorConfig);
  const problems: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'highwayWidths') {
      for (const [type, width] of Object.entries((value ?? {}) as Record<string, unknown>)) {
        if (typeof width === 'number' && width > 0 && width <= 50) next.highwayWidths[type] = width;
        else problems.push(`highwayWidths.${type} must be a width from 0 to 50 m`);
      }
      continue;
    }
    const range = SETTING_RANGES[key as keyof typeof SETTING_RANGES];
    if (!range) {
      problems.push(`unknown setting ${key}`);
    } else if (typeof value !== 'number' || !(value >= range[0] && value <= range[1])) {
      problems.push(`${key} must be a number from ${range[0]} to ${range[1]}`);
    } else {
      next[key as keyof typeof SETTING_RANGES] = value;
    }
  }
  if (next.minHalfWidth > next.maxHalfWidth) problems.push('minHalfWidth must not be above maxHalfWidth');
  const defaultOutside = next.defaultHalfWidth < next.minHalfWidth || next.defaultHalfWidth > next.maxHalfWidth;
  if (defaultOutside && 'defaultHalfWidth' in patch) {
    problems.push('defaultHalfWidth must lie between minHalfWidth and maxHalfWidth');
  } else if (defaultOutside) {
    next.defaultHalfWidth = Math.min(next.maxHalfWidth, Math.max(next.minHalfWidth, next.defaultHalfWidth));
  }
  if (problems.length === 0) Object.assign(corridorConfig, next);
  return problems;
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

/**
 * Morphological opening, the counterpart of {@link closeShortDips}: a bulge
 * in the clearance of up to `2 * radius` stations (a driveway, a gap
 * between two houses) goes, a longer widening keeps its full length. NaN as
 * there.
 */
export function cutShortBulges(values: readonly number[], radius = stationRadius(corridorConfig.bulgeLength)): number[] {
  const eroded = values.map((_, k) => windowExtreme(values, k, radius, Math.min));
  return eroded.map((_, k) => (Number.isNaN(values[k]) ? NaN : windowExtreme(eroded, k, radius, Math.max)));
}

/**
 * A stretch of a segment, from `t` (0-1 along the segment) to the next
 * piece, with its half width left and right of the direction of travel.
 */
export interface CorridorPiece {
  t: number;
  left: number;
  right: number;
}

/** One segment of a route as {@link fitCorridorPieces} sees it. */
export interface CorridorStations {
  /**
   * Free space the tiles showed left and right of the direction of travel,
   * one value per station; station `k` of `n` stands for `[k/n, (k+1)/n]`
   * of the segment. NaN where no fine tile was loaded, empty if the segment
   * was never measured.
   */
  left: readonly number[];
  right: readonly number[];
  /** Half width from the street, for stations the tiles could not measure. */
  fallback: number;
  /**
   * The segment runs over a street. Off the network (the leg to the HQ,
   * often through buildings and yards) the tiles may only narrow it below
   * the fallback, not widen it.
   */
  onStreet: boolean;
}

/**
 * What the clearance rays found at one station
 * (ThreeTilesEngine.measureStreetClearance).
 */
export interface StationProbe {
  /**
   * Why the station could not be measured: no tile under it, or its tile
   * is coarser than `maxTileError` (still streaming in). Null when measured.
   */
  unmeasured: 'no tile' | 'coarse tile' | null;
  /** Geometric error of the tile under the station, Infinity without one. */
  tileError: number;
  /**
   * Distance to the first fine hit per ray height (low, high) left and
   * right of the direction of travel; the ray length where nothing was
   * hit. Empty when unmeasured.
   */
  left: number[];
  right: number[];
}

/**
 * Free space on one side of a probed station: a wall stops every ray, so
 * the farthest of the first hits. NaN when the station was not measured.
 */
export function probeFreeSpace(probe: StationProbe | null, side: 'left' | 'right'): number {
  if (!probe || probe.unmeasured !== null || probe[side].length === 0) return NaN;
  return Math.max(...probe[side]);
}

/** How one side of one station got its half width, see {@link fitCorridorStations}. */
export interface StationFit {
  /** Measured free space, NaN where the station could not be measured. */
  free: number;
  /** After closing short dips and cutting short bulges along the route. */
  smoothed: number;
  halfWidth: number;
  /** What set the half width, e.g. "bulge cut, wall less margin". For `__corridor.pick()`. */
  rule: string;
}

/**
 * The half width of every station of a route, per side, and how it came
 * about.
 *
 * The measured free space on each side, less `wallMargin` where the rays
 * found a wall, is the half width on that side, clamped to
 * [minHalfWidth, maxHalfWidth]. Along the whole route, across its
 * waypoints, short dips are closed (closeShortDips) and short bulges cut
 * (cutShortBulges), each side on its own, then the value is rounded down
 * to `widthStep`. A station the tiles could not measure gets the street's
 * half width; off the network the street's half width is the cap.
 */
export function fitCorridorStations(
  segments: readonly CorridorStations[],
): { left: StationFit[][]; right: StationFit[][] } {
  const { minHalfWidth, maxHalfWidth, widthStep, wallMargin } = corridorConfig;

  const fitSide = (side: 'left' | 'right'): StationFit[][] => {
    const free = segments.flatMap((s) => s[side]);
    const smoothed = cutShortBulges(closeShortDips(free));
    let offset = 0;
    return segments.map((segment) => {
      const fits = segment[side].map((_, k): StationFit => {
        const f = free[offset + k];
        const s = smoothed[offset + k];
        if (Number.isNaN(s)) return { free: f, smoothed: s, halfWidth: segment.fallback, rule: 'unmeasured: street width' };
        const rules: string[] = [];
        if (s > f) rules.push('dip closed');
        else if (s < f) rules.push('bulge cut');
        // A ray that hit nothing reports its full length, the maximum; a
        // wall keeps `wallMargin` off.
        let halfWidth: number;
        if (s >= maxHalfWidth) {
          halfWidth = maxHalfWidth;
          rules.push('no wall within the maximum');
        } else {
          halfWidth = Math.floor((s - wallMargin) / widthStep) * widthStep;
          rules.push('wall less margin');
        }
        if (halfWidth < minHalfWidth) {
          halfWidth = minHalfWidth;
          rules.push('minimum');
        }
        if (!segment.onStreet && segment.fallback < halfWidth) {
          halfWidth = segment.fallback;
          rules.push('leg to the HQ: street width');
        }
        return { free: f, smoothed: s, halfWidth, rule: rules.join(', ') };
      });
      offset += segment[side].length;
      return fits;
    });
  };

  return { left: fitSide('left'), right: fitSide('right') };
}

/**
 * The corridor pieces of each segment of a route, from what the tiles
 * showed: the station half widths of {@link fitCorridorStations}, runs of
 * equal widths as one piece. A segment without stations is one piece at
 * the fallback.
 */
export function fitCorridorPieces(segments: readonly CorridorStations[]): CorridorPiece[][] {
  const { left, right } = fitCorridorStations(segments);
  return segments.map((segment, i) => {
    const n = segment.left.length;
    if (n === 0) return [{ t: 0, left: segment.fallback, right: segment.fallback }];
    const pieces: CorridorPiece[] = [];
    for (let k = 0; k < n; k++) {
      const l = left[i][k].halfWidth;
      const r = right[i][k].halfWidth;
      const last = pieces[pieces.length - 1];
      if (!last || last.left !== l || last.right !== r) pieces.push({ t: k / n, left: l, right: r });
    }
    return pieces;
  });
}

/** Half width left of the direction of travel on the segment that starts at `waypoint`. */
export function segmentLeft(waypoint: RouteWaypoint): number {
  return waypoint.corridorLeft ?? corridorConfig.defaultHalfWidth;
}

/** Half width right of the direction of travel on the segment that starts at `waypoint`. */
export function segmentRight(waypoint: RouteWaypoint): number {
  return waypoint.corridorRight ?? corridorConfig.defaultHalfWidth;
}

/** How far off the centre line an enemy may walk on a side of this half width. */
export function lateralLimit(halfWidth: number): number {
  return Math.max(0, halfWidth - corridorConfig.edgeMargin);
}

/** Lateral limits on one side of a route. */
export interface SideLimits {
  /** Lateral limit of each segment, from its half width on this side. */
  segment: Float64Array;
  /**
   * Lateral limit at each waypoint once the taper is applied: never more
   * than an adjacent segment allows, and at most `taper` per metre above
   * any other point of the route.
   */
  node: Float64Array;
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
  /** Lateral limits left and right of the direction of travel. */
  left: SideLimits;
  right: SideLimits;
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
  const taper = corridorConfig.taper;

  cumulativeLength[0] = 0;
  for (let i = 0; i < segments; i++) {
    const a = path[i];
    const b = path[i + 1];
    segmentLengths[i] = haversineDistance(a.lat, a.lon, b.lat, b.lon);
    cumulativeLength[i + 1] = cumulativeLength[i] + segmentLengths[i];
  }

  return {
    segmentLengths,
    cumulativeLength,
    totalLength: cumulativeLength[segments],
    left: buildSideLimits(path, segmentLengths, segmentLeft, taper),
    right: buildSideLimits(path, segmentLengths, segmentRight, taper),
    taper,
  };
}

function buildSideLimits(
  path: readonly RouteWaypoint[],
  segmentLengths: readonly number[],
  halfWidthOf: (waypoint: RouteWaypoint) => number,
  taper: number,
): SideLimits {
  const segments = segmentLengths.length;
  const segment = new Float64Array(segments);
  const node = new Float64Array(path.length);
  for (let i = 0; i < segments; i++) segment[i] = lateralLimit(halfWidthOf(path[i]));

  if (segments > 0) {
    // A waypoint allows no more than the tighter of its two segments. Then
    // a min-plus distance transform, one pass each way: the limit may rise
    // by at most `taper` per metre. Inside a segment the envelope is
    // min(segment limit, start node + taper * s, end node + taper * rest),
    // because every other segment reaches it through one of the two nodes.
    for (let k = 0; k < path.length; k++) {
      const before = k > 0 ? segment[k - 1] : Infinity;
      const after = k < segments ? segment[k] : Infinity;
      node[k] = Math.min(before, after);
    }
    for (let k = 1; k < path.length; k++) {
      node[k] = Math.min(node[k], node[k - 1] + taper * segmentLengths[k - 1]);
    }
    for (let k = path.length - 2; k >= 0; k--) {
      node[k] = Math.min(node[k], node[k + 1] + taper * segmentLengths[k]);
    }
  }
  return { segment, node };
}
