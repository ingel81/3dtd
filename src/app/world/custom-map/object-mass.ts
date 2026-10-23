/**
 * Buildings raised from their own footprint (MapObject.mass): what the
 * map's rules read of one, worked out from its rings as a catalogue model's
 * measurements are (object-ground.ts, object-roof.ts), so the build bans,
 * the roofs towers stand on, the seat and the structures treat it like any
 * building. Pure; the render side is render/objects/mass-layer.ts.
 */
import {
  MAP_MASS_COVERS,
  MAP_MASS_FACADES,
  MAP_MASS_HEADS,
  MAP_MASS_OPENINGS,
  MAP_MASS_ROOFS,
  MASS_ASSET,
  type MapMass,
  type MapMassCover,
  type MapMassFacade,
  type MapMassOpening,
  type MapMassRoof,
  type MapObject,
} from './map-document';
import type { GroundBox } from './object-ground';
import type { CatalogRoof } from './object-roof';
import type { ObjectFooting } from './render/objects/object-seat';
import type { MapText } from './map-text';
import { roofModel, roofRiseAt, roofRun, roofTriangleGuess, type RoofModel } from './mass-roof';

/** Points a raised building may have over all its rings */
export const MASS_MAX_POINTS = 2048;
/** Height of a flat roof's parapet over the roof, m */
export const MASS_PARAPET = 0.9;
/** Cell of the roof grid, m; larger for a building too big for MASS_ROOF_CELLS cells a side */
const ROOF_CELL = 1;
const MASS_ROOF_CELLS = 160;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Parts a raised building may have (MapMass.parts) */
export const MASS_MAX_PARTS = 256;
/** Openings a raised building may have (MapMass.openings) */
export const MASS_MAX_OPENINGS = 32;

const HEX = /^#[0-9a-f]{6}$/i;

/** Why `m` is no raised building; null when it is one */
export function massProblem(m: unknown): MapText | null {
  if (typeof m !== 'object' || m === null) return { key: 'notObject', v: { what: { kind: 'building' } } };
  const r = m as Record<string, unknown>;
  const rings = r['rings'];
  if (!Array.isArray(rings) || rings.length === 0) return { key: 'massOutline' };
  let points = 0;
  for (const ring of rings) {
    if (!isRing(ring)) return { key: 'massRing' };
    points += ring.length / 2;
  }
  const parts = r['parts'];
  if (parts !== undefined) {
    if (!Array.isArray(parts) || parts.length === 0 || parts.length > MASS_MAX_PARTS) return { key: 'massParts' };
    for (const part of parts) {
      if (typeof part !== 'object' || part === null) return { key: 'massParts' };
      const p = part as Record<string, unknown>;
      const own = p['rings'];
      if (!Array.isArray(own) || own.length === 0 || !own.every(isRing)) return { key: 'massParts' };
      for (const ring of own as number[][]) points += ring.length / 2;
      const problem = bodyProblem(p, true);
      if (problem) return problem.key === 'massColour' ? problem : { key: 'massParts' };
    }
  }
  if (points > MASS_MAX_POINTS) return { key: 'massPoints', v: { max: MASS_MAX_POINTS } };
  const body = bodyProblem(r, false);
  if (body) return body;
  const shop = r['shop'];
  if (shop !== undefined && (!Array.isArray(shop) || !shop.every((k) => Number.isInteger(k) && k >= 0 && k < (rings[0] as unknown[]).length / 2))) {
    return { key: 'massShop' };
  }
  const openings = r['openings'];
  if (openings !== undefined && (!Array.isArray(openings) || openings.length === 0 || openings.length > MASS_MAX_OPENINGS || !openings.every(isOpening))) {
    return { key: 'massOpenings' };
  }
  return null;
}

