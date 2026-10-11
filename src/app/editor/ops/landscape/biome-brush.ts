/**
 * The biome brush: one dab shapes the ground, paints its materials and
 * grows its objects under a round brush with a frayed rim.
 *
 * - Heights pull toward the original ground plus the biome's relief (rolling
 *   hills, ridges, dunes, crater fields, a level village, a sunken swamp
 *   with pools of swamp water, lava or ice), so a held brush settles
 *   instead of piling up; roads keep their ground.
 * - Ground paint mixes the biome's materials by noise, a steep-slope
 *   material on slopes, a shore material around pools, and a pattern on
 *   top: the city's street grid or hell's glowing cracks.
 * - Objects come from a jittered grid per object kind and stroke seed:
 *   every grid cell has one candidate spot and one dice roll, decided once,
 *   so the forest is the same however the mouse moved over it. Core plants
 *   grow where the brush was strong, edge plants (undergrowth, fences) where
 *   it only brushed the rim; edge plants are decided when the stroke ends.
 *   A kind mixes all its candidate assets the catalogue has, one per spot.
 *   City buildings and lamps take fixed slots along the street grid.
 */
import type { MapTerrain } from '../../../world/custom-map/map-document';
import { sampleX, sampleY, slopeAt, texelX, texelY, type GridRect } from '../../model/grid';
import { brushWeight, type BrushSettings } from '../brush';
import { MAX_LAYERS, readWeights, writeWeights } from '../paint-ops';
import { HEIGHT_LIMITS } from '../terrain-ops';
import { CITY_GRID, type BiomeDef, type BiomeObject } from './biomes';
import { citySlots, streetDistance } from './city';
import { crackAt } from './cracks';
import { craterProfile } from './shapes';
import type { CatalogIndex } from '../../catalog/asset-catalog';
import { smooth, type LandscapeNoise } from './landscape-noise';
import type { LandscapeStroke } from './landscape-stroke';

/** Share per second the ground and paint close toward the biome at full strength */
const SHAPE_RATE = 2.5;
const PAINT_RATE = 3;

/** Brush weight with a ragged rim: noise moves the edge in and out */
export function frayedWeight(noise: LandscapeNoise, d: number, x: number, y: number, brush: BrushSettings): number {
  const w = brushWeight(d, brush.radius, Math.max(0.35, brush.falloff));
  if (w <= 0 || w >= 1) return w;
  return smooth(0.1, 0.9, w + (noise.fray(x, y) - 0.5) * 0.7);
}

/** Relief offset of a biome at a map point, metres at full strength */
function relief(stroke: LandscapeStroke, biome: BiomeDef, x: number, y: number): number {
  const r = biome.relief;
  const n = stroke.noise;
  switch (r.kind) {
    case 'rolling':
      return r.amplitude * n.fbm(x, y, r.wave, 4);
    case 'ridged':
      return r.amplitude * (n.ridged(x, y, r.wave) - 0.25);
    case 'dunes':
      return r.amplitude * n.billowed(x, y, r.wave);
    case 'sink':
      return -r.amplitude * (0.6 + 0.4 * n.fbm(x, y, r.wave, 3));
    case 'flatten':
      return 0;
    case 'craters':
      return r.amplitude * (craterField(n, x, y, r.wave) + 0.15 * n.fbm(x, y, r.wave * 2, 3));
  }
}

/**
 * A field of craters: about half the cells of a `wave` metre grid hold one,
 * of a random size (small ones many, big ones few); deeper the wider. In
 * units of the relief amplitude.
 */
export function craterField(n: LandscapeNoise, x: number, y: number, wave: number): number {
  const ci = Math.floor(x / wave);
  const cj = Math.floor(y / wave);
  let h = 0;
  for (let j = cj - 1; j <= cj + 1; j++) {
    for (let i = ci - 1; i <= ci + 1; i++) {
      if (n.hash(i, j, 71) > 0.55) continue;
      const size = n.hash(i, j, 74);
      const radius = wave * (0.15 + 0.5 * size * size);
      const d = Math.hypot(x - (i + n.hash(i, j, 72)) * wave, y - (j + n.hash(i, j, 73)) * wave);
      if (d < radius * 1.8) h += craterProfile(d / radius) * (0.4 + 1.6 * (radius / wave));
    }
  }
  return h;
}

