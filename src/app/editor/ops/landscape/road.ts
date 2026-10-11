/**
 * The road brush: a drawn line becomes a road in the path network (joined
 * to a node or road it starts or ends near), the ground under it becomes a
 * smooth embankment or cutting, its surface is painted, and lamps and
 * fences can line it.
 */
import type { MapPathKind, MapPoint } from '../../../world/custom-map/map-document';
import { addNode, connect, edgePolyline, nearestNode, nearestOnEdges, pointAt, polylineLength, splitEdge } from '../path-graph';
import { flattenUnderPaths, paintUnderPaths } from '../path-terrain';
import { chaikin, simplify } from './lines';
import type { LandscapeStroke } from './landscape-stroke';

export interface RoadOptions {
  width: number;
  kind: MapPathKind;
  /** Level the ground into an embankment or cutting */
  adapt: boolean;
  /** Paint the surface with the first available of these materials; empty paints nothing */
  surface: readonly string[];
  lamps: boolean;
  fences: boolean;
  /** Metres to snap the ends onto nodes and roads */
  snap: number;
}

export const DEFAULT_ROAD: RoadOptions = {
  width: 8,
  kind: 'road',
  adapt: true,
  surface: ['cobblestone', 'paving', 'dirt-path'],
  lamps: true,
  fences: false,
  snap: 12,
};

const LAMP_SPACING = 28;
const FENCE_SPACING = 6;

export interface RoadResult {
  edgeId: string;
  length: number;
  lamps: number;
  fences: number;
}

export function buildRoad(stroke: LandscapeStroke, drawn: readonly MapPoint[], options: RoadOptions): RoadResult | null {
  const doc = stroke.doc;
  const t = doc.terrain;
  if (drawn.length < 2 || polylineLength(drawn) < Math.max(6, options.width)) return null;
  stroke.markPaths();
  const paths = doc.paths;
  const smooth = simplify(chaikin(drawn, 2), 1.5);

  const endNode = (p: MapPoint): string => {
    const node = nearestNode(paths, p, options.snap);
    if (node) return node.id;
    const onEdge = nearestOnEdges(paths, p, options.snap * 0.7);
    if (onEdge) return splitEdge(paths, onEdge.edge.id, p)!.id;
    return addNode(paths, p).id;
  };
  const a = endNode(smooth[0]);
  const b = endNode(smooth[smooth.length - 1]);
  if (a === b) return null;
  const edge = connect(paths, a, b, options.width, options.kind);
  if (!edge) return null;
  const via = smooth.slice(1, -1);
  if (via.length) edge.via = via;
  else delete edge.via;
  stroke.refreshRoads();

  if (options.adapt) {
    const rect = flattenUnderPaths(t, paths, [edge.id], { shoulder: Math.max(6, options.width), smoothing: 30 }, (r) => stroke.touchHeights(r));
    if (rect) stroke.changed({ heights: rect });
  }
  const surface = options.surface.length ? stroke.layerOf(options.surface) : null;
  if (surface !== null) {
    const rect = paintUnderPaths(t, paths, surface, [edge.id], 1.5, (r) => stroke.touchSplat(r));
    if (rect) stroke.changed({ splat: rect });
  }

  // Lamps and fences at the side, turned along the road
  const line = edgePolyline(paths, edge);
  const length = polylineLength(line);
  const placed: string[] = [];
  const side = (along: number, offset: number, asset: string, alternate: boolean, k: number) => {
    const p = pointAt(line, along);
    const q = pointAt(line, Math.min(length, along + 1));
    const r = pointAt(line, Math.max(0, along - 1));
    const dx = q.x - r.x;
    const dy = q.y - r.y;
    const dl = Math.hypot(dx, dy) || 1;
    const sides = alternate ? [k % 2 ? 1 : -1] : [-1, 1];
    for (const s of sides) {
      const x = p.x - (dy / dl) * offset * s;
      const y = p.y + (dx / dl) * offset * s;
      const footprint = stroke.catalog.object(asset).radius;
      if (!stroke.freeForObject(x, y, Math.max(0, Math.min(footprint, offset - options.width / 2 - 1.1)))) continue;
      if (stroke.grid.near({ x, y }, 1.2)) continue;
      const o = stroke.addObject({
        asset,
        x: Math.round(x * 100) / 100,
        y: Math.round(y * 100) / 100,
        z: 0,
        rotation: Math.round(Math.atan2(dy, dx) * 1000) / 1000,
        scale: 1,
      });
      placed.push(o.id);
    }
  };
  let lamps = 0;
  let fences = 0;
  if (options.lamps && stroke.catalog.objects.has('lamp-post')) {
    for (let s = LAMP_SPACING / 2, k = 0; s < length - 4; s += LAMP_SPACING, k++) {
      const before = placed.length;
      side(s, options.width / 2 + 1.6, 'lamp-post', true, k);
      lamps += placed.length - before;
    }
  }
  const fence = ['fence-wood'].find((f) => stroke.catalog.objects.has(f));
  if (options.fences && fence) {
    for (let s = FENCE_SPACING / 2, k = 0; s < length - FENCE_SPACING / 2; s += FENCE_SPACING, k++) {
      const before = placed.length;
      side(s, options.width / 2 + 3, fence, false, k);
      fences += placed.length - before;
    }
  }
  stroke.changed({ paths: true, objects: placed.length ? placed : undefined });
  return { edgeId: edge.id, length, lamps, fences };
}
