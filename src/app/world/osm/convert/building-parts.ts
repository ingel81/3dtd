/**
 * OSM's parts of a building (Simple 3D Buildings) as the parts of its
 * raised mass (building-mass.ts): each part's storeys, height and roof,
 * the walls it shares with its neighbours, the footprint they leave
 * uncovered filled.
 */
import type { MapMass, MapMassFacade, MapMassPart, MapMassRoof, MapPoint } from '../../custom-map/map-document';
import type { BuildingKind } from '../building-tags';
import { ringArea } from '../square-clip';
import { MASS_MAX_PARTS, MASS_MAX_POINTS, MASS_PARAPET, offsetRing, ringArea2, ringsContain } from '../../custom-map/object-mass';
import { ANY_PITCH, compass, MANSARD_PITCH, MAX_RIDGE, PITCH, ROOF_SHAPES, roofFit, simplifiedRings, SIMPLIFY_M, SKILLION_PITCH, TOWER_PITCH } from './building-roof';
import { round2 } from './geom';
import { roofRun } from '../../custom-map/mass-roof';
import { count, MATERIALS, metres, PLINTH, roofLook, storeyOf, tagColour } from './building-look';
import { minAreaRect } from '../../custom-map/map-surfaces';

/**
 * A part of a building in OSM (`building:part`) as the import reads it: its
 * outline and courtyards in map space, its tags
 */
export interface OsmPart {
  outer: readonly MapPoint[];
  holes: readonly (readonly MapPoint[])[];
  tags: Readonly<Record<string, string>>;
}

/** `building:part` values that show nothing outside: a lift's shaft, a room, a floor inside the building */
const HIDDEN_PARTS: ReadonlySet<string> = new Set(['no', 'elevator', 'room', 'rooms', 'floor', 'level', 'corridor', 'shaft']);

/** Whether a `building:part` stands to be seen: not hidden inside (HIDDEN_PARTS), not under the ground */
export function isDrawnPart(tags: Readonly<Record<string, string>>): boolean {
  const part = tags['building:part'];
  return !!part && !HIDDEN_PARTS.has(part) && tags['location'] !== 'underground' && !(parseInt(tags['layer'] ?? '0', 10) < 0);
}

/** Share of the footprint its parts cover at least, else a part of its own fills the rest */
const PARTS_COVER = 0.97;
/** How far that filling part keeps inside the footprint's walls and off its courtyards, m: never in the plane of a part's wall */
const FILL_INSET = 0.15;
/** Points of the footprint the parts' cover is measured at, about */
const COVER_SAMPLES = 600;

/**
 * A footprint with parts raised as them (raiseMass): each part's own
 * outline, floor, walls, roof and colours (partOf), the footprint's rings
 * its ground, and where the parts leave more than 1 - PARTS_COVER of it
 * bare a part of the footprint's own height fills it, drawn in from its
 * walls. Null when no part stands
 */
