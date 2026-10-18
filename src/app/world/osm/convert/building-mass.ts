/**
 * Footprints no catalogue model covers raised as they are (docs/OSM_WORLD_PLAN.md,
 * "Gebäude aus dem Grundriss"): the outline and its courtyards, simplified,
 * as the rings of a MapMass in the object's own axes; its height from
 * `height` or `building:levels`, else guessed from the kind and the size;
 * its roof from `roof:shape`, else by kind (pitched only over a footprint
 * that is nearly its rectangle); its walls from `building:material`, else
 * by kind; its tint from `building:colour`, else one of its facade's.
 */
import type { MapMass, MapMassFacade, MapMassRoof, MapPoint } from '../../custom-map/map-document';
import { insetOutline, MASS_MAX_POINTS, MASS_PARAPET, ringArea2, segmentDistance } from '../../custom-map/object-mass';
import { toModel } from '../../custom-map/object-ground';
import { buildingLevels, type BuildingKind } from '../building-tags';

/** Points nearer than this (m) to the line of their neighbours go (Douglas-Peucker) */
const SIMPLIFY_M = 0.35;
/** A footprint filling this much of its rectangle, without courtyards, may take a pitched roof over the rectangle */
const PITCH_FILL = 0.9;
/** The same for an old-town house and a tower */
const PITCH_FILL_OLD = 0.72;
/** A footprint under TOWER_AREA m² whose walls stand TOWER_SLENDER times as high as the root of its area is a tower */
const TOWER_AREA = 400;
const TOWER_SLENDER = 2.2;
/** A tower's pyramid, degrees */
const TOWER_PITCH = 62;
/** Highest a mansard's slopes rise, m */
const MANSARD_RISE = 7;
/** Storey heights, m: homes, and offices, schools and public buildings */
const HOME_STOREY = 2.9;
const WORK_STOREY = 3.6;
/** The ground floor's plinth over the seat, m */
const PLINTH = 0.4;

/** Storeys and wall height of each kind without tags: a hall is one storey of its own height */
const KIND_LEVELS: Readonly<Record<BuildingKind, { floors: number } | { hall: number }>> = {
  house: { floors: 2 },
  semi: { floors: 2 },
  terrace: { floors: 2 },
  apartments: { floors: 3 },
  office: { floors: 4 },
  civic: { floors: 3 },
  school: { floors: 3 },
  station: { floors: 2 },
  parking: { floors: 3 },
  retail: { hall: 6 },
  industrial: { hall: 7.5 },
  farm: { hall: 7 },
  church: { hall: 13 },
  chapel: { hall: 7 },
  greenhouse: { hall: 3.5 },
  garage: { hall: 2.8 },
  shed: { hall: 2.5 },
  carport: { hall: 2.6 },
  canopy: { hall: 4.5 },
  kiosk: { hall: 3 },
  transformer: { hall: 3 },
  oldtown: { floors: 3 },
};

/** Kinds that take a pitched roof where the footprint allows one, and its pitch in degrees */
const PITCH: Partial<Record<BuildingKind, number>> = {
  house: 38,
  semi: 38,
  terrace: 38,
  farm: 22,
  church: 48,
  chapel: 45,
  station: 30,
  garage: 12,
  shed: 15,
  oldtown: 55,
};

/** Walls of each kind without `building:material` */
const KIND_FACADE: Readonly<Record<BuildingKind, MapMassFacade>> = {
  house: 'plaster',
  semi: 'plaster',
  terrace: 'plaster',
  apartments: 'plaster',
  civic: 'plaster',
  office: 'concrete',
  school: 'concrete',
  parking: 'concrete',
  kiosk: 'concrete',
  transformer: 'concrete',
  garage: 'concrete',
  station: 'brick',
  retail: 'metal',
  industrial: 'metal',
  farm: 'metal',
  greenhouse: 'metal',
  shed: 'metal',
  carport: 'metal',
  canopy: 'metal',
  church: 'stone',
  chapel: 'stone',
  oldtown: 'timber',
};

const MATERIALS: Readonly<Record<string, MapMassFacade>> = {
  brick: 'brick',
  stone: 'stone',
  sandstone: 'stone',
  limestone: 'stone',
  granite: 'stone',
  concrete: 'concrete',
  reinforced_concrete: 'concrete',
  glass: 'concrete',
  metal: 'metal',
  steel: 'metal',
  metal_plates: 'metal',
  plaster: 'plaster',
  stucco: 'plaster',
  render: 'plaster',
  cement_block: 'concrete',
  wood: 'plaster',
  timber_framing: 'timber',
  half_timbered: 'timber',
};

