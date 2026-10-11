/**
 * The river brush: a drawn line becomes a natural river: the hand's line
 * smoothed into a Catmull-Rom curve that meanders a little, a width that
 * swells and narrows along it, a bed deep in the middle with shallow
 * shelves at the sides, banks that slope into the land through sand and
 * gravel to grass, reeds in clumps at the water's edge and stones on the
 * banks, and a bridge wherever it crosses a road.
 *
 * Maps have one main water level, so the river surface lies at it (or, on
 * a map without water, just under the lowest ground along the line); the
 * bed is cut below it through higher ground, and low land gets a bank.
 */
import type { MapPoint } from '../../../world/custom-map/map-document';
import { sampleX, sampleY, texelX, texelY, type GridRect } from '../../model/grid';
import { MAX_LAYERS, readWeights, writeWeights } from '../paint-ops';
import { edgePolyline, nearestOnPolyline, pointAt, polylineLength, splitEdge } from '../path-graph';
import { resample, segmentCross } from './lines';
import { smooth } from './landscape-noise';
import type { LandscapeStroke } from './landscape-stroke';

export interface RiverOptions {
  /** Mean water width in metres */
  width: number;
  /** Depth of the bed below the surface in its middle */
  depth: number;
  /** Mean width of each bank in metres */
  bank: number;
  /** Reeds at the water's edge and stones on the banks */
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

/** Catmull-Rom through the drawn points (thinned to one every `spacing` metres), sampled every `step` */
export function catmullRomLine(drawn: readonly MapPoint[], spacing: number, step: number): MapPoint[] {
  const ctrl = resample(drawn, spacing);
  if (ctrl.length < 3) return resample(ctrl, step);
  const pts = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]];
  const out: MapPoint[] = [];
  for (let k = 1; k < pts.length - 2; k++) {
    const [p0, p1, p2, p3] = [pts[k - 1], pts[k], pts[k + 1], pts[k + 2]];
    const n = Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / step));
    for (let s = 0; s < n; s++) {
      const t = s / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push({ ...pts[pts.length - 2] });
  return out;
}

/** The river's course: the smoothed line with a gentle meander, and its half width along it */
export function riverCourse(
  stroke: LandscapeStroke,
  drawn: readonly MapPoint[],
  options: RiverOptions,
  step: number,
): { line: MapPoint[]; half: (along: number) => number } {
  const base = catmullRomLine(drawn, Math.max(12, options.width), step);
  const length = polylineLength(base);
  const n = stroke.noise;
  const fade = (s: number) => smooth(0, 30, s) * smooth(0, 30, length - s);
  // Meander: sideways out of the drawn line by up to about the river's width
  const line = base.map((p, k) => {
    const s = (length * k) / Math.max(1, base.length - 1);
    const q = pointAt(base, Math.min(length, s + 1));
    const r = pointAt(base, Math.max(0, s - 1));
    const dl = Math.hypot(q.x - r.x, q.y - r.y) || 1;
    const off = n.fbm(s, 0, 70, 3, 'n4') * options.width * 0.7 * fade(s);
    return { x: p.x - ((q.y - r.y) / dl) * off, y: p.y + ((q.x - r.x) / dl) * off };
  });
  const half = (along: number) => (options.width / 2) * (0.75 + 0.5 * (0.5 + 0.5 * n.fbm(along, 0, 90, 2, 'n6')));
  return { line, half };
}

