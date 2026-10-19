import { Color, ShaderChunk, MeshStandardMaterial, SRGBColorSpace, Vector2, Vector3, Vector4, type DataArrayTexture, type Texture } from 'three';
import type { LayerArray } from './terrain-textures';
import { SHADER_NOISE } from '../shader-noise';
import { TERRAIN_HEIGHT_VERTEX, TERRAIN_NORMAL_VERTEX, TERRAIN_VERTEX_PARS } from './terrain-chunks';
import type { MapWaterKind } from '../../map-document';
import { shoreWaves } from '../water/shore-waves';
import { VARIATION_GLSL, variationTexture } from './variation-texture';
import { WIND_UNIFORMS } from '../environment/wind';
import { TERRAIN_CUT_GLSL } from './terrain-cuts';
import type { MaterialCategory } from '../asset-catalog';
import type { MapBiome } from '../../map-document';
import { groundMood } from './ground-mood';

/**
 * How a ground material of a catalogue category blends and shines: `soft`
 * scales the height blend band against its neighbours (grass and sand run
 * into them, rock and ice cut), `rough` is the roughness range its
 * texture's roughness maps into (mud and ice glossier, grass and sand matt),
 * `coarse` how strongly its own texture, read again at a coarse scale,
 * shapes it over tens of metres (grass in tussocks and patches, soil in
 * stony and damp spots; roads and planks hardly), `turf` whether it is a
 * sward that tears open on steep, convex slopes
 */
interface MaterialLook {
  soft: number;
  rough: [number, number];
  coarse: number;
  turf: number;
}

const MATERIAL_LOOK: Record<MaterialCategory, MaterialLook> = {
  grass: { soft: 1.4, rough: [0.72, 1], coarse: 0.62, turf: 1 },
  forest: { soft: 1.3, rough: [0.68, 1], coarse: 0.55, turf: 0.7 },
  soil: { soft: 1.2, rough: [0.5, 0.95], coarse: 0.5, turf: 0 },
  sand: { soft: 1.5, rough: [0.62, 0.96], coarse: 0.4, turf: 0 },
  snow: { soft: 1.3, rough: [0.45, 0.82], coarse: 0.3, turf: 0 },
  rock: { soft: 0.6, rough: [0.45, 0.9], coarse: 0.4, turf: 0 },
  road: { soft: 0.8, rough: [0.5, 0.9], coarse: 0.15, turf: 0 },
  volcanic: { soft: 0.8, rough: [0.4, 0.9], coarse: 0.4, turf: 0 },
  ice: { soft: 0.7, rough: [0.12, 0.45], coarse: 0.25, turf: 0 },
  wood: { soft: 0.8, rough: [0.5, 0.85], coarse: 0.1, turf: 0 },
};

export function materialLook(category: MaterialCategory | undefined): MaterialLook {
  return (category && MATERIAL_LOOK[category]) || { soft: 1, rough: [0.6, 1], coarse: 0.35, turf: 0 };
}

/**
 * The terrain's material: a MeshStandardMaterial (scene lights, shadows,
 * fog, log depth and tone mapping as every other standard material) whose
 * albedo, normal, roughness and AO come from blended ground layers.
 *
 * Per fragment:
 * 1. Splat weights of the map's layers (two RGBA layers of one array, a third past 8 layers), the road and path
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
 * 5. Coarse structure: the strongest layer reads its own colour texture
 *    again at about six times its scale and shapes the ground with it over
 *    tens of metres, at every distance (the second anti-tiling colour
 *    lookup of far layers goes for it). The ground's mood per biome
 *    (ground-mood.ts) tints crests, hollows, runnels and patches, and turf
 *    tears open on steep, convex slopes.
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
  /** The splat maps as one array (SplatTextures): two layers, three on a map with more than 8 layers */
  splat: DataArrayTexture;
  /** Splat channels the shader reads when not the array's (warm-up twins of a larger variant): 8 or 12 */
  splatLayers?: number;
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
  /** 1 for a paved array layer (catalogue `paved`): no wear, tints or scree on it */
  paved?: number[];
  width: number;
  depth: number;
  cliffAngle: number;
  splatResolution?: number;
  /** Layers the shader loops over, when not the array's (warm-up twins of a larger variant) */
  layers?: number;
  /** Draws the ground's colour alone, unlit, as from a few dozen metres (ground-albedo.ts bakes the map with it) */
  albedoBake?: boolean;
}

