/**
 * Route graph: the enemy routes as one walkable network, for the hero
 * (docs/HERO.md, PLAYER_AGENCY_CONCEPT.md 3.2, "Stufe 1").
 *
 * The routes arrive as one polyline per spawn point. Where two of them share
 * a street they share its waypoints, up to rounding; waypoints closer than
 * MERGE_RADIUS_M become one node. A waypoint that lies on another route's
 * segment without being one of its ends (a route joining another between two
 * of its waypoints) splits that segment, so the join is a junction too.
 *
 * Positions are metres on a flat projection around the first waypoint
 * (east-north, longitude scaled by cos of the origin latitude), the same
 * approximation the combat code uses at these distances.
 *
 * Deterministic: routes are read in the order of their keys, never in the
 * map's insertion order, every loop runs in index order, and ties go to the
 * lower index. The same routes give the same graph, and the same query the
 * same path, which the command pipeline and a replay rely on.
 */

import type { GeoPosition } from '../models/game.types';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from './geo-utils';

/** Waypoints closer than this are one node, metres. */
export const MERGE_RADIUS_M = 1.5;

/** Bucket size of the segment index used for the junction split, metres. */
const JUNCTION_BUCKET_M = 16;

export interface RouteGraphNode {
  /** East of the origin, metres */
  readonly x: number;
  /** North of the origin, metres */
  readonly z: number;
  readonly lat: number;
  readonly lon: number;
}

export interface RouteGraphEdge {
  readonly a: number;
  readonly b: number;
  /** Metres */
  readonly length: number;
}

/** A point on the graph: on edge `edge`, at share `t` (0..1) of the way from its node a to its node b. */
export interface GraphPoint {
  readonly edge: number;
  readonly t: number;
}

/** A graph point with its distance from the position it was looked up for. */
export interface NearestGraphPoint extends GraphPoint {
  readonly distanceM: number;
}

export interface GraphPath {
  /** Metres along the graph */
  readonly length: number;
  /** From the start point through the nodes to the end point, consecutive duplicates removed */
  readonly points: GeoPosition[];
}

export class RouteGraph {
  private readonly cosLat0: number;

  private constructor(
    readonly nodes: readonly RouteGraphNode[],
    readonly edges: readonly RouteGraphEdge[],
    /** Edge indices per node, in ascending order */
    private readonly incident: readonly (readonly number[])[],
    private readonly lat0: number,
    private readonly lon0: number,
  ) {
    this.cosLat0 = Math.cos(lat0 * DEG_TO_RAD);
  }

