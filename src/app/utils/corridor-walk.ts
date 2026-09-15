import type { ColumnSample } from '../three-engine/column-sample';
import type { RouteCell } from './route-cell';
import { RouteCellSampler } from './route-cell-sampler';
import { corridorConfig, lowObjectTop, walkWidth } from './route-corridor';
import { type RouteCellLattice, jointCap, segmentTouchesCell } from './route-grid-builder';
import { carriedDeckY, surfaceY } from './deck-approach';

/**
 * Where enemies can walk off the route centre line, and how that narrows
 * the corridor.
 *
 * The clearance rays let the corridor reach over whatever stops only one of
 * them (probeFreeSpace in route-corridor.ts): an eave or a tree crown above
 * the low one, and below the high one a parked car, a van or a hedge whose
 * column behind the hit they did not see raised (probeLowWall). The
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

/** What the walk check reads off the grid. */
export interface WalkGround {
  /** The grid's column probe; the columns of the cells, cached by the engine. */
  column: ColumnAt;
  /**
   * The cell at the grid spot around (x, z) where a route centre line runs
   * through it, null where none does. The corridor claims such a cell at
   * any width (claimSegmentCells), so no narrower corridor drops it. Its
   * surface, and on the stretch off a bridge end where it lies on the route
   * from there (RouteCell.deckEnd), tell which hit of its column counts
   * (surfaceY).
   */
  lineCell: (x: number, z: number) => Pick<RouteCell, 'surface' | 'deckEnd'> | null;
}

/**
 * Why cellWalkable says what it says, for `__corridor.pick()`: `walkable`
 * (true), `roof`, `hollow`, `step` and `drop` (false, see judgeWalk), the
 * rest null.
 */
export type WalkCheck =
  | 'walkable'
  | 'roof'
  | 'hollow'
  | 'step'
  | 'drop'
  | 'centre line'
  | 'centre line on a roof'
  | 'deck or tunnel'
  | 'no bridge end'
  | 'no sample'
  | 'coarse tile'
  | 'no centre line ground'
  | 'seam';

/** What the walk check found for one cell. */
export interface WalkJudgement {
  walkable: boolean | null;
  check: WalkCheck;
  /** Height of the cell over the ground of the centre line beside it (centreLineGround), null where there is none. */
  overLine: number | null;
}

/**
 * Whether an enemy could walk from the route centre line out to `cell`,
 * see judgeWalk.
 */
export function cellWalkable(cell: RouteCell, ground: WalkGround, cellSize: number): boolean | null {
  return judgeWalk(cell, ground, cellSize).walkable;
}

/** centreLineGround per grid spot key, for one pass over the cells (unwalkableCells). */
type LineGroundMemo = Map<number, number | null>;

/**
 * Whether an enemy could walk from the route centre line out to `cell`,
 * and why.
 *
 * False for a cell more than `roofRise` above the ground of the centre line
 * beside it (centreLineGround): its column came down on a roof, an eave or
 * a crown over the street (roof check). False for a cell whose column hits
 * something more than `stepRise` and at most `roofRise` above the hit it
 * stands on (lowObjectTop, hollow check): a car or a van the
 * photogrammetry made hollow, the street under its body the lowest hit,
 * which the cell took. False as well where a walk out from
 * the centre line cannot climb onto it (step check, see walkOut): a parked
 * car, a van, a hedge, a raised garden; or cannot get down to it (drop
 * check): the embankment below a street across a slope, a quay wall.
 *
 * On the stretch off a bridge end (`approach`) the walk out stands on the
 * hit a cell there takes (walkSurface), as the centre line spots do
 * (centreLineGround): the one nearest to the height the route carries
 * there, the deck carried on, not the quay under it.
 *
 * Null where that cannot be told or would change nothing: a cell without a
 * sample of its own, one sampled from a tile coarser than `maxTileError`
 * (told once a finer one has streamed in, so a coarse hull narrows
 * nothing), a cell a centre line runs through (the corridor keeps it at
 * any width, even where the line only clips a corner), a deck or tunnel
 * cell, an approach cell without a column at its bridge end, no column on
 * the centre line beside it, or one more than OUTLIER_M from that (a seam).
 *
 * @param memo Keeps centreLineGround per grid spot over a pass that judges
 *   many cells: the edge cells beside one spot share it.
 */
