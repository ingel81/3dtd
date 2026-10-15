/**
 * One stroke of a landscape brush: heights, ground paint, water and objects
 * change together while the mouse moves and land as one undo step. The
 * stroke records the arrays it touches (tile patches), the layer list and
 * water it adds, and the objects it places; it also knows what the land
 * must leave alone (roads, spawns, HQ) and the heights before it began, so
 * every brush pulls toward a target from the original ground instead of
 * piling up dab by dab.
 */
import { fitSplatMaps, type CustomMapDocument, type MapGroundLayer, type MapObject, type MapPaths, type MapPoint, type MapRiver, type MapWater, type MapWaterKind } from '../../../world/custom-map/map-document';
import type { CatalogIndex } from '../../catalog/asset-catalog';
import {
  CompoundCommand,
  ObjectsCommand,
  PatchCommand,
  SnapshotCommand,
  mergeChanges,
  patchArray,
  patchLayout,
  splatTargets,
  type DocChange,
  type PatchTarget,
  type SplatTarget,
  type EditCommand,
  type EditorDocument,
} from '../../model/editor-document';
import type { GridRect } from '../../model/grid';
import { RegionRecorder } from '../../model/region-patch';
import { BodyAddCommand, LayerListCommand, RiverListCommand, WaterSwapCommand } from '../../model/terrain-commands';
import { MAX_LAYERS } from '../paint-ops';
import { ObjectGrid, ObjectIds, rockShape, settled } from '../object-ops';
import { edgePolyline, nearestOnPolyline } from '../path-graph';
import { BODY_COLORS, emptyWater } from '../water-ops';
import { MAX_WATER_BODIES } from '../../../world/custom-map/map-file';
import { mirrorChange, objectImages, sameSector, symmetryImages, type SymmetryMode } from '../symmetry';
import { FieldCache } from './field-cache';
import { LandscapeNoise } from './landscape-noise';

/** Metres from where a stroke begins within which it finds the water it works by (coastLevel) */
const COAST_REACH = 150;

interface RoadLine {
  points: MapPoint[];
  half: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Spawns and the HQ keep this much free ground */
const MARKER_CLEARANCE = 14;

export class LandscapeStroke {
  readonly noise: LandscapeNoise;
  readonly heights: RegionRecorder<Float32Array>;
  /** Recorders of the splat maps; the third joins when the stroke adds a ninth layer */
  readonly splat: RegionRecorder<Uint8Array>[];
  private waterRecorder: RegionRecorder<Uint8Array> | null = null;
  private readonly layersBefore: MapGroundLayer[];
  private readonly waterBefore: MapWater | null;
  private createdWater: MapWater | null = null;
  /** Mask recorders of the further bodies the stroke touched, by index */
  private readonly bodyRecorders = new Map<number, RegionRecorder<Uint8Array>>();
  /** Bodies the stroke added at the end of the list */
  private readonly bodiesAdded: number[] = [];
  /** The body each kind of pool fills in this stroke */
  private readonly poolBodies = new Map<MapWaterKind, number>();
  /** Whether the stroke painted the main water's mask (only then do its images get it) */
  private waterTouched = false;
  private pathsBefore: MapPaths | null = null;
  private riversBefore: { list: MapRiver[] | undefined } | null = null;
  readonly added: MapObject[] = [];
  /** Objects the stroke took off the map */
  private readonly removed: ObjectsCommand[] = [];
  readonly grid: ObjectGrid;
  private readonly ids: ObjectIds;
  private roads: RoadLine[] = [];
  private readonly markers: MapPoint[];
  private change: DocChange = {};
  /** Copy every dab and object to the symmetric images; objects grow only in the sector the stroke began in */
  symmetry: SymmetryMode = 'none';
  /** The stroke adds to the ground (a mountain, a crater): a symmetric image takes the change on its own ground */
  heightsAdd = false;
  /**
   * The editor's ways (on by default): symmetric images take only the cells
   * the stroke changed, a full layer list makes room (makeRoom). Off, every
   * cell of a dab copies and a material that finds the list full is left out
   */
  editorCopies = true;
  /** Ground height where the stroke began (levelling brushes) */
  anchor: { x: number; y: number; h: number } | null = null;
  /** The level of the water the stroke works by (coastLevel), worked out once; undefined before */
  private coast: number | null | undefined = undefined;
  /** Per stroke memory of the brushes (decided object cells, strongest weights) */
  readonly decided = new Set<string>();
  readonly strongest = new Map<string, number>();
  /** Position-only values the brushes worked out already (noise per texel), by name */
  readonly fields = new Map<string, FieldCache>();
  /** Materials the stroke wanted but found no room for in the full layer list */
  readonly layersFull: string[] = [];
  /** Materials of a full list that took over a layer no ground used any more (`hell-ground for snow-drift`) */
  readonly layersReused: string[] = [];
  /** Materials of a full list painted with the layer nearest in look (`lava as lava-crust`) */
  readonly layersShared: string[] = [];
  /** Where each material of a full list went, decided once per stroke (makeRoom) */
  private readonly fullChoice = new Map<string, number | null>();

