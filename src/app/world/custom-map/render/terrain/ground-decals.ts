import {
  InstancedBufferAttribute,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
} from 'three';
import type { CustomMapDocument, MapObject } from '../../map-document';
import type { CatalogObject } from '../asset-catalog';
import { SHADER_NOISE } from '../shader-noise';
import { addHeightFog } from '../environment/height-fog';
import { TERRAIN_HEIGHT_GLSL, type HeightTexture } from './height-texture';

/**
 * Wear on the ground where life happens: fallen leaves under trees, trodden
 * dark soil along roads and paths and at the doors of houses, puddles in
 * wet places. Baked from the map's rules (objects, paths, weather), never
 * painted by hand; one instanced mesh, one draw call.
 *
 * Each decal is a small grid draped over the terrain (the height texture
 * in the vertex shader, a few centimetres above it), lit, shadowed and
 * fogged like the ground (a standard material); its shape is drawn in the
 * fragment shader per kind, frayed at the rim by noise, so no square shows.
 */

/** What a decal shows */
export const DecalKind = { Leaves: 0, Soil: 1, Puddle: 2 } as const;
export type DecalKind = (typeof DecalKind)[keyof typeof DecalKind];

interface Decal {
  x: number;
  y: number;
  size: number;
  rotation: number;
  kind: DecalKind;
}

/** Decals over a map at most (each is a few dozen triangles) */
const MAX_DECALS = 3000;

export class GroundDecals {
  readonly mesh: InstancedMesh<PlaneGeometry, MeshStandardMaterial>;
  private readonly place: InstancedBufferAttribute;
  private readonly kind: InstancedBufferAttribute;

  constructor(heights: HeightTexture) {
    // A grid of 4 x 4 cells in the x/z plane, draped per vertex
    const geometry = new PlaneGeometry(1, 1, 4, 4).rotateX(-Math.PI / 2);
    this.place = new InstancedBufferAttribute(new Float32Array(MAX_DECALS * 4), 4);
    this.kind = new InstancedBufferAttribute(new Float32Array(MAX_DECALS * 2), 2);
    geometry.setAttribute('aDecal', this.place);
    geometry.setAttribute('aDecalKind', this.kind);
    const material = new MeshStandardMaterial({ roughness: 0.9, metalness: 0, transparent: true, depthWrite: false });
    material.name = 'custom-map-decals';
    material.polygonOffset = true;
    material.polygonOffsetFactor = -2;
    material.polygonOffsetUnits = -2;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, heights.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${TERRAIN_HEIGHT_GLSL}\nattribute vec4 aDecal;\nattribute vec2 aDecalKind;\nvarying vec2 vDecalUv;\nvarying vec2 vDecalKind;`)
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `
          // Turned and sized in map space, then on the ground (scene x is map -x)
          float dc = cos(aDecal.w);
          float ds = sin(aDecal.w);
          vec2 local = vec2(position.x * dc - position.z * ds, position.x * ds + position.z * dc) * aDecal.z;
          vec2 mapAt = aDecal.xy + vec2(-local.x, local.y);
          vec3 transformed = vec3(-mapAt.x, terrainHeightAt(mapAt), mapAt.y);
          // Above the ground by more with distance: the terrain's coarser levels and the logarithmic depth
          // would swallow a decal lying a few centimetres up
          transformed.y += 0.05 + length((modelMatrix * vec4(transformed, 1.0)).xyz - cameraPosition) * 0.002;
          vDecalUv = position.xz * 2.0;
          vDecalKind = aDecalKind;`,
        )
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${SHADER_NOISE}\nvarying vec2 vDecalUv;\nvarying vec2 vDecalKind;`)
        .replace(
          '#include <map_fragment>',
          /* glsl */ `
          {
            float r = length(vDecalUv);
            float seed = vDecalKind.y;
            // A frayed rim: the radius the noise allows at this angle and spot
            float rim = 0.75 + (valueNoise(vDecalUv * 2.5 + seed) - 0.5) * 0.5;
            float body = smoothstep(rim, rim - 0.25, r);
            int kind = int(vDecalKind.x + 0.5);
            if (kind == 0) {
              // Leaves: scattered small blots in autumn colours, thicker towards the middle
              vec2 cell = vDecalUv * 9.0 + seed * 7.0;
              float leaf = smoothstep(0.35, 0.6, valueNoise(cell)) * (0.5 + 0.5 * smoothstep(0.2, 0.5, valueNoise(cell * 0.31 + 3.0)));
              vec3 tint = mix(vec3(0.36, 0.2, 0.08), vec3(0.58, 0.4, 0.12), valueNoise(cell * 0.5 + 9.0));
              diffuseColor = vec4(tint, leaf * body * 0.85);
            } else if (kind == 1) {
              // Trodden soil: a dark, slightly glossy stain, patchy inside
              float patchy = 0.6 + 0.4 * valueNoise(vDecalUv * 4.0 + seed);
              diffuseColor = vec4(vec3(0.075, 0.05, 0.03), body * patchy * 0.8);
            } else {
              // Puddle: dark water with a soft edge
              diffuseColor = vec4(vec3(0.05, 0.06, 0.07), smoothstep(rim * 0.85, rim * 0.6, r) * 0.75);
            }
            if (diffuseColor.a < 0.01) discard;
          }`,
        )
        // Puddles shine; leaves and soil stay matt
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = int(vDecalKind.x + 0.5) == 2 ? 0.08 : roughness;');
    };
    material.customProgramCacheKey = () => 'custom-map-decals-1';
    addHeightFog(material);
    this.mesh = new InstancedMesh(geometry, material, MAX_DECALS);
    this.mesh.name = 'custom-map-decals';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
    this.mesh.userData['losTransparent'] = true;
    // The instance matrices stay identity: the vertex shader places every decal from aDecal
    this.mesh.matrixAutoUpdate = false;
    const identity = new Object3D();
    identity.updateMatrix();
    for (let i = 0; i < MAX_DECALS; i++) this.mesh.setMatrixAt(i, identity.matrix);
  }

  /** Lays the decals the map's rules ask for (objects by catalogue category, paths, weather) */
  set(doc: CustomMapDocument, entries: Map<string, CatalogObject>): void {
    const decals = planDecals(doc, entries);
    const n = Math.min(MAX_DECALS, decals.length);
    for (let i = 0; i < n; i++) {
      const d = decals[i];
      this.place.setXYZW(i, d.x, d.y, d.size, d.rotation);
      this.kind.setXY(i, d.kind, (i * 0.6180339) % 1 * 50);
    }
    this.place.needsUpdate = true;
    this.kind.needsUpdate = true;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
}

