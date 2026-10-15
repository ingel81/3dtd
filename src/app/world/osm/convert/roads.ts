/**
 * The roads of an OSM world: the street graph over OSM node ids, the ground
 * levelled under it and its surface painted.
 *
 * Graph: every node two road ways share (or one way passes twice) becomes a
 * map node, the points between become an edge's curve points; so ways that
 * cross at an inner node connect, as on the real places
 * (OsmStreetService.parseOverpassResponse). Ways are cut at the map's edge
 * (a node of their own there) and where the answer cut their geometry off.
 * Bridges become bridge edges (the deck spans the ground the heights know).
 * Tunnels stay in the graph as tunnel edges (not drawn, levelled or painted),
 * so routes run through them as on the real places; their mouths get portal
 * models (convert/tunnels.ts). A tunnel shorter than MIN_TUNNEL_M (an
 * underpass under an embankment the world does not draw) stays a road, and a
 * footway or path through one stays a path (the portal is a road's).
 */
import { flattenUnderPaths } from '../../../editor/ops/path-terrain';
import { MAX_LAYERS, readWeights, writeWeights } from '../../../editor/ops/paint-ops';
import { fitSplatMaps, type MapPathEdge, type MapPathNode, type MapPaths, type MapPoint, type MapTerrain } from '../../custom-map/map-document';
import type { OsmFeatures } from '../osm-parse';
import { bridgeStyle, roadTags, type RoadSurface } from '../osm-tags';

export interface RoadStats {
  /** Road ways read, and the tunnels (ways joined end to end) kept as tunnel edges, with their length */
  ways: number;
  tunnels: number;
  tunnelM: number;
  nodes: number;
  edges: number;
  bridges: number;
  /** Kilometres by kind */
  km: { road: number; path: number; bridge: number };
  /** Kilometres by OSM highway type */
  kmByType: Record<string, number>;
  /** Pieces cut at the map's edge */
  cutAtEdge: number;
  /** Tunnel ways kept as plain roads and paths: footways and paths, and roads in tunnels shorter than MIN_TUNNEL_M */
  openTunnels: number;
}

/** A tunnel's mouth inside the map: where its portal stands */
export interface TunnelMouth {
  p: MapPoint;
  /** Unit direction into the tunnel */
  inward: MapPoint;
  width: number;
  /** Index of its tunnel in RoadBuild.tunnels */
  tunnel: number;
}

/** A tunnel: its ways' lines (one per way) and their whole length */
export interface TunnelLine {
  lines: MapPoint[][];
  length: number;
}

export interface RoadBuild {
  paths: MapPaths;
  /** Name of the way each edge came from ('' without one), for the spawns' names */
  names: Map<string, string>;
  stats: RoadStats;
  tunnels: TunnelLine[];
  mouths: TunnelMouth[];
}

/** Metres the roads stay inside the map's edge */
const EDGE_INSET = 1;
/** Curve points closer than this to the line through their neighbours are dropped, metres */
const VIA_TOLERANCE = 0.2;
/** Tunnels shorter than this stay roads, metres: two portals (a 1.6 m facade, a 14 m vault, the hill behind) need the room */
export const MIN_TUNNEL_M = 40;
/** Metres along the way the direction into a tunnel is measured over */
const MOUTH_AIM_M = 10;

interface Vertex {
  id: number | null;
  p: MapPoint;
}

