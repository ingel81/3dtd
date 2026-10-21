/**
 * Sloped roofs of raised buildings over any outline (docs/OSM_LANDMARKS_PLAN.md
 * L4): one model per body (a building or one of its parts, object-mass.ts
 * massBodies) that the map's rules read heights from and the mass layer
 * draws (render/objects/mass-layer.ts). Pure, in the body's own frame at
 * scale 1 (model x, z), heights as the rise over the eaves.
 *
 * - `gable`, `hip`, `halfhip`, `mansard`: the straight skeleton of the
 *   outline and its courtyards (roof-skeleton.ts), every slope as steep as
 *   the others, so each wing has its ridge along it and valleys and hips
 *   come where wings meet. Walls another building or part stands against
 *   (`shared`) stand still: no slope rises from them, the slopes beside run
 *   on up to them and an upright gable fills the rest (a party wall, a wing
 *   against its corner tower). For a gable roof the wings' ends stand still
 *   too (a wall between a wing's two long sides, found on a first run): the
 *   ridge runs out to them, also over a skewed end; a half-hip (Krüppelwalm)
 *   keeps a small hip over the gable's top. A mansard is the hip roof cut
 *   off flat where its steep slopes have run their way in. A rectangle's
 *   ridge may run across it (`roofAcross`, OSM `roof:orientation=across`):
 *   gables on its long sides.
 * - `skillion`: one slope over the whole outline, down towards
 *   `roofDirection`; the walls follow it up.
 *
 * The roof reaches past the walls (eaves, verges) in the planes of its
 * slopes; where the outline is too tight for that, flush with them.
 */
import type { MapMassRoof } from './map-document';
import { cleanedRings, cleanedWalls, straightSkeleton, type Skeleton } from './roof-skeleton';

/** How far a sloped roof reaches past the walls, m */
export const ROOF_EAVES = 0.4;
/** A mansard's steep slopes run in at most this far from the walls, m */
export const MANSARD_RUN = 4;
/** A half-hip's gable reaches up this share of the roof's rise, the hip the rest */
const HALF_HIP_CUT = 0.62;
/** A wing's two long sides at least this near to back to back for its end to stand as a gable (cos 32°) */
const GABLE_SIDES = 0.85;

/** What a body's roof is made from: its rings, its roof and the roof's measures */
export interface RoofBody {
  rings: number[][];
  roof: MapMassRoof;
  ridge?: number;
  /** A skillion's way down (radians from model +x towards +z); a gable's ridge across its rectangle */
  roofDirection?: number;
  roofAcross?: boolean;
  /** Walls of the outline another building or part stands against (MapMass.shared) */
  shared?: number[];
}

/** A plane of the roof: rise over the eaves = px x + pz z + p0 */
export interface RoofPlaneFit {
  px: number;
  pz: number;
  p0: number;
}

