import {
  Color,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Ray,
  Raycaster,
  Sphere,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Camera,
  type Material,
  type Object3D,
  type MeshStandardMaterial,
} from 'three';
import type { MapObject } from '../../map-document';
import { objectRadius, screenDistance, type AssetCatalog, type CatalogObject } from '../asset-catalog';
import type { HeightField } from '../height-field';
import type { MapAssetLibrary, ModelPart, ObjectModel } from '../map-asset-library';
import { addHeightFog } from '../environment/height-fog';
import { WIND_GLSL, WIND_UNIFORMS, windSwayAtTop } from '../environment/wind';
import { mapToScene } from '../map-coords';
import { seatHeight, wallShear } from './object-seat';
import { addAtlasVariants } from './atlas-variants';
import { instanceVariation } from './instance-variation';
import type { ImpostorCache } from './impostor-cache';
import { addVertexRoughMetal, mergeParts } from './merge-parts';
import { clothGeometry, isCloth } from './cloth';
import { DEFAULT_SPIN, SPIN_GLSL } from './spin';
import { addRotorTurn, DEFAULT_ROTOR, isRotor, rotorDepthMaterial, rotorGeometry, rotorHub } from './rotor';
import { addNightWindows, isWindowGlass } from './night-windows';
import { addLodFade, blendAt, disposeFadeGeometry, fadeGeometry, REST_S, SETTLE_S, settleBlend, type LodBlend } from './lod-fade';
import { MassLayer } from './mass-layer';

/**
 * The placed objects of a map, drawn instanced. An asset with many objects
 * (more than PACK_MAX: forests, scatter) is split into square cells of the
 * map (CELL_SIZE): per cell and detail level one InstancedMesh per model
 * part, each with tight bounds. three's frustum culling then drops whole
 * cells for the camera, the sun's shadow and the LOS cube alike, and
 * nothing is repacked per frame. An asset with few objects (houses, cars,
 * lamps: most of a town) has no cells: one InstancedMesh per detail level
 * and part, and its objects are sorted into the levels by their own
 * distance again whenever the camera moved REPACK_STEP. A town of 900
 * objects drew some 200 cells of up to ten parts each, 1111 calls in the
 * game view (docs/BENCHMARKS.md); packed it draws one mesh per asset, level
 * and part. Plain-coloured model parts of one look are merged into one
 * (merge-parts.ts). Around each switch distance a band shows both levels
 * dissolving into each other (lod-fade.ts), packed objects each by their
 * own distance, cells as a whole.
 *
 * - each frame a cell shows one detail level by its distance (the model,
 *   the catalogue's `lod` models, an impostor for far trees) and hides
 *   beyond the asset's draw distance
 * - only cells near the camera's focus cast shadows (the sun's shadow box
 *   covers no more)
 * - sight blockers (trees, big rocks, buildings) live in the LOS group:
 *   the LOS cube renders from the towers with its own frustum, and sees
 *   the level the camera chose
 *
 * Trees and plants sway in the wind, foliage cards keep their normals and
 * fade when seen edge-on or near their draw distance, waterfall cards flow
 * and flames flicker (all in objectMaterial). Vegetation gets a brightness
 * hue and size per instance, trees also a lean, autumn foliage a wider
 * turn of colour (instance-variation.ts), so a forest of one model does
 * not look cloned.
 *
 * Buildings raised from their own footprint (MapObject.mass) have no model
 * of their own: the mass layer draws them (mass-layer.ts), every object
 * call here hands them over.
 */

