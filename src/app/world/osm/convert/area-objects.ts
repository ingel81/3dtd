/**
 * The objects areas.ts sets on the land-use surfaces of an OSM world:
 * goals, hoops and nets on the pitches, playground devices, parked cars,
 * market stalls, benches and loungers, outdoor seating, graves, allotment
 * plots with their sheds; and the lookups they need.
 */
import type { MapObject, MapPoint, MapSurface, MapSurfaceMarking } from '../../custom-map/map-document';
import type { OsmArea, OsmPoint } from '../osm-parse';
import { centroid, courtOf, insideRing, insideSurface, markingPoint, minAreaRect, parkingRows, signedArea, STALL, surfaceArea } from '../../custom-map/map-surfaces';
import { hashCell } from '../../../map-ops/landscape-noise';
import { pointSegmentDistance } from '../../../map-ops/path-graph';
import { type AreaLook, availableMaterial, PARKED_CARS, PLAYGROUND_DEVICES, PLAYGROUND_SETS } from '../area-tags';
import { round2 } from './geom';

/** Metres a cell of the buildings' index */
const BUILDING_CELL = 40;

/** Most graves a cemetery gets, most plots an allotment area */
const MAX_GRAVES = 500;
const MAX_PLOTS = 120;

/** One surface to lay, before its material is settled */
export interface Planned {
  surface: MapSurface;
  look: AreaLook;
  area: OsmArea;
}

/** The direction (radians from east) a model facing north at turn 0 turns to face from `from` to `to` */
const facing = (from: MapPoint, to: MapPoint) => Math.atan2(-(to.x - from.x), to.y - from.y);

export const at = (p: MapPoint): MapPoint => ({ x: round2(p.x), y: round2(p.y) });

export type Add = (o: Omit<MapObject, 'id'>, source: string, priority: number, reach?: number) => void;

const place = (asset: string, p: MapPoint, rotation: number, scale = 1): Omit<MapObject, 'id'> => ({ asset, x: p.x, y: p.y, z: 0, rotation, scale });

/** A football pitch: goals on the goal lines (a small pitch's small goals), floodlights at the corners of a big one in a sports centre */
export function soccer(m: MapSurfaceMarking, centres: readonly OsmArea[], add: Add): void {
  const court = courtOf(m);
  if (court.length >= 60) goals(m, 'football-goal', 1, add);
  else goals(m, 'goal-small', 1, add);
  const centre = { x: m.x, y: m.y };
  if (court.length < 60 || !centres.some((a) => a.outer.some((r) => insideRing(centre, r)))) return;
  const hl = court.length / 2 + 3;
  const hw = court.width / 2 + 3;
  for (const [u, v] of [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]]) {
    const p = markingPoint(m, u, v);
    add(place('floodlight-mast', p, facing(p, centre)), 'floodlights', 1);
  }
}

/** A goal on each goal line, its mouth to the middle */
export function goals(m: MapSurfaceMarking, asset: string, scale: number, add: Add): void {
  const court = courtOf(m);
  const centre = { x: m.x, y: m.y };
  for (const side of [-1, 1]) {
    const p = markingPoint(m, (side * court.length) / 2, 0);
    add(place(asset, p, facing(p, centre), scale), 'goals', 0);
  }
}

/** A basketball court's hoops, their boards 1.2 m inside the end lines, facing the middle */
export function hoops(m: MapSurfaceMarking, add: Add): void {
  const court = courtOf(m);
  const centre = { x: m.x, y: m.y };
  for (const side of [-1, 1]) {
    const p = markingPoint(m, side * (court.length / 2 - 1.2 * (court.length / 28)), 0);
    add(place('basketball-hoop', p, facing(p, centre)), 'hoops', 0);
  }
}

/** A multi-sport court: small goals on the end lines, hoops behind them, a ball fence along the ends */
export function multi(m: MapSurfaceMarking, add: Add): void {
  goals(m, 'goal-small', 1, add);
  const court = courtOf(m);
  const centre = { x: m.x, y: m.y };
  for (const side of [-1, 1]) {
    const p = markingPoint(m, side * (m.length / 2 - 0.4), 0);
    if (Math.abs(m.length / 2 - court.length / 2) > 0.8) add(place('basketball-hoop', p, facing(p, centre)), 'hoops', 0);
    const a = markingPoint(m, side * (m.length / 2 - 0.3), -m.width / 2 + 0.3);
    const b = markingPoint(m, side * (m.length / 2 - 0.3), m.width / 2 - 0.3);
    line(a, b, 'fence-chainlink', 3.6, add, 'ball fence');
  }
}

