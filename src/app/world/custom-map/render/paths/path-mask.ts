import type { MapPathEdge, MapPaths, MapPoint, MapRiver, MapRiverPoint } from '../../map-document';
import type { TexelRect } from '../terrain/texture-ranges';
import { sampleRiver } from '../water/river-surface';

/**
 * Paths are painted into the terrain, not laid on it as strips: an RGBA
 * mask over the map (red = road, green = path, blue = position across the
 * strongest path at that texel, 0 left edge, 0.5 centre line, 1 right edge,
 * alpha = river bank: wet gravel along both sides of every river)
 * tells the terrain shader where to blend in the road materials and where
 * the wheel ruts and the grass strip between them run. The surface stays the terrain's own, so a
 * road follows every bump without z-fighting, and the height blend gives
 * cobbles poking through grass at the edges instead of a hard border.
 *
 * Bridges are not painted; they get a deck mesh (path-bridges.ts). Nor are
 * roads with a painted `surface` (OSM worlds): their ground shows.
 */

/** Texel size the mask aims for, in metres */
export const PATH_MASK_TEXEL = 0.5;
export const PATH_MASK_MAX_RESOLUTION = 2048;

export function pathMaskResolution(width: number, depth: number): number {
  const r = Math.ceil(Math.max(width, depth) / PATH_MASK_TEXEL);
  return Math.min(PATH_MASK_MAX_RESOLUTION, r + (r & 1));
}

/** Polyline of an edge from node a over its via points to node b */
export function edgePolyline(edge: MapPathEdge, nodes: Map<string, MapPoint>): MapPoint[] | null {
  const a = nodes.get(edge.a);
  const b = nodes.get(edge.b);
  if (!a || !b) return null;
  return [a, ...(edge.via ?? []), b];
}

/**
 * Rasterises the paths into an RGBA mask (see above) of `resolution`^2 texels over a map of
 * `width` x `depth` metres (texel (0, 0) at the south-west corner). Full
 * strength up to 80% of the half width, fading out to 115%.
 */
export function rasterizePathMask(
  paths: MapPaths,
  width: number,
  depth: number,
  resolution: number,
  rivers: MapRiver[] = [],
): Uint8Array {
  const out = new Uint8Array(resolution * resolution * 4);
  paintPathMask(out, paths, width, depth, resolution, rivers, { i0: 0, j0: 0, i1: resolution - 1, j1: resolution - 1 });
  return out;
}

/** Whether an edge is painted into the mask (bridges, painted surfaces and tunnels are not) */
function painted(edge: MapPathEdge): boolean {
  return edge.kind !== 'bridge' && !edge.surface && !edge.tunnel;
}

/**
 * Paints the mask's texels in `rect` (cleared by the caller) from every
 * river and path that reaches them, in the same order as the whole mask, so
 * a rectangle comes out exactly as a whole raster has it
 */
function paintPathMask(
  out: Uint8Array,
  paths: MapPaths,
  width: number,
  depth: number,
  resolution: number,
  rivers: MapRiver[],
  rect: TexelRect,
): void {
  rasterizeRiverBanks(out, rivers, width, depth, resolution, rect);
  const nodes = new Map<string, MapPoint>(paths.nodes.map((n) => [n.id, n]));
  const sx = resolution / width;
  const sy = resolution / depth;
  for (const edge of paths.edges) {
    if (!painted(edge)) continue;
    const line = edgePolyline(edge, nodes);
    if (!line) continue;
    const channel = edge.kind === 'road' ? 0 : 1;
    const half = edge.width / 2;
    const inner = half * 0.8;
    const outer = half * 1.15;
    for (let s = 0; s < line.length - 1; s++) {
      const p = line[s];
      const q = line[s + 1];
      const minX = Math.max(rect.i0, Math.floor((Math.min(p.x, q.x) - outer + width / 2) * sx));
      const maxX = Math.min(rect.i1, Math.ceil((Math.max(p.x, q.x) + outer + width / 2) * sx));
      const minY = Math.max(rect.j0, Math.floor((Math.min(p.y, q.y) - outer + depth / 2) * sy));
      const maxY = Math.min(rect.j1, Math.ceil((Math.max(p.y, q.y) + outer + depth / 2) * sy));
      if (minX > maxX || minY > maxY) continue;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len2 = dx * dx + dy * dy || 1;
      for (let ty = minY; ty <= maxY; ty++) {
        const y = (ty + 0.5) / sy - depth / 2;
        for (let tx = minX; tx <= maxX; tx++) {
          const x = (tx + 0.5) / sx - width / 2;
          let t = ((x - p.x) * dx + (y - p.y) * dy) / len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(x - (p.x + t * dx), y - (p.y + t * dy));
          if (d >= outer) continue;
          const f = d <= inner ? 1 : 1 - (d - inner) / (outer - inner);
          const v = Math.round(f * f * (3 - 2 * f) * 255);
          const q = (ty * resolution + tx) * 4;
          if (v <= out[q + channel]) continue;
          // The strongest path at a texel also owns its across position
          if (v >= out[q] && v >= out[q + 1]) {
            const side = (x - p.x) * dy - (y - p.y) * dx >= 0 ? 1 : -1;
            out[q + 2] = Math.round((0.5 + (side * Math.min(d, outer)) / (2 * outer)) * 255);
          }
          out[q + channel] = v;
        }
      }
    }
  }
}

