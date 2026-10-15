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
import { heightAt, insideMap, nearestSample, slopeAt, type GridRect } from '../model/grid';
import { BRUSH_LIMITS, type BrushSettings } from './brush';
import { finishGenerated, generateTerrain, type TerrainPreset } from './generate';
import { biomeBand, biomeDab, finishBiome } from './landscape/biome-brush';
import { cliffModelsFor, cliffRocksDab } from './landscape/cliff-rocks';
import { biomeById, type BiomeId } from './landscape/biomes';
import { cracksDab } from './landscape/cracks';
import { erosionDab } from './landscape/erosion';
import { hashCell, LandscapeNoise } from './landscape/landscape-noise';
import { LandscapeStroke } from './landscape/landscape-stroke';
import { resample, simplify } from './landscape/lines';
import { carveRiver, DEFAULT_RIVER, type RiverOptions, type RiverResult } from './landscape/river';
import { buildRoad, DEFAULT_ROAD, type RoadOptions, type RoadResult } from './landscape/road';
import { cliffAlong, coastAlong, formDab, type FormKind } from './landscape/shapes';
import {
  alignedToSlope,
  ObjectGrid,
  ObjectIds,
  scatterDab,
  settled,
  rockShape,
  levelsGround,
  levelUnderBuilding,
  MAX_SINK,
  objectsAlong,
  setDown,
  wallAlong,
  wallKitOf,
  type LineOptions,
  type ScatterOptions,
  DEFAULT_LINE,
  DEFAULT_SCATTER,
} from './object-ops';
import { mirrorMap as mirrorWholeMap, type MirrorResult } from './mirror-map';
import { pourWater } from './pour';
import { ALL_PARTS, captureStamp, pasteStamp, type PasteOptions, type Stamp, type StampParts, type StampRect } from './stamp';
import { MAX_LAYERS, autoPaint, defaultAutoRules, paintDab, readWeights, removeLayer, type AutoPaintRule } from './paint-ops';
import { addNode, connect, edgePolyline, nearestNode, nearestOnEdges, pointAt, polylineLength, spawnRoutes, splitEdge } from './path-graph';
import { flattenUnderPaths, paintUnderPaths } from './path-terrain';
import { mirrorChange, objectImages, symmetryImages, type SymmetryMode } from './symmetry';
import { flattenDab, noiseDab, plateauDab, raiseDab, rampBetween, smoothDab, terraceDab, erodeDab } from './terrain-ops';
import { addPouredBodies, basinSpillHeight, BODY_COLORS, emptyWater, fillBasin, fillFromEdge, lakeDab, RIM_MARGIN, waterBody, waterMaskDab, wetSamples } from './water-ops';
import { MAX_WATER_BODIES } from '../../world/custom-map/map-file';
import { validateMap, type MapIssue } from '../validation/map-validation';
import { assetCosts } from '../validation/map-budget';
import { lifeProblems, newLifeId } from '../../world/custom-map/map-life';
import {
  fitSplatMaps,
  type CustomMapDocument,
  type MapEnvironment,
  type MapBridgeStyle,
  type MapGameplay,
  type MapLife,
  type MapLifeArea,
  type MapLifeKind,
  type MapObject,
  type MapPathKind,
  type MapPoint,
  type MapWaterKind,
} from '../../world/custom-map/map-document';