/** Distance from the point at `at` in `xyz` to `p`; not Math.hypot, a builtin call whose result V8 boxes, per object and frame */
function distance(xyz: Float32Array, at: number, p: Vector3): number {
  const dx = xyz[at] - p.x;
  const dy = xyz[at + 1] - p.y;
  const dz = xyz[at + 2] - p.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** `n` values of `from` at `at` into `to` at `into` */
function copyValues(from: Float32Array, at: number, to: Float32Array, into: number, n: number): void {
  for (let k = 0; k < n; k++) to[into + k] = from[at + k];
}

/** Marks the first `count` values of an instance attribute for upload, not the room behind them; none for an empty level (hidden) */
function uploadFirst(attribute: InstancedBufferAttribute, count: number): void {
  if (count === 0) return;
  attribute.clearUpdateRanges();
  attribute.addUpdateRange(0, count);
  attribute.needsUpdate = true;
}

/**
 * Marks `count` values at `start` of an instance attribute for upload, in one range per attribute that grows over
 * them: three empties the ranges only when it uploads, that is when the mesh draws, so a level never shown (a far
 * one while the brush works near) gathered one range per object and frame without end
 */
function markRange(attribute: InstancedBufferAttribute, start: number, count: number): void {
  const range = attribute.updateRanges[0];
  if (!range) attribute.addUpdateRange(start, count);
  else {
    const end = Math.max(range.start + range.count, start + count);
    range.start = Math.min(range.start, start);
    range.count = end - range.start;
  }
  attribute.needsUpdate = true;
}

/** Edge of an object cell in metres */
export const CELL_SIZE = 192;
/** Assets with at most this many objects draw without cells, sorted into levels per object */
export const PACK_MAX = 512;
/** A packed asset sorts its objects into levels again once the camera moved this far, m */
const REPACK_STEP = 2;
/**
 * Packed objects sorted again per frame at most, over all assets: the
 * camera moves every packed asset its step at once, and a town's assets
 * all sorted in that one frame; the rest wait for the next frames, oldest
 * first (applyLevels)
 */
const REPACK_PER_FRAME = 1500;
/** The cell key of a packed asset's one cell */
const PACKED = Number.MIN_SAFE_INTEGER;
/** An object outside every band (Packed.nextOf) */
const NO_NEXT = -2;
/** Strongest glow of an object surface (emissive colour times intensity, linear) */
const MAX_EMISSIVE = 0.55;
/**
 * Room a cell's meshes keep for objects added later: half again of what
 * they hold, at least 16. A brush that adds a few objects a frame then writes
 * them into the free slots instead of building the cell's meshes anew.
 */
function cellCapacity(n: number): number {
  return Math.max(16, Math.ceil(n * 1.5));
}

interface Level {
  from: number;
  /** `depthMaterial`: the part's own for the shadow pass (an impostor's card turned to the sun) */
  parts: { geometry: BufferGeometry; material: Material; depthMaterial?: Material }[];
  /** A far impostor: starts at the larger of `from` and the quality level's impostor distance */
  impostor?: boolean;
}

interface Cell {
  /** Object indices of the batch in this cell; slot k of the meshes draws indices[k] */
  indices: number[];
  /** Instances the cell's meshes have room for (their count is indices.length) */
  capacity: number;
  /** Meshes per level */
  levels: InstancedMesh[][];
  /** Per level the `lodFade` of its meshes' instances (lod-fade.ts) */
  fades: InstancedBufferAttribute[];
  sphere: Sphere;
  level: number;
  /** In a band: the level it dissolves into (-1: none, at the draw distance) and how far; null outside a band */
  next: number | null;
  fade: number;
  /** A packed asset's one cell: its objects sorted into the levels; null for a cell of the map */
  packed: Packed | null;
}

/** The levels of a packed asset (PACK_MAX) */
interface Packed {
  /** The level each object shows, -1 hidden */
  levelOf: Int8Array;
  /** In a band: the level it dissolves into (-1: none), NO_NEXT outside; and how far (lod-fade.ts) */
  nextOf: Int8Array;
  fadeOf: Float32Array;
  /**
   * The level each object casts its shadow with, -1 none: the one that
   * covers more of its pixels in a band, and only near the focus
   * (shadowRadius), as the cells do
   */
  shadowOf: Int8Array;
  /** Per level: how many of its instances, written first, cast (the shadow pass draws only those) */
  casters: number[];
  /** Per level: the instance matrices (and colours) all its part meshes share, and the bounds of what it shows */
  matrices: InstancedBufferAttribute[];
  colors: (InstancedBufferAttribute | null)[];
  bounds: Sphere[];
  /** Every object in object order, level 0's parts: what the editor picks (never drawn) */
  pick: InstancedMesh[];
  /** Where the camera stood at the last sort */
  at: Vector3;
  /** The instances changed since: the next sort writes every level */
  stale: boolean;
  /** Objects in a band at the last sort: they follow the settling at rest */
  banded: number;
}

interface AssetBatch {
  entry: CatalogObject;
  model: ObjectModel;
  blocksLos: boolean;
  objects: MapObject[];
  levels: Level[];
  /** Instance matrices of all objects (16 per object) */
  matrices: Float32Array;
  /** Bounding sphere centre and radius per object (4 per object) */
  spheres: Float32Array;
  colors: Float32Array | null;
  cells: Map<number, Cell>;
  /** Cell and slot of each object */
  slots: { cell: number; slot: number }[];
}

export interface ObjectHit {
  object: MapObject;
  point: Vector3;
  distance: number;
}

export interface ObjectLayerOptions {
  /** The view's impostors (shared with its other object layers); without them far trees keep their model */
  impostors?: ImpostorCache;
  /** Level of the water at a map point, null on dry ground (floating objects) */
  waterLevelAt?: (x: number, y: number) => number | null;
  /** Assets with at most this many objects draw packed (PACK_MAX by default; 0 puts every asset into cells) */
  packMax?: number;
}

export class MapObjectLayer {
  /** Non-blocking objects; blocking ones are added to the LOS group given to the constructor */
  readonly group = new Group();
  /**
   * Settles once the programs of assets new to the map are built (the editor compiles them off the main
   * thread): their first objects wait for it, instead of linking them in the frame they first draw
   */
  prepareAssets: ((assetIds: string[]) => Promise<unknown>) | null = null;
  private batches: AssetBatch[] = [];
  private readonly byId = new Map<string, { batch: AssetBatch; index: number }>();
  private readonly materials = new Map<string, Material>();
  /** Shadow materials of rotor parts by seconds a turn (rotorShadow) */
  private readonly rotorShadows = new Map<number, Material>();
  private disposed = false;
  private generation = 0;
  private readonly camPos = new Vector3();
  private readonly focus = new Vector3();
  /** How far the bands have settled at rest (lod-fade.ts settleBlend): 0 while the camera moves, 1 at rest */
  private settle = 0;
  /** The camera's position at the last frame, and how long it has stood there, s */
  private readonly lastCamPos = new Vector3(Infinity, 0, 0);
  private readonly lastFocus = new Vector3(Infinity, 0, 0);
  private lastShadowRadius = 0;
  private restFor = 0;
  /** The levels being worked out for a cell or packed object (blendAt, settleBlend), one object for all */
  private readonly blend: LodBlend = { level: 0, next: null, t: 0 };
  /** Which levels of a packed asset writePacked writes again, one array for all */
  private dirtyLevels = new Uint8Array(8);
  /** Packed cells due for their sort this frame, with their assets and their place among all packed cells (applyLevels) */
  private readonly due: { batch: AssetBatch; cell: Cell; order: number }[] = [];
  private dueCount = 0;
  /** The place among the packed cells the next frame's sort starts at: the first one left waiting */
  private repackFrom = 0;
  /** A packed cell waits for its sort: the next frame sorts on though the camera stands */
  private repackDue = false;
  private readonly tmpMatrix = new Matrix4();
  private readonly shear = new Matrix4();
  private readonly tmpPos = new Vector3();
  /** Ground and water for seatHeight, bound once */
  private readonly seatGround = (x: number, y: number): number => this.field.heightAt(x, y);
  private readonly seatWater = (x: number, y: number): number | null => this.options.waterLevelAt?.(x, y) ?? null;
  private readonly tmpQuat = new Quaternion();
  private readonly tmpScale = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly leanAxis = new Vector3();
  private readonly tilt = new Quaternion();
  private readonly tiltEuler = new Euler();
  private readonly sphere = new Sphere();
  private readonly raycaster = new Raycaster();
  private readonly pickMeshes: InstancedMesh[] = [];
  private readonly instanceSphere = new Sphere();
  private readonly instanceMatrix = new Matrix4();
  /** Cells within this distance of the focus cast shadows */
  shadowRadius = 400;
  /**
   * The quality level's part (render-quality.ts): detail switches and the
   * draw distance of objects that do not block sight times `lodBias`,
   * impostors from `impostorFrom` m. High (1, 380 m) is the picture as
   * before the levels. Sight blockers keep their draw distance: what the
   * line of sight sees does not depend on the level
   */
  private detail = { lodBias: 1, impostorFrom: 380 };
  /** Fade ranges of the card materials with the draw distance they were made for */
  private readonly fades: { range: Vector2; drawDistance: number }[] = [];
  /** Counts every change the sun's shadow map shows: instances moved, levels or casters switched */
  version = 0;
  /** The buildings raised from their footprint */
  private readonly masses: MassLayer;

  constructor(
    private readonly field: HeightField,
    private readonly assets: MapAssetLibrary,
    private readonly losGroup: Group,
    private readonly options: ObjectLayerOptions = {},
  ) {
    this.group.name = 'custom-map-objects';
    this.group.userData['losTransparent'] = true;
    this.masses = new MassLayer(field, assets, losGroup, options.waterLevelAt, () => this.version++);
    this.group.add(this.masses.group);
  }

  /** Replaces every object; resolves when the models are in */
  async setObjects(objects: MapObject[]): Promise<void> {
    const generation = ++this.generation;
    const masses = objects.filter(MassLayer.owns);
    const shown = this.masses.setObjects(masses);
    if (masses.length) objects = objects.filter((o) => !MassLayer.owns(o));
    const groups = new Map<string, MapObject[]>();
    const catalog = await this.assets.catalog();
    for (const o of objects) {
      const entry = entriesOf(catalog).get(o.asset);
      const blocks = o.blocksLos ?? entry?.blocksLos ?? false;
      const key = `${o.asset}|${blocks ? 1 : 0}`;
      let list = groups.get(key);
      if (!list) groups.set(key, (list = []));
      list.push(o);
    }
    // Every asset's model and detail models at once: one after the other, a town waited for 49 loads in a row
    const loaded = await Promise.all(
      [...groups].map(async ([key, list]) => ({
        key,
        list,
        parts: await Promise.all([this.assets.model(list[0].asset), this.assets.lodModels(list[0].asset)]).then(async (parts) => {
          await this.prepareImpostor(parts[0]);
          return parts;
        }),
      })),
    );
    if (generation !== this.generation) return;
    const built = loaded.map(({ key, list, parts: [model, lods] }) => this.buildBatch(model, lods, key.endsWith('|1'), list));
    this.clear();
    this.batches = built;
    for (const b of built) b.objects.forEach((o, index) => this.byId.set(o.id, { batch: b, index }));
    this.applyLevels(true);
    await shown;
  }

  /**
   * Moves, turns or scales objects in place, one upload per asset. Returns
   * the ones it could not: unknown, another asset or LOS flag, or out of
   * their cell; the caller moves those out and in again.
   */
  updateObjects(objects: readonly MapObject[]): MapObject[] {
    const rest: MapObject[] = [];
    const changed = new Map<AssetBatch, number[]>();
    for (const o of objects) {
      const slot = this.byId.get(o.id);
      const b = slot?.batch;
      // A raised building goes out and in again (mass-layer.ts writes all of them anew)
      if (!slot || !b || MassLayer.owns(o)) {
        rest.push(o);
        continue;
      }
      const blocks = o.blocksLos ?? b.entry.blocksLos;
      const cell = b.slots[slot.index].cell;
      if (o.asset !== b.objects[slot.index].asset || blocks !== b.blocksLos || (cell !== PACKED && this.cellKey(o.x, o.y) !== cell)) {
        rest.push(o);
        continue;
      }
      b.objects[slot.index] = o;
      this.writeInstance(b, slot.index);
      let list = changed.get(b);
      if (!list) changed.set(b, (list = []));
      list.push(slot.index);
    }
    for (const [b, list] of changed) this.uploadInstances(b, list, true);
    if (changed.size) this.version++;
    return rest;
  }

  /**
   * Adds objects; only the cells they land in are rebuilt (an asset new to
   * the map loads its model first). Resolves when they show.
   */
  async addObjects(objects: MapObject[]): Promise<void> {
    if (!objects.length) return;
    const masses = objects.filter(MassLayer.owns);
    if (masses.length) {
      objects = objects.filter((o) => !MassLayer.owns(o));
      await Promise.all([this.masses.change(masses, []), this.addObjects(objects)]);
      return;
    }
    const generation = this.generation;
    const catalog = await this.assets.catalog();
    const groups = new Map<string, MapObject[]>();
    for (const o of objects) {
      const entry = entriesOf(catalog).get(o.asset);
      const blocks = o.blocksLos ?? entry?.blocksLos ?? false;
      const key = `${o.asset}|${blocks ? 1 : 0}`;
      let list = groups.get(key);
      if (!list) groups.set(key, (list = []));
      list.push(o);
    }
    for (const [key, list] of groups) {
      const blocks = key.endsWith('|1');
      const find = (): AssetBatch | undefined => this.batches.find((x) => x.model.id === list[0].asset && x.blocksLos === blocks);
      let b = find();
      if (!b) {
        // An asset new to the map: its programs built before its first objects draw (prepareAssets)
        const [model, lods] = await Promise.all([this.assets.model(list[0].asset), this.assets.lodModels(list[0].asset), this.prepareAssets?.([list[0].asset])]);
        await this.prepareImpostor(model);
        // A setObjects in between replaced everything
        if (generation !== this.generation) return;
        // Another call may have made the batch meanwhile
        b = find();
        if (!b) {
          const built = this.buildBatch(model, lods, blocks, list);
          this.batches.push(built);
          built.objects.forEach((o, index) => this.byId.set(o.id, { batch: built, index }));
          continue;
        }
      }
      const start = b.objects.length;
      const n = start + list.length;
      b.objects.push(...list);
      b.matrices = grow(b.matrices, n * 16);
      b.spheres = grow(b.spheres, n * 4);
      // A first tinted object gives the batch colours: every cell then needs them
      const newColors = !b.colors && list.some((o) => o.tint);
      if (b.colors || newColors) b.colors = grow(b.colors ?? new Float32Array(0), n * 3);
      if (newColors) for (let i = 0; i < start; i++) this.writeInstance(b, i);
      b.slots.length = n;
      for (let i = start; i < n; i++) {
        this.writeInstance(b, i);
        this.byId.set(b.objects[i].id, { batch: b, index: i });
      }
      // New colours, a packed asset (its one cell is built anew, a few hundred instances at most), or one
      // that grows past PACK_MAX into cells: laid out anew
      if (newColors || b.cells.has(PACKED) || n <= (this.options.packMax ?? PACK_MAX)) {
        this.layoutCells(b);
        continue;
      }
      // Into free slots of their cells; a cell without room (or a new one) is built once for all of them
      const rebuild = new Map<number, number[]>();
      for (let i = start; i < n; i++) this.placeInCell(b, i, rebuild);
      for (const [key, added] of rebuild) this.rebuildCell(b, key, added);
    }
    // New cells start without a level: the normal pass picks theirs and leaves the others alone
    this.version++;
    this.applyLevels(false);
  }

  /**
   * Removes objects by id: each leaves its cell's meshes in place (the cell's
   * last instance fills its slot), a cell that empties goes; a packed asset
   * is built anew
   */
  removeObjects(ids: string[]): void {
    const masses = ids.filter((id) => this.masses.has(id));
    if (masses.length) void this.masses.change([], masses);
    // Packed assets are built anew once their objects are out
    const repack = new Set<AssetBatch>();
    for (const id of ids) {
      const slot = this.byId.get(id);
      if (!slot) continue;
      const b = slot.batch;
      const i = slot.index;
      this.byId.delete(id);
      if (b.cells.has(PACKED)) repack.add(b);
      else this.takeFromCell(b, i);
      const last = b.objects.length - 1;
      if (i !== last) {
        // The batch's last object moves into the gap; its cell slot now names index i
        b.objects[i] = b.objects[last];
        b.slots[i] = b.slots[last];
        b.matrices.copyWithin(i * 16, last * 16, last * 16 + 16);
        b.spheres.copyWithin(i * 4, last * 4, last * 4 + 4);
        b.colors?.copyWithin(i * 3, last * 3, last * 3 + 3);
        const moved = b.cells.get(b.slots[i].cell);
        if (moved) moved.indices[b.slots[i].slot] = i;
        this.byId.set(b.objects[i].id, { batch: b, index: i });
      }
      b.objects.length = last;
      b.slots.length = last;
    }
    for (const b of repack) this.layoutCells(b);
    const empty = this.batches.filter((b) => b.objects.length === 0);
    if (empty.length) this.batches = this.batches.filter((b) => b.objects.length > 0);
    this.version++;
    this.applyLevels(false);
  }

  /**
   * Objects stand on the terrain: call after heights changed, with the
   * changed rectangle in map metres to touch only the objects on it
   */
  refreshHeights(rect?: { minX: number; minY: number; maxX: number; maxY: number }, floatingOnly = false): void {
    if (!floatingOnly) this.masses.refreshHeights(rect);
    for (const b of this.batches) {
      if (floatingOnly && !b.entry.float) continue;
      const reach = b.entry.footprint * 3 + 2;
      const changed: number[] = [];
      const visit = (i: number): void => {
        const o = b.objects[i];
        if (rect && (o.x < rect.minX - reach || o.x > rect.maxX + reach || o.y < rect.minY - reach || o.y > rect.maxY + reach)) {
          return;
        }
        if (this.reseat(b, i)) changed.push(i);
      };
      if (rect && !b.cells.has(PACKED)) {
        // Only the cells the rectangle reaches: a brush on a map of 50 000 objects touches a few dozen
        const cx0 = Math.floor((rect.minX - reach) / CELL_SIZE);
        const cx1 = Math.floor((rect.maxX + reach) / CELL_SIZE);
        const cy0 = Math.floor((rect.minY - reach) / CELL_SIZE);
        const cy1 = Math.floor((rect.maxY + reach) / CELL_SIZE);
        for (let cx = cx0; cx <= cx1; cx++) {
          for (let cy = cy0; cy <= cy1; cy++) b.cells.get(cx * 4096 + cy)?.indices.forEach(visit);
        }
      } else {
        for (let i = 0; i < b.objects.length; i++) visit(i);
      }
      if (changed.length) {
        this.uploadInstances(b, changed, !!rect);
        this.version++;
      }
    }
  }

  /** Detail level and draw distance per cell, shadows near `focus` (group space); the wind's clock runs in the environment */
  update(dt: number, camera: Camera, focus?: Vector3): void {
    camera.getWorldPosition(this.camPos);
    this.group.worldToLocal(this.camPos);
    this.focus.copy(focus ?? this.camPos);
    // At rest the bands settle, moving they open again (settleBlend)
    const moved = this.camPos.distanceToSquared(this.lastCamPos) > 1e-6;
    const focusMoved = this.focus.distanceToSquared(this.lastFocus) > 1e-6 || this.shadowRadius !== this.lastShadowRadius;
    this.lastCamPos.copy(this.camPos);
    this.lastFocus.copy(this.focus);
    this.lastShadowRadius = this.shadowRadius;
    this.restFor = moved ? 0 : this.restFor + dt;
    const settle = Math.min(1, Math.max(0, this.settle + (this.restFor >= REST_S ? dt : -dt) / SETTLE_S));
    const settling = settle !== this.settle;
    this.settle = settle;
    // A camera at rest with its bands settled and no packed asset waiting for its sort changes nothing
    if (moved || focusMoved || settling || this.repackDue) this.applyLevels(false, settling);
  }

  /**
   * Shows one cell of every level of every asset with shadows on (or puts the
   * normal per-frame choice back): a single render then compiles every
   * program the objects can need, shadow depth variants included
   */
  showAllForWarmUp(on: boolean): void {
    if (!on) {
      this.applyLevels(true);
      return;
    }
    for (const b of this.batches) {
      const cell = b.cells.values().next().value as Cell | undefined;
      for (const c of b.cells.values()) for (const meshes of c.levels) for (const m of meshes) m.visible = false;
      if (!cell) continue;
      // A packed asset: every object into every level for the one render
      if (cell.packed) this.writePacked(b, cell, cell.packed, true);
      for (const meshes of cell.levels) {
        for (const m of meshes) {
          m.visible = true;
          m.castShadow = true;
          m.frustumCulled = false;
        }
      }
    }
  }

  /**
   * One instance of every detail level of these assets, with the same
   * materials and instance attributes the map's cells would get, for
   * compiling their programs before the first one is placed. Bakes the
   * impostors too. The caller disposes the meshes (not their geometry or
   * materials, which the layer shares).
   */
  async warmUpMeshes(ids: string[]): Promise<InstancedMesh[]> {
    const out: InstancedMesh[] = [];
    const identity = new Matrix4();
    const white = new Color(1, 1, 1);
    for (const id of new Set(ids)) {
      const [model, lods] = await Promise.all([this.assets.model(id), this.assets.lodModels(id)]);
      await this.prepareImpostor(model);
      const vegetation = model.entry.category === 'tree' || model.entry.category === 'plant';
      for (const level of this.levelsFor(model, lods)) {
        for (const part of level.parts) {
          // Vegetation always has instance colours; other assets only when tinted, so both variants
          for (const colored of vegetation ? [true] : [false, true]) {
            const mesh = new InstancedMesh(part.geometry, part.material, 1);
            if (part.depthMaterial) mesh.customDepthMaterial = part.depthMaterial;
            mesh.setMatrixAt(0, identity);
            if (colored) mesh.setColorAt(0, white);
            mesh.frustumCulled = false;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            out.push(mesh);
          }
        }
      }
    }
    return out;
  }

  /** First object a scene-space ray hits; the raycaster and the mesh list are kept between calls */
  raycast(ray: Ray): ObjectHit | null {
    this.raycaster.ray.copy(ray);
    const meshes = this.pickMeshes;
    meshes.length = 0;
    for (const b of this.batches) for (const c of b.cells.values()) for (const m of c.packed ? c.packed.pick : c.levels[0]) meshes.push(m);
    const hits = this.raycaster.intersectObjects(meshes, false);
    meshes.length = 0;
    let found: ObjectHit | null = null;
    for (const hit of hits) {
      const mesh = hit.object as InstancedMesh;
      const batch = mesh.userData['batch'] as AssetBatch | undefined;
      const cell = mesh.userData['cell'] as Cell | undefined;
      if (!batch || !cell || hit.instanceId === undefined) continue;
      // A packed asset's pick meshes hold the objects in their own order
      const index = cell.packed ? hit.instanceId : cell.indices[hit.instanceId];
      found = { object: batch.objects[index], point: hit.point, distance: hit.distance };
      break;
    }
    const mass = this.masses.raycast(this.raycaster, ray);
    return mass && (!found || mass.distance < found.distance) ? mass : found;
  }

  /** Meshes of objects that block no sight (scatter, props, small plants): what a water reflection leaves out */
  decorMeshes(): Object3D[] {
    const out: Object3D[] = [];
    this.group.traverse((o) => {
      const b = o.userData['batch'] as AssetBatch | undefined;
      if (b && !b.blocksLos) out.push(o);
    });
    return out;
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.clear();
    this.masses.dispose();
    for (const m of this.materials.values()) m.dispose();
    for (const m of this.rotorShadows.values()) m.dispose();
    this.materials.clear();
    this.fades.length = 0;
    this.group.removeFromParent();
  }

  private clear(): void {
    for (const b of this.batches) {
      for (const c of b.cells.values()) this.disposeCell(c);
    }
    this.batches = [];
    this.byId.clear();
  }

  private cellKey(x: number, y: number): number {
    return Math.floor(x / CELL_SIZE) * 4096 + Math.floor(y / CELL_SIZE);
  }

  /** Bakes an asset's impostor ahead (ImpostorCache.prepare), when the layer draws impostors */
  private prepareImpostor(model: ObjectModel): Promise<void> {
    return this.options.impostors?.prepare(model) ?? Promise.resolve();
  }

  /** Detail levels of an asset: its model, the catalogue's LOD models, an impostor for far trees */
  private levelsFor(model: ObjectModel, lods: { model: ObjectModel; screen: number }[]): Level[] {
    const entry = model.entry;
    const drawn = (m: ObjectModel) =>
      mergedParts(m).map((p) => ({ geometry: p.geometry, material: this.objectMaterial(p.material, entry), depthMaterial: isRotor(p.material) ? this.rotorShadow(entry) : undefined }));
    const levels: Level[] = [{ from: 0, parts: drawn(model) }];
    // Where an object of the asset's size at scale 1 fills the level's screen share
    const radius = objectRadius(entry);
    for (const lod of lods) levels.push({ from: screenDistance(radius, lod.screen), parts: drawn(lod.model) });
    const imp = this.options.impostors?.get(model);
    if (imp) {
      // Beyond the game camera's usual distance (200 to 300 m, impostorFrom in High), where a tree is a few pixels wide
      const from = Math.max(lods.length ? levels[levels.length - 1].from * 1.5 : 0, entry.height * 25);
      levels.push({ from, impostor: true, parts: [{ geometry: imp.geometry, material: imp.material, depthMaterial: imp.depthMaterial }] });
    }
    return levels;
  }

  private buildBatch(model: ObjectModel, lods: { model: ObjectModel; screen: number }[], blocksLos: boolean, objects: MapObject[]): AssetBatch {
    const entry = model.entry;
    const n = objects.length;
    const vegetation = entry.category === 'tree' || entry.category === 'plant';
    const tinted = vegetation || objects.some((o) => o.tint);
    const b: AssetBatch = {
      entry,
      model,
      blocksLos,
      objects: objects.slice(),
      levels: this.levelsFor(model, lods),
      matrices: new Float32Array(n * 16),
      spheres: new Float32Array(n * 4),
      colors: tinted ? new Float32Array(n * 3) : null,
      cells: new Map(),
      slots: new Array(n),
    };
    for (let i = 0; i < n; i++) this.writeInstance(b, i);
    this.layoutCells(b);
    return b;
  }

  /**
   * Sorts the batch's objects into cells and builds every cell's meshes
   * anew; an asset with few objects gets its one packed cell instead
   */
  private layoutCells(b: AssetBatch): void {
    for (const cell of b.cells.values()) this.disposeCell(cell);
    b.cells.clear();
    if (b.objects.length <= (this.options.packMax ?? PACK_MAX)) {
      // Few objects: one packed cell, built anew (a few hundred instances at most)
      const indices = Array.from({ length: b.objects.length }, (_, i) => i);
      for (let i = 0; i < indices.length; i++) b.slots[i] = { cell: PACKED, slot: i };
      if (indices.length) b.cells.set(PACKED, this.buildCell(b, indices, true));
      return;
    }
    const lists = new Map<number, number[]>();
    for (let i = 0; i < b.objects.length; i++) {
      const key = this.cellKey(b.objects[i].x, b.objects[i].y);
      let list = lists.get(key);
      if (!list) lists.set(key, (list = []));
      b.slots[i] = { cell: key, slot: list.length };
      list.push(i);
    }
    for (const cell of b.cells.values()) this.disposeCell(cell);
    b.cells.clear();
    for (const [key, indices] of lists) b.cells.set(key, this.buildCell(b, indices));
  }

  /**
   * Object i (written already) into a free slot of its cell's meshes; when
   * the cell has no room or is new, `rebuild` collects it for rebuildCell
   */
  private placeInCell(b: AssetBatch, i: number, rebuild: Map<number, number[]>): void {
    const key = this.cellKey(b.objects[i].x, b.objects[i].y);
    const cell = b.cells.get(key);
    const waiting = rebuild.get(key);
    if (!cell || waiting || cell.indices.length >= cell.capacity) {
      if (waiting) waiting.push(i);
      else rebuild.set(key, [i]);
      return;
    }
    const slot = cell.indices.length;
    cell.indices.push(i);
    // In a band the next pass writes the dissolve of every slot, the new one too
    cell.fade = -1;
    b.slots[i] = { cell: key, slot };
    this.sphere.set(this.tmpPos.fromArray(b.spheres, i * 4), b.spheres[i * 4 + 3]);
    if (cell.sphere.isEmpty()) cell.sphere.copy(this.sphere);
    else cell.sphere.union(this.sphere);
    for (const meshes of cell.levels) {
      for (const m of meshes) {
        this.writeSlot(b, m, slot, i);
        m.count = cell.indices.length;
        this.growBounds(m, slot);
      }
    }
  }

  /** A cell built anew with the objects it held and `added` (a new cell: only those) */
  private rebuildCell(b: AssetBatch, key: number, added: number[]): void {
    const old = b.cells.get(key);
    const indices = old ? [...old.indices, ...added] : added;
    if (old) this.disposeCell(old);
    const cell = this.buildCell(b, indices);
    b.cells.set(key, cell);
    indices.forEach((i, slot) => (b.slots[i] = { cell: key, slot }));
  }

  /** Object i out of its cell: the cell's last instance moves into its slot; an empty cell goes */
  private takeFromCell(b: AssetBatch, i: number): void {
    const { cell: key, slot } = b.slots[i];
    const cell = b.cells.get(key);
    if (!cell) return;
    const last = cell.indices.length - 1;
    if (slot !== last) {
      const j = cell.indices[last];
      cell.indices[slot] = j;
      b.slots[j] = { cell: key, slot };
      for (const meshes of cell.levels) for (const m of meshes) this.writeSlot(b, m, slot, j);
    }
    cell.indices.pop();
    if (!cell.indices.length) {
      this.disposeCell(cell);
      b.cells.delete(key);
      return;
    }
    for (const meshes of cell.levels) for (const m of meshes) m.count = cell.indices.length;
  }

  /**
   * The mesh's bounding sphere takes in the instance at `slot` (its
   * geometry's sphere moved by its matrix, as three computes it): frustum
   * culling must not drop it, and a full recompute walks every instance
   */
  private growBounds(m: InstancedMesh, slot: number): void {
    if (!m.boundingSphere) {
      m.computeBoundingSphere();
      return;
    }
    const g = m.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    this.instanceSphere.copy(g.boundingSphere!).applyMatrix4(this.instanceMatrix.fromArray(m.instanceMatrix.array, slot * 16));
    m.boundingSphere.union(this.instanceSphere);
  }

  /** Object i's matrix and colour into slot `slot` of a cell mesh, uploaded as a range */
  private writeSlot(b: AssetBatch, m: InstancedMesh, slot: number, i: number): void {
    (m.instanceMatrix.array as Float32Array).set(b.matrices.subarray(i * 16, i * 16 + 16), slot * 16);
    markRange(m.instanceMatrix, slot * 16, 16);
    const colors = m.instanceColor;
    if (b.colors && colors) {
      (colors.array as Float32Array).set(b.colors.subarray(i * 3, i * 3 + 3), slot * 3);
      markRange(colors, slot * 3, 3);
    }
  }

  private buildCell(b: AssetBatch, indices: number[], packed = false): Cell {
    const entry = b.entry;
    const parent = b.blocksLos ? this.losGroup : this.group;
    const n = indices.length;
    const capacity = packed ? n : cellCapacity(n);
    const cell: Cell = { indices, capacity, levels: [], fades: [], sphere: new Sphere(), level: -1, next: null, fade: 0, packed: null };
    const pack: Packed | null = packed
      ? {
        levelOf: new Int8Array(n).fill(-2),
        nextOf: new Int8Array(n).fill(NO_NEXT),
        fadeOf: new Float32Array(n),
        shadowOf: new Int8Array(n).fill(-1),
        casters: [],
        matrices: [],
        colors: [],
        bounds: [],
        pick: [],
        at: new Vector3(),
        stale: true,
        banded: 0,
      }
      : null;
    for (const [li, level] of b.levels.entries()) {
      const meshes: InstancedMesh[] = [];
      // The level's dissolve per instance, shared by its parts
      const fade = new InstancedBufferAttribute(new Float32Array(capacity), 1);
      cell.fades.push(fade);
      // A packed level's parts share one set of instances
      const shared = pack ? new InstancedBufferAttribute(new Float32Array(n * 16), 16) : null;
      const sharedColors = pack && b.colors ? new InstancedBufferAttribute(new Float32Array(n * 3), 3) : null;
      if (pack) {
        pack.matrices.push(shared!);
        pack.colors.push(sharedColors);
        pack.bounds.push(new Sphere());
        pack.casters.push(0);
      }
      for (const part of level.parts) {
        const mesh = new InstancedMesh(fadeGeometry(part.geometry, fade), part.material, capacity);
        if (part.depthMaterial) mesh.customDepthMaterial = part.depthMaterial;
        mesh.count = n;
        mesh.name = `${entry.id}${b.blocksLos ? '' : '-decor'}${li ? `-lod${li}` : ''}`;
        if (shared) {
          mesh.instanceMatrix = shared;
          if (sharedColors) mesh.instanceColor = sharedColors;
          mesh.count = 0;
          mesh.boundingSphere = pack!.bounds[li];
          // The shadow pass draws the level's casters only, written first (writePacked)
          const p = pack!;
          let drawn = 0;
          mesh.onBeforeShadow = () => {
            drawn = mesh.count;
            mesh.count = Math.min(drawn, p.casters[li]);
          };
          mesh.onAfterShadow = () => {
            mesh.count = drawn;
          };
        } else {
          const arr = mesh.instanceMatrix.array as Float32Array;
          indices.forEach((i, k) => arr.set(b.matrices.subarray(i * 16, i * 16 + 16), k * 16));
          if (b.colors) {
            const c = new Color();
            indices.forEach((i, k) => mesh.setColorAt(k, c.setRGB(b.colors![i * 3], b.colors![i * 3 + 1], b.colors![i * 3 + 2])));
          }
        }
        mesh.castShadow = entry.category !== 'plant' || entry.height > 0.8;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.visible = false;
        if (!shared) mesh.computeBoundingSphere();
        mesh.userData['batch'] = b;
        mesh.userData['cell'] = cell;
        if (!b.blocksLos) mesh.userData['losTransparent'] = true;
        parent.add(mesh);
        meshes.push(mesh);
      }
      cell.levels.push(meshes);
    }
    if (pack) {
      // The editor's picks: every object, level 0's parts, in object order
      for (const part of b.levels[0]?.parts ?? []) {
        const mesh = new InstancedMesh(part.geometry, part.material, n);
        mesh.userData['batch'] = b;
        mesh.userData['cell'] = cell;
        pack.pick.push(mesh);
      }
      this.writePicks(b, pack, indices);
      cell.packed = pack;
    }
    this.cellBounds(b, cell);
    return cell;
  }

  /** The pick meshes of objects `changed` from the batch's matrices */
  private writePicks(b: AssetBatch, pack: Packed, changed: readonly number[]): void {
    for (const m of pack.pick) {
      const arr = m.instanceMatrix.array as Float32Array;
      for (const i of changed) arr.set(b.matrices.subarray(i * 16, i * 16 + 16), i * 16);
      m.instanceMatrix.needsUpdate = true;
      m.boundingSphere = null;
      m.computeBoundingSphere();
    }
  }

  /**
   * A packed asset's objects into the levels for the camera's distance to
   * each, an object in a band into both its levels with their dissolve
   * (or every object into every level whole, for the warm-up). Writes only
   * levels whose objects or dissolves changed, every level when the
   * instances did (`stale`). Returns whether an object changed its levels:
   * a dissolve moving within the band changes no shadow.
   */
  private writePacked(b: AssetBatch, cell: Cell, pack: Packed, all = false): boolean {
    const n = cell.indices.length;
    const levels = b.levels.length;
    const { lodBias, impostorFrom } = this.detail;
    const draw = b.blocksLos ? b.entry.drawDistance : b.entry.drawDistance * lodBias;
    if (this.dirtyLevels.length < levels) this.dirtyLevels = new Uint8Array(levels);
    const dirty = this.dirtyLevels;
    dirty.fill(pack.stale || all ? 1 : 0, 0, levels);
    let moved = pack.stale || all;
    let banded = 0;
    const casts = b.entry.category !== 'plant' || b.entry.height > 0.8;
    const blend = this.blend;
    for (let i = 0; i < n; i++) {
      const s = i * 4;
      if (all) {
        blend.level = 0;
        blend.next = null;
        blend.t = 0;
      } else {
        const d = Math.max(0, distance(b.spheres, s, this.camPos) - b.spheres[s + 3]);
        blendAt(b.levels, d, draw, lodBias, impostorFrom, blend);
      }
      if (blend.next !== null) banded++;
      settleBlend(blend, this.settle, blend);
      const next = blend.next ?? NO_NEXT;
      // In a band the level that covers more of the pixels casts, and only near the focus
      const near = distance(b.spheres, s, this.focus) - b.spheres[s + 3] < this.shadowRadius;
      const caster = !casts || !near ? -1 : next !== NO_NEXT && blend.t >= 0.5 ? next : blend.level;
      if (caster !== pack.shadowOf[i]) {
        moved = true;
        if (pack.shadowOf[i] >= 0) dirty[pack.shadowOf[i]] = 1;
        if (caster >= 0) dirty[caster] = 1;
        pack.shadowOf[i] = caster;
      }
      const was = pack.levelOf[i];
      const wasNext = pack.nextOf[i];
      if (blend.level !== was || next !== wasNext) {
        moved = true;
        if (was >= 0) dirty[was] = 1;
        if (wasNext >= 0) dirty[wasNext] = 1;
        if (blend.level >= 0) dirty[blend.level] = 1;
        if (next >= 0) dirty[next] = 1;
      } else if (next !== NO_NEXT && pack.fadeOf[i] !== blend.t) {
        if (blend.level >= 0) dirty[blend.level] = 1;
        if (next >= 0) dirty[next] = 1;
      }
      pack.levelOf[i] = blend.level;
      pack.nextOf[i] = next;
      pack.fadeOf[i] = blend.t;
    }
    pack.stale = false;
    pack.banded = banded;
    if (dirty.indexOf(1) < 0 || dirty.indexOf(1) >= levels) return false;
    for (let l = 0; l < levels; l++) {
      if (!dirty[l]) continue;
      const matrices = pack.matrices[l].array as Float32Array;
      const colors = pack.colors[l]?.array as Float32Array | undefined;
      const fades = cell.fades[l].array as Float32Array;
      const bounds = pack.bounds[l].makeEmpty();
      let count = 0;
      // The level's casters first, then the rest: the shadow pass draws the first `casters` (buildCell)
      for (let pass = 0; pass < 2; pass++) {
        const casting = pass === 0;
        for (let i = 0; i < n; i++) {
          const outgoing = pack.levelOf[i] === l;
          if (!all && !outgoing && pack.nextOf[i] !== l) continue;
          if (!all && (pack.shadowOf[i] === l) !== casting) continue;
          if (all && !casting) continue;
          // Copied value by value: a subarray per object was a view object each, most of what a sort allocated
          copyValues(b.matrices, i * 16, matrices, count * 16, 16);
          if (colors && b.colors) copyValues(b.colors, i * 3, colors, count * 3, 3);
          // Outgoing: drop a share t of the pixels; incoming: keep a share t
          fades[count] = all || pack.nextOf[i] === NO_NEXT ? 0 : outgoing ? pack.fadeOf[i] : pack.fadeOf[i] - 1;
          this.sphere.set(this.tmpPos.fromArray(b.spheres, i * 4), b.spheres[i * 4 + 3]);
          if (bounds.isEmpty()) bounds.copy(this.sphere);
          else bounds.union(this.sphere);
          count++;
        }
        if (casting) pack.casters[l] = count;
      }
      // Only the instances the level holds now go up
      uploadFirst(pack.matrices[l], count * 16);
      if (pack.colors[l]) uploadFirst(pack.colors[l]!, count * 3);
      uploadFirst(cell.fades[l], count);
      for (const m of cell.levels[l]) {
        m.count = count;
        m.visible = count > 0;
        m.frustumCulled = !all;
        m.castShadow = pack.casters[l] > 0;
      }
    }
    return moved;
  }

  private disposeCell(cell: Cell): void {
    for (const meshes of cell.levels) {
      for (const m of meshes) {
        m.removeFromParent();
        m.dispose();
        disposeFadeGeometry(m.geometry);
      }
    }
    for (const m of cell.packed?.pick ?? []) m.dispose();
  }

  /** The cell's bounding sphere, from its instances */
  private cellBounds(b: AssetBatch, cell: Cell): void {
    cell.sphere.makeEmpty();
    for (const i of cell.indices) {
      this.sphere.set(this.tmpPos.fromArray(b.spheres, i * 4), b.spheres[i * 4 + 3]);
      if (cell.sphere.isEmpty()) cell.sphere.copy(this.sphere);
      else cell.sphere.union(this.sphere);
    }
  }

  /** Re-uploads the instances of changed objects into their cells' meshes */
  private uploadInstances(b: AssetBatch, changed: number[], ranged: boolean): void {
    const touched = new Set<Cell>();
    for (const i of changed) {
      const { cell: key, slot } = b.slots[i];
      const cell = b.cells.get(key);
      if (!cell) continue;
      touched.add(cell);
      if (cell.packed) continue;
      for (const meshes of cell.levels) {
        for (const m of meshes) {
          (m.instanceMatrix.array as Float32Array).set(b.matrices.subarray(i * 16, i * 16 + 16), slot * 16);
          if (ranged) markRange(m.instanceMatrix, slot * 16, 16);
          else {
            // All of it: ranges marked before would cut the upload to them
            m.instanceMatrix.clearUpdateRanges();
            m.instanceMatrix.needsUpdate = true;
          }
        }
      }
    }
    for (const cell of touched) {
      this.cellBounds(b, cell);
      if (!cell.packed) continue;
      // The objects sort again into their levels, every level written with the new instances
      this.writePicks(b, cell.packed, changed);
      cell.packed.stale = true;
      this.writePacked(b, cell, cell.packed);
    }
    // A few changed (a brush): the mesh spheres grow by them; many: computed anew
    if (ranged && changed.length < 64) {
      for (const i of changed) {
        const { cell: key, slot } = b.slots[i];
        const cell = b.cells.get(key);
        if (cell && !cell.packed) for (const meshes of cell.levels) for (const m of meshes) this.growBounds(m, slot);
      }
    } else {
      for (const cell of touched) if (!cell.packed) for (const meshes of cell.levels) for (const m of meshes) m.computeBoundingSphere();
    }
  }

  /** The quality level's detail (see `detail`); every cell takes its level again */
  setDetail(detail: { lodBias: number; impostorFrom: number }): void {
    if (detail.lodBias === this.detail.lodBias && detail.impostorFrom === this.detail.impostorFrom) return;
    this.detail = { ...detail };
    for (const f of this.fades) f.range.set(f.drawDistance * detail.lodBias * 0.55, f.drawDistance * detail.lodBias);
    this.applyLevels(true);
  }

  /**
   * Per cell: the level for its distance, hidden beyond the draw distance,
   * shadows only near the focus. Packed assets sort their objects again
   * once the camera moved a step, at most REPACK_PER_FRAME objects a frame
   * (forced ones and settling bands all at once); one left waiting sets
   * `repackDue` and goes first in the next frame
   */
  private applyLevels(force: boolean, settling = false): void {
    if (force) this.version++;
    const { lodBias, impostorFrom } = this.detail;
    let packed = 0;
    this.dueCount = 0;
    for (const b of this.batches) {
      const draw = b.blocksLos ? b.entry.drawDistance : b.entry.drawDistance * lodBias;
      for (const cell of b.cells.values()) {
        const pack = cell.packed;
        if (pack) {
          const order = packed++;
          // Sorted again once the camera moved a step; the shadow map follows what changed
          if (force) pack.stale = true;
          // A band that settles or opens is written anew though the camera stands
          if (pack.stale || (settling && pack.banded > 0)) {
            pack.at.copy(this.camPos);
            if (this.writePacked(b, cell, pack)) this.version++;
          } else if (pack.at.distanceToSquared(this.camPos) >= REPACK_STEP * REPACK_STEP) {
            this.addDue(b, cell, order);
          }
          continue;
        }
        const d = Math.max(0, cell.sphere.distanceToPoint(this.camPos));
        const { level, next, t } = settleBlend(blendAt(b.levels, d, draw, lodBias, impostorFrom, this.blend), this.settle, this.blend);
        if (level !== cell.level || next !== cell.next || force) {
          for (let l = 0; l < cell.levels.length; l++) {
            for (const m of cell.levels[l]) {
              m.visible = l === level || l === next;
              m.frustumCulled = true;
            }
          }
          cell.level = level;
          cell.next = next;
          cell.fade = -1;
          this.version++;
        }
        if (next !== null && t !== cell.fade) {
          // The whole cell dissolves: outgoing drops a share t of its pixels, incoming keeps a share t
          cell.fade = t;
          if (level >= 0) this.setCellFade(cell, level, t);
          if (next >= 0) this.setCellFade(cell, next, t - 1);
        } else if (next === null && cell.fade !== 0) {
          cell.fade = 0;
          if (level >= 0) this.setCellFade(cell, level, 0);
        }
        // In a band the level that covers more of the pixels casts the shadow
        const caster = next !== null && next >= 0 && t >= 0.5 ? next : level;
        if (caster >= 0) {
          const shadow = cell.sphere.distanceToPoint(this.focus) < this.shadowRadius;
          const casts = b.entry.category !== 'plant' || b.entry.height > 0.8;
          for (let l = 0; l < cell.levels.length; l++) {
            for (const m of cell.levels[l]) {
              const on = l === caster && casts && shadow;
              if (m.castShadow === on) continue;
              m.castShadow = on;
              this.version++;
            }
          }
        }
      }
    }
    this.sortDue();
  }

  private addDue(batch: AssetBatch, cell: Cell, order: number): void {
    const slot = this.due[this.dueCount];
    if (slot) {
      slot.batch = batch;
      slot.cell = cell;
      slot.order = order;
    } else {
      this.due.push({ batch, cell, order });
    }
    this.dueCount++;
  }

  /** The due packed cells sorted, from where the last frame stopped round, until REPACK_PER_FRAME objects are */
  private sortDue(): void {
    const n = this.dueCount;
    this.repackDue = false;
    if (!n) return;
    let start = 0;
    while (start < n && this.due[start].order < this.repackFrom) start++;
    let budget = REPACK_PER_FRAME;
    for (let k = 0; k < n; k++) {
      const { batch, cell, order } = this.due[(start + k) % n];
      if (budget <= 0) {
        this.repackFrom = order;
        this.repackDue = true;
        return;
      }
      budget -= cell.indices.length;
      cell.packed!.at.copy(this.camPos);
      if (this.writePacked(batch, cell, cell.packed!)) this.version++;
    }
    this.repackFrom = 0;
  }

  /** Every instance of a cell's level at one dissolve */
  private setCellFade(cell: Cell, level: number, fade: number): void {
    (cell.fades[level].array as Float32Array).fill(fade);
    cell.fades[level].needsUpdate = true;
  }

  /**
   * Object i on the ground as it is now: only its height follows the ground
   * (its seat, writeInstance's), the matrix's translation and the sphere's
   * centre; turn, tilt and size are the document's. Whether it moved, so a
   * brush uploads only the objects whose ground changed, not every one in
   * its rectangle
   */
  private reseat(b: AssetBatch, i: number): boolean {
    const o = b.objects[i];
    if (this.sheared(b)) {
      // A wall that follows the slope takes its shear anew with its height
      const at = i * 16;
      const before = b.matrices.slice(at, at + 16);
      this.writeInstance(b, i);
      return before.some((v, k) => v !== b.matrices[at + k]);
    }
    const y = Math.fround(seatHeight(b.entry, o, this.seatGround, this.seatWater) + o.z);
    const at = i * 16 + 13;
    const lift = y - b.matrices[at];
    if (lift === 0) return false;
    b.matrices[at] = y;
    b.spheres[i * 4 + 1] += lift;
    return true;
  }

  /**
   * Whether an asset's objects follow the slope (wallShear): walls and fences that block no sight and carry no
   * tower; what the line of sight and the build rules see stays level
   */
  private sheared(b: AssetBatch): boolean {
    return b.entry.category === 'wall' && !b.blocksLos && !b.entry.roof;
  }

  /** Instance matrix, bounding sphere and colour of object i from the document */
  private writeInstance(b: AssetBatch, i: number): void {
    const o = b.objects[i];
    const e = b.entry;
    // Vegetation varies in size and shade, trees also in lean (instance-variation.ts): in the matrix and colour only
    const look = instanceVariation(o.id, e.category, e.tags);
    const s = (o.scale || 1) * look.size;
    const lean = this.sheared(b) ? wallShear(e, o, this.seatGround) : null;
    const ground = lean ? lean.height : seatHeight(e, o, this.seatGround, this.seatWater);
    mapToScene(o.x, o.y, ground + o.z, this.tmpPos);
    this.tmpQuat.setFromAxisAngle(this.up, o.rotation);
    if (o.pitch || o.roll) this.tmpQuat.multiply(this.tilt.setFromEuler(this.tiltEuler.set(o.pitch ?? 0, 0, o.roll ?? 0, 'XZY')));
    if (look.lean > 0) {
      // About a level axis across the lean's direction (scene x is map -x), in the scene's frame
      this.leanAxis.set(Math.sin(look.leanToward), 0, Math.cos(look.leanToward));
      this.tmpQuat.premultiply(this.tilt.setFromAxisAngle(this.leanAxis, look.lean));
    }
    this.tmpScale.setScalar(s);
    this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
    // Along a slope (wallShear): model y rises with model x, the posts stay upright
    if (lean) this.tmpMatrix.multiply(this.shear.set(1, 0, 0, 0, lean.shear, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1));
    this.tmpMatrix.toArray(b.matrices, i * 16);
    const radius = Math.max(e.footprint, b.model.height * 0.6) * s;
    b.spheres[i * 4] = this.tmpPos.x;
    b.spheres[i * 4 + 1] = this.tmpPos.y + (b.model.height * s) / 2;
    b.spheres[i * 4 + 2] = this.tmpPos.z;
    b.spheres[i * 4 + 3] = radius;
    if (b.colors) {
      const c = o.tint ? new Color(o.tint) : null;
      b.colors[i * 3] = (c?.r ?? 1) * look.r;
      b.colors[i * 3 + 1] = (c?.g ?? 1) * look.g;
      b.colors[i * 3 + 2] = (c?.b ?? 1) * look.b;
    }
  }

  /**
   * The material an object part is drawn with: a copy of the model's,
   * shared by every asset with the same source material and look. Adds
   * wind sway (wind > 0), the foliage card fixes (materials `foliage-*`:
   * authored normals on both sides, fade when edge-on and towards the draw
   * distance), flowing waterfall cards (`foliage-waterfall*`) and flicker
   * for flames (foliage cards that glow). The per-asset numbers are
   * uniforms, so all of them share a handful of shader programs.
   */
  /** The shadow pass's material for an asset's rotor parts, shared by assets turning as fast */
  private rotorShadow(entry: CatalogObject): Material {
    const period = Math.max(0.5, entry.rotor ?? DEFAULT_ROTOR);
    let m = this.rotorShadows.get(period);
    if (!m) this.rotorShadows.set(period, (m = rotorDepthMaterial({ value: period })));
    return m;
  }

  private objectMaterial(source: Material, entry: CatalogObject): Material {
    const m0 = source as MeshStandardMaterial;
    const card = m0.name.startsWith('foliage-');
    const waterfall = m0.name.startsWith('foliage-waterfall');
    const flame = card && !waterfall && !!m0.emissive && m0.emissive.getHex() !== 0;
    // Banner cloth waves where the map asks for it (cloth.ts, WIND_UNIFORMS.uClothWave)
    const cloth = isCloth(m0);
    // Parts that turn round the model's upright axis: a radar dish, a lighthouse's lens (catalogue `spin`)
    const spin = m0.name.startsWith('spin-');
    // Parts that turn round a hub of their own: a windmill's sails, a water wheel (rotor.ts, catalogue `rotor`)
    const rotor = isRotor(m0);
    const period = rotor ? (entry.rotor ?? DEFAULT_ROTOR) : (entry.spin ?? DEFAULT_SPIN);
    const wind = waterfall ? 0 : entry.wind;
    // Floating objects that are not moored structures rock on the water
    const bob = !!entry.float && entry.category !== 'structure';
    // Several looks in one atlas (a herd of several breeds): only for objects that stay where they are
    const variants = !card && !bob && (entry.variants ?? 1) > 1 ? entry.variants! : 1;
    const key = `${source.uuid}|${entry.grime ? 1 : 0}|${wind}|${wind > 0 ? entry.height : 0}|${card ? entry.drawDistance : 0}|${bob ? 1 : 0}|${cloth ? 1 : 0}|${spin || rotor ? period : 0}|${rotor ? 1 : 0}|${variants}`;
    const cached = this.materials.get(key);
    if (cached) return cached;
    // Always an own copy: the library's material is shared (other views, the editor's thumbnails)
    // and is never changed or disposed here. Copies of one source share its textures and programs
    const m = source.clone() as MeshStandardMaterial;
    if (!card && m.emissive) {
      // Glowing surfaces (lava, crystals, windows) stay under a cap: at night a full glow
      // reads as a flat bright disc instead of a lit surface
      const peak = Math.max(m.emissive.r, m.emissive.g, m.emissive.b) * m.emissiveIntensity;
      if (peak > MAX_EMISSIVE) m.emissiveIntensity *= MAX_EMISSIVE / peak;
    }
    if (!card && wind <= 0 && !bob && !spin && !rotor) {
      if (m.userData['roughMetal']) addVertexRoughMetal(m);
      if (entry.grime && m.aoMap) addGrime(m);
      if (variants > 1) addAtlasVariants(m, variants);
      addWindowGlow(m, source);
      addLodFade(m);
      addHeightFog(m);
      this.materials.set(key, m);
      return m;
    }
    const bias = this.detail.lodBias;
    const local = {
      // Sway at the top in a strong wind, and the height it is measured at (model metres)
      uWindBend: { value: windSwayAtTop(wind, entry.height) },
      uWindHeight: { value: Math.max(entry.height, 0.3) },
      uFadeRange: { value: new Vector2(entry.drawDistance * bias * 0.55, entry.drawDistance * bias) },
      // Seconds a turn of the spinning or rotor parts
      uSpinPeriod: { value: Math.max(0.5, period) },
    };
    if (card) this.fades.push({ range: local.uFadeRange.value, drawDistance: entry.drawDistance });
    const variant = `${wind > 0 ? 'w' : ''}${card ? 'c' : ''}${waterfall ? 'f' : ''}${flame ? 'l' : ''}${bob ? 'b' : ''}${cloth ? 'k' : ''}${spin ? 's' : ''}${rotor ? 'r' : ''}`;
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, WIND_UNIFORMS);
      shader.uniforms['uWindBend'] = local.uWindBend;
      shader.uniforms['uWindHeight'] = local.uWindHeight;
      shader.uniforms['uFadeRange'] = local.uFadeRange;
      shader.uniforms['uSpinPeriod'] = local.uSpinPeriod;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${WIND_GLSL}\nuniform float uWindBend;\nuniform float uWindHeight;`);
      if (wind > 0) {
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
          // The rest pose, for the shadow lookup below
          vec3 windRest = transformed;
          {
            // The wind's direction in model space: the instance's rotation and scale undone
            vec3 base = vec3(0.0);
            vec3 windDir = vec3(uWindDir.x, 0.0, uWindDir.y);
            #ifdef USE_INSTANCING
            base = instanceMatrix[3].xyz;
            windDir = normalize(transpose(mat3(instanceMatrix)) * windDir);
            #endif
            vec3 acrossDir = normalize(cross(vec3(0.0, 1.0, 0.0), windDir) + vec3(1e-5, 0.0, 0.0));
            float phase = dot(base.xz, vec2(0.071, 0.093));
            // The push at the plant: steady wind, swell and the gust fronts that cross the map (windPush)
            float push = windPush(base.xz);
            float t = uWindTime;
            float hn = clamp(transformed.y / uWindHeight, 0.0, 1.3);
            // A plant swings slower the taller it is (an 8 m tree about once in four seconds), so a wood does not
            // tremble at one quick beat
            float w = 1.6 * sqrt(8.0 / max(uWindHeight, 0.5));
            // Trunk and crown as one: a stiff trunk (bending with the square of the height) leans with the push
            // and swings slowly round that lean, a little across it too
            float sway = sin(t * w + phase) * 0.6 + sin(t * w * 1.63 + phase * 1.7) * 0.22;
            vec3 off = (windDir * (0.75 * push + 0.3 * sway * (0.3 + push)) + acrossDir * sin(t * w * 0.77 + phase * 1.3) * 0.12 * (0.3 + push))
              * uWindBend * 0.4 * hn * hn;
            // Branches: away from the trunk they bend a little more and bob on their own, slowly; each bough
            // moves as one (the phase changes over a few metres, not from vertex to vertex)
            float reach = length(transformed.xz) / uWindHeight;
            float branch = smoothstep(0.06, 0.35, reach) * smoothstep(0.15, 0.5, hn);
            float bp = dot(transformed, vec3(0.37, 0.29, 0.41)) * 2.6 / uWindHeight + phase;
            float beat = sin(t * w * 1.9 + bp) * 0.75 + sin(t * w * 3.1 + bp * 1.4) * 0.25;
            off += (windDir * (0.3 * push + 0.12 * beat * (0.2 + push)) + vec3(0.0, 0.1 * beat * (0.2 + push), 0.0)) * uWindBend * 0.4 * branch;
            ${card ? `// Leaf cards flutter, each card as a whole (the phase over half a metre), quick and small
            vec3 flutter = sin(t * vec3(4.3, 5.1, 3.7) + transformed * 1.3 + phase);
            off += flutter * 0.03 * (0.2 + push) * smoothstep(0.1, 0.4, hn) * min(uWindBend * 4.0, 1.0);` : ''}
            // The player's plant motion: still, calmer or as the wind takes them
            off *= uPlantSway;
            // Bent, not stretched: what moves sideways sinks a little
            off.y -= dot(off.xz, off.xz) / (2.0 * max(transformed.y, 0.5));
            transformed += off;
          }`,
        );
        // The sun's shadow map holds the plants at rest (three's depth material has no sway, and the map is
        // cached over frames): a swaying leaf looked it up where it had moved to and slid in and out of its own
        // crown's shadow, the canopy flickered. It reads the shadow at its rest pose, so the shading rides along
        shader.vertexShader = shader.vertexShader.replace(
          '#include <shadowmap_vertex>',
          /* glsl */ `#ifdef USE_SHADOWMAP
          vec4 windSwayed = worldPosition;
          worldPosition = vec4(windRest, 1.0);
          #ifdef USE_INSTANCING
          worldPosition = instanceMatrix * worldPosition;
          #endif
          worldPosition = modelMatrix * worldPosition;
          #endif
          #include <shadowmap_vertex>
          #ifdef USE_SHADOWMAP
          worldPosition = windSwayed;
          #endif`,
        );
      }
      if (bob) {
        // Rocking on the water: a slow heave, roll and pitch, each object with its own phase
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
          {
            float phase = 0.0;
            #ifdef USE_INSTANCING
            phase = dot(instanceMatrix[3].xz, vec2(0.13, 0.17));
            #endif
            float t = uWindTime;
            float heave = sin(t * 0.9 + phase) * 0.06;
            float roll = sin(t * 0.7 + phase * 1.3) * 0.035;
            float pitch = sin(t * 0.55 + phase * 0.7) * 0.025;
            transformed.y += heave + transformed.x * roll + transformed.z * pitch;
          }`,
        );
      }
      if (spin) {
        // Turning round the model's upright axis, each object at its own angle (spinAngle): the shape and its normals
        const angle = `float spinPhase = 0.0;
            #ifdef USE_INSTANCING
            spinPhase = spinAngle(instanceMatrix[3].xz);
            #endif
            float spinA = uWindTime * 6.2831853 / uSpinPeriod + spinPhase;
            mat2 spinTurn = mat2(cos(spinA), sin(spinA), -sin(spinA), cos(spinA));`;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>
uniform float uSpinPeriod;
${SPIN_GLSL}`)
          .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
{
${angle}
objectNormal.xz = spinTurn * objectNormal.xz;
}`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
{
${angle}
transformed.xz = spinTurn * transformed.xz;
}`);
      }
      if (rotor) addRotorTurn(shader, local.uSpinPeriod);
      if (cloth) {
        // The cloth ripples down from where it is fastened, more at its free end, and blows out with the wind
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aHang;\nuniform float uClothWave;')
          .replace(
            '#include <begin_vertex>',
            /* glsl */ `#include <begin_vertex>
          {
            vec3 clothBase = vec3(0.0);
            vec3 clothWind = vec3(uWindDir.x, 0.0, uWindDir.y);
            #ifdef USE_INSTANCING
            clothBase = instanceMatrix[3].xyz;
            clothWind = normalize(transpose(mat3(instanceMatrix)) * clothWind);
            #endif
            float clothPhase = dot(clothBase.xz, vec2(0.071, 0.093));
            float clothPush = windPush(clothBase.xz);
            float ripple = sin(transformed.y * 2.6 - uWindTime * (3.0 + 2.0 * clothPush) + clothPhase) * 0.65
              + sin(transformed.x * 4.0 - uWindTime * 4.6 + clothPhase * 1.7) * 0.35;
            float clothOn = uClothWave * uPlantSway;
            transformed.z += ripple * aHang * (0.05 + 0.2 * clothPush) * clothOn;
            transformed += clothWind * aHang * aHang * 0.35 * clothPush * clothOn;
          }`,
          );
      }
      if (waterfall) {
        // Water runs down the card: scroll the texture
        shader.vertexShader = shader.vertexShader.replace(
          '#include <uv_vertex>',
          '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv.y += uWindTime * 0.6;\n#endif',
        );
      }
      if (card) {
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec2 uFadeRange;\nuniform float uWindTime;')
          // Card normals are authored (bent out of the crown, up for grass); three flips them on
          // back faces of double-sided materials, which turned every card's back black
          .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
          .replace(
            '#include <alphatest_fragment>',
            /* glsl */ `{
            // Cards seen edge-on smear their texture into streaks: fade them out by the flat face normal
            vec3 faceNormal = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
            float facing = abs(dot(faceNormal, normalize(vViewPosition)));
            diffuseColor.a *= smoothstep(0.08, 0.3, facing);
            // Fade out towards the draw distance: thin far cards turn into dark lines otherwise
            diffuseColor.a *= 1.0 - smoothstep(uFadeRange.x, uFadeRange.y, length(vViewPosition));
          }
          #include <alphatest_fragment>`,
          );
        if (flame) {
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <emissivemap_fragment>',
            /* glsl */ `#include <emissivemap_fragment>
            totalEmissiveRadiance *= 0.75 + 0.18 * sin(uWindTime * 11.0 + vViewPosition.x * 3.0) + 0.1 * sin(uWindTime * 23.0 + vViewPosition.y * 5.0);`,
          );
        }
      }
    };
    m.customProgramCacheKey = () => `custom-map-object-${variant}`;
    if (m.userData['roughMetal']) addVertexRoughMetal(m);
    if (variants > 1) addAtlasVariants(m, variants);
    // Window glass on parts that move lights up at night as well (a ship rocking on the water, a turning part)
    if (!card) addWindowGlow(m, source);
    addLodFade(m);
    addHeightFog(m);
    this.materials.set(key, m);
    return m;
  }
}