/** Share of the mask past which a change paints it whole: a rectangle would save little */
const WHOLE_SHARE = 0.4;

/** Metres the river banks reach past the surface's edge at most (rasterizeRiverBanks) */
const BANK_REACH = 5 * 2.4;

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The path mask of a map kept up to date as the paths change: it remembers
 * what it painted (each painted edge's kind, width and line, each river's
 * points) and paints again only the texels round what moved, came or went.
 * Dragging a road node on a big map paints a few thousand texels of four
 * million instead of all of them.
 */
export class PathMaskRaster {
  readonly data: Uint8Array;
  /** Each painted edge (`e:` id) and water river (`r:` id) as last painted: kind, width, then the points */
  private shapes = new Map<string, Float64Array>();
  /** The painted edges in their order: of two crossing paths as strong, the first owns the across position */
  private order: string[] = [];
  private painted = false;

  constructor(
    readonly width: number,
    readonly depth: number,
    readonly resolution: number,
  ) {
    this.data = new Uint8Array(resolution * resolution * 4);
  }

  /** Paints the mask for these paths and rivers; the texel rectangle that changed, null when nothing did */
  update(paths: MapPaths, rivers: MapRiver[] = []): TexelRect | null {
    const res = this.resolution;
    const nodes = new Map<string, MapPoint>(paths.nodes.map((n) => [n.id, n]));
    const shapes = new Map<string, Float64Array>();
    const order: string[] = [];
    let box: Box | null = null;
    const grow = (key: string, shape: Float64Array) => (box = growBox(box, key, shape));
    // A shape that is not as it was: its old and its new ground paint again
    const visit = (key: string, kind: number, size: number, points: readonly MapPoint[], stride: 2 | 3) => {
      const old = this.shapes.get(key);
      let same = !!old && old.length === 2 + points.length * stride && old[0] === kind && old[1] === size;
      for (let k = 0; same && k < points.length; k++) {
        const o = 2 + k * stride;
        same = old![o] === points[k].x && old![o + 1] === points[k].y && (stride === 2 || old![o + 2] === (points[k] as MapRiverPoint).width);
      }
      if (same) {
        shapes.set(key, old!);
        return;
      }
      const shape = new Float64Array(2 + points.length * stride);
      shape[0] = kind;
      shape[1] = size;
      points.forEach((p, k) => {
        shape[2 + k * stride] = p.x;
        shape[3 + k * stride] = p.y;
        if (stride === 3) shape[4 + k * stride] = (p as MapRiverPoint).width;
      });
      shapes.set(key, shape);
      if (!this.painted) return;
      grow(key, shape);
      if (old) grow(key, old);
    };
    for (const edge of paths.edges) {
      if (!painted(edge)) continue;
      const line = edgePolyline(edge, nodes);
      if (!line) continue;
      const key = `e:${edge.id}`;
      order.push(key);
      visit(key, edge.kind === 'road' ? 0 : 1, edge.width, line, 2);
    }
    for (const river of rivers) {
      if (river.kind === 'water' && river.points.length >= 2) visit(`r:${river.id}`, 2, 0, river.points, 3);
    }
    if (this.painted) for (const [key, old] of this.shapes) if (!shapes.has(key)) grow(key, old);
    const reordered = this.painted && !sameOrder(this.order, order, this.shapes, shapes);
    this.shapes = shapes;
    this.order = order;
    const whole: TexelRect = { i0: 0, j0: 0, i1: res - 1, j1: res - 1 };
    let rect: TexelRect;
    if (!this.painted || reordered) {
      rect = whole;
    } else {
      // Grown in the closures above
      const b = box as Box | null;
      if (!b) return null;
      const sx = res / this.width;
      const sy = res / this.depth;
      rect = {
        i0: Math.max(0, Math.floor((b.x0 + this.width / 2) * sx) - 1),
        j0: Math.max(0, Math.floor((b.y0 + this.depth / 2) * sy) - 1),
        i1: Math.min(res - 1, Math.ceil((b.x1 + this.width / 2) * sx) + 1),
        j1: Math.min(res - 1, Math.ceil((b.y1 + this.depth / 2) * sy) + 1),
      };
      if (rect.i1 < rect.i0 || rect.j1 < rect.j0) return null;
      if ((rect.i1 - rect.i0 + 1) * (rect.j1 - rect.j0 + 1) > res * res * WHOLE_SHARE) rect = whole;
    }
    this.painted = true;
    for (let j = rect.j0; j <= rect.j1; j++) this.data.fill(0, (j * res + rect.i0) * 4, (j * res + rect.i1 + 1) * 4);
    paintPathMask(this.data, paths, this.width, this.depth, res, rivers, rect);
    return rect;
  }
}

