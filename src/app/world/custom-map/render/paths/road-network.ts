import { ShapeUtils, Vector2 } from 'three';
import type { MapPathEdge, MapPaths, MapPoint } from '../../map-document';
import { edgePolyline, type RoadCover } from './path-mask';
import { encodeRoadStyle, ORDER_STEP, PAVED_SURFACES, roadStyle, styleKey, type RoadStyle } from './road-style';
import { DRAPE_TILE, drapeTileKey } from '../drape/draped-layer';
import { conformDraped, type DrapedGeometry, type DrapeGround, type DrapeRect } from '../drape/draped-refine';
import type { DrapedConformPool } from '../drape/draped-conform-pool';
import type { ConformJob } from '../drape/draped-conform-protocol';

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
/** A junction's cover has no centre line (its `ring`) */
const NO_LINE: readonly MapPoint[] = [];
/** Metres a cover (RoadNetworkBuilder.covers) stays inside a ribbon's edges: the ground's mask is read between texels */
const COVER_INSET = 0.25;
/** Points per kerb curve and per half of a path's round end; a longer kerb curve a point every KERB_STEP m, up to KERB_POINTS */
const CURVE_POINTS = 6;
const KERB_STEP = 1.25;
const KERB_POINTS = 24;
/**
 * A junction vertex's arm weight (0 to 1) rides in the fraction of its wear
 * (a whole number): from ARM_WEIGHT_BASE over ARM_WEIGHT_SPAN, well clear of
 * the whole numbers. Interpolated across a triangle, a weight of 0 laid on
 * the whole number itself came out a hair under it at some pixels, its
 * fraction then nearly 1: the road's texture and its wear flipped per pixel,
 * and every junction flickered with each move of the camera
 */
export const ARM_WEIGHT_BASE = 0.25;
/** Highest rank (RoadStyle.rank) that meets a kerbed road at a junction without kerbs of its own: service roads and paths */
const MOUTH_RANK = 2;
/** Metres past the kerb a mouth's edge reads (MOUTH_RANK): beyond the kerb and its gutter, so none is drawn there */
const MOUTH_EDGE = 0.8;
export const ARM_WEIGHT_SPAN = 0.5;

