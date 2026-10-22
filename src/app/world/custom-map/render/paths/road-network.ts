import type { MapPathEdge, MapPaths, MapPoint } from '../../map-document';
import { edgePolyline, type RoadCover } from './path-mask';
import { encodeRoadStyle, ORDER_STEP, PAVED_SURFACES, roadStyle, styleKey, type RoadStyle } from './road-style';
import { DRAPE_TILE, drapeTileKey } from '../drape/draped-layer';
import { conformDraped, type DrapedGeometry, type DrapeGround, type DrapeRect } from '../drape/draped-refine';

/**
 * The paved roads of a map as one surface (RoadSurfaceLayer draws it): a
 * ribbon along every road with its texture running along the centre line,
 * a junction where roads meet, rounded kerbs between them, and a rounded
 * end where a path stops. Edges with a paved surface (road-style.ts
 * PAVED_SURFACES) take part; bridges have their deck, tunnels their portal,
 * gravel and dirt stay painted into the ground.
 *
 * Edges meet end to end at nodes. Where two of one look meet and nothing
 * else, they run on as one ribbon (a chain: one polyline, its distance along
 * running on, no seam); anywhere else the node is a junction. A junction's
 * ribbons end where their kerbs meet the next road's, plus a kerb radius;
 * the polygon between their ends is the junction's own surface, its texture
 * running on from the widest road's and blending into each other road's
 * towards its end (no seam at any), its kerbs quadratic curves from one
 * road's edge to the next. A road's pavement (MapPathEdge.sidewalk) widens
 * its ribbon beyond the carriageway; the distance to the edge each vertex
 * carries is the kerb's, negative over the pavement.
 *
 * Map space throughout: x east, y north, triangles counter-clockwise seen
 * from above (front faces up once in the scene, map-coords.ts). Heights come
 * from the terrain in the vertex shader; with the ground given, the
 * triangles of each ribbon and junction are cut where the ground bends under
 * them (drape/draped-refine.ts), so between its vertices the surface lies on
 * the terrain's own triangles and the ground never comes through. Where a
 * ribbon meets its junction, both carry the same points on their shared
 * edges (the ribbon's end section), no crack between them. When the ground
 * changes (a brush), `reground` lays again what lies there. A whole map
 * (`update` with `later`) is laid flat at once and onto the ground a few
 * milliseconds at a time (`layOnGround`): a big map's roads take most of a
 * second. The vertices go into tiles of TILE metres, a mesh each, for
 * culling.
 */

/** Metres a side of a tile: the draped surfaces' (drape/draped-layer.ts) */
export const ROAD_TILE = DRAPE_TILE;
/**
 * Longest step between cross sections along a road. The ground is followed by cutting the triangles where it bends
 * (conformDraped), not by the sections: on ground that is one plane a road is a few long quads
 */
const STEP = 6;
/** Longest ribbon piece in one tile, metres */
const PIECE = 48;
/** Metres a cover (RoadNetworkBuilder.covers) stays inside a ribbon's edges: the ground's mask is read between texels */
const COVER_INSET = 0.25;
/** Points per kerb curve and per half of a path's round end */
const CURVE_POINTS = 6;

/**
 * One tile's geometry; per vertex: map position (2), across, along, distance
 * to the edge, look (encodeRoadStyle) (4), direction along (2), and in a
 * junction the frame of the road it runs into: across and along in it, its
 * turn against the junction's, its wear plus the weight of its texture (4)
 */
export interface RoadTile {
  key: string;
  /** Lower corner of the tile, map metres */
  x: number;
  y: number;
  position: Float32Array;
  road: Float32Array;
  dir: Float32Array;
  arm: Float32Array;
  index: Uint32Array;
}

export interface RoadNetwork {
  /** The tiles built anew (all on the first build; a tile rebuilt to nothing comes back empty) */
  tiles: RoadTile[];
  /** The looks the roads have, each once */
  styles: RoadStyle[];
  /** The surfaces in the order the looks name their layers (encodeRoadStyle): new ones join at the end */
  surfaces: string[];
  /** The layer of the pavements' surface among them, -1 while no road has one */
  sidewalk: number;
}

/** The surface of every pavement beside a road */
export const SIDEWALK_SURFACE = 'sidewalk';

/** Whether an edge is drawn by the road surface */
export function pavedEdge(edge: MapPathEdge): boolean {
  return edge.kind !== 'bridge' && !edge.tunnel && !edge.area && !!edge.surface && PAVED_SURFACES.has(edge.surface);
}

interface Chain {
  /** Its least edge id: the same whatever else changes */
  id: string;
  edge: MapPathEdge;
  edges: string[];
  nodes: [string, string];
  line: MapPoint[];
  /** Distance along at each point of `line` */
  at: number[];
  length: number;
  /** Half the ribbon's width: the carriageway's and the pavement beyond it */
  half: number;
  /** Metres of pavement either side */
  walk: number;
  style: number;
  trim: [number, number];
  /** Cross sections at both ends of the drawn ribbon, right to left seen along the ribbon */
  ends: [Section | null, Section | null];
  cap: [boolean, boolean];
  /** Inside a junction of several nodes (too short for a ribbon between them): the junction's surface covers it */
  inner: boolean;
}

interface Vertex {
  x: number;
  y: number;
  across: number;
  along: number;
  edge: number;
  style: number;
  dx: number;
  dy: number;
  /** In a junction: across and along in the frame of the road it runs into, that frame's turn, wear + weight */
  arm?: [number, number, number, number];
}

type Section = Vertex[];

interface End {
  chain: Chain;
  start: boolean;
  /** Its node */
  x: number;
  y: number;
  /** Unit direction away from the node */
  dx: number;
  dy: number;
  angle: number;
}

/** A tile's vertices and triangles as they grow */
class TileData {
  v: Float32Array = new Float32Array(64);
  r: Float32Array = new Float32Array(128);
  d: Float32Array = new Float32Array(64);
  a: Float32Array = new Float32Array(128);
  i: Uint32Array = new Uint32Array(192);
  vertices = 0;
  indices = 0;

  vertex(p: Vertex): void {
    const n = this.vertices;
    if (n * 2 + 2 > this.v.length) {
      this.v = grow(this.v);
      this.r = grow(this.r);
      this.d = grow(this.d);
      this.a = grow(this.a);
    }
    this.v[n * 2] = p.x;
    this.v[n * 2 + 1] = p.y;
    this.r[n * 4] = p.across;
    this.r[n * 4 + 1] = p.along;
    this.r[n * 4 + 2] = p.edge;
    this.r[n * 4 + 3] = p.style;
    this.d[n * 2] = p.dx;
    this.d[n * 2 + 1] = p.dy;
    if (p.arm) this.a.set(p.arm, n * 4);
    this.vertices++;
  }

