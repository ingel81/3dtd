/**
 * The river brush: a drawn line becomes a natural river or a lava flow: the
 * hand's line smoothed into a Catmull-Rom curve that meanders a little, a
 * width that swells and narrows, a surface that only ever falls (the river
 * runs downhill whichever way it was drawn), a bed deep in the middle with
 * shallow shelves, banks that slope into the land through sand and gravel
 * (scorched rock around lava), reeds in clumps and stones on the banks, a
 * waterfall where the surface drops steeply, and a bridge wherever it
 * crosses a road. The river itself is a `MapRiver` of the map: points with
 * width and surface height that the renderer draws as a flowing ribbon.
 */
import type { MapPoint, MapRiver } from '../../../world/custom-map/map-document';
import { heightAt, sampleX, sampleY, texelX, texelY, type GridRect } from '../../model/grid';
import { MAX_LAYERS, readWeights, writeWeights } from '../paint-ops';
import { edgePolyline, nearestOnPolyline, newId, pointAt, polylineLength, splitEdge } from '../path-graph';
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
  /** Water, or a lava flow with scorched banks */
  kind: 'water' | 'lava';
}

export const DEFAULT_RIVER: RiverOptions = { width: 14, depth: 2.5, bank: 10, reeds: true, bridges: true, kind: 'water' };

/** Metres the surface falls at least per metre of course */
const MIN_FALL = 0.004;
/** Metres the surface stays under the ground along the centre line */
const UNDER = 0.5;
/** A surface falling steeper than this (metres per metre) gets a waterfall */
const FALL_SLOPE = 0.25;
/** Metres a waterfall drops at least */
const FALL_MIN = 1.5;
/** Metres between the points of a river */
const POINT_STEP = 8;

export interface RiverResult {
  line: MapPoint[];
  river: MapRiver;
  bridges: number;
  waterfalls: number;
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
  // Narrow at both ends: a spring and a mouth instead of a cut-off channel
  const taper = (along: number) => 0.35 + 0.65 * smooth(0, 25, along) * smooth(0, 25, length - along);
  const half = (along: number) => (options.width / 2) * taper(along) * (0.75 + 0.5 * (0.5 + 0.5 * n.fbm(along, 0, 90, 2, 'n6')));
  return { line, half };
}

/**
 * The surface along a course: just under the ground at the top, never
 * rising, falling at least a little. A line drawn uphill is turned round so
 * the river flows from its first point.
 */
export function riverSurface(stroke: LandscapeStroke, line: readonly MapPoint[]): { line: MapPoint[]; surface: number[]; reversed: boolean } {
  const t = stroke.doc.terrain;
  const last = line[line.length - 1];
  const reversed = heightAt(t, line[0].x, line[0].y) < heightAt(t, last.x, last.y);
  const course = reversed ? [...line].reverse() : [...line];
  const surface: number[] = [];
  for (let k = 0; k < course.length; k++) {
    const under = heightAt(t, course[k].x, course[k].y) - UNDER;
    if (k === 0) surface.push(under);
    else {
      const run = Math.hypot(course[k].x - course[k - 1].x, course[k].y - course[k - 1].y);
      surface.push(Math.min(surface[k - 1] - MIN_FALL * run, under));
    }
  }
  return { line: course, surface, reversed };
}

