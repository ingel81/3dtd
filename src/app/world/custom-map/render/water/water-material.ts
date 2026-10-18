import {
  Color,
  Matrix4,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector4,
  type Texture,
} from 'three';
import type { MapWaterKind } from '../../map-document';
import { HEIGHT_FOG_PARS, HEIGHT_FOG_UNIFORMS, heightFogFragment } from '../environment/height-fog';
import { LAMP_LIGHT_PARS, LAMP_LIGHT_UNIFORMS } from '../effects/lamp-light';
import { SHOT_LIGHT_PARS, SHOT_LIGHT_UNIFORMS } from '../../../../three-engine/shot-lights/shot-light-shader';
import { SKY_FUNCTIONS, SKY_TEXTURE_GLSL } from '../environment/sky-dome';
import { SHADER_NOISE } from '../shader-noise';
import { TERRAIN_HEIGHT_GLSL, type HeightTexture } from '../terrain/height-texture';
import { GROUND_COLOR_GLSL, GROUND_COLOR_UNIFORMS } from '../terrain/ground-color';
import { FLOW_MAP_MAX, SHORE_FIELD_MAX, SLOPE_FIELD_MAX } from './flow-map';
import { SHORE_PHASE_GLSL, shoreWaves } from './shore-waves';
import { foamNoiseTexture } from './foam-noise';
import { lavaNoiseTexture } from './lava-noise';
import { waveTexture } from './wave-noise';
import { SCENE_COPY_GLSL, type SceneCopy } from './scene-copy';
import { SHORE_CUT_DEPTH, SHORE_CUT_SCALE } from './shore-cut';
import type { MapEffects } from '../map-effects';
import type { WaterReflection } from './water-reflection';

/**
 * The material of every water body (lake, sea, swamp, ice, lava; areas and
 * rivers). Depth per pixel is the surface height minus the terrain height
 * under it (HeightTexture), so the shoreline is where the terrain cuts the
 * surface: smooth, whatever the grid. Area bodies also fade out by their
 * mask (bilinear), so a mask edge over low ground is rounded, not stepped,
 * and end on their shore cut (shore-cut.ts, the mask texture's G): at a
 * steep bank, where the terrain's triangles cross the level in saw teeth,
 * on a smooth line just inside them.
 *
 * Kinds (define KIND):
 * - water: clear at the shore, the body colour in the deep, waves, sky
 *   reflection with fresnel, sun glint, lacy foam along the shore (foam-noise.ts)
 * - sea: like water with stronger waves and surf bands running to the shore
 * - swamp: murky, weak reflection, floating algae patches
 * - ice: opaque, still; light over shallows, dark teal over depth, fresnel
 *   glint, cracks and snow drifted into the shallows
 * - lava: opaque and glowing; dark crust plates drift apart and together,
 *   the cracks between them glow dark red, orange to yellow by heat (wider
 *   and brighter where it is hot, slowly breathing), the glow spills onto
 *   the plates' edges; capped so only the hottest cracks pass a bloom
 *   threshold; cools to a closed, greyer crust at the shore
 *
 * Rivers (define RIVER) carry their flow per vertex and fade at the
 * ribbon's sides; waves and crust ride it in two cross-faded phases like an
 * area body's baked current, so the pattern never shears into stripes.
 */

export const KIND_ID: Record<MapWaterKind, number> = { water: 0, lava: 1, ice: 2, sea: 3, swamp: 4 };


export interface WaterMaterialOptions {
  kind: MapWaterKind;
  river: boolean;
  heights: HeightTexture;
  color: string;
  /** Half the map's extent (x, y), to tell map from apron */
  mapHalf: Vector2;
}

export function createWaterMaterial(o: WaterMaterialOptions): ShaderMaterial {
  // Foam bands running to the shore (not on rivers: they run along their own banks)
  const shore = o.river ? null : shoreWaves(o.kind);
  const material = new ShaderMaterial({
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      UniformsLib.lights,
      {
        uWaves: { value: null },
        uTime: { value: 0 },
        uDeep: { value: new Color() },
        uShallow: { value: new Color() },
        uFlow: { value: new Vector2(0.6, 0.25) },
        uLight: { value: 1 },
        uMask: { value: null },
        uMaskUv: { value: new Vector4() },
        uHasMask: { value: 0 },
        uMapHalf: { value: o.mapHalf.clone() },
        // Baked flow of an area body (flow-map.ts), on the mask's grid; none: the drift uFlow
        uFlowMap: { value: null },
        uHasFlow: { value: 0 },
        uLavaNoise: { value: null },
        uFoam: { value: null },
        // 1: the bank above the waterline gets a wet film from the water (bodies whose banks the terrain does not wet)
        uWetFilm: { value: 0 },
        // The scene mirrored in this body's level (water-reflection.ts): on while it is the level mirrored
        uReflectOn: { value: 0 },
        // Scene metres the mirror draws (water-reflection.ts far): its share fades out towards it
        uReflectFar: { value: 400 },
        uReflection: { value: null },
        uReflectMatrix: { value: new Matrix4() },
      },
    ]),
    defines: {
      KIND: KIND_ID[o.kind] ?? 0,
      RIVER: o.river ? 1 : 0,
      ...(shore ? { SHORE_DENSITY: shore.density.toFixed(3), SHORE_SPEED: shore.speed.toFixed(3), SHORE_REACH: shore.reach.toFixed(1) } : {}),
    },
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    transparent: o.kind === 'water' || o.kind === 'sea' || o.kind === 'swamp',
    fog: true,
    // The sun's shadow and the point light pool (lanterns, torches, lava) reach the water
    lights: true,
    depthWrite: true,
  });
  material.uniforms['uWaves'].value = waveTexture();
  if (o.kind === 'lava') material.uniforms['uLavaNoise'].value = lavaNoiseTexture();
  else if (o.kind !== 'ice') material.uniforms['uFoam'].value = foamNoiseTexture();
  // Shared objects (merge above copied them): fog and terrain heights follow their owners
  Object.assign(material.uniforms, HEIGHT_FOG_UNIFORMS, LAMP_LIGHT_UNIFORMS, SHOT_LIGHT_UNIFORMS, o.heights.uniforms, GROUND_COLOR_UNIFORMS);
  material.name = `custom-map-water-${o.kind}`;
  setWaterColor(material, o.kind, o.color);
  return material;
}

export function setWaterColor(material: ShaderMaterial, kind: MapWaterKind, color: string): void {
  const u = material.uniforms;
  const fallback: Record<MapWaterKind, string> = {
    water: '#2d5a5e',
    sea: '#1d4a60',
    swamp: '#2c3218',
    ice: '#3c6e80',
    lava: '#ff4a0a',
  };
  const deep = new Color(color || fallback[kind]);
  u['uDeep'].value.copy(deep);
  // Shallows: the body's colour turned light turquoise (the swamp: murky green), where the ground shows through
  u['uShallow'].value.copy(deep).lerp(new Color(kind === 'swamp' ? 0x4a5028 : 0x5fb3a6), kind === 'swamp' ? 0.3 : 0.4);
}

