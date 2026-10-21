/**
 * Surfaces over the ground (MapSurface, TODO E237): their limits and checks,
 * the turned rectangle a marking is drawn in, and the measures of what it
 * draws there. The renderer (render/surfaces/) draws the lines from these
 * measures; the OSM world places goals, nets and cars by them, so a goal
 * stands on the goal line the shader paints.
 */
import { MAP_SURFACE_MARKINGS, type MapPoint, type MapSurface, type MapSurfaceMarking, type MapSurfaceMarkingKind } from './map-document';
import type { MapText, MapThing } from './map-text';

/** Most surfaces a map keeps (an OSM city has some 900) */
export const MAX_SURFACES = 4096;
/** Most points of an outline or a hole */
export const MAX_SURFACE_POINTS = 2048;
/** Most holes of a surface */
export const MAX_SURFACE_HOLES = 64;
/**
 * Most materials a map's surfaces draw (one texture array, as the roads');
 * a surface past them draws its material's mean colour
 */
export const MAX_SURFACE_MATERIALS = 15;
/** How much of its rectangle an outline must fill for a marking to fit (a car park in an L takes its paving only) */
export const MARKING_FILL = 0.85;

/**
 * The court a marking draws, in metres: real measures, fitted into the
 * rectangle less a metre each side where it is smaller. A football pitch, a
 * multi-sport court, a track, a car park and a platform take the rectangle
 * itself (their lines are its edges)
 */
const COURT: Readonly<Record<MapSurfaceMarkingKind, { length: number; width: number } | null>> = {
  soccer: null,
  handball: { length: 40, width: 20 },
  basketball: { length: 28, width: 15 },
  tennis: { length: 23.77, width: 10.97 },
  volleyball: { length: 18, width: 9 },
  multi: null,
  track: null,
  parking: null,
  platform: null,
  runnel: null,
};

/** Metres of water at a runnel's bottom without its own (MapSurfaceMarking.water): a trickle */
export const RUNNEL_TRICKLE = 0.08;

/** Metres between a court's lines and the rectangle's edge, each side */
const RUN_OFF = 1;
/** A football pitch's or multi-sport court's lines stay inside the rectangle by this share of its side, at most 3 m */
const PITCH_INSET = 0.02;

/**
 * The court's length and width (along and across the rectangle), metres. A
 * runnel's are its water's width and its own: it draws by its outline, the
 * shader needs only how wide it and its water are
 */
export function courtOf(m: Pick<MapSurfaceMarking, 'kind' | 'length' | 'width' | 'water'>): { length: number; width: number } {
  if (m.kind === 'runnel') return { length: Math.min(m.width, m.water ?? RUNNEL_TRICKLE), width: m.width };
  const real = COURT[m.kind];
  if (!real) {
    if (m.kind !== 'soccer' && m.kind !== 'multi') return { length: m.length, width: m.width };
    const inset = Math.min(3, Math.max(0.5, Math.min(m.length, m.width) * PITCH_INSET));
    return { length: Math.max(0, m.length - 2 * inset), width: Math.max(0, m.width - 2 * inset) };
  }
  const fit = Math.min(1, Math.max(0, m.length - 2 * RUN_OFF) / real.length, Math.max(0, m.width - 2 * RUN_OFF) / real.width);
  return { length: real.length * fit, width: real.width * fit };
}

/** A point of the marking's frame (`u` along its length, `v` across, from its middle) in map space */
export function markingPoint(m: MapSurfaceMarking, u: number, v: number): MapPoint {
  const c = Math.cos(m.angle);
  const s = Math.sin(m.angle);
  return { x: m.x + u * c - v * s, y: m.y + u * s + v * c };
}

/** A map point in the marking's frame: `u` along its length, `v` across */
export function markingFrame(m: MapSurfaceMarking, p: MapPoint): { u: number; v: number } {
  const c = Math.cos(m.angle);
  const s = Math.sin(m.angle);
  const dx = p.x - m.x;
  const dy = p.y - m.y;
  return { u: dx * c + dy * s, v: -dx * s + dy * c };
}

