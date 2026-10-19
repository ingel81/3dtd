import { ShapeUtils, Vector2 } from 'three';
import type { MapPoint, MapSurface, MapSurfaceMarkingKind } from '../../map-document';
import { courtOf, surfaceArea } from '../../map-surfaces';

/**
 * A surface (MapSurface) as triangles for the draped surface layer: the
 * outline and its holes triangulated (earcut), every triangle cut along
 * cells (cutCells) that are as large as the ground lets them be: one plane
 * of ground under a cell, few edges near it. So the surface follows the
 * ground between its corners (the terrain's height is read per vertex)
 * without a triangle more than flat ground needs. The pieces go into the
 * layer's tiles. Map space throughout, triangles counter-clockwise seen
 * from above.
 *
 * Per vertex besides its map point (SurfacePiece.mark, .look):
 *   - where it lies in the marking's frame (`u` along the rectangle's long
 *     side, `v` across, from its middle) and half the court's length and
 *     width (map-surfaces.ts courtOf); without a marking the map point and
 *     no court. The texture runs in this frame, so a pitch's grain and its
 *     mowing stripes run along it;
 *   - the look: material layer, marking, rank (surfaceLook); the edges of
 *     the outline and holes near its grid cell (SurfaceEdges), from which
 *     the shader measures each pixel's distance to the edge exactly (a
 *     distance per vertex, interpolated, bent at every corner); and the
 *     direction of the frame's `u` (the texture's grain and normals).
 */

/** Metres of the largest cell the triangles are cut along (quartered on uneven ground and near many edges) */
export const MAX_SURFACE_CELL = 64;
/** Metres the ground may stand off the plane of a cell's corners before the cell is quartered */
const PLANE_TOLERANCE = 0.008;
/** Metres a side of the surfaces' tiles (a mesh each): wider than the roads', the surfaces cover little of them */
export const SURFACE_TILE = 1024;
/** Metres from its cell an edge is listed for (the look reads the edge's distance up to this: kerbs, contact shade) */
export const EDGE_REACH = 1;
/** Most edges listed for one cell (four bits of the reference, EDGE_REF): the nearest */
export const MAX_CELL_EDGES = 15;
/** A cell's edge reference: where its list starts times EDGE_REF, plus how many */
export const EDGE_REF = 16;

/** The marking's code in the look (0: none) */
export const MARKING_CODE: Readonly<Record<MapSurfaceMarkingKind, number>> = {
  soccer: 1,
  handball: 2,
  basketball: 3,
  tennis: 4,
  volleyball: 5,
  multi: 6,
  track: 7,
  parking: 8,
  platform: 9,
};

/** Most rank: of two surfaces that overlap, the one of higher rank is drawn over the other (DrapePull, surfaceRanks) */
export const MAX_SURFACE_RANK = 15;

/** The look of a vertex as one float: layer (4 bits), marking (4 bits), rank (4 bits) */
export function surfaceLook(layer: number, kind: MapSurfaceMarkingKind | undefined, rank: number): number {
  return Math.min(15, layer) + 16 * (kind ? MARKING_CODE[kind] : 0) + 256 * Math.min(MAX_SURFACE_RANK, rank);
}

/** Metres of a cell of the index surfaceRanks finds overlaps by */
const RANK_CELL = 64;

/**
 * Each surface's rank, so that of two that overlap the smaller lies over
 * the larger and none of one rank overlaps another of it (two at one depth
 * would fight): the larger first, each one rank over the highest of those
 * before it whose box it overlaps, up to MAX_SURFACE_RANK. Boxes, by the
 * cells of a coarse grid: a square of setts and the paths through it, a
 * court on a playground
 */
