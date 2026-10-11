/**
 * One stroke of a landscape brush: heights, ground paint, water and objects
 * change together while the mouse moves and land as one undo step. The
 * stroke records the arrays it touches (tile patches), the layer list and
 * water it adds, and the objects it places; it also knows what the land
 * must leave alone (roads, spawns, HQ) and the heights before it began, so
 * every brush pulls toward a target from the original ground instead of
 * piling up dab by dab.
 */
import type { CustomMapDocument, MapGroundLayer, MapObject, MapPaths, MapPoint, MapWater } from '../../../world/custom-map/map-document';
import type { CatalogIndex } from '../../catalog/asset-catalog';
import {
  CompoundCommand,
  ObjectsCommand,
  PatchCommand,
  SnapshotCommand,
  mergeChanges,
  patchLayout,
  type DocChange,
  type EditCommand,
  type EditorDocument,
} from '../../model/editor-document';
import type { GridRect } from '../../model/grid';
import { RegionRecorder } from '../../model/region-patch';
import { LayerListCommand, WaterSwapCommand } from '../../model/terrain-commands';
import { MAX_LAYERS } from '../paint-ops';
import { ObjectGrid, ObjectIds } from '../object-ops';
import { edgePolyline, nearestOnPolyline } from '../path-graph';
import { emptyWater } from '../water-ops';
import { mirrorChange, objectImages, sameSector, symmetryImages, type SymmetryMode } from '../symmetry';
import { LandscapeNoise } from './landscape-noise';

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
  readonly splat: [RegionRecorder<Uint8Array>, RegionRecorder<Uint8Array>];
  private waterRecorder: RegionRecorder<Uint8Array> | null = null;
  private readonly layersBefore: MapGroundLayer[];
  private readonly waterBefore: MapWater | null;
  private createdWater: MapWater | null = null;
  private pathsBefore: MapPaths | null = null;
  readonly added: MapObject[] = [];
  readonly grid: ObjectGrid;
  private readonly ids: ObjectIds;
  private roads: RoadLine[] = [];
  private readonly markers: MapPoint[];
  private change: DocChange = {};
  /** Copy every dab and object to the symmetric images; objects grow only in the sector the stroke began in */
  symmetry: SymmetryMode = 'none';
  /** Ground height where the stroke began (levelling brushes) */
  anchor: { x: number; y: number; h: number } | null = null;
  /** Per stroke memory of the brushes (decided object cells, strongest weights) */
  readonly decided = new Set<string>();
  readonly strongest = new Map<string, number>();

  constructor(
    readonly editor: EditorDocument,
    readonly label: string,
    readonly seed: number,
    readonly catalog: CatalogIndex,
  ) {
    const doc = editor.doc;
    const t = doc.terrain;
    this.noise = new LandscapeNoise(seed);
    this.heights = new RegionRecorder(t.grid.heights, patchLayout(doc, 'heights'));
    this.splat = [new RegionRecorder(t.splat.maps[0], patchLayout(doc, 'splat0')), new RegionRecorder(t.splat.maps[1], patchLayout(doc, 'splat1'))];
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

  /** Whether an object may stand here: off roads, away from spawns and HQ, not in water */
  freeForObject(x: number, y: number, footprint: number): boolean {
    if (this.symmetry !== 'none' && this.anchor && !sameSector(this.symmetry, { x, y }, this.anchor)) return false;
    if (this.roadDistance(x, y, footprint + 2) < footprint + 1) return false;
    for (const m of this.markers) if (Math.hypot(m.x - x, m.y - y) < MARKER_CLEARANCE + footprint) return false;
    const t = this.doc.terrain;
    if (t.water) {
      const g = t.grid;
      const i = Math.round((x + t.width / 2) / g.cellSize);
      const j = Math.round((y + t.depth / 2) / g.cellSize);
      if (i >= 0 && j >= 0 && i < g.columns && j < g.rows) {
        const k = j * g.columns + i;
        if (t.water.mask[k] && g.heights[k] < t.water.level + 0.2) return false;
      }
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
    if (t.layers.length >= MAX_LAYERS) {
      // Full: another candidate that is there already, else nothing
      const other = t.layers.findIndex((l) => candidates.includes(l.material));
      return other >= 0 ? other : null;
    }
    t.layers.push({ material });
    this.change = mergeChanges(this.change, { layers: true });
    this.editor.emit({ layers: true });
    return t.layers.length - 1;
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

  /** Call before the stroke changes the road network (river bridges, a new road) */
  markPaths(): void {
    this.pathsBefore ??= structuredClone(this.doc.paths);
  }

  touchHeights(rect: GridRect): void {
    this.heights.touch(rect);
  }

  touchSplat(rect: GridRect): void {
    this.splat[0].touch(rect);
    this.splat[1].touch(rect);
  }

  touchWater(rect: GridRect): void {
    this.waterRecorder?.touch(rect);
  }

  /** Height of sample (i, j) before the stroke */
  baseHeight(i: number, j: number): number {
    return this.heights.original(i, j);
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
    const change =
      center && this.symmetry !== 'none'
        ? mirrorChange(
            this.doc,
            this.symmetry,
            center,
            dab,
            { heights: (r) => this.touchHeights(r), splat: (r) => this.touchSplat(r), water: (r) => this.touchWater(r) },
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
    if (layersAfter.length !== this.layersBefore.length) parts.push(new LayerListCommand('Layers', this.layersBefore, layersAfter));
    if (this.createdWater) parts.push(new WaterSwapCommand('Water', this.waterBefore, this.createdWater));
    const patches = new PatchCommand(this.label, [
      { target: 'heights', patches: this.heights.finish() },
      { target: 'splat0', patches: this.splat[0].finish() },
      { target: 'splat1', patches: this.splat[1].finish() },
      ...(this.waterRecorder ? [{ target: 'water' as const, patches: this.waterRecorder.finish() }] : []),
    ]);
    if (!patches.empty) parts.push(patches);
    if (this.pathsBefore) parts.push(new SnapshotCommand('Roads', { paths: this.pathsBefore }, { paths: structuredClone(doc.paths) }));
    if (this.added.length) {
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