/** A face of the roof on the ground (no eaves) and its plane: what heights are read from */
export interface RoofFace extends RoofPlaneFit {
  /** Its outline (and holes), x, z pairs */
  rings: number[][];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** A face as drawn: its outline with the eaves, its plane, the way along its eaves (unit); a flat one's texture in x, z */
export interface RoofPolygon extends RoofPlaneFit {
  rings: number[][];
  ux: number;
  uz: number;
  flat: boolean;
}

/**
 * An upright wall over the eaves (a gable, a half-hip's trapezoid): on the
 * line from a to b, its top as a chain from a to b of (metres from a, rise)
 */
export interface RoofGable {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  top: number[];
}

export interface RoofModel {
  faces: RoofFace[];
  polygons: RoofPolygon[];
  gables: RoofGable[];
  /** The walls' tops follow this plane (a skillion's), else they stand at the eaves */
  walls?: RoofPlaneFit;
  /** Highest rise over the eaves */
  top: number;
}

const models = new WeakMap<number[][], Map<string, RoofModel | null>>();

/** The roof model of a sloped roof (gable, hip, half-hip, mansard, skillion) with a ridge; null for any other or where none can be made (the roof is then flat). Worked out once per rings and roof */
export function roofModel(body: RoofBody): RoofModel | null {
  const { roof } = body;
  const ridge = body.ridge ?? 0;
  if (!(ridge > 0) || (roof !== 'gable' && roof !== 'hip' && roof !== 'halfhip' && roof !== 'mansard' && roof !== 'skillion')) return null;
  let byRoof = models.get(body.rings);
  if (!byRoof) models.set(body.rings, (byRoof = new Map()));
  const key = `${roof}|${ridge}|${body.roofDirection ?? ''}|${body.roofAcross ? 1 : 0}|${body.shared?.join(',') ?? ''}`;
  const cached = byRoof.get(key);
  if (cached !== undefined) return cached;
  let model: RoofModel | null;
  // A lean-to round a courtyard slopes down to it from every outer wall (a cloister's walk), else one way
  if (roof === 'skillion') model = body.rings.length > 1 ? skeletonModel(body, ridge) : skillionModel(body.rings, ridge, body.roofDirection ?? Math.PI / 2);
  else if (roof === 'gable' && body.roofAcross && body.rings.length === 1 && rectAxes(body.rings[0])) model = acrossModel(body.rings[0], ridge);
  else model = skeletonModel(body, ridge);
  byRoof.set(key, model);
  return model;
}

/** The rise of the roof over the eaves at (x, z): of the face that holds the point; null off the roof */
export function roofRiseAt(model: RoofModel, x: number, z: number): number | null {
  for (const f of model.faces) {
    if (x < f.minX || x > f.maxX || z < f.minZ || z > f.maxZ || !inRings(f.rings, x, z)) continue;
    return Math.max(0, f.px * x + f.pz * z + f.p0);
  }
  return null;
}

/** Triangles the model draws: its polygons' and its gables' (each piece of a gable two) */
export function roofTriangles(model: RoofModel): number {
  let n = 0;
  for (const p of model.polygons) {
    const corners = p.rings.reduce((s, r) => s + r.length / 2, 0);
    n += corners - 2 + 2 * (p.rings.length - 1);
  }
  for (const g of model.gables) n += gableIsTriangle(g) ? 2 : (g.top.length / 2 - 1) * 4;
  return n;
}

/** Whether a gable is one triangle (its top a point between two feet on the eaves): one wall piece drawn in to its top */
export function gableIsTriangle(g: RoofGable): boolean {
  return g.top.length === 6 && g.top[1] === 0 && g.top[5] === 0;
}

/** How far a mansard's steep slopes run in: a share of the outline's mean half width, at most MANSARD_RUN */
export function mansardRun(rings: readonly (readonly number[])[]): number {
  let perimeter = 0;
  let area = 0;
  rings.forEach((r, k) => {
    const n = r.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const dx = r[2 * i] - r[2 * j];
      const dz = r[2 * i + 1] - r[2 * j + 1];
      perimeter += Math.sqrt(dx * dx + dz * dz);
    }
    area += (k === 0 ? 1 : -1) * Math.abs(area2(r) / 2);
  });
  return Math.min(MANSARD_RUN, (0.8 * Math.max(area, 0)) / Math.max(perimeter, 1e-6));
}

function area2(ring: readonly number[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) a += ring[j] * ring[i + 1] - ring[i] * ring[j + 1];
  return a;
}

/** Even-odd over rings */
function inRings(rings: readonly (readonly number[])[], x: number, z: number): boolean {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const zi = r[i + 1];
      const zj = r[j + 1];
      if (zi > z !== zj > z && x < r[i] + ((z - zi) / (zj - zi)) * (r[j] - r[i])) inside = !inside;
    }
  }
  return inside;
}

function face(rings: number[][], plane: RoofPlaneFit): RoofFace {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const r = rings[0];
  for (let i = 0; i < r.length; i += 2) {
    minX = Math.min(minX, r[i]);
    maxX = Math.max(maxX, r[i]);
    minZ = Math.min(minZ, r[i + 1]);
    maxZ = Math.max(maxZ, r[i + 1]);
  }
  const e = 1e-6;
  return { rings, ...plane, minX: minX - e, maxX: maxX + e, minZ: minZ - e, maxZ: maxZ + e };
}

/** A point of a face as the roof builds it: where, how far in from its wall's line, the ring corner it is and the wall standing still it lies on (-1 none) */
interface FacePoint {
  x: number;
  z: number;
  t: number;
  corner: number;
  gable: number;
}

