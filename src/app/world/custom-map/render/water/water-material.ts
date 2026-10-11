import {
  Color,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  UnsignedByteType,
  Vector2,
  Vector4,
  type Texture,
} from 'three';
import type { MapWaterKind } from '../../map-document';
import { HEIGHT_FOG_PARS, HEIGHT_FOG_UNIFORMS, heightFogFragment } from '../environment/height-fog';
import { SKY_FUNCTIONS } from '../environment/sky-dome';
import { SHADER_NOISE } from '../shader-noise';
import { TERRAIN_HEIGHT_GLSL, type HeightTexture } from '../terrain/height-texture';

/**
 * The material of every water body (lake, sea, swamp, ice, lava; areas and
 * rivers). Depth per pixel is the surface height minus the terrain height
 * under it (HeightTexture), so the shoreline is where the terrain cuts the
 * surface: smooth, whatever the grid. Area bodies also fade out by their
 * mask (bilinear), so a mask edge over low ground is rounded, not stepped.
 *
 * Kinds (define KIND):
 * - water: clear at the shore, the body colour in the deep, waves, sky
 *   reflection with fresnel, sun glint, foam where it gets shallow
 * - sea: like water with stronger waves and surf bands running to the shore
 * - swamp: murky, weak reflection, floating algae patches
 * - ice: opaque, still; light over shallows, dark teal over depth, fresnel
 *   glint, cracks and snow drifted into the shallows
 * - lava: opaque and glowing; crust plates drift over veins whose colour
 *   runs dark red, orange to yellow by heat; capped so only the hottest
 *   veins pass a bloom threshold; cools to crust at the shore
 *
 * Rivers (define RIVER) carry their flow per vertex and fade at the
 * ribbon's sides.
 */

export const KIND_ID: Record<MapWaterKind, number> = { water: 0, lava: 1, ice: 2, sea: 3, swamp: 4 };

let waves: DataTexture | null = null;

export interface WaterMaterialOptions {
  kind: MapWaterKind;
  river: boolean;
  heights: HeightTexture;
  color: string;
  /** Half the map's extent (x, y), to tell map from apron */
  mapHalf: Vector2;
}

export function createWaterMaterial(o: WaterMaterialOptions): ShaderMaterial {
  const material = new ShaderMaterial({
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
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
      },
    ]),
    defines: { KIND: KIND_ID[o.kind] ?? 0, RIVER: o.river ? 1 : 0 },
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    transparent: o.kind === 'water' || o.kind === 'sea' || o.kind === 'swamp',
    fog: true,
    depthWrite: true,
  });
  material.uniforms['uWaves'].value = waveTexture();
  // Shared objects (merge above copied them): fog and terrain heights follow their owners
  Object.assign(material.uniforms, HEIGHT_FOG_UNIFORMS, o.heights.uniforms);
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
  u['uShallow'].value.copy(deep).lerp(new Color(kind === 'swamp' ? 0x4a5028 : 0x6f9a88), 0.3);
}

/** Bilinear mask of an area body over the grid: texture and map-to-uv transform */
export function setWaterMask(material: ShaderMaterial, mask: Texture | null, uv: Vector4): void {
  const u = material.uniforms;
  u['uMask'].value = mask;
  u['uMaskUv'].value.copy(uv);
  u['uHasMask'].value = mask ? 1 : 0;
}

/**
 * Reflect the sky dome's own function: the material takes over its uniform
 * objects. `sunIntensity` dims the body colour at night.
 */
export function setWaterSky(material: ShaderMaterial, skyUniforms: ShaderMaterial['uniforms'], sunIntensity: number): void {
  const u = material.uniforms;
  for (const key of [
    'uZenith',
    'uHorizon',
    'uSunDir',
    'uSunColor',
    'uCloudColor',
    'uCloudShadow',
    'uCover',
    'uGlow',
    'uSkyTime',
    'uStars',
    'uPlanet',
    'uAurora',
  ]) {
    u[key] = skyUniforms[key];
  }
  u['uLight'].value = Math.min(1.1, Math.max(0.12, (sunIntensity / 3.4) * 0.85 + 0.15));
  material.needsUpdate = true;
}

/**
 * A tiling normal texture of sums of waves with whole-number frequencies
 * (so it repeats seamlessly), shared by all water surfaces.
 */
