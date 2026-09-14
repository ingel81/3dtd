import type { ColumnSample } from '../three-engine/column-sample';
import type { RouteCell } from './route-cell';
import { RouteCellSampler } from './route-cell-sampler';
import { corridorConfig } from './route-corridor';
import { jointCap, segmentTouchesCell } from './route-grid-builder';

/**
 * Where enemies can walk off the route centre line, and how that narrows
 * the corridor.
 *
 * The clearance rays let the corridor reach over whatever stops only one of
 * them (probeFreeSpace in route-corridor.ts): a parked car, a van or a hedge
 * below the high ray, an eave or a tree crown above the low one. The
 * photogrammetry has no ground under any of them, so the column of a cell
 * there comes down on its top. Such a cell is no place to walk to
 * (cellWalkable), and the corridor ends before it: the grid in use names
 * those cells (unwalkableCells), every station of a route is capped short
 * of the ones its piece of the corridor claims (walkCaps, applied by
 * fitCorridorStations), and routes and cells are built again
 * (CorridorController.rebuildCorridors). Enemies keep within the narrower
 * corridor as within any other (lateralLimit), so none walks where no cell
 * is. Until 2026-09-14 such cells stayed in the corridor, put on the ground
 * beside them (orange in the Route Grid Overlay).
 */

/** The column at a point, or half a metre beside it on a seam (RouteCellSampler.columnNear). */
export type ColumnAt = (x: number, z: number) => ColumnSample | null;

/**
 * Whether an enemy could walk from the route centre line out to `cell`.
 *
 * False for a cell more than `roofRise` above the ground on the centre line
 * beside it (axisX, axisZ): its column came down on a roof, an eave or a
 * crown over the street (roof check). False as well where a walk out from
 * the centre line cannot climb onto it (step check, see reached): a parked
 * car, a van, a hedge, a raised garden.
 *
 * Null where that cannot be told: a cell without a sample of its own, one
 * sampled from a tile coarser than `maxTileError` (told once a finer one has
 * streamed in, so a coarse hull narrows nothing), a cell the centre line runs
 * through, a deck or tunnel cell, no column on the centre line beside it, or
 * one more than OUTLIER_M from that (a seam).
 *
 * @param column The grid's column probe; the probes on the centre line and on
 *   the way out are the columns of the cells there, cached by the engine.
 */
export function cellWalkable(cell: RouteCell, column: ColumnAt, cellSize: number): boolean | null {
  if (cell.surface !== 'ground' || cell.sample.state !== 'stable') return null;
  if (cell.axisX === cell.x && cell.axisZ === cell.z) return null;
  if (cell.sample.tileGeometricError > corridorConfig.maxTileError) return null;
  const axis = column(cell.axisX, cell.axisZ);
  if (axis === null) return null;
  const rise = cell.terrainHeight - axis.groundY;
  if (Math.abs(rise) > RouteCellSampler.OUTLIER_M) return null;
  if (rise > corridorConfig.roofRise) return false;
  return reached(cell, axis.groundY, column, cellSize);
}

/** The cells among `cells` an enemy could not walk to (cellWalkable false). */
export function unwalkableCells(cells: Iterable<RouteCell>, column: ColumnAt, cellSize: number): RouteCell[] {
  const found: RouteCell[] = [];
  for (const cell of cells) {
    if (cellWalkable(cell, column, cellSize) === false) found.push(cell);
  }
  return found;
}

/**
 * Whether a walk from the centre line out to `cell`, grid spot by grid
 * spot, can climb onto the cell's ground.
 *
 * The walk starts on the centre line (`axisY`). A spot counts as reached
 * where its ground lies at most `stepRise` above the highest ground reached
 * so far, or above the last one plus the cross slope for every spot since
 * (crossSlope). So it goes down a ditch or a drop (up to OUTLIER_M, deeper is
 * a seam), up a kerb, a step or a slope, but not onto a car, a van or a
 * hedge; the ground beyond one of those counts again.
 */
