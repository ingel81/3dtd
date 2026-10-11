import {
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  BufferAttribute,
  Mesh,
  MeshStandardMaterial,
  Vector2,
  Vector4,
  type Texture,
} from 'three';
import { SHADER_NOISE } from '../shader-noise';
import { TERRAIN_HEIGHT_GLSL, type HeightTexture } from '../terrain/height-texture';
import type { CoverMap } from '../environment/cover-map';
import { addHeightFog } from '../environment/height-fog';

/**
 * Grass blades near the camera: a tile of instanced blades that wraps
 * around the camera's focus (each blade's spot is fixed in the world and
 * folded into the tile), standing on the height grid (fetched in the vertex
 * shader), as dense as the grass layers of the splat there (none on roads,
 * paths and cliffs), swaying in the wind. Towards a circle inside the
 * tile the blades thin out (dithered) and shrink, so neither the tile's
 * square nor the switch to the painted ground is seen. Each blade takes the
 * colour the ground has under it (the splat's layer averages with the
 * terrain's macro variation), so from high up the blades do not show as a
 * patch of their own colour. None grows where the CoverMap's top lies
 * above the ground: in the footprints of buildings, structures and rocks
 * (pools too) and under water, lava and ice.
 *
 * Lit like any standard material (shadows received, fog, grade); blades do
 * not cast shadows. Not part of line of sight.
 */

export interface GrassInputs {
  splat: [Texture, Texture];
  pathMask: Texture;
  /** Grass share per splat channel (1 for grass layers, 0 otherwise), maps 0 and 1 */
  mask: [Vector4, Vector4];
  /** Average colour (linear) of the layer in each splat channel, maps 0 and 1 in order */
  colors: Color[];
  width: number;
  depth: number;
}

/** Edge of the tile around the focus, metres */
const TILE = 64;
const BLADES = 70000;
/** Rows of the blade strip */
const ROWS = 4;

export class GrassField {
  readonly mesh: Mesh<InstancedBufferGeometry, MeshStandardMaterial>;
  private hasGrass = false;
  private near = true;
  private readonly uniforms = {
    uGrassCenter: { value: new Vector2() },
    uGrassTile: { value: TILE },
    uGrassTime: { value: 0 },
    uGrassSplat0: { value: null as Texture | null },
    uGrassSplat1: { value: null as Texture | null },
    uGrassPath: { value: null as Texture | null },
    uGrassMask0: { value: new Vector4() },
    uGrassMask1: { value: new Vector4() },
    uGrassMapSize: { value: new Vector2() },
    uGrassColors: { value: Array.from({ length: 8 }, () => new Color()) },
    uGrassCover: { value: null as Texture | null },
    uGrassHasCover: { value: 0 },
  };

  constructor(heights: HeightTexture) {

    const g = new InstancedBufferGeometry();
    // A tapering strip: (ROWS + 1) pairs of vertices, x across, y up
    const pos = new Float32Array((ROWS + 1) * 2 * 3);
    for (let r = 0; r <= ROWS; r++) {
      const t = r / ROWS;
      const w = 0.5 * (1 - t * 0.85);
      pos.set([-w, t, 0, w, t, 0], r * 6);
    }
    const index: number[] = [];
    for (let r = 0; r < ROWS; r++) {
      const a = r * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(pos.length).map((_, k) => (k % 3 === 1 ? 1 : 0)), 3));
    g.setIndex(index);
    const offsets = new Float32Array(BLADES * 2);
    const rnd = new Float32Array(BLADES * 4);
    let s = 12345;
    const next = (): number => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    for (let i = 0; i < BLADES; i++) {
      offsets[i * 2] = next() * TILE;
      offsets[i * 2 + 1] = next() * TILE;
      rnd.set([next(), next(), next(), next()], i * 4);
    }
    g.setAttribute('aBladeOffset', new InstancedBufferAttribute(offsets, 2));
    g.setAttribute('aBladeRand', new InstancedBufferAttribute(rnd, 4));
    g.instanceCount = BLADES;