function waveTexture(): DataTexture {
  if (waves) return waves;
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  let seed = 11;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const list = Array.from({ length: 24 }, (_, n) => {
    const freq = 1 + Math.floor(rnd() * (3 + n));
    const angle = rnd() * Math.PI * 2;
    return {
      kx: Math.round(Math.cos(angle) * freq),
      ky: Math.round(Math.sin(angle) * freq),
      amp: 1 / (1 + n * 0.35),
      phase: rnd() * Math.PI * 2,
    };
  });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0;
      let dy = 0;
      for (const w of list) {
        const a = ((w.kx * x + w.ky * y) / size) * Math.PI * 2 + w.phase;
        const c = Math.cos(a) * w.amp;
        dx += c * w.kx;
        dy += c * w.ky;
      }
      const nx = -dx * 0.02;
      const ny = -dy * 0.02;
      const len = Math.hypot(nx, ny, 1);
      const q = (y * size + x) * 4;
      data[q] = Math.round((nx / len) * 127.5 + 127.5);
      data[q + 1] = Math.round((ny / len) * 127.5 + 127.5);
      data[q + 2] = Math.round((1 / len) * 127.5 + 127.5);
      data[q + 3] = 255;
    }
  }
  const t = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  t.colorSpace = NoColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  waves = t;
  return t;
}

