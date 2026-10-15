/**
 * The map kit: builds or changes a map in code with the editor's own
 * operations, as a person would with the mouse. A landscape call is one
 * stroke of the Landscape tool (`LandscapeStroke`): biome dabs along a line,
 * landforms, cliff edges, rivers, roads. The terrain, paint, water, object
 * and path calls run the same ops as the Terrain, Paint, Water, Objects,
 * Paths and Spawns tools. Every stroke takes its seed from the kit's seed and
 * a counter, so a script gives the same map every time.
 *
 * The shipped levels are built with it (tools/maps/levels/kit.ts, LevelKit)
 * and an AI agent's scripts run against it (docs/AGENT_MCP.md). It writes
 * into the document directly; the strokes keep their steps in a history of
 * the kit's own (`editor`), which the caller drops or turns into one step.
 *
 * Order that works: ground shape (generator, forms, cliffs), rivers, roads,
 * spawns and HQ, then biomes and paint (they leave roads and markers alone),
 * then single objects.
 */
import { CatalogIndex } from '../catalog/asset-catalog';
import { EditorDocument } from '../model/editor-document';
import { heightAt, slopeAt, type GridRect } from '../model/grid';
import { BRUSH_LIMITS, type BrushSettings } from './brush';
import { finishGenerated, generateTerrain, type TerrainPreset } from './generate';
import { biomeBand, biomeDab, finishBiome } from './landscape/biome-brush';
import { biomeById, type BiomeId } from './landscape/biomes';
import { cracksDab } from './landscape/cracks';
import { erosionDab } from './landscape/erosion';
import { hashCell, LandscapeNoise } from './landscape/landscape-noise';
import { LandscapeStroke } from './landscape/landscape-stroke';
import { resample, simplify } from './landscape/lines';
import { carveRiver, DEFAULT_RIVER, type RiverOptions, type RiverResult } from './landscape/river';
import { buildRoad, DEFAULT_ROAD, type RoadOptions, type RoadResult } from './landscape/road';
import { cliffAlong, formDab, type FormKind } from './landscape/shapes';
import { ObjectGrid, ObjectIds, scatterDab, settled, rockShape, type ScatterOptions, DEFAULT_SCATTER } from './object-ops';
import { MAX_LAYERS, autoPaint, defaultAutoRules, paintDab, readWeights, removeLayer, type AutoPaintRule } from './paint-ops';
import { addNode, connect, edgePolyline, nearestNode, nearestOnEdges, pointAt, polylineLength, spawnRoutes, splitEdge } from './path-graph';
import { flattenUnderPaths, paintUnderPaths } from './path-terrain';
import { mirrorChange, objectImages, symmetryImages, type SymmetryMode } from './symmetry';
import { flattenDab, noiseDab, plateauDab, raiseDab, rampBetween, smoothDab, terraceDab, erodeDab } from './terrain-ops';
import { BODY_COLORS, emptyWater, fillBasin, fillFromEdge, lakeDab, waterMaskDab } from './water-ops';
import { validateMap, type MapIssue } from '../validation/map-validation';
import { assetCosts } from '../validation/map-budget';
import {
  fitSplatMaps,
  type CustomMapDocument,
  type MapEnvironment,
  type MapBridgeStyle,
  type MapGameplay,
  type MapObject,
  type MapPathKind,
  type MapPoint,
  type MapWaterKind,
} from '../../world/custom-map/map-document';

/** A brush as the panel sets it; falloff defaults to the editor's 0.6 */
export interface Brush {
  radius: number;
  strength?: number;
  falloff?: number;
}

/**
 * Where a brush goes: one spot, a line it is dragged along, or dab centres
 * worked out already (`dabCentres`), which it takes as they are
 */
export type Where = MapPoint | readonly MapPoint[] | DabList;

/** Dab centres of a stroke, as `dabCentres` gives them */
export interface DabList {
  readonly dabs: readonly MapPoint[];
}

export interface PlaceOptions {
  rotation?: number;
  /** Tilt after the turn around the model's own x axis (radians) */
  pitch?: number;
  /** Tilt around the model's own z axis (radians) */
  roll?: number;
  scale?: number;
  /** Height over the ground (the editor's Z field) */
  z?: number;
  blocksBuild?: boolean;
  blocksLos?: boolean;
  tint?: string;
}

