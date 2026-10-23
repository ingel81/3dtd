/**
 * What kind of building an OSM footprint is, and the catalogue models that
 * stand for each kind (docs/OSM_WORLD_PLAN.md, "Gebäude"): the tables of the
 * plan as data. The kind comes from `building`, else from `amenity`, `shop`,
 * the levels, the land use around and the size; the models carry their wall
 * box (width along the front, depth) and their storeys, which the footprint
 * is fitted against (convert/buildings.ts).
 */
import type { FootprintKind } from '../custom-map/map-footprints';

export type BuildingKind =
  | 'house'
  | 'semi'
  | 'terrace'
  | 'garage'
  | 'shed'
  | 'carport'
  | 'canopy'
  | 'apartments'
  | 'office'
  | 'retail'
  | 'industrial'
  | 'farm'
  | 'school'
  | 'civic'
  | 'church'
  | 'chapel'
  | 'station'
  | 'parking'
  | 'greenhouse'
  | 'kiosk'
  | 'transformer'
  /** A club's house on a sports ground: one storey, a low roof */
  | 'clubhouse'
  /** A house of an old town (convert/old-town.ts): half-timbered or plastered, steep roof */
  | 'oldtown'
  // Landmarks (landmarkRole): raised from their outline, a catalogue model only where one of their own fits
  | 'palace'
  | 'castle'
  | 'cathedral'
  | 'tower'
  | 'gate'
  | 'townhall'
  | 'monument';

/** A catalogue model a building is fitted with */
export interface BuildingModel {
  asset: string;
  /** Wall box, metres: width along the front (model x), depth (model z); at scale 1 */
  box: readonly [number, number];
  /** Centre of the box in the model's own x and z (front +z), where the model is not centred on its walls */
  at?: readonly [number, number];
  /** Storeys */
  floors: number;
  /** Stands in a row with copies of itself (blank sides, a module) */
  module?: boolean;
  /** A corner house: street front and its west side (model -x); stands only at the ends of rows (convert/buildings.ts) */
  corner?: boolean;
}

/**
 * The models, measured: the walls of the O6 models as built
 * (tools/map-assets/build_modern.py, the plan's table), the older city
 * models from their bounds less the eaves. The industrial hall counts its
 * office annex at the west, the car park its ramp at the back.
 */
