/**
 * The areas of use of an OSM world as data: the table of
 * docs/OSM_WORLD_ROUND2_PLAN.md (E237, Zuordnung). Which kind an area's tags
 * make (a pitch of a sport, a playground, a car park, a square, a
 * platform), the material its surface is laid in (from its `surface` tag,
 * else a good guess for the kind), its lines, whether its ground is
 * levelled, and the objects of its kind. convert/areas.ts lays them.
 *
 * Every material names the ones it falls back on (MATERIAL_FALLBACK): the
 * sports grounds of round 2 may not be in a catalogue yet, and a map draws
 * at most MAX_SURFACE_MATERIALS on its surfaces; the last of every chain is
 * a material every catalogue has.
 */
import type { MapSurfaceMarkingKind } from '../custom-map/map-document';

/** What an area of use is */
export type AreaKind =
  | 'soccer'
  | 'tennis'
  | 'basketball'
  | 'multi'
  | 'handball'
  | 'volleyball'
  | 'beachvolleyball'
  | 'table_tennis'
  | 'boules'
  | 'athletics'
  | 'skateboard'
  | 'equestrian'
  | 'pitch'
  | 'playground'
  | 'parking'
  | 'square'
  | 'platform'
  | 'pool'
  | 'cemetery'
  | 'allotments'
  | 'seating';

export interface AreaLook {
  kind: AreaKind;
  /** The surface's material, before its fallbacks; none for an area that lays no surface (a cemetery's ground stays) */
  material: string | null;
  /** The lines drawn when the outline fills its rectangle well (map-surfaces.ts MARKING_FILL) */
  marking?: MapSurfaceMarkingKind;
  /** Its ground levelled to one height (lines and cars do not tilt on a slope) */
  level?: boolean;
}

/** Every material's fallbacks, in order; the last of each chain is in every catalogue */
export const MATERIAL_FALLBACK: Readonly<Record<string, readonly string[]>> = {
  tartan: ['red-earth', 'sand'],
  'rubber-safety': ['wood-chips'],
  'artificial-turf': ['grass-lush'],
  'hard-court-green': ['hard-court-blue', 'asphalt'],
  'hard-court-blue': ['hard-court-green', 'asphalt'],
  'pool-tiles': ['sidewalk', 'concrete'],
  pavers: ['paving'],
  'brick-paving': ['pavers', 'paving'],
  herringbone: ['pavers', 'paving'],
  cobblestone: ['paving'],
  'cobblestone-mossy': ['cobblestone', 'paving'],
  sidewalk: ['paving'],
  'red-earth': ['sand'],
  'gravel-light': ['gravel', 'sand'],
  dirt: ['sand'],
  concrete: ['asphalt'],
  'wood-chips': ['sand'],
};

/** `surface` values to the material laid */
const SURFACE_MATERIAL: Readonly<Record<string, string>> = {
  asphalt: 'asphalt',
  paved: 'asphalt',
  chipseal: 'asphalt',
  concrete: 'concrete',
  'concrete:plates': 'concrete',
  paving_stones: 'pavers',
  'paving_stones:lanes': 'pavers',
  bricks: 'brick-paving',
  sett: 'cobblestone',
  cobblestone: 'cobblestone',
  unhewn_cobblestone: 'cobblestone',
  'cobblestone:flattened': 'cobblestone',
  grass_paver: 'cobblestone-mossy',
  gravel: 'gravel-light',
  fine_gravel: 'gravel-light',
  compacted: 'gravel-light',
  pebblestone: 'gravel-light',
  sand: 'sand',
  woodchips: 'wood-chips',
  grass: 'grass-lush',
  artificial_turf: 'artificial-turf',
  tartan: 'tartan',
  rubber: 'rubber-safety',
  clay: 'red-earth',
  dirt: 'dirt',
  earth: 'dirt',
  ground: 'dirt',
  acrylic: 'hard-court-green',
  carpet: 'artificial-turf',
};

/** The kind of a sport's pitch, its material without a `surface` tag, its lines and whether it is levelled */
const SPORTS: Readonly<Record<string, Omit<AreaLook, 'kind'> & { kind: AreaKind }>> = {
  soccer: { kind: 'soccer', material: 'grass-lush', marking: 'soccer', level: true },
  tennis: { kind: 'tennis', material: 'red-earth', marking: 'tennis', level: true },
  basketball: { kind: 'basketball', material: 'hard-court-blue', marking: 'basketball', level: true },
  multi: { kind: 'multi', material: 'tartan', marking: 'multi', level: true },
  handball: { kind: 'handball', material: 'hard-court-blue', marking: 'handball', level: true },
  volleyball: { kind: 'volleyball', material: 'hard-court-green', marking: 'volleyball', level: true },
  beachvolleyball: { kind: 'beachvolleyball', material: 'sand', marking: 'volleyball', level: true },
  table_tennis: { kind: 'table_tennis', material: 'concrete' },
  boules: { kind: 'boules', material: 'gravel-light' },
  petanque: { kind: 'boules', material: 'gravel-light' },
  athletics: { kind: 'athletics', material: 'tartan', marking: 'track', level: true },
  running: { kind: 'athletics', material: 'tartan', marking: 'track', level: true },
  skateboard: { kind: 'skateboard', material: 'concrete' },
  equestrian: { kind: 'equestrian', material: 'sand' },
};

