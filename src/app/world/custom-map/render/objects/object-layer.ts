import {
  Color,
  Frustum,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Ray,
  Raycaster,
  Sphere,
  Vector3,
  type Camera,
  type Material,
  type MeshStandardMaterial,
} from 'three';
import type { MapObject } from '../../map-document';
import type { CatalogObject } from '../asset-catalog';
import type { HeightField } from '../height-field';
import type { MapAssetLibrary, ObjectModel } from '../map-asset-library';
import { addHeightFog } from '../environment/height-fog';
import { mapToScene } from '../map-coords';

/**
 * The placed objects of a map, drawn instanced: one InstancedMesh per model
 * part and asset, split by whether the objects block line of sight.
 *
 * - Sight blockers (trees, big rocks, buildings) go into the LOS group and
 *   always hold every instance: the LOS cube renders from the towers, not
 *   from the camera, so they must not be culled by the camera.
 * - Everything else (grass, flowers, small props) is culled per instance
 *   on the CPU by the asset's draw distance and the camera frustum; the
 *   visible instances are packed to the front of the buffer.
 *
 * Trees and plants sway in the wind (vertex shader, by height in the model
 * and a phase from the instance position). Vegetation gets a small random
 * brightness per instance, so a forest of one model does not look cloned.
 */

/** Height (metres) at which a model of wind strength 1 sways by 1 m */
const WIND_REFERENCE_HEIGHT = 18;

interface AssetBatch {
  key: string;
  entry: CatalogObject;
  model: ObjectModel;
  blocksLos: boolean;
  objects: MapObject[];
  meshes: InstancedMesh[];
  /** Instance matrices of all objects (16 per object) */
  matrices: Float32Array;
  /** Bounding sphere centre and radius per object (4 per object) */
  spheres: Float32Array;
  colors: Float32Array | null;
  culled: boolean;
}

export interface ObjectHit {
  object: MapObject;
  point: Vector3;
  distance: number;
}

export class MapObjectLayer {
  /** Non-blocking objects; blocking ones are added to the LOS group given to the constructor */
  readonly group = new Group();
  private batches: AssetBatch[] = [];
  private readonly byId = new Map<string, { batch: AssetBatch; index: number }>();
  private readonly windUniforms = { uWindTime: { value: 0 } };
  private readonly windMaterials = new Map<Material, Material>();
  private generation = 0;
  private readonly frustum = new Frustum();
  private readonly projScreen = new Matrix4();
  private readonly lastCamera = new Matrix4();
  private readonly camPos = new Vector3();
  private readonly tmpMatrix = new Matrix4();
  private readonly tmpPos = new Vector3();
  private readonly tmpQuat = new Quaternion();
  private readonly tmpScale = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly sphere = new Sphere();
  private forceCull = true;

