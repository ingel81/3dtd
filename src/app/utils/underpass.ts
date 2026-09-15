import type { Street } from '../interfaces/street-network-provider.interface';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from './geo-utils';
import { estimateStreetWidth, runsUnderCover } from './route-corridor';
import { TUNNEL_PORTAL_OFFSET_M } from './route-grid-builder';

/**
 * Where a route or a street runs under another way: a bridge over it, or a
 * way OSM puts on a higher layer.
 *
 * A cell takes the lowest hit of its column (RouteCellSampler). Under a deck
 * whose underside the photogrammetry has filled down to the ground, that is
 * the deck. Playtest 2026-09-15, Erlenbach (D2): the route on Weinsberger
 * Straße (way 230161781, secondary, no layer) passes under the two
 * carriageways of the A6 (ways 15258911 and 15258913, motorway,
 * `bridge=yes layer=1`, 3 lanes), which cross it at 85 degrees 16 m apart.
 * The column at the click had one hit, on the deck at 220.67 m; two columns
 * beside it saw the street 5.6 and 5.9 m under the deck. Cells, the red line
 * and the enemies stood on the deck.
 *
 * So such a stretch is a short tunnel: PathAndRouteService cuts the route
 * where it begins and ends (splitAtSpans) and marks the piece `inTunnel`.
 * Its cells take their height between portals on the street either side
 * (tunnelColumn in route-cell-sampler.ts), it is not measured, and it keeps
 * the street's OSM width. The yellow street overlay takes the same
 * stretches along each street (streetUnderpasses).
 */

interface LatLon {
  lat: number;
  lon: number;
}

/**
 * How far past half the OSM width of the way above a stretch reaches on
 * either side, metres. A motorway carriageway of 3 lanes is 10 m by its
 * lanes tag (estimateStreetWidth); with a hard shoulder and the edges of
 * the deck the structure is about 16 m wide. The portals lie
 * TUNNEL_PORTAL_OFFSET_M further out.
 */
export const DECK_EDGE_MARGIN_M = 4;

/**
 * Stretches closer than this along the route are one, metres: the two
 * carriageways of a motorway on decks of their own, whose gap may be filled
 * as well, and a portal between them could come down on either deck.
 */
export const UNDERPASS_JOIN_M = 10;

/**
 * The longest stretch one crossing gives, metres. A way over the route at a
 * shallow angle covers it for its reach divided by the sine of the angle.
 */
export const UNDERPASS_MAX_M = 80;

/** A cut this close to a point of the path is left out, metres (splitAtSpans). */
const SNAP_M = 1;

/** How high a way lies by its OSM tags: `layer`, else 1 on a bridge, else 0. */
export function wayLevel(way: Pick<Street, 'layer' | 'bridge'>): number {
  return way.layer ?? (way.bridge !== undefined ? 1 : 0);
}

/** A stretch of a path under another way, metres along the path, and the way above it (the first where several join). */
export interface UnderpassSpan {
  from: number;
  to: number;
  wayId: number;
}

/** A way above ground level as UnderpassIndex looks for it. */
interface RaisedWay {
  street: Street;
  level: number;
  /** Half its OSM width plus DECK_EDGE_MARGIN_M: how far the structure reaches either side of its line. */
  reach: number;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/** Metres east and north from `origin` to `p`, flat with the longitude scale `kx` at the origin. */
function offsetM(origin: LatLon, p: LatLon, kx: number): { x: number; z: number } {
  return { x: (p.lon - origin.lon) * kx, z: (p.lat - origin.lat) * METERS_PER_DEGREE_LAT };
}

/** Longitude scale around `p`, metres per degree. */
function lonScale(p: LatLon): number {
  return METERS_PER_DEGREE_LAT * Math.cos(p.lat * DEG_TO_RAD);
}

/** Length of the edge `a`-`b`, metres, flat around `a`: the one measure spans and cuts share. */
function edgeLengthM(a: LatLon, b: LatLon): number {
  const { x, z } = offsetM(a, b, lonScale(a));
  return Math.hypot(x, z);
}

/** Whether `p` is a node of `street`: the path meets the way there instead of passing under it. */
function isNodeOf(street: Street, p: LatLon): boolean {
  return street.nodes.some((node) => node.lat === p.lat && node.lon === p.lon);
}

/**
 * The ways of a street network that another way can run under, for
 * looking up where a path crosses under them (spans).
 */
export class UnderpassIndex {
  private readonly ways: RaisedWay[] = [];

