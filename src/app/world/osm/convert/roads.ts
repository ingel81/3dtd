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
 * A passage through a building (`tunnel=building_passage`, `covered=yes`)
 * is a road with `covered`: the building stands over it, the routes run
 * under cover. So is a tunnel that lies mostly under buildings, and an
 * underground car park keeps only its entrances, ramps down to the wall
 * (convert/underground.ts): only tunnels through the ground get portals. A square's outline (`area=yes`) is pulled off the walls of
 * the houses round it (square-outlines.ts). Roundabouts are laid as circles first (roundabouts.ts).
 */
import { flattenJunctions, flattenUnderPaths } from '../../../map-ops/path-terrain';
import { MAX_LAYERS, readWeights, writeWeights } from '../../../map-ops/paint-ops';
import { fitSplatMaps, type MapPathEdge, type MapPathNode, type MapPaths, type MapPoint, type MapTerrain } from '../../custom-map/map-document';
import type { OsmFeatures, OsmWay } from '../osm-parse';
import { bridgeStyle, roadTags, sidewalkTag, type RoadSurface } from '../osm-tags';
import { roadPaintBands } from '../../custom-map/render/paths/road-style';
import { pullDeadEnds, pullOutlines } from './square-outlines';
import { sortUnderground, type Ramp, type UndergroundReport } from './underground';
import { findDescents, type DescentReport, type SubwayDescent } from './subway-descents';
import { roundRoundabouts } from './roundabouts';

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
  /** Footway and path tunnels kept under a track field: underpasses, see underpasses() */
  underpasses: number;
  /** Their stairs and ramps down from the ground (subway-descents.ts) */
  descents: DescentReport;
  /** Edges through buildings (passages, `covered`), and points of squares' outlines pulled off the walls (square-outlines.ts) */
  covered: number;
  outlinePulled: number;
  /** Ends of roads and paths pulled off the building they end at (square-outlines.ts pullDeadEnds) */
  endsPulled: number;
  /** Tunnels under buildings (underground.ts): passages, car parks and their entrances */
  underground: UndergroundReport;
  /** Roundabouts laid as circles (roundabouts.ts) */
  roundabouts: number;
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
  /** What the way of each road edge says of its pavements (sidewalkTag): metres, 0 none, null when it says nothing */
  pavements: Map<string, number | null>;
  stats: RoadStats;
  tunnels: TunnelLine[];
  mouths: TunnelMouth[];
  /** The car parks' entrances, to sink after the roads are levelled (underground.ts sinkRamps) */
  ramps: Ramp[];
  /** The underpasses' stairs and ramps, to place after the ground is levelled (subway-descents.ts placeDescents) */
  descents: SubwayDescent[];
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
  // Roundabouts as circles, in the ways themselves (whatever reads them after sees circles)
  const roundabouts = roundRoundabouts(features.ways);
  const read = features.ways
    .filter((w) => w.nodes.length >= 2)
    .map((way) => ({ way, tags: roadTags(way.tags) }))
    .filter((r): r is { way: typeof r.way; tags: NonNullable<typeof r.tags> } => r.tags !== null);
  // Tunnels under buildings first: passages covered, car parks down to their entrances
  const { roads: sorted, ramps, report: underground } = sortUnderground(read, features);
  // A station's subway is often mapped indoors, its stairs too: such ways below the ground find the underpasses and
  // their descents, and stay out of the graph with the ways indoors (roadTags): as tunnel edges under the platforms
  // they held the platforms' roofs off (buildings.ts takes a tunnel for a road)
  const below = features.ways
    .filter((w) => w.nodes.length >= 2 && w.tags['indoor'] && w.tags['indoor'] !== 'no' && belowGround(w.tags))
    .map((way) => ({ way, tags: roadTags({ ...way.tags, indoor: 'no' }) }))
    .filter((r): r is { way: typeof r.way; tags: NonNullable<typeof r.tags> } => r.tags?.kind === 'path');
  const indoors = new Set(below);
  const taken = [...sorted, ...below];
  const stats: RoadStats = { ways: 0, tunnels: 0, tunnelM: 0, nodes: 0, edges: 0, bridges: 0, km: { road: 0, path: 0, bridge: 0 }, kmByType: {}, cutAtEdge: 0, openTunnels: 0, underpasses: 0, descents: { stairs: 0, ramps: 0, skipped: 0 }, covered: 0, outlinePulled: 0, endsPulled: 0, underground, roundabouts };
  const { tunnels, mouths, short } = findTunnels(sorted.filter((r) => r.tags.kind === 'road'), lim);
  const under = underpasses(taken.filter((r) => r.tags.tunnel && r.tags.kind === 'path').map((r) => r.way), features);
  for (const r of taken) {
    if (!r.tags.tunnel || (r.tags.kind === 'road' && !short.has(r.way)) || under.has(r.way)) continue;
    r.tags = { ...r.tags, tunnel: false };
    if (!indoors.has(r)) stats.openTunnels++;
  }
  // The ways up from the underpasses' mouths go under with them, their stairs and ramps in their place
  const { descents, report: descentReport } = findDescents(taken, under, features);
  stats.descents = descentReport;
  const roads = taken.filter((r) => !indoors.has(r));
  stats.underpasses = roads.filter((r) => under.has(r.way)).length;
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
  const pavements = new Map<string, number | null>();
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
          else if (kind === 'bridge') edge.style = bridgeStyle(way.tags, tags.kind);
          else edge.surface = tags.surface;
          // Through a building (a passage, an arcade): the building stands over it
          if (tags.covered && !tags.tunnel && kind !== 'bridge') edge.covered = true;
          // The outline of a square: walked, not drawn (its surface shows it, convert/areas.ts)
          if (way.tags['area'] === 'yes' && kind !== 'bridge' && !tags.tunnel) edge.area = true;
          edges.push(edge);
          names.set(edge.id, way.tags['name'] ?? '');
          if (kind === 'road' && !tags.tunnel) pavements.set(edge.id, sidewalkTag(way.tags));
          stats.km[kind] += length / 1000;
          stats.kmByType[tags.type] = (stats.kmByType[tags.type] ?? 0) + length / 1000;
          if (kind === 'bridge') stats.bridges++;
        }
        start = k;
      }
    }
  }
  const paths = { nodes: [...nodes.values()], edges };
  // The squares' outlines off the walls of the houses round them: they hold no building off
  stats.outlinePulled = pullOutlines(paths, features);
  // A road that ends at a building ends in front of its wall: it cuts no building back along its line
  stats.endsPulled = pullDeadEnds(paths, features, lim);
  stats.covered = edges.filter((e) => e.covered).length;
  stats.nodes = nodes.size;
  stats.edges = edges.length;
  for (const key of ['road', 'path', 'bridge'] as const) stats.km[key] = round2(stats.km[key]);
  for (const key of Object.keys(stats.kmByType)) stats.kmByType[key] = round2(stats.kmByType[key]);
  return { paths, names, pavements, stats, tunnels, mouths, ramps, descents };
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
/** Railways that run over what they cross (not in a tunnel, not gone) */
const RAILS_OVER = new Set(['rail', 'light_rail', 'tram', 'subway', 'narrow_gauge', 'funicular', 'monorail', 'preserved', 'disused']);
/** Tracks a path tunnel passes under, at least, to run under a track field (a station's) rather than a line */
const TRACK_FIELD = 3;