/**
 * The skeleton a sloped roof stands on: the walls other buildings stand
 * against (`shared`, indices of the outline's walls) standing still, and for
 * a gable or a half-hip the wings' ends too (wingEnds: found on a first run
 * with them moving). Null where none can be made
 */
function roofSkeleton(body: RoofBody): { sk: Skeleton; ends: ReadonlySet<number>; shared: ReadonlySet<number> } | null {
  const clean = cleanedRings(body.rings);
  if (!clean) return null;
  // A lean-to round a courtyard: every outer wall stands, the slopes run from the courtyard up to them
  const outer = body.roof === 'skillion' ? Array.from({ length: clean.rings[0].length / 2 }, (_, i) => i) : [];
  const shared = [...new Set([...cleanedWalls(body.rings, clean, 0, body.shared ?? []), ...outer])].sort((a, b) => a - b);
  // Walls standing against others: at most all but one (a roof needs a slope)
  let sk = straightSkeleton(body.rings, shared);
  let standing = shared;
  if (!sk && shared.length) {
    sk = straightSkeleton(body.rings);
    standing = [];
  }
  if (!sk) return null;
  if (body.roof === 'gable' || body.roof === 'halfhip') {
    const ends = wingEnds(sk);
    if (ends.length) {
      const both = [...new Set([...standing, ...ends])].sort((a, b) => a - b);
      const gabled = straightSkeleton(body.rings, both);
      if (gabled) return { sk: gabled, ends: new Set(ends), shared: new Set(standing) };
    }
  }
  return { sk, ends: new Set(), shared: new Set(standing) };
}

/**
 * The walls a wing ends in: a moving wall whose face is three-cornered (the
 * wall and one node), its node linked to one more node off the rings (the
 * ridge), between two moving walls nearly back to back (the wing's long sides)
 */
function wingEnds(sk: Skeleton): number[] {
  const corners = sk.rings.reduce((s, r) => s + r.length / 2, 0);
  const out: number[] = [];
  for (let e = 0; e < sk.edges.length; e++) {
    const E = sk.edges[e];
    const f = sk.faces[e];
    if (E.still || f.length !== 3 || f[2] < corners) continue;
    const around = sk.links[f[2]];
    if (around.length !== 3 || !around.some((k) => k !== f[0] && k !== f[1] && k >= corners)) continue;
    const ringStart = e - E.i;
    const count = sk.rings[E.ring].length / 2;
    const P = sk.edges[ringStart + ((E.i + count - 1) % count)];
    const N = sk.edges[ringStart + ((E.i + 1) % count)];
    if (P.still || N.still || P.dx * N.dx + P.dz * N.dz > -GABLE_SIDES) continue;
    out.push(e);
  }
  return out;
}

/**
 * Gable, hip, half-hip and mansard over the skeleton of the rings (with the
 * walls standing still that other buildings stand against, and a gable's
 * wing ends): the slope the ridge over the widest wing makes (a mansard's
 * over its run), the gables over the walls standing still, the eaves and
 * verges past the walls (none past a wall another building stands against)
 */
