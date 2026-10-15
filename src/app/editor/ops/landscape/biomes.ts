/**
 * The landscapes the biome brush paints: which ground, how the ground
 * moves, which objects grow there and how densely. Asset and material ids
 * are lists of candidates: a material takes the first the catalogue has;
 * an object kind mixes all its candidates the catalogue has, one per spot,
 * so a forest has oaks, maples and young trees side by side.
 */
import type { MapBiome, MapWaterKind } from '../../../world/custom-map/map-document';

export type BiomeId =
  | 'meadow'
  | 'forest'
  | 'conifer'
  | 'rocks'
  | 'mountains'
  | 'swamp'
  | 'desert'
  | 'beach'
  | 'snow'
  | 'arctic'
  | 'village'
  | 'city'
  | 'hell'
  | 'wasteland'
  | 'moon'
  | 'mars';

export interface BiomeGround {
  /** Material candidates, first available wins */
  material: readonly string[];
  /** Share of the area, the shares of a biome are mixed by noise */
  share: number;
}

/**
 * Where an object kind grows. Core: where the brush is strong; edge: the
 * fraying rim (undergrowth); any: both; shore: around the pools; block:
 * along the edges of city blocks, facing the street; street: on the
 * sidewalks.
 */
export type BiomeZone = 'core' | 'edge' | 'any' | 'shore' | 'pool' | 'block' | 'street' | 'walk' | 'curb';

export interface BiomeObject {
  assets: readonly string[];
  /** Objects per hectare at full strength in their zone (block and street: share of the slots taken) */
  perHectare: number;
  scale: readonly [number, number];
  zone: BiomeZone;
  /** No other object closer than this, metres */
  spacing: number;
  /** 0 spreads evenly, 1 grows in clumps */
  clump?: number;
  /** Only this many metres over the water the stroke works by (its coast, LandscapeStroke.coastLevel): from, to */
  above?: readonly [number, number];
  /** Only in this climate of the map (mapClimate): palms where it is warm, pines where it is not */
  climate?: MapClimate;
}

/** Warm or cool, from the map's look: palms or pines on a beach */
export type MapClimate = 'warm' | 'cool';

/** The climate of a map's look: warm in the desert, on Mars and in hell, cool everywhere else */
export function mapClimate(biome: MapBiome | undefined): MapClimate {
  return biome === 'desert' || biome === 'mars' || biome === 'hell' ? 'warm' : 'cool';
}

export type ReliefKind = 'rolling' | 'ridged' | 'dunes' | 'flatten' | 'sink' | 'craters' | 'shore';

export interface BiomeRelief {
  kind: ReliefKind;
  /** Metres at full strength */
  amplitude: number;
  /** Wavelength in metres */
  wave: number;
}

/** A pattern laid over the ground mix: a street grid (city) or glowing cracks (hell) */
export type GroundPattern = 'streets' | 'cracks';

export interface BiomeDef {
  id: BiomeId;
  label: string;
  hint: string;
  /** Preview colour of the brush */
  color: string;
  ground: readonly BiomeGround[];
  /** Ground on slopes steeper than 30 degrees */
  steepGround?: readonly string[];
  /** Ground around the pools */
  shoreGround?: readonly string[];
  /** Ground at the waterline of the stroke's coast, up to `band` metres over and under the water */
  waterline?: { material: readonly string[]; band: number };
  relief: BiomeRelief;
  objects: readonly BiomeObject[];
  /** Share of the area that sinks into pools */
  pools?: number;
  /** What fills the pools (default water) */
  water?: MapWaterKind;
  pattern?: GroundPattern;
}

/** The street grid of the city biome, fixed to the map so strokes line up */
export const CITY_GRID = {
  /** Metres from one street's middle to the next */
  block: 64,
  /** Half width of the carriageway */
  street: 5,
  /** Half width of carriageway and sidewalks */
  sidewalk: 8.5,
} as const;

