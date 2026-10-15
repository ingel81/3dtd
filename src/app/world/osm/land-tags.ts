/**
 * Land and water of an OSM world as data: the tables of
 * docs/OSM_WORLD_PLAN.md (Zuordnung: Boden, Biome, Pflanzen; Wasser). Which
 * class an area's tags make, which ground it paints (with the materials it
 * falls back on when the twelve layers are full) and what grows on it.
 */

/** What an area of land is, for its ground and its plants */
export type LandClass =
  | 'forest'
  | 'conifers'
  | 'scrub'
  | 'heath'
  | 'meadow'
  | 'lawn'
  | 'park'
  | 'farmland'
  | 'farmyard'
  | 'vineyard'
  | 'orchard'
  | 'allotments'
  | 'cemetery'
  | 'paved'
  | 'industrial'
  | 'railway'
  | 'construction'
  | 'brownfield'
  | 'rock'
  | 'scree'
  | 'sand'
  | 'beach'
  | 'wetland'
  | 'glacier'
  | 'parking'
  | 'pitch'
  | 'playground';

/**
 * The ground of a class: its material, then the ones it takes when that did
 * not get a layer (the base grass last, always there)
 */
export const LAND_GROUND: Readonly<Record<LandClass, readonly string[]>> = {
  forest: ['forest-floor', 'forest-ground', 'grass-leafy'],
  conifers: ['forest-ground', 'forest-floor', 'grass-leafy'],
  scrub: ['grass-dry', 'grass-withered', 'meadow'],
  heath: ['grass-dry', 'grass-withered', 'meadow'],
  meadow: ['meadow', 'grass-lush'],
  lawn: ['grass-lush'],
  park: ['grass-lush'],
  farmland: ['farmland', 'farm-soil', 'dirt'],
  farmyard: ['dirt', 'mud-tracks', 'gravel'],
  vineyard: ['farm-soil', 'farmland', 'dirt'],
  orchard: ['meadow-earthy', 'meadow', 'grass-lush'],
  allotments: ['grass-lush'],
  cemetery: ['grass-lush'],
  paved: ['paving', 'pavers', 'sidewalk', 'concrete'],
  industrial: ['concrete', 'concrete-damaged', 'asphalt', 'gravel'],
  railway: ['gravel', 'gravel-light', 'dirt'],
  construction: ['dirt', 'rubble', 'gravel'],
  brownfield: ['rubble', 'debris', 'dirt'],
  rock: ['rocky-ground', 'rocky-terrain', 'scree', 'gravel'],
  scree: ['scree', 'rocky-ground', 'gravel'],
  sand: ['sand', 'sand-coast', 'sand-gravelly'],
  beach: ['sand-coast', 'sand', 'sand-gravelly'],
  wetland: ['swamp-ground', 'mud', 'mud-wet'],
  glacier: ['ice', 'snow'],
  parking: ['asphalt', 'concrete', 'paving'],
  pitch: ['grass-lush'],
  playground: ['wood-chips', 'gravel', 'sand'],
};

const LANDUSE: Readonly<Record<string, LandClass>> = {
  forest: 'forest',
  meadow: 'meadow',
  grass: 'lawn',
  village_green: 'lawn',
  recreation_ground: 'lawn',
  greenery: 'lawn',
  flowerbed: 'lawn',
  farmland: 'farmland',
  plant_nursery: 'farmland',
  farmyard: 'farmyard',
  vineyard: 'vineyard',
  orchard: 'orchard',
  allotments: 'allotments',
  cemetery: 'cemetery',
  commercial: 'paved',
  retail: 'paved',
  industrial: 'industrial',
  railway: 'railway',
  construction: 'construction',
  brownfield: 'brownfield',
  landfill: 'brownfield',
  quarry: 'rock',
};

const NATURAL: Readonly<Record<string, LandClass>> = {
  wood: 'forest',
  scrub: 'scrub',
  shrubbery: 'scrub',
  heath: 'heath',
  grassland: 'meadow',
  bare_rock: 'rock',
  scree: 'scree',
  shingle: 'scree',
  sand: 'sand',
  beach: 'beach',
  wetland: 'wetland',
  glacier: 'glacier',
};