  /** The graph of `routes`, keyed by spawn id. Empty routes give an empty graph. */
  static fromRoutes(routes: ReadonlyMap<string, readonly GeoPosition[]>): RouteGraph {
    const keys = [...routes.keys()].sort();
    const first = keys.map((k) => routes.get(k)!).find((r) => r.length > 0)?.[0];
    const lat0 = first?.lat ?? 0;
    const lon0 = first?.lon ?? 0;
    const cosLat0 = Math.cos(lat0 * DEG_TO_RAD);

    const nodes: RouteGraphNode[] = [];
    const nodeBuckets = new Map<string, number[]>();
    const nodeAt = (lat: number, lon: number): number => {
      const x = (lon - lon0) * METERS_PER_DEGREE_LAT * cosLat0;
      const z = (lat - lat0) * METERS_PER_DEGREE_LAT;
      const cx = Math.floor(x / MERGE_RADIUS_M);
      const cz = Math.floor(z / MERGE_RADIUS_M);
      let best = -1;
      let bestSq = MERGE_RADIUS_M * MERGE_RADIUS_M;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (const i of nodeBuckets.get(`${cx + dx},${cz + dz}`) ?? []) {
            const d = (nodes[i].x - x) ** 2 + (nodes[i].z - z) ** 2;
            if (d < bestSq || (d === bestSq && i < best)) {
              best = i;
              bestSq = d;
            }
          }
        }
      }
      if (best >= 0) return best;
      const index = nodes.length;
      nodes.push({ x, z, lat, lon });
      const key = `${cx},${cz}`;
      const bucket = nodeBuckets.get(key);
      if (bucket) bucket.push(index);
      else nodeBuckets.set(key, [index]);
      return index;
    };

    // Segments in route order, each pair once
    const pairs: [number, number][] = [];
    const seen = new Set<string>();
    for (const key of keys) {
      let prev = -1;
      for (const wp of routes.get(key)!) {
        const node = nodeAt(wp.lat, wp.lon);
        if (prev >= 0 && node !== prev) {
          const id = prev < node ? `${prev},${node}` : `${node},${prev}`;
          if (!seen.has(id)) {
            seen.add(id);
            pairs.push([prev, node]);
          }
        }
        prev = node;
      }
    }

    const split = splitAtJunctions(nodes, pairs);

    const edges: RouteGraphEdge[] = [];
    const edgeIds = new Set<string>();
    for (const [a, b] of split) {
      if (a === b) continue;
      const id = a < b ? `${a},${b}` : `${b},${a}`;
      if (edgeIds.has(id)) continue;
      edgeIds.add(id);
      const length = Math.hypot(nodes[b].x - nodes[a].x, nodes[b].z - nodes[a].z);
      edges.push({ a, b, length });
    }

    const incident: number[][] = nodes.map(() => []);
    edges.forEach((e, i) => {
      incident[e.a].push(i);
      incident[e.b].push(i);
    });

    return new RouteGraph(nodes, edges, incident, lat0, lon0);
  }

  get isEmpty(): boolean {
    return this.edges.length === 0;
  }

  /**
   * The graph point nearest to (lat, lon), 2D, or null when the graph is
   * empty or nothing lies within `maxDistanceM`. Ties go to the lower edge.
   */
  nearestPoint(lat: number, lon: number, maxDistanceM = Infinity): NearestGraphPoint | null {
    const px = this.x(lon);
    const pz = this.z(lat);
    let bestEdge = -1;
    let bestT = 0;
    let bestSq = Infinity;
    for (let i = 0; i < this.edges.length; i++) {
      const t = this.projectT(i, px, pz);
      const { x, z } = this.local({ edge: i, t });
      const d = (x - px) ** 2 + (z - pz) ** 2;
      if (d < bestSq) {
        bestSq = d;
        bestEdge = i;
        bestT = t;
      }
    }
    if (bestEdge < 0) return null;
    const distanceM = Math.sqrt(bestSq);
    if (distanceM > maxDistanceM) return null;
    return { edge: bestEdge, t: bestT, distanceM };
  }

  /** Geo position of a graph point, interpolated linearly like MovementComponent. */
  pointGeo(p: GraphPoint): GeoPosition {
    const e = this.edges[p.edge];
    const a = this.nodes[e.a];
    const b = this.nodes[e.b];
    return { lat: a.lat + (b.lat - a.lat) * p.t, lon: a.lon + (b.lon - a.lon) * p.t };
  }

  /** Straight-line distance between two graph points, 2D, metres. */
  straightDistance(p: GraphPoint, q: GraphPoint): number {
    const a = this.local(p);
    const b = this.local(q);
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  /**
   * Shortest walk along the graph from `from` to `to` (Dijkstra), or null
   * when they lie in parts of the graph that do not connect.
   */
  shortestPath(from: GraphPoint, to: GraphPoint): GraphPath | null {
    const fromEdge = this.edges[from.edge];
    const toEdge = this.edges[to.edge];

    // Both on one edge: straight along it, unless a detour through the nodes is shorter (never on a simple edge)
    let direct = Infinity;
    if (from.edge === to.edge) direct = Math.abs(to.t - from.t) * fromEdge.length;

    const search = this.dijkstra(
      [
        { node: fromEdge.a, cost: from.t * fromEdge.length },
        { node: fromEdge.b, cost: (1 - from.t) * fromEdge.length },
      ],
      (dist) => dist >= direct,
      [
        { node: toEdge.a, extra: to.t * toEdge.length },
        { node: toEdge.b, extra: (1 - to.t) * toEdge.length },
      ],
    );

    const start = this.pointGeo(from);
    const end = this.pointGeo(to);
    if (from.edge === to.edge && direct <= search.bestTotal) {
      return { length: direct, points: dedupe([start, end]) };
    }
    if (search.bestNode < 0) return null;

    const chain: number[] = [];
    for (let n = search.bestNode; n >= 0; n = search.prev[n]) chain.push(n);
    chain.reverse();
    const points = [start, ...chain.map((n) => ({ lat: this.nodes[n].lat, lon: this.nodes[n].lon })), end];
    return { length: search.bestTotal, points: dedupe(points) };
  }

  /**
   * The point within `reachM` of `anchor`, measured along the graph, that
   * lies nearest (2D) to (lat, lon). How far the hero may chase on his leash.
   */
  closestWithinReach(anchor: GraphPoint, reachM: number, lat: number, lon: number): GraphPoint {
    const anchorEdge = this.edges[anchor.edge];
    const search = this.dijkstra(
      [
        { node: anchorEdge.a, cost: anchor.t * anchorEdge.length },
        { node: anchorEdge.b, cost: (1 - anchor.t) * anchorEdge.length },
      ],
      (dist) => dist > reachM,
    );
    const dist = search.dist;

    // Edges with a reached end, and the anchor's own, in ascending order
    const candidates = new Set<number>([anchor.edge]);
    for (let n = 0; n < this.nodes.length; n++) {
      if (dist[n] <= reachM) for (const e of this.incident[n]) candidates.add(e);
    }
    const ordered = [...candidates].sort((p, q) => p - q);

    const px = this.x(lon);
    const pz = this.z(lat);
    let best: GraphPoint = anchor;
    let bestSq = Infinity;
    for (const edge of ordered) {
      const e = this.edges[edge];
      const len = e.length;
      // Reachable intervals of t on this edge
      const intervals: [number, number][] = [];
      if (dist[e.a] <= reachM) intervals.push([0, Math.min(1, (reachM - dist[e.a]) / len)]);
      if (dist[e.b] <= reachM) intervals.push([Math.max(0, 1 - (reachM - dist[e.b]) / len), 1]);
      if (edge === anchor.edge) {
        intervals.push([Math.max(0, anchor.t - reachM / len), Math.min(1, anchor.t + reachM / len)]);
      }
      const want = this.projectT(edge, px, pz);
      for (const [lo, hi] of intervals) {
        const t = Math.min(hi, Math.max(lo, want));
        const { x, z } = this.local({ edge, t });
        const d = (x - px) ** 2 + (z - pz) ** 2;
        if (d < bestSq) {
          bestSq = d;
          best = { edge, t };
        }
      }
    }
    return best;
  }

  // ==================== Internals ====================

  private x(lon: number): number {
    return (lon - this.lon0) * METERS_PER_DEGREE_LAT * this.cosLat0;
  }

  private z(lat: number): number {
    return (lat - this.lat0) * METERS_PER_DEGREE_LAT;
  }

  private local(p: GraphPoint): { x: number; z: number } {
    const e = this.edges[p.edge];
    const a = this.nodes[e.a];
    const b = this.nodes[e.b];
    return { x: a.x + (b.x - a.x) * p.t, z: a.z + (b.z - a.z) * p.t };
  }

  /** Share of edge `edge` nearest to the local point, clamped to the edge. */
  private projectT(edge: number, px: number, pz: number): number {
    const e = this.edges[edge];
    const a = this.nodes[e.a];
    const b = this.nodes[e.b];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lenSq = dx * dx + dz * dz;
    if (lenSq === 0) return 0;
    return Math.min(1, Math.max(0, ((px - a.x) * dx + (pz - a.z) * dz) / lenSq));
  }

  /**
   * Dijkstra from seeded nodes. Stops once the nearest open node satisfies
   * `stop`, or can no longer improve on the best target. Ties in the queue go
   * to the lower node index, so equal routes always resolve the same way.
   */
  private dijkstra(
    seeds: { node: number; cost: number }[],
    stop: (dist: number) => boolean,
    targets: { node: number; extra: number }[] = [],
  ): { dist: Float64Array; prev: Int32Array; bestNode: number; bestTotal: number } {
    const n = this.nodes.length;
    const dist = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    const heap = new MinHeap();
    for (const { node, cost } of seeds) {
      if (cost < dist[node]) {
        dist[node] = cost;
        heap.push(cost, node);
      }
    }

    const extra = new Map<number, number>();
    for (const { node, extra: e } of targets) {
      extra.set(node, Math.min(extra.get(node) ?? Infinity, e));
    }
    let bestNode = -1;
    let bestTotal = Infinity;

    while (heap.size > 0) {
      const [d, u] = heap.pop();
      if (done[u] || d > dist[u]) continue;
      if (stop(d) || d >= bestTotal) break;
      done[u] = 1;
      const e = extra.get(u);
      if (e !== undefined && d + e < bestTotal) {
        bestTotal = d + e;
        bestNode = u;
      }
      for (const edgeIndex of this.incident[u]) {
        const edge = this.edges[edgeIndex];
        const v = edge.a === u ? edge.b : edge.a;
        const nd = d + edge.length;
        if (nd < dist[v] || (nd === dist[v] && !done[v] && u < prev[v])) {
          dist[v] = nd;
          prev[v] = u;
          heap.push(nd, v);
        }
      }
    }
    return { dist, prev, bestNode, bestTotal };
  }
}