function skeletonModel(body: RoofBody, ridge: number): RoofModel | null {
  const made = roofSkeleton(body);
  if (!made || made.sk.maxT < 0.05) return null;
  const { sk, ends, shared } = made;
  const { roof } = body;
  const run = slopeRun(sk, roof);
  if (run === null) return null;
  const slope = ridge / run;
  const { edges, nodes } = sk;
  const corners = sk.rings.reduce((s, r) => s + r.length / 2, 0);
  // Which wall standing still each node off the rings lies on
  const onGable = new Map<number, number>();
  sk.chains.forEach((chain, e) => {
    if (!chain) return;
    for (const k of chain.slice(1, -1)) onGable.set(k, e);
  });
  const point = (k: number): FacePoint => ({ x: nodes[3 * k], z: nodes[3 * k + 1], t: nodes[3 * k + 2], corner: k < corners ? k : -1, gable: onGable.get(k) ?? -1 });
  const pts: (FacePoint[] | null)[] = sk.faces.map((f, e) => (edges[e].still ? null : f.map(point)));
  const gables: RoofGable[] = [];
  /** Extra faces: a half-hip's hip over its gable */
  const hips: { pts: FacePoint[]; plane: RoofPlaneFit }[] = [];
  for (let e = 0; e < edges.length; e++) {
    const E = edges[e];
    const chain = sk.chains[e];
    if (!E.still || !chain) continue;
    const top = chain.flatMap((k) => [(nodes[3 * k] - E.ax) * E.dx + (nodes[3 * k + 1] - E.az) * E.dz, Math.min(ridge, slope * nodes[3 * k + 2])]);
    top[0] = 0;
    top[top.length - 2] = E.len;
    if (roof === 'halfhip' && ends.has(e) && chain.length === 3) {
      const cap = halfHip(sk, e, chain[1], slope, pts);
      if (cap) {
        hips.push(cap.hip);
        gables.push({ ax: E.ax, az: E.az, bx: E.bx, bz: E.bz, top: cap.top });
        continue;
      }
    }
    if (top.some((v, i) => i % 2 === 1 && v > 0.02)) gables.push({ ax: E.ax, az: E.az, bx: E.bx, bz: E.bz, top });
  }
  // The eaves: each corner of the rings out where its two walls' lines, moved out, cross (a shared wall's not)
  const reach = edges.map((E, e) => (shared.has(e) ? 0 : ROOF_EAVES));
  const eaves = movedOut(sk, reach);
  const faces: RoofFace[] = [];
  const polygons: RoofPolygon[] = [];
  const cap = roof === 'mansard' ? run : Infinity;
  for (let e = 0; e < edges.length; e++) {
    const fp = pts[e];
    if (!fp) continue;
    const E = edges[e];
    const plane = { px: slope * E.nx, pz: slope * E.nz, p0: -slope * (E.ax * E.nx + E.az * E.nz) };
    if (cap === Infinity) {
      faces.push(face([fp.flatMap((q) => [q.x, q.z])], plane));
      polygons.push({ rings: [drawnRing(fp, e, sk, eaves, reach)], ...plane, ux: E.dx, uz: E.dz, flat: false });
      continue;
    }
    // A mansard: the face below its run sloped, above it flat at the ridge
    const below = clipT(fp, E, cap, true);
    const above = clipT(fp, E, cap, false);
    if (below) {
      faces.push(face([below.flatMap((q) => [q.x, q.z])], plane));
      polygons.push({ rings: [drawnRing(below, e, sk, eaves, reach)], ...plane, ux: E.dx, uz: E.dz, flat: false });
    }
    if (above) {
      const flat = { px: 0, pz: 0, p0: ridge };
      faces.push(face([above.flatMap((q) => [q.x, q.z])], flat));
      polygons.push({ rings: [above.flatMap((q) => [q.x, q.z])], ...flat, ux: 1, uz: 0, flat: true });
    }
  }
  for (const h of hips) {
    const ring = h.pts.flatMap((q) => [q.x, q.z]);
    faces.push(face([ring], h.plane));
    const len = Math.sqrt((h.pts[1].x - h.pts[0].x) ** 2 + (h.pts[1].z - h.pts[0].z) ** 2) || 1;
    polygons.push({ rings: [ring], ...h.plane, ux: (h.pts[1].x - h.pts[0].x) / len, uz: (h.pts[1].z - h.pts[0].z) / len, flat: false });
  }
  if (!polygons.length) return null;
  // The highest point: the ridge over the widest wing (a mansard's top)
  return { faces, polygons, gables, top: Math.min(ridge, slope * sk.maxT) };
}

/**
 * A half-hip over the gable on wall e whose top is node m (Krüppelwalm):
 * the gable up to HALF_HIP_CUT of the top's rise, a hip from there to the
 * ridge, run back as far as the slopes run; the faces of the walls before
 * and after it take the hip's foot instead of the top. Null where the ridge
 * is too short for it
 */
