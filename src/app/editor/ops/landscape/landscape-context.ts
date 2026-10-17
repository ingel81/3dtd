/**
 * What a landscape brush knows while it works, over the transaction that
 * records its edit (edit-transaction.ts): heights, ground paint, water and
 * objects change together while the mouse moves and land as one undo step.
 * The context knows what the land must leave alone (roads, spawns, HQ,
 * LandQuery), the heights before the stroke began, so every brush pulls
 * toward a target from the original ground instead of piling up dab by dab,
 * the water it works by, the layer list and where a full one makes room,
 * and the objects it places and their images.
 */
import { fitSplatMaps, type CustomMapDocument, type MapObject, type MapPoint, type MapWater, type MapWaterKind } from '../../../world/custom-map/map-document';
import type { CatalogIndex } from '../../../map-ops/asset-catalog';
import type { DocChange, EditCommand } from '../../model/doc-change';
import type { EditTransaction } from '../../model/edit-transaction';
import type { GridRect } from '../../../map-ops/grid';
import { BodyAddCommand, WaterSwapCommand } from '../../model/commands/terrain';
import { MAX_LAYERS } from '../../../map-ops/paint-ops';
import { ObjectGrid, ObjectIds, rockShape, settled } from '../../../map-ops/object-ops';
import { BODY_COLORS, emptyWater } from '../../../map-ops/water-ops';
import { MAX_WATER_BODIES } from '../../../world/custom-map/map-file';
import { mirrorDab, objectImages, sameSector, symmetryImages, type SymmetryMode } from '../symmetry';
import { FieldCache } from './field-cache';
import { LandscapeNoise } from '../../../map-ops/landscape-noise';

/** Metres from where a stroke begins within which it finds the water it works by (coastLevel) */
const COAST_REACH = 150;
/** Metres the coast's distance field reaches; further counts as this far */
const COAST_FAR = 120;

/** Side of the cells the stroke files the roads' segments in, metres */
const ROAD_CELL = 16;

/**
 * The roads' segments, each with its road's half width, filed in cells of
 * ROAD_CELL by their bounds grown by that half width: a point looks only at
 * the cells within the distance it asks about, not at every road.
 */
class RoadSegments {
  /** Ends and half width per segment: ax, ay, bx, by, half */
  private readonly parts: Float64Array;
  private readonly cells = new Map<number, number[]>();

  constructor(roads: readonly { points: readonly MapPoint[]; half: number }[]) {
    let count = 0;
    for (const r of roads) count += Math.max(0, r.points.length - 1);
    this.parts = new Float64Array(count * 5);
    let s = 0;
    for (const r of roads) {
      for (let k = 1; k < r.points.length; k++, s++) {
        const a = r.points[k - 1];
        const b = r.points[k];
        this.parts.set([a.x, a.y, b.x, b.y, r.half], s * 5);
        const i0 = Math.floor((Math.min(a.x, b.x) - r.half) / ROAD_CELL);
        const i1 = Math.floor((Math.max(a.x, b.x) + r.half) / ROAD_CELL);
        const j0 = Math.floor((Math.min(a.y, b.y) - r.half) / ROAD_CELL);
        const j1 = Math.floor((Math.max(a.y, b.y) + r.half) / ROAD_CELL);
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const key = roadCellKey(i, j);
            const list = this.cells.get(key);
            if (list) list.push(s);
            else this.cells.set(key, [s]);
          }
        }
      }
    }
  }

  /** Metres from a point to the nearest road's edge (negative on it), where under `within`; else Infinity or at least `within` */
  distance(x: number, y: number, within: number): number {
    if (!this.cells.size) return Infinity;
    const p = this.parts;
    const i0 = Math.floor((x - within) / ROAD_CELL);
    const i1 = Math.floor((x + within) / ROAD_CELL);
    const j0 = Math.floor((y - within) / ROAD_CELL);
    const j1 = Math.floor((y + within) / ROAD_CELL);
    let best = Infinity;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const list = this.cells.get(roadCellKey(i, j));
        if (!list) continue;
        for (const s of list) {
          const o = s * 5;
          const ax = p[o];
          const ay = p[o + 1];
          const dx = p[o + 2] - ax;
          const dy = p[o + 3] - ay;
          const len2 = dx * dx + dy * dy;
          const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
          const d = Math.hypot(ax + dx * t - x, ay + dy * t - y) - p[o + 4];
          if (d < best) best = d;
        }
      }
    }
    return best;
  }
}

function roadCellKey(i: number, j: number): number {
  return (i + 1_000_000) * 2_000_003 + (j + 1_000_000);
}

