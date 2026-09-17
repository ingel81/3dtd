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
import { RouteCornerBuilder, type RouteCorners } from './route-corners';
import type { ColumnSample } from '../three-engine/column-sample';

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
   * Heights of the low and the high clearance ray over the ground. What
   * blocks both counts as a wall: a facade, a wall, a trunk. What stops
   * only the high one (a tree crown, an eave, a balcony) does not narrow
   * the corridor. What stops only the low one counts as a wall where the
   * ground behind it is raised (`lowWallRise`): a parked car or van, a
   * hedge, a front garden above the pavement; not a fence, a bollard or a
   * sign post in front of ground at street level. The corridor ends before
   * a cell under a crown or an eave (`roofRise`) or on a car or a hedge
   * (`stepRise`) as well, see corridor-walk.ts.
   */
  rayHeightLow: number;
  rayHeightHigh: number;
  /**
   * Where only the low ray stops, what it hit counts as a wall if the
   * column {@link LOW_WALL_BEHIND_M} behind the hit comes down at least
   * this much above the station's ground: the roof of a parked car or a
   * van (the photogrammetry has no ground under it), a hedge, a garden
   * raised above the pavement. Above a kerb (10 to 15 cm) plus the camber
   * of the street, below a 0.4 m raised bed and the 0.58 m a car stood
   * above its neighbours in the mesh (playtest 2026-09-14, Rothenburg).
   * See {@link probeLowWall}.
   */
  lowWallRise: number;
  /**
   * Distance kept from a wall the rays found, taken off the free space, so
   * the cells next to a facade stay out from under balconies and canopies.
   * Not taken off where the rays hit nothing.
   */
  wallMargin: number;
  /**
   * Where both rays hit and the high one stops at most this much nearer than
   * the low one, the wall's outer face bounds the corridor, not the wall
   * under it: upper floors that jut out over the ground floor (a jetty of a
   * half-timbered house), an oriel. Cells under them stood under the
   * roof. A crown or a balcony
   * further out in front of the facade keeps the farther hit. 0: always the
   * farther hit. See {@link probeFreeSpace}.
   */
  overhangDepth: number;
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
   * lamp post, a sign, a single tree trunk. A low wall (a parked car or a
   * van, {@link probeLowWall}) stays however short it is. Rounded up to
   * whole stations either side, see {@link closeShortDips}.
   */
  dipLength: number;
  /**
   * A bulge in the measured free space up to about this long is cut: a
   * driveway, a gap between two houses, the mouth of a narrow side street.
   * Rounded up to whole stations either side, see {@link cutShortBulges}.
   */
  bulgeLength: number;
  /**
   * No enemy walks to a route cell whose column comes down more than this
   * above the ground on the route centre line beside it: the column hit a
   * roof, an eave or a tree crown over the street, with no ground under it
   * in the photogrammetry. The corridor ends before it (cellWalkable in
   * corridor-walk.ts).
   */
  roofRise: number;
  /**
   * No enemy walks to a route cell a walk from the centre line out to it,
   * spot by spot across the grid, cannot climb onto, each step at most this
   * much: the column hit a parked car, a van or a hedge, which the
   * photogrammetry has no ground under either. A kerb, a step and a slope
   * that climbs a little from spot to spot stay walkable. The corridor ends
   * before such a cell (cellWalkable in corridor-walk.ts). 0.5 m: in the
   * Rothenburg playtest of 2026-09-14 a car stood 0.57 m over the street
   * cell in front of it and passed 0.75 m, while the steps between ground
   * cells there were at most 0.24 m. A bank on one side only (nothing to
   * mirror, see crossSlope) stays walkable up to 25 % across the grid axes,
   * about 17 % on a diagonal.
   */
  stepRise: number;
  /**
   * The mirror of `stepRise`: no enemy walks to a route cell a walk from the
   * centre line cannot get down to, each step at most this much: an
   * embankment below a street across a slope, a quay or retaining wall, the
   * river or the street under it. A gutter, a kerb down, a ramp and the
   * cross slope of a street across a hillside stay walkable. 0.5 m, as
   * `stepRise`: a bank falling on one side only stays walkable up to 25 %
   * across the grid axes, about 17 % on a diagonal; 1 in 1.5 is a common
   * embankment. Until 2026-09-15 a walk went down any drop (playtest
   * 2026-09-15, Rothenburg: cells down the embankment on the valley side).
   */
  stepDrop: number;
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
  lowWallRise: 0.3,
  wallMargin: 0.5,
  overhangDepth: 1,
  maxTileError: 5,
  widthStep: 0.5,
  dipLength: 4,
  bulgeLength: 8,
  roofRise: 2.5,
  stepRise: 0.5,
  stepDrop: 0.5,
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
 * Settings whose change moves the clearance stations, what the rays see,
 * how their hits become the free space that is stored, or which cells an
 * enemy could not walk to (the stored walk caps, corridor-walk.ts):
 * changing one means measuring again. The others only reshape what was
 * measured.
 */