/** The pattern layers of a biome, resolved once per dab */
interface PatternLayers {
  kind: BiomeDef['pattern'];
  a: number | null;
  b: number | null;
}

/** Swamp pool noise at a point, 0..1; pools lie below `biome.pools` */
function poolNoise(stroke: LandscapeStroke, x: number, y: number): number {
  // Domain-warped so the pools come out as rounded, lobed blobs
  const wx = x + 9 * stroke.noise.fbm(x, y, 30, 2, 'n2');
  const wy = y + 9 * stroke.noise.fbm(x + 71, y - 13, 30, 2, 'n3');
  return 0.5 + 0.5 * stroke.noise.fbm(wx, wy, 26, 3, 'n5');
}

/** How deep inside a pool, 0 outside to 1 in its middle */
export function poolDepth(stroke: LandscapeStroke, biome: BiomeDef, x: number, y: number): number {
  if (!biome.pools) return 0;
  return 1 - smooth(biome.pools - 0.14, biome.pools, poolNoise(stroke, x, y));
}

/** A ring around the pools (mud, reeds), 0..1 */
export function poolShore(stroke: LandscapeStroke, biome: BiomeDef, x: number, y: number): number {
  if (!biome.pools) return 0;
  const n = poolNoise(stroke, x, y);
  return smooth(biome.pools - 0.06, biome.pools + 0.01, n) * (1 - smooth(biome.pools + 0.04, biome.pools + 0.12, n));
}

/** Where a biome goes and how strongly: a frayed brush dab, or a whole band of the map at full weight */
export interface BiomeReach {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** 0..1 at a map point */
  weight(x: number, y: number): number;
  /** Where the change is centred, for symmetry; none for a band */
  center?: { x: number; y: number };
}

function dabReach(noise: LandscapeNoise, center: { x: number; y: number }, brush: BrushSettings): BiomeReach {
  const r = brush.radius;
  return {
    minX: center.x - r,
    maxX: center.x + r,
    minY: center.y - r,
    maxY: center.y + r,
    weight: (x, y) => frayedWeight(noise, Math.hypot(x - center.x, y - center.y), x, y, brush),
    center,
  };
}

export function biomeDab(
  stroke: LandscapeStroke,
  center: { x: number; y: number },
  brush: BrushSettings,
  biome: BiomeDef,
  dt: number,
): void {
  const step = Math.min(dt, 0.1);
  applyBiome(stroke, dabReach(stroke.noise, center, brush), biome, brush.strength, 1 - Math.exp(-SHAPE_RATE * step), Math.min(1, PAINT_RATE * step));
}

/**
 * The biome at full strength over a band of the map (`minY` to `maxY`, the
 * whole width), the ground and paint set at once; for map templates. The
 * level for pools and levelled biomes comes from the map's middle.
 */
export function biomeBand(stroke: LandscapeStroke, biome: BiomeDef, minY: number, maxY: number): void {
  const t = stroke.doc.terrain;
  stroke.anchor ??= { x: 0, y: 0, h: stroke.baseHeight(...sampleIndex(t, 0, 0)) };
  applyBiome(stroke, { minX: -t.width / 2, maxX: t.width / 2, minY, maxY, weight: () => 1 }, biome, 1, 1, 1);
}

