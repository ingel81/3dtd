/**
 * The landscapes the biome brush paints: which ground, how the ground
 * moves, which objects grow there and how densely. Asset and material ids
 * are lists of candidates; the brush takes the first the catalogue has, so
 * a smaller catalogue still paints (with less variety).
 */

export type BiomeId = 'meadow' | 'forest' | 'conifer' | 'rocks' | 'swamp' | 'desert' | 'snow' | 'village';

export interface BiomeGround {
  /** Material candidates, first available wins */
  material: readonly string[];
  /** Share of the area, the shares of a biome are mixed by noise */
  share: number;
}

export type BiomeZone = 'core' | 'edge' | 'any' | 'shore';

export interface BiomeObject {
  assets: readonly string[];
  /** Objects per hectare at full strength in their zone */
  perHectare: number;
  scale: readonly [number, number];
  /** Core: where the brush is strong; edge: the fraying rim (undergrowth); any: both; shore: around swamp pools */
  zone: BiomeZone;
  /** No other object closer than this, metres */
  spacing: number;
  /** 0 spreads evenly, 1 grows in clumps */
  clump?: number;
}

export type ReliefKind = 'rolling' | 'ridged' | 'dunes' | 'flatten' | 'sink';

export interface BiomeRelief {
  kind: ReliefKind;
  /** Metres at full strength */
  amplitude: number;
  /** Wavelength in metres */
  wave: number;
}

export interface BiomeDef {
  id: BiomeId;
  label: string;
  hint: string;
  /** Preview colour of the brush */
  color: string;
  ground: readonly BiomeGround[];
  /** Ground on slopes steeper than 30 degrees */
  steepGround?: readonly string[];
  relief: BiomeRelief;
  objects: readonly BiomeObject[];
  /** Share of the area that becomes shallow water (swamp pools) */
  pools?: number;
}