export function surfaceRanks(surfaces: readonly MapSurface[]): Map<string, number> {
  const boxes = surfaces.map((s) => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of s.outer) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    return { s, x0, y0, x1, y1, area: surfaceArea(s), rank: 0 };
  });
  const cells = new Map<number, typeof boxes>();
  const out = new Map<string, number>();
  for (const b of [...boxes].sort((p, q) => q.area - p.area)) {
    const i0 = Math.floor(b.x0 / RANK_CELL);
    const i1 = Math.floor(b.x1 / RANK_CELL);
    const j0 = Math.floor(b.y0 / RANK_CELL);
    const j1 = Math.floor(b.y1 / RANK_CELL);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        for (const o of cells.get(i * 65536 + j) ?? []) {
          if (o.x0 < b.x1 && b.x0 < o.x1 && o.y0 < b.y1 && b.y0 < o.y1) b.rank = Math.max(b.rank, o.rank + 1);
        }
      }
    }
    b.rank = Math.min(MAX_SURFACE_RANK, b.rank);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const key = i * 65536 + j;
        let list = cells.get(key);
        if (!list) cells.set(key, (list = []));
        list.push(b);
      }
    }
    out.set(b.s.id, b.rank);
  }
  return out;
}

/**
 * A surface's triangles in one tile, as the tile's buffers take them
 * (SurfaceLayer keeps every surface's pieces to put a tile together again
 * after an edit: plain number arrays held 95 MB on an OSM city)
 */
export interface SurfacePiece {
  /** Map x, y per vertex */
  position: Float32Array;
  /** u, v, half court length, half court width per vertex */
  mark: Float32Array;
  /**
   * Look, edges, the frame's direction (radians) per vertex. Edges: where
   * the cell's list starts in the surface's edges times EDGE_REF, plus how
   * many (0: none near)
   */
  look: Float32Array;
  index: Uint32Array;
}

/** A piece while its triangles come in */
interface GrowingPiece {
  position: number[];
  mark: number[];
  look: number[];
  index: number[];
}

/** A surface's triangles by tile key, and the edges its cells list (x0, y0, x1, y1 each, map metres) */
export interface SurfaceMesh {
  pieces: Map<string, SurfacePiece>;
  edges: Float32Array;
}

/** The ground a surface lies on: its height at a map point, the metres between its samples and where its grid starts */
export interface SurfaceGround {
  heightAt(x: number, y: number): number;
  cell: number;
  originX: number;
  originY: number;
}

/** A cell the triangles are cut along: its lower corner, its side and the reference of the edges near it */
interface Leaf {
  x0: number;
  y0: number;
  size: number;
  ref: number;
}

/**
 * The surface's triangles by tile key; `layer` is its material's texture
 * layer, `rank` its rank (surfaceRanks), `ground` the terrain it follows
 * (flat without), `tile` the side of the layer's tiles
 */