export const BUILDING_MODELS: Readonly<Record<string, BuildingModel>> = Object.fromEntries(
  (
    [
      { asset: 'house-modern', box: [10, 8.6], floors: 2 },
      { asset: 'house-modern-red', box: [9, 8.2], floors: 2 },
      { asset: 'house-semi', box: [14, 9], floors: 2 },
      { asset: 'house-terrace', box: [6, 10], floors: 2, module: true },
      { asset: 'house-terrace-row', box: [24, 10], floors: 2, module: true },
      { asset: 'garage', box: [3, 6], floors: 1, module: true },
      { asset: 'garage-row', box: [15, 6], floors: 1, module: true },
      { asset: 'garden-shed', box: [2.2, 2.6], floors: 1 },
      { asset: 'carport', box: [3.2, 5.6], floors: 1, module: true },
      { asset: 'carport-double', box: [6.4, 5.6], floors: 1, module: true },
      { asset: 'station-canopy', box: [22, 13], floors: 1 },
      { asset: 'block-row-4', box: [15, 12], floors: 4, module: true },
      { asset: 'block-row-6', box: [16, 13], floors: 6, module: true },
      { asset: 'block-corner-4', box: [14, 14], floors: 4, corner: true },
      { asset: 'block-corner-6', box: [15, 15], floors: 6, corner: true },
      { asset: 'apartment-block', box: [14, 11.4], floors: 4 },
      { asset: 'apartment-block-tall', box: [16.6, 13.6], floors: 8 },
      { asset: 'shop', box: [9.6, 8], floors: 2 },
      { asset: 'office-mid', box: [24, 14], floors: 5 },
      { asset: 'office-high', box: [22, 18], floors: 8 },
      { asset: 'office-tower', box: [15, 15], floors: 12 },
      { asset: 'supermarket', box: [40, 26], floors: 1 },
      { asset: 'hall-flat', box: [30, 20], floors: 1 },
      { asset: 'warehouse', box: [18, 12.8], floors: 1 },
      { asset: 'industrial-hall', box: [70, 30], at: [-5, 0], floors: 2 },
      { asset: 'barn', box: [11.4, 8], floors: 1 },
      { asset: 'school', box: [46, 14], floors: 3 },
      { asset: 'town-hall', box: [30, 15], floors: 3 },
      { asset: 'town-church', box: [33, 14], at: [0.35, 0], floors: 3 },
      { asset: 'chapel', box: [9, 14], floors: 2 },
      { asset: 'station', box: [28, 11], floors: 2 },
      { asset: 'parking-garage', box: [37, 54], at: [-2.5, -7], floors: 4 },
      { asset: 'greenhouse', box: [6, 12], floors: 1, module: true },
      { asset: 'kiosk', box: [4, 3], floors: 1 },
      { asset: 'transformer-station', box: [3.6, 2.6], floors: 1 },
      // tools/map-assets/build_modern2.py; the barn stands with a gable to the front
      { asset: 'shop-small', box: [10, 8], floors: 1 },
      { asset: 'shop-office', box: [12, 10], floors: 4 },
      { asset: 'office-ribbon', box: [16, 16], floors: 10 },
      { asset: 'barn-modern', box: [12, 18], floors: 1 },
      { asset: 'outbuilding', box: [4, 4], floors: 1 },
      { asset: 'shelter-lean-to', box: [6, 2.6], floors: 1 },
      { asset: 'annex', box: [7, 5], floors: 1 },
      // tools/map-assets/build_oldtown.py: the walls of the ground floor (the storeys above jut out a little)
      { asset: 'oldtown-gable-3', box: [7, 12], floors: 3, module: true },
      { asset: 'oldtown-gable-4', box: [8.5, 14], floors: 4, module: true },
      { asset: 'oldtown-gable-2', box: [6, 10], floors: 2, module: true },
      { asset: 'oldtown-eave-3', box: [12, 9.5], floors: 3, module: true },
      { asset: 'oldtown-eave-2', box: [10, 9], floors: 2, module: true },
      // The ends of the rows (ROW_ENDS): the module with one gable or both open, windows where no house abuts
      ...rowEnds('house-terrace', [6, 10], 2),
      ...rowEnds('block-row-4', [15, 12], 4),
      ...rowEnds('block-row-6', [16, 13], 6),
    ] satisfies BuildingModel[]
  ).map((m) => [m.asset, m]),
);

/** The three ends of a row module: open to the model's west (-x), to its east, both */
function rowEnds(module: string, box: readonly [number, number], floors: number): BuildingModel[] {
  return ['-end-w', '-end-e', '-ends'].map((end) => ({ asset: module + end, box, floors }));
}

/**
 * Modules with blank sides and the models that stand at the end of their
 * row where no house abuts (convert/buildings.ts): open to the west (model
 * -x), to the east, on both sides
 */
export const ROW_ENDS: Readonly<Record<string, { w: string; e: string; both: string }>> = Object.fromEntries(
  ['house-terrace', 'block-row-4', 'block-row-6'].map((m) => [m, { w: `${m}-end-w`, e: `${m}-end-e`, both: `${m}-ends` }]),
);

/**
 * The models of each kind, best first where the fit is a tie; a kind
 * without a fitting model takes the next kind's (`fallback`) and the report
 * counts it. `rows`: the kind stands in rows of modules (terraces, garages,
 * city blocks), so a footprint laid with several copies costs little.
 * `own`: a landmark's kind takes only its own models, never another kind's
 * nor the block with a facade; none fitting, it is raised from its outline
 */