/** Spawns and the HQ keep this much free ground */
const MARKER_CLEARANCE = 14;

/**
 * What the land must leave alone, read from the map once (the roads again
 * with refreshRoads): roads, spawns and HQ, water. Changes nothing.
 */
export class LandQuery {
  private roads = new RoadSegments([]);
  private readonly markers: MapPoint[];

  constructor(readonly doc: CustomMapDocument) {
    this.markers = [doc.hq, ...doc.spawns];
    this.readRoads();
  }

  /** Whether an object may grow at (x, y) at all (a symmetric stroke grows only in its own sector) */
  protected inSector(_x: number, _y: number): boolean {
    return true;
  }

  /** Re-read the roads (a brush that lays one wants the others to avoid it) */
  refreshRoads(): void {
    this.readRoads();
  }

  private readRoads(): void {
    const paths = this.doc.paths;
    const nodes = new Map(paths.nodes.map((n) => [n.id, n]));
    this.roads = new RoadSegments(
      paths.edges.map((e) => {
        const a = nodes.get(e.a);
        const b = nodes.get(e.b);
        return { points: a && b ? [a, ...(e.via ?? []), b] : [], half: e.width / 2 };
      }),
    );
  }

  /**
   * Metres from a point to the edge of the nearest road (negative on it);
   * beyond `within` the answer only says "at least that far" (Infinity
   * without roads nearby)
   */
  roadDistance(x: number, y: number, within = 30): number {
    return this.roads.distance(x, y, within);
  }

  /** Whether an object may stand here: off roads, away from spawns and HQ, not in water (unless it floats) */
  freeForObject(x: number, y: number, footprint: number, onWater = false): boolean {
    if (!this.inSector(x, y)) return false;
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
}

export class LandscapeContext extends LandQuery {
  /** Copy every dab and object to the symmetric images; objects grow only in the sector the stroke began in */
  symmetry: SymmetryMode = 'none';
  /** Ground height where the stroke began (levelling brushes) */
  anchor: { x: number; y: number; h: number } | null = null;
  readonly noise: LandscapeNoise;
  /** The body each kind of pool fills in this stroke */
  private readonly poolBodies = new Map<MapWaterKind, number>();
  /** Whether the stroke painted the main water's mask (only then do its images get it) */
  private waterTouched = false;
  readonly grid: ObjectGrid;
  private readonly ids: ObjectIds;
  /** The stroke adds to the ground (a mountain, a crater): a symmetric image takes the change on its own ground */
  heightsAdd = false;
  /**
   * The editor's ways (on by default): symmetric images take only the cells
   * the stroke changed, a full layer list makes room (makeRoom). Off, every
   * cell of a dab copies and a material that finds the list full is left out
   */
  editorCopies = true;
  /** The level of the water the stroke works by (coastLevel), worked out once; undefined before */
  private coast: number | null | undefined = undefined;
  /** Distances to the coast (coastDistance), worked out once; undefined before */
  private coastFar: Float32Array | null | undefined = undefined;
  /** Per stroke memory of the brushes (decided object cells, strongest weights) */
  readonly decided = new Set<string>();
  readonly strongest = new Map<string, number>();
  /** Position-only values the brushes worked out already (noise per texel), by name */
  readonly fields = new Map<string, FieldCache>();
  /** The same as doubles, where the values feed heights (a landform's noise and the roads' hold), by name */
  readonly floatFields = new Map<string, FieldCache<Float64Array>>();
  /** Materials the stroke wanted but found no room for in the full layer list */
  readonly layersFull: string[] = [];
  /** Materials of a full list that took over a layer no ground used any more (`hell-ground for snow-drift`) */
  readonly layersReused: string[] = [];
  /** Materials of a full list painted with the layer nearest in look (`lava as lava-crust`) */
  readonly layersShared: string[] = [];
  /** Where each material of a full list went, decided once per stroke (makeRoom) */
  private readonly fullChoice = new Map<string, number | null>();

  constructor(
    /** The transaction the stroke's edit goes into */
    readonly tx: EditTransaction,
    readonly seed: number,
    readonly catalog: CatalogIndex,
    /** Ground layers the stroke may fill the list up to (the shipped levels' builder keeps its own) */
    readonly maxLayers = MAX_LAYERS,
  ) {
    super(tx.doc);
    const doc = tx.doc;
    this.noise = new LandscapeNoise(seed);
    // The layer list as it was: a full one reuses only layers from before the stroke (unusedLayer)
    tx.snapshot('layers');
    this.grid = new ObjectGrid(8, doc.objects);
    this.ids = new ObjectIds(doc.objects);
  }