export interface MapKitOptions {
  /** Named in the errors the kit throws (a level's id) */
  name: string;
  /** Seed of the strokes and the noise */
  seed: number;
  /** Ground layers the brushes may fill the list up to (MAX_LAYERS) */
  maxLayers?: number;
}

/** Turn (radians, counter-clockwise from north) that makes a model face from `from` toward `to` */
export function facing(from: MapPoint, to: MapPoint): number {
  return Math.atan2(-(to.x - from.x), to.y - from.y);
}

/** Small deterministic random numbers (mulberry32) */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

function brushOf(b: Brush): BrushSettings {
  const clampTo = (v: number, l: { min: number; max: number }) => Math.min(l.max, Math.max(l.min, v));
  return {
    radius: clampTo(b.radius, BRUSH_LIMITS.radius),
    strength: clampTo(b.strength ?? 1, BRUSH_LIMITS.strength),
    falloff: clampTo(b.falloff ?? 0.6, BRUSH_LIMITS.falloff),
  };
}

function isLine(w: Where): w is readonly MapPoint[] {
  return Array.isArray(w);
}

/** The dab centres of a brush dragged along `where`, about `step` metres apart */
function dabs(where: Where, step: number): MapPoint[] {
  if ('dabs' in where) return where.dabs.map((p) => ({ x: p.x, y: p.y }));
  if (!isLine(where)) return [{ x: where.x, y: where.y }];
  if (where.length < 2) return where.map((p) => ({ x: p.x, y: p.y }));
  return resample(where, Math.max(1, step));
}

/**
 * The dabs a Terrain, Paint or Water brush makes along `where` (a third of
 * its radius apart): a stroke split into runs of them changes the ground as
 * the whole stroke does, one run at a time
 */
export function dabCentres(where: Where, brush: Brush): MapPoint[] {
  return dabs(where, brushOf(brush).radius / 3);
}

export class MapKit {
  readonly editor: EditorDocument;
  /** Noise of the kit's seed, for a script's own choices */
  readonly noise: LandscapeNoise;
  /** The editor's symmetry switch: strokes, lines, objects and spawns land at every image */
  symmetry: SymmetryMode = 'none';
  readonly name: string;
  readonly seed: number;
  readonly maxLayers: number;
  private strokes = 0;
  /** Materials brushes wanted while the layer list was full (the editor's status line says the same) */
  readonly leftOut = new Set<string>();

  constructor(
    readonly doc: CustomMapDocument,
    readonly catalog: CatalogIndex,
    options: MapKitOptions,
  ) {
    this.name = options.name;
    this.seed = options.seed;
    this.maxLayers = options.maxLayers ?? MAX_LAYERS;
    this.editor = new EditorDocument(doc, { steps: 4, bytes: 32 * 1024 * 1024 });
    this.noise = new LandscapeNoise(options.seed);
  }

  get half(): number {
    return this.doc.terrain.width / 2;
  }

  /** Ground height at a map point */
  h(x: number, y: number): number {
    return heightAt(this.doc.terrain, x, y);
  }

  slope(x: number, y: number): number {
    return slopeAt(this.doc.terrain, x, y);
  }

  private nextSeed(): number {
    this.strokes++;
    return Math.floor(hashCell(this.strokes, this.seed, 977) * 2 ** 31);
  }

  /** One Landscape stroke: `paint` runs the dabs, the stroke lands as one step */
  stroke<T>(label: string, paint: (s: LandscapeStroke) => T, seed = this.nextSeed()): T {
    const s = new LandscapeStroke(this.editor, label, seed, this.catalog, this.maxLayers);
    s.symmetry = this.symmetry;
    // The level scripts build the shipped maps: their strokes copy and fill up the layer list as they always did
    s.editorCopies = false;
    const out = paint(s);
    for (const m of s.layersFull) this.leftOut.add(m);
    s.finish();
    return out;
  }

  /** The lines a line tool builds: the drawn one and its symmetric images (mirrored ones run backwards) */
  private images(line: readonly MapPoint[]): MapPoint[][] {
    const t = this.doc.terrain;
    return symmetryImages(this.symmetry, t.grid.columns === t.grid.rows).map((img) => {
      const mapped = line.map((q) => img.point(q));
      return img.flips ? mapped.reverse() : mapped;
    });
  }

  // ---- Landscape tool ------------------------------------------------------------------------------------------