  constructor(streets: readonly Street[]) {
    for (const street of streets) {
      if (street.nodes.length < 2) continue;
      let minLat = Infinity;
      let maxLat = -Infinity;
      let minLon = Infinity;
      let maxLon = -Infinity;
      for (const node of street.nodes) {
        minLat = Math.min(minLat, node.lat);
        maxLat = Math.max(maxLat, node.lat);
        minLon = Math.min(minLon, node.lon);
        maxLon = Math.max(maxLon, node.lon);
      }
      const reach = estimateStreetWidth(street).widthM / 2 + DECK_EDGE_MARGIN_M;
      this.ways.push({ street, level: wayLevel(street), reach, minLat, maxLat, minLon, maxLon });
    }
  }

  /**
   * The stretches of `path` under another way, joined where they lie within
   * UNDERPASS_JOIN_M of each other and cut to the path. `ways[i]` is the way
   * segment `i` runs on (null off the network, level 0), `open[i]` whether
   * it can pass under anything at all: not a bridge, not already a tunnel.
   *
   * A segment passes under a way that crosses it on a higher level
   * (wayLevel), other than its own and not at a node the two share (a
   * junction). The stretch reaches the way's `reach` either side of the
   * crossing, divided by the sine of the angle between the two, at most
   * UNDERPASS_MAX_M in all.
   */
  spans(path: readonly LatLon[], ways: readonly (Street | null)[], open: readonly boolean[]): UnderpassSpan[] {
    const found: UnderpassSpan[] = [];
    let along = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const length = edgeLengthM(a, b);
      if (open[i] && length > 0) this.crossings(a, b, length, along, ways[i], found);
      along += length;
    }
    return joinSpans(found, along);
  }

  /** The crossings of the segment `a`-`b` (`length` m, starting `along` m into the path) under the raised ways, into `found`. */
  private crossings(a: LatLon, b: LatLon, length: number, along: number, own: Street | null, found: UnderpassSpan[]): void {
    const level = own ? wayLevel(own) : 0;
    const kx = lonScale(a);
    const { x: dx, z: dz } = offsetM(a, b, kx);
    const minLat = Math.min(a.lat, b.lat);
    const maxLat = Math.max(a.lat, b.lat);
    const minLon = Math.min(a.lon, b.lon);
    const maxLon = Math.max(a.lon, b.lon);
    for (const raised of this.ways) {
      if (raised.level <= level || raised.street.id === own?.id) continue;
      if (raised.maxLat < minLat || raised.minLat > maxLat || raised.maxLon < minLon || raised.minLon > maxLon) continue;
      const nodes = raised.street.nodes;
      for (let k = 0; k < nodes.length - 1; k++) {
        const p = offsetM(a, nodes[k], kx);
        const q = offsetM(a, nodes[k + 1], kx);
        const ex = q.x - p.x;
        const ez = q.z - p.z;
        // a + t (b - a) = p + u (q - p)
        const den = dx * ez - dz * ex;
        if (den === 0) continue;
        const t = (p.x * ez - p.z * ex) / den;
        const u = (p.x * dz - p.z * dx) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        if ((t < 1e-9 && isNodeOf(raised.street, a)) || (t > 1 - 1e-9 && isNodeOf(raised.street, b))) continue;
        const sine = Math.abs(den) / (length * Math.hypot(ex, ez));
        const half = Math.min(UNDERPASS_MAX_M / 2, raised.reach / Math.max(sine, 1e-6));
        const at = along + t * length;
        found.push({ from: at - half, to: at + half, wayId: raised.street.id });
      }
    }
  }
}

/** `spans` in order along the path, joined within UNDERPASS_JOIN_M, cut to [0, `total`]. */
function joinSpans(spans: UnderpassSpan[], total: number): UnderpassSpan[] {
  spans.sort((p, q) => p.from - q.from);
  const joined: UnderpassSpan[] = [];
  for (const span of spans) {
    const last = joined[joined.length - 1];
    if (last && span.from <= last.to + UNDERPASS_JOIN_M) last.to = Math.max(last.to, span.to);
    else joined.push({ ...span });
  }
  for (const span of joined) {
    span.from = Math.max(0, span.from);
    span.to = Math.min(total, span.to);
  }
  return joined;
}

/** The path cut where the stretches under a way begin and end, see splitAtSpans. */
export interface SplitPath<T extends LatLon> {
  points: T[];
  /** Per piece, the segment of the old path it lies on. */
  segment: number[];
  /** Per piece, the way above it; null outside the stretches and on segments that cannot pass under anything. */
  under: (number | null)[];
}

