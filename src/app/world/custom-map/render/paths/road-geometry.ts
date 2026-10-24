/**
 * Plane geometry of the road network: points, tangents and sections along
 * a chain, a chain's end, where segments meet or cross, rings, and the
 * order and offset of a chain from its edges' ids.
 */
import type { Chain, End, Section } from './road-types';
import type { MapPoint } from '../../map-document';
import { seedOf } from '../../../../utils/seeded-random';
import { ORDER_STEP } from './road-style';

/** A chain's end at its start or its finish: its direction away from the node, over its first three metres */
export function endOf(chain: Chain, start: boolean): End {
  const p = start ? chain.line[0] : chain.line[chain.line.length - 1];
  const reach = Math.min(3, chain.length * 0.3);
  const q = pointAt(chain, chain.at[0] + (start ? reach : chain.length - reach));
  const l = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  const end: End = { chain, start, x: p.x, y: p.y, dx: (q.x - p.x) / l, dy: (q.y - p.y) / l, angle: 0 };
  end.angle = Math.atan2(end.dy, end.dx);
  return end;
}

/** Three columns of a ribbon: the distance to the edge peaks in the middle (the ground's bends cut the triangles, conformDraped) */
export const COLUMNS = [-1, 0, 1];

/** A chain's cross section at a distance along, right to left looking along it */
export function sectionAt(chain: Chain, d: number): Section {
  const p = pointAt(chain, d);
  const t = tangentAt(chain, d);
  const walk = chain.walk;
  const h = chain.half;
  // Mitred at a corner: the offset grows as the corner sharpens, at most twice the width
  const nx = -t.y * t.scale;
  const ny = t.x * t.scale;
  return COLUMNS.map((u) => ({ x: p.x + nx * u * h, y: p.y + ny * u * h, across: u * h, along: d, edge: h * (1 - Math.abs(u)) - walk, style: chain.style, dx: t.x, dy: t.y }));
}

/** Where a chain's drawn ribbon starts and ends (distances along) by its trims; trimmed away between two junctions, one point where they meet */
export function ribbonSpan(chain: Chain): [number, number] {
  const o = chain.at[0];
  const from = o + chain.trim[0];
  const to = o + chain.length - chain.trim[1];
  if (to - from >= 0.05) return [from, to];
  const mid = Math.max(o, Math.min(o + chain.length, (from + to) / 2));
  return [mid, mid];
}

/** Whether a point lies on a chain's surface, more than a few decimetres in from its edges */
export function insideRibbon(chain: Chain, p: MapPoint): boolean {
  const { line } = chain;
  const limit = chain.half - 0.3;
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1];
    const lx = line[k].x - a.x;
    const ly = line[k].y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * lx + (p.y - a.y) * ly) / (lx * lx + ly * ly || 1)));
    if (Math.hypot(p.x - a.x - lx * t, p.y - a.y - ly * t) < limit) return true;
  }
  return false;
}

/** The end section of a road at a junction (its ribbon's, as emitRibbon lays it), right to left seen from the node */
export function endSection(e: End): Section {
  const [from, to] = ribbonSpan(e.chain);
  const s = sectionAt(e.chain, e.start ? from : to);
  return e.start ? s : s.reverse();
}