export function partsMass(
  outer: readonly MapPoint[],
  holes: readonly (readonly MapPoint[])[],
  local: (ring: readonly MapPoint[]) => number[],
  rotation: number,
  parts: readonly OsmPart[],
  kind: BuildingKind,
  tags: Readonly<Record<string, string>>,
  area: number,
  levels: { floors: number; height: number },
  facade: MapMassFacade,
  roofColour: Pick<MapMass, 'roofTint' | 'roofCover'>,
): MapMass | null {
  // The biggest first, as many as a building may have
  const sorted = parts
    .map((p) => ({ p, area: Math.abs(ringArea(p.outer)) - p.holes.reduce((s, h) => s + Math.abs(ringArea(h)), 0) }))
    .filter((q) => q.area >= 1)
    .sort((a, b) => b.area - a.area)
    .slice(0, MASS_MAX_PARTS - 1);
  for (let tolerance = SIMPLIFY_M, tries = 0; tries < 6; tolerance *= 1.8, tries++) {
    const rings = simplifiedRings(outer, holes, local, 0, tolerance);
    if (!rings.length) return null;
    let points = rings.reduce((s, r) => s + r.length / 2, 0);
    const own: MapMassPart[] = [];
    const from: { p: OsmPart; area: number }[] = [];
    for (const q of sorted) {
      const part = partOf(q.p, q.area, local, rotation, kind, levels, facade, tolerance);
      if (!part) continue;
      own.push(part);
      from.push(q);
      points += part.rings.reduce((s, r) => s + r.length / 2, 0);
    }
    if (!own.length) return null;
    // A lean-to without its way down slopes away from the higher part it leans on
    own.forEach((part, k) => {
      if (part.roof !== 'skillion' || compass(from[k].p.tags['roof:direction']) !== null) return;
      const down = leanAway(part, own);
      if (down === null) return;
      const leaning = partOf(from[k].p, from[k].area, local, rotation, kind, levels, facade, tolerance, down);
      if (leaning) own[k] = leaning;
    });
    // What the parts leave bare of the footprint: filled by a part of its own, a little inside its walls
    let fill: MapMassPart | null = null;
    if (partsCover(rings, own) < PARTS_COVER) {
      fill = fillPart(rings, own, levels);
      if (fill) points += fill.rings.reduce((s, r) => s + r.length / 2, 0);
    }
    // Walls against another part (a wing against its corner tower or the next wing): its roof ends there upright
    const all = fill ? [...own, fill] : own;
    const shared = own.map((part) => partWalls(part, all));
    shared.forEach((walls, k) => {
      if (!walls.length) return;
      // No higher a roof than before: the slopes over the wings left lie flatter, not taller
      const standing = partOf(from[k].p, from[k].area, local, rotation, kind, levels, facade, tolerance, null, walls, own[k].ridge);
      if (standing) own[k] = standing;
    });
    if (fill) own.push(fill);
    if (points > MASS_MAX_POINTS && tries < 5) continue;
    const height = round2(Math.max(...own.map((q) => q.height)));
    return { rings, height, floors: levels.floors, roof: 'flat', facade, ...roofColour, parts: own };
  }
  return null;
}

/** How far past a wall another building or part must stand to share it, m */
const SHARED_REACH = 0.4;

/**
 * The walls of a ring (x, z pairs, the outline) another building or part
 * stands against (MapMass.shared): `inside` holds the ground a little past
 * four of five points along it, so a wall another stands against only in
 * part keeps its slope; walls under a metre do not count
 */
export function sharedWalls(ring: readonly number[], inside: (x: number, z: number) => boolean): number[] {
  const out: number[] = [];
  const n = ring.length / 2;
  const s = ringArea2(ring) > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = ring[2 * j] - ring[2 * i];
    const ez = ring[2 * j + 1] - ring[2 * i + 1];
    const len = Math.hypot(ex, ez);
    if (len < 1) continue;
    // Out of a counter-clockwise ring is right of its walls
    const nx = (ez / len) * s;
    const nz = (-ex / len) * s;
    let hits = 0;
    for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) if (inside(ring[2 * i] + ex * f + nx * SHARED_REACH, ring[2 * i + 1] + ez * f + nz * SHARED_REACH)) hits++;
    if (hits >= 4) out.push(i);
  }
  return out;
}

/**
 * The walls a part of a raised building shares with another part standing
 * there at its eaves (a wing against its corner tower, a wing against the
 * next one): no slope of its roof rises from them (MapMassPart.shared)
 */
function partWalls(p: MapMassPart, parts: readonly MapMassPart[]): number[] {
  if (p.roof !== 'gable' && p.roof !== 'hip' && p.roof !== 'halfhip' && p.roof !== 'mansard') return [];
  // Standing from under its eaves to half way up its roof at least: a lower one leaves its slopes free
  const others = parts.filter((q) => q !== p && (q.base ?? 0) < p.height - 0.5 && q.height + (q.ridge ?? 0) >= p.height + 0.5 * (p.ridge ?? 0));
  return others.length ? sharedWalls(p.rings[0], (x, z) => others.some((q) => ringsContain(q.rings, x, z))) : [];
}

