/**
 * The map's path network as a graph: nodes, edges with optional curve
 * points, and the operations the path tool needs (add, connect, split an
 * edge into a junction, delete, smooth) plus routing: the shortest way from
 * a spawn to the HQ along the edges, entering and leaving the network at
 * the nearest point. Everything here edits `MapPaths` in place; the tool
 * wraps it in a snapshot command.
 */
import { MinHeap } from '../../utils/street-astar';
import type {
  CustomMapDocument,
  MapPathEdge,
  MapPathKind,
  MapPathNode,
  MapPaths,
  MapPoint,
} from '../../world/custom-map/map-document';

export const DEFAULT_PATH_WIDTH = 8;

export function newId(prefix: string, taken: Iterable<{ id: string }>): string {
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`);
  for (const t of taken) {
    const m = re.exec(t.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

export function nodeById(paths: MapPaths, id: string): MapPathNode | undefined {
  return paths.nodes.find((n) => n.id === id);
}

/** The edge as a line: a, its curve points, b */
export function edgePolyline(paths: MapPaths, edge: MapPathEdge): MapPoint[] {
  const a = nodeById(paths, edge.a);
  const b = nodeById(paths, edge.b);
  if (!a || !b) return [];
  return [{ x: a.x, y: a.y }, ...(edge.via ?? []).map((p) => ({ x: p.x, y: p.y })), { x: b.x, y: b.y }];
}

export function polylineLength(points: readonly MapPoint[]): number {
  let n = 0;
  for (let k = 1; k < points.length; k++) n += Math.hypot(points[k].x - points[k - 1].x, points[k].y - points[k - 1].y);
  return n;
}

export function nearestNode(paths: MapPaths, p: MapPoint, maxDist = Infinity, except?: string): MapPathNode | null {
  let best: MapPathNode | null = null;
  let bestD = maxDist;
  for (const n of paths.nodes) {
    if (n.id === except) continue;
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    if (d <= bestD) {
      best = n;
      bestD = d;
    }
  }
  return best;
}

export interface EdgeHit {
  edge: MapPathEdge;
  point: MapPoint;
  dist: number;
  /** Segment of the polyline the point lies on */
  segment: number;
  /** Arc length from a to the point */
  along: number;
  length: number;
}

/** The nearest point on any edge */
export function nearestOnEdges(paths: MapPaths, p: MapPoint, maxDist = Infinity): EdgeHit | null {
  let best: EdgeHit | null = null;
  for (const edge of paths.edges) {
    const line = edgePolyline(paths, edge);
    const hit = nearestOnPolyline(line, p);
    if (hit && hit.dist <= maxDist && (!best || hit.dist < best.dist)) {
      best = { edge, ...hit, length: polylineLength(line) };
    }
  }
  return best;
}

export function nearestOnPolyline(
  line: readonly MapPoint[],
  p: MapPoint,
): { point: MapPoint; dist: number; segment: number; along: number } | null {
  if (line.length < 2) return null;
  let best: { point: MapPoint; dist: number; segment: number; along: number } | null = null;
  let walked = 0;
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1];
    const b = line[k];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const s = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    const q = { x: a.x + dx * s, y: a.y + dy * s };
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    const segLen = Math.sqrt(len2);
    if (!best || d < best.dist) best = { point: q, dist: d, segment: k - 1, along: walked + segLen * s };
    walked += segLen;
  }
  return best;
}

/** Side of the cells an EdgeIndex files the edges' segments in, metres */
const EDGE_CELL = 32;

/**
 * The edges of a path graph as lines, filed by segment in a grid of
 * EDGE_CELL cells: the nearest edge to a point is looked up in the cells
 * around it, ring by ring, instead of over every edge (an OSM world has ten
 * thousand). Built once for a graph that does not change while it is used
 * (a check, the routes of all spawns).
 */
export class EdgeIndex {
  private readonly lines = new Map<MapPathEdge, MapPoint[]>();
  private readonly lengths = new Map<MapPathEdge, number>();
  private readonly order = new Map<MapPathEdge, number>();
  private readonly cells = new Map<number, { edge: MapPathEdge; segment: number }[]>();
  private readonly minI: number;
  private readonly minJ: number;
  private readonly maxI: number;
  private readonly maxJ: number;

  constructor(readonly paths: MapPaths) {
    const nodes = new Map(paths.nodes.map((n) => [n.id, n]));
    let minI = Infinity;
    let minJ = Infinity;
    let maxI = -Infinity;
    let maxJ = -Infinity;
    paths.edges.forEach((edge, n) => {
      const a = nodes.get(edge.a);
      const b = nodes.get(edge.b);
      const line = a && b ? [{ x: a.x, y: a.y }, ...(edge.via ?? []).map((p) => ({ x: p.x, y: p.y })), { x: b.x, y: b.y }] : [];
      this.lines.set(edge, line);
      this.lengths.set(edge, polylineLength(line));
      this.order.set(edge, n);
      for (let k = 1; k < line.length; k++) {
        const i0 = Math.floor(Math.min(line[k - 1].x, line[k].x) / EDGE_CELL);
        const i1 = Math.floor(Math.max(line[k - 1].x, line[k].x) / EDGE_CELL);
        const j0 = Math.floor(Math.min(line[k - 1].y, line[k].y) / EDGE_CELL);
        const j1 = Math.floor(Math.max(line[k - 1].y, line[k].y) / EDGE_CELL);
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const key = cellKey(i, j);
            let list = this.cells.get(key);
            if (!list) this.cells.set(key, (list = []));
            list.push({ edge, segment: k - 1 });
          }
        }
        minI = Math.min(minI, i0);
        minJ = Math.min(minJ, j0);
        maxI = Math.max(maxI, i1);
        maxJ = Math.max(maxJ, j1);
      }
    });
    this.minI = minI;
    this.minJ = minJ;
    this.maxI = maxI;
    this.maxJ = maxJ;
  }

  /** The edge as a line (edgePolyline): the index's copy, not to be changed */
  polyline(edge: MapPathEdge): MapPoint[] {
    return this.lines.get(edge) ?? edgePolyline(this.paths, edge);
  }

  length(edge: MapPathEdge): number {
    return this.lengths.get(edge) ?? polylineLength(this.polyline(edge));
  }

  /** The nearest point on any edge within `maxDist`, as nearestOnEdges finds it (of two as near, the first edge) */
  nearest(p: MapPoint, maxDist = Infinity): EdgeHit | null {
    if (!this.cells.size) return null;
    const ci = Math.floor(p.x / EDGE_CELL);
    const cj = Math.floor(p.y / EDGE_CELL);
    // Rings until no farther cell can hold a nearer segment, or the grid ends
    const rings = Math.max(ci - this.minI, this.maxI - ci, cj - this.minJ, this.maxJ - cj, 0);
    let best: { edge: MapPathEdge; dist: number } | null = null;
    for (let r = 0; r <= rings; r++) {
      const near = Math.max(0, r - 1) * EDGE_CELL;
      if (near > maxDist || (best && near > best.dist)) break;
      for (let j = cj - r; j <= cj + r; j++) {
        for (let i = ci - r; i <= ci + r; i++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
          for (const item of this.cells.get(cellKey(i, j)) ?? []) {
            const line = this.lines.get(item.edge)!;
            const d = segmentDistance(p, line[item.segment], line[item.segment + 1]);
            if (d > maxDist) continue;
            if (!best || d < best.dist || (d === best.dist && this.order.get(item.edge)! < this.order.get(best.edge)!)) best = { edge: item.edge, dist: d };
          }
        }
      }
    }
    if (!best) return null;
    const hit = nearestOnPolyline(this.lines.get(best.edge)!, p)!;
    return { edge: best.edge, ...hit, length: this.lengths.get(best.edge)! };
  }
}

/** One number per grid cell (cells within a million of the origin either way) */
function cellKey(i: number, j: number): number {
  return (i + 1_000_000) * 2_000_003 + (j + 1_000_000);
}

function segmentDistance(p: MapPoint, a: MapPoint, b: MapPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const s = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(a.x + dx * s - p.x, a.y + dy * s - p.y);
}

export function addNode(paths: MapPaths, p: MapPoint): MapPathNode {
  const node = { id: newId('n', paths.nodes), x: p.x, y: p.y };
  paths.nodes.push(node);
  return node;
}

/** An edge between two nodes; returns the existing one when they are joined already */
export function connect(paths: MapPaths, a: string, b: string, width = DEFAULT_PATH_WIDTH, kind: MapPathKind = 'road'): MapPathEdge | null {
  if (a === b) return null;
  const existing = paths.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
  if (existing) return existing;
  const edge: MapPathEdge = { id: newId('e', paths.edges), a, b, width, kind };
  paths.edges.push(edge);
  return edge;
}

/** Splits an edge at a point into two, joined by a new node (a junction to branch from) */
export function splitEdge(paths: MapPaths, edgeId: string, p: MapPoint): MapPathNode | null {
  const edge = paths.edges.find((e) => e.id === edgeId);
  if (!edge) return null;
  const line = edgePolyline(paths, edge);
  const hit = nearestOnPolyline(line, p);
  if (!hit) return null;
  const node = addNode(paths, hit.point);
  const via = edge.via ?? [];
  // Curve points before the hit segment stay on the first half
  const first = via.slice(0, hit.segment);
  const second = via.slice(hit.segment);
  const tail: MapPathEdge = { id: newId('e', paths.edges), a: node.id, b: edge.b, width: edge.width, kind: edge.kind };
  if (second.length) tail.via = second;
  // Both halves keep what the road brush built; each takes its own objects away by where they stand (undressEdge)
  if (edge.dress) tail.dress = structuredClone(edge.dress);
  if (edge.style) tail.style = edge.style;
  edge.b = node.id;
  if (first.length) edge.via = first;
  else delete edge.via;
  paths.edges.push(tail);
  return node;
}

/** Removes a node and its edges, then nodes left without edges */
export function deleteNode(paths: MapPaths, id: string): void {
  paths.edges = paths.edges.filter((e) => e.a !== id && e.b !== id);
  paths.nodes = paths.nodes.filter((n) => n.id !== id);
}

/** Removes an edge and the nodes it leaves alone */
export function deleteEdge(paths: MapPaths, id: string): void {
  const edge = paths.edges.find((e) => e.id === id);
  if (!edge) return;
  paths.edges = paths.edges.filter((e) => e.id !== id);
  for (const n of [edge.a, edge.b]) {
    if (!paths.edges.some((e) => e.a === n || e.b === n)) paths.nodes = paths.nodes.filter((x) => x.id !== n);
  }
}

/**
 * Removes a node with exactly two edges and joins them into one, keeping
 * the curve (the node becomes a curve point). Returns false otherwise.
 */
export function dissolveNode(paths: MapPaths, id: string): boolean {
  const edges = paths.edges.filter((e) => e.a === id || e.b === id);
  const node = nodeById(paths, id);
  if (edges.length !== 2 || !node) return false;
  const [e1, e2] = edges;
  const l1 = edgePolyline(paths, e1);
  const l2 = edgePolyline(paths, e2);
  const into = e1.b === id ? l1 : [...l1].reverse();
  const out = e2.a === id ? l2 : [...l2].reverse();
  const from = e1.b === id ? e1.a : e1.b;
  const to = e2.a === id ? e2.b : e2.a;
  if (from === to) return false;
  const line = [...into, ...out.slice(1)];
  e1.a = from;
  e1.b = to;
  e1.via = line.slice(1, -1);
  if (!e1.via.length) delete e1.via;
  paths.edges = paths.edges.filter((e) => e !== e2);
  paths.nodes = paths.nodes.filter((n) => n.id !== id);
  return true;
}

export function moveNode(paths: MapPaths, id: string, p: MapPoint): void {
  const node = nodeById(paths, id);
  if (!node) return;
  const dx = p.x - node.x;
  const dy = p.y - node.y;
  node.x = p.x;
  node.y = p.y;
  // Curve points follow by their share of the way from the other end
  for (const e of paths.edges) {
    if (!e.via?.length || (e.a !== id && e.b !== id)) continue;
    const n = e.via.length + 1;
    e.via = e.via.map((v, k) => {
      const share = e.a === id ? 1 - (k + 1) / n : (k + 1) / n;
      return { x: v.x + dx * share, y: v.y + dy * share };
    });
  }
}

/** Merges node `from` into node `into` (snap onto an existing node): edges move over */
export function mergeNodes(paths: MapPaths, from: string, into: string): void {
  if (from === into) return;
  for (const e of paths.edges) {
    if (e.a === from) e.a = into;
    if (e.b === from) e.b = into;
  }
  paths.edges = paths.edges.filter((e, k, all) => {
    if (e.a === e.b) return false;
    return all.findIndex((o) => (o.a === e.a && o.b === e.b) || (o.a === e.b && o.b === e.a)) === k;
  });
  paths.nodes = paths.nodes.filter((n) => n.id !== from);
}

/**
 * Curve an edge with a Catmull-Rom spline through its ends, using the
 * neighbouring edges at each end as tangents when the node has exactly one
 * other edge. `spacing` metres between curve points.
 */
export function smoothEdge(paths: MapPaths, edgeId: string, spacing = 8): void {
  const edge = paths.edges.find((e) => e.id === edgeId);
  if (!edge) return;
  const line = edgePolyline(paths, edge);
  if (line.length < 2) return;
  const before = neighbourPoint(paths, edge, edge.a) ?? mirror(line[1], line[0]);
  const after = neighbourPoint(paths, edge, edge.b) ?? mirror(line[line.length - 2], line[line.length - 1]);
  const ctrl = [before, ...line, after];
  const out: MapPoint[] = [];
  for (let k = 1; k < ctrl.length - 2; k++) {
    const p0 = ctrl[k - 1];
    const p1 = ctrl[k];
    const p2 = ctrl[k + 1];
    const p3 = ctrl[k + 2];
    const steps = Math.max(1, Math.round(Math.hypot(p2.x - p1.x, p2.y - p1.y) / spacing));
    for (let s = k === 1 ? 1 : 0; s < steps; s++) out.push(catmull(p0, p1, p2, p3, s / steps));
    if (k < ctrl.length - 3) out.push({ ...p2 });
  }
  const via = out.filter((p, k) => k === 0 || Math.hypot(p.x - out[k - 1].x, p.y - out[k - 1].y) > 0.01);
  if (via.length) edge.via = via;
  else delete edge.via;
}

export function straightenEdge(paths: MapPaths, edgeId: string): void {
  const edge = paths.edges.find((e) => e.id === edgeId);
  if (edge) delete edge.via;
}

function neighbourPoint(paths: MapPaths, edge: MapPathEdge, nodeId: string): MapPoint | null {
  const others = paths.edges.filter((e) => e !== edge && (e.a === nodeId || e.b === nodeId));
  if (others.length !== 1) return null;
  const line = edgePolyline(paths, others[0]);
  return others[0].a === nodeId ? line[1] : line[line.length - 2];
}

function mirror(p: MapPoint, about: MapPoint): MapPoint {
  return { x: 2 * about.x - p.x, y: 2 * about.y - p.y };
}

function catmull(p0: MapPoint, p1: MapPoint, p2: MapPoint, p3: MapPoint, t: number): MapPoint {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
}

// ---------------------------------------------------------------------------
// Graph queries

/** Groups of nodes joined by edges */
export function components(paths: MapPaths, index = new EdgeIndex(paths)): string[][] {
  const adj = adjacency(paths, index);
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const n of paths.nodes) {
    if (seen.has(n.id)) continue;
    const group: string[] = [];
    const stack = [n.id];
    seen.add(n.id);
    while (stack.length) {
      const id = stack.pop()!;
      group.push(id);
      for (const { to } of adj.get(id) ?? []) {
        if (!seen.has(to)) {
          seen.add(to);
          stack.push(to);
        }
      }
    }
    out.push(group);
  }
  return out;
}

interface Link {
  to: string;
  edge: MapPathEdge;
  length: number;
}

function adjacency(paths: MapPaths, index: EdgeIndex): Map<string, Link[]> {
  const adj = new Map<string, Link[]>();
  for (const n of paths.nodes) adj.set(n.id, []);
  for (const e of paths.edges) {
    const length = index.length(e);
    adj.get(e.a)?.push({ to: e.b, edge: e, length });
    adj.get(e.b)?.push({ to: e.a, edge: e, length });
  }
  return adj;
}

export interface Route {
  points: MapPoint[];
  length: number;
  /** How far the start and end lie off the network */
  startGap: number;
  endGap: number;
}

/**
 * Shortest way along the network from the point nearest `from` to the
 * point nearest `to`. Null when there is no network or the two points lie
 * on parts that do not connect. `index` (an EdgeIndex of `paths`) saves
 * building one per call where many routes run on one graph.
 */
export function routeBetween(paths: MapPaths, from: MapPoint, to: MapPoint, index = new EdgeIndex(paths)): Route | null {
  const s = index.nearest(from);
  const t = index.nearest(to);
  if (!s || !t) return null;
  const sLine = index.polyline(s.edge);
  const tLine = index.polyline(t.edge);
  const startGap = s.dist;
  const endGap = t.dist;

  if (s.edge === t.edge) {
    return {
      points: [s.point, ...slicePolyline(sLine, s.along, t.along), t.point],
      length: Math.abs(t.along - s.along),
      startGap,
      endGap,
    };
  }

  // Dijkstra from the two ends of the start edge, each with its partial cost
  const adj = adjacency(paths, index);
  const dist = new Map<string, number>();
  const prev = new Map<string, { node: string; edge: MapPathEdge } | null>();
  // Open nodes by cost; a node reached again for less leaves its old entry behind, skipped when it comes up
  const open = new MinHeap<string>();
  const seed = (node: string, cost: number) => {
    if (cost < (dist.get(node) ?? Infinity)) {
      dist.set(node, cost);
      prev.set(node, null);
      open.push(node, cost);
    }
  };
  seed(s.edge.a, s.along);
  seed(s.edge.b, s.length - s.along);
  const done = new Set<string>();
  while (open.size) {
    const cur = open.pop()!;
    if (done.has(cur)) continue;
    done.add(cur);
    const best = dist.get(cur)!;
    for (const link of adj.get(cur) ?? []) {
      const d = best + link.length;
      if (d < (dist.get(link.to) ?? Infinity)) {
        dist.set(link.to, d);
        prev.set(link.to, { node: cur, edge: link.edge });
        open.push(link.to, d);
      }
    }
  }
  const viaA = (dist.get(t.edge.a) ?? Infinity) + t.along;
  const viaB = (dist.get(t.edge.b) ?? Infinity) + (t.length - t.along);
  const total = Math.min(viaA, viaB);
  if (!Number.isFinite(total)) return null;
  const exitNode = viaA <= viaB ? t.edge.a : t.edge.b;

  // Walk back from the exit node
  const chain: { node: string; edge: MapPathEdge | null }[] = [];
  let node: string | undefined = exitNode;
  while (node !== undefined) {
    const p = prev.get(node);
    chain.unshift({ node, edge: p?.edge ?? null });
    node = p?.node;
  }
  const first = chain[0].node;
  const points: MapPoint[] = [s.point];
  points.push(...slicePolyline(sLine, s.along, first === s.edge.a ? 0 : s.length));
  for (let k = 1; k < chain.length; k++) {
    const edge = chain[k].edge!;
    const line = index.polyline(edge);
    const forward = edge.a === chain[k - 1].node;
    points.push(...(forward ? line : [...line].reverse()));
  }
  const tLen = t.length;
  points.push(...slicePolyline(tLine, exitNode === t.edge.a ? 0 : tLen, t.along), t.point);
  return { points: dedupe(points), length: total, startGap, endGap };
}

/** The points of a polyline between two arc lengths, ends included, in that direction */
export function slicePolyline(line: readonly MapPoint[], from: number, to: number): MapPoint[] {
  const forward = to >= from;
  const pts = forward ? line : [...line].reverse();
  const total = polylineLength(line);
  const a = forward ? from : total - from;
  const b = forward ? to : total - to;
  const out: MapPoint[] = [pointAt(pts, a)];
  let walked = 0;
  for (let k = 1; k < pts.length; k++) {
    walked += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
    if (walked > a && walked < b) out.push({ ...pts[k] });
  }
  out.push(pointAt(pts, b));
  return out;
}

export function pointAt(line: readonly MapPoint[], along: number): MapPoint {
  let walked = 0;
  for (let k = 1; k < line.length; k++) {
    const seg = Math.hypot(line[k].x - line[k - 1].x, line[k].y - line[k - 1].y);
    if (walked + seg >= along) {
      const s = seg > 0 ? (along - walked) / seg : 0;
      return { x: line[k - 1].x + (line[k].x - line[k - 1].x) * s, y: line[k - 1].y + (line[k].y - line[k - 1].y) * s };
    }
    walked += seg;
  }
  return { ...line[line.length - 1] };
}

function dedupe(points: MapPoint[]): MapPoint[] {
  return points.filter((p, k) => k === 0 || Math.hypot(p.x - points[k - 1].x, p.y - points[k - 1].y) > 1e-6);
}

/** Routes from every spawn to the HQ, by spawn id; null where there is none */
export function spawnRoutes(doc: CustomMapDocument): Map<string, Route | null> {
  const out = new Map<string, Route | null>();
  const index = new EdgeIndex(doc.paths);
  for (const s of doc.spawns) out.set(s.id, routeBetween(doc.paths, s, doc.hq, index));
  return out;
}
