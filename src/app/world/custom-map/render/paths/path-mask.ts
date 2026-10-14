import type { MapPathEdge, MapPaths, MapPoint, MapRiver } from '../../map-document';
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
 * Bridges are not painted; they get a deck mesh (path-bridges.ts).
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
  rasterizeRiverBanks(out, rivers, width, depth, resolution);
  const nodes = new Map<string, MapPoint>(paths.nodes.map((n) => [n.id, n]));
  const sx = resolution / width;
  const sy = resolution / depth;
  for (const edge of paths.edges) {
    if (edge.kind === 'bridge') continue;
    const line = edgePolyline(edge, nodes);
    if (!line) continue;
    const channel = edge.kind === 'road' ? 0 : 1;
    const half = edge.width / 2;
    const inner = half * 0.8;
    const outer = half * 1.15;
    for (let s = 0; s < line.length - 1; s++) {
      const p = line[s];
      const q = line[s + 1];
      const minX = Math.max(0, Math.floor((Math.min(p.x, q.x) - outer + width / 2) * sx));
      const maxX = Math.min(resolution - 1, Math.ceil((Math.max(p.x, q.x) + outer + width / 2) * sx));
      const minY = Math.max(0, Math.floor((Math.min(p.y, q.y) - outer + depth / 2) * sy));
      const maxY = Math.min(resolution - 1, Math.ceil((Math.max(p.y, q.y) + outer + depth / 2) * sy));
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
  return out;
}

/**
 * River banks into the mask's alpha: full inside the river and up to 1.5 m
 * past its edge, fading out 5 m past it; lava flows leave no wet bank.
 * The banks are uneven: wider on the inside of a bend (where a river drops
 * its gravel), narrow on the outside (where it cuts), and their width
 * wanders along the river.
 */
function rasterizeRiverBanks(out: Uint8Array, rivers: MapRiver[], width: number, depth: number, resolution: number): void {
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
      const minX = Math.max(0, Math.floor((Math.min(p.x, q.x) - reach + width / 2) * sx));
      const maxX = Math.min(resolution - 1, Math.ceil((Math.max(p.x, q.x) + reach + width / 2) * sx));
      const minY = Math.max(0, Math.floor((Math.min(p.y, q.y) - reach + depth / 2) * sy));
      const maxY = Math.min(resolution - 1, Math.ceil((Math.max(p.y, q.y) + reach + depth / 2) * sy));
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