/** Whether `o` is a way through a building (MapMassOpening): a line, a door's width and height at least, a kind and a head */
function isOpening(o: unknown): boolean {
  if (typeof o !== 'object' || o === null) return false;
  const r = o as Record<string, unknown>;
  const line = r['line'];
  if (!Array.isArray(line) || line.length !== 4 || !line.every(finite)) return false;
  if (Math.hypot((line[2] as number) - (line[0] as number), (line[3] as number) - (line[1] as number)) < 0.5) return false;
  if (!finite(r['width']) || (r['width'] as number) < 0.5 || (r['width'] as number) > 30) return false;
  if (r['floor'] !== undefined && (!finite(r['floor']) || (r['floor'] as number) < -10 || (r['floor'] as number) > 0)) return false;
  // At least a door's height over its floor (a car park's top may lie under the seat, its floor deeper)
  if (!finite(r['height']) || (r['height'] as number) - ((r['floor'] as number | undefined) ?? 0) < 1.5 || (r['height'] as number) > 30) return false;
  return MAP_MASS_OPENINGS.includes(r['kind'] as never) && MAP_MASS_HEADS.includes(r['head'] as never);
}

/** A ring of at least three x, z pairs */
function isRing(ring: unknown): ring is number[] {
  return Array.isArray(ring) && ring.length >= 6 && ring.length % 2 === 0 && ring.every(finite);
}

/** Why the fields a building and its parts share are wrong (a part's facade may be missing, its floor stand over the seat) */
function bodyProblem(r: Record<string, unknown>, part: boolean): MapText | null {
  if (!finite(r['height']) || (r['height'] as number) < 1 || (r['height'] as number) > 400) return { key: 'massHeight' };
  if (part && r['base'] !== undefined && (!finite(r['base']) || (r['base'] as number) < 0 || (r['base'] as number) >= (r['height'] as number))) {
    return { key: 'massHeight' };
  }
  if (!finite(r['floors']) || (r['floors'] as number) < 1 || (r['floors'] as number) > 120) return { key: 'massStoreys' };
  if (!MAP_MASS_ROOFS.includes(r['roof'] as never)) return { key: 'massRoof' };
  if (r['ridge'] !== undefined && (!finite(r['ridge']) || (r['ridge'] as number) < 0 || (r['ridge'] as number) > 60)) return { key: 'massRidge' };
  if (r['roofDirection'] !== undefined && (!finite(r['roofDirection']) || Math.abs(r['roofDirection'] as number) > 7)) return { key: 'massRoof' };
  if (r['roofAcross'] !== undefined && typeof r['roofAcross'] !== 'boolean') return { key: 'massRoof' };
  const shared = r['shared'];
  const outline = Array.isArray(r['rings']) && Array.isArray((r['rings'] as unknown[])[0]) ? ((r['rings'] as unknown[][])[0].length / 2) : 0;
  if (shared !== undefined && (!Array.isArray(shared) || !shared.every((k) => Number.isInteger(k) && k >= 0 && k < outline))) return { key: 'massRoof' };
  if (!(part && r['facade'] === undefined) && !MAP_MASS_FACADES.includes(r['facade'] as never)) return { key: 'massFacade' };
  for (const key of part ? ['tint', 'roofTint'] : ['roofTint']) {
    if (r[key] !== undefined && (typeof r[key] !== 'string' || !HEX.test(r[key] as string))) return { key: 'massColour' };
  }
  if (r['roofCover'] !== undefined && !MAP_MASS_COVERS.includes(r['roofCover'] as never)) return { key: 'massRoof' };
  return null;
}

/**
 * One body of a raised building as it is drawn and as its roof is
 * measured: the building itself, or one of its parts (MapMass.parts) with
 * the building's facade and roof covering where the part has none of its
 * own. Its walls stand from `base` up (0 or missing: from the ground, with
 * the foundation below)
 */