export function carveRiver(stroke: LandscapeStroke, drawn: readonly MapPoint[], options: RiverOptions): RiverResult | null {
  const doc = stroke.doc;
  const t = doc.terrain;
  const g = t.grid;
  if (drawn.length < 2 || polylineLength(drawn) < g.cellSize * 3) return null;
  const { line, half } = riverCourse(stroke, drawn, options, g.cellSize);
  const maxHalf = options.width * 0.65;
  const reach = maxHalf + options.bank * 1.4;
  const n = stroke.noise;

  // The water surface
  let lowest = Infinity;
  for (const p of line) {
    const i = Math.min(g.columns - 1, Math.max(0, Math.round((p.x + t.width / 2) / g.cellSize)));
    const j = Math.min(g.rows - 1, Math.max(0, Math.round((p.y + t.depth / 2) / g.cellSize)));
    lowest = Math.min(lowest, stroke.baseHeight(i, j));
  }
  const level = stroke.ensureWater(lowest - 0.4);
  const shore = level + 0.35;

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
  /** Bank width at a point: wider and narrower along the river */
  const bankAt = (x: number, y: number) => options.bank * (0.7 + 0.6 * (0.5 + 0.5 * n.fbm(x, y, 40, 2, 'n3')));
  for (let j = rect.j0; j <= rect.j1; j++) {
    const y = sampleY(t, j);
    for (let i = rect.i0; i <= rect.i1; i++) {
      const x = sampleX(t, i);
      const hit = nearestOnPolyline(line, { x, y });
      if (!hit) continue;
      const h = half(hit.along);
      const d = hit.dist;
      const bank = bankAt(x, y);
      if (d >= h + bank) continue;
      const k = j * g.columns + i;
      const base = stroke.baseHeight(i, j);
      if (d < h) {
        // Deep in the middle, a shallow shelf toward the sides
        const deep = Math.pow(1 - smooth(0.2, 1, d / h), 1.3);
        g.heights[k] = Math.min(base, level - 0.25 - options.depth * deep);
      } else {
        // The bank: from just above the water into the land, a soft S curve
        const s = smooth(0, 1, (d - h) / bank);
        g.heights[k] = shore + (base - shore) * s;
      }
      if (d < h + g.cellSize * 1.5) water.mask[k] = 255;
    }
  }

  // Ground: gravel and mud under water, sand and gravel on the inner bank, fading into the land
  const sand = stroke.layerOf(['sand', 'gravel']);
  const gravel = stroke.layerOf(['gravel', 'rocky-ground', 'sand']);
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
    const target = new Float32Array(MAX_LAYERS);
    for (let v = splat.j0; v <= splat.j1; v++) {
      const y = texelY(t, v);
      for (let u = splat.i0; u <= splat.i1; u++) {
        const x = texelX(t, u);
        const hit = nearestOnPolyline(line, { x, y });
        if (!hit) continue;
        const h = half(hit.along);
        const bank = bankAt(x, y);
        const s = (hit.dist - h) / bank;
        if (s > 0.85) continue;
        // How much of the river ground: full under water, fading out over the outer half of the bank
        const a = 1 - smooth(0.25, 0.85, s);
        if (a <= 0) continue;
        target.fill(0);
        const mix = 0.5 + 0.5 * n.fbm(x, y, 14, 3, 'n6');
        if (s < 0) {
          if (mud !== null) target[mud] += 0.5 + 0.4 * mix;
          target[gravel ?? sand] += 0.5 - 0.4 * mix + 0.0001;
        } else {
          target[sand] += 0.4 + 0.5 * mix;
          target[gravel ?? sand] += 0.6 - 0.5 * mix;
        }
        let sum = 0;
        for (let k = 0; k < MAX_LAYERS; k++) sum += target[k];
        const texel = v * res + u;
        readWeights(t, texel, w8);
        for (let k = 0; k < MAX_LAYERS; k++) w8[k] = w8[k] * (1 - a) + (target[k] / sum) * 255 * a;
        writeWeights(t, texel, w8);
      }
    }
  }

  // Reeds in clumps at the water's edge, stones on the banks
  const placed: string[] = [];
  const reed = ['reeds', 'cattails', 'grass-clump'].find((a) => stroke.catalog.objects.has(a));
  const stone = ['rock-small', 'stone'].find((a) => stroke.catalog.objects.has(a));
  if (options.reeds) {
    const length = polylineLength(line);
    for (let s = 0, k = 0; s < length; s += 1.6, k++) {
      const p = pointAt(line, s);
      const q = pointAt(line, Math.min(length, s + 1));
      const dl = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      const h = half(s);
      for (const side of [-1, 1]) {
        const put = (asset: string, off: number, scale: number) => {
          const x = p.x - ((q.y - p.y) / dl) * off * side;
          const y = p.y + ((q.x - p.x) / dl) * off * side;
          if (!stroke.freeForObject(x, y, 0.3) || stroke.grid.near({ x, y }, 0.9)) return;
          const o = stroke.addObject({
            asset,
            x: Math.round(x * 100) / 100,
            y: Math.round(y * 100) / 100,
            z: 0,
            rotation: Math.round(n.hash(k, side, 43) * 6283) / 1000,
            scale: Math.round(scale * 1000) / 1000,
          });
          placed.push(o.id);
        };
        // Reeds where the clump noise is high, right at the edge
        const clump = 0.5 + 0.5 * n.fbm(p.x + side * 31, p.y, 18, 2, 'n2');
        if (reed && n.hash(k, side, 41) < smooth(0.45, 0.8, clump) * 0.9) put(reed, h + 0.3 + n.hash(k, side, 42) * 2.2, 0.8 + n.hash(k, side, 44) * 0.6);
        if (stone && n.hash(k, side, 45) < 0.07) put(stone, h + 1 + n.hash(k, side, 46) * options.bank * 0.5, 0.4 + n.hash(k, side, 47) * 0.8);
      }
    }
  }

  const bridges = options.bridges ? bridgeCrossings(stroke, line, maxHalf + options.bank) : 0;
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