  triangle(a: number, b: number, c: number): void {
    if (this.indices + 3 > this.i.length) this.i = grow(this.i);
    this.i[this.indices++] = a;
    this.i[this.indices++] = b;
    this.i[this.indices++] = c;
  }

  /** Its vertices and triangles as a draped geometry (views, no copy) */
  geometry(): DrapedGeometry {
    const n = this.vertices;
    return {
      position: this.v.subarray(0, n * 2),
      attributes: { r: { array: this.r.subarray(0, n * 4), itemSize: 4 }, d: { array: this.d.subarray(0, n * 2), itemSize: 2 }, a: { array: this.a.subarray(0, n * 4), itemSize: 4 } },
      index: this.i.subarray(0, this.indices),
    };
  }

  /** Takes a draped geometry's vertices and triangles (its own `geometry` laid onto the ground) */
  take(g: DrapedGeometry): void {
    this.v = g.position;
    this.r = g.attributes['r'].array;
    this.d = g.attributes['d'].array;
    this.a = g.attributes['a'].array;
    this.i = g.index;
    this.vertices = g.position.length / 2;
    this.indices = g.index.length;
  }
}

function grow<T extends Float32Array | Uint32Array>(a: T): T {
  const b = new (a.constructor as new (n: number) => T)(a.length * 2);
  b.set(a);
  return b;
}

/** The geometry of one ribbon or junction, by the tiles its pieces start in */
class TileBuilder {
  readonly tiles = new Map<string, TileData>();
  /** Edges shared with another item (x0, y0, x1, y1 each, as the vertices keep them): a ribbon's end sections */
  readonly shared: number[] = [];

  /** The edges between the points of a cross section, as shared with the item at its other side */
  share(section: readonly Vertex[]): void {
    for (let k = 0; k + 1 < section.length; k++) {
      this.shared.push(Math.fround(section[k].x), Math.fround(section[k].y), Math.fround(section[k + 1].x), Math.fround(section[k + 1].y));
    }
  }

  /** The tile holding a map point */
  tileAt(p: MapPoint): TileData {
    const key = drapeTileKey(p.x, p.y);
    let t = this.tiles.get(key);
    if (!t) {
      t = new TileData();
      this.tiles.set(key, t);
    }
    return t;
  }

  /** Adds triangles over `verts` (indices into them) to the tile of `verts[0]` */
  add(verts: readonly Vertex[], triangles: readonly number[]): void {
    if (!verts.length || !triangles.length) return;
    const t = this.tileAt(verts[0]);
    const base = t.vertices;
    for (const v of verts) t.vertex(v);
    for (let k = 0; k < triangles.length; k += 3) t.triangle(base + triangles[k], base + triangles[k + 1], base + triangles[k + 2]);
  }
}

/** What an edge was when last laid: its fields and points, compared field by field (no strings built) */
interface EdgeState {
  edge: MapPathEdge;
  /** a.x, a.y, b.x, b.y, width, pavement, then the via points */
  numbers: number[];
}

function edgeNumbers(e: MapPathEdge, nodes: ReadonlyMap<string, MapPoint>): number[] {
  const a = nodes.get(e.a);
  const b = nodes.get(e.b);
  const out = [a?.x ?? NaN, a?.y ?? NaN, b?.x ?? NaN, b?.y ?? NaN, e.width, e.sidewalk ?? 0];
  for (const p of e.via ?? []) out.push(p.x, p.y);
  return out;
}

function sameEdge(s: EdgeState, e: MapPathEdge, numbers: readonly number[]): boolean {
  const o = s.edge;
  if (o.a !== e.a || o.b !== e.b || o.kind !== e.kind || o.surface !== e.surface || o.street !== e.street || !!o.tunnel !== !!e.tunnel) return false;
  if (s.numbers.length !== numbers.length) return false;
  for (let k = 0; k < numbers.length; k++) if (s.numbers[k] !== numbers[k]) return false;
  return true;
}

/**
 * The road surface of a map's paths, kept between changes: `update` lays
 * again only what a change reaches and hands back the tiles that holds.
 * What a changed edge touches: the ribbons holding it, the ribbons meeting
 * those at their ends (their junction and so their trim may change), and
 * the junctions at the ends of all of them; the other ribbons and junctions
 * keep their geometry, and a rebuilt tile is put together from the pieces
 * of everything in it. A node dragged in the editor lays a few ribbons, not
 * the map.
 */
export class RoadNetworkBuilder {
  private readonly edges = new Map<string, EdgeState>();
  private readonly chains = new Map<string, Chain>();
  /** The chain each paved edge belongs to */
  private readonly chainOf = new Map<string, Chain>();
  /** Nodes where something not drawn here meets (a bridge, a tunnel, a track) */
  private others = new Set<string>();
  /** Pieces by item ('c' + chain id, 'j' + node id) and tile */
  private readonly pieces = new Map<string, Map<string, TileData>>();
  /** Items with pieces in each tile */
  private readonly tileItems = new Map<string, Set<string>>();
  /** Each item's box (x0, y0, x1, y1, map metres): what a change of the ground reaches */
  private readonly boxes = new Map<string, [number, number, number, number]>();
  /** The roads' ends at each junction laid (by its node, a cluster's least), to lay it again on new ground */
  private readonly junctionEnds = new Map<string, { node: MapPoint; ends: End[] }>();
  /** The cluster each node of a junction of several nodes is in (its least node), and their nodes */
  private readonly clusterOf = new Map<string, string>();
  private readonly members = new Map<string, string[]>();
  /** Items laid flat, to lay onto the ground later (layOnGround), with the edges they share */
  private readonly unlaid = new Map<string, number[]>();
  /** Tiles of items laid onto the ground since the last time layOnGround gave them */
  private readonly relaid = new Set<string>();
  /** Items laid now go flat into `unlaid` (update with `later`) */
  private later = false;
  private readonly styles: RoadStyle[] = [];
  private readonly surfaces: string[] = [];
  private readonly codes = new Map<string, number>();

  /** @param ground The terrain the roads lie on: their triangles are cut where it bends (none: flat between their vertices) */
  constructor(private readonly ground: DrapeGround | null = null) {}

  /**
   * Where the surface hides the ground (the path mask's covers): each
   * ribbon's centre line out to COVER_INSET short of its edges
   */
  covers(): RoadCover[] {
    const out: RoadCover[] = [];
    for (const c of this.chains.values()) if (c.half - COVER_INSET > 0.3) out.push({ id: c.id, line: c.line, half: c.half - COVER_INSET });
    return out;
  }

  /**
   * The paths as they are now: lays what changed, returns the tiles rebuilt.
   * `later`: flat for now, onto the ground with layOnGround
   */
  update(paths: MapPaths, later = false): RoadNetwork {
    this.later = later && !!this.ground;
    try {
      return this.lay(paths);
    } finally {
      this.later = false;
    }
  }

