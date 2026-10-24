/**
 * How a raised building looks by its tags and kind (building-mass.ts):
 * its storeys and height, its facade's material and tint, its roof's
 * colour and covering, from OSM's colours and materials or the kind's.
 */
import { type BuildingKind, buildingLevels } from '../building-tags';
import type { MapMass, MapMassCover, MapMassFacade } from '../../custom-map/map-document';
import { round2 } from './geom';

/** Storey heights, m: homes, and offices, schools and public buildings */
const HOME_STOREY = 2.9;
const WORK_STOREY = 3.6;
/** A castle's, a palace's, a town hall's and a gate's storeys: high halls, m */
const HALL_STOREY = 4.2;
/** The ground floor's plinth over the seat, m */
export const PLINTH = 0.4;

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
export const LANDMARK_KINDS: ReadonlySet<BuildingKind> = new Set(['palace', 'castle', 'cathedral', 'tower', 'gate', 'townhall', 'monument']);

export const MATERIALS: Readonly<Record<string, MapMassFacade>> = {
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

/** A number tag (`height`, `min_height`, `roof:height`, a comma for the point), null where missing or out of bounds */
export function metres(tags: Readonly<Record<string, string>>, key: string): number | null {
  const v = parseFloat((tags[key] ?? '').replace(',', '.'));
  return v > 0 && v < 700 ? v : null;
}

/** A count tag (`building:levels`, `building:min_level`), null where missing */
export function count(tags: Readonly<Record<string, string>>, key: string): number | null {
  const v = parseFloat(tags[key] ?? '');
  return v > 0 && v < 200 ? Math.round(v) : null;
}

/** The storey height of a kind, m */
export function storeyOf(kind: BuildingKind): number {
  return kind === 'house' || kind === 'semi' || kind === 'terrace' || kind === 'apartments' || kind === 'oldtown'
    ? HOME_STOREY
    : kind === 'palace' || kind === 'castle' || kind === 'townhall' || kind === 'gate'
      ? HALL_STOREY
      : WORK_STOREY;
}

/** A roof's colour and covering from `roof:colour` and `roof:material` (MapMass.roofTint, roofCover); none untagged */
export function roofLook(tags: Readonly<Record<string, string>>): Pick<MapMass, 'roofTint' | 'roofCover'> {
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
export function mostOf(values: readonly (string | undefined)[]): string | undefined {
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