function reached(cell: RouteCell, axisY: number, column: ColumnAt, cellSize: number): boolean {
  const y = cell.terrainHeight;
  // The walk never reaches less than the centre line, so a cell at most one
  // step above it is reached whatever lies in between: no probes on the way
  // out for the edge cells of a level street.
  if (y <= axisY + corridorConfig.stepRise) return true;
  const gx = Math.round((cell.x - cell.axisX) / cellSize);
  const gz = Math.round((cell.z - cell.axisZ) / cellSize);
  const steps = Math.max(Math.abs(gx), Math.abs(gz));
  if (steps === 0) return true;
  // Rounded away from the centre line.
  const along = (g: number, k: number) => Math.sign(g * k) * Math.round(Math.abs((g * k) / steps)) * cellSize;
  const spot = (k: number) => column(cell.axisX + along(gx, k), cell.axisZ + along(gz, k));
  // The cross slope from one step along the straight line to the cell and
  // its mirror, not from the grid spots: on a line neither along an axis nor
  // diagonal (a cell round the end of a segment) the spots take the rise in
  // uneven steps, the first one often none. The same spots otherwise.
  const ux = (cell.x - cell.axisX) / steps;
  const uz = (cell.z - cell.axisZ) / steps;
  const slope = crossSlope(axisY, column(cell.axisX + ux, cell.axisZ + uz), column(cell.axisX - ux, cell.axisZ - uz));

  let top = axisY;
  let last = axisY;
  let lastK = 0;
  const reaches = (ground: number, k: number) =>
    ground <= Math.max(top, last + slope * (k - lastK)) + corridorConfig.stepRise;
  for (let k = 1; k < steps; k++) {
    const probe = spot(k);
    if (probe === null) continue;
    const ground = probe.groundY;
    if (!reaches(ground, k) || ground < top - RouteCellSampler.OUTLIER_M) continue;
    last = ground;
    lastK = k;
    if (ground > top) top = ground;
  }
  return reaches(y, steps);
}

/**
 * Rise per grid spot of the ground across the street, from the first step
 * on the way out (`up`) and its mirror on the other side of the centre
 * line (`down`): where the ground rises towards the cell about as much as
 * it falls on the other side (the two within `stepRise`), the smaller of
 * the two, else 0. A car or a hedge rises on one side only, a quay wall
 * falls far more than a car rises; a hillside street tilts both ways
 * alike (DevWorld's terrain as well). As the tower footprint's cursorSlope
 * does it.
 */
function crossSlope(axisY: number, up: ColumnSample | null, down: ColumnSample | null): number {
  if (up === null || down === null) return 0;
  const rise = up.groundY - axisY;
  const fall = axisY - down.groundY;
  if (rise <= 0 || fall <= 0 || Math.abs(rise - fall) > corridorConfig.stepRise) return 0;
  return Math.min(rise, fall);
}

/** A point the corridor must not claim, local x, z: the centre of a cell an enemy could not walk to. */
export interface WalkSpot {
  x: number;
  z: number;
}

/** One segment of a route as walkCaps sees it. */
export interface WalkCapSegment {
  /** Local start and end. */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /**
   * Stations of the segment; station k covers [k/n, (k+1)/n] of it. 0 for a
   * segment without any (a tunnel, never measured), whose width no cap
   * changes: a cell a tunnel reaches is a tunnel cell, never judged.
   */
  stations: number;
  /**
   * Half width in use left and right of the direction of travel, per
   * station; a single value for a segment without stations.
   */
  left: readonly number[];
  right: readonly number[];
}

/** How far out from the centre line each station may reach, per side; Infinity where nothing limits it. */
export interface WalkCaps {
  left: number[];
  right: number[];
}