/** Tints per facade, one per footprint by its id (null: the texture's own colour) */
const TINTS: Readonly<Record<MapMassFacade, readonly (string | null)[]>> = {
  plaster: [null, '#f6eee2', '#efe5d6', '#f3e3cb', '#e4ddd5', '#e9d6c2', '#dcd2c6', '#e8e2c8', '#d9dcd6'],
  concrete: [null, '#e6e3dc', '#d8d6d0', '#cfd2d4'],
  metal: ['#a9483a', '#8f3b31', '#7d8c96', '#b8bec2', '#a7b0a0', '#5f7a66', '#c9c5b8'],
  brick: [null, '#e0c8b8', '#c9a690'],
  stone: [null, '#e9e1d0', '#d6cdbd'],
  // The plaster between the frames: ochre, white, salmon, sage, cream
  timber: ['#f0d29a', '#f4f1e8', '#efc2b2', '#d4dcc6', '#f2e4c4'],
};

/** Colour names of `building:colour` the tints take as they are */
const NAMED: Readonly<Record<string, string>> = {
  white: '#f4f2ee',
  grey: '#b8b8b4',
  gray: '#b8b8b4',
  beige: '#e8d8bc',
  yellow: '#efd9a0',
  cream: '#f1e6cc',
  red: '#b0503e',
  brown: '#8f6a4e',
  blue: '#7d93a8',
  green: '#8ea486',
  orange: '#e3a46c',
  pink: '#e8bcb0',
};

/** One raised building: its mass in the object's own axes, the object's place and turn, its tint */
export interface RaisedMass {
  mass: MapMass;
  /** The object's middle (its rectangle's) and turn; the front (model +z) and the half sides of its rectangle */
  centre: MapPoint;
  rotation: number;
  front: MapPoint;
  hw: number;
  hd: number;
  tint: string | null;
}

/** A footprint's turned rectangle as convert/buildings.ts finds it: middle, unit axis along side `a`, sides */
export interface MassRect {
  c: MapPoint;
  u: MapPoint;
  a: number;
  b: number;
}

/**
 * The footprint (`outer` with its courtyards `holes`, in map space) raised
 * as a building of `kind`, laid in its rectangle's axes; null when nothing
 * is left of it after simplifying
 */
export function raiseMass(
  outer: readonly MapPoint[],
  holes: readonly (readonly MapPoint[])[],
  rect: MassRect,
  kind: BuildingKind,
  tags: Readonly<Record<string, string>>,
  area: number,
  salt: number,
): RaisedMass | null {
  // Model +x along the rectangle's side a (its axis u turned back), +z a quarter turn left of it in the map
  const front = { x: -rect.u.y, y: rect.u.x };
  const rotation = Math.atan2(-front.x, front.y);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const local = (ring: readonly MapPoint[]): number[] => {
    const out: number[] = [];
    for (const p of ring) {
      const m = toModel(p.x - rect.c.x, p.y - rect.c.y, cos, sin);
      out.push(round2(m.x), round2(m.z));
    }
    return out;
  };
  const levels = massLevels(tags, kind, area);
  // A tower (much higher than wide: a town hall's or a gate's): stone, storeys of its own, a steep pyramid
  const tower = area < TOWER_AREA && levels.height > TOWER_SLENDER * Math.sqrt(area);
  if (tower) levels.floors = Math.max(levels.floors, Math.round(levels.height / 4));
  const pitchDeg = tower ? TOWER_PITCH : roofPitch(tags, kind);
  const fill = area / Math.max(1e-6, rect.a * rect.b);
  let rings: number[][];
  let roof: MapMassRoof = 'flat';
  let ridge: number | undefined;
  // An old town's houses are rarely square: a pitched roof over the rectangle of one that nearly fills it
  if (pitchDeg && !holes.length && fill >= (kind === 'oldtown' || tower ? PITCH_FILL_OLD : PITCH_FILL)) {
    // Nearly its rectangle: the rectangle itself under a ridge along its longer side
    const ha = round2(rect.a / 2);
    const hb = round2(rect.b / 2);
    rings = [[-ha, -hb, ha, -hb, ha, hb, -ha, hb]];
    roof = tower || tags['roof:shape'] === 'hipped' || tags['roof:shape'] === 'pyramidal' || (tags['roof:shape'] === undefined && kind === 'house' && salt % 3 === 0)
      ? 'hip'
      : 'gable';
    const half = Math.min(rect.a, rect.b) / 2;
    const tagged = parseFloat((tags['roof:height'] ?? '').replace(',', '.'));
    ridge = round2(tagged > 0 && tagged < 40 ? tagged : Math.min(tower ? 24 : 14, half * Math.tan((pitchDeg * Math.PI) / 180)));
  } else {
    let tolerance = SIMPLIFY_M;
    rings = [];
    // Simplified more until the building has few enough points
    for (let tries = 0; tries < 6; tries++, tolerance *= 1.8) {
      const out = simplifyRing(outer, tolerance);
      if (!out) return null;
      rings = [local(out)];
      for (const h of holes) {
        const ring = simplifyRing(h, tolerance);
        if (ring) rings.push(local(ring));
      }
      if (rings.reduce((s, r) => s + r.length / 2, 0) <= MASS_MAX_POINTS) break;
    }
    // A kind with a pitched roof on a crooked outline: slopes from every wall up to a flat top (a mansard)
    const inset = pitchDeg && rings.length === 1 ? insetOutline(rings[0]) : null;
    if (inset) {
      roof = 'mansard';
      ridge = round2(Math.min(MANSARD_RISE, inset.run * Math.tan((pitchDeg * Math.PI) / 180)));
    }
  }
  // A pitched roof's walls stop at the eaves; a flat one's go on to the parapet
  const height = round2(roof === 'flat' ? levels.height + MASS_PARAPET : levels.height);
  const facade = tower && !MATERIALS[tags['building:material'] ?? ''] ? 'stone' : massFacade(tags, kind);
  return {
    mass: { rings, height, floors: levels.floors, roof, ...(ridge !== undefined ? { ridge } : {}), facade },
    centre: rect.c,
    rotation,
    front,
    hw: rect.a / 2,
    hd: rect.b / 2,
    tint: massTint(tags, facade, salt),
  };
}