    const material = new MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: DoubleSide });
    material.name = 'custom-map-grass';
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms, heights.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${GRASS_VERTEX_PARS}`)
        .replace('#include <beginnormal_vertex>', GRASS_NORMAL)
        .replace('#include <begin_vertex>', GRASS_BEGIN);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBladeColor;')
        .replace('#include <map_fragment>', 'diffuseColor.rgb = vBladeColor;')
        // Blades are double sided and three flips the normal on back faces: half the blades then
        // faced down and showed as dark specks over the meadow
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
    };
    material.customProgramCacheKey = () => 'custom-map-grass-1';
    addHeightFog(material);
    this.mesh = new Mesh(g, material);
    this.mesh.name = 'custom-map-grass';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.userData['losTransparent'] = true;
  }

  setInputs(p: GrassInputs): void {
    const u = this.uniforms;
    u.uGrassSplat0.value = p.splat[0];
    u.uGrassSplat1.value = p.splat[1];
    u.uGrassPath.value = p.pathMask;
    u.uGrassMask0.value.copy(p.mask[0]);
    u.uGrassMask1.value.copy(p.mask[1]);
    u.uGrassColors.value.forEach((c, k) => c.copy(p.colors[k] ?? c.setRGB(0.2, 0.3, 0.1)));
    u.uGrassMapSize.value.set(p.width, p.depth);
    this.hasGrass = p.mask[0].lengthSq() + p.mask[1].lengthSq() > 0;
    this.mesh.visible = this.hasGrass && this.near;
  }

  /** Footprints and water surfaces (the CoverMap shares the height grid) */
  setCover(cover: CoverMap): void {
    this.uniforms.uGrassCover.value = cover.texture;
    this.uniforms.uGrassHasCover.value = 1;
  }

  /** Whether the camera is close enough for blades to show */
  setNear(near: boolean): void {
    this.near = near;
    this.mesh.visible = this.hasGrass && near;
  }

  /** `focus` in the map group's space */
  update(dt: number, focus: { x: number; z: number }): void {
    this.uniforms.uGrassTime.value += dt;
    this.uniforms.uGrassCenter.value.set(focus.x, focus.z);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
}

const GRASS_VERTEX_PARS = /* glsl */ `
attribute vec2 aBladeOffset;
attribute vec4 aBladeRand;
uniform vec2 uGrassCenter;
uniform float uGrassTile;
uniform float uGrassTime;
uniform sampler2D uGrassSplat0;
uniform sampler2D uGrassSplat1;
uniform sampler2D uGrassPath;
uniform vec4 uGrassMask0;
uniform vec4 uGrassMask1;
uniform vec2 uGrassMapSize;
uniform vec3 uGrassColors[8];
uniform sampler2D uGrassCover;
uniform float uGrassHasCover;
varying vec3 vBladeColor;
${SHADER_NOISE}

${TERRAIN_HEIGHT_GLSL}

