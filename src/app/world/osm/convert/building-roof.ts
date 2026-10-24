/**
 * A raised building's roof by its tags, kind and outline (building-mass.ts):
 * its shape and pitch, a church's steeple, the ridge's direction (tagged,
 * across the street or along the long side), the outline simplified for it.
 */
import type { BuildingKind } from '../building-tags';
import type { MapMass, MapMassPart, MapMassRoof, MapPoint } from '../../custom-map/map-document';
import { round2, round3 } from './geom';
import { MASS_MAX_POINTS, massApex, ringArea2 } from '../../custom-map/object-mass';
import { massRectAxes, roofRun } from '../../custom-map/mass-roof';
import { toModel } from '../../custom-map/object-ground';
import { simplifyRing } from '../../../map-ops/lines';

/** Points nearer than this (m) to the line of their neighbours go (Douglas-Peucker) */
export const SIMPLIFY_M = 0.35;

/** A tower's pyramid, degrees */
export const TOWER_PITCH = 62;
/** Highest a mansard's slopes rise, m */
const MANSARD_RISE = 7;

/** Kinds that take a pitched roof where the footprint allows one, and its pitch in degrees */
export const PITCH: Partial<Record<BuildingKind, number>> = {
  house: 38,
  semi: 38,
  terrace: 38,
  farm: 22,
  church: 48,
  chapel: 45,
  station: 30,
  garage: 12,
  clubhouse: 25,
  shed: 15,
  oldtown: 55,
  palace: 42,
  castle: 45,
  cathedral: 50,
  townhall: 50,
  gate: 50,
  tower: TOWER_PITCH,
};

/** A footprint's turned rectangle as convert/buildings.ts finds it: middle, unit axis along side `a`, sides */
export interface MassRect {
  c: MapPoint;
  u: MapPoint;
  a: number;
  b: number;
}

/**
 * OSM `roof:shape` values as the roofs drawn (mass-roof.ts): the ridged ones
 * over any outline, a lean-to as a skillion; onion, dome and spire as a
 * pyramid until L5, many-sided ones (`many`, `quadruple_saltbox`) hipped.
 * Others stand flat at half their roof's height
 */
export const ROOF_SHAPES: Readonly<Record<string, MapMassRoof>> = {
  flat: 'flat',
  gabled: 'gable',
  gambrel: 'gable',
  round: 'gable',
  saltbox: 'gable',
  double_saltbox: 'gable',
  'half-hipped': 'halfhip',
  'side_half-hipped': 'halfhip',
  hipped: 'hip',
  side_hipped: 'hip',
  quadruple_saltbox: 'hip',
  many: 'hip',
  crosspitched: 'hip',
  mansard: 'mansard',
  skillion: 'skillion',
  lean_to: 'skillion',
  pyramidal: 'pyramid',
  cone: 'pyramid',
  conical: 'pyramid',
  onion: 'pyramid',
  dome: 'pyramid',
  spire: 'pyramid',
  helm: 'pyramid',
};

/** Pitches of the roofs no tag or kind gives one, degrees: a lean-to's, a mansard's steep slopes, any other */
export const SKILLION_PITCH = 18;
export const MANSARD_PITCH = 62;
export const ANY_PITCH = 40;
/** Highest rise of a building's sloped roof by its pitch, m: a house's, a large landmark's, a tower's helm */
export const RIDGE_MOST = 14;
export const LANDMARK_RIDGE_MOST = 18;
export const TOWER_RIDGE_MOST = 24;
/** A sloped roof over a building tagged with `height` but not `roof:height` takes at most this share of it */
export const ROOF_SHARE = 0.45;

/**
 * The roof a footprint takes: its `roof:shape` (ROOF_SHAPES), else its
 * kind's, and the pitch from `roof:angle`, else the kind's. Untagged a tower
 * has a helm; an old-town house a gable, now and then a half-hip or, when
 * large, a hip; a house a gable or a hip; a palace, a castle, a town hall,
 * a station and an old town's large blocks a hip; a church a steep gable;
 * the kinds without a pitch (blocks, halls, offices) a flat roof
 */
export function roofOf(tags: Readonly<Record<string, string>>, kind: BuildingKind, tower: boolean, oldTown: boolean, salt: number, area: number): { roof: MapMassRoof; pitch: number } {
  const angle = parseFloat(tags['roof:angle'] ?? '');
  const own = angle > 3 && angle < 80 ? angle : null;
  const shape = tags['roof:shape'];
  if (shape !== undefined) {
    const roof = ROOF_SHAPES[shape] ?? 'flat';
    const pitch = own ?? (roof === 'skillion' ? SKILLION_PITCH : roof === 'mansard' ? MANSARD_PITCH : roof === 'pyramid' ? TOWER_PITCH : (PITCH[kind] ?? ANY_PITCH));
    return { roof, pitch };
  }
  if (tower) return { roof: 'pyramid', pitch: own ?? TOWER_PITCH };
  const pitch = PITCH[kind];
  if (pitch === undefined) {
    // An old town has hardly a flat roof: its large blocks are hipped
    const block = kind === 'apartments' || kind === 'civic' || kind === 'office' || kind === 'school';
    return oldTown && block ? { roof: 'hip', pitch: own ?? 45 } : { roof: 'flat', pitch: 0 };
  }
  let roof: MapMassRoof = 'gable';
  if (kind === 'oldtown') roof = salt % 6 === 0 ? 'halfhip' : area > 350 && salt % 2 === 0 ? 'hip' : 'gable';
  else if (kind === 'house' || kind === 'semi' || kind === 'terrace') roof = salt % 3 === 0 ? 'hip' : salt % 7 === 1 ? 'halfhip' : 'gable';
  else if (kind === 'palace' || kind === 'castle' || kind === 'townhall' || kind === 'station') roof = 'hip';
  return { roof, pitch: own ?? pitch };
}