export interface MassBody {
  rings: number[][];
  base?: number;
  height: number;
  floors: number;
  roof: MapMassRoof;
  ridge?: number;
  roofDirection?: number;
  roofAcross?: boolean;
  shared?: number[];
  facade: MapMassFacade;
  shop?: number[];
  /** Its walls' colour over the object's (a part's own `building:colour`) */
  tint?: string;
  /** Its walls' colour as a factor over their facade's texture, times the object's (a catalogue model's basement in its walls' colour) */
  tone?: readonly [number, number, number];
  roofTint?: string;
  roofCover?: MapMassCover;
  /** The ways through the building (MapMass.openings): its walls open where they cross them */
  openings?: readonly MapMassOpening[];
  /**
   * Of those, the ones whose insides it draws (their reveals, ceiling, back
   * wall, in its walls' look): all of them for a building without parts,
   * else each on the part standing on the ground over its inside
   */
  hosts?: readonly MapMassOpening[];
  /** Metres of basement under its floor (MapObject.basement): its walls reach that much further down */
  basement?: number;
  /** Only the basement under a catalogue model (its wall box): walls up to the model's floor, no roof */
  cellar?: boolean;
  /** The colour of its windows' frames (linear; a catalogue model's, under which it is the basement) */
  frame?: readonly [number, number, number];
  /** The building's ground (MapMass.rings) the openings' insides run through; its own rings when missing */
  ground?: number[][];
  /** The rings of all its building's parts: an opening reaches out to a part's wall a little past the ground */
  walls?: readonly number[][];
}

const bodyCache = new WeakMap<MapMass, { rings: number[][]; parts: MapMass['parts']; openings: MapMass['openings']; bodies: readonly MassBody[] }>();

/**
 * What a raised building is drawn as: its parts (each with the building's
 * facade and roof where it has none of its own), else the building itself.
 * Worked out once per set of rings and parts
 */
export function massBodies(m: MapMass): readonly MassBody[] {
  if (!m.parts?.length) return [m];
  const cached = bodyCache.get(m);
  if (cached && cached.rings === m.rings && cached.parts === m.parts && cached.openings === m.openings) return cached.bodies;
  const parts = m.parts;
  const openings = m.openings;
  // Each opening's inside drawn by the part on the ground over it, else by the first on the ground, else the first
  const ground = parts.map((part, k) => ((part.base ?? 0) <= 0.5 ? k : -1)).filter((k) => k >= 0);
  const hostOf = openings?.map((o) => {
    const p = openingInside(o);
    return ground.find((k) => ringsContain(parts[k].rings, p.x, p.z)) ?? ground[0] ?? 0;
  });
  const walls = openings ? [...m.rings, ...parts.flatMap((p) => p.rings)] : [];
  const bodies = parts.map((p, k): MassBody => {
    const roofTint = p.roofTint ?? m.roofTint;
    const roofCover = p.roofCover ?? m.roofCover;
    const ways = openings ? { openings, hosts: openings.filter((_, j) => hostOf![j] === k), ground: m.rings, walls } : {};
    return { ...p, facade: p.facade ?? m.facade, ...(roofTint ? { roofTint } : {}), ...(roofCover ? { roofCover } : {}), ...ways };
  });
  bodyCache.set(m, { rings: m.rings, parts, openings, bodies });
  return bodies;
}

/** Metres beside a car park's entrance its ramp's cutting reaches (its sides, a slope as deep as the ramp), and before it */
const RAMP_SIDE = 4.5;
const RAMP_BEFORE = 12;

/**
 * Whether model point (x, z) at scale 1 lies in the cutting of a car park's
 * ramp before one of the building's entrances (MapMass.openings, `garage`):
 * ground the building does not stand on (object-seat.ts)
 */
export function massOnRamp(m: MapMass, x: number, z: number): boolean {
  for (const o of m.openings ?? []) {
    if (o.kind !== 'garage') continue;
    const [ax, az, bx, bz] = o.line;
    const l = Math.hypot(bx - ax, bz - az) || 1;
    const dx = (bx - ax) / l;
    const dz = (bz - az) / l;
    const t = (x - ax) * dx + (z - az) * dz;
    const s = Math.abs((x - ax) * dz - (z - az) * dx);
    if (t >= -RAMP_BEFORE && t <= l && s <= o.width / 2 + RAMP_SIDE) return true;
  }
  return false;
}