// 1 where something stands on the ground or water lies over it, 0 on open ground; bilinear over the grid
float grassCovered(vec2 m) {
  if (uGrassHasCover < 0.5) return 0.0;
  vec2 g = (m - uTerrainGrid.xy) / uTerrainGrid.z;
  vec2 g0 = floor(g);
  vec2 fr = g - g0;
  ivec2 hi = ivec2(uTerrainGridSize) - 1;
  float c[4];
  for (int k = 0; k < 4; k++) {
    ivec2 p = clamp(ivec2(g0) + ivec2(k & 1, k >> 1), ivec2(0), hi);
    c[k] = step(0.05, texelFetch(uGrassCover, p, 0).r - texelFetch(uTerrainHeights, p, 0).r);
  }
  return mix(mix(c[0], c[1], fr.x), mix(c[2], c[3], fr.x), fr.y);
}
`;

const GRASS_NORMAL = /* glsl */ `
// Normals point up: blades light like the ground they grow from
vec3 objectNormal = vec3(0.0, 1.0, 0.0);
#ifdef USE_TANGENT
vec3 objectTangent = vec3(1.0, 0.0, 0.0);
#endif
`;

const GRASS_BEGIN = /* glsl */ `
// The blade's spot in the world, folded into the tile around the focus
vec2 sceneXZ = uGrassCenter + mod(aBladeOffset - uGrassCenter, vec2(uGrassTile)) - 0.5 * uGrassTile;
vec2 mapPos = vec2(-sceneXZ.x, sceneXZ.y);
vec2 uvMap = mapPos / uGrassMapSize + 0.5;
vec4 s0 = texture2D(uGrassSplat0, uvMap);
vec4 s1 = texture2D(uGrassSplat1, uvMap);
float total = dot(s0, vec4(1.0)) + dot(s1, vec4(1.0));
float grass = (dot(s0, uGrassMask0) + dot(s1, uGrassMask1)) / max(total, 1e-3);
vec2 pm = texture2D(uGrassPath, uvMap).rg;
grass *= 1.0 - max(pm.r, pm.g);
// No grass on steep ground or outside the map
float hx = terrainHeightAt(mapPos + vec2(1.0, 0.0)) - terrainHeightAt(mapPos - vec2(1.0, 0.0));
float hy = terrainHeightAt(mapPos + vec2(0.0, 1.0)) - terrainHeightAt(mapPos - vec2(0.0, 1.0));
float slope = length(vec2(hx, hy)) * 0.5;
grass *= smoothstep(0.9, 0.5, slope);
grass *= step(abs(mapPos.x), uGrassMapSize.x * 0.5) * step(abs(mapPos.y), uGrassMapSize.y * 0.5);
// None in footprints of buildings, structures, rocks and pools, nor under water, lava or ice
grass *= 1.0 - smoothstep(0.25, 0.6, grassCovered(mapPos));
// Towards a circle inside the tile: fewer blades (each drops out at its own threshold), and shorter
float edge = length(sceneXZ - uGrassCenter) / (0.5 * uGrassTile);
float fade = 1.0 - smoothstep(0.3, 0.88, edge);
float keep = smoothstep(0.45, 0.8, grass) * smoothstep(0.0, 0.25, fade - fract(aBladeRand.x * 7.31 + aBladeRand.y * 3.17));
keep *= 0.4 + 0.6 * fade;
float bladeHeight = (0.35 + aBladeRand.y * 0.45) * keep;
float bladeWidth = (0.07 + aBladeRand.z * 0.05) * sqrt(keep);
// Turned at random, bent by its own lean and the wind
float a = aBladeRand.x * 6.2832;
vec2 dir = vec2(cos(a), sin(a));
float t = position.y;
vec3 transformed = vec3(dir.x * position.x * bladeWidth, t * bladeHeight, dir.y * position.x * bladeWidth);
float gust = sin(uGrassTime * 1.3 + dot(sceneXZ, vec2(0.11, 0.07))) * 0.5 + 0.5;
vec2 sway = vec2(0.8, 0.3) * (0.15 + 0.35 * gust) + vec2(sin(uGrassTime * 2.7 + aBladeRand.w * 20.0), cos(uGrassTime * 2.1 + aBladeRand.w * 13.0)) * 0.08;
vec2 lean = vec2(-dir.y, dir.x) * (aBladeRand.w - 0.5) * 0.5;
transformed.xz += (lean + sway) * t * t * bladeHeight;
transformed += vec3(sceneXZ.x, terrainHeightAt(mapPos), sceneXZ.y);
// The ground's colour here: the grass layers' averages by splat weight, with the terrain's macro
// variation and grading (terrain-material.ts), so blades match the painted ground under them
vec3 ground = vec3(0.0);
float gw = 0.0;
for (int k = 0; k < 4; k++) {
  ground += uGrassColors[k] * s0[k] * uGrassMask0[k] + uGrassColors[k + 4] * s1[k] * uGrassMask1[k];
  gw += s0[k] * uGrassMask0[k] + s1[k] * uGrassMask1[k];
}
ground /= max(gw, 1e-3);
float n1 = valueNoise(mapPos * 0.017);
float n2 = valueNoise(mapPos * 0.0041 + 17.0);
float n3 = valueNoise(mapPos * 0.11);
ground *= mix(0.86, 1.1, n1 * 0.6 + n2 * 0.4) * mix(0.93, 1.06, n3);
ground = mix(ground, ground * vec3(1.1, 1.04, 0.8), smoothstep(0.5, 0.85, n2) * 0.5);
ground = mix(ground, ground * vec3(0.84, 0.92, 0.95), smoothstep(0.45, 0.15, n1) * 0.6);
ground *= mix(vec3(1.0), vec3(0.86, 1.04, 0.92), smoothstep(0.0, 0.08, ground.g - max(ground.r, ground.b)));
ground = mix(vec3(dot(ground, vec3(0.299, 0.587, 0.114))), ground, 0.94);
// The ground's texture AO darkens it a little on average
ground *= 0.94;
// Darker root, lighter tip, each blade a little different; the same brightness as the ground on
// average, and flatter with distance, where single blades are below a pixel
float near = 1.0 - smoothstep(25.0, 110.0, length((modelViewMatrix * vec4(transformed, 1.0)).xyz));
float shade = mix(0.78, 1.18, smoothstep(0.0, 0.8, t)) * (0.94 + aBladeRand.z * 0.12);
vec3 dry = mix(vec3(1.0), vec3(1.1, 1.04, 0.82), step(0.85, aBladeRand.y));
vBladeColor = ground * mix(vec3(1.0), dry * shade, near);
`;