export function judgeWalk(cell: RouteCell, ground: WalkGround, cellSize: number, memo?: LineGroundMemo): WalkJudgement {
  const unjudged = (check: WalkCheck, overLine: number | null = null): WalkJudgement => ({ walkable: null, check, overLine });
  const lineGround = (x: number, z: number): number | null => {
    if (!memo) return centreLineGround(x, z, ground, cellSize);
    const key = ((Math.floor(x / cellSize) & 0xffff) << 16) | (Math.floor(z / cellSize) & 0xffff);
    let y = memo.get(key);
    if (y === undefined) {
      y = centreLineGround(x, z, ground, cellSize);
      memo.set(key, y);
    }
    return y;
  };
  if (cell.surface === 'deck' || cell.surface === 'tunnel') return unjudged('deck or tunnel');
  if (cell.sample.state !== 'stable') return unjudged('no sample');
  const carried = carriedAt(cell, ground.column);
  if (cell.surface === 'approach' && carried === null) return unjudged('no bridge end');
  const surfaceOf = walkSurface(cell, carried);
  if (ground.lineCell(cell.x, cell.z) !== null) {
    const lineY = lineGround(cell.x, cell.z);
    if (lineY === null) return unjudged('centre line');
    // Its own column on a roof over the line, or over the height carried
    // there: the grid put it on the street (streetUnderRoof).
    const own = ground.column(cell.x, cell.z);
    const lifted = own !== null && surfaceOf(own) - (carried ?? lineY) > corridorConfig.roofRise;
    return unjudged(lifted ? 'centre line on a roof' : 'centre line', cell.terrainHeight - lineY);
  }
  if (cell.sample.tileGeometricError > corridorConfig.maxTileError) return unjudged('coarse tile');
  const axisY = lineGround(cell.axisX, cell.axisZ);
  if (axisY === null) return unjudged('no centre line ground');
  const rise = cell.terrainHeight - axisY;
  if (Math.abs(rise) > RouteCellSampler.OUTLIER_M) return unjudged('seam', rise);
  if (rise > corridorConfig.roofRise) return { walkable: false, check: 'roof', overLine: rise };
  const own = ground.column(cell.x, cell.z);
  if (own !== null && lowObjectTop(own, surfaceOf(own)) !== null) return { walkable: false, check: 'hollow', overLine: rise };
  const check = walkOut(cell, axisY, ground.column, surfaceOf, cellSize);
  return { walkable: check === 'walkable', check, overLine: rise };
}

/** The height a column gives a walk, see walkSurface. */
type SurfaceY = (column: ColumnSample) => number;

const groundOf: SurfaceY = (column) => column.groundY;

/**
 * The height the route carries at an `approach` cell (carriedDeckY), which
 * its hits compare with (surfaceY); null for any other cell and where the
 * column at its bridge end is missing.
 */
function carriedAt(cell: Pick<RouteCell, 'surface' | 'deckEnd'>, column: ColumnAt): number | null {
  if (cell.surface !== 'approach' || cell.deckEnd === null) return null;
  return carriedDeckY(cell.deckEnd, column);
}

/**
 * The hit of each column a walk out to `cell` stands on: the hit a cell of
 * its surface would take there (surfaceY), the ground or, on the stretch
 * off a bridge end, the hit nearest to `carried`, the height the route
 * carries at the cell (carriedAt).
 */
function walkSurface(cell: RouteCell, carried: number | null): SurfaceY {
  if (cell.surface === 'ground') return groundOf;
  return (probe) => surfaceY(cell.surface, probe, carried) ?? probe.groundY;
}

