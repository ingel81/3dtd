import type { ColumnSample } from '../three-engine/column-sample';
import type { ApproachPoint, ApproachStart, RouteCell } from './route-cell';
import type { Street, StreetNode } from '../interfaces/street-network-provider.interface';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from './geo-utils';
import { runsUnderCover } from './route-corridor';
import type { StreetUnder } from './underpass';

/**
 * The height a route carries along an approach: past the end of its OSM
 * bridge way, and along the leg from the street to the HQ.
 *
 * A route over a way with `bridge=*` stands on the deck, the top of the
 * column (RouteCellSampler); every other way on the lowest hit. The
 * structure of a bridge can reach past the end of its bridge way, and the
 * ways there carry no bridge tag. Playtest 2026-09-14, Paris, Pont d'Iéna:
 * ways of 7 and 2 m at one head, 31 m at the other, over a quay 8 to 9.5 m
 * below the deck; their cells, the red line and the enemies dropped to the
 * quay, the yellow street overlay ran on the quay and the river. Retest
 * 2026-09-15, head at Place de Varsovie: the route turns 35 and then 90
 * degrees within 26 m of the other carriageway's bridge way, and the
 * columns of the road there have a second surface 1.2 to 3.9 m under it in
 * the same tile, at one spot the road 10 m below. The turn ended the
 * stretch after 9 m; the cells behind it took the surface under the road.
 *
 * So the route off a bridge end is followed for up to DECK_APPROACH_M,
 * whichever way it turns, as long as it is neither bridge nor tunnel
 * (routeApproaches). Along it, the height the route carries is followed from
 * the top of the column at the bridge end, point by point (carriedY),
 * and a cell or point there takes the hit of its own column nearest to that
 * height (approachY). Where the route stays on the level of the deck,
 * over a quay or a road below, that is the top. Stairs and ramps down to the
 * quay are followed down and keep their ground, also where they pass under
 * a deck. A crown, lamp, statue or awning over a street on the level of the
 * deck lies farther above it than the street. Past that distance the lowest
 * hit, as on any other way.
 *
 * The leg to the HQ runs over no street, from the point of the route
 * nearest to the HQ, often into a building. Photogrammetry has no floor in
 * a building, the lowest hit of a column there is its roof: the cells of
 * the leg climbed onto the HQ's building, the red line ran up its facade,
 * and enemies walked into the house and came out through the roof
 * (playtest 2026-09-16, Audi NSU Neckarsulm and Erlenbach BBH). So the leg
 * carries the height too, from the lowest hit where it leaves the street,
 * along the whole leg (routeApproaches): a yard, a garden, a ramp or stairs
 * follow their ground, a building keeps the street's level, and the
 * enemies walk into it at street level and vanish at the end of the route.
 * Where a bridge's approach reaches the start of the leg, the leg carries
 * that height on instead.
 *
 * Route cells find the stretch along their route (routeApproaches), the
 * yellow street overlay along the street network (streetDeckApproaches);
 * cells, the centre line ground, the corridor walk check, the clearance
 * stations and the overlay take their heights by the same rule (surfaceY,
 * carriedY, approachY).
 */

/**
 * How far past the end of a bridge way the route off it is followed,
 * metres along the route. At Place de Varsovie the ways off the bridge way
 * are 9, 18 and 34 m long round two turns, to the next junction at 61 m;
 * behind the other head the route reaches a junction at 44 m, over the
 * underpasses of the quay.
 */
export const DECK_APPROACH_M = 60;

/**
 * Metres between the points the height the route carries is followed at
 * (carriedY), one grid cell.
 */
export const CARRY_STEP_M = 2;

/**
 * How far the height the route carries may change from one point to the
 * next (carriedY), metres. Stairs rise about 1.2 m over CARRY_STEP_M; a
 * deck lies further over the stairs, road or quay it spans, and a crown,
 * awning or car without ground under it further over the street.
 */
export const CARRY_STEP_RISE_M = 1.5;

