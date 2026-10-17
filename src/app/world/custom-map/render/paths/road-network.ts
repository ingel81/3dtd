import type { MapPathEdge, MapPaths, MapPoint } from '../../map-document';
import { edgePolyline } from './path-mask';
import { encodeRoadStyle, PAVED_SURFACES, roadStyle, styleKey, type RoadStyle } from './road-style';

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
 * running on from the widest road's, its kerbs quadratic curves from one
 * road's edge to the next.
 *
 * Map space throughout: x east, y north, triangles counter-clockwise seen
 * from above (front faces up once in the scene, map-coords.ts). Heights come
 * from the terrain in the vertex shader, so the surface follows every edit.
 * The vertices go into tiles of TILE metres, a mesh each, for culling.
 */

/** Metres a side of a tile */
export const ROAD_TILE = 512;
/** Longest step between cross sections along a road: the terrain's cell, so the surface lies on it */
const STEP = 2;
/** Longest ribbon piece in one tile, metres */
const PIECE = 48;
/** Points per kerb curve and per half of a path's round end */
const CURVE_POINTS = 6;

/** One tile's geometry; per vertex: map position (2), across, along, distance to the edge, look (encodeRoadStyle) (4), direction along (2) */
export interface RoadTile {
  key: string;
  /** Lower corner of the tile, map metres */
  x: number;
  y: number;
  position: Float32Array;
  road: Float32Array;
  dir: Float32Array;
  index: Uint32Array;
}

export interface RoadNetwork {
  tiles: RoadTile[];
  /** The looks the roads have, each once */
  styles: RoadStyle[];
  /** The surfaces in the order the looks name their layers (encodeRoadStyle) */
  surfaces: string[];
}

/** Whether an edge is drawn by the road surface */
export function pavedEdge(edge: MapPathEdge): boolean {
  return edge.kind !== 'bridge' && !edge.tunnel && !!edge.surface && PAVED_SURFACES.has(edge.surface);
}

interface Chain {
  edge: MapPathEdge;
  line: MapPoint[];
  /** Distance along at each point of `line` */
  at: number[];
  length: number;
  half: number;
  style: number;
  trim: [number, number];
  /** Cross sections at both ends of the drawn ribbon, right to left seen along the ribbon */
  ends: [Section | null, Section | null];
  cap: [boolean, boolean];
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
}

type Section = Vertex[];

interface End {
  chain: Chain;
  start: boolean;
  /** Unit direction away from the node */
  dx: number;
  dy: number;
  angle: number;
}

/** A tile's vertices and triangles as they grow */
class TileData {
  v = new Float32Array(1024);
  r = new Float32Array(2048);
  d = new Float32Array(1024);
  i = new Uint32Array(3072);
  vertices = 0;
  indices = 0;

  constructor(
    readonly x: number,
    readonly y: number,
  ) {}

  vertex(p: Vertex): void {
    const n = this.vertices;
    if (n * 2 + 2 > this.v.length) {
      this.v = grow(this.v);
      this.r = grow(this.r);
      this.d = grow(this.d);
    }
    this.v[n * 2] = p.x;
    this.v[n * 2 + 1] = p.y;
    this.r[n * 4] = p.across;
    this.r[n * 4 + 1] = p.along;
    this.r[n * 4 + 2] = p.edge;
    this.r[n * 4 + 3] = p.style;
    this.d[n * 2] = p.dx;
    this.d[n * 2 + 1] = p.dy;
    this.vertices++;
  }

  triangle(a: number, b: number, c: number): void {
    if (this.indices + 3 > this.i.length) this.i = grow(this.i);
    this.i[this.indices++] = a;
    this.i[this.indices++] = b;
    this.i[this.indices++] = c;
  }
}

function grow<T extends Float32Array | Uint32Array>(a: T): T {
  const b = new (a.constructor as new (n: number) => T)(a.length * 2);
  b.set(a);
  return b;
}

class TileBuilder {
  private readonly tiles = new Map<string, TileData>();