/** Metres along the length of a car park's stall, and across the row */
export const STALL = { width: 2.5, depth: 5 } as const;
/** A car park's aisle between two rows of stalls, at least, metres */
const AISLE = 6;

/**
 * The rows of a car park's stalls, across its rectangle: each a band
 * `[v0, v1]` with its stalls nose to `v0` or `v1` (the side of the aisle),
 * and the stalls' middles along it. Rows lie back to back between the
 * aisles: a band of 16 m holds a row, an aisle and a row; a narrow park has
 * a row along one side, a park narrower than a stall none. The shader draws
 * the same lines (SURFACE_SAMPLE `parking`)
 */
export function parkingRows(m: Pick<MapSurfaceMarking, 'length' | 'width'>): { v0: number; v1: number; aisle: 1 | -1; stalls: number[] }[] {
  const { length: l, width: w } = m;
  const count = Math.floor(Math.max(0, l - 2) / STALL.width);
  const first = (-count * STALL.width) / 2 + STALL.width / 2;
  const stalls = Array.from({ length: count }, (_, k) => first + k * STALL.width);
  const rows: { v0: number; v1: number; aisle: 1 | -1; stalls: number[] }[] = [];
  if (w < STALL.depth || count === 0) return rows;
  if (w < 2 * STALL.depth + AISLE) {
    rows.push({ v0: -w / 2, v1: -w / 2 + STALL.depth, aisle: 1, stalls });
    return rows;
  }
  const bands = parkingBands(w);
  const band = w / bands;
  for (let k = 0; k < bands; k++) {
    const v0 = -w / 2 + k * band;
    rows.push({ v0, v1: v0 + STALL.depth, aisle: 1, stalls });
    rows.push({ v0: v0 + band - STALL.depth, v1: v0 + band, aisle: -1, stalls });
  }
  return rows;
}

/** Bands of row, aisle and row across a car park `width` wide (at least 16 m) */
export function parkingBands(width: number): number {
  return Math.max(1, Math.round(width / (2 * STALL.depth + AISLE)));
}

/** A turned rectangle: middle, unit axis `u` along side `a`, side `b` across (u turned a quarter left) */
export interface TurnedRect {
  c: MapPoint;
  u: MapPoint;
  a: number;
  b: number;
}

/** Convex hull (Andrew's monotone chain), counter-clockwise */
export function convexHull(points: readonly MapPoint[]): MapPoint[] {
  const pts = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
  if (pts.length < 3) return pts;
  const cross = (o: MapPoint, a: MapPoint, b: MapPoint) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: MapPoint[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: MapPoint[] = [];
  for (let k = pts.length - 1; k >= 0; k--) {
    const p = pts[k];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** The smallest turned rectangle round a ring: one side lies on an edge of its hull (rotating calipers, tried edge by edge) */
export function minAreaRect(ring: readonly MapPoint[]): TurnedRect {
  const hull = convexHull(ring);
  let best: TurnedRect | null = null;
  let bestArea = Infinity;
  for (let k = 0; k < hull.length; k++) {
    const p = hull[k];
    const q = hull[(k + 1) % hull.length];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (len < 1e-6) continue;
    const u = { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const h of hull) {
      const su = h.x * u.x + h.y * u.y;
      const sv = -h.x * u.y + h.y * u.x;
      minU = Math.min(minU, su);
      maxU = Math.max(maxU, su);
      minV = Math.min(minV, sv);
      maxV = Math.max(maxV, sv);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea - 1e-9) {
      bestArea = area;
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      best = { c: { x: cu * u.x - cv * u.y, y: cu * u.y + cv * u.x }, u, a: maxU - minU, b: maxV - minV };
    }
  }
  return best ?? { c: ring[0] ?? { x: 0, y: 0 }, u: { x: 1, y: 0 }, a: 0, b: 0 };
}

/** Signed area of a ring (counter-clockwise positive) */
export function signedArea(ring: readonly MapPoint[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j].x - ring[i].x) * (ring[j].y + ring[i].y);
  return s / 2;
}

/** Square metres of a surface: its outline less its holes */
export function surfaceArea(s: Pick<MapSurface, 'outer' | 'holes'>): number {
  return Math.abs(signedArea(s.outer)) - (s.holes ?? []).reduce((sum, h) => sum + Math.abs(signedArea(h)), 0);
}

/** Even-odd: whether a point lies inside a ring */
export function insideRing(p: MapPoint, ring: readonly MapPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x)) inside = !inside;
  }
  return inside;
}

