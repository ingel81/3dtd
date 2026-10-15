/**
 * Ground paint: the splat maps hold one weight per layer and texel (layer k
 * in map k >> 2, channel k & 3). Painting raises one layer and lowers the
 * others so a texel's weights keep adding up to 255; erasing lowers a layer
 * and gives its share to the others (to layer 0 when nothing else is left).
 * The third map (layers 9 to 12) exists only on maps with more than 8
 * layers; without it those weights read as 0 and are not written.
 */
import { MAX_GROUND_LAYERS, fitSplatMaps, type MapTerrain, type MapWater } from '../../world/custom-map/map-document';
import { heightAt, slopeAt, texelRectAround, texelX, texelY, type GridRect } from '../model/grid';
import { brushWeight, type BrushSettings } from './brush';

export const MAX_LAYERS = MAX_GROUND_LAYERS;

/** Reads the 12 weights of texel `t` into `out` */
export function readWeights(terrain: MapTerrain, texel: number, out: Float32Array): void {
  const [m0, m1, m2] = terrain.splat.maps;
  const at = texel * 4;
  for (let c = 0; c < 4; c++) {
    out[c] = m0[at + c];
    out[c + 4] = m1[at + c];
    out[c + 8] = m2 ? m2[at + c] : 0;
  }
}

/** Writes 12 weights, scaled so they add up to 255; without a third map the last four count as 0 */
export function writeWeights(terrain: MapTerrain, texel: number, w: Float32Array): void {
  const [m0, m1, m2] = terrain.splat.maps;
  const layers = m2 ? 12 : 8;
  let sum = 0;
  for (let k = 0; k < layers; k++) sum += w[k];
  if (sum <= 0) {
    w.fill(0);
    w[0] = 255;
    sum = 255;
  }
  const s = 255 / sum;
  // Round so the sum stays exactly 255: the largest layer takes the rest
  let total = 0;
  let largest = 0;
  const at = texel * 4;
  const bytes = new Array<number>(layers);
  for (let k = 0; k < layers; k++) {
    bytes[k] = Math.round(w[k] * s);
    total += bytes[k];
    if (bytes[k] > bytes[largest]) largest = k;
  }
  bytes[largest] = Math.max(0, bytes[largest] + 255 - total);
  for (let c = 0; c < 4; c++) {
    m0[at + c] = bytes[c];
    m1[at + c] = bytes[c + 4];
    if (m2) m2[at + c] = bytes[c + 8];
  }
}

/** Paint (or erase) layer `layer` under the brush by up to `amount` (0..1 of full) per dab */
export function paintDab(
  terrain: MapTerrain,
  x: number,
  y: number,
  brush: BrushSettings,
  layer: number,
  amount: number,
  erase = false,
): GridRect {
  const rect = texelRectAround(terrain, x, y, brush.radius);
  const res = terrain.splat.resolution;
  const w = new Float32Array(MAX_LAYERS);
  for (let v = rect.j0; v <= rect.j1; v++) {
    const dy = texelY(terrain, v) - y;
    for (let u = rect.i0; u <= rect.i1; u++) {
      const weight = brushWeight(Math.hypot(texelX(terrain, u) - x, dy), brush.radius, brush.falloff);
      if (weight <= 0) continue;
      const texel = v * res + u;
      readWeights(terrain, texel, w);
      const a = Math.min(1, amount * brush.strength * weight);
      if (erase) {
        w[layer] *= 1 - a;
        let rest = 0;
        for (let k = 0; k < MAX_LAYERS; k++) if (k !== layer) rest += w[k];
        if (rest <= 0 && layer !== 0) w[0] = 255 - w[layer];
      } else {
        for (let k = 0; k < MAX_LAYERS; k++) w[k] = k === layer ? w[k] + (255 - w[k]) * a : w[k] * (1 - a);
      }
      writeWeights(terrain, texel, w);
    }
  }
  return rect;
}

/** The layer with the most weight at a map point */
export function dominantLayer(terrain: MapTerrain, x: number, y: number): number {
  const res = terrain.splat.resolution;
  const u = Math.min(res - 1, Math.max(0, Math.floor(((x + terrain.width / 2) / terrain.width) * res)));
  const v = Math.min(res - 1, Math.max(0, Math.floor(((y + terrain.depth / 2) / terrain.depth) * res)));
  const w = new Float32Array(MAX_LAYERS);
  readWeights(terrain, v * res + u, w);
  let best = 0;
  for (let k = 1; k < terrain.layers.length; k++) if (w[k] > w[best]) best = k;
  return best;
}

/** A rule of the auto paint: where a layer goes by slope and height */
export interface AutoPaintRule {
  layer: number;
  minSlope: number;
  maxSlope: number;
  minHeight: number;
  maxHeight: number;
  /** Soft edge of the bands, degrees and metres */
  blend: number;
}

/**
 * Rules from the materials the map already has: the first layer covers
 * everything, a sand-like layer the low shore of the map's water (none on
 * a map without water: low ground away from any shore stays as it is), a
 * rock-like one slopes from 30 degrees on (gentler flanks keep their
 * grass, as on real mountains), a snow-like one the peaks, over the rock up
 * to 40 degrees so a steep summit stays white. Of several candidates a
 * rock is taken before a stone, a stone before a cliff.
 */