/**
 * Storeys and the walls' height to the eaves or the roof (m, without a
 * parapet): `height` (less a pitched roof's `roof:height`), else
 * `building:levels` at the kind's storey, else the kind's own, a big hall a
 * little higher, a big block one storey more
 */
export function massLevels(tags: Readonly<Record<string, string>>, kind: BuildingKind, area: number): { floors: number; height: number } {
  const own = KIND_LEVELS[kind];
  const storey = kind === 'house' || kind === 'semi' || kind === 'terrace' || kind === 'apartments' || kind === 'oldtown' ? HOME_STOREY : WORK_STOREY;
  const tagged = parseFloat((tags['height'] ?? '').replace(',', '.'));
  if (tagged > 0 && tagged < 400) {
    const roofHeight = parseFloat((tags['roof:height'] ?? '').replace(',', '.'));
    const walls = Math.max(2.2, tagged - (roofHeight > 0 && roofHeight < tagged ? roofHeight : 0));
    return { floors: Math.max(1, Math.round(walls / ('hall' in own ? Math.max(walls, 4) : storey))), height: walls };
  }
  const levels = buildingLevels(tags);
  if (levels !== null) {
    const floors = Math.min(120, Math.max(1, levels));
    return { floors, height: floors === 1 && 'hall' in own ? own.hall : PLINTH + floors * storey };
  }
  if ('hall' in own) {
    // A big hall stands higher: up to 4 m more at 12 000 m²
    const grow = kind === 'industrial' || kind === 'retail' || kind === 'farm' ? Math.min(4, area / 3000) : 0;
    return { floors: 1, height: round2(own.hall + grow) };
  }
  const floors = own.floors + (kind === 'apartments' && area > 900 ? 1 : 0);
  return { floors, height: PLINTH + floors * storey };
}

/** The pitch of a pitched roof (degrees) the tags or the kind ask for; 0 for a flat one */
function roofPitch(tags: Readonly<Record<string, string>>, kind: BuildingKind): number {
  const shape = tags['roof:shape'];
  if (shape === 'flat') return 0;
  const angle = parseFloat(tags['roof:angle'] ?? '');
  if (shape === 'gabled' || shape === 'hipped' || shape === 'half-hipped' || shape === 'pyramidal') return angle > 5 && angle < 70 ? angle : (PITCH[kind] ?? 35);
  return shape === undefined ? (PITCH[kind] ?? 0) : 0;
}

/** The walls' look: `building:material` (or `building:facade:material`), else the kind's */
export function massFacade(tags: Readonly<Record<string, string>>, kind: BuildingKind): MapMassFacade {
  return MATERIALS[tags['building:material'] ?? tags['building:facade:material'] ?? ''] ?? KIND_FACADE[kind];
}