/**
 * Keys of the grid spots a route centre line runs through, edges and
 * corners included (segmentTouchesCell): the cells claimSegmentCells claims
 * at any width. Their axis spot (RouteCell.axisX) is not always the cell
 * itself: where the line only clips a corner, the point of the line
 * nearest to the cell centre lies in the spot beside it. `routes` are the
 * local positions of each route.
 */
export function centreLineKeys(routes: readonly (readonly { x: number; z: number }[])[], lattice: RouteCellLattice): Set<number> {
  const keys = new Set<number>();
  const size = lattice.cellSize;
  for (const points of routes) {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      // Column by column of grid spots, the z range of the segment over it;
      // one spot more on the low side of each range for a line on an edge.
      for (let gx = lattice.index(Math.min(a.x, b.x)) - 1; gx <= lattice.index(Math.max(a.x, b.x)); gx++) {
        const x0 = gx * size;
        let t0 = 0;
        let t1 = 1;
        if (dx !== 0) {
          const ta = (x0 - a.x) / dx;
          const tb = (x0 + size - a.x) / dx;
          t0 = Math.max(0, Math.min(ta, tb));
          t1 = Math.min(1, Math.max(ta, tb));
          if (t0 > t1) continue;
        } else if (a.x < x0 || a.x > x0 + size) {
          continue;
        }
        const z0 = a.z + dz * t0;
        const z1 = a.z + dz * t1;
        for (let gz = lattice.index(Math.min(z0, z1)) - 1; gz <= lattice.index(Math.max(z0, z1)); gz++) {
          if (segmentTouchesCell(size, a, b, gx, gz)) keys.add(lattice.key(gx, gz));
        }
      }
    }
  }
  return keys;
}

/**
 * The height a cell a route centre line runs through takes instead of the
 * hit `y` of its column (RouteCellSampler.sampleCellY): the ground of the
 * line around it (centreLineGround) where `y` lies more than `roofRise`
 * above that; null for any other cell or hit, which keeps the hit.
 *
 * Such a column came down on a jetty, an oriel or a roof corner the line
 * passes under or clips, with no street under it in the photogrammetry
 * (playtest 2026-09-14, Rothenburg: 5.7 m and 7.6 m over the street). An
 * edge cell like that leaves the corridor (cellWalkable), but the
 * corridor keeps a cell the line runs through at any width, and enemies
 * take their height from the cell they are in: they climbed onto the
 * roof and the cell stood there in the Route Grid Overlay. Tree crowns
 * over the street are the same case (playtest Erlenbach). A slope along
 * the line rises far less than `roofRise` from one spot to the next; the
 * median keeps up to two raised spots in a row, the cell and one beside
 * it, out of the reference.
 *
 * On the stretch off a bridge end (`approach`) the reference is the height
 * the route carries there (carriedDeckY) instead of the centre line around
 * the cell: the line around the last cells of the stretch reaches past it,
 * onto ground spots that may take the quay under a deck that goes on
 * further, and the median would pull a cell on the deck down to the quay.
 * Deck and tunnel cells keep their hit.
 */
export function streetUnderRoof(cell: RouteCell, y: number, ground: WalkGround, cellSize: number): number | null {
  if (ground.lineCell(cell.x, cell.z) === null) return null;
  if (cell.surface === 'ground') return streetUnderRoofAt(cell.x, cell.z, y, ground, cellSize);
  const lineY = carriedAt(cell, ground.column);
  return lineY !== null && y - lineY > corridorConfig.roofRise ? lineY : null;
}

/**
 * The rule of streetUnderRoof at any point (x, z): the ground of the route
 * centre line around it (centreLineGround) where the hit `y` there lies
 * more than `roofRise` above that, else null.
 *
 * RouteCellSampler.tunnelColumn asks it for the two portals of a tunnel or
 * covered passage. 2 m outside a mouth the column can come down on the
 * jetty of the house the passage runs through, or on the house itself where
 * the OSM way ends short of the opening, and every cell of the passage took
 * its height on the line between that and the other portal (playtest
 * 2026-09-15, Rothenburg, archway: the yellow cells climbed inside the
 * passage, enemies came out of the house on the other side). The tunnel
 * spots do not count for the line ground, the ground spots past the mouth
 * do.
 */
