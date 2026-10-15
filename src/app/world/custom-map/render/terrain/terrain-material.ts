import { Color, ShaderChunk, MeshStandardMaterial, Vector2, Vector3, Vector4, type Texture } from 'three';
import type { LayerArray } from './terrain-textures';
import { SHADER_NOISE } from '../shader-noise';
import { TERRAIN_MORPH_PARS, TERRAIN_MORPH_VERTEX } from './terrain-chunks';
import type { MapWaterKind } from '../../map-document';
import { shoreWaves } from '../water/shore-waves';
import { VARIATION_GLSL, variationTexture } from './variation-texture';
import { WIND_UNIFORMS } from '../environment/wind';
import type { MaterialCategory } from '../asset-catalog';

/**
 * How a ground material of a catalogue category blends and shines: `soft`
 * scales the height blend band against its neighbours (grass and sand run
 * into them, rock and ice cut), `rough` is the roughness range its
 * texture's roughness maps into (mud and ice glossier, grass and sand matt)
 */
const MATERIAL_LOOK: Record<MaterialCategory, { soft: number; rough: [number, number] }> = {
  grass: { soft: 1.4, rough: [0.72, 1] },
  forest: { soft: 1.3, rough: [0.68, 1] },
  soil: { soft: 1.2, rough: [0.5, 0.95] },
  sand: { soft: 1.5, rough: [0.62, 0.96] },
  snow: { soft: 1.3, rough: [0.45, 0.82] },
  rock: { soft: 0.6, rough: [0.45, 0.9] },
  road: { soft: 0.8, rough: [0.5, 0.9] },
  volcanic: { soft: 0.8, rough: [0.4, 0.9] },
  ice: { soft: 0.7, rough: [0.12, 0.45] },
  wood: { soft: 0.8, rough: [0.5, 0.85] },
};

export function materialLook(category: MaterialCategory | undefined): { soft: number; rough: [number, number] } {
  return (category && MATERIAL_LOOK[category]) || { soft: 1, rough: [0.6, 1] };
}

/**
 * The terrain's material: a MeshStandardMaterial (scene lights, shadows,
 * fog, log depth and tone mapping as every other standard material) whose
 * albedo, normal, roughness and AO come from blended ground layers.
 *
 * Per fragment:
 * 1. Splat weights of the map's layers (two RGBA maps, a third past 8 layers), the road and path
 *    mask, and the cliff weight from the slope (above `cliffAngle`, with a
 *    noisy edge) are combined into one weight per texture-array layer.
 * 2. Every layer with weight samples albedo+height and normal+roughness+AO,
 *    twice with offset UVs picked by a low-frequency noise (no visible
 *    repeat); the cliff layer samples three planes (triplanar), and on
 *    slopes from 25 degrees the strongest painted layer does too (no
 *    streaks stretched down a flank).
 * 3. Height blend: a layer shows where its height plus weight is within a
 *    small band of the best, so gravel fills the gaps between cobbles and
 *    grass gives way to dirt in clumps, not as a smear.
 * 4. Macro variation (two octaves of value noise) tints and darkens the
 *    albedo over tens and hundreds of metres; far away the albedo leans
 *    towards the layer's average colour, which hides the mip pattern.
 *
 * The mesh is in map frame (scene x = -map x); the group must not be rotated,
 * since the shader takes object space as world space for its projections.
 */

/** Array layers at most: the map's 12 ground layers, the cliff and the two path materials, rounded up to four */
export const TERRAIN_MAX_LAYERS = 16;

/** Layers the terrain shader loops over for `depth` array layers (TerrainMaterial.layerCount) */
export function terrainLayerCount(depth: number): number {
  return Math.min(TERRAIN_MAX_LAYERS, Math.max(4, Math.ceil(depth / 4) * 4));
}

export interface TerrainLayerSlots {
  /** Number of array layers in use */
  count: number;
  /** Array layer of the map's splat layer k (k < 12) */
  splat: number[];
  cliff: number;
  road: number;
  path: number;
}

export interface TerrainMaterialParams {
  colorArray: LayerArray;
  dataArray: LayerArray;
  /** Two splat maps, three on a map with more than 8 layers */
  splat: Texture[];
  pathMask: Texture;
  /** The border's natural ground for the apron (apron-paint.ts); without, the apron shows the first layer */
  apronPaint?: Texture;
  /** Grid normals (GridNormalTexture) and the grid's columns, rows and cell size */
  gridNormals: Texture;
  /** Baked ground occlusion on the same grid (GroundOcclusion) */
  gridOcclusion: Texture;
  grid: { columns: number; rows: number; cellSize: number };
  slots: TerrainLayerSlots;
  /** Metres per texture repeat, by array layer */
  scales: number[];
  /** Average albedo (sRGB hex), by array layer */
  averages: string[];
  /** Glow (0..1) and flow (m/s along map +x) by array layer, for lava */
  emissive?: number[];
  flow?: number[];
  /** Catalogue category by array layer: how soft it blends and how rough it is (MATERIAL_LOOK) */
  categories?: (MaterialCategory | undefined)[];
  width: number;
  depth: number;
  cliffAngle: number;
  splatResolution?: number;
  /** Layers the shader loops over, when not the array's (warm-up twins of a larger variant) */
  layers?: number;
}

