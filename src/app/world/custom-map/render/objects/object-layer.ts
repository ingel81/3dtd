import {
  Color,
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
import type { CatalogObject } from '../asset-catalog';
import type { HeightField } from '../height-field';
import type { MapAssetLibrary, ObjectModel } from '../map-asset-library';
import { addHeightFog } from '../environment/height-fog';
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
/** Height (metres) at which a model of wind strength 1 sways by 1 m */
const WIND_REFERENCE_HEIGHT = 18;
/** Strongest glow of an object surface (emissive colour times intensity, linear) */
const MAX_EMISSIVE = 0.55;

interface Level {
  from: number;
  parts: { geometry: BufferGeometry; material: Material }[];
}

interface Cell {
  /** Object indices of the batch in this cell */
  indices: number[];
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
  private readonly objectUniforms = { uWindTime: { value: 0 } };
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
  private readonly sphere = new Sphere();
  /** Cells within this distance of the focus cast shadows */
  shadowRadius = 400;

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
      const entry = catalog.objects.find((e) => e.id === o.asset);
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
   * Moves, turns or scales one object in place. Returns false when the
   * object is unknown, changed its asset or LOS flag, or left its cell; the
   * caller then calls `setObjects`.
   */
  updateObject(o: MapObject): boolean {
    const slot = this.byId.get(o.id);
    if (!slot) return false;
    const b = slot.batch;
    const blocks = o.blocksLos ?? b.entry.blocksLos;
    if (o.asset !== b.objects[slot.index].asset || blocks !== b.blocksLos) return false;
    if (this.cellKey(o.x, o.y) !== b.slots[slot.index].cell) return false;
    b.objects[slot.index] = o;
    this.writeInstance(b, slot.index);
    this.uploadInstances(b, [slot.index], true);
    return true;
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
      for (let i = 0; i < b.objects.length; i++) {
        const o = b.objects[i];
        if (rect && (o.x < rect.minX - reach || o.x > rect.maxX + reach || o.y < rect.minY - reach || o.y > rect.maxY + reach)) {
          continue;
        }
        this.writeInstance(b, i);
        changed.push(i);
      }
      if (changed.length) this.uploadInstances(b, changed, !!rect);
    }
  }

  /** Wind time, detail level and draw distance per cell, shadows near `focus` (group space) */
  update(dt: number, camera: Camera, focus?: Vector3): void {
    this.objectUniforms.uWindTime.value += dt;
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

  /** First object a scene-space ray hits */
  raycast(ray: Ray): ObjectHit | null {
    const raycaster = new Raycaster(ray.origin, ray.direction);
    const meshes: InstancedMesh[] = [];
    for (const b of this.batches) for (const c of b.cells.values()) meshes.push(...c.levels[0]);
    const hits = raycaster.intersectObjects(meshes, false);
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
    for (const imp of this.impostors.values()) imp?.dispose();
    this.impostors.clear();
    this.group.removeFromParent();
  }

  private clear(): void {
    for (const b of this.batches) {
      for (const c of b.cells.values()) {
        for (const meshes of c.levels) {
          for (const m of meshes) {
            m.removeFromParent();
            m.dispose();
          }
        }
      }
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
        // Beyond the game camera's usual distance (200 to 300 m), where a tree is a few pixels wide
        const from = Math.max(lods.length ? lods[lods.length - 1].distance * 1.5 : 0, 380, entry.height * 25);
        levels.push({ from, parts: [{ geometry: imp.geometry, material: imp.material }] });
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
    // Objects into cells
    const lists = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const key = this.cellKey(objects[i].x, objects[i].y);
      let list = lists.get(key);
      if (!list) lists.set(key, (list = []));
      b.slots[i] = { cell: key, slot: list.length };
      list.push(i);
    }
    const parent = blocksLos ? this.losGroup : this.group;
    for (const [key, indices] of lists) {
      const cell: Cell = { indices, levels: [], sphere: new Sphere(), level: -1 };
      for (const [li, level] of b.levels.entries()) {
        const meshes: InstancedMesh[] = [];
        for (const part of level.parts) {
          const mesh = new InstancedMesh(part.geometry, part.material, indices.length);
          mesh.name = `${entry.id}${blocksLos ? '' : '-decor'}${li ? `-lod${li}` : ''}`;
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
          if (!blocksLos) mesh.userData['losTransparent'] = true;
          parent.add(mesh);
          meshes.push(mesh);
        }
        cell.levels.push(meshes);
      }
      this.cellBounds(b, cell);
      b.cells.set(key, cell);
    }
    return b;
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
    for (const cell of touched) {
      this.cellBounds(b, cell);
      for (const meshes of cell.levels) for (const m of meshes) m.computeBoundingSphere();
    }
  }

  /** Per cell: the level for its distance, hidden beyond the draw distance, shadows only near the focus */
  private applyLevels(force: boolean): void {
    for (const b of this.batches) {
      const draw = b.entry.drawDistance;
      for (const cell of b.cells.values()) {
        const d = Math.max(0, cell.sphere.distanceToPoint(this.camPos));
        let level = -1;
        if (d <= draw) {
          level = 0;
          for (let l = b.levels.length - 1; l > 0; l--) {
            if (d >= b.levels[l].from) {
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
        }
        if (level >= 0) {
          const shadow = cell.sphere.distanceToPoint(this.focus) < this.shadowRadius;
          const casts = b.entry.category !== 'plant' || b.entry.height > 0.8;
          for (const m of cell.levels[level]) m.castShadow = casts && shadow;
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
    const key = `${source.uuid}|${wind}|${card ? entry.drawDistance : 0}|${bob ? 1 : 0}`;
    const cached = this.materials.get(key);
    if (cached) return cached;
    if (!card && m0.emissive) {
      // Glowing surfaces (lava, crystals, windows) stay under a cap: at night a full glow
      // reads as a flat bright disc instead of a lit surface
      const peak = Math.max(m0.emissive.r, m0.emissive.g, m0.emissive.b) * m0.emissiveIntensity;
      if (peak > MAX_EMISSIVE) m0.emissiveIntensity *= MAX_EMISSIVE / peak;
    }
    if (!card && wind <= 0 && !bob) {
      addHeightFog(source);
      this.materials.set(key, source);
      return source;
    }
    const m = source.clone() as MeshStandardMaterial;
    const local = {
      uWindStrength: { value: wind / WIND_REFERENCE_HEIGHT },
      uFadeRange: { value: new Vector2(entry.drawDistance * 0.55, entry.drawDistance) },
    };
    const shared = this.objectUniforms;
    const variant = `${wind > 0 ? 'w' : ''}${card ? 'c' : ''}${waterfall ? 'f' : ''}${flame ? 'l' : ''}${bob ? 'b' : ''}`;
    m.onBeforeCompile = (shader) => {
      shader.uniforms['uWindTime'] = shared.uWindTime;
      shader.uniforms['uWindStrength'] = local.uWindStrength;
      shader.uniforms['uFadeRange'] = local.uFadeRange;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWindTime;\nuniform float uWindStrength;');
      if (wind > 0) {
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
          {
            float phase = 0.0;
            #ifdef USE_INSTANCING
            phase = dot(instanceMatrix[3].xz, vec2(0.071, 0.093));
            #endif
            float h = max(transformed.y, 0.0);
            float bend = h * h * uWindStrength;
            float t = uWindTime;
            float gust = sin(t * 0.7 + phase * 0.5) * 0.5 + 0.5;
            float swayX = (sin(t * 1.4 + phase) * 0.7 + sin(t * 2.9 + phase * 1.7) * 0.3) * (0.6 + gust * 0.6);
            float swayZ = sin(t * 1.1 + phase * 1.3) * 0.5;
            // Leaves flutter a little on their own
            float flutter = sin(t * 7.0 + dot(transformed, vec3(3.1, 2.3, 4.7))) * 0.03 * min(h, 3.0) / 3.0;
            transformed.x += swayX * bend + flutter;
            transformed.z += swayZ * bend * 0.6 + flutter;
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