export class TerrainMaterial extends MeshStandardMaterial {
  readonly terrainUniforms = {
    uColorArray: { value: null as LayerArray | null },
    uDataArray: { value: null as LayerArray | null },
    uSplats: { value: null as DataArrayTexture | null },
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
    /** Coarse self-structure and turf by array layer (MATERIAL_LOOK) */
    uCoarse: { value: new Float32Array(TERRAIN_MAX_LAYERS) },
    uTurf: { value: new Float32Array(TERRAIN_MAX_LAYERS) },
    uPaved: { value: new Float32Array(TERRAIN_MAX_LAYERS) },
    /** The biome's ground mood (ground-mood.ts): tints of crests, hollows, runnels and patches, bare earth, saturation */
    uMoodCrest: { value: new Vector3(1, 1, 1) },
    uMoodHollow: { value: new Vector3(1, 1, 1) },
    uMoodDrain: { value: new Vector3(1, 1, 1) },
    uMoodPatchA: { value: new Vector3(1, 1, 1) },
    uMoodPatchB: { value: new Vector3(1, 1, 1) },
    uMoodBare: { value: new Color() },
    uMoodWorn: { value: new Color() },
    uMoodShore: { value: new Color() },
    uMoodClover: { value: new Vector3(1, 1, 1) },
    uMoodFlower: { value: new Color() },
    uMoodSat: { value: 0.94 },
    uTerrainTime: { value: 0 },
    uSplatLayer: { value: new Int32Array(12).fill(-1) },
    uCliffLayer: { value: -1 },
    uRoadLayer: { value: -1 },
    uPathLayer: { value: -1 },
    uCliffCos: { value: Math.cos((40 * Math.PI) / 180) },
    /** Where the far cascade of the sun's shadow applies (far-shadow.ts; the shadow is the light grid's); replaced by MapTerrainLayer's */
    /** The wind's direction (the shared wind uniform), where snow drifts pile up */
    uDriftWind: WIND_UNIFORMS.uWindDir,
    uFarShadowArea: { value: new Vector4() },
    /** Replaced by TerrainChunks.uniforms (MapTerrainLayer): the height grid and the geomorph's camera */
    uMorphEye: { value: new Vector3() },
    uMorphFocus: { value: new Vector3(1e9, 0, 1e9) },
    uTerrainHeights: { value: null as Texture | null },
    uTerrainGrid: { value: new Vector4() },
    uTerrainGridSize: { value: new Vector2(1, 1) },
    /** Replaced by TerrainCuts.uniforms (MapTerrainLayer); none without */
    uCutMap: { value: null as Texture | null },
    uCutGrid: { value: new Vector4() },
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

  /** The colour bake's variant (TerrainMaterialParams.albedoBake) */
  readonly albedoBake: boolean;

  constructor(params: TerrainMaterialParams) {
    super({ roughness: 1, metalness: 0 });
    this.name = 'custom-map-terrain';
    // The terrain glows by lava itself (TERRAIN_SAMPLE): not again through the objects' lava glow
    this.userData['noLavaGlow'] = true;
    this.layerCount = terrainLayerCount(params.layers ?? params.colorArray.image.depth);
    this.splatLayers = (params.splatLayers ?? params.splat.image.depth * 4) > 8 ? 12 : 8;
    this.albedoBake = !!params.albedoBake;
    this.setParams(params);
    this.setGroundMood('temperate');
    this.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.terrainUniforms);
      shader.vertexShader = shader.vertexShader
        // The chunks' heights and normals from the grid on the GPU (terrain-chunks.ts); the apron brings its own
        .replace('#include <common>', `#include <common>\nvarying vec3 vTerrainPos;\nvarying vec3 vTerrainNormal;\n#ifndef TERRAIN_APRON\n${TERRAIN_VERTEX_PARS}\n#endif`)
        .replace('#include <beginnormal_vertex>', `#ifdef TERRAIN_APRON\n#include <beginnormal_vertex>\n#else\n${TERRAIN_NORMAL_VERTEX}\n#endif`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>\n#ifndef TERRAIN_APRON\n${TERRAIN_HEIGHT_VERTEX}\n#endif\nvTerrainPos = transformed;\nvTerrainNormal = objectNormal;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>\n#define TERRAIN_LAYERS ${this.layerCount}\n#define TERRAIN_SPLATS ${this.splatLayers}\n${this.albedoBake ? '#define TERRAIN_ALBEDO_BAKE\n' : ''}${TERRAIN_FRAGMENT_PARS}`,
        )
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
    u.uSplats.value = p.splat;
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
      u.uCoarse.value[k] = look.coarse;
      u.uTurf.value[k] = look.turf;
      u.uPaved.value[k] = p.paved?.[k] ?? 0;
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

  /** How the ground reads crests, hollows and runnels in this biome (ground-mood.ts) */
  setGroundMood(biome: MapBiome): void {
    const m = groundMood(biome);
    const u = this.terrainUniforms;
    u.uMoodCrest.value.fromArray(m.crest);
    u.uMoodHollow.value.fromArray(m.hollow);
    u.uMoodDrain.value.fromArray(m.drain);
    u.uMoodPatchA.value.fromArray(m.patchA);
    u.uMoodPatchB.value.fromArray(m.patchB);
    u.uMoodBare.value.setRGB(m.bare[0], m.bare[1], m.bare[2], SRGBColorSpace);
    u.uMoodWorn.value.setRGB(m.worn[0], m.worn[1], m.worn[2], SRGBColorSpace);
    u.uMoodShore.value.setRGB(m.shore[0], m.shore[1], m.shore[2], SRGBColorSpace);
    u.uMoodClover.value.fromArray(m.clover);
    u.uMoodFlower.value.setRGB(m.flower[0], m.flower[1], m.flower[2], SRGBColorSpace);
    u.uMoodSat.value = m.saturation;
  }

  setCliffAngle(degrees: number): void {
    this.terrainUniforms.uCliffCos.value = Math.cos((degrees * Math.PI) / 180);
  }

  override customProgramCacheKey(): string {
    return `custom-map-terrain-4-${this.layerCount}-${this.splatLayers}${this.albedoBake ? '-albedo' : ''}`;
  }
}

const TERRAIN_FRAGMENT_PARS = /* glsl */ `
precision highp sampler2DArray;
varying vec3 vTerrainPos;
varying vec3 vTerrainNormal;
uniform sampler2DArray uColorArray;
uniform sampler2DArray uDataArray;
// The splat maps, a layer each (SplatTextures)
uniform sampler2DArray uSplats;
uniform sampler2D uPathMask;
#ifdef TERRAIN_APRON
uniform sampler2D uApronPaint;
#endif
uniform sampler2D uGridNormals;
uniform sampler2D uGridOcclusion;
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
uniform float uCoarse[TERRAIN_LAYERS];
uniform float uTurf[TERRAIN_LAYERS];
uniform float uPaved[TERRAIN_LAYERS];
uniform vec3 uMoodCrest;
uniform vec3 uMoodHollow;
uniform vec3 uMoodDrain;
uniform vec3 uMoodPatchA;
uniform vec3 uMoodPatchB;
uniform vec3 uMoodBare;
uniform vec3 uMoodWorn;
uniform vec3 uMoodShore;
uniform vec3 uMoodClover;
uniform vec3 uMoodFlower;
uniform float uMoodSat;
// How far off the camera stands, for what changes with distance (far ground cheaper, its blend to the average). The
// colour bake (ground-albedo.ts) sees the ground as from a few dozen metres, where grass and water read it
#ifdef TERRAIN_ALBEDO_BAKE
#define TERRAIN_VIEW_DIST 30.0
#else
#define TERRAIN_VIEW_DIST length(vViewPosition)
#endif
// The coarse self-structure's scale against a layer's own (no simple fraction: the repeats never line up)
#define COARSE_SCALE 0.157
uniform float uTerrainTime;
uniform int uSplatLayer[12];
uniform int uCliffLayer;
uniform int uRoadLayer;
uniform int uPathLayer;
uniform float uCliffCos;
uniform float uSteepNear;
#ifndef TERRAIN_APRON
${TERRAIN_CUT_GLSL}
#endif
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
  vec4 da = textureGrad(uDataArray, vec3(uv + offa, float(layer)), dx, dy);
  // Far ground: one lookup of each; the coarse self-structure of the strongest layer (TERRAIN_SAMPLE) breaks
  // the repeat there
  if (single) {
    col = ca;
    dat = da;
    return;
  }
  vec4 cb = textureGrad(uColorArray, vec3(uv + offb, float(layer)), dx, dy);
  float b = smoothstep(0.2, 0.8, f - 0.1 * dot(ca.rgb - cb.rgb, vec3(1.0)));
  col = mix(ca, cb, b);
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
`;

/**
 * three's light loop with the far cascade applied to the sun (the scene's
 * only directional light): after its shadow map, before it lights
 */
const TERRAIN_LIGHTS = ShaderChunk.lights_fragment_begin.replace(
  /(vDirectionalShadowCoord\[ i \] \) : 1\.0;\s*#endif)/,
  '$1\n\t\tdirectLight.color *= terrainFarSun;',
);

const TERRAIN_SAMPLE = /* glsl */ `
vec3 tPos = vTerrainPos;
vec2 mapPos = vec2(-tPos.x, tPos.z);
// The sun's light left by the far cascade (TERRAIN_LIGHTS): 1 inside the cached shadow map, beyond it the baked
// land shadow, the alpha of the light grid's flickering layer (far-shadow.ts, height-fog.ts's lamp light)
float terrainFarSun = 1.0;
if (uFarShadowArea.w > 0.5) {
  float beyond = smoothstep(0.7, 0.95, length(mapPos - uFarShadowArea.xy) / uFarShadowArea.z);
  if (beyond > 0.0) terrainFarSun = mix(1.0, texture(uLampGrid, vec3(mapPos * uLampGridUv.xy + uLampGridUv.zw, 1.0)).a, beyond);
}
#ifndef TERRAIN_APRON
// Inside the opening of a model set into the ground (a tunnel's vault): the model's own surfaces show
if (terrainCut(mapPos, tPos.y)) discard;
#endif
// What the lighting reads of the ground (set below, or plainly under a road surface)
vec3 terrainNormal;
float terrainRough;
float terrainSpec;
float terrainAO;
vec3 accGlow = vec3(0.0);
// Under the middle of a road surface (path-mask.ts covers) only the road shows: the ground does none of its work
// (the mask's read where the ground lies, which the wet banks take too)
vec4 pathHere = texture2D(uPathMask, mapPos / uMapSize + 0.5);
#ifdef TERRAIN_APRON
bool underRoad = false;
#else
bool underRoad = pathHere.b > 0.996 && pathHere.r + pathHere.g < 0.002;
#endif
if (underRoad) {
  terrainNormal = normalize(vTerrainNormal);
  terrainRough = 0.9;
  terrainSpec = 0.25;
  terrainAO = 1.0;
  diffuseColor.rgb = vec3(0.1);
} else {
// Beyond the map (the apron) there is no grid: vertex normals, and the border's natural ground (below)
vec2 edgeDist = abs(mapPos) - uMapSize * 0.5;
float outside = smoothstep(0.0, 12.0, max(edgeDist.x, edgeDist.y));
vec4 gridSample = texture2D(uGridNormals, mapPos * uGridUv.xy + uGridUv.zw);
vec3 nGeo = safeNormalize(mix(gridSample.xyz, normalize(vTerrainNormal), outside), vec3(0.0, 1.0, 0.0));
// Banks just above the water are wet: darker and glossier. The grid's alpha is 1 within two samples of the
// water and fades to 0 four samples further (the shore strip, below)
float nearWater = smoothstep(0.9, 1.0, gridSample.a);
float wetBank = nearWater * smoothstep(uWaterLevel + 1.3, uWaterLevel + 0.15, tPos.y) * (1.0 - outside);
wetBank = max(wetBank, pathHere.a * (1.0 - outside) * 0.85);
// Swash: each foam band that reaches the shore runs up the bank and drains away (shore-waves.ts, same phase)
float swash = 0.0;
if (uSwashSpeed > 0.0) {
  float q = fract(uTerrainTime * uSwashSpeed + 0.04);
  float runup = uWaterLevel + 0.03 + 0.28 * (1.0 - smoothstep(0.0, 0.55, q));
  swash = nearWater * smoothstep(runup + 0.04, runup - 0.04, tPos.y) * smoothstep(uWaterLevel - 0.2, uWaterLevel + 0.02, tPos.y) * (1.0 - outside);
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
vec4 s0 = texture(uSplats, vec3(tuv + wobble, 0.0));
vec4 s1 = texture(uSplats, vec3(tuv + wobble, 1.0));
#if TERRAIN_SPLATS > 8
// The third map only on maps with more than 8 layers
vec4 s2 = texture(uSplats, vec3(tuv + wobble, 2.0));
float sw[TERRAIN_SPLATS] = float[TERRAIN_SPLATS](s0.r, s0.g, s0.b, s0.a, s1.r, s1.g, s1.b, s1.a, s2.r, s2.g, s2.b, s2.a);
#else
float sw[TERRAIN_SPLATS] = float[TERRAIN_SPLATS](s0.r, s0.g, s0.b, s0.a, s1.r, s1.g, s1.b, s1.a);
#endif
float sum = 0.0;
for (int k = 0; k < TERRAIN_SPLATS; k++) if (uSplatLayer[k] >= 0) sum += sw[k];
if (sum < 0.001) { sw[0] = 1.0; sum = 1.0; }
for (int k = 0; k < TERRAIN_SPLATS; k++) if (uSplatLayer[k] >= 0) w[uSplatLayer[k]] += sw[k] / sum * (1.0 - outside);
// Beyond the map the border's natural ground runs on (apron-paint.ts), at the point of the border nearest. The
// chunks lie within the map: only the apron's program has it (a texture unit less for the ground's)
#ifdef TERRAIN_APRON
if (outside > 0.0) {
  vec2 hm = uMapSize * 0.5;
  vec2 q = clamp(mapPos, -hm, hm);
  vec2 e = abs(mapPos) - hm;
  // Metres along the border, counter-clockwise from the south-west corner (south, east, north, west)
  float along = e.y >= e.x
    ? (mapPos.y < 0.0 ? q.x + hm.x : 2.0 * uMapSize.x + uMapSize.y - (q.x + hm.x))
    : (mapPos.x > 0.0 ? uMapSize.x + q.y + hm.y : 2.0 * (uMapSize.x + uMapSize.y) - (q.y + hm.y));
  float perimeter = 2.0 * (uMapSize.x + uMapSize.y);
  float au = along / perimeter;
  // Further out the paint blurs along the border as the apron's heights do (terrain-apron.ts: 0.6 of the
  // distance either way, a quarter of the border at most): a change of ground at the border fans out into a
  // soft blend on the backdrop range instead of a straight seam running to the horizon
  float spread = min(max(e.x, e.y) * 0.6 / perimeter, 0.25) / 3.0;
  float apron = 0.0;
  for (int r = 0; r < TERRAIN_SPLATS / 4; r++) {
    float v = (float(r) + 0.5) / 3.0;
    vec4 a = vec4(0.0);
    for (int t = -3; t <= 3; t++) a += textureLod(uApronPaint, vec2(au + float(t) * spread, v), 0.0) * float(4 - abs(t));
    a /= 16.0;
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
#endif

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

// The ground's shape, baked with its occlusion (ground-occlusion.ts, the same fetch): crests and knolls dry
// and pale, hollows and runnels damp and darker, scree at the feet of steep slopes, cooled rock around lava
vec4 shape = texture2D(uGridOcclusion, mapPos * uGridUv.xy + uGridUv.zw);
float inside = 1.0 - outside;
float lavaNear = shape.a * inside;
// Around lava the ground turns to rock (the biome's cliff layer, with its strata, then cooled and scorched
// below): its sand or dust kept its flat paint under the dark tint and the glow, and the crater walls read as
// a smooth orange sheet. Ragged edge, a few metres out from the lava
float scorched = smoothstep(0.4, 0.75, lavaNear + (varFine.a - 0.5) * 0.3 + (n3 - 0.5) * 0.2);

// Cliffs above the slope threshold, edge broken up by noise
float cliff = 0.0;
if (uCliffLayer >= 0) {
  // The rock's edge is broken, not a height contour: blocks of rock reach down into the scree and the
  // scree runs up the rock in tongues along the fall line, at several scales over the map. Short tongues:
  // 20 m long ones drew the grass and the rock as brush strokes down every flank
  vec2 fall = normalize(vec2(-nGeo.x, nGeo.z) + 1e-4);
  float tongue = valueNoise(vec2(dot(mapPos, vec2(-fall.y, fall.x)) * 0.3, dot(mapPos, fall) * 0.14));
  float broken = (n3 - 0.5) * 0.12 + (varFine.a - 0.5) * 0.1 + (varFiner.b - 0.5) * 0.07 + (tongue - 0.5) * 0.1;
  float c = uCliffCos + broken;
  cliff = smoothstep(c + 0.035, c - 0.035, nGeo.y);
  // Glowing ground (lava cracks) keeps its paint however steep: a volcano's flanks and crater walls lie past
  // the cliff angle, and the rock covered every crack painted on them
  float hotPaint = 0.0;
  for (int k = 0; k < TERRAIN_LAYERS; k++) hotPaint += uEmissive[k] > 0.0 ? w[k] : 0.0;
  cliff *= 1.0 - clamp(hotPaint, 0.0, 1.0);
  cliff = max(cliff, scorched);
  for (int k = 0; k < TERRAIN_LAYERS; k++) w[k] *= 1.0 - cliff;
  w[uCliffLayer] += cliff;
}

// Coarse self-structure: the strongest layer's own colour texture at about six times its scale, one lookup
// at every distance; it shapes the ground below (after the far blend, so distant land keeps it)
int domLayer = 0;
float domW = -1.0;
for (int k = 0; k < TERRAIN_LAYERS; k++) {
  if (w[k] > domW) {
    domW = w[k];
    domLayer = k;
  }
}
float coarseS = uInvScale[domLayer] * COARSE_SCALE;
vec3 coarseCol = textureGrad(uColorArray, vec3(tPos.xz * coarseS + vec2(0.37, 0.71), float(domLayer)), dPosX * coarseS, dPosY * coarseS).rgb;

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
float viewDist = TERRAIN_VIEW_DIST;
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
terrainNormal = safeNormalize(accN, nGeo);

// Macro variation and far blend
vec3 albedo = accC.rgb;
float macro = n1 * 0.6 + n2 * 0.4;
albedo *= mix(0.86, 1.1, macro) * mix(0.93, 1.06, n3);
// A paved surface keeps its own look: the ground's wear, tints, islands and scree below stay off it (paved weight)
float paved = 0.0;
for (int k = 0; k < TERRAIN_LAYERS; k++) paved += w[k] * uPaved[k];
paved = smoothstep(0.15, 0.6, paved);
vec3 pavedAlbedo = albedo;
// Large patches in the biome's two kinds (ground-mood.ts): drier and sunlit in some, lush and cool in others
albedo = mix(albedo, albedo * uMoodPatchA, smoothstep(0.5, 0.85, n2) * 0.5);
albedo = mix(albedo, albedo * uMoodPatchB, smoothstep(0.45, 0.15, n1) * 0.6);
// And the same two kinds again in patches of about a dozen metres with firm edges (a stand of clover, a dry
// knoll, a damp spot), and clumps of a few metres: what a meadow or a sand flat shows from the game camera
float midPatch = varFine.r * 0.7 + n3 * 0.3;
albedo = mix(albedo, albedo * uMoodPatchA, smoothstep(0.56, 0.62, midPatch) * 0.8);
albedo = mix(albedo, albedo * uMoodPatchB, smoothstep(0.43, 0.37, midPatch) * 0.6);
albedo *= mix(0.9, 1.06, smoothstep(0.35, 0.65, varFiner.r));
// Photo grass reads olive under a warm sun: where green leads, pull red and blue back a little
float greenLead = smoothstep(0.0, 0.08, albedo.g - max(albedo.r, albedo.b));
albedo *= mix(vec3(1.0), vec3(0.86, 1.04, 0.92), greenLead);
// The biome's saturation: photo textures under a strong sun read too green, a marsh or a wasteland duller still
albedo = mix(vec3(dot(albedo, vec3(0.299, 0.587, 0.114))), albedo, uMoodSat);
float far = smoothstep(120.0, 900.0, TERRAIN_VIEW_DIST);
albedo = mix(albedo, accAvg * mix(0.8, 1.15, macro), far * 0.45);
// The coarse structure as the layer's own light and dark and its hue drift (dry blades, damp earth) against its
// average colour; not on rock faces (a top projection) nor on glowing ground
// Photo textures are even by nature (a lawn, a gravel bed): their deviation from the mean is drawn out, so the
// clumps, stones and damp spots of the texture read from the game camera as tussocks and patches
vec3 coarseRatio = coarseCol / max(uAverage[domLayer], vec3(0.02));
float coarseLum = clamp(1.0 + (dot(coarseRatio, vec3(0.3333)) - 1.0) * 2.4, 0.5, 1.6);
vec3 coarseHue = clamp(1.0 + (coarseRatio / max(dot(coarseRatio, vec3(0.3333)), 0.05) - 1.0) * 1.8, vec3(0.7), vec3(1.35));
float coarseAmount = uCoarse[domLayer] * clamp(domW, 0.0, 1.0) * (1.0 - cliff) * (uEmissive[domLayer] > 0.0 ? 0.0 : 1.0);
albedo *= mix(vec3(1.0), coarseHue * coarseLum, coarseAmount);
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
  // Gullies: dark streaks running down the face, a couple of metres wide across it and broken every
  // dozen metres down it. Across a fixed map direction and 80 m long they were stripes pulled down the
  // whole wall, or one shade on a wall along that direction
  vec2 faceFall = normalize(vec2(-nGeo.x, nGeo.z) + 1e-4);
  float streak = valueNoise(vec2(dot(mapPos, vec2(-faceFall.y, faceFall.x)) * 0.5, tPos.y * 0.08 + 5.0));
  float gully = mix(0.84, 1.04, smoothstep(0.15, 0.65, streak));
  float shade = strata * gully;
  vec3 bandTint = mix(vec3(0.93, 0.95, 0.99), vec3(1.06, 1.0, 0.91), bandNoise);
  albedo = mix(albedo, albedo * shade * bandTint, cliff);
}

// The ground's shape (fetched above, before the cliffs)
float curv = (shape.g - 0.5) * 2.0 * inside;
float crest = smoothstep(0.04, 0.4, curv) * (1.0 - cliff);
float hollow = smoothstep(0.04, 0.4, -curv) * (1.0 - cliff);
float drain = smoothstep(0.35, 0.9, shape.b) * inside * (1.0 - cliff);
// In the biome's mood: a temperate crest dries to straw, a marsh hollow is peat, a desert runnel salt
albedo = mix(albedo, albedo * uMoodCrest, crest * 0.8);
albedo = mix(albedo, albedo * uMoodHollow * 0.9, hollow);
albedo = mix(albedo, albedo * uMoodDrain * 0.8, drain);
// Turf tears open on steep, convex slopes below the cliff angle: tongues of the biome's bare earth down the
// fall line, more on crests, in the coarse structure's dark spots first
float turf = 0.0;
for (int k = 0; k < TERRAIN_LAYERS; k++) turf += w[k] * uTurf[k];
float tearSlope = smoothstep(0.965, 0.87, nGeo.y) * (1.0 - cliff) * inside * turf;
if (tearSlope > 0.01) {
  vec2 tearFall = normalize(vec2(-nGeo.x, nGeo.z) + 1e-4);
  float tearTongue = valueNoise(vec2(dot(mapPos, vec2(-tearFall.y, tearFall.x)) * 0.45, dot(mapPos, tearFall) * 0.11));
  float tearAt = tearTongue * 0.55 + varFine.b * 0.3 + (1.0 - coarseLum) * 0.35 + crest * 0.25;
  float tear = smoothstep(0.62, 0.78, tearAt) * min(1.0, tearSlope * 2.2);
  albedo = mix(albedo, uMoodBare * (0.8 + 0.4 * coarseLum), tear * 0.85);
}
float natural = clamp(1.0 - road - path, 0.0, 1.0) * inside * (1.0 - cliff);
// Islands of clover in flower on level, open grass (not on crests, not in hollows), a dozen metres across with
// ragged rims; near the camera the blossoms are single spots, from afar they blend into a pale haze
float levelGround = smoothstep(0.94, 0.985, nGeo.y);
// The island field from the 512 m and 96 m variation (blots of about 9 and 12 m), never the 28 m one: that
// texture repeats every 28 m and laid the islands out in a strict grid over the whole map
float islandField = varCoarse.b * 0.55 + varFine.r * 0.45;
float islands = smoothstep(0.64, 0.72, islandField) * levelGround * (1.0 - crest) * (1.0 - hollow) * natural;
islands *= clamp(turf, 0.0, 1.0);
if (islands > 0.01) {
  // Clover everywhere on the island, the bloom thick at its heart and thinning in tongues to its rim; each island
  // flowers in its own shade (warmer or paler, the biome's colour either way)
  float heart = smoothstep(0.35, 0.75, islands * (0.6 + 0.8 * varFiner.a));
  float bloom = smoothstep(0.64, 0.74, texture2D(uVariation, mapPos / 3.1 + 0.19).b);
  float haze = smoothstep(40.0, 160.0, viewDist);
  vec3 flower = uMoodFlower * mix(vec3(1.06, 1.0, 0.82), vec3(0.96, 0.98, 1.06), varFine.a);
  vec3 sward = albedo * uMoodClover;
  albedo = mix(albedo, mix(sward, flower, mix(bloom, 0.14, haze) * heart), islands * 0.8);
}
// Trodden rims along roads and paths: a coarse level of the path mask (about 2.2 m) is a halo round them;
// outside the way itself the sward is trampled darker, then worn to the biome's bare earth in ragged tongues
float maskTexel = uMapSize.x / float(textureSize(uPathMask, 0).x);
vec4 halo4 = textureLod(uPathMask, tuv, log2(max(2.2 / maskTexel, 1.0)));
float worn = clamp((halo4.r + halo4.g) * 2.0, 0.0, 1.0) * natural;
if (worn > 0.01) {
  float wornAt = worn + (varFine.a - 0.5) * 0.5 + (varFiner.b - 0.5) * 0.35;
  albedo *= 1.0 - 0.28 * smoothstep(0.08, 0.35, wornAt);
  albedo = mix(albedo, uMoodWorn * (0.8 + 0.4 * coarseLum), smoothstep(0.36, 0.56, wornAt) * 0.9);
}
// Along the water a strip of the biome's shore (pale gravel, mud, frost): the grid's fading halo round the
// main water, below a couple of metres above its level, its upper edge ragged
float shore = smoothstep(0.0, 0.55, gridSample.a + (varFine.b - 0.5) * 0.35) * natural * (1.0 - nearWater * 0.5)
  * (uWaterLevel > -1e3 ? smoothstep(uWaterLevel + 2.6, uWaterLevel + 0.6, tPos.y) : 1.0);
albedo = mix(albedo, uMoodShore * (0.82 + 0.36 * coarseLum) * mix(0.85, 1.12, smoothstep(0.3, 0.7, varFiner.b)), shore * 0.8);
// Scree: at the foot of rock and steep slopes (the occlusion is low there), more in hollows and on what still
// slopes, the cliff's rock spills out as stones, light and dark
if (uCliffLayer >= 0) {
  float foot = smoothstep(0.9, 0.62, shape.r) * natural;
  float scree = foot * smoothstep(0.3, 0.6, varFine.b * 0.6 + hollow * 0.5 + (1.0 - nGeo.y) * 2.5);
  vec3 stones = uAverage[uCliffLayer] * mix(0.68, 1.18, smoothstep(0.3, 0.7, varFiner.b)) * mix(0.9, 1.05, varFine.a);
  albedo = mix(albedo, stones, scree * 0.8);
}
// Back to the paved surface's own colour where it lies; only a little grime in its joints (the texture's low
// heights) near its edge, where the trodden ground meets it
if (paved > 0.0) {
  float joints = smoothstep(0.35, 0.1, accC.a) * (0.5 + 0.5 * worn);
  albedo = mix(albedo, pavedAlbedo * (1.0 - 0.14 * joints) * mix(vec3(1.0), uMoodWorn / max(dot(uMoodWorn, vec3(0.333)), 0.05), 0.12 * joints), paved);
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
// Around lava the ground is cooled rock: farther out baked rust-dark, at the lava black basalt. Both keep the
// rock's own light and dark (its texture and strata against its average, drawn out): one flat colour there,
// under the glow and the lava's lights, read as a smooth orange sheet
if (lavaNear > 0.01) {
  float rockLum = dot(albedo, vec3(0.3333)) / max(dot(accAvg, vec3(0.3333)), 0.02);
  float grain = clamp(1.0 + (rockLum - 1.0) * 1.1, 0.5, 1.5) * mix(0.82, 1.12, varFiner.b);
  float baked = smoothstep(0.2, 0.6, lavaNear + (varFiner.a - 0.5) * 0.2);
  albedo = mix(albedo, albedo * vec3(0.52, 0.3, 0.22), baked * 0.85);
  vec3 basalt = mix(vec3(0.075, 0.064, 0.058), vec3(0.11, 0.07, 0.05), smoothstep(0.4, 0.7, varFine.b));
  albedo = mix(albedo, basalt * grain, smoothstep(0.55, 0.85, lavaNear));
  // Lit orange from below with the lava's slow pulse, strongest in the rock's cracks and hollows (its low
  // heights), faint on its knobs
  float seams = mix(0.4, 1.5, smoothstep(0.6, 0.15, accC.a));
  accGlow += vec3(1.0, 0.32, 0.06) * pow(lavaNear, 4.0) * 0.22 * seams * (0.85 + 0.15 * sin(uTerrainTime * 1.1 + mapPos.x * 0.05));
}
albedo *= mix(1.0, 0.6, wetBank);
// Soil, grass and rock are rough and barely shiny: against the sun at a grazing angle the full
// specular of a standard material turned meadows and yards into white sheets. Wet banks keep a sheen
terrainRough = mix(mix(accD.b, 0.45, wetBank), 0.25, swash) * (1.0 - drain * 0.2);
terrainSpec = mix(0.25, 0.6, wetBank);
// Against the light at a grazing angle the specular turned smooth rock and packed earth into white sheets:
// it fades towards the edge of view (a damped Fresnel for ground that is never a mirror)
float grazing = 1.0 - max(dot(normalize((viewMatrix * vec4(terrainNormal, 0.0)).xyz), normalize(vViewPosition)), 0.0);
terrainSpec *= 1.0 - 0.6 * pow(grazing, 4.0);
// Texture AO and the baked ground occlusion (hollows, slope feet, contact shadows of objects)
float groundAO = mix(shape.r, 1.0, outside);
terrainAO = mix(1.0, accD.a, 0.85) * groundAO;
diffuseColor.rgb = albedo;
}
#ifdef TERRAIN_ALBEDO_BAKE
// The bake keeps the colour alone (linear; the target's sRGB encodes it): nothing of the lighting below
gl_FragColor = vec4(diffuseColor.rgb, 1.0);
return;
#endif
`;