/** Whether a point lies inside a ring (even-odd) */
export function inRing(ring: readonly MapPoint[], q: MapPoint): boolean {
  let inside = false;
  for (let k = 0, l = ring.length - 1; k < ring.length; l = k++) {
    const a = ring[k];
    const b = ring[l];
    if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Whether a ring is a polygon: counter-clockwise, no side crossing another */
export function simpleRing(ring: readonly MapPoint[]): boolean {
  const n = ring.length;
  let area = 0;
  for (let k = 0; k < n; k++) area += ring[k].x * ring[(k + 1) % n].y - ring[(k + 1) % n].x * ring[k].y;
  if (area <= 0) return false;
  for (let k = 0; k < n; k++) {
    for (let j = k + 2; j < n; j++) if (!(k === 0 && j === n - 1) && crosses(ring[k], ring[k + 1], ring[j], ring[(j + 1) % n])) return false;
  }
  return true;
}

/** Distance from p to segment a-b, and where along it (0 at a, 1 at b) the nearest point lies */
export function segmentDistance(p: MapPoint, a: MapPoint, b: MapPoint): { d: number; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return { d: Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t), t };
}

/** Whether segment p-q crosses segment r-s inside both (touching at an end is no crossing) */
export function crosses(p: MapPoint, q: MapPoint, r: MapPoint, s: MapPoint): boolean {
  if (Math.max(p.x, q.x) < Math.min(r.x, s.x) || Math.max(r.x, s.x) < Math.min(p.x, q.x)) return false;
  if (Math.max(p.y, q.y) < Math.min(r.y, s.y) || Math.max(r.y, s.y) < Math.min(p.y, q.y)) return false;
  const side = (a: MapPoint, b: MapPoint, c: MapPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const a = side(p, q, r);
  const b = side(p, q, s);
  const e = side(r, s, p);
  const f = side(r, s, q);
  return ((a > 1e-9 && b < -1e-9) || (a < -1e-9 && b > 1e-9)) && ((e > 1e-9 && f < -1e-9) || (e < -1e-9 && f > 1e-9));
}

/** Where the line on from p through q (beyond q) meets the line back from s through r (before r), null behind either */
export function rayMeet(p: MapPoint, q: MapPoint, r: MapPoint, s: MapPoint): MapPoint | null {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const ex = r.x - s.x;
  const ey = r.y - s.y;
  const det = dx * -ey - dy * -ex;
  if (Math.abs(det) < 1e-9) return null;
  // q + d * a = r + e * b, a, b >= 0
  const rx = r.x - q.x;
  const ry = r.y - q.y;
  const a = (rx * -ey - ry * -ex) / det;
  const b = (dx * ry - dy * rx) / det;
  if (a < 0 || b < 0) return null;
  return { x: q.x + dx * a, y: q.y + dy * a };
}

/** Where segment p-q crosses segment r-s, null when it does not */
export function segmentCross(p: MapPoint, q: MapPoint, r: MapPoint, s: MapPoint): MapPoint | null {
  const d = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x);
  if (Math.abs(d) < 1e-12) return null;
  const t = ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / d;
  const u = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / d;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
}

/** The point at a distance along a chain */
export function pointAt(chain: Chain, d: number): MapPoint {
  const { line, at } = chain;
  const k = segmentAt(at, d);
  const span = at[k] - at[k - 1] || 1;
  const t = Math.min(1, Math.max(0, (d - at[k - 1]) / span));
  return { x: line[k - 1].x + (line[k].x - line[k - 1].x) * t, y: line[k - 1].y + (line[k].y - line[k - 1].y) * t };
}

/**
 * Unit direction at a distance along a chain, and the mitre's stretch of
 * the offset: at a point of the line the mean of its two segments, the
 * offset lengthened so both kerbs keep their width (at most twice)
 */
export function tangentAt(chain: Chain, d: number): { x: number; y: number; scale: number } {
  const { line, at } = chain;
  const seg = (k: number): MapPoint => {
    const a = line[Math.max(0, Math.min(line.length - 2, k))];
    const b = line[Math.max(1, Math.min(line.length - 1, k + 1))];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  };
  const k = segmentAt(at, d - 1e-6);
  const here = seg(k - 1);
  // On a point of the line (not its ends): mitre between the segments either side
  if (k < at.length - 1 && Math.abs(at[k] - d) < 1e-6) {
    const after = seg(k);
    const mx = here.x + after.x;
    const my = here.y + after.y;
    const l = Math.hypot(mx, my);
    if (l < 1e-6) return { ...here, scale: 1 };
    const cos = (mx / l) * here.x + (my / l) * here.y;
    return { x: mx / l, y: my / l, scale: 1 / Math.max(0.5, cos) };
  }
  return { ...here, scale: 1 };
}

/** The first index k >= 1 with at[k] >= d (the last when none): the segment k - 1 .. k holding distance d */
function segmentAt(at: readonly number[], d: number): number {
  let lo = 1;
  let hi = at.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (at[mid] < d) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Where two ribbons or junctions of one rank overlap without meeting (a
 * footway crossing another, a slip road over a street's pavement), which
 * lies over which: an order within the rank from an id (0 to 15, in the
 * look's top bits, ORDER_STEP; road-surface.ts draws each step a little
 * nearer). On the ground's own triangles two of one rank would lie at one
 * depth and fight
 */
export function orderOf(id: string): number {
  return (seedOf(id) % 16) * ORDER_STEP;
}

/** A chain's start of distance along, from its edges' ids (the least): 0.5 to 997 m */
export function alongOffset(edges: readonly string[]): number {
  const id = edges.reduce((a, b) => (b < a ? b : a));
  return (seedOf(id) % 997) + 0.5;
}

/** Points closer than 5 cm to the previous one left out */
export function dropDoubles(line: readonly MapPoint[]): MapPoint[] {
  const out: MapPoint[] = [];
  for (const p of line) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 0.05) out.push(p);
  }
  return out;
}

/**
 * Corners of the line rounded off: a corner turning more than 8 degrees
 * becomes a curve (quadratic, through points every 10 degrees) that leaves
 * each segment up to 40% of its length before the corner, at most 1.5 road
 * widths; OSM lines are straight between their nodes, and a wide road's
 * kerb at a mitred corner read as a kink
 */
export function roundCorners(line: readonly MapPoint[], half: number): MapPoint[] {
  if (line.length < 3) return [...line];
  const out: MapPoint[] = [line[0]];
  for (let k = 1; k < line.length - 1; k++) {
    const a = line[k - 1];
    const p = line[k];
    const b = line[k + 1];
    const la = Math.hypot(p.x - a.x, p.y - a.y);
    const lb = Math.hypot(b.x - p.x, b.y - p.y);
    const cos = ((p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y)) / (la * lb || 1);
    const turn = Math.acos(Math.max(-1, Math.min(1, cos)));
    if (turn < (8 * Math.PI) / 180) {
      out.push(p);
      continue;
    }
    const cut = Math.min(0.4 * la, 0.4 * lb, 3 * half);
    const s = { x: p.x + ((a.x - p.x) * cut) / la, y: p.y + ((a.y - p.y) * cut) / la };
    const e = { x: p.x + ((b.x - p.x) * cut) / lb, y: p.y + ((b.y - p.y) * cut) / lb };
    const steps = Math.max(2, Math.ceil(turn / ((10 * Math.PI) / 180)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      out.push({ x: u * u * s.x + 2 * u * t * p.x + t * t * e.x, y: u * u * s.y + 2 * u * t * p.y + t * t * e.y });
    }
  }
  out.push(line[line.length - 1]);
  return out;
}