/** A point inside the building on an opening's line: a passage's middle, near a car park's blind end */
export function openingInside(o: MapMassOpening): { x: number; z: number } {
  const [ax, az, bx, bz] = o.line;
  const t = o.kind === 'garage' ? Math.max(0.5, 1 - 0.3 / Math.max(0.6, Math.hypot(bx - ax, bz - az))) : 0.5;
  return { x: ax + (bx - ax) * t, z: az + (bz - az) * t };
}

/** The object's raised building, when it is one (the asset and a building) */
export function massOf(o: Pick<MapObject, 'asset' | 'mass'>): MapMass | null {
  return o.asset === MASS_ASSET && o.mass ? o.mass : null;
}

/** Signed area of a ring of x, z pairs (positive: counter-clockwise in x, z) */
export function ringArea2(ring: readonly number[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) a += ring[j] * ring[i + 1] - ring[i] * ring[j + 1];
  return a / 2;
}

/** Ground the building covers at scale 1, m²: its outline less its courtyards */
export function massArea(m: MapMass): number {
  let a = Math.abs(ringArea2(m.rings[0]));
  for (let k = 1; k < m.rings.length; k++) a -= Math.abs(ringArea2(m.rings[k]));
  return Math.max(0, a);
}

/**
 * The model of a body's sloped roof (gable, hip, half-hip, mansard, skillion
 * over any outline, mass-roof.ts), null for a flat roof, a pyramid or one
 * that cannot be made (then it stands flat)
 */
export function massSlopes(m: MassBody): RoofModel | null {
  return roofModel(m);
}

/**
 * Whether a sloped roof stands over the body (massSlopes makes one), else its
 * roof is flat or a pyramid; read off its skeleton without making the model
 */
export function massPitched(m: MassBody): boolean {
  return (m.ridge ?? 0) > 0 && roofRun(m) !== null;
}

const apexes = new WeakMap<number[], { x: number; z: number } | null>();

/**
 * The top of a pyramid roof (`roof: 'pyramid'`, one ring, a ridge): the
 * outline's middle (its centroid), where the slopes of all walls meet; null
 * for any other roof or for an outline its middle does not see whole (then
 * the roof is flat). Worked out once per ring
 */
export function massApex(m: MassBody): { x: number; z: number } | null {
  if (m.roof !== 'pyramid' || m.rings.length !== 1 || !((m.ridge ?? 0) > 0)) return null;
  const ring = m.rings[0];
  const cached = apexes.get(ring);
  if (cached !== undefined) return cached;
  const a2 = ringArea2(ring);
  let apex: { x: number; z: number } | null = null;
  if (Math.abs(a2) > 0.5) {
    let cx = 0;
    let cz = 0;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const cross = ring[j] * ring[i + 1] - ring[i] * ring[j + 1];
      cx += (ring[j] + ring[i]) * cross;
      cz += (ring[j + 1] + ring[i + 1]) * cross;
    }
    cx /= 6 * a2;
    cz /= 6 * a2;
    // Every wall turns the same way round the middle: each slope a triangle of its own
    let seen = true;
    for (let i = 0, j = ring.length - 2; i < ring.length && seen; j = i, i += 2) {
      const turn = (ring[i] - ring[j]) * (cz - ring[j + 1]) - (ring[i + 1] - ring[j + 1]) * (cx - ring[j]);
      seen = turn * Math.sign(a2) > 1e-6;
    }
    if (seen) apex = { x: cx, z: cz };
  }
  apexes.set(ring, apex);
  return apex;
}

/** Triangles the mass layer draws for one body (massTriangles) */
function bodyTriangles(m: MassBody): number {
  let edges = 0;
  for (const r of m.rings) edges += r.length / 2;
  // Two per wall; a sloped roof's faces and gables (a skillion's walls a triangle more each), a pyramid's slope per wall
  if (massPitched(m)) return edges * 2 + roofTriangleGuess(m) + (m.roof === 'skillion' && m.rings.length === 1 ? edges * 2 : 0);
  if (massApex(m)) return edges * 3;
  return edges * 2 + (edges - 2 + 2 * (m.rings.length - 1)) + edges * 4;
}

