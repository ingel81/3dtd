import type { ColumnSample } from '../three-engine/column-sample';
import type { RouteCell } from './route-cell';
import type { Street, StreetNode } from '../interfaces/street-network-provider.interface';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from './geo-utils';
import { runsUnderCover } from './route-corridor';

/**
 * Where a bridge deck carries on past the end of its OSM bridge way.
 *
 * A route over a way with `bridge=*` stands on the deck, the top of the
 * column (RouteCellSampler); every other way on the lowest hit. The
 * structure of a bridge can reach past the end of its bridge way, and the
 * short ways that continue it there carry no bridge tag. Playtest
 * 2026-09-14, Paris, Pont d'Iéna: ways of 7 and 2 m at one head, 31 m at
 * the other, over a quay 8 to 9.5 m below the deck; their cells, the red
 * line and the enemies dropped to the quay, the yellow street overlay ran
 * on the quay and the river.
 *
 * So a way that continues a bridge keeps its deck for up to DECK_APPROACH_M
 * from the end of the bridge way, but only where the top of the column
 * there lies within DECK_APPROACH_RISE_M of the top of the column at the
 * bridge end (continuesDeck). Elsewhere, and past that distance, it keeps
 * the lowest hit like any other way. "Continues": straight on, turning at
 * most DECK_APPROACH_TURN_DEG at each joint (continuesBridge), and not into
 * a tunnel. Stairs down to a quay road under the bridge, or a quay road at
 * grade, turn off and stay on their ground.
 *
 * Route cells find the stretch along their route (deckApproaches), the
 * yellow street overlay along the street network (streetDeckApproaches);
 * cells, the centre line ground, the corridor walk check and the overlay
 * take their heights by the same rule (surfaceY, deckApproachY,
 * continuesDeck).
 */

/**
 * How far past the end of a bridge way its deck may carry on, metres along
 * the ways. The ways off the Paris heads are 7 plus 2 m and 31 m long.
 */
export const DECK_APPROACH_M = 40;

/**
 * How far the top of a column may lie from the top at the bridge end and
 * still be the deck carried on, metres. Covers a deck grade of up to about
 * 4 % over DECK_APPROACH_M. Awnings, shelters, signs, lamps, statues and
 * tree crowns stand higher than that over a street at deck level, so a
 * column there keeps its ground.
 */
export const DECK_APPROACH_RISE_M = 1.5;

/** Largest turn at a joint for a way to continue a bridge, degrees. */
export const DECK_APPROACH_TURN_DEG = 45;

const COS_TURN = Math.cos(DECK_APPROACH_TURN_DEG * DEG_TO_RAD);

/** Whether a column top at `topY` carries on the deck whose top at the bridge end is `deckY`. */
export function continuesDeck(topY: number, deckY: number): boolean {
  return Math.abs(topY - deckY) <= DECK_APPROACH_RISE_M;
}

/**
 * The height `column` gives a point on a way off a bridge end whose deck
 * top there is `deckY`: the top where it carries on the deck, else the
 * lowest hit as on any other way.
 */
export function deckApproachY(column: ColumnSample, deckY: number): number {
  return continuesDeck(column.topY, deckY) ? column.topY : column.groundY;
}

/**
 * The height `column` gives a cell of `surface` (RouteCell.surface): the
 * lowest hit on the ground, the top on a deck, deckApproachY on the stretch
 * off a bridge end with `deckY` the top at its bridge end. Null for a
 * tunnel cell, which takes its height between the portals, and for an
 * approach cell without `deckY`. The one rule for the hit a cell stands on:
 * the cells (RouteCellSampler.hitOf), the centre line ground and the walk
 * out to a cell (corridor-walk.ts) read their columns through it.
 */
export function surfaceY(surface: RouteCell['surface'], column: ColumnSample, deckY: number | null): number | null {
  if (surface === 'ground') return column.groundY;
  if (surface === 'deck') return column.topY;
  if (surface === 'approach' && deckY !== null) return deckApproachY(column, deckY);
  return null;
}

/**
 * Whether a way leaving in direction (bx, bz) goes on from one arriving in
 * direction (ax, az): turning at most DECK_APPROACH_TURN_DEG. A zero-length
 * piece turns nowhere.
 */
export function continuesBridge(ax: number, az: number, bx: number, bz: number): boolean {
  const la = Math.hypot(ax, az);
  const lb = Math.hypot(bx, bz);
  if (la === 0 || lb === 0) return true;
  return (ax * bx + az * bz) / (la * lb) >= COS_TURN;
}

/**
 * A segment of a route on the stretch off a bridge end: `end` is the index
 * of the route point where the bridge ends, `from` and `to` the distance
 * along the route from there to the segment's start and to its end, metres.
 */
export interface DeckApproach {
  end: number;
  from: number;
  to: number;
}

/**
 * The stretches off each bridge end of a route, per segment (none, one, or
 * two between two bridges). `points` are the route's local positions,
 * `onBridge` and `inTunnel` the flags per segment. From every end of a run
 * of bridge segments the stretch runs on along the route while the route
 * continues the bridge (continuesBridge), is neither bridge nor tunnel, and
 * the segment starts within DECK_APPROACH_M.
 */
