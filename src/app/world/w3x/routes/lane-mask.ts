/**
 * Where creeps walk, as a raster: the lane mask the terrain strategy
 * skeletonises and the converter measures lane widths in.
 *
 * Tower defense maps keep lanes walkable but not buildable; the mask takes
 * those pathing cells first. When that does not look like lanes (almost
 * nothing, or most of the walkable ground), it falls back to walkable ground
 * below the map's common cliff level (sunken lanes), then to walkable ground
 * with road-like tiles.
 */

import { type W3eTerrain, W3_TILE } from '../formats/w3e';
import { type PathingMap, WPM, WPM_CELL, laneCell, walkable } from '../formats/wpm';

export interface LaneMask {
  /** Pixels per row and column */
  width: number;
  height: number;
  /** World units per pixel */
  cell: number;
  /** World position of pixel (0, 0)'s lower left corner */
  originX: number;
  originY: number;
  data: Uint8Array;
  source: 'pathing' | 'sunken' | 'road';
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Ground tiles that read as roads (paved, bricks, tiles, roads) by the end of their id */
export const ROAD_TILE = /(btl|sqd|rtl|blm|wmb|cbp|stp|rd|brk|cob|tle)$/i;

/** Pathing-cell scale: 2 = half tiles (64 units), enough to keep 2-tile lanes 4 pixels wide */
const DOWNSAMPLE = 2;

export function buildLaneMask(pathing: PathingMap | null, terrain: W3eTerrain, bounds: Bounds): LaneMask | null {
  if (!pathing) return null;
  const cell = WPM_CELL * DOWNSAMPLE;
  const originX = terrain.offsetX;
  const originY = terrain.offsetY;
  const width = Math.floor(pathing.width / DOWNSAMPLE);
  const height = Math.floor(pathing.height / DOWNSAMPLE);

  const inside = (px: number, py: number): boolean => {
    const x = originX + (px + 0.5) * cell;
    const y = originY + (py + 0.5) * cell;
    return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
  };
  // A pixel takes the majority of its pathing cells
  const sample = (px: number, py: number, test: (v: number) => boolean): boolean => {
    let hits = 0;
    for (let dy = 0; dy < DOWNSAMPLE; dy++) {
      for (let dx = 0; dx < DOWNSAMPLE; dx++) {
        const v = pathing.cells[(py * DOWNSAMPLE + dy) * pathing.width + px * DOWNSAMPLE + dx];
        if (test(v)) hits++;
      }
    }
    return hits * 2 >= DOWNSAMPLE * DOWNSAMPLE;
  };
  const corner = (px: number, py: number): number => {
    const i = Math.min(terrain.width - 1, Math.floor(((px + 0.5) * cell) / W3_TILE));
    const j = Math.min(terrain.height - 1, Math.floor(((py + 0.5) * cell) / W3_TILE));
    return j * terrain.width + i;
  };

  const make = (test: (px: number, py: number) => boolean): { data: Uint8Array; count: number; walk: number } => {
    const data = new Uint8Array(width * height);
    let count = 0;
    let walk = 0;
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        if (!inside(px, py) || !sample(px, py, walkable)) continue;
        walk++;
        if (test(px, py)) {
          data[py * width + px] = 1;
          count++;
        }
      }
    }
    return { data, count, walk };
  };
  const plausible = (m: { count: number; walk: number }): boolean => m.count > m.walk * 0.03 && m.count < m.walk * 0.6;

  const lanes = make((px, py) => sample(px, py, laneCell) && sample(px, py, (v) => (v & WPM.LAND) !== 0));
  if (plausible(lanes)) return { width, height, cell, originX, originY, data: lanes.data, source: 'pathing' };

  // Common layer of walkable ground
  const counts = new Map<number, number>();
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      if (!inside(px, py) || !sample(px, py, walkable)) continue;
      const l = terrain.layer[corner(px, py)];
      counts.set(l, (counts.get(l) ?? 0) + 1);
    }
  }
  const common = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 2;
  const sunken = make((px, py) => terrain.layer[corner(px, py)] < common);
  if (plausible(sunken)) return { width, height, cell, originX, originY, data: sunken.data, source: 'sunken' };

  const road = make((px, py) => ROAD_TILE.test(terrain.groundTiles[terrain.texture[corner(px, py)]] ?? ''));
  if (plausible(road)) return { width, height, cell, originX, originY, data: road.data, source: 'road' };
  return null;
}

export function maskAt(m: LaneMask, x: number, y: number): boolean {
  const px = Math.floor((x - m.originX) / m.cell);
  const py = Math.floor((y - m.originY) / m.cell);
  return px >= 0 && py >= 0 && px < m.width && py < m.height && m.data[py * m.width + px] === 1;
}

/**
 * Lane width in world units across the segment a-b: at several points along
 * it, the run of mask pixels perpendicular to it; the median of those runs.
 * Null when no sample point lies on the mask.
 */
export function laneWidth(m: LaneMask, a: { x: number; y: number }, b: { x: number; y: number }, maxWidth: number): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;
  const nx = -dy / len;
  const ny = dx / len;
  const step = m.cell / 2;
  const runs: number[] = [];
  for (let k = 1; k < 8; k++) {
    const t = k / 8;
    const cx = a.x + dx * t;
    const cy = a.y + dy * t;
    if (!maskAt(m, cx, cy)) continue;
    let w = step;
    for (let s = step; s <= maxWidth; s += step) {
      if (!maskAt(m, cx + nx * s, cy + ny * s)) break;
      w += step;
    }
    for (let s = step; s <= maxWidth; s += step) {
      if (!maskAt(m, cx - nx * s, cy - ny * s)) break;
      w += step;
    }
    runs.push(Math.min(w, maxWidth));
  }
  if (runs.length === 0) return null;
  runs.sort((p, q) => p - q);
  return runs[Math.floor(runs.length / 2)];
}