function applyBiome(stroke: LandscapeStroke, reach: BiomeReach, biome: BiomeDef, strength: number, pull: number, paintRate: number): void {
  const doc = stroke.doc;
  const t = doc.terrain;
  const g = t.grid;
  const start = reach.center ?? { x: (reach.minX + reach.maxX) / 2, y: (reach.minY + reach.maxY) / 2 };
  stroke.anchor ??= { ...start, h: stroke.baseHeight(...sampleIndex(t, start.x, start.y)) };

  // Water for the pools: a body of the biome's kind near the stroke's start, or a new one just under it
  const pool = biome.pools ? stroke.poolWater(stroke.anchor.h - 0.3, biome.water ?? 'water') : null;
  const waterLevel = pool ? pool.water.level : null;

  // Heights
  const rect = sampleRectOf(t, reach);
  stroke.touchHeights(rect);
  pool?.touch(rect);
  let wet = false;
  for (let j = rect.j0; j <= rect.j1; j++) {
    const y = sampleY(t, j);
    for (let i = rect.i0; i <= rect.i1; i++) {
      const x = sampleX(t, i);
      const w = reach.weight(x, y);
      if (w <= 0) continue;
      const keep = stroke.roadKeep(x, y);
      if (keep <= 0) continue;
      const base = stroke.baseHeight(i, j);
      let target = biome.relief.kind === 'flatten' ? stroke.anchor.h : base + relief(stroke, biome, x, y) * strength;
      const k = j * g.columns + i;
      if (waterLevel !== null && w > 0.3) {
        // Pools: the ground sinks under the level toward their middle; the mask reaches a little
        // past the shore, the renderer cuts the surface where the ground rises above it
        const p = poolDepth(stroke, biome, x, y);
        if (p > 0) {
          target = Math.min(target, waterLevel + 0.25 - 1.1 * p);
          // The mask only where the ground ends up under the level, so no water floats over the shore
          if (p > 0.3) {
            pool!.water.mask[k] = 255;
            wet = true;
          }
        }
      }
      const a = Math.min(1, pull * w * keep * (0.4 + 0.6 * strength));
      const h = g.heights[k] + (target - g.heights[k]) * a;
      g.heights[k] = Math.min(HEIGHT_LIMITS.max, Math.max(HEIGHT_LIMITS.min, h));
    }
  }

  // Ground paint
  const layers = biome.ground.map((gr) => ({ layer: stroke.layerOf(gr.material), share: gr.share }));
  const steep = biome.steepGround ? stroke.layerOf(biome.steepGround) : null;
  const mud = biome.pools ? stroke.layerOf(biome.shoreGround ?? ['mud', 'dirt']) : null;
  const pattern: PatternLayers =
    biome.pattern === 'streets'
      ? { kind: 'streets', a: stroke.layerOf(['asphalt', 'asphalt-cracked', 'paving']), b: stroke.layerOf(['sidewalk', 'concrete', 'paving']) }
      : biome.pattern === 'cracks'
        ? { kind: 'cracks', a: stroke.layerOf(['lava', 'lava-crust']), b: stroke.layerOf(['lava-crust', 'obsidian', 'basalt']) }
        : { kind: undefined, a: null, b: null };
  const trect = texelRectOf(t, reach);
  stroke.touchSplat(trect);
  paintBiome(stroke, t, trect, reach, strength, biome, layers, steep, mud, pattern, paintRate);

  // Objects
  const placed = growObjects(stroke, reach, strength, biome, false);
  stroke.changed({ heights: rect, splat: trect, water: wet || undefined, objects: placed.length ? placed : undefined }, reach.center);
}

/** Edge plants: decided once the stroke is over, where the brush only grazed */
export function finishBiome(stroke: LandscapeStroke, brush: BrushSettings, biome: BiomeDef): void {
  const placed = growObjects(stroke, null, brush.strength, biome, true);
  if (placed.length) stroke.changed({ objects: placed });
}

function sampleIndex(t: MapTerrain, x: number, y: number): [number, number] {
  const g = t.grid;
  return [
    Math.min(g.columns - 1, Math.max(0, Math.round((x + t.width / 2) / g.cellSize))),
    Math.min(g.rows - 1, Math.max(0, Math.round((y + t.depth / 2) / g.cellSize))),
  ];
}

function sampleRectOf(t: MapTerrain, r: BiomeReach): GridRect {
  const g = t.grid;
  return {
    i0: Math.max(0, Math.floor((r.minX + t.width / 2) / g.cellSize)),
    i1: Math.min(g.columns - 1, Math.ceil((r.maxX + t.width / 2) / g.cellSize)),
    j0: Math.max(0, Math.floor((r.minY + t.depth / 2) / g.cellSize)),
    j1: Math.min(g.rows - 1, Math.ceil((r.maxY + t.depth / 2) / g.cellSize)),
  };
}

function texelRectOf(t: MapTerrain, r: BiomeReach): GridRect {
  const res = t.splat.resolution;
  return {
    i0: Math.max(0, Math.floor(((r.minX + t.width / 2) / t.width) * res)),
    i1: Math.min(res - 1, Math.ceil(((r.maxX + t.width / 2) / t.width) * res)),
    j0: Math.max(0, Math.floor(((r.minY + t.depth / 2) / t.depth) * res)),
    j1: Math.min(res - 1, Math.ceil(((r.maxY + t.depth / 2) / t.depth) * res)),
  };
}