/**
 * The switchable effects of the water (map-effects.ts): refraction looks
 * through to the frame behind (`copy` captures it before the first water
 * draws, `mesh.onBeforeRender`), sea waves swell the sea, the detail adds
 * the richer shading of water, sea and swamp, the reflection mirrors the
 * scene in an area body's level (`reflection` renders it, `setWaterMirrored`
 * says which body it is for). Lava and ice keep their look. Recompiles only
 * when a switch changes.
 */
export function setWaterEffects(
  material: ShaderMaterial,
  kind: MapWaterKind,
  effects: MapEffects,
  copy: SceneCopy,
  reflection: WaterReflection | null = null,
): { refraction: boolean; reflects: boolean } {
  // Not through lava and ice (opaque), nor the swamp (murky)
  const refraction = effects.refraction && (kind === 'water' || kind === 'sea');
  const seaWaves = effects.seaWaves && kind === 'sea';
  const lavaGlow = effects.lavaGlow && kind === 'lava';
  const detail = effects.waterDetail && (kind === 'water' || kind === 'sea' || kind === 'swamp');
  const reflects = !!reflection && effects.reflection && (kind === 'water' || kind === 'sea' || kind === 'swamp');
  const d = material.defines as Record<string, unknown>;
  const was = `${'REFRACT' in d}|${'SEA_WAVES' in d}|${'LAVA_GLOW' in d}|${'WATER_DETAIL' in d}|${'REFLECT_SCENE' in d}`;
  // Always set again in one order: the order of the defines is part of the program's key, and one switched
  // off and on again went to the end and made a program of its own for the same shader (a level made
  // ready ahead and put back linked the water anew in the next frame, 280 ms)
  for (const name of ['REFLECT_SCENE', 'LAVA_GLOW', 'WATER_DETAIL', 'REFRACT', 'SEA_WAVES']) delete d[name];
  if (reflects) d['REFLECT_SCENE'] = '';
  if (reflection) Object.assign(material.uniforms, reflection.uniforms);
  if (lavaGlow) d['LAVA_GLOW'] = '';
  if (detail) d['WATER_DETAIL'] = '';
  if (refraction) d['REFRACT'] = '';
  if (seaWaves) d['SEA_WAVES'] = '';
  Object.assign(material.uniforms, copy.uniforms);
  if (was !== `${refraction}|${seaWaves}|${lavaGlow}|${detail}|${reflects}`) material.needsUpdate = true;
  return { refraction, reflects };
}

/** How strongly this material's body shows the reflection this frame: 0 none, 1 full (it fades in and out) */
export function setWaterMirrored(material: ShaderMaterial, weight: number): void {
  material.uniforms['uReflectOn'].value = weight;
}

/** Baked flow of an area body (flow-map.ts, RG on the mask's grid and uv), or none */
export function setWaterFlow(material: ShaderMaterial, flow: Texture | null): void {
  material.uniforms['uFlowMap'].value = flow;
  material.uniforms['uHasFlow'].value = flow ? 1 : 0;
}

/** Bilinear mask (R) and shore cut (G) of an area body over the grid: texture and map-to-uv transform */
export function setWaterMask(material: ShaderMaterial, mask: Texture | null, uv: Vector4): void {
  const u = material.uniforms;
  u['uMask'].value = mask;
  u['uMaskUv'].value.copy(uv);
  u['uHasMask'].value = mask ? 1 : 0;
}

/** How far a dark scene (MapEnvironment.darkness 1, night) dims the water's own light below the sun's share */
const NIGHT_DIM = 0.7;

/**
 * The water's own light (uLight): its body, foam and the land it mirrors,
 * from the sun's intensity, and for water (not lava, which glows by itself)
 * dimmed with the scene's darkness, the square of it so dusk dims a little
 * and night much. The sun alone left it bright at night: a night map's
 * moonlight raises the sun's intensity, and the body took no part of the
 * land's darkening, so harbours and canals glowed turquoise or green over
 * dark streets. Lamps and their light on the water are added on top and stay
 */
export function waterLight(sunIntensity: number, darkness: number, lava = false): number {
  const sun = Math.min(1.1, Math.max(0.12, (sunIntensity / 3.4) * 0.85 + 0.15));
  if (lava) return sun;
  const d = Math.min(1, Math.max(0, darkness));
  return Math.max(0.05, sun * (1 - NIGHT_DIM * d * d));
}

/**
 * Reflect the sky dome's sky: the material takes over its uniform objects,
 * the baked sky texture among them. `sunIntensity` and `darkness` (the
 * environment's) set the water's own light (waterLight).
 */
export function setWaterSky(material: ShaderMaterial, skyUniforms: ShaderMaterial['uniforms'], sunIntensity: number, darkness = 0): void {
  const u = material.uniforms;
  for (const key of [
    'uZenith',
    'uHorizon',
    'uSunDir',
    'uSunColor',
    'uGlowColor',
    'uCloudColor',
    'uCloudShadow',
    'uCover',
    'uGlow',
    'uSkyTime',
    'uCloudOffset',
    'uSkyTex',
    'uStars',
    'uPlanet',
    'uAurora',
  ]) {
    u[key] = skyUniforms[key];
  }
  u['uLight'].value = waterLight(sunIntensity, darkness, material.defines['KIND'] === KIND_ID.lava);
  material.needsUpdate = true;
}