/**
 * The footway and path tunnels under a track field: a station's subway,
 * passing under TRACK_FIELD tracks or more. They stay tunnel edges, out of
 * the picture and out of the levelling, their stairs ending at the mouths,
 * and so does every path tunnel joined to one (the stairs and spurs down to
 * it, which cross nothing themselves); no portals (those come with road
 * tunnels only, which gave a footway underpass a portal at every spur).
 * Opened like a path under one or two tracks (each track gets a bridge of
 * its own over it, rails.ts), the levelling cut it into the track bed as a
 * trench right across the station, an abutment of a bridge at every track
 */
function underpasses(tunnels: readonly OsmWay[], features: OsmFeatures): Set<OsmWay> {
  const out = new Set<OsmWay>();
  if (!tunnels.length) return out;
  const over = features.ways.filter((w) => {
    if (w.tags['tunnel'] && w.tags['tunnel'] !== 'no') return false;
    return RAILS_OVER.has(w.tags['railway'] ?? '');
  });
  for (const t of tunnels) {
    const tp = t.points;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of tp) {
      if (!p) continue;
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    let tracks = 0;
    for (const w of over) {
      crossing: for (let k = 1; k < w.points.length; k++) {
        const c = w.points[k - 1];
        const d = w.points[k];
        if (!c || !d || Math.max(c.x, d.x) < x0 || Math.min(c.x, d.x) > x1 || Math.max(c.y, d.y) < y0 || Math.min(c.y, d.y) > y1) continue;
        for (let i = 1; i < tp.length; i++) {
          const a = tp[i - 1];
          const b = tp[i];
          if (a && b && segmentsCross(a, b, c, d)) {
            tracks++;
            break crossing;
          }
        }
      }
    }
    if (tracks >= TRACK_FIELD) out.add(t);
  }
  // The stairs and spurs of an underpass go with it: path tunnels sharing a node with one kept, as far as they reach
  const byNode = new Map<number, OsmWay[]>();
  for (const t of tunnels) for (const id of t.nodes) byNode.set(id, [...(byNode.get(id) ?? []), t]);
  const queue = [...out];
  while (queue.length) {
    const t = queue.pop()!;
    for (const id of t.nodes) {
      for (const o of byNode.get(id) ?? []) {
        if (out.has(o)) continue;
        out.add(o);
        queue.push(o);
      }
    }
  }
  return out;
}