function paintBiome(
  stroke: LandscapeStroke,
  t: MapTerrain,
  rect: GridRect,
  reach: BiomeReach,
  strength: number,
  biome: BiomeDef,
  layers: { layer: number | null; share: number }[],
  steep: number | null,
  mud: number | null,
  pattern: PatternLayers,
  rate: number,
): void {
  const usable = layers.filter((l) => l.layer !== null) as { layer: number; share: number }[];
  if (!usable.length) return;
  const res = t.splat.resolution;
  const w8 = new Float32Array(MAX_LAYERS);
  const target = new Float32Array(MAX_LAYERS);
  const noiseOf = ['n6', 'n5', 'n3', 'n2'] as const;
  for (let v = rect.j0; v <= rect.j1; v++) {
    const y = texelY(t, v);
    for (let u = rect.i0; u <= rect.i1; u++) {
      const x = texelX(t, u);
      const w = reach.weight(x, y);
      if (w <= 0) continue;
      groundMix(stroke, t, biome, usable, steep, mud, pattern, x, y, target, noiseOf);
      const a = Math.min(1, rate * w * (0.5 + 0.5 * strength));
      const texel = v * res + u;
      readWeights(t, texel, w8);
      for (let k = 0; k < MAX_LAYERS; k++) w8[k] = w8[k] * (1 - a) + target[k] * 255 * a;
      writeWeights(t, texel, w8);
    }
  }
}

/**
 * The biome's ground at a point as a soft mix: each material grows in
 * broad clusters of its own noise (wavelength about 50 m) weighted by its
 * share, so patches have soft, irregular rims instead of salt and pepper;
 * the steep material takes over smoothly on slopes, mud (or the biome's
 * shore ground) rings the pools, and the pattern goes on top.
 */
function groundMix(
  stroke: LandscapeStroke,
  t: MapTerrain,
  biome: BiomeDef,
  usable: { layer: number; share: number }[],
  steep: number | null,
  mud: number | null,
  pattern: PatternLayers,
  x: number,
  y: number,
  out: Float32Array,
  noiseOf: readonly ('n6' | 'n5' | 'n3' | 'n2')[],
): void {
  out.fill(0);
  let sum = 0;
  usable.forEach((l, k) => {
    const n = 0.5 + 0.5 * stroke.noise.fbm(x + k * 97, y - k * 53, 50, 4, noiseOf[k % noiseOf.length]);
    // Sharpened so a patch has a body and a soft rim
    const v = l.share * Math.pow(smooth(0.25, 0.75, n) + 0.05, 2.2);
    out[l.layer] += v;
    sum += v;
  });
  if (sum > 0) for (let k = 0; k < MAX_LAYERS; k++) out[k] /= sum;
  const fold = (layer: number, share: number) => {
    if (share <= 0) return;
    for (let k = 0; k < MAX_LAYERS; k++) out[k] *= 1 - share;
    out[layer] += share;
  };
  if (steep !== null) fold(steep, smooth(24, 36, slopeAt(t, x, y)));
  if (mud !== null && biome.pools) fold(mud, poolShore(stroke, biome, x, y) * 0.9);
  if (pattern.kind === 'streets') {
    const d = streetDistance(x, y);
    if (pattern.b !== null) fold(pattern.b, 1 - smooth(CITY_GRID.sidewalk - 0.4, CITY_GRID.sidewalk + 0.4, d));
    if (pattern.a !== null) fold(pattern.a, 1 - smooth(CITY_GRID.street - 0.3, CITY_GRID.street + 0.3, d));
  } else if (pattern.kind === 'cracks') {
    const c = crackAt(stroke, x, y);
    if (pattern.b !== null) fold(pattern.b, c.crust * 0.4);
    if (pattern.a !== null) fold(pattern.a, c.crack);
  }
}

/** The jittered-grid cell size for a density (one candidate per cell) */
function cellSize(o: BiomeObject, strengthScale: number): number {
  return Math.sqrt(10000 / Math.max(0.1, o.perHectare * strengthScale));
}