  /**
   * Lays the items `update` left flat onto the ground until `budgetMs` are
   * spent (one at least); once none is left, the tiles they are in (else
   * null: more to lay)
   */
  layOnGround(budgetMs: number): RoadNetwork | null {
    const start = performance.now();
    let laid = 0;
    for (const [item, shared] of this.unlaid) {
      if (laid++ && performance.now() - start >= budgetMs) return null;
      this.unlaid.delete(item);
      const tiles = this.pieces.get(item);
      if (!tiles) continue;
      this.conform(tiles, shared);
      for (const key of tiles.keys()) this.relaid.add(key);
    }
    const net = this.network(new Set(this.relaid));
    this.relaid.clear();
    return net;
  }

  private lay(paths: MapPaths): RoadNetwork {
    const nodes = new Map<string, MapPoint>(paths.nodes.map((n) => [n.id, n]));
    // The edges that changed, came or went, and the nodes they touch
    const touched = new Set<string>();
    const changed = new Set<string>();
    const seen = new Set<string>();
    const others = new Set<string>();
    const at = new Map<string, MapPathEdge[]>();
    for (const e of paths.edges) {
      if (!pavedEdge(e)) {
        others.add(e.a);
        others.add(e.b);
        continue;
      }
      seen.add(e.id);
      for (const n of [e.a, e.b]) {
        const list = at.get(n);
        if (list) list.push(e);
        else at.set(n, [e]);
      }
      const numbers = edgeNumbers(e, nodes);
      const s = this.edges.get(e.id);
      if (s && sameEdge(s, e, numbers)) continue;
      if (s) touched.add(s.edge.a).add(s.edge.b);
      touched.add(e.a).add(e.b);
      changed.add(e.id);
      this.edges.set(e.id, { edge: e, numbers });
    }
    for (const [id, s] of this.edges) {
      if (seen.has(id)) continue;
      touched.add(s.edge.a).add(s.edge.b);
      changed.add(id);
      this.edges.delete(id);
    }
    // A track or bridge coming or going at a node changes its round end
    for (const n of others) if (!this.others.has(n)) touched.add(n);
    for (const n of this.others) if (!others.has(n)) touched.add(n);
    this.others = others;

    // Chains holding a changed edge give their ends; every chain ending at a touched node is laid again
    const holds = (c: Chain) => c.edges.some((id) => changed.has(id));
    for (const c of this.chains.values()) if (holds(c)) c.nodes.forEach((n) => touched.add(n));
    const dropped: Chain[] = [];
    for (const c of this.chains.values()) if (holds(c) || touched.has(c.nodes[0]) || touched.has(c.nodes[1])) dropped.push(c);
    const rebuilt = new Set<string>();
    for (const c of dropped) {
      this.chains.delete(c.id);
      for (const id of c.edges) if (this.chainOf.get(id) === c) this.chainOf.delete(id);
      this.dropItem(`c${c.id}`, rebuilt);
    }

    // New chains from the free paved edges
    const made: Chain[] = [];
    for (const e of paths.edges) {
      if (!pavedEdge(e) || this.chainOf.has(e.id)) continue;
      const c = this.chain(e, at, nodes);
      if (!c) continue;
      made.push(c);
      this.chains.set(c.id, c);
    }

    // The junctions at every node a new chain ends at, then the geometry. Nodes a short chain joins, too close for a
    // ribbon between their junctions, are one junction (a cluster): with the nodes clustered with them before
    const lay = new Set<string>();
    for (const c of made) c.nodes.forEach((n) => lay.add(n));
    for (const n of touched) lay.add(n);
    for (const n of [...lay]) for (const m of this.members.get(this.clusterOf.get(n) ?? '') ?? []) lay.add(m);
    const endsAt = new Map<string, End[]>();
    const endsOf = (node: string): End[] => {
      let list = endsAt.get(node);
      if (list) return list;
      list = [];
      for (const e of at.get(node) ?? []) {
        const c = this.chainOf.get(e.id);
        if (!c) continue;
        for (const start of [true, false]) {
          if (c.nodes[start ? 0 : 1] !== node) continue;
          if (list.some((l) => l.chain === c && l.start === start)) continue;
          list.push(endOf(c, start));
        }
      }
      endsAt.set(node, list);
      return list;
    };
    // A cluster whose outline would fold over its middle (roads from its nodes side by side, crossing each other's
    // ends) is laid as its nodes alone
    const clusters = clusterJunctions(lay, endsOf).flatMap((group) => {
      if (group.length === 1) return [group];
      const inside = new Set(group);
      const list = group.flatMap((n) => endsOf(n)).filter((e) => !(inside.has(e.chain.nodes[0]) && inside.has(e.chain.nodes[1])));
      const centre = clusterCentre(group.map((n) => nodes.get(n)!));
      const trims = list.map((e) => [...e.chain.trim] as [number, number]);
      trimJunction(centre, list);
      const fits = list.length > 1 && outlineAround(centre, list);
      list.forEach((e, k) => (e.chain.trim = trims[k]));
      return fits ? [group] : group.map((n) => [n]);
    });
    // Trims of the kept chains at those nodes, to see whether they moved, and whether they were inside a cluster
    const laid = new Set(clusters.flat());
    const before = new Map<Chain, [number, number, boolean]>();
    for (const c of this.chains.values()) if (laid.has(c.nodes[0]) || laid.has(c.nodes[1])) before.set(c, [c.trim[0], c.trim[1], c.inner]);
    for (const nodeList of clusters) {
      const key = nodeList.reduce((p, q) => (q < p ? q : p));
      // The clusters these nodes were in go
      for (const n of nodeList) {
        const was = this.clusterOf.get(n) ?? n;
        this.dropItem(`j${was}`, rebuilt);
        this.junctionEnds.delete(was);
        for (const m of this.members.get(was) ?? []) if (this.clusterOf.get(m) === was) this.clusterOf.delete(m);
        this.members.delete(was);
      }
      const inside = new Set(nodeList);
      const list: End[] = [];
      for (const n of nodeList) {
        for (const e of endsOf(n)) {
          const inner = inside.has(e.chain.nodes[0]) && inside.has(e.chain.nodes[1]) && nodeList.length > 1;
          e.chain.inner = inner;
          if (!inner) list.push(e);
        }
      }
      if (nodeList.length > 1) {
        this.members.set(key, nodeList);
        for (const n of nodeList) this.clusterOf.set(n, key);
      }
      if (list.length === 1 && nodeList.length === 1) {
        const e = list[0];
        // A path that ends with nothing else there gets a round end; a road ends square
        e.chain.cap[e.start ? 0 : 1] = e.chain.edge.kind === 'path' && !others.has(key);
      } else if (list.length > 1) {
        const centre = clusterCentre(nodeList.map((n) => nodes.get(n)!));
        trimJunction(centre, list);
        this.junctionEnds.set(key, { node: centre, ends: list });
      }
    }
    // A kept chain whose trim moved (it ends at a junction laid again) or that went in or out of a cluster is laid again
    const fresh = new Set(made);
    for (const [c, was] of before) {
      if (fresh.has(c) || (was[0] === c.trim[0] && was[1] === c.trim[1] && was[2] === c.inner)) continue;
      this.dropItem(`c${c.id}`, rebuilt);
      made.push(c);
    }
    for (const c of made) if (!c.inner) this.putItem(`c${c.id}`, (out) => emitRibbon(c, out), rebuilt);
    for (const nodeList of clusters) {
      const key = nodeList.reduce((p, q) => (q < p ? q : p));
      const j = this.junctionEnds.get(key);
      if (j) this.putItem(`j${key}`, (out) => emitJunction(j.node, j.ends, out, this.styleOf), rebuilt);
    }
    return this.network(rebuilt);
  }