export function streetUnderRoofAt(x: number, z: number, y: number, ground: WalkGround, cellSize: number): number | null {
  const lineY = centreLineGround(x, z, ground, cellSize);
  return lineY !== null && y - lineY > corridorConfig.roofRise ? lineY : null;
}

/** The cells among `cells` an enemy could not walk to (cellWalkable false). */
export function unwalkableCells(cells: Iterable<RouteCell>, ground: WalkGround, cellSize: number): RouteCell[] {
  const found: RouteCell[] = [];
  const memo: LineGroundMemo = new Map();
  for (const cell of cells) {
    if (judgeWalk(cell, ground, cellSize, memo).walkable === false) found.push(cell);
  }
  return found;
}

const ascending = (a: number, b: number) => a - b;

/** Grid steps either way along the centre line that centreLineGround takes in. */
const LINE_REACH = 2;

/**
 * Ground of the route centre line at the grid spot (x, z): the median of
 * the heights of the centre line spots within LINE_REACH grid steps of it
 * (5 by 5), the lower of the middle two for an even count. On a line those
 * are the spot and two before and after it, so two raised spots in a row
 * do not tip it; with one either way, a tree crown over two spots of the
 * street did (playtest Erlenbach: cells in crowns beside the street). Three
 * in a row, 6 m of crown over the line, still do. A spot counts with the surface
 * its cell stands on, as RouteCellSampler.hitOf takes it (surfaceY): the
 * lowest hit of its column, the highest on a bridge deck, on the stretch off
 * a bridge end the one nearest to the height the route carries there; a
 * tunnel spot not at all, nor a spot of the stretch without a column at its
 * bridge end. With
 * the lowest hit of the deck spots, the water under the deck, the edge
 * cells at the head of a bridge on a diagonal line stood 8 m over the
 * median and were judged a roof. Null where none of them has a column.
 *
 * One spot alone was the reference until 2026-09-14. Where the line runs
 * under the jetty of a half-timbered house, the column of its spot comes
 * down on the jetty (the photogrammetry has no street under it), and every
 * cell beside it was measured against that: a cell 2 m above the street
 * under an eave was 3.7 m below the reference and passed (playtest
 * 2026-09-14, Rothenburg, spot 5.7 m above the street).
 */
export function centreLineGround(x: number, z: number, ground: WalkGround, cellSize: number): number | null {
  const heights: number[] = [];
  for (let dx = -LINE_REACH; dx <= LINE_REACH; dx++) {
    for (let dz = -LINE_REACH; dz <= LINE_REACH; dz++) {
      const sx = x + dx * cellSize;
      const sz = z + dz * cellSize;
      const line = ground.lineCell(sx, sz);
      if (line === null || line.surface === 'tunnel') continue;
      const column = ground.column(sx, sz);
      if (column === null) continue;
      const y = surfaceY(line.surface, column, carriedAt(line, ground.column));
      if (y !== null) heights.push(y);
    }
  }
  if (heights.length === 0) return null;
  heights.sort(ascending);
  return heights[Math.floor((heights.length - 1) / 2)];
}