function halfHip(sk: Skeleton, e: number, m: number, slope: number, pts: (FacePoint[] | null)[]): { hip: { pts: FacePoint[]; plane: RoofPlaneFit }; top: number[] } | null {
  const E = sk.edges[e];
  const { nodes } = sk;
  const corners = sk.rings.reduce((s, r) => s + r.length / 2, 0);
  const ridge = sk.links[m]?.find((k) => k >= corners);
  if (ridge === undefined) return null;
  const mx = nodes[3 * m];
  const mz = nodes[3 * m + 1];
  const t = nodes[3 * m + 2];
  const rx = nodes[3 * ridge] - mx;
  const rz = nodes[3 * ridge + 1] - mz;
  const room = Math.sqrt(rx * rx + rz * rz);
  if (room < 0.5) return null;
  const c = HALF_HIP_CUT;
  const back = Math.min(room * 0.9, t * (1 - c));
  const hx = mx + (rx / room) * back;
  const hz = mz + (rz / room) * back;
  const pa: FacePoint = { x: E.ax + (mx - E.ax) * c, z: E.az + (mz - E.az) * c, t: t * c, corner: -1, gable: e };
  const pb: FacePoint = { x: E.bx + (mx - E.bx) * c, z: E.bz + (mz - E.bz) * c, t: t * c, corner: -1, gable: e };
  const plane = planeOf3(pa.x, pa.z, slope * pa.t, pb.x, pb.z, slope * pb.t, hx, hz, slope * t);
  if (!plane) return null;
  // The faces of the walls before and after: the top replaced by the gable's cut and the hip's top
  const ringStart = e - E.i;
  const count = sk.rings[E.ring].length / 2;
  const fp = pts[ringStart + ((E.i + count - 1) % count)];
  const fn = pts[ringStart + ((E.i + 1) % count)];
  if (!fp || !fn) return null;
  const ip = fp.findIndex((q) => q.x === mx && q.z === mz);
  const iN = fn.findIndex((q) => q.x === mx && q.z === mz);
  if (ip < 0 || iN < 0) return null;
  const hip: FacePoint = { x: hx, z: hz, t, corner: -1, gable: -1 };
  fp.splice(ip, 1, pa, hip);
  fn.splice(iN, 1, { ...hip }, pb);
  const ua = (pa.x - E.ax) * E.dx + (pa.z - E.az) * E.dz;
  const ub = (pb.x - E.ax) * E.dx + (pb.z - E.az) * E.dz;
  return { hip: { pts: [pa, pb, { ...hip }], plane }, top: [0, 0, ua, slope * pa.t, ub, slope * pb.t, E.len, 0] };
}

/** The plane through three points (x, z, rise); null where they lie in a line */
function planeOf3(ax: number, az: number, ay: number, bx: number, bz: number, by: number, cx: number, cz: number, cy: number): RoofPlaneFit | null {
  const ux = bx - ax;
  const uz = bz - az;
  const uy = by - ay;
  const vx = cx - ax;
  const vz = cz - az;
  const vy = cy - ay;
  const det = ux * vz - uz * vx;
  if (Math.abs(det) < 1e-9) return null;
  const px = (uy * vz - uz * vy) / det;
  const pz = (ux * vy - uy * vx) / det;
  return { px, pz, p0: ay - px * ax - pz * az };
}

/**
 * The corners of the skeleton's rings moved out: where their walls' lines,
 * each moved out by its `reach`, cross; null where that would turn a wall
 * round (a short wall between two that close in) or reach far out of an
 * acute corner
 */
function movedOut(sk: Skeleton, reach: readonly number[]): number[] | null {
  const out: number[] = [];
  let first = 0;
  for (const r of sk.rings) {
    const n = r.length / 2;
    for (let i = 0; i < n; i++) {
      const p = first + ((i + n - 1) % n);
      const q = first + i;
      const L = sk.edges[p];
      const R = sk.edges[q];
      const x = r[2 * i];
      const z = r[2 * i + 1];
      // Lines moved out (against their inward normals): x - dL nL + s tL meets x - dR nR + u tR
      const den = L.dx * R.dz - L.dz * R.dx;
      if (Math.abs(den) < 1e-6) {
        out.push(x - reach[q] * R.nx, z - reach[q] * R.nz);
        continue;
      }
      const wx = -reach[q] * R.nx + reach[p] * L.nx;
      const wz = -reach[q] * R.nz + reach[p] * L.nz;
      const s = (wx * R.dz - wz * R.dx) / den;
      const ox = x - reach[p] * L.nx + L.dx * s;
      const oz = z - reach[p] * L.nz + L.dz * s;
      if ((ox - x) * (ox - x) + (oz - z) * (oz - z) > 9 * ROOF_EAVES * ROOF_EAVES) return null;
      out.push(ox, oz);
    }
    // No wall turned round between its moved-out ends
    for (let i = 0; i < n; i++) {
      const E = sk.edges[first + i];
      const a = (first + i) * 2;
      const b = (first + ((i + 1) % n)) * 2;
      if ((out[b] - out[a]) * E.dx + (out[b + 1] - out[a + 1]) * E.dz < 0.05) return null;
    }
    first += n;
  }
  return out;
}