export const KIND_MODELS: Readonly<Record<BuildingKind, { models: readonly string[]; fallback?: BuildingKind; rows?: boolean; own?: boolean }>> = {
  house: { models: ['house-modern', 'house-modern-red', 'house-semi', 'house-terrace', 'annex'], fallback: 'apartments' },
  semi: { models: ['house-semi'], fallback: 'house' },
  terrace: { models: ['house-terrace', 'house-terrace-row'], fallback: 'house', rows: true },
  garage: { models: ['garage', 'garage-row', 'outbuilding'], fallback: 'carport', rows: true },
  shed: { models: ['garden-shed', 'outbuilding'], fallback: 'garage' },
  carport: { models: ['carport', 'carport-double', 'shelter-lean-to'], fallback: 'garage', rows: true },
  canopy: { models: ['station-canopy', 'carport-double', 'carport'], fallback: 'carport' },
  apartments: {
    models: ['block-row-4', 'block-row-6', 'apartment-block', 'apartment-block-tall', 'house-terrace'],
    fallback: 'office',
    rows: true,
  },
  office: { models: ['office-mid', 'office-high', 'office-tower', 'office-ribbon', 'shop-office', 'block-row-6'], fallback: 'apartments' },
  retail: { models: ['supermarket', 'hall-flat', 'shop', 'shop-small', 'shop-office', 'kiosk'], fallback: 'industrial' },
  industrial: { models: ['industrial-hall', 'hall-flat', 'warehouse'], fallback: 'retail' },
  farm: { models: ['barn-modern', 'barn', 'warehouse', 'hall-flat'], fallback: 'industrial' },
  school: { models: ['school', 'town-hall'], fallback: 'office' },
  civic: { models: ['town-hall', 'school'], fallback: 'office' },
  church: { models: ['town-church', 'chapel'], own: true },
  chapel: { models: ['chapel', 'town-church'], own: true },
  station: { models: ['station'], own: true },
  parking: { models: ['parking-garage'], fallback: 'industrial' },
  greenhouse: { models: ['greenhouse'], fallback: 'shed', rows: true },
  kiosk: { models: ['kiosk'], fallback: 'shed' },
  transformer: { models: ['transformer-station'], fallback: 'shed' },
  clubhouse: { models: [], own: true },
  // Old-town houses stand wall to wall: a long footprint is a row of them
  oldtown: { models: ['oldtown-gable-3', 'oldtown-eave-3', 'oldtown-gable-2', 'oldtown-eave-2', 'oldtown-gable-4'], fallback: 'house', rows: true },
  townhall: { models: ['town-hall'], own: true },
  palace: { models: [], own: true },
  castle: { models: [], own: true },
  cathedral: { models: [], own: true },
  tower: { models: [], own: true },
  gate: { models: [], own: true },
  monument: { models: [], own: true },
};

/** `building` values to a kind; values not here guess from the other tags and the size */
const BUILDING_VALUES: Readonly<Record<string, BuildingKind>> = {
  house: 'house',
  detached: 'house',
  bungalow: 'house',
  villa: 'house',
  farm: 'house',
  cabin: 'shed',
  semidetached_house: 'semi',
  terrace: 'terrace',
  garage: 'garage',
  garages: 'garage',
  shed: 'shed',
  hut: 'shed',
  allotment_house: 'shed',
  toilets: 'kiosk',
  elevator: 'kiosk',
  carport: 'carport',
  roof: 'canopy',
  apartments: 'apartments',
  residential: 'apartments',
  dormitory: 'apartments',
  hotel: 'apartments',
  office: 'office',
  commercial: 'office',
  retail: 'retail',
  supermarket: 'retail',
  kiosk: 'kiosk',
  industrial: 'industrial',
  warehouse: 'industrial',
  manufacture: 'industrial',
  factory: 'industrial',
  hangar: 'industrial',
  sports_hall: 'industrial',
  barn: 'farm',
  farm_auxiliary: 'farm',
  cowshed: 'farm',
  stable: 'farm',
  sty: 'farm',
  school: 'school',
  university: 'school',
  college: 'school',
  kindergarten: 'school',
  public: 'school',
  hospital: 'school',
  nursing_home: 'civic',
  museum: 'civic',
  civic: 'civic',
  government: 'civic',
  fire_station: 'civic',
  church: 'church',
  cathedral: 'church',
  mosque: 'church',
  religious: 'church',
  chapel: 'chapel',
  train_station: 'station',
  transportation: 'station',
  parking: 'parking',
  greenhouse: 'greenhouse',
  transformer_tower: 'transformer',
};