/** A church's footprint at least this big (m²) and this full of its rectangle gets a steeple when OSM draws none */
const STEEPLE_AREA = 250;
const STEEPLE_FILL = 0.7;
/** The steeple's side: this share of the nave's width, within these metres */
const STEEPLE_SHARE = 0.55;
const STEEPLE_SIDE = [4.5, 8] as const;
/** Its walls this many times the nave's, at least and at most these metres; its helm this many times its side */
const STEEPLE_RISE = 2.2;
const STEEPLE_HEIGHT = [20, 42] as const;
const STEEPLE_HELM = 2.4;

/**
 * The steeple of a church OSM gives only its outline (no `building:part`):
 * a square stone tower at the nave's west end, inside its footprint, with a
 * steep helm, as most village and town churches stand. Null for a small or
 * irregular footprint, a ruin, and a nave no longer than wide
 */
export function steepleOf(
  outer: readonly MapPoint[],
  holes: readonly (readonly MapPoint[])[],
  rect: MassRect,
  area: number,
  tags: Readonly<Record<string, string>>,
  local: (ring: readonly MapPoint[]) => number[],
  naveHeight: number,
): MapMassPart | null {
  if (area < STEEPLE_AREA || area / (rect.a * rect.b) < STEEPLE_FILL || holes.length) return null;
  if (tags['ruins'] || tags['building'] === 'ruins' || tags['historic'] === 'ruins') return null;
  const long = Math.max(rect.a, rect.b);
  const wide = Math.min(rect.a, rect.b);
  if (long < wide * 1.3) return null;
  // The nave's axis, towards the west (map x is east)
  let axis = rect.a >= rect.b ? rect.u : { x: -rect.u.y, y: rect.u.x };
  if (axis.x > 0) axis = { x: -axis.x, y: -axis.y };
  const across = { x: -axis.y, y: axis.x };
  const side = round2(Math.min(STEEPLE_SIDE[1], Math.max(STEEPLE_SIDE[0], wide * STEEPLE_SHARE)));
  const reach = long / 2 - side / 2;
  const mid = { x: rect.c.x + axis.x * reach, y: rect.c.y + axis.y * reach };
  const corner = (along: number, out: number): MapPoint => ({
    x: mid.x + (axis.x * along + across.x * out) * side * 0.5,
    y: mid.y + (axis.y * along + across.y * out) * side * 0.5,
  });
  const ring = local([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]);
  const height = round2(Math.min(STEEPLE_HEIGHT[1], Math.max(STEEPLE_HEIGHT[0], naveHeight * STEEPLE_RISE)));
  return { rings: [ring], height, floors: Math.max(1, Math.round(height / 4)), roof: 'pyramid', ridge: round2(side * STEEPLE_HELM), facade: 'stone' };
}

/** A sloped roof's fields on a building or a part (MapMass.ridge, roofDirection, roofAcross) and its rise */
interface RoofFit {
  roof: MapMassRoof;
  ridge: number;
  fields: Pick<MapMass, 'ridge' | 'roofDirection' | 'roofAcross' | 'shared'>;
}

/**
 * The measures of `roof` over `rings` (in the building's axes): its rise the
 * tagged `roof:height`, else as its pitch makes it over the widest wing (a
 * mansard's over its run, a skillion's over its depth, a ridge across a
 * rectangle over half its length), at most `most`; a skillion's way down
 * from `roof:direction` (or `down`, else across its rectangle by the salt),
 * a gable's ridge across from `roof:orientation` or `roof:direction`. A
 * pyramid its middle does not see whole is a hip; null where no roof of the
 * kind can be made over the outline (mass-roof.ts) and it stands flat
 */
