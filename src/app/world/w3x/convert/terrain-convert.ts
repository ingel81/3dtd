/**
 * Warcraft terrain to the map document's terrain: heights, water, ground
 * layers and splat maps over the imported area.
 *
 * Heights: corner ground height plus cliff layer (128 units a level). Inside
 * a tile the ground height is bilinear; the cliff layer steps at the tile
 * middle to the nearest corner's level, so cliffs come out as near-vertical
 * steps one sample wide, and ramps (tiles with a ramp corner) blend the
 * layer bilinearly into slopes.
 *
 * Water: corners with the water flag whose water surface lies above the
 * ground. The most common level is the map's water (`terrain.water`), every
 * other level a water body of its own (`terrain.waterBodies`), such as basins
 * on a raised platform.
 *
 * Splat: each texel blends the ground textures of its tile's four corners
 * with smoothstep weights, like Warcraft's corner-based tiles but softer.
 */

import type { MapGroundLayer, MapSplat, MapTerrain, MapWater } from '../../custom-map/map-document';
import { splatResolutionFor } from '../../custom-map/map-create';
import { MAX_GROUND_LAYERS } from '../../custom-map/map-file';
import { W3E_FLAG, W3_TILE, type W3eTerrain, cornerGroundZ, cornerWaterZ } from '../formats/w3e';
import type { Bounds } from '../routes/lane-mask';
import { type CatalogEntryRef, CLIFF_MATERIAL, groundRule, resolveMaterial } from './ground-materials';

/** World units to map metres around the imported area's centre */
export class ImportFrame {
  readonly centerX: number;
  readonly centerY: number;

  constructor(
    readonly bounds: Bounds,
    /** Metres per world unit */
    readonly scale: number,
  ) {
    this.centerX = (bounds.minX + bounds.maxX) / 2;
    this.centerY = (bounds.minY + bounds.maxY) / 2;
  }

  x(wx: number): number {
    return (wx - this.centerX) * this.scale;
  }

  y(wy: number): number {
    return (wy - this.centerY) * this.scale;
  }

  contains(wx: number, wy: number): boolean {
    const b = this.bounds;
    return wx >= b.minX && wx <= b.maxX && wy >= b.minY && wy <= b.maxY;
  }
}

export interface TileSample {
  /** Corner indices sw, se, nw, ne */
  c00: number;
  c10: number;
  c01: number;
  c11: number;
  u: number;
  v: number;
}