export class TerrainMaterial extends MeshStandardMaterial {
  readonly terrainUniforms = {
    uColorArray: { value: null as LayerArray | null },
    uDataArray: { value: null as LayerArray | null },
    uSplat0: { value: null as Texture | null },
    uSplat1: { value: null as Texture | null },
    uSplat2: { value: null as Texture | null },
    uPathMask: { value: null as Texture | null },
    /** The border's natural ground carried onto the apron (apron-paint.ts) */
    uApronPaint: { value: null as Texture | null },
    uGridNormals: { value: null as Texture | null },
    uGridOcclusion: { value: null as Texture | null },
    /** The ground's variation, natural blots at three scales (variation-texture.ts) */
    uVariation: { value: variationTexture() as Texture },
    uGridUv: { value: new Vector4() },
    uWaterLevel: { value: -1e4 },
    /** Swash of the main water's shore bands (shore-waves.ts): bands per second, 0 none */
    uSwashSpeed: { value: 0 },
    uMapSize: { value: new Vector2() },
    /** Metres per splat texel */
    uSplatTexel: { value: 1 },
    uInvScale: { value: new Float32Array(TERRAIN_MAX_LAYERS) },
    uAverage: { value: Array.from({ length: TERRAIN_MAX_LAYERS }, () => new Color()) },
    uEmissive: { value: new Float32Array(TERRAIN_MAX_LAYERS) },
    uFlow: { value: new Float32Array(TERRAIN_MAX_LAYERS) },
    /** Blend band factor and roughness range (texture roughness 0..1 mapped into it) by array layer */
    uSoft: { value: new Float32Array(TERRAIN_MAX_LAYERS).fill(1) },
    /** Camera distances (m) from which the ground samples one layer lookup, and no layer textures at all */
    uFarSingle: { value: 150 },
    uFarFlat: { value: 400 },
    /** Camera distance (m) up to which painted ground on steep slopes reads its side planes; 0 none */
    uSteepNear: { value: 150 },
    uRough: { value: Array.from({ length: TERRAIN_MAX_LAYERS }, () => new Vector2(0.6, 1)) },
    uTerrainTime: { value: 0 },
    uSplatLayer: { value: new Int32Array(12).fill(-1) },
    uCliffLayer: { value: -1 },
    uRoadLayer: { value: -1 },
    uPathLayer: { value: -1 },
    uCliffCos: { value: Math.cos((40 * Math.PI) / 180) },
    /** The far cascade of the sun's shadow and where it applies (far-shadow.ts); replaced by MapTerrainLayer's */
    uFarShadow: { value: null as Texture | null },
    /** The wind's direction (the shared wind uniform), where snow drifts pile up */
    uDriftWind: WIND_UNIFORMS.uWindDir,
    uFarShadowArea: { value: new Vector4() },
    /** Replaced by TerrainChunks.morphEye and morphFocus (MapTerrainLayer) */
    uMorphEye: { value: new Vector3() },
    uMorphFocus: { value: new Vector3(1e9, 0, 1e9) },
  };

  /**
   * Layers the shader loops over: the array's layers rounded up to a multiple
   * of four. The loops unroll in the driver's compiler, so a map with few
   * materials links its program faster; the rounding keeps the editor from
   * recompiling for every material it adds.
   */
  readonly layerCount: number;

  /** Splat layers the shader reads: 8 from two maps, 12 when the map has the third (its own program) */
  readonly splatLayers: number;