  /**
   * The biome brush held for `hold` seconds at each dab along `where` (dabs a
   * third of the radius apart), the rim plants decided at the end
   */
  biome(id: BiomeId, where: Where, brush: Brush, hold = 0.6): void {
    const def = biomeById(id);
    const b = brushOf(brush);
    this.stroke(def.label, (s) => {
      for (const c of dabs(where, b.radius / 3)) for (let t = 0; t < hold; t += 0.1) biomeDab(s, c, b, def, 0.1);
      finishBiome(s, b, def);
    });
  }

  /** A template's whole-map biome pass (`biomeBand`) between two northings */
  biomeBand(id: BiomeId, minY = -this.half, maxY = this.half): void {
    const def = biomeById(id);
    this.stroke(def.label, (s) => {
      for (let y = minY; y < maxY; y += 48) biomeBand(s, def, y, Math.min(maxY, y + 48));
    });
  }

  /** Mountain, valley, plateau, crater or dunes, held `hold` seconds per dab */
  form(kind: FormKind, where: Where, brush: Brush, hold = 3): void {
    const b = brushOf(brush);
    this.stroke(kind, (s) => {
      for (const c of dabs(where, b.radius / 3)) {
        for (let t = 0; t < hold; t += 0.1) s.changed({ heights: formDab(s, kind, c, b, 0.1) }, c);
      }
    });
  }

  /** Cliff edge along a line: the ground left of the drawing direction rises by `height` */
  cliff(line: readonly MapPoint[], height: number, reach: number): void {
    this.stroke('Cliff edge', (s) => {
      s.symmetry = 'none';
      for (const l of this.images(line)) {
        const rect = cliffAlong(s, l, height, reach);
        if (rect) s.changed({ heights: rect });
      }
    });
  }

  /** Rain erosion: `drops` dabs along `where` */
  erode(where: Where, brush: Brush, rounds = 6): void {
    const b = brushOf(brush);
    this.stroke('Erode', (s) => {
      let dab = 0;
      for (const c of dabs(where, b.radius / 2)) for (let k = 0; k < rounds; k++) s.changed({ heights: erosionDab(s, c, b, dab++) }, c);
    });
  }

  /** Glow cracks held `hold` seconds per dab */
  cracks(where: Where, brush: Brush, hold = 1): void {
    const b = brushOf(brush);
    this.stroke('Glow cracks', (s) => {
      for (const c of dabs(where, b.radius / 3)) {
        for (let t = 0; t < hold; t += 0.1) {
          const r = cracksDab(s, c, b, 0.1);
          s.changed({ heights: r.heights, splat: r.splat ?? undefined }, c);
        }
      }
    });
  }

  /** A river or lava flow along a line (the River line of the Landscape tool) */
  river(line: readonly MapPoint[], options: Partial<RiverOptions> = {}): RiverResult[] {
    return this.stroke('River', (s) => {
      s.symmetry = 'none';
      const out: RiverResult[] = [];
      for (const l of this.images(line)) {
        const r = carveRiver(s, l, { ...DEFAULT_RIVER, ...options });
        if (!r) throw new Error(`${this.name}: river too short`);
        out.push(r);
      }
      return out;
    });
  }

  /** A road along a line (the Road line): joined at its ends, graded, paved, lamps or fences */
  road(line: readonly MapPoint[], options: Partial<RoadOptions> = {}): RoadResult[] {
    return this.stroke('Road', (s) => {
      s.symmetry = 'none';
      const out: RoadResult[] = [];
      for (const l of this.images(line)) {
        const r = buildRoad(s, l, { ...DEFAULT_ROAD, ...options });
        if (!r) throw new Error(`${this.name}: road not built`);
        out.push(r);
      }
      return out;
    });
  }

  // ---- Map tool: generator -------------------------------------------------------------------------------------

  /** The terrain generator over the whole map (replace or add), without repainting */
  generate(preset: TerrainPreset, seed: number, strength: number, add = false): void {
    const result = generateTerrain(this.doc.terrain, { preset, seed, strength, add });
    finishGenerated(this.doc, { ...result, water: null, materials: [] }, () => false, false);
  }

  // ---- Terrain tool --------------------------------------------------------------------------------------------

