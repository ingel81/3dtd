/**
 * The river brush: a drawn line becomes a river bed with water, banks of
 * sand or mud, reeds along the shore, and a bridge wherever it crosses a
 * road.
 *
 * Maps have one water level, so a river is level too: its surface lies at
 * the map's water level (or, on a map without water, just under the lowest
 * ground along the line), the bed is cut below it, and where the river
 * passes higher ground it cuts a channel with sloping banks; where the land
 * lies lower it raises a low bank so the water stays in its bed.
 */
import type { MapPoint } from '../../../world/custom-map/map-document';
import { sampleX, sampleY, texelX, texelY, type GridRect } from '../../model/grid';
import { MAX_LAYERS, readWeights, writeWeights } from '../paint-ops';
import { edgePolyline, nearestOnPolyline, pointAt, polylineLength, splitEdge } from '../path-graph';
import { chaikin, resample, segmentCross } from './lines';
import { smooth } from './landscape-noise';
import type { LandscapeStroke } from './landscape-stroke';

export interface RiverOptions {
  /** Water width in metres */
  width: number;
  /** Depth of the bed below the surface */
  depth: number;
  /** Width of each bank in metres */
  bank: number;
  /** Grow reeds on the banks */
  reeds: boolean;
  /** Turn crossed roads into bridges */
  bridges: boolean;
}

export const DEFAULT_RIVER: RiverOptions = { width: 14, depth: 2.5, bank: 10, reeds: true, bridges: true };

export interface RiverResult {
  line: MapPoint[];
  level: number;
  bridges: number;
  heights: GridRect | null;
  splat: GridRect | null;
}

export function carveRiver(stroke: LandscapeStroke, drawn: readonly MapPoint[], options: RiverOptions): RiverResult | null {
  const doc = stroke.doc;
  const t = doc.terrain;
  const g = t.grid;
  if (drawn.length < 2 || polylineLength(drawn) < g.cellSize * 3) return null;
  const line = resample(chaikin(drawn, 3), g.cellSize);
  const half = options.width / 2;
  const reach = half + options.bank;

  // The water surface
  let lowest = Infinity;
  for (const p of line) {
    const i = Math.min(g.columns - 1, Math.max(0, Math.round((p.x + t.width / 2) / g.cellSize)));
    const j = Math.min(g.rows - 1, Math.max(0, Math.round((p.y + t.depth / 2) / g.cellSize)));
    lowest = Math.min(lowest, stroke.baseHeight(i, j));
  }
  const level = stroke.ensureWater(lowest - 0.4);

  const xs = line.map((p) => p.x);
  const ys = line.map((p) => p.y);
  const rect: GridRect = {
    i0: Math.max(0, Math.floor((Math.min(...xs) - reach + t.width / 2) / g.cellSize)),
    i1: Math.min(g.columns - 1, Math.ceil((Math.max(...xs) + reach + t.width / 2) / g.cellSize)),
    j0: Math.max(0, Math.floor((Math.min(...ys) - reach + t.depth / 2) / g.cellSize)),
    j1: Math.min(g.rows - 1, Math.ceil((Math.max(...ys) + reach + t.depth / 2) / g.cellSize)),
  };
  stroke.touchHeights(rect);
  stroke.touchWater(rect);
  const water = t.water!;
  const n = stroke.noise;
  for (let j = rect.j0; j <= rect.j1; j++) {
    const y = sampleY(t, j);
    for (let i = rect.i0; i <= rect.i1; i++) {
      const x = sampleX(t, i);
      const hit = nearestOnPolyline(line, { x, y });
      if (!hit) continue;
      // The banks wander a little
      const d = hit.dist + n.fbm(x, y, 25, 2, 'n5') * half * 0.25;
      if (d >= reach) continue;
      const k = j * g.columns + i;
      const base = stroke.baseHeight(i, j);
      if (d < half) {
        const s = d / half;
        g.heights[k] = Math.min(base, level - options.depth * (1 - s * s) - 0.3);
        water.mask[k] = 255;
      } else {
        // Bank: from just above the water up (or down) to the land
        const s = smooth(0, 1, (d - half) / options.bank);
        const shore = level + 0.4;
        g.heights[k] = shore + (base - shore) * s;
        if (d < half + g.cellSize) water.mask[k] = 255;
      }
    }
  }

  // Banks: sand on the inner half, mud mixed in
  const sand = stroke.layerOf(['sand', 'gravel']);
  const mud = stroke.layerOf(['mud', 'dirt']);
  let splat: GridRect | null = null;
  if (sand !== null) {
    const res = t.splat.resolution;
    splat = {
      i0: Math.max(0, Math.floor(((Math.min(...xs) - reach + t.width / 2) / t.width) * res)),
      i1: Math.min(res - 1, Math.ceil(((Math.max(...xs) + reach + t.width / 2) / t.width) * res)),
      j0: Math.max(0, Math.floor(((Math.min(...ys) - reach + t.depth / 2) / t.depth) * res)),
      j1: Math.min(res - 1, Math.ceil(((Math.max(...ys) + reach + t.depth / 2) / t.depth) * res)),
    };
    stroke.touchSplat(splat);
    const w8 = new Float32Array(MAX_LAYERS);
    for (let v = splat.j0; v <= splat.j1; v++) {
      const y = texelY(t, v);
      for (let u = splat.i0; u <= splat.i1; u++) {
        const x = texelX(t, u);
        const hit = nearestOnPolyline(line, { x, y });
        if (!hit || hit.dist > half + options.bank * 0.8) continue;
        const a = 1 - smooth(half + options.bank * 0.3, half + options.bank * 0.8, hit.dist);
        const pick = mud !== null && n.fbm(x, y, 12, 2, 'n6') > 0.15 ? mud : sand;
        const texel = v * res + u;
        readWeights(t, texel, w8);
        for (let k = 0; k < MAX_LAYERS; k++) w8[k] = k === pick ? w8[k] + (255 - w8[k]) * a : w8[k] * (1 - a);
        writeWeights(t, texel, w8);
      }
    }
  }

  // Reeds along both banks
  const placed: string[] = [];
  const reed = ['reeds', 'grass-clump'].find((a) => stroke.catalog.objects.has(a));
  if (options.reeds && reed) {
    const length = polylineLength(line);
    for (let s = 0, k = 0; s < length; s += 2.5, k++) {
      for (const side of [-1, 1]) {
        if (n.hash(k, side, 41) > 0.55) continue;
        const p = pointAt(line, s);
        const q = pointAt(line, Math.min(length, s + 1));
        const dl = Math.hypot(q.x - p.x, q.y - p.y) || 1;
        const off = half + 0.5 + n.hash(k, side, 42) * 2.5;
        const x = p.x - ((q.y - p.y) / dl) * off * side;
        const y = p.y + ((q.x - p.x) / dl) * off * side;
        if (!stroke.freeForObject(x, y, 0.3) || stroke.grid.near({ x, y }, 1)) continue;
        const o = stroke.addObject({
          asset: reed,
          x: Math.round(x * 100) / 100,
          y: Math.round(y * 100) / 100,
          z: 0,
          rotation: Math.round(n.hash(k, side, 43) * 6283) / 1000,
          scale: Math.round((0.8 + n.hash(k, side, 44) * 0.6) * 1000) / 1000,
        });
        placed.push(o.id);
      }
    }
  }

  const bridges = options.bridges ? bridgeCrossings(stroke, line, reach) : 0;
  stroke.changed({ heights: rect, splat: splat ?? undefined, water: true, objects: placed.length ? placed : undefined, paths: bridges > 0 || undefined });
  return { line, level, bridges, heights: rect, splat };
}