  constructor(params: TerrainMaterialParams) {
    super({ roughness: 1, metalness: 0 });
    this.name = 'custom-map-terrain';
    // The terrain glows by lava itself (TERRAIN_SAMPLE): not again through the objects' lava glow
    this.userData['noLavaGlow'] = true;
    this.layerCount = terrainLayerCount(params.layers ?? params.colorArray.image.depth);
    this.splatLayers = params.splat.length > 2 ? 12 : 8;
    this.setParams(params);
    this.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.terrainUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vTerrainPos;\nvarying vec3 vTerrainNormal;\n${TERRAIN_MORPH_PARS}`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>\n${TERRAIN_MORPH_VERTEX}\nvTerrainPos = transformed;\nvTerrainNormal = normal;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n#define TERRAIN_LAYERS ${this.layerCount}\n#define TERRAIN_SPLATS ${this.splatLayers}\n${TERRAIN_FRAGMENT_PARS}`)
        .replace('#include <map_fragment>', TERRAIN_SAMPLE)
        // The marker lets addHeightFog add wetness after the terrain's own roughness
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = terrainRough;\n// map-roughness-done')
        // The far cascade dims the sun where the land hides it beyond the cached shadow map
        .replace('#include <lights_fragment_begin>', TERRAIN_LIGHTS)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += accGlow;')
        .replace(
          '#include <normal_fragment_maps>',
          'normal = normalize((viewMatrix * vec4(terrainNormal, 0.0)).xyz);',
        )
        .replace(
          '#include <aomap_fragment>',
          '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= terrainAO;\nreflectedLight.indirectSpecular *= terrainAO * terrainSpec;\nreflectedLight.directDiffuse *= mix(1.0, terrainAO, 0.6);\nreflectedLight.directSpecular *= terrainSpec;',
        );
    };
  }

  setParams(p: TerrainMaterialParams): void {
    const u = this.terrainUniforms;
    u.uColorArray.value = p.colorArray;
    u.uDataArray.value = p.dataArray;
    u.uSplat0.value = p.splat[0];
    u.uSplat1.value = p.splat[1];
    u.uSplat2.value = p.splat[2] ?? null;
    u.uPathMask.value = p.pathMask;
    u.uApronPaint.value = p.apronPaint ?? null;
    u.uGridNormals.value = p.gridNormals;
    u.uGridOcclusion.value = p.gridOcclusion;
    // Map metres to the grid texture: sample i sits at texel centre (i + 0.5) / columns
    const sx = 1 / (p.grid.cellSize * p.grid.columns);
    const sy = 1 / (p.grid.cellSize * p.grid.rows);
    u.uGridUv.value.set(sx, sy, (p.width / 2) * sx + 0.5 / p.grid.columns, (p.depth / 2) * sy + 0.5 / p.grid.rows);
    u.uMapSize.value.set(p.width, p.depth);
    u.uSplatTexel.value = p.splatResolution ? Math.max(p.width, p.depth) / p.splatResolution : 1;
    for (let k = 0; k < TERRAIN_MAX_LAYERS; k++) {
      u.uInvScale.value[k] = 1 / (p.scales[k] ?? 4);
      u.uAverage.value[k].set(p.averages[k] ?? '#808080');
      u.uEmissive.value[k] = p.emissive?.[k] ?? 0;
      u.uFlow.value[k] = p.flow?.[k] ?? 0;
      const look = materialLook(p.categories?.[k]);
      u.uSoft.value[k] = look.soft;
      u.uRough.value[k].set(look.rough[0], look.rough[1]);
    }
    for (let k = 0; k < 12; k++) u.uSplatLayer.value[k] = p.slots.splat[k] ?? -1;
    u.uCliffLayer.value = p.slots.cliff;
    u.uRoadLayer.value = p.slots.road;
    u.uPathLayer.value = p.slots.path;
    this.setCliffAngle(p.cliffAngle);
  }

  /** Advances flowing and pulsing layers */
  tick(dt: number): void {
    this.terrainUniforms.uTerrainTime.value += dt;
  }

  /**
   * Distances (m) from which far ground gets cheaper: one layer lookup at a
   * larger scale, then the layers' average colours only, and up to which
   * painted ground on steep slopes reads its side planes (quality levels)
   */
  setFarDistances(single: number, flat: number, steep = single): void {
    this.terrainUniforms.uFarSingle.value = single;
    this.terrainUniforms.uFarFlat.value = Math.max(single, flat);
    this.terrainUniforms.uSteepNear.value = steep;
  }

  /** Water level for the wet banks, and the kind of the main water for its swash; null when the map has no water */
  setWaterLevel(level: number | null, kind?: MapWaterKind): void {
    // Far below any terrain, but not so far that level + 1.3 and level + 0.15 round to the same float
    this.terrainUniforms.uWaterLevel.value = level ?? -1e4;
    this.terrainUniforms.uSwashSpeed.value = level === null ? 0 : (shoreWaves(kind)?.speed ?? 0);
  }

  setCliffAngle(degrees: number): void {
    this.terrainUniforms.uCliffCos.value = Math.cos((degrees * Math.PI) / 180);
  }

  override customProgramCacheKey(): string {
    return `custom-map-terrain-2-${this.layerCount}-${this.splatLayers}`;
  }
}

