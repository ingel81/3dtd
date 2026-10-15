/**
 * How OSM tags become map things: the tables of docs/OSM_WORLD_PLAN.md
 * (Zuordnung) as data. Phase O1 reads the roads; land, water, buildings and
 * furniture follow in O3 to O5.
 */
import type { MapPathKind } from '../custom-map/map-document';

/** A highway type the world lays: its kind on the map and its width without `width` or `lanes` */
interface RoadType {
  kind: MapPathKind;
  width: number;
  /** Ground material without a `surface` tag */
  surface: RoadSurface;
}

/**
 * Ground materials a road is painted with, five layers of the twelve. Paving
 * stones and footways share the grey slabs (`sidewalk`): from the game camera
 * the small brown pavers read like cobblestone, and the land gets the layer.
 */
export type RoadSurface = 'asphalt' | 'cobblestone' | 'sidewalk' | 'gravel' | 'dirt-path';

/**
 * The highway types of the street loads of the real places (the same list,
 * decision 7 of the plan): enemies take roads, footways, paths and steps
 * there, so they do here.
 */
export const ROAD_TYPES: Readonly<Record<string, RoadType>> = {
  motorway: { kind: 'road', width: 12, surface: 'asphalt' },
  motorway_link: { kind: 'road', width: 7, surface: 'asphalt' },
  trunk: { kind: 'road', width: 11, surface: 'asphalt' },
  trunk_link: { kind: 'road', width: 7, surface: 'asphalt' },
  primary: { kind: 'road', width: 10, surface: 'asphalt' },
  primary_link: { kind: 'road', width: 7, surface: 'asphalt' },
  secondary: { kind: 'road', width: 9, surface: 'asphalt' },
  secondary_link: { kind: 'road', width: 7, surface: 'asphalt' },
  tertiary: { kind: 'road', width: 7, surface: 'asphalt' },
  tertiary_link: { kind: 'road', width: 6, surface: 'asphalt' },
  unclassified: { kind: 'road', width: 6, surface: 'asphalt' },
  residential: { kind: 'road', width: 6, surface: 'asphalt' },
  living_street: { kind: 'road', width: 6, surface: 'sidewalk' },
  service: { kind: 'road', width: 4, surface: 'asphalt' },
  pedestrian: { kind: 'road', width: 5, surface: 'sidewalk' },
  track: { kind: 'path', width: 3, surface: 'gravel' },
  footway: { kind: 'path', width: 2.5, surface: 'sidewalk' },
  cycleway: { kind: 'path', width: 2.5, surface: 'asphalt' },
  path: { kind: 'path', width: 2, surface: 'dirt-path' },
  steps: { kind: 'path', width: 2.5, surface: 'sidewalk' },
};

/** `surface` values to the painted material */
const SURFACES: Readonly<Record<string, RoadSurface>> = {
  asphalt: 'asphalt',
  concrete: 'asphalt',
  'concrete:plates': 'asphalt',
  'concrete:lanes': 'asphalt',
  chipseal: 'asphalt',
  paved: 'asphalt',
  paving_stones: 'sidewalk',
  'paving_stones:lanes': 'sidewalk',
  bricks: 'sidewalk',
  metal: 'sidewalk',
  wood: 'sidewalk',
  sett: 'cobblestone',
  cobblestone: 'cobblestone',
  unhewn_cobblestone: 'cobblestone',
  'cobblestone:flattened': 'cobblestone',
  grass_paver: 'cobblestone',
  gravel: 'gravel',
  fine_gravel: 'gravel',
  compacted: 'gravel',
  pebblestone: 'gravel',
  rock: 'gravel',
  unpaved: 'dirt-path',
  dirt: 'dirt-path',
  earth: 'dirt-path',
  ground: 'dirt-path',
  grass: 'dirt-path',
  mud: 'dirt-path',
  sand: 'dirt-path',
  woodchips: 'dirt-path',
};

/** Narrowest and widest a road is laid, metres */
const MIN_WIDTH = 1.5;
const MAX_WIDTH = 24;
/** Metres per lane when `lanes` gives the width */
const LANE_WIDTH = 3;

export interface RoadTags {
  type: string;
  kind: MapPathKind;
  width: number;
  surface: RoadSurface;
  /** A bridge (`bridge=*` but `no`) */
  bridge: boolean;
  /** A tunnel (see roadTags): a tunnel edge with portals at its mouths (convert/tunnels.ts) */
  tunnel: boolean;
}

/**
 * What a way's tags make of it as a road, null for a way that is none. Width
 * from `width`, else `lanes` times 3 m, else the type's; `surface` picks the
 * material. A passage through a building is no tunnel: it stays a road.
 */
export function roadTags(tags: Record<string, string>): RoadTags | null {
  const type = tags['highway'];
  const road = type ? ROAD_TYPES[type] : undefined;
  if (!road) return null;
  const widthTag = /^\s*(\d+(?:[.,]\d+)?)\s*m?\s*$/.exec(tags['width'] ?? '');
  const lanes = /^\d+$/.test(tags['lanes'] ?? '') ? parseInt(tags['lanes'], 10) : 0;
  const raw = widthTag ? parseFloat(widthTag[1].replace(',', '.')) : lanes > 0 && road.kind === 'road' ? lanes * LANE_WIDTH : road.width;
  const tunnel = tags['tunnel'];
  return {
    type,
    kind: road.kind,
    width: Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, raw)) * 10) / 10,
    surface: SURFACES[tags['surface'] ?? ''] ?? road.surface,
    bridge: !!tags['bridge'] && tags['bridge'] !== 'no',
    tunnel: !!tunnel && tunnel !== 'no' && tunnel !== 'building_passage',
  };
}

/** A bridge's deck: wood where its tags say so, else stone (a concrete style comes with phase O5) */
export function bridgeStyle(tags: Record<string, string>): 'wood' | 'stone' {
  const material = tags['bridge:material'] ?? tags['material'] ?? '';
  return material === 'wood' ? 'wood' : 'stone';
}
