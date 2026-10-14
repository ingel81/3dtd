import { Color, MeshStandardMaterial, Vector2, Vector3, Vector4, type Texture } from 'three';
import type { LayerArray } from './terrain-textures';
import { SHADER_NOISE } from '../shader-noise';
import { TERRAIN_MORPH_PARS, TERRAIN_MORPH_VERTEX } from './terrain-chunks';

/**
 * The terrain's material: a MeshStandardMaterial (scene lights, shadows,
 * fog, log depth and tone mapping as every other standard material) whose
 * albedo, normal, roughness and AO come from blended ground layers.
 *
 * Per fragment:
 * 1. Splat weights of the map's layers (two RGBA maps), the road and path
 *    mask, and the cliff weight from the slope (above `cliffAngle`, with a
 *    noisy edge) are combined into one weight per texture-array layer.
 * 2. Every layer with weight samples albedo+height and normal+roughness+AO,
 *    twice with offset UVs picked by a low-frequency noise (no visible
 *    repeat); the cliff layer samples three planes (triplanar).
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

export const TERRAIN_MAX_LAYERS = 12;

/** Layers the terrain shader loops over for `depth` array layers (TerrainMaterial.layerCount) */
export function terrainLayerCount(depth: number): number {
  return Math.min(TERRAIN_MAX_LAYERS, Math.max(4, Math.ceil(depth / 4) * 4));
}

export interface TerrainLayerSlots {
  /** Number of array layers in use */
  count: number;
  /** Array layer of the map's splat layer k (k < 8) */
  splat: number[];
  cliff: number;
  road: number;
  path: number;
}

export interface TerrainMaterialParams {
  colorArray: LayerArray;
  dataArray: LayerArray;
  splat: [Texture, Texture];
  pathMask: Texture;
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
    uPathMask: { value: null as Texture | null },
    uGridNormals: { value: null as Texture | null },
    uGridOcclusion: { value: null as Texture | null },
    uGridUv: { value: new Vector4() },
    uWaterLevel: { value: -1e4 },
    uMapSize: { value: new Vector2() },
    /** Metres per splat texel */
    uSplatTexel: { value: 1 },
    uInvScale: { value: new Float32Array(TERRAIN_MAX_LAYERS) },
    uAverage: { value: Array.from({ length: TERRAIN_MAX_LAYERS }, () => new Color()) },
    uEmissive: { value: new Float32Array(TERRAIN_MAX_LAYERS) },
    uFlow: { value: new Float32Array(TERRAIN_MAX_LAYERS) },
    uTerrainTime: { value: 0 },
    uSplatLayer: { value: new Int32Array(8).fill(-1) },
    uCliffLayer: { value: -1 },
    uRoadLayer: { value: -1 },
    uPathLayer: { value: -1 },
    uCliffCos: { value: Math.cos((40 * Math.PI) / 180) },
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

