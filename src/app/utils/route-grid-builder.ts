import { RouteWaypoint } from '../models/game.types';
import { corridorConfig, lateralLimit, segmentLeft, segmentRight } from './route-corridor';
import { ApproachPoint, RouteCell, TunnelSpan } from './route-cell';
import { SegmentApproach, nearestApproach, pointOnApproach, routeApproaches, segmentApproaches } from './carried-height';

/**
 * Building the route-cell corridor: which cells a route claims, which
 * surface each one stands on, and the tunnel stretches between their
 * portals. Used by GlobalRouteGrid.generateFromRoutes; the sampling of the
 * cells that follows lives in RouteCellSampler.
 */

/**
 * How far outside a tunnel mouth its portal ground is probed, metres: right
 * at the mouth a column can land on the overhang above it.
 */
export const TUNNEL_PORTAL_OFFSET_M = 2;

/**
 * A segment in a tunnel stretch: the portals of the whole stretch (local x,
 * z, TUNNEL_PORTAL_OFFSET_M outside the mouths) and the part of the way
 * from portal a to b the segment covers.
 */
export interface SegmentTunnel {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  from: number;
  to: number;
  /** The stretch is a passage (RouteWaypoint.passage on one of its segments); absent on a tunnel from OSM. */
  passage?: true;
}

/**
 * The grid lattice cells are claimed on: GlobalRouteGrid's cell size and its
 * keying rule, so a cell is created under the key every lookup uses.
 */
export interface RouteCellLattice {
  readonly cellSize: number;
  /** Grid index of a local coordinate. */
  index(v: number): number;
  /** Integer key of grid spot (gx, gz). */
  key(gx: number, gz: number): number;
}

/** A route point in local coordinates; y is the smoothed route height. */
interface LocalPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * The tunnel stretch each segment of `route` lies in (`inTunnel` on its
 * start waypoint), null outside tunnels. `points` are the route's local
 * positions.
 */
export function tunnelSegments(route: readonly RouteWaypoint[], points: readonly { x: number; z: number }[]): (SegmentTunnel | null)[] {
  const segments = route.length - 1;
  const result: (SegmentTunnel | null)[] = new Array(segments).fill(null);
  let i = 0;
  while (i < segments) {
    if (!route[i].inTunnel) {
      i++;
      continue;
    }
    let end = i;
    while (end + 1 < segments && route[end + 1].inTunnel) end++;

    const lengths: number[] = [];
    for (let j = i; j <= end; j++) lengths.push(Math.hypot(points[j + 1].x - points[j].x, points[j + 1].z - points[j].z));
    const inner = lengths.reduce((sum, l) => sum + l, 0);
    const total = inner + 2 * TUNNEL_PORTAL_OFFSET_M;
    // Portals moved out along the first and the last segment.
    const outward = (from: { x: number; z: number }, to: { x: number; z: number }) => {
      const len = Math.hypot(to.x - from.x, to.z - from.z) || 1;
      return { x: to.x + ((to.x - from.x) / len) * TUNNEL_PORTAL_OFFSET_M, z: to.z + ((to.z - from.z) / len) * TUNNEL_PORTAL_OFFSET_M };
    };
    const a = outward(points[i + 1], points[i]);
    const b = outward(points[end], points[end + 1]);

    const passage = route.slice(i, end + 1).some((w) => w.passage === true);
    let along = TUNNEL_PORTAL_OFFSET_M;
    for (let j = i; j <= end; j++) {
      const from = along / total;
      along += lengths[j - i];
      result[j] = { ax: a.x, az: a.z, bx: b.x, bz: b.z, from, to: along / total, ...(passage ? { passage: true as const } : {}) };
    }
    i = end + 1;
  }
  return result;
}

/**
 * How far past its start and its end a segment claims cells, left and right
 * of its direction of travel: the radius of its round ends, see
 * claimSegmentCells and jointCap.
 */