/** Chance a candidate grows, from the brush weight it got and its zone */
function zoneChance(zone: BiomeObject['zone'], w: number, shore = 0): number {
  switch (zone) {
    case 'shore':
      return smooth(0.1, 0.4, w) * shore;
    case 'core':
      return smooth(0.45, 0.85, w);
    case 'any':
      return smooth(0.05, 0.6, w);
    case 'edge':
      // A band at the rim: weights between a touch and the middle
      return w <= 0.02 ? 0 : smooth(0.02, 0.15, w) * (1 - smooth(0.45, 0.75, w));
    case 'block':
    case 'street':
      // Slots of the street grid, decided in growSlots
      return smooth(0.45, 0.85, w);
  }
}

/**
 * Candidates in reach (or all remembered ones when `reach` is null at the
 * stroke's end). Core and any plants are placed as soon as their
 * chance passes their roll; edge plants remember their strongest weight and
 * are decided at the end.
 */
function growObjects(stroke: LandscapeStroke, reach: BiomeReach | null, strength: number, biome: BiomeDef, ending: boolean): string[] {
  const t = stroke.doc.terrain;
  const placed: string[] = [];
  const streets = biome.pattern === 'streets';
  biome.objects.forEach((o, kind) => {
    const assets = o.assets.filter((a) => stroke.catalog.objects.has(a));
    if (!assets.length) return;
    if (o.zone === 'block' || o.zone === 'street') {
      if (reach) placed.push(...growSlots(stroke, reach, strength, o, kind, assets));
      return;
    }
    // Density follows the brush strength; the grid is fixed per stroke so candidates stay put
    const cell = cellSize(o, 1);
    const visit = (ci: number, cj: number, w: number) => {
      const key = `${kind}:${ci}:${cj}`;
      if (stroke.decided.has(key)) return;
      const n = stroke.noise;
      const px = (ci + n.hash(ci, cj, kind * 4 + 1)) * cell;
      const py = (cj + n.hash(ci, cj, kind * 4 + 2)) * cell;
      if (o.zone === 'edge' && !ending) {
        stroke.strongest.set(key, Math.max(stroke.strongest.get(key) ?? 0, w));
        return;
      }
      const clump = o.clump ? 1 - o.clump + o.clump * 2 * (0.5 + 0.5 * n.fbm(px, py, 30, 2, 'n3')) : 1;
      const shore = o.zone === 'shore' ? poolShore(stroke, biome, px, py) : 0;
      const chance = zoneChance(o.zone, w, shore) * strength * clump;
      const roll = n.hash(ci, cj, kind * 4 + 3);
      if (roll >= chance) {
        // Core plants may still grow when the brush comes closer; edge plants are final
        if (ending) stroke.decided.add(key);
        return;
      }
      stroke.decided.add(key);
      if (Math.abs(px) > t.width / 2 - 2 || Math.abs(py) > t.depth / 2 - 2) return;
      const asset = assets[Math.floor(n.hash(ci, cj, kind * 4 + 6) * assets.length) % assets.length];
      const footprint = stroke.catalog.object(asset).radius;
      if (streets && streetDistance(px, py) < CITY_GRID.sidewalk + footprint + 0.5) return;
      if (!stroke.freeForObject(px, py, footprint)) return;
      if (stroke.grid.near({ x: px, y: py }, o.spacing)) return;
      const s = o.scale[0] + (o.scale[1] - o.scale[0]) * n.hash(ci, cj, kind * 4 + 4);
      const slope = slopeAt(t, px, py);
      const obj = stroke.addObject({
        asset,
        x: Math.round(px * 100) / 100,
        y: Math.round(py * 100) / 100,
        z: Math.round(-Math.min(2, (slope / 10) * 0.4) * s * 100) / 100,
        rotation: Math.round(n.hash(ci, cj, kind * 4 + 5) * Math.PI * 2 * 1000) / 1000,
        scale: Math.round(s * 1000) / 1000,
      });
      placed.push(obj.id);
    };
    if (ending) {
      if (o.zone !== 'edge') return;
      for (const [key, w] of stroke.strongest) {
        const [k, ci, cj] = key.split(':').map(Number);
        if (k === kind) visit(ci, cj, w);
      }
      return;
    }
    if (!reach) return;
    for (let cj = Math.floor(reach.minY / cell); cj <= Math.floor(reach.maxY / cell); cj++) {
      for (let ci = Math.floor(reach.minX / cell); ci <= Math.floor(reach.maxX / cell); ci++) {
        const px = (ci + stroke.noise.hash(ci, cj, kind * 4 + 1)) * cell;
        const py = (cj + stroke.noise.hash(ci, cj, kind * 4 + 2)) * cell;
        if (px < reach.minX || px >= reach.maxX || py < reach.minY || py >= reach.maxY) continue;
        const w = reach.weight(px, py);
        if (w > 0) visit(ci, cj, w);
      }
    }
  });
  return placed;
}

