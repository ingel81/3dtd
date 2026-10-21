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
  MAP_MASS_ROOFS,
  MASS_ASSET,
  type MapMass,
  type MapMassCover,
  type MapMassFacade,
  type MapMassRoof,
  type MapObject,
} from './map-document';
import type { GroundBox } from './object-ground';
import type { CatalogRoof } from './object-roof';
import type { ObjectFooting } from './render/objects/object-seat';
import type { MapText } from './map-text';

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
  return null;
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
  facade: MapMassFacade;
  shop?: number[];
  /** Its walls' colour over the object's (a part's own `building:colour`) */
  tint?: string;
  roofTint?: string;
  roofCover?: MapMassCover;
}

const bodyCache = new WeakMap<MapMass, { rings: number[][]; parts: MapMass['parts']; bodies: readonly MassBody[] }>();

/**
 * What a raised building is drawn as: its parts (each with the building's
 * facade and roof where it has none of its own), else the building itself.
 * Worked out once per set of rings and parts
 */
export function massBodies(m: MapMass): readonly MassBody[] {
  if (!m.parts?.length) return [m];
  const cached = bodyCache.get(m);
  if (cached && cached.rings === m.rings && cached.parts === m.parts) return cached.bodies;
  const bodies = m.parts.map((p): MassBody => {
    const roofTint = p.roofTint ?? m.roofTint;
    const roofCover = p.roofCover ?? m.roofCover;
    return { ...p, facade: p.facade ?? m.facade, ...(roofTint ? { roofTint } : {}), ...(roofCover ? { roofCover } : {}) };
  });
  bodyCache.set(m, { rings: m.rings, parts: m.parts, bodies });
  return bodies;
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

/** The frame of a pitched roof over a rectangle: its middle, unit axis `u` along the ridge (its longer side), `v` across, half sides */
export interface MassRectFrame {
  cx: number;
  cz: number;
  ux: number;
  uz: number;
  vx: number;
  vz: number;
  /** Half the side along the ridge, half the side across it */
  halfS: number;
  halfT: number;
}

const frames = new WeakMap<number[], MassRectFrame | null>();

/**
 * A ring of four points that is a rectangle, turned any way (a part of a
 * building lies as OSM has it): its frame, the ridge along its longer side
 * (along x where both are as long); null for any other ring. Worked out once
 * per ring
 */
export function massRectFrame(ring: number[]): MassRectFrame | null {
  const cached = frames.get(ring);
  if (cached !== undefined) return cached;
  let frame: MassRectFrame | null = null;
  if (ring.length === 8) {
    let square = true;
    for (let i = 0; i < 4 && square; i++) {
      const a = 2 * i;
      const b = 2 * ((i + 1) % 4);
      const c = 2 * ((i + 2) % 4);
      const e1x = ring[b] - ring[a];
      const e1z = ring[b + 1] - ring[a + 1];
      const e2x = ring[c] - ring[b];
      const e2z = ring[c + 1] - ring[b + 1];
      const l1 = Math.hypot(e1x, e1z);
      const l2 = Math.hypot(e2x, e2z);
      // Right angles, within the centimetre the rings are rounded to
      square = l1 > 0.05 && l2 > 0.05 && Math.abs(e1x * e2x + e1z * e2z) <= 0.01 * (l1 + l2);
    }
    if (square) {
      const l0 = Math.hypot(ring[2] - ring[0], ring[3] - ring[1]);
      const l1 = Math.hypot(ring[4] - ring[2], ring[5] - ring[3]);
      const e0 = [(ring[2] - ring[0]) / l0, (ring[3] - ring[1]) / l0];
      const e1 = [(ring[4] - ring[2]) / l1, (ring[5] - ring[3]) / l1];
      // Along the longer side; of two as long, the one nearer the x axis
      const along = Math.abs(l0 - l1) > 1e-6 ? (l0 > l1 ? e0 : e1) : Math.abs(e0[0]) >= Math.abs(e1[0]) ? e0 : e1;
      let [ux, uz] = along;
      if (ux < -1e-9 || (Math.abs(ux) <= 1e-9 && uz < 0)) {
        ux = -ux;
        uz = -uz;
      }
      let vx = -uz;
      let vz = ux;
      if (vx < -1e-9 || (Math.abs(vx) <= 1e-9 && vz < 0)) {
        vx = -vx;
        vz = -vz;
      }
      frame = {
        cx: (ring[0] + ring[2] + ring[4] + ring[6]) / 4,
        cz: (ring[1] + ring[3] + ring[5] + ring[7]) / 4,
        ux,
        uz,
        vx,
        vz,
        halfS: Math.max(l0, l1) / 2,
        halfT: Math.min(l0, l1) / 2,
      };
    }
  }
  frames.set(ring, frame);
  return frame;
}

/** Whether a pitched roof stands: only over a lone rectangle (turned any way), else the roof is flat */
export function massPitched(m: MassBody): boolean {
  if ((m.roof !== 'gable' && m.roof !== 'hip') || m.rings.length !== 1 || !((m.ridge ?? 0) > 0)) return false;
  return massRectFrame(m.rings[0]) !== null;
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
  // Four walls, two slopes of two triangles; two gables (a quad drawn in to a point) or two hips
  if (massPitched(m)) return 8 + 4 + (m.roof === 'hip' ? 2 : 4);
  let edges = 0;
  for (const r of m.rings) edges += r.length / 2;
  // Two per wall, one slope per wall
  if (massApex(m)) return edges * 3;
  if (massInset(m)) return edges * 4 + edges - 2;
  return edges * 2 + (edges - 2 + 2 * (m.rings.length - 1)) + edges * 4;
}

/**
 * Triangles the mass layer draws for the building: two per wall, a flat
 * roof's triangulation and four per side of its parapet (its inner face and
 * its top), a pitched roof's slopes and gables, a mansard's slopes and top,
 * a pyramid's slopes; a building with parts its parts'
 */
export function massTriangles(m: MapMass): number {
  let n = 0;
  for (const b of massBodies(m)) n += bodyTriangles(b);
  return n;
}

/** Highest point of one body over the seat at scale 1, m */
export function bodyTop(m: MassBody): number {
  return m.height + (massPitched(m) || massInset(m) || massApex(m) ? (m.ridge ?? 0) : 0);
}

/** Highest point over the seat at scale 1, m: of a building with parts, its highest part's */
export function massTop(m: MapMass): number {
  let top = 0;
  for (const b of massBodies(m)) top = Math.max(top, bodyTop(b));
  return top;
}

/** A mansard's slopes run in at most this far from the walls, m */
export const MANSARD_RUN = 4;

/** A mansard's flat top: the outline drawn in by `run` metres (its slopes' run), at `ridge` over the eaves */
export interface MassInset {
  ring: number[];
  run: number;
}

const insets = new WeakMap<number[][], MassInset | null>();

/**
 * The top of a mansard roof (`roof: 'mansard'`, one ring, a ridge): the
 * outline drawn in from every wall, the run a share of the outline's mean
 * half width and at most MANSARD_RUN; null for any other roof or where the
 * drawn-in outline would cross itself (then the roof is flat). Worked out
 * once per set of rings
 */
export function massInset(m: MassBody): MassInset | null {
  if (m.roof !== 'mansard' || m.rings.length !== 1 || !((m.ridge ?? 0) > 0)) return null;
  const cached = insets.get(m.rings);
  if (cached !== undefined) return cached;
  const inset = insetOutline(m.rings[0]);
  insets.set(m.rings, inset);
  return inset;
}

/** An outline drawn in by a share of its mean half width (at most MANSARD_RUN), halved twice where it crosses itself */
export function insetOutline(ring: readonly number[]): MassInset | null {
  const n = ring.length / 2;
  let perimeter = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) perimeter += Math.hypot(ring[2 * i] - ring[2 * j], ring[2 * i + 1] - ring[2 * j + 1]);
  const area = Math.abs(ringArea2(ring));
  // Mean half width: area over half the perimeter, halved (a 10 x 30 m house: 3.75 m)
  let run = Math.min(MANSARD_RUN, (0.8 * area) / perimeter);
  for (let tries = 0; tries < 3 && run > 0.6; tries++, run /= 2) {
    const out = offsetRing(ring, run);
    if (out && Math.abs(ringArea2(out)) > 0.5 && !selfCrossing(out)) return { ring: out, run };
  }
  return null;
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

/** Whether two walls of a ring that do not meet cross */
function selfCrossing(ring: readonly number[]): boolean {
  const n = ring.length / 2;
  if (n > 120) return true;
  for (let i = 0; i < n; i++) {
    const a = 2 * i;
    const b = 2 * ((i + 1) % n);
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = 2 * j;
      const d = 2 * ((j + 1) % n);
      if (segmentDistance(ring[a], ring[a + 1], ring[b], ring[b + 1], ring[c], ring[c + 1], ring[d], ring[d + 1]) === 0) return true;
    }
  }
  return false;
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

/** Roof height of one body over the seat at model (x, z), scale 1: a flat roof inside its parapet, a pitched one on its slopes */
export function bodyRoofAt(m: MassBody, x: number, z: number): number {
  const inset = massInset(m);
  if (inset) {
    // A mansard rises from the walls over its run, flat above
    let wall = Infinity;
    const r = m.rings[0];
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const dx = r[i] - r[j];
      const dz = r[i + 1] - r[j + 1];
      const l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - r[j]) * dx + (z - r[j + 1]) * dz) / l2)) : 0;
      wall = Math.min(wall, Math.hypot(x - r[j] - t * dx, z - r[j + 1] - t * dz));
    }
    return m.height + (m.ridge ?? 0) * Math.min(1, wall / inset.run);
  }
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
  const f = massPitched(m) ? massRectFrame(m.rings[0]) : null;
  if (!f) return m.height - MASS_PARAPET;
  const ridge = m.ridge ?? 0;
  // The ridge runs along the longer side
  const s = (x - f.cx) * f.ux + (z - f.cz) * f.uz;
  const t = (x - f.cx) * f.vx + (z - f.cz) * f.vz;
  let rise = ridge * Math.max(0, 1 - Math.abs(t) / f.halfT);
  if (m.roof === 'hip') {
    // The hips slope as the sides do, from each end in
    rise = Math.min(rise, ridge * Math.max(0, (f.halfS - Math.abs(s)) / f.halfT));
  }
  return m.height + rise;
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
 * the storeys (plinth, then `floors` storeys under the cornice or parapet)
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