export const MEASUREMENT_KEYS: readonly (keyof CorridorConfig)[] = [
  'stationSpacing',
  'rayHeightLow',
  'rayHeightHigh',
  'maxHalfWidth',
  'maxTileError',
  'overhangDepth',
  'lowWallRise',
  'roofRise',
  'stepRise',
  'stepDrop',
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
  // 50: nothing counts, only what stops both rays is a wall.
  lowWallRise: [0.1, 50],
  wallMargin: [0, 5],
  overhangDepth: [0, 5],
  maxTileError: [0.1, 100],
  widthStep: [0.1, 2],
  dipLength: [0, 100],
  bulgeLength: [0, 100],
  roofRise: [0.5, 50],
  stepRise: [0.1, 50],
  // 50: a walk goes down any drop up to OUTLIER_M, as until 2026-09-15.
  stepDrop: [0.1, 50],
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

/** The OSM fields that put a street under cover. */
export interface CoverTags {
  tunnel?: string;
  covered?: string;
}

/**
 * The street runs through a tunnel or a covered passage: `tunnel=*` other
 * than `no` (`yes`, `building_passage`, `culvert`, ...) or `covered=yes`.
 * A column there sees only the ground or roof above, and the clearance
 * rays would hit the tunnel walls.
 */
export function runsUnderCover(street: CoverTags): boolean {
  return (street.tunnel !== undefined && street.tunnel !== 'no') || street.covered === 'yes';
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
export function stationRadius(lengthM: number): number {
  return Math.max(0, Math.ceil(lengthM / corridorConfig.stationSpacing / 2));
}

/**
 * Morphological closing over `radius` stations either side (by default
 * enough for `dipLength`). A dip in the clearance of up to `2 * radius`
 * stations (a lamp post, a sign, a single trunk) goes, a longer narrowing
 * keeps its full length. A station `keep` marks (a low wall,
 * probeLowWall: a parked car or a van) keeps its value however short the
 * dip. NaN marks a station that could not be measured; it stays unknown
 * and does not count for its neighbours.
 */
export function closeShortDips(
  values: readonly number[],
  keep: readonly boolean[] = [],
  radius = stationRadius(corridorConfig.dipLength),
): number[] {
  const dilated = values.map((_, k) => windowExtreme(values, k, radius, Math.max));
  return dilated.map((_, k) => (Number.isNaN(values[k]) || keep[k] ? values[k] : windowExtreme(dilated, k, radius, Math.min)));
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
 * A gap of unmeasured stations up to about `dipLength` long takes the
 * smaller free space of the measured stations either side of it, or of the
 * one there is at an end of the route. The column under a station on a
 * seam between two tile meshes can find no tile while the stations around
 * it measure the street; the gap would otherwise narrow the corridor to the
 * street width for that one station. Longer gaps stay NaN.
 */
function fillShortGaps(values: readonly number[]): number[] {
  const maxStations = Math.floor(corridorConfig.dipLength / corridorConfig.stationSpacing);
  const filled = [...values];
  let k = 0;
  while (k < values.length) {
    if (!Number.isNaN(values[k])) {
      k++;
      continue;
    }
    let end = k;
    while (end < values.length && Number.isNaN(values[end])) end++;
    const before = k > 0 ? values[k - 1] : NaN;
    const after = end < values.length ? values[end] : NaN;
    if (end - k <= maxStations && !(Number.isNaN(before) && Number.isNaN(after))) {
      const value = Number.isNaN(before) ? after : Number.isNaN(after) ? before : Math.min(before, after);
      filled.fill(value, k, end);
    }
    k = end;
  }
  return filled;
}

/**
 * A stretch of a segment, from `t` (0-1 along the segment) to the next
 * piece, with its half width left and right of the direction of travel.
 */
export interface CorridorPiece {
  t: number;
  left: number;
  right: number;
  /**
   * Widest the piece may get on each side: at a low wall the rays saw (a
   * parked car, a hedge) the half width it gave, which closeShortNarrowings
   * keeps to. Absent where nothing limits it.
   */
  maxLeft?: number;
  maxRight?: number;
}

/** What a clearance measurement holds for one segment (PathAndRouteService.clearanceBySegment). */
export interface SegmentClearance {
  left: number[];
  right: number[];
  probes: (StationProbe | null)[];
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
  /**
   * Stations whose free space is a low wall (probeLowWall), left and right:
   * a parked car or a van. The dip closing keeps them, and closing short
   * narrowings does not widen them. Missing: none.
   */
  lowWallLeft?: readonly boolean[];
  lowWallRight?: readonly boolean[];
}

/**
 * How far behind the low ray's hit the column stands that tells whether
 * the ground there is raised (StationProbe.lowRise): on the roof of a car
 * (1.7 to 1.9 m wide) or a van hit on its side, past a bollard, a sign
 * post, a litter bin or a fence. Every other ray has to reach beyond it
 * for the low one to have stopped alone (lowRayAlone): a trunk stops both
 * about where it stands and stays a wall of both rays.
 */
export const LOW_WALL_BEHIND_M = 1;

/**
 * The low ray (the first of `hits`, distances capped at `maxDistance`)
 * stopped at something every other ray passes over: each of those hit
 * nothing or hit at least {@link LOW_WALL_BEHIND_M} beyond it.
 */
export function lowRayAlone(hits: readonly number[], maxDistance: number): boolean {
  const low = hits[0];
  if (hits.length < 2 || !(low < maxDistance)) return false;
  return hits.slice(1).every((d) => d >= maxDistance || d >= low + LOW_WALL_BEHIND_M);
}

/**
 * The top of a low object over a hollow in `column`: its highest hit, where
 * that lies more than `stepRise` and at most `roofRise` above `standY`, the
 * hit a cell or station there stands on; null otherwise. A parked car or a
 * van the photogrammetry made hollow, the street under its body the lowest
 * hit (playtest 2026-09-15, 727, Rothenburg, Galgengasse: the roof of a red
 * car 1.48 and 2 m over the street under it; its cells stood on that street
 * and passed the walk check, and the column behind the low ray's hit showed
 * no rise). Higher up it is a roof, an awning, a crown or a deck, which
 * the band's roof check and the stretch off a bridge end deal with. Where a cell
 * stands on the top already (the deck carried on past a bridge end over a
 * hollow under the road), nothing lies above it. A column keeps only its
 * lowest and its highest hit (ColumnSample): a car under a crown or an eave
 * higher than `roofRise` shows only as the crown.
 */
export function lowObjectTop(column: ColumnSample, standY: number): number | null {
  const over = column.topY - standY;
  return over > corridorConfig.stepRise && over <= corridorConfig.roofRise ? column.topY : null;
}

/**
 * What the clearance rays found at one station
 * (TerrainQueries.measureStreetClearance).
 */
export interface StationProbe {
  /**
   * Why the station could not be measured: no tile under it, its tile is
   * coarser than `maxTileError` (still streaming in), or, on the stretch
   * off a bridge end, the column at that end has no such tile yet. Null
   * when measured.
   */
  unmeasured: 'no tile' | 'coarse tile' | 'no approach start' | null;
  /** Geometric error of the tile under the station, Infinity without one. */
  tileError: number;
  /**
   * Distance to the first fine hit per ray height (low, high) left and
   * right of the direction of travel; the ray length where nothing was
   * hit. Empty when unmeasured.
   */
  left: number[];
  right: number[];
  /**
   * Per side, where the low ray alone stopped (lowRayAlone): how far the
   * column {@link LOW_WALL_BEHIND_M} behind its hit comes down above the
   * station's ground, the top of what the photogrammetry has there; on the
   * stretch off a bridge end the hit nearest to the height carried there,
   * as the station's own ground (surfaceY). NaN on a side where the low ray
   * did not stop alone, where that column has no tile up to `maxTileError`,
   * and on a bridge deck (the lowest hit of a column there may be the river
   * or road under it). Absent when unmeasured.
   */
  lowRise?: { left: number; right: number };
  /**
   * The column under the station found no tile (a seam between two tile
   * meshes), so the station was measured from the column this far along
   * the route, ahead positive. Absent when the column under it had a tile.
   */
  shiftM?: number;
}

/**
 * The low ray alone stopped on this side of a probed station, at something
 * with raised ground behind it: the column {@link LOW_WALL_BEHIND_M} behind
 * the hit comes down at least `lowWallRise` above the station's ground
 * (StationProbe.lowRise). A parked car or a van, a hedge, a low wall in
 * front of a raised garden; not a bollard, a sign post or a fence in front
 * of ground at street level. It counts as a wall (probeFreeSpace), however
 * short (closeShortDips, closeShortNarrowings).
 */
export function probeLowWall(probe: StationProbe | null, side: 'left' | 'right'): boolean {
  if (!probe || probe.unmeasured !== null) return false;
  return (probe.lowRise?.[side] ?? NaN) >= corridorConfig.lowWallRise;
}

/**
 * Free space on one side of a probed station: a wall stops every ray, so
 * the farthest of the first hits. Except where every ray hit and the high
 * one, the last, stopped at most `overhangDepth` nearer than the low one:
 * upper floors jutting out over the ground floor, whose outer face is the
 * nearest hit. And where the low ray alone hit a low wall (probeLowWall):
 * its hit. NaN when the station was not measured.
 */
export function probeFreeSpace(probe: StationProbe | null, side: 'left' | 'right'): number {
  if (!probe || probe.unmeasured !== null || probe[side].length === 0) return NaN;
  const hits = probe[side];
  if (probeLowWall(probe, side)) return hits[0];
  const farthest = Math.max(...hits);
  const low = hits[0];
  const high = hits[hits.length - 1];
  const overhang = farthest < corridorConfig.maxHalfWidth && high < low && low - high <= corridorConfig.overhangDepth;
  return overhang ? Math.min(...hits) : farthest;
}

/** How one side of one station got its half width, see {@link fitCorridorStations}. */
export interface StationFit {
  /** Measured free space, NaN where the station could not be measured. */
  free: number;
  /** After filling short gaps, closing short dips and cutting short bulges along the route. */
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
 * waypoints, a short gap of unmeasured stations takes the free space
 * measured around it (fillShortGaps), short dips other than low walls
 * (lowWallLeft, lowWallRight) are closed (closeShortDips) and short bulges
 * cut (cutShortBulges), each side on its own, then the value is rounded
 * down to `widthStep`. A station the tiles
 * could not measure in a longer gap gets the street's half width; off the
 * network the street's half width is the cap.
 *
 * This is how far the rays leave room, the wall the walkable band is looked
 * for within (corridor-band.ts), not the corridor in use: the band's edges
 * set that.
 */
export function fitCorridorStations(
  segments: readonly CorridorStations[],
): { left: StationFit[][]; right: StationFit[][] } {
  const { minHalfWidth, maxHalfWidth, widthStep, wallMargin } = corridorConfig;

  const fitSide = (side: 'left' | 'right'): StationFit[][] => {
    const free = segments.flatMap((s) => s[side]);
    const lowWalls = segments.flatMap((s) => lowWallsOf(s, side));
    const filled = fillShortGaps(free);
    const smoothed = cutShortBulges(closeShortDips(filled, lowWalls));
    let offset = 0;
    return segments.map((segment) => {
      const fits = segment[side].map((_, k): StationFit => {
        const f = free[offset + k];
        const g = filled[offset + k];
        const s = smoothed[offset + k];
        const rules: string[] = [];
        let halfWidth: number;
        if (Number.isNaN(s)) {
          halfWidth = segment.fallback;
          rules.push('unmeasured: street width');
        } else {
          if (Number.isNaN(f)) rules.push('unmeasured: from neighbours');
          if (lowWalls[offset + k]) rules.push('low obstacle, raised behind');
          if (s > g) rules.push('dip closed');
          else if (s < g) rules.push('bulge cut');
          // A ray that hit nothing reports its full length, the maximum; a
          // wall keeps `wallMargin` off.
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
        }
        return { free: f, smoothed: s, halfWidth, rule: rules.join(', ') };
      });
      offset += segment[side].length;
      return fits;
    });
  };

  return { left: fitSide('left'), right: fitSide('right') };
}

/** Which stations of `segment` are low walls on `side`, one flag per station. */
function lowWallsOf(segment: CorridorStations, side: 'left' | 'right'): boolean[] {
  const flags = side === 'left' ? segment.lowWallLeft : segment.lowWallRight;
  return segment[side].map((_, k) => flags?.[k] ?? false);
}

/**
 * The corridor pieces of each segment of a route, from what the tiles
 * showed: the station half widths of {@link fitCorridorStations}, runs of
 * equal widths as one piece, with the narrowest walk cap of their stations
 * as `maxLeft` / `maxRight`, and at a low wall (lowWallLeft, lowWallRight)
 * the half width it gave. A segment without stations is one piece at the
 * fallback.
 */
export function fitCorridorPieces(segments: readonly CorridorStations[]): CorridorPiece[][] {
  const { left, right } = fitCorridorStations(segments);
  return segments.map((segment, i) => {
    const n = segment.left.length;
    if (n === 0) return [{ t: 0, left: segment.fallback, right: segment.fallback }];
    const lowLeft = lowWallsOf(segment, 'left');
    const lowRight = lowWallsOf(segment, 'right');
    const pieces: CorridorPiece[] = [];
    for (let k = 0; k < n; k++) {
      const l = left[i][k].halfWidth;
      const r = right[i][k].halfWidth;
      let last = pieces[pieces.length - 1];
      if (!last || last.left !== l || last.right !== r) {
        last = { t: k / n, left: l, right: r };
        pieces.push(last);
      }
      const maxLeft = Math.min(last.maxLeft ?? Infinity, lowLeft[k] ? l : Infinity);
      const maxRight = Math.min(last.maxRight ?? Infinity, lowRight[k] ? r : Infinity);
      if (maxLeft < Infinity) last.maxLeft = maxLeft;
      if (maxRight < Infinity) last.maxRight = maxRight;
    }
    return pieces;
  });
}

/**
 * Widen every stretch of the corridor that is narrower on one side than
 * the stretches right before and after it, and together at most about
 * `dipLength` long, to the narrower of those two: the short-dip closing of
 * fitCorridorStations once more, over the pieces a route ends up with,
 * whatever set their widths. A stretch narrowed by a rule that does not
 * look along the route (the street width of a station or a short segment
 * the tiles did not measure) would otherwise pinch the cells and, with
 * the taper, the enemy stream for many metres around it. A narrowing that
 * runs longer, such as walls on both sides over a few metres, stays; so
 * does one at either end of the route. No piece gets wider than its
 * `maxLeft` / `maxRight`: a car or an eave narrows the corridor however
 * short it is, whether the grid found it (a walk cap) or the rays (a low
 * wall).
 *
 * `pieces` per segment as fitCorridorPieces gives them, `lengths` the
 * segment lengths in metres, `fixed` the segments whose width must not
 * change: tunnels and covered passages, which the rays do not measure and
 * where more width would put cells into the walls. Returns new pieces,
 * equal neighbours within a segment merged.
 */
export function closeShortNarrowings(
  pieces: readonly (readonly CorridorPiece[])[],
  lengths: readonly number[],
  fixed: readonly boolean[],
): CorridorPiece[][] {
  const stretches: {
    segment: number; t: number; length: number; left: number; right: number; fixed: boolean; max: { left: number; right: number };
  }[] = [];
  pieces.forEach((own, i) => {
    own.forEach((piece, k) => {
      const end = k + 1 < own.length ? own[k + 1].t : 1;
      stretches.push({
        segment: i, t: piece.t, length: (end - piece.t) * lengths[i], left: piece.left, right: piece.right, fixed: fixed[i],
        max: { left: piece.maxLeft ?? Infinity, right: piece.maxRight ?? Infinity },
      });
    });
  });

  // Station lengths do not add up to dipLength exactly.
  const maxLength = corridorConfig.dipLength + 1e-6;
  for (const side of ['left', 'right'] as const) {
    // Raising one run can make it part of a wider run that is a short dip
    // itself, so go again until nothing changes.
    let changed = true;
    while (changed) {
      changed = false;
      let a = 0;
      while (a < stretches.length) {
        if (stretches[a].fixed) {
          a++;
          continue;
        }
        const width = stretches[a][side];
        let b = a;
        let length = 0;
        while (b < stretches.length && !stretches[b].fixed && stretches[b][side] === width) length += stretches[b++].length;
        const before = a > 0 ? stretches[a - 1][side] : -Infinity;
        const after = b < stretches.length ? stretches[b][side] : -Infinity;
        if (before > width && after > width && length <= maxLength) {
          const to = Math.min(before, after);
          for (let k = a; k < b; k++) {
            const raised = Math.min(to, stretches[k].max[side]);
            if (raised <= stretches[k][side]) continue;
            stretches[k][side] = raised;
            changed = true;
          }
        }
        a = b;
      }
    }
  }

  const result: CorridorPiece[][] = pieces.map(() => []);
  for (const { segment, t, left, right } of stretches) {
    const own = result[segment];
    const last = own[own.length - 1];
    if (!last || last.left !== left || last.right !== right) own.push({ t, left, right });
  }
  return result;
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
   * any other point of the route. The envelope of the sharp route, which
   * the worm's sway keeps to (worm-path.ts) and the arcs are sized by
   * (route-corners.ts).
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
  /**
   * The arcs enemies round the corners on, and the lateral limits they keep
   * to with them. Sized on first read, or before in slices
   * (sizeRouteCorners), which costs far more than the rest: the hero walks
   * the corners sharp and never reads it.
   */
  readonly corners: RouteCorners;
  /** The taper the node limits were built with, metres sideways per metre. */
  taper: number;
}

const profiles = new WeakMap<readonly RouteWaypoint[], RouteProfile>();

/** Per profile: sizes its corner arcs on until `timeUp` says so, true once they stand. */
const cornerSizing = new WeakMap<RouteProfile, (timeUp: () => boolean) => boolean>();

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

  const left = buildSideLimits(path, segmentLengths, segmentLeft, taper);
  const right = buildSideLimits(path, segmentLengths, segmentRight, taper);
  let corners: RouteCorners | null = null;
  let builder: RouteCornerBuilder | null = null;
  const size = (timeUp: () => boolean): boolean => {
    if (corners) return true;
    builder ??= new RouteCornerBuilder(path, segmentLengths, cumulativeLength, left, right, taper);
    corners = builder.step(timeUp);
    if (corners) builder = null;
    return corners !== null;
  };
  const profile: RouteProfile = {
    segmentLengths,
    cumulativeLength,
    totalLength: cumulativeLength[segments],
    left,
    right,
    get corners(): RouteCorners {
      size(() => false);
      return corners!;
    },
    taper,
  };
  cornerSizing.set(profile, size);
  return profile;
}

/**
 * Size the corner arcs of `path` (RouteProfile.corners) for about
 * `budgetMs`, a group of knicks at a time and at least one, for a caller
 * that spreads them over frames (CorridorBuild). True once they stand, at
 * once where they already do.
 */
export function sizeRouteCorners(path: readonly RouteWaypoint[], budgetMs: number, now: () => number = () => performance.now()): boolean {
  const start = now();
  return cornerSizing.get(getRouteProfile(path))!(() => now() - start >= budgetMs);
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