  override refreshRoads(): void {
    super.refreshRoads();
    // The roads' hold is kept per sample with the forms' noise
    this.floatFields.clear();
  }

  protected override inSector(x: number, y: number): boolean {
    return this.symmetry === 'none' || !this.anchor || sameSector(this.symmetry, { x, y }, this.anchor);
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
    // A new third map is recorded from its first touch on, as every dab touches before it writes
    fitSplatMaps(t);
    this.tx.changed({ layers: true });
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
      this.tx.changed({ layers: true });
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
      if (taken.has(k) || this.tx.layersBefore[k]?.material !== t.layers[k].material) continue;
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
      // Made before the stroke paints its mask: the step makes it first, its tiles fill it
      this.tx.include(new WaterSwapCommand(this.tx.label, null, structuredClone(t.water)));
      this.tx.editor.emit({ water: true });
    }
    return t.water.level;
  }

  /**
   * Water at a level for a pasted piece: the main water for plain water when the map has none (made at
   * `level`) or it lies within half a metre of it, else a body of that kind within half a metre, else a new body
   * there (with the map full of bodies, the one of that kind nearest the level). Returns it and a function that
   * records a rect of its mask before the stroke writes there.
   */
  waterAt(level: number, kind: MapWaterKind, color?: string): { water: MapWater; touch: (rect: GridRect) => void } {
    const t = this.doc.terrain;
    if (kind === 'water' && (!t.water || Math.abs(t.water.level - level) <= 0.5)) {
      this.ensureWater(level);
      return { water: t.water!, touch: (r) => this.touchWater(r) };
    }
    const bodies = (t.waterBodies ??= []);
    let index = bodies.findIndex((b) => (b.kind ?? 'water') === kind && Math.abs(b.level - level) <= 0.5);
    if (index < 0 && bodies.length >= MAX_WATER_BODIES) index = bodies.reduce((best, b, n) => ((b.kind ?? 'water') === kind && (best < 0 || Math.abs(b.level - level) < Math.abs(bodies[best].level - level)) ? n : best), -1);
    if (index < 0) {
      bodies.push({ ...emptyWater(t, Math.round(level * 10) / 10), color: color ?? BODY_COLORS[kind], kind });
      index = bodies.length - 1;
      this.tx.include(new BodyAddCommand(this.tx.label, index, structuredClone(bodies[index])));
      this.tx.editor.emit({ water: true });
    }
    // Its images copy with it from here on, touched or not
    const target = `body${index}` as const;
    this.tx.record(target);
    return { water: bodies[index], touch: (rect) => this.tx.touch(target, rect) };
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
      this.tx.include(new BodyAddCommand(this.tx.label, index, structuredClone(bodies[index])));
      this.tx.editor.emit({ water: true });
    }
    this.poolBodies.set(kind, index);
    const target = `body${index}` as const;
    this.tx.record(target);
    return { water: bodies[index], touch: (rect) => this.tx.touch(target, rect), index };
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