/**
 * Split every segment that another route's waypoint lies on (within
 * MERGE_RADIUS_M, away from its ends), so a route joining another between
 * two of its waypoints meets it in a node. Returns the segments, split ones
 * replaced by their pieces, in the original order.
 */
function splitAtJunctions(nodes: readonly RouteGraphNode[], pairs: readonly [number, number][]): [number, number][] {
  const buckets = new Map<string, number[]>();
  pairs.forEach(([a, b], i) => {
    const pa = nodes[a];
    const pb = nodes[b];
    const x0 = Math.floor((Math.min(pa.x, pb.x) - MERGE_RADIUS_M) / JUNCTION_BUCKET_M);
    const x1 = Math.floor((Math.max(pa.x, pb.x) + MERGE_RADIUS_M) / JUNCTION_BUCKET_M);
    const z0 = Math.floor((Math.min(pa.z, pb.z) - MERGE_RADIUS_M) / JUNCTION_BUCKET_M);
    const z1 = Math.floor((Math.max(pa.z, pb.z) + MERGE_RADIUS_M) / JUNCTION_BUCKET_M);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const key = `${cx},${cz}`;
        const bucket = buckets.get(key);
        if (bucket) bucket.push(i);
        else buckets.set(key, [i]);
      }
    }
  });

  const cuts: { t: number; node: number }[][] = pairs.map(() => []);
  nodes.forEach((p, node) => {
    const key = `${Math.floor(p.x / JUNCTION_BUCKET_M)},${Math.floor(p.z / JUNCTION_BUCKET_M)}`;
    for (const i of buckets.get(key) ?? []) {
      const [a, b] = pairs[i];
      if (node === a || node === b) continue;
      const pa = nodes[a];
      const pb = nodes[b];
      const dx = pb.x - pa.x;
      const dz = pb.z - pa.z;
      const lenSq = dx * dx + dz * dz;
      if (lenSq === 0) continue;
      const t = ((p.x - pa.x) * dx + (p.z - pa.z) * dz) / lenSq;
      if (t <= 0 || t >= 1) continue;
      const d = Math.hypot(pa.x + dx * t - p.x, pa.z + dz * t - p.z);
      if (d < MERGE_RADIUS_M && !cuts[i].some((c) => c.node === node)) cuts[i].push({ t, node });
    }
  });

  const out: [number, number][] = [];
  pairs.forEach(([a, b], i) => {
    const list = cuts[i].sort((p, q) => p.t - q.t || p.node - q.node);
    let from = a;
    for (const { node } of list) {
      out.push([from, node]);
      from = node;
    }
    out.push([from, b]);
  });
  return out;
}

function dedupe(points: GeoPosition[]): GeoPosition[] {
  const out: GeoPosition[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last.lat !== p.lat || last.lon !== p.lon) out.push(p);
  }
  return out;
}

/** Binary min-heap of (key, value), ties broken by the smaller value. */
class MinHeap {
  private readonly keys: number[] = [];
  private readonly values: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, value: number): void {
    this.keys.push(key);
    this.values.push(value);
    let i = this.keys.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): [number, number] {
    const top: [number, number] = [this.keys[0], this.values[0]];
    const lastKey = this.keys.pop()!;
    const lastValue = this.values.pop()!;
    if (this.keys.length > 0) {
      this.keys[0] = lastKey;
      this.values[0] = lastValue;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.keys.length && this.less(l, m)) m = l;
        if (r < this.keys.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private less(i: number, j: number): boolean {
    return this.keys[i] < this.keys[j] || (this.keys[i] === this.keys[j] && this.values[i] < this.values[j]);
  }

  private swap(i: number, j: number): void {
    [this.keys[i], this.keys[j]] = [this.keys[j], this.keys[i]];
    [this.values[i], this.values[j]] = [this.values[j], this.values[i]];
  }
}