/**
 * How a walk from the centre line out to `cell`, grid spot by grid spot,
 * ends: on the cell's ground (`walkable`), or short of it because the cell
 * lies too high (`step`) or too low (`drop`) for the ground reached before.
 *
 * The walk starts on the centre line (`lineY`), or where the line stands
 * raised over the ground on both sides of it, a row of cars on it, on that
 * ground (groundBesideRaisedLine). A spot counts as reached
 * where its ground lies at most `stepRise` above the highest ground reached
 * so far, or above the last one plus the cross slope for every spot since,
 * where the ground rises towards the cell (crossSlope); and at most
 * `stepDrop` below the lowest ground reached so far, or below the last one
 * less the cross slope for every spot since, where it falls towards the
 * cell. Where it falls, every ground reached counts carried down the cross
 * slope to the spot, the last one in full as well. So it goes up and down a
 * kerb, a step, a gutter or a slope, but not onto a car, a van or a hedge,
 * nor down an embankment or a quay wall; the ground beyond one of those
 * counts again where it is back within reach. Deeper than OUTLIER_M below
 * is a seam, never reached. `surfaceY`: the hit of each column the walk
 * stands on (walkSurface).
 *
 * Until 2026-09-15 the walk went down any drop: on the valley side of a
 * street across a slope the corridor reached down the embankment into the
 * vegetation (playtest 2026-09-15, Rothenburg), while the uphill side ended
 * at the bank. And the highest ground reached on that side was the centre
 * line, which a car there counted from: 0.8 m high 4 m down a 10 % cross
 * slope it stood 0.4 m above it and kept its cell (the same playtest:
 * single parked cars still carried cells). Now it counts from the ground in
 * front of it. That ground keeps its full step, so a step up to a garden
 * level with the centre line stays walkable, and so does a car up to
 * `stepRise` plus one spot's fall above it.
 */
function walkOut(cell: RouteCell, lineY: number, column: ColumnAt, surfaceY: SurfaceY, cellSize: number): 'walkable' | 'step' | 'drop' {
  const y = cell.terrainHeight;
  const { stepRise, stepDrop } = corridorConfig;
  const gx = Math.round((cell.x - cell.axisX) / cellSize);
  const gz = Math.round((cell.z - cell.axisZ) / cellSize);
  const steps = Math.max(Math.abs(gx), Math.abs(gz));
  if (steps === 0) return 'walkable';
  // The walk never reaches lower than the centre line, nor less high than
  // it or, where the ground falls towards the cell, its ground carried
  // down the cross slope (the ceiling below). So a cell at most one step
  // above or below the centre line is reached whatever lies in between,
  // right beside the line or where the ground does not fall towards it: no
  // probes on the way out for most edge cells of a level street.
  const inReach = (from: number) => y <= from + stepRise && y >= from - stepDrop;
  if (inReach(lineY) && steps === 1) return 'walkable';
  // Rounded away from the centre line.
  const along = (g: number, k: number) => Math.sign(g * k) * Math.round(Math.abs((g * k) / steps)) * cellSize;
  const spot = (k: number) => column(cell.axisX + along(gx, k), cell.axisZ + along(gz, k));
  // The cross slope from one step along the straight line to the cell and
  // its mirror, not from the grid spots: on a line neither along an axis nor
  // diagonal (a cell round the end of a segment) the spots take the rise in
  // uneven steps, the first one often none. The same spots otherwise.
  const ux = (cell.x - cell.axisX) / steps;
  const uz = (cell.z - cell.axisZ) / steps;
  const toward = column(cell.axisX + ux, cell.axisZ + uz);
  if (inReach(lineY) && (toward === null || surfaceY(toward) >= lineY)) return 'walkable';
  const away = column(cell.axisX - ux, cell.axisZ - uz);
  const axisY = groundBesideRaisedLine(lineY, toward, away, surfaceY) ?? lineY;
  const slope = crossSlope(axisY, toward, away, surfaceY);
  const rise = Math.max(0, slope);
  const fall = Math.min(0, slope);
  if (inReach(axisY) && y <= axisY + fall * steps + stepRise) return 'walkable';

  let top = axisY;
  // The highest ground reached, each spot carried down the cross slope to
  // spot 0: its ground less the fall per spot. `top` where the ground does
  // not fall towards the cell.
  let high = axisY;
  let bottom = axisY;
  let last = axisY;
  let lastK = 0;
  const ceiling = (k: number) => Math.max(high + fall * k, last + rise * (k - lastK)) + stepRise;
  const floor = (k: number) => Math.min(bottom, last + fall * (k - lastK)) - stepDrop;
  for (let k = 1; k < steps; k++) {
    const probe = spot(k);
    if (probe === null) continue;
    const ground = surfaceY(probe);
    if (ground > ceiling(k) || ground < floor(k) || ground < top - RouteCellSampler.OUTLIER_M) continue;
    last = ground;
    lastK = k;
    top = Math.max(top, ground);
    high = Math.max(high, ground - fall * k);
    bottom = Math.min(bottom, ground);
  }
  return y > ceiling(steps) ? 'step' : y < floor(steps) ? 'drop' : 'walkable';
}