  /**
   * Metres from each height sample to the nearest water of the stroke's
   * coast (coastLevel: a sample of a body at that level under its surface,
   * or within a river of it), up to COAST_FAR; null without a coast. Worked
   * out once per stroke on the ground before it (a chamfer distance over the
   * grid), so a beach keeps its profile while the brush reshapes it.
   */
  coastDistance(): Float32Array | null {
    if (this.coastFar !== undefined) return this.coastFar;
    const level = this.coastLevel();
    if (level === null) return (this.coastFar = null);
    const t = this.doc.terrain;
    const g = t.grid;
    const c = g.columns;
    const rows = g.rows;
    const d = new Float32Array(c * rows).fill(COAST_FAR);
    const bodies = [t.water, ...(t.waterBodies ?? [])].filter((b) => b && Math.abs(b.level - level) < 0.01);
    for (let k = 0; k < d.length; k++) {
      const h = this.baseHeight(k % c, Math.floor(k / c));
      for (const b of bodies) if (b!.mask[k] && h < level) d[k] = 0;
    }
    for (const river of t.rivers ?? []) {
      if (river.kind !== 'water') continue;
      for (const p of river.points) {
        const i0 = Math.round((p.x + t.width / 2) / g.cellSize);
        const j0 = Math.round((p.y + t.depth / 2) / g.cellSize);
        const r = Math.ceil(p.width / 2 / g.cellSize);
        for (let j = Math.max(0, j0 - r); j <= Math.min(rows - 1, j0 + r); j++) for (let i = Math.max(0, i0 - r); i <= Math.min(c - 1, i0 + r); i++) d[j * c + i] = 0;
      }
    }
    // Two passes of a 3-4 chamfer, in metres
    const a = g.cellSize;
    const b = g.cellSize * Math.SQRT2;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < c; i++) {
        const k = j * c + i;
        if (i > 0) d[k] = Math.min(d[k], d[k - 1] + a);
        if (j > 0) {
          d[k] = Math.min(d[k], d[k - c] + a);
          if (i > 0) d[k] = Math.min(d[k], d[k - c - 1] + b);
          if (i < c - 1) d[k] = Math.min(d[k], d[k - c + 1] + b);
        }
      }
    }
    for (let j = rows - 1; j >= 0; j--) {
      for (let i = c - 1; i >= 0; i--) {
        const k = j * c + i;
        if (i < c - 1) d[k] = Math.min(d[k], d[k + 1] + a);
        if (j < rows - 1) {
          d[k] = Math.min(d[k], d[k + c] + a);
          if (i < c - 1) d[k] = Math.min(d[k], d[k + c + 1] + b);
          if (i > 0) d[k] = Math.min(d[k], d[k + c - 1] + b);
        }
      }
    }
    return (this.coastFar = d);
  }

  /** Call before the stroke changes the road network (river bridges, a new road) */
  markPaths(): void {
    this.tx.snapshot('paths');
  }

  /** Whether the stroke changed the road network */
  get pathsMarked(): boolean {
    return this.tx.marked('paths');
  }

  /** Call before the stroke adds or changes a river */
  markRivers(): void {
    this.tx.snapshot('rivers');
  }

  /** Call before the stroke adds life areas (a pasted stamp's) */
  markLife(): void {
    this.tx.snapshot('life');
  }

  /** Save the main water's mask under `rect` before writing there; its symmetric images copy with it from then on */
  touchWater(rect: GridRect): void {
    this.waterTouched = true;
    this.tx.touch('water', rect);
  }

  /** Height of sample (i, j) before the stroke */
  baseHeight(i: number, j: number): number {
    return this.tx.original('heights', i, j);
  }

  /** Takes objects off the map, as part of the stroke's undo step; before any are added */
  removeObjects(ids: readonly string[]): void {
    if (!ids.length) return;
    const set = new Set(ids);
    // Their places are free again for what the stroke sets
    for (const o of this.doc.objects) if (set.has(o.id)) this.grid.remove(o);
    this.tx.removeObjects(ids);
  }

  addObject(o: Omit<MapObject, 'id'>): MapObject {
    const object = { ...o, id: this.ids.take() } as MapObject;
    const t = this.doc.terrain;
    const images = this.symmetry === 'none' ? [] : objectImages([object], symmetryImages(this.symmetry, t.grid.columns === t.grid.rows), () => this.ids.take(), t.width / 2, t.depth / 2);
    const placed = [object, ...images];
    this.tx.addObjects(placed);
    for (const p of placed) this.grid.add(p);
    return object;
  }

  /** Tell the view what a dab changed; with the pointer's position the dab is copied to its symmetric images */
  changed(dab: DocChange, center?: MapPoint): void {
    if (dab.bodies && this.symmetry !== 'none') dab = { ...dab, bodies: undefined, bodyRect: undefined, water: true };
    const change =
      center && this.symmetry !== 'none'
        ? mirrorDab(this.tx, this.symmetry, center, dab, {
            heightsAdd: this.heightsAdd,
            water: this.waterTouched,
            copyAll: !this.editorCopies,
            waterRect: dab.water ? dab.heights : undefined,
          })
        : dab;
    this.tx.changed(change);
  }

  /** The stroke as one undo step; null when it changed nothing */
  finish(): EditCommand | null {
    const t = this.doc.terrain;
    // Rocks settle onto their plates on the ground the stroke leaves behind (it may have shaped it after placing them)
    const moved: string[] = [];
    for (const o of this.tx.added) {
      const rock = rockShape(this.catalog.object(o.asset));
      if (!rock) continue;
      const next = settled(t, o, rock);
      if (next === o) continue;
      Object.assign(o, next);
      if (!next.pitch) delete o.pitch;
      if (!next.roll) delete o.roll;
      moved.push(o.id);
    }
    if (moved.length) this.tx.editor.emit({ objects: moved });
    return this.tx.commit();
  }

  /** Everything the stroke changed so far, for one last view refresh */
  get changes(): DocChange {
    return this.tx.changes;
  }
}