/**
 * Triangles the mass layer draws for the building: two per wall, a flat
 * roof's triangulation and four per side of its parapet (its inner face and
 * its top), a sloped roof's faces and gables (a skillion's walls a triangle
 * more up to its slope), a pyramid's slopes; a building with parts its parts'
 */
export function massTriangles(m: MapMass): number {
  let n = 0;
  for (const b of massBodies(m)) n += bodyTriangles(b);
  // An opening: the walls it crosses in pieces round it, its reveals, its ceiling or vault (render/objects/mass-openings.ts)
  return n + (m.openings?.length ?? 0) * OPENING_TRIANGLES;
}

/** Triangles an opening adds, about: two walls in four pieces each, two reveals, a vault of five facets in wedges */
const OPENING_TRIANGLES = 48;

/** Highest point of one body over the seat at scale 1, m */
export function bodyTop(m: MassBody): number {
  // A sloped roof reaches its ridge (mass-roof.ts: the rise over the widest wing, a mansard's top)
  return m.height + (massPitched(m) || massApex(m) ? (m.ridge ?? 0) : 0);
}

/** Highest point over the seat at scale 1, m: of a building with parts, its highest part's */
export function massTop(m: MapMass): number {
  let top = 0;
  for (const b of massBodies(m)) top = Math.max(top, bodyTop(b));
  return top;
}

/** Every vertex moved `d` in along the bisector of its walls (a mitre held to 2.5 d; out for a negative `d`); null where a wall turns round */
export function offsetRing(ring: readonly number[], d: number): number[] | null {
  const n = ring.length / 2;
  const ccw = ringArea2(ring) > 0;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = (i + n - 1) % n;
    const q = (i + 1) % n;
    const x = ring[2 * i];
    const z = ring[2 * i + 1];
    const e1x = x - ring[2 * p];
    const e1z = z - ring[2 * p + 1];
    const e2x = ring[2 * q] - x;
    const e2z = ring[2 * q + 1] - z;
    const l1 = Math.hypot(e1x, e1z) || 1;
    const l2 = Math.hypot(e2x, e2z) || 1;
    // Inward normals: the walls turned a quarter towards the inside
    const s = ccw ? 1 : -1;
    const n1x = (-e1z / l1) * s;
    const n1z = (e1x / l1) * s;
    const n2x = (-e2z / l2) * s;
    const n2z = (e2x / l2) * s;
    const bx = n1x + n2x;
    const bz = n1z + n2z;
    const dot = n1x * n2x + n1z * n2z;
    if (dot < -0.95) return null;
    const k = Math.min(2.5, 1 / Math.max(0.2, (1 + dot) / 2) ** 0.5) * d;
    const bl = Math.hypot(bx, bz) || 1;
    out.push(x + (bx / bl) * k, z + (bz / bl) * k);
  }
  // The drawn-in outline keeps its turn
  return ringArea2(out) > 0 === ccw ? out : null;
}

/** Bounds of the outline at scale 1 */
export function massBounds(m: MapMass): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const r = m.rings[0];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    minX = Math.min(minX, r[i]);
    maxX = Math.max(maxX, r[i]);
    minZ = Math.min(minZ, r[i + 1]);
    maxZ = Math.max(maxZ, r[i + 1]);
  }
  return { minX, maxX, minZ, maxZ };
}

/** The ground rectangle at scale 1 (object-ground.ts): the outline's bounds */
export function massBox(m: MapMass): GroundBox {
  const b = massBounds(m);
  return [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, (b.maxX - b.minX) / 2, (b.maxZ - b.minZ) / 2];
}

/** Radius round the origin that holds the outline at scale 1 */
export function massRadius(m: MapMass): number {
  const r = m.rings[0];
  let most = 0;
  for (let i = 0; i < r.length; i += 2) most = Math.max(most, r[i] * r[i] + r[i + 1] * r[i + 1]);
  return Math.sqrt(most);
}