/** The road ways of `features` as the map's path graph */
export function buildRoads(features: OsmFeatures): RoadBuild {
  const lim = features.half - EDGE_INSET;
  const stats: RoadStats = { ways: 0, tunnels: 0, tunnelM: 0, nodes: 0, edges: 0, bridges: 0, km: { road: 0, path: 0, bridge: 0 }, kmByType: {}, cutAtEdge: 0, openTunnels: 0 };
  const roads = features.ways
    .filter((w) => w.nodes.length >= 2)
    .map((way) => ({ way, tags: roadTags(way.tags) }))
    .filter((r): r is { way: typeof r.way; tags: NonNullable<typeof r.tags> } => r.tags !== null);
  const { tunnels, mouths, short } = findTunnels(roads.filter((r) => r.tags.kind === 'road'), lim);
  for (const r of roads) {
    if (!r.tags.tunnel || (r.tags.kind === 'road' && !short.has(r.way))) continue;
    r.tags = { ...r.tags, tunnel: false };
    stats.openTunnels++;
  }
  stats.tunnels = tunnels.length;
  stats.tunnelM = tunnels.reduce((s, t) => s + t.length, 0);

  // Nodes used twice or more: shared by ways, or a way's closing node
  const uses = new Map<number, number>();
  for (const { way } of roads) {
    stats.ways++;
    for (const id of way.nodes) uses.set(id, (uses.get(id) ?? 0) + 1);
  }

  const nodes = new Map<string, MapPathNode>();
  const edges: MapPathEdge[] = [];
  const names = new Map<string, string>();
  let borderCount = 0;
  const nodeFor = (v: Vertex, fallback: string): string => {
    const id = v.id !== null ? `n${v.id}` : fallback;
    if (!nodes.has(id)) nodes.set(id, { id, x: round2(v.p.x), y: round2(v.p.y) });
    return id;
  };

  for (const { way, tags } of roads) {
    const vertices: (Vertex | null)[] = way.points.map((p, k) => (p ? { id: way.nodes[k], p } : null));
    for (const piece of clipPieces(vertices, lim)) {
      if (piece.cut) stats.cutAtEdge++;
      const line = piece.vertices;
      // Split at the shared nodes
      let start = 0;
      for (let k = 1; k < line.length; k++) {
        const v = line[k];
        const last = k === line.length - 1;
        if (!last && !(v.id !== null && (uses.get(v.id) ?? 0) >= 2)) continue;
        for (const span of loopFree(line.slice(start, k + 1))) {
          const a = nodeFor(span[0], `b${++borderCount}`);
          const b = nodeFor(span[span.length - 1], `b${++borderCount}`);
          if (a === b) continue;
          const pts = span.map((s) => s.p);
          const length = lineLength(pts);
          if (length < 0.5) continue;
          const kind = tags.bridge && !tags.tunnel ? 'bridge' : tags.kind;
          const via = thin(pts, VIA_TOLERANCE).slice(1, -1).map((p) => ({ x: round2(p.x), y: round2(p.y) }));
          const edge: MapPathEdge = { id: `e${edges.length + 1}`, a, b, width: tags.width, kind, street: tags.type };
          if (via.length) edge.via = via;
          if (tags.tunnel) edge.tunnel = true;
          else if (kind === 'bridge') edge.style = bridgeStyle(way.tags);
          else edge.surface = tags.surface;
          edges.push(edge);
          names.set(edge.id, way.tags['name'] ?? '');
          stats.km[kind] += length / 1000;
          stats.kmByType[tags.type] = (stats.kmByType[tags.type] ?? 0) + length / 1000;
          if (kind === 'bridge') stats.bridges++;
        }
        start = k;
      }
    }
  }
  stats.nodes = nodes.size;
  stats.edges = edges.length;
  for (const key of ['road', 'path', 'bridge'] as const) stats.km[key] = round2(stats.km[key]);
  for (const key of Object.keys(stats.kmByType)) stats.kmByType[key] = round2(stats.kmByType[key]);
  return { paths: { nodes: [...nodes.values()], edges }, names, stats, tunnels, mouths };
}

type RoadWay = OsmFeatures['ways'][number];

/**
 * The tunnels among `roads`: tunnel ways joined where they share a node,
 * their length, and their mouths: the ends of a tunnel way that no other
 * tunnel way continues from, inside the square |x|, |y| <= lim (where a
 * tunnel runs off the map it has no portal). The ways of tunnels shorter
 * than MIN_TUNNEL_M come back in `short`.
 */
export function findTunnels(
  roads: readonly { way: RoadWay; tags: { tunnel: boolean; width: number } }[],
  lim: number,
): { tunnels: TunnelLine[]; mouths: TunnelMouth[]; short: Set<RoadWay> } {
  const ways = roads.filter((r) => r.tags.tunnel);
  // Join the ways over shared nodes (union-find over their indices)
  const parent = ways.map((_, k) => k);
  const find = (k: number): number => (parent[k] === k ? k : (parent[k] = find(parent[k])));
  const byNode = new Map<number, number>();
  // How often a node is a tunnel way's end (1) or inner node (2): once is a mouth
  const ends = new Map<number, number>();
  ways.forEach(({ way }, k) => {
    way.nodes.forEach((id, i) => {
      const seen = byNode.get(id);
      if (seen === undefined) byNode.set(id, k);
      else parent[find(seen)] = find(k);
      ends.set(id, (ends.get(id) ?? 0) + (i === 0 || i === way.nodes.length - 1 ? 1 : 2));
    });
  });
  const groups = new Map<number, number[]>();
  ways.forEach((_, k) => {
    const root = find(k);
    const members = groups.get(root);
    if (members) members.push(k);
    else groups.set(root, [k]);
  });

  const tunnels: TunnelLine[] = [];
  const mouths: TunnelMouth[] = [];
  const short = new Set<RoadWay>();
  for (const members of groups.values()) {
    const lines = members.map((k) => ways[k].way.points.filter((p): p is MapPoint => p !== null));
    const length = lines.reduce((s, l) => s + lineLength(l), 0);
    if (length < MIN_TUNNEL_M) {
      for (const k of members) short.add(ways[k].way);
      continue;
    }
    const index = tunnels.length;
    tunnels.push({ lines, length: Math.round(length) });
    for (const k of members) {
      const { way, tags } = ways[k];
      for (const end of [0, way.nodes.length - 1]) {
        const p = way.points[end];
        if (!p || ends.get(way.nodes[end]) !== 1 || Math.abs(p.x) > lim || Math.abs(p.y) > lim) continue;
        const line = (end === 0 ? way.points : [...way.points].reverse()).filter((q): q is MapPoint => q !== null);
        const aim = pointAlong(line, Math.min(MOUTH_AIM_M, lineLength(line)));
        const d = Math.hypot(aim.x - p.x, aim.y - p.y);
        if (d < 1e-6) continue;
        mouths.push({ p: { x: round2(p.x), y: round2(p.y) }, inward: { x: (aim.x - p.x) / d, y: (aim.y - p.y) / d }, width: tags.width, tunnel: index });
      }
    }
  }
  return { tunnels, mouths, short };
}