  /**
   * The ground changed in a map rectangle (all when omitted): the ribbons and
   * junctions there are laid again on it; the tiles rebuilt
   */
  reground(rect?: DrapeRect): RoadNetwork {
    const rebuilt = new Set<string>();
    if (this.ground) {
      const reached = (item: string) => {
        const b = this.boxes.get(item);
        return !!b && (!rect || (b[0] <= rect.maxX && b[2] >= rect.minX && b[1] <= rect.maxY && b[3] >= rect.minY));
      };
      // The ribbons first: their end sections are what the junctions join
      for (const c of this.chains.values()) {
        const item = `c${c.id}`;
        if (c.inner || !reached(item)) continue;
        this.dropItem(item, rebuilt);
        this.putItem(item, (out) => emitRibbon(c, out), rebuilt);
      }
      for (const [node, j] of this.junctionEnds) {
        const item = `j${node}`;
        if (!reached(item)) continue;
        this.dropItem(item, rebuilt);
        this.putItem(item, (out) => emitJunction(j.node, j.ends, out, this.styleOf), rebuilt);
      }
    }
    return this.network(rebuilt);
  }

  /**
   * An item's tiles onto the ground's triangles, all together (an edge two of its pieces share takes the same points
   * in both), its edges shared with other items with their points whatever its triangles there need
   */
  private conform(tiles: Map<string, TileData>, shared: readonly number[]): void {
    if (!this.ground) return;
    const list = [...tiles.values()];
    conformDraped(
      list.map((t) => t.geometry()),
      this.ground,
      { forced: shared },
    ).forEach((g, k) => g && list[k].take(g));
  }

  private network(rebuilt: Set<string>): RoadNetwork {
    return { tiles: [...rebuilt].map((key) => this.assemble(key)), styles: [...this.styles], surfaces: [...this.surfaces], sidewalk: this.surfaces.indexOf(SIDEWALK_SURFACE) };
  }

  /** The code of a look for the vertices, its surface given a layer on first sight */
  private readonly styleOf = (s: RoadStyle): number => {
    const key = styleKey(s);
    let code = this.codes.get(key);
    if (code === undefined) {
      if (!this.surfaces.includes(s.surface)) this.surfaces.push(s.surface);
      code = encodeRoadStyle(s, this.surfaces.indexOf(s.surface));
      this.styles.push(s);
      this.codes.set(key, code);
    }
    return code;
  };

  /** The chain through a free edge: edges of one look joined where they meet each other and nothing else */
  private chain(first: MapPathEdge, at: ReadonlyMap<string, MapPathEdge[]>, nodes: Map<string, MapPoint>): Chain | null {
    const key = styleKey(roadStyle(first));
    const taken = new Set<MapPathEdge>([first]);
    const next = (node: string, from: MapPathEdge): MapPathEdge | null => {
      const list = at.get(node) ?? [];
      if (list.length !== 2) return null;
      const o = list[0] === from ? list[1] : list[0];
      if (taken.has(o) || this.chainOf.has(o.id) || Math.abs(o.width - from.width) > 0.3 || Math.abs((o.sidewalk ?? 0) - (from.sidewalk ?? 0)) > 0.3) return null;
      if (styleKey(roadStyle(o)) !== key) return null;
      return o;
    };
    const first0 = edgePolyline(first, nodes);
    if (!first0) return null;
    const line: MapPoint[] = [...first0];
    const members = [first];
    // Forward from b, backward from a
    let tail = first.b;
    for (let e = next(tail, first); e; e = next(tail, e)) {
      const l = edgePolyline(e, nodes);
      if (!l) break;
      taken.add(e);
      members.push(e);
      const forward = e.a === tail;
      if (forward) for (let k = 1; k < l.length; k++) line.push(l[k]);
      else for (let k = l.length - 2; k >= 0; k--) line.push(l[k]);
      tail = forward ? e.b : e.a;
    }
    let head = first.a;
    const before: MapPoint[] = [];
    for (let e = next(head, first); e; e = next(head, e)) {
      const l = edgePolyline(e, nodes);
      if (!l) break;
      taken.add(e);
      members.push(e);
      const backward = e.b === head;
      // Points before the head, nearest first
      if (backward) for (let k = l.length - 2; k >= 0; k--) before.push(l[k]);
      else for (let k = 1; k < l.length; k++) before.push(l[k]);
      head = backward ? e.a : e.b;
    }
    const full = before.length ? [...before.reverse(), ...line] : line;
    const walk = Math.max(0, first.sidewalk ?? 0);
    const half = first.width / 2 + walk;
    // The pavements' texture joins the roads' at the end, as any new surface (their layers keep their place)
    if (walk > 0 && !this.surfaces.includes(SIDEWALK_SURFACE)) this.surfaces.push(SIDEWALK_SURFACE);
    const clean = roundCorners(dropDoubles(full), half);
    if (clean.length < 2) return null;
    const ids = members.map((e) => e.id);
    // Distance along from an offset of its own, the same whatever else changes: no two roads start their patches
    // and dashes alike
    const dist = [alongOffset(ids)];
    for (let k = 1; k < clean.length; k++) dist.push(dist[k - 1] + Math.hypot(clean[k].x - clean[k - 1].x, clean[k].y - clean[k - 1].y));
    const chain: Chain = {
      id: ids.reduce((a, b) => (b < a ? b : a)),
      edge: first,
      edges: ids,
      nodes: [head, tail],
      line: clean,
      at: dist,
      length: dist[dist.length - 1] - dist[0],
      half,
      walk,
      style: this.styleOf(roadStyle(first)) + orderOf(ids.reduce((a, b) => (b < a ? b : a))),
      trim: [0, 0],
      ends: [null, null],
      cap: [false, false],
      inner: false,
    };
    for (const id of ids) this.chainOf.set(id, chain);
    return chain;
  }

  private dropItem(item: string, rebuilt: Set<string>): void {
    const tiles = this.pieces.get(item);
    if (!tiles) return;
    for (const key of tiles.keys()) {
      this.tileItems.get(key)?.delete(item);
      rebuilt.add(key);
    }
    this.pieces.delete(item);
    this.boxes.delete(item);
    this.unlaid.delete(item);
  }