/**
 * The hit of `column` nearest to `y`, the height the route carries there
 * (carriedY): its top where that lies at least as near as its lowest
 * hit, else the lowest hit; but `y` itself where that hit lies more than
 * CARRY_STEP_RISE_M above it. The top of a deck carried on lies nearer than
 * the quay or road under it; a street on the level of the deck nearer than
 * a crown, lamp, statue or car over it. A crown, awning, sign or roof with
 * no ground under it lies further above, and a cell there stands at the
 * height carried, as the route itself keeps it past such a column
 * (carriedY). A hit further below stays: the open quay beside a deck.
 */
export function approachY(column: ColumnSample, y: number): number {
  const hit = Math.abs(column.topY - y) <= Math.abs(column.groundY - y) ? column.topY : column.groundY;
  return hit - y > CARRY_STEP_RISE_M ? y : hit;
}

/**
 * The height the route carries `point.m` along `point.path` from the start
 * of its approach, the first point of the path: at the end of a bridge the
 * top of the column there, where the leg to the HQ leaves the street its
 * lowest hit (`point.start`); then every CARRY_STEP_M along the path the
 * hit of the column there nearest to the height so far (approachY), where
 * that lies within CARRY_STEP_RISE_M of it; a point whose column has none,
 * or no column, keeps the height so far. So the height goes down stairs and
 * up a ramp, but neither down through a gap in the mesh onto the road under
 * a deck nor up onto a crown, a car or the roof of a building. Null without
 * a column at the start. `column` is the caller's column probe, cached by
 * the engine per 0.5 m.
 */
export function carriedY(point: ApproachPoint, column: (x: number, z: number) => ColumnSample | null): number | null {
  const { path, m } = point;
  const first = column(path[0].x, path[0].z);
  if (first === null) return null;
  let y = point.start === 'bridge' ? first.topY : first.groundY;
  let next = CARRY_STEP_M;
  let start = 0;
  for (let k = 1; k < path.length && next <= m; k++) {
    const a = path[k - 1];
    const b = path[k];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    for (; next <= m && next <= start + length; next += CARRY_STEP_M) {
      const f = (next - start) / length;
      const here = column(a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f);
      if (here === null) continue;
      const hit = approachY(here, y);
      if (Math.abs(hit - y) <= CARRY_STEP_RISE_M) y = hit;
    }
    start += length;
  }
  return y;
}

/**
 * The height `column` gives a cell of `surface` (RouteCell.surface): the
 * lowest hit on the ground, the top on a deck, approachY on an approach
 * with `carried` the height the route carries there (carriedY). Null for a
 * tunnel cell, which takes its height between the portals, and for an
 * approach cell without `carried`. The one rule for the hit a cell stands
 * on: the cells (RouteCellSampler.hitOf) and the clearance stations
 * (TerrainQueries.measureStreetClearance) read their columns through it.
 */
export function surfaceY(surface: RouteCell['surface'], column: ColumnSample, carried: number | null): number | null {
  if (surface === 'ground') return column.groundY;
  if (surface === 'deck') return column.topY;
  if (surface === 'approach' && carried !== null) return approachY(column, carried);
  return null;
}

/**
 * A segment of a route on an approach: `path` the indices of the route
 * points from the start of the approach to the far end of the segment, the
 * first the start; `from` and `to` the distance along the route from the
 * start to the segment's start and to its end, metres; `start` what the
 * approach starts from (ApproachPoint.start); `reach` how far from its
 * start the approach carries its height on this segment: DECK_APPROACH_M on
 * a street, all of the leg to the HQ.
 */
export interface Approach {
  path: readonly number[];
  from: number;
  to: number;
  start: ApproachStart;
  reach: number;
}