function tileAt(t: W3eTerrain, wx: number, wy: number, out: TileSample): TileSample {
  const fx = (wx - t.offsetX) / W3_TILE;
  const fy = (wy - t.offsetY) / W3_TILE;
  const i = Math.max(0, Math.min(t.width - 2, Math.floor(fx)));
  const j = Math.max(0, Math.min(t.height - 2, Math.floor(fy)));
  out.u = Math.max(0, Math.min(1, fx - i));
  out.v = Math.max(0, Math.min(1, fy - j));
  out.c00 = j * t.width + i;
  out.c10 = out.c00 + 1;
  out.c01 = out.c00 + t.width;
  out.c11 = out.c01 + 1;
  return out;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Terrain height in world units at a world point */
export function heightAt(t: W3eTerrain, wx: number, wy: number, s: TileSample = {} as TileSample): number {
  tileAt(t, wx, wy, s);
  const { c00, c10, c01, c11, u, v } = s;
  const ground = lerp(lerp(cornerGroundZ(t, c00), cornerGroundZ(t, c10), u), lerp(cornerGroundZ(t, c01), cornerGroundZ(t, c11), u), v);
  const ramp = (t.flags[c00] | t.flags[c10] | t.flags[c01] | t.flags[c11]) & W3E_FLAG.RAMP;
  let layer: number;
  if (ramp) layer = lerp(lerp(t.layer[c00], t.layer[c10], u), lerp(t.layer[c01], t.layer[c11], u), v);
  else layer = t.layer[u < 0.5 ? (v < 0.5 ? c00 : c01) : v < 0.5 ? c10 : c11];
  return ground + (layer - 2) * W3_TILE;
}

export interface TerrainConvertOptions {
  samplesPerTile: number;
  catalog?: CatalogEntryRef[];
  waterColor: string;
  cliffAngle: number;
}

export interface TerrainConvertResult {
  terrain: MapTerrain;
  /** Ground tile id -> material id */
  materials: Map<string, string>;
  waterSamples: number;
  warnings: string[];
}

export function convertTerrain(t: W3eTerrain, frame: ImportFrame, options: TerrainConvertOptions): TerrainConvertResult {
  const warnings: string[] = [];
  const b = frame.bounds;
  const n = options.samplesPerTile;
  const step = W3_TILE / n;
  const columns = Math.round((b.maxX - b.minX) / step) + 1;
  const rows = Math.round((b.maxY - b.minY) / step) + 1;
  const cellSize = step * frame.scale;
  const heights = new Float32Array(columns * rows);
  const s = {} as TileSample;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      heights[j * columns + i] = heightAt(t, b.minX + i * step, b.minY + j * step, s) * frame.scale;
    }
  }

  // Corners inside the area: which textures they use, where water is
  const ci0 = Math.max(0, Math.floor((b.minX - t.offsetX) / W3_TILE));
  const ci1 = Math.min(t.width - 1, Math.ceil((b.maxX - t.offsetX) / W3_TILE));
  const cj0 = Math.max(0, Math.floor((b.minY - t.offsetY) / W3_TILE));
  const cj1 = Math.min(t.height - 1, Math.ceil((b.maxY - t.offsetY) / W3_TILE));
  const textureUse = new Map<number, number>();
  /** Water levels in 8-unit buckets: corner count and summed level */
  const waterLevels = new Map<number, { count: number; sum: number }>();
  for (let j = cj0; j <= cj1; j++) {
    for (let i = ci0; i <= ci1; i++) {
      const c = j * t.width + i;
      textureUse.set(t.texture[c], (textureUse.get(t.texture[c]) ?? 0) + 1);
      if (t.flags[c] & W3E_FLAG.WATER) {
        const z = cornerWaterZ(t, c);
        const bucket = waterLevels.get(Math.round(z / 8)) ?? { count: 0, sum: 0 };
        bucket.count++;
        bucket.sum += z;
        waterLevels.set(Math.round(z / 8), bucket);
      }
    }
  }

  // Ground layers: materials by use, the most used first (the base layer)
  const materials = new Map<string, string>();
  const materialUse = new Map<string, number>();
  for (const [tex, count] of textureUse) {
    const tile = t.groundTiles[tex] ?? '????';
    const material = resolveMaterial({ id: groundRule(tile).material, category: groundRule(tile).category }, options.catalog);
    materials.set(tile, material);
    materialUse.set(material, (materialUse.get(material) ?? 0) + count);
  }
  const ordered = [...materialUse].sort((x, y) => y[1] - x[1]).map(([m]) => m);
  const kept = ordered.slice(0, MAX_GROUND_LAYERS);
  if (ordered.length > MAX_GROUND_LAYERS) {
    warnings.push(`terrain: ${ordered.length} ground materials, the ${ordered.length - MAX_GROUND_LAYERS} least used merged`);
  }
  const layerOfMaterial = (m: string): number => {
    const k = kept.indexOf(m);
    if (k >= 0) return k;
    const cat = options.catalog?.find((c) => c.id === m)?.category;
    const same = cat ? kept.findIndex((x) => options.catalog?.find((c) => c.id === x)?.category === cat) : -1;
    return Math.max(0, same);
  };
  const layerOfTexture = new Int8Array(16).fill(0);
  for (let tex = 0; tex < t.groundTiles.length && tex < 16; tex++) {
    const m = materials.get(t.groundTiles[tex]);
    if (m) layerOfTexture[tex] = layerOfMaterial(m);
  }
  const layers: MapGroundLayer[] = kept.map((material) => ({ material }));
  if (layers.length === 0) layers.push({ material: resolveMaterial({ id: 'dirt', category: 'soil' }, options.catalog) });

  const splat = buildSplat(t, frame, Math.max(columns, rows), layerOfTexture);

  // Water: the most common level is the map's water, every other level a water body of its own
  let water: MapWater | null = null;
  const waterBodies: MapWater[] = [];
  let waterSamples = 0;
  if (waterLevels.size > 0) {
    const levels = [...waterLevels.values()].sort((x, y) => y.count - x.count).map((l) => l.sum / l.count);
    const masks = levels.map(() => new Uint8Array(columns * rows));
    const counts = levels.map(() => 0);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < columns; i++) {
        const wx = b.minX + i * step;
        const wy = b.minY + j * step;
        tileAt(t, wx, wy, s);
        const c = s.v < 0.5 ? (s.u < 0.5 ? s.c00 : s.c10) : s.u < 0.5 ? s.c01 : s.c11;
        if (!(t.flags[c] & W3E_FLAG.WATER)) continue;
        const z = cornerWaterZ(t, c);
        if (z * frame.scale <= heights[j * columns + i]) continue;
        // The body whose level is nearest
        let k = 0;
        for (let n = 1; n < levels.length; n++) if (Math.abs(levels[n] - z) < Math.abs(levels[k] - z)) k = n;
        masks[k][j * columns + i] = 255;
        counts[k]++;
        waterSamples++;
      }
    }
    levels.forEach((level, k) => {
      if (counts[k] === 0) return;
      const body: MapWater = { level: level * frame.scale, mask: masks[k], color: options.waterColor };
      if (!water) water = body;
      else waterBodies.push(body);
    });
  }

  return {
    terrain: {
      width: (columns - 1) * cellSize,
      depth: (rows - 1) * cellSize,
      grid: { columns, rows, cellSize, heights },
      layers,
      splat,
      water,
      ...(waterBodies.length ? { waterBodies } : {}),
      cliffAngle: options.cliffAngle,
      cliffMaterial: resolveMaterial(CLIFF_MATERIAL, options.catalog),
    },
    materials,
    waterSamples,
    warnings,
  };
}

