/**
 * "Enhanced" ground for an imported map (W3xImportOptions.style, the
 * default): instead of the Warcraft tiles' flat textures the ground is
 * painted by what each place is in the game.
 *
 * - Roads (the route graph's edges): a paved middle and a gravel edge that
 *   frays into the grass
 * - Build ground (walkable and buildable in the pathing map): meadow, with
 *   lusher and drier patches from value noise
 * - Everything else that is flat (unwalkable rims, the map's border, tree
 *   walls): forest floor with mossy patches, planted with extra trees
 *
 * Steep faces keep the cliff material (by slope), water stays. The palette
 * follows the tileset's biome (temperate, winter, desert, autumn).
 */

import type { MapGroundLayer, MapObject, MapPaths, MapSplat } from '../../custom-map/map-document';
import { splatResolutionFor, valueNoise } from '../../custom-map/map-create';
import { MAX_GROUND_LAYERS } from '../../custom-map/map-file';
import { type PathingMap, WPM, WPM_CELL } from '../formats/wpm';
import type { W3eTerrain } from '../formats/w3e';
import { hashIndex } from './doodad-assets';
import { type CatalogEntryRef, resolveMaterial } from './ground-materials';
import type { ImportFrame } from './terrain-convert';

export type ImportStyle = 'enhanced' | 'original';

interface Palette {
  road: string;
  roadEdge: string;
  grass: string;
  grassLush: string;
  grassDry: string;
  forest: string;
  forestMoss: string;
  trees: string[];
}

// Fresh green: the greenest grass as the ground, the plainer one and moss as
// patches; under the rim's trees grey-brown ground and moss. No meadow, no
// yellow forest moss, no orange forest floor: they turn the map olive and rust
const TEMPERATE: Palette = {
  road: 'cobblestone',
  roadEdge: 'gravel-path',
  grass: 'grass-lush',
  grassLush: 'grass',
  grassDry: 'moss',
  forest: 'forest-ground',
  forestMoss: 'moss',
  trees: ['tree-oak', 'tree-birch', 'tree-pine', 'tree-fir'],
};

const PALETTES: Record<string, Palette> = {
  winter: {
    road: 'cobblestone-grey',
    roadEdge: 'gravel-light',
    grass: 'snow-fresh',
    grassLush: 'frozen-ground',
    grassDry: 'snow-windswept',
    forest: 'snow-rocky',
    forestMoss: 'frozen-ground',
    trees: ['tree-pine', 'tree-fir'],
  },
  desert: {
    road: 'sandstone-paving',
    roadEdge: 'sand-gravelly',
    grass: 'grass-dry',
    grassLush: 'grass-sparse',
    grassDry: 'desert-hardpan',
    forest: 'desert-stony',
    forestMoss: 'sand-gravelly',
    trees: ['tree-dead', 'tree-birch'],
  },
  autumn: {
    road: 'cobblestone-mossy',
    roadEdge: 'gravel-path',
    grass: 'grass-leafy',
    grassLush: 'meadow',
    grassDry: 'grass-withered',
    forest: 'leaves-autumn',
    forestMoss: 'leaves-scattered',
    trees: ['tree-oak', 'tree-birch', 'tree-dead'],
  },
};

/** Tileset letter to biome: Northrend, Icecrown, Lordaeron Winter; Barrens, Outland; Lordaeron Fall, Felwood, Village Fall */
const BIOME: Record<string, string> = { N: 'winter', I: 'winter', W: 'winter', B: 'desert', O: 'desert', F: 'autumn', C: 'autumn', Q: 'autumn' };

export function biomePalette(tileset: string): Palette {
  return PALETTES[BIOME[tileset] ?? ''] ?? TEMPERATE;
}

/** Layer order of the enhanced ground; index = layer */
const SLOTS = ['grass', 'grassLush', 'grassDry', 'road', 'roadEdge', 'forest', 'forestMoss'] as const;
type Slot = (typeof SLOTS)[number];

export interface EnhanceInput {
  terrain: W3eTerrain;
  frame: ImportFrame;
  pathing: PathingMap | null;
  /** Roads in map metres (the converted route graph) */
  paths: MapPaths;
  /** Map extent in metres and the height grid's sample count along the longer side */
  width: number;
  depth: number;
  samples: number;
  tileset: string;
  catalog?: CatalogEntryRef[];
}