/**
 * A face's outline as drawn: its ring corners out at the eaves, its points on
 * a gable's wall out past it along the face's own wall (the verge), all in
 * the face's plane
 */
function drawnRing(fp: readonly FacePoint[], e: number, sk: Skeleton, eaves: number[] | null, reach: readonly number[]): number[] {
  const E = sk.edges[e];
  const out: number[] = [];
  for (const q of fp) {
    if (q.corner >= 0 && eaves) {
      out.push(eaves[2 * q.corner], eaves[2 * q.corner + 1]);
    } else if (q.gable >= 0 && eaves && reach[q.gable] > 0) {
      // Along this face's wall out to the gable's line moved out: in the face's plane
      const G = sk.edges[q.gable];
      const towards = -(E.dx * G.nx + E.dz * G.nz);
      const mu = Math.abs(towards) > 0.2 ? reach[q.gable] / towards : 0;
      out.push(q.x + E.dx * mu, q.z + E.dz * mu);
    } else {
      out.push(q.x, q.z);
    }
  }
  return out;
}

/** The part of a face nearer its wall than `cap` (or farther, `below` false), clipped along the line at that time; null for none */
function clipT(fp: readonly FacePoint[], E: { ax: number; az: number; nx: number; nz: number }, cap: number, below: boolean): FacePoint[] | null {
  const out: FacePoint[] = [];
  const side = (q: FacePoint) => (below ? cap - q.t : q.t - cap);
  for (let i = 0; i < fp.length; i++) {
    const p = fp[i];
    const q = fp[(i + 1) % fp.length];
    const sp = side(p);
    const sq = side(q);
    if (sp >= 0) out.push(p);
    if (sp >= 0 !== sq >= 0) {
      const k = sp / (sp - sq);
      out.push({ x: p.x + (q.x - p.x) * k, z: p.z + (q.z - p.z) * k, t: cap, corner: -1, gable: p.gable >= 0 && p.gable === q.gable ? p.gable : -1 });
    }
  }
  if (out.length < 3) return null;
  let a = 0;
  for (let i = 0, j = out.length - 1; i < out.length; j = i++) a += out[j].x * out[i].z - out[i].x * out[j].z;
  return Math.abs(a) > 0.02 ? out : null;
}

/**
 * What a sloped roof's rise is measured over, m: the widest wing's half
 * width (the skeleton's latest time), a mansard's run, a skillion's depth
 * along its way down, half the length of a rectangle whose ridge runs
 * across; null where the roof cannot be made over the rings. The import
 * makes the rise from the pitch with it (convert/building-mass.ts)
 */
export function roofRun(body: RoofBody): number | null {
  if (body.roof === 'skillion' && body.rings.length === 1) {
    const dx = Math.cos(body.roofDirection ?? Math.PI / 2);
    const dz = Math.sin(body.roofDirection ?? Math.PI / 2);
    const r = body.rings[0];
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < r.length; i += 2) {
      lo = Math.min(lo, r[i] * dx + r[i + 1] * dz);
      hi = Math.max(hi, r[i] * dx + r[i + 1] * dz);
    }
    return hi - lo >= 0.5 ? hi - lo : null;
  }
  if (body.roof === 'gable' && body.roofAcross && body.rings.length === 1) {
    const axes = rectAxes(body.rings[0]);
    if (axes) return axes.hs;
  }
  if (body.roof !== 'gable' && body.roof !== 'hip' && body.roof !== 'halfhip' && body.roof !== 'mansard' && body.roof !== 'skillion') return null;
  const sk = roofSkeleton(body)?.sk;
  return sk ? slopeRun(sk, body.roof) : null;
}

/** What a skeleton roof's slope rises over: the widest wing's half width, a mansard's run; null under 0.3 m (skeletonModel makes none) */
function slopeRun(sk: Skeleton, roof: MapMassRoof): number | null {
  const run = roof === 'mansard' ? Math.min(mansardRun(sk.rings), sk.maxT * 0.85) : sk.maxT;
  return run >= 0.3 ? run : null;
}

