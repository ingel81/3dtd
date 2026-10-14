/**
 * The river brush: a drawn line becomes a natural river or a lava flow: the
 * hand's line smoothed into a Catmull-Rom curve that meanders a little, a
 * width that swells and narrows, a surface that only ever falls (the river
 * runs downhill whichever way it was drawn) that stands a little below the
 * lower of its two banks, so it reads as a filled channel, not a film on
 * the land, a bed deep in the middle with shallow shelves, banks that rise
 * from the water into the land through sand and gravel
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
/** Share of the bank over which it rises from the water's edge to the land; the rest is flat land */
const BANK_RISE = 0.6;
/** A surface falling at least as much as it runs gets a waterfall (a cliff); gentler is rapids */
const FALL_STEEP = 1;
/** Metres one waterfall drops at most; a higher cliff gets a cascade */
const MAX_FALL = 12;
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
 * Metres a river's surface stays below the lower of its banks: the drop
 * from the land to the water that makes it a channel, more for a wider one
 */
export function freeboard(width: number): number {
  return Math.min(1.5, Math.max(0.4, 0.3 + 0.05 * width));
}

/**
 * The surface along a course from its banks: at each point `freeboard`
 * below the lower of the two banks (the land at either side, `out` metres
 * past the water's edge) and UNDER below the ground in the middle (`centre`,
 * the ground before any bed; else the land straight across from bank to
 * bank); never rising downstream and falling at least MIN_FALL per metre.
 * How far the lower bank pulls the surface down is averaged along the
 * course over about the band's width: where the course bends on a slope,
 * the bank samples swing up and down the slope, and the surface should not
 * step with them. `half` is the half width at each point of the line.
 */