/**
 * `building` values that are no building on the ground: left out. A ruin
 * (`building=ruins`) stands, as a ruin (buildingRole)
 */
const NOT_ON_GROUND = new Set(['no', 'bridge', 'collapsed', 'demolished', 'proposed', 'abandoned:yes', 'container', 'tent']);

/** `amenity` values on a building of unknown kind */
const AMENITY_KINDS: Readonly<Record<string, BuildingKind>> = {
  place_of_worship: 'church',
  school: 'school',
  university: 'school',
  college: 'school',
  kindergarten: 'school',
  hospital: 'school',
  courthouse: 'civic',
  police: 'civic',
  fire_station: 'civic',
  library: 'civic',
  theatre: 'civic',
  parking: 'parking',
  fuel: 'canopy',
  toilets: 'kiosk',
  shelter: 'carport',
  // Homes, care and the town's own: a nursing home with a courtyard is no factory hall
  social_facility: 'civic',
  nursing_home: 'civic',
  clinic: 'civic',
  doctors: 'civic',
  community_centre: 'civic',
  arts_centre: 'civic',
  social_centre: 'civic',
  public_building: 'civic',
  prison: 'civic',
  monastery: 'church',
};

/** Land use around a building of unknown kind (the use its middle lies in) */
export type BuildingLand = 'residential' | 'commercial' | 'retail' | 'industrial' | 'farm' | 'education' | 'religious' | 'allotments' | 'garages' | 'sports' | null;

const LAND_USES: Readonly<Record<string, BuildingLand>> = {
  residential: 'residential',
  commercial: 'commercial',
  retail: 'retail',
  industrial: 'industrial',
  railway: 'industrial',
  farmyard: 'farm',
  farmland: 'farm',
  vineyard: 'farm',
  orchard: 'farm',
  education: 'education',
  religious: 'religious',
  allotments: 'allotments',
  garages: 'garages',
};

/** The building land use an area's tags give, null for none */
export function buildingLandOf(tags: Readonly<Record<string, string>>): BuildingLand {
  if (tags['landuse']) return LAND_USES[tags['landuse']] ?? null;
  const amenity = tags['amenity'];
  if (amenity === 'school' || amenity === 'university' || amenity === 'college' || amenity === 'kindergarten') return 'education';
  if (SPORTS_GROUNDS.has(tags['leisure'] ?? '')) return 'sports';
  return null;
}

/** `leisure` values of the grounds a building on which is the club's house (or its hall) */
const SPORTS_GROUNDS: ReadonlySet<string> = new Set(['pitch', 'sports_centre', 'stadium', 'track', 'golf_course']);

/** `man_made` works whose buildings are technical boxes, not houses (a covered reservoir, a pumping station) */
const WORKS: ReadonlySet<string> = new Set(['storage_tank', 'reservoir_covered', 'water_works', 'pumping_station', 'wastewater_plant']);

/** Storeys a building's tags give (`building:levels`, else `height` at 3.2 m a storey), null without */
export function buildingLevels(tags: Readonly<Record<string, string>>): number | null {
  const levels = parseFloat(tags['building:levels'] ?? '');
  if (levels > 0 && levels < 200) return Math.round(levels);
  const height = parseFloat((tags['height'] ?? '').replace(',', '.'));
  if (height > 0 && height < 700) return Math.max(1, Math.round(height / 3.2));
  return null;
}

