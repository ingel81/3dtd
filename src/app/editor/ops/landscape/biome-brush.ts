/**
 * The biome brush: one dab shapes the ground, paints its materials and
 * grows its objects under a round brush with a frayed rim.
 *
 * - Heights pull toward the original ground plus the biome's relief (rolling
 *   hills, ridges, dunes, a level village, a sunken swamp with pools), so a
 *   held brush settles instead of piling up; roads keep their ground.
 * - Ground paint mixes the biome's materials by noise, a steep-slope
 *   material on slopes.
 * - Objects come from a jittered grid per object kind and stroke seed:
 *   every grid cell has one candidate spot and one dice roll, decided once,
 *   so the forest is the same however the mouse moved over it. Core plants
 *   grow where the brush was strong, edge plants (undergrowth, fences) where
 *   it only brushed the rim; edge plants are decided when the stroke ends.
 */
import type { MapTerrain } from '../../../world/custom-map/map-document';
import { sampleRectAround, sampleX, sampleY, slopeAt, texelRectAround, texelX, texelY, type GridRect } from '../../model/grid';
import { brushWeight, type BrushSettings } from '../brush';
import { MAX_LAYERS, readWeights, writeWeights } from '../paint-ops';
import { HEIGHT_LIMITS } from '../terrain-ops';
import type { BiomeDef, BiomeObject } from './biomes';
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
  }
}

/** Whether a swamp pool lies here */
function inPool(stroke: LandscapeStroke, biome: BiomeDef, x: number, y: number): boolean {
  return !!biome.pools && 0.5 + 0.5 * stroke.noise.fbm(x, y, 22, 3, 'n5') < biome.pools;
}

export function biomeDab(
  stroke: LandscapeStroke,
  center: { x: number; y: number },
  brush: BrushSettings,
  biome: BiomeDef,
  dt: number,
): void {
  const doc = stroke.doc;
  const t = doc.terrain;
  const g = t.grid;
  stroke.anchor ??= { ...center, h: stroke.baseHeight(...sampleIndex(t, center.x, center.y)) };
  const strength = brush.strength;

  // Water for swamp pools: the existing level, or a new one just under the stroke's start
  const waterLevel = biome.pools ? stroke.ensureWater(stroke.anchor.h - 0.3) : null;

  // Heights
  const rect = sampleRectAround(t, center.x, center.y, brush.radius);
  stroke.touchHeights(rect);
  if (waterLevel !== null) stroke.touchWater(rect);
  const pull = 1 - Math.exp(-SHAPE_RATE * Math.min(dt, 0.1));
  let wet = false;
  for (let j = rect.j0; j <= rect.j1; j++) {
    const y = sampleY(t, j);
    for (let i = rect.i0; i <= rect.i1; i++) {
      const x = sampleX(t, i);
      const w = frayedWeight(stroke.noise, Math.hypot(x - center.x, y - center.y), x, y, brush);
      if (w <= 0) continue;
      const keep = stroke.roadKeep(x, y);
      if (keep <= 0) continue;
      const base = stroke.baseHeight(i, j);
      let target = biome.relief.kind === 'flatten' ? stroke.anchor.h : base + relief(stroke, biome, x, y) * strength;
      const k = j * g.columns + i;
      if (waterLevel !== null && w > 0.45 && inPool(stroke, biome, x, y)) {
        target = Math.min(target, waterLevel - 0.35);
        t.water!.mask[k] = 255;
        wet = true;
      }
      const a = Math.min(1, pull * w * keep * (0.4 + 0.6 * strength));
      const h = g.heights[k] + (target - g.heights[k]) * a;
      g.heights[k] = Math.min(HEIGHT_LIMITS.max, Math.max(HEIGHT_LIMITS.min, h));
    }
  }

  // Ground paint
  const layers = biome.ground.map((gr) => ({ layer: stroke.layerOf(gr.material), share: gr.share }));
  const steep = biome.steepGround ? stroke.layerOf(biome.steepGround) : null;
  const trect = texelRectAround(t, center.x, center.y, brush.radius);
  stroke.touchSplat(trect);
  paintBiome(stroke, t, trect, center, brush, layers, steep, Math.min(1, PAINT_RATE * Math.min(dt, 0.1)));

  // Objects
  const placed = growObjects(stroke, center, brush, biome, false);
  stroke.changed({ heights: rect, splat: trect, water: wet || undefined, objects: placed.length ? placed : undefined });
}

/** Edge plants: decided once the stroke is over, where the brush only grazed */
export function finishBiome(stroke: LandscapeStroke, brush: BrushSettings, biome: BiomeDef): void {
  const placed = growObjects(stroke, null, brush, biome, true);
  if (placed.length) stroke.changed({ objects: placed });
}

