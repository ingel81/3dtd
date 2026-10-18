import { ShapeUtils, Vector2 } from 'three';
import type { MapPoint, MapSurface, MapSurfaceMarkingKind } from '../../map-document';
import { courtOf, markingFrame, surfaceArea } from '../../map-surfaces';
import { drapeTileKey } from '../drape/draped-layer';

/**
 * A surface (MapSurface) as triangles for the draped surface layer: the
 * outline and its holes triangulated (earcut), every triangle cut along a
 * grid of SURFACE_CELL metres so the surface follows the ground between
 * its corners (the terrain's height is read per vertex), the pieces sorted
 * into the layer's tiles. Map space throughout, triangles counter-clockwise
 * seen from above.
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

/** Metres of a grid cell the triangles are cut along */
export const SURFACE_CELL = 4;
/** Metres from its cell an edge is listed for (the look reads the edge's distance up to this: kerbs, contact shade) */
export const EDGE_REACH = 1;
/** Most edges listed for one cell (three bits of the reference): the nearest */
export const MAX_CELL_EDGES = 7;

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

/** Most rank: of two surfaces that overlap, the smaller is drawn over the larger (DrapePull) */
export const MAX_SURFACE_RANK = 6;

/** The look of a vertex as one float: layer (4 bits), marking (4 bits), rank (3 bits) */
export function surfaceLook(layer: number, kind: MapSurfaceMarkingKind | undefined, rank: number): number {
  return Math.min(15, layer) + 16 * (kind ? MARKING_CODE[kind] : 0) + 256 * rank;
}

/** A surface's rank by its size: big squares 0, a court 3 or 4, a tiny bed 6 */
export function surfaceRank(area: number): number {
  return Math.max(0, Math.min(MAX_SURFACE_RANK, Math.round(Math.log2(20000 / Math.max(area, 1)) / 1.6)));
}

/** A surface's triangles in one tile */
export interface SurfacePiece {
  /** Map x, y per vertex */
  position: number[];
  /** u, v, half court length, half court width per vertex */
  mark: number[];
  /**
   * Look, edges, the frame's direction (radians) per vertex. Edges: where
   * the cell's list starts in the surface's SurfaceEdges times 8, plus how
   * many (0: none near)
   */
  look: number[];
  index: number[];
}

/** A surface's triangles by tile key, and the edges its cells list (x0, y0, x1, y1 each, map metres) */
export interface SurfaceMesh {
  pieces: Map<string, SurfacePiece>;
  edges: Float32Array;
}

/** The surface's triangles by tile key; `layer` is its material's texture layer */
export function surfacePieces(s: MapSurface, layer: number): SurfaceMesh {
  const outer = clean(s.outer);
  const holes = (s.holes ?? []).map(clean).filter((h) => h.length >= 3);
  const out = new Map<string, SurfacePiece>();
  if (outer.length < 3) return { pieces: out, edges: new Float32Array(0) };
  const points = [outer, ...holes].flat();
  // Vectors (the triangulation compares them), copies (it trims a ring's repeated end point in place)
  const vectors = (ring: readonly MapPoint[]) => ring.map((p) => new Vector2(p.x, p.y));
  const faces = ShapeUtils.triangulateShape(vectors(outer), holes.map(vectors));
  const m = s.marking;
  const court = m ? courtOf(m) : null;
  const look = surfaceLook(layer, m?.kind, surfaceRank(surfaceArea(s)));
  // The frame's direction: the marking's long side, else east (the map point is the frame)
  const angle = m && court ? m.angle : 0;
  const edges = ringEdges([outer, ...holes]);
  const listed: number[] = [];
  const cellRefs = new Map<number, number>();
  // The edges near a cell, listed once per cell
  const refOf = (i: number, j: number): number => {
    const key = i * 65536 + j;
    let ref = cellRefs.get(key);
    if (ref === undefined) {
      const near = cellEdges(edges, i * SURFACE_CELL, j * SURFACE_CELL);
      ref = near.length ? (listed.length / 4) * 8 + near.length : 0;
      for (const k of near) listed.push(edges[k], edges[k + 1], edges[k + 2], edges[k + 3]);
      cellRefs.set(key, ref);
    }
    return ref;
  };
  const vertexOf = new Map<string, Map<string, number>>();
  const polygon: MapPoint[] = [];

  const emit = (poly: readonly MapPoint[], i: number, j: number) => {
    const ref = refOf(i, j);
    if (poly.length < 3) return;
    let cx = 0;
    let cy = 0;
    for (const p of poly) {
      cx += p.x;
      cy += p.y;
    }
    const key = drapeTileKey(cx / poly.length, cy / poly.length);
    let piece = out.get(key);
    let ids = vertexOf.get(key);
    if (!piece || !ids) {
      piece = { position: [], mark: [], look: [], index: [] };
      ids = new Map();
      out.set(key, piece);
      vertexOf.set(key, ids);
    }
    const index: number[] = [];
    for (const p of poly) {
      // Shared with the neighbours' pieces that list the same edges (all with none)
      const id = `${Math.round(p.x * 512)},${Math.round(p.y * 512)},${ref}`;
      let k = ids.get(id);
      if (k === undefined) {
        k = piece.position.length / 2;
        ids.set(id, k);
        piece.position.push(p.x, p.y);
        if (m && court) {
          const f = markingFrame(m, p);
          piece.mark.push(f.u, f.v, court.length / 2, court.width / 2);
        } else piece.mark.push(p.x, p.y, 0, 0);
        piece.look.push(look, ref, angle);
      }
      index.push(k);
    }
    // A fan over the convex piece
    for (let k = 1; k + 1 < index.length; k++) piece.index.push(index[0], index[k], index[k + 1]);
  };

  for (const f of faces) {
    let a = points[f[0]];
    let b = points[f[1]];
    const c = points[f[2]];
    if (!a || !b || !c) continue;
    const turn = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(turn) < 1e-9) continue;
    if (turn < 0) [a, b] = [b, a];
    const i0 = Math.floor(Math.min(a.x, b.x, c.x) / SURFACE_CELL);
    const i1 = Math.floor(Math.max(a.x, b.x, c.x) / SURFACE_CELL);
    const j0 = Math.floor(Math.min(a.y, b.y, c.y) / SURFACE_CELL);
    const j1 = Math.floor(Math.max(a.y, b.y, c.y) / SURFACE_CELL);
    if (i0 === i1 && j0 === j1) {
      emit([a, b, c], i0, j0);
      continue;
    }
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        polygon.length = 0;
        polygon.push(a, b, c);
        const cut = clipToCell(polygon, i * SURFACE_CELL, j * SURFACE_CELL, (i + 1) * SURFACE_CELL, (j + 1) * SURFACE_CELL);
        if (cut.length >= 3 && Math.abs(polygonArea(cut)) > 1e-6) emit(cut, i, j);
      }
    }
  }
  return { pieces: out, edges: Float32Array.from(listed) };
}

