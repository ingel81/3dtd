/**
 * What kind of building an OSM footprint is, and the catalogue models that
 * stand for each kind (docs/OSM_WORLD_PLAN.md, "Gebäude"): the tables of the
 * plan as data. The kind comes from `building`, else from `amenity`, `shop`,
 * the levels, the land use around and the size; the models carry their wall
 * box (width along the front, depth) and their storeys, which the footprint
 * is fitted against (convert/buildings.ts).
 */

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
  | 'transformer';

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
    ] satisfies BuildingModel[]
  ).map((m) => [m.asset, m]),
);

/**
 * The models of each kind, best first where the fit is a tie; a kind
 * without a fitting model takes the next kind's (`fallback`) and the report
 * counts it. `rows`: the kind stands in rows of modules (terraces, garages,
 * city blocks), so a footprint laid with several copies costs little
 */
export const KIND_MODELS: Readonly<Record<BuildingKind, { models: readonly string[]; fallback?: BuildingKind; rows?: boolean }>> = {
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
  church: { models: ['town-church', 'chapel'], fallback: 'civic' },
  chapel: { models: ['chapel', 'town-church'], fallback: 'church' },
  station: { models: ['station'], fallback: 'civic' },
  parking: { models: ['parking-garage'], fallback: 'industrial' },
  greenhouse: { models: ['greenhouse'], fallback: 'shed', rows: true },
  kiosk: { models: ['kiosk'], fallback: 'shed' },
  transformer: { models: ['transformer-station'], fallback: 'shed' },
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
  museum: 'civic',
  townhall: 'civic',
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

/** `building` values that are no building on the ground: left out */
const NOT_ON_GROUND = new Set(['no', 'bridge', 'ruins', 'collapsed', 'demolished', 'proposed', 'abandoned:yes', 'container', 'tent']);

/** `amenity` values on a building of unknown kind */
const AMENITY_KINDS: Readonly<Record<string, BuildingKind>> = {
  place_of_worship: 'church',
  school: 'school',
  university: 'school',
  college: 'school',
  kindergarten: 'school',
  hospital: 'school',
  townhall: 'civic',
  courthouse: 'civic',
  police: 'civic',
  fire_station: 'civic',
  library: 'civic',
  theatre: 'civic',
  parking: 'parking',
  fuel: 'canopy',
  toilets: 'kiosk',
  shelter: 'carport',
};

/** Land use around a building of unknown kind (the use its middle lies in) */
export type BuildingLand = 'residential' | 'commercial' | 'retail' | 'industrial' | 'farm' | 'education' | 'religious' | 'allotments' | 'garages' | null;

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
  return null;
}

/** Storeys a building's tags give (`building:levels`, else `height` at 3.2 m a storey), null without */
export function buildingLevels(tags: Readonly<Record<string, string>>): number | null {
  const levels = parseFloat(tags['building:levels'] ?? '');
  if (levels > 0 && levels < 200) return Math.round(levels);
  const height = parseFloat((tags['height'] ?? '').replace(',', '.'));
  if (height > 0 && height < 700) return Math.max(1, Math.round(height / 3.2));
  return null;
}

/** Whether a footprint with these tags stands on the ground as a building of its own */
export function isGroundBuilding(tags: Readonly<Record<string, string>>): boolean {
  const b = tags['building'];
  if (!b || NOT_ON_GROUND.has(b)) return false;
  if (tags['location'] === 'underground' || parseInt(tags['layer'] ?? '0', 10) < 0) return false;
  return true;
}

/**
 * Median footprint (m²) of the buildings around under which the place is one
 * of houses (a village, a suburb): there a big untagged footprint is a big
 * house or a farmhouse, not a block of flats (Erlenbach: median about 110 m²)
 */
export const HOUSE_PLACE_AREA = 180;
/** Untagged footprints bigger than this (m²) are blocks of flats; among houses (HOUSE_PLACE_AREA) the second */
const BLOCK_AREA = 220;
const BLOCK_AREA_AMONG_HOUSES = 400;

/**
 * The kind of a building: its `building` value, else its `amenity` or
 * `shop`, else a guess from the size (m² of its footprint), the storeys,
 * the shape (its longer side over the shorter), the land use around and
 * the median footprint of the buildings around (`around`, m², null unknown)
 */
export function buildingKind(
  tags: Readonly<Record<string, string>>,
  area: number,
  aspect: number,
  land: BuildingLand,
  around: number | null = null,
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
  if (land === 'religious') return area > 150 ? 'church' : 'chapel';
  if (land === 'commercial' || land === 'retail') return area > 600 && (levels ?? 1) <= 2 ? 'retail' : 'office';
  if (area > 1500) return (levels ?? 1) <= 2 ? 'industrial' : 'apartments';
  const block = around !== null && around < HOUSE_PLACE_AREA ? BLOCK_AREA_AMONG_HOUSES : BLOCK_AREA;
  if ((levels ?? 0) >= 3 || area > block) return 'apartments';
  return 'house';
}
