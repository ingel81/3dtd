/**
 * The openings of the raised buildings (MapMass.openings,
 * docs/OSM_LANDMARKS_PLAN.md "Durchgänge, gebaut"): where a covered way
 * (a passage, `tunnel=building_passage`, `covered=yes`, a tunnel half under
 * houses, a car park's stub behind its ramp; roads.ts, underground.ts) runs
 * through a building's ground, the building gets an opening there: its
 * walls open over the way's width, the room under it free, the building on
 * over it. Drawn by the mass layer with the building's own walls
 * (render/objects/mass-openings.ts); no model, no portal.
 *
 * Per stretch of a covered way on the ground: a straight line from the wall
 * it enters to the wall it leaves (a car park's: to the end of its stub),
 * as wide as the way (and its bend), as high as its traffic needs and the
 * storeys over it allow; a round arch in a stone building, a lintel
 * elsewhere. A stretch that bends too much or runs along a wall rather than
 * through it stays closed, as before (the report counts it).
 */
import { heightAt } from '../../../map-ops/grid';
import type { CustomMapDocument, MapMass, MapMassOpening, MapPathEdge, MapPoint } from '../../custom-map/map-document';
import { toModel } from '../../custom-map/object-ground';
import { MASS_MAX_OPENINGS, massBodies, ringsContain } from '../../custom-map/object-mass';

/** Clear height of a passage by what runs through it, m: carriageways, pedestrian streets, footways */
const DRIVE_HEIGHT = 3.8;
const STREET_HEIGHT = 3.4;
const FOOT_HEIGHT = 2.9;
/** A car park's entrance: clear height over its floor at the wall, m */
const GARAGE_HEIGHT = 2.4;
/** Ways cars drive through (OSM `highway`) */
const DRIVES = new Set(['service', 'residential', 'living_street', 'unclassified', 'tertiary', 'secondary', 'primary', 'track', 'road']);
/** Lowest opening worth cutting, m; an arch's springing at least, m */
const LEAST_HEIGHT = 2.2;
const LEAST_SPRING = 1.9;
/** Metres the building keeps over an opening's top below its lowest eaves there (the lintel, a storey's floor) */
const OVER = 1.2;
/** An opening reaches its ground floor's height this many times over its plinth at most (a carriageway's lintel under the first floor's sills) */
const GROUND_REACH = 1.15;
/** A stone gateway: its width at least, its arch springing this high as room allows, m */
const GATE_WIDTH = 3.6;
const GATE_SPRING = 2.6;
/** Metres a way reaches past its door on the wall: OSM puts a passage's ends on the wall or a little in */
const PAST_DOOR = 1.5;
/** Widest bend in a stretch the opening widens over, m; more and it stays closed */
const BEND_MAX = 1.5;
/** A stretch that meets a wall flatter than this (sine of the angle) runs along it, not through */
const CROSS_LEAST = 0.5;
/** Widest opening, m */
const WIDTH_MAX = 12;

export interface OpeningReport {
  passages: number;
  arches: number;
  garages: number;
  /** Stretches under a building that stay closed: a bend, a way along a wall, no room under the eaves */
  closed: number;
}

/** A covered way as one line: its points (map), its width and street, whether each end is blind (no way goes on from it) */
interface CoveredWay {
  points: MapPoint[];
  width: number;
  street: string;
  blind0: boolean;
  blind1: boolean;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** The map's covered ways joined into lines where two meet end to end, each end reaching PAST_DOOR beyond a door */
export class CoveredWays {
  readonly ways: CoveredWay[] = [];

  constructor(doc: Pick<CustomMapDocument, 'paths'>) {
    const nodes = new Map(doc.paths.nodes.map((n) => [n.id, n]));
    const degree = new Map<string, number>();
    const coveredAt = new Map<string, MapPathEdge[]>();
    for (const e of doc.paths.edges) {
      for (const id of [e.a, e.b]) degree.set(id, (degree.get(id) ?? 0) + 1);
      if (!e.covered) continue;
      for (const id of [e.a, e.b]) {
        const list = coveredAt.get(id);
        if (list) list.push(e);
        else coveredAt.set(id, [e]);
      }
    }
    const done = new Set<MapPathEdge>();
    const line = (e: MapPathEdge, from: string): MapPoint[] => {
      const pts = [nodes.get(e.a)!, ...(e.via ?? []), nodes.get(e.b)!].map((p) => ({ x: p.x, y: p.y }));
      return from === e.a ? pts : pts.reverse();
    };
    for (const e of doc.paths.edges) {
      if (!e.covered || done.has(e) || !nodes.has(e.a) || !nodes.has(e.b)) continue;
      done.add(e);
      // Walk on from both ends while exactly one other covered edge of the same width goes on
      let points = line(e, e.a);
      let head = e.a;
      let tail = e.b;
      const grow = (end: string, atTail: boolean): string => {
        for (;;) {
          const next = (coveredAt.get(end) ?? []).filter((n) => n !== e && !done.has(n) && n.width === e.width);
          if (next.length !== 1 || (coveredAt.get(end) ?? []).length !== 2) return end;
          const n = next[0];
          if (!nodes.has(n.a) || !nodes.has(n.b)) return end;
          done.add(n);
          const more = line(n, end);
          points = atTail ? [...points, ...more.slice(1)] : [...more.reverse().slice(0, -1), ...points];
          end = n.a === end ? n.b : n.a;
        }
      };
      tail = grow(tail, true);
      head = grow(head, false);
      const blind0 = (degree.get(head) ?? 0) <= 1;
      const blind1 = (degree.get(tail) ?? 0) <= 1;
      // On through its doors: the stretch under the building begins outside the wall
      if (!blind0) points = [reach(points[0], points[1], PAST_DOOR), ...points];
      if (!blind1) points = [...points, reach(points[points.length - 1], points[points.length - 2], PAST_DOOR)];
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      this.ways.push({ points, width: e.width, street: e.street ?? '', blind0, blind1, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) });
    }
  }