/**
 * The approaches of a route, per segment (none, one, or more: between two
 * bridges, or off a bridge onto the leg to the HQ). `points` are the
 * route's local positions, `onBridge`, `inTunnel` and `onStreet` the flags
 * per segment; the leg to the HQ runs over no street.
 *
 * From every end of a run of bridge segments the approach runs on along
 * the route, whichever way it turns, while the route is neither bridge nor
 * tunnel: over a street while the segment starts within DECK_APPROACH_M,
 * onto the leg to the HQ where that starts within it, and then along the
 * whole leg. A leg no bridge's approach reaches is an approach of its own,
 * from where it leaves the street (or a tunnel) to its end.
 */
export function routeApproaches(
  points: readonly { x: number; z: number }[],
  onBridge: readonly boolean[],
  inTunnel: readonly boolean[],
  onStreet: readonly boolean[],
): Approach[][] {
  const segments = points.length - 1;
  const result: Approach[][] = Array.from({ length: Math.max(0, segments) }, () => []);
  const open = (i: number) => i >= 0 && i < segments && !onBridge[i] && !inTunnel[i];
  const leg = (i: number) => open(i) && !onStreet[i];

  // From the start at point `end` along the route in `step`, beginning with segment `first`.
  const walk = (first: number, step: 1 | -1, end: number, start: ApproachStart) => {
    const path = [end];
    let distance = 0;
    let onLeg = false;
    for (let j = first; open(j); j += step) {
      const reaches = leg(j) ? onLeg || distance <= DECK_APPROACH_M : start === 'bridge' && distance < DECK_APPROACH_M;
      if (!reaches) break;
      onLeg = leg(j);
      const a = points[step > 0 ? j : j + 1];
      const b = points[step > 0 ? j + 1 : j];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      path.push(step > 0 ? j + 1 : j);
      const [from, to] = step > 0 ? [distance, distance + length] : [distance + length, distance];
      result[j].push({ path: [...path], from, to, start, reach: onLeg ? Infinity : DECK_APPROACH_M });
      distance += length;
    }
  };

  for (let i = 0; i < segments; i++) {
    if (!onBridge[i]) continue;
    if (open(i + 1)) walk(i + 1, 1, i + 1, 'bridge');
    if (open(i - 1)) walk(i - 1, -1, i, 'bridge');
  }
  for (let i = 0; i < segments; i++) {
    if (leg(i) && !leg(i - 1) && result[i].length === 0) walk(i, 1, i, 'street');
  }
  return result;
}

/**
 * The approach among a segment's `approaches` whose start is nearest to the
 * point `t` of the way along it (0 to 1), null where none reaches it.
 */
export function nearestApproach<T extends { from: number; to: number; reach: number }>(approaches: readonly T[], t: number): T | null {
  let nearest: T | null = null;
  let nearestM = Infinity;
  for (const approach of approaches) {
    const distance = approach.from + (approach.to - approach.from) * t;
    if (distance <= approach.reach && distance <= nearestM) {
      nearest = approach;
      nearestM = distance;
    }
  }
  return nearest;
}

/**
 * An approach as the cells and clearance stations of a segment take it:
 * Approach with the route points of its path, local.
 */
export interface SegmentApproach {
  path: readonly { x: number; z: number }[];
  from: number;
  to: number;
  start: ApproachStart;
  reach: number;
}

/** The approaches `approaches` of a segment of the route with the local positions `points`, see SegmentApproach. */
export function segmentApproaches(approaches: readonly Approach[], points: readonly { x: number; z: number }[]): SegmentApproach[] {
  return approaches.map((approach) => ({ ...approach, path: approach.path.map((k) => ({ x: points[k].x, z: points[k].z })) }));
}

/**
 * Whether the start of the approach `a` lies nearer along its route than
 * that of `b`; at the same distance, whether its start has the lesser x,
 * then z. Of two approaches that reach a cell or a station, the height
 * carried from the nearer start counts, whichever route came first.
 */
export function startsNearer(a: ApproachPoint, b: ApproachPoint): boolean {
  if (a.m !== b.m) return a.m < b.m;
  const [p, q] = [a.path[0], b.path[0]];
  return p.x !== q.x ? p.x < q.x : p.z < q.z;
}

