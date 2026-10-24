/**
 * Footprints no catalogue model covers raised as they are (docs/OSM_WORLD_PLAN.md,
 * "Gebäude aus dem Grundriss"): the outline and its courtyards, simplified,
 * as the rings of a MapMass in the object's own axes; its height from
 * `height` or `building:levels`, else guessed from the kind and the size;
 * its roof from `roof:shape`, `roof:height`, `roof:angle`, `roof:direction`
 * and `roof:orientation`, else by kind, sloped over the real outline
 * (custom-map/mass-roof.ts: gable, hip, half-hip, mansard, skillion per
 * wing, docs/OSM_LANDMARKS_PLAN.md L4); its walls from `building:material`, else
 * by kind; its tint from `building:colour`, else one of its facade's.
 *
 * A footprint with parts (`building:part` inside it, Simple 3D Buildings;
 * docs/OSM_LANDMARKS_PLAN.md L3) is raised as its parts: each its own
 * outline in the building's frame, from `min_height` (or
 * `building:min_level`) to `height` (or `building:levels`), its own roof
 * from `roof:shape` and `roof:height`, its own walls and colours from
 * `building:material`, `building:colour`, `roof:colour`, `roof:material`;
 * the footprint gives the kind, the facade and the tint where a part has
 * none, and where the parts leave much of it bare a part of its own fills it.
 */
import type { MapMass, MapMassCover, MapMassFacade, MapMassPart, MapMassRoof, MapPoint } from '../../custom-map/map-document';
import { massRectAxes, roofRun } from '../../custom-map/mass-roof';
import {
  MASS_MAX_PARTS,
  MASS_MAX_POINTS,
  MASS_PARAPET,
  massApex,
  offsetRing,
  ringArea2,
  ringsContain,
  segmentDistance,
} from '../../custom-map/object-mass';
import { toModel } from '../../custom-map/object-ground';
import { minAreaRect } from '../../custom-map/map-surfaces';
import { buildingLevels, type BuildingKind } from '../building-tags';
import { ringArea } from '../square-clip';
import { pointSegmentDistance } from '../../../map-ops/path-graph';
import { round2, round3 } from './geom';

/** Points nearer than this (m) to the line of their neighbours go (Douglas-Peucker) */
const SIMPLIFY_M = 0.35;
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
/** A castle's, a palace's, a town hall's and a gate's storeys: high halls, m */
const HALL_STOREY = 4.2;
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
  clubhouse: { floors: 1 },
  oldtown: { floors: 3 },
  palace: { floors: 3 },
  castle: { floors: 3 },
  townhall: { floors: 3 },
  gate: { floors: 3 },
  tower: { floors: 6 },
  cathedral: { hall: 22 },
  monument: { hall: 6 },
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
  clubhouse: 'plaster',
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
  palace: 'stone',
  castle: 'stone',
  cathedral: 'stone',
  tower: 'stone',
  gate: 'stone',
  townhall: 'stone',
  monument: 'stone',
};

/** Landmark kinds: their storeys are high halls (HALL_STOREY), their stone takes the tints of building stone (LANDMARK_TINTS) */
const LANDMARK_KINDS: ReadonlySet<BuildingKind> = new Set(['palace', 'castle', 'cathedral', 'tower', 'gate', 'townhall', 'monument']);

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

/**
 * The stone of landmarks without `building:colour`, by the footprint's salt
 * (no two castles alike), over the facade's own stone: a castle's, a
 * tower's, a church's grey, red or brown rubble and yellow sandstone; a
 * palace's dressed sandstone, red, yellow or pale, or limestone
 */