/** A net across the middle of the court, its posts on the sidelines (the model's X along them) */
export function net(m: MapSurfaceMarking, asset: string, add: Add): void {
  add(place(asset, { x: m.x, y: m.y }, m.angle + Math.PI / 2), 'nets', 0);
}

/** A fence round the marking's rectangle, 0.3 m inside it */
export function fenceRect(m: MapSurfaceMarking, asset: string, spacing: number, add: Add, source: string): void {
  const l = m.length / 2 - 0.3;
  const w = m.width / 2 - 0.3;
  const corners = [markingPoint(m, -l, -w), markingPoint(m, l, -w), markingPoint(m, l, w), markingPoint(m, -l, w)];
  for (let k = 0; k < 4; k++) line(corners[k], corners[(k + 1) % 4], asset, spacing, add, source);
}

/** Pieces of a fence or hedge along a straight line, each across it (their length along model X) */
export function line(a: MapPoint, b: MapPoint, asset: string, spacing: number, add: Add, source: string, priority = 1): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const count = Math.max(1, Math.round(len / spacing));
  const rotation = Math.atan2(b.y - a.y, b.x - a.x);
  for (let k = 0; k < count; k++) {
    const f = (k + 0.5) / count;
    add(place(asset, { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, rotation), source, priority, spacing / 2);
  }
}

/** Skate ramps facing each other along the park, one in the middle of a small one */
export function skatePark(s: MapSurface, add: Add): void {
  const r = minAreaRect(s.outer);
  const along = r.a >= r.b ? r.u : { x: -r.u.y, y: r.u.x };
  const length = Math.max(r.a, r.b);
  const centre = r.c;
  const ends = length >= 14 ? [-1, 1] : [0];
  for (const e of ends) {
    const p = { x: centre.x + along.x * e * (length / 2 - 3), y: centre.y + along.y * e * (length / 2 - 3) };
    add(place('skate-ramp', p, e === 0 ? facing(p, { x: p.x + along.x, y: p.y + along.y }) : facing(p, centre)), 'skate ramps', 0);
  }
}

/**
 * Spots inside a surface on a jittered grid of `size` metres, at least
 * `margin` from its edge, in an order of their own (the same data gives the
 * same spots)
 */
function spotsIn(s: MapSurface, size: number, margin: number, salt: number): MapPoint[] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of s.outer) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const out: { p: MapPoint; order: number }[] = [];
  const rings = [s.outer, ...(s.holes ?? [])];
  for (let y = minY + size / 2, j = 0; y < maxY; y += size, j++) {
    for (let x = minX + size / 2, i = 0; x < maxX; x += size, i++) {
      const p = { x: x + (hashCell(i, j, salt) - 0.5) * size * 0.5, y: y + (hashCell(i, j, salt + 1) - 0.5) * size * 0.5 };
      if (!insideSurface(s, p)) continue;
      let d = Infinity;
      for (const r of rings) for (let k = 0; k < r.length; k++) d = Math.min(d, pointSegmentDistance(p, r[k], r[(k + 1) % r.length]));
      if (d < margin) continue;
      out.push({ p, order: hashCell(i, j, salt + 2) });
    }
  }
  return out.sort((a, b) => a.order - b.order).map((e) => e.p);
}

/** Benches at the edge of a surface, 1 m inside, facing its middle */
export function benchesAt(s: MapSurface, count: number, salt: number, add: Add, source: string): void {
  const c = centroid(s.outer);
  const ring = s.outer;
  const perimeter = ring.reduce((sum, p, k) => sum + Math.hypot(ring[(k + 1) % ring.length].x - p.x, ring[(k + 1) % ring.length].y - p.y), 0);
  for (let b = 0; b < count; b++) {
    const along = ((b + hashCell(b, 3, salt)) / count) * perimeter;
    const edge = pointOnRing(ring, along);
    const d = Math.hypot(c.x - edge.x, c.y - edge.y) || 1;
    const p = { x: edge.x + ((c.x - edge.x) / d) * 1, y: edge.y + ((c.y - edge.y) / d) * 1 };
    if (insideSurface(s, p)) add(place('bench', p, facing(p, c)), source, 3);
  }
}

