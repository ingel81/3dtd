import type { StreetNode } from '../interfaces/street-network-provider.interface';
import { haversineDistance } from './geo-utils';
import { closestPointOnSegment } from './route-geometry';

/**
 * Where a spawn's route starts: at the foot of the spawn on the street
 * segment nearest to it (findNearestStreetPoint), and on from there through
 * whichever end of the segment reaches the end of the route for less. The
 * spawn portal and the enemies stand on the route start
 * (MarkerVisualizationService.placeSpawnPortal, EnemyManager), so they stand
 * where the player clicked. Until 2026-09-14 the route began on the
 * segment's first node, up to a segment's length along the street from the
 * click. Shared by OsmStreetService and the pathfinding worker, which run
 * the same A* on the same network.
 */

/**
 * A foot this close to an end of its segment starts the route on that node
 * (m): no stub of a route, as leavePathForBase keeps no point within a metre
 * of the last one either.
 */
export const ROUTE_START_SNAP_M = 1;

/** Id of a route start between two street nodes; OSM node ids are positive. */
export const ROUTE_START_NODE_ID = -1;

/** A route from a street node to the end, and what A* paid for it. */
export interface RouteTail {
  path: StreetNode[];
  cost: number;
}

/**
 * The routes from the street segment `a`-`b` to one end. A* runs from each
 * end of the segment at most once, the first time a start needs it: the
 * spawn preview (MapPlacementService) keeps one per segment the cursor
 * slides along, and every start on it costs only the choice.
 */
export class SegmentRoutes {
  private readonly tails = new Map<StreetNode, RouteTail | null>();

  /**
   * @param weight Cost factor of the segment's street type, as A* weighs its edges
   * @param routeOn A* from a node of the segment to the end, null without a route
   */
  constructor(
    private readonly a: StreetNode,
    private readonly b: StreetNode,
    private readonly weight: number,
    private readonly routeOn: (node: StreetNode) => RouteTail | null,
  ) {}

  /**
   * Where a route from (lat, lon) starts: the foot of the point on the
   * segment, or the end of the segment within ROUTE_START_SNAP_M of it.
   */
  startAt(lat: number, lon: number): StreetNode {
    const foot = closestPointOnSegment(this.a, this.b, { lat, lon });
    const toA = haversineDistance(foot.lat, foot.lon, this.a.lat, this.a.lon);
    const toB = haversineDistance(foot.lat, foot.lon, this.b.lat, this.b.lon);
    if (Math.min(toA, toB) < ROUTE_START_SNAP_M) return toA <= toB ? this.a : this.b;
    return { id: ROUTE_START_NODE_ID, lat: foot.lat, lon: foot.lon };
  }

  /**
   * The route from (lat, lon): from its start (startAt) through the end of
   * the segment whose route costs less, the piece of the segment up to it
   * at `weight` included, `a` on a tie. A route from that end that runs back
   * over the segment through the other end goes to the other end straight
   * from the start instead of passing it twice. Empty without a route from
   * either end.
   */
  routeFrom(lat: number, lon: number): StreetNode[] {
    const start = this.startAt(lat, lon);
    if (start === this.a || start === this.b) return this.tail(start)?.path.slice() ?? [];

    const cost = (end: StreetNode): number => {
      const tail = this.tail(end);
      return tail ? tail.cost + haversineDistance(start.lat, start.lon, end.lat, end.lon) * this.weight : Infinity;
    };
    const costA = cost(this.a);
    const costB = cost(this.b);
    if (costA === Infinity && costB === Infinity) return [];

    const end = costA <= costB ? this.a : this.b;
    const other = end === this.a ? this.b : this.a;
    const path = this.tail(end)!.path;
    return path[1]?.id === other.id ? [start, ...path.slice(1)] : [start, ...path];
  }

  /** A* from `end`, run the first time it is asked for. */
  private tail(end: StreetNode): RouteTail | null {
    let tail = this.tails.get(end);
    if (tail === undefined) {
      tail = this.routeOn(end);
      this.tails.set(end, tail);
    }
    return tail;
  }
}