/** The box grown by the ground a shape paints: a path's fade round its line, a river's banks round its curve */
function growBox(box: Box | null, key: string, shape: Float64Array): Box {
  let points: { x: number; y: number }[];
  let pad: number;
  if (key.startsWith('r:')) {
    const river: MapRiverPoint[] = [];
    for (let k = 2; k < shape.length; k += 3) river.push({ x: shape[k], y: shape[k + 1], width: shape[k + 2], height: 0 });
    points = sampleRiver(river, 2);
    pad = Math.max(...river.map((p) => p.width)) / 2 + BANK_REACH;
  } else {
    points = [];
    for (let k = 2; k < shape.length; k += 2) points.push({ x: shape[k], y: shape[k + 1] });
    pad = (shape[1] / 2) * 1.15;
  }
  let b = box ?? { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of points) b = { x0: Math.min(b.x0, p.x - pad), y0: Math.min(b.y0, p.y - pad), x1: Math.max(b.x1, p.x + pad), y1: Math.max(b.y1, p.y + pad) };
  return b;
}

/** Whether the edges kept in both lists stand in the same order */
function sameOrder(before: string[], after: string[], had: Map<string, unknown>, has: Map<string, unknown>): boolean {
  let k = 0;
  for (const key of before) {
    if (!has.has(key)) continue;
    while (k < after.length && !had.has(after[k])) k++;
    if (after[k] !== key) return false;
    k++;
  }
  return true;
}

/**
 * River banks into the mask's alpha: full inside the river and up to 1.5 m
 * past its edge, fading out 5 m past it; lava flows leave no wet bank.
 * The banks are uneven: wider on the inside of a bend (where a river drops
 * its gravel), narrow on the outside (where it cuts), and their width
 * wanders along the river.
 */
function rasterizeRiverBanks(out: Uint8Array, rivers: MapRiver[], width: number, depth: number, resolution: number, rect: TexelRect): void {
  const sx = resolution / width;
  const sy = resolution / depth;
  for (const river of rivers) {
    if (river.kind !== 'water' || river.points.length < 2) continue;
    const line = sampleRiver(river.points, 2);
    const dirAt = (s: number): [number, number] => {
      const a = line[Math.max(0, Math.min(line.length - 2, s))];
      const b = line[Math.max(1, Math.min(line.length - 1, s + 1))];
      const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return [(b.x - a.x) / l, (b.y - a.y) / l];
    };
    for (let s = 0; s < line.length - 1; s++) {
      const p = line[s];
      const q = line[s + 1];
      const half = Math.max(p.width, q.width) / 2;
      // Turn per metre over the neighbouring samples (positive: bends left)
      const [ax, ay] = dirAt(s - 2);
      const [bx, by] = dirAt(s + 2);
      const bend = (ax * by - ay * bx) / 8;
      // Wandering width along the river: two slow waves of the distance
      const wander = 0.75 + 0.25 * Math.sin(s * 0.21 + river.points.length) + 0.2 * Math.sin(s * 0.53 + 1.7);
      const scaleOf = (left: boolean): number => {
        const inside = (bend > 0) === left;
        const k = Math.min(1, Math.abs(bend) * 30);
        return Math.max(0.35, Math.min(2.4, wander * (1 + (inside ? 1.3 : -0.6) * k)));
      };
      const reach = half + 5 * 2.4;
      const minX = Math.max(rect.i0, Math.floor((Math.min(p.x, q.x) - reach + width / 2) * sx));
      const maxX = Math.min(rect.i1, Math.ceil((Math.max(p.x, q.x) + reach + width / 2) * sx));
      const minY = Math.max(rect.j0, Math.floor((Math.min(p.y, q.y) - reach + depth / 2) * sy));
      const maxY = Math.min(rect.j1, Math.ceil((Math.max(p.y, q.y) + reach + depth / 2) * sy));
      if (minX > maxX || minY > maxY) continue;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len2 = dx * dx + dy * dy || 1;
      const scaleLeft = scaleOf(true);
      const scaleRight = scaleOf(false);
      for (let ty = minY; ty <= maxY; ty++) {
        const y = (ty + 0.5) / sy - depth / 2;
        for (let tx = minX; tx <= maxX; tx++) {
          const x = (tx + 0.5) / sx - width / 2;
          let t = ((x - p.x) * dx + (y - p.y) * dy) / len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(x - (p.x + t * dx), y - (p.y + t * dy));
          const scale = dx * (y - p.y) - dy * (x - p.x) > 0 ? scaleLeft : scaleRight;
          const inner = half + 1.5 * scale;
          const outer = half + 5 * scale;
          if (d >= outer) continue;
          const f = d <= inner ? 1 : 1 - (d - inner) / (outer - inner);
          const v = Math.round(f * f * (3 - 2 * f) * 255);
          const k = (ty * resolution + tx) * 4 + 3;
          if (v > out[k]) out[k] = v;
        }
      }
    }
  }
}