const TERRAIN_FRAGMENT_PARS = /* glsl */ `
precision highp sampler2DArray;
varying vec3 vTerrainPos;
varying vec3 vTerrainNormal;
uniform sampler2DArray uColorArray;
uniform sampler2DArray uDataArray;
uniform sampler2D uSplat0;
uniform sampler2D uSplat1;
#if TERRAIN_SPLATS > 8
uniform sampler2D uSplat2;
#endif
uniform sampler2D uPathMask;
uniform sampler2D uApronPaint;
uniform sampler2D uGridNormals;
uniform sampler2D uGridOcclusion;
uniform sampler2D uFarShadow;
// The map's wind direction in the scene (wind.ts), for snow drifts
uniform vec2 uDriftWind;
uniform vec4 uFarShadowArea;
${VARIATION_GLSL}
uniform vec4 uGridUv;
uniform float uWaterLevel;
uniform float uSwashSpeed;
uniform vec2 uMapSize;
uniform float uSplatTexel;
uniform float uInvScale[TERRAIN_LAYERS];
uniform vec3 uAverage[TERRAIN_LAYERS];
uniform float uEmissive[TERRAIN_LAYERS];
uniform float uFlow[TERRAIN_LAYERS];
uniform float uSoft[TERRAIN_LAYERS];
uniform float uFarSingle;
uniform float uFarFlat;
uniform vec2 uRough[TERRAIN_LAYERS];
uniform float uTerrainTime;
uniform int uSplatLayer[12];
uniform int uCliffLayer;
uniform int uRoadLayer;
uniform int uPathLayer;
uniform float uCliffCos;
uniform float uSteepNear;
// Painted ground takes the side planes from 25 degrees of slope, fully from 35
#define STEEP_FROM_COS ${Math.cos((25 * Math.PI) / 180).toFixed(4)}
#define STEEP_FULL_COS ${Math.cos((35 * Math.PI) / 180).toFixed(4)}

${SHADER_NOISE}

// Sample a layer on one plane without visible repetition: two lookups with
// offsets chosen by a slow noise, blended where the noise steps
// (after Inigo Quilez, "texture repetition", technique 3).
void sampleNoTile(int layer, vec2 uv, vec2 dx, vec2 dy, float k, bool single, out vec4 col, out vec4 dat) {
  float l = k * 8.0;
  float f = fract(l);
  float ia = floor(l);
  float ib = ia + 1.0;
  vec2 offa = sin(vec2(3.0, 7.0) * ia);
  vec2 offb = sin(vec2(3.0, 7.0) * ib);
  vec4 ca = textureGrad(uColorArray, vec3(uv + offa, float(layer)), dx, dy);
  vec4 cb = textureGrad(uColorArray, vec3(uv + offb, float(layer)), dx, dy);
  float b = smoothstep(0.2, 0.8, f - 0.1 * dot(ca.rgb - cb.rgb, vec3(1.0)));
  col = mix(ca, cb, b);
  vec4 da = textureGrad(uDataArray, vec3(uv + offa, float(layer)), dx, dy);
  // Far ground: the colour keeps both samples (its tiling would show), normal and roughness take one
  if (single) {
    dat = da;
    return;
  }
  vec4 db = textureGrad(uDataArray, vec3(uv + offb, float(layer)), dx, dy);
  dat = mix(da, db, b);
}

// Normal maps are OpenGL style (green towards the image top); the arrays are
// uploaded without a flip, so the image top is v = 0 and green flips
// A zero vector normalises to NaN, and one NaN pixel blooms into a glowing disc
vec3 safeNormalize(vec3 v, vec3 fallback) {
  float l = length(v);
  return l > 1e-5 ? v / l : fallback;
}

vec3 unpackTerrainNormal(vec4 dat) {
  // Strengthened: from game distance the ground's relief would otherwise vanish
  vec2 xy = (dat.xy * 2.0 - 1.0) * vec2(1.6, -1.6);
  return vec3(xy, sqrt(max(0.0, 1.0 - dot(xy, xy))));
}

// Triplanar on the side planes (after Ben Golus, whiteout blend): the samples of the x and z planes mixed
// into the top projection's colour, data and normal by the shares in t (x, top, z)
void sideBlend(vec4 cx, vec4 dx4, vec4 cz, vec4 dz4, vec3 t, vec3 nGeo, vec3 sgn, inout vec3 nTop, inout vec4 col, inout vec4 dat) {
  vec3 tx = unpackTerrainNormal(dx4);
  vec3 tz = unpackTerrainNormal(dz4);
  tx.x *= sgn.x;
  tz.x *= -sgn.z;
  tx = vec3(tx.xy + nGeo.zy, abs(tx.z) * nGeo.x);
  tz = vec3(tz.xy + nGeo.xy, abs(tz.z) * nGeo.z);
  nTop = safeNormalize(tx.zyx * t.x + nTop * t.y + tz.xyz * t.z, nGeo);
  col = cx * t.x + col * t.y + cz * t.z;
  dat = dx4 * t.x + dat * t.y + dz4 * t.z;
}

// The sun's light left by the far cascade: 1 inside the cached shadow map, the baked land shadow beyond it
float farSunShade() {
  if (uFarShadowArea.w < 0.5) return 1.0;
  vec2 m = vec2(-vTerrainPos.x, vTerrainPos.z);
  float beyond = smoothstep(0.7, 0.95, length(m - uFarShadowArea.xy) / uFarShadowArea.z);
  if (beyond <= 0.0) return 1.0;
  return mix(1.0, texture2D(uFarShadow, m / uMapSize + 0.5).r, beyond);
}
`;

/**
 * three's light loop with the far cascade applied to the sun (the scene's
 * only directional light): after its shadow map, before it lights
 */
const TERRAIN_LIGHTS = ShaderChunk.lights_fragment_begin.replace(
  /(vDirectionalShadowCoord\[ i \] \) : 1\.0;\s*#endif)/,
  '$1\n\t\tdirectLight.color *= farSunShade();',
);