/** Storeys under a footprint that starts above the ground (`building:min_level`, else `min_height`): a part on another */
export function buildingMinLevel(tags: Readonly<Record<string, string>>): number | null {
  const levels = parseFloat(tags['building:min_level'] ?? '');
  if (levels > 0 && levels < 200) return Math.round(levels);
  const height = parseFloat((tags['min_height'] ?? '').replace(',', '.'));
  if (height > 0 && height < 700) return Math.round(height / 3.2);
  return null;
}

/**
 * What OSM says a footprint with these tags is (map-footprints.ts), null for
 * none: any `building` value, on the ground or not, and any `building:part`.
 * `building=no` says the area is no building; it counts only as the part it
 * may also be. Below the ground (`location=underground`, `layer` < 0) wins
 * over the value.
 */
export function footprintKindOf(tags: Readonly<Record<string, string>>): FootprintKind | null {
  const b = tags['building'];
  const part = tags['building:part'];
  const building = !!b && b !== 'no';
  if (!building && (!part || part === 'no')) return null;
  if (tags['location'] === 'underground' || parseInt(tags['layer'] ?? '0', 10) < 0) return 'underground';
  if (!building) return 'part';
  return NOT_ON_GROUND.has(b) ? 'offGround' : 'ground';
}

/** Whether a footprint with these tags stands on the ground as a building of its own */
export function isGroundBuilding(tags: Readonly<Record<string, string>>): boolean {
  return footprintKindOf(tags) === 'ground';
}

/**
 * What kind of landmark an element is (docs/OSM_LANDMARKS_PLAN.md,
 * "Kategorien und Erkennung"): one reading of the tags for the buildings
 * (their kind, buildingKind) and for the frame (the intro's flight, the
 * bells, the HQ offered there: convert/anchors.ts). `palace` and `castle`
 * are the two sorts of the plan's castle (castle_type: a stately home or a
 * fortress); `worship` a place of worship that is no Christian church;
 * `museum` and `sight` change no form, only that the landmark stays (the
 * room round the HQ takes none, convert/buildings.ts)
 */
export type LandmarkRole = 'palace' | 'castle' | 'cathedral' | 'church' | 'chapel' | 'worship' | 'gate' | 'tower' | 'townhall' | 'monument' | 'station' | 'museum' | 'sight';

/** A church or temple with a footprint at least this big (m²) is a church, a smaller one a chapel */
const CHURCH_MIN_AREA = 250;
/** `building` values of places of worship */
const WORSHIP_BUILDINGS = /^(church|chapel|basilica|monastery|cloister|mosque|synagogue|temple|shrine|religious)$/;
/** `building=tower` bigger than this (m²) without `historic` is a high-rise, not a tower */
const TOWER_ROLE_AREA = 400;
/** `tower:type` of the towers that are landmarks (not a mast, a cooling tower) */
const LANDMARK_TOWERS = /^(defensive|bell_tower|watchtower|observation)$/;

/**
 * The landmark role of an element's tags (`area`: its footprint, m², 0 for a
 * point), null for none. The first rule that matches wins: castle (palace,
 * castle), place of worship (cathedral, church, chapel, worship), gate,
 * tower, town hall, monument, station, museum, sight. A gate comes before a
 * tower: a gate tower is a way through first. `historic=building`,
 * `heritage` and `start_date` alone make nothing a landmark (an old town's
 * signs, convert/old-town.ts)
 */