export function bankLevels(
  land: (x: number, y: number) => number,
  line: readonly MapPoint[],
  half: (k: number) => number,
  out: number,
  centre?: (x: number, y: number) => number,
): number[] {
  const n = line.length;
  const along: number[] = [];
  const middle: number[] = [];
  const pull: number[] = [];
  for (let k = 0; k < n; k++) {
    const p = line[k];
    const a = line[Math.max(0, k - 1)];
    const b = line[Math.min(n - 1, k + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const h = half(k);
    const d = h + out;
    const left = land(p.x + nx * d, p.y + ny * d);
    const right = land(p.x - nx * d, p.y - ny * d);
    const c = (centre ? centre(p.x, p.y) : (left + right) / 2) - UNDER;
    along.push(k ? along[k - 1] + Math.hypot(p.x - line[k - 1].x, p.y - line[k - 1].y) : 0);
    middle.push(c);
    pull.push(Math.min(0, Math.min(left, right) - freeboard(h * 2) - c));
  }
  const surface: number[] = [];
  let lo = 0;
  let hi = 0;
  let sum = 0;
  for (let k = 0; k < n; k++) {
    // The window of samples within the band's half width plus `out` either way
    const reach = half(k) + out;
    while (hi < n && along[hi] <= along[k] + reach) sum += pull[hi++];
    while (along[lo] < along[k] - reach) sum -= pull[lo++];
    const level = middle[k] + sum / (hi - lo);
    surface.push(k ? Math.min(surface[k - 1] - MIN_FALL * (along[k] - along[k - 1]), level) : level);
  }
  return surface;
}

/**
 * The surface along a course (bankLevels on the ground as it is). A line
 * drawn uphill is turned round so the river flows from its first point;
 * `half` is the half width at a distance along the course as drawn.
 */
export function riverSurface(
  stroke: LandscapeStroke,
  line: readonly MapPoint[],
  half: (along: number) => number,
  bank: number,
): { line: MapPoint[]; surface: number[]; reversed: boolean } {
  const t = stroke.doc.terrain;
  const last = line[line.length - 1];
  const reversed = heightAt(t, line[0].x, line[0].y) < heightAt(t, last.x, last.y);
  const course = reversed ? [...line].reverse() : [...line];
  const along: number[] = [0];
  for (let k = 1; k < course.length; k++) along.push(along[k - 1] + Math.hypot(course[k].x - course[k - 1].x, course[k].y - course[k - 1].y));
  const length = along[along.length - 1];
  const ground = (x: number, y: number) => heightAt(t, x, y);
  // The land where the widest bank meets it, as relevelRiver reads it after carving
  const surface = bankLevels(ground, course, (k) => half(reversed ? length - along[k] : along[k]), bank * 1.4, ground);
  return { line: course, surface, reversed };
}

/**
 * A river's surface heights set again from its banks (bankLevels on the
 * ground as it is, where the brush's widest bank meets the land, so its own
 * bed and banks do not count), the flow direction kept:
 * a river from before sinks into its channel, one carved since stays put
 */
export function relevelRiver(stroke: LandscapeStroke, river: MapRiver, bank = DEFAULT_RIVER.bank): void {
  const t = stroke.doc.terrain;
  const pts = river.points;
  if (pts.length < 2) return;
  stroke.markRivers();
  const levels = bankLevels((x, y) => heightAt(t, x, y), pts, (k) => pts[k].width / 2, bank * 1.4);
  pts.forEach((p, k) => (p.height = Math.round(levels[k] * 100) / 100));
}

export function carveRiver(stroke: LandscapeStroke, drawn: readonly MapPoint[], options: RiverOptions): RiverResult | null {
  const doc = stroke.doc;
  const t = doc.terrain;
  const g = t.grid;
  if (drawn.length < 2 || polylineLength(drawn) < g.cellSize * 3) return null;
  const lava = options.kind === 'lava';
  const course = riverCourse(stroke, drawn, options, g.cellSize);
  const { line, surface, reversed } = riverSurface(stroke, course.line, course.half, options.bank);
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

  const xs = line.map((p) => p.x);
  const ys = line.map((p) => p.y);
  const rect: GridRect = {
    i0: Math.max(0, Math.floor((Math.min(...xs) - reach + t.width / 2) / g.cellSize)),
    i1: Math.min(g.columns - 1, Math.ceil((Math.max(...xs) + reach + t.width / 2) / g.cellSize)),
    j0: Math.max(0, Math.floor((Math.min(...ys) - reach + t.depth / 2) / g.cellSize)),
    j1: Math.min(g.rows - 1, Math.ceil((Math.max(...ys) + reach + t.depth / 2) / g.cellSize)),
  };
  stroke.touchHeights(rect);
  const bankAt = bankWidthAt(stroke, options.bank);
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
        const s = smooth(0, 1, (d - h) / (bank * BANK_RISE));
        g.heights[k] = shore + (base - shore) * s;
      }
    }
  }

  const splat = paintRiverBed(stroke, line, half, bankAt, reach, lava);

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

  const { placed, waterfalls } = decorateRiver(stroke, line, along, surface, half, options, lava);

  const bridges = options.bridges && !lava ? bridgeCrossings(stroke, line, maxHalf + options.bank) : 0;
  stroke.changed({ heights: rect, splat: splat ?? undefined, water: true, objects: placed.length ? placed : undefined, paths: bridges > 0 || undefined });
  return { line, river, bridges, waterfalls, heights: rect, splat };
}

/** Bank width at a point: wider and narrower along the river */
function bankWidthAt(stroke: LandscapeStroke, bank: number): (x: number, y: number) => number {
  const n = stroke.noise;
  return (x, y) => bank * (0.7 + 0.6 * (0.5 + 0.5 * n.fbm(x, y, 40, 2, 'n3')));
}

/**
 * The ground of a river's bed and banks: mud and gravel in the bed, sand
 * and gravel on the inner bank (scorched rock by lava), fading into the land
 * over the outer half of the bank. Returns the painted texels.
 */
function paintRiverBed(
  stroke: LandscapeStroke,
  line: readonly MapPoint[],
  half: (s: number) => number,
  bankAt: (x: number, y: number) => number,
  reach: number,
  lava: boolean,
): GridRect | null {
  // Ground: mud and gravel in the bed, sand and gravel on the inner bank (scorched rock by lava), fading into the land
  const sand = stroke.layerOf(lava ? ['scorched-ground', 'volcanic-rock', 'basalt'] : ['sand', 'gravel']);
  const gravel = stroke.layerOf(lava ? ['volcanic-rock', 'basalt', 'scorched-ground'] : ['gravel', 'rocky-ground', 'sand']);
  const mud = stroke.layerOf(lava ? ['lava-crust', 'basalt'] : ['mud', 'dirt']);
  let splat: GridRect | null = null;
  const t = stroke.doc.terrain;
  const n = stroke.noise;
  const xs = line.map((p) => p.x);
  const ys = line.map((p) => p.y);
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

  return splat;
}