/**
 * One tile's geometry; per vertex: map position (2), across, along, distance
 * to the edge, look (encodeRoadStyle) (4), direction along (2), and in a
 * junction the frame of the road it runs into: across and along in it, its
 * turn against the junction's, its wear with the weight of its texture in
 * the fraction (ARM_WEIGHT_BASE; 0 on a ribbon) (4)
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
  /**
   * The first metres of a bridge's deck at a junction (bridgeStub): an arm of the junction whose surface the deck
   * is, never drawn here; its end section lies at the node
   */
  stub?: boolean;
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
  /** In a junction: across and along in the frame of the road it runs into, that frame's turn, its wear and weight (ARM_WEIGHT_BASE) */
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
  /** The bridges as last laid (their decks are arms of junctions, bridgeStub) */
  private readonly decks = new Map<string, EdgeState>();
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
  private readonly junctionEnds = new Map<string, { node: MapPoint; ends: End[]; inner: Chain[] }>();
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
   * ribbon's centre line as drawn, between its trims, out to COVER_INSET
   * short of its edges, and each junction's outline (`ring`, painted
   * COVER_INSET inside it). A ribbon's cover to the node reached past the
   * junction's kerbs where a road narrows on or bends away (the bare ground's
   * grey in a wedge beside the surface); without a cover in the junction,
   * grass grew through its pavements. Each carries its drawn edge (`edge`,
   * where the grass stops); a ribbon too narrow for a cover only that
   */
  covers(): RoadCover[] {
    const out: RoadCover[] = [];
    for (const c of this.chains.values()) {
      if (c.inner) continue;
      const [from, to] = ribbonSpan(c);
      if (to - from < 0.5) continue;
      // The same cover while the ribbon is the same (the editor sends only the covers that changed, by identity)
      const was = this.coverOf.get(c);
      if (was && was.from === from && was.to === to && was.line === c.line) {
        out.push(was.cover);
        continue;
      }
      const line = [pointAt(c, from)];
      for (let k = 0; k < c.line.length; k++) if (c.at[k] > from && c.at[k] < to) line.push(c.line[k]);
      line.push(pointAt(c, to));
      const cover = { id: c.id, line, half: c.half - COVER_INSET > 0.3 ? c.half - COVER_INSET : 0, edge: c.half };
      this.coverOf.set(c, { from, to, line: c.line, cover });
      out.push(cover);
    }
    for (const cover of this.outlines.values()) out.push(cover);
    return out;
  }

  /** Each ribbon's cover as last made (covers) */
  private readonly coverOf = new WeakMap<Chain, { from: number; to: number; line: readonly MapPoint[]; cover: RoadCover }>();

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

  /**
   * What layOnGround does, in the workers of `pool` (DrapedConformPool): all
   * items laid flat so far at once. An item the paths changed meanwhile keeps
   * waiting for layOnGround
   */
  async layOnGroundIn(pool: DrapedConformPool): Promise<RoadNetwork> {
    const work: { item: string; tiles: Map<string, TileData>; list: TileData[] }[] = [];
    const jobs: ConformJob[] = [];
    for (const [item, shared] of this.unlaid) {
      const tiles = this.pieces.get(item);
      if (!tiles) continue;
      const list = [...tiles.values()];
      work.push({ item, tiles, list });
      jobs.push({ geometries: list.map((t) => t.geometry()), forced: shared });
    }
    const results = await pool.conform(jobs);
    work.forEach(({ item, tiles, list }, k) => {
      // Laid anew while the workers were at it: its tiles are not these any more
      const now = [...tiles.values()];
      if (this.pieces.get(item) !== tiles || !this.unlaid.has(item) || now.length !== list.length || list.some((t, j) => now[j] !== t)) return;
      this.unlaid.delete(item);
      results[k].forEach((g, j) => g && list[j].take(g));
      for (const key of tiles.keys()) this.relaid.add(key);
    });
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
    /** The bridges at each node: arms of a junction there (bridgeStub) */
    const decks = new Map<string, MapPathEdge[]>();
    const seenDecks = new Set<string>();
    for (const e of paths.edges) {
      if (!pavedEdge(e)) {
        others.add(e.a);
        others.add(e.b);
        if (e.kind === 'bridge' && !e.tunnel) {
          for (const n of [e.a, e.b]) decks.set(n, [...(decks.get(n) ?? []), e]);
          // A deck that came, moved or went lays its junctions again
          seenDecks.add(e.id);
          const numbers = edgeNumbers(e, nodes);
          const s = this.decks.get(e.id);
          if (!s || !sameEdge(s, e, numbers)) {
            if (s) touched.add(s.edge.a).add(s.edge.b);
            touched.add(e.a).add(e.b);
            this.decks.set(e.id, { edge: e, numbers });
          }
        }
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
    for (const [id, s] of this.decks) {
      if (seenDecks.has(id)) continue;
      touched.add(s.edge.a).add(s.edge.b);
      this.decks.delete(id);
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
      // A footway or path joining a road with a pavement here joins the pavement: no arm of the junction, its ribbon
      // runs to the node under the road's surface (a lower rank), the road's kerb on past it. As an arm, crossing the
      // pavement to the carriageway, the kerbs either side met in a spike at its mouth
      list = ontoPavement(list, 1);
      // A bridge going on from a road here: its deck's first metres an arm, so the junction reaches the deck
      if (list.length) {
        for (const e of decks.get(node) ?? []) {
          const stub = bridgeStub(e, node, nodes);
          if (stub) list.push(endOf(stub, true));
        }
      }
      endsAt.set(node, list);
      return list;
    };
    // A cluster whose outline neither runs round its middle (fanned from there) nor is a polygon (triangulated as one;
    // roads from its nodes side by side, crossing each other's ends) is laid as its nodes alone
    const clusters = clusterJunctions(lay, endsOf).flatMap((group) => {
      if (group.length === 1) return [group];
      const inside = new Set(group);
      const all = group.flatMap((n) => endsOf(n));
      const within = (e: End) => inside.has(e.chain.nodes[0]) && inside.has(e.chain.nodes[1]);
      const list = ontoPavement(all.filter((e) => !within(e)));
      const inner = [...new Set(all.filter(within).map((e) => e.chain))];
      const centre = clusterCentre(group.map((n) => nodes.get(n)!));
      const trims = list.map((e) => [...e.chain.trim] as [number, number]);
      trimJunction(centre, list, group.map(endsOf));
      // Its outline round its middle or a polygon, and over the chains inside it: a kerb that cut across one (it could
      // not follow a way turning back on itself) left the chain's ground bare, a ribbon there is better
      const outline = list.length > 1 ? junctionOutline(list, list.map(endSection), inner, false) : [];
      const fits =
        list.length > 1 &&
        (outlineAround(centre, list) || simpleRing(outline)) &&
        inner.every((ch) => [0.25, 0.5, 0.75].every((s) => inRing(outline, pointAt(ch, ch.at[0] + ch.length * s))));
      list.forEach((e, k) => (e.chain.trim = trims[k]));
      return fits ? [group] : group.map((n) => [n]);
    });
    // Trims of the kept chains at those nodes, to see whether they moved, and whether they were inside a cluster
    const laid = new Set(clusters.flat());
    const before = new Map<Chain, [number, number, boolean, string]>();
    const ends = (c: Chain) => `${+c.cap[0]}${+c.cap[1]}`;
    for (const c of this.chains.values()) if (laid.has(c.nodes[0]) || laid.has(c.nodes[1])) before.set(c, [c.trim[0], c.trim[1], c.inner, ends(c)]);
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
      const innerChains = new Set<Chain>();
      for (const n of nodeList) {
        for (const e of endsOf(n)) {
          const inner = inside.has(e.chain.nodes[0]) && inside.has(e.chain.nodes[1]) && nodeList.length > 1;
          e.chain.inner = inner;
          if (inner) innerChains.add(e.chain);
          else list.push(e);
        }
      }
      // A footway at one node of a group joins the pavement of a road at another (ontoPavement)
      const kept = ontoPavement(list);
      list.splice(0, list.length, ...kept);
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
        trimJunction(centre, list, nodeList.length > 1 ? nodeList.map(endsOf) : []);
        this.junctionEnds.set(key, { node: centre, ends: list, inner: [...innerChains] });
      }
    }
    // A kept chain whose trim moved (it ends at a junction laid again) or that went in or out of a cluster is laid again
    const fresh = new Set(made);
    for (const [c, was] of before) {
      if (fresh.has(c) || (was[0] === c.trim[0] && was[1] === c.trim[1] && was[2] === c.inner && was[3] === ends(c))) continue;
      this.dropItem(`c${c.id}`, rebuilt);
      made.push(c);
    }
    for (const c of made) if (!c.inner) this.putItem(`c${c.id}`, (out) => emitRibbon(c, out), rebuilt);
    // The decks' stubs: their end sections at their nodes, as a ribbon's would be (they draw nothing)
    for (const j of this.junctionEnds.values()) for (const e of j.ends) if (e.chain.stub) e.chain.ends = [sectionAt(e.chain, e.chain.at[0]), null];
    for (const nodeList of clusters) {
      const key = nodeList.reduce((p, q) => (q < p ? q : p));
      const j = this.junctionEnds.get(key);
      if (j) this.putItem(`j${key}`, (out) => this.outline(`j${key}`, emitJunction(j.node, j.ends, j.inner, out, this.styleOf)), rebuilt);
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
        this.putItem(item, (out) => this.outline(item, emitJunction(j.node, j.ends, j.inner, out, this.styleOf)), rebuilt);
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
    this.outlines.delete(item);
  }

  /** A junction's outline as laid, for its cover (covers) */
  private outline(item: string, ring: MapPoint[] | null): void {
    if (ring && ring.length >= 3) this.outlines.set(item, { id: item, line: NO_LINE, half: 0, ring });
    else this.outlines.delete(item);
  }

  /** The junctions' covers by their outlines, by item ('j' + node id) */
  private readonly outlines = new Map<string, RoadCover>();

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

/** Metres of a bridge's deck its stub runs along from its node (bridgeStub) */
const STUB = 4;

/**
 * A bridge's first metres from `node` as a chain of its width without
 * pavements (Chain.stub): an arm of the junction there, its end section at
 * the node, so the junction's outline runs across the deck's end. Laid as if
 * the bridge did not meet the junction, its kerb cut across short of the
 * deck and left the ground bare between them, a hook beside the deck
 */
function bridgeStub(e: MapPathEdge, node: string, nodes: ReadonlyMap<string, MapPoint>): Chain | null {
  const line = edgePolyline(e, nodes as Map<string, MapPoint>);
  if (!line || line.length < 2) return null;
  const pts = e.a === node ? line : [...line].reverse();
  const a = pts[0];
  const b = pts[1];
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  if (l < 0.5) return null;
  const length = Math.min(STUB, l);
  const q = { x: a.x + ((b.x - a.x) * length) / l, y: a.y + ((b.y - a.y) * length) / l };
  return {
    id: `deck-${e.id}-${node}`,
    edge: { ...e, kind: 'road', surface: 'asphalt', sidewalk: 0 },
    edges: [],
    nodes: [node, ''],
    line: [a, q],
    at: [0, length],
    length,
    half: e.width / 2,
    walk: 0,
    style: 0,
    trim: [0, 0],
    ends: [null, null],
    cap: [false, false],
    inner: false,
    stub: true,
  };
}

/**
 * The ends of a junction (a node's, or a group's) without the footways and
 * paths that have no kerb of their own, where a road there has a pavement:
 * such a way joins the pavement, its ribbon runs on under the road's surface
 * (its lower rank) and the road's kerb runs on past it. As an arm it crossed
 * the pavement to the carriageway: the kerbs either side met in a spike at
 * its mouth, or, mapped beside the road (a pavement of its own) and meeting
 * it at a node of the group, the road's kerb bent far into the carriageway
 * towards it. Unchanged where that would leave fewer than `least` (a group's
 * two)
 */
function ontoPavement(list: End[], least = 2): End[] {
  if (!list.some((e) => e.chain.walk > 0)) return list;
  const kept = list.filter((e) => !(e.chain.edge.kind === 'path' && !roadStyle(e.chain.edge).gutter));
  return kept.length >= least ? kept : list;
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
 * The ends in counter-clockwise order around `c` (a cluster's ends start at their own nodes). In a junction of
 * several nodes (`nodes`: the ends at each, the chains inside it too) a road whose end would lie on a chain inside it
 * is trimmed past the kerbs of the roads at its own node: seen from the junction's middle the kerbs of a side road and
 * of the next road out meet behind them, and its end lay on the carriageway of the road through
 */
function trimJunction(c: MapPoint, list: End[], nodes: readonly (readonly End[])[] = []): void {
  const trims = wantedTrims(c, list);
  const widest = Math.max(...list.map((e) => e.chain.half));
  const outer = new Set(list);
  const inner = new Set(nodes.flat().filter((e) => !outer.has(e)).map((e) => e.chain));
  const set = (e: End, t: number) => {
    // A deck's stub ends at its node (bridgeStub)
    if (!e.chain.stub) e.chain.trim[e.start ? 0 : 1] = Math.max(0, Math.min(Math.min(e.chain.length * 0.45, widest * 4 + 6), t));
  };
  list.forEach((e, k) => set(e, trims[k]));
  if (inner.size) {
    for (const ends of nodes) {
      const on = ends.filter((e) => outer.has(e) && endSection(e).some((p) => [...inner].some((chain) => insideRibbon(chain, p))));
      if (!on.length) continue;
      const sorted = [...ends];
      const own = wantedTrims(ends[0], sorted);
      for (const e of on) set(e, Math.max(e.chain.trim[e.start ? 0 : 1], own[sorted.indexOf(e)]));
    }
  }
  // Two roads leaving side by side (a slip road beside the road it leaves, short between two junctions, its trim held
  // to its length) whose end sections still cross or reach onto the other's carriageway: both trimmed on, a step at a time, until they part, up to most of
  // their length. Crossed, the junction's outline folded and it fell apart into fans over each other
  const n = list.length;
  for (let round = 0; n > 1 && round < SPLAY_ROUNDS; round++) {
    let crossed = false;
    for (let k = 0; k < n; k++) {
      const a = list[k];
      const b = list[(k + 1) % n];
      // A footway beside a road (a pavement mapped of its own) runs along it, not across: no end of the two trimmed on
      if (a === b || a.chain.edge.kind === 'path' || b.chain.edge.kind === 'path') continue;
      const sa = endSection(a);
      const sb = endSection(b);
      const apart = !crosses(sa[0], sa[sa.length - 1], sb[0], sb[sb.length - 1]) && !sa.some((p) => insideRibbon(b.chain, p)) && !sb.some((p) => insideRibbon(a.chain, p));
      if (apart) continue;
      crossed = true;
      for (const e of [a, b]) {
        if (e.chain.stub) continue;
        const at = e.start ? 0 : 1;
        e.chain.trim[at] = Math.min(e.chain.length * SPLAY_SHARE, e.chain.trim[at] + SPLAY_STEP);
      }
    }
    if (!crossed) break;
  }
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
    if (n > 1 && gap > Math.PI * 0.94) {
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

/** Trimming on of two ends whose sections cross (trimJunction): metres a step, steps at most, share of a road's length at most */
const SPLAY_STEP = 0.75;
const SPLAY_ROUNDS = 12;
const SPLAY_SHARE = 0.9;

/** Longest chain between two junctions that may join them into one */
const CLUSTER_CHAIN = 16;
/** Most a chain may turn from end to end to be inside a junction of several nodes, radians */
const CLUSTER_TURN = Math.PI / 6;
/** Widest a junction of several nodes may grow (its nodes' box, metres) */
const CLUSTER_SPAN = 24;

/**
 * The junctions to lay at `lay`'s nodes: a node alone, or several a short
 * chain joins (nearly straight, CLUSTER_TURN) where their junctions want more room than the chain has
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
      // A chain that bends (a roundabout's ring between two of its mouths) keeps its ribbon: a junction's kerb across
      // it would cut its curve off in a chord
      if (ea.dx * eb.dx + ea.dy * eb.dy > -Math.cos(CLUSTER_TURN)) continue;
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

/** Three columns of a ribbon: the distance to the edge peaks in the middle (the ground's bends cut the triangles, conformDraped) */
const COLUMNS = [-1, 0, 1];

/** A chain's cross section at a distance along, right to left looking along it */
function sectionAt(chain: Chain, d: number): Section {
  const p = pointAt(chain, d);
  const t = tangentAt(chain, d);
  const walk = chain.walk;
  const h = chain.half;
  // Mitred at a corner: the offset grows as the corner sharpens, at most twice the width
  const nx = -t.y * t.scale;
  const ny = t.x * t.scale;
  return COLUMNS.map((u) => ({ x: p.x + nx * u * h, y: p.y + ny * u * h, across: u * h, along: d, edge: h * (1 - Math.abs(u)) - walk, style: chain.style, dx: t.x, dy: t.y }));
}

/** Where a chain's drawn ribbon starts and ends (distances along) by its trims; trimmed away between two junctions, one point where they meet */
function ribbonSpan(chain: Chain): [number, number] {
  const o = chain.at[0];
  const from = o + chain.trim[0];
  const to = o + chain.length - chain.trim[1];
  if (to - from >= 0.05) return [from, to];
  const mid = Math.max(o, Math.min(o + chain.length, (from + to) / 2));
  return [mid, mid];
}

/** The ribbon of a chain between its trims, with its round ends, into the tiles; keeps its end sections for the junctions */
function emitRibbon(chain: Chain, out: TileBuilder): void {
  const [from, to] = ribbonSpan(chain);
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
  const sections: Section[] = stops.map((d) => sectionAt(chain, d));
  chain.ends = [sections[0], sections[sections.length - 1]];
  out.share(sections[0]);
  if (sections.length > 1) out.share(sections[sections.length - 1]);
  // Pieces of at most PIECE metres, each into the tile it starts in
  const w = COLUMNS.length;
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

/** A point of a junction's outline: its distance to the edge, the road it belongs to, whether on that road's end section */
interface RingPoint {
  x: number;
  y: number;
  edge: number;
  arm: number;
  side: boolean;
}

/**
 * A junction's outline, counter-clockwise: the roads' end sections (`sides`, right to left seen from the node, the
 * ends in order as trimJunction sorted them), each followed by the kerb to the next road. `gutter`: the junction's
 * look has kerbs; `follow`: a kerb between two of its nodes that would cut across a chain between them follows the
 * chains' edges instead
 */
function junctionOutline(list: readonly End[], sides: readonly Section[], inner: readonly Chain[], gutter: boolean, follow = true): RingPoint[] {
  // The ring: each road's end section, then the kerb to the next road (a curve through where both kerbs would meet,
  // else straight); a point of a section belongs to its road, a kerb point to the nearer of the two
  const ring: RingPoint[] = [];
  const n = list.length;
  // A kerb between two roads without one gets none: its points lie past the gutter's width from the edge
  const kerbs = list.map((e) => roadStyle(e.chain.edge).gutter);
  // A driveway or a path (no kerb of its own, a lower rank than a road with one here, MOUTH_RANK at most) meets the
  // carriageway without one: the kerbs either side end in the corner curves towards it. Kerbed round its own edges, the
  // kerb ran into the junction along one side of it and back out along the other, a notch in the pavement
  const ranks = list.map((e) => roadStyle(e.chain.edge).rank);
  const top = Math.max(-1, ...ranks.filter((_, k) => kerbs[k]));
  const mouth = list.map((_, k) => gutter && !kerbs[k] && ranks[k] <= MOUTH_RANK && ranks[k] < top);
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    const kerbEdge = gutter && !kerbs[k] && !kerbs[j] && !mouth[k] && !mouth[j] ? 0.6 : 0;
    const side = sides[k];
    for (const v of side) ring.push({ x: v.x, y: v.y, edge: mouth[k] ? v.edge + MOUTH_EDGE : v.edge, arm: k, side: true });
    const a = side[side.length - 1];
    const b = sides[j][0];
    // The outline runs round the pavements: from one road's to the next's
    const walkA = mouth[k] ? -MOUTH_EDGE : list[k].chain.walk;
    const walkB = mouth[j] ? -MOUTH_EDGE : list[j].chain.walk;
    // Two roads wide apart (a road going on through the junction, bending or not): the kerb follows their own lines;
    // so does a kerb between two nodes of the junction that would cut across a chain between them (the ground grey
    // where its surface should be). Not into a mouth: the kerb crosses it
    const ea = list[k];
    const eb = list[j];
    const crossing = mouth[k] || mouth[j];
    let along = crossing ? null : kerbAlong(ea, eb, inner);
    const curve = along ? [] : kerbCurve(a, ea, b, eb);
    if (!along && !crossing && follow && inner.some((c) => curve.some((p) => insideRibbon(c, p)))) along = kerbAlong(ea, eb, inner, true);
    if (along) along.forEach((p) => ring.push({ x: p.x, y: p.y, edge: kerbEdge - p.walk, arm: p.second ? (k + 1) % n : k, side: false }));
    else curve.forEach((p) => ring.push({ x: p.x, y: p.y, edge: kerbEdge - (walkA * (1 - p.t) + walkB * p.t), arm: p.t * 2 <= 1 ? k : (k + 1) % n, side: false }));
  }
  return untangle(ring);
}

/** Sharpest turn back an outline may take at a kerb point (cosine of the angle between the way in and out) */
const SPIKE_COS = -0.5;

/**
 * A junction's outline without spikes and loops of kerb: a kerb point where
 * the outline turns back on itself (more than 120 degrees) goes, and where
 * two stretches of it cross, the kerb points between them (the loop) go.
 * The kerbs between two ends met wherever the lines of the roads beside them
 * took them: at a narrow mouth, a taper or a corner cut close they ran past
 * each other and back, a spike or a zigzag of kerb into the carriageway.
 * The roads' end sections stay (other surfaces share their points)
 */
function untangle(ring: RingPoint[]): RingPoint[] {
  const out = [...ring];
  for (let round = 0; round < out.length + 8; round++) {
    let changed = false;
    const n = out.length;
    if (n < 4) break;
    for (let k = 0; k < n && !changed; k++) {
      const p = out[k];
      if (p.side) continue;
      const a = out[(k + n - 1) % n];
      const b = out[(k + 1) % n];
      const ax = p.x - a.x;
      const ay = p.y - a.y;
      const bx = b.x - p.x;
      const by = b.y - p.y;
      const la = Math.hypot(ax, ay);
      const lb = Math.hypot(bx, by);
      // A point on top of the one before, or a turn back
      if (la < 1e-4 || lb < 1e-4 || (ax * bx + ay * by) / (la * lb) < SPIKE_COS) {
        out.splice(k, 1);
        changed = true;
      }
    }
    if (changed) continue;
    // A loop: two sides that cross; the shorter run of kerb points between them goes
    for (let i = 0; i < n && !changed; i++) {
      for (let j = i + 2; j < n && !changed; j++) {
        if (i === 0 && j === n - 1) continue;
        if (!crosses(out[i], out[(i + 1) % n], out[j], out[(j + 1) % n])) continue;
        const inner = out.slice(i + 1, j + 1);
        const outer = [...out.slice(j + 1), ...out.slice(0, i + 1)];
        const loop = inner.length <= outer.length ? inner : outer;
        if (loop.some((q) => q.side)) continue;
        for (const q of loop) out.splice(out.indexOf(q), 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

/**
 * The kerb's points between road ea's end section (its left point `a`) and the next road eb's (its right point `b`),
 * with how far along it each lies: a curve through where both kerbs would meet (lineMeet), else, the kerb lines
 * meeting behind the ends (the inside of a bend, a road going on at another width), a curve leaving each end along
 * its road (Hermite), so the kerb of a roundabout's island follows its circle through the junctions on it instead of
 * cutting across in a chord
 */
function kerbCurve(a: MapPoint, ea: End, b: MapPoint, eb: End): (MapPoint & { t: number })[] {
  const cross = lineMeet(a, ea, b, eb);
  const span = Math.hypot(b.x - a.x, b.y - a.y);
  // As many points as its length wants: six over a long curve (a roundabout's mouth) made a polygon of the kerb
  const length = cross ? Math.hypot(cross.x - a.x, cross.y - a.y) + Math.hypot(b.x - cross.x, b.y - cross.y) : span * 1.5;
  const points = Math.max(CURVE_POINTS, Math.min(KERB_POINTS, Math.ceil(length / KERB_STEP)));
  const out: (MapPoint & { t: number })[] = [];
  for (let s = 1; s < points; s++) {
    const t = s / points;
    const u = 1 - t;
    if (cross) {
      out.push({ x: u * u * a.x + 2 * u * t * cross.x + t * t * b.x, y: u * u * a.y + 2 * u * t * cross.y + t * t * b.y, t });
      continue;
    }
    const h00 = 2 * t * t * t - 3 * t * t + 1;
    const h10 = t * t * t - 2 * t * t + t;
    const h01 = -2 * t * t * t + 3 * t * t;
    const h11 = t * t * t - t * t;
    out.push({ x: h00 * a.x - h10 * span * ea.dx + h01 * b.x + h11 * span * eb.dx, y: h00 * a.y - h10 * span * ea.dy + h01 * b.y + h11 * span * eb.dy, t });
  }
  return out;
}

/** Whether a point lies on a chain's surface, more than a few decimetres in from its edges */
function insideRibbon(chain: Chain, p: MapPoint): boolean {
  const { line } = chain;
  const limit = chain.half - 0.3;
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1];
    const lx = line[k].x - a.x;
    const ly = line[k].y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * lx + (p.y - a.y) * ly) / (lx * lx + ly * ly || 1)));
    if (Math.hypot(p.x - a.x - lx * t, p.y - a.y - ly * t) < limit) return true;
  }
  return false;
}

/** The end section of a road at a junction (its ribbon's, as emitRibbon lays it), right to left seen from the node */
function endSection(e: End): Section {
  const [from, to] = ribbonSpan(e.chain);
  const s = sectionAt(e.chain, e.start ? from : to);
  return e.start ? s : s.reverse();
}

/** Whether a point lies inside a ring (even-odd) */
function inRing(ring: readonly MapPoint[], q: MapPoint): boolean {
  let inside = false;
  for (let k = 0, l = ring.length - 1; k < ring.length; l = k++) {
    const a = ring[k];
    const b = ring[l];
    if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Whether a ring is a polygon: counter-clockwise, no side crossing another */
function simpleRing(ring: readonly MapPoint[]): boolean {
  const n = ring.length;
  let area = 0;
  for (let k = 0; k < n; k++) area += ring[k].x * ring[(k + 1) % n].y - ring[(k + 1) % n].x * ring[k].y;
  if (area <= 0) return false;
  for (let k = 0; k < n; k++) {
    for (let j = k + 2; j < n; j++) if (!(k === 0 && j === n - 1) && crosses(ring[k], ring[k + 1], ring[j], ring[(j + 1) % n])) return false;
  }
  return true;
}

/** The surface between the ends of the roads at a junction: the polygon its outline is, else fanned from its node */
/** The surface between the ends of the roads at a junction; its outline (where its surface hides the ground), null when none is laid */
function emitJunction(c: MapPoint, list: End[], inner: readonly Chain[], out: TileBuilder, styleOf: (s: RoadStyle) => number): MapPoint[] | null {
  // The ends in counter-clockwise order (trimJunction sorted them), each with its cross section seen from the node:
  // right to left looking away from it
  const sides = list.map((e) => {
    const s = e.chain.ends[e.start ? 0 : 1];
    if (!s) return null;
    return e.start ? s : [...s].reverse();
  });
  if (sides.some((s) => !s)) return null;
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
      arm: [armAcross, armAlong, Math.atan2(f.dy, f.dx) - Math.atan2(mf.dy, mf.dx), wears[arm] + ARM_WEIGHT_BASE + weight * ARM_WEIGHT_SPAN],
    };
  };
  for (const side of sides) out.share(side!);
  // The node lies on the widest road, its kerbs that road's half carriageway away: the distance to the edge runs from
  // there to the ring, so the kerbs cross the junction where that road's run. A narrower way's half (a footway
  // joining) pulled them in towards the node, the pavement bulging into the carriageway on both sides of each
  // junction like the teeth of a saw
  const centre: RingPoint = { x: c.x, y: c.y, edge: m.chain.half - m.chain.walk, arm: main, side: false };
  // A second ring inside the kerb's: each kerb point moved in square to the outline by its pavement and KERB_BAND,
  // less where the kerb curves tighter or the node is near; a road's end section is its own. Between the two rings
  // the distance to the edge is the true one, so pavement, kerb and gutter run parallel to the outline round the
  // junction; fanned from the node it only grew with the distance from the node, the kerb wide where the outline lies
  // far out and thin where it comes close
  const left = (p: MapPoint, q: MapPoint, r: MapPoint): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  // An outline that is a polygon is triangulated as one, its band parallel to it all round. Fanned from the node the
  // band had to stay in the wedge of each stretch of outline: links and slip roads beside a junction or a junction of
  // several nodes whose roads leave side by side folded the fan over the node, its triangles over each other's and the
  // kerbs across the carriageway, and a kerb running slantwise past the node (along a chain inside the junction) had
  // its band cut back at every other point, the kerb in steps. An outline that is no polygon (roads crossing each
  // other's ends) keeps the fan and its single ring, its kerbs between nodes straight across the chains between them,
  // not along them
  const runsAround = (r: readonly RingPoint[]) => r.every((p, k) => left(c, p, r[(k + 1) % r.length]) > 0);
  let ring = junctionOutline(list, sides as Section[], inner, look.gutter);
  let around = runsAround(ring);
  // An outline round the node is a polygon (its points seen in turn from there)
  const fan = !around && !simpleRing(ring);
  if (fan && inner.length) {
    ring = junctionOutline(list, sides as Section[], inner, look.gutter, false);
    around = runsAround(ring);
  }
  const count = ring.length;
  const normals = ring.map((p, k) => {
    const prev = ring[(k + count - 1) % count];
    const next = ring[(k + 1) % count];
    const tl = Math.hypot(next.x - prev.x, next.y - prev.y);
    if (p.side || tl < 1e-6) return null;
    // Counter-clockwise round the node: inside is on the left
    let d = p.edge < 0 ? KERB_BAND - p.edge : KERB_BAND;
    if (fan) d = Math.min(d, Math.hypot(p.x - c.x, p.y - c.y) * 0.45);
    // Where the outline turns left (towards the inside), no further in than most of the radius of its turn
    const ax = p.x - prev.x;
    const ay = p.y - prev.y;
    const bx = next.x - p.x;
    const by = next.y - p.y;
    const turn = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
    if (turn > 1e-3) d = Math.min(d, (0.8 * Math.min(Math.hypot(ax, ay), Math.hypot(bx, by))) / turn);
    return { nx: -(next.y - prev.y) / tl, ny: (next.x - prev.x) / tl, d };
  });
  const inward = (k: number, d: number): RingPoint => {
    const p = ring[k];
    const n = normals[k];
    return !n || d <= 0 ? p : { x: p.x + n.nx * d, y: p.y + n.ny * d, edge: p.edge + d, arm: p.arm, side: false };
  };
  const depth = normals.map((n) => n?.d ?? 0);
  const inside: RingPoint[] = [];
  // No fold: where the band between two points or the fan beyond it would turn over (a kerb meeting a road's end at a
  // sharp angle, a tight curve, the node close by), both points come out halfway, at last back onto the outline
  const folds = (k: number): boolean => {
    const j = (k + 1) % count;
    const [p, q, pi, qi] = [ring[k], ring[j], inside[k], inside[j]];
    if (left(p, q, qi) < -1e-9 || left(p, qi, pi) < -1e-9) return true;
    // The band and the fan stay in the wedge of their stretch of outline: no triangle over the next one's
    if (fan) return left(c, pi, qi) <= 0 || left(c, p, qi) <= 0 || left(c, pi, q) <= 0;
    // The inner ring crosses neither itself nor the outline (a narrow neck between two roads side by side)
    for (let i = 0; i < count; i++) {
      const l = (i + 1) % count;
      if (i !== k && crosses(pi, qi, ring[i], ring[l])) return true;
      if (i !== k && i !== j && l !== k && crosses(pi, qi, inside[i], inside[l])) return true;
    }
    return false;
  };
  if (!around && fan) depth.fill(0);
  for (let k = 0; k < count; k++) inside[k] = inward(k, depth[k]);
  for (let round = 0; round < 8; round++) {
    let folded = false;
    for (let k = 0; k < count; k++) {
      if (!folds(k)) continue;
      folded = true;
      for (const i of [k, (k + 1) % count]) {
        depth[i] = round < 7 ? depth[i] / 2 : 0;
        inside[i] = inward(i, depth[i]);
      }
    }
    if (!folded) break;
  }
  // Each triangle in one road's frame: near a road's end its texture takes over from the junction's (the weight, 1 on
  // the end section, 0 at the node and on the kerbs), so no seam shows at any end
  const verts: Vertex[] = [];
  const tris: number[] = [];
  const triangle = (p: RingPoint, q: RingPoint, r: RingPoint, arm: number): void => {
    // Skip slivers the wrong way round (an outline that is no polygon, roads crossing each other's ends) and the empty
    // ones
    if (left(p, q, r) <= 1e-9) return;
    const base = verts.length;
    const weight = (v: RingPoint) => (v.side && v.arm === arm ? 1 : 0);
    verts.push(vertex(p, arm, weight(p)), vertex(q, arm, weight(q)), vertex(r, arm, weight(r)));
    tris.push(base, base + 1, base + 2);
  };
  for (let k = 0; k < ring.length; k++) {
    const p = ring[k];
    const q = ring[(k + 1) % ring.length];
    const pi = inside[k];
    const qi = inside[(k + 1) % ring.length];
    const arm = p.side ? p.arm : q.side ? q.arm : p.arm;
    // The band between the rings, then the fan from the node to the inner ring
    triangle(p, q, qi, arm);
    if (pi !== p) triangle(p, qi, pi, arm);
    if (fan) triangle(centre, pi, qi, arm);
  }
  if (!fan) {
    // The inner ring as a polygon (earcut), each point once; a triangle in the frame of the road whose end it touches
    const poly: RingPoint[] = [];
    for (const p of inside) if (p !== poly[poly.length - 1] && p !== poly[0]) poly.push(p);
    // Where the inner ring could not move in all round (a narrow neck between two slip roads), points inside it on a
    // grid, each with its true distance to the edge (fieldPoints): between the inner ring's points alone the distance
    // ran linearly from kerb to kerb, and the junction read as pavement across
    const all: RingPoint[] = [...poly];
    const faces = ShapeUtils.triangulateShape(
      poly.map((p) => new Vector2(p.x, p.y)),
      [],
    ).map((f) => (left(poly[f[0]], poly[f[1]], poly[f[2]]) > 0 ? f : [f[0], f[2], f[1]]));
    restoreDropped(poly, faces);
    if (poly.some((p) => !p.side && p.edge < KERB_BAND - 0.05)) insertPoints(all, faces, fieldPoints(c, ring, poly, centre.edge));
    for (const t of faces) {
      const [a, b, d] = t.map((i) => all[i]);
      const arm = a.side ? a.arm : b.side ? b.arm : d.side ? d.arm : a.arm;
      if (left(a, b, d) > 0) triangle(a, b, d, arm);
      else triangle(a, d, b, arm);
    }
  }
  out.add(verts, tris);
  return ring.map((p) => ({ x: p.x, y: p.y }));
}

/** Metres between the points a junction's surface takes inside its inner ring (fieldPoints), and their least gap to it */
const FIELD_STEP = 1.5;
const FIELD_GAP = 0.6;
/** Most passes of flips after the points went in (insertPoints) */
const FLIP_PASSES = 200;

/**
 * Points on a grid of FIELD_STEP round node `c` inside polygon `poly` (a
 * junction's inner ring), FIELD_GAP and more off its sides, each with its
 * distance to the edge as the outline gives it (`ring`, its points'
 * distances): the least over the outline's sides of the side's distance
 * where the point lies square to it plus the metres to it. The arm of the
 * outline point nearest. No more than `most` (the widest road's middle); each
 * point a little off the grid by a hash of it, so no three lie on a line
 * (the triangulation drew a side through the middle one)
 */
function fieldPoints(c: MapPoint, ring: readonly RingPoint[], poly: readonly RingPoint[], most: number): RingPoint[] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const out: RingPoint[] = [];
  const n = poly.length;
  for (let i = Math.ceil((x0 - c.x) / FIELD_STEP); c.x + i * FIELD_STEP < x1; i++) {
    for (let j = Math.ceil((y0 - c.y) / FIELD_STEP); c.y + j * FIELD_STEP < y1; j++) {
      const h = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
      const q = { x: c.x + (i + (h - Math.floor(h) - 0.5) * 0.3) * FIELD_STEP, y: c.y + (j + (((h * 7.31) % 1) + 1) % 1 * 0.3 - 0.15) * FIELD_STEP };
      let inside = false;
      let gap = Infinity;
      for (let k = 0, l = n - 1; k < n; l = k++) {
        const a = poly[k];
        const b = poly[l];
        if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
        gap = Math.min(gap, segmentDistance(q, a, b).d);
      }
      if (!inside || gap < FIELD_GAP) continue;
      let edge = Infinity;
      let arm = 0;
      let near = Infinity;
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k];
        const b = ring[(k + 1) % ring.length];
        const s = segmentDistance(q, a, b);
        const e = a.edge + (b.edge - a.edge) * s.t + s.d;
        if (e < edge) edge = e;
        if (s.d < near) {
          near = s.d;
          arm = s.t < 0.5 ? a.arm : b.arm;
        }
      }
      out.push({ x: q.x, y: q.y, edge: Math.min(edge, most), arm, side: false });
    }
  }
  return out;
}

/**
 * The points of polygon `pts` its triangulation (`faces`, counter-clockwise)
 * left out or put only into flat triangles (dropped), each into the triangle
 * whose side it lies on, split there: the triangulation drops a point in a
 * straight run of the outline where it gets stuck, and the side spanning it
 * met the band's two triangles at it (a crack)
 */
function restoreDropped(pts: readonly MapPoint[], faces: number[][]): void {
  const flat = (f: number[]) => Math.abs((pts[f[1]].x - pts[f[0]].x) * (pts[f[2]].y - pts[f[0]].y) - (pts[f[1]].y - pts[f[0]].y) * (pts[f[2]].x - pts[f[0]].x)) <= 1e-9;
  for (let f = faces.length - 1; f >= 0; f--) if (flat(faces[f])) faces.splice(f, 1);
  const used = new Set(faces.flat());
  for (let k = 0; k < pts.length; k++) {
    if (used.has(k)) continue;
    const q = pts[k];
    for (let f = 0; f < faces.length; f++) {
      const face = faces[f];
      const e = [0, 1, 2].find((s) => {
        const a = pts[face[s]];
        const b = pts[face[(s + 1) % 3]];
        const along = (q.x - a.x) * (b.x - a.x) + (q.y - a.y) * (b.y - a.y);
        const len = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
        return along > 0 && along < len && Math.abs((b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x)) < 1e-6 * Math.sqrt(len);
      });
      if (e === undefined) continue;
      const [a, b, c] = [face[e], face[(e + 1) % 3], face[(e + 2) % 3]];
      faces[f] = [a, k, c];
      faces.push([k, b, c]);
      break;
    }
  }
}

/**
 * Points into a triangulation of `pts` (`faces`, counter-clockwise; both
 * grow): each splits the triangle it lies in, then sides inside it are
 * flipped where the triangles beside them are not Delaunay, so no long side
 * runs from kerb to kerb across the points (the distance along it only that
 * of its ends). Sides on the outline stay. A point on a side or outside every
 * triangle is left out
 */
function insertPoints(pts: MapPoint[], faces: number[][], add: readonly MapPoint[]): void {
  const area = (a: MapPoint, b: MapPoint, c: MapPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (const q of add) {
    const f = faces.findIndex(([a, b, c]) => area(pts[a], pts[b], q) > 1e-6 && area(pts[b], pts[c], q) > 1e-6 && area(pts[c], pts[a], q) > 1e-6);
    if (f < 0) continue;
    const [a, b, c] = faces[f];
    const k = pts.length;
    pts.push(q);
    faces[f] = [a, b, k];
    faces.push([b, c, k], [c, a, k]);
  }
  // Lawson's flips: a side is flipped where the far corner of one triangle lies in the other's circumcircle
  const inCircle = (a: MapPoint, b: MapPoint, c: MapPoint, d: MapPoint): boolean => {
    const ax = a.x - d.x;
    const ay = a.y - d.y;
    const bx = b.x - d.x;
    const by = b.y - d.y;
    const cx = c.x - d.x;
    const cy = c.y - d.y;
    return (ax * ax + ay * ay) * (bx * cy - cx * by) - (bx * bx + by * by) * (ax * cy - cx * ay) + (cx * cx + cy * cy) * (ax * by - bx * ay) > 1e-9;
  };
  // Passes over all sides, each triangle flipped once a pass, until none is
  for (let pass = 0; pass < FLIP_PASSES; pass++) {
    const sides = new Map<string, [number, number]>();
    for (let f = 0; f < faces.length; f++) for (let e = 0; e < 3; e++) sides.set(`${faces[f][e]},${faces[f][(e + 1) % 3]}`, [f, e]);
    const touched = new Set<number>();
    for (let f = 0; f < faces.length; f++) {
      if (touched.has(f)) continue;
      for (let e = 0; e < 3; e++) {
        const a = faces[f][e];
        const b = faces[f][(e + 1) % 3];
        const c = faces[f][(e + 2) % 3];
        const other = sides.get(`${b},${a}`);
        if (!other || touched.has(other[0])) continue;
        const [g, h] = other;
        const d = faces[g][(h + 2) % 3];
        if (!inCircle(pts[a], pts[b], pts[c], pts[d])) continue;
        // Only a convex pair turns: both new triangles counter-clockwise
        if (area(pts[c], pts[a], pts[d]) <= 1e-6 || area(pts[d], pts[b], pts[c]) <= 1e-6) continue;
        faces[f] = [c, a, d];
        faces[g] = [d, b, c];
        touched.add(f).add(g);
        break;
      }
    }
    if (!touched.size) break;
  }
}

/** Distance from p to segment a-b, and where along it (0 at a, 1 at b) the nearest point lies */
function segmentDistance(p: MapPoint, a: MapPoint, b: MapPoint): { d: number; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return { d: Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t), t };
}

/** Whether segment p-q crosses segment r-s inside both (touching at an end is no crossing) */
function crosses(p: MapPoint, q: MapPoint, r: MapPoint, s: MapPoint): boolean {
  if (Math.max(p.x, q.x) < Math.min(r.x, s.x) || Math.max(r.x, s.x) < Math.min(p.x, q.x)) return false;
  if (Math.max(p.y, q.y) < Math.min(r.y, s.y) || Math.max(r.y, s.y) < Math.min(p.y, q.y)) return false;
  const side = (a: MapPoint, b: MapPoint, c: MapPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const a = side(p, q, r);
  const b = side(p, q, s);
  const e = side(r, s, p);
  const f = side(r, s, q);
  return ((a > 1e-9 && b < -1e-9) || (a < -1e-9 && b > 1e-9)) && ((e > 1e-9 && f < -1e-9) || (e < -1e-9 && f > 1e-9));
}

/** How far past the kerb the junction's distance to the edge is the true one (its paint and gutter lie within), m */
const KERB_BAND = 1.2;

/** Most a road may turn at a node of a junction (radians) for the kerb to follow it, not round a corner */
const KERB_TURN = Math.PI / 4;
/** Most the way through a junction's chains may turn at a node for a kerb to follow their edges (kerbAlong, `follow`) */
const FOLLOW_TURN = Math.PI / 2;

/**
 * The kerb between road ea and the next road eb counter-clockwise, along
 * the roads' own lines: the edge of the way from ea's end section in to its
 * node, on through the chains inside the junction (one of several nodes) to
 * eb's node and out along eb to its end section, each piece at its own half
 * width on the kerb's side (tapering where two widths meet), cut where one
 * piece's edge crosses the next (the inside of a bend; where they part, the
 * kerb lines meet in front, lineMeet). For a road going on
 * (turning at most KERB_TURN at each node of the way): straight or bending
 * through the junction, a roundabout's ring past its mouths, the island's
 * kerb then round as the ring. Points between the end sections, a metre
 * apart or closer, with the pavement there (`walk`) and whether they lie on
 * eb's side; null for a corner between two roads (rounded by lineMeet) or
 * without a way through the junction's chains
 */
function kerbAlong(ea: End, eb: End, inner: readonly Chain[], follow = false): (MapPoint & { walk: number; second: boolean })[] | null {
  const nodeOf = (e: End) => e.chain.nodes[e.start ? 0 : 1];
  // The way through the junction's chains from ea's node to eb's (none for one node)
  const way: { chain: Chain; forward: boolean }[] = [];
  if (nodeOf(ea) !== nodeOf(eb)) {
    const from = new Map<string, { chain: Chain; forward: boolean; prev: string }>();
    const queue = [nodeOf(ea)];
    const seen = new Set(queue);
    while (queue.length && !from.has(nodeOf(eb))) {
      const node = queue.shift()!;
      for (const chain of inner) {
        const forward = chain.nodes[0] === node;
        if (!forward && chain.nodes[1] !== node) continue;
        const next = chain.nodes[forward ? 1 : 0];
        if (seen.has(next)) continue;
        seen.add(next);
        from.set(next, { chain, forward, prev: node });
        queue.push(next);
      }
    }
    if (!from.has(nodeOf(eb))) return null;
    for (let node = nodeOf(eb); node !== nodeOf(ea); ) {
      const step = from.get(node)!;
      way.unshift({ chain: step.chain, forward: step.forward });
      node = step.prev;
    }
  }
  // One road going on: at each node of the way it turns no more than KERB_TURN (a corner between two roads is rounded).
  // Following the chains inside (`follow`) no more than FOLLOW_TURN: the kerb runs on the right of the way, and where
  // it turned back on itself (a ring between two mouths into a slip road) that edge lay across the way, the outline
  // folded and the junction fell apart
  if (!follow || way.length) {
    const most = Math.cos(follow ? FOLLOW_TURN : KERB_TURN);
    let dx = -ea.dx;
    let dy = -ea.dy;
    for (const w of way) {
      const out = endOf(w.chain, w.forward);
      if (dx * out.dx + dy * out.dy < most) return null;
      const back = endOf(w.chain, !w.forward);
      dx = -back.dx;
      dy = -back.dy;
    }
    if (dx * eb.dx + dy * eb.dy < most) return null;
  } else return null;
  // The pieces of the way: chain distances from d0 to d1 (the joints between pieces at the nodes)
  // From the road's end section (its ribbon's, ribbonSpan: a road trimmed away between two junctions ends where they
  // meet) to its node
  const ends = (e: End): [number, number] => {
    const c = e.chain;
    const [from, to] = ribbonSpan(c);
    return e.start ? [from, c.at[0]] : [to, c.at[0] + c.length];
  };
  const [a0, a1] = ends(ea);
  const [b1, b0] = ends(eb);
  // Each with its way along the chain (forward: as its distance grows), also where it has no length (a road not trimmed)
  const spans: { chain: Chain; d0: number; d1: number; forward: boolean; second: boolean }[] = [{ chain: ea.chain, d0: a0, d1: a1, forward: !ea.start, second: false }];
  for (const w of way) spans.push({ chain: w.chain, d0: w.forward ? w.chain.at[0] : w.chain.at[0] + w.chain.length, d1: w.forward ? w.chain.at[0] + w.chain.length : w.chain.at[0], forward: w.forward, second: false });
  spans.push({ chain: eb.chain, d0: b0, d1: b1, forward: eb.start, second: true });
  // At a joint between two widths of a road going on (turning at most KERB_TURN there) the edge tapers over twice the
  // change and a metre to their mean (as trimJunction tapers a road of two ends), so the two edges meet there instead
  // of stepping; at a corner between two roads each keeps its width (tapered, a road's kerb came in short of its edge)
  const heading = (k: number, end: boolean): MapPoint => {
    const t = tangentAt(spans[k].chain, end ? spans[k].d1 : spans[k].d0);
    return spans[k].forward ? t : { x: -t.x, y: -t.y };
  };
  const toward = (k: number, other: number): { to: number; reach: number } | null => {
    if (other < 0 || other >= spans.length) return null;
    const [first, second] = other < k ? [other, k] : [k, other];
    const a = heading(first, true);
    const b = heading(second, false);
    if (a.x * b.x + a.y * b.y < Math.cos(KERB_TURN)) return null;
    const step = Math.abs(spans[k].chain.half - spans[other].chain.half);
    return step < 0.05 ? null : { to: (spans[k].chain.half + spans[other].chain.half) / 2, reach: step * 2 + 1 };
  };
  // Each piece's edge on the right of the way round the junction (counter-clockwise, the surface on the left)
  const pieces = spans.map(({ chain, d0, d1, forward, second }, k) => {
    const before = k > 0 ? toward(k, k - 1) : null;
    const after = k < spans.length - 1 ? toward(k, k + 1) : null;
    const steps = Math.max(1, Math.ceil(Math.abs(d1 - d0)));
    const sign = forward ? 1 : -1;
    const out: (MapPoint & { walk: number; second: boolean })[] = [];
    for (let s = 0; s <= steps; s++) {
      const d = d0 + ((d1 - d0) * s) / steps;
      let half = chain.half;
      if (before) half += (before.to - chain.half) * Math.max(0, 1 - Math.abs(d - d0) / before.reach);
      if (after) half += (after.to - chain.half) * Math.max(0, 1 - Math.abs(d1 - d) / after.reach);
      const p = pointAt(chain, d);
      const t = tangentAt(chain, d);
      // Right of the way: right of the chain's direction going forward, left going back
      out.push({ x: p.x + t.y * half * t.scale * sign, y: p.y - t.x * half * t.scale * sign, walk: chain.walk, second });
    }
    return out;
  });
  // Joined piece by piece where the edges cross (the inside of a bend; at a joint that tapers, at the node): the
  // latest crossing on the way in, the earliest on the way out, a corner of more than KERB_ROUND rounded off by the
  // narrower road's kerb radius. Edges that part (the outside of a bend): at one node no kerb along them, the kerb
  // lines meet in front (lineMeet); between nodes a curve from one edge to the next through where their lines meet
  type KerbPoint = MapPoint & { walk: number; second: boolean };
  let line = pieces[0];
  for (let k = 1; k < pieces.length; k++) {
    const next = pieces[k];
    const radius = Math.min(6, Math.max(0.5, Math.min(spans[k - 1].chain.half, spans[k].chain.half) * 0.8 + 1));
    let joined: KerbPoint[] | null = null;
    for (let i = line.length - 1; i > 0 && !joined; i--) {
      for (let j = 0; j + 1 < next.length; j++) {
        const x = segmentCross(line[i - 1], line[i], next[j], next[j + 1]);
        if (!x) continue;
        const corner = { ...x, walk: line[i - 1].walk, second: line[i - 1].second };
        joined = follow ? roundJoint(line.slice(0, i), corner, next.slice(j + 1), radius) : [...line.slice(0, i), corner, ...next.slice(j + 1)];
        break;
      }
    }
    if (!joined && follow) {
      const p = line[line.length - 1];
      const q = next[0];
      let meet = line.length > 1 && next.length > 1 ? rayMeet(line[line.length - 2], p, q, next[1]) : null;
      // Not far beyond either (edges nearly parallel): straight across
      if (meet && Math.hypot(meet.x - p.x, meet.y - p.y) + Math.hypot(meet.x - q.x, meet.y - q.y) > Math.hypot(q.x - p.x, q.y - p.y) * 3 + 2) meet = null;
      const curve: KerbPoint[] = [];
      for (let s = 1; meet && s < CURVE_POINTS; s++) {
        const t = s / CURVE_POINTS;
        const u = 1 - t;
        const from = t < 0.5 ? p : q;
        curve.push({ x: u * u * p.x + 2 * u * t * meet.x + t * t * q.x, y: u * u * p.y + 2 * u * t * meet.y + t * t * q.y, walk: from.walk, second: from.second });
      }
      joined = [...line, ...curve, ...next];
    }
    if (!joined) return null;
    line = joined;
  }
  // Between the end sections (theirs are the ring's own points)
  return line.slice(1, -1);
}

/** Least turn (radians) of a kerb at a joint of kerbAlong's pieces that is rounded off */
const KERB_ROUND = Math.PI / 12;

/**
 * A kerb's corner at `x` (the line `before` comes in, `after` goes on)
 * rounded off: a curve from `radius` before it to `radius` after it (less where
 * a side is shorter), through the corner as its control point
 */
function roundJoint<T extends MapPoint & { walk: number; second: boolean }>(before: T[], x: T, after: T[], radius: number): T[] {
  const into = before[before.length - 1];
  const out = after[0];
  if (!into || !out) return [...before, x, ...after];
  const ax = x.x - into.x;
  const ay = x.y - into.y;
  const bx = out.x - x.x;
  const by = out.y - x.y;
  if (Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) < KERB_ROUND) return [...before, x, ...after];
  // Back along the incoming line and on along the outgoing one by the radius (at most two fifths of either)
  const walk = (points: T[], from: MapPoint, reach: number): { at: MapPoint; rest: T[] } => {
    let prev: MapPoint = from;
    for (let k = 0; k < points.length; k++) {
      const l = Math.hypot(points[k].x - prev.x, points[k].y - prev.y);
      if (l >= reach) {
        const t = reach / (l || 1);
        return { at: { x: prev.x + (points[k].x - prev.x) * t, y: prev.y + (points[k].y - prev.y) * t }, rest: points.slice(k) };
      }
      reach -= l;
      prev = points[k];
    }
    return { at: prev, rest: [] };
  };
  const length = (points: readonly MapPoint[], from: MapPoint) => points.reduce((s, p, k) => s + Math.hypot(p.x - (k ? points[k - 1] : from).x, p.y - (k ? points[k - 1] : from).y), 0);
  const back = [...before].reverse();
  const r = Math.min(radius, length(back, x) * 0.4, length(after, x) * 0.4);
  if (r < 0.05) return [...before, x, ...after];
  const s0 = walk(back, x, r);
  const s1 = walk(after, x, r);
  const curve: T[] = [];
  for (let s = 0; s <= CURVE_POINTS; s++) {
    const t = s / CURVE_POINTS;
    const u = 1 - t;
    curve.push({ ...(t < 0.5 ? into : out), x: u * u * s0.at.x + 2 * u * t * x.x + t * t * s1.at.x, y: u * u * s0.at.y + 2 * u * t * x.y + t * t * s1.at.y });
  }
  return [...s0.rest.reverse(), ...curve, ...s1.rest];
}

/** Where the line on from p through q (beyond q) meets the line back from s through r (before r), null behind either */
function rayMeet(p: MapPoint, q: MapPoint, r: MapPoint, s: MapPoint): MapPoint | null {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const ex = r.x - s.x;
  const ey = r.y - s.y;
  const det = dx * -ey - dy * -ex;
  if (Math.abs(det) < 1e-9) return null;
  // q + d * a = r + e * b, a, b >= 0
  const rx = r.x - q.x;
  const ry = r.y - q.y;
  const a = (rx * -ey - ry * -ex) / det;
  const b = (dx * ry - dy * rx) / det;
  if (a < 0 || b < 0) return null;
  return { x: q.x + dx * a, y: q.y + dy * a };
}

/** Where segment p-q crosses segment r-s, null when it does not */
function segmentCross(p: MapPoint, q: MapPoint, r: MapPoint, s: MapPoint): MapPoint | null {
  const d = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x);
  if (Math.abs(d) < 1e-12) return null;
  const t = ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / d;
  const u = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
}

/**
 * Where the kerb line through `a` (along road ea, back towards the node) meets
 * the one through `b` (along eb): the control point of the kerb curve; null
 * when they meet behind either end or not at all
 */
function lineMeet(a: MapPoint, ea: End, b: MapPoint, eb: End): MapPoint | null {
  // a - ea.d * p = b - eb.d * q
  const det = -ea.dx * eb.dy + ea.dy * eb.dx;
  if (Math.abs(det) < 1e-4) return null;
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  // -ea.d * p + eb.d * q = r
  const p = (rx * eb.dy - ry * eb.dx) / det;
  const q = (-ea.dx * ry + ea.dy * rx) / det;
  if (p < 0 || q < 0) return null;
  // Far behind both (roads nearly parallel, from nodes of a junction metres apart): no curve out of the junction
  const reach = Math.hypot(rx, ry) * 3 + 2;
  if (p > reach && q > reach) return null;
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