/** City buildings and lamps: the grid's slots in reach where it is strong, each decided once */
function growSlots(stroke: LandscapeStroke, reach: BiomeReach, strength: number, o: BiomeObject, kind: number, assets: string[]): string[] {
  const t = stroke.doc.terrain;
  const n = stroke.noise;
  const placed: string[] = [];
  for (const slot of citySlots(o.zone as 'block' | 'street', reach.minX, reach.maxX, reach.minY, reach.maxY)) {
    const key = `${kind}:${slot.key}`;
    if (stroke.decided.has(key)) continue;
    const w = reach.weight(slot.x, slot.y);
    if (w < 0.45) continue;
    stroke.decided.add(key);
    const [hi, hj] = [Math.round(slot.x * 10), Math.round(slot.y * 10)];
    if (n.hash(hi, hj, kind * 4 + 3) >= Math.min(1, o.perHectare) * strength) continue;
    if (Math.abs(slot.x) > t.width / 2 - 4 || Math.abs(slot.y) > t.depth / 2 - 4) continue;
    const asset = assets[Math.floor(n.hash(hi, hj, kind * 4 + 6) * assets.length) % assets.length];
    if (!stroke.freeForObject(slot.x, slot.y, stroke.catalog.object(asset).radius * 0.5)) continue;
    if (stroke.grid.near(slot, o.spacing)) continue;
    const s = o.scale[0] + (o.scale[1] - o.scale[0]) * n.hash(hi, hj, kind * 4 + 4);
    const obj = stroke.addObject({ asset, x: slot.x, y: slot.y, z: 0, rotation: slot.rotation, scale: Math.round(s * 1000) / 1000 });
    placed.push(obj.id);
  }
  return placed;
}

/** Candidate spots the brush would grow at, for the preview under the cursor */
export function previewSpots(
  noise: LandscapeNoise,
  catalog: CatalogIndex,
  center: { x: number; y: number },
  brush: BrushSettings,
  biome: BiomeDef,
  limit = 400,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  biome.objects.forEach((o, kind) => {
    if (!o.assets.some((a) => catalog.objects.has(a))) return;
    if (o.zone === 'block' || o.zone === 'street') {
      const r = brush.radius;
      for (const slot of citySlots(o.zone, center.x - r, center.x + r, center.y - r, center.y + r)) {
        const w = frayedWeight(noise, Math.hypot(slot.x - center.x, slot.y - center.y), slot.x, slot.y, brush);
        if (out.length < limit && w >= 0.45) out.push({ x: slot.x, y: slot.y });
      }
      return;
    }
    const cell = cellSize(o, 1);
    const r = brush.radius;
    for (let cj = Math.floor((center.y - r) / cell); cj <= Math.floor((center.y + r) / cell) && out.length < limit; cj++) {
      for (let ci = Math.floor((center.x - r) / cell); ci <= Math.floor((center.x + r) / cell) && out.length < limit; ci++) {
        const n = noise;
        const px = (ci + n.hash(ci, cj, kind * 4 + 1)) * cell;
        const py = (cj + n.hash(ci, cj, kind * 4 + 2)) * cell;
        const w = frayedWeight(noise, Math.hypot(px - center.x, py - center.y), px, py, brush);
        const clump = o.clump ? 1 - o.clump + o.clump * 2 * (0.5 + 0.5 * n.fbm(px, py, 30, 2, 'n3')) : 1;
        if (n.hash(ci, cj, kind * 4 + 3) < zoneChance(o.zone, w) * brush.strength * clump) out.push({ x: px, y: py });
      }
    }
  });
  return out;
}