/**
 * What the brush puts along a river: reeds in clumps at the edge and stones
 * on the banks (by lava only scattered volcanic rock), and waterfalls where
 * the surface drops more than it runs (a cliff), at the lip, one per step of
 * at most MAX_FALL metres. `along` and `surface` are per point of `line`,
 * `half` the half width at a distance along it.
 */
function decorateRiver(
  stroke: LandscapeStroke,
  line: readonly MapPoint[],
  along: readonly number[],
  surface: readonly number[],
  half: (s: number) => number,
  options: { reeds: boolean; bank: number },
  lava: boolean,
): { placed: string[]; waterfalls: number } {
  const t = stroke.doc.terrain;
  const n = stroke.noise;
  const length = along[along.length - 1] ?? 0;
  const round = (v: number) => Math.round(v * 100) / 100;
  const placed: string[] = [];
  // Reeds in clumps at the edge and stones on the banks; by lava only scattered volcanic rock
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

  // Waterfalls where the surface drops more than it runs (a cliff), at the lip, one per step of at most
  // MAX_FALL metres; gentler steep stretches stay rapids on the ribbon
  let waterfalls = 0;
  const fall = lava ? undefined : has(['fx-waterfall', 'waterfall']);
  if (fall) {
    const tall = Math.max(0.5, stroke.catalog.object(fall).height);
    const steep = (k: number) => {
      const run = along[k] - along[k - 1];
      return run > 0 && (surface[k - 1] - surface[k]) / run >= FALL_STEEP;
    };
    for (let k = 1; k < line.length; k++) {
      if (!steep(k)) continue;
      const top = k - 1;
      while (k + 1 < line.length && steep(k + 1)) k++;
      const drop = surface[top] - surface[k];
      if (drop < FALL_MIN) continue;
      const steps = Math.max(1, Math.ceil(drop / MAX_FALL - 0.05));
      const heading = Math.atan2(line[k].y - line[top].y, line[k].x - line[top].x) - Math.PI / 2;
      for (let n = 0; n < steps; n++) {
        // The lip of this step: where the surface has fallen n steps' worth
        const lipLevel = surface[top] - (drop * n) / steps;
        let at = top;
        while (at < k && surface[at + 1] > lipLevel - 1e-3) at++;
        const lip = line[at];
        const foot = lipLevel - drop / steps;
        const ground = heightAt(t, lip.x, lip.y);
        const o = stroke.addObject({
          asset: fall,
          x: round(lip.x),
          y: round(lip.y),
          // The sheet stands from its foot up to the lip
          z: round(foot - ground),
          rotation: Math.round(heading * 1000) / 1000,
          scale: round(drop / steps / tall),
        });
        placed.push(o.id);
        waterfalls++;
      }
    }
  }

  return { placed, waterfalls };
}

/**
 * Carves the bed of an existing river again along its points (after they
 * were moved): deep in the middle, a soft bank up to the land, as the brush
 * does, the surface and widths from the points. Returns the changed rect.
 */