/** Even-odd over all rings: whether model point (x, z) at scale 1 lies on the building's ground */
export function massContains(m: MapMass, x: number, z: number): boolean {
  return ringsContain(m.rings, x, z);
}

/**
 * Even-odd over `rings` (x, z pairs, the outline then its courtyards):
 * whether point (x, z) lies inside. `+ - * /` only, so the simulation may
 * ask it too (the roof a tower stands on, StructureLedger)
 */
export function ringsContain(rings: readonly (readonly number[])[], x: number, z: number): boolean {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i];
      const zi = r[i + 1];
      const xj = r[j];
      const zj = r[j + 1];
      if (zi > z !== zj > z && x < xi + ((z - zi) / (zj - zi)) * (xj - xi)) inside = !inside;
    }
  }
  return inside;
}

/** Distance (m, scale 1) from model point (x, z) to the building's ground: 0 on it */
export function massDistance(m: MapMass, x: number, z: number): number {
  if (massContains(m, x, z)) return 0;
  let best = Infinity;
  for (const r of m.rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const ax = r[j];
      const az = r[j + 1];
      const dx = r[i] - ax;
      const dz = r[i + 1] - az;
      const len2 = dx * dx + dz * dz;
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
      best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
    }
  }
  return best;
}

/**
 * The point of the rings' edges nearest model point (x, z), into `out`.
 * Only `+ - * /` and comparisons: every engine comes to the same bits (the
 * simulation places a hit's hole with it, StructureLedger)
 */
export function ringsNearest(rings: readonly (readonly number[])[], x: number, z: number, out: { x: number; z: number }): void {
  let best = Infinity;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const ax = r[j];
      const az = r[j + 1];
      const dx = r[i] - ax;
      const dz = r[i + 1] - az;
      const len2 = dx * dx + dz * dz;
      const t = len2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
      const px = ax + t * dx;
      const pz = az + t * dz;
      const sq = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (sq < best) {
        best = sq;
        out.x = px;
        out.z = pz;
      }
    }
  }
}

/** Distance between two pieces of line (a to b, c to d), 0 where they cross */
export function segmentDistance(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number {
  // Crossing pieces meet
  const d1 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const d2 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  const d3 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d4 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  const at = (px: number, pz: number, qx: number, qz: number, sx: number, sz: number): number => {
    const ux = sx - qx;
    const uz = sz - qz;
    const l2 = ux * ux + uz * uz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - qx) * ux + (pz - qz) * uz) / l2)) : 0;
    return Math.hypot(px - qx - t * ux, pz - qz - t * uz);
  };
  return Math.min(at(ax, az, cx, cz, dx, dz), at(bx, bz, cx, cz, dx, dz), at(cx, cz, ax, az, bx, bz), at(dx, dz, ax, az, bx, bz));
}

/**
 * Distance (m, scale 1) from the piece of line a to b (model x, z) to the
 * building's ground: 0 where it crosses a wall or starts on the building.
 * Exact, one pass over the walls (the editor's road check walks a road's
 * centre line through it)
 */
export function massSegmentDistance(m: MapMass, ax: number, az: number, bx: number, bz: number): number {
  if (massContains(m, ax, az)) return 0;
  let best = Infinity;
  for (const r of m.rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      best = Math.min(best, segmentDistance(ax, az, bx, bz, r[j], r[j + 1], r[i], r[i + 1]));
      if (best === 0) return 0;
    }
  }
  return best;
}

/** Roof height of one body over the seat at model (x, z), scale 1: a flat roof inside its parapet, a sloped one on its slopes */
export function bodyRoofAt(m: MassBody, x: number, z: number): number {
  const slopes = massSlopes(m);
  if (slopes) return m.height + (roofRiseAt(slopes, x, z) ?? 0);
  const apex = massApex(m);
  if (apex) {
    // On the slope of the wall whose triangle (its two ends and the top) holds the point: as high as it is near the top
    const r = m.rings[0];
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const w = apexWeight(r[j], r[j + 1], r[i], r[i + 1], apex.x, apex.z, x, z);
      if (w >= 0) return m.height + (m.ridge ?? 0) * w;
    }
    return m.height;
  }
  return m.height - MASS_PARAPET;
}