export function defaultAutoRules(terrain: MapTerrain): AutoPaintRule[] {
  const rules: AutoPaintRule[] = [];
  const find = (...words: string[]) => {
    for (const w of words) {
      const k = terrain.layers.findIndex((l, n) => n > 0 && l.material.toLowerCase().includes(w));
      if (k >= 0) return k;
    }
    return -1;
  };
  let min = Infinity;
  let max = -Infinity;
  for (const h of terrain.grid.heights) {
    if (h < min) min = h;
    if (h > max) max = h;
  }
  const span = Math.max(1, max - min);
  rules.push({ layer: 0, minSlope: 0, maxSlope: 90, minHeight: -Infinity, maxHeight: Infinity, blend: 4 });
  const water = shoreLevel(terrain);
  const sand = find('sand', 'beach', 'mud');
  if (sand >= 0 && water !== null) {
    rules.push({ layer: sand, minSlope: 0, maxSlope: 20, minHeight: -Infinity, maxHeight: water + Math.max(1.5, span * 0.05), blend: 1.5 });
  }
  const rock = find('rock', 'stone', 'cliff');
  if (rock >= 0) rules.push({ layer: rock, minSlope: 35, maxSlope: 90, minHeight: -Infinity, maxHeight: Infinity, blend: 5 });
  const snow = find('snow', 'ice');
  if (snow >= 0) rules.push({ layer: snow, minSlope: 0, maxSlope: 40, minHeight: min + span * 0.8, maxHeight: Infinity, blend: span * 0.04 });
  return rules;
}

/** The level of the map's water a shore forms at: the main water, else the lowest lake or sea; null without water */
function shoreLevel(terrain: MapTerrain): number | null {
  const wet = (w: MapWater | null | undefined) => !!w && (w.kind ?? 'water') !== 'lava' && w.mask.some((v) => v);
  if (wet(terrain.water)) return terrain.water!.level;
  const levels = (terrain.waterBodies ?? []).filter(wet).map((w) => w.level);
  return levels.length ? Math.min(...levels) : null;
}

/** Repaints the whole map from rules; later rules lie over earlier ones */
export function autoPaint(terrain: MapTerrain, rules: readonly AutoPaintRule[]): GridRect {
  const res = terrain.splat.resolution;
  const w = new Float32Array(MAX_LAYERS);
  for (let v = 0; v < res; v++) {
    const y = texelY(terrain, v);
    for (let u = 0; u < res; u++) {
      const x = texelX(terrain, u);
      const h = heightAt(terrain, x, y);
      const s = slopeAt(terrain, x, y);
      w.fill(0);
      for (const r of rules) {
        if (r.layer >= terrain.layers.length) continue;
        const a = band(s, r.minSlope, r.maxSlope, r.blend) * band(h, r.minHeight, r.maxHeight, r.blend);
        if (a <= 0) continue;
        for (let k = 0; k < MAX_LAYERS; k++) w[k] *= 1 - a;
        w[r.layer] += 255 * a;
      }
      writeWeights(terrain, v * res + u, w);
    }
  }
  return { i0: 0, j0: 0, i1: res - 1, j1: res - 1 };
}

/** 1 inside [lo, hi], fading to 0 over `blend` outside */
function band(value: number, lo: number, hi: number, blend: number): number {
  const b = Math.max(1e-6, blend);
  if (value < lo) return Math.max(0, 1 - (lo - value) / b);
  if (value > hi) return Math.max(0, 1 - (value - hi) / b);
  return 1;
}

/** Moves layer `from` to place `to` in both the layer list and the weights */
export function moveLayer(terrain: MapTerrain, from: number, to: number): void {
  const n = terrain.layers.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return;
  const order = [...Array(MAX_LAYERS).keys()];
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  const [layer] = terrain.layers.splice(from, 1);
  terrain.layers.splice(to, 0, layer);
  remapWeights(terrain, order);
}

/** Removes layer `index`; its weight goes to the others */
export function removeLayer(terrain: MapTerrain, index: number): void {
  if (terrain.layers.length <= 1 || index < 0 || index >= terrain.layers.length) return;
  const res = terrain.splat.resolution;
  const w = new Float32Array(MAX_LAYERS);
  for (let t = 0; t < res * res; t++) {
    readWeights(terrain, t, w);
    w[index] = 0;
    writeWeights(terrain, t, w);
  }
  terrain.layers.splice(index, 1);
  const order = [...Array(MAX_LAYERS).keys()];
  order.splice(index, 1);
  order.push(index);
  remapWeights(terrain, order);
  // Down to 8 layers: the third map holds nothing any more
  fitSplatMaps(terrain);
}

/** New weights: slot k takes what slot `order[k]` held */
function remapWeights(terrain: MapTerrain, order: number[]): void {
  const res = terrain.splat.resolution;
  const w = new Float32Array(MAX_LAYERS);
  const out = new Float32Array(MAX_LAYERS);
  for (let t = 0; t < res * res; t++) {
    readWeights(terrain, t, w);
    for (let k = 0; k < MAX_LAYERS; k++) out[k] = w[order[k]];
    writeWeights(terrain, t, out);
  }
}