export function deckApproaches(
  points: readonly { x: number; z: number }[],
  onBridge: readonly boolean[],
  inTunnel: readonly boolean[],
): DeckApproach[][] {
  const segments = points.length - 1;
  const result: DeckApproach[][] = Array.from({ length: Math.max(0, segments) }, () => []);
  const open = (i: number) => i >= 0 && i < segments && !onBridge[i] && !inTunnel[i];

  // From the bridge end at point `end` along the route in `step`, starting
  // with segment `first`; (dx, dz) is the way of travel off the bridge.
  const walk = (first: number, step: 1 | -1, end: number, dx: number, dz: number) => {
    let distance = 0;
    for (let j = first; open(j) && distance < DECK_APPROACH_M; j += step) {
      const a = points[step > 0 ? j : j + 1];
      const b = points[step > 0 ? j + 1 : j];
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      if (!continuesBridge(dx, dz, ex, ez)) break;
      const length = Math.hypot(ex, ez);
      if (length > 0) {
        dx = ex;
        dz = ez;
      }
      result[j].push(step > 0 ? { end, from: distance, to: distance + length } : { end, from: distance + length, to: distance });
      distance += length;
    }
  };

  for (let i = 0; i < segments; i++) {
    if (!onBridge[i]) continue;
    const a = points[i];
    const b = points[i + 1];
    if (open(i + 1)) walk(i + 1, 1, i + 1, b.x - a.x, b.z - a.z);
    if (open(i - 1)) walk(i - 1, -1, i, a.x - b.x, a.z - b.z);
  }
  return result;
}

/**
 * The stretch among a segment's `approaches` whose bridge end is nearest
 * to the point `t` of the way along it (0 to 1), null where none lies
 * within DECK_APPROACH_M.
 */
export function nearestDeckApproach<T extends { from: number; to: number }>(approaches: readonly T[], t: number): T | null {
  let nearest: T | null = null;
  let nearestM = DECK_APPROACH_M;
  for (const approach of approaches) {
    const distance = approach.from + (approach.to - approach.from) * t;
    if (distance <= nearestM) {
      nearest = approach;
      nearestM = distance;
    }
  }
  return nearest;
}

/**
 * What a street point takes its height from (TerrainQueries.getStreetHeightEstimate):
 * `bridge` on a bridge way, the bridge end on a way off one, null elsewhere.
 */
export type StreetDeck = 'bridge' | { lat: number; lon: number };

/** A node of the street network on the stretch off a bridge end. */
export interface StreetDeckApproach {
  /** The end node of the bridge way. */
  deckEnd: StreetNode;
  /** Along the ways from there, metres. */
  distanceM: number;
}

/**
 * The nodes of `streets` on a stretch off the end of a bridge way, by node
 * id: from both end nodes of every way with `bridge=*`, along the ways
 * without, as long as they continue the bridge (continuesBridge), are no
 * tunnel and the node lies within DECK_APPROACH_M. A node several stretches
 * reach belongs to the nearest bridge end. The end nodes themselves are in
 * it at 0 m, as the first node of the way off the bridge.
 *
 * The same stretch as deckApproaches along a route over those ways, except
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
  const open: { node: StreetNode; dx: number; dz: number; distanceM: number; deckEnd: StreetNode }[] = [];
  const reach = (node: StreetNode, dx: number, dz: number, distanceM: number, deckEnd: StreetNode) => {
    const known = found.get(node.id);
    if (known && known.distanceM <= distanceM) return;
    found.set(node.id, { deckEnd, distanceM });
    open.push({ node, dx, dz, distanceM, deckEnd });
  };

  for (const street of streets) {
    const nodes = street.nodes;
    if (street.bridge === undefined || nodes.length < 2) continue;
    const last = nodes.length - 1;
    const first = offsetM(nodes[1], nodes[0]);
    reach(nodes[0], first.x, first.z, 0, nodes[0]);
    const end = offsetM(nodes[last - 1], nodes[last]);
    reach(nodes[last], end.x, end.z, 0, nodes[last]);
  }

  while (open.length > 0) {
    const { node, dx, dz, distanceM, deckEnd } = open.pop()!;
    // Reached again from a nearer bridge end since.
    if (found.get(node.id)!.distanceM < distanceM) continue;
    for (const { street, index } of places.get(node.id) ?? []) {
      if (street.bridge !== undefined || runsUnderCover(street)) continue;
      for (const next of [street.nodes[index - 1], street.nodes[index + 1]]) {
        if (next === undefined) continue;
        const edge = offsetM(node, next);
        if (!continuesBridge(dx, dz, edge.x, edge.z)) continue;
        const length = Math.hypot(edge.x, edge.z);
        const distance = distanceM + length;
        if (distance > DECK_APPROACH_M) continue;
        if (length > 0) reach(next, edge.x, edge.z, distance, deckEnd);
        else reach(next, dx, dz, distance, deckEnd);
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