  constructor(
    readonly editor: EditorDocument,
    readonly label: string,
    readonly seed: number,
    readonly catalog: CatalogIndex,
    /** Ground layers the stroke may fill the list up to (the shipped levels' builder keeps its own) */
    readonly maxLayers = MAX_LAYERS,
  ) {
    const doc = editor.doc;
    const t = doc.terrain;
    this.noise = new LandscapeNoise(seed);
    this.heights = new RegionRecorder(t.grid.heights, patchLayout(doc, 'heights'));
    this.splat = splatTargets(doc).map((target) => new RegionRecorder(patchArray(doc, target) as Uint8Array, patchLayout(doc, target)));
    if (t.water) this.waterRecorder = new RegionRecorder(t.water.mask, patchLayout(doc, 'water'));
    this.layersBefore = t.layers.map((l) => ({ ...l }));
    this.waterBefore = t.water ? structuredClone(t.water) : null;
    this.grid = new ObjectGrid(8, doc.objects);
    this.ids = new ObjectIds(doc.objects);
    this.markers = [doc.hq, ...doc.spawns];
    this.refreshRoads();
  }

  get doc(): CustomMapDocument {
    return this.editor.doc;
  }

  /** Re-read the roads (a brush that lays one wants the others to avoid it) */
  refreshRoads(): void {
    const paths = this.doc.paths;
    this.roads = paths.edges.map((e) => {
      const points = edgePolyline(paths, e);
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      return { points, half: e.width / 2, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    });
  }

  /** Metres from a point to the edge of the nearest road (negative on it); Infinity without roads nearby */
  roadDistance(x: number, y: number, within = 30): number {
    let best = Infinity;
    for (const r of this.roads) {
      const pad = r.half + within;
      if (x < r.minX - pad || x > r.maxX + pad || y < r.minY - pad || y > r.maxY + pad) continue;
      const hit = nearestOnPolyline(r.points, { x, y });
      if (hit) best = Math.min(best, hit.dist - r.half);
    }
    return best;
  }

  /** Whether an object may stand here: off roads, away from spawns and HQ, not in water (unless it floats) */
  freeForObject(x: number, y: number, footprint: number, onWater = false): boolean {
    if (this.symmetry !== 'none' && this.anchor && !sameSector(this.symmetry, { x, y }, this.anchor)) return false;
    if (this.roadDistance(x, y, footprint + 2) < footprint + 1) return false;
    for (const m of this.markers) if (Math.hypot(m.x - x, m.y - y) < MARKER_CLEARANCE + footprint) return false;
    const t = this.doc.terrain;
    const g = t.grid;
    const i = Math.round((x + t.width / 2) / g.cellSize);
    const j = Math.round((y + t.depth / 2) / g.cellSize);
    if (!onWater && i >= 0 && j >= 0 && i < g.columns && j < g.rows) {
      const k = j * g.columns + i;
      const wet = (w: MapWater | null | undefined) => !!w && !!w.mask[k] && g.heights[k] < w.level + 0.2;
      if (wet(t.water) || t.waterBodies?.some(wet)) return false;
    }
    return true;
  }

  /** 1 away from roads, 0 on them: how much the land may change here */
  roadKeep(x: number, y: number): number {
    const d = this.roadDistance(x, y, 6);
    if (d === Infinity) return 1;
    return Math.min(1, Math.max(0, (d - 1) / 5));
  }

  /** The layer index of a material, adding it to the map when there is room; null when the list is full */
  layerOf(candidates: readonly string[]): number | null {
    const t = this.doc.terrain;
    const material = candidates.find((m) => this.catalog.materials.has(m)) ?? null;
    if (!material) return null;
    const existing = t.layers.findIndex((l) => l.material === material);
    if (existing >= 0) return existing;
    if (t.layers.length >= this.maxLayers) {
      // Full: another candidate that is there already, else room made for it
      const other = t.layers.findIndex((l) => candidates.includes(l.material));
      if (other >= 0) return other;
      if (this.editorCopies) return this.makeRoom(material);
      if (!this.layersFull.includes(material)) this.layersFull.push(material);
      return null;
    }
    t.layers.push({ material });
    fitSplatMaps(t);
    // A new third map: recorded from here on, every dab touches before it writes
    for (const target of splatTargets(this.doc).slice(this.splat.length)) {
      this.splat.push(new RegionRecorder(patchArray(this.doc, target) as Uint8Array, patchLayout(this.doc, target)));
    }
    this.change = mergeChanges(this.change, { layers: true });
    this.editor.emit({ layers: true });
    return t.layers.length - 1;
  }

  /**
   * A layer for `material` in a full list, once per stroke and material: a
   * layer that was on the map before the stroke and that no ground uses any
   * more (painted over everywhere) takes the new material; else the layer
   * nearest to it in look (sharing a catalogue tag first, then by mean
   * colour) paints in its place. Null only without a catalogue entry to
   * compare. The status line names what went where (landscape-tool.ts).
   */
  private makeRoom(material: string): number | null {
    const known = this.fullChoice.get(material);
    if (known !== undefined) return known;
    const t = this.doc.terrain;
    let k = this.unusedLayer();
    if (k !== null) {
      this.layersReused.push(`${material} for ${t.layers[k].material}`);
      t.layers[k] = { material };
      this.change = mergeChanges(this.change, { layers: true });
      this.editor.emit({ layers: true });
    } else {
      k = this.nearestLayer(material);
      if (k === null) this.layersFull.push(material);
      else this.layersShared.push(`${material} as ${t.layers[k].material}`);
    }
    this.fullChoice.set(material, k);
    return k;
  }

  /**
   * A layer from before the stroke that no texel holds more than a trace of
   * (4 of 255), not the first one and not taken over in this stroke already
   */
  private unusedLayer(): number | null {
    const t = this.doc.terrain;
    const maps = t.splat.maps;
    const taken = new Set([...this.fullChoice.values()]);
    for (let k = 1; k < t.layers.length; k++) {
      if (taken.has(k) || this.layersBefore[k]?.material !== t.layers[k].material) continue;
      const map = maps[k >> 2];
      if (!map) continue;
      let used = false;
      for (let q = k & 3; q < map.length && !used; q += 4) used = map[q] > 4;
      if (!used) return k;
    }
    return null;
  }

  /** The layer nearest in look to `material`: sharing a catalogue tag counts first, then the mean colour */
  private nearestLayer(material: string): number | null {
    const want = this.catalog.materials.get(material);
    if (!want) return null;
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0);
    const [r, g, b] = rgb(want.color);
    const tags = new Set(want.tags ?? []);
    let best: number | null = null;
    let bestScore = Infinity;
    this.doc.terrain.layers.forEach((l, k) => {
      const have = this.catalog.materials.get(l.material);
      if (!have) return;
      const [r2, g2, b2] = rgb(have.color);
      const shared = (have.tags ?? []).some((tag) => tags.has(tag));
      const score = Math.hypot(r - r2, g - g2, b - b2) + (shared ? 0 : 1000);
      if (score < bestScore) {
        bestScore = score;
        best = k;
      }
    });
    return best;
  }