/**
 * About the triangles a sloped roof's model draws (roofTriangles), from its
 * skeleton without making the model: the import's scene cost. 0 where it
 * makes none
 */
export function roofTriangleGuess(body: RoofBody): number {
  if (roofRun(body) === null) return 0;
  if (body.roof === 'skillion' && body.rings.length === 1) return body.rings.reduce((s, r) => s + r.length / 2, 0);
  if (body.roof === 'gable' && body.roofAcross && body.rings.length === 1 && rectAxes(body.rings[0])) return 8;
  const sk = roofSkeleton(body)!.sk;
  let n = 0;
  sk.faces.forEach((f, e) => {
    // A face's fan, a mansard's flat top one more; a gable's triangle, a longer top's pieces
    if (!sk.edges[e].still) n += f.length - 2 + (body.roof === 'mansard' ? 2 : 0);
    else n += sk.chains[e].length <= 3 ? 2 : (sk.chains[e].length - 1) * 4;
  });
  return n;
}

/** A rectangle's axes (massRectAxes) */
export function massRectAxes(ring: readonly number[]): { cx: number; cz: number; ux: number; uz: number; vx: number; vz: number; hs: number; ht: number } | null {
  return rectAxes(ring);
}

/** A rectangle's axes (4 corners, right angles): its middle, unit axes along its longer and shorter side, half sides; null for any other ring */
function rectAxes(ring: readonly number[]): { cx: number; cz: number; ux: number; uz: number; vx: number; vz: number; hs: number; ht: number } | null {
  if (ring.length !== 8) return null;
  for (let i = 0; i < 4; i++) {
    const a = 2 * i;
    const b = 2 * ((i + 1) % 4);
    const c = 2 * ((i + 2) % 4);
    const e1x = ring[b] - ring[a];
    const e1z = ring[b + 1] - ring[a + 1];
    const e2x = ring[c] - ring[b];
    const e2z = ring[c + 1] - ring[b + 1];
    const l1 = Math.sqrt(e1x * e1x + e1z * e1z);
    const l2 = Math.sqrt(e2x * e2x + e2z * e2z);
    if (l1 < 0.05 || l2 < 0.05 || Math.abs(e1x * e2x + e1z * e2z) > 0.01 * (l1 + l2)) return null;
  }
  const l0 = Math.sqrt((ring[2] - ring[0]) ** 2 + (ring[3] - ring[1]) ** 2);
  const l1 = Math.sqrt((ring[4] - ring[2]) ** 2 + (ring[5] - ring[3]) ** 2);
  const long0 = l0 >= l1;
  const ux = long0 ? (ring[2] - ring[0]) / l0 : (ring[4] - ring[2]) / l1;
  const uz = long0 ? (ring[3] - ring[1]) / l0 : (ring[5] - ring[3]) / l1;
  return {
    cx: (ring[0] + ring[2] + ring[4] + ring[6]) / 4,
    cz: (ring[1] + ring[3] + ring[5] + ring[7]) / 4,
    ux,
    uz,
    vx: -uz,
    vz: ux,
    hs: Math.max(l0, l1) / 2,
    ht: Math.min(l0, l1) / 2,
  };
}

/** A gable roof over a rectangle with its ridge across it: the slopes down to its short sides, gables on its long ones */
function acrossModel(ring: readonly number[], ridge: number): RoofModel | null {
  const f = rectAxes(ring)!;
  const { cx, cz, ux, uz, vx, vz, hs, ht } = f;
  const slope = ridge / hs;
  const at = (s: number, t: number) => [cx + ux * s + vx * t, cz + uz * s + vz * t];
  const faces: RoofFace[] = [];
  const polygons: RoofPolygon[] = [];
  const reach = ROOF_EAVES;
  for (const side of [-1, 1]) {
    // Rise = slope * (hs - side * s): s along u from the middle
    const plane = { px: -side * slope * ux, pz: -side * slope * uz, p0: slope * hs + side * slope * (ux * cx + uz * cz) };
    faces.push(face([[...at(0, -ht), ...at(side * hs, -ht), ...at(side * hs, ht), ...at(0, ht)]], plane));
    const ring2 = side > 0
      ? [...at(0, -ht - reach), ...at(hs + reach, -ht - reach), ...at(hs + reach, ht + reach), ...at(0, ht + reach)]
      : [...at(0, ht + reach), ...at(-hs - reach, ht + reach), ...at(-hs - reach, -ht - reach), ...at(0, -ht - reach)];
    polygons.push({ rings: [ring2], ...plane, ux: vx * side, uz: vz * side, flat: false });
  }
  const gables: RoofGable[] = [];
  for (const side of [-1, 1]) {
    const [ax, az] = at(-hs, side * ht);
    const [bx, bz] = at(hs, side * ht);
    gables.push({ ax, az, bx, bz, top: [0, 0, hs, ridge, 2 * hs, 0] });
  }
  return { faces, polygons, gables, top: ridge };
}