interface RoadSegment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  half: number;
}

function roadSegments(paths: MapPaths): RoadSegment[] {
  const nodes = new Map(paths.nodes.map((n) => [n.id, n]));
  const out: RoadSegment[] = [];
  for (const e of paths.edges) {
    const line = [nodes.get(e.a), ...(e.via ?? []), nodes.get(e.b)];
    for (let s = 0; s + 1 < line.length; s++) {
      const a = line[s];
      const b = line[s + 1];
      if (a && b) out.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, half: e.width / 2 });
    }
  }
  return out;
}

/** Distance to the nearest road, in units of that road's half width (Infinity off every road's reach) */
function roadReach(segments: RoadSegment[], x: number, y: number, maxHalfWidths: number): number {
  let best = Infinity;
  for (const s of segments) {
    const reach = s.half * maxHalfWidths;
    if (x < Math.min(s.ax, s.bx) - reach || x > Math.max(s.ax, s.bx) + reach) continue;
    if (y < Math.min(s.ay, s.by) - reach || y > Math.max(s.ay, s.by) + reach) continue;
    const dx = s.bx - s.ax;
    const dy = s.by - s.ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / len2)) : 0;
    const d = Math.hypot(x - s.ax - dx * t, y - s.ay - dy * t) / s.half;
    if (d < best) best = d;
  }
  return best;
}

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Ground class at a world point from the pathing map: 1 rim (unwalkable,
 * outside, or unbuildable away from the roads: a map's outer ring), else 0
 * (build ground). `nearRoad`: the point lies by a road, where unbuildable
 * ground is the lane.
 */
function rimAt(p: PathingMap | null, t: W3eTerrain, wx: number, wy: number, nearRoad: boolean): number {
  if (!p) return 0;
  const i = Math.floor((wx - t.offsetX) / WPM_CELL);
  const j = Math.floor((wy - t.offsetY) / WPM_CELL);
  if (i < 0 || j < 0 || i >= p.width || j >= p.height) return 1;
  const v = p.cells[j * p.width + i];
  if (v & WPM.NO_WALK) return 1;
  return !nearRoad && v & WPM.NO_BUILD ? 1 : 0;
}

/** Road reach (half widths) within which unbuildable ground counts as lane, not rim */
const LANE_REACH = 2.5;

/** Splat and layers of the enhanced ground */
export function enhanceGround(input: EnhanceInput): { layers: MapGroundLayer[]; splat: MapSplat; palette: Palette } {
  const palette = biomePalette(input.tileset);
  const layers: MapGroundLayer[] = SLOTS.slice(0, MAX_GROUND_LAYERS).map((slot) => ({
    material: resolveMaterial({ id: palette[slot], category: slotCategory(slot) }, input.catalog),
  }));
  const res = splatResolutionFor(input.samples);
  const maps: [Uint8Array, Uint8Array] = [new Uint8Array(res * res * 4), new Uint8Array(res * res * 4)];
  const segments = roadSegments(input.paths);
  const { frame, terrain: t, pathing } = input;
  const w = new Float32Array(SLOTS.length);
  // Rim: averaged over a small cross so its edge is soft
  const rimSoft = (wx: number, wy: number, nearRoad: boolean): number => {
    const d = 48;
    return (
      (rimAt(pathing, t, wx, wy, nearRoad) * 2 +
        rimAt(pathing, t, wx + d, wy, nearRoad) +
        rimAt(pathing, t, wx - d, wy, nearRoad) +
        rimAt(pathing, t, wx, wy + d, nearRoad) +
        rimAt(pathing, t, wx, wy - d, nearRoad)) /
      6
    );
  };
  for (let v = 0; v < res; v++) {
    const my = -input.depth / 2 + ((v + 0.5) / res) * input.depth;
    const wy = frame.centerY + my / frame.scale;
    for (let u = 0; u < res; u++) {
      const mx = -input.width / 2 + ((u + 0.5) / res) * input.width;
      const wx = frame.centerX + mx / frame.scale;
      w.fill(0);
      const reach = roadReach(segments, mx, my, LANE_REACH + 0.5);
      // Road: paved to 0.7 of the half width, a gravel edge out to about 1.25 that frays with noise
      const fray = valueNoise(mx * 0.35, my * 0.35, 11) * 0.12;
      const road = 1 - smooth(0.6, 0.8, reach + fray);
      const edge = (1 - smooth(1.05, 1.35, reach + fray)) * (1 - road);
      const rest = 1 - road - edge;
      const rim = rimSoft(wx, wy, reach < LANE_REACH);
      // Meadow patches, large and small
      const n1 = valueNoise(mx / 38, my / 38, 3);
      const n2 = valueNoise(mx / 13, my / 13, 7);
      // Mostly plain grass; lush and dry patches blend in at most two thirds
      const lush = 0.65 * smooth(0.2, 0.7, n1 + n2 * 0.35);
      const dry = 0.45 * smooth(0.35, 0.8, -n1 + n2 * 0.4);
      const moss = smooth(0.0, 0.5, valueNoise(mx / 21, my / 21, 5));
      w[3] = road;
      w[4] = edge;
      const ground = rest * (1 - rim);
      w[0] = ground * Math.max(0, 1 - lush - dry);
      w[1] = ground * lush;
      w[2] = ground * dry;
      const forest = rest * rim;
      w[5] = forest * (1 - moss * 0.7);
      w[6] = forest * moss * 0.7;
      const texel = (v * res + u) * 4;
      for (let k = 0; k < SLOTS.length; k++) {
        if (w[k] > 0) maps[k >> 2][texel + (k & 3)] = Math.round(Math.min(1, w[k]) * 255);
      }
    }
  }
  return { layers, splat: { resolution: res, maps }, palette };
}

function slotCategory(slot: Slot): string {
  return slot.startsWith('road') ? 'road' : slot.startsWith('forest') ? 'forest' : 'grass';
}

/**
 * Trees on the rim (unwalkable flat ground, the border) where the map has
 * none: one candidate per `spacing` metres, jittered and kept by a hash,
 * away from roads, water, cliff faces and the map's own trees and houses
 */
export function rimTrees(
  input: EnhanceInput,
  existing: readonly MapObject[],
  heightSlope: (x: number, y: number) => number,
  isWater: (x: number, y: number) => boolean,
  budget: number,
  spacing = 7,
): MapObject[] {
  if (budget <= 0 || !input.pathing) return [];
  const palette = biomePalette(input.tileset);
  const segments = roadSegments(input.paths);
  const { frame, terrain: t, pathing } = input;
  // The map's objects on a coarse grid, to keep clear of them
  const cell = spacing;
  const columns = Math.ceil(input.width / cell) + 1;
  const taken = new Uint8Array(columns * (Math.ceil(input.depth / cell) + 1));
  const key = (x: number, y: number): number =>
    Math.floor((y + input.depth / 2) / cell) * columns + Math.floor((x + input.width / 2) / cell);
  for (const o of existing) taken[key(o.x, o.y)] = 1;
  const out: MapObject[] = [];
  let n = 0;
  for (let y = -input.depth / 2 + cell / 2; y < input.depth / 2; y += cell) {
    for (let x = -input.width / 2 + cell / 2; x < input.width / 2; x += cell) {
      n++;
      if (out.length >= budget) return out;
      const h = hashIndex(n, 0x7ee5);
      if ((h & 0xff) < 64) continue; // a quarter left open
      const jx = x + (((h >>> 8) & 0xff) / 255 - 0.5) * cell * 0.8;
      const jy = y + (((h >>> 16) & 0xff) / 255 - 0.5) * cell * 0.8;
      if (taken[key(jx, jy)]) continue;
      const wx = frame.centerX + jx / frame.scale;
      const wy = frame.centerY + jy / frame.scale;
      const reach = roadReach(segments, jx, jy, 4);
      if (reach < 3 || !rimAt(pathing, t, wx, wy, reach < LANE_REACH) || !frame.contains(wx, wy)) continue;
      // Not on cliff faces, not in water
      if (heightSlope(jx, jy) > 35 || isWater(jx, jy)) continue;
      out.push({
        id: `t${n}`,
        asset: palette.trees[(h >>> 24) % palette.trees.length],
        x: Math.round(jx * 100) / 100,
        y: Math.round(jy * 100) / 100,
        z: 0,
        rotation: Math.round((((h >>> 4) & 0x3ff) / 1023) * Math.PI * 2 * 100) / 100,
        scale: Math.round((0.8 + ((h >>> 12) & 0xff) / 255 * 0.5) * 100) / 100,
      });
    }
  }
  return out;
}