const TREES_TEMPERATE = ['tree-oak', 'tree-maple', 'tree-birch', 'tree-oak-young'];

export const BIOMES: readonly BiomeDef[] = [
  {
    id: 'meadow',
    label: 'Meadow',
    hint: 'Grass with flowers and bushes, gently rolling',
    color: '#8db255',
    ground: [
      // Mostly greens: the straw-coloured meadow ground only in small patches, else a wide view reads as camouflage
      { material: ['grass-lush', 'grass'], share: 0.55 },
      { material: ['grass', 'grass-lush'], share: 0.33 },
      { material: ['meadow', 'grass'], share: 0.12 },
    ],
    relief: { kind: 'rolling', amplitude: 1.2, wave: 60 },
    objects: [
      { assets: ['grass-green', 'grass-clump'], perHectare: 160, scale: [0.8, 1.4], zone: 'any', spacing: 1.5, clump: 0.6 },
      { assets: ['flowers', 'flowers-blue', 'flowers-yellow', 'periwinkle'], perHectare: 90, scale: [0.8, 1.3], zone: 'core', spacing: 1.5, clump: 0.85 },
      { assets: ['bush', 'shrub', 'shrub-wide'], perHectare: 14, scale: [0.7, 1.3], zone: 'any', spacing: 4, clump: 0.5 },
      { assets: ['tree-oak', 'tree-maple', 'tree-birch'], perHectare: 2, scale: [0.9, 1.3], zone: 'core', spacing: 12 },
      { assets: ['rock-mossy-flat', 'rock-round'], perHectare: 2, scale: [0.6, 1.2], zone: 'any', spacing: 8 },
    ],
  },
  {
    id: 'forest',
    label: 'Forest',
    hint: 'Oak, maple and birch on forest floor, ferns and mushrooms inside, bushes at the edge',
    color: '#3f6b2a',
    ground: [
      { material: ['forest-floor', 'forest-ground', 'dirt'], share: 0.5 },
      { material: ['forest-moss', 'moss', 'grass-lush'], share: 0.25 },
      { material: ['forest-twigs', 'leaves-scattered', 'dirt'], share: 0.25 },
    ],
    relief: { kind: 'rolling', amplitude: 2, wave: 70 },
    objects: [
      { assets: ['tree-oak', 'tree-maple'], perHectare: 100, scale: [0.85, 1.35], zone: 'core', spacing: 5, clump: 0.3 },
      { assets: [...TREES_TEMPERATE], perHectare: 55, scale: [0.85, 1.25], zone: 'any', spacing: 5, clump: 0.5 },
      { assets: ['fern', 'nettles', 'periwinkle'], perHectare: 140, scale: [0.8, 1.4], zone: 'core', spacing: 1.5, clump: 0.7 },
      { assets: ['mushrooms', 'roots', 'branches'], perHectare: 40, scale: [0.8, 1.3], zone: 'core', spacing: 2, clump: 0.7 },
      { assets: ['bush', 'shrub', 'bush-ivy'], perHectare: 110, scale: [0.8, 1.4], zone: 'edge', spacing: 2.5, clump: 0.4 },
      { assets: ['stump', 'stump-old', 'stump-mossy'], perHectare: 7, scale: [0.8, 1.2], zone: 'core', spacing: 4 },
      { assets: ['log', 'log-fallen'], perHectare: 5, scale: [0.8, 1.2], zone: 'core', spacing: 6 },
      { assets: ['rock-mossy-a', 'rock-mossy-b', 'rock-mossy-c'], perHectare: 3, scale: [0.6, 1.2], zone: 'core', spacing: 8 },
    ],
  },
  {
    id: 'conifer',
    label: 'Pine forest',
    hint: 'Dense pines and firs on needle ground, undergrowth at the rim',
    color: '#2c4f2f',
    ground: [
      { material: ['forest-ground', 'forest-floor'], share: 0.55 },
      { material: ['forest-twigs', 'forest-ground'], share: 0.2 },
      { material: ['rocky-ground', 'gravel', 'dirt'], share: 0.25 },
    ],
    steepGround: ['rock-lichen', 'rocky-ground', 'cliff'],
    relief: { kind: 'rolling', amplitude: 2.5, wave: 80 },
    objects: [
      { assets: ['tree-pine'], perHectare: 130, scale: [0.8, 1.4], zone: 'core', spacing: 4.5, clump: 0.3 },
      { assets: ['tree-fir', 'tree-pine', 'tree-fir-young'], perHectare: 110, scale: [0.8, 1.35], zone: 'any', spacing: 4.5, clump: 0.3 },
      { assets: ['fern', 'grass-green'], perHectare: 50, scale: [0.8, 1.2], zone: 'core', spacing: 2, clump: 0.6 },
      { assets: ['bush', 'shrub'], perHectare: 80, scale: [0.8, 1.3], zone: 'edge', spacing: 2.5 },
      { assets: ['rock-small', 'boulder', 'rock-mossy-b'], perHectare: 10, scale: [0.6, 1.4], zone: 'any', spacing: 4 },
      { assets: ['log-fallen', 'stump-old'], perHectare: 4, scale: [0.8, 1.2], zone: 'core', spacing: 6 },
    ],
  },
  {
    id: 'rocks',
    label: 'Rocks',
    hint: 'Ridged rocky ground with boulders and scree',
    color: '#7d7a74',
    ground: [
      { material: ['rocky-ground', 'gravel'], share: 0.5 },
      { material: ['scree', 'gravel', 'rocky-ground'], share: 0.3 },
      { material: ['grass-sparse', 'gravel'], share: 0.2 },
    ],
    steepGround: ['cliff', 'rock-lichen', 'rocky-ground'],
    relief: { kind: 'ridged', amplitude: 7, wave: 45 },
    objects: [
      { assets: ['rock-small', 'stones', 'rock-round', 'rock-granite-flat'], perHectare: 90, scale: [0.6, 1.8], zone: 'any', spacing: 2.5, clump: 0.6 },
      { assets: ['rock-large', 'boulder', 'rock-granite'], perHectare: 14, scale: [0.6, 1.5], zone: 'core', spacing: 8, clump: 0.4 },
      { assets: ['grass-green', 'grass-clump'], perHectare: 30, scale: [0.7, 1.1], zone: 'edge', spacing: 2 },
    ],
  },
  {
    id: 'mountains',
    label: 'Mountains',
    hint: 'High ridged peaks, scree and granite, sparse pines and blue flowers',
    color: '#8a8f96',
    ground: [
      { material: ['rocky-ground', 'gravel'], share: 0.5 },
      { material: ['scree', 'gravel'], share: 0.32 },
      { material: ['grass-sparse', 'rocky-ground'], share: 0.18 },
    ],
    steepGround: ['cliff-granite', 'cliff', 'rocky-ground'],
    relief: { kind: 'ridged', amplitude: 24, wave: 90 },
    objects: [
      { assets: ['boulder', 'rock-granite', 'rock-large'], perHectare: 12, scale: [0.7, 1.6], zone: 'any', spacing: 6, clump: 0.5 },
      { assets: ['rock-granite-flat', 'stones', 'rock-small'], perHectare: 50, scale: [0.6, 1.5], zone: 'any', spacing: 2.5, clump: 0.6 },
      { assets: ['tree-pine', 'tree-fir-young'], perHectare: 12, scale: [0.7, 1.2], zone: 'any', spacing: 6, clump: 0.7 },
      { assets: ['grass-green', 'flowers-blue'], perHectare: 50, scale: [0.7, 1.2], zone: 'edge', spacing: 2, clump: 0.7 },
    ],
  },
  {
    id: 'swamp',
    label: 'Swamp',
    hint: 'Mud, murky pools ringed by reeds, willows and dead trees, fireflies',
    color: '#556b3a',
    ground: [
      { material: ['mud-wet', 'mud', 'dirt'], share: 0.35 },
      { material: ['swamp-ground', 'mud'], share: 0.35 },
      { material: ['moss', 'grass-lush'], share: 0.3 },
    ],
    shoreGround: ['mud-dark', 'mud', 'dirt'],
    relief: { kind: 'sink', amplitude: 1, wave: 30 },
    pools: 0.35,
    water: 'swamp',
    objects: [
      { assets: ['reed-bed', 'reeds', 'grass-swamp'], perHectare: 900, scale: [0.8, 1.4], zone: 'shore', spacing: 1, clump: 0.3 },
      { assets: ['grass-swamp', 'nettles', 'fern'], perHectare: 90, scale: [0.8, 1.3], zone: 'any', spacing: 1.5, clump: 0.7 },
      { assets: ['tree-swamp-dead', 'tree-dead'], perHectare: 10, scale: [0.8, 1.3], zone: 'core', spacing: 8 },
      { assets: ['tree-willow', 'tree-mangrove'], perHectare: 6, scale: [0.8, 1.2], zone: 'any', spacing: 9 },
      { assets: ['mushrooms', 'roots', 'stump-mossy'], perHectare: 20, scale: [0.8, 1.2], zone: 'core', spacing: 2.5, clump: 0.6 },
      { assets: ['bush-ivy', 'bush'], perHectare: 25, scale: [0.7, 1.2], zone: 'edge', spacing: 3 },
      { assets: ['log-fallen', 'rock-mossy-flat'], perHectare: 6, scale: [0.8, 1.2], zone: 'any', spacing: 5 },
      { assets: ['lily-pads'], perHectare: 120, scale: [0.7, 1.3], zone: 'pool', spacing: 2, clump: 0.7 },
      { assets: ['fx-fireflies'], perHectare: 1.5, scale: [1, 1.4], zone: 'core', spacing: 18 },
    ],
  },
  {
    id: 'desert',
    label: 'Desert',
    hint: 'Dunes and cracked hardpan, cacti, succulents and wind-cut rocks',
    color: '#c2b080',
    ground: [
      // Sand first; the darker hardpan and stony ground in small patches, else a wide view reads as camouflage
      { material: ['sand-dunes', 'sand'], share: 0.86 },
      { material: ['desert-cracked', 'desert-hardpan', 'sand'], share: 0.09 },
      { material: ['desert-stony', 'sand-gravelly', 'sand'], share: 0.05 },
    ],
    steepGround: ['cliff-sandstone', 'sandstone', 'rocky-ground'],
    relief: { kind: 'dunes', amplitude: 4, wave: 70 },
    objects: [
      { assets: ['cactus', 'cactus-tall', 'cactus-barrel', 'tree-quiver-small'], perHectare: 6, scale: [0.6, 1.3], zone: 'any', spacing: 7, clump: 0.5 },
      { assets: ['desert-shrub', 'succulent', 'grass-tall-dry'], perHectare: 16, scale: [0.6, 1.3], zone: 'any', spacing: 4, clump: 0.6 },
      { assets: ['rock-desert', 'rock-sandstone', 'stones'], perHectare: 5, scale: [0.6, 1.4], zone: 'any', spacing: 8 },
      { assets: ['rock-desert-large', 'rock-sandstone-large'], perHectare: 1.2, scale: [0.6, 1.2], zone: 'core', spacing: 18 },
      { assets: ['bones', 'tree-dead-pale', 'tree-quiver-dead'], perHectare: 0.8, scale: [0.7, 1.1], zone: 'any', spacing: 20 },
    ],
  },
  {
    id: 'beach',
    label: 'Beach',
    hint: 'Sand flattening down to the water, a wet strip at the waterline, gravel and driftwood, dune grass; palms where the map is warm, shore pines where it is cool',
    color: '#e3cf98',
    // Three ground layers at most: sand, the wet coastal sand, gravelly sand
    ground: [
      { material: ['sand', 'sand-coast'], share: 0.82 },
      { material: ['sand-gravelly', 'pebbles', 'sand'], share: 0.18 },
    ],
    waterline: { material: ['sand-coast', 'sand'], band: 0.35 },
    steepGround: ['sand-gravelly', 'pebbles', 'rocky-ground'],
    relief: { kind: 'shore', amplitude: 1.2, wave: 45 },
    objects: [
      // A loose row of trees behind the dunes, then driftwood and pebbles along the band over the water and tufts
      // of dune grass: dense enough that a beach reads at a glance. Trees first: an object keeps others at its
      // spacing, and the grass would leave them no room
      { assets: ['tree-palm', 'tree-palm-tall'], perHectare: 14, scale: [0.85, 1.25], zone: 'any', spacing: 8, clump: 0.5, above: [1.8, 12], climate: 'warm' },
      { assets: ['tree-pine'], perHectare: 16, scale: [0.8, 1.2], zone: 'any', spacing: 7, clump: 0.55, above: [2.2, 14], climate: 'cool' },
      { assets: ['log-fallen', 'log'], perHectare: 14, scale: [0.7, 1.3], zone: 'any', spacing: 6, clump: 0.4, above: [0.2, 2.2] },
      { assets: ['pebbles-scatter'], perHectare: 45, scale: [0.7, 1.4], zone: 'any', spacing: 2.5, clump: 0.75, above: [-0.2, 1.4] },
      { assets: ['grass-tall-dry'], perHectare: 260, scale: [0.8, 1.4], zone: 'any', spacing: 1.4, clump: 0.7, above: [1.2, 9] },
    ],
  },
  {
    id: 'snow',
    label: 'Snow',
    hint: 'Snow fields with snowy firs and rocks poking through',
    color: '#e6ebef',
    ground: [
      { material: ['snow-fresh', 'snow'], share: 0.5 },
      { material: ['snow', 'snow-windswept'], share: 0.3 },
      { material: ['snow-rocky', 'snow'], share: 0.2 },
    ],
    steepGround: ['snow-rocky', 'rocky-ground', 'cliff'],
    relief: { kind: 'rolling', amplitude: 1.5, wave: 60 },
    objects: [
      { assets: ['tree-fir-snow', 'tree-pine-snow', 'tree-fir-young-snow'], perHectare: 30, scale: [0.8, 1.3], zone: 'any', spacing: 6, clump: 0.6 },
      { assets: ['rock-snow', 'boulder'], perHectare: 8, scale: [0.6, 1.5], zone: 'any', spacing: 5 },
      { assets: ['grass-snow'], perHectare: 30, scale: [0.7, 1.2], zone: 'edge', spacing: 2, clump: 0.6 },
    ],
  },
  {
    id: 'arctic',
    label: 'Arctic',
    hint: 'Drifts, pack ice and frozen pools, ice crystals, drifting snow',
    color: '#bcd9e6',
    ground: [
      { material: ['snow-drift', 'snow'], share: 0.45 },
      { material: ['pack-ice', 'ice'], share: 0.3 },
      { material: ['ice-shelf', 'blue-ice', 'ice'], share: 0.25 },
    ],
    steepGround: ['blue-ice', 'snow-rocky', 'cliff'],
    shoreGround: ['ice-cracked', 'ice'],
    relief: { kind: 'rolling', amplitude: 2.5, wave: 80 },
    pools: 0.3,
    water: 'ice',
    objects: [
      { assets: ['ice-spikes', 'ice-blocks', 'crystals-ice'], perHectare: 3, scale: [0.6, 1.4], zone: 'core', spacing: 10, clump: 0.6 },
      { assets: ['snow-drift-mound', 'rock-snow', 'boulder'], perHectare: 6, scale: [0.6, 1.5], zone: 'any', spacing: 6 },
      { assets: ['tree-frozen', 'tree-fir-young-snow'], perHectare: 1.5, scale: [0.6, 1], zone: 'edge', spacing: 10 },
      { assets: ['iceberg', 'ice-floe'], perHectare: 1, scale: [0.6, 1.2], zone: 'pool', spacing: 14 },
      { assets: ['igloo', 'research-station'], perHectare: 0.1, scale: [1, 1], zone: 'core', spacing: 60 },
      { assets: ['fx-snow'], perHectare: 0.6, scale: [1, 1.5], zone: 'core', spacing: 30 },
    ],
  },
  {
    id: 'village',
    label: 'Village',
    hint: 'Levelled ground, cottages and houses, fences, stalls, carts and lamps',
    color: '#9c8466',
    ground: [
      { material: ['grass-leafy', 'grass', 'meadow'], share: 0.55 },
      { material: ['dirt-path', 'mud-tracks', 'dirt'], share: 0.25 },
      { material: ['crazy-paving', 'cobblestone', 'paving'], share: 0.2 },
    ],
    relief: { kind: 'flatten', amplitude: 1, wave: 40 },
    objects: [
      { assets: ['house', 'house-large', 'cottage', 'house-stone', 'house-tall'], perHectare: 16, scale: [0.9, 1.1], zone: 'core', spacing: 14 },
      { assets: ['barn', 'windmill', 'watchtower'], perHectare: 1.2, scale: [0.9, 1.1], zone: 'core', spacing: 22 },
      { assets: ['well', 'market-stall-red', 'market-stall-blue'], perHectare: 1.5, scale: [1, 1], zone: 'core', spacing: 14 },
      { assets: ['lamp-post'], perHectare: 4, scale: [1, 1], zone: 'core', spacing: 12 },
      { assets: ['crate', 'barrel', 'cart', 'woodpile', 'barrel-wine', 'hay-bales'], perHectare: 16, scale: [0.9, 1.2], zone: 'core', spacing: 3, clump: 0.8 },
      { assets: ['fence-wood', 'fence-picket', 'hedge'], perHectare: 12, scale: [1, 1], zone: 'edge', spacing: 5 },
      { assets: ['tree-oak', 'tree-oak-young', 'tree-birch'], perHectare: 4, scale: [0.9, 1.2], zone: 'edge', spacing: 10 },
      { assets: ['flowers-yellow', 'flowers', 'periwinkle'], perHectare: 30, scale: [0.8, 1.2], zone: 'any', spacing: 2, clump: 0.8 },
    ],
  },
  {
    id: 'city',
    label: 'City',
    hint: 'A street grid: asphalt, sidewalks with lamps, paved blocks lined with buildings',
    color: '#7f8389',
    ground: [
      { material: ['pavers', 'concrete', 'paving'], share: 0.45 },
      { material: ['brick-paving', 'herringbone', 'paving'], share: 0.35 },
      { material: ['grass-leafy', 'grass'], share: 0.2 },
    ],
    relief: { kind: 'flatten', amplitude: 1, wave: 40 },
    pattern: 'streets',
    objects: [
      { assets: ['apartment-block', 'apartment-block-tall', 'brick-block', 'brick-house', 'shop', 'office-tower', 'house-tall'], perHectare: 0.6, scale: [0.95, 1.1], zone: 'block', spacing: 12 },
      { assets: ['street-lamp', 'lamp-post'], perHectare: 0.5, scale: [1, 1], zone: 'street', spacing: 8 },
      { assets: ['tree-street', 'bench', 'trash-can', 'hydrant', 'bus-stop', 'street-sign', 'bollards'], perHectare: 0.4, scale: [0.95, 1.05], zone: 'walk', spacing: 4 },
      { assets: ['car-red', 'car-blue', 'car-white', 'car-grey', 'pickup', 'truck', 'bus'], perHectare: 0.35, scale: [1, 1], zone: 'curb', spacing: 5 },
      { assets: ['tree-street', 'tree-oak-young', 'tree-maple'], perHectare: 6, scale: [0.8, 1], zone: 'core', spacing: 10 },
      { assets: ['crate', 'barrel-small', 'crate-long', 'trash-can'], perHectare: 5, scale: [0.9, 1.1], zone: 'core', spacing: 4, clump: 0.8 },
    ],
  },
  {
    id: 'hell',
    label: 'Hell',
    hint: 'Cinders and brimstone split by glowing cracks, lava pools, bones and braziers',
    color: '#8a2a14',
    ground: [
      { material: ['hell-ground', 'scorched-ground'], share: 0.4 },
      { material: ['cinders', 'volcanic-rock'], share: 0.35 },
      { material: ['brimstone', 'obsidian', 'basalt'], share: 0.25 },
    ],
    steepGround: ['obsidian', 'volcanic-rock', 'basalt'],
    shoreGround: ['lava-crust', 'scorched-ground'],
    relief: { kind: 'ridged', amplitude: 6, wave: 50 },
    pools: 0.25,
    water: 'lava',
    pattern: 'cracks',
    objects: [
      { assets: ['lava-rock', 'rock-volcanic', 'rock-pumice'], perHectare: 10, scale: [0.6, 1.5], zone: 'any', spacing: 4, clump: 0.6 },
      { assets: ['obsidian-spikes', 'obsidian-slabs', 'hell-spires', 'lava-rock-large'], perHectare: 3, scale: [0.7, 1.3], zone: 'core', spacing: 9, clump: 0.6 },
      { assets: ['basalt-columns'], perHectare: 0.8, scale: [0.7, 1.4], zone: 'core', spacing: 14 },
      { assets: ['tree-dead-pale', 'tree-dead', 'tree-charred'], perHectare: 2.5, scale: [0.8, 1.2], zone: 'any', spacing: 10 },
      { assets: ['bone-pile', 'bones', 'chains', 'cage'], perHectare: 4, scale: [0.8, 1.2], zone: 'any', spacing: 6 },
      { assets: ['hell-gate', 'altar'], perHectare: 0.12, scale: [1, 1], zone: 'core', spacing: 50 },
      { assets: ['brazier', 'torch'], perHectare: 0.8, scale: [1, 1.2], zone: 'core', spacing: 20 },
      { assets: ['fx-embers'], perHectare: 1.5, scale: [1, 1.5], zone: 'core', spacing: 16 },
      { assets: ['fx-smoke'], perHectare: 0.4, scale: [1, 1.5], zone: 'core', spacing: 30 },
    ],
  },
  {
    id: 'wasteland',
    label: 'Wasteland',
    hint: 'After the end: cracked asphalt, rubble and shell craters, ruins, wrecks and smoke',
    color: '#6f675a',
    ground: [
      // Rubble first: the dark asphalt and mossy concrete in small patches, else a wide view reads as camouflage
      { material: ['asphalt-cracked', 'concrete-damaged', 'dirt'], share: 0.12 },
      { material: ['rubble', 'debris', 'gravel'], share: 0.8 },
      { material: ['concrete-moss', 'grass-withered', 'dirt'], share: 0.08 },
    ],
    relief: { kind: 'craters', amplitude: 2.5, wave: 26 },
    objects: [
      { assets: ['brick-block-ruined', 'apartment-block-ruined', 'ruin-wall', 'wall-dry-stone-ruined'], perHectare: 2.5, scale: [0.8, 1.1], zone: 'core', spacing: 16 },
      { assets: ['car-wreck', 'car-wreck-b', 'car-burnt', 'pickup-wreck', 'truck-wreck', 'bus-wreck', 'tank-wreck'], perHectare: 3, scale: [0.95, 1.05], zone: 'any', spacing: 8, clump: 0.6 },
      { assets: ['tyres', 'barrel-rusty', 'barrel-rusty-tipped', 'toxic-barrel', 'barrels-broken', 'rubble-pile'], perHectare: 12, scale: [0.9, 1.2], zone: 'any', spacing: 3, clump: 0.8 },
      { assets: ['fence-broken', 'fence-chainlink-barbed', 'barbed-wire', 'road-barrier'], perHectare: 6, scale: [1, 1], zone: 'edge', spacing: 5 },
      { assets: ['tree-charred', 'tree-dead', 'tree-dead-pale'], perHectare: 3, scale: [0.7, 1.1], zone: 'any', spacing: 10 },
      { assets: ['grass-tall-dry', 'nettles', 'grass-autumn'], perHectare: 50, scale: [0.7, 1.2], zone: 'any', spacing: 2, clump: 0.8 },
      { assets: ['rubble-pile-large', 'bones', 'stones'], perHectare: 4, scale: [0.8, 1.2], zone: 'any', spacing: 6 },
      { assets: ['fx-smoke'], perHectare: 0.6, scale: [1, 1.6], zone: 'core', spacing: 26 },
    ],
  },
  {
    id: 'moon',
    label: 'Moon',
    hint: 'Grey regolith pocked with craters, scattered boulders',
    color: '#a6a6a2',
    ground: [
      { material: ['regolith', 'concrete'], share: 0.55 },
      { material: ['regolith-rough', 'regolith'], share: 0.37 },
      { material: ['moon-basalt', 'crater-floor', 'regolith'], share: 0.08 },
    ],
    steepGround: ['moon-basalt', 'regolith-rough'],
    relief: { kind: 'craters', amplitude: 5, wave: 42 },
    objects: [
      { assets: ['moon-boulder', 'moon-rock'], perHectare: 6, scale: [0.5, 1.6], zone: 'any', spacing: 5, clump: 0.6 },
      { assets: ['moon-rocks-small', 'moon-rock'], perHectare: 18, scale: [0.6, 1.4], zone: 'any', spacing: 2.5, clump: 0.7 },
      { assets: ['lander', 'antenna-mast', 'antenna-dish', 'base-hub'], perHectare: 0.12, scale: [1, 1], zone: 'core', spacing: 60 },
    ],
  },
  {
    id: 'mars',
    label: 'Mars',
    hint: 'Butterscotch dust, dark basalt sand, ochre gravel; rust, grey and black rocks, mesas',
    color: '#a87a56',
    ground: [
      { material: ['mars-dunes', 'mars-dust'], share: 0.5 },
      { material: ['desert-gravel', 'mars-gravel'], share: 0.3 },
      { material: ['volcanic-rock', 'basalt', 'mars-regolith'], share: 0.2 },
    ],
    steepGround: ['cliff-ochre', 'mars-rock', 'rock-red-granite'],
    relief: { kind: 'dunes', amplitude: 3, wave: 55 },
    objects: [
      { assets: ['mars-boulder', 'mars-rock-large', 'boulder', 'rock-basalt'], perHectare: 6, scale: [0.6, 1.5], zone: 'any', spacing: 6, clump: 0.6 },
      { assets: ['mars-stone', 'stones-desert-scatter', 'stones-volcanic-scatter', 'boulder'], perHectare: 18, scale: [0.6, 1.4], zone: 'any', spacing: 2.5, clump: 0.7 },
      { assets: ['mesa', 'sandstone-pillar'], perHectare: 0.25, scale: [0.6, 1], zone: 'core', spacing: 40 },
      { assets: ['dome-glass', 'greenhouse-dome', 'rover'], perHectare: 0.1, scale: [1, 1], zone: 'core', spacing: 60 },
    ],
  },
];

export function biomeById(id: BiomeId): BiomeDef {
  return BIOMES.find((b) => b.id === id) ?? BIOMES[0];
}