/**
 * A raised building's walls another building stands against (a party wall,
 * MapMass.shared): its sloped roof ends there in a gable (a narrow town
 * house between two others is sloped front and back, its ridge along the
 * street). Its rise stays: walls standing still only make the wings the
 * slopes span deeper, so they lie flatter, the roof no higher; dropped where
 * no roof can be made so
 */
export function shareWalls(mass: MapMass, shared: readonly number[]): void {
  if (!shared.length || mass.parts || (mass.roof !== 'gable' && mass.roof !== 'hip' && mass.roof !== 'halfhip' && mass.roof !== 'mansard')) return;
  if (roofRun({ ...mass, shared: [...shared] }) !== null) mass.shared = [...shared];
}

/** Share of the footprint (rings in the building's axes) under its parts, on a raster of about COVER_SAMPLES points */
export function partsCover(rings: readonly (readonly number[])[], parts: readonly Pick<MapMassPart, 'rings'>[]): number {
  const r = rings[0];
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
  const cell = Math.max(0.25, Math.sqrt(((maxX - minX) * (maxZ - minZ)) / COVER_SAMPLES));
  let inside = 0;
  let covered = 0;
  for (let z = minZ + cell / 2; z < maxZ; z += cell) {
    for (let x = minX + cell / 2; x < maxX; x += cell) {
      if (!ringsContain(rings, x, z)) continue;
      inside++;
      if (parts.some((p) => ringsContain(p.rings, x, z))) covered++;
    }
  }
  return inside ? covered / inside : 1;
}

/**
 * The part that fills what the parts leave bare: the footprint drawn in
 * FILL_INSET from its walls (its courtyards out as far), flat, as high as
 * the footprint's own walls but no higher than its lowest part on the
 * ground; null where the drawn-in outline crosses itself
 */
function fillPart(rings: readonly number[][], parts: readonly MapMassPart[], levels: { floors: number; height: number }): MapMassPart | null {
  const outer = offsetRing(rings[0], FILL_INSET);
  if (!outer) return null;
  const courts = rings.slice(1).map((h) => offsetRing(h, -FILL_INSET));
  const ground = parts.filter((p) => !(p.base ?? 0)).map((p) => p.height);
  const height = round2(Math.min(levels.height + MASS_PARAPET, ...ground));
  if (height < 2) return null;
  return { rings: [outer.map(round2), ...courts.filter((h): h is number[] => !!h).map((h) => h.map(round2))], height, floors: levels.floors, roof: 'flat' };
}

/**
 * One `building:part` as a part of the raised building: its outline in the
 * building's axes; its floor from `min_height` (or `building:min_level`
 * storeys); its top from `height`, else `building:levels`, else the
 * building's own (a tower a storey higher); its roof from `roof:shape`,
 * `roof:height`, `roof:angle`, `roof:direction`, `roof:orientation` over its
 * real outline (roofFit; a skillion without a way down slopes `down`, away
 * from a higher part it leans on, partsMass; a shape not drawn stands flat
 * at half its roof's height); its storeys from `building:levels`; its walls
 * and colours from `building:material`, `building:colour`, `roof:colour`,
 * `roof:material`. Null where nothing of it stands
 */