const LEISURE: Readonly<Record<string, LandClass>> = {
  park: 'park',
  garden: 'park',
  common: 'lawn',
  pitch: 'pitch',
  playground: 'playground',
  golf_course: 'lawn',
};

/**
 * The land class of an area's tags, null for one that paints no ground
 * (residential land keeps the base grass of its gardens; buildings, water
 * and named regions such as a mountain range are not land cover)
 */
export function landClassOf(tags: Readonly<Record<string, string>>): LandClass | null {
  if (tags['building'] || tags['area:highway']) return null;
  const forest = (c: LandClass) => (c === 'forest' && tags['leaf_type'] === 'needleleaved' ? 'conifers' : c);
  const natural = NATURAL[tags['natural'] ?? ''];
  if (natural) return forest(natural);
  const landuse = LANDUSE[tags['landuse'] ?? ''];
  if (landuse) return forest(landuse);
  const leisure = LEISURE[tags['leisure'] ?? ''];
  if (leisure) return leisure;
  if (tags['amenity'] === 'parking' && (tags['parking'] ?? 'surface') === 'surface') return 'parking';
  return null;
}

/** What a water area or line is */
export type WaterClass = 'river' | 'lake' | 'pool';

/** `water=*` values of `natural=water` that are a river's surface (the main water) */
const RIVER_WATER = new Set(['river', 'canal', 'stream', 'oxbow', 'rapids', 'lock', 'fish_pass']);

/**
 * The water class of an area's tags, null for one that is no open water:
 * rivers (their surface, the main water), lakes and ponds (own bodies),
 * pools and fountains (small, while there is room)
 */
export function waterClassOf(tags: Readonly<Record<string, string>>): WaterClass | null {
  if (tags['covered'] === 'yes' || tags['location'] === 'underground' || tags['tunnel']) return null;
  if (tags['waterway'] === 'riverbank' || tags['waterway'] === 'dock') return 'river';
  if (tags['leisure'] === 'swimming_pool' || tags['amenity'] === 'fountain' || tags['water'] === 'fountain') {
    return tags['indoor'] === 'yes' || tags['building'] ? null : 'pool';
  }
  if (tags['natural'] === 'water' || tags['landuse'] === 'reservoir' || tags['landuse'] === 'basin') {
    if (tags['intermittent'] === 'yes' && tags['water'] === 'basin') return null;
    return RIVER_WATER.has(tags['water'] ?? '') ? 'river' : 'lake';
  }
  return null;
}

/** A waterway drawn as a river line: its width without a `width` tag and its depth, metres */
export interface WaterwayType {
  width: number;
  depth: number;
  /** Bank width each side, metres */
  bank: number;
}

export const WATERWAYS: Readonly<Record<string, WaterwayType>> = {
  river: { width: 12, depth: 2, bank: 6 },
  canal: { width: 8, depth: 1.5, bank: 3 },
  stream: { width: 2.5, depth: 0.7, bank: 2.5 },
  drain: { width: 1.6, depth: 0.5, bank: 1.5 },
  ditch: { width: 1.2, depth: 0.4, bank: 1.2 },
};

/** The waterway type of a way's tags, null for one the world does not draw (culverts and other tunnels, dry ones) */
export function waterwayOf(tags: Readonly<Record<string, string>>): WaterwayType | null {
  const type = WATERWAYS[tags['waterway'] ?? ''];
  if (!type) return null;
  if (tags['tunnel'] && tags['tunnel'] !== 'no') return null;
  if (tags['location'] === 'underground' || tags['intermittent'] === 'yes') return null;
  const widthTag = /^\s*(\d+(?:[.,]\d+)?)\s*m?\s*$/.exec(tags['width'] ?? '');
  if (!widthTag) return type;
  const width = Math.min(40, Math.max(0.8, parseFloat(widthTag[1].replace(',', '.'))));
  return { ...type, width, depth: Math.min(3, Math.max(type.depth, width * 0.15)) };
}