export function surfacePieces(s: MapSurface, layer: number, rank = 0, ground: SurfaceGround | null = null, tile = SURFACE_TILE): SurfaceMesh {
  const outer = clean(s.outer);
  const holes = (s.holes ?? []).map(clean).filter((h) => h.length >= 3);
  const out = new Map<string, GrowingPiece>();
  if (outer.length < 3) return { pieces: new Map(), edges: new Float32Array(0) };
  const points = [outer, ...holes].flat();
  // Vectors (the triangulation compares them), copies (it trims a ring's repeated end point in place)
  const vectors = (ring: readonly MapPoint[]) => ring.map((p) => new Vector2(p.x, p.y));
  const faces = ShapeUtils.triangulateShape(vectors(outer), holes.map(vectors));
  const m = s.marking;
  const court = m ? courtOf(m) : null;
  const look = surfaceLook(layer, m?.kind, rank);
  // The frame's direction: the marking's long side, else east (the map point is the frame)
  const angle = m && court ? m.angle : 0;
  const edges = ringEdges([outer, ...holes]);
  const listed: number[] = [];
  const leaves = cutCells(edges, outer, holes, ground, (near) => {
    const ref = near.length ? (listed.length / 4) * EDGE_REF + near.length : 0;
    for (const k of near) listed.push(edges[k], edges[k + 1], edges[k + 2], edges[k + 3]);
    return ref;
  });
  // Each piece its own vertices (a fan over the convex piece): sharing them across pieces cost more to find than
  // the few vertices it saves
  const cos = m ? Math.cos(m.angle) : 1;
  const sin = m ? Math.sin(m.angle) : 0;
  let last: { key: string; piece: GrowingPiece } | null = null;

  const emit = (poly: Float64Array, count: number, ref: number) => {
    let cx = 0;
    let cy = 0;
    for (let k = 0; k < count; k++) {
      cx += poly[k * 2];
      cy += poly[k * 2 + 1];
    }
    const key = `${Math.floor(cx / count / tile)},${Math.floor(cy / count / tile)}`;
    let piece = last?.key === key ? last.piece : out.get(key);
    if (!piece) out.set(key, (piece = { position: [], mark: [], look: [], index: [] }));
    last = { key, piece };
    const first = piece.position.length / 2;
    for (let v = 0; v < count; v++) {
      const x = poly[v * 2];
      const y = poly[v * 2 + 1];
      piece.position.push(x, y);
      if (m && court) {
        const dx = x - m.x;
        const dy = y - m.y;
        piece.mark.push(dx * cos + dy * sin, -dx * sin + dy * cos, court.length / 2, court.width / 2);
      } else piece.mark.push(x, y, 0, 0);
      piece.look.push(look, ref, angle);
    }
    for (let k = 1; k + 1 < count; k++) piece.index.push(first, first + k, first + k + 1);
  };
  const clip = new CellClipper();
  const found: Leaf[] = [];

  for (const f of faces) {
    let a = points[f[0]];
    let b = points[f[1]];
    const c = points[f[2]];
    if (!a || !b || !c) continue;
    const turn = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(turn) < 1e-9) continue;
    if (turn < 0) [a, b] = [b, a];
    const x0 = Math.min(a.x, b.x, c.x);
    const x1 = Math.max(a.x, b.x, c.x);
    const y0 = Math.min(a.y, b.y, c.y);
    const y1 = Math.max(a.y, b.y, c.y);
    leaves.near(x0, y0, x1, y1, found);
    for (const leaf of found) {
      clip.start(a, b, c);
      // Whole inside its cell: as it is
      const whole = x0 >= leaf.x0 && x1 <= leaf.x0 + leaf.size && y0 >= leaf.y0 && y1 <= leaf.y0 + leaf.size;
      const count = whole ? 3 : clip.cut(leaf.x0, leaf.y0, leaf.x0 + leaf.size, leaf.y0 + leaf.size);
      if (count < 3 || (!whole && clip.area() <= 1e-6)) continue;
      // A cell of the ground's own grid: cut along the diagonal its two triangles meet on (TERRAIN_HEIGHT_GLSL), so
      // between its corners the surface lies on the ground's triangles, not across them
      if (ground && leaf.size <= ground.cell + 1e-9) {
        const s0 = leaf.x0;
        const t0 = leaf.y0;
        const e = leaf.size;
        const h00 = ground.heightAt(s0, t0);
        const h10 = ground.heightAt(s0 + e, t0);
        const h01 = ground.heightAt(s0, t0 + e);
        const h11 = ground.heightAt(s0 + e, t0 + e);
        // Main diagonal (x - y constant) or the other (x + y constant)
        const main = Math.abs(h00 - h11) <= Math.abs(h10 - h01);
        for (const side of [1, -1]) {
          const n = main ? clip.half(side, -side, -side * (s0 - t0), count) : clip.half(side, side, -side * (s0 + t0 + e), count);
          if (n >= 3) emit(clip.halfPoints, n, leaf.ref);
        }
        continue;
      }
      emit(clip.points, count, leaf.ref);
    }
  }
  const pieces = new Map<string, SurfacePiece>();
  for (const [key, p] of out) {
    pieces.set(key, { position: Float32Array.from(p.position), mark: Float32Array.from(p.mark), look: Float32Array.from(p.look), index: Uint32Array.from(p.index) });
  }
  return { pieces, edges: Float32Array.from(listed) };
}