/** The edges (offsets into `e`) within EDGE_REACH of the cell at (x0, y0), the nearest MAX_CELL_EDGES */
function cellEdges(e: Float64Array, x0: number, y0: number): number[] {
  const near: { k: number; d: number }[] = [];
  const cx = x0 + SURFACE_CELL / 2;
  const cy = y0 + SURFACE_CELL / 2;
  const half = SURFACE_CELL / 2 + EDGE_REACH;
  for (let k = 0; k < e.length; k += 4) {
    if (!segmentMeetsBox(e[k], e[k + 1], e[k + 2], e[k + 3], cx - half, cy - half, cx + half, cy + half)) continue;
    near.push({ k, d: segmentDistance(e, k, cx, cy) });
  }
  if (near.length > MAX_CELL_EDGES) near.sort((p, q) => p.d - q.d).length = MAX_CELL_EDGES;
  return near.map((n) => n.k);
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

/** A convex polygon cut to an axis-aligned box (Sutherland-Hodgman, four sides) */
function clipToCell(poly: MapPoint[], x0: number, y0: number, x1: number, y1: number): MapPoint[] {
  let p = clipSide(poly, (q) => q.x - x0, (q, r) => lerpAt(q, r, x0, 'x'));
  p = clipSide(p, (q) => x1 - q.x, (q, r) => lerpAt(q, r, x1, 'x'));
  p = clipSide(p, (q) => q.y - y0, (q, r) => lerpAt(q, r, y0, 'y'));
  return clipSide(p, (q) => y1 - q.y, (q, r) => lerpAt(q, r, y1, 'y'));
}

function clipSide(poly: readonly MapPoint[], inside: (q: MapPoint) => number, cross: (q: MapPoint, r: MapPoint) => MapPoint): MapPoint[] {
  const out: MapPoint[] = [];
  for (let k = 0; k < poly.length; k++) {
    const q = poly[k];
    const r = poly[(k + 1) % poly.length];
    const dq = inside(q);
    const dr = inside(r);
    if (dq >= 0) out.push(q);
    if ((dq >= 0) !== (dr >= 0) && dq !== 0 && dr !== 0) out.push(cross(q, r));
  }
  return out;
}

/** The point on segment q-r where its `axis` is `at` (exactly, so the cells' shared corners agree) */
function lerpAt(q: MapPoint, r: MapPoint, at: number, axis: 'x' | 'y'): MapPoint {
  const t = (at - q[axis]) / (r[axis] - q[axis]);
  return axis === 'x' ? { x: at, y: q.y + (r.y - q.y) * t } : { x: q.x + (r.x - q.x) * t, y: at };
}

function polygonArea(poly: readonly MapPoint[]): number {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return s / 2;
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