const LANDMARK_TINTS: readonly string[] = ['#cfc8bd', '#c98a72', '#b9a58c', '#e2c9a4', '#b9724f'];
const PALACE_TINTS: readonly string[] = ['#c98a72', '#e2c9a4', '#d9a07f', '#ece4d2'];

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
  black: '#3a3a3a',
  anthracite: '#383e42',
  darkgrey: '#7a7a78',
  darkgray: '#7a7a78',
  lightgrey: '#d3d3d0',
  lightgray: '#d3d3d0',
  silver: '#c0c0c0',
  antiquewhite: '#faebd7',
  ivory: '#f8f6ec',
  linen: '#f6f0e6',
  wheat: '#f0dcb4',
  tan: '#d2b48c',
  khaki: '#d8cc98',
  sandybrown: '#e4a868',
  darkred: '#8b2f2a',
  maroon: '#7a2c28',
  sienna: '#a0522d',
  salmon: '#e9967a',
  ochre: '#d0a050',
  copper: '#4a9a88',
  teal: '#4a8a88',
  darkgreen: '#4e6e48',
  navy: '#3a4a6a',
};

/**
 * Colour names on stone walls: the building stones of LANDMARK_TINTS, not
 * paint (a castle `building:colour=red` is red sandstone, not a red wall)
 */
const STONE_NAMED: Readonly<Record<string, string>> = {
  red: '#c98a72',
  pink: '#d9a07f',
  yellow: '#e2c9a4',
  beige: '#e2c9a4',
  cream: '#ece4d2',
  white: '#ece4d2',
  grey: '#cfc8bd',
  gray: '#cfc8bd',
  brown: '#b9a58c',
};