const WATER_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
attribute float aDepth;
#ifdef SEA_WAVES
uniform float uTime;
varying vec3 vSwellNormal;
// One Gerstner wave: the point moves round in a circle as the wave passes (crests sharpen); adds to the normal
void gerstner(vec2 dir, float length, float amp, inout vec3 p, inout vec3 n, vec2 at) {
  float k = 6.2832 / length;
  float c = sqrt(9.8 * k);
  float f = k * (dot(dir, at) - c * uTime);
  float q = 0.6;
  p.x += dir.x * q * amp * cos(f);
  p.z += dir.y * q * amp * cos(f);
  p.y += amp * sin(f);
  n.x -= dir.x * k * amp * cos(f);
  n.z -= dir.y * k * amp * cos(f);
  n.y -= q * k * amp * sin(f);
}
#endif
#if RIVER == 1
attribute vec2 aFlow;
attribute float aAcross;
varying vec2 vFlow;
varying float vAcross;
#endif
varying float vApronDepth;
varying vec3 vWorldPos;
varying vec3 vMapPos;
void main() {
  vApronDepth = aDepth;
  // The map's own frame (the view's group may sit anywhere in the scene): terrain lookups use it
  vMapPos = position;
#if RIVER == 1
  vFlow = aFlow;
  vAcross = aAcross;
#endif
  vec3 surface = position;
#ifdef SEA_WAVES
  // A swell on the open sea, flat towards the shore (the depth under the vertex)
  float swell = smoothstep(0.5, 5.0, aDepth);
  vec3 swellN = vec3(0.0, 1.0, 0.0);
  vec2 at = (modelMatrix * vec4(position, 1.0)).xz;
  gerstner(normalize(vec2(0.8, 0.6)), 34.0, 0.32 * swell, surface, swellN, at);
  gerstner(normalize(vec2(-0.4, 0.9)), 21.0, 0.18 * swell, surface, swellN, at);
  gerstner(normalize(vec2(0.95, -0.3)), 13.0, 0.09 * swell, surface, swellN, at);
  vSwellNormal = normalize(swellN);
#endif
  vec4 worldPos = modelMatrix * vec4(surface, 1.0);
  vWorldPos = worldPos.xyz;
  vec4 mvPosition = viewMatrix * worldPos;
  // The sun's shadow: three's chunk reads worldPosition (no normal attribute: no normal offset)
  vec4 worldPosition = worldPos;
  #include <shadowmap_vertex>
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const WATER_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
uniform sampler2D uWaves;
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec2 uFlow;
uniform float uLight;
uniform sampler2D uMask;
uniform vec4 uMaskUv;
uniform float uHasMask;
uniform vec2 uMapHalf;
uniform sampler2D uFlowMap;
uniform float uHasFlow;
uniform sampler2D uLavaNoise;
uniform sampler2D uFoam;
uniform float uWetFilm;
#ifdef SEA_WAVES
varying vec3 vSwellNormal;
#endif
#ifdef REFRACT
${SCENE_COPY_GLSL}
#endif
#ifdef REFLECT_SCENE
uniform float uReflectOn;
uniform float uReflectFar;
uniform sampler2D uReflection;
uniform mat4 uReflectMatrix;
#endif
${HEIGHT_FOG_PARS}
${LAMP_LIGHT_PARS}
${SHOT_LIGHT_PARS}
${SHADER_NOISE}
${SKY_FUNCTIONS}
${SKY_TEXTURE_GLSL}
${TERRAIN_HEIGHT_GLSL}
#ifdef WATER_DETAIL
${GROUND_COLOR_GLSL}
#endif
${SHORE_PHASE_GLSL}
varying float vApronDepth;
varying vec3 vWorldPos;
varying vec3 vMapPos;
#if RIVER == 1
varying vec2 vFlow;
varying float vAcross;
#endif

// The gradient of a value over the surface, per metre in the scene's x/z plane: its screen derivatives solved
// for the plane. Independent of the mesh's own triangles
vec2 surfaceGradient(float f) {
  vec2 dx = dFdx(vWorldPos.xz);
  vec2 dy = dFdy(vWorldPos.xz);
  float det = dx.x * dy.y - dx.y * dy.x;
  vec2 df = vec2(dFdx(f), dFdy(f));
  return vec2(dy.y * df.x - dx.y * df.y, dx.x * df.y - dy.x * df.x) / (sign(det) * max(abs(det), 1e-8));
}

// How steeply the depth changes over the surface (rise over run)
float surfaceSlope(float depth) {
  return length(surfaceGradient(depth));
}

// Three layers of waves; the finest (weight fine) fades with distance, where it only turned into grain
vec3 waveNormal(vec2 p, vec2 flow, float strength, float fine) {
  vec3 a = texture2D(uWaves, p / 23.0 + flow * 0.021).xyz * 2.0 - 1.0;
  vec3 b = texture2D(uWaves, p / 9.0 - vec2(flow.y, -flow.x) * 0.035 + flow * 0.02).xyz * 2.0 - 1.0;
  vec3 c = texture2D(uWaves, p / 3.1 + flow * 0.09).xyz * 2.0 - 1.0;
  vec3 n = vec3((a.xy * 0.6 + b.xy * 0.45 + c.xy * 0.3 * fine) * strength, 1.0);
  // Texture x/y lie in the scene's x/z plane
  return normalize(vec3(n.x, n.z, n.y));
}

// Lava's heat field (x), the distance to the nearest crack between its crust plates (y, 0 on the crack, 1
// half a plate away) and how open that crack is (z, the heat field at the crack lookup's own scale, so it
// changes from crack to crack) at a point: the baked noise, its coordinates warped by a slowly drifting field
// whose strength breathes, so the cracks bend and the crust tears open and closes again
vec3 lavaAt(vec2 p, vec2 drift) {
  vec2 w = texture2D(uLavaNoise, p * 0.008 + vec2(uTime * 0.004, -uTime * 0.003)).ba - 0.5;
  vec2 q = p * 0.035 + drift * 0.15 + w * (0.07 + 0.03 * sin(uTime * 0.21));
  vec2 c = texture2D(uLavaNoise, q * 1.7 + w * 0.05 + 0.37).rg;
  return vec3(texture2D(uLavaNoise, q).r, c.y, c.x);
}

// Seconds per cycle of the flow map's two phases: long enough that the waves do not visibly stretch
const float FLOW_PERIOD = 6.0;

// Waves moved along a baked velocity (m/s) in two phases half a cycle apart: each slides for a cycle
// and starts again where the other is at its strongest, so the surface flows on without stretching
vec3 flowNormal(vec2 p, vec2 vel, vec2 drift, float strength, float fine) {
  float t = uTime / FLOW_PERIOD;
  float ph0 = fract(t);
  float ph1 = fract(t + 0.5);
  vec3 a = waveNormal(p - vel * ph0 * FLOW_PERIOD, drift, strength, fine);
  vec3 b = waveNormal(p - vel * ph1 * FLOW_PERIOD + vec2(7.3, 3.1), drift, strength, fine);
  return normalize(mix(b, a, 1.0 - abs(2.0 * ph0 - 1.0)));
}

#if KIND == 2
// Distance to the nearest edge between two cells of a jittered grid (cells of 1): the long straight cracks
// between ice plates. Returns the edge distance, and in id a random value of the cell
float iceEdge(vec2 p, out float id) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  vec2 m1 = vec2(0.0);
  vec2 m2 = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = vec2(hash12(cell + g), hash12(cell + g + 17.3));
      vec2 r = g + o * 0.8 + 0.1 - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; m2 = m1; d1 = d; m1 = r; id = hash12(cell + g + 3.7); }
      else if (d < d2) { d2 = d; m2 = r; }
    }
  }
  // Distance to the bisector between the two nearest points
  return dot(0.5 * (m1 + m2), normalize(m2 - m1));
}
#endif

// Glints of the lamps nearest the view (lanterns, torches, lava glow) and of the shots on a surface of normal n,
// from the scene's light buffer (shot-lights); their faint pool on it comes with shotLightAt below
vec3 pointGlints(vec3 n, vec3 v) {
  return uShotLightCount > 0 ? shotLightGlints(vWorldPos, n, v, 140.0) * 3.0 : vec3(0.0);
}