/**
 * The cells the triangles are cut along: squares of the grid of
 * MAX_SURFACE_CELL metres, quartered where the ground under them is not one
 * plane (within PLANE_TOLERANCE), so the surface follows it, and where more
 * than MAX_CELL_EDGES edges come near (the shader reads that many), down to
 * the ground's own cell. Flat ground (a car park, a levelled pitch, a
 * square in town) gets few big cells; a slope with bumps the ground's grid.
 * `list` takes the edges near a leaf and gives their reference
 */
function cutCells(edges: Float64Array, outer: readonly MapPoint[], holes: readonly MapPoint[][], ground: SurfaceGround | null, list: (near: number[]) => number): LeafIndex {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of outer) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const least = Math.max(1, ground?.cell ?? 2);
  // The grid starts where the ground's does, so its smallest cells are the ground's
  const ox = ground?.originX ?? 0;
  const oy = ground?.originY ?? 0;
  // Each edge's box grown by the reach, for the tests per cell
  const boxes = new Float64Array(edges.length);
  for (let k = 0; k < edges.length; k += 4) {
    boxes[k] = Math.min(edges[k], edges[k + 2]) - EDGE_REACH;
    boxes[k + 1] = Math.min(edges[k + 1], edges[k + 3]) - EDGE_REACH;
    boxes[k + 2] = Math.max(edges[k], edges[k + 2]) + EDGE_REACH;
    boxes[k + 3] = Math.max(edges[k + 1], edges[k + 3]) + EDGE_REACH;
  }
  const index = new LeafIndex(ox, oy);
  const visit = (cx0: number, cy0: number, size: number, candidates: readonly number[]) => {
    const cx1 = cx0 + size;
    const cy1 = cy0 + size;
    const near: number[] = [];
    for (const k of candidates) {
      if (boxes[k] > cx1 || boxes[k + 2] < cx0 || boxes[k + 1] > cy1 || boxes[k + 3] < cy0) continue;
      if (segmentMeetsBox(edges[k], edges[k + 1], edges[k + 2], edges[k + 3], cx0 - EDGE_REACH, cy0 - EDGE_REACH, cx1 + EDGE_REACH, cy1 + EDGE_REACH)) near.push(k);
    }
    // No edge near and the middle outside: nothing of the surface lies here
    const mid = { x: cx0 + size / 2, y: cy0 + size / 2 };
    if (!near.length && (!insideRing(mid, outer) || holes.some((h) => insideRing(mid, h)))) return;
    const small = size / 2 < least - 1e-9;
    if (!small && (near.length > MAX_CELL_EDGES || !planar(ground, cx0, cy0, size))) {
      const h = size / 2;
      // A quarter can only meet edges its parent meets; with none near, it lies wholly inside
      const pass = near.length ? near : [];
      visit(cx0, cy0, h, pass);
      visit(cx0 + h, cy0, h, pass);
      visit(cx0, cy0 + h, h, pass);
      visit(cx0 + h, cy0 + h, h, pass);
      return;
    }
    if (near.length > MAX_CELL_EDGES) {
      near.sort((p, q) => segmentDistance(edges, p, mid.x, mid.y) - segmentDistance(edges, q, mid.x, mid.y));
      near.length = MAX_CELL_EDGES;
    }
    index.add({ x0: cx0, y0: cy0, size, ref: list(near) });
  };
  // The edges by the top cells their grown boxes touch: a top cell tests its own, not the outline's every edge
  const top = new Map<number, number[]>();
  for (let k = 0; k < edges.length; k += 4) {
    for (let j = Math.floor((boxes[k + 1] - oy) / MAX_SURFACE_CELL); j <= Math.floor((boxes[k + 3] - oy) / MAX_SURFACE_CELL); j++) {
      for (let i = Math.floor((boxes[k] - ox) / MAX_SURFACE_CELL); i <= Math.floor((boxes[k + 2] - ox) / MAX_SURFACE_CELL); i++) {
        const key = i * 65536 + j;
        let list = top.get(key);
        if (!list) top.set(key, (list = []));
        list.push(k);
      }
    }
  }
  const none: number[] = [];
  for (let j = Math.floor((y0 - oy) / MAX_SURFACE_CELL); oy + j * MAX_SURFACE_CELL <= y1; j++) {
    for (let i = Math.floor((x0 - ox) / MAX_SURFACE_CELL); ox + i * MAX_SURFACE_CELL <= x1; i++) {
      visit(ox + i * MAX_SURFACE_CELL, oy + j * MAX_SURFACE_CELL, MAX_SURFACE_CELL, top.get(i * 65536 + j) ?? none);
    }
  }
  return index;
}