  /**
   * Dabs of a Terrain, Paint or Water brush along `where`; with symmetry the
   * cells each dab changed are copied to their images, as the editor does
   */
  private terrainDabs(where: Where, brush: Brush, part: 'heights' | 'splat' | 'water', fn: (c: MapPoint, b: BrushSettings) => GridRect): void {
    const b = brushOf(brush);
    const touch = { heights: () => undefined, splat: () => undefined, water: () => undefined };
    for (const c of dabs(where, b.radius / 3)) {
      const rect = fn(c, b);
      if (this.symmetry === 'none') continue;
      const change = part === 'splat' ? { splat: rect } : part === 'water' ? { heights: rect, water: true } : { heights: rect };
      mirrorChange(this.doc, this.symmetry, c, change, touch, part === 'water' ? rect : undefined);
    }
  }

  /** Raise (negative: lower) by up to `metres` per dab */
  raise(where: Where, brush: Brush, metres: number): void {
    this.terrainDabs(where, brush, 'heights', (c, b) => raiseDab(this.doc.terrain, c.x, c.y, b, metres));
  }

  smooth(where: Where, brush: Brush, passes = 4): void {
    this.terrainDabs(where, brush, 'heights', (c, b) => {
      let rect = smoothDab(this.doc.terrain, c.x, c.y, b, 1);
      for (let k = 1; k < passes; k++) rect = smoothDab(this.doc.terrain, c.x, c.y, b, 1);
      return rect;
    });
  }

  /** Flatten toward a height (the Level brush), `pull` 0..1 per dab */
  level(where: Where, brush: Brush, height: number, pull = 1): void {
    this.terrainDabs(where, brush, 'heights', (c, b) => flattenDab(this.doc.terrain, c.x, c.y, b, height, pull));
  }

  roughen(where: Where, brush: Brush, metres: number, seed = this.seed): void {
    this.terrainDabs(where, brush, 'heights', (c, b) => noiseDab(this.doc.terrain, c.x, c.y, b, metres, seed));
  }

  /** Thermal erosion of the Terrain tool: steep slopes slide into scree */
  slide(where: Where, brush: Brush, passes = 3): void {
    this.terrainDabs(where, brush, 'heights', (c, b) => erodeDab(this.doc.terrain, c.x, c.y, b, passes));
  }

  terrace(where: Where, brush: Brush, step: number, base = 0, pull = 1): void {
    this.terrainDabs(where, brush, 'heights', (c, b) => terraceDab(this.doc.terrain, c.x, c.y, b, step, pull, base));
  }

  /** The Cliff brush: a hard-edged plateau at `height` */
  plateau(where: Where, brush: Brush, height: number, pull = 1): void {
    this.terrainDabs(where, brush, 'heights', (c, b) => plateauDab(this.doc.terrain, c.x, c.y, b, height, pull));
  }

  /** A ramp between two ground points at their own heights (or the given ones) */
  ramp(a: MapPoint & { h?: number }, b: MapPoint & { h?: number }, width: number, falloff = 0.5): void {
    rampBetween(this.doc.terrain, { x: a.x, y: a.y, h: a.h ?? this.h(a.x, a.y) }, { x: b.x, y: b.y, h: b.h ?? this.h(b.x, b.y) }, width, falloff);
  }

  /**
   * Copies the whole sector of `from` (heights, ground paint, main water) to
   * its symmetric images: what a symmetric brush does per dab, at once, for
   * ground that was not painted symmetrically (the generator)
   */
  mirrorFrom(from: MapPoint): void {
    if (this.symmetry === 'none') return;
    const t = this.doc.terrain;
    const all = { i0: 0, j0: 0, i1: t.grid.columns - 1, j1: t.grid.rows - 1 };
    const texels = { i0: 0, j0: 0, i1: t.splat.resolution - 1, j1: t.splat.resolution - 1 };
    const touch = { heights: () => undefined, splat: () => undefined, water: () => undefined };
    mirrorChange(this.doc, this.symmetry, from, { heights: all, splat: texels, water: !!t.water }, touch, all);
  }

  // ---- Paint tool ----------------------------------------------------------------------------------------------

  /** The layer of a material, added to the list when it is missing */
  layer(material: string): number {
    const t = this.doc.terrain;
    if (!this.catalog.materials.has(material)) throw new Error(`${this.name}: no material ${material}`);
    const k = t.layers.findIndex((l) => l.material === material);
    if (k >= 0) return k;
    if (t.layers.length >= this.maxLayers) throw new Error(`${this.name}: ground layers full, ${material} left out`);
    t.layers.push({ material });
    fitSplatMaps(t);
    return t.layers.length - 1;
  }