  /** The tile holding a map point */
  tileAt(p: MapPoint): TileData {
    const tx = Math.floor(p.x / ROAD_TILE);
    const ty = Math.floor(p.y / ROAD_TILE);
    const key = `${tx},${ty}`;
    let t = this.tiles.get(key);
    if (!t) {
      t = new TileData(tx * ROAD_TILE, ty * ROAD_TILE);
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

  build(): RoadTile[] {
    return [...this.tiles.entries()].map(([key, t]) => ({
      key,
      x: t.x,
      y: t.y,
      position: t.v.slice(0, t.vertices * 2),
      road: t.r.slice(0, t.vertices * 4),
      dir: t.d.slice(0, t.vertices * 2),
      index: t.i.slice(0, t.indices),
    }));
  }
}

/** The road surface of `paths` (see above) */
export function buildRoadNetwork(paths: MapPaths): RoadNetwork {
  const nodes = new Map<string, MapPoint>(paths.nodes.map((n) => [n.id, n]));
  const paved = paths.edges.filter(pavedEdge);
  const styles: RoadStyle[] = [];
  const surfaces: string[] = [];
  const codes = new Map<string, number>();
  // The code of a look for the vertices, its surface given a layer on first sight
  const styleOf = (s: RoadStyle): number => {
    const key = styleKey(s);
    let code = codes.get(key);
    if (code === undefined) {
      if (!surfaces.includes(s.surface)) surfaces.push(s.surface);
      code = encodeRoadStyle(s, surfaces.indexOf(s.surface));
      styles.push(s);
      codes.set(key, code);
    }
    return code;
  };

  // Edges at each node: the paved ones, and whether anything else meets there (a bridge, a tunnel, a track)
  const at = new Map<string, MapPathEdge[]>();
  const other = new Set<string>();
  for (const e of paths.edges) {
    if (pavedEdge(e)) {
      for (const n of [e.a, e.b]) at.set(n, [...(at.get(n) ?? []), e]);
    } else {
      other.add(e.a);
      other.add(e.b);
    }
  }

  // Chains: edges of one look joined where they meet each other and nothing else
  const used = new Set<MapPathEdge>();
  const chains: Chain[] = [];
  const ends: { node: string; chain: Chain; start: boolean }[] = [];
  for (const first of paved) {
    if (used.has(first)) continue;
    used.add(first);
    const key = styleKey(roadStyle(first));
    const next = (node: string, from: MapPathEdge): MapPathEdge | null => {
      const list = at.get(node) ?? [];
      if (list.length !== 2) return null;
      const o = list[0] === from ? list[1] : list[0];
      if (used.has(o) || Math.abs(o.width - from.width) > 0.3 || styleKey(roadStyle(o)) !== key) return null;
      return o;
    };
    let line = edgePolyline(first, nodes);
    if (!line) continue;
    // Forward from b, backward from a
    let tail = first.b;
    for (let e = next(tail, first); e; e = next(tail, e)) {
      used.add(e);
      const l = edgePolyline(e, nodes);
      if (!l) break;
      const forward = e.a === tail;
      line = [...line, ...(forward ? l : [...l].reverse()).slice(1)];
      tail = forward ? e.b : e.a;
    }
    let head = first.a;
    for (let e = next(head, first); e; e = next(head, e)) {
      used.add(e);
      const l = edgePolyline(e, nodes);
      if (!l) break;
      const backward = e.b === head;
      line = [...(backward ? l : [...l].reverse()).slice(0, -1), ...line];
      head = backward ? e.a : e.b;
    }
    const half = first.width / 2;
    const clean = roundCorners(dropDoubles(line), half);
    if (clean.length < 2) continue;
    // Distance along from an offset of its own: no two roads start their patches and dashes alike
    const dist = [((chains.length * 7919) % 997) + 0.5];
    for (let k = 1; k < clean.length; k++) dist.push(dist[k - 1] + Math.hypot(clean[k].x - clean[k - 1].x, clean[k].y - clean[k - 1].y));
    const chain: Chain = {
      edge: first,
      line: clean,
      at: dist,
      length: dist[dist.length - 1] - dist[0],
      half,
      style: styleOf(roadStyle(first)),
      trim: [0, 0],
      ends: [null, null],
      cap: [false, false],
    };
    chains.push(chain);
    ends.push(...[head, tail].map((node, k) => ({ node, chain, start: k === 0 })));
  }
  return finish();

  // The ends by node, then trims, ribbons and junctions
  function finish(): RoadNetwork {
    const byNode = new Map<string, End[]>();
    for (const { node, chain, start } of ends) {
      const p = start ? chain.line[0] : chain.line[chain.line.length - 1];
      const reach = Math.min(3, chain.length * 0.3);
      const q = pointAt(chain, chain.at[0] + (start ? reach : chain.length - reach));
      const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      const end: End = { chain, start, dx: (q.x - p.x) / l, dy: (q.y - p.y) / l, angle: 0 };
      end.angle = Math.atan2(end.dy, end.dx);
      byNode.set(node, [...(byNode.get(node) ?? []), end]);
    }
    for (const [node, list] of byNode) {
      if (list.length === 1) {
        // A path that ends with nothing else there gets a round end; a road ends square
        const e = list[0];
        e.chain.cap[e.start ? 0 : 1] = e.chain.edge.kind === 'path' && !other.has(node);
      } else {
        trimJunction(nodes.get(node)!, list);
      }
    }
    const out = new TileBuilder();
    for (const chain of chains) emitRibbon(chain, out);
    for (const [node, list] of byNode) if (list.length > 1) emitJunction(nodes.get(node)!, list, out, styleOf);
    return { tiles: out.build(), styles, surfaces };
  }
}

/** Trim lengths of the roads meeting at a junction: past where each road's kerb meets the next, plus a kerb radius */
function trimJunction(c: MapPoint, list: End[]): void {
  list.sort((a, b) => a.angle - b.angle);
  const n = list.length;
  const trims = list.map(() => 0);
  const widest = Math.max(...list.map((e) => e.chain.half));
  for (let k = 0; k < n; k++) {
    const a = list[k];
    const b = list[(k + 1) % n];
    let gap = b.angle - a.angle;
    if (gap <= 0) gap += Math.PI * 2;
    // Nearly straight on, or the outside of a bend: the kerbs meet at the node
    if (gap > Math.PI * 0.94 || n === 1) continue;
    const corner = kerbCorner(c, a, b);
    if (!corner) continue;
    const radius = Math.min(6, Math.max(0.5, Math.min(a.chain.half, b.chain.half) * 0.8 + (a.chain.edge.kind === 'path' ? 0 : 1)));
    trims[k] = Math.max(trims[k], corner.t + radius);
    trims[(k + 1) % n] = Math.max(trims[(k + 1) % n], corner.s + radius);
  }
  list.forEach((e, k) => {
    const limit = Math.min(e.chain.length * 0.45, widest * 4 + 6);
    e.chain.trim[e.start ? 0 : 1] = Math.max(0, Math.min(limit, trims[k]));
  });
}

/**
 * Where road a's left kerb meets road b's right kerb (b the next road
 * counter-clockwise), as distances along each from the node; null when they
 * do not meet in front of the node
 */
function kerbCorner(c: MapPoint, a: End, b: End): { t: number; s: number; x: number; y: number } | null {
  const ha = a.chain.half;
  const hb = b.chain.half;
  // a's left kerb: c + na * ha + da * t; b's right kerb: c - nb * hb + db * s
  const nax = -a.dy;
  const nay = a.dx;
  const nbx = -b.dy;
  const nby = b.dx;
  const rx = -nbx * hb - nax * ha;
  const ry = -nby * hb - nay * ha;
  // da * t - db * s = r
  const det = a.dx * -b.dy - a.dy * -b.dx;
  if (Math.abs(det) < 1e-6) return null;
  const t = (rx * -b.dy - ry * -b.dx) / det;
  const s = (a.dx * ry - a.dy * rx) / det;
  if (t < -1e-6 || s < -1e-6) return null;
  return { t: Math.max(0, t), s: Math.max(0, s), x: c.x + nax * ha + a.dx * t, y: c.y + nay * ha + a.dy * t };
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
  // The ground under a road is levelled flat across: three columns carry a road up to 9 m, five a wider one
  const columns = h <= 4.5 ? [-1, 0, 1] : [-1, -0.5, 0, 0.5, 1];
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
      edge: h * (1 - Math.abs(u)),
      style: chain.style,
      dx: t.x,
      dy: t.y,
    }));
  });
  chain.ends = [sections[0], sections[sections.length - 1]];
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

