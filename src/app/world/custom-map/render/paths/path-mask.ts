import type { MapPathEdge, MapPaths, MapPoint } from '../../map-document';

/**
 * Paths are painted into the terrain, not laid on it as strips: an RGBA
 * mask over the map (red = road, green = path, blue = position across the
 * strongest path at that texel, 0 left edge, 0.5 centre line, 1 right edge)
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
export function rasterizePathMask(paths: MapPaths, width: number, depth: number, resolution: number): Uint8Array {
  const out = new Uint8Array(resolution * resolution * 4);
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
