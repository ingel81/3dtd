/**
 * The landscapes the biome brush paints: which ground, how the ground
 * moves, which objects grow there and how densely. Asset and material ids
 * are lists of candidates: a material takes the first the catalogue has;
 * an object kind mixes all its candidates the catalogue has, one per spot,
 * so a forest has oaks, maples and young trees side by side.
 */
import type { MapWaterKind } from '../../../world/custom-map/map-document';

export type BiomeId =
  | 'meadow'
  | 'forest'
  | 'conifer'
  | 'rocks'
  | 'mountains'
  | 'swamp'
  | 'desert'
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
export type BiomeZone = 'core' | 'edge' | 'any' | 'shore' | 'block' | 'street';

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
}

export type ReliefKind = 'rolling' | 'ridged' | 'dunes' | 'flatten' | 'sink' | 'craters';

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
      { material: ['grass-lush', 'grass'], share: 0.45 },
      { material: ['meadow', 'grass'], share: 0.35 },
      { material: ['grass-leafy', 'grass'], share: 0.2 },
    ],
    relief: { kind: 'rolling', amplitude: 1.2, wave: 60 },
    objects: [
      { assets: ['grass-green', 'grass-clump'], perHectare: 160, scale: [0.8, 1.4], zone: 'any', spacing: 1.5, clump: 0.6 },
      { assets: ['flowers', 'flowers-red', 'flowers-blue', 'flowers-yellow', 'periwinkle'], perHectare: 90, scale: [0.8, 1.3], zone: 'core', spacing: 1.5, clump: 0.85 },
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
      { assets: ['mushrooms', 'mushrooms-red', 'roots', 'branches'], perHectare: 40, scale: [0.8, 1.3], zone: 'core', spacing: 2, clump: 0.7 },
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
      { material: ['grass-sparse', 'rocky-ground'], share: 0.35 },
      { material: ['scree', 'gravel'], share: 0.35 },
      { material: ['rocky-ground', 'gravel'], share: 0.3 },
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
      { assets: ['mushrooms', 'mushrooms-red', 'roots', 'stump-mossy'], perHectare: 20, scale: [0.8, 1.2], zone: 'core', spacing: 2.5, clump: 0.6 },
      { assets: ['bush-ivy', 'bush'], perHectare: 25, scale: [0.7, 1.2], zone: 'edge', spacing: 3 },
      { assets: ['log-fallen', 'rock-mossy-flat'], perHectare: 6, scale: [0.8, 1.2], zone: 'any', spacing: 5 },
      { assets: ['fx-fireflies'], perHectare: 1.5, scale: [1, 1.4], zone: 'core', spacing: 18 },
    ],
  },
  {
    id: 'desert',
    label: 'Desert',
    hint: 'Dunes and cracked hardpan, cacti, succulents and wind-cut rocks',
    color: '#c2b080',
    ground: [
      { material: ['sand-dunes', 'sand'], share: 0.55 },
      { material: ['desert-cracked', 'desert-hardpan', 'sand'], share: 0.25 },
      { material: ['desert-stony', 'sand-gravelly', 'sand'], share: 0.2 },
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
      { assets: ['crystals-ice'], perHectare: 3, scale: [0.6, 1.4], zone: 'core', spacing: 10, clump: 0.6 },
      { assets: ['rock-snow', 'boulder'], perHectare: 6, scale: [0.6, 1.5], zone: 'any', spacing: 6 },
      { assets: ['tree-fir-young-snow'], perHectare: 1.5, scale: [0.6, 1], zone: 'edge', spacing: 10 },
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
      { assets: ['flowers-red', 'flowers', 'periwinkle'], perHectare: 30, scale: [0.8, 1.2], zone: 'any', spacing: 2, clump: 0.8 },
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
      { assets: ['house-tall', 'house-stone', 'house-large', 'house'], perHectare: 0.85, scale: [0.95, 1.15], zone: 'block', spacing: 9 },
      { assets: ['lamp-post'], perHectare: 0.9, scale: [1, 1], zone: 'street', spacing: 8 },
      { assets: ['tree-oak-young', 'tree-maple'], perHectare: 6, scale: [0.8, 1], zone: 'core', spacing: 10 },
      { assets: ['crate', 'barrel-small', 'crate-long', 'cart'], perHectare: 6, scale: [0.9, 1.1], zone: 'core', spacing: 4, clump: 0.8 },
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
      { assets: ['rock-volcanic', 'rock-volcanic-large', 'rock-pumice'], perHectare: 20, scale: [0.6, 1.6], zone: 'any', spacing: 4, clump: 0.6 },
      { assets: ['basalt-columns', 'rock-basalt-large'], perHectare: 2, scale: [0.7, 1.4], zone: 'core', spacing: 12, clump: 0.5 },
      { assets: ['tree-dead-pale', 'tree-dead'], perHectare: 3, scale: [0.8, 1.2], zone: 'any', spacing: 10 },
      { assets: ['bones'], perHectare: 5, scale: [0.8, 1.3], zone: 'any', spacing: 5 },
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
      { material: ['asphalt-cracked', 'concrete-damaged', 'dirt'], share: 0.3 },
      { material: ['rubble', 'debris', 'gravel'], share: 0.4 },
      { material: ['concrete-moss', 'grass-withered', 'dirt'], share: 0.3 },
    ],
    relief: { kind: 'craters', amplitude: 2.5, wave: 26 },
    objects: [
      { assets: ['ruin-wall', 'wall-dry-stone-ruined', 'castle-wall-ruined-b'], perHectare: 3, scale: [0.8, 1.1], zone: 'core', spacing: 14 },
      { assets: ['barrels-broken', 'barrel-old', 'crate', 'cart'], perHectare: 10, scale: [0.9, 1.2], zone: 'any', spacing: 3, clump: 0.8 },
      { assets: ['tree-dead', 'tree-dead-pale'], perHectare: 3, scale: [0.7, 1.1], zone: 'any', spacing: 10 },
      { assets: ['grass-tall-dry', 'nettles', 'grass-autumn'], perHectare: 50, scale: [0.7, 1.2], zone: 'any', spacing: 2, clump: 0.8 },
      { assets: ['bones', 'stones'], perHectare: 6, scale: [0.8, 1.2], zone: 'any', spacing: 4 },
      { assets: ['fx-smoke'], perHectare: 0.6, scale: [1, 1.6], zone: 'core', spacing: 26 },
    ],
  },
  {
    id: 'moon',
    label: 'Moon',
    hint: 'Grey regolith pocked with craters, scattered boulders',
    color: '#a6a6a2',
    ground: [
      { material: ['regolith', 'concrete'], share: 0.45 },
      { material: ['regolith-rough', 'regolith'], share: 0.35 },
      { material: ['moon-basalt', 'crater-floor', 'regolith'], share: 0.2 },
    ],
    steepGround: ['moon-basalt', 'regolith-rough'],
    relief: { kind: 'craters', amplitude: 5, wave: 42 },
    objects: [
      { assets: ['boulder', 'rock-granite', 'rock-round'], perHectare: 6, scale: [0.5, 1.6], zone: 'any', spacing: 5, clump: 0.6 },
      { assets: ['stones', 'rock-small'], perHectare: 20, scale: [0.6, 1.4], zone: 'any', spacing: 2.5, clump: 0.7 },
    ],
  },
  {
    id: 'mars',
    label: 'Mars',
    hint: 'Rust dust and dunes, gravel plains, red rocks and mesas',
    color: '#b5623a',
    ground: [
      { material: ['mars-dust', 'red-earth'], share: 0.4 },
      { material: ['mars-dunes', 'sand-red'], share: 0.3 },
      { material: ['mars-gravel', 'mars-regolith'], share: 0.3 },
    ],
    steepGround: ['mars-rock', 'cliff-ochre', 'rock-red-granite'],
    relief: { kind: 'dunes', amplitude: 3, wave: 55 },
    objects: [
      { assets: ['rock-desert', 'rock-sandstone', 'rock-desert-large'], perHectare: 6, scale: [0.6, 1.5], zone: 'any', spacing: 6, clump: 0.6 },
      { assets: ['stones', 'rock-small'], perHectare: 18, scale: [0.6, 1.4], zone: 'any', spacing: 2.5, clump: 0.7 },
      { assets: ['mesa', 'sandstone-pillar'], perHectare: 0.25, scale: [0.6, 1], zone: 'core', spacing: 40 },
    ],
  },
];

export function biomeById(id: BiomeId): BiomeDef {
  return BIOMES.find((b) => b.id === id) ?? BIOMES[0];
}