/** Whether a way's tags put it below the ground: a tunnel, or a layer under the ground's */
function belowGround(tags: Record<string, string>): boolean {
  return (!!tags['tunnel'] && tags['tunnel'] !== 'no') || parseInt(tags['layer'] ?? '0', 10) < 0;
}

/** Whether segment ab crosses segment cd (touching at an end does not count) */
function segmentsCross(a: MapPoint, b: MapPoint, c: MapPoint, d: MapPoint): boolean {
  const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(den) < 1e-12) return false;
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
  const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
}

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
  // flattenUnderPaths levels the edges in the order of the list it is given; the junctions after, on their ground
  flattenUnderPaths(terrain, { nodes: paths.nodes, edges }, null, ROAD_LEVELLING);
  flattenJunctions(terrain, paths, edges, ROAD_LEVELLING);
}

/** Metres a painted road fades into the ground beside it */
const PAINT_SOFT_EDGE = 0.75;
/**
 * Metres the floor of a covered way (a passage, a car park's entrance) is
 * paved beyond its half width, sharp: the opening a building cuts over it
 * is wider than the way (half a metre, more at a bend, a gate at least
 * 3.6 m, building-openings.ts), and its floor showed the grass under the
 * house beside the way
 */
const COVERED_FLOOR = 1.5;
/** The ground materials paintRoads paints for `paths`: the surfaces, and the verges of the paved roads */
export function roadPaintMaterials(paths: MapPaths): Set<string> {
  const out = new Set<string>();
  for (const edge of paths.edges) if (!edge.area) for (const band of roadPaintBands(edge, PAINT_SOFT_EDGE)) out.add(band.materials[0]);
  return out;
}

/**
 * The roads' surfaces painted into the ground (edges with `surface`): each
 * texel takes the material of the road that covers it most, full inside the
 * half width and fading over PAINT_SOFT_EDGE; under a paved road (drawn as
 * a road surface) its own material and a verge round it (roadPaintBands,
 * the editor's too); a square's outline (`area`) not at all. Adds the materials to the layer list as needed;
 * returns them.
 */
export function paintRoads(terrain: MapTerrain, paths: MapPaths): RoadSurface[] {
  const nodes = new Map(paths.nodes.map((n) => [n.id, n]));
  // Bands to paint: the paved roads' cores first, so where a verge meets a core the core keeps the texel
  const cores: PaintBand[] = [];
  const rims: PaintBand[] = [];
  for (const edge of paths.edges) {
    if (!edge.surface || edge.kind === 'bridge' || edge.area) continue;
    const a = nodes.get(edge.a);
    const b = nodes.get(edge.b);
    if (!a || !b) continue;
    const line = [a, ...(edge.via ?? []), b];
    for (const band of roadPaintBands(edge, PAINT_SOFT_EDGE)) (band.core ? cores : rims).push({ line, material: band.materials[0], half: band.half, soft: band.soft });
    if (edge.covered) cores.push({ line, material: edge.surface, half: edge.width / 2 + COVERED_FLOOR, soft: 0.05 });
  }
  return paintBands(terrain, [...cores, ...rims]) as RoadSurface[];
}

/** A band of ground material along a line: full over `half` metres either side, fading over `soft` */
export interface PaintBand {
  line: readonly MapPoint[];
  material: string;
  half: number;
  soft: number;
}

/**
 * Paints `bands` into the ground: each texel takes the material of the band
 * that covers it most (the first of two as strong), blended over what the
 * ground had by that cover. A material the ground lacks gets a layer while
 * there is room. Returns the materials that got a layer
 */
export function paintBands(terrain: MapTerrain, bands: readonly PaintBand[]): string[] {
  const res = terrain.splat.resolution;
  const alpha = new Float32Array(res * res);
  const layerOf = new Int8Array(res * res).fill(-1);
  const layers = terrain.layers;
  const used: string[] = [];
  const layerIndex = (material: string): number => {
    let k = layers.findIndex((l) => l.material === material);
    if (k < 0 && layers.length < MAX_LAYERS) {
      layers.push({ material });
      used.push(material);
      k = layers.length - 1;
    }
    return k;
  };
  const sx = res / terrain.width;
  const sy = res / terrain.depth;
  for (const band of bands) {
    const layer = layerIndex(band.material);
    if (layer < 0) continue;
    const { line, half, soft } = band;
    const outer = half + soft;
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
          const f = d <= half ? 1 : 1 - (d - half) / soft;
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