/** A half disc beyond an end section: `sign` +1 beyond the ribbon's end, -1 before its start */
function emitCap(section: Section, sign: number, out: TileBuilder): void {
  const mid = section[(section.length - 1) / 2];
  const h = (section[section.length - 1].across - section[0].across) / 2;
  const verts: Vertex[] = [mid];
  // From the right edge round the far side to the left one (counter-clockwise beyond the end, clockwise before the start)
  for (let k = 0; k <= CURVE_POINTS * 2; k++) {
    const a = (k / (CURVE_POINTS * 2)) * Math.PI;
    const across = -Math.cos(a) * h;
    const ahead = Math.sin(a) * h * sign;
    verts.push({
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
  const tris: number[] = [];
  for (let k = 1; k < verts.length - 1; k++) {
    if (sign > 0) tris.push(0, k, k + 1);
    else tris.push(0, k + 1, k);
  }
  out.add(verts, tris);
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
  // The widest road's texture runs on over the junction
  let main = 0;
  for (let k = 1; k < list.length; k++) if (list[k].chain.half > list[main].chain.half) main = k;
  const m = list[main];
  const mainSection = sides[main]!;
  const anchor = mainSection[(mainSection.length - 1) / 2];
  const style = styleOf(roadStyle(m.chain.edge, true));
  // Along the ribbon's own direction at its end, so its texture runs on without a seam
  const fx = anchor.dx;
  const fy = anchor.dy;
  const frame = (x: number, y: number, edge: number): Vertex => ({
    x,
    y,
    across: (x - anchor.x) * -fy + (y - anchor.y) * fx,
    along: anchor.along + (x - anchor.x) * fx + (y - anchor.y) * fy,
    edge,
    style,
    dx: fx,
    dy: fy,
  });
  const ring: Vertex[] = [];
  const n = list.length;
  for (let k = 0; k < n; k++) {
    const side = sides[k]!;
    for (const v of side) ring.push(frame(v.x, v.y, v.edge));
    // The kerb to the next road: a curve through where both kerbs would meet, else straight
    const a = side[side.length - 1];
    const next = sides[(k + 1) % n]!;
    const b = next[0];
    const ea = list[k];
    const eb = list[(k + 1) % n];
    const cross = n > 1 ? lineMeet(a, ea, b, eb) : null;
    if (cross) {
      for (let s = 1; s < CURVE_POINTS; s++) {
        const t = s / CURVE_POINTS;
        const u = 1 - t;
        ring.push(frame(u * u * a.x + 2 * u * t * cross.x + t * t * b.x, u * u * a.y + 2 * u * t * cross.y + t * t * b.y, 0));
      }
    }
  }
  const centre = frame(c.x, c.y, Math.min(...list.map((e) => e.chain.half)));
  const verts = [centre, ...ring];
  const tris: number[] = [];
  for (let k = 0; k < ring.length; k++) {
    const p = ring[k];
    const q = ring[(k + 1) % ring.length];
    // Skip slivers the wrong way round (a ring folding over the node at a very sharp junction)
    if ((p.x - c.x) * (q.y - c.y) - (p.y - c.y) * (q.x - c.x) <= 0) continue;
    tris.push(0, 1 + k, 1 + ((k + 1) % ring.length));
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
