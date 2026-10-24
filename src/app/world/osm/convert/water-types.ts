/** What the water of an OSM world hands on (water.ts, water-rivers.ts): its paint materials, the result and its report */
import type { ImportNote } from '../../import-notes';
import type { MapPoint } from '../../custom-map/map-document';

/**
 * Ground materials of the water's beds and shores, by role: a dry river's
 * bed (`intermittent=yes`) is dry gravel, a dry ditch bare earth
 */
export const WATER_MATERIALS = { bed: 'riverbed', bank: 'riverbed', beach: 'sand-coast', dryBed: 'riverbed-dry', ditch: 'dirt' } as const;
export type WaterPaintRole = keyof typeof WATER_MATERIALS;

export interface WaterReport {
  coast: boolean;
  /** Main water: 'sea', 'river' or none */
  main: 'sea' | 'river' | null;
  riverSections: number;
  lakes: number;
  pools: number;
  wetlands: number;
  /** Bodies left out past the limit of MAX_WATER_BODIES, and areas under MIN_WATER_AREA */
  dropped: number;
  tooSmall: number;
  /** Waterway lines drawn with water, and their kilometres */
  rivers: number;
  riverKm: number;
  /** Waterway lines drawn as their channel only (dry ones and drains), and the drains' runnels among them */
  dry: number;
  runnels: number;
  /** Map metres the ground moved up so the map's zero is the sea level (coast only) */
  zeroShift: number;
}

/** What the water stage leaves for the later stages: the shores to paint, and where the water is */
export interface WaterResult {
  report: WaterReport;
  /** Per height sample, 0..1 per role: what paintWater lays */
  paint: Record<WaterPaintRole, Float32Array>;
  /** Per height sample: 1 in a body or a river's channel (plants keep out) */
  wet: Uint8Array;
  /** Per height sample: 1 in the sea */
  sea: Uint8Array;
  /** Per height sample: 1 under a road or path (not a bridge) */
  roads: Uint8Array;
  /** Per height sample: the bed of a river's channel, NaN outside one (cut again once the roads are levelled) */
  channel: Float32Array;
  /** Per height sample: 1 in the channel of a dry waterway or a drain (plants keep out; no reeds, it is not `wet`) */
  dry: Uint8Array;
  /** The drains' runnels, laid as surfaces with the areas (layRunnels) */
  runnels: Runnel[];
  warnings: ImportNote[];
}

/** A drain's runnel: its line, the width at its bottom and the water's width there (a trickle when dry), metres */
export interface Runnel {
  /** The way's id: the runnel's surfaces are `osm-w<way>-<k>` */
  way: number;
  line: MapPoint[];
  width: number;
  water: number;
}