/** Whether a point lies on a surface: inside its outline, in none of its holes */
export function insideSurface(s: Pick<MapSurface, 'outer' | 'holes'>, p: MapPoint): boolean {
  return insideRing(p, s.outer) && !(s.holes ?? []).some((h) => insideRing(p, h));
}

/**
 * The marking of `kind` fitted to an outline: its smallest turned
 * rectangle, the long side along. Null where the outline fills less than
 * MARKING_FILL of it (an L or a ring: the lines would cross its edge). A
 * runnel follows its outline whatever its shape (a strip, bent or not): its
 * width is the strip's, from its area and its perimeter as a rectangle's
 */
export function fitMarking(kind: MapSurfaceMarkingKind, outer: readonly MapPoint[], holes: readonly MapPoint[][] = [], fill = MARKING_FILL): MapSurfaceMarking | null {
  if (outer.length < 3) return null;
  const r = minAreaRect(outer);
  if (kind === 'runnel') {
    const area = surfaceArea({ outer: outer as MapPoint[] });
    let half = 0;
    for (let k = 0; k < outer.length; k++) half += Math.hypot(outer[(k + 1) % outer.length].x - outer[k].x, outer[(k + 1) % outer.length].y - outer[k].y) / 2;
    const width = (half - Math.sqrt(Math.max(0, half * half - 4 * area))) / 2;
    if (width < 0.1 || width > 1000) return null;
    const along = r.a >= r.b;
    const angle = along ? Math.atan2(r.u.y, r.u.x) : Math.atan2(r.u.x, -r.u.y);
    return { kind, x: round(r.c.x), y: round(r.c.y), angle: Math.round(angle * 1e4) / 1e4, length: round(Math.max(width, half - width)), width: round(width) };
  }
  if (r.a < 1 || r.b < 1) return null;
  const area = surfaceArea({ outer: outer as MapPoint[], holes: holes as MapPoint[][] });
  if (area < fill * r.a * r.b) return null;
  const along = r.a >= r.b;
  const angle = along ? Math.atan2(r.u.y, r.u.x) : Math.atan2(r.u.x, -r.u.y);
  return { kind, x: round(r.c.x), y: round(r.c.y), angle: Math.round(angle * 1e4) / 1e4, length: round(Math.max(r.a, r.b)), width: round(Math.min(r.a, r.b)) };
}

const round = (v: number) => Math.round(v * 100) / 100;

/** A new surface id not in the list */
export function newSurfaceId(surfaces: readonly MapSurface[], stem = 'surface'): string {
  const ids = new Set(surfaces.map((s) => s.id));
  for (let n = 1; ; n++) {
    const id = `${stem}-${n}`;
    if (!ids.has(id)) return id;
  }
}

/** The materials the surfaces draw, each once in the order they first come (the renderer's texture layers) */
export function surfaceMaterials(surfaces: readonly MapSurface[]): string[] {
  return [...new Set(surfaces.map((s) => s.material))];
}

/**
 * What is wrong with one surface, in words (empty when fine); a surface with
 * a problem is left out on reading (map-repair.ts), an unknown marking only
 * loses its lines
 */