  constructor(params: TerrainMaterialParams) {
    super({ roughness: 1, metalness: 0 });
    this.name = 'custom-map-terrain';
    this.layerCount = terrainLayerCount(params.layers ?? params.colorArray.image.depth);
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
        .replace('#include <common>', `#include <common>\n#define TERRAIN_LAYERS ${this.layerCount}\n${TERRAIN_FRAGMENT_PARS}`)
        .replace('#include <map_fragment>', TERRAIN_SAMPLE)
        // The marker lets addHeightFog add wetness after the terrain's own roughness
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = terrainRough;\n// map-roughness-done')
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
    u.uPathMask.value = p.pathMask;
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
    }
    for (let k = 0; k < 8; k++) u.uSplatLayer.value[k] = p.slots.splat[k] ?? -1;
    u.uCliffLayer.value = p.slots.cliff;
    u.uRoadLayer.value = p.slots.road;
    u.uPathLayer.value = p.slots.path;
    this.setCliffAngle(p.cliffAngle);
  }

  /** Advances flowing and pulsing layers */
  tick(dt: number): void {
    this.terrainUniforms.uTerrainTime.value += dt;
  }

  /** Water level for the wet banks; null when the map has no water */
  setWaterLevel(level: number | null): void {
    // Far below any terrain, but not so far that level + 1.3 and level + 0.15 round to the same float
    this.terrainUniforms.uWaterLevel.value = level ?? -1e4;
  }

  setCliffAngle(degrees: number): void {
    this.terrainUniforms.uCliffCos.value = Math.cos((degrees * Math.PI) / 180);
  }

  override customProgramCacheKey(): string {
    return `custom-map-terrain-1-${this.layerCount}`;
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
uniform sampler2D uPathMask;
uniform sampler2D uGridNormals;
uniform sampler2D uGridOcclusion;
uniform vec4 uGridUv;
uniform float uWaterLevel;
uniform vec2 uMapSize;
uniform float uSplatTexel;
uniform float uInvScale[TERRAIN_LAYERS];
uniform vec3 uAverage[TERRAIN_LAYERS];
uniform float uEmissive[TERRAIN_LAYERS];
uniform float uFlow[TERRAIN_LAYERS];
uniform float uTerrainTime;
uniform int uSplatLayer[8];
uniform int uCliffLayer;
uniform int uRoadLayer;
uniform int uPathLayer;
uniform float uCliffCos;

${SHADER_NOISE}

// Sample a layer on one plane without visible repetition: two lookups with
// offsets chosen by a slow noise, blended where the noise steps
// (after Inigo Quilez, "texture repetition", technique 3).
void sampleNoTile(int layer, vec2 uv, vec2 dx, vec2 dy, float k, out vec4 col, out vec4 dat) {
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
`;

const TERRAIN_SAMPLE = /* glsl */ `
vec3 tPos = vTerrainPos;
vec2 mapPos = vec2(-tPos.x, tPos.z);
// Beyond the map (the apron) there is no grid: vertex normals and the first layer
vec2 edgeDist = abs(mapPos) - uMapSize * 0.5;
float outside = smoothstep(0.0, 12.0, max(edgeDist.x, edgeDist.y));
vec4 gridSample = texture2D(uGridNormals, mapPos * uGridUv.xy + uGridUv.zw);
vec3 nGeo = safeNormalize(mix(gridSample.xyz, normalize(vTerrainNormal), outside), vec3(0.0, 1.0, 0.0));
// Banks just above the water are wet: darker and glossier
float wetBank = gridSample.a * smoothstep(uWaterLevel + 1.3, uWaterLevel + 0.15, tPos.y) * (1.0 - outside);
wetBank = max(wetBank, texture2D(uPathMask, mapPos / uMapSize + 0.5).a * (1.0 - outside) * 0.85);
vec2 tuv = mapPos / uMapSize + 0.5;
vec2 dPosX = dFdx(tPos.xz);
vec2 dPosY = dFdy(tPos.xz);

// Slow noise: macro variation, splat edge wobble, anti-tiling selector
float n1 = valueNoise(mapPos * 0.017);
float n2 = valueNoise(mapPos * 0.0041 + 17.0);
float n3 = valueNoise(mapPos * 0.11);
// The splat's edges wander with noise: coarse, and fine in proportion to the splat's texel size, so a
// big map (2 m per texel) does not show soft blurred blobs up close
vec2 wobble = ((vec2(n3, valueNoise(mapPos * 0.11 + 31.0)) - 0.5) * 2.5
  + (vec2(valueNoise(mapPos * 0.6 + 7.0), valueNoise(mapPos * 0.6 + 13.0)) - 0.5) * 1.2 * max(1.0, uSplatTexel)
  + (vec2(valueNoise(mapPos * 2.1 + 3.0), valueNoise(mapPos * 2.1 + 19.0)) - 0.5) * 0.5 * uSplatTexel) / uMapSize;

float w[TERRAIN_LAYERS];
for (int k = 0; k < TERRAIN_LAYERS; k++) w[k] = 0.0;
vec4 s0 = texture2D(uSplat0, tuv + wobble);
vec4 s1 = texture2D(uSplat1, tuv + wobble);
float sw[8] = float[8](s0.r, s0.g, s0.b, s0.a, s1.r, s1.g, s1.b, s1.a);
float sum = 0.0;
for (int k = 0; k < 8; k++) if (uSplatLayer[k] >= 0) sum += sw[k];
if (sum < 0.001) { sw[0] = 1.0; sum = 1.0; }
for (int k = 0; k < 8; k++) if (uSplatLayer[k] >= 0) w[uSplatLayer[k]] += sw[k] / sum * (1.0 - outside);
w[max(uSplatLayer[0], 0)] += outside;

// Roads and paths replace the painted ground
vec4 pmask = texture2D(uPathMask, tuv + wobble * 0.5);
vec2 pm = pmask.rg * (1.0 - outside);
// Frayed edges: noise eats into the soft rim of the mask, grass grows in from the side
float fray = (valueNoise(mapPos * 0.9 + 11.0) - 0.5) * 0.9 + (n3 - 0.5) * 0.4;
pm = clamp(pm + fray * pm * (1.0 - pm) * 2.5, 0.0, 1.0);
// Across position: 0 on the centre line, 1 at the edges
float across = abs(pmask.b * 2.0 - 1.0) * 1.15;
// Wheel ruts on roads, worn into the path material
float ruts = exp(-pow((across - 0.42) / 0.11, 2.0)) * smoothstep(0.6, 0.9, pm.r);
// Paths: a grass strip down the middle between the tracks
float strip = smoothstep(0.22, 0.08, across + (valueNoise(mapPos * 1.7) - 0.5) * 0.12) * smoothstep(0.7, 1.0, pm.g);
float road = uRoadLayer >= 0 ? pm.r * (1.0 - ruts * 0.55) : 0.0;
float path = uPathLayer >= 0 ? max(pm.g * (1.0 - strip * 0.85), ruts * 0.55 * pm.r) * (1.0 - road) : 0.0;
// River banks (mask alpha): wet gravel and earth along both sides, under the water a dark bed
float riverBank = pmask.a * (1.0 - outside);
float keep = 1.0 - road - path;
for (int k = 0; k < TERRAIN_LAYERS; k++) w[k] *= keep;
if (uRoadLayer >= 0) w[uRoadLayer] += road;
if (uPathLayer >= 0) w[uPathLayer] += path;
if (uPathLayer >= 0 && riverBank > 0.0) {
  float bank = riverBank * (0.55 + (n3 - 0.5) * 0.5);
  for (int k = 0; k < TERRAIN_LAYERS; k++) w[k] *= 1.0 - bank;
  w[uPathLayer] += bank;
}

// Cliffs above the slope threshold, edge broken up by noise
float cliff = 0.0;
if (uCliffLayer >= 0) {
  float c = uCliffCos + (n3 - 0.5) * 0.08;
  cliff = smoothstep(c + 0.06, c - 0.06, nGeo.y);
  for (int k = 0; k < TERRAIN_LAYERS; k++) w[k] *= 1.0 - cliff;
  w[uCliffLayer] += cliff;
}

// Sample the layers with weight, keep albedo+height and normal+rough+AO
vec4 lc[TERRAIN_LAYERS];
vec4 ld[TERRAIN_LAYERS];
vec3 ln[TERRAIN_LAYERS];
float best = -1.0;
float sel = valueNoise(mapPos * 0.11 + 5.0);
// Blend noise: breaks the texture-periodic pattern where two layers meet
float blendNoise = (valueNoise(mapPos * 0.35 + 3.0) - 0.5) * 0.5 + (n3 - 0.5) * 0.3;
vec3 tri = pow(abs(nGeo), vec3(4.0));
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
  sampleNoTile(uCliffLayer, sideX * s, sideXdx * s, sideXdy * s, sel, cliffX, cliffXd);
  sampleNoTile(uCliffLayer, sideZ * s, sideZdx * s, sideZdy * s, sel, cliffZ, cliffZd);
}
for (int k = 0; k < TERRAIN_LAYERS; k++) {
  if (w[k] < 0.004) continue;
  float s = uInvScale[k];
  vec4 col; vec4 dat;
  // Flowing layers (lava) scroll along map +x, which is scene -x
  vec2 flowUv = vec2(uFlow[k] * uTerrainTime, 0.0);
  sampleNoTile(k, (tPos.xz + flowUv) * s, dPosX * s, dPosY * s, sel, col, dat);
  vec3 tn = unpackTerrainNormal(dat);
  // Top projection: tangent x along scene +x, tangent y along scene +z (whiteout blend)
  vec3 nTop = safeNormalize(vec3(tn.x + nGeo.x, tn.z * nGeo.y, tn.y + nGeo.z), nGeo);
  if (k == uCliffLayer && cliffSides) {
    // Triplanar on the side planes (after Ben Golus, whiteout blend)
    vec4 cx = cliffX; vec4 dx4 = cliffXd; vec4 cz = cliffZ; vec4 dz4 = cliffZd;
    vec3 tx = unpackTerrainNormal(dx4);
    vec3 tz = unpackTerrainNormal(dz4);
    tx.x *= sgn.x;
    tz.x *= -sgn.z;
    tx = vec3(tx.xy + nGeo.zy, abs(tx.z) * nGeo.x);
    tz = vec3(tz.xy + nGeo.xy, abs(tz.z) * nGeo.z);
    nTop = safeNormalize(tx.zyx * tri.x + nTop * tri.y + tz.xyz * tri.z, nGeo);
    col = cx * tri.x + col * tri.y + cz * tri.z;
    dat = dx4 * tri.x + dat * tri.y + dz4 * tri.z;
  }
  // Each layer gets its own noise sign, so neighbours do not shift together
  col.a += blendNoise * (float(k & 1) * 2.0 - 1.0);
  lc[k] = col;
  ld[k] = dat;
  ln[k] = nTop;
  best = max(best, col.a + w[k]);
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
  float b = max(lc[k].a + w[k] - best + band, 0.0) * w[k];
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

albedo *= mix(1.0, 0.6, wetBank);
// Soil, grass and rock are rough and barely shiny: against the sun at a grazing angle the full
// specular of a standard material turned meadows and yards into white sheets. Wet banks keep a sheen
float terrainRough = mix(clamp(accD.b, 0.6, 1.0), 0.45, wetBank);
float terrainSpec = mix(0.25, 0.6, wetBank);
// Texture AO and the baked ground occlusion (hollows, slope feet, contact shadows of objects)
float groundAO = mix(texture2D(uGridOcclusion, mapPos * uGridUv.xy + uGridUv.zw).r, 1.0, outside);
float terrainAO = mix(1.0, accD.a, 0.85) * groundAO;
diffuseColor.rgb = albedo;
`;