  /** The ways that come within `r` of (x, y) */
  near(x: number, y: number, r: number): CoveredWay[] {
    return this.ways.filter((w) => w.minX - r <= x && w.maxX + r >= x && w.minY - r <= y && w.maxY + r >= y);
  }

  /**
   * Whether a covered way runs through the footprint (`outer` less `holes`,
   * map points): it is raised from its outline then, no catalogue model, so
   * its walls can open (one way to build, decision 1)
   */
  through(outer: readonly MapPoint[], holes: readonly (readonly MapPoint[])[]): boolean {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const q of outer) {
      minX = Math.min(minX, q.x);
      maxX = Math.max(maxX, q.x);
      minY = Math.min(minY, q.y);
      maxY = Math.max(maxY, q.y);
    }
    const ways = this.ways.filter((w) => w.minX <= maxX && w.maxX >= minX && w.minY <= maxY && w.maxY >= minY);
    if (!ways.length) return false;
    const rings = [outer, ...holes].map((r) => r.flatMap((q) => [q.x, q.y]));
    return ways.some((w) => stretches(w.points.map((q) => [q.x, q.y] as const), rings).some((s) => lineLength(s.points) >= 0.8));
  }
}

function lineLength(points: readonly (readonly [number, number])[]): number {
  let s = 0;
  for (let k = 1; k < points.length; k++) s += Math.hypot(points[k][0] - points[k - 1][0], points[k][1] - points[k - 1][1]);
  return s;
}

/** `p` moved `d` on away from `q` */
function reach(p: MapPoint, q: MapPoint, d: number): MapPoint {
  const l = Math.hypot(p.x - q.x, p.y - q.y) || 1;
  return { x: p.x + ((p.x - q.x) / l) * d, y: p.y + ((p.y - q.y) / l) * d };
}

/** Where a raised building stands: its origin on the map, its turn and scale */
export interface OpeningFrame {
  x: number;
  y: number;
  rotation: number;
  scale: number;
}

/**
 * The openings of raised building `mass` standing at `frame` where the
 * covered `ways` run through its ground, a car park's floor on the seat
 * until garageFloors sets it. Counts into `report`
 */