  private putItem(item: string, emit: (out: TileBuilder) => void, rebuilt: Set<string>): void {
    const out = new TileBuilder();
    emit(out);
    if (!out.tiles.size) return;
    const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const t of out.tiles.values()) {
      for (let k = 0; k < t.vertices * 2; k += 2) {
        box[0] = Math.min(box[0], t.v[k]);
        box[1] = Math.min(box[1], t.v[k + 1]);
        box[2] = Math.max(box[2], t.v[k]);
        box[3] = Math.max(box[3], t.v[k + 1]);
      }
    }
    this.boxes.set(item, box);
    if (this.later) this.unlaid.set(item, out.shared);
    else this.conform(out.tiles, out.shared);
    this.pieces.set(item, out.tiles);
    for (const key of out.tiles.keys()) {
      let set = this.tileItems.get(key);
      if (!set) {
        set = new Set();
        this.tileItems.set(key, set);
      }
      set.add(item);
      rebuilt.add(key);
    }
  }

  /** A tile's geometry: the pieces of everything in it, one after another */
  private assemble(key: string): RoadTile {
    const parts: TileData[] = [];
    for (const item of this.tileItems.get(key) ?? []) {
      const p = this.pieces.get(item)?.get(key);
      if (p) parts.push(p);
    }
    const vertices = parts.reduce((s, p) => s + p.vertices, 0);
    const indices = parts.reduce((s, p) => s + p.indices, 0);
    const tile: RoadTile = {
      key,
      x: Number(key.split(',')[0]) * ROAD_TILE,
      y: Number(key.split(',')[1]) * ROAD_TILE,
      position: new Float32Array(vertices * 2),
      road: new Float32Array(vertices * 4),
      dir: new Float32Array(vertices * 2),
      arm: new Float32Array(vertices * 4),
      index: new Uint32Array(indices),
    };
    let v = 0;
    let i = 0;
    for (const p of parts) {
      tile.position.set(p.v.subarray(0, p.vertices * 2), v * 2);
      tile.road.set(p.r.subarray(0, p.vertices * 4), v * 4);
      tile.dir.set(p.d.subarray(0, p.vertices * 2), v * 2);
      tile.arm.set(p.a.subarray(0, p.vertices * 4), v * 4);
      for (let k = 0; k < p.indices; k++) tile.index[i + k] = p.i[k] + v;
      v += p.vertices;
      i += p.indices;
    }
    return tile;
  }
}

/** The road surface of `paths` in one go (all tiles) */
export function buildRoadNetwork(paths: MapPaths): RoadNetwork {
  return new RoadNetworkBuilder().update(paths);
}

/** A chain's end at its start or its finish: its direction away from the node, over its first three metres */
function endOf(chain: Chain, start: boolean): End {
  const p = start ? chain.line[0] : chain.line[chain.line.length - 1];
  const reach = Math.min(3, chain.length * 0.3);
  const q = pointAt(chain, chain.at[0] + (start ? reach : chain.length - reach));
  const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  const end: End = { chain, start, x: p.x, y: p.y, dx: (q.x - p.x) / l, dy: (q.y - p.y) / l, angle: 0 };
  end.angle = Math.atan2(end.dy, end.dx);
  return end;
}

/**
 * Trim lengths of the roads meeting at a junction: past where each road's kerb meets the next, plus a kerb radius.
 * The ends in counter-clockwise order around `c` (a cluster's ends start at their own nodes)
 */
function trimJunction(c: MapPoint, list: End[]): void {
  const trims = wantedTrims(c, list);
  const widest = Math.max(...list.map((e) => e.chain.half));
  list.forEach((e, k) => {
    const limit = Math.min(e.chain.length * 0.45, widest * 4 + 6);
    e.chain.trim[e.start ? 0 : 1] = Math.max(0, Math.min(limit, trims[k]));
  });
}

/** The trims a junction's ends want (trimJunction, before the limits), the list sorted counter-clockwise around `c` */
function wantedTrims(c: MapPoint, list: End[]): number[] {
  // Around the centre by a point some metres out along each road: ends from nodes a few metres apart sort as seen
  for (const e of list) e.angle = Math.atan2(e.y + e.dy * 8 - c.y, e.x + e.dx * 8 - c.x);
  list.sort((a, b) => a.angle - b.angle);
  const n = list.length;
  const trims = list.map(() => 0);
  for (let k = 0; k < n; k++) {
    const a = list[k];
    const b = list[(k + 1) % n];
    let gap = Math.atan2(b.dy, b.dx) - Math.atan2(a.dy, a.dx);
    if (gap <= 0) gap += Math.PI * 2;
    // Nearly straight on, or the outside of a bend: the kerbs meet at the node. A road going on at another width
    // tapers instead: both trimmed by twice the change and a metre, the junction's straight kerbs run across
    // (they stepped at the node, a tooth in the kerb at every change of width)
    if (n === 2 && gap > Math.PI * 0.94) {
      const taper = Math.abs(a.chain.half - b.chain.half);
      if (taper > 0.3) {
        trims[k] = Math.max(trims[k], taper * 2 + 1);
        trims[(k + 1) % n] = Math.max(trims[(k + 1) % n], taper * 2 + 1);
      }
      continue;
    }
    if (gap > Math.PI * 0.94 || n === 1) continue;
    const corner = kerbCorner(a, b);
    if (!corner) continue;
    const radius = Math.min(6, Math.max(0.5, Math.min(a.chain.half, b.chain.half) * 0.8 + (a.chain.edge.kind === 'path' ? 0 : 1)));
    trims[k] = Math.max(trims[k], corner.t + radius);
    trims[(k + 1) % n] = Math.max(trims[(k + 1) % n], corner.s + radius);
  }
  return trims;
}

/** Longest chain between two junctions that may join them into one */
const CLUSTER_CHAIN = 16;
/** Widest a junction of several nodes may grow (its nodes' box, metres) */
const CLUSTER_SPAN = 24;

/**
 * The junctions to lay at `lay`'s nodes: a node alone, or several a short
 * chain joins where their junctions want more room than the chain has
 * (their trims together past nine tenths of it, wantedTrims): a ribbon
 * there would be a sliver, the two junctions' kerbs crossing each other's
 * surface. Grows over such chains to nodes beyond `lay`; shortest chains
 * first, a cluster no wider than CLUSTER_SPAN. Each list sorted
 */