function partOf(
  part: OsmPart,
  area: number,
  local: (ring: readonly MapPoint[]) => number[],
  rotation: number,
  kind: BuildingKind,
  levels: { floors: number; height: number },
  facade: MapMassFacade,
  tolerance: number,
  down: number | null = null,
  shared: readonly number[] = [],
  most = MAX_RIDGE,
): MapMassPart | null {
  const t = part.tags;
  const tower = t['man_made'] === 'tower' || t['building:part'] === 'tower' || !!t['tower:type'];
  const storey = storeyOf(kind);
  // Untagged a part is flat (OSM's default for parts)
  const wanted = ROOF_SHAPES[t['roof:shape'] ?? 'flat'] ?? 'flat';
  const angle = parseFloat(t['roof:angle'] ?? '');
  const pitchDeg = angle > 3 && angle < 85
    ? angle
    : wanted === 'pyramid' || tower ? TOWER_PITCH : wanted === 'skillion' ? SKILLION_PITCH : wanted === 'mansard' ? MANSARD_PITCH : (PITCH[kind] ?? ANY_PITCH);
  const tagged = metres(t, 'roof:height');
  const rings = simplifiedRings(part.outer, part.holes, local, 0, tolerance);
  if (!rings.length) return null;
  const fit = wanted === 'flat' ? null : roofFit(rings, wanted, pitchDeg, tagged, most, t, rotation, Math.round(area), minAreaRect(part.outer), down, shared);
  const roof: MapMassRoof = fit?.roof ?? 'flat';
  let ridge = fit?.ridge ?? 0;
  const height = metres(t, 'height');
  const own = count(t, 'building:levels');
  const minLevel = count(t, 'building:min_level');
  const base = round2(metres(t, 'min_height') ?? (minLevel ? PLINTH + minLevel * storey : 0));
  // The top of the walls: the tagged height less the roof drawn on it (a roof not drawn: half of it), else the storeys
  let top = height !== null
    ? height - (roof === 'flat' ? (tagged ?? 0) / 2 : ridge)
    : own !== null
      ? PLINTH + own * storey
      : levels.height + (tower ? storey : 0);
  if (top < base + 1) {
    // A roof taller than its part: the walls a metre at least, the roof the rest
    top = base + 1;
    if (height !== null && roof !== 'flat') ridge = round2(Math.max(0.5, height - top));
  }
  if (roof === 'flat') top += MASS_PARAPET;
  const floors = Math.min(120, Math.max(1, own ?? Math.round((top - PLINTH) / storey)));
  const wall = MATERIALS[t['building:material'] ?? t['building:facade:material'] ?? ''];
  const tint = tagColour(t['building:colour'], (wall ?? facade) === 'stone');
  const look = roofLook(t);
  return {
    rings,
    ...(base > 0 ? { base } : {}),
    height: round2(Math.min(400, top)),
    floors,
    roof,
    ...(fit ? { ...fit.fields, ridge } : {}),
    ...(wall && wall !== facade ? { facade: wall } : {}),
    ...(tint ? { tint } : {}),
    ...look,
  };
}

/**
 * The way down of a skillion part that OSM gives none: away from the higher
 * part it leans on (an aisle's roof down from the nave), the wall it shares
 * with it the longest; null where it leans on none
 */
function leanAway(part: MapMassPart, parts: readonly MapMassPart[]): number | null {
  const ring = part.rings[0];
  const top = part.height + (part.ridge ?? 0);
  let best = 0;
  let way: number | null = null;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const ex = ring[i] - ring[j];
    const ez = ring[i + 1] - ring[j + 1];
    const len = Math.sqrt(ex * ex + ez * ez);
    if (len < 1) continue;
    const mx = (ring[i] + ring[j]) / 2;
    const mz = (ring[i + 1] + ring[j + 1]) / 2;
    // The wall's normal pointing into the part
    let nx = -ez / len;
    let nz = ex / len;
    if (!ringsContain(part.rings, mx + nx * 0.05, mz + nz * 0.05)) {
      nx = -nx;
      nz = -nz;
    }
    // A higher part just outside this wall
    const higher = parts.some((q) => q !== part && q.height > top - 0.5 && ringsContain(q.rings, mx - nx * 0.6, mz - nz * 0.6));
    if (higher && len > best) {
      best = len;
      way = Math.atan2(nz, nx);
    }
  }
  return way;
}