/** Splits every road the river crosses and makes the crossing stretch a bridge; returns how many */
export function bridgeCrossings(stroke: LandscapeStroke, river: readonly MapPoint[], span: number): number {
  const paths = stroke.doc.paths;
  let made = 0;
  for (let guard = 0; guard < 64; guard++) {
    const crossing = findCrossing(paths, river);
    if (!crossing) break;
    stroke.markPaths();
    const { edge, along, length } = crossing;
    const line = edgePolyline(paths, edge);
    const far = Math.min(length - 0.5, along + span);
    const near = Math.max(0.5, along - span);
    const farNode = far < length - 1 ? splitEdge(paths, edge.id, pointAt(line, far)) : null;
    const nearNode = near > 1 ? splitEdge(paths, edge.id, pointAt(line, near)) : null;
    // The stretch over the water: between the two new nodes, or the whole edge when it is short
    const fromId = nearNode?.id ?? edge.a;
    const toId = farNode?.id ?? (nearNode ? null : edge.b);
    const bridge = paths.edges.find((e) => e.a === fromId && (toId === null || e.b === toId)) ?? edge;
    bridge.kind = 'bridge';
    made++;
  }
  if (made) stroke.refreshRoads();
  return made;
}

function findCrossing(
  paths: Parameters<typeof edgePolyline>[0],
  river: readonly MapPoint[],
): { edge: (typeof paths.edges)[number]; along: number; length: number } | null {
  for (const edge of paths.edges) {
    if (edge.kind === 'bridge') continue;
    const line = edgePolyline(paths, edge);
    let walked = 0;
    for (let k = 1; k < line.length; k++) {
      const seg = Math.hypot(line[k].x - line[k - 1].x, line[k].y - line[k - 1].y);
      for (let r = 1; r < river.length; r++) {
        const s = segmentCross(line[k - 1], line[k], river[r - 1], river[r]);
        if (s !== null) return { edge, along: walked + seg * s, length: polylineLength(line) };
      }
      walked += seg;
    }
  }
  return null;
}