function clusterJunctions(lay: ReadonlySet<string>, endsOf: (node: string) => End[]): string[][] {
  const wanted = new Map<string, Map<End, number>>();
  const wants = (node: string): Map<End, number> => {
    let m = wanted.get(node);
    if (!m) {
      const list = endsOf(node);
      m = new Map();
      if (list.length > 1) {
        const sorted = [...list];
        const trims = wantedTrims(list[0], sorted);
        sorted.forEach((e, k) => m!.set(e, trims[k]));
      }
      wanted.set(node, m);
    }
    return m;
  };
  // The short chains reachable from the nodes to lay, each once, shortest first
  const short: { chain: Chain; a: string; b: string }[] = [];
  const seen = new Set<Chain>();
  const nodes = new Set(lay);
  const queue = [...lay];
  while (queue.length) {
    const node = queue.pop()!;
    for (const e of endsOf(node)) {
      const c = e.chain;
      if (seen.has(c)) continue;
      seen.add(c);
      const [a, b] = c.nodes;
      if (a === b || c.length > CLUSTER_CHAIN) continue;
      const ea = endsOf(a).find((x) => x.chain === c && x.start);
      const eb = endsOf(b).find((x) => x.chain === c && !x.start);
      if (!ea || !eb || endsOf(a).length < 2 || endsOf(b).length < 2) continue;
      if ((wants(a).get(ea) ?? 0) + (wants(b).get(eb) ?? 0) <= c.length * 0.9) continue;
      short.push({ chain: c, a, b });
      for (const n of [a, b]) {
        if (nodes.has(n)) continue;
        nodes.add(n);
        queue.push(n);
      }
    }
  }
  short.sort((p, q) => p.chain.length - q.chain.length);
  // Union, keeping each cluster's box within the span
  const parent = new Map<string, string>();
  const box = new Map<string, [number, number, number, number]>();
  const root = (n: string): string => {
    let r = n;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const point = (n: string): MapPoint => {
    for (const e of endsOf(n)) return { x: e.x, y: e.y };
    return { x: 0, y: 0 };
  };
  for (const n of nodes) {
    parent.set(n, n);
    const p = point(n);
    box.set(n, [p.x, p.y, p.x, p.y]);
  }
  for (const { a, b } of short) {
    const ra = root(a);
    const rb = root(b);
    if (ra === rb) continue;
    const p = box.get(ra)!;
    const q = box.get(rb)!;
    const joined: [number, number, number, number] = [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[2], q[2]), Math.max(p[3], q[3])];
    if (Math.hypot(joined[2] - joined[0], joined[3] - joined[1]) > CLUSTER_SPAN) continue;
    parent.set(rb, ra);
    box.set(ra, joined);
  }
  const groups = new Map<string, string[]>();
  for (const n of nodes) {
    const r = root(n);
    const g = groups.get(r);
    if (g) g.push(n);
    else groups.set(r, [n]);
  }
  return [...groups.values()].map((g) => g.sort());
}

/**
 * Whether a junction's outline (its roads' end sections in order, sorted by
 * trimJunction) runs once round its middle, counter-clockwise: a fan from
 * the middle covers it without a fold
 */
function outlineAround(c: MapPoint, list: readonly End[]): boolean {
  const ring: MapPoint[] = [];
  for (const e of list) {
    const chain = e.chain;
    const d = e.start ? chain.at[0] + chain.trim[0] : chain.at[0] + chain.length - chain.trim[1];
    const p = pointAt(chain, d);
    // Right, then left, looking away from the node
    const s = e.start ? 1 : -1;
    const t = tangentAt(chain, d);
    ring.push({ x: p.x + t.y * chain.half * s, y: p.y - t.x * chain.half * s }, { x: p.x - t.y * chain.half * s, y: p.y + t.x * chain.half * s });
  }
  let turn = 0;
  for (let k = 0; k < ring.length; k++) {
    const p = ring[k];
    const q = ring[(k + 1) % ring.length];
    if ((p.x - c.x) * (q.y - c.y) - (p.y - c.y) * (q.x - c.x) <= 0) return false;
    turn += Math.atan2((p.x - c.x) * (q.y - c.y) - (p.y - c.y) * (q.x - c.x), (p.x - c.x) * (q.x - c.x) + (p.y - c.y) * (q.y - c.y));
  }
  return Math.abs(turn - Math.PI * 2) < 0.01;
}