function sampleIndex(t: MapTerrain, x: number, y: number): [number, number] {
  const g = t.grid;
  return [
    Math.min(g.columns - 1, Math.max(0, Math.round((x + t.width / 2) / g.cellSize))),
    Math.min(g.rows - 1, Math.max(0, Math.round((y + t.depth / 2) / g.cellSize))),
  ];
}

function paintBiome(
  stroke: LandscapeStroke,
  t: MapTerrain,
  rect: GridRect,
  center: { x: number; y: number },
  brush: BrushSettings,
  layers: { layer: number | null; share: number }[],
  steep: number | null,
  rate: number,
): void {
  const usable = layers.filter((l) => l.layer !== null) as { layer: number; share: number }[];
  if (!usable.length) return;
  const total = usable.reduce((s, l) => s + l.share, 0);
  const res = t.splat.resolution;
  const w8 = new Float32Array(MAX_LAYERS);
  for (let v = rect.j0; v <= rect.j1; v++) {
    const y = texelY(t, v);
    for (let u = rect.i0; u <= rect.i1; u++) {
      const x = texelX(t, u);
      const w = frayedWeight(stroke.noise, Math.hypot(x - center.x, y - center.y), x, y, brush);
      if (w <= 0) continue;
      // Which material: noise picks a slot by the shares
      let pick = usable[0].layer;
      const n = (0.5 + 0.5 * stroke.noise.fbm(x, y, 18, 3, 'n6')) * total;
      let acc = 0;
      for (const l of usable) {
        acc += l.share;
        if (n <= acc) {
          pick = l.layer;
          break;
        }
      }
      if (steep !== null && slopeAt(t, x, y) > 30) pick = steep;
      const a = Math.min(1, rate * w * (0.5 + 0.5 * brush.strength));
      const texel = v * res + u;
      readWeights(t, texel, w8);
      for (let k = 0; k < MAX_LAYERS; k++) w8[k] = k === pick ? w8[k] + (255 - w8[k]) * a : w8[k] * (1 - a);
      writeWeights(t, texel, w8);
    }
  }
}

/** The jittered-grid cell size for a density (one candidate per cell) */
function cellSize(o: BiomeObject, strengthScale: number): number {
  return Math.sqrt(10000 / Math.max(0.1, o.perHectare * strengthScale));
}

/** Chance a candidate grows, from the brush weight it got and its zone */
function zoneChance(zone: BiomeObject['zone'], w: number): number {
  switch (zone) {
    case 'core':
      return smooth(0.45, 0.85, w);
    case 'any':
      return smooth(0.05, 0.6, w);
    case 'edge':
      // A band at the rim: weights between a touch and the middle
      return w <= 0.02 ? 0 : smooth(0.02, 0.15, w) * (1 - smooth(0.45, 0.75, w));
  }
}

/**
 * Candidates under the brush (or all remembered ones when `center` is null
 * at the stroke's end). Core and any plants are placed as soon as their
 * chance passes their roll; edge plants remember their strongest weight and
 * are decided at the end.
 */
function growObjects(
  stroke: LandscapeStroke,
  center: { x: number; y: number } | null,
  brush: BrushSettings,
  biome: BiomeDef,
  ending: boolean,
): string[] {
  const t = stroke.doc.terrain;
  const placed: string[] = [];
  biome.objects.forEach((o, kind) => {
    const asset = o.assets.find((a) => stroke.catalog.objects.has(a));
    if (!asset) return;
    // Density follows the brush strength; the grid is fixed per stroke so candidates stay put
    const cell = cellSize(o, 1);
    const footprint = stroke.catalog.object(asset).radius;
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
      const chance = zoneChance(o.zone, w) * brush.strength * clump;
      const roll = n.hash(ci, cj, kind * 4 + 3);
      if (roll >= chance) {
        // Core plants may still grow when the brush comes closer; edge plants are final
        if (ending) stroke.decided.add(key);
        return;
      }
      stroke.decided.add(key);
      if (Math.abs(px) > t.width / 2 - 2 || Math.abs(py) > t.depth / 2 - 2) return;
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
    if (!center) return;
    const r = brush.radius;
    for (let cj = Math.floor((center.y - r) / cell); cj <= Math.floor((center.y + r) / cell); cj++) {
      for (let ci = Math.floor((center.x - r) / cell); ci <= Math.floor((center.x + r) / cell); ci++) {
        const px = (ci + stroke.noise.hash(ci, cj, kind * 4 + 1)) * cell;
        const py = (cj + stroke.noise.hash(ci, cj, kind * 4 + 2)) * cell;
        const w = frayedWeight(stroke.noise, Math.hypot(px - center.x, py - center.y), px, py, brush);
        if (w > 0) visit(ci, cj, w);
      }
    }
  });
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