/** The point `along` metres down `line` */
function pointAlong(line: readonly MapPoint[], along: number): MapPoint {
  let walked = 0;
  for (let k = 1; k < line.length; k++) {
    const seg = Math.hypot(line[k].x - line[k - 1].x, line[k].y - line[k - 1].y);
    if (walked + seg >= along && seg > 0) {
      const s = (along - walked) / seg;
      return { x: line[k - 1].x + (line[k].x - line[k - 1].x) * s, y: line[k - 1].y + (line[k].y - line[k - 1].y) * s };
    }
    walked += seg;
  }
  return line[line.length - 1];
}

/**
 * The runs of a way's vertices inside the square |x|, |y| <= lim: a gap
 * (a node the answer cut off) ends a run, and so does the square's edge, at
 * a vertex of its own there (no node id). `cut` marks a run that ends at the
 * edge.
 */
export function clipPieces(vertices: readonly (Vertex | null)[], lim: number): { vertices: Vertex[]; cut: boolean }[] {
  const out: { vertices: Vertex[]; cut: boolean }[] = [];
  let run: Vertex[] = [];
  let cut = false;
  const flush = () => {
    if (run.length >= 2) out.push({ vertices: run, cut });
    run = [];
    cut = false;
  };
  const inside = (p: MapPoint) => Math.abs(p.x) <= lim && Math.abs(p.y) <= lim;
  for (let k = 0; k < vertices.length; k++) {
    const v = vertices[k];
    if (!v) {
      flush();
      continue;
    }
    const prev = k > 0 ? vertices[k - 1] : null;
    if (!prev) {
      if (inside(v.p)) run.push(v);
      continue;
    }
    const seg = clipSegment(prev.p, v.p, lim);
    if (!seg) continue;
    const [t0, t1] = seg;
    const at = (t: number): MapPoint => ({ x: prev.p.x + (v.p.x - prev.p.x) * t, y: prev.p.y + (v.p.y - prev.p.y) * t });
    if (t0 > 0) {
      // Comes in over the edge
      flush();
      run.push({ id: null, p: at(t0) });
      cut = true;
    }
    if (t1 < 1) {
      run.push({ id: null, p: at(t1) });
      cut = true;
      flush();
    } else run.push(v);
  }
  flush();
  return out;
}

/** The part of segment a-b inside the square, as parameters along it; null when none (Liang-Barsky) */
function clipSegment(a: MapPoint, b: MapPoint, lim: number): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const checks: [number, number][] = [
    [-dx, a.x + lim],
    [dx, lim - a.x],
    [-dy, a.y + lim],
    [dy, lim - a.y],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1 ? [t0, t1] : null;
}

/**
 * A span whose ends are one node (a closed way with one shared node) split at
 * its middle vertex, so no edge starts and ends at one node
 */
function loopFree(span: Vertex[]): Vertex[][] {
  const first = span[0];
  const last = span[span.length - 1];
  const same = first.id !== null ? first.id === last.id : first.p.x === last.p.x && first.p.y === last.p.y;
  if (!same) return [span];
  if (span.length < 3) return [];
  const mid = Math.floor(span.length / 2);
  return [span.slice(0, mid + 1), span.slice(mid)];
}

function lineLength(points: readonly MapPoint[]): number {
  let s = 0;
  for (let k = 1; k < points.length; k++) s += Math.hypot(points[k].x - points[k - 1].x, points[k].y - points[k - 1].y);
  return s;
}