  /** Water on the map (created at `level` if there is none); returns its level */
  ensureWater(level: number): number {
    const t = this.doc.terrain;
    if (!t.water) {
      t.water = emptyWater(t, Math.round(level * 10) / 10);
      this.createdWater = structuredClone(t.water);
      this.waterRecorder = new RegionRecorder(t.water.mask, patchLayout(this.doc, 'water'));
      this.editor.emit({ water: true });
    }
    return t.water.level;
  }

  /**
   * The water pools of a kind fill: the main water for plain water (created
   * at `level` when there is none), else a body of that kind at most 2 m
   * below `level` (one above would stand over the land the stroke starts
   * on), added when the map has none. Returns the body and a function that
   * records a rect of its mask before the stroke writes there.
   */
  poolWater(level: number, kind: MapWaterKind): { water: MapWater; touch: (rect: GridRect) => void; index: number } {
    const t = this.doc.terrain;
    if (kind === 'water') {
      this.ensureWater(level);
      return { water: t.water!, touch: (r) => this.touchWater(r), index: -1 };
    }
    const bodies = (t.waterBodies ??= []);
    let index =
      this.poolBodies.get(kind) ??
      bodies.findIndex((b) => b.kind === kind && b.level <= level + 0.05 && b.level > level - 2);
    // A map full of bodies: the one of that kind nearest the level
    if (index < 0 && bodies.length >= MAX_WATER_BODIES) index = bodies.reduce((best, b, n) => (b.kind === kind && (best < 0 || Math.abs(b.level - level) < Math.abs(bodies[best].level - level)) ? n : best), -1);
    if (index < 0) {
      bodies.push({ ...emptyWater(t, Math.round(level * 10) / 10), color: BODY_COLORS[kind], kind });
      index = bodies.length - 1;
      this.bodiesAdded.push(index);
      this.editor.emit({ water: true });
    }
    this.poolBodies.set(kind, index);
    let recorder = this.bodyRecorders.get(index);
    if (!recorder) {
      recorder = new RegionRecorder(bodies[index].mask, patchLayout(this.doc, `body${index}`));
      this.bodyRecorders.set(index, recorder);
    }
    const r = recorder;
    return { water: bodies[index], touch: (rect) => r.touch(rect), index };
  }