const WATER_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
attribute float aDepth;
#if RIVER == 1
attribute vec2 aFlow;
attribute float aAcross;
varying vec2 vFlow;
varying float vAcross;
#endif
varying float vApronDepth;
varying vec3 vWorldPos;
void main() {
  vApronDepth = aDepth;
#if RIVER == 1
  vFlow = aFlow;
  vAcross = aAcross;
#endif
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  vec4 mvPosition = viewMatrix * worldPos;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const WATER_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
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
${HEIGHT_FOG_PARS}
${SHADER_NOISE}
${SKY_FUNCTIONS}
${TERRAIN_HEIGHT_GLSL}
varying float vApronDepth;
varying vec3 vWorldPos;
#if RIVER == 1
varying vec2 vFlow;
varying float vAcross;
#endif

vec3 waveNormal(vec2 p, vec2 flow, float strength) {
  vec3 a = texture2D(uWaves, p / 23.0 + flow * 0.021).xyz * 2.0 - 1.0;
  vec3 b = texture2D(uWaves, p / 9.0 - vec2(flow.y, -flow.x) * 0.035 + flow * 0.02).xyz * 2.0 - 1.0;
  vec3 c = texture2D(uWaves, p / 3.1 + flow * 0.09).xyz * 2.0 - 1.0;
  vec3 n = vec3((a.xy * 0.6 + b.xy * 0.45 + c.xy * 0.3) * strength, 1.0);
  // Texture x/y lie in the scene's x/z plane
  return normalize(vec3(n.x, n.z, n.y));
}

void main() {
  #include <logdepthbuf_fragment>
  vec2 m = vec2(-vWorldPos.x, vWorldPos.z);
  bool outside = abs(m.x) > uMapHalf.x || abs(m.y) > uMapHalf.y;
  // Depth per pixel: the shore is where the terrain cuts the surface
  float depth = outside ? vApronDepth : vWorldPos.y - terrainHeightAt(m);
  float edge = 1.0;
  if (uHasMask > 0.5 && !outside) edge = smoothstep(0.3, 0.6, texture2D(uMask, m * uMaskUv.xy + uMaskUv.zw).r);
#if RIVER == 1
  edge *= 1.0 - smoothstep(0.82, 1.0, abs(vAcross));
  // Wave patterns move downstream
  vec2 flow = -vFlow * uTime;
#else
  vec2 flow = uFlow * uTime;
#endif
  if (depth <= 0.0 || edge <= 0.001) discard;
  vec3 v = normalize(cameraPosition - vWorldPos);
  vec3 color;
  float alpha = 1.0;

#if KIND == 1
  // Lava: veins glow by heat, crust plates drift over them, cooled crust at the shore
  vec2 lp = vWorldPos.xz;
  vec2 drift = flow * 0.12 + uFlow * uTime * 0.03;
  float plates = skyFbm(lp * 0.14 + drift);
  float veins = 1.0 - smoothstep(0.02, 0.11, abs(skyFbm(lp * 0.32 - drift * 1.4 + 3.0) - 0.5));
  float crust = smoothstep(0.42, 0.62, plates);
  float heat = max(veins * (1.0 - crust * 0.75), (1.0 - crust) * 0.45);
  heat *= smoothstep(0.0, 0.7, depth);
  heat *= 0.85 + 0.15 * sin(uTime * 1.3 + plates * 12.0);
  // Ramp: crust, deep red, orange, yellow; capped so only the hottest veins pass a bloom threshold
  vec3 crustColor = vec3(0.045, 0.03, 0.026) * (0.6 + 0.4 * uLight);
  vec3 red = uDeep * vec3(0.55, 0.09, 0.02);
  vec3 orange = vec3(1.0, 0.36, 0.06);
  vec3 yellow = vec3(1.0, 0.72, 0.28);
  color = heat < 0.4 ? mix(crustColor, red, heat / 0.4) : heat < 0.75 ? mix(red, orange, (heat - 0.4) / 0.35) : mix(orange, yellow, (heat - 0.75) / 0.25);
  color *= 1.0 + heat * 0.25;
  // A faint sheen on the crust
  color += skyColor(vec3(0.0, 1.0, 0.0), false) * 0.03 * (1.0 - heat) * uLight;
  alpha = edge;
#elif KIND == 2
  // Ice: light over shallows, dark over depth, fresnel glint, cracks, snow drifted into the shallows
  vec2 ip = vWorldPos.xz;
  vec3 n = normalize(vec3((valueNoise(ip * 0.3) - 0.5) * 0.05, 1.0, (valueNoise(ip * 0.3 + 7.0) - 0.5) * 0.05));
  float fresnel = 0.03 + 0.97 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  // Frosted surface: a blurred reflection (the sky up the reflected ray, mixed with the haze)
  vec3 sky = mix(skyColor(normalize(vec3(r.x, max(r.y, 0.02) + 0.6, r.z)), false), uHorizon, 0.5);
  vec3 body = mix(vec3(0.42, 0.56, 0.62), uDeep * vec3(0.22, 0.38, 0.46), smoothstep(0.2, 3.0, depth));
  float crack = 1.0 - smoothstep(0.0, 0.015, abs(skyFbm(ip * 0.09 + 5.0) - 0.5));
  body *= 1.0 - crack * 0.45;
  // Snow drifted into the shallows and a fine grain of frost
  float snow = smoothstep(0.6, 0.05, depth) * (0.7 + 0.3 * valueNoise(ip * 1.7)) + smoothstep(0.7, 0.95, valueNoise(ip * 2.3)) * 0.25;
  body = mix(body, vec3(0.82, 0.86, 0.9), clamp(snow, 0.0, 1.0));
  color = mix(body * uLight, sky, fresnel * 0.5);
  color += uSunColor * pow(max(dot(r, uSunDir), 0.0), 80.0) * 0.6;
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
  vec3 n = waveNormal(vWorldPos.xz, flow, waveStrength);
  float calm = smoothstep(0.0, 1.2, depth);
  n = normalize(mix(vec3(0.0, 1.0, 0.0), n, 0.35 + 0.65 * calm));
  float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
  vec3 r = reflect(-v, n);
  vec3 sky = skyColor(vec3(r.x, max(r.y, 0.02), r.z), false);
  vec3 body = mix(uShallow, uDeep, smoothstep(0.2, 3.5, depth)) * uLight;
  #if KIND == 4
  color = mix(body, sky, fresnel * 0.4 + 0.02);
  // Algae and duckweed drifting in patches
  float algae = smoothstep(0.52, 0.68, skyFbm(vWorldPos.xz * 0.22 + uFlow * uTime * 0.01));
  color = mix(color, vec3(0.16, 0.24, 0.06) * uLight, algae * 0.85);
  #else
  color = mix(body, sky, fresnel * 0.9 + 0.05);
  #endif
  // Sun glint, weaker in the shallows: there the surface is calm and flat, and a flat mirror against the
  // sun drew white streaks along every shore
  float spec = (pow(max(dot(r, uSunDir), 0.0), 320.0) * 3.0 + pow(max(dot(r, uSunDir), 0.0), 40.0) * 0.2) * smoothstep(0.1, 1.5, depth);
  #if KIND == 4
  spec *= 0.3;
  #endif
  color += uSunColor * spec;
  // Foam where it gets shallow, broken up by the waves
  float foamNoise = texture2D(uWaves, vWorldPos.xz / 2.3 + uTime * 0.03).x;
  float foamBreak = texture2D(uWaves, vWorldPos.xz / 17.0 - uTime * 0.01).y;
  float foam = smoothstep(0.25, 0.0, depth) * smoothstep(0.45, 0.75, foamNoise * 0.6 + foamBreak * 0.6 - depth);
  #if KIND == 3
  // Surf: bands rolling in to the shore
  float band = sin(depth * 2.6 - uTime * 1.3 + foamBreak * 3.0);
  foam = max(foam, smoothstep(0.75, 0.98, band) * smoothstep(3.0, 0.4, depth) * (0.6 + foamNoise * 0.6));
  #endif
  #if RIVER == 1
  // Ripples where the river runs fast and shallow
  foam = max(foam, smoothstep(0.7, 0.95, foamNoise) * smoothstep(1.2, 0.3, depth) * min(length(vFlow), 1.0));
  #endif
  color = mix(color, vec3(0.85, 0.88, 0.86) * uLight, foam * 0.65);
  #if KIND == 4
  alpha = mix(0.75, 0.97, smoothstep(0.0, 0.8, depth));
  #else
  alpha = mix(0.55, 0.96, smoothstep(0.0, 1.6, depth));
  alpha = max(alpha, fresnel);
  #endif
  alpha = max(alpha, foam * 0.8);
  // A soft seam where the terrain cuts the surface
  alpha *= smoothstep(0.0, 0.06, depth) * edge;
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