void main() {
  #include <logdepthbuf_fragment>
  // 1 in the sun, 0 in the shadow of trees, bridges and banks
  float sunShade = getShadowMask();
  vec2 m = vec2(-vMapPos.x, vMapPos.z);
  bool outside = abs(m.x) > uMapHalf.x || abs(m.y) > uMapHalf.y;
  // Depth per pixel: the shore is where the terrain cuts the surface
  float depth = outside ? vApronDepth : vMapPos.y - terrainHeightAt(m);
  float edge = 1.0;
  // The bilinear mask on its own (1 without one): how far the bank's wet film may reach
  float maskReach = 1.0;
  // The shore cut in cells, negative on the dry side (3 without a mask)
  float shoreCut = 3.0;
  if (uHasMask > 0.5 && !outside) {
    vec2 maskCut = texture2D(uMask, m * uMaskUv.xy + uMaskUv.zw).rg;
    maskReach = smoothstep(0.02, 0.45, maskCut.r);
    // The shore cut in cells (positive on the wet side): a soft edge a quarter cell wide
    float cut = (maskCut.g * 255.0 - 128.0) / ${SHORE_CUT_SCALE.toFixed(1)};
    shoreCut = cut;
    edge = smoothstep(0.3, 0.6, maskCut.r) * smoothstep(0.0, 0.25, cut);
    // Where the cut lies inside the drawn waterline (a wall, a bank in teeth) the water there reads as shallow
    // as at a shore, so it ends in its clear rim and foam instead of a hard line of deep water; from two cells
    // in (the cut's values stop at SHORE_CUT_REACH) the depth per pixel again
    depth = mix(min(depth, max(cut, 0.0) * ${SHORE_CUT_DEPTH.toFixed(2)}), depth, smoothstep(1.5, 2.5, cut));
  }
#if RIVER == 1
  edge *= 1.0 - smoothstep(0.82, 1.0, abs(vAcross));
  // The river's current per vertex: its patterns move downstream at half of it in two cross-faded phases (see
  // flowNormal). Time times the vertex's velocity would shear them without end wherever the speed or heading
  // changes from row to row: after some minutes they read as stripes across the river
  vec2 vel = vFlow * 0.5;
  vec2 flow = vec2(0.0);
#else
  vec2 flow = uFlow * uTime;
  // The body's own current (bank circulation, lava convection), m/s in the scene's x and z
  vec2 vel = vec2(0.0);
  // The baked field: the current (rg), the blurred distance to the shore (b) and the bank's slope (a)
  bool hasField = uHasFlow > 0.5 && !outside;
  vec4 field = hasField ? texture2D(uFlowMap, m * uMaskUv.xy + uMaskUv.zw) : vec4(0.5, 0.5, 0.0, 0.0);
  vel = (field.rg * 2.0 - 1.0) * ${FLOW_MAP_MAX.toFixed(2)};
#endif
#if RIVER == 1 || !(KIND == 0 || KIND == 3 || KIND == 4)
  float gradSlope = surfaceSlope(depth);
#endif
#if RIVER == 0 && (KIND == 0 || KIND == 3 || KIND == 4)
  // The bank just above the waterline is wet: a dark film with a sheen, a hand's breadth to some 40 cm high,
  // changing along the shore. Every body, so a lake up a hill or a poured basin no longer meets a dry bank
  // (the terrain wets only the main water's banks). A cheap path for pixels that were thrown away
  // Derivatives before any branch on the pixel
  float gradSlope = surfaceSlope(depth);
  if (depth <= 0.0) {
    if (outside || maskReach <= 0.0) discard;
    // As high as the waves lap, and no farther from the waterline than about a cell (the shore cut, its
    // distance on the dry side): a steep bank a band some 40 cm high, a flat one a ragged strip
    vec4 wetNoise = texture2D(uFoam, vWorldPos.xz / 9.0 + 0.31);
    float rag = (wetNoise.a - 0.5) * 0.9;
    float wetHeight = mix(0.08, 0.4, wetNoise.b);
    // Some stretches stay nearly dry, others are soaked a cell and more up the bank
    float wetCells = mix(0.05, 1.5, wetNoise.g * wetNoise.g);
    float wet = (1.0 - smoothstep(0.55, 1.0, -depth / wetHeight + rag)) * (1.0 - smoothstep(0.5, 1.0, -shoreCut / wetCells + rag))
      * maskReach * (1.0 - smoothstep(150.0, 450.0, length(cameraPosition - vWorldPos)));
    if (wet <= 0.01) discard;
    vec3 wv = normalize(cameraPosition - vWorldPos);
    float wetFresnel = pow(1.0 - max(wv.y, 0.0), 4.0);
    vec3 sheen = skyTex(reflect(-wv, vec3(0.0, 1.0, 0.0))) * wetFresnel * 0.35 * uLight;
    gl_FragColor = vec4(sheen, wet * mix(0.3, 0.5, wetFresnel));
    #include <colorspace_fragment>
    return;
  }
#endif
  if (depth <= 0.0 || edge <= 0.001) discard;
  vec3 v = normalize(cameraPosition - vWorldPos);
  vec3 color;
  float alpha = 1.0;

#if KIND == 1
  // Lava: dark crust plates with glowing cracks between them (a baked noise texture, lava-noise.ts), warped by
  // a slow field so the crust tears open and closes again; at the shore it cools into a closed crust heaped in
  // ridges
  vec2 lp = vWorldPos.xz;
  vec2 drift = flow * 0.12 + uFlow * uTime * 0.03;
  // Two phases of the crust (one where it stands still) and the weight of the first
  vec3 lv0;
  vec3 lv1;
  float lw = 1.0;
  #if RIVER == 1
  bool flows = true;
  #else
  bool flows = uHasFlow > 0.5 && !outside;
  #endif
  if (flows) {
    // The crust rides the river's current or the baked convection cells in two phases that cross-fade (see
    // flowNormal)
    float lt = uTime / (FLOW_PERIOD * 3.0);
    lw = 1.0 - abs(2.0 * fract(lt) - 1.0);
    lv0 = lavaAt(lp - vel * fract(lt) * FLOW_PERIOD * 3.0, drift);
    lv1 = lavaAt(lp - vel * fract(lt + 0.5) * FLOW_PERIOD * 3.0 + vec2(11.0, 5.0), drift);
  } else {
    lv0 = lavaAt(lp, drift);
    lv1 = lv0;
  }
  float heatField = mix(lv1.x, lv0.x, lw);
  float crackDist = mix(lv1.y, lv0.y, lw);
  // Hot zones drift with the heat field and breathe slowly, a little apart from place to place
  float breath = sin(uTime * 0.4 + heatField * 8.0 + (lp.x - lp.y) * 0.04);
  float hot = smoothstep(0.4, 0.8, heatField + breath * 0.05);
  // Cooled margin: towards the shore the crust closes and piles up in ridges along it
  float margin = smoothstep(1.3, 0.15, depth + (heatField - 0.5) * 0.6);
  // The cracks: wider where it is hot, closed in the cooled margin; their core hottest. At least about a
  // pixel wide, so far away they do not thin out into a dark crust
  // Not one net of cracks alike: some stand open and glow, others have closed to dark seams, more of them
  // open over hot zones
  float open = smoothstep(0.45, 0.8, mix(lv1.z, lv0.z, lw) + hot * 0.4);
  float width = mix(0.05, 0.22, hot) * mix(0.35, 1.0, open) * (1.0 - margin * 0.85) * (0.9 + 0.1 * breath) + fwidth(crackDist) * 1.2;
  // Each phase's cracks on their own, then blended: blending the distances instead smoothed the crust into
  // plastic without cracks halfway through each cycle
  float seam = mix(1.0 - smoothstep(width * 0.25, width, lv1.y), 1.0 - smoothstep(width * 0.25, width, lv0.y), lw);
  float crack = seam * open;
  // Where it is hottest the crust melts away in open patches; rafts of crust still float in them (the plates'
  // middles)
  float molten = smoothstep(0.68, 0.86, heatField + breath * 0.04) * (1.0 - margin) * (1.0 - 0.85 * smoothstep(0.5, 0.75, crackDist));
  // Over hot zones the thin crust only smoulders: a dull glow, not a red wash over the whole pool
  float heat = max(max(crack * mix(0.6, 1.0, hot), molten * 0.8), hot * 0.12 * (1.0 - margin)) * smoothstep(0.0, 0.7, depth);
  // The cracks' glow spills onto the plates' edges
  float halo = exp(-crackDist / max(width, 0.02) * 1.4) * (1.0 - crack) * mix(0.35, 1.0, hot) * open * (1.0 - margin * 0.7);
  // Relief: each plate domed up from its cracks and rough with the heat field. Its normal comes from the
  // thickness's gradient over the surface, so a river's ribbon never shows its triangles as facets
  float thick = smoothstep(0.0, 0.6, crackDist) * 0.5 + heatField * 0.3 + margin * 0.45 * (0.5 + 0.5 * sin(depth * 9.0 + heatField * 7.0));
  vec2 tg = surfaceGradient(thick) * 0.6;
  vec3 rn = normalize(vec3(-tg.x, 1.0, -tg.y));
  float sunLit = max(dot(rn, uSunDir), 0.0) * sunShade;
  // Dark glassy basalt, greyer where it cooled at the margin, its edges lit red from the cracks; the plates'
  // tops catch the sun and the sky in a soft glint
  vec3 basalt = mix(vec3(0.045, 0.04, 0.038), vec3(0.1, 0.092, 0.088), margin) * (0.75 + 0.5 * heatField);
  // Closed cracks are dark seams between the plates
  basalt *= 1.0 - seam * (1.0 - open) * 0.6;
  vec3 crustColor = basalt * (uSunColor * sunLit * 0.9 + uLight * 0.3) + vec3(0.6, 0.11, 0.02) * halo * halo * 0.8;
  vec3 rr = reflect(-v, rn);
  crustColor += (uSunColor * pow(max(dot(rr, uSunDir), 0.0), 28.0) * 0.22 * sunShade + skyTex(vec3(rr.x, max(rr.y, 0.05), rr.z)) * 0.05 * uLight) * (1.0 - margin * 0.6);
  // Ramp: crust, deep red, orange, yellow; capped so only the hottest cracks pass a bloom threshold
  vec3 red = uDeep * vec3(0.42, 0.06, 0.015);
  vec3 orange = vec3(1.0, 0.36, 0.06);
  vec3 yellow = vec3(1.0, 0.74, 0.32);
  color = heat < 0.35 ? mix(crustColor, red, heat / 0.35) : heat < 0.72 ? mix(red, orange, (heat - 0.35) / 0.37) : mix(orange, yellow, (heat - 0.72) / 0.28);
  color *= 1.0 + heat * 0.25;
  #ifdef LAVA_GLOW
  // The hottest cracks go past 1: the bloom pass picks them up
  color *= 1.0 + smoothstep(0.7, 1.0, heat) * 1.8;
  #endif
  alpha = edge;
#elif KIND == 2
  // Ice: light over shallows, dark over depth, fresnel glint, cracks, snow drifted into the shallows
  vec2 ip = vWorldPos.xz;
  vec3 n = normalize(vec3((valueNoise(ip * 0.3) - 0.5) * 0.05, 1.0, (valueNoise(ip * 0.3 + 7.0) - 0.5) * 0.05));
  float fresnel = 0.03 + 0.97 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  // Frosted surface: a blurred reflection (the sky up the reflected ray, mixed with the haze)
  vec3 sky = mix(skyTex(normalize(vec3(r.x, max(r.y, 0.02) + 0.6, r.z))), uHorizon, 0.5);
  vec3 body = mix(vec3(0.42, 0.56, 0.62), uDeep * vec3(0.22, 0.38, 0.46), smoothstep(0.2, 3.0, depth));
  // Not one ice all over: clear black patches where it froze still, milky ones where snow froze in
  float patchy = valueNoise(ip * 0.035 + 11.0);
  float black = smoothstep(0.62, 0.8, patchy) * smoothstep(0.4, 1.5, depth);
  float milky = smoothstep(0.38, 0.2, patchy);
  body = mix(body, body * vec3(0.55, 0.68, 0.78), black);
  body = mix(body, vec3(0.62, 0.7, 0.76), milky * 0.45);
  // Bubbles caught in the ice: small white dots in clusters, seen through clear ice over depth
  float bubbles = smoothstep(0.82, 0.9, valueNoise(ip * 3.1 + 2.0)) * smoothstep(0.55, 0.75, valueNoise(ip * 0.21 + 7.0));
  body = mix(body, vec3(0.78, 0.86, 0.9), bubbles * 0.6 * (1.0 - milky) * smoothstep(0.3, 1.0, depth));
  // Wandering cracks: thicker and darker in some places, faint in others, with a lit fracture face beside them
  float wander = skyFbm(ip * 0.09 + 5.0) - 0.5;
  float width = 0.008 + 0.014 * valueNoise(ip * 0.06 + 3.0);
  float crack = (1.0 - smoothstep(0.0, width, abs(wander))) * mix(0.35, 1.0, valueNoise(ip * 0.045 + 21.0));
  float face = (1.0 - smoothstep(width, width * 3.0, wander)) * step(0.0, wander) * (1.0 - crack);
  body *= 1.0 - crack * 0.5;
  body = mix(body, vec3(0.8, 0.88, 0.92), face * 0.2);
  // Long straight cracks between plates, white (light caught in the fracture), only over parts of the lake
  float plateId;
  // The plates' edges bent by noise, so they do not read as a honeycomb; half of the plates show no edge
  vec2 bent = ip / 24.0 + (vec2(valueNoise(ip * 0.11), valueNoise(ip * 0.11 + 9.0)) - 0.5) * 0.35;
  float plateEdge = iceEdge(bent, plateId);
  float plates = (1.0 - smoothstep(0.0, 0.006 + 0.008 * plateId, plateEdge)) * step(0.45, plateId)
    * smoothstep(0.55, 0.7, valueNoise(ip * 0.015 + 31.0)) * mix(0.4, 1.0, valueNoise(ip * 0.3 + 4.0));
  body = mix(body, vec3(0.86, 0.92, 0.96), plates * 0.6);
  // Snow drifted into the shallows and a fine grain of frost
  float snow = smoothstep(0.6, 0.05, depth) * (0.7 + 0.3 * valueNoise(ip * 1.7)) + smoothstep(0.7, 0.95, valueNoise(ip * 2.3)) * 0.25;
  body = mix(body, vec3(0.82, 0.86, 0.9), clamp(snow, 0.0, 1.0));
  color = mix(body * uLight * mix(0.6, 1.0, sunShade), sky, fresnel * 0.5);
  color += uSunColor * pow(max(dot(r, uSunDir), 0.0), 80.0) * 0.6 * sunShade;
  color += pointGlints(n, v) * 0.5;
  // The baked light of lamps and fires on the bank (lamp-light.ts) on the ice, and the shots' (shot-lights)
  color += body * lampLightAt(vWorldPos) * 0.8;
  if (uShotLightCount > 0) color += body * shotLightAt(vWorldPos, n) * 0.8;
  alpha = edge;
#else
  // Water, sea, swamp
  #if KIND == 3
  float waveStrength = 1.5;
  #elif KIND == 4
  float waveStrength = 0.25;
  #else
  float waveStrength = 1.0;
  #endif
  // Gusts: patches of rougher and calmer water drifting over the surface (the foam's break-up below)
  float foamBreak = texture2D(uWaves, vWorldPos.xz / 17.0 - uTime * 0.01).y;
  float gust = smoothstep(0.3, 0.7, foamBreak);
  #if RIVER == 1
  // A stream's surface in lanes: long smooth slicks and rough streaks side by side, drifting down with the
  // current (its two cross-faded phases), so the river reads as flowing even from the game's camera. Calmer in
  // the channel's middle than over the shallows at its sides
  vec2 laneDir = normalize(vFlow + vec2(1e-4));
  vec2 laneAt = vec2(dot(vWorldPos.xz, vec2(-laneDir.y, laneDir.x)) / 9.0, dot(vWorldPos.xz, laneDir) / 70.0);
  float lt = uTime / FLOW_PERIOD;
  float laneShift = length(vFlow) * 0.5 * FLOW_PERIOD / 70.0;
  float lanes = mix(texture2D(uFoam, laneAt - vec2(0.0, laneShift * fract(lt + 0.5)) + 0.5).g, texture2D(uFoam, laneAt - vec2(0.0, laneShift * fract(lt))).g, 1.0 - abs(2.0 * fract(lt) - 1.0));
  gust = smoothstep(0.3, 0.75, lanes) * mix(1.0, 0.6, 1.0 - abs(vAcross));
  #endif
  waveStrength *= mix(0.6, 1.3, gust);
  float fine = 1.0 - smoothstep(30.0, 160.0, length(cameraPosition - vWorldPos));
  #if RIVER == 1
  // In the current's own frame, stretched along it: the ripples of a stream are long lines down the flow,
  // not the round chop of a lake
  vec2 alongFlow = normalize(vFlow + vec2(1e-4));
  vec2 acrossFlow = vec2(-alongFlow.y, alongFlow.x);
  vec2 inFlow = vec2(dot(vWorldPos.xz, acrossFlow), dot(vWorldPos.xz, alongFlow) / 2.4);
  vec3 nf = flowNormal(inFlow, vec2(dot(vel, acrossFlow), dot(vel, alongFlow) / 2.4), flow, waveStrength, fine);
  vec3 n = normalize(vec3(acrossFlow.x * nf.x + alongFlow.x * nf.z * 0.6, nf.y, acrossFlow.y * nf.x + alongFlow.y * nf.z * 0.6));
  #else
  // Lakes and seas: a slow drift, and along their baked current where they have one
  vec3 n = uHasFlow > 0.5 && !outside ? flowNormal(vWorldPos.xz, vel, flow * 0.3, waveStrength, fine) : waveNormal(vWorldPos.xz, flow, waveStrength, fine);
  #endif
  #ifdef SEA_WAVES
  // The swell tilts the surface; the small waves ride on it
  n = normalize(n + vSwellNormal - vec3(0.0, 1.0, 0.0));
  #endif
  float calm = smoothstep(0.0, 1.2, depth);
  n = normalize(mix(vec3(0.0, 1.0, 0.0), n, 0.35 + 0.65 * calm));
  float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  vec3 sky = skyTex(vec3(r.x, max(r.y, 0.02), r.z));
  // Absorption by depth: red goes first, then green, so shallows turn green-blue before the body's colour
  // takes over; how much of the ground still shows through
  vec3 absorbed = exp(-depth * vec3(0.6, 0.25, 0.16));
  float see = (absorbed.r + absorbed.g + absorbed.b) / 3.0;
  // The light the water scatters back: the light shallow tone only where it is really shallow (see squared),
  // so a stream or a shelf two metres deep reads in the body's own colour instead of a bright turquoise
  vec3 body = mix(uDeep, uShallow, see * see) * mix(vec3(1.0), absorbed / max(see, 1e-3), 0.25) * uLight * mix(0.55, 1.0, sunShade);
  #if RIVER == 1
  // A stream carries silt: a little greener and duller than a lake, darkest down its channel
  body = mix(body, vec3(dot(body, vec3(0.3, 0.5, 0.2))) * vec3(0.92, 1.05, 0.88), 0.3) * mix(1.0, 0.82, 1.0 - abs(vAcross));
  #endif
  // The body takes the hue of the light: under a warm low sun (dusk) it reads muted and warm from above, as
  // the reflection does close in, not the body's own blue. A near-white day sun and a blue night leave it
  vec3 sunHue = uSunColor / max(max(uSunColor.r, uSunColor.g), max(uSunColor.b, 1e-3));
  float warm = smoothstep(0.35, 0.8, 1.0 - min(min(sunHue.r, sunHue.g), sunHue.b)) * smoothstep(0.0, 0.3, sunHue.r - sunHue.b);
  float bodyLuma = dot(body, vec3(0.2126, 0.7152, 0.0722));
  body = mix(body, bodyLuma * sunHue / max(dot(sunHue, vec3(0.2126, 0.7152, 0.0722)), 0.05), warm * 0.35);
  // In shade the bright sky reflection reads a little darker too (the eye compares it with the shaded bank)
  sky *= mix(0.8, 1.0, sunShade);
  #ifdef WATER_DETAIL
  // The body shaded by its waves: slopes towards the sun a little lighter, the others darker, so the
  // surface reads as moving water rather than one flat tint
  vec2 sunFlat = normalize(uSunDir.xz + vec2(1e-4));
  vec2 viewFlat = normalize(v.xz + vec2(1e-4));
  body *= 1.0 + clamp(dot(n.xz, sunFlat) * 2.5, -0.2, 0.2) * sunShade;
  // Deep water darker still: the middle of a lake or a deep channel reads deeper than its shelf
  body *= mix(1.0, 0.72, smoothstep(2.0, 10.0, depth));
  #endif
  // How much of the reflection shows over the body
  #if KIND == 4
  float mirrorWeight = fresnel * 0.4 + 0.02;
  #else
  float mirrorWeight = fresnel * 0.9 + 0.05;
  #endif
  // How much of the scene's mirror this pixel shows: the body's weight (it fades in and out, mirror-choice.ts),
  // and towards the mirror's reach the land traced over the heights takes over, so far water never meets the
  // mirror's edge
  float mirrorShare = 0.0;
  #ifdef REFLECT_SCENE
  mirrorShare = uReflectOn * (1.0 - smoothstep(uReflectFar * 0.6, uReflectFar, length(cameraPosition - vWorldPos)));
  #endif
  #ifdef WATER_DETAIL
  if (mirrorShare < 0.999) {
  // The land in the reflection: the reflected ray, followed over the terrain's heights 1.5, 4.5, 13.5 and
  // 40.5 m out, runs into a bank, a cliff or the hills beyond the shore; there the water mirrors the ground's
  // colour where the ray met it (its splat layers), shaded, hazier the farther the land (terrain only, not
  // trees or houses)
  vec2 rayMap = normalize(vec2(-r.x, r.z) + vec2(1e-4));
  float rise = r.y / max(length(r.xz), 1e-3);
  float land = 0.0;
  float landFar = 0.0;
  float probe = 1.5;
  vec2 hitAt = m;
  for (int k = 0; k < 4; k++) {
    float hit = smoothstep(-0.2, 0.8, terrainHeightNear(m + rayMap * probe) - vMapPos.y - probe * rise);
    landFar += (1.0 - land) * hit * smoothstep(5.0, 45.0, probe);
    if (land < 0.5 && hit >= 0.5) hitAt = m + rayMap * probe;
    land = max(land, hit);
    probe *= 3.0;
  }
  // The ground there as the bank shows it: lit by the sun from the side it faces the water, a little shaded
  vec3 landLit = groundColorAt(hitAt) * (uSunColor * (0.25 + 0.45 * max(uSunDir.y, 0.0)) + uLight * 0.25);
  vec3 landTone = mix(landLit, uHorizon * 0.6, landFar / max(land, 1e-3)) * mix(0.7, 1.0, sunShade);
  sky = mix(sky, landTone, land * 0.85);
  }
  #endif
  #ifdef REFLECT_SCENE
  // Where the scene is mirrored (High, Ultra) a calm surface shows its reflection from above too, as a still
  // lake does; rough patches and the sea's swell less. The same for a body the mirror does not serve now (another
  // level has it, or it lies beyond its reach): its sky and traced land show as strongly, so the mirror coming
  // or going changes what is reflected, not how bright the water reads
  #if KIND == 3
  mirrorWeight = mix(0.16, 1.0, fresnel) * mix(1.0, 0.75, gust);
  #elif KIND == 4
  mirrorWeight = mix(0.18, 0.7, fresnel);
  #else
  mirrorWeight = mix(0.3, 1.0, fresnel) * mix(1.0, 0.75, gust);
  #endif
  if (mirrorShare > 0.001) {
    // The scene mirrored in this level (water-reflection.ts), bent by the waves: banks, trees, houses and the
    // sky over them
    vec4 rc = uReflectMatrix * vec4(vWorldPos, 1.0);
    sky = mix(sky, texture2D(uReflection, rc.xy / rc.w + n.xz * 0.05).rgb, mirrorShare);
  }
  #endif
  #if KIND == 4
  color = mix(body, sky, mirrorWeight);
  // Algae and duckweed in patches along the banks, where the water is shallow and still; the open
  // water stays dark (patches over the whole surface read as camouflage, not as a swamp)
  vec2 ap = vWorldPos.xz * 0.3 + uFlow * uTime * 0.01;
  float algae = smoothstep(0.5, 0.66, skyFbm(ap));
  float bank = smoothstep(0.9, 0.2, depth + (valueNoise(ap * 0.7) - 0.5) * 0.6);
  // Lit like the land around and darker than it: at night the patches must not glow over the dark water
  color = mix(color, vec3(0.1, 0.15, 0.04) * uLight * uLight, algae * bank * 0.45);
  #else
  color = mix(body, sky, mirrorWeight);
  #endif
  // The sharp part of the sun glint sparkles: small facets of a fine, fast wave layer catch the sun and let
  // go of it
  float sparkle = texture2D(uWaves, vWorldPos.xz / 0.9 + uTime * vec2(0.13, -0.11)).x;
  #ifdef REFRACT
  // The ground behind, bent by the waves and tinted by what the water absorbs on the way through
  vec3 behind = sceneBehind((n.xz - vec2(0.0)) * 0.03 * min(depth, 2.0));
  vec3 through = behind * absorbed;
    #ifdef WATER_DETAIL
  // Light the waves focus on the shallow bed (the fine wave layer as caustics), where the sun reaches it
  through *= 1.0 + smoothstep(0.52, 0.8, sparkle) * 0.9 * see * sunShade;
    #endif
  color = mix(mix(through, body, 1.0 - see), sky, mirrorWeight);
  #endif
  // Sun glint, weaker in the shallows: there the surface is calm and flat, and a flat mirror against the
  // sun drew white streaks along every shore
  float spec = (pow(max(dot(r, uSunDir), 0.0), 320.0) * 3.0 * (0.3 + 1.7 * smoothstep(0.55, 0.85, sparkle)) + pow(max(dot(r, uSunDir), 0.0), 40.0) * 0.2) * smoothstep(0.1, 1.5, depth);
  #if KIND == 4
  spec *= 0.3;
  #endif
  color += uSunColor * spec * sunShade;
  #ifdef WATER_DETAIL
  // Light through the waves: looking towards a low sun, the slopes facing the viewer glow in the shallow
  // colour where the water is deep enough to carry it
  float against = max(dot(-viewFlat, sunFlat), 0.0);
  float facing = clamp(dot(n.xz, viewFlat) * 6.0, 0.0, 1.0);
  float scatter = against * against * facing * (1.0 - 0.6 * uSunDir.y) * smoothstep(0.3, 1.5, depth);
    #if KIND == 4
  scatter *= 0.3;
    #endif
  color += uShallow * vec3(0.7, 1.15, 1.0) * uSunColor * scatter * 0.3 * sunShade;
  #endif
  color += pointGlints(n, v);
  // The baked light of lamps and fires on the bank (lamp-light.ts): a warm sheen on the water near them; the
  // shots' light (shot-lights) the same, a flash over a river shimmers on it
  color += lampLightAt(vWorldPos) * 0.18;
  if (uShotLightCount > 0) color += shotLightAt(vWorldPos, n) * 0.25;
  // Foam along the shore (foam-noise.ts): lace with holes that gathers at the waterline and thins out to open
  // water. How far out it reaches changes along the shore, it leaves gaps, and its front breathes up the bank
  // and back; nowhere a closed line of one width. Its distance from the waterline in metres is the depth over
  // the bank's slope (an area body's baked slope, else the depth's gradient over the surface): a flat beach
  // carries a wide strip, a steep bank a narrow one, a quay wall a few patches at its foot
  vec2 fp = vWorldPos.xz;
  vec4 foamFar = texture2D(uFoam, fp / 53.0 + uFlow * uTime * 0.002);
  #if RIVER == 1
  // Along the current in the two cross-faded phases of the waves (flowNormal), so the lace never shears
  float ft = uTime / FLOW_PERIOD;
  vec4 laceA = texture2D(uFoam, (fp - vel * fract(ft) * FLOW_PERIOD) / 7.0);
  vec4 laceB = texture2D(uFoam, (fp - vel * fract(ft + 0.5) * FLOW_PERIOD) / 7.0 + 0.5);
  vec4 foamNear = mix(laceB, laceA, 1.0 - abs(2.0 * fract(ft) - 1.0));
  float bankSlope = gradSlope;
  float wall = 0.0;
  #else
  vec4 foamNear = texture2D(uFoam, fp / 7.0 + flow * 0.04);
  float bankSlope = hasField ? field.a * ${SLOPE_FIELD_MAX.toFixed(2)} : gradSlope;
  float wall = hasField ? smoothstep(1.3, 2.3, bankSlope) : 0.0;
  #endif
  float fromLine = depth / clamp(bankSlope, 0.06, 3.0);
  #if RIVER == 0
  // At a wall the depth jumps within a pixel: the foam there keeps to the blurred distance to the shore
  if (hasField) fromLine = mix(fromLine, field.b * ${SHORE_FIELD_MAX.toFixed(1)} * 0.7, wall);
  #endif
  // Out to 0.3 to 3 m, wider on a gentle bank, narrow at a steep one; the sea a little farther, the swamp less
  #if KIND == 3
  float foamScale = 1.5;
  #elif KIND == 4
  float foamScale = 0.6;
  #else
  float foamScale = 1.0;
  #endif
  #if RIVER == 1
  // A river's banks: the current carries the foam off, it gathers less
  foamScale *= 0.7;
  #endif
  float foamReach = mix(0.3, 3.0, foamFar.b * foamFar.b) * foamScale * mix(1.0, 0.35, smoothstep(0.4, 2.0, bankSlope));
  // The front runs up the bank and back, out of step along the shore
  float lap = sin(uTime * 0.85 + foamFar.g * 13.0 + foamNear.a * 1.7);
  float x = fromLine + lap * 0.22 * foamReach - 0.08;
  // Gaps along the shore where the water meets the bank clear, patches where it gathers
  float gaps = smoothstep(0.2, 0.55, foamFar.g);
  float density = exp(-max(x, 0.0) * 3.0 / foamReach) * (1.0 - smoothstep(0.6, 1.0, x / foamReach)) * gaps * mix(0.45, 1.1, foamFar.a) * mix(0.6, 1.1, foamNear.g) * edge;
  #ifdef SHORE_DENSITY
  // Bands of foam that come in from the open water and run up to the shore (shore-waves.ts). They follow
  // the blurred distance to the shore, so they round the bank's corners instead of tracing its cells,
  // wobble along it and break up into the same lace; they gather out of nothing farther out. At a steep bank
  // (a quay wall) little foam: the water there is deep right up to it. The terrain's swash shares the phase
  float shoreDist = hasField ? field.b * ${SHORE_FIELD_MAX.toFixed(1)} : depth * 6.0;
  float sp = shorePhase(shoreDist + (foamBreak - 0.5) * (0.6 / SHORE_DENSITY) + (foamNear.a - 0.5) * (0.15 / SHORE_DENSITY), SHORE_DENSITY, SHORE_SPEED, uTime);
  float bandShape = smoothstep(0.35, 0.86, sp) * (1.0 - smoothstep(0.88, 1.0, sp));
  #if KIND == 3
  float reach = 5.0;
  float bandStrength = 1.0;
  #else
  // Lakes: only close in
  float reach = 0.6;
  float bandStrength = 0.4;
  #endif
  float bands = bandShape * smoothstep(SHORE_REACH, SHORE_REACH * 0.3, shoreDist) * smoothstep(reach, reach * 0.35, depth)
    * mix(0.4, 1.0, foamNear.g) * smoothstep(0.15, 0.5, foamFar.g + foamBreak * 0.3);
  density = max(density, bands * bandStrength * (1.0 - 0.85 * wall) * edge);
  #endif
  // The lace: dense foam keeps all but the bubbles' middles, thin foam only their walls; the bubbles slowly
  // pop and form. Capped, so even the densest foam keeps its largest holes. Once a pixel covers more than a
  // bubble (far away) the threshold softens into the share of foam there instead of solid white
  float metresPerPixel = length(fwidth(fp));
  float soft = mix(0.2, 0.6, smoothstep(0.04, 0.35, metresPerPixel));
  float pop = 1.0 + 0.12 * sin(uTime * 1.3 + foamNear.a * 6.2832);
  // The fine noise breaks the bubbles' walls, so thin foam falls apart into flecks instead of a net of cracks
  float laceAt = (foamNear.r * 0.7 + (1.0 - foamNear.a) * 0.4) * (1.0 - soft * 0.5);
  float foam = smoothstep(laceAt, laceAt + soft, min(density, 0.85) * pop) * mix(1.0, 0.75, smoothstep(0.04, 0.35, metresPerPixel));
  // Between the flecks the water is milky where foam gathers, so the lace sits in a soft haze of its own
  foam = max(foam, density * 0.28 * smoothstep(0.25, 0.75, foamNear.g));
  // A strip of a few pixels (far away, a steep bank) shows as a faint tint, not as a white line
  foam *= mix(0.45, 1.0, smoothstep(1.5, 6.0, foamReach / max(metresPerPixel, 1e-4))) * (1.0 - 0.5 * wall);
  #if RIVER == 1
    #ifdef WATER_DETAIL
  // On a river the waves' texture, stretched along the current and running down it: streaks of foam
  vec2 fd = normalize(vFlow + vec2(1e-4));
  float foamNoise = texture2D(uWaves, vec2(dot(vWorldPos.xz, vec2(-fd.y, fd.x)) / 1.1, (dot(vWorldPos.xz, fd) - uTime * 0.9) / 5.0)).x;
    #else
  float foamNoise = texture2D(uWaves, vWorldPos.xz / 2.3 + uTime * 0.03).x;
    #endif
  // Ripples where the river runs fast and shallow
  foam = max(foam, smoothstep(0.7, 0.95, foamNoise) * smoothstep(1.2, 0.3, depth) * min(length(vFlow), 1.0));
    #ifdef WATER_DETAIL
  // Streaks along the current where it runs on (none on a slow stream: they read as paint), white water
  // where it runs fast (rapids, below a fall)
  float speed = length(vFlow);
  foam = max(foam, smoothstep(0.6, 0.9, foamNoise) * 0.8 * smoothstep(0.7, 3.0, speed));
  foam = max(foam, smoothstep(0.5, 0.8, foamNoise) * smoothstep(2.0, 3.5, speed) * 0.6);
    #endif
  #endif
  // Foam is translucent: its thin parts let the water's colour through
  color = mix(color, vec3(0.86, 0.89, 0.88) * uLight * mix(0.65, 1.0, sunShade), foam * (0.4 + 0.4 * foam));
  #if KIND == 4
  alpha = mix(0.75, 0.97, smoothstep(0.0, 0.8, depth));
  #else
  alpha = mix(0.96, 0.5, see);
  alpha = max(alpha, fresnel);
  #endif
  alpha = max(alpha, foam * 0.8);
  #ifdef REFRACT
  // Drawn over the copy of the ground: opaque but at the seam
  alpha = 1.0;
  #endif
  // A soft seam where the terrain cuts the surface
  alpha *= smoothstep(0.0, 0.12, depth) * edge;
#endif
#if KIND == 1 || KIND == 2
  // Opaque bodies: the mask edge cuts, rounded by the bilinear mask
  if (alpha < 0.5) discard;
  alpha = 1.0;
#endif
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  ${heightFogFragment('vWorldPos')}
}
`;