export function carveRiver(stroke: LandscapeStroke, drawn: readonly MapPoint[], options: RiverOptions): RiverResult | null {
  const doc = stroke.doc;
  const t = doc.terrain;
  const g = t.grid;
  if (drawn.length < 2 || polylineLength(drawn) < g.cellSize * 3) return null;
  const lava = options.kind === 'lava';
  const course = riverCourse(stroke, drawn, options, g.cellSize);
  const { line, surface, reversed } = riverSurface(stroke, course.line);
  const length = polylineLength(line);
  const half = (s: number) => course.half(reversed ? length - s : s);
  const along: number[] = [0];
  for (let k = 1; k < line.length; k++) along.push(along[k - 1] + Math.hypot(line[k].x - line[k - 1].x, line[k].y - line[k - 1].y));
  /** Surface height at a distance along the course */
  const surfaceAt = (s: number) => {
    let lo = 0;
    let hi = along.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (along[mid] <= s) lo = mid;
      else hi = mid;
    }
    const f = Math.min(1, Math.max(0, (s - along[lo]) / Math.max(1e-6, along[hi] - along[lo])));
    return surface[lo] + (surface[hi] - surface[lo]) * f;
  };
  const maxHalf = options.width * 0.65;
  const reach = maxHalf + options.bank * 1.4;
  const n = stroke.noise;

  const xs = line.map((p) => p.x);
  const ys = line.map((p) => p.y);
  const rect: GridRect = {
    i0: Math.max(0, Math.floor((Math.min(...xs) - reach + t.width / 2) / g.cellSize)),
    i1: Math.min(g.columns - 1, Math.ceil((Math.max(...xs) + reach + t.width / 2) / g.cellSize)),
    j0: Math.max(0, Math.floor((Math.min(...ys) - reach + t.depth / 2) / g.cellSize)),
    j1: Math.min(g.rows - 1, Math.ceil((Math.max(...ys) + reach + t.depth / 2) / g.cellSize)),
  };
  stroke.touchHeights(rect);
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
      const level = surfaceAt(hit.along);
      if (d < h) {
        // Deep in the middle, a shallow shelf toward the sides
        const deep = Math.pow(1 - smooth(0.2, 1, d / h), 1.3);
        g.heights[k] = Math.min(base, level - 0.25 - options.depth * deep);
      } else {
        // The bank: from just above the surface into the land, a soft S curve (a levee where the land lies lower)
        const shore = level + 0.35;
        const s = smooth(0, 1, (d - h) / bank);
        g.heights[k] = shore + (base - shore) * s;
      }
    }
  }

  // Ground: mud and gravel in the bed, sand and gravel on the inner bank (scorched rock by lava), fading into the land
  const sand = stroke.layerOf(lava ? ['scorched-ground', 'volcanic-rock', 'basalt'] : ['sand', 'gravel']);
  const gravel = stroke.layerOf(lava ? ['volcanic-rock', 'basalt', 'scorched-ground'] : ['gravel', 'rocky-ground', 'sand']);
  const mud = stroke.layerOf(lava ? ['lava-crust', 'basalt'] : ['mud', 'dirt']);
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
        const s = (hit.dist - half(hit.along)) / bankAt(x, y);
        if (s > 0.85) continue;
        // How much of the river ground: full in the bed, fading out over the outer half of the bank
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

  // The river itself: points with width and surface height, flowing from the first
  stroke.markRivers();
  const round = (v: number) => Math.round(v * 100) / 100;
  const points = resample(line, POINT_STEP).map((p) => {
    const s = nearestOnPolyline(line, p)?.along ?? 0;
    return { x: round(p.x), y: round(p.y), width: round(half(s) * 2), height: round(surfaceAt(s)) };
  });
  const rivers = (t.rivers ??= []);
  const river: MapRiver = { id: newId('river', rivers), kind: lava ? 'lava' : 'water', points };
  rivers.push(river);

  // Reeds in clumps at the edge and stones on the banks; by lava only scattered volcanic rock
  const placed: string[] = [];
  const has = (ids: string[]) => ids.find((a) => stroke.catalog.objects.has(a));
  const reed = lava ? undefined : has(['reed-bed', 'reeds', 'grass-swamp', 'grass-clump']);
  const stone = lava ? has(['rock-volcanic', 'rock-basalt', 'rock-pumice']) : has(['stones', 'rock-round', 'rock-small']);
  if (options.reeds) {
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
            x: round(x),
            y: round(y),
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

  // A waterfall over each steep stretch of the surface, facing downstream, as tall as the drop
  let waterfalls = 0;
  const fall = lava ? undefined : has(['fx-waterfall', 'waterfall']);
  if (fall) {
    const tall = Math.max(0.5, stroke.catalog.object(fall).height);
    const steep = (a: number) => {
      const run = Math.hypot(points[a].x - points[a - 1].x, points[a].y - points[a - 1].y);
      return run > 0 && (points[a - 1].height - points[a].height) / run >= FALL_SLOPE;
    };
    for (let k = 1; k < points.length; k++) {
      if (!steep(k)) continue;
      const top = points[k - 1];
      while (k + 1 < points.length && steep(k + 1)) k++;
      const foot = points[k];
      const drop = top.height - foot.height;
      if (drop < FALL_MIN) continue;
      const o = stroke.addObject({
        asset: fall,
        x: round((top.x + foot.x) / 2),
        y: round((top.y + foot.y) / 2),
        z: 0,
        rotation: Math.round((Math.atan2(foot.y - top.y, foot.x - top.x) - Math.PI / 2) * 1000) / 1000,
        scale: round(drop / tall),
      });
      placed.push(o.id);
      waterfalls++;
    }
  }

  const bridges = options.bridges && !lava ? bridgeCrossings(stroke, line, maxHalf + options.bank) : 0;
  stroke.changed({ heights: rect, splat: splat ?? undefined, water: true, objects: placed.length ? placed : undefined, paths: bridges > 0 || undefined });
  return { line, river, bridges, waterfalls, heights: rect, splat };
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