export function recarveRiver(
  stroke: LandscapeStroke,
  river: MapRiver,
  depth = DEFAULT_RIVER.depth,
  bankWidth = DEFAULT_RIVER.bank,
  /** The land the bed is cut into; the ground before the stroke by default */
  base: (i: number, j: number) => number = (i, j) => stroke.baseHeight(i, j),
): GridRect | null {
  const t = stroke.doc.terrain;
  const g = t.grid;
  const pts = river.points;
  if (pts.length < 2) return null;
  const along: number[] = [0];
  for (let k = 1; k < pts.length; k++) along.push(along[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
  const at = (s: number, key: 'width' | 'height') => {
    let k = 1;
    while (k < pts.length - 1 && along[k] < s) k++;
    const f = Math.min(1, Math.max(0, (s - along[k - 1]) / Math.max(1e-6, along[k] - along[k - 1])));
    return pts[k - 1][key] + (pts[k][key] - pts[k - 1][key]) * f;
  };
  const reach = Math.max(...pts.map((q) => q.width)) / 2 + bankWidth * 1.4;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const rect: GridRect = {
    i0: Math.max(0, Math.floor((Math.min(...xs) - reach + t.width / 2) / g.cellSize)),
    i1: Math.min(g.columns - 1, Math.ceil((Math.max(...xs) + reach + t.width / 2) / g.cellSize)),
    j0: Math.max(0, Math.floor((Math.min(...ys) - reach + t.depth / 2) / g.cellSize)),
    j1: Math.min(g.rows - 1, Math.ceil((Math.max(...ys) + reach + t.depth / 2) / g.cellSize)),
  };
  stroke.touchHeights(rect);
  for (let j = rect.j0; j <= rect.j1; j++) {
    const y = sampleY(t, j);
    for (let i = rect.i0; i <= rect.i1; i++) {
      const x = sampleX(t, i);
      const hit = nearestOnPolyline(pts, { x, y });
      if (!hit) continue;
      const h = at(hit.along, 'width') / 2;
      const d = hit.dist;
      if (d >= h + bankWidth) continue;
      const k = j * g.columns + i;
      const land = base(i, j);
      const level = at(hit.along, 'height');
      if (d < h) {
        const deep = Math.pow(1 - smooth(0.2, 1, d / h), 1.3);
        g.heights[k] = Math.min(land, level - 0.25 - depth * deep);
      } else {
        const shore = level + 0.35;
        g.heights[k] = shore + (land - shore) * smooth(0, 1, (d - h) / (bankWidth * BANK_RISE));
      }
    }
  }
  stroke.changed({ heights: rect, water: true });
  return rect;
}

/** What the river brush puts on the banks and in the falls; a removed river takes them along */
const RIVER_ASSETS = new Set([
  'reed-bed', 'reeds', 'grass-swamp', 'grass-clump',
  'stones', 'rock-round', 'rock-small',
  'rock-volcanic', 'rock-basalt', 'rock-pumice',
  'fx-waterfall', 'waterfall',
]);

/**
 * Takes a river off the map as if it had never been carved: across the bed
 * and its banks the ground runs straight from the land on one side to the
 * land on the other (a levee or a cutting goes too), and so does the ground
 * paint, blending into the land at the edge. The reeds, stones and falls of
 * the brush in that band go along, a bridge over it is a road again.
 * Returns the changed height rect.
 */
export function removeRiver(stroke: LandscapeStroke, index: number, bankWidth = DEFAULT_RIVER.bank): GridRect | null {
  const t = stroke.doc.terrain;
  const river = t.rivers?.[index];
  if (!river) return null;
  stroke.markRivers();
  t.rivers!.splice(index, 1);
  if (!t.rivers!.length) delete t.rivers;
  const pts = river.points;
  if (pts.length < 2) {
    stroke.changed({ water: true });
    return null;
  }
  const reachAt = riverReach(pts, bankWidth);
  const { heights: rect, splat } = restoreBand(stroke, pts, reachAt);

  // A bridge over the river is a road again
  for (const edge of stroke.doc.paths.edges) {
    if (edge.kind !== 'bridge') continue;
    const line = edgePolyline(stroke.doc.paths, edge);
    const crosses = line.some((p, k) => k > 0 && pts.some((r, m) => m > 0 && segmentCross(line[k - 1], p, pts[m - 1], r) !== null));
    if (!crosses) continue;
    stroke.markPaths();
    edge.kind = 'road';
  }

  const gone = stroke.doc.objects
    .filter((o) => RIVER_ASSETS.has(o.asset))
    .filter((o) => {
      const hit = nearestOnPolyline(pts, o);
      return !!hit && hit.dist < reachAt(hit.along);
    })
    .map((o) => o.id);
  stroke.removeObjects(gone);
  stroke.changed({ heights: rect, splat, water: true, paths: stroke.pathsMarked || undefined, objects: gone.length ? gone : undefined });
  return rect;
}

/** The half width of a river's band at each distance along it: its surface and the banks the brush made */
function riverReach(pts: readonly MapRiver['points'][number][], bankWidth: number): (along: number) => number {
  const along: number[] = [0];
  for (let k = 1; k < pts.length; k++) along.push(along[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
  return (s: number) => {
    let k = 1;
    while (k < pts.length - 1 && along[k] < s) k++;
    const f = Math.min(1, Math.max(0, (s - along[k - 1]) / Math.max(1e-6, along[k] - along[k - 1])));
    // The brush's banks reach up to 1.3 times their mean width
    return (pts[k - 1].width + (pts[k].width - pts[k - 1].width) * f) / 2 + bankWidth * 1.4;
  };
}

/**
 * The ground of a band along a line as if nothing had been built or carved
 * there: across the band the heights run straight from the land at one edge
 * to the land at the other (a bed, a levee, an embankment or a cutting
 * goes), and so does the ground paint, easing into the land over the outer
 * quarter. `reachAt` is the band's half width at each distance along the
 * line. Returns the changed height and texel rects.
 */
export function restoreBand(
  stroke: LandscapeStroke,
  pts: readonly MapPoint[],
  reachAt: (along: number) => number,
  /** Leave the heights (the caller restores them itself) and do only the paint */
  paintOnly = false,
): { heights: GridRect; splat: GridRect } {
  const t = stroke.doc.terrain;
  const g = t.grid;
  /**
   * Where a point lies in the band: the land at its two edges straight across
   * the course, the share of the way from the right edge to the left, and how
   * much the fill counts (full over the bed, easing out over the outer quarter)
   */
  const across = (x: number, y: number) => {
    const hit = nearestOnPolyline(pts, { x, y });
    if (!hit) return null;
    const e = reachAt(hit.along);
    if (hit.dist >= e) return null;
    const a = pts[hit.segment];
    const b = pts[hit.segment + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const q = hit.point;
    const offset = (x - q.x) * nx + (y - q.y) * ny;
    return {
      left: { x: q.x + nx * e, y: q.y + ny * e },
      right: { x: q.x - nx * e, y: q.y - ny * e },
      share: Math.min(1, Math.max(0, (offset + e) / (2 * e))),
      weight: 1 - smooth(0.75, 1, hit.dist / e),
    };
  };
  let reach = 0;
  let along = 0;
  for (let k = 0; k < pts.length; k++) {
    if (k) along += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
    reach = Math.max(reach, reachAt(along));
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs) - reach + t.width / 2;
  const x1 = Math.max(...xs) + reach + t.width / 2;
  const y0 = Math.min(...ys) - reach + t.depth / 2;
  const y1 = Math.max(...ys) + reach + t.depth / 2;

  // Heights: worked out on the built ground first, written after, so no fill reads another
  const rect: GridRect = {
    i0: Math.max(0, Math.floor(x0 / g.cellSize)),
    i1: Math.min(g.columns - 1, Math.ceil(x1 / g.cellSize)),
    j0: Math.max(0, Math.floor(y0 / g.cellSize)),
    j1: Math.min(g.rows - 1, Math.ceil(y1 / g.cellSize)),
  };
  if (!paintOnly) stroke.touchHeights(rect);
  const fills: { k: number; h: number }[] = [];
  for (let j = paintOnly ? rect.j1 + 1 : rect.j0; j <= rect.j1; j++) {
    const y = sampleY(t, j);
    for (let i = rect.i0; i <= rect.i1; i++) {
      const x = sampleX(t, i);
      const c = across(x, y);
      if (!c) continue;
      const left = heightAt(t, c.left.x, c.left.y);
      const right = heightAt(t, c.right.x, c.right.y);
      const k = j * g.columns + i;
      fills.push({ k, h: g.heights[k] + (right + (left - right) * c.share - g.heights[k]) * c.weight });
    }
  }
  for (const f of fills) g.heights[f.k] = f.h;

  // Ground paint the same way, from the texels at the two edges
  const res = t.splat.resolution;
  const splat: GridRect = {
    i0: Math.max(0, Math.floor((x0 / t.width) * res)),
    i1: Math.min(res - 1, Math.ceil((x1 / t.width) * res)),
    j0: Math.max(0, Math.floor((y0 / t.depth) * res)),
    j1: Math.min(res - 1, Math.ceil((y1 / t.depth) * res)),
  };
  stroke.touchSplat(splat);
  const texelAt = (p: MapPoint) => {
    const u = Math.min(res - 1, Math.max(0, Math.floor(((p.x + t.width / 2) / t.width) * res)));
    const v = Math.min(res - 1, Math.max(0, Math.floor(((p.y + t.depth / 2) / t.depth) * res)));
    return v * res + u;
  };
  const left = new Float32Array(MAX_LAYERS);
  const right = new Float32Array(MAX_LAYERS);
  const w8 = new Float32Array(MAX_LAYERS);
  const paints: { texel: number; w: Float32Array }[] = [];
  for (let v = splat.j0; v <= splat.j1; v++) {
    const y = texelY(t, v);
    for (let u = splat.i0; u <= splat.i1; u++) {
      const c = across(texelX(t, u), y);
      if (!c) continue;
      const texel = v * res + u;
      readWeights(t, texelAt(c.left), left);
      readWeights(t, texelAt(c.right), right);
      readWeights(t, texel, w8);
      const out = new Float32Array(MAX_LAYERS);
      for (let k = 0; k < MAX_LAYERS; k++) out[k] = w8[k] + (right[k] + (left[k] - right[k]) * c.share - w8[k]) * c.weight;
      paints.push({ texel, w: out });
    }
  }
  for (const p of paints) writeWeights(t, p.texel, p.w);
  return { heights: rect, splat };
}

/**
 * A river reshaped (points moved, taken out, a new width): the old bed is
 * filled as if never carved and the new one carved, the reeds, stones and
 * falls of the old band that the new band does not reach go. `rivers` in
 * the document already hold the new shape.
 */
export function moveRiverBed(stroke: LandscapeStroke, before: MapRiver, after: MapRiver, bankWidth = DEFAULT_RIVER.bank): void {
  if (before.points.length < 2) {
    recarveRiver(stroke, after);
    return;
  }
  const oldReach = riverReach(before.points, bankWidth);
  const newReach = riverReach(after.points, bankWidth);
  // The brush's reeds, stones and falls of both bands go; the new band gets its own, as at the first carving
  const gone = stroke.doc.objects
    .filter((o) => RIVER_ASSETS.has(o.asset))
    .filter((o) => {
      const was = nearestOnPolyline(before.points, o);
      const now = nearestOnPolyline(after.points, o);
      return (!!was && was.dist < oldReach(was.along)) || (!!now && now.dist < newReach(now.along));
    })
    .map((o) => o.id);
  stroke.removeObjects(gone);
  const band = restoreBand(stroke, before.points, oldReach);
  // The new bed cuts into the land as it is now, the old bed filled
  const land = stroke.doc.terrain.grid.heights.slice();
  const columns = stroke.doc.terrain.grid.columns;
  // Its surface from the banks where it runs now
  relevelRiver(stroke, after, bankWidth);
  const carved = after.points.length >= 2 ? recarveRiver(stroke, after, DEFAULT_RIVER.depth, bankWidth, (i, j) => land[j * columns + i]) : null;
  let painted: GridRect | null = null;
  let placed: string[] = [];
  if (carved) {
    const pts = after.points;
    const along: number[] = [0];
    for (let k = 1; k < pts.length; k++) along.push(along[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
    const half = (s: number) => newReach(s) - bankWidth * 1.4;
    const lava = after.kind === 'lava';
    painted = paintRiverBed(stroke, pts, half, bankWidthAt(stroke, bankWidth), Math.max(...pts.map((q) => q.width)) / 2 + bankWidth * 1.4, lava);
    placed = decorateRiver(stroke, pts, along, pts.map((q) => q.height), half, { reeds: true, bank: bankWidth }, lava).placed;
  }
  stroke.changed({
    heights: carved ? { i0: Math.min(band.heights.i0, carved.i0), j0: Math.min(band.heights.j0, carved.j0), i1: Math.max(band.heights.i1, carved.i1), j1: Math.max(band.heights.j1, carved.j1) } : band.heights,
    splat: painted ? { i0: Math.min(band.splat.i0, painted.i0), j0: Math.min(band.splat.j0, painted.j0), i1: Math.max(band.splat.i1, painted.i1), j1: Math.max(band.splat.j1, painted.j1) } : band.splat,
    water: true,
    objects: gone.length || placed.length ? [...gone, ...placed] : undefined,
  });
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
