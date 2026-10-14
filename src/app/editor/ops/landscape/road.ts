/**
 * The road brush: a drawn line becomes a road in the path network (joined
 * to a node or road it starts or ends near), the ground under it becomes a
 * smooth embankment or cutting, its surface is painted, and lamps and
 * fences can line it.
 */
import type { MapPathEdge, MapPathKind, MapPaths, MapPoint, MapRoadDress } from '../../../world/custom-map/map-document';
import { restoreBand } from './river';
import { addNode, connect, edgePolyline, nearestNode, nearestOnEdges, nearestOnPolyline, pointAt, polylineLength, splitEdge } from '../path-graph';
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

  const surface = options.surface.length ? stroke.layerOf(options.surface) : null;
  const dress: MapRoadDress = {
    adapt: options.adapt,
    ...(surface !== null ? { surface: t.layers[surface].material } : {}),
    lamps: options.lamps,
    fences: options.fences,
    objects: [],
  };
  const { lamps, fences } = dressEdge(stroke, edge, dress);
  stroke.changed({ paths: true });
  return { edgeId: edge.id, length: polylineLength(edgePolyline(paths, edge)), lamps, fences };
}

/** How far either side of a road the brush's embankment, cutting and paint reach */
function dressReach(edge: MapPathEdge): number {
  return edge.width / 2 + Math.max(6, edge.width);
}

/**
 * Builds what `dress` asks for along an edge: the ground levelled into an
 * embankment or cutting, the surface painted, lamps and fences at the
 * sides; stores the dress with the ids of the objects on the edge
 */
export function dressEdge(stroke: LandscapeStroke, edge: MapPathEdge, dress: MapRoadDress): { lamps: number; fences: number } {
  const t = stroke.doc.terrain;
  const paths = stroke.doc.paths;
  if (dress.adapt) {
    const rect = flattenUnderPaths(t, paths, [edge.id], { shoulder: Math.max(6, edge.width), smoothing: 30 }, (r) => stroke.touchHeights(r));
    if (rect) stroke.changed({ heights: rect });
  }
  const surface = dress.surface ? stroke.layerOf([dress.surface]) : null;
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
      if (!stroke.freeForObject(x, y, Math.max(0, Math.min(footprint, offset - edge.width / 2 - 1.1)))) continue;
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
  if (dress.lamps && stroke.catalog.objects.has('lamp-post')) {
    for (let s = LAMP_SPACING / 2, k = 0; s < length - 4; s += LAMP_SPACING, k++) {
      const before = placed.length;
      side(s, edge.width / 2 + 1.6, 'lamp-post', true, k);
      lamps += placed.length - before;
    }
  }
  const fence = ['fence-wood'].find((f) => stroke.catalog.objects.has(f));
  if (dress.fences && fence) {
    for (let s = FENCE_SPACING / 2, k = 0; s < length - FENCE_SPACING / 2; s += FENCE_SPACING, k++) {
      const before = placed.length;
      side(s, edge.width / 2 + 3, fence, false, k);
      fences += placed.length - before;
    }
  }
  edge.dress = { ...dress, objects: placed };
  stroke.changed({ paths: true, objects: placed.length ? placed : undefined });
  return { lamps, fences };
}

/**
 * Takes what the road brush built along an edge away: its lamps and fences
 * (those still there), and the embankment, cutting and paint of its band,
 * the ground across it straight from the land at one side to the other
 * (restoreBand), along `line`, where the edge ran
 */
export function undressEdge(stroke: LandscapeStroke, edge: MapPathEdge, line: readonly MapPoint[]): void {
  const dress = edge.dress;
  if (!dress) return;
  // Its own objects by where they stand: two halves of a split road share the list
  const ids = new Set(dress.objects);
  const reach = dressReach(edge) + 2;
  const gone = stroke.doc.objects
    .filter((o) => ids.has(o.id))
    .filter((o) => (nearestOnPolyline(line, o)?.dist ?? Infinity) <= reach)
    .map((o) => o.id);
  stroke.removeObjects(gone);
  if ((dress.adapt || dress.surface) && line.length >= 2) {
    const band = restoreBand(stroke, line, () => dressReach(edge));
    stroke.changed({ heights: band.heights, splat: band.splat });
  }
  if (gone.length) stroke.changed({ objects: gone });
}

/**
 * Roads moved or reshaped (`paths` holds the new network, `before` the
 * old): every dressed edge whose line or width changed is undressed along
 * its old line and dressed anew along the new one. The stroke must have
 * marked the paths of before. Returns how many were laid anew.
 */
export function relayRoads(stroke: LandscapeStroke, before: MapPaths): number {
  const paths = stroke.doc.paths;
  const changed = paths.edges.filter((e) => {
    if (!e.dress) return false;
    const old = before.edges.find((o) => o.id === e.id);
    if (!old) return false;
    const a = edgePolyline(before, old);
    const b = edgePolyline(paths, e);
    return old.width !== e.width || a.length !== b.length || a.some((p, k) => Math.abs(p.x - b[k].x) > 0.01 || Math.abs(p.y - b[k].y) > 0.01);
  });
  if (!changed.length) return 0;
  // All objects out first, then everything in: a stroke removes before it adds
  for (const e of changed) undressEdge(stroke, { ...before.edges.find((o) => o.id === e.id)!, dress: e.dress }, edgePolyline(before, before.edges.find((o) => o.id === e.id)!));
  stroke.refreshRoads();
  for (const e of changed) dressEdge(stroke, e, e.dress!);
  return changed.length;
}