export function massOpenings(mass: MapMass, frame: OpeningFrame, ways: CoveredWays, report: OpeningReport): MapMassOpening[] {
  const scale = frame.scale || 1;
  const cos = Math.cos(frame.rotation);
  const sin = Math.sin(frame.rotation);
  const r = Math.max(...mass.rings[0].map((v) => Math.abs(v))) * Math.SQRT2 * scale + 2;
  const out: MapMassOpening[] = [];
  for (const way of ways.near(frame.x, frame.y, r)) {
    // The way in the building's frame at scale 1
    const pts = way.points.map((p) => {
      const m = toModel(p.x - frame.x, p.y - frame.y, cos, sin);
      return { x: m.x / scale, z: m.z / scale, map: p };
    });
    for (const st of stretches(pts.map((p) => [p.x, p.z] as const), mass.rings)) {
      if (out.length >= MASS_MAX_OPENINGS) break;
      const blindStart = st.s0 === 0 && way.blind0;
      const blindEnd = st.end && way.blind1;
      const a = st.points[0];
      const b = st.points[st.points.length - 1];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 0.8) continue;
      // Straight from wall to wall, as wide as the way and its bend
      let bend = 0;
      for (const p of st.points) bend = Math.max(bend, lineDistance(p, a, b));
      const across = (k: number) => k < 0 || wallSine(mass.rings, a, b, k) >= CROSS_LEAST;
      if (bend > BEND_MAX || !across(st.wall0) || !across(st.wall1)) {
        report.closed++;
        continue;
      }
      const garage = blindEnd && !blindStart && way.street === 'service' && length <= 3.5;
      const width = Math.min(WIDTH_MAX, way.width + 0.5 + 2 * bend);
      // Its line: a metre out past each wall it crosses, to its end where it ends inside
      const dx = (b[0] - a[0]) / length;
      const dz = (b[1] - a[1]) / length;
      const out0 = blindStart ? 0 : 1;
      const out1 = blindEnd ? 0 : 1;
      const line: [number, number, number, number] = [round2(a[0] - dx * out0), round2(a[1] - dz * out0), round2(b[0] + dx * out1), round2(b[1] + dz * out1)];
      // Room under the eaves of the lowest part on the ground it passes under, and in its ground floor (a little more)
      const low = lowestBody(mass, a, b);
      const storey = Math.max(2.4, (low.height - 1) / Math.max(1, low.floors));
      const room = Math.min(low.height - OVER, Math.max(FOOT_HEIGHT, 0.5 + storey * GROUND_REACH));
      let opening: MapMassOpening | null;
      if (garage) {
        // Its floor on the ground for now: where the ramp meets the wall, under the seat once it stands (garageFloors)
        opening = room >= GARAGE_HEIGHT ? { line, width: round2(width), height: GARAGE_HEIGHT, kind: 'garage', head: 'flat', floor: 0 } : null;
      } else {
        const wanted = DRIVES.has(way.street) ? DRIVE_HEIGHT : way.street === 'pedestrian' ? STREET_HEIGHT : FOOT_HEIGHT;
        // A stone building takes a round arch, a gateway's width at least, its springing GATE_SPRING up as room allows; else a lintel
        const stone = stoneAt(mass, a, b);
        const gate = Math.min(WIDTH_MAX, Math.max(width, GATE_WIDTH));
        const crown = Math.min(Math.max(wanted, gate / 2 + GATE_SPRING), room);
        const arch = stone && crown - gate / 2 >= LEAST_SPRING;
        const height = arch ? crown : Math.min(wanted, room);
        const wide = arch ? gate : width;
        opening = height >= LEAST_HEIGHT ? { line, width: round2(wide), height: round2(height), kind: 'passage', head: arch ? 'arch' : 'flat' } : null;
      }
      if (!opening) {
        report.closed++;
        continue;
      }
      // Two ways along the same line (a path and its steps): one opening, as wide as the wider
      const twin = out.find((o) => Math.hypot(o.line[0] - line[0], o.line[1] - line[1]) + Math.hypot(o.line[2] - line[2], o.line[3] - line[3]) < 2);
      if (twin) {
        twin.width = Math.max(twin.width, opening.width);
        continue;
      }
      out.push(opening);
      if (opening.kind === 'garage') report.garages++;
      else {
        report.passages++;
        if (opening.head === 'arch') report.arches++;
      }
    }
  }
  return out;
}

/**
 * The floors of a raised building's car park entrances, once it is seated
 * (`seat`, scene height; its ramps' cuttings do not count, object-mass.ts
 * massOnRamp): the ground where each ramp meets the wall, under the seat;
 * its top GARAGE_HEIGHT over it
 */
export function garageFloors(openings: readonly MapMassOpening[], frame: OpeningFrame, ground: CustomMapDocument['terrain'], seat: number): void {
  const scale = frame.scale || 1;
  const cos = Math.cos(frame.rotation);
  const sin = Math.sin(frame.rotation);
  for (const o of openings) {
    if (o.kind !== 'garage') continue;
    // The line starts a metre before the wall
    const [ax, az, bx, bz] = o.line;
    const l = Math.hypot(bx - ax, bz - az) || 1;
    const wall = pointOnMap(frame, [ax + (bx - ax) / l, az + (bz - az) / l], cos, sin, scale);
    const floor = Math.min(0, Math.max(-6, heightAt(ground, wall.x, wall.y) - seat));
    o.floor = round2(floor);
    o.height = round2(floor + GARAGE_HEIGHT);
  }
}

/** A stretch of a line on the ground: its points from where it enters to where it leaves or ends, the walls it crosses there (-1 none) */
interface Stretch {
  points: (readonly [number, number])[];
  s0: number;
  end: boolean;
  wall0: number;
  wall1: number;
}

