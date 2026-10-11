/**
 * Terrain generator: whole-map landscapes from a preset, a seed and a
 * strength, for a new map or over an existing one. Built on the seeded
 * noise of DevWorld (`devworld/utils/seeded-random.ts`).
 *
 * - Hills: rolling ground in two scales
 * - Valleys: broad hills cut by a network of sharp valleys
 * - Islands: land rising from water, sinking toward the map's edge
 * - Canyon: a high plain cut by a winding canyon with stepped walls
 * - Terraces: hills in flat steps with steep risers
 */
import type { CustomMapDocument, MapTerrain } from '../../world/custom-map/map-document';
import { autoPaint, defaultAutoRules } from './paint-ops';
import { edgePolyline, nearestOnPolyline } from './path-graph';
import { flattenUnderPaths } from './path-terrain';
import { emptyWater } from './water-ops';
import { sampleX, sampleY } from '../model/grid';
import { LandscapeNoise, smooth } from './landscape/landscape-noise';
import { HEIGHT_LIMITS } from './terrain-ops';

export type TerrainPreset = 'flat' | 'hills' | 'valleys' | 'islands' | 'canyon' | 'terraces';

export const TERRAIN_PRESETS: readonly { id: TerrainPreset; label: string; hint: string }[] = [
  { id: 'flat', label: 'Flat', hint: 'Level ground' },
  { id: 'hills', label: 'Hills', hint: 'Rolling ground in two scales' },
  { id: 'valleys', label: 'Valleys', hint: 'Broad hills cut by sharp valleys' },
  { id: 'islands', label: 'Islands', hint: 'Land rising from the sea, water all around' },
  { id: 'canyon', label: 'Canyon', hint: 'A high plain with a winding canyon' },
  { id: 'terraces', label: 'Terraces', hint: 'Hills in flat steps with steep risers' },
];

export interface GenerateOptions {
  preset: TerrainPreset;
  seed: number;
  /** 0..1, how high and rough */
  strength: number;
  /** Replace the ground, or add the preset on top of it */
  add?: boolean;
}

export interface GenerateResult {
  /** Water level when the preset wants water (islands, canyon river) */
  water: number | null;
  /** Ground materials the preset wants beside the base one, for auto paint */
  materials: string[][];
}

/** Height of the preset at a map point, metres */
export function presetHeight(t: MapTerrain, noise: LandscapeNoise, o: GenerateOptions, x: number, y: number): number {
  const size = Math.max(t.width, t.depth);
  const s = Math.max(0.05, o.strength);
  switch (o.preset) {
    case 'flat':
      return 0;
    case 'hills':
      return s * (22 * noise.fbm(x, y, size * 0.35, 4) + 6 * noise.fbm(x, y, size * 0.08, 3, 'n2'));
    case 'valleys': {
      const base = s * 20 * (0.6 + 0.4 * noise.fbm(x, y, size * 0.4, 3));
      const cut = Math.pow(noise.ridged(x, y, size * 0.3, 4), 3);
      return base - s * 26 * cut;
    }
    case 'islands': {
      const d = Math.max(Math.abs(x) / (t.width / 2), Math.abs(y) / (t.depth / 2));
      const land = 3 + s * 16 * (0.55 + 0.45 * noise.fbm(x, y, size * 0.25, 4));
      return land - (land + 8) * smooth(0.55, 0.95, d + 0.15 * noise.fbm(x, y, size * 0.12, 3, 'n3'));
    }
    case 'canyon': {
      // The canyon winds east to west across the middle
      const wave = size * 0.5;
      const centre = Math.sin((x / wave) * Math.PI) * t.depth * 0.12 + noise.fbm(x, 0, size * 0.2, 3, 'n4') * t.depth * 0.08;
      const half = Math.max(12, t.depth * 0.05);
      const d = Math.abs(y - centre);
      const plain = s * 34 + s * 4 * noise.fbm(x, y, size * 0.1, 3);
      const step = Math.max(3, plain / 4);
      const wall = smooth(half, half * 3.2, d);
      const stepped = Math.round((wall * plain) / step) * step;
      return 0.5 * (wall * plain) + 0.5 * stepped;
    }
    case 'terraces': {
      const h = s * 30 * (0.5 + 0.5 * noise.fbm(x, y, size * 0.3, 4));
      const step = 5 + 3 * s;
      const level = Math.floor(h / step);
      const f = h / step - level;
      return (level + smooth(0.7, 1, f)) * step;
    }
  }
}

/** Writes the preset into the terrain heights (all of them) */
export function generateTerrain(t: MapTerrain, o: GenerateOptions): GenerateResult {
  generateRows(t, o, 0, t.grid.rows);
  return presetResult(o);
}

/**
 * Writes the preset into rows `j0` to `j1` (exclusive) of the heights; a
 * worker generates a big map in bands this way and shows each as it comes
 */
export function generateRows(t: Pick<MapTerrain, 'width' | 'depth' | 'grid'>, o: GenerateOptions, j0: number, j1: number, noise = new LandscapeNoise(o.seed)): void {
  const g = t.grid;
  for (let j = j0; j < Math.min(j1, g.rows); j++) {
    const y = sampleY(t as MapTerrain, j);
    for (let i = 0; i < g.columns; i++) {
      const k = j * g.columns + i;
      const h = presetHeight(t as MapTerrain, noise, o, sampleX(t as MapTerrain, i), y) + (o.add ? g.heights[k] : 0);
      g.heights[k] = Math.min(HEIGHT_LIMITS.max, Math.max(HEIGHT_LIMITS.min, h));
    }
  }
}

/** Water and extra ground layers a preset wants */
export function presetResult(o: GenerateOptions): GenerateResult {
  switch (o.preset) {
    case 'islands':
      return { water: 0, materials: [['sand'], ['rocky-ground', 'gravel']] };
    case 'canyon':
      return { water: 0.6, materials: [['rocky-ground', 'gravel'], ['sand', 'dirt']] };
    case 'valleys':
    case 'terraces':
      return { water: null, materials: [['rocky-ground', 'gravel']] };
    default:
      return { water: null, materials: [] };
  }
}

/**
 * Makes a freshly generated map playable and coloured: water where the
 * preset wants it, the roads levelled (a causeway where they would run
 * under water), extra ground layers and an auto paint by slope and height.
 * `hasMaterial` says which catalogue materials exist.
 */
export function finishGenerated(doc: CustomMapDocument, result: GenerateResult, hasMaterial: (id: string) => boolean, repaint = true): void {
  const t = doc.terrain;
  if (result.water !== null) {
    t.water = emptyWater(t, result.water);
    t.water.mask.fill(255);
  }
  flattenUnderPaths(t, doc.paths, null, { shoulder: 10, smoothing: 30 });
  if (t.water) {
    const g = t.grid;
    const lift = t.water.level + 0.8;
    for (const e of doc.paths.edges) {
      const line = edgePolyline(doc.paths, e);
      for (let j = 0; j < g.rows; j++) {
        for (let i = 0; i < g.columns; i++) {
          const k = j * g.columns + i;
          if (g.heights[k] >= lift) continue;
          const hit = nearestOnPolyline(line, { x: sampleX(t, i), y: sampleY(t, j) });
          if (hit && hit.dist <= e.width / 2 + 3) g.heights[k] = lift;
        }
      }
    }
  }
  for (const candidates of result.materials) {
    const m = candidates.find(hasMaterial);
    if (m && !t.layers.some((l) => l.material === m) && t.layers.length < 8) t.layers.push({ material: m });
  }
  if (repaint && t.layers.length > 1) autoPaint(t, defaultAutoRules(t));
}