  /**
   * The level of the water nearest where the stroke began (`anchor`), within
   * COAST_REACH metres: a lake's or the sea's where its mask is set and the
   * ground lies under it, a river's surface; null without water near. Worked
   * out once per stroke: a beach brush grades and paints toward it.
   */
  coastLevel(): number | null {
    if (this.coast !== undefined) return this.coast;
    const t = this.doc.terrain;
    const g = t.grid;
    const at = this.anchor;
    let best = Infinity;
    let level: number | null = null;
    if (at) {
      const ci = Math.round((at.x + t.width / 2) / g.cellSize);
      const cj = Math.round((at.y + t.depth / 2) / g.cellSize);
      const r = Math.ceil(COAST_REACH / g.cellSize);
      const bodies = [t.water, ...(t.waterBodies ?? [])];
      for (let j = Math.max(0, cj - r); j <= Math.min(g.rows - 1, cj + r); j++) {
        for (let i = Math.max(0, ci - r); i <= Math.min(g.columns - 1, ci + r); i++) {
          const d = Math.hypot(i - ci, j - cj) * g.cellSize;
          if (d >= best || d > COAST_REACH) continue;
          const k = j * g.columns + i;
          for (const b of bodies) {
            if (b && b.mask[k] && g.heights[k] < b.level) {
              best = d;
              level = b.level;
            }
          }
        }
      }
      for (const river of t.rivers ?? []) {
        if (river.kind !== 'water') continue;
        for (const p of river.points) {
          const d = Math.hypot(p.x - at.x, p.y - at.y);
          if (d < best && d <= COAST_REACH) {
            best = d;
            level = p.height;
          }
        }
      }
    }
    this.coast = level;
    return level;
  }

  /** Call before the stroke changes the road network (river bridges, a new road) */
  markPaths(): void {
    this.pathsBefore ??= structuredClone(this.doc.paths);
  }

  /** Whether the stroke changed the road network */
  get pathsMarked(): boolean {
    return this.pathsBefore !== null;
  }

  /** Call before the stroke adds or changes a river */
  markRivers(): void {
    const list = this.doc.terrain.rivers;
    this.riversBefore ??= { list: list ? structuredClone(list) : undefined };
  }

  touchHeights(rect: GridRect): void {
    this.heights.touch(rect);
  }

  touchSplat(rect: GridRect): void {
    for (const recorder of this.splat) recorder.touch(rect);
  }

  touchWater(rect: GridRect): void {
    this.waterTouched = true;
    this.waterRecorder?.touch(rect);
  }

  /** Height of sample (i, j) before the stroke */
  baseHeight(i: number, j: number): number {
    return this.heights.original(i, j);
  }

  /** What element (i, j, channel) of a target held before the stroke; the array's value where it is not recorded */
  private original(target: PatchTarget, i: number, j: number, channel: number): number {
    const recorder =
      target === 'heights'
        ? this.heights
        : target === 'water'
          ? this.waterRecorder
          : target.startsWith('splat')
            ? this.splat[Number(target.slice(5))]
            : this.bodyRecorders.get(Number(target.slice(4)));
    if (recorder) return recorder.original(i, j, channel);
    const layout = patchLayout(this.doc, target);
    return patchArray(this.doc, target)[(j * layout.columns + i) * layout.channels + channel];
  }

  /** Takes objects off the map, as part of the stroke's undo step; before any are added */
  removeObjects(ids: readonly string[]): void {
    if (!ids.length) return;
    if (this.added.length) throw new Error('Objects are removed before the stroke adds any');
    const set = new Set(ids);
    // Their places are free again for what the stroke sets
    for (const o of this.doc.objects) if (set.has(o.id)) this.grid.remove(o);
    const command = ObjectsCommand.remove(this.label, this.doc, ids);
    command.apply(this.doc);
    this.removed.push(command);
  }