/** A playground's devices: those mapped inside it (`devices`: the points with a `playground` tag), else a set by its size; benches at its edge */
export function playground(s: MapSurface, devices: readonly OsmPoint[], salt: number, nearRoute: (p: MapPoint) => boolean, add: Add): void {
  const mapped = devices.filter((q) => insideSurface(s, q));
  const priority = (p: MapPoint) => (nearRoute(p) ? 2 : 4);
  if (mapped.length) {
    for (const q of mapped) {
      const asset = PLAYGROUND_DEVICES[q.tags['playground']];
      if (asset) add(place(asset, q, hashCell(q.id % 1e6, 5, salt) * Math.PI * 2), 'playground', priority(q));
    }
  } else {
    const area = surfaceArea(s);
    const set = [...PLAYGROUND_SETS].reverse().find((e) => area >= e.from)!;
    const spots = spotsIn(s, 6, 2.5, salt);
    const taken: MapPoint[] = [];
    for (const asset of set.devices) {
      const p = spots.find((q) => taken.every((t) => Math.hypot(t.x - q.x, t.y - q.y) >= 5));
      if (!p) break;
      taken.push(p);
      add(place(asset, p, hashCell(Math.round(p.x), Math.round(p.y), salt) * Math.PI * 2), 'playground', priority(p));
    }
  }
  benchesAt(s, Math.min(4, Math.max(1, Math.round(surfaceArea(s) / 400))), salt, add, 'playground benches');
}

/** Cars on 40 to 70 % of a car park's stalls (a share of its own) that lie wholly on it, nose in */
export function parkedCars(s: MapSurface, m: MapSurfaceMarking, salt: number, add: Add): void {
  const fill = 0.4 + 0.3 * salt;
  parkingRows(m).forEach((row, r) => {
    const v = (row.v0 + row.v1) / 2;
    row.stalls.forEach((u, k) => {
      const roll = hashCell(k, r, Math.round(salt * 1e6));
      if (roll >= fill) return;
      // The stall's corners a little inside it: a row along the park's edge has them on its outline
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => markingPoint(m, u + a * (STALL.width / 2 - 0.3), v + b * ((row.v1 - row.v0) / 2 - 0.3)));
      if (!corners.every((q) => insideSurface(s, q))) return;
      const p = markingPoint(m, u, v);
      const back = markingPoint(m, u, v - row.aisle);
      add(place(PARKED_CARS[Math.floor(hashCell(k, r + 99, Math.round(salt * 1e6)) * PARKED_CARS.length)], p, facing(p, back)), 'cars', 6);
    });
  });
}

/** A market square's stalls in two rows along the middle */
export function marketStalls(s: MapSurface, salt: number, add: Add): void {
  const r = minAreaRect(s.outer);
  const along = r.a >= r.b ? r.u : { x: -r.u.y, y: r.u.x };
  const across = { x: -along.y, y: along.x };
  const length = Math.max(r.a, r.b);
  const count = Math.min(8, Math.max(2, Math.floor(length / 7)));
  for (let k = 0; k < count; k++) {
    const u = (k - (count - 1) / 2) * 5;
    for (const side of [-1, 1]) {
      const p = { x: r.c.x + along.x * u + across.x * side * 3, y: r.c.y + along.y * u + across.y * side * 3 };
      if (!insideSurface(s, p)) continue;
      const centre = { x: r.c.x + along.x * u, y: r.c.y + along.y * u };
      add(place(hashCell(k, side + 2, salt) < 0.5 ? 'market-stall-red' : 'market-stall-blue', p, facing(p, centre)), 'market stalls', 4);
    }
  }
}

/** Loungers beside a pool of an open-air bath, along its long sides, facing it */
export function loungers(pool: OsmArea, add: Add): void {
  const ring = pool.outer[0];
  if (!ring || pool.area < 150) return;
  const r = minAreaRect(ring);
  const along = r.a >= r.b ? r.u : { x: -r.u.y, y: r.u.x };
  const across = { x: -along.y, y: along.x };
  const length = Math.max(r.a, r.b);
  const off = Math.min(r.a, r.b) / 2 + 3.5;
  const count = Math.min(12, Math.floor(length / 1.6));
  for (let k = 0; k < count; k++) {
    const u = (k - (count - 1) / 2) * 1.6;
    const p = { x: r.c.x + along.x * u + across.x * off, y: r.c.y + along.y * u + across.y * off };
    add(place('sun-lounger', p, facing(p, { x: p.x - across.x, y: p.y - across.y })), 'loungers', 5);
  }
}

