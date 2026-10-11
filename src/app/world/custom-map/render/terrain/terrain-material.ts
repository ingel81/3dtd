import { Color, MeshStandardMaterial, Vector2, Vector4, type DataArrayTexture, type Texture } from 'three';
import { SHADER_NOISE } from '../shader-noise';

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
  colorArray: DataArrayTexture;
  dataArray: DataArrayTexture;
  splat: [Texture, Texture];
  pathMask: Texture;
  /** Grid normals (GridNormalTexture) and the grid's columns, rows and cell size */
  gridNormals: Texture;
  grid: { columns: number; rows: number; cellSize: number };
  slots: TerrainLayerSlots;
  /** Metres per texture repeat, by array layer */
  scales: number[];
  /** Average albedo (sRGB hex), by array layer */
  averages: string[];
  width: number;
  depth: number;
  cliffAngle: number;
}

export class TerrainMaterial extends MeshStandardMaterial {
  readonly terrainUniforms = {
    uColorArray: { value: null as DataArrayTexture | null },
    uDataArray: { value: null as DataArrayTexture | null },
    uSplat0: { value: null as Texture | null },
    uSplat1: { value: null as Texture | null },
    uPathMask: { value: null as Texture | null },
    uGridNormals: { value: null as Texture | null },
    uGridUv: { value: new Vector4() },
    uMapSize: { value: new Vector2() },
    uInvScale: { value: new Float32Array(TERRAIN_MAX_LAYERS) },
    uAverage: { value: Array.from({ length: TERRAIN_MAX_LAYERS }, () => new Color()) },
    uSplatLayer: { value: new Int32Array(8).fill(-1) },
    uCliffLayer: { value: -1 },
    uRoadLayer: { value: -1 },
    uPathLayer: { value: -1 },
    uCliffCos: { value: Math.cos((40 * Math.PI) / 180) },
  };