/** Where the point `t` (0 to 1) of a segment lies on its approach `approach`, see RouteCell.onApproach. */
export function pointOnApproach(approach: SegmentApproach, t: number): ApproachPoint {
  return { path: approach.path, m: approach.from + (approach.to - approach.from) * t, start: approach.start };
}

/**
 * What a street point takes its height from (TerrainQueries.getStreetHeightEstimate):
 * `bridge` on a bridge way; on an approach the route or way there from its
 * start, geographic, its first point the start and its last the street
 * point, its length `m` and what the height is carried from (`start`,
 * ApproachStart); on a stretch under another way the portals either side
 * (StreetUnder, underpass.ts); null elsewhere. The yellow overlay knows
 * approaches off bridge ends only, `__routes.describe()` the leg to the HQ
 * as well.
 */
export type StreetSurface = 'bridge' | StreetApproach | StreetUnder;

/** A street point on an approach, geographic, see StreetSurface. */
export interface StreetApproach {
  path: readonly { lat: number; lon: number }[];
  m: number;
  start: ApproachStart;
}

/** A node of the street network on the stretch off a bridge end. */
export interface StreetDeckApproach {
  /** The nodes from the end node of the bridge way to this one. */
  path: readonly StreetNode[];
  /** Along them, metres. */
  distanceM: number;
}

/**
 * The nodes of `streets` on a stretch off the end of a bridge way, by node
 * id: from both end nodes of every way with `bridge=*`, along the ways
 * without, whichever way they turn, as long as they are no tunnel and the
 * node lies within DECK_APPROACH_M. A node several stretches reach belongs
 * to the nearest bridge end. The end nodes themselves are in it at 0 m, as
 * the first node of the way off the bridge.
 *
 * The same stretch as routeApproaches along a route over those ways, except
 * where a route leaves a bridge way at one of its middle nodes: the route
 * carries the deck on there, the street network does not.
 */
export function streetDeckApproaches(streets: readonly Street[]): Map<number, StreetDeckApproach> {
  const places = new Map<number, { street: Street; index: number }[]>();
  for (const street of streets) {
    street.nodes.forEach((node, index) => {
      const list = places.get(node.id);
      if (list) list.push({ street, index });
      else places.set(node.id, [{ street, index }]);
    });
  }

  const found = new Map<number, StreetDeckApproach>();
  const open: StreetDeckApproach[] = [];
  const reach = (path: readonly StreetNode[], distanceM: number) => {
    const node = path[path.length - 1];
    const known = found.get(node.id);
    if (known && known.distanceM <= distanceM) return;
    const approach = { path, distanceM };
    found.set(node.id, approach);
    open.push(approach);
  };

  for (const street of streets) {
    const nodes = street.nodes;
    if (street.bridge === undefined || nodes.length < 2) continue;
    reach([nodes[0]], 0);
    reach([nodes[nodes.length - 1]], 0);
  }

  while (open.length > 0) {
    const approach = open.pop()!;
    const node = approach.path[approach.path.length - 1];
    // Reached again from a nearer bridge end since.
    if (found.get(node.id) !== approach) continue;
    for (const { street, index } of places.get(node.id) ?? []) {
      if (street.bridge !== undefined || runsUnderCover(street)) continue;
      for (const next of [street.nodes[index - 1], street.nodes[index + 1]]) {
        if (next === undefined) continue;
        const edge = offsetM(node, next);
        const distance = approach.distanceM + Math.hypot(edge.x, edge.z);
        if (distance <= DECK_APPROACH_M) reach([...approach.path, next], distance);
      }
    }
  }
  return found;
}

/** Metres east and north from `a` to `b`, flat around `a`. */
function offsetM(a: StreetNode, b: StreetNode): { x: number; z: number } {
  return {
    x: (b.lon - a.lon) * METERS_PER_DEGREE_LAT * Math.cos(a.lat * DEG_TO_RAD),
    z: (b.lat - a.lat) * METERS_PER_DEGREE_LAT,
  };
}