export function surfaceProblems(s: unknown): MapText[] {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return [{ key: 'notObject', v: { what: { kind: 'surface' } } }];
  const f = s as MapSurface;
  const of: MapThing = { kind: 'surface', id: String(f.id) };
  const p: MapText[] = [];
  if (typeof f.id !== 'string' || !f.id) p.push({ key: 'noId', v: { what: { kind: 'surface' } } });
  if (typeof f.material !== 'string' || !f.material) p.push({ key: 'noMaterial', v: { what: of } });
  if (!ringOk(f.outer)) p.push({ key: 'outline', v: { what: of, max: MAX_SURFACE_POINTS } });
  if (f.holes !== undefined && (!Array.isArray(f.holes) || f.holes.length > MAX_SURFACE_HOLES || !f.holes.every(ringOk))) {
    p.push({ key: 'holes', v: { what: 'holes', max: MAX_SURFACE_HOLES, points: MAX_SURFACE_POINTS }, of });
  }
  if (f.group !== undefined && typeof f.group !== 'string') p.push({ key: 'id', v: { what: 'group' }, of });
  if (f.marking !== undefined) p.push(...markingProblems(f.marking).map((t) => ({ ...t, of })));
  return p;
}

/** What is wrong with a marking (empty when fine) */
export function markingProblems(m: unknown): MapText[] {
  if (!m || typeof m !== 'object') return [{ key: 'notObject', v: { what: { kind: 'marking' } } }];
  const k = m as MapSurfaceMarking;
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (!MAP_SURFACE_MARKINGS.includes(k.kind)) return [{ key: 'unknown', v: { what: 'marking', value: String(k.kind) } }];
  if (![k.x, k.y, k.angle].every(finite)) return [{ key: 'markingMiddle' }];
  if (!finite(k.length) || !finite(k.width) || k.length <= 0 || k.width <= 0 || k.length > 1000 || k.width > 1000) {
    return [{ key: 'markingSize' }];
  }
  if (k.water !== undefined && (!finite(k.water) || k.water < 0 || k.water > k.width)) return [{ key: 'markingSize' }];
  return [];
}

/**
 * The outline of a strip `half` metres either side of a line (a runnel's
 * shells): along its left side, back along its right, square at the ends.
 * A corner's outer side is mitred, at most twice `half` out, so a sharp turn
 * does not throw a spike; null for a line shorter than a point
 */
export function stripOutline(line: readonly MapPoint[], half: number): MapPoint[] | null {
  const pts = line.filter((p, k) => k === 0 || Math.hypot(p.x - line[k - 1].x, p.y - line[k - 1].y) > 1e-3);
  if (pts.length < 2) return null;
  const left: MapPoint[] = [];
  const right: MapPoint[] = [];
  const dir = (a: MapPoint, b: MapPoint) => {
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  };
  for (let k = 0; k < pts.length; k++) {
    const din = dir(pts[Math.max(0, k - 1)], pts[Math.max(1, k)]);
    const dout = dir(pts[Math.min(pts.length - 2, k)], pts[Math.min(pts.length - 1, k + 1)]);
    // The corner's bisector across the line, scaled so both sides keep their distance (the mitre)
    let nx = -(din.y + dout.y);
    let ny = din.x + dout.x;
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    const cos = nx * -dout.y + ny * dout.x;
    const reach = half / Math.max(cos, 0.5);
    const p = pts[k];
    left.push({ x: p.x + nx * reach, y: p.y + ny * reach });
    right.push({ x: p.x - nx * reach, y: p.y - ny * reach });
  }
  return [...left, ...right.reverse()];
}

function ringOk(ring: unknown): boolean {
  return (
    Array.isArray(ring) &&
    ring.length >= 3 &&
    ring.length <= MAX_SURFACE_POINTS &&
    ring.every((q: MapPoint) => !!q && typeof q.x === 'number' && typeof q.y === 'number' && Number.isFinite(q.x) && Number.isFinite(q.y))
  );
}