/** What a life area may set beside its kind, shape and points */
export type LifeOptions = Partial<Pick<MapLifeArea, 'density' | 'height' | 'color' | 'sound' | 'volume' | 'asset' | 'quality' | 'species' | 'speed'>>;
const LIFE_OPTION_KEYS: readonly (keyof LifeOptions)[] = ['density', 'height', 'color', 'sound', 'volume', 'asset', 'quality', 'species', 'speed'];

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
  /** "Align to slope" after placing: tilted with the ground over its footprint (a rock then settles onto its plate) */
  align?: boolean;
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

  /**
   * A contour line: where the ground stands at `height`, traced across a
   * slope. Every `spacing` metres along `a` to `b` (a line across the slope)
   * it looks up and down the slope, square to that line and up to `reach`
   * metres off it, for the spot at that height; stretches where the ground
   * never reaches it (a ridge, a hollow) are left out, so the result may come
   * in pieces. For rows along a hillside: terraces, fences, barriers.
   */
  contour(a: MapPoint, b: MapPoint, height: number, o: { spacing?: number; reach?: number } = {}): MapPoint[][] {
    const spacing = o.spacing ?? 4;
    const reach = o.reach ?? 60;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const along = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const across = { x: -along.y, y: along.x };
    const pieces: MapPoint[][] = [];
    let piece: MapPoint[] = [];
    for (let d = 0; d <= len; d += spacing) {
      const m = { x: a.x + along.x * d, y: a.y + along.y * d };
      const at = (s: number) => ({ x: m.x + across.x * s, y: m.y + across.y * s });
      // The nearest crossing of the height on either side, then halved down to a decimetre
      let found: MapPoint | null = null;
      const step = 2;
      for (let s = 0; s <= reach && !found; s += step) {
        for (const sign of s ? [1, -1] : [1]) {
          const lo = s * sign;
          const hi = (s + step) * sign;
          const fl = this.h(at(lo).x, at(lo).y) - height;
          const fh = this.h(at(hi).x, at(hi).y) - height;
          if (fl * fh > 0) continue;
          let [p, q, fp] = [lo, hi, fl];
          for (let k = 0; k < 6; k++) {
            const mid = (p + q) / 2;
            const fm = this.h(at(mid).x, at(mid).y) - height;
            if (fm * fp > 0) [p, fp] = [mid, fm];
            else q = mid;
          }
          found = at((p + q) / 2);
          break;
        }
      }
      const last = piece[piece.length - 1];
      // A crossing far off the last one is another stretch of the line (round a spur), not its next point
      if (found && last && Math.hypot(found.x - last.x, found.y - last.y) > spacing * 3) {
        pieces.push(piece);
        piece = [];
      }
      if (found && Math.abs(found.x) < this.half && Math.abs(found.y) < this.half) piece.push({ x: r2(found.x), y: r2(found.y) });
      else if (piece.length) {
        pieces.push(piece);
        piece = [];
      }
    }
    if (piece.length) pieces.push(piece);
    return pieces.filter((p) => p.length >= 2);
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

  /**
   * A rocky coast along a line drawn on the shore, the land on one side
   * (`land`, left or right of the line's direction): the land rises to a
   * cliff of `top` metres with a ragged face at the line and a shelf behind
   * it (`shelf`, 6 m), falling back to the land's own height at `grade` (0.35
   * m per metre); the sea floor at its foot sinks to `bed` (-3 m). It only
   * raises land and deepens sea, its ends taper into the shore as it was,
   * roads keep their ground. Cliff rocks (`rocks`, cliff-coast; null none)
   * line the face from under the water to the shelf's edge, their face to the
   * sea, and stones (`surf`; null none) break the water before it. Fill the
   * sea again after it (`sea`). Returns the objects placed.
   */
  rockyCoast(
    line: readonly MapPoint[],
    o: { land: 'left' | 'right'; top: number; bed?: number; shelf?: number; grade?: number; rocks?: readonly string[] | null; surf?: readonly string[] | null },
  ): MapObject[] {
    const drawn = o.land === 'left' ? line : [...line].reverse();
    const rocks = o.rocks === undefined ? ['cliff-coast'] : (o.rocks ?? []);
    const surf = o.surf === undefined ? ['rock-large', 'rock-granite', 'boulder'] : (o.surf ?? []);
    for (const a of [...rocks, ...surf]) if (!this.catalog.objects.has(a)) throw new Error(`${this.name}: ${this.catalog.unknown('asset', a)}`);
    this.stroke('Rocky coast', (s) => {
      s.symmetry = 'none';
      for (const l of this.images(drawn)) {
        const rect = coastAlong(s, l, { top: o.top, bed: o.bed ?? -3, shelf: o.shelf ?? 6, grade: o.grade ?? 0.35, reach: 40 });
        if (rect) s.changed({ heights: rect });
      }
    });
    this.freeCheck = null;
    const out: MapObject[] = [];
    const level = this.doc.terrain.water?.level ?? 0;
    this.freeCheck = new LandscapeStroke(this.editor, 'check', 1, this.catalog);
    const check = this.freeCheck;
    const length = polylineLength(drawn);
    // Along the line: where it runs, its land side (left) and its sea side
    const frame = (d: number) => {
      const p = pointAt(drawn, d);
      const q = pointAt(drawn, Math.min(length, d + 1));
      const r = pointAt(drawn, Math.max(0, d - 1));
      const dl = Math.hypot(q.x - r.x, q.y - r.y) || 1;
      return { p, land: { x: -(q.y - r.y) / dl, y: (q.x - r.x) / dl } };
    };
    // Cliff rocks along the face: where the ground falls through the middle of the cliff, from 1.5 m under the water
    // to just over the shelf, a little more than their width apart; none where the cliff tapers out or on a road
    // Smallest last: where a piece's ends would stand out in open water (a tight bend of the shore) a smaller one goes
    const bySize = [...rocks].sort((a, b) => this.catalog.object(b).radius - this.catalog.object(a).radius);
    for (let d = 0, k = 0; rocks.length && d < length; k++) {
      const { p, land } = frame(d);
      const at = (off: number) => ({ x: p.x + land.x * off, y: p.y + land.y * off });
      const shelf = this.h(at(8).x, at(8).y);
      d += 4;
      if (shelf < level + 1.5) continue;
      const mid = (shelf + level) / 2;
      let face: MapPoint | null = null;
      for (let off = 8; off >= -8; off -= 0.5) {
        if (this.h(at(off).x, at(off).y) < mid) {
          face = at(off);
          break;
        }
      }
      if (!face) continue;
      const ground = this.h(face.x, face.y);
      const bottom = Math.min(level - 1.5, ground);
      const first = rocks[Math.floor(this.noise.hash(k, 7, 91) * rocks.length) % rocks.length];
      const fits = (asset: string): { asset: string; scale: number; half: number } | null => {
        const entry = this.catalog.object(asset);
        const scale = Math.min(2, Math.max(0.5, (shelf + 0.4 - bottom) / entry.height));
        const half = entry.radius * scale * 0.7;
        for (const side of [-1, 1]) {
          // Its end, a few metres in: still on the shore
          const end = { x: face!.x - land.y * half * side + land.x * 4, y: face!.y + land.x * half * side + land.y * 4 };
          if (this.h(end.x, end.y) < level - 1) return null;
        }
        return check.roadDistance(face!.x, face!.y, half * 2) < half ? null : { asset, scale, half };
      };
      const pick = fits(first) ?? bySize.slice(bySize.indexOf(first) + 1).map(fits).find((f) => f) ?? null;
      if (!pick) continue;
      // The model's north to the sea, its width along the coast
      const rotation = Math.atan2(land.x, -land.y);
      out.push(this.place(pick.asset, face.x, face.y, { rotation, scale: pick.scale, z: bottom - ground }));
      d += pick.half * 1.25 - 4;
    }
    if (!surf.length || !this.doc.terrain.water) return out;
    // Stones in the surf every 7 m, about half of them, 3 to 9 m out, standing out of the water
    for (let d = 4, k = 0; d < length - 4; d += 7, k++) {
      if (this.noise.hash(k, 3, 91) < 0.45) continue;
      const { p, land } = frame(d);
      const off = 3 + 6 * this.noise.hash(k, 4, 91);
      const at = { x: p.x - land.x * off, y: p.y - land.y * off };
      const ground = this.h(at.x, at.y);
      if (ground > level - 0.3 || check.roadDistance(at.x, at.y, 8) < 4) continue;
      const asset = surf[k % surf.length];
      const entry = this.catalog.object(asset);
      // Tall enough to show though it settles up to MAX_SINK into the floor; none where it would have to be huge
      const need = (level - ground + 0.4 + 0.8 * this.noise.hash(k, 5, 91)) / (entry.height * (1 - MAX_SINK));
      if (need > 3) continue;
      out.push(this.place(asset, at.x, at.y, { rotation: this.noise.hash(k, 6, 91) * Math.PI * 2, scale: Math.max(0.6, need) }));
    }
    return out;
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

  /**
   * Cliff rocks along `where` (Landscape tool): cliff walls on the steep
   * spots under the brush, sized to the drop; `model` one cliff asset, or
   * 'auto' for those of the map's look. Returns the ids placed
   */
  cliffRocks(where: Where, brush: Brush, model = 'auto'): string[] {
    const models = cliffModelsFor(this.doc.environment.biome, model, this.catalog);
    if (!models.length) throw new Error(`${this.name}: ${model === 'auto' ? 'the catalogue has no cliff models' : this.catalog.unknown('asset', model)}`);
    const b = brushOf(brush);
    const ids = this.stroke('Cliff rocks', (s) => {
      const out: string[] = [];
      for (const c of dabs(where, b.radius / 3)) {
        const got = cliffRocksDab(s, c, b, models, this.catalog);
        if (got.length) s.changed({ objects: got });
        out.push(...got);
      }
      return out;
    });
    this.freeCheck = null;
    return ids;
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

  /**
   * The terrain generator over the whole map (replace or add). Without
   * `repaint` the ground only; with it as the Map panel's generator does: the
   * water the preset wants, its ground layers and an auto paint
   */
  generate(preset: TerrainPreset, seed: number, strength: number, add = false, repaint = false): void {
    const result = generateTerrain(this.doc.terrain, { preset, seed, strength, add });
    if (repaint) finishGenerated(this.doc, result, (m) => this.catalog.materials.has(m), true);
    else finishGenerated(this.doc, { ...result, water: null, materials: [] }, () => false, false);
    this.freeCheck = null;
  }

  /**
   * "Mirror now" (the top bar): the sector of `from` becomes the whole map,
   * ground, water, objects, spawns, roads and rivers
   */
  mirrorMap(mode: SymmetryMode, from: MapPoint): MirrorResult {
    const out = mirrorWholeMap(this.doc, mode, from);
    this.freeCheck = null;
    return out;
  }

  /** Copy a rectangle of the map and paste it centred on `to` (Copy and stamps), turned, its rim faded into the ground */
  copyArea(rect: StampRect, to: MapPoint, o: { rotation?: number; feather?: number; parts?: Partial<StampParts> } = {}): void {
    this.paste(captureStamp(this.doc, rect), to, o);
  }

  /** Paste a stamp centred on `to` as the Copy and stamps tool does */
  paste(stamp: Stamp, to: MapPoint, o: { rotation?: number; feather?: number; parts?: Partial<StampParts> } = {}): void {
    const options: PasteOptions = { parts: { ...ALL_PARTS, ...o.parts }, rotation: o.rotation ?? 0, feather: o.feather ?? 0.25 };
    this.stroke(
      'Paste',
      (s) => {
        s.symmetry = 'none';
        pasteStamp(s, stamp, to, options);
      },
      0,
    );
    this.freeCheck = null;
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
    if (!this.catalog.materials.has(material)) throw new Error(`${this.name}: ${this.catalog.unknown('material', material)}`);
    const k = t.layers.findIndex((l) => l.material === material);
    if (k >= 0) return k;
    if (t.layers.length >= this.maxLayers) throw new Error(`${this.name}: ground layers full (at most ${this.maxLayers}: ${t.layers.map((l) => l.material).join(', ')}), ${material} left out; map.trimLayers(max) removes the least used`);
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
    if (!this.catalog.materials.has(material)) throw new Error(`${this.name}: ${this.catalog.unknown('material', material)}`);
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

  /**
   * Fill basin to its rim (the Water tool's Ctrl click on a fresh body): the
   * body's level a little under where the hollow under a point overflows,
   * its mask the hollow alone. After the ground round a lake changed (a
   * river cut its rim, a road lowered it), the water stands where it holds.
   */
  fillToRim(p: MapPoint, body = -1): number {
    const t = this.doc.terrain;
    const g = t.grid;
    const water = waterBody(t, body);
    if (!water) throw new Error(`${this.name}: no body ${body}`);
    const i = Math.round((p.x + t.width / 2) / g.cellSize);
    const j = Math.round((p.y + t.depth / 2) / g.cellSize);
    water.level = Math.round((basinSpillHeight(t, i, j) - RIM_MARGIN) * 10) / 10;
    water.mask.fill(0);
    if (!fillBasin(t, i, j, body)) throw new Error(`${this.name}: no basin under (${p.x}, ${p.y})`);
    return water.level;
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

  /**
   * The shore of the land round `center` between two directions (radians,
   * counter-clockwise from east): going out from the centre, where the
   * ground first falls under `level` (the main water's, else 0), a point
   * about every `step` metres. It runs counter-clockwise, so the land lies
   * on its left (rockyCoast with `land: 'left'`); directions without a shore
   * within `max` metres are left out.
   */
  shoreAround(center: MapPoint, from: number, to: number, o: { level?: number; step?: number; max?: number } = {}): MapPoint[] {
    const level = o.level ?? this.doc.terrain.water?.level ?? 0;
    const max = o.max ?? 200;
    const out: MapPoint[] = [];
    const turns = Math.max(2, Math.ceil(((to - from) * 180) / Math.PI));
    for (let k = 0; k <= turns; k++) {
      const a = from + ((to - from) * k) / turns;
      for (let r = 1; r <= max; r += 0.5) {
        const p = { x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r };
        if (Math.abs(p.x) > this.half || Math.abs(p.y) > this.doc.terrain.depth / 2) break;
        if (this.h(p.x, p.y) < level) {
          out.push(p);
          break;
        }
      }
    }
    return out.length > 1 ? resample(out, o.step ?? 6) : out;
  }

  // ---- Objects tool --------------------------------------------------------------------------------------------

  private freeCheck: LandscapeStroke | null = null;

  /** Whether an object of this footprint may stand here: off roads, away from spawns and HQ, dry */
  /**
   * Pour water or lava at a point (Water tool, Pour): it fills the hollow,
   * spills over and fills every hollow on its way down as new bodies; with
   * symmetry at every image. Returns how many bodies it made
   */
  pour(at: MapPoint, kind: 'water' | 'lava' = 'water'): number {
    const t = this.doc.terrain;
    const g = t.grid;
    const { i, j } = nearestSample(t, at.x, at.y);
    const wet = wetSamples(t);
    if (wet[j * g.columns + i]) throw new Error(`${this.name}: there is water at (${at.x}, ${at.y}) already; pour onto dry ground`);
    const starts = symmetryImages(this.symmetry, g.columns === g.rows).map((img) => {
      const [ii, jj] = img.cell(i, j, g.columns, g.rows);
      return jj * g.columns + ii;
    });
    const result = pourWater({ columns: g.columns, rows: g.rows, heights: g.heights, starts, wet, cellSize: g.cellSize });
    return addPouredBodies(t, result.lakes, kind, MAX_WATER_BODIES);
  }

  free(x: number, y: number, footprint: number): boolean {
    this.freeCheck ??= new LandscapeStroke(this.editor, 'check', 1, this.catalog);
    this.freeCheck.refreshRoads();
    return this.freeCheck.freeForObject(x, y, footprint);
  }

  /** Place one object (and its symmetric images); a rock settles onto its plate as in the editor */
  place(asset: string, x: number, y: number, o: PlaceOptions = {}): MapObject {
    if (!this.catalog.objects.has(asset)) throw new Error(`${this.name}: ${this.catalog.unknown('asset', asset)}`);
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
    // A building levels its ground first, as in the editor (levelUnderBuilding)
    const entry = this.catalog.object(asset);
    if (levelsGround(entry)) for (const p of [object, ...images]) levelUnderBuilding(t, p, entry.radius);
    if (o.align) {
      object = alignedToSlope(t, object, entry.radius);
      images = images.map((i) => alignedToSlope(t, i, entry.radius));
    }
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
    for (const a of assets) if (!this.catalog.objects.has(a)) throw new Error(`${this.name}: ${this.catalog.unknown('asset', a)}`);
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
   * Objects along a line as the Objects tool's Line draws them: a wall kit's
   * piece builds the kit's wall (blocks or towers at the corners), any other
   * asset stands every `spacing` metres, turned along, across or at random,
   * optionally on both sides. With symmetry at every image
   */
  line(asset: string, line: readonly MapPoint[], o: Partial<LineOptions> & { alignToSlope?: boolean } = {}): MapObject[] {
    if (!this.catalog.objects.has(asset)) throw new Error(`${this.name}: ${this.catalog.unknown('asset', asset)}`);
    const t = this.doc.terrain;
    const ids = new ObjectIds(this.doc.objects);
    const options: LineOptions = { ...DEFAULT_LINE, ...o };
    const kit = wallKitOf(asset);
    const own = (
      kit ? wallAlong(line, kit, { corners: options.corners ?? 'blocks', front: options.front ?? 'left' }, ids) : objectsAlong(line, asset, options, ids, rng(this.nextSeed()))
    ).filter((p) => insideMap(t, p));
    const images = this.symmetry === 'none' ? [] : objectImages(own, symmetryImages(this.symmetry, t.grid.columns === t.grid.rows), () => ids.take(), t.width / 2, t.depth / 2);
    const entry = this.catalog.object(asset);
    if (levelsGround(entry)) for (const p of [...own, ...images]) levelUnderBuilding(t, p, entry.radius);
    const placed = [...own, ...images].map((p) => setDown(t, p, rockShape(entry), !!o.alignToSlope && !entry.float, entry.radius));
    this.doc.objects.push(...placed);
    this.freeCheck = null;
    return placed;
  }

  /**
   * A quay along a line: the land on one side (`land`: left or right of the
   * line's direction) level at `top` over 14 m, the water side at `bed` over
   * `reach` metres (16 by default: wider where the land's slopes reach far into the water), one sheer
   * step between them that the map's cliff material faces (stone blocks or
   * concrete: a quay wall, no earth bank), and a promenade on top: bollards
   * at the edge every `spacing` metres, lamps every second one a few metres
   * in, where nothing stands in the way. Returns the dressing placed.
   */
  quay(
    line: readonly MapPoint[],
    o: { top: number; bed: number; land: 'left' | 'right'; reach?: number; spacing?: number; bollard?: string | null; lamp?: string | null },
  ): MapObject[] {
    const s = o.land === 'left' ? 1 : -1;
    const offset = (d: number): MapPoint[] =>
      resample(line, 2).map((p, k, all) => {
        const a = all[Math.max(0, k - 1)];
        const b = all[Math.min(all.length - 1, k + 1)];
        const dl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        return { x: p.x - ((b.y - a.y) / dl) * d, y: p.y + ((b.x - a.x) / dl) * d };
      });
    // Land and water each as a strip whose hard edge is the line
    this.level(offset(s * 7), { radius: 7, falloff: 0.05 }, o.top);
    const reach = o.reach ?? 16;
    this.level(offset((-s * reach) / 2), { radius: reach / 2, falloff: 0.05 }, o.bed);
    const out: MapObject[] = [];
    const spacing = o.spacing ?? 10;
    const length = polylineLength(line);
    for (let d = spacing / 2, n = 0; d < length; d += spacing, n++) {
      const p = pointAt(line, d);
      const q = pointAt(line, Math.min(length, d + 1));
      const dl = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      const at = (off: number) => ({ x: p.x - ((q.y - p.y) / dl) * off * s, y: p.y + ((q.x - p.x) / dl) * off * s });
      const water = at(-6);
      const edge = at(1.4);
      if (o.bollard !== null && this.free(edge.x, edge.y, 0.6)) out.push(this.place(o.bollard ?? 'bollards', edge.x, edge.y, { rotation: facing(edge, water) + Math.PI / 2 }));
      const inner = at(4);
      if (n % 2 === 0 && o.lamp !== null && this.free(inner.x, inner.y, 0.4)) out.push(this.place(o.lamp ?? 'street-lamp', inner.x, inner.y, { rotation: facing(inner, water) }));
    }
    return out;
  }

  /**
   * A glacier or snowfield along a line from its head down to its snout: the
   * crags under it laid into an even tongue `width` metres wide that falls
   * straight from point to point, `sink` metres under the ground's heights
   * at the points, `snow` painted over it (fading out at
   * its edges), broken ice at the snout (`snout` assets) and moraine scree
   * along both edges (`moraine` assets), each kept off roads and markers.
   * The ground's cliff material still shows where the tongue stays steeper
   * than the map's cliff angle: an icefall reads as rock there. Returns the
   * objects placed.
   */
  glacier(
    line: readonly MapPoint[],
    o: { width: number; snow: string; sink?: number; snout?: readonly string[]; moraine?: readonly string[] },
  ): MapObject[] {
    const w = o.width;
    // The ice as an even slope from point to point, at the ground's heights there less the sink, its edges blended
    const heights = line.map((p) => this.h(p.x, p.y) - (o.sink ?? 0));
    for (let i = 0; i < line.length - 1; i++) this.ramp({ ...line[i], h: heights[i] }, { ...line[i + 1], h: heights[i + 1] }, w, 0.5);
    const pts = resample(line, 4);
    this.smooth(pts, { radius: w * 0.6, falloff: 0.6 }, 3);
    this.paint(o.snow, pts, { radius: w * 0.55, falloff: 0.45 }, 1);
    const out: MapObject[] = [];
    const end = pts[pts.length - 1];
    if (o.snout?.length) out.push(...this.scatter(o.snout, end, { radius: w * 0.4, strength: 1 }, { density: 3, minDistance: 3, scaleMin: 0.8, scaleMax: 1.6 }));
    if (o.moraine?.length) {
      for (const side of [1, -1]) {
        const edge = pts.map((p, k) => {
          const a = pts[Math.max(0, k - 1)];
          const b = pts[Math.min(pts.length - 1, k + 1)];
          const dl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
          return { x: p.x - ((b.y - a.y) / dl) * (w / 2) * side, y: p.y + ((b.x - a.x) / dl) * (w / 2) * side };
        });
        out.push(...this.scatter(o.moraine, edge, { radius: w * 0.12 + 2, strength: 1 }, { density: 2, minDistance: 4, scaleMin: 0.7, scaleMax: 1.4 }));
      }
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

  // ---- Life ----------------------------------------------------------------------------------------------------

  /** A life area (the Life tool's Outline): the outline the life fills; returns its id */
  lifeArea(kind: MapLifeKind, points: readonly MapPoint[], options: LifeOptions = {}): string {
    return this.addLife(kind, 'area', points, options);
  }

  /** A life route (the Life tool's Line): the line flocks, boats or a sound follow; returns its id */
  lifeRoute(kind: MapLifeKind, points: readonly MapPoint[], options: LifeOptions = {}): string {
    return this.addLife(kind, 'route', points, options);
  }

  /** The map's own life: { auto: { smoke, fireflies, birds, sparks }, density, flags, ambience: { sound, volume } } */
  lifeSettings(patch: Omit<MapLife, 'areas'>): void {
    const life: MapLife = { ...this.doc.life, ...patch, auto: patch.auto ? { ...this.doc.life?.auto, ...patch.auto } : this.doc.life?.auto };
    if (!life.auto) delete life.auto;
    const problems = lifeProblems(life);
    if (problems.length) throw new Error(`${this.name}: ${problems[0]}`);
    this.doc.life = life;
  }

  /** Remove life areas by id */
  removeLife(ids: readonly string[]): void {
    const areas = this.doc.life?.areas ?? [];
    const missing = ids.filter((id) => !areas.some((a) => a.id === id));
    if (missing.length) throw new Error(`${this.name}: there are no life areas ${missing.join(', ')}; life areas: ${areas.map((a) => a.id).join(', ') || 'none'}`);
    this.doc.life = { ...this.doc.life, areas: areas.filter((a) => !ids.includes(a.id)) };
  }

  private addLife(kind: MapLifeKind, shape: MapLifeArea['shape'], points: readonly MapPoint[], options: LifeOptions): string {
    const areas = this.doc.life?.areas ?? [];
    const unknown = Object.keys(options).filter((k) => !LIFE_OPTION_KEYS.includes(k as keyof LifeOptions));
    if (unknown.length) throw new Error(`${this.name}: life areas know no ${unknown.join(', ')} (they take ${LIFE_OPTION_KEYS.join(', ')})`);
    const area: MapLifeArea = { id: newLifeId(areas, kind), kind, shape, points: points.map((p) => ({ x: r2(p.x), y: r2(p.y) })), ...options };
    const life: MapLife = { ...this.doc.life, areas: [...areas, area] };
    const problems = lifeProblems(life);
    if (problems.length) throw new Error(`${this.name}: ${problems[0]}`);
    this.doc.life = life;
    return area.id;
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