/** The weight of the top c at point p in the triangle a, b, c; -1 where p lies outside it */
function apexWeight(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, px: number, pz: number): number {
  const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (Math.abs(d) < 1e-12) return -1;
  const wa = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d;
  const wb = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d;
  const wc = 1 - wa - wb;
  return wa >= -1e-9 && wb >= -1e-9 && wc >= -1e-9 ? Math.min(1, wc) : -1;
}

/**
 * Roof height over the seat at model (x, z), scale 1: of the highest body
 * standing there (a tower's helm over its wing); 0 where none stands (a
 * courtyard, beside the building)
 */
export function massRoofAt(m: MapMass, x: number, z: number): number {
  const bodies = massBodies(m);
  if (bodies[0] === m) return massContains(m, x, z) ? bodyRoofAt(m, x, z) : 0;
  let best = 0;
  for (const b of bodies) {
    const r = b.rings[0];
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < r.length; i += 2) {
      minX = Math.min(minX, r[i]);
      maxX = Math.max(maxX, r[i]);
      minZ = Math.min(minZ, r[i + 1]);
      maxZ = Math.max(maxZ, r[i + 1]);
    }
    if (x < minX || x > maxX || z < minZ || z > maxZ || !ringsContain(b.rings, x, z)) continue;
    best = Math.max(best, bodyRoofAt(b, x, z));
  }
  return best;
}

const roofs = new WeakMap<MapMass, CatalogRoof>();

/**
 * The top a tower stands on (object-roof.ts), as the catalogue measures it
 * for its models: a grid over the outline's bounds, the roof's height in
 * each cell that lies on the building's ground (on one of its parts, for a
 * building with parts), none in a courtyard. Worked out once per building.
 */
export function massRoof(m: MapMass): CatalogRoof {
  let roof = roofs.get(m);
  if (roof) return roof;
  const b = massBounds(m);
  const cell = Math.max(ROOF_CELL, Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / MASS_ROOF_CELLS);
  const columns = Math.max(1, Math.ceil((b.maxX - b.minX) / cell));
  const rows = Math.max(1, Math.ceil((b.maxZ - b.minZ) / cell));
  const top = massTop(m);
  const step = top / 254;
  let bytes = '';
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const x = b.minX + (i + 0.5) * cell;
      const z = b.minZ + (j + 0.5) * cell;
      const h = massRoofAt(m, x, z);
      bytes += String.fromCharCode(h > 0 ? Math.max(1, Math.min(255, Math.round(h / step))) : 0);
    }
  }
  roof = { x: b.minX, z: b.minZ, cell, columns, rows, step, heights: btoa(bytes) };
  roofs.set(m, roof);
  return roof;
}

/** What the map's rules read of a catalogue entry, for one object: its own building's where it has one */
export interface ObjectShape {
  footprint: number;
  height: number;
  box?: GroundBox;
  roof?: CatalogRoof;
}

/**
 * The ground, height, rectangle and roof of an object at scale 1: its
 * raised building's (massRadius, massTop, massBox, massRoof), else its
 * catalogue entry's
 */
export function objectShape<E extends Partial<ObjectShape>>(o: Pick<MapObject, 'asset' | 'mass'>, entry: E | undefined): ObjectShape {
  const m = massOf(o);
  if (m) return { footprint: massRadius(m), height: massTop(m), box: massBox(m), roof: massRoof(m) };
  return { footprint: entry?.footprint ?? 1, height: entry?.height ?? 0, box: entry?.box, roof: entry?.roof };
}