/**
 * How far out from the centre line each station of a route may reach on
 * each side so that its corridor claims none of `spots`: per segment,
 * station and side, the distance to the nearest spot the station's piece
 * of the corridor claims, less a margin; Infinity where it claims none.
 *
 * The geometry of claimSegmentCells: a spot along a segment belongs to the
 * station there, one past an end of the segment to the station at that end,
 * where that end's round end reaches it (jointCap with the widths in use).
 * At a joint whose round ends on both sides reach the spot, the earlier
 * segment's last station takes the cap; either keeps both round ends off
 * it. The margin is how much further than a piece's half width the round
 * end of a neighbouring piece reaches (reach less edgeMargin, 0.08 m by
 * default), plus a centimetre, so no piece claims the spot once its station
 * is capped. A spot the segment runs through stays: the corridor claims
 * that cell at any width.
 */
export function walkCaps(route: readonly WalkCapSegment[], spots: readonly WalkSpot[], cellSize: number): WalkCaps[] {
  const overshoot = Math.max(0, cellSize * Math.SQRT1_2 * Math.hypot(1, corridorConfig.taper) - corridorConfig.edgeMargin);
  const margin = overshoot + 0.01;
  const caps: WalkCaps[] = route.map((s) => ({
    left: new Array<number>(s.stations).fill(Infinity),
    right: new Array<number>(s.stations).fill(Infinity),
  }));
  const cap = (i: number, side: 'left' | 'right', k: number, distance: number) => {
    caps[i][side][k] = Math.min(caps[i][side][k], Math.max(0, distance - margin));
  };
  const first = (s: WalkCapSegment, side: 'left' | 'right') => s[side][0];
  const last = (s: WalkCapSegment, side: 'left' | 'right') => s[side][s[side].length - 1];

  for (const spot of spots) {
    const gx = Math.floor(spot.x / cellSize);
    const gz = Math.floor(spot.z / cellSize);
    const places = route.map((s) => placeOn(s, spot.x, spot.z));
    for (let i = 0; i < route.length; i++) {
      const segment = route[i];
      const n = segment.stations;
      if (n === 0) continue;
      if (segmentTouchesCell(cellSize, { x: segment.ax, z: segment.az }, { x: segment.bx, z: segment.bz }, gx, gz)) continue;
      const { along, distance, side } = places[i];
      if (along >= 0 && along <= 1) {
        const k = Math.min(n - 1, Math.floor(along * n));
        if (distance <= segment[side][k] + overshoot) cap(i, side, k, distance);
      } else if (along > 1) {
        const next = route[i + 1];
        const radius = next ? jointCap(last(segment, side), first(next, side), cellSize) : last(segment, side);
        if (distance <= radius) cap(i, side, n - 1, distance);
      } else {
        const previous = route[i - 1];
        const radius = previous ? jointCap(first(segment, side), last(previous, side), cellSize) : first(segment, side);
        if (distance > radius) continue;
        // The earlier segment caps the joint where its own round end reaches the spot too.
        const before = places[i - 1];
        const handled = previous !== undefined && previous.stations > 0 && before.along > 1 && before.side === side
          && before.distance <= jointCap(last(previous, side), first(segment, side), cellSize);
        if (!handled) cap(i, side, 0, distance);
      }
    }
  }
  return caps;
}

/** Where (x, z) lies from `segment`: how far along it (0 to 1 over its length), how far off it and on which side. */
function placeOn(segment: WalkCapSegment, x: number, z: number): { along: number; distance: number; side: 'left' | 'right' } {
  const dx = segment.bx - segment.ax;
  const dz = segment.bz - segment.az;
  const lenSq = dx * dx + dz * dz;
  const along = lenSq > 0 ? ((x - segment.ax) * dx + (z - segment.az) * dz) / lenSq : 0;
  const t = Math.max(0, Math.min(1, along));
  const distance = Math.hypot(segment.ax + dx * t - x, segment.az + dz * t - z);
  // (-dz, dx) points right of the direction of travel (x east, z south), as in claimSegmentCells.
  const side = (z - segment.az) * dx - (x - segment.ax) * dz >= 0 ? 'right' : 'left';
  return { along, distance, side };
}
