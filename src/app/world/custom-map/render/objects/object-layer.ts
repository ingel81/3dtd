import {
  Color,
  Euler,
  Group,
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
  type MeshStandardMaterial,
  type WebGLRenderer,
} from 'three';
import type { MapObject } from '../../map-document';
import type { AssetCatalog, CatalogObject } from '../asset-catalog';
import type { HeightField } from '../height-field';
import type { MapAssetLibrary, ObjectModel } from '../map-asset-library';
import { addHeightFog } from '../environment/height-fog';
import { WIND_GLSL, WIND_UNIFORMS, windSwayAtTop } from '../environment/wind';
import { mapToScene } from '../map-coords';
import { bakeImpostor, type Impostor } from './impostor';

/**
 * The placed objects of a map, drawn instanced and split into square cells
 * of the map (CELL_SIZE): per asset, cell and detail level one InstancedMesh
 * per model part, each with tight bounds. three's frustum culling then drops
 * whole cells for the camera, the sun's shadow and the LOS cube alike, and
 * nothing is repacked per frame:
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
 * and hue per instance, so a forest of one model does not look cloned.
 */

/** Edge of an object cell in metres */
export const CELL_SIZE = 192;
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
  parts: { geometry: BufferGeometry; material: Material }[];
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
  sphere: Sphere;
  level: number;
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
  /** Renderer for baking tree impostors; without one far trees keep their model */
  renderer?: WebGLRenderer;
  /** Level of the water at a map point, null on dry ground (floating objects) */
  waterLevelAt?: (x: number, y: number) => number | null;
}

export class MapObjectLayer {
  /** Non-blocking objects; blocking ones are added to the LOS group given to the constructor */
  readonly group = new Group();
  private batches: AssetBatch[] = [];
  private readonly byId = new Map<string, { batch: AssetBatch; index: number }>();
  private readonly materials = new Map<string, Material>();
  private readonly impostors = new Map<string, Impostor | null>();
  private generation = 0;
  private readonly camPos = new Vector3();
  private readonly focus = new Vector3();
  private readonly tmpMatrix = new Matrix4();
  private readonly tmpPos = new Vector3();
  private readonly tmpQuat = new Quaternion();
  private readonly tmpScale = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
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

  constructor(
    private readonly field: HeightField,
    private readonly assets: MapAssetLibrary,
    private readonly losGroup: Group,
    private readonly options: ObjectLayerOptions = {},
  ) {
    this.group.name = 'custom-map-objects';
    this.group.userData['losTransparent'] = true;
  }