/**
 * The ground a walk out starts from where the centre line stands raised over
 * the ground on both sides of it: the first step on the way out (`toward`)
 * and its mirror (`away`) both lie more than `stepDrop` below `lineY`, the
 * centre line ground (centreLineGround). A row of parked cars or a hedge the
 * OSM line runs over: three of the five line spots on it tip the median onto
 * its top, and every cell on the street beside it lay more than a step below
 * that and was a drop, the corridor there only the centre line cells on the
 * roofs (playtest 2026-09-15, retest 706 to 708). The middle of the two, so a
 * street across a slope keeps its cross slope (crossSlope); the higher of the
 * two where they lie more than two steps (`stepRise`) apart, one side falling
 * far (a quay wall, an embankment), so the walk goes on from the other. Null
 * where either lies within `stepDrop` of the line or has no column: the walk
 * starts on the line.
 */
function groundBesideRaisedLine(lineY: number, toward: ColumnSample | null, away: ColumnSample | null, surfaceY: SurfaceY): number | null {
  if (toward === null || away === null) return null;
  const { stepRise, stepDrop } = corridorConfig;
  const out = surfaceY(toward);
  const back = surfaceY(away);
  if (lineY - out <= stepDrop || lineY - back <= stepDrop) return null;
  return Math.abs(out - back) <= 2 * stepRise ? (out + back) / 2 : Math.max(out, back);
}

/**
 * Rise per grid spot of the ground across the street towards the cell,
 * from the first step on the way out (`toward`) and its mirror on the
 * other side of the centre line (`away`): where the ground rises towards
 * the cell about as much as it falls on the other side, or falls towards
 * it about as much as it rises there (the two within `stepRise`), the
 * smaller of the two, negative where it falls; else 0. A car or a hedge
 * rises on one side only, a quay wall or an embankment below a terrace
 * falls on one side only; a hillside street tilts both ways alike
 * (DevWorld's terrain as well). As the tower footprint's cursorSlope does
 * it.
 */
