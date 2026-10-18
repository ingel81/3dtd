/**
 * Buildings raised from their own footprint (MapObject.mass): what the
 * map's rules read of one, worked out from its rings as a catalogue model's
 * measurements are (object-ground.ts, object-roof.ts), so the build bans,
 * the roofs towers stand on, the seat and the structures treat it like any
 * building. Pure; the render side is render/objects/mass-layer.ts.
 */
import {
  MAP_MASS_FACADES,
  MAP_MASS_ROOFS,
  MASS_ASSET,
  type MapMass,
  type MapObject,
} from './map-document';
import type { GroundBox } from './object-ground';
import type { CatalogRoof } from './object-roof';
import type { ObjectFooting } from './render/objects/object-seat';

/** Points a raised building may have over all its rings */
export const MASS_MAX_POINTS = 2048;
/** Height of a flat roof's parapet over the roof, m */
export const MASS_PARAPET = 0.9;
/** Cell of the roof grid, m; larger for a building too big for MASS_ROOF_CELLS cells a side */
const ROOF_CELL = 1;
const MASS_ROOF_CELLS = 160;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Why `m` is no raised building, in words; null when it is one */
export function massProblem(m: unknown): string | null {
  if (typeof m !== 'object' || m === null) return 'its building is not an object';
  const r = m as Record<string, unknown>;
  const rings = r['rings'];
  if (!Array.isArray(rings) || rings.length === 0) return 'its building has no outline';
  let points = 0;
  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length < 6 || ring.length % 2 !== 0 || !ring.every(finite)) return 'its building has a broken ring';
    points += ring.length / 2;
  }
  if (points > MASS_MAX_POINTS) return `its building has more than ${MASS_MAX_POINTS} points`;
  if (!finite(r['height']) || (r['height'] as number) < 1 || (r['height'] as number) > 400) return 'its building has a bad height';
  if (!finite(r['floors']) || (r['floors'] as number) < 1 || (r['floors'] as number) > 120) return 'its building has bad storeys';
  if (!MAP_MASS_ROOFS.includes(r['roof'] as never)) return 'its building has an unknown roof';
  if (r['ridge'] !== undefined && (!finite(r['ridge']) || (r['ridge'] as number) < 0 || (r['ridge'] as number) > 60)) return 'its building has a bad ridge';
  if (!MAP_MASS_FACADES.includes(r['facade'] as never)) return 'its building has an unknown facade';
  return null;
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

/** Whether a pitched roof stands: only over a lone rectangle along the model's axes, else the roof is flat */
export function massPitched(m: MapMass): boolean {
  if (m.roof === 'flat' || m.rings.length !== 1 || m.rings[0].length !== 8 || !((m.ridge ?? 0) > 0)) return false;
  const r = m.rings[0];
  // Each side runs along x or along z
  for (let i = 0; i < 8; i += 2) {
    const j = (i + 2) % 8;
    if (Math.abs(r[i] - r[j]) > 0.01 && Math.abs(r[i + 1] - r[j + 1]) > 0.01) return false;
  }
  return true;
}

/**
 * Triangles the mass layer draws for the building: two per wall, a flat
 * roof's triangulation and four per side of its parapet (its inner face and
 * its top), a pitched roof's slopes and gables
 */
export function massTriangles(m: MapMass): number {
  // Four walls, two slopes of two triangles; two gables (a quad drawn in to a point) or two hips
  if (massPitched(m)) return 8 + 4 + (m.roof === 'hip' ? 2 : 4);
  let edges = 0;
  for (const r of m.rings) edges += r.length / 2;
  return edges * 2 + (edges - 2 + 2 * (m.rings.length - 1)) + edges * 4;
}

/** Highest point over the seat at scale 1, m */
export function massTop(m: MapMass): number {
  return m.height + (massPitched(m) ? (m.ridge ?? 0) : 0);
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

/** Roof height over the seat at model (x, z), scale 1: a flat roof inside its parapet, a pitched one on its slopes */
function roofHeightAt(m: MapMass, pitched: boolean, b: ReturnType<typeof massBounds>, x: number, z: number): number {
  if (!pitched) return m.height - MASS_PARAPET;
  const ridge = m.ridge ?? 0;
  // The ridge runs along the longer side
  const alongX = b.maxX - b.minX >= b.maxZ - b.minZ;
  const half = alongX ? (b.maxZ - b.minZ) / 2 : (b.maxX - b.minX) / 2;
  const across = alongX ? Math.abs(z - (b.minZ + b.maxZ) / 2) : Math.abs(x - (b.minX + b.maxX) / 2);
  let rise = ridge * Math.max(0, 1 - across / half);
  if (m.roof === 'hip') {
    // The hips slope as the sides do, from each end in
    const along = alongX ? Math.min(x - b.minX, b.maxX - x) : Math.min(z - b.minZ, b.maxZ - z);
    rise = Math.min(rise, ridge * Math.max(0, along / half));
  }
  return m.height + rise;
}

const roofs = new WeakMap<MapMass, CatalogRoof>();

/**
 * The top a tower stands on (object-roof.ts), as the catalogue measures it
 * for its models: a grid over the outline's bounds, the roof's height in
 * each cell that lies on the building's ground, none in a courtyard.
 * Worked out once per building.
 */
export function massRoof(m: MapMass): CatalogRoof {
  let roof = roofs.get(m);
  if (roof) return roof;
  const b = massBounds(m);
  const pitched = massPitched(m);
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
      const h = massContains(m, x, z) ? roofHeightAt(m, pitched, b, x, z) : 0;
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
}

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
    out.push({ x: a.x, y: a.y, nx: (b.x - a.x) / s, ny: (b.y - a.y) / s, width: length * s, ground, top: m.height * s });
  }
  return out;
}