/** Squares: a pedestrian area, an `area:highway` of a footway or living street, `place=square` */
const SQUARE_HIGHWAYS = new Set(['pedestrian', 'footway', 'living_street']);

/**
 * The look of an area's tags, null for one that is no area of use (its
 * ground stays as land-tags.ts paints it). Cemeteries and allotments lay no
 * surface: their ground stays, they get their rows and plots
 */
export function areaLookOf(tags: Readonly<Record<string, string>>): AreaLook | null {
  if (tags['building'] || tags['indoor'] === 'yes' || tags['covered'] === 'yes' || tags['location'] === 'underground') return null;
  const surface = SURFACE_MATERIAL[tags['surface'] ?? ''];
  const leisure = tags['leisure'];
  if (leisure === 'pitch' || (leisure === 'track' && tags['area'] === 'yes')) {
    const sports = (tags['sport'] ?? '').split(';').map((s) => s.trim());
    const sport = sports.map((s) => SPORTS[s]).find((s) => !!s) ?? (leisure === 'track' ? SPORTS['athletics'] : null);
    const look: AreaLook = sport ? { ...sport } : { kind: 'pitch', material: 'grass-lush' };
    if (surface) look.material = pitchSurface(look.kind, surface);
    // A court of hard ground is painted acrylic, not plain asphalt: green for tennis, blue for the others
    const hard = tags['surface'] === 'hard' || ((tags['surface'] === 'asphalt' || tags['surface'] === 'concrete') && look.kind === 'tennis');
    if (hard) look.material = look.kind === 'tennis' ? 'hard-court-green' : 'hard-court-blue';
    return look;
  }
  // Most playgrounds are lawn with a sandpit and devices on it (the devices come with the area, PLAYGROUND_SETS):
  // rubber, sand or bark only where `surface` says so
  if (leisure === 'playground') return { kind: 'playground', material: surface ?? 'grass-lush' };
  if (leisure === 'swimming_pool' && tags['indoor'] !== 'yes') return { kind: 'pool', material: 'pool-tiles' };
  if (leisure === 'outdoor_seating') return { kind: 'seating', material: null };
  if (tags['amenity'] === 'parking' && (tags['parking'] ?? 'surface') === 'surface') return { kind: 'parking', material: surface ?? 'asphalt', marking: 'parking', level: true };
  if (tags['railway'] === 'platform' || (tags['public_transport'] === 'platform' && tags['area'] === 'yes')) {
    return { kind: 'platform', material: surface ?? 'concrete', marking: 'platform' };
  }
  if ((tags['highway'] === 'pedestrian' && tags['area'] === 'yes') || SQUARE_HIGHWAYS.has(tags['area:highway'] ?? '') || tags['place'] === 'square') {
    return { kind: 'square', material: surface ?? 'paving' };
  }
  if (tags['landuse'] === 'cemetery' || tags['amenity'] === 'grave_yard') return { kind: 'cemetery', material: null };
  if (tags['landuse'] === 'allotments') return { kind: 'allotments', material: null };
  return null;
}

/** A pitch's `surface`: grass on a court of hard ground stays its sport's (an old tag), sand on a court is a beach court's */
function pitchSurface(kind: AreaKind, material: string): string {
  if (material === 'dirt') return kind === 'tennis' ? 'red-earth' : 'dirt';
  return material;
}

/**
 * The first of `material` and its fallbacks a catalogue has (`has`); the
 * last of the chain when none answers (a catalogue without the list: specs,
 * an old frame)
 */
export function availableMaterial(material: string, has: ((id: string) => boolean) | null): string {
  const chain = [material, ...(MATERIAL_FALLBACK[material] ?? [])];
  if (!has) return chain[chain.length - 1];
  return chain.find(has) ?? chain[chain.length - 1];
}

/** Playground points (`playground=*`) to the model that stands for them, null for one without */
export const PLAYGROUND_DEVICES: Readonly<Record<string, string>> = {
  swing: 'playground-swing',
  basketswing: 'playground-swing',
  slide: 'playground-slide',
  seesaw: 'seesaw',
  springy: 'spring-rider',
  climbingframe: 'climbing-frame',
  climbing_frame: 'climbing-frame',
  structure: 'climbing-frame',
  sandpit: 'sandbox',
  roundabout: 'playground-roundabout',
  playhouse: 'climbing-frame',
};

/** A playground without mapped devices: the set it gets, by its size (square metres from, devices) */
export const PLAYGROUND_SETS: readonly { from: number; devices: readonly string[] }[] = [
  { from: 0, devices: ['spring-rider', 'sandbox'] },
  { from: 150, devices: ['playground-swing', 'sandbox', 'spring-rider'] },
  { from: 400, devices: ['playground-swing', 'playground-slide', 'sandbox', 'seesaw', 'spring-rider'] },
  { from: 900, devices: ['playground-swing', 'playground-slide', 'climbing-frame', 'sandbox', 'seesaw', 'spring-rider', 'playground-swing'] },
];

/** The cars on a car park, one picked per stall */
export const PARKED_CARS: readonly string[] = ['car-red', 'car-blue', 'car-white', 'car-grey', 'car-grey', 'car-white'];