/**
 * `path` cut where `spans` (UnderpassIndex.spans) begin and end. A cut
 * within SNAP_M of a point of the path is left out, the middle of each piece
 * decides whether it lies under a way. Pieces of a segment that is not
 * `open` (a bridge, a tunnel) stay as they are.
 */
export function splitAtSpans<T extends LatLon>(
  path: readonly T[],
  spans: readonly UnderpassSpan[],
  open: readonly boolean[],
  interpolate: (a: T, b: T, f: number) => T,
): SplitPath<T> {
  const segments = path.length - 1;
  if (spans.length === 0 || segments < 1) {
    return { points: [...path], segment: Array.from({ length: Math.max(0, segments) }, (_, i) => i), under: new Array(Math.max(0, segments)).fill(null) };
  }
  const points: T[] = [];
  const segment: number[] = [];
  const under: (number | null)[] = [];
  const spanAt = (m: number) => spans.find((span) => span.from <= m && m <= span.to) ?? null;
  let start = 0;
  for (let i = 0; i < segments; i++) {
    const a = path[i];
    const b = path[i + 1];
    const length = edgeLengthM(a, b);
    const end = start + length;
    const cuts = [start];
    for (const span of spans) {
      for (const m of [span.from, span.to]) {
        if (m > start + SNAP_M && m < end - SNAP_M && !cuts.includes(m)) cuts.push(m);
      }
    }
    cuts.sort((p, q) => p - q);
    cuts.push(end);
    for (let c = 0; c < cuts.length - 1; c++) {
      points.push(c === 0 ? a : interpolate(a, b, (cuts[c] - start) / length));
      segment.push(i);
      under.push(open[i] ? spanAt((cuts[c] + cuts[c + 1]) / 2)?.wayId ?? null : null);
    }
    start = end;
  }
  points.push(path[segments]);
  return { points, segment, under };
}

/** The point `m` metres along `path`, straight on past either end along its first or last edge. */
export function pointAlong(path: readonly LatLon[], m: number): LatLon {
  let start = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const length = edgeLengthM(path[i], path[i + 1]);
    const last = i === path.length - 2;
    if ((m <= start + length || last) && (m >= start || i === 0) && length > 0) {
      const f = (m - start) / length;
      return { lat: path[i].lat + (path[i + 1].lat - path[i].lat) * f, lon: path[i].lon + (path[i + 1].lon - path[i].lon) * f };
    }
    start += length;
  }
  return { lat: path[0].lat, lon: path[0].lon };
}

/**
 * A point of a street on a stretch under another way, as the yellow street
 * overlay takes its height (TerrainQueries.getStreetHeightEstimate): the
 * ground between the two portals, TUNNEL_PORTAL_OFFSET_M outside the ends
 * of the stretch along the street, `f` of the way from the first; the way
 * above in `wayId`.
 */
export interface StreetUnder {
  portals: readonly [LatLon, LatLon];
  f: number;
  wayId: number;
}

/**
 * The nodes of `streets` on a stretch under another way, per street id and
 * node index (null for a node outside one), for the streets with such a
 * node: the same stretches as a route over the street gets
 * (UnderpassIndex.spans), with the portals of a tunnel stretch there
 * (tunnelSegments in route-grid-builder.ts). Bridges and tunnels have none.
 * Only nodes: where a stretch holds no node, the overlay runs straight from
 * the node before it to the one after.
 */
export function streetUnderpasses(streets: readonly Street[]): Map<number, (StreetUnder | null)[]> {
  const index = new UnderpassIndex(streets);
  const found = new Map<number, (StreetUnder | null)[]>();
  for (const street of streets) {
    const nodes = street.nodes;
    if (street.bridge !== undefined || runsUnderCover(street) || nodes.length < 2) continue;
    const edges = nodes.length - 1;
    const spans = index.spans(nodes, new Array<Street>(edges).fill(street), new Array<boolean>(edges).fill(true));
    if (spans.length === 0) continue;
    let along = 0;
    const under = nodes.map((node, k): StreetUnder | null => {
      if (k > 0) along += edgeLengthM(nodes[k - 1], node);
      const span = spans.find((s) => s.from <= along && along <= s.to);
      if (!span) return null;
      const from = span.from - TUNNEL_PORTAL_OFFSET_M;
      const to = span.to + TUNNEL_PORTAL_OFFSET_M;
      return { portals: [pointAlong(nodes, from), pointAlong(nodes, to)], f: (along - from) / (to - from), wayId: span.wayId };
    });
    if (under.some((u) => u !== null)) found.set(street.id, under);
  }
  return found;
}