const smooth = (x: number): number => x * x * (3 - 2 * x);

function buildSplat(t: W3eTerrain, frame: ImportFrame, samples: number, layerOfTexture: Int8Array): MapSplat {
  const res = splatResolutionFor(samples);
  const maps: [Uint8Array, Uint8Array] = [new Uint8Array(res * res * 4), new Uint8Array(res * res * 4)];
  const b = frame.bounds;
  const s = {} as TileSample;
  const w = new Float32Array(MAX_GROUND_LAYERS);
  for (let v = 0; v < res; v++) {
    const wy = b.minY + ((v + 0.5) / res) * (b.maxY - b.minY);
    for (let u = 0; u < res; u++) {
      const wx = b.minX + ((u + 0.5) / res) * (b.maxX - b.minX);
      tileAt(t, wx, wy, s);
      const su = smooth(s.u);
      const sv = smooth(s.v);
      w.fill(0);
      w[layerOfTexture[t.texture[s.c00]]] += (1 - su) * (1 - sv);
      w[layerOfTexture[t.texture[s.c10]]] += su * (1 - sv);
      w[layerOfTexture[t.texture[s.c01]]] += (1 - su) * sv;
      w[layerOfTexture[t.texture[s.c11]]] += su * sv;
      const texel = (v * res + u) * 4;
      for (let k = 0; k < MAX_GROUND_LAYERS; k++) {
        if (w[k] > 0) maps[k >> 2][texel + (k & 3)] = Math.round(w[k] * 255);
      }
    }
  }
  return { resolution: res, maps };
}
