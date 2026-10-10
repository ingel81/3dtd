/**
 * A fresh map document: flat or rolling ground of one material, a straight
 * road from the west edge to an HQ east of the middle, one spawn. The editor's
 * "New map" and tests start here.
 */
import {
  MAP_FORMAT,
  MAP_VERSION,
  type CustomMapDocument,
  type MapEnvironment,
} from './map-document';

export interface NewMapOptions {
  id: string;
  name: string;
  author?: string;
  description?: string;
  /** Extent in metres, rounded down to whole cells */
  width: number;
  depth: number;
  /** Metres between height samples */
  cellSize?: number;
  /** Start ground: flat at 0 or gentle hills */
  ground?: 'flat' | 'noise';
  /** Hill amplitude in metres for `noise` */
  relief?: number;
  seed?: number;
  /** Material of layer 0, painted everywhere */
  baseMaterial?: string;
  /** Splat texels per side */
  splatResolution?: number;
  /** Lay the starter road, spawn and HQ (on by default) */
  starter?: boolean;
  now?: Date;
}

export const DEFAULT_ENVIRONMENT: MapEnvironment = {
  sky: 'day',
  sunAzimuth: 135,
  sunElevation: 45,
  fogDensity: 0.0004,
  tint: '#ffffff',
};

export const DEFAULT_CELL_SIZE = 4;
export const DEFAULT_CLIFF_ANGLE = 40;
export const DEFAULT_ROAD_WIDTH = 8;

/** Map ids: lowercase letters, digits and dashes */
export const MAP_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** A map id from a name: "Lost Valley 2" -> "lost-valley-2" */
export function slugMapId(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'map';
}

export function createMapDocument(options: NewMapOptions): CustomMapDocument {
  const cellSize = options.cellSize ?? DEFAULT_CELL_SIZE;
  const columns = Math.max(2, Math.floor(options.width / cellSize) + 1);
  const rows = Math.max(2, Math.floor(options.depth / cellSize) + 1);
  const width = (columns - 1) * cellSize;
  const depth = (rows - 1) * cellSize;
  const heights = new Float32Array(columns * rows);
  if (options.ground === 'noise') {
    fillNoise(heights, columns, rows, cellSize, options.relief ?? 12, options.seed ?? 1);
  }
  const resolution = options.splatResolution ?? splatResolutionFor(Math.max(columns, rows));
  const splat0 = new Uint8Array(resolution * resolution * 4);
  for (let t = 0; t < resolution * resolution; t++) splat0[t * 4] = 255;
  const now = (options.now ?? new Date()).toISOString();
  const starter = options.starter ?? true;
  const edgeX = -width / 2 + cellSize * 2;
  const hqX = width * 0.25;

  return {
    format: MAP_FORMAT,
    version: MAP_VERSION,
    meta: {
      id: options.id,
      name: options.name,
      author: options.author ?? '',
      description: options.description ?? '',
      createdAt: now,
      updatedAt: now,
    },
    terrain: {
      width,
      depth,
      grid: { columns, rows, cellSize, heights },
      layers: [{ material: options.baseMaterial ?? 'grass' }],
      splat: { resolution, maps: [splat0, new Uint8Array(resolution * resolution * 4)] },
      water: null,
      cliffAngle: DEFAULT_CLIFF_ANGLE,
      cliffMaterial: 'rock',
    },
    objects: [],
    paths: starter
      ? {
          nodes: [
            { id: 'n1', x: edgeX, y: 0 },
            { id: 'n2', x: hqX, y: 0 },
          ],
          edges: [{ id: 'e1', a: 'n1', b: 'n2', width: DEFAULT_ROAD_WIDTH, kind: 'road' }],
        }
      : { nodes: [], edges: [] },
    spawns: starter ? [{ id: 's1', name: 'West', x: edgeX, y: 0 }] : [],
    hq: { x: starter ? hqX : 0, y: 0 },
    environment: { ...DEFAULT_ENVIRONMENT },
  };
}

/** About one splat texel per height cell, a power of two between 64 and 1024 */
export function splatResolutionFor(samples: number): number {
  let r = 64;
  while (r < samples && r < 1024) r *= 2;
  return r;
}

/** Smooth value noise in a few octaves, deterministic for a seed */
function fillNoise(out: Float32Array, columns: number, rows: number, cell: number, amp: number, seed: number): void {
  const octaves = [
    { wave: 400, weight: 1 },
    { wave: 160, weight: 0.4 },
    { wave: 60, weight: 0.15 },
  ];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      let h = 0;
      for (let o = 0; o < octaves.length; o++) {
        const { wave, weight } = octaves[o];
        h += valueNoise((i * cell) / wave, (j * cell) / wave, seed + o * 1013) * weight;
      }
      out[j * columns + i] = h * amp;
    }
  }
}

function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h & 0xffff) / 0xffff;
}

/** Value noise in [-1, 1] with smoothstep interpolation */
export function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return (top + (bottom - top) * sy) * 2 - 1;
}