function crossSlope(axisY: number, toward: ColumnSample | null, away: ColumnSample | null, surfaceY: SurfaceY): number {
  if (toward === null || away === null) return 0;
  const out = surfaceY(toward) - axisY;
  const back = axisY - surfaceY(away);
  if (out * back <= 0 || Math.abs(out - back) > corridorConfig.stepRise) return 0;
  return Math.sign(out) * Math.min(Math.abs(out), Math.abs(back));
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

/** Share of a station's length within which a spot counts as right at its end, for rounding in the local projection. */
const ALONG_EPSILON = 1e-6;

/** A line from (ax, az) to (bx, bz), local. */
interface Line {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

/** One station of a route in walkCaps: its segment `i`, its index `k` there and its stretch of the segment. */
interface CapStation extends Line {
  i: number;
  k: number;
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
 * is capped. A spot a centre line runs through stays: the corridor claims
 * that cell at any width.
 *
 * That margin holds while the capped half width is at least `edgeMargin`.
 * Below it the enemies' limit there is 0, and the round end of the station
 * next to it still reaches half a cell diagonal times hypot(1, taper), 1.58 m
 * by default (jointCap): a car cell 1.5 m off the line, next to where two
 * stations meet, stayed (playtest 2026-09-14). So, once the stations along
 * the spots are capped, every station whose round end at a joint with
 * narrower neighbour would still reach a spot is capped short of it as well,
 * until none does (roundEndsOff).
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

  const kept: WalkSpot[] = [];
  for (const spot of spots) {
    const gx = Math.floor(spot.x / cellSize);
    const gz = Math.floor(spot.z / cellSize);
    const through = (s: Line) => segmentTouchesCell(cellSize, { x: s.ax, z: s.az }, { x: s.bx, z: s.bz }, gx, gz);
    if (route.some(through)) continue;
    kept.push(spot);
    const places = route.map((s) => placeOn(s, spot.x, spot.z));
    for (let i = 0; i < route.length; i++) {
      const segment = route[i];
      const n = segment.stations;
      if (n === 0) continue;
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
  roundEndsOff(route, kept, caps, cellSize);
  return caps;
}

/**
 * Cap every station whose round end at a joint would still reach one of
 * `spots` short of it, see walkCaps. A joint is where two segments meet,
 * or inside a segment where two stations get different half widths on
 * either side: the fitting makes a piece of each run of stations equal on
 * both sides. Where only the other side changes, the round end on this
 * side keeps the full half width of its neighbour and can reach over a
 * short piece into a stretch narrowed on this side (a tree crown over the
 * street, capped on both sides, playtest Erlenbach). The
 * half width of a station is taken as the one in use or its cap, whichever
 * is smaller, rounded down to `widthStep` as the corridor fitting does. The
 * cap is the distance of the spot to the joint less a centimetre: the round
 * end of a station reaches at most its own half width (jointCap). Repeated
 * until no station changes, as a cap makes new joints.
 */
function roundEndsOff(route: readonly WalkCapSegment[], spots: readonly WalkSpot[], caps: WalkCaps[], cellSize: number): void {
  if (spots.length === 0) return;
  const stations: CapStation[] = [];
  route.forEach((s, i) => {
    for (let k = 0; k < s.stations; k++) {
      const f0 = k / s.stations;
      const f1 = (k + 1) / s.stations;
      stations.push({
        i, k,
        ax: s.ax + (s.bx - s.ax) * f0, az: s.az + (s.bz - s.az) * f0,
        bx: s.ax + (s.bx - s.ax) * f1, bz: s.az + (s.bz - s.az) * f1,
      });
    }
  });
  const width = (st: CapStation, side: 'left' | 'right') => Math.min(route[st.i][side][st.k], walkWidth(caps[st.i][side][st.k]));

  let changed = true;
  while (changed) {
    changed = false;
    for (let s = 0; s < stations.length; s++) {
      const st = stations[s];
      for (const q of [s - 1, s + 1]) {
        const other = stations[q];
        // Neighbours along the route; across a segment without stations (a tunnel) there are none.
        if (!other || Math.abs(other.i - st.i) > 1) continue;
        for (const spot of spots) {
          const { along, distance, side } = placeOn(st, spot.x, spot.z);
          // At or past the end of the station that meets `other`. Right at
          // the joint the piece claims with its own half width
          // (claimSegmentCells takes along 0 and 1 as along its length):
          // a cell centre on the line across the joint, as where stations
          // meet at an odd metre.
          const beyond = q < s ? -along : along - 1;
          if (beyond < -ALONG_EPSILON) continue;
          // Within a segment, stations equal on both sides are one piece: no joint.
          const same = (s: 'left' | 'right') => width(st, s) === width(other, s);
          if (other.i === st.i && same('left') && same('right')) continue;
          const own = width(st, side);
          const next = width(other, side);
          const radius = beyond <= ALONG_EPSILON ? own : jointCap(own, next, cellSize);
          if (distance > radius) continue;
          const capped = Math.max(0, distance - 0.01);
          if (capped >= caps[st.i][side][st.k]) continue;
          caps[st.i][side][st.k] = capped;
          changed = true;
        }
      }
    }
  }
}

/** Where (x, z) lies from `segment`: how far along it (0 to 1 over its length), how far off it and on which side. */
function placeOn(segment: Line, x: number, z: number): { along: number; distance: number; side: 'left' | 'right' } {
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