export function landmarkRole(tags: Readonly<Record<string, string>>, area: number): LandmarkRole | null {
  const b = tags['building'] ?? '';
  const historic = tags['historic'] ?? '';
  if (b === 'palace' || /^(palace|stately|manor)$/.test(tags['castle_type'] ?? '')) return 'palace';
  if (historic === 'castle' || historic === 'fort' || b === 'castle' || b === 'fortress') return 'castle';
  if (b === 'cathedral') return 'cathedral';
  if (tags['amenity'] === 'place_of_worship' || WORSHIP_BUILDINGS.test(b)) {
    // The altar or a chapel inside a house is mapped as a point: only the church itself counts
    if (!area && !tags['wikidata']) return null;
    if (tags['religion'] && tags['religion'] !== 'christian') return 'worship';
    if (b === 'chapel' || (area > 0 && area < CHURCH_MIN_AREA && b !== 'church')) return 'chapel';
    return 'church';
  }
  if (historic === 'city_gate' || b === 'gatehouse') return 'gate';
  if (historic === 'tower' || (b === 'tower' && (area <= TOWER_ROLE_AREA || !!historic))) return 'tower';
  if (tags['man_made'] === 'tower' && (!!historic || LANDMARK_TOWERS.test(tags['tower:type'] ?? ''))) return 'tower';
  if ((tags['amenity'] === 'townhall' || b === 'townhall') && (area > 0 || tags['wikidata'])) return 'townhall';
  if (b === 'monument' || (/^(monument|memorial)$/.test(historic) && (tags['wikidata'] || area > 0) && tags['memorial'] !== 'plaque')) return 'monument';
  if (b === 'train_station' || (tags['railway'] === 'station' && area > 0)) return 'station';
  if (tags['tourism'] === 'museum' && area > 0) return 'museum';
  if (tags['tourism'] === 'attraction' && (tags['wikidata'] || tags['heritage'])) return 'sight';
  return null;
}

/** Whether the tags say a building is a ruin: `building=ruins`, `ruins=yes`, `historic=ruins`, `abandoned:building` */
export function isRuinTags(tags: Readonly<Record<string, string>>): boolean {
  return tags['building'] === 'ruins' || tags['ruins'] === 'yes' || tags['historic'] === 'ruins' || !!tags['abandoned:building'];
}

/** A footprint's role (buildingRole): the landmark it is, null for an ordinary building, and whether it is a ruin */
export interface BuildingRole {
  landmark: LandmarkRole | null;
  ruin: boolean;
}

/** `building` values a compound passes its role to: a building of its own, not an outbuilding */
const COMPOUND_TAKES = /^(yes|ruins|castle|tower|church|chapel|palace|residential|house|civic|public|hall)$/;
/** Footprints smaller than this (m²) take no role from their compound */
const COMPOUND_FROM = 40;

/**
 * A footprint's role: its own landmark role (landmarkRole), else that of
 * the compound it stands in (`compound`: the grounds of a castle mapped
 * without `building`, isCompoundTags) where it is a building of its own
 * from COMPOUND_FROM m², no shed or garage; a ruin by its own tags or the
 * compound's
 */
export function buildingRole(tags: Readonly<Record<string, string>>, area: number, compound: Readonly<Record<string, string>> | null = null): BuildingRole {
  const own = landmarkRole(tags, area);
  const inherits = !!compound && area >= COMPOUND_FROM && COMPOUND_TAKES.test(tags['building'] ?? '');
  const landmark = own ?? (inherits ? landmarkRole(compound, area) : null);
  return { landmark, ruin: isRuinTags(tags) || (inherits && isRuinTags(compound)) };
}

/** Whether an area is a compound whose buildings take its role: a castle mapped as its grounds, no building itself */
export function isCompoundTags(tags: Readonly<Record<string, string>>): boolean {
  return !tags['building'] && (tags['historic'] === 'castle' || tags['historic'] === 'fort');
}

/** The kind a landmark role builds as, null for one that keeps the kind of the other tags (a museum, a sight) */
function roleKind(role: LandmarkRole, area: number): BuildingKind | null {
  switch (role) {
    case 'church':
    case 'worship':
      return area < 150 ? 'chapel' : 'church';
    case 'museum':
    case 'sight':
      return null;
    default:
      return role;
  }
}

/**
 * Median footprint (m²) of the buildings around under which the place is one
 * of houses (a village, a suburb): there a big untagged footprint is a big
 * house or a farmhouse, not a block of flats (Musterdorf: median about 110 m²)
 */
export const HOUSE_PLACE_AREA = 180;
/** Untagged footprints bigger than this (m²) are blocks of flats; among houses (HOUSE_PLACE_AREA) the second */
const BLOCK_AREA = 220;
const BLOCK_AREA_AMONG_HOUSES = 400;