/** Whether the ground's samples in a cell lie on one plane (the one through three of its corners) */
function planar(ground: SurfaceGround | null, x0: number, y0: number, size: number): boolean {
  if (!ground) return true;
  const h00 = ground.heightAt(x0, y0);
  const h10 = ground.heightAt(x0 + size, y0);
  const h01 = ground.heightAt(x0, y0 + size);
  const dx = (h10 - h00) / size;
  const dy = (h01 - h00) / size;
  const step = ground.cell;
  for (let y = y0; y <= y0 + size + 1e-6; y += step) {
    for (let x = x0; x <= x0 + size + 1e-6; x += step) {
      if (Math.abs(ground.heightAt(x, y) - (h00 + dx * (x - x0) + dy * (y - y0))) > PLANE_TOLERANCE) return false;
    }
  }
  return true;
}

/** The leaves by the cells of the top grid they lie in (from the ground's origin) */
class LeafIndex {
  private readonly cells = new Map<number, Leaf[]>();

  constructor(
    private readonly ox: number,
    private readonly oy: number,
  ) {}

  add(leaf: Leaf): void {
    const key = Math.floor((leaf.x0 - this.ox + 1e-6) / MAX_SURFACE_CELL) * 65536 + Math.floor((leaf.y0 - this.oy + 1e-6) / MAX_SURFACE_CELL);
    let list = this.cells.get(key);
    if (!list) this.cells.set(key, (list = []));
    list.push(leaf);
  }

  /** The leaves overlapping a box, into `out` */
  near(x0: number, y0: number, x1: number, y1: number, out: Leaf[]): void {
    out.length = 0;
    for (let j = Math.floor((y0 - this.oy) / MAX_SURFACE_CELL); this.oy + j * MAX_SURFACE_CELL <= y1; j++) {
      for (let i = Math.floor((x0 - this.ox) / MAX_SURFACE_CELL); this.ox + i * MAX_SURFACE_CELL <= x1; i++) {
        const list = this.cells.get(i * 65536 + j);
        if (!list) continue;
        for (const leaf of list) if (leaf.x0 < x1 && leaf.x0 + leaf.size > x0 && leaf.y0 < y1 && leaf.y0 + leaf.size > y0) out.push(leaf);
      }
    }
  }
}

/** Even-odd: whether a point lies inside a ring */
function insideRing(p: MapPoint, ring: readonly MapPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x)) inside = !inside;
  }
  return inside;
}