/** Tables with chairs and parasols on an outdoor seating area, a few metres apart */
export function outdoorSeating(e: Planned, add: Add): void {
  const salt = e.area.id % 1e6;
  const spots = spotsIn(e.surface, 3, 1, salt).slice(0, 12);
  spots.forEach((p, k) => {
    add(place('cafe-set', p, hashCell(k, 1, salt) * Math.PI), 'outdoor seating', 5);
    if (k % 2 === 0) add(place('parasol', p, 0), 'outdoor seating', 5);
  });
}

/**
 * A cemetery: two gravel paths across its middle along its rectangle's
 * axes (surfaces of their own, cut to its outline), graves in rows along
 * them, 3 m from the paths and the edge, nearest the middle first, a hedge
 * along its outline
 */
export function cemetery(e: Planned, extra: MapSurface[], add: Add, has: ((id: string) => boolean) | null): void {
  const s = e.surface;
  const r = minAreaRect(s.outer);
  const along = r.a >= r.b ? r.u : { x: -r.u.y, y: r.u.x };
  const angle = Math.atan2(along.y, along.x);
  const length = Math.max(r.a, r.b);
  const width = Math.min(r.a, r.b);
  const m: MapSurfaceMarking = { kind: 'platform', x: r.c.x, y: r.c.y, angle, length, width };
  const gravel = availableMaterial('gravel-light', has);
  const strips = [
    [markingPoint(m, -length / 2 - 1, -1.5), markingPoint(m, length / 2 + 1, -1.5), markingPoint(m, length / 2 + 1, 1.5), markingPoint(m, -length / 2 - 1, 1.5)],
    [markingPoint(m, -1.5, -width / 2 - 1), markingPoint(m, 1.5, -width / 2 - 1), markingPoint(m, 1.5, width / 2 + 1), markingPoint(m, -1.5, width / 2 + 1)],
  ];
  strips.forEach((strip, k) => {
    const cut = clipConvex(s.outer, strip);
    if (cut.length >= 3 && Math.abs(signedArea(cut)) > 20) extra.push({ id: `${s.id}-path-${k + 1}`, material: gravel, outer: cut.map(at), group: s.group });
  });
  // Rows of graves, nearest the middle first
  const spots: { p: MapPoint; d: number }[] = [];
  const rings = [s.outer, ...(s.holes ?? [])];
  for (let v = -width / 2 + 3; v <= width / 2 - 3; v += 3.2) {
    if (Math.abs(v) < 3.2) continue;
    for (let u = -length / 2 + 3; u <= length / 2 - 3; u += 2.6) {
      if (Math.abs(u) < 3) continue;
      const p = markingPoint(m, u, v);
      if (!insideSurface(s, p)) continue;
      let d = Infinity;
      for (const ring of rings) for (let k = 0; k < ring.length; k++) d = Math.min(d, pointSegmentDistance(p, ring[k], ring[(k + 1) % ring.length]));
      if (d < 3) continue;
      spots.push({ p, d: Math.hypot(u, v) });
    }
  }
  spots.sort((a, b) => a.d - b.d);
  for (const { p } of spots.slice(0, MAX_GRAVES)) add(place('graves', p, angle + Math.PI / 2), 'graves', 2);
  // A hedge round it, 0.8 m inside
  const c = centroid(s.outer);
  const inset = s.outer.map((p) => {
    const d = Math.hypot(c.x - p.x, c.y - p.y) || 1;
    return { x: p.x + ((c.x - p.x) / d) * 0.8, y: p.y + ((c.y - p.y) / d) * 0.8 };
  });
  for (let k = 0; k < inset.length; k++) line(inset[k], inset[(k + 1) % inset.length], 'hedge-long', 6, add, 'cemetery hedge', 1);
}

/**
 * Allotments: plots of about 15 x 25 m along the area's rectangle, each with
 * a picket fence on its front and one side, a raised bed in the middle and a
 * shed at the back where OSM maps no hut in it; nearest the middle first
 */
