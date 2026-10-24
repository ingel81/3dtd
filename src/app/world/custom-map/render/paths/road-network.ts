import type { MapPathEdge, MapPaths, MapPoint } from '../../map-document';
import { edgePolyline, type RoadCover } from './path-mask';
import { encodeRoadStyle, PAVED_SURFACES, roadStyle, styleKey, type RoadStyle } from './road-style';
import { DRAPE_TILE } from '../drape/draped-layer';
import { conformDraped, type DrapeGround, type DrapeRect } from '../drape/draped-refine';
import type { DrapedConformPool } from '../drape/draped-conform-pool';
import type { ConformJob } from '../drape/draped-conform-protocol';
import type { Chain, End, Section, Vertex } from './road-types';
import { TileBuilder, TileData } from './road-tiles';
import { alongOffset, COLUMNS, dropDoubles, endOf, endSection, inRing, orderOf, pointAt, ribbonSpan, roundCorners, sectionAt, simpleRing } from './road-geometry';
import { CURVE_POINTS } from './road-kerb';
import { clusterCentre, clusterJunctions, emitJunction, junctionOutline, outlineAround, trimJunction } from './road-junction';

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
const SIDEWALK_SURFACE = 'sidewalk';

/** Whether an edge is drawn by the road surface */
function pavedEdge(edge: MapPathEdge): boolean {
  return edge.kind !== 'bridge' && !edge.tunnel && !edge.area && !!edge.surface && PAVED_SURFACES.has(edge.surface);
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
    const { touched, changed, at, decks, others } = this.diffEdges(paths, nodes);
    const rebuilt = new Set<string>();
    this.dropChains(touched, changed, rebuilt);
    const made = this.newChains(paths, at, nodes);
    // The junctions at every node a new chain ends at, then the geometry. Nodes a short chain joins, too close for a
    // ribbon between their junctions, are one junction (a cluster): with the nodes clustered with them before
    const lay = new Set<string>();
    for (const c of made) c.nodes.forEach((n) => lay.add(n));
    for (const n of touched) lay.add(n);
    for (const n of [...lay]) for (const m of this.members.get(this.clusterOf.get(n) ?? '') ?? []) lay.add(m);
    const endsOf = this.endsLookup(at, decks, nodes);
    const clusters = fitClusters(lay, endsOf, nodes);
    const before = this.trimsBefore(clusters);
    for (const nodeList of clusters) this.layJunction(nodeList, endsOf, nodes, others, rebuilt);
    this.relayMoved(before, made, rebuilt);
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

  /** The edges that changed, came or went since the last lay, the nodes they touch, and the paved edges and bridges at each node */
  private diffEdges(
    paths: MapPaths,
    nodes: ReadonlyMap<string, MapPoint>,
  ): { touched: Set<string>; changed: Set<string>; at: Map<string, MapPathEdge[]>; decks: Map<string, MapPathEdge[]>; others: Set<string> } {
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
    return { touched, changed, at, decks, others };
  }

  /** Chains holding a changed edge give their ends; every chain ending at a touched node goes, to be laid again */
  private dropChains(touched: Set<string>, changed: ReadonlySet<string>, rebuilt: Set<string>): void {
    const holds = (c: Chain) => c.edges.some((id) => changed.has(id));
    for (const c of this.chains.values()) if (holds(c)) c.nodes.forEach((n) => touched.add(n));
    const dropped: Chain[] = [];
    for (const c of this.chains.values()) if (holds(c) || touched.has(c.nodes[0]) || touched.has(c.nodes[1])) dropped.push(c);
    for (const c of dropped) {
      this.chains.delete(c.id);
      for (const id of c.edges) if (this.chainOf.get(id) === c) this.chainOf.delete(id);
      this.dropItem(`c${c.id}`, rebuilt);
    }
  }

  /** New chains from the free paved edges */
  private newChains(paths: MapPaths, at: Map<string, MapPathEdge[]>, nodes: Map<string, MapPoint>): Chain[] {
    const made: Chain[] = [];
    for (const e of paths.edges) {
      if (!pavedEdge(e) || this.chainOf.has(e.id)) continue;
      const c = this.chain(e, at, nodes);
      if (!c) continue;
      made.push(c);
      this.chains.set(c.id, c);
    }
    return made;
  }

  /** The roads' ends at a node, once each: a footway onto a pavement joins it, a bridge going on is an arm (bridgeStub) */
  private endsLookup(at: ReadonlyMap<string, MapPathEdge[]>, decks: ReadonlyMap<string, MapPathEdge[]>, nodes: ReadonlyMap<string, MapPoint>): (node: string) => End[] {
    const endsAt = new Map<string, End[]>();
    return (node: string): End[] => {
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
  }

  /** Trims of the kept chains at the junctions laid, to see whether they moved, and whether they were inside a cluster */
  private trimsBefore(clusters: readonly string[][]): Map<Chain, [number, number, boolean, string]> {
    const laid = new Set(clusters.flat());
    const before = new Map<Chain, [number, number, boolean, string]>();
    const ends = (c: Chain) => `${+c.cap[0]}${+c.cap[1]}`;
    for (const c of this.chains.values()) if (laid.has(c.nodes[0]) || laid.has(c.nodes[1])) before.set(c, [c.trim[0], c.trim[1], c.inner, ends(c)]);
    return before;
  }

  /** The junction of `nodeList` (a node or a cluster): the clusters its nodes were in go, its roads' ends trimmed, a lone end capped */
  private layJunction(nodeList: string[], endsOf: (node: string) => End[], nodes: ReadonlyMap<string, MapPoint>, others: ReadonlySet<string>, rebuilt: Set<string>): void {
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

  /** A kept chain whose trim moved (it ends at a junction laid again) or that went in or out of a cluster is laid again */
  private relayMoved(before: ReadonlyMap<Chain, [number, number, boolean, string]>, made: Chain[], rebuilt: Set<string>): void {
    const ends = (c: Chain) => `${+c.cap[0]}${+c.cap[1]}`;
    const fresh = new Set(made);
    for (const [c, was] of before) {
      if (fresh.has(c) || (was[0] === c.trim[0] && was[1] === c.trim[1] && was[2] === c.inner && was[3] === ends(c))) continue;
      this.dropItem(`c${c.id}`, rebuilt);
      made.push(c);
    }
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

/**
 * The junctions to lay, by their nodes. A cluster whose outline neither runs round its middle (fanned from there)
 * nor is a polygon (triangulated as one; roads from its nodes side by side, crossing each other's ends) is laid as
 * its nodes alone
 */
function fitClusters(lay: ReadonlySet<string>, endsOf: (node: string) => End[], nodes: ReadonlyMap<string, MapPoint>): string[][] {
  return clusterJunctions(lay, endsOf).flatMap((group) => {
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