  /** Paint a material under the brush, `amount` 0..1 per dab */
  paint(material: string, where: Where, brush: Brush, amount = 1): void {
    const layer = this.layer(material);
    this.terrainDabs(where, brush, 'splat', (c, b) => paintDab(this.doc.terrain, c.x, c.y, b, layer, amount));
  }

  /** "Auto paint the map" with the panel's rules, or own ones by material */
  autoPaint(rules?: (Omit<AutoPaintRule, 'layer'> & { material: string })[]): void {
    const t = this.doc.terrain;
    autoPaint(t, rules ? rules.map(({ material, ...r }) => ({ ...r, layer: this.layer(material) })) : defaultAutoRules(t));
  }

  /**
   * Fewer ground materials load faster (each is a layer of the terrain's
   * texture arrays and its program): removes the layers with the least
   * weight over the map, as the Paint panel's remove does (their weight goes
   * to the others), until at most `max` are left
   */
  trimLayers(max: number): string[] {
    const t = this.doc.terrain;
    const removed: string[] = [];
    const w = new Float32Array(MAX_LAYERS);
    while (t.layers.length > max) {
      const sum = new Float64Array(MAX_LAYERS);
      for (let k = 0; k < t.splat.resolution * t.splat.resolution; k++) {
        readWeights(t, k, w);
        for (let l = 0; l < MAX_LAYERS; l++) sum[l] += w[l];
      }
      let least = 1;
      for (let l = 2; l < t.layers.length; l++) if (sum[l] < sum[least]) least = l;
      removed.push(t.layers[least].material);
      removeLayer(t, least);
    }
    return removed;
  }

  /** The cliff material for steep faces (its own slot, not one of the ground layers) and from which angle */
  cliffs(material: string, angle: number): void {
    if (!this.catalog.materials.has(material)) throw new Error(`${this.name}: no material ${material}`);
    this.doc.terrain.cliffMaterial = material;
    this.doc.terrain.cliffAngle = angle;
  }

  /** Paint a material under the given roads (all when none) */
  paintRoads(material: string, edgeIds: string[] | null = null, softEdge = 1.5): void {
    paintUnderPaths(this.doc.terrain, this.doc.paths, this.layer(material), edgeIds, softEdge);
  }

  // ---- Water tool ----------------------------------------------------------------------------------------------

  /** The main water at a level (created when missing); returns its body index -1 */
  water(level: number, kind: MapWaterKind = 'water', color = BODY_COLORS[kind]): number {
    const t = this.doc.terrain;
    t.water ??= emptyWater(t, level);
    t.water.level = level;
    t.water.kind = kind;
    t.water.color = color;
    return -1;
  }

  /** A further body; returns its index */
  body(level: number, kind: MapWaterKind, color = BODY_COLORS[kind]): number {
    const t = this.doc.terrain;
    const bodies = (t.waterBodies ??= []);
    bodies.push({ ...emptyWater(t, level), kind, color });
    return bodies.length - 1;
  }

  /** Fill basin: floods the hollow under a point */
  fill(p: MapPoint, body = -1): void {
    const t = this.doc.terrain;
    const g = t.grid;
    const i = Math.round((p.x + t.width / 2) / g.cellSize);
    const j = Math.round((p.y + t.depth / 2) / g.cellSize);
    if (!fillBasin(t, i, j, body)) throw new Error(`${this.name}: no basin under (${p.x}, ${p.y})`);
  }

  /** Dig lake: the bed sinks to `depth` under the body's level */
  lake(where: Where, brush: Brush, depth: number, body = -1, rounds = 10): void {
    this.terrainDabs(where, brush, 'water', (c, b) => {
      let rect = lakeDab(this.doc.terrain, c.x, c.y, b, depth, 0.3, body);
      for (let k = 1; k < rounds; k++) rect = lakeDab(this.doc.terrain, c.x, c.y, b, depth, 0.3, body);
      return rect;
    });
  }

  /** Paint or erase a body's mask */
  waterMask(where: Where, brush: Brush, on: boolean, body = -1): void {
    this.terrainDabs(where, brush, 'water', (c, b) => waterMaskDab(this.doc.terrain, c.x, c.y, b, on, body));
  }

  /** Sea from the edge */
  sea(body = -1): number {
    return fillFromEdge(this.doc.terrain, body);
  }

  // ---- Objects tool --------------------------------------------------------------------------------------------