export function roofFit(
  rings: number[][],
  wanted: MapMassRoof,
  pitchDeg: number,
  tagged: number | null,
  most: number,
  tags: Readonly<Record<string, string>>,
  rotation: number,
  salt: number,
  rect: MassRect | null,
  down: number | null = null,
  shared: readonly number[] = [],
): RoofFit | null {
  const tan = Math.tan((Math.min(80, Math.max(3, pitchDeg)) * Math.PI) / 180);
  let roof = wanted;
  if (roof === 'pyramid') {
    const area = Math.abs(ringArea2(rings[0]));
    const ridge = rings.length === 1 ? pyramidRidge(rings[0], tagged ?? 0, pitchDeg, area) : null;
    if (ridge) return { roof, ridge, fields: { ridge } };
    roof = 'hip';
  }
  const fields: RoofFit['fields'] = {};
  let run: number | null;
  if (roof === 'skillion') {
    const dir = compass(tags['roof:direction']);
    // OSM's way down is a bearing on the map (x east, y north): turned into the building's axes
    fields.roofDirection = round3(dir !== null ? modelAngle(Math.sin(dir), Math.cos(dir), rotation) : down ?? defaultDown(rect, rotation, salt));
    run = roofRun({ rings, roof, ridge: 1, roofDirection: fields.roofDirection });
  } else {
    const across = roof === 'gable' && rings.length === 1 && acrossWanted(tags, rings[0], rotation);
    if (across) fields.roofAcross = true;
    if (shared.length) fields.shared = [...shared];
    run = roofRun({ rings, roof, ridge: 1, ...fields });
    if (run === null && fields.shared) {
      delete fields.shared;
      run = roofRun({ rings, roof, ridge: 1, ...fields });
    }
  }
  if (run === null) return null;
  const ridge = round2(Math.max(0.3, Math.min(MAX_RIDGE, tagged ?? Math.min(roof === 'mansard' ? MANSARD_RISE : most, run * tan))));
  fields.ridge = ridge;
  // The run was measured over the roof's skeleton: a model can be made (mass-roof.ts roofRun)
  return { roof, ridge, fields };
}

/** Whether a gable's ridge runs across its rectangle: `roof:orientation=across`, or `roof:direction` along its longer side */
function acrossWanted(tags: Readonly<Record<string, string>>, ring: readonly number[], rotation: number): boolean {
  const axes = massRectAxes(ring);
  if (!axes) return false;
  if (tags['roof:orientation'] === 'across') return true;
  if (tags['roof:orientation'] === 'along') return false;
  const dir = compass(tags['roof:direction']);
  if (dir === null) return false;
  // The slopes face the way the tag says: along the longer side means the ridge across it
  const a = modelAngle(Math.sin(dir), Math.cos(dir), rotation);
  return Math.abs(Math.cos(a) * axes.ux + Math.sin(a) * axes.uz) > 0.7;
}

/** A skillion's way down without a tag: across its rectangle's longer side, one way or the other by the salt */
function defaultDown(rect: MassRect | null, rotation: number, salt: number): number {
  if (!rect) return Math.PI / 2;
  // The rectangle's side b runs along v, a quarter turn left of u on the map
  const sign = salt % 2 ? 1 : -1;
  return modelAngle(-rect.u.y * sign, rect.u.x * sign, rotation);
}

/** A direction on the map (x east, y north) as an angle in the building's axes (from model +x towards +z) */
function modelAngle(dx: number, dy: number, rotation: number): number {
  const m = toModel(dx, dy, Math.cos(rotation), Math.sin(rotation));
  return Math.atan2(m.z, m.x);
}

/** Compass points of `roof:direction` */
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** `roof:direction` (degrees from north, clockwise, or a compass point) in radians; null for none */
export function compass(value: string | undefined): number | null {
  if (!value) return null;
  const v = value.trim().toUpperCase();
  const k = COMPASS.indexOf(v);
  const deg = k >= 0 ? k * 22.5 : parseFloat(v.replace(',', '.'));
  return Number.isFinite(deg) ? (((deg % 360) + 360) % 360) * (Math.PI / 180) : null;
}

/**
 * The outline and its courtyards in the building's axes, simplified, more
 * until they leave `spare` of the points a building may have; none when the
 * outline is gone
 */
export function simplifiedRings(outer: readonly MapPoint[], holes: readonly (readonly MapPoint[])[], local: (ring: readonly MapPoint[]) => number[], used: number, tolerance = SIMPLIFY_M): number[][] {
  let rings: number[][] = [];
  for (let tries = 0; tries < 6; tries++, tolerance *= 1.8) {
    const out = simplifyRing(outer, tolerance);
    if (!out) return [];
    rings = [local(out)];
    for (const h of holes) {
      const ring = simplifyRing(h, tolerance);
      if (ring) rings.push(local(ring));
    }
    if (used + rings.reduce((s, r) => s + r.length / 2, 0) <= MASS_MAX_POINTS) break;
  }
  return rings;
}

/** A pyramid's rise over an outline its middle sees whole (massApex): the tagged `roof:height`, else by its pitch over its mean radius; null for none */
function pyramidRidge(ring: number[], tagged: number, pitchDeg: number, area: number): number | null {
  const ridge = round2(Math.min(MAX_RIDGE, tagged > 0 ? tagged : Math.sqrt(area / Math.PI) * Math.tan((pitchDeg * Math.PI) / 180)));
  return ridge > 0.2 && massApex({ rings: [ring], height: 1, floors: 1, roof: 'pyramid', ridge, facade: 'stone' }) ? ridge : null;
}

/** Highest roof a building or a part may have, m (map-repair.ts massProblem) */
export const MAX_RIDGE = 60;