  addObject(o: Omit<MapObject, 'id'>): MapObject {
    const object = { ...o, id: this.ids.take() } as MapObject;
    const t = this.doc.terrain;
    const images = this.symmetry === 'none' ? [] : objectImages([object], symmetryImages(this.symmetry, t.grid.columns === t.grid.rows), () => this.ids.take(), t.width / 2, t.depth / 2);
    for (const placed of [object, ...images]) {
      this.doc.objects.push(placed);
      this.added.push(placed);
      this.grid.add(placed);
    }
    return object;
  }

  /** Tell the view what a dab changed; with the pointer's position the dab is copied to its symmetric images */
  changed(dab: DocChange, center?: MapPoint): void {
    if (dab.bodies && this.symmetry !== 'none') dab = { ...dab, bodies: undefined, bodyRect: undefined, water: true };
    const change =
      center && this.symmetry !== 'none'
        ? mirrorChange(
            this.doc,
            this.symmetry,
            center,
            dab,
            {
              heights: (r) => this.touchHeights(r),
              splat: (r) => this.touchSplat(r),
              water: this.waterTouched ? (r) => this.touchWater(r) : undefined,
              bodies: [...this.bodyRecorders.keys()],
              body: (index, r) => this.bodyRecorders.get(index)?.touch(r),
              original: this.editorCopies ? (target, i, j, ch) => this.original(target, i, j, ch) : undefined,
              heightsAdd: this.heightsAdd,
            },
            dab.water ? dab.heights : undefined,
          )
        : dab;
    this.change = mergeChanges(this.change, change);
    this.editor.emit(change);
  }

  /** The stroke as one undo step; null when it changed nothing */
  finish(): EditCommand | null {
    const doc = this.doc;
    const t = doc.terrain;
    const parts: EditCommand[] = [];
    const layersAfter = t.layers.map((l) => ({ ...l }));
    // A longer list, or a layer that took over another material (a full list, makeRoom)
    if (layersAfter.length !== this.layersBefore.length || layersAfter.some((l, k) => l.material !== this.layersBefore[k].material)) {
      parts.push(new LayerListCommand('Layers', this.layersBefore, layersAfter));
    }
    if (this.createdWater) parts.push(new WaterSwapCommand('Water', this.waterBefore, this.createdWater));
    for (const index of this.bodiesAdded) parts.push(new BodyAddCommand('Water', index, structuredClone(t.waterBodies![index])));
    const patches = new PatchCommand(this.label, [
      { target: 'heights', patches: this.heights.finish() },
      ...this.splat.map((r, k) => ({ target: `splat${k}` as SplatTarget, patches: r.finish() })),
      ...(this.waterRecorder ? [{ target: 'water' as const, patches: this.waterRecorder.finish() }] : []),
      ...[...this.bodyRecorders].map(([index, r]) => ({ target: `body${index}` as const, patches: r.finish() })),
    ]);
    if (!patches.empty) parts.push(patches);
    if (this.riversBefore) parts.push(new RiverListCommand('Rivers', this.riversBefore.list, t.rivers ? structuredClone(t.rivers) : undefined));
    if (this.pathsBefore) parts.push(new SnapshotCommand('Roads', { paths: this.pathsBefore }, { paths: structuredClone(doc.paths) }));
    parts.push(...this.removed);
    if (this.added.length) {
      // Rocks settle onto their plates on the ground the stroke leaves behind (it may have shaped it after placing them)
      const moved: string[] = [];
      for (const o of this.added) {
        const rock = rockShape(this.catalog.object(o.asset));
        if (!rock) continue;
        const next = settled(t, o, rock);
        if (next === o) continue;
        Object.assign(o, next);
        if (!next.pitch) delete o.pitch;
        if (!next.roll) delete o.roll;
        moved.push(o.id);
      }
      if (moved.length) this.editor.emit({ objects: moved });
      const start = doc.objects.length - this.added.length;
      parts.push(new ObjectsCommand('Objects', this.added.map((o, k) => ({ before: null, after: { ...o }, index: start + k }))));
    }
    if (!parts.length) return null;
    const command = parts.length === 1 && parts[0] === patches ? patches : new CompoundCommand(this.label, parts);
    this.editor.push(command);
    return command;
  }

  /** Everything the stroke changed so far, for one last view refresh */
  get changes(): DocChange {
    return this.change;
  }
}