export interface SegmentCaps {
  startLeft: number;
  startRight: number;
  endLeft: number;
  endRight: number;
}

/**
 * Radius of the round end a segment of half width `own` gets on one side of
 * a joint with a segment of half width `other` on that side.
 *
 * Enemies near the joint keep within the lateral limit of the narrower of
 * the two, which rises by `taper` per metre away from it (buildSideLimits
 * in route-corridor.ts). A cell holding such an enemy has its centre at
 * most half a cell diagonal away from it, and past the end of the enemy's
 * segment that is never further from the joint than the limit there plus
 * half a cell diagonal times hypot(1, taper). Those cells need the round
 * end, the rest past the joint is the other segment's.
 *
 * At most `own`, the radius every end had before. With `own` at a joint
 * where the corridor narrows (a front garden ends at a house, a parking bay
 * at a facade, a crossing at a narrow street), the wider piece spilled its
 * width round its end into the narrower one for up to its half width along
 * the route: cells inside the house, which the roof check then put on the
 * ground (playtest 2026-09-14, orange cells in houses in Rothenburg).
 */
export function jointCap(own: number, other: number, cellSize: number): number {
  const reach = cellSize * Math.SQRT1_2 * Math.hypot(1, corridorConfig.taper);
  return Math.min(own, lateralLimit(Math.min(own, other)) + reach);
}

/**
 * Claim the cells of every segment of one route in `cells`, see
 * claimSegmentCells. `points` are the route's local positions. Which
 * surface a cell samples depends on all segments that reach it, so the
 * caller samples only once every route has claimed its cells. At a joint
 * of two segments each one's round end is cut to jointCap; the two ends of
 * the route keep their half widths. `alongClaims`: see claimSegmentCells,
 * one set for all routes of a grid. A segment on the stretch off a bridge
 * end (routeApproaches) hands it on.
 */
export function claimRouteCells(
  cells: Map<number, RouteCell>,
  lattice: RouteCellLattice,
  route: readonly RouteWaypoint[],
  points: readonly LocalPoint[],
  alongClaims = new Set<number>(),
): void {
  const tunnels = tunnelSegments(route, points);
  const segments = route.length - 1;
  const flags = route.slice(0, Math.max(0, segments));
  const approaches = routeApproaches(points, flags.map((w) => w.onBridge === true), flags.map((w) => w.inTunnel === true));
  const cap = (own: number, neighbour: RouteWaypoint | undefined, side: (w: RouteWaypoint) => number) =>
    neighbour ? jointCap(own, side(neighbour), lattice.cellSize) : own;
  for (let i = 0; i < segments; i++) {
    const left = segmentLeft(route[i]);
    const right = segmentRight(route[i]);
    const before = i > 0 ? route[i - 1] : undefined;
    const after = i + 1 < segments ? route[i + 1] : undefined;
    const caps: SegmentCaps = {
      startLeft: cap(left, before, segmentLeft),
      startRight: cap(right, before, segmentRight),
      endLeft: cap(left, after, segmentLeft),
      endRight: cap(right, after, segmentRight),
    };
    const approach = segmentApproaches(approaches[i], points);
    claimSegmentCells(
      cells, lattice, points[i], points[i + 1], left, right, route[i].onBridge === true, tunnels[i], caps, alongClaims, approach,
    );
  }
}

/**
 * Which surface a cell takes when two segments reach it on equal terms,
 * both along their length or both with a round end: the lower one, see
 * claimSegmentCells. Tunnels are settled before.
 */
const SURFACE_ORDER: Record<RouteCell['surface'], number> = { ground: 0, approach: 1, deck: 2, tunnel: 3 };