/** The tint: `building:colour` (a hex colour or a common name), else one of the facade's by the footprint's salt */
export function massTint(tags: Readonly<Record<string, string>>, facade: MapMassFacade, salt: number): string | null {
  const colour = (tags['building:colour'] ?? '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(colour)) return colour;
  if (/^#[0-9a-f]{3}$/.test(colour)) return `#${colour[1]}${colour[1]}${colour[2]}${colour[2]}${colour[3]}${colour[3]}`;
  if (NAMED[colour]) return NAMED[colour];
  const list = TINTS[facade];
  return list[salt % list.length];
}

/** A road's piece in the building's own axes (model x, z) with the half width the building keeps off */
export interface MassRoad {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  half: number;
}

/** The share of its ground a raised building keeps at least when roads cut it back (clipOffRoads) */
const CLIP_KEEP = 0.5;

/**
 * Cuts a raised building's walls back from the roads that reach into it (an
 * old town's houses stand at the edge of a street the map draws wider): each
 * road piece that comes nearer to the outline than its half width cuts the
 * outline along a line beside it, on the side of the building's middle.
 * Courtyards the cut reaches go. False (the building unchanged) when less
 * than CLIP_KEEP of the ground would be left or nothing is left to cut.
 */
export function clipOffRoads(mass: MapMass, roads: readonly MassRoad[]): boolean {
  let outer = mass.rings[0];
  const before = Math.abs(ringArea2(outer));
  let holes = mass.rings.slice(1);
  for (const r of roads) {
    const dx = r.bx - r.ax;
    const dz = r.bz - r.az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6 || ringRoadDistance(outer, r) >= r.half) continue;
    // The side of the building's middle, and the line half a road's width off the centre line
    let nx = -dz / len;
    let nz = dx / len;
    const [cx, cz] = ringMiddle(outer);
    if ((cx - r.ax) * nx + (cz - r.az) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const cut = clipHalfPlane(outer, r.ax, r.az, nx, nz, r.half);
    if (!cut) return false;
    outer = cut;
    holes = holes.filter((h) => ringRoadDistance(h, r) >= r.half && clipHalfPlane(h, r.ax, r.az, nx, nz, r.half)?.length === h.length);
  }
  if (outer === mass.rings[0]) return true;
  if (Math.abs(ringArea2(outer)) < before * CLIP_KEEP) return false;
  mass.rings = [outer.map(round2), ...holes];
  return true;
}

/** Nearest approach (m) of a road piece's centre line to a ring's edges */
function ringRoadDistance(ring: readonly number[], r: MassRoad): number {
  let best = Infinity;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    best = Math.min(best, segmentDistance(ring[j], ring[j + 1], ring[i], ring[i + 1], r.ax, r.az, r.bx, r.bz));
  }
  return best;
}

/** Mean of a ring's points */
function ringMiddle(ring: readonly number[]): [number, number] {
  let x = 0;
  let z = 0;
  for (let i = 0; i < ring.length; i += 2) {
    x += ring[i];
    z += ring[i + 1];
  }
  return [x / (ring.length / 2), z / (ring.length / 2)];
}

/** Sutherland-Hodgman: the part of a ring where (p - a) · n >= d; null when under three points are left */
function clipHalfPlane(ring: readonly number[], ax: number, az: number, nx: number, nz: number, d: number): number[] | null {
  const out: number[] = [];
  const n = ring.length / 2;
  for (let k = 0; k < n; k++) {
    const px = ring[2 * k];
    const pz = ring[2 * k + 1];
    const qx = ring[(2 * k + 2) % ring.length];
    const qz = ring[(2 * k + 3) % ring.length];
    const sp = (px - ax) * nx + (pz - az) * nz - d;
    const sq = (qx - ax) * nx + (qz - az) * nz - d;
    if (sp >= 0) out.push(px, pz);
    if (sp >= 0 !== sq >= 0) {
      const t = sp / (sp - sq);
      out.push(px + (qx - px) * t, pz + (qz - pz) * t);
    }
  }
  return out.length >= 6 ? out : null;
}

/**
 * A closed ring (the first point not repeated) with the points nearer than
 * `tolerance` to the line of their neighbours left out, as Douglas-Peucker
 * does, from its two points farthest apart; null when fewer than three
 * points or no area are left
 */
export function simplifyRing(ring: readonly MapPoint[], tolerance: number): MapPoint[] | null {
  const pts = ring.length > 1 && ring[0].x === ring[ring.length - 1].x && ring[0].y === ring[ring.length - 1].y ? ring.slice(0, -1) : [...ring];
  if (pts.length < 3) return null;
  // Split at the point farthest from the first, simplify both halves
  let far = 0;
  let best = -1;
  for (let k = 1; k < pts.length; k++) {
    const d = (pts[k].x - pts[0].x) ** 2 + (pts[k].y - pts[0].y) ** 2;
    if (d > best) {
      best = d;
      far = k;
    }
  }
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[far] = 1;
  const stack: [number, number][] = [[0, far], [far, pts.length]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const a = pts[i];
    const b = pts[j % pts.length];
    let worst = -1;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      const d = pointLine(pts[k], a, b);
      if (d > worst) {
        worst = d;
        at = k;
      }
    }
    if (at >= 0 && worst > tolerance) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  const out = pts.filter((_, k) => keep[k]);
  if (out.length < 3) return null;
  let s = 0;
  for (let i = 0, j = out.length - 1; i < out.length; j = i++) s += out[j].x * out[i].y - out[i].x * out[j].y;
  return Math.abs(s) > 1 ? out : null;
}

function pointLine(p: MapPoint, a: MapPoint, b: MapPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