  private freeCheck: LandscapeStroke | null = null;

  /** Whether an object of this footprint may stand here: off roads, away from spawns and HQ, dry */
  free(x: number, y: number, footprint: number): boolean {
    this.freeCheck ??= new LandscapeStroke(this.editor, 'check', 1, this.catalog);
    this.freeCheck.refreshRoads();
    return this.freeCheck.freeForObject(x, y, footprint);
  }

  /** Place one object (and its symmetric images); a rock settles onto its plate as in the editor */
  place(asset: string, x: number, y: number, o: PlaceOptions = {}): MapObject {
    if (!this.catalog.objects.has(asset)) throw new Error(`${this.name}: no asset ${asset}`);
    const ids = new ObjectIds(this.doc.objects);
    const rock = rockShape(this.catalog.object(asset));
    let object: MapObject = {
      id: ids.take(),
      asset,
      x: r2(x),
      y: r2(y),
      z: r2(o.z ?? 0),
      rotation: r3(o.rotation ?? 0),
      scale: r3(o.scale ?? 1),
      ...(o.blocksBuild !== undefined ? { blocksBuild: o.blocksBuild } : {}),
      ...(o.blocksLos !== undefined ? { blocksLos: o.blocksLos } : {}),
      ...(o.tint ? { tint: o.tint } : {}),
      ...(o.pitch ? { pitch: r3(o.pitch) } : {}),
      ...(o.roll ? { roll: r3(o.roll) } : {}),
    };
    const t = this.doc.terrain;
    let images = this.symmetry === 'none' ? [] : objectImages([object], symmetryImages(this.symmetry, t.grid.columns === t.grid.rows), () => ids.take(), t.width / 2, t.depth / 2);
    if (rock) {
      object = settled(t, object, rock);
      images = images.map((i) => settled(t, i, rock));
    }
    this.doc.objects.push(object, ...images);
    this.freeCheck = null;
    return object;
  }

  /**
   * The scatter brush dragged along `where` (one dab per `hold` 0.1 s at each
   * point), with a fixed random stream; with `avoidRoads` the spots the
   * Landscape brushes would refuse (roads, markers, water) are dropped
   */
  scatter(assets: readonly string[], where: Where, brush: Brush, options: Partial<ScatterOptions> = {}, avoidRoads = true, hold = 1): MapObject[] {
    for (const a of assets) if (!this.catalog.objects.has(a)) throw new Error(`${this.name}: no asset ${a}`);
    const b = brushOf(brush);
    const random = rng(this.nextSeed());
    const grid = new ObjectGrid(8, this.doc.objects);
    const ids = new ObjectIds(this.doc.objects);
    const placed: MapObject[] = [];
    for (const c of dabs(where, b.radius / 2)) {
      for (let t = 0; t < hold; t += 0.1) {
        for (const o of scatterDab(this.doc.terrain, c, b, { ...DEFAULT_SCATTER, ...options, assets }, grid, ids, random, 0.6, (a) => rockShape(this.catalog.object(a)), (a) => !!this.catalog.object(a).float)) {
          if (avoidRoads && !this.free(o.x, o.y, this.catalog.object(o.asset).radius)) continue;
          placed.push(o);
        }
      }
    }
    const t = this.doc.terrain;
    const images = this.symmetry === 'none' ? [] : objectImages(placed, symmetryImages(this.symmetry, t.grid.columns === t.grid.rows), () => ids.take(), t.width / 2, t.depth / 2);
    this.doc.objects.push(...placed, ...images);
    this.freeCheck = null;
    return placed;
  }

  /** Smoke from a house's chimney: a smoke effect just over its roof */
  chimney(house: MapObject, scale = 0.6): MapObject {
    const top = this.catalog.object(house.asset).height * house.scale * 0.95;
    return this.place('fx-smoke', house.x + 1.5, house.y - 1, { z: house.z + top, scale });
  }