/** A repeatable random number from a seed (0..1) */
function hash(seed: number): number {
  const s = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * The decals of a map: leaves under trees (autumn and broadleaf woods
 * more), trodden soil along roads and paths and before the doors of
 * houses, puddles beside paths when it rains or in a swamp
 */
export function planDecals(doc: CustomMapDocument, entries: Map<string, CatalogObject>): Decal[] {
  const out: Decal[] = [];
  const wet = doc.environment.weather === 'rain' || doc.environment.biome === 'swamp';
  const objects: MapObject[] = doc.objects;
  for (const o of objects) {
    const e = entries.get(o.asset);
    if (!e) continue;
    const s = o.scale || 1;
    const h = hash(o.x * 0.37 + o.y * 0.71);
    if (e.category === 'tree' && !e.tags?.includes('conifer') && !e.tags?.includes('hell') && !e.tags?.includes('wasteland')) {
      // One tree in two drops a carpet of leaves around its trunk
      if (h < 0.5) out.push({ x: o.x, y: o.y, size: Math.max(4, e.footprint * s * 3), rotation: h * 6.28, kind: DecalKind.Leaves });
    } else if (e.category === 'building' && !e.tags?.includes('moon') && !e.tags?.includes('mars')) {
      // Trodden soil before the door (the model's front, +z, is map north at rotation 0)
      const reach = e.footprint * s * 0.9;
      const a = o.rotation;
      out.push({ x: o.x - Math.sin(a) * reach, y: o.y + Math.cos(a) * reach, size: 4.5 + h * 2.5, rotation: h * 6.28, kind: DecalKind.Soil });
    }
  }
  // Along roads and paths: worn patches at their edges every 9 to 15 m, puddles in the wet
  const nodes = new Map(doc.paths.nodes.map((n) => [n.id, n]));
  for (const edge of doc.paths.edges) {
    if (edge.kind === 'bridge') continue;
    const a = nodes.get(edge.a);
    const b = nodes.get(edge.b);
    if (!a || !b) continue;
    const line = [a, ...(edge.via ?? []), b];
    let walked = 0;
    for (let k = 0; k < line.length - 1; k++) {
      const p = line[k];
      const q = line[k + 1];
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      if (len < 1e-3) continue;
      const tx = (q.x - p.x) / len;
      const ty = (q.y - p.y) / len;
      for (; walked < len; walked += 9 + hash(walked + k) * 6) {
        const h = hash(p.x + walked * 1.3 + p.y * 0.7);
        const side = h < 0.5 ? -1 : 1;
        const off = edge.width / 2 + 0.6 + h * 1.2;
        const x = p.x + tx * walked - ty * off * side;
        const y = p.y + ty * walked + tx * off * side;
        const kind = wet && h > 0.7 ? DecalKind.Puddle : DecalKind.Soil;
        out.push({ x, y, size: kind === DecalKind.Puddle ? 2 + h * 2 : 3.2 + h * 2.8, rotation: h * 6.28, kind });
      }
      walked -= len;
    }
  }
  return out;
}