/**
 * Weathering baked into a model's occlusion texture (catalogue `grime`,
 * blender_kit.bake_ao): dirt from the ground, streaks under the sills, dirt
 * in the hollows. The occlusion darkens the colour in direct light as well,
 * part way, so the weathering shows in the sun; the tiled surfaces stay
 * sharp, no texture or draw call more
 */
function addGrime(m: Material): void {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (shader, renderer) => {
    prev.call(m, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      #ifdef USE_AOMAP
      diffuseColor.rgb *= mix(1.0, texture2D(aoMap, vAoMapUv).r, 0.55);
      #endif`,
    );
  };
  m.customProgramCacheKey = () => `${prevKey.call(m)}-grime`;
}

/** Window glass glows at night (night-windows.ts): a merged part per vertex, a glass material all over */
function addWindowGlow(m: Material, source: Material): void {
  if (m.userData['nightGlow']) addNightWindows(m, true);
  else if (isWindowGlass(source.name)) addNightWindows(m, false);
}

const merged = new WeakMap<ObjectModel, ModelPart[]>();

/**
 * A model's parts with the plain-coloured ones merged (merge-parts.ts), banner cloth cut to wave (cloth.ts) and
 * rotor parts told their hub (rotor.ts), once per model
 */
function mergedParts(model: ObjectModel): ModelPart[] {
  let parts = merged.get(model);
  if (!parts) {
    parts = mergeParts(model.parts).map((p) => (isCloth(p.material) ? { geometry: clothGeometry(p.geometry), material: p.material } : p));
    // Rotor parts learn their shared hub and axle (rotor.ts)
    const rotors = parts.filter((p) => isRotor(p.material));
    if (rotors.length) {
      const hub = rotorHub(rotors.map((p) => p.geometry));
      parts = parts.map((p) => (isRotor(p.material) ? { geometry: rotorGeometry(p.geometry, hub), material: p.material } : p));
    }
    merged.set(model, parts);
  }
  return parts;
}

/** `a`, or a copy with room for `length` values (the old ones kept) */
function grow(a: Float32Array, length: number): Float32Array {
  if (a.length >= length) return a;
  const out = new Float32Array(Math.max(length, Math.ceil(a.length * 1.5)));
  out.set(a);
  return out;
}

const entryMaps = new WeakMap<AssetCatalog, Map<string, CatalogObject>>();

/** The catalogue's objects by id, built once per catalogue */
function entriesOf(catalog: AssetCatalog): Map<string, CatalogObject> {
  let map = entryMaps.get(catalog);
  if (!map) entryMaps.set(catalog, (map = new Map(catalog.objects.map((e) => [e.id, e]))));
  return map;
}