/** An object's footing (object-seat.ts): its catalogue entry's, with a raised building's own ground, height and rectangle */
export function objectFooting(o: Pick<MapObject, 'asset' | 'mass'>, f: ObjectFooting | undefined): ObjectFooting | undefined {
  const m = massOf(o);
  if (!m || !f) return f;
  return { ...f, footprint: massRadius(m), height: massTop(m), box: massBox(m) };
}

/** One street-facing wall of a raised building on the map (what shop signs and awnings hang on) */
export interface MassFront {
  /** Middle of the wall at its foot, map metres; the outward normal (unit) */
  x: number;
  y: number;
  nx: number;
  ny: number;
  /** Length of the wall, m */
  width: number;
  /** Top of the ground floor and of the walls over the seat, m */
  ground: number;
  top: number;
  /** Sill of the first floor's windows over the seat, m (with one storey the top of the walls) */
  sill: number;
  /** The wall's index in the outline (MapMass.shop) */
  edge: number;
}

/** Sill of the windows over a storey's floor per facade (mass-layer.ts WALL_COLOR_FRAGMENT) */
const MASS_SILL: Readonly<Record<MapMass['facade'], number>> = { plaster: 0.9, concrete: 0.85, metal: 0, brick: 0.85, stone: 1.1, timber: 0.85 };

/** Plinth over the seat of each facade (mass-layer.ts WALL_COLOR_FRAGMENT) */
const MASS_PLINTH: Readonly<Record<MapMass['facade'], number>> = { plaster: 0.45, concrete: 0.6, metal: 1, brick: 0.5, stone: 0.6, timber: 0.5 };

/**
 * The walls of the outline at least `least` metres long, on the map at the
 * object's place, turn and scale (courtyards left out): middle, outward
 * normal, length, and the top of the ground floor as the mass layer lays out
 * the storeys (plinth, then `floors` storeys under the cornice or parapet);
 * not a wall a way opens (MapMass.openings)
 */
export function massFronts(o: Pick<MapObject, 'asset' | 'mass' | 'x' | 'y' | 'rotation' | 'scale'>, least = 2): MassFront[] {
  const m = massOf(o);
  if (!m) return [];
  const s = o.scale || 1;
  const cos = Math.cos(o.rotation);
  const sin = Math.sin(o.rotation);
  // Model (x, z) to the map: the inverse of toModel (object-ground.ts)
  const toMap = (x: number, z: number) => ({ x: o.x - (x * cos + z * sin) * s, y: o.y - x * sin * s + z * cos * s });
  const plinth = MASS_PLINTH[m.facade];
  const band = m.roof === 'flat' ? MASS_PARAPET + 0.25 : 0.3;
  const storey = Math.max(0.5, m.height - plinth - band) / Math.max(1, m.floors);
  const ground = (plinth + Math.min(storey, 4.6)) * s;
  const r = m.rings[0];
  const out: MassFront[] = [];
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const length = Math.hypot(r[i] - r[j], r[i + 1] - r[j + 1]);
    if (length * s < least) continue;
    // A wall a way opens (MapMass.openings) carries no sign or awning: they would hang in the opening
    if (m.openings?.some((o) => segmentDistance(o.line[0], o.line[1], o.line[2], o.line[3], r[j], r[j + 1], r[i], r[i + 1]) < o.width / 2)) continue;
    const mx = (r[i] + r[j]) / 2;
    const mz = (r[i + 1] + r[j + 1]) / 2;
    let nx = (r[i + 1] - r[j + 1]) / length;
    let nz = -(r[i] - r[j]) / length;
    if (massContains(m, mx + nx * 0.05, mz + nz * 0.05)) {
      nx = -nx;
      nz = -nz;
    }
    const a = toMap(mx, mz);
    const b = toMap(mx + nx, mz + nz);
    const sill = m.floors > 1 ? ground + MASS_SILL[m.facade] * s : m.height * s;
    out.push({ x: a.x, y: a.y, nx: (b.x - a.x) / s, ny: (b.y - a.y) / s, width: length * s, ground, top: m.height * s, sill, edge: j / 2 });
  }
  return out;
}