/** The middle of a junction's nodes */
function clusterCentre(points: readonly MapPoint[]): MapPoint {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/**
 * Where road a's left kerb meets road b's right kerb (b the next road
 * counter-clockwise), as distances along each from its node; null when they
 * do not meet in front of both
 */
function kerbCorner(a: End, b: End): { t: number; s: number; x: number; y: number } | null {
  const ha = a.chain.half;
  const hb = b.chain.half;
  // a's left kerb: pa + na * ha + da * t; b's right kerb: pb - nb * hb + db * s
  const nax = -a.dy;
  const nay = a.dx;
  const nbx = -b.dy;
  const nby = b.dx;
  const rx = b.x - nbx * hb - (a.x + nax * ha);
  const ry = b.y - nby * hb - (a.y + nay * ha);
  // da * t - db * s = r
  const det = a.dx * -b.dy - a.dy * -b.dx;
  if (Math.abs(det) < 1e-6) return null;
  const t = (rx * -b.dy - ry * -b.dx) / det;
  const s = (a.dx * ry - a.dy * rx) / det;
  if (t < -1e-6 || s < -1e-6) return null;
  return { t: Math.max(0, t), s: Math.max(0, s), x: a.x + nax * ha + a.dx * t, y: a.y + nay * ha + a.dy * t };
}

/** The ribbon of a chain between its trims, with its round ends, into the tiles; keeps its end sections for the junctions */
function emitRibbon(chain: Chain, out: TileBuilder): void {
  const o = chain.at[0];
  let from = o + chain.trim[0];
  let to = o + chain.length - chain.trim[1];
  // Trimmed away between two junctions: one section where they meet, no ribbon
  if (to - from < 0.05) from = to = Math.max(o, Math.min(o + chain.length, (from + to) / 2));
  // Distances of the cross sections: the polyline's points in range, steps of at most STEP between
  const stops: number[] = [from];
  for (let k = 1; k < chain.at.length; k++) {
    const d = chain.at[k];
    if (d <= from) continue;
    const end = Math.min(d, to);
    const last = stops[stops.length - 1];
    const steps = Math.ceil((end - last) / STEP - 1e-6);
    for (let s = 1; s <= steps; s++) stops.push(last + ((end - last) * s) / steps);
    if (d >= to) break;
  }
  if (to <= from) stops.length = 1;
  const h = chain.half;
  // Three columns: the distance to the edge peaks in the middle (the ground's bends cut the triangles, conformDraped)
  const columns = [-1, 0, 1];
  const sections: Section[] = stops.map((d) => {
    const p = pointAt(chain, d);
    const t = tangentAt(chain, d);
    // Mitred at a corner: the offset grows as the corner sharpens, at most twice the width
    const nx = -t.y * t.scale;
    const ny = t.x * t.scale;
    return columns.map((u) => ({
      x: p.x + nx * u * h,
      y: p.y + ny * u * h,
      across: u * h,
      along: d,
      edge: h * (1 - Math.abs(u)) - chain.walk,
      style: chain.style,
      dx: t.x,
      dy: t.y,
    }));
  });
  chain.ends = [sections[0], sections[sections.length - 1]];
  out.share(sections[0]);
  if (sections.length > 1) out.share(sections[sections.length - 1]);
  // Pieces of at most PIECE metres, each into the tile it starts in
  const w = columns.length;
  let first = 0;
  while (first < sections.length - 1) {
    let last = first + 1;
    while (last < sections.length - 1 && stops[last] - stops[first] < PIECE) last++;
    const tile = out.tileAt(sections[first][0]);
    const base = tile.vertices;
    for (let r = first; r <= last; r++) for (const v of sections[r]) tile.vertex(v);
    for (let r = 0; r < last - first; r++) {
      for (let col = 0; col < w - 1; col++) {
        const a = base + r * w + col;
        tile.triangle(a, a + w, a + w + 1);
        tile.triangle(a, a + w + 1, a + 1);
      }
    }
    first = last;
  }
  if (chain.cap[0]) emitCap(sections[0], -1, out);
  if (chain.cap[1]) emitCap(sections[sections.length - 1], 1, out);
}

/**
 * A half disc beyond an end section: `sign` +1 beyond the ribbon's end, -1
 * before its start. Its straight side is the section itself, every point of
 * it: the cap and the ribbon meet on the same vertices, no crack once both
 * lie on the ground's triangles
 */
function emitCap(section: Section, sign: number, out: TileBuilder): void {
  const mid = section[(section.length - 1) / 2];
  const h = (section[section.length - 1].across - section[0].across) / 2;
  // From the right edge round the far side to the left one, then back along the section
  const ring: Vertex[] = [section[0]];
  for (let k = 1; k < CURVE_POINTS * 2; k++) {
    const a = (k / (CURVE_POINTS * 2)) * Math.PI;
    const across = -Math.cos(a) * h;
    const ahead = Math.sin(a) * h * sign;
    ring.push({
      x: mid.x + mid.dx * ahead - mid.dy * across,
      y: mid.y + mid.dy * ahead + mid.dx * across,
      across,
      along: mid.along + ahead,
      edge: 0,
      style: mid.style,
      dx: mid.dx,
      dy: mid.dy,
    });
  }
  for (let k = section.length - 1; k > 0; k--) ring.push(section[k]);
  // Fanned from the far side's middle (counter-clockwise beyond the end, clockwise before the start)
  const apex = CURVE_POINTS;
  const tris: number[] = [];
  for (let k = 0; k < ring.length; k++) {
    const next = (k + 1) % ring.length;
    if (k === apex || next === apex) continue;
    if (sign > 0) tris.push(apex, k, next);
    else tris.push(apex, next, k);
  }
  out.add(ring, tris);
}

/** The surface between the ends of the roads at a junction, fanned from its node */
function emitJunction(c: MapPoint, list: End[], out: TileBuilder, styleOf: (s: RoadStyle) => number): void {
  // The ends in counter-clockwise order (trimJunction sorted them), each with its cross section seen from the node:
  // right to left looking away from it
  const sides = list.map((e) => {
    const s = e.chain.ends[e.start ? 0 : 1];
    if (!s) return null;
    return e.start ? s : [...s].reverse();
  });
  if (sides.some((s) => !s)) return;
  // The widest road's texture runs on over the junction; its kerbs go round the corners where any road has them
  let main = 0;
  for (let k = 1; k < list.length; k++) if (list[k].chain.half > list[main].chain.half) main = k;
  const m = list[main];
  const look = roadStyle(m.chain.edge, true);
  look.gutter ||= list.some((e) => roadStyle(e.chain.edge).gutter);
  const style = styleOf(look) + orderOf(`j${c.x},${c.y}`);
  // Each road's frame at its end: the middle of its end section and its direction there (the ribbon's own)
  const frames = sides.map((side) => side![(side!.length - 1) / 2]);
  const wears = list.map((e) => Math.round(roadStyle(e.chain.edge).wear * 31));
  const at = (x: number, y: number, f: Vertex): [number, number] => [(x - f.x) * -f.dy + (y - f.y) * f.dx, f.along + (x - f.x) * f.dx + (y - f.y) * f.dy];
  const mf = frames[main];
  const vertex = (p: RingPoint, arm: number, weight: number): Vertex => {
    const [across, along] = at(p.x, p.y, mf);
    const f = frames[arm];
    const [armAcross, armAlong] = at(p.x, p.y, f);
    return {
      x: p.x,
      y: p.y,
      across,
      along,
      edge: p.edge,
      style,
      dx: mf.dx,
      dy: mf.dy,
      arm: [armAcross, armAlong, Math.atan2(f.dy, f.dx) - Math.atan2(mf.dy, mf.dx), wears[arm] + weight * 0.99],
    };
  };
  // The ring: each road's end section, then the kerb to the next road (a curve through where both kerbs would meet,
  // else straight); a point of a section belongs to its road, a kerb point to the nearer of the two
  interface RingPoint {
    x: number;
    y: number;
    edge: number;
    arm: number;
    side: boolean;
  }
  const ring: RingPoint[] = [];
  const n = list.length;
  // A kerb between two roads without one gets none: its points lie past the gutter's width from the edge
  const kerbs = list.map((e) => roadStyle(e.chain.edge).gutter);
  for (let k = 0; k < n; k++) {
    const kerbEdge = look.gutter && !kerbs[k] && !kerbs[(k + 1) % n] ? 0.6 : 0;
    const side = sides[k]!;
    for (const v of side) ring.push({ x: v.x, y: v.y, edge: v.edge, arm: k, side: true });
    out.share(side);
    const a = side[side.length - 1];
    const b = sides[(k + 1) % n]![0];
    const cross = lineMeet(a, list[k], b, list[(k + 1) % n]);
    // The outline runs round the pavements: from one road's to the next's
    const walkA = list[k].chain.walk;
    const walkB = list[(k + 1) % n].chain.walk;
    if (cross) {
      for (let s = 1; s < CURVE_POINTS; s++) {
        const t = s / CURVE_POINTS;
        const u = 1 - t;
        ring.push({ x: u * u * a.x + 2 * u * t * cross.x + t * t * b.x, y: u * u * a.y + 2 * u * t * cross.y + t * t * b.y, edge: kerbEdge - (walkA * u + walkB * t), arm: s * 2 <= CURVE_POINTS ? k : (k + 1) % n, side: false });
      }
    } else {
      // A straight kerb: its middle parts the two roads' frames
      ring.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, edge: kerbEdge - (walkA + walkB) / 2, arm: k, side: false });
    }
  }
  // The node lies on the widest road, its kerbs that road's half carriageway away: the distance to the edge runs from
  // there to the ring, so the kerbs cross the junction where that road's run. A narrower way's half (a footway
  // joining) pulled them in towards the node, the pavement bulging into the carriageway on both sides of each
  // junction like the teeth of a saw
  const centre: RingPoint = { x: c.x, y: c.y, edge: m.chain.half - m.chain.walk, arm: main, side: false };
  // Fanned from the node, each triangle in one road's frame: near a road's end its texture takes over from the
  // junction's (the weight, 1 on the end section, 0 at the node and on the kerbs), so no seam shows at any end
  const verts: Vertex[] = [];
  const tris: number[] = [];
  for (let k = 0; k < ring.length; k++) {
    const p = ring[k];
    const q = ring[(k + 1) % ring.length];
    // Skip slivers the wrong way round (a ring folding over the node at a very sharp junction)
    if ((p.x - c.x) * (q.y - c.y) - (p.y - c.y) * (q.x - c.x) <= 0) continue;
    const arm = p.side ? p.arm : q.side ? q.arm : p.arm;
    const base = verts.length;
    verts.push(vertex(centre, arm, 0), vertex(p, arm, p.side && p.arm === arm ? 1 : 0), vertex(q, arm, q.side && q.arm === arm ? 1 : 0));
    tris.push(base, base + 1, base + 2);
  }
  out.add(verts, tris);
}