/**
 * Claim the cells whose centre lies within the half width of the segment
 * `start`-`end`, `left` or `right` of its direction by the side the
 * centre is on, and every cell the segment runs through, creating the
 * missing ones. Past the start or the end of the segment the half width is
 * that of `caps` (default: the segment's own, a round end). The second rule
 * makes a bottleneck narrower than a cell a
 * single file of cells, a staircase on a diagonal, in which enemies walk
 * the centre line (lateral limit 0). Local coordinates; y is the smoothed
 * route height, stored on each new cell as its `routeAnchorY` and as
 * fallback `terrainHeight` until the first sample succeeds. `tunnel`:
 * the segment lies in a tunnel, its cells take their height between the
 * portals, also those another segment reaches as well.
 *
 * `approaches`: the stretches off a bridge end the segment lies on
 * (SegmentApproach). A cell whose nearest point on the segment lies within
 * DECK_APPROACH_M of the nearest such bridge end is an `approach` cell and
 * compares with the height the route carries at that point
 * (RouteCell.onApproach).
 *
 * A cell another segment reached first: a tunnel wins. Otherwise a segment
 * that reaches the cell along its length (the centre's nearest point lies
 * on it, or it runs through the cell) takes the cell, surface and centre
 * line spot, from one that reached it only with a round end; `alongClaims`
 * holds the keys of cells claimed along a length so far. Two segments that
 * both reach it along their length, or both with a round end: the lower
 * surface wins, the ground over the stretch off a bridge end over a deck
 * (SURFACE_ORDER), a street under a bridge. So at the end of a bridge the
 * approach's round end no longer turns the first metres of the deck into
 * ground, which took the lowest hit, the quay or river under the deck
 * (playtest 2026-09-14, Paris, Pont d'Iéna), and the bridge's round end
 * leaves the approach on its own surface.
 */
export function claimSegmentCells(
  cells: Map<number, RouteCell>,
  lattice: RouteCellLattice,
  start: LocalPoint,
  end: LocalPoint,
  left: number,
  right: number,
  onBridge: boolean,
  tunnel: SegmentTunnel | null,
  caps: SegmentCaps = { startLeft: left, startRight: right, endLeft: left, endRight: right },
  alongClaims = new Set<number>(),
  approaches: readonly SegmentApproach[] = [],
): void {
  const cellSize = lattice.cellSize;
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lenSq = dx * dx + dz * dz;
  const reach = Math.max(left, right);
  const gx0 = lattice.index(Math.min(start.x, end.x) - reach);
  const gx1 = lattice.index(Math.max(start.x, end.x) + reach);
  const gz0 = lattice.index(Math.min(start.z, end.z) - reach);
  const gz1 = lattice.index(Math.max(start.z, end.z) + reach);

  for (let gx = gx0; gx <= gx1; gx++) {
    const cx = (gx + 0.5) * cellSize;
    for (let gz = gz0; gz <= gz1; gz++) {
      // Closest point of the segment to the cell centre.
      const cz = (gz + 0.5) * cellSize;
      const along = lenSq > 0 ? ((cx - start.x) * dx + (cz - start.z) * dz) / lenSq : 0;
      const t = Math.max(0, Math.min(1, along));
      const ox = start.x + dx * t - cx;
      const oz = start.z + dz * t - cz;
      // (-dz, dx) points right of the direction of travel (engine frame x west,
      // z north, and any frame turned from it, such as x east, z south).
      const rightOfLine = (cz - start.z) * dx - (cx - start.x) * dz >= 0;
      const halfWidth = along < 0 ? (rightOfLine ? caps.startRight : caps.startLeft)
        : along > 1 ? (rightOfLine ? caps.endRight : caps.endLeft)
        : rightOfLine ? right : left;
      const within = ox * ox + oz * oz <= halfWidth * halfWidth;
      if (!within && !segmentTouchesCell(cellSize, start, end, gx, gz)) continue;
      // Along the segment's length, or it runs through the cell; not only its round end.
      const alongIt = !within || (along >= 0 && along <= 1);

      const key = lattice.key(gx, gz);
      const existing = cells.get(key);
      const span: TunnelSpan | null = tunnel
        ? {
          ax: tunnel.ax, az: tunnel.az, bx: tunnel.bx, bz: tunnel.bz, f: tunnel.from + (tunnel.to - tunnel.from) * t,
          ...(tunnel.passage ? { passage: true } : {}),
        }
        : null;
      // The centre line's grid spot next to the cell, where the walk check starts (cellWalkable).
      const axisX = (lattice.index(start.x + dx * t) + 0.5) * cellSize;
      const axisZ = (lattice.index(start.z + dz * t) + 0.5) * cellSize;
      const anchorY = start.y + (end.y - start.y) * t;
      const approach = onBridge || tunnel ? null : nearestApproach(approaches, t);
      const surface: RouteCell['surface'] = onBridge ? 'deck' : tunnel ? 'tunnel' : approach ? 'approach' : 'ground';
      const onApproach = approach ? pointOnApproach(approach, t) : null;
      if (existing) {
        // A cell several segments reach: a tunnel wins, or the cells in its
        // mouth, reached by the approach first, would sample the hill above
        // it. Else see above: along a length over a round end, then the
        // lower surface.
        if (span) {
          if (existing.surface !== 'tunnel') {
            existing.surface = 'tunnel';
            existing.tunnelSpan = span;
            existing.onApproach = null;
          }
        } else if (existing.surface !== 'tunnel') {
          if (alongIt && !alongClaims.has(key)) {
            alongClaims.add(key);
            existing.surface = surface;
            existing.onApproach = onApproach;
            existing.axisX = axisX;
            existing.axisZ = axisZ;
            existing.routeAnchorY = anchorY;
            existing.terrainHeight = anchorY;
          } else if (alongIt === alongClaims.has(key) && SURFACE_ORDER[surface] < SURFACE_ORDER[existing.surface]) {
            existing.surface = surface;
            existing.onApproach = onApproach;
          }
        }
        continue;
      }
      if (alongIt) alongClaims.add(key);
      addCell(cells, key, cx, cz, axisX, axisZ, anchorY, surface, span, onApproach);
    }
  }
}