const TERRAIN_SAMPLE = /* glsl */ `
vec3 tPos = vTerrainPos;
vec2 mapPos = vec2(-tPos.x, tPos.z);
// Beyond the map (the apron) there is no grid: vertex normals, and the border's natural ground (below)
vec2 edgeDist = abs(mapPos) - uMapSize * 0.5;
float outside = smoothstep(0.0, 12.0, max(edgeDist.x, edgeDist.y));
vec4 gridSample = texture2D(uGridNormals, mapPos * uGridUv.xy + uGridUv.zw);
vec3 nGeo = safeNormalize(mix(gridSample.xyz, normalize(vTerrainNormal), outside), vec3(0.0, 1.0, 0.0));
// Banks just above the water are wet: darker and glossier
float wetBank = gridSample.a * smoothstep(uWaterLevel + 1.3, uWaterLevel + 0.15, tPos.y) * (1.0 - outside);
wetBank = max(wetBank, texture2D(uPathMask, mapPos / uMapSize + 0.5).a * (1.0 - outside) * 0.85);
// Swash: each foam band that reaches the shore runs up the bank and drains away (shore-waves.ts, same phase)
float swash = 0.0;
if (uSwashSpeed > 0.0) {
  float q = fract(uTerrainTime * uSwashSpeed + 0.04);
  float runup = uWaterLevel + 0.03 + 0.28 * (1.0 - smoothstep(0.0, 0.55, q));
  swash = gridSample.a * smoothstep(runup + 0.04, runup - 0.04, tPos.y) * smoothstep(uWaterLevel - 0.2, uWaterLevel + 0.02, tPos.y) * (1.0 - outside);
  wetBank = max(wetBank, swash);
}
vec2 tuv = mapPos / uMapSize + 0.5;
vec2 dPosX = dFdx(tPos.xz);
vec2 dPosY = dFdy(tPos.xz);

// The ground's variation (variation-texture.ts): natural blots at three scales, three lookups for what
// were a dozen value noises. Macro variation, splat edge wobble, anti-tiling selector
vec4 varCoarse = variationAt(mapPos);
vec4 varFine = variationFine(mapPos);
vec4 varFiner = variationFiner(mapPos);
float n1 = varCoarse.r;
float n2 = varCoarse.g;
float n3 = varCoarse.b;
// The splat's edges wander with noise: coarse, and fine in proportion to the splat's texel size, so a
// big map (2 m per texel) does not show soft blurred blobs up close
vec2 wobble = ((varCoarse.ba - 0.5) * 2.5
  + (varFine.ba - 0.5) * 1.2 * max(1.0, uSplatTexel)
  + (varFiner.ba - 0.5) * 0.5 * uSplatTexel) / uMapSize;

float w[TERRAIN_LAYERS];
for (int k = 0; k < TERRAIN_LAYERS; k++) w[k] = 0.0;
vec4 s0 = texture2D(uSplat0, tuv + wobble);
vec4 s1 = texture2D(uSplat1, tuv + wobble);
#if TERRAIN_SPLATS > 8
// The third map only on maps with more than 8 layers: the others neither sample nor bind it
vec4 s2 = texture2D(uSplat2, tuv + wobble);
float sw[TERRAIN_SPLATS] = float[TERRAIN_SPLATS](s0.r, s0.g, s0.b, s0.a, s1.r, s1.g, s1.b, s1.a, s2.r, s2.g, s2.b, s2.a);
#else
float sw[TERRAIN_SPLATS] = float[TERRAIN_SPLATS](s0.r, s0.g, s0.b, s0.a, s1.r, s1.g, s1.b, s1.a);
#endif
float sum = 0.0;
for (int k = 0; k < TERRAIN_SPLATS; k++) if (uSplatLayer[k] >= 0) sum += sw[k];
if (sum < 0.001) { sw[0] = 1.0; sum = 1.0; }
for (int k = 0; k < TERRAIN_SPLATS; k++) if (uSplatLayer[k] >= 0) w[uSplatLayer[k]] += sw[k] / sum * (1.0 - outside);
// Beyond the map the border's natural ground runs on (apron-paint.ts), at the point of the border nearest
if (outside > 0.0) {
  vec2 hm = uMapSize * 0.5;
  vec2 q = clamp(mapPos, -hm, hm);
  vec2 e = abs(mapPos) - hm;
  // Metres along the border, counter-clockwise from the south-west corner (south, east, north, west)
  float along = e.y >= e.x
    ? (mapPos.y < 0.0 ? q.x + hm.x : 2.0 * uMapSize.x + uMapSize.y - (q.x + hm.x))
    : (mapPos.x > 0.0 ? uMapSize.x + q.y + hm.y : 2.0 * (uMapSize.x + uMapSize.y) - (q.y + hm.y));
  float au = along / (2.0 * (uMapSize.x + uMapSize.y));
  float apron = 0.0;
  for (int r = 0; r < TERRAIN_SPLATS / 4; r++) {
    vec4 a = textureLod(uApronPaint, vec2(au, (float(r) + 0.5) / 3.0), 0.0);
    for (int c = 0; c < 4; c++) {
      int layer = uSplatLayer[r * 4 + c];
      if (layer >= 0) {
        w[layer] += a[c] * outside;
        apron += a[c];
      }
    }
  }
  // No paint of the border known (a material built before it): the first layer, as before
  if (apron < 0.01) w[max(uSplatLayer[0], 0)] += outside;
}

// Roads and paths replace the painted ground
vec4 pmask = texture2D(uPathMask, tuv + wobble * 0.5);
vec2 pm = pmask.rg * (1.0 - outside);
// Frayed edges: noise eats into the soft rim of the mask, grass grows in from the side
float fray = (varFine.a - 0.5) * 0.9 + (n3 - 0.5) * 0.4;
pm = clamp(pm + fray * pm * (1.0 - pm) * 2.5, 0.0, 1.0);
// Across position: 0 on the centre line, 1 at the edges
float across = abs(pmask.b * 2.0 - 1.0) * 1.15;
// Wheel ruts on roads, worn into the path material
float ruts = exp(-pow((across - 0.42) / 0.11, 2.0)) * smoothstep(0.6, 0.9, pm.r);
// Paths: a grass strip down the middle between the tracks
float strip = smoothstep(0.22, 0.08, across + (varFiner.a - 0.5) * 0.12) * smoothstep(0.7, 1.0, pm.g);
float road = uRoadLayer >= 0 ? pm.r * (1.0 - ruts * 0.55) : 0.0;
float path = uPathLayer >= 0 ? max(pm.g * (1.0 - strip * 0.85), ruts * 0.55 * pm.r) * (1.0 - road) : 0.0;
// River banks (mask alpha): wet gravel and earth along both sides, under the water a dark bed
float riverBank = pmask.a * (1.0 - outside);
float keep = 1.0 - road - path;
for (int k = 0; k < TERRAIN_LAYERS; k++) w[k] *= keep;
if (uRoadLayer >= 0) w[uRoadLayer] += road;
if (uPathLayer >= 0) w[uPathLayer] += path;
if (uPathLayer >= 0 && riverBank > 0.0) {
  // Gravel in patches, its edge eaten by noise: no even strip like a canal's
  float bank = riverBank * (0.55 + (n3 - 0.5) * 0.5) * smoothstep(0.05, 0.45, riverBank + (varFine.b - 0.5) * 0.45);
  for (int k = 0; k < TERRAIN_LAYERS; k++) w[k] *= 1.0 - bank;
  w[uPathLayer] += bank;
}

// Cliffs above the slope threshold, edge broken up by noise
float cliff = 0.0;
if (uCliffLayer >= 0) {
  // The rock's edge is broken, not a height contour: blocks of rock reach down into the scree and the
  // scree runs up the rock in tongues along the fall line, at several scales over the map
  vec2 fall = normalize(vec2(-nGeo.x, nGeo.z) + 1e-4);
  float tongue = valueNoise(vec2(dot(mapPos, vec2(-fall.y, fall.x)) * 0.32, dot(mapPos, fall) * 0.05));
  float broken = (n3 - 0.5) * 0.12 + (varFine.a - 0.5) * 0.1 + (varFiner.b - 0.5) * 0.07 + (tongue - 0.5) * 0.14;
  float c = uCliffCos + broken;
  cliff = smoothstep(c + 0.035, c - 0.035, nGeo.y);
  for (int k = 0; k < TERRAIN_LAYERS; k++) w[k] *= 1.0 - cliff;
  w[uCliffLayer] += cliff;
}

// Sample the layers with weight, keep albedo+height and normal+rough+AO
vec4 lc[TERRAIN_LAYERS];
vec4 ld[TERRAIN_LAYERS];
vec3 ln[TERRAIN_LAYERS];
float best = -1.0;
float sel = varCoarse.a;
// Blend noise: breaks the texture-periodic pattern where two layers meet
float blendNoise = (varFine.a - 0.5) * 0.5 + (n3 - 0.5) * 0.3;
// Side projections take over from about 35 degrees of slope: the top one stretched the rock on mid slopes
vec3 tri = vec3(pow(abs(nGeo.x), 2.0), pow(abs(nGeo.y), 8.0), pow(abs(nGeo.z), 2.0));
tri /= tri.x + tri.y + tri.z;
// Side plane coordinates of the cliff projection and their derivatives, outside any branch
vec3 sgn = sign(nGeo + 1e-5);
vec2 sideX = vec2(tPos.z * sgn.x, tPos.y);
vec2 sideZ = vec2(-tPos.x * sgn.z, tPos.y);
vec2 sideXdx = dFdx(sideX);
vec2 sideXdy = dFdy(sideX);
vec2 sideZdx = dFdx(sideZ);
vec2 sideZdy = dFdy(sideZ);
// The cliff layer's side planes, sampled once before the loop: inside it the driver's compiler
// unrolls the sampling for every layer, which made this program take seconds to link
vec4 cliffX = vec4(0.0); vec4 cliffXd = vec4(0.5, 0.5, 1.0, 1.0);
vec4 cliffZ = vec4(0.0); vec4 cliffZd = vec4(0.5, 0.5, 1.0, 1.0);
bool cliffSides = uCliffLayer >= 0 && tri.y < 0.98 && w[uCliffLayer] >= 0.004;
if (cliffSides) {
  float s = uInvScale[uCliffLayer];
  sampleNoTile(uCliffLayer, sideX * s, sideXdx * s, sideXdy * s, sel, false, cliffX, cliffXd);
  sampleNoTile(uCliffLayer, sideZ * s, sideZdx * s, sideZdy * s, sel, false, cliffZ, cliffZd);
}
// Ground in the distance is cheaper: from uFarSingle each layer reads its normal and roughness once instead
// of twice (the colour keeps its anti-tiling pair; a band dithered by noise, so no line shows), from
// uFarFlat no layer textures at all, the layers' average colours by weight over the grid's normal (the
// macro variation stays). The textures fade into those colours over the last 30 % before uFarFlat: a
// dithered band of 30 m swept the paint over the ground as the intro's camera came down from its overview
float farJitter = (sel - 0.5) * 30.0;
float viewDist = length(vViewPosition);
bool farSingle = viewDist > uFarSingle + farJitter;
bool farFlat = viewDist > uFarFlat;
float farFade = smoothstep(uFarFlat * 0.7, uFarFlat, viewDist);
// Painted ground on a steep slope (from STEEP_FROM to STEEP_FULL degrees, below the cliff angle): the top
// projection stretched it into streaks. Its strongest layer also reads the two side planes, once before the
// loop as the cliff does, within uSteepNear metres of the camera (0 on Low: none)
float steepShare = 1.0 - smoothstep(STEEP_FULL_COS, STEEP_FROM_COS, nGeo.y);
int steepLayer = -1;
vec4 steepX = vec4(0.0); vec4 steepXd = vec4(0.5, 0.5, 1.0, 1.0);
vec4 steepZ = vec4(0.0); vec4 steepZd = vec4(0.5, 0.5, 1.0, 1.0);
if (steepShare > 0.004 && !farFlat && viewDist < uSteepNear + farJitter) {
  float strongest = 0.004;
  for (int k = 0; k < TERRAIN_LAYERS; k++) {
    if (k != uCliffLayer && w[k] > strongest) {
      strongest = w[k];
      steepLayer = k;
    }
  }
  if (steepLayer >= 0) {
    float s = uInvScale[steepLayer];
    sampleNoTile(steepLayer, sideX * s, sideXdx * s, sideXdy * s, sel, farSingle, steepX, steepXd);
    sampleNoTile(steepLayer, sideZ * s, sideZdx * s, sideZdy * s, sel, farSingle, steepZ, steepZd);
  }
}
// The side planes' share for the steep layer: all of it from STEEP_FULL, split between x and z as the cliff's
float sideSum = max(tri.x + tri.z, 1e-5);
vec3 steepTri = vec3(tri.x / sideSum * steepShare, 1.0 - steepShare, tri.z / sideSum * steepShare);
if (farFlat) {
  for (int k = 0; k < TERRAIN_LAYERS; k++) {
    lc[k] = vec4(uAverage[k], 0.5);
    ld[k] = vec4(0.5, 0.5, 0.85, 1.0);
    ln[k] = nGeo;
    best = max(best, 0.5 + w[k]);
  }
} else
for (int k = 0; k < TERRAIN_LAYERS; k++) {
  if (w[k] < 0.004) continue;
  float s = uInvScale[k];
  vec4 col; vec4 dat;
  // Flowing layers (lava) scroll along map +x, which is scene -x
  vec2 flowUv = vec2(uFlow[k] * uTerrainTime, 0.0);
  sampleNoTile(k, (tPos.xz + flowUv) * s, dPosX * s, dPosY * s, sel, farSingle, col, dat);
  vec3 tn = unpackTerrainNormal(dat);
  // Top projection: tangent x along scene +x, tangent y along scene +z (whiteout blend)
  vec3 nTop = safeNormalize(vec3(tn.x + nGeo.x, tn.z * nGeo.y, tn.y + nGeo.z), nGeo);
  if (k == uCliffLayer && cliffSides) sideBlend(cliffX, cliffXd, cliffZ, cliffZd, tri, nGeo, sgn, nTop, col, dat);
  else if (k == steepLayer) sideBlend(steepX, steepXd, steepZ, steepZd, steepTri, nGeo, sgn, nTop, col, dat);
  // Each layer gets its own noise sign, so neighbours do not shift together
  col.a += blendNoise * (float(k & 1) * 2.0 - 1.0);
  // Towards the flat ground's values, which it has once past uFarFlat
  lc[k] = mix(col, vec4(uAverage[k], 0.5), farFade);
  ld[k] = mix(dat, vec4(0.5, 0.5, 0.85, 1.0), farFade);
  ln[k] = safeNormalize(mix(nTop, nGeo, farFade), nGeo);
  best = max(best, lc[k].a + w[k]);
}

// Height blend within a band below the best layer
// Narrower blend band on coarse splats: crisp transitions where the weights are smeared over metres
float band = 0.26 * clamp(0.7 / uSplatTexel, 0.45, 1.0);
float total = 0.0;
vec4 accC = vec4(0.0);
vec4 accD = vec4(0.0);
vec3 accN = vec3(0.0);
vec3 accAvg = vec3(0.0);
vec3 accGlow = vec3(0.0);
for (int k = 0; k < TERRAIN_LAYERS; k++) {
  if (w[k] < 0.004) continue;
  // Each layer blends as soft as its kind: grass and sand run into their neighbours, rock and ice cut
  float b = max(lc[k].a + w[k] - best + band * uSoft[k], 0.0) * w[k];
  // Roughness as its kind is rough: the texture's range mapped into the kind's
  ld[k].b = mix(uRough[k].x, uRough[k].y, ld[k].b);
  if (uEmissive[k] > 0.0) {
    // Glow only in the deep parts of the texture (cracks), the crust between them dark; a slow pulse.
    // The colour runs from dark red through orange to a little yellow in the deepest cracks, never past
    // it: the texture's own colour times a gain burnt pink-white patches into the ground
    float hot = smoothstep(0.27, 0.06, lc[k].a);
    float pulse = 0.8 + 0.2 * sin(uTerrainTime * 1.3 + valueNoise(mapPos * 0.08) * 9.0);
    vec3 glow = mix(vec3(0.35, 0.03, 0.005), vec3(0.95, 0.28, 0.03), smoothstep(0.0, 0.6, hot));
    glow = mix(glow, vec3(1.0, 0.5, 0.08), smoothstep(0.8, 1.0, hot) * 0.5);
    accGlow += glow * hot * pulse * uEmissive[k] * b;
    // A glowing crack is its light, not a lit surface: its pale texture colour would wash the glow out
    lc[k].rgb *= 1.0 - 0.7 * hot * uEmissive[k];
  }
  accC += lc[k] * b;
  accD += ld[k] * b;
  accN += ln[k] * b;
  accAvg += uAverage[k] * b;
  total += b;
}
total = max(total, 1e-5);
accC /= total;
accD /= total;
accAvg /= total;
accGlow /= total;
vec3 terrainNormal = safeNormalize(accN, nGeo);

// Macro variation and far blend
vec3 albedo = accC.rgb;
float macro = n1 * 0.6 + n2 * 0.4;
albedo *= mix(0.86, 1.1, macro) * mix(0.93, 1.06, n3);
// Large patches: drier and yellower in some, deeper and cooler in others
albedo = mix(albedo, albedo * vec3(1.1, 1.04, 0.8), smoothstep(0.5, 0.85, n2) * 0.5);
albedo = mix(albedo, albedo * vec3(0.84, 0.92, 0.95), smoothstep(0.45, 0.15, n1) * 0.6);
// Photo grass reads olive under a warm sun: where green leads, pull red and blue back a little
float greenLead = smoothstep(0.0, 0.08, albedo.g - max(albedo.r, albedo.b));
albedo *= mix(vec3(1.0), vec3(0.86, 1.04, 0.92), greenLead);
// A little less saturated overall: photo textures under a strong sun read too green
albedo = mix(vec3(dot(albedo, vec3(0.299, 0.587, 0.114))), albedo, 0.94);
float far = smoothstep(120.0, 900.0, length(vViewPosition));
albedo = mix(albedo, accAvg * mix(0.8, 1.15, macro), far * 0.45);
// Rock faces: strata along the height, warped by noise, and weathering streaks running down. The
// cliff texture alone repeats every few metres and from afar blurs into one flat colour; the bands
// give a mountain side its structure at any distance
if (cliff > 0.01) {
  float warp = (valueNoise(mapPos * 0.006) - 0.5) * 40.0 + (valueNoise(mapPos * 0.03 + 7.0) - 0.5) * 10.0 + (n3 - 0.5) * 4.0;
  float bandNoise = valueNoise(vec2((tPos.y + warp) * 0.16, 3.7));
  float fine = valueNoise(vec2((tPos.y + warp * 0.5) * 0.9, 9.1));
  // Bands show in patches, not around the whole mountain
  float patches = smoothstep(0.3, 0.7, valueNoise(mapPos * 0.009 + 11.0));
  float strata = mix(1.0, mix(0.78, 1.1, smoothstep(0.25, 0.75, bandNoise)) * (0.92 + 0.14 * fine), 0.35 + 0.65 * patches);
  // Gullies: dark streaks running down the face, broken along their length
  float streak = valueNoise(vec2(dot(mapPos, vec2(0.11, 0.07)) * 2.3, tPos.y * 0.012 + 5.0));
  float gully = mix(0.74, 1.06, smoothstep(0.15, 0.65, streak));
  float shade = strata * gully;
  vec3 bandTint = mix(vec3(0.93, 0.95, 0.99), vec3(1.06, 1.0, 0.91), bandNoise);
  albedo = mix(albedo, albedo * shade * bandTint, cliff);
}

// The ground's shape, baked with its occlusion (ground-occlusion.ts, the same fetch): crests and knolls dry
// and pale, hollows and runnels damp and darker, scree at the feet of steep slopes, cooled rock around lava
vec4 shape = texture2D(uGridOcclusion, mapPos * uGridUv.xy + uGridUv.zw);
float inside = 1.0 - outside;
float curv = (shape.g - 0.5) * 2.0 * inside;
float crest = smoothstep(0.04, 0.4, curv) * (1.0 - cliff);
float hollow = smoothstep(0.04, 0.4, -curv) * (1.0 - cliff);
float drain = smoothstep(0.35, 0.9, shape.b) * inside * (1.0 - cliff);
float lavaNear = shape.a * inside;
albedo = mix(albedo, albedo * vec3(1.1, 1.05, 0.88), crest * 0.45);
albedo *= 1.0 - max(hollow * 0.16, drain * 0.22);
albedo = mix(albedo, albedo * vec3(0.88, 1.0, 0.9), drain * 0.35);
// Scree: in a hollow under steep ground (the occlusion is low there), the cliff's rock spills out
if (uCliffLayer >= 0) {
  float scree = hollow * smoothstep(0.85, 0.55, shape.r) * smoothstep(0.35, 0.65, varFine.b + hollow * 0.3);
  albedo = mix(albedo, uAverage[uCliffLayer] * 0.85, scree * 0.55);
}
// Snow drifts: where snow lies it gathers in hollows and on the lee side of slopes (the downhill side
// facing along the wind), smooth and white, in patches; not on rock faces
if (uSnowCover > 0.0) {
  vec2 downhill = nGeo.xz / max(length(nGeo.xz), 1e-4);
  float lee = smoothstep(0.2, 0.75, dot(downhill, uDriftWind)) * smoothstep(0.995, 0.93, nGeo.y);
  float drift = max(smoothstep(0.02, 0.3, -curv), lee * 0.85) * smoothstep(0.3, 0.55, varFine.b + 0.15) * inside * (1.0 - cliff);
  // Drifts fill first: a light snowfall already lies thick there
  float driftAmount = drift * min(1.0, uSnowCover * 4.0);
  albedo = mix(albedo, vec3(0.86, 0.9, 0.95), driftAmount);
  accD.b = mix(accD.b, 0.55, driftAmount);
}
// Around lava the ground is cooled rock, lit orange from below with the lava's slow pulse
albedo = mix(albedo, vec3(0.045, 0.04, 0.038), smoothstep(0.55, 0.85, lavaNear));
accGlow += vec3(1.0, 0.32, 0.06) * pow(lavaNear, 4.0) * 0.22 * (0.85 + 0.15 * sin(uTerrainTime * 1.1 + mapPos.x * 0.05));
albedo *= mix(1.0, 0.6, wetBank);
// Soil, grass and rock are rough and barely shiny: against the sun at a grazing angle the full
// specular of a standard material turned meadows and yards into white sheets. Wet banks keep a sheen
float terrainRough = mix(mix(accD.b, 0.45, wetBank), 0.25, swash) * (1.0 - drain * 0.2);
float terrainSpec = mix(0.25, 0.6, wetBank);
// Against the light at a grazing angle the specular turned smooth rock and packed earth into white sheets:
// it fades towards the edge of view (a damped Fresnel for ground that is never a mirror)
float grazing = 1.0 - max(dot(normalize((viewMatrix * vec4(terrainNormal, 0.0)).xyz), normalize(vViewPosition)), 0.0);
terrainSpec *= 1.0 - 0.6 * pow(grazing, 4.0);
// Texture AO and the baked ground occlusion (hollows, slope feet, contact shadows of objects)
float groundAO = mix(shape.r, 1.0, outside);
float terrainAO = mix(1.0, accD.a, 0.85) * groundAO;
diffuseColor.rgb = albedo;
`;