export const BIOMES: readonly BiomeDef[] = [
  {
    id: 'meadow',
    label: 'Meadow',
    hint: 'Grass with flowers and bushes, gently rolling',
    color: '#8db255',
    ground: [
      { material: ['grass-lush', 'grass'], share: 0.5 },
      { material: ['meadow', 'grass'], share: 0.35 },
      { material: ['grass', 'grass-lush'], share: 0.15 },
    ],
    relief: { kind: 'rolling', amplitude: 1.2, wave: 60 },
    objects: [
      { assets: ['grass-clump'], perHectare: 140, scale: [0.8, 1.4], zone: 'any', spacing: 1.5, clump: 0.6 },
      { assets: ['flowers'], perHectare: 70, scale: [0.8, 1.3], zone: 'core', spacing: 1.5, clump: 0.8 },
      { assets: ['bush'], perHectare: 14, scale: [0.7, 1.3], zone: 'any', spacing: 4, clump: 0.5 },
      { assets: ['tree-oak', 'tree-birch'], perHectare: 2, scale: [0.9, 1.3], zone: 'core', spacing: 12 },
    ],
  },
  {
    id: 'forest',
    label: 'Forest',
    hint: 'Oak and birch on forest floor, ferns inside, bushes at the edge',
    color: '#3f6b2a',
    ground: [
      { material: ['forest-floor', 'forest-ground', 'dirt'], share: 0.7 },
      { material: ['grass-lush', 'grass'], share: 0.3 },
    ],
    relief: { kind: 'rolling', amplitude: 2, wave: 70 },
    objects: [
      { assets: ['tree-oak'], perHectare: 110, scale: [0.85, 1.35], zone: 'core', spacing: 5, clump: 0.3 },
      { assets: ['tree-birch', 'tree-oak'], perHectare: 50, scale: [0.85, 1.25], zone: 'any', spacing: 5, clump: 0.5 },
      { assets: ['fern'], perHectare: 120, scale: [0.8, 1.4], zone: 'core', spacing: 1.5, clump: 0.7 },
      { assets: ['bush'], perHectare: 110, scale: [0.8, 1.4], zone: 'edge', spacing: 2.5, clump: 0.4 },
      { assets: ['stump'], perHectare: 6, scale: [0.8, 1.2], zone: 'core', spacing: 4 },
      { assets: ['log'], perHectare: 5, scale: [0.8, 1.2], zone: 'core', spacing: 6 },
    ],
  },
  {
    id: 'conifer',
    label: 'Pine forest',
    hint: 'Dense pines and firs on needle ground, undergrowth at the rim',
    color: '#2c4f2f',
    ground: [
      { material: ['forest-ground', 'forest-floor'], share: 0.75 },
      { material: ['rocky-ground', 'gravel', 'dirt'], share: 0.25 },
    ],
    steepGround: ['rocky-ground', 'cliff'],
    relief: { kind: 'rolling', amplitude: 2.5, wave: 80 },
    objects: [
      { assets: ['tree-pine'], perHectare: 140, scale: [0.8, 1.4], zone: 'core', spacing: 4.5, clump: 0.3 },
      { assets: ['tree-fir', 'tree-pine'], perHectare: 110, scale: [0.8, 1.35], zone: 'any', spacing: 4.5, clump: 0.3 },
      { assets: ['fern'], perHectare: 50, scale: [0.8, 1.2], zone: 'core', spacing: 2, clump: 0.6 },
      { assets: ['bush'], perHectare: 80, scale: [0.8, 1.3], zone: 'edge', spacing: 2.5 },
      { assets: ['rock-small'], perHectare: 10, scale: [0.6, 1.4], zone: 'any', spacing: 4 },
    ],
  },
  {
    id: 'rocks',
    label: 'Rocks',
    hint: 'Ridged rocky ground with boulders and scree',
    color: '#7d7a74',
    ground: [
      { material: ['rocky-ground', 'gravel'], share: 0.6 },
      { material: ['gravel', 'rocky-ground'], share: 0.4 },
    ],
    steepGround: ['cliff', 'rock-mossy', 'rocky-ground'],
    relief: { kind: 'ridged', amplitude: 7, wave: 45 },
    objects: [
      { assets: ['rock-small'], perHectare: 90, scale: [0.6, 1.8], zone: 'any', spacing: 2.5, clump: 0.6 },
      { assets: ['rock-large'], perHectare: 14, scale: [0.6, 1.5], zone: 'core', spacing: 8, clump: 0.4 },
      { assets: ['grass-clump'], perHectare: 30, scale: [0.7, 1.1], zone: 'edge', spacing: 2 },
    ],
  },
  {
    id: 'swamp',
    label: 'Swamp',
    hint: 'Mud, shallow pools, dead trees and reeds',
    color: '#556b3a',
    ground: [
      { material: ['mud', 'dirt'], share: 0.6 },
      { material: ['grass-lush', 'grass'], share: 0.4 },
    ],
    relief: { kind: 'sink', amplitude: 1, wave: 30 },
    pools: 0.35,
    objects: [
      { assets: ['reeds', 'cattails', 'grass-clump'], perHectare: 900, scale: [0.8, 1.4], zone: 'shore', spacing: 1, clump: 0.3 },
      { assets: ['grass-clump'], perHectare: 90, scale: [0.8, 1.3], zone: 'any', spacing: 1.5, clump: 0.7 },
      { assets: ['tree-dead'], perHectare: 14, scale: [0.8, 1.3], zone: 'core', spacing: 8 },
      { assets: ['bush'], perHectare: 25, scale: [0.7, 1.2], zone: 'edge', spacing: 3 },
      { assets: ['log', 'stump'], perHectare: 8, scale: [0.8, 1.2], zone: 'any', spacing: 5 },
    ],
  },
  {
    id: 'desert',
    label: 'Desert',
    hint: 'Sand dunes with scattered stones',
    color: '#c2b080',
    ground: [{ material: ['sand'], share: 1 }],
    steepGround: ['rocky-ground', 'gravel'],
    relief: { kind: 'dunes', amplitude: 4, wave: 70 },
    objects: [
      { assets: ['cactus', 'bush-dry', 'rock-small'], perHectare: 8, scale: [0.6, 1.4], zone: 'any', spacing: 6 },
      { assets: ['rock-large'], perHectare: 2, scale: [0.6, 1.2], zone: 'core', spacing: 15 },
      { assets: ['tree-dead'], perHectare: 1, scale: [0.7, 1.1], zone: 'any', spacing: 20 },
    ],
  },
  {
    id: 'snow',
    label: 'Snow',
    hint: 'Snow fields with firs and rocks poking through',
    color: '#e6ebef',
    ground: [{ material: ['snow'], share: 1 }],
    steepGround: ['rocky-ground', 'cliff'],
    relief: { kind: 'rolling', amplitude: 1.5, wave: 60 },
    objects: [
      { assets: ['tree-fir-snow', 'tree-fir', 'tree-pine'], perHectare: 30, scale: [0.8, 1.3], zone: 'any', spacing: 6, clump: 0.6 },
      { assets: ['rock-small'], perHectare: 12, scale: [0.6, 1.5], zone: 'any', spacing: 4 },
    ],
  },
  {
    id: 'village',
    label: 'Village',
    hint: 'Levelled ground, houses, fences, lamps and props',
    color: '#9c8466',
    ground: [
      { material: ['grass', 'meadow'], share: 0.6 },
      { material: ['dirt-path', 'dirt'], share: 0.25 },
      { material: ['paving', 'cobblestone'], share: 0.15 },
    ],
    relief: { kind: 'flatten', amplitude: 1, wave: 40 },
    objects: [
      { assets: ['house', 'house-large'], perHectare: 16, scale: [0.9, 1.1], zone: 'core', spacing: 14 },
      { assets: ['barn'], perHectare: 1.5, scale: [0.9, 1.1], zone: 'core', spacing: 22 },
      { assets: ['well'], perHectare: 0.8, scale: [1, 1], zone: 'core', spacing: 25 },
      { assets: ['lamp-post'], perHectare: 4, scale: [1, 1], zone: 'core', spacing: 12 },
      { assets: ['crate', 'barrel'], perHectare: 14, scale: [0.9, 1.2], zone: 'core', spacing: 3, clump: 0.8 },
      { assets: ['fence-wood'], perHectare: 12, scale: [1, 1], zone: 'edge', spacing: 5 },
      { assets: ['tree-oak', 'tree-birch'], perHectare: 4, scale: [0.9, 1.2], zone: 'edge', spacing: 10 },
    ],
  },
];

export function biomeById(id: BiomeId): BiomeDef {
  return BIOMES.find((b) => b.id === id) ?? BIOMES[0];
}