/**
 * Where the kerb line through `a` (along road ea, back towards the node) meets
 * the one through `b` (along eb): the control point of the kerb curve; null
 * when they meet behind either end or not at all
 */
function lineMeet(a: Vertex, ea: End, b: Vertex, eb: End): MapPoint | null {
  // a - ea.d * p = b - eb.d * q
  const det = -ea.dx * eb.dy + ea.dy * eb.dx;
  if (Math.abs(det) < 1e-4) return null;
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  // -ea.d * p + eb.d * q = r
  const p = (rx * eb.dy - ry * eb.dx) / det;
  const q = (-ea.dx * ry + ea.dy * rx) / det;
  if (p < 0 || q < 0) return null;
  return { x: a.x - ea.dx * p, y: a.y - ea.dy * p };
}

/** The point at a distance along a chain */
function pointAt(chain: Chain, d: number): MapPoint {
  const { line, at } = chain;
  const k = segmentAt(at, d);
  const span = at[k] - at[k - 1] || 1;
  const t = Math.min(1, Math.max(0, (d - at[k - 1]) / span));
  return { x: line[k - 1].x + (line[k].x - line[k - 1].x) * t, y: line[k - 1].y + (line[k].y - line[k - 1].y) * t };
}

/**
 * Unit direction at a distance along a chain, and the mitre's stretch of
 * the offset: at a point of the line the mean of its two segments, the
 * offset lengthened so both kerbs keep their width (at most twice)
 */
function tangentAt(chain: Chain, d: number): { x: number; y: number; scale: number } {
  const { line, at } = chain;
  const seg = (k: number): MapPoint => {
    const a = line[Math.max(0, Math.min(line.length - 2, k))];
    const b = line[Math.max(1, Math.min(line.length - 1, k + 1))];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  };
  const k = segmentAt(at, d - 1e-6);
  const here = seg(k - 1);
  // On a point of the line (not its ends): mitre between the segments either side
  if (k < at.length - 1 && Math.abs(at[k] - d) < 1e-6) {
    const after = seg(k);
    const mx = here.x + after.x;
    const my = here.y + after.y;
    const l = Math.hypot(mx, my);
    if (l < 1e-6) return { ...here, scale: 1 };
    const cos = (mx / l) * here.x + (my / l) * here.y;
    return { x: mx / l, y: my / l, scale: 1 / Math.max(0.5, cos) };
  }
  return { ...here, scale: 1 };
}

/** The first index k >= 1 with at[k] >= d (the last when none): the segment k - 1 .. k holding distance d */
function segmentAt(at: readonly number[], d: number): number {
  let lo = 1;
  let hi = at.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (at[mid] < d) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Where two ribbons or junctions of one rank overlap without meeting (a
 * footway crossing another, a slip road over a street's pavement), which
 * lies over which: an order within the rank from an id (0 to 15, in the
 * look's top bits, ORDER_STEP; road-surface.ts draws each step a little
 * nearer). On the ground's own triangles two of one rank would lie at one
 * depth and fight
 */
function orderOf(id: string): number {
  let h = 2166136261;
  for (let k = 0; k < id.length; k++) h = Math.imul(h ^ id.charCodeAt(k), 16777619);
  return ((h >>> 0) % 16) * ORDER_STEP;
}

/** A chain's start of distance along, from its edges' ids (the least): 0.5 to 997 m */
function alongOffset(edges: readonly string[]): number {
  const id = edges.reduce((a, b) => (b < a ? b : a));
  let h = 2166136261;
  for (let k = 0; k < id.length; k++) h = Math.imul(h ^ id.charCodeAt(k), 16777619);
  return ((h >>> 0) % 997) + 0.5;
}

/** Points closer than 5 cm to the previous one left out */
function dropDoubles(line: readonly MapPoint[]): MapPoint[] {
  const out: MapPoint[] = [];
  for (const p of line) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 0.05) out.push(p);
  }
  return out;
}

/**
 * Corners of the line rounded off: a corner turning more than 8 degrees
 * becomes a curve (quadratic, through points every 10 degrees) that leaves
 * each segment up to 40% of its length before the corner, at most 1.5 road
 * widths; OSM lines are straight between their nodes, and a wide road's
 * kerb at a mitred corner read as a kink
 */
function roundCorners(line: readonly MapPoint[], half: number): MapPoint[] {
  if (line.length < 3) return [...line];
  const out: MapPoint[] = [line[0]];
  for (let k = 1; k < line.length - 1; k++) {
    const a = line[k - 1];
    const p = line[k];
    const b = line[k + 1];
    const la = Math.hypot(p.x - a.x, p.y - a.y);
    const lb = Math.hypot(b.x - p.x, b.y - p.y);
    const cos = ((p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y)) / (la * lb || 1);
    const turn = Math.acos(Math.max(-1, Math.min(1, cos)));
    if (turn < (8 * Math.PI) / 180) {
      out.push(p);
      continue;
    }
    const cut = Math.min(0.4 * la, 0.4 * lb, 3 * half);
    const s = { x: p.x + ((a.x - p.x) * cut) / la, y: p.y + ((a.y - p.y) * cut) / la };
    const e = { x: p.x + ((b.x - p.x) * cut) / lb, y: p.y + ((b.y - p.y) * cut) / lb };
    const steps = Math.max(2, Math.ceil(turn / ((10 * Math.PI) / 180)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      out.push({ x: u * u * s.x + 2 * u * t * p.x + t * t * e.x, y: u * u * s.y + 2 * u * t * p.y + t * t * e.y });
    }
  }
  out.push(line[line.length - 1]);
  return out;
}