/**
 * Whether the segment `start`-`end` touches the square of grid spot
 * (gx, gz), edges included (Liang-Barsky clipping), the square grown by
 * `margin` on every side. At generation, and where the band checks the
 * cells its line will claim (corridor-band.ts).
 */
export function segmentTouchesCell(
  cellSize: number,
  start: { x: number; z: number },
  end: { x: number; z: number },
  gx: number,
  gz: number,
  margin = 0,
): boolean {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  const x0 = gx * cellSize - margin;
  const z0 = gz * cellSize - margin;
  const size = cellSize + 2 * margin;
  return clip(-dx, start.x - x0) && clip(dx, x0 + size - start.x)
    && clip(-dz, start.z - z0) && clip(dz, z0 + size - start.z);
}

/**
 * Construct a cell in unsampled state with `anchorY` as a temporary
 * terrain-Y fallback (combat-side reads need *some* value). Its terrain
 * height comes from sampleCellY, the sole writer of terrainHeight, which
 * generateFromRoutes runs once all segments have claimed their cells.
 */
function addCell(
  cells: Map<number, RouteCell>,
  key: number,
  x: number,
  z: number,
  axisX: number,
  axisZ: number,
  anchorY: number,
  surface: RouteCell['surface'],
  tunnelSpan: TunnelSpan | null,
  onApproach: ApproachPoint | null,
): void {
  const cell: RouteCell = {
    key,
    x,
    z,
    axisX,
    axisZ,
    terrainHeight: anchorY,        // Fallback until sampleCellY succeeds.
    surface,
    tunnelSpan,
    onApproach,
    routeAnchorY: anchorY,
    sample: {
      state: 'unsampled',
      sampledAt: 0,
      tileDepth: 0,
      tileGeometricError: Infinity,
    },
    heightSampled: false,
    enemies: new Set(),
    towerVisibility: new Map(),
    airVisibility: new Map(),
  };

  cells.set(key, cell);
}