/** Douglas-Peucker: the points of `line` that stray more than `tolerance` from the line through those kept */
function thin(line: readonly MapPoint[], tolerance: number): MapPoint[] {
  if (line.length <= 2) return [...line];
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const dx = line[b].x - line[a].x;
    const dy = line[b].y - line[a].y;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstDist = tolerance;
    for (let k = a + 1; k < b; k++) {
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((line[k].x - line[a].x) * dx + (line[k].y - line[a].y) * dy) / len2)) : 0;
      const d = Math.hypot(line[k].x - line[a].x - t * dx, line[k].y - line[a].y - t * dy);
      if (d > worstDist) {
        worst = k;
        worstDist = d;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return line.filter((_, k) => keep[k] === 1);
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** Shoulder (metres past the half width that fade into the ground) and smoothing along the road */
export const ROAD_LEVELLING = { shoulder: 3, smoothing: 20 } as const;

/**
 * The ground levelled across every road and path (bridges span theirs, tunnels run under it):
 * paths first, then the roads from narrow to wide, so where they meet the
 * wider road's profile wins
 */
export function levelRoads(terrain: MapTerrain, paths: MapPaths): void {
  const edges = paths.edges
    .filter((e) => e.kind !== 'bridge' && !e.tunnel)
    .sort((a, b) => (a.kind === b.kind ? a.width - b.width : a.kind === 'path' ? -1 : 1));
  // flattenUnderPaths levels the edges in the order of the list it is given
  flattenUnderPaths(terrain, { nodes: paths.nodes, edges }, null, ROAD_LEVELLING);
}

/** Metres a painted road fades into the ground beside it */
const PAINT_SOFT_EDGE = 0.75;

/**
 * The roads' surfaces painted into the ground (edges with `surface`): each
 * texel takes the material of the road that covers it most, full inside the
 * half width and fading over PAINT_SOFT_EDGE. Adds the materials to the
 * layer list as needed; returns them.
 */
export function paintRoads(terrain: MapTerrain, paths: MapPaths): RoadSurface[] {
  const res = terrain.splat.resolution;
  const alpha = new Float32Array(res * res);
  const layerOf = new Int8Array(res * res).fill(-1);
  const layers = terrain.layers;
  const used: RoadSurface[] = [];
  const layerIndex = (material: string): number => {
    let k = layers.findIndex((l) => l.material === material);
    if (k < 0 && layers.length < MAX_LAYERS) {
      layers.push({ material });
      used.push(material as RoadSurface);
      k = layers.length - 1;
    }
    return k;
  };
  const nodes = new Map(paths.nodes.map((n) => [n.id, n]));
  const sx = res / terrain.width;
  const sy = res / terrain.depth;
  for (const edge of paths.edges) {
    if (!edge.surface || edge.kind === 'bridge') continue;
    const a = nodes.get(edge.a);
    const b = nodes.get(edge.b);
    if (!a || !b) continue;
    const layer = layerIndex(edge.surface);
    if (layer < 0) continue;
    const line = [a, ...(edge.via ?? []), b];
    const half = edge.width / 2;
    const outer = half + PAINT_SOFT_EDGE;
    for (let s = 0; s + 1 < line.length; s++) {
      const p = line[s];
      const q = line[s + 1];
      const minX = Math.max(0, Math.floor((Math.min(p.x, q.x) - outer + terrain.width / 2) * sx));
      const maxX = Math.min(res - 1, Math.ceil((Math.max(p.x, q.x) + outer + terrain.width / 2) * sx));
      const minY = Math.max(0, Math.floor((Math.min(p.y, q.y) - outer + terrain.depth / 2) * sy));
      const maxY = Math.min(res - 1, Math.ceil((Math.max(p.y, q.y) + outer + terrain.depth / 2) * sy));
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len2 = dx * dx + dy * dy || 1;
      for (let ty = minY; ty <= maxY; ty++) {
        const y = (ty + 0.5) / sy - terrain.depth / 2;
        for (let tx = minX; tx <= maxX; tx++) {
          const x = (tx + 0.5) / sx - terrain.width / 2;
          const t = Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / len2));
          const d = Math.hypot(x - (p.x + t * dx), y - (p.y + t * dy));
          if (d >= outer) continue;
          const f = d <= half ? 1 : 1 - (d - half) / PAINT_SOFT_EDGE;
          const k = ty * res + tx;
          if (f <= alpha[k]) continue;
          alpha[k] = f;
          layerOf[k] = layer;
        }
      }
    }
  }
  fitSplatMaps(terrain);
  const w = new Float32Array(MAX_LAYERS);
  for (let k = 0; k < alpha.length; k++) {
    const f = alpha[k];
    if (f <= 0) continue;
    readWeights(terrain, k, w);
    for (let l = 0; l < MAX_LAYERS; l++) w[l] *= 1 - f;
    w[layerOf[k]] += 255 * f;
    writeWeights(terrain, k, w);
  }
  return used;
}