  /** Replaces every object; resolves when the models are in */
  async setObjects(objects: MapObject[]): Promise<void> {
    const generation = ++this.generation;
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
    const built: AssetBatch[] = [];
    for (const [key, list] of groups) {
      const [model, lods] = await Promise.all([this.assets.model(list[0].asset), this.assets.lodModels(list[0].asset)]);
      if (generation !== this.generation) return;
      built.push(this.buildBatch(model, lods, key.endsWith('|1'), list));
    }
    if (generation !== this.generation) return;
    this.clear();
    this.batches = built;
    for (const b of built) b.objects.forEach((o, index) => this.byId.set(o.id, { batch: b, index }));
    this.applyLevels(true);
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
      if (!slot || !b) {
        rest.push(o);
        continue;
      }
      const blocks = o.blocksLos ?? b.entry.blocksLos;
      if (o.asset !== b.objects[slot.index].asset || blocks !== b.blocksLos || this.cellKey(o.x, o.y) !== b.slots[slot.index].cell) {
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
        const [model, lods] = await Promise.all([this.assets.model(list[0].asset), this.assets.lodModels(list[0].asset)]);
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
      if (newColors) {
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
   * last instance fills its slot), a cell that empties goes
   */
  removeObjects(ids: string[]): void {
    for (const id of ids) {
      const slot = this.byId.get(id);
      if (!slot) continue;
      const b = slot.batch;
      const i = slot.index;
      this.byId.delete(id);
      this.takeFromCell(b, i);
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
    for (const b of this.batches) {
      if (floatingOnly && !b.entry.float) continue;
      const reach = b.entry.footprint * 3 + 2;
      const changed: number[] = [];
      const visit = (i: number): void => {
        const o = b.objects[i];
        if (rect && (o.x < rect.minX - reach || o.x > rect.maxX + reach || o.y < rect.minY - reach || o.y > rect.maxY + reach)) {
          return;
        }
        this.writeInstance(b, i);
        changed.push(i);
      };
      if (rect) {
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
  update(_dt: number, camera: Camera, focus?: Vector3): void {
    camera.getWorldPosition(this.camPos);
    this.group.worldToLocal(this.camPos);
    this.focus.copy(focus ?? this.camPos);
    this.applyLevels(false);
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
      const vegetation = model.entry.category === 'tree' || model.entry.category === 'plant';
      for (const level of this.levelsFor(model, lods)) {
        for (const part of level.parts) {
          // Vegetation always has instance colours; other assets only when tinted, so both variants
          for (const colored of vegetation ? [true] : [false, true]) {
            const mesh = new InstancedMesh(part.geometry, part.material, 1);
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
    for (const b of this.batches) for (const c of b.cells.values()) for (const m of c.levels[0]) meshes.push(m);
    const hits = this.raycaster.intersectObjects(meshes, false);
    meshes.length = 0;
    for (const hit of hits) {
      const mesh = hit.object as InstancedMesh;
      const batch = mesh.userData['batch'] as AssetBatch | undefined;
      const cell = mesh.userData['cell'] as Cell | undefined;
      if (!batch || !cell || hit.instanceId === undefined) continue;
      return { object: batch.objects[cell.indices[hit.instanceId]], point: hit.point, distance: hit.distance };
    }
    return null;
  }

  dispose(): void {
    this.generation++;
    this.clear();
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
    this.fades.length = 0;
    for (const imp of this.impostors.values()) imp?.dispose();
    this.impostors.clear();
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

  /** Detail levels of an asset: its model, the catalogue's LOD models, an impostor for far trees */
  private levelsFor(model: ObjectModel, lods: { model: ObjectModel; distance: number }[]): Level[] {
    const entry = model.entry;
    const levels: Level[] = [{ from: 0, parts: model.parts.map((p) => ({ geometry: p.geometry, material: this.objectMaterial(p.material, entry) })) }];
    for (const lod of lods) {
      levels.push({ from: lod.distance, parts: lod.model.parts.map((p) => ({ geometry: p.geometry, material: this.objectMaterial(p.material, entry) })) });
    }
    // Trees and big rocks (buildings get hand-made far models through the catalogue's lod)
    const impostor = entry.category === 'tree' || (entry.category === 'rock' && entry.height >= 1.5);
    if (impostor && this.options.renderer && !model.placeholder) {
      let imp = this.impostors.get(entry.id);
      if (imp === undefined) {
        imp = bakeImpostor(this.options.renderer, model);
        if (imp) addHeightFog(imp.material);
        this.impostors.set(entry.id, imp);
      }
      if (imp) {
        // Beyond the game camera's usual distance (200 to 300 m, impostorFrom in High), where a tree is a few pixels wide
        const from = Math.max(lods.length ? lods[lods.length - 1].distance * 1.5 : 0, entry.height * 25);
        levels.push({ from, impostor: true, parts: [{ geometry: imp.geometry, material: imp.material }] });
      }
    }
    return levels;
  }

  private buildBatch(model: ObjectModel, lods: { model: ObjectModel; distance: number }[], blocksLos: boolean, objects: MapObject[]): AssetBatch {
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

  /** Sorts the batch's objects into cells and builds every cell's meshes anew */
  private layoutCells(b: AssetBatch): void {
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
    m.instanceMatrix.addUpdateRange(slot * 16, 16);
    m.instanceMatrix.needsUpdate = true;
    const colors = m.instanceColor;
    if (b.colors && colors) {
      (colors.array as Float32Array).set(b.colors.subarray(i * 3, i * 3 + 3), slot * 3);
      colors.addUpdateRange(slot * 3, 3);
      colors.needsUpdate = true;
    }
  }

  private buildCell(b: AssetBatch, indices: number[]): Cell {
    const entry = b.entry;
    const parent = b.blocksLos ? this.losGroup : this.group;
    const capacity = cellCapacity(indices.length);
    const cell: Cell = { indices, capacity, levels: [], sphere: new Sphere(), level: -1 };
    for (const [li, level] of b.levels.entries()) {
      const meshes: InstancedMesh[] = [];
      for (const part of level.parts) {
        const mesh = new InstancedMesh(part.geometry, part.material, capacity);
        mesh.count = indices.length;
        mesh.name = `${entry.id}${b.blocksLos ? '' : '-decor'}${li ? `-lod${li}` : ''}`;
        const arr = mesh.instanceMatrix.array as Float32Array;
        indices.forEach((i, k) => arr.set(b.matrices.subarray(i * 16, i * 16 + 16), k * 16));
        if (b.colors) {
          const c = new Color();
          indices.forEach((i, k) => mesh.setColorAt(k, c.setRGB(b.colors![i * 3], b.colors![i * 3 + 1], b.colors![i * 3 + 2])));
        }
        mesh.castShadow = entry.category !== 'plant' || entry.height > 0.8;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.visible = false;
        mesh.computeBoundingSphere();
        mesh.userData['batch'] = b;
        mesh.userData['cell'] = cell;
        if (!b.blocksLos) mesh.userData['losTransparent'] = true;
        parent.add(mesh);
        meshes.push(mesh);
      }
      cell.levels.push(meshes);
    }
    this.cellBounds(b, cell);
    return cell;
  }

  private disposeCell(cell: Cell): void {
    for (const meshes of cell.levels) {
      for (const m of meshes) {
        m.removeFromParent();
        m.dispose();
      }
    }
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
      for (const meshes of cell.levels) {
        for (const m of meshes) {
          (m.instanceMatrix.array as Float32Array).set(b.matrices.subarray(i * 16, i * 16 + 16), slot * 16);
          if (ranged) m.instanceMatrix.addUpdateRange(slot * 16, 16);
          m.instanceMatrix.needsUpdate = true;
        }
      }
    }
    for (const cell of touched) this.cellBounds(b, cell);
    // A few changed (a brush): the mesh spheres grow by them; many: computed anew
    if (ranged && changed.length < 64) {
      for (const i of changed) {
        const { cell: key, slot } = b.slots[i];
        const cell = b.cells.get(key);
        if (cell) for (const meshes of cell.levels) for (const m of meshes) this.growBounds(m, slot);
      }
    } else {
      for (const cell of touched) for (const meshes of cell.levels) for (const m of meshes) m.computeBoundingSphere();
    }
  }

  /** The quality level's detail (see `detail`); every cell takes its level again */
  setDetail(detail: { lodBias: number; impostorFrom: number }): void {
    if (detail.lodBias === this.detail.lodBias && detail.impostorFrom === this.detail.impostorFrom) return;
    this.detail = { ...detail };
    for (const f of this.fades) f.range.set(f.drawDistance * detail.lodBias * 0.55, f.drawDistance * detail.lodBias);
    this.applyLevels(true);
  }

  /** Per cell: the level for its distance, hidden beyond the draw distance, shadows only near the focus */
  private applyLevels(force: boolean): void {
    if (force) this.version++;
    const { lodBias, impostorFrom } = this.detail;
    for (const b of this.batches) {
      const draw = b.blocksLos ? b.entry.drawDistance : b.entry.drawDistance * lodBias;
      for (const cell of b.cells.values()) {
        const d = Math.max(0, cell.sphere.distanceToPoint(this.camPos));
        let level = -1;
        if (d <= draw) {
          level = 0;
          for (let l = b.levels.length - 1; l > 0; l--) {
            const at = b.levels[l];
            if (d >= (at.impostor ? Math.max(at.from, impostorFrom) : at.from * lodBias)) {
              level = l;
              break;
            }
          }
        }
        if (level !== cell.level || force) {
          cell.levels.forEach((meshes, l) => {
            for (const m of meshes) {
              m.visible = l === level;
              m.frustumCulled = true;
            }
          });
          cell.level = level;
          this.version++;
        }
        if (level >= 0) {
          const shadow = cell.sphere.distanceToPoint(this.focus) < this.shadowRadius;
          const casts = b.entry.category !== 'plant' || b.entry.height > 0.8;
          for (const m of cell.levels[level]) {
            if (m.castShadow === (casts && shadow)) continue;
            m.castShadow = casts && shadow;
            this.version++;
          }
        }
      }
    }
  }

  /** Instance matrix, bounding sphere and colour of object i from the document */
  private writeInstance(b: AssetBatch, i: number): void {
    const o = b.objects[i];
    const e = b.entry;
    const s = o.scale || 1;
    let ground = this.field.heightAt(o.x, o.y);
    if (e.float) {
      // The waterline at the water's level; on dry ground on the terrain
      ground = this.options.waterLevelAt?.(o.x, o.y) ?? ground;
    } else if (e.category === 'building' || e.category === 'wall' || e.category === 'prop') {
      // Eight points on the footprint circle, so a turned house finds its lowest corner too;
      // the models' foundations reach below 0 and fill the gap on the uphill side
      const r = e.footprint * s;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        ground = Math.min(ground, this.field.heightAt(o.x + Math.cos(a) * r, o.y + Math.sin(a) * r));
      }
    } else if (e.category === 'tree') {
      ground -= 0.15 * s;
    }
    mapToScene(o.x, o.y, ground + o.z, this.tmpPos);
    this.tmpQuat.setFromAxisAngle(this.up, o.rotation);
    if (o.pitch || o.roll) this.tmpQuat.multiply(this.tilt.setFromEuler(this.tiltEuler.set(o.pitch ?? 0, 0, o.roll ?? 0, 'XZY')));
    this.tmpScale.setScalar(s);
    this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
    this.tmpMatrix.toArray(b.matrices, i * 16);
    const radius = Math.max(e.footprint, b.model.height * 0.6) * s;
    b.spheres[i * 4] = this.tmpPos.x;
    b.spheres[i * 4 + 1] = this.tmpPos.y + (b.model.height * s) / 2;
    b.spheres[i * 4 + 2] = this.tmpPos.z;
    b.spheres[i * 4 + 3] = radius;
    if (b.colors) {
      const c = o.tint ? new Color(o.tint) : null;
      // Hash of the id: the same object keeps its shade across rebuilds
      let h = 2166136261;
      for (let k = 0; k < o.id.length; k++) h = Math.imul(h ^ o.id.charCodeAt(k), 16777619);
      const r1 = ((h >>> 0) % 1000) / 1000;
      const r2 = ((h >>> 10) % 1000) / 1000;
      const r3 = ((h >>> 20) % 1000) / 1000;
      // Brightness, then a hue drift: some crowns yellower, some bluer, a few turning early
      const v = 0.8 + r1 * 0.32;
      const turning = b.entry.category === 'tree' && r3 > 0.93 ? 1 : 0;
      b.colors[i * 3] = (c?.r ?? 1) * v * (0.92 + r2 * 0.16 + turning * 0.25);
      b.colors[i * 3 + 1] = (c?.g ?? 1) * v * (0.96 + r3 * 0.06);
      b.colors[i * 3 + 2] = (c?.b ?? 1) * v * (1.06 - r2 * 0.2 - turning * 0.2);
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
  private objectMaterial(source: Material, entry: CatalogObject): Material {
    const m0 = source as MeshStandardMaterial;
    const card = m0.name.startsWith('foliage-');
    const waterfall = m0.name.startsWith('foliage-waterfall');
    const flame = card && !waterfall && !!m0.emissive && m0.emissive.getHex() !== 0;
    const wind = waterfall ? 0 : entry.wind;
    // Floating objects that are not moored structures rock on the water
    const bob = !!entry.float && entry.category !== 'structure';
    const key = `${source.uuid}|${wind}|${wind > 0 ? entry.height : 0}|${card ? entry.drawDistance : 0}|${bob ? 1 : 0}`;
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
    if (!card && wind <= 0 && !bob) {
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
    };
    if (card) this.fades.push({ range: local.uFadeRange.value, drawDistance: entry.drawDistance });
    const variant = `${wind > 0 ? 'w' : ''}${card ? 'c' : ''}${waterfall ? 'f' : ''}${flame ? 'l' : ''}${bob ? 'b' : ''}`;
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, WIND_UNIFORMS);
      shader.uniforms['uWindBend'] = local.uWindBend;
      shader.uniforms['uWindHeight'] = local.uWindHeight;
      shader.uniforms['uFadeRange'] = local.uFadeRange;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${WIND_GLSL}\nuniform float uWindBend;\nuniform float uWindHeight;`);
      if (wind > 0) {
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
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
            float push = windPush(base.xz);
            float t = uWindTime;
            float hn = clamp(transformed.y / uWindHeight, 0.0, 1.3);
            // Trunk: nearly rigid, leans with the push, rocks a little along and across it
            float rock = sin(t * 1.3 + phase) * 0.6 + sin(t * 2.3 + phase * 1.7) * 0.25;
            vec3 off = (windDir * (0.7 * push + 0.2 * rock * (0.3 + push)) + acrossDir * sin(t * 0.9 + phase * 1.3) * 0.1 * (0.3 + push))
              * uWindBend * 0.4 * hn * hn;
            // Branches: away from the trunk, each part of the crown on its own beat, along the wind and up and down
            float reach = length(transformed.xz) / uWindHeight;
            float branch = smoothstep(0.04, 0.3, reach) * smoothstep(0.1, 0.45, hn);
            float bp = dot(transformed, vec3(0.37, 0.29, 0.41)) * 9.0 / uWindHeight + phase;
            float beat = sin(t * 2.1 + bp) * 0.7 + sin(t * 3.7 + bp * 1.3) * 0.3;
            off += (windDir * (0.45 * push + 0.4 * beat * (0.25 + push)) + vec3(0.0, 0.3 * beat * (0.25 + push), 0.0)) * uWindBend * 0.4 * branch;
            // Leaves flutter on their own, quick and small
            vec3 flutter = sin(t * vec3(8.3, 9.1, 7.4) + transformed * vec3(3.1, 2.3, 4.7));
            off += flutter * ${card ? '0.05' : '0.012'} * (0.2 + push) * smoothstep(0.05, 0.3, hn) * min(uWindBend * 4.0, 1.0);
            // Bent, not stretched: what moves sideways sinks a little
            off.y -= dot(off.xz, off.xz) / (2.0 * max(transformed.y, 0.5));
            transformed += off;
          }`,
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
    addHeightFog(m);
    this.materials.set(key, m);
    return m;
  }
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