/** One raised building: its mass in the object's own axes, the object's place and turn, its tint */
interface RaisedMass {
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
interface MassRect {
  c: MapPoint;
  u: MapPoint;
  a: number;
  b: number;
}

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
 * OSM `roof:shape` values as the roofs drawn (mass-roof.ts): the ridged ones
 * over any outline, a lean-to as a skillion; onion, dome and spire as a
 * pyramid until L5, many-sided ones (`many`, `quadruple_saltbox`) hipped.
 * Others stand flat at half their roof's height
 */
const ROOF_SHAPES: Readonly<Record<string, MapMassRoof>> = {
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
const SKILLION_PITCH = 18;
const MANSARD_PITCH = 62;
const ANY_PITCH = 40;
/** Highest rise of a building's sloped roof by its pitch, m: a house's, a large landmark's, a tower's helm */
const RIDGE_MOST = 14;
const LANDMARK_RIDGE_MOST = 18;
const TOWER_RIDGE_MOST = 24;
/** A sloped roof over a building tagged with `height` but not `roof:height` takes at most this share of it */
const ROOF_SHARE = 0.45;

/**
 * The footprint (`outer` with its courtyards `holes`, in map space) raised
 * as a building of `kind`, laid in its rectangle's axes; with `parts`
 * (building:part in it, isDrawnPart) raised as those; null when nothing
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
  oldTown = false,
  parts: readonly OsmPart[] = [],
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
  // A tower (tagged one, or much higher than wide: a town hall's or a gate's): stone, storeys of its own, a steep pyramid
  const tower = kind === 'tower' || (area < TOWER_AREA && levels.height > TOWER_SLENDER * Math.sqrt(area));
  if (tower) levels.floors = Math.max(levels.floors, Math.round(levels.height / 4));
  const facade = tower && !MATERIALS[tags['building:material'] ?? ''] ? 'stone' : massFacade(tags, kind, oldTown);
  const tint = massTint(tags, facade, salt, tower || LANDMARK_KINDS.has(kind) ? kind : null);
  const roofColour = roofLook(tags);
  const placed = { centre: rect.c, rotation, front, hw: rect.a / 2, hd: rect.b / 2, tint };
  const drawn = parts.filter((p) => isDrawnPart(p.tags));
  if (drawn.length) {
    const mass = partsMass(outer, holes, local, rotation, drawn, kind, tags, area, levels, facade, roofColour);
    if (!mass) return null;
    // Untagged, the building takes the colours most of its parts have: the parts without (a stair tower) match them
    const ownTint = tagColour(tags['building:colour'], facade === 'stone') ?? mostOf(mass.parts!.map((p) => p.tint));
    if (ownTint) {
      placed.tint = ownTint;
      for (const p of mass.parts!) if (p.tint === ownTint) delete p.tint;
    }
    if (!mass.roofTint && !mass.roofCover) {
      const look = mostOf(mass.parts!.map((p) => (p.roofTint || p.roofCover ? `${p.roofTint ?? ''}|${p.roofCover ?? ''}` : undefined)));
      if (look) {
        const [roofTint, roofCover] = look.split('|');
        if (roofTint) mass.roofTint = roofTint;
        if (roofCover) mass.roofCover = roofCover as MapMassCover;
      }
    }
    for (const p of mass.parts!) {
      if (p.roofTint === mass.roofTint && p.roofCover === mass.roofCover) {
        delete p.roofTint;
        delete p.roofCover;
      }
    }
    return { mass, ...placed };
  }
  // The real outline under the roof its tags ask for, else its kind's (deterministic by the footprint's salt)
  const rings = simplifiedRings(outer, holes, local, 0);
  if (!rings.length) return null;
  const wanted = roofOf(tags, kind, tower, oldTown, salt, area);
  const tagged = metres(tags, 'roof:height');
  const most = tower ? TOWER_RIDGE_MOST : LANDMARK_KINDS.has(kind) || kind === 'church' ? LANDMARK_RIDGE_MOST : RIDGE_MOST;
  // A tagged height without the roof's: the roof is part of it, the walls the rest
  const tallTag = metres(tags, 'height');
  const within = tallTag !== null && tagged === null ? tallTag * ROOF_SHARE : Infinity;
  const fit = wanted.roof === 'flat' ? null : roofFit(rings, wanted.roof, wanted.pitch, tagged, Math.min(most, within), tags, rotation, salt, rect);
  const roof: MapMassRoof = fit?.roof ?? 'flat';
  if (fit && tallTag !== null && tagged === null) {
    levels.height = Math.max(2.2, tallTag - fit.ridge);
    if (buildingLevels(tags) === null) levels.floors = Math.max(1, Math.round((levels.height - PLINTH) / storeyOf(kind)));
  }
  // A sloped roof's walls stop at the eaves; a flat one's go on to the parapet
  const height = round2(roof === 'flat' ? levels.height + MASS_PARAPET : levels.height);
  const steeple = kind === 'church' ? steepleOf(outer, holes, rect, area, tags, local, levels.height) : null;
  if (steeple) {
    const nave: MapMassPart = { rings, height, floors: levels.floors, roof, ...(fit ? fit.fields : {}) };
    const parts = [nave, steeple];
    return { mass: { rings, height: round2(Math.max(height, steeple.height)), floors: levels.floors, roof: 'flat', facade, ...roofColour, parts }, ...placed };
  }
  return {
    mass: { rings, height, floors: levels.floors, roof, ...(fit ? fit.fields : {}), facade, ...(roof !== 'flat' ? roofColour : {}) },
    ...placed,
  };
}

/**
 * The roof a footprint takes: its `roof:shape` (ROOF_SHAPES), else its
 * kind's, and the pitch from `roof:angle`, else the kind's. Untagged a tower
 * has a helm; an old-town house a gable, now and then a half-hip or, when
 * large, a hip; a house a gable or a hip; a palace, a castle, a town hall,
 * a station and an old town's large blocks a hip; a church a steep gable;
 * the kinds without a pitch (blocks, halls, offices) a flat roof
 */
function roofOf(tags: Readonly<Record<string, string>>, kind: BuildingKind, tower: boolean, oldTown: boolean, salt: number, area: number): { roof: MapMassRoof; pitch: number } {
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
function steepleOf(
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
function roofFit(
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
function compass(value: string | undefined): number | null {
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
function simplifiedRings(outer: readonly MapPoint[], holes: readonly (readonly MapPoint[])[], local: (ring: readonly MapPoint[]) => number[], used: number, tolerance = SIMPLIFY_M): number[][] {
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
const MAX_RIDGE = 60;

/** A number tag (`height`, `min_height`, `roof:height`, a comma for the point), null where missing or out of bounds */
function metres(tags: Readonly<Record<string, string>>, key: string): number | null {
  const v = parseFloat((tags[key] ?? '').replace(',', '.'));
  return v > 0 && v < 700 ? v : null;
}

/** A count tag (`building:levels`, `building:min_level`), null where missing */
function count(tags: Readonly<Record<string, string>>, key: string): number | null {
  const v = parseFloat(tags[key] ?? '');
  return v > 0 && v < 200 ? Math.round(v) : null;
}

/** The storey height of a kind, m */
function storeyOf(kind: BuildingKind): number {
  return kind === 'house' || kind === 'semi' || kind === 'terrace' || kind === 'apartments' || kind === 'oldtown'
    ? HOME_STOREY
    : kind === 'palace' || kind === 'castle' || kind === 'townhall' || kind === 'gate'
      ? HALL_STOREY
      : WORK_STOREY;
}

/**
 * A footprint with parts raised as them (raiseMass): each part's own
 * outline, floor, walls, roof and colours (partOf), the footprint's rings
 * its ground, and where the parts leave more than 1 - PARTS_COVER of it
 * bare a part of the footprint's own height fills it, drawn in from its
 * walls. Null when no part stands
 */
function partsMass(
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

/** A roof's colour and covering from `roof:colour` and `roof:material` (MapMass.roofTint, roofCover); none untagged */
function roofLook(tags: Readonly<Record<string, string>>): Pick<MapMass, 'roofTint' | 'roofCover'> {
  const roofTint = tagColour(tags['roof:colour'], false, true) ?? undefined;
  const roofCover = ROOF_MATERIALS[tags['roof:material'] ?? ''] ?? (roofTint ? coverOfColour(roofTint) : undefined);
  return { ...(roofTint ? { roofTint } : {}), ...(roofCover ? { roofCover } : {}) };
}

/** Coverings of `roof:material` values */
const ROOF_MATERIALS: Readonly<Record<string, MapMassCover>> = {
  roof_tiles: 'tiles',
  tiles: 'tiles',
  tile: 'tiles',
  clay: 'tiles',
  slate: 'slate',
  shingles: 'slate',
  stone: 'slate',
  eternit: 'slate',
  metal: 'metal',
  copper: 'metal',
  zinc: 'metal',
  tin: 'metal',
  lead: 'metal',
  steel: 'metal',
  metal_sheet: 'metal',
};

/** The covering a roof's colour suggests: red to brown clay tiles, green (copper) sheet metal, grey to black slate */
function coverOfColour(hex: string): MapMassCover {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max > 0 ? (max - min) / max : 0;
  if (sat < 0.25) return 'slate';
  if (r >= g && r >= b) return 'tiles';
  return g >= b || g > r ? 'metal' : 'slate';
}

/**
 * A colour tag (`building:colour`, `roof:colour`) as #rrggbb: a hex colour
 * or a known name; on stone (`stone`) the names are the colours of building
 * stone (STONE_NAMED), not of paint; null for none
 */
export function tagColour(value: string | undefined, stone: boolean, roof = false): string | null {
  const colour = (value ?? '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(colour)) return colour;
  if (/^#[0-9a-f]{3}$/.test(colour)) return `#${colour[1]}${colour[1]}${colour[2]}${colour[2]}${colour[3]}${colour[3]}`;
  return (roof ? ROOF_NAMED[colour] : stone ? STONE_NAMED[colour] : undefined) ?? NAMED[colour] ?? null;
}

/**
 * Colour names on roofs: slate, tiles and copper as they weather, not paint
 * (a `roof:colour=grey` is a slate roof, darker than a grey wall)
 */
const ROOF_NAMED: Readonly<Record<string, string>> = {
  grey: '#5f6368',
  gray: '#5f6368',
  darkgrey: '#45484d',
  darkgray: '#45484d',
  black: '#2f3134',
  anthracite: '#383c40',
  red: '#a4553f',
  brown: '#7b513c',
  green: '#5f8f78',
  blue: '#4c5d78',
};

/** The value most of a list have (the first of those as many), undefined for none */
function mostOf(values: readonly (string | undefined)[]): string | undefined {
  const counts = new Map<string, number>();
  let best: string | undefined;
  for (const v of values) {
    if (v === undefined) continue;
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (!best || n > counts.get(best)!) best = v;
  }
  return best;
}

/**
 * Storeys and the walls' height to the eaves or the roof (m, without a
 * parapet): `height` (less a pitched roof's `roof:height`), else
 * `building:levels` at the kind's storey, else the kind's own, a big hall a
 * little higher, a big block one storey more
 */
export function massLevels(tags: Readonly<Record<string, string>>, kind: BuildingKind, area: number): { floors: number; height: number } {
  const own = KIND_LEVELS[kind];
  const storey = storeyOf(kind);
  const tagged = parseFloat((tags['height'] ?? '').replace(',', '.'));
  if (tagged > 0 && tagged < 400) {
    const roofHeight = parseFloat((tags['roof:height'] ?? '').replace(',', '.'));
    const walls = Math.max(2.2, tagged - (roofHeight > 0 && roofHeight < tagged ? roofHeight : 0));
    // The storeys OSM counts where it does (a palace's three high ones under 19 m), else as many as fit
    const counted = buildingLevels({ 'building:levels': tags['building:levels'] ?? '' });
    if (counted !== null) return { floors: Math.min(120, counted), height: walls };
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
  // A big block one storey more; a castle's or a palace's wing by its size, its outbuildings lower
  const grand = kind === 'palace' || kind === 'castle';
  const floors = own.floors + (kind === 'apartments' && area > 900 ? 1 : 0) + (grand && area > 1500 ? 1 : 0) - (grand && area < 150 ? 1 : 0);
  return { floors, height: PLINTH + floors * storey };
}

/** The walls' look: `building:material` (or `building:facade:material`), else the kind's; a town hall in an old town half-timbered */
export function massFacade(tags: Readonly<Record<string, string>>, kind: BuildingKind, oldTown = false): MapMassFacade {
  const tagged = MATERIALS[tags['building:material'] ?? tags['building:facade:material'] ?? ''];
  if (tagged) return tagged;
  return kind === 'townhall' && oldTown ? 'timber' : KIND_FACADE[kind];
}

/**
 * The tint: `building:colour` (a hex colour or a common name), else one of
 * the facade's by the footprint's salt; a landmark of stone (`landmark`: its
 * kind) one of the building stones (LANDMARK_TINTS, a palace's PALACE_TINTS)
 */
export function massTint(tags: Readonly<Record<string, string>>, facade: MapMassFacade, salt: number, landmark: BuildingKind | null = null): string | null {
  const tagged = tagColour(tags['building:colour'], facade === 'stone');
  if (tagged) return tagged;
  const list = landmark && facade === 'stone' ? (landmark === 'palace' ? PALACE_TINTS : LANDMARK_TINTS) : TINTS[facade];
  return list[salt % list.length];
}

/** A road's piece in the building's own axes (model x, z) with the half width the building keeps off */
interface MassRoad {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  half: number;
}

/**
 * The share of its ground a raised building keeps at least when roads cut it
 * back (clipOffRoads); CLIP_LEAST where no less cut leaves it off the roads
 * (convert/buildings.ts)
 */
export const CLIP_KEEP = 0.5;
export const CLIP_LEAST = 0.3;

/**
 * Cuts a raised building's walls back from the roads that reach into it (an
 * old town's houses stand at the edge of a street the map draws wider): each
 * road piece that comes nearer to the outline than its half width cuts the
 * outline along a line beside it, on the side of the building's middle.
 * Courtyards the cut reaches go. Its parts are cut along the same lines,
 * a part cut away goes. False (the building unchanged) when less than
 * `keep` of the ground would be left or nothing is left to cut.
 */
export function clipOffRoads(mass: MapMass, roads: readonly MassRoad[], keep = CLIP_KEEP): boolean {
  let outer = mass.rings[0];
  const before = Math.abs(ringArea2(outer));
  let holes = mass.rings.slice(1);
  // What was done to the outline, once more for each part: a ring after it, null where nothing is left of it
  const steps: ((ring: number[]) => number[] | null)[] = [];
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
    // Only where the building stands beside the road: a cut that would take what lies behind the line past either
    // end of the piece (a big building whose corner a road leaves from) moves only the corners in its way off it
    if (overreaches(outer, r, nx, nz, len)) {
      const step = (ring: number[]) => pushedOff(ring, r, nx, nz, len);
      outer = step(outer);
      steps.push(step);
      continue;
    }
    const step = (ring: number[]) => clipHalfPlane(ring, r.ax, r.az, nx, nz, r.half);
    const cut = step(outer);
    if (!cut) return false;
    outer = cut;
    holes = holes.filter((h) => ringRoadDistance(h, r) >= r.half && step(h)?.length === h.length);
    steps.push(step);
  }
  if (outer === mass.rings[0]) return true;
  if (Math.abs(ringArea2(outer)) < before * keep) return false;
  mass.rings = [outer.map(round2), ...holes];
  // The walls it shared are other walls now (MapMass.shared counts them on the outline)
  delete mass.shared;
  if (mass.parts) {
    // The parts the same way: what lies past a cut goes, a part wholly past it with it
    const parts: MapMassPart[] = [];
    for (const p of mass.parts) {
      let ring: number[] | null = p.rings[0];
      let courts = p.rings.slice(1);
      for (const step of steps) {
        if (!ring) break;
        ring = step(ring);
        courts = courts.filter((h) => step(h)?.length === h.length);
      }
      if (!ring || Math.abs(ringArea2(ring)) < 1) continue;
      // A part cut keeps its roof over what is left of it (a helm its top, mass-roof.ts the rest), not its shared walls
      if (ring === p.rings[0]) {
        parts.push(p);
      } else {
        const cut: MapMassPart = { ...p, rings: [ring.map(round2), ...courts] };
        delete cut.shared;
        parts.push(cut);
      }
    }
    if (parts.length) mass.parts = parts;
    else delete mass.parts;
  }
  return true;
}

/**
 * Whether cutting a ring along road piece `r` (normal n towards the
 * building's middle) would take a point that lies behind the road (farther
 * than its half width and a little past its centre line) and beyond the
 * piece's ends: the line runs on where the road does not
 */
function overreaches(ring: readonly number[], r: MassRoad, nx: number, nz: number, len: number): boolean {
  const tx = (r.bx - r.ax) / len;
  const tz = (r.bz - r.az) / len;
  for (let i = 0; i < ring.length; i += 2) {
    const dx = ring[i] - r.ax;
    const dz = ring[i + 1] - r.az;
    if (dx * nx + dz * nz >= -(r.half + OVERREACH_SLACK)) continue;
    const t = dx * tx + dz * tz;
    if (t < -r.half || t > len + r.half) return true;
  }
  return false;
}

/** Metres behind a road's band a cut may still take beside the road's ends */
const OVERREACH_SLACK = 0.5;

/** The ring with its points in the band of road piece `r` (within its half width, along its length) moved off it along n */
function pushedOff(ring: number[], r: MassRoad, nx: number, nz: number, len: number): number[] {
  const tx = (r.bx - r.ax) / len;
  const tz = (r.bz - r.az) / len;
  let out: number[] | null = null;
  for (let i = 0; i < ring.length; i += 2) {
    const dx = ring[i] - r.ax;
    const dz = ring[i + 1] - r.az;
    const s = dx * nx + dz * nz;
    const t = dx * tx + dz * tz;
    if (s >= r.half || s < -r.half || t < -r.half || t > len + r.half) continue;
    out ??= [...ring];
    out[i] += (r.half - s) * nx;
    out[i + 1] += (r.half - s) * nz;
  }
  return out ?? ring;
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
      const d = pointSegmentDistance(pts[k], a, b);
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

