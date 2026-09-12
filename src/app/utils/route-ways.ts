import { Street, StreetNode } from '../interfaces/street-network-provider.interface';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from './geo-utils';

/** A route point lies on a street edge if it is closer than this, metres. */
const ON_EDGE_TOLERANCE_M = 0.5;

interface StreetEdge {
  street: Street;
  a: StreetNode;
  b: StreetNode;
}

interface LatLon {
  lat: number;
  lon: number;
}

const pointKey = (p: LatLon) => `${p.lat},${p.lon}`;
const edgeKey = (a: LatLon, b: LatLon) => `${pointKey(a)}|${pointKey(b)}`;

/** Distance from `p` to the segment `a`-`b` in metres, flat-earth around the segment. */
function distanceToEdgeM(p: LatLon, a: LatLon, b: LatLon): number {
  const lonScale = Math.cos((a.lat + b.lat) * 0.5 * DEG_TO_RAD);
  const dx = (b.lon - a.lon) * lonScale;
  const dz = b.lat - a.lat;
  const px = (p.lon - a.lon) * lonScale;
  const pz = p.lat - a.lat;
  const lenSq = dx * dx + dz * dz;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + pz * dz) / lenSq));
  return Math.hypot(px - t * dx, pz - t * dz) * METERS_PER_DEGREE_LAT;
}

function liesOn(a: LatLon, b: LatLon, edge: StreetEdge): boolean {
  return distanceToEdgeM(a, edge.a, edge.b) < ON_EDGE_TOLERANCE_M
    && distanceToEdgeM(b, edge.a, edge.b) < ON_EDGE_TOLERANCE_M;
}

/**
 * Finds the street each segment of a route runs over.
 *
 * Real-world routes copy lat/lon unchanged from the street nodes, so almost
 * every segment is an exact edge of a way. The rest lie on an edge without
 * sharing its nodes: the piece up to the turn-off towards the HQ, pieces of
 * a split segment and the whole DevWorld route, whose nodes are graph nodes
 * and 2 m subdivisions. Those are matched geometrically, first against the
 * edge of the previous segment, then against all of them.
 */
export class StreetEdgeIndex {
  private readonly edges = new Map<string, StreetEdge>();
  private readonly all: StreetEdge[] = [];

  constructor(streets: readonly Street[]) {
    for (const street of streets) {
      for (let i = 0; i < street.nodes.length - 1; i++) {
        const edge = { street, a: street.nodes[i], b: street.nodes[i + 1] };
        this.all.push(edge);
        this.edges.set(edgeKey(edge.a, edge.b), edge);
        this.edges.set(edgeKey(edge.b, edge.a), edge);
      }
    }
  }

  /** The street under each segment `i` (`path[i]` to `path[i + 1]`), `null` off the network. */
  match(path: readonly LatLon[]): (Street | null)[] {
    const result: (Street | null)[] = [];
    let previous: StreetEdge | null = null;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      let edge = this.edges.get(edgeKey(a, b)) ?? null;
      if (!edge && previous && liesOn(a, b, previous)) edge = previous;
      if (!edge) edge = this.all.find((candidate) => liesOn(a, b, candidate)) ?? null;
      result.push(edge?.street ?? null);
      previous = edge;
    }
    return result;
  }
}