/**
 * The kind of a building: its `building` value, else its `amenity` or
 * `shop`, else a guess from the size (m² of its footprint), the storeys,
 * the shape (its longer side over the shorter; `winged`: courtyards, or
 * wings that fill little of its rectangle), the land use around and the
 * median footprint of the buildings around (`around`, m², null unknown);
 * `oldTown` (convert/old-town.ts) turns houses, shops and small public
 * buildings into old-town houses. A landmark (`role`, buildingRole) takes
 * the kind of its role first
 */
export function buildingKind(
  tags: Readonly<Record<string, string>>,
  area: number,
  aspect: number,
  land: BuildingLand,
  around: number | null = null,
  winged = false,
  oldTown = false,
  role: BuildingRole = buildingRole(tags, area),
): BuildingKind {
  // A landmark builds as one, never as an old-town house
  const landmark = role.landmark && roleKind(role.landmark, area);
  if (landmark) return landmark;
  const kind = guessKind(tags, area, aspect, land, around, winged);
  // In an old town its houses, its shops and small offices and public buildings are old-town houses
  if (oldTown && OLD_TOWN_KINDS.has(kind) && area <= OLD_TOWN_AREA && (buildingLevels(tags) ?? 3) <= 5) return 'oldtown';
  return kind;
}

/** Kinds an old town builds as its own houses, up to OLD_TOWN_AREA m² */
const OLD_TOWN_KINDS: ReadonlySet<BuildingKind> = new Set(['house', 'semi', 'terrace', 'apartments', 'retail', 'office', 'civic']);
const OLD_TOWN_AREA = 700;

function guessKind(
  tags: Readonly<Record<string, string>>,
  area: number,
  aspect: number,
  land: BuildingLand,
  around: number | null,
  winged: boolean,
): BuildingKind {
  const tagged = BUILDING_VALUES[tags['building'] ?? ''];
  if (tagged) {
    // A big house or a small block: the size says more than the tag
    if (tagged === 'house' && area > 400) return 'apartments';
    if (tagged === 'industrial' && area < 60) return 'garage';
    // `commercial` without storeys: a big one is a hall (a winery, a market), not an office block
    if (tags['building'] === 'commercial' && area > 600 && buildingLevels(tags) === null) return 'retail';
    return tagged;
  }
  // A works' building or a service building without a use of its own: a technical box, a hall when big
  if (tags['building'] === 'service' || WORKS.has(tags['man_made'] ?? '')) return area < 80 ? 'garage' : 'industrial';
  const amenity = AMENITY_KINDS[tags['amenity'] ?? ''];
  if (amenity) return amenity === 'church' && area < 150 ? 'chapel' : amenity;
  if (tags['shop']) return area > 150 ? 'retail' : 'apartments';
  const levels = buildingLevels(tags);
  if (area < 15) return 'shed';
  if (area < 45) return land === 'farm' || land === 'allotments' || (area < 25 && aspect < 1.4) ? 'shed' : 'garage';
  if (land === 'garages') return 'garage';
  if (land === 'industrial') return area < 120 ? 'garage' : 'industrial';
  if (land === 'farm') return area > 150 && (levels ?? 1) <= 2 ? 'farm' : 'house';
  if (land === 'education') return area > 300 ? 'school' : 'house';
  if (land === 'sports') return area > 600 ? 'industrial' : 'clubhouse';
  if (land === 'religious') return area > 150 ? 'church' : 'chapel';
  if (land === 'commercial' || land === 'retail') return area > 600 && (levels ?? 1) <= 2 ? 'retail' : 'office';
  // A big footprint with wings or a courtyard is a block, a big plain one a hall
  if (area > 1500) return (levels ?? 1) <= 2 && !winged ? 'industrial' : 'apartments';
  const block = around !== null && around < HOUSE_PLACE_AREA ? BLOCK_AREA_AMONG_HOUSES : BLOCK_AREA;
  if ((levels ?? 0) >= 3 || area > block) return 'apartments';
  return 'house';
}