/** The stretches of polyline `pts` (model x, z) on the ground of `rings`, between its crossings with their walls */
export function stretches(pts: readonly (readonly [number, number])[], rings: readonly (readonly number[])[]): Stretch[] {
  // Every crossing: along the line (segment k plus its share), and the wall's index over all rings
  const marks: { k: number; t: number; wall: number }[] = [];
  for (let k = 1; k < pts.length; k++) {
    const [ax, az] = pts[k - 1];
    const [bx, bz] = pts[k];
    let wall = 0;
    for (const r of rings) {
      for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2, wall++) {
        const hit = segmentHit(ax, az, bx, bz, r[j], r[j + 1], r[i], r[i + 1]);
        if (hit !== null) marks.push({ k, t: hit, wall });
      }
    }
  }
  marks.sort((p, q) => p.k - q.k || p.t - q.t);
  const at = (k: number, t: number): readonly [number, number] => [pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * t, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * t];
  const bounds = [{ k: 1, t: 0, wall: -1 }, ...marks, { k: pts.length - 1, t: 1, wall: -1 }];
  const out: Stretch[] = [];
  for (let n = 1; n < bounds.length; n++) {
    const p = bounds[n - 1];
    const q = bounds[n];
    const points: (readonly [number, number])[] = [at(p.k, p.t)];
    for (let k = p.k; k < q.k; k++) points.push(pts[k]);
    points.push(at(q.k, q.t));
    // Inside: the middle of its first piece of any length on the ground
    let piece = 1;
    while (piece < points.length - 1 && Math.hypot(points[piece][0] - points[piece - 1][0], points[piece][1] - points[piece - 1][1]) < 1e-3) piece++;
    const a = points[piece - 1];
    const b = points[piece];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-3) continue;
    if (!ringsContain(rings, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) continue;
    out.push({ points, s0: n === 1 ? 0 : 1, end: n === bounds.length - 1, wall0: p.wall, wall1: q.wall });
  }
  return out;
}

/** Where segment a-b crosses segment c-d: the share along a-b; null where they do not */
function segmentHit(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number | null {
  const rx = bx - ax;
  const rz = bz - az;
  const sx = dx - cx;
  const sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((cx - ax) * sz - (cz - az) * sx) / den;
  const u = ((cx - ax) * rz - (cz - az) * rx) / den;
  return t > 0 && t <= 1 && u >= 0 && u < 1 ? t : null;
}

/** Sine of the angle between line a-b and wall `k` (its index over all rings) */
function wallSine(rings: readonly (readonly number[])[], a: readonly [number, number], b: readonly [number, number], k: number): number {
  let wall = 0;
  for (const r of rings) {
    const n = r.length / 2;
    if (k < wall + n) {
      const i = (k - wall) * 2;
      const j = i === 0 ? r.length - 2 : i - 2;
      const wx = r[i] - r[j];
      const wz = r[i + 1] - r[j + 1];
      const lx = b[0] - a[0];
      const lz = b[1] - a[1];
      return Math.abs(wx * lz - wz * lx) / ((Math.hypot(wx, wz) || 1) * (Math.hypot(lx, lz) || 1));
    }
    wall += n;
  }
  return 1;
}

/** Distance from `p` to the line through a and b */
function lineDistance(p: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): number {
  const lx = b[0] - a[0];
  const lz = b[1] - a[1];
  const l = Math.hypot(lx, lz) || 1;
  return Math.abs((p[0] - a[0]) * lz - (p[1] - a[1]) * lx) / l;
}

/** The part standing on the ground over the line a-b with the lowest eaves (the building itself without parts): its eaves and storeys */
function lowestBody(mass: MapMass, a: readonly [number, number], b: readonly [number, number]): { height: number; floors: number } {
  const bodies = massBodies(mass).filter((p) => (p.base ?? 0) <= 0.5);
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const steps = Math.max(2, Math.ceil(length));
  let low: { height: number; floors: number } = { height: mass.height, floors: mass.floors };
  let found = false;
  for (let s = 0; s <= steps; s++) {
    const x = a[0] + ((b[0] - a[0]) * s) / steps;
    const z = a[1] + ((b[1] - a[1]) * s) / steps;
    for (const p of bodies) {
      if (!ringsContain(p.rings, x, z) || (found && p.height >= low.height)) continue;
      low = { height: p.height, floors: p.floors };
      found = true;
    }
  }
  return low;
}

/** Whether the walls the line a-b passes through are stone (the part over its middle, else the building's) */
function stoneAt(mass: MapMass, a: readonly [number, number], b: readonly [number, number]): boolean {
  const x = (a[0] + b[0]) / 2;
  const z = (a[1] + b[1]) / 2;
  const over = massBodies(mass).find((p) => (p.base ?? 0) <= 0.5 && ringsContain(p.rings, x, z));
  return (over?.facade ?? mass.facade) === 'stone';
}

/** Model point (x, z) at scale 1 on the map */
function pointOnMap(frame: OpeningFrame, p: readonly [number, number], cos: number, sin: number, scale: number): MapPoint {
  const x = p[0] * scale;
  const z = p[1] * scale;
  return { x: frame.x - (x * cos + z * sin), y: frame.y - x * sin + z * cos };
}

const round2 = (v: number) => Math.round(v * 100) / 100;