/**
 * One slope over the outline down towards `direction`: as high as `ridge`
 * over its lowest wall at its highest; eaves on its low side and its
 * verges, flush on its high side (a lean-to's)
 */
function skillionModel(rings: number[][], ridge: number, direction: number): RoofModel | null {
  const dx = Math.cos(direction);
  const dz = Math.sin(direction);
  const r = rings[0];
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    const q = r[i] * dx + r[i + 1] * dz;
    lo = Math.min(lo, q);
    hi = Math.max(hi, q);
  }
  if (hi - lo < 0.5) return null;
  // Rise = slope * (hi - p . d): ridge on the high side, 0 on the low
  const slope = ridge / (hi - lo);
  const plane = { px: -slope * dx, pz: -slope * dz, p0: slope * hi };
  const drawn = rings.map((ring, k) => outset(ring, k === 0, dx, dz));
  const ok = drawn.every((q) => q !== null);
  return {
    faces: [face(rings, plane)],
    polygons: [{ rings: ok ? (drawn as number[][]) : rings, ...plane, ux: -dz, uz: dx, flat: false }],
    gables: [],
    walls: plane,
    top: ridge,
  };
}

/** A ring moved out by ROOF_EAVES off its walls, but not off the walls facing up the slope `d`; null where a wall turns round */
function outset(ring: readonly number[], outline: boolean, dx: number, dz: number): number[] | null {
  const n = ring.length / 2;
  const ccw = area2(ring) > 0;
  // Outward normals, and how far each wall's line moves
  const ns: number[] = [];
  const ds: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = ring[2 * j] - ring[2 * i];
    const ez = ring[2 * j + 1] - ring[2 * i + 1];
    const l = Math.sqrt(ex * ex + ez * ez) || 1;
    // Out of the outline is right of a counter-clockwise ring; out of a courtyard's ring into the courtyard
    const s = ccw === outline ? 1 : -1;
    const nx = (ez / l) * s;
    const nz = (-ex / l) * s;
    ns.push(nx, nz);
    ds.push(nx * dx + nz * dz < -0.5 ? 0 : ROOF_EAVES);
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n;
    const x = ring[2 * i];
    const z = ring[2 * i + 1];
    // The moved lines of walls p and i: points x + n d + s e
    const ax = x + ns[2 * p] * ds[p];
    const az = z + ns[2 * p + 1] * ds[p];
    const bx = x + ns[2 * i] * ds[i];
    const bz = z + ns[2 * i + 1] * ds[i];
    const e1x = -ns[2 * p + 1];
    const e1z = ns[2 * p];
    const e2x = -ns[2 * i + 1];
    const e2z = ns[2 * i];
    const den = e1x * e2z - e1z * e2x;
    if (Math.abs(den) < 1e-6) {
      out.push((ax + bx) / 2, (az + bz) / 2);
      continue;
    }
    const s = ((bx - ax) * e2z - (bz - az) * e2x) / den;
    const ox = ax + e1x * s;
    const oz = az + e1z * s;
    if ((ox - x) ** 2 + (oz - z) ** 2 > 9 * ROOF_EAVES * ROOF_EAVES) return null;
    out.push(ox, oz);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = ring[2 * j] - ring[2 * i];
    const ez = ring[2 * j + 1] - ring[2 * i + 1];
    if ((out[2 * j] - out[2 * i]) * ex + (out[2 * j + 1] - out[2 * i + 1]) * ez <= 0) return null;
  }
  return out;
}