export function allotmentPlots(e: Planned, buildings: BuildingIndex, add: Add): void {
  const s = e.surface;
  const r = minAreaRect(s.outer);
  const along = r.a >= r.b ? r.u : { x: -r.u.y, y: r.u.x };
  const angle = Math.atan2(along.y, along.x);
  const length = Math.max(r.a, r.b);
  const width = Math.min(r.a, r.b);
  const m: MapSurfaceMarking = { kind: 'platform', x: r.c.x, y: r.c.y, angle, length, width };
  const plots: { u: number; v: number; d: number }[] = [];
  const W = 15;
  const D = 25;
  for (let v = -width / 2 + D / 2; v <= width / 2 - D / 2 + 0.01; v += D) {
    for (let u = -length / 2 + W / 2; u <= length / 2 - W / 2 + 0.01; u += W) {
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => markingPoint(m, u + (a * W) / 2, v + (b * D) / 2));
      if (!corners.every((q) => insideSurface(s, q))) continue;
      plots.push({ u, v, d: Math.hypot(u, v) });
    }
  }
  plots.sort((a, b) => a.d - b.d);
  const huts = buildings.near(s.outer).map((b) => centroid(b.outer[0] ?? [])).filter((p) => insideSurface(s, p));
  for (const { u, v } of plots.slice(0, MAX_PLOTS)) {
    const p = (du: number, dv: number) => markingPoint(m, u + du, v + dv);
    line(p(-W / 2, -D / 2), p(W / 2, -D / 2), 'fence-picket', 3.6, add, 'allotment fences', 3);
    line(p(-W / 2, -D / 2), p(-W / 2, D / 2), 'fence-picket', 3.6, add, 'allotment fences', 3);
    add(place('flower-bed', p(0, -2), angle), 'allotment beds', 3);
    const corners = [p(-W / 2, -D / 2), p(W / 2, -D / 2), p(W / 2, D / 2), p(-W / 2, D / 2)];
    if (huts.some((h) => insideRing(h, corners))) continue;
    const shed = p(W / 2 - 3, D / 2 - 3);
    add(place('garden-shed', shed, facing(shed, p(0, 0))), 'allotment sheds', 3);
  }
}

/** The point `along` metres round a ring from its first point */
function pointOnRing(ring: readonly MapPoint[], along: number): MapPoint {
  let left = along;
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k];
    const b = ring[(k + 1) % ring.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= len) return { x: a.x + ((b.x - a.x) * left) / (len || 1), y: a.y + ((b.y - a.y) * left) / (len || 1) };
    left -= len;
  }
  return ring[0];
}

/** A ring cut to a convex polygon (Sutherland-Hodgman); the clip polygon counter-clockwise or clockwise alike */
function clipConvex(subject: readonly MapPoint[], clip: readonly MapPoint[]): MapPoint[] {
  const sign = signedArea(clip) >= 0 ? 1 : -1;
  let out = subject.slice();
  for (let k = 0; k < clip.length && out.length; k++) {
    const a = clip[k];
    const b = clip[(k + 1) % clip.length];
    const side = (p: MapPoint) => sign * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const p = input[i];
      const q = input[(i + 1) % input.length];
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) out.push(p);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
    }
  }
  return out;
}

/** The buildings' footprints by the cells of a coarse grid their boxes touch */
export class BuildingIndex {
  private readonly cells = new Map<number, OsmArea[]>();

  constructor(buildings: readonly OsmArea[]) {
    for (const b of buildings) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const r of b.outer) {
        for (const p of r) {
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
      }
      for (let j = Math.floor(minY / BUILDING_CELL); j <= Math.floor(maxY / BUILDING_CELL); j++) {
        for (let i = Math.floor(minX / BUILDING_CELL); i <= Math.floor(maxX / BUILDING_CELL); i++) {
          const key = i * 65536 + j;
          let list = this.cells.get(key);
          if (!list) this.cells.set(key, (list = []));
          list.push(b);
        }
      }
    }
  }

  /** Whether a point lies in a footprint (inside an outer ring, in none of its holes) */
  holds(p: MapPoint): boolean {
    const list = this.cells.get(Math.floor(p.x / BUILDING_CELL) * 65536 + Math.floor(p.y / BUILDING_CELL));
    return !!list?.some((b) => b.outer.some((r) => insideRing(p, r)) && !b.inner.some((r) => insideRing(p, r)));
  }

  /** The buildings whose cells a ring's box touches */
  near(ring: readonly MapPoint[]): OsmArea[] {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of ring) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const out = new Set<OsmArea>();
    for (let j = Math.floor(minY / BUILDING_CELL); j <= Math.floor(maxY / BUILDING_CELL); j++) {
      for (let i = Math.floor(minX / BUILDING_CELL); i <= Math.floor(maxX / BUILDING_CELL); i++) for (const b of this.cells.get(i * 65536 + j) ?? []) out.add(b);
    }
    return [...out];
  }
}