  constructor(params: TerrainMaterialParams) {
    super({ roughness: 1, metalness: 0 });
    this.name = 'custom-map-terrain';
    this.setParams(params);
    this.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.terrainUniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vTerrainPos;\nvarying vec3 vTerrainNormal;',
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvTerrainPos = position;\nvTerrainNormal = normal;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${TERRAIN_FRAGMENT_PARS}`)
        .replace('#include <map_fragment>', TERRAIN_SAMPLE)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = terrainRough;')
        .replace(
          '#include <normal_fragment_maps>',
          'normal = normalize((viewMatrix * vec4(terrainNormal, 0.0)).xyz);',
        )
        .replace(
          '#include <aomap_fragment>',
          '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= terrainAO;\nreflectedLight.indirectSpecular *= terrainAO;\nreflectedLight.directDiffuse *= mix(1.0, terrainAO, 0.6);',
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
    // Map metres to the grid texture: sample i sits at texel centre (i + 0.5) / columns
    const sx = 1 / (p.grid.cellSize * p.grid.columns);
    const sy = 1 / (p.grid.cellSize * p.grid.rows);
    u.uGridUv.value.set(sx, sy, (p.width / 2) * sx + 0.5 / p.grid.columns, (p.depth / 2) * sy + 0.5 / p.grid.rows);
    u.uMapSize.value.set(p.width, p.depth);
    for (let k = 0; k < TERRAIN_MAX_LAYERS; k++) {
      u.uInvScale.value[k] = 1 / (p.scales[k] ?? 4);
      u.uAverage.value[k].set(p.averages[k] ?? '#808080');
    }
    for (let k = 0; k < 8; k++) u.uSplatLayer.value[k] = p.slots.splat[k] ?? -1;
    u.uCliffLayer.value = p.slots.cliff;
    u.uRoadLayer.value = p.slots.road;
    u.uPathLayer.value = p.slots.path;
    this.setCliffAngle(p.cliffAngle);
  }

  setCliffAngle(degrees: number): void {
    this.terrainUniforms.uCliffCos.value = Math.cos((degrees * Math.PI) / 180);
  }

  override customProgramCacheKey(): string {
    return 'custom-map-terrain-1';
  }
}

const TERRAIN_FRAGMENT_PARS = /* glsl */ `
precision highp sampler2DArray;
#define TERRAIN_LAYERS ${TERRAIN_MAX_LAYERS}
varying vec3 vTerrainPos;
varying vec3 vTerrainNormal;
uniform sampler2DArray uColorArray;
uniform sampler2DArray uDataArray;
uniform sampler2D uSplat0;
uniform sampler2D uSplat1;
uniform sampler2D uPathMask;
uniform sampler2D uGridNormals;
uniform vec4 uGridUv;
uniform vec2 uMapSize;
uniform float uInvScale[TERRAIN_LAYERS];
uniform vec3 uAverage[TERRAIN_LAYERS];
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
vec3 unpackTerrainNormal(vec4 dat) {
  vec2 xy = (dat.xy * 2.0 - 1.0) * vec2(1.0, -1.0);
  return vec3(xy, sqrt(max(0.0, 1.0 - dot(xy, xy))));
}
`;

const TERRAIN_SAMPLE = /* glsl */ `
vec3 tPos = vTerrainPos;
vec2 mapPos = vec2(-tPos.x, tPos.z);
// Beyond the map (the apron) there is no grid: vertex normals and the first layer
vec2 edgeDist = abs(mapPos) - uMapSize * 0.5;
float outside = smoothstep(0.0, 12.0, max(edgeDist.x, edgeDist.y));
vec3 nGeo = normalize(mix(texture2D(uGridNormals, mapPos * uGridUv.xy + uGridUv.zw).xyz, normalize(vTerrainNormal), outside));
vec2 tuv = mapPos / uMapSize + 0.5;
vec2 dPosX = dFdx(tPos.xz);
vec2 dPosY = dFdy(tPos.xz);

// Slow noise: macro variation, splat edge wobble, anti-tiling selector
float n1 = valueNoise(mapPos * 0.017);
float n2 = valueNoise(mapPos * 0.0041 + 17.0);
float n3 = valueNoise(mapPos * 0.11);
vec2 wobble = ((vec2(n3, valueNoise(mapPos * 0.11 + 31.0)) - 0.5) * 2.5
  + (vec2(valueNoise(mapPos * 0.6 + 7.0), valueNoise(mapPos * 0.6 + 13.0)) - 0.5) * 1.2) / uMapSize;

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
vec2 pm = texture2D(uPathMask, tuv).rg * (1.0 - outside);
float road = uRoadLayer >= 0 ? pm.r : 0.0;
float path = uPathLayer >= 0 ? pm.g * (1.0 - road) : 0.0;
float keep = 1.0 - road - path;
for (int k = 0; k < TERRAIN_LAYERS; k++) w[k] *= keep;
if (uRoadLayer >= 0) w[uRoadLayer] += road;
if (uPathLayer >= 0) w[uPathLayer] += path;

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
for (int k = 0; k < TERRAIN_LAYERS; k++) {
  if (w[k] < 0.004) continue;
  float s = uInvScale[k];
  vec4 col; vec4 dat;
  sampleNoTile(k, tPos.xz * s, dPosX * s, dPosY * s, sel, col, dat);
  vec3 tn = unpackTerrainNormal(dat);
  // Top projection: tangent x along scene +x, tangent y along scene +z (whiteout blend)
  vec3 nTop = normalize(vec3(tn.x + nGeo.x, tn.z * nGeo.y, tn.y + nGeo.z));
  if (k == uCliffLayer && tri.y < 0.98) {
    // Triplanar on the side planes (after Ben Golus, whiteout blend)
    vec4 cx; vec4 dx4; vec4 cz; vec4 dz4;
    sampleNoTile(k, sideX * s, sideXdx * s, sideXdy * s, sel, cx, dx4);
    sampleNoTile(k, sideZ * s, sideZdx * s, sideZdy * s, sel, cz, dz4);
    vec3 tx = unpackTerrainNormal(dx4);
    vec3 tz = unpackTerrainNormal(dz4);
    tx.x *= sgn.x;
    tz.x *= -sgn.z;
    tx = vec3(tx.xy + nGeo.zy, abs(tx.z) * nGeo.x);
    tz = vec3(tz.xy + nGeo.xy, abs(tz.z) * nGeo.z);
    nTop = normalize(tx.zyx * tri.x + nTop * tri.y + tz.xyz * tri.z);
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
const float band = 0.26;
float total = 0.0;
vec4 accC = vec4(0.0);
vec4 accD = vec4(0.0);
vec3 accN = vec3(0.0);
vec3 accAvg = vec3(0.0);
for (int k = 0; k < TERRAIN_LAYERS; k++) {
  if (w[k] < 0.004) continue;
  float b = max(lc[k].a + w[k] - best + band, 0.0) * w[k];
  accC += lc[k] * b;
  accD += ld[k] * b;
  accN += ln[k] * b;
  accAvg += uAverage[k] * b;
  total += b;
}
accC /= total;
accD /= total;
accAvg /= total;
vec3 terrainNormal = normalize(accN);

// Macro variation and far blend
vec3 albedo = accC.rgb;
float macro = n1 * 0.6 + n2 * 0.4;
albedo *= mix(0.86, 1.1, macro);
albedo = mix(albedo, albedo * vec3(1.08, 1.04, 0.86), smoothstep(0.55, 0.85, n2) * 0.5);
float far = smoothstep(120.0, 900.0, length(vViewPosition));
albedo = mix(albedo, accAvg * mix(0.8, 1.15, macro), far * 0.45);

float terrainRough = clamp(accD.b, 0.3, 1.0);
float terrainAO = mix(1.0, accD.a, 0.85);
diffuseColor.rgb = albedo;
`;