  constructor(
    private readonly field: HeightField,
    private readonly assets: MapAssetLibrary,
    private readonly losGroup: Group,
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
      const model = await this.assets.model(list[0].asset);
      if (generation !== this.generation) return;
      built.push(this.buildBatch(key, model, key.endsWith('|1'), list));
    }
    if (generation !== this.generation) return;
    this.clear();
    this.batches = built;
    for (const b of built) {
      b.objects.forEach((o, index) => this.byId.set(o.id, { batch: b, index }));
      for (const m of b.meshes) (b.blocksLos ? this.losGroup : this.group).add(m);
    }
    this.forceCull = true;
  }

  /**
   * Moves, turns or scales one object in place. Returns false when the
   * object is unknown or changed its asset or LOS flag; the caller then
   * calls `setObjects`.
   */
  updateObject(o: MapObject): boolean {
    const slot = this.byId.get(o.id);
    if (!slot) return false;
    const b = slot.batch;
    const blocks = o.blocksLos ?? b.entry.blocksLos;
    if (o.asset !== b.objects[slot.index].asset || blocks !== b.blocksLos) return false;
    b.objects[slot.index] = o;
    this.writeInstance(b, slot.index);
    if (!b.culled) {
      for (const m of b.meshes) {
        m.instanceMatrix.array.set(b.matrices.subarray(slot.index * 16, slot.index * 16 + 16), slot.index * 16);
        m.instanceMatrix.needsUpdate = true;
        m.computeBoundingSphere();
      }
    }
    this.forceCull = true;
    return true;
  }

  /** Objects stand on the terrain: call after heights changed */
  refreshHeights(): void {
    for (const b of this.batches) {
      for (let i = 0; i < b.objects.length; i++) this.writeInstance(b, i);
      if (!b.culled) {
        for (const m of b.meshes) {
          (m.instanceMatrix.array as Float32Array).set(b.matrices);
          m.instanceMatrix.needsUpdate = true;
          m.computeBoundingSphere();
        }
      }
    }
    this.forceCull = true;
  }

  /** Wind time and per-instance culling of the non-blocking objects */
  update(dt: number, camera: Camera): void {
    this.windUniforms.uWindTime.value += dt;
    camera.updateMatrixWorld();
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (!this.forceCull && this.projScreen.equals(this.lastCamera)) return;
    this.lastCamera.copy(this.projScreen);
    this.forceCull = false;
    this.frustum.setFromProjectionMatrix(this.projScreen);
    camera.getWorldPosition(this.camPos);
    this.group.worldToLocal(this.camPos);
    for (const b of this.batches) if (b.culled) this.cull(b);
  }

  /** First object a scene-space ray hits */
  raycast(ray: Ray): ObjectHit | null {
    const raycaster = new Raycaster(ray.origin, ray.direction);
    const meshes = this.batches.flatMap((b) => b.meshes);
    const hits = raycaster.intersectObjects(meshes, false);
    for (const hit of hits) {
      const batch = this.batches.find((b) => b.meshes.includes(hit.object as InstancedMesh));
      if (!batch || hit.instanceId === undefined) continue;
      // Culled batches pack visible instances; their order is kept in userData
      const order = (hit.object as InstancedMesh).userData['order'] as Int32Array | undefined;
      const index = order ? order[hit.instanceId] : hit.instanceId;
      return { object: batch.objects[index], point: hit.point, distance: hit.distance };
    }
    return null;
  }

  dispose(): void {
    this.generation++;
    this.clear();
    for (const m of this.windMaterials.values()) m.dispose();
    this.windMaterials.clear();
    this.group.removeFromParent();
  }

  private clear(): void {
    for (const b of this.batches) {
      for (const m of b.meshes) {
        m.removeFromParent();
        m.dispose();
      }
    }
    this.batches = [];
    this.byId.clear();
  }

  private buildBatch(key: string, model: ObjectModel, blocksLos: boolean, objects: MapObject[]): AssetBatch {
    const entry = model.entry;
    const n = objects.length;
    const vegetation = entry.category === 'tree' || entry.category === 'plant';
    const tinted = vegetation || objects.some((o) => o.tint);
    const b: AssetBatch = {
      key,
      entry,
      model,
      blocksLos,
      objects: objects.slice(),
      meshes: [],
      matrices: new Float32Array(n * 16),
      spheres: new Float32Array(n * 4),
      colors: tinted ? new Float32Array(n * 3) : null,
      culled: !blocksLos,
    };
    for (let i = 0; i < n; i++) this.writeInstance(b, i);
    for (const part of model.parts) {
      const material = entry.wind > 0 ? this.windMaterial(part.material, entry) : part.material;
      addHeightFog(material);
      const mesh = new InstancedMesh(part.geometry, material, n);
      mesh.name = `${entry.id}${blocksLos ? '' : '-decor'}`;
      (mesh.instanceMatrix.array as Float32Array).set(b.matrices);
      if (b.colors) {
        for (let i = 0; i < n; i++) mesh.setColorAt(i, new Color(b.colors[i * 3], b.colors[i * 3 + 1], b.colors[i * 3 + 2]));
      }
      mesh.castShadow = entry.category !== 'plant' || entry.height > 0.8;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      if (b.culled) {
        mesh.frustumCulled = false;
        mesh.userData['order'] = new Int32Array(n);
        mesh.userData['losTransparent'] = true;
      } else {
        mesh.computeBoundingSphere();
      }
      b.meshes.push(mesh);
    }
    return b;
  }

  /** Instance matrix, bounding sphere and colour of object i from the document */
  private writeInstance(b: AssetBatch, i: number): void {
    const o = b.objects[i];
    const e = b.entry;
    const s = o.scale || 1;
    // Buildings and walls sit on the lowest point under their footprint, so no corner floats
    let ground = this.field.heightAt(o.x, o.y);
    if (e.category === 'building' || e.category === 'wall' || e.category === 'prop') {
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

  /** Packs the instances within draw distance and frustum to the front */
  private cull(b: AssetBatch): void {
    const maxD = b.entry.drawDistance;
    const maxD2 = maxD * maxD;
    const cx = this.camPos.x;
    const cy = this.camPos.y;
    const cz = this.camPos.z;
    const order = b.meshes[0]?.userData['order'] as Int32Array | undefined;
    if (!order) return;
    let count = 0;
    for (let i = 0; i < b.objects.length; i++) {
      const sx = b.spheres[i * 4];
      const sy = b.spheres[i * 4 + 1];
      const sz = b.spheres[i * 4 + 2];
      const dx = sx - cx;
      const dy = sy - cy;
      const dz = sz - cz;
      if (dx * dx + dy * dy + dz * dz > maxD2) continue;
      this.sphere.center.set(sx, sy, sz);
      this.sphere.radius = b.spheres[i * 4 + 3];
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      order[count++] = i;
    }
    for (const m of b.meshes) {
      const dst = m.instanceMatrix.array as Float32Array;
      const colors = m.instanceColor?.array as Float32Array | undefined;
      for (let k = 0; k < count; k++) {
        const i = order[k];
        dst.set(b.matrices.subarray(i * 16, i * 16 + 16), k * 16);
        if (colors && b.colors) {
          colors[k * 3] = b.colors[i * 3];
          colors[k * 3 + 1] = b.colors[i * 3 + 1];
          colors[k * 3 + 2] = b.colors[i * 3 + 2];
        }
      }
      if (m !== b.meshes[0]) (m.userData['order'] as Int32Array).set(order.subarray(0, count));
      m.count = count;
      m.instanceMatrix.clearUpdateRanges();
      m.instanceMatrix.addUpdateRange(0, count * 16);
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) {
        m.instanceColor.clearUpdateRanges();
        m.instanceColor.addUpdateRange(0, count * 3);
        m.instanceColor.needsUpdate = true;
      }
    }
  }

  /** A copy of the model's material that sways with the wind (one per source material) */
  private windMaterial(source: Material, entry: CatalogObject): Material {
    const key = source;
    const cached = this.windMaterials.get(key);
    if (cached) return cached;
    const m = source.clone() as MeshStandardMaterial;
    const strength = entry.wind / WIND_REFERENCE_HEIGHT;
    const uniforms = this.windUniforms;
    m.onBeforeCompile = (shader) => {
      shader.uniforms['uWindTime'] = uniforms.uWindTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWindTime;')
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
          {
            float phase = 0.0;
            #ifdef USE_INSTANCING
            phase = dot(instanceMatrix[3].xz, vec2(0.071, 0.093));
            #endif
            float h = max(transformed.y, 0.0);
            float bend = h * h * ${strength.toFixed(5)};
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
    };
    if (m.name.startsWith('foliage-')) {
      // Cards seen edge-on smear their texture into streaks: fade them out by the flat face normal
      const prev = m.onBeforeCompile;
      const fadeStart = (entry.drawDistance * 0.55).toFixed(1);
      const fadeEnd = entry.drawDistance.toFixed(1);
      m.onBeforeCompile = (shader, renderer) => {
        prev.call(m, shader, renderer);
        shader.fragmentShader = shader.fragmentShader
          // Card normals are authored (bent out of the crown, up for grass); three flips them on
          // back faces of double-sided materials, which turned every card's back black
          .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
          .replace(
            '#include <alphatest_fragment>',
            /* glsl */ `{
            vec3 faceNormal = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
            float facing = abs(dot(faceNormal, normalize(vViewPosition)));
            diffuseColor.a *= smoothstep(0.08, 0.3, facing);
            // Fade out towards the draw distance: thin far cards turn into dark lines otherwise
            diffuseColor.a *= 1.0 - smoothstep(${fadeStart}, ${fadeEnd}, length(vViewPosition));
          }
          #include <alphatest_fragment>`,
          );
      };
    }
    m.customProgramCacheKey = () =>
      `custom-map-wind-${strength.toFixed(5)}-${m.name.startsWith('foliage-') ? `card-${entry.drawDistance}` : 'solid'}`;
    this.windMaterials.set(key, m);
    return m;
  }
}