/** Whether a segment meets an axis-aligned box (Liang-Barsky) */
function segmentMeetsBox(x0: number, y0: number, x1: number, y1: number, bx0: number, by0: number, bx1: number, by1: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const sides: [number, number][] = [
    [-dx, x0 - bx0],
    [dx, bx1 - x0],
    [-dy, y0 - by0],
    [dy, by1 - y0],
  ];
  for (const [p, q] of sides) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

function segmentDistance(e: Float64Array, k: number, x: number, y: number): number {
  const dx = e[k + 2] - e[k];
  const dy = e[k + 3] - e[k + 1];
  const t = Math.max(0, Math.min(1, ((x - e[k]) * dx + (y - e[k + 1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(e[k] + t * dx - x, e[k + 1] + t * dy - y);
}

/** The ring without a repeated end point or points on top of the one before */
function clean(ring: readonly MapPoint[]): MapPoint[] {
  const out: MapPoint[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || Math.abs(p.x - last.x) > 1e-4 || Math.abs(p.y - last.y) > 1e-4) out.push({ x: p.x, y: p.y });
  }
  while (out.length > 1 && Math.abs(out[0].x - out[out.length - 1].x) <= 1e-4 && Math.abs(out[0].y - out[out.length - 1].y) <= 1e-4) out.pop();
  return out;
}

/**
 * A triangle cut to an axis-aligned box (Sutherland-Hodgman, four sides) in
 * flat arrays: no allocation per cut. A cut point on a side lies exactly on
 * it, so the cells' shared corners agree
 */
class CellClipper {
  /** The polygon after the last cut, x and y in turn */
  points = new Float64Array(32);
  /** The part `half` kept */
  readonly halfPoints = new Float64Array(32);
  private other = new Float64Array(32);
  private count = 0;

  start(a: MapPoint, b: MapPoint, c: MapPoint): void {
    const p = this.points;
    p[0] = a.x;
    p[1] = a.y;
    p[2] = b.x;
    p[3] = b.y;
    p[4] = c.x;
    p[5] = c.y;
    this.count = 3;
  }

  /** Cuts to the box; the points left */
  cut(x0: number, y0: number, x1: number, y1: number): number {
    this.side(0, x0, 1);
    this.side(0, x1, -1);
    this.side(1, y0, 1);
    this.side(1, y1, -1);
    return this.count;
  }

  /** The part of the polygon (its first `count` points) where a x + b y + c >= 0, into `halfPoints`; its points */
  half(a: number, b: number, c: number, count: number): number {
    const p = this.points;
    const o = this.halfPoints;
    let k = 0;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      const dq = a * p[i * 2] + b * p[i * 2 + 1] + c;
      const dr = a * p[j * 2] + b * p[j * 2 + 1] + c;
      if (dq >= 0) {
        o[k++] = p[i * 2];
        o[k++] = p[i * 2 + 1];
      }
      if (dq >= 0 !== dr >= 0 && dq !== 0 && dr !== 0) {
        const t = dq / (dq - dr);
        o[k++] = p[i * 2] + (p[j * 2] - p[i * 2]) * t;
        o[k++] = p[i * 2 + 1] + (p[j * 2 + 1] - p[i * 2 + 1]) * t;
      }
    }
    return k / 2;
  }

  /** Twice the area enclosed, halved */
  area(): number {
    const p = this.points;
    let s = 0;
    for (let i = 0, j = this.count - 1; i < this.count; j = i++) s += (p[j * 2] + p[i * 2]) * (p[j * 2 + 1] - p[i * 2 + 1]);
    return Math.abs(s / 2);
  }

  /** Keeps the side where (coordinate `axis` - at) * sign >= 0 */
  private side(axis: 0 | 1, at: number, sign: number): void {
    const p = this.points;
    const o = this.other;
    const n = this.count;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const qa = p[i * 2 + axis];
      const ra = p[j * 2 + axis];
      const dq = (qa - at) * sign;
      const dr = (ra - at) * sign;
      if (dq >= 0) {
        o[k++] = p[i * 2];
        o[k++] = p[i * 2 + 1];
      }
      if (dq >= 0 !== dr >= 0 && dq !== 0 && dr !== 0) {
        const t = (at - qa) / (ra - qa);
        if (axis === 0) {
          o[k++] = at;
          o[k++] = p[i * 2 + 1] + (p[j * 2 + 1] - p[i * 2 + 1]) * t;
        } else {
          o[k++] = p[i * 2] + (p[j * 2] - p[i * 2]) * t;
          o[k++] = at;
        }
      }
    }
    this.points = o;
    this.other = p;
    this.count = k / 2;
  }
}

/** The rings' edges as x0, y0, x1, y1 */
function ringEdges(rings: readonly MapPoint[][]): Float64Array {
  const n = rings.reduce((sum, r) => sum + r.length, 0);
  const e = new Float64Array(n * 4);
  let k = 0;
  for (const r of rings) {
    for (let i = 0; i < r.length; i++) {
      const p = r[i];
      const q = r[(i + 1) % r.length];
      e[k++] = p.x;
      e[k++] = p.y;
      e[k++] = q.x;
      e[k++] = q.y;
    }
  }
  return e;
}