  /** Objects one after another along a line, turned along it (walls, fences, boardwalks) */
  row(asset: string, line: readonly MapPoint[], spacing: number, o: PlaceOptions & { offset?: number; turn?: number; zFrom?: (p: MapPoint) => number } = {}): MapObject[] {
    const length = polylineLength(line);
    const n = Math.max(1, Math.round(length / spacing));
    const out: MapObject[] = [];
    const pts = resample(line, length / n);
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k];
      const b = pts[k + 1];
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dl = Math.hypot(dx, dy) || 1;
      const off = o.offset ?? 0;
      const p = { x: m.x - (dy / dl) * off, y: m.y + (dx / dl) * off };
      // Models face +y (north) at turn 0; along the line means the line's direction turned to north
      const rotation = Math.atan2(-dx, dy) + (o.turn ?? 0);
      out.push(this.place(asset, p.x, p.y, { ...o, rotation, z: o.zFrom ? o.zFrom(p) : o.z }));
    }
    return out;
  }

  /**
   * Walls along the road shoulders where the ground falls away beside the
   * road (an embankment): one piece every `spacing` metres, its front to the
   * drop. Placed with `place`, like a person setting them one by one.
   */
  shoulderWalls(asset: string, o: { spacing: number; offset?: number; minDrop?: number; edges?: string[] } = { spacing: 6 }): MapObject[] {
    const paths = this.doc.paths;
    const out: MapObject[] = [];
    for (const e of paths.edges) {
      if (e.kind === 'bridge' || (o.edges && !o.edges.includes(e.id))) continue;
      const line = edgePolyline(paths, e);
      const length = polylineLength(line);
      const off = o.offset ?? e.width / 2 + 1;
      for (let s = o.spacing / 2; s < length - o.spacing / 2; s += o.spacing) {
        const p = pointAt(line, s);
        const q = pointAt(line, Math.min(length, s + 1));
        const r = pointAt(line, Math.max(0, s - 1));
        const dl = Math.hypot(q.x - r.x, q.y - r.y) || 1;
        const n = { x: -(q.y - r.y) / dl, y: (q.x - r.x) / dl };
        const road = this.h(p.x, p.y);
        for (const side of [-1, 1]) {
          const w = { x: p.x + n.x * off * side, y: p.y + n.y * off * side };
          const below = { x: p.x + n.x * (off + 3) * side, y: p.y + n.y * (off + 3) * side };
          if (road - this.h(below.x, below.y) < (o.minDrop ?? 2)) continue;
          if (Math.abs(w.x) > this.half - 3 || Math.abs(w.y) > this.half - 3) continue;
          out.push(this.place(asset, w.x, w.y, { rotation: facing(p, below) }));
        }
      }
    }
    return out;
  }

  /**
   * Deletes objects that would block building on a road (the check's
   * "object stands on a path"), leaving gates and arches the road runs through
   */
  clearRoads(keep: readonly string[] = ['castle-gate', 'gate-ruin', 'ruin-arch', 'rock-arch', 'hell-gate', 'palisade-gate', 'iron-gate', 'gate-farm']): number {
    this.freeCheck ??= new LandscapeStroke(this.editor, 'check', 1, this.catalog);
    this.freeCheck.refreshRoads();
    const check = this.freeCheck;
    const before = this.doc.objects.length;
    this.doc.objects = this.doc.objects.filter((o) => {
      if (keep.includes(o.asset) || !(o.blocksBuild ?? this.catalog.object(o.asset).blocksBuild)) return true;
      return check.roadDistance(o.x, o.y, 4) >= 0;
    });
    this.freeCheck = null;
    return before - this.doc.objects.length;
  }

  /** Remove objects within `radius` of a point (the Erase brush) */
  erase(p: MapPoint, radius: number, keep?: (o: MapObject) => boolean): void {
    this.doc.objects = this.doc.objects.filter((o) => Math.hypot(o.x - p.x, o.y - p.y) > radius || (keep?.(o) ?? false));
    this.freeCheck = null;
  }

  // ---- Paths tool and markers ----------------------------------------------------------------------------------

  /** A plain path (Paths tool, Draw): nodes at the points, joined to nodes and roads within `snap` metres */
  path(points: readonly MapPoint[], width: number, kind: MapPathKind = 'road', snap = 6, style?: MapBridgeStyle): string | null {
    const paths = this.doc.paths;
    const nodeAt = (q: MapPoint): string => {
      const p = { x: r2(q.x), y: r2(q.y) };
      const n = nearestNode(paths, p, snap);
      if (n) return n.id;
      const hit = nearestOnEdges(paths, p, snap);
      if (hit) return splitEdge(paths, hit.edge.id, p)!.id;
      return addNode(paths, p).id;
    };
    const a = nodeAt(points[0]);
    const b = nodeAt(points[points.length - 1]);
    // Both ends on one node: a stub too short to keep, as the tool drops it
    const edge = connect(paths, a, b, width, kind);
    if (!edge) return null;
    if (style) edge.style = style;
    if (points.length > 2) edge.via = points.slice(1, -1).map((p) => ({ x: r2(p.x), y: r2(p.y) }));
    this.freeCheck = null;
    return edge.id;
  }

  /**
   * Paths drawn along a line that turn into bridges wherever the line runs
   * over water (ground below `wetBelow`): the Paths tool with the kind
   * switched at each shore. Dry gaps shorter than 8 m stay bridge.
   */
  walk(line: readonly MapPoint[], o: { width?: number; bridgeWidth?: number; dry?: MapPathKind; wetBelow?: number } = {}): void {
    const pts = resample(line, 2);
    const wet = pts.map((p) => this.h(p.x, p.y) < (o.wetBelow ?? 0.4));
    for (let i = 0; i < pts.length; ) {
      let j = i;
      while (j < pts.length && wet[j] === wet[i]) j++;
      if (!wet[i] && i > 0 && j < pts.length && j - i < 4) for (let q = i; q < j; q++) wet[q] = true;
      i = j;
    }
    let start = 0;
    for (let i = 1; i <= pts.length; i++) {
      if (i < pts.length && wet[i] === wet[start]) continue;
      const end = Math.min(i, pts.length - 1);
      const seg = pts.slice(start, end + 1);
      if (seg.length >= 2) {
        const bridge = wet[start];
        this.path(simplify(seg, 0.8), bridge ? (o.bridgeWidth ?? 4) : (o.width ?? 5), bridge ? 'bridge' : (o.dry ?? 'path'), 3);
      }
      start = end;
    }
  }

  /** The bridge style (wood, stone, lava) of every bridge edge, or of those near a point */
  bridgeStyle(style: MapBridgeStyle, near?: MapPoint, within = 40): void {
    const paths = this.doc.paths;
    for (const e of paths.edges) {
      if (e.kind !== 'bridge') continue;
      if (near && Math.min(...edgePolyline(paths, e).map((p) => Math.hypot(p.x - near.x, p.y - near.y))) > within) continue;
      e.style = style;
    }
  }

  /** "Flatten road" for the given edges (all when none) */
  flattenRoads(edgeIds: string[] | null = null, shoulder = 6, smoothing = 24): void {
    flattenUnderPaths(this.doc.terrain, this.doc.paths, edgeIds, { shoulder, smoothing });
  }

  /** A spawn; with symmetry, one per call (a mirrored map names its spawns itself) */
  spawn(name: string, x: number, y: number): void {
    const taken = new Set(this.doc.spawns.map((s) => s.id));
    let n = this.doc.spawns.length + 1;
    while (taken.has(`s${n}`)) n++;
    this.doc.spawns.push({ id: `s${n}`, name, x: r2(x), y: r2(y) });
    this.freeCheck = null;
  }

  hq(x: number, y: number): void {
    this.doc.hq = { x: r2(x), y: r2(y) };
    this.freeCheck = null;
  }

  // ---- Environment and Gameplay --------------------------------------------------------------------------------

  environment(env: Partial<MapEnvironment>): void {
    this.doc.environment = { ...this.doc.environment, ...env };
  }

  gameplay(g: MapGameplay): void {
    this.doc.gameplay = { ...g };
  }

  // ---- Done ----------------------------------------------------------------------------------------------------

  /** Spur length per spawn, metres (null: no route) */
  lanes(): Record<string, number | null> {
    const out: Record<string, number | null> = {};
    for (const [id, route] of spawnRoutes(this.doc)) {
      const s = this.doc.spawns.find((x) => x.id === id)!;
      out[s.name] = route ? Math.round(route.length) : null;
    }
    return out;
  }

  /** The editor's check */
  issues(): MapIssue[] {
    return validateMap(this.doc, {
      blocksBuild: (a) => this.catalog.object(a).blocksBuild,
      footingOf: (a) => this.catalog.object(a).footing,
      costOf: assetCosts(this.catalog, this.doc),
    });
  }

  /** Rocks placed before the ground under them was shaped: lowered onto their plates, as the check asks */
  settleRocks(): void {
    this.doc.objects = this.doc.objects.map((o) => {
      const rock = rockShape(this.catalog.object(o.asset));
      return rock ? settled(this.doc.terrain, o, rock) : o;
    });
  }
}
