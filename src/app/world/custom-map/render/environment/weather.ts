import {
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  AdditiveBlending,
  PlaneGeometry,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector2,
  Vector3,
  Vector4,
  type Camera,
} from 'three';
import type { MapWeather } from '../../map-document';
import { COVER_GLSL, type CoverMap } from './cover-map';
import { WIND_UNIFORMS } from './wind';

/**
 * Rain or snow where the camera looks: three nested boxes of streaks or
 * flakes (CASCADES), each a cube ahead of the camera, each the next one's
 * size times four, an equal share of the particles in each. Every box
 * wraps as the view moves (each particle's spot is fixed in the world and
 * folded into its box), so the weather fills the view near and far at any
 * height without simulating anything: the small box the air in front of the
 * lens, the large one the land from a game camera hundreds of metres up.
 * A box thins out towards its walls, where the next one goes on; the
 * outermost ends in the haze. One box around the focus left the view
 * outside it empty: a rectangle of snow over the far ground, none near a
 * low camera, a patch of it under a high one. Fog weather has no particles;
 * the environment thickens its fog instead (CustomMapEnvironment).
 */

/** Edge of each box, m: the air at the lens, the scene, the land to the haze */
export const CASCADES = [40, 160, 640] as const;
/** How far ahead of the camera a box's centre lies, in its own edge */
const AHEAD = 0.35;
const MAX_RAIN = 24000;
/** Most a particle grows with its distance (a flake at 35 m and more), times */
const GROW_MAX = 6;

/** What the layer shows: the map's weather, or a biome's ambient particles */
export type WeatherParticles = MapWeather | 'embers' | 'ash' | 'dust';

/** Shader kind and particles at full strength */
const KINDS: Record<string, { id: number; max: number }> = {
  rain: { id: 0, max: 24000 },
  snow: { id: 1, max: 14000 },
  embers: { id: 2, max: 3000 },
  ash: { id: 3, max: 9000 },
  dust: { id: 4, max: 7000 },
};

export class WeatherLayer {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;

  /** Whether the current weather shows any particles */
  get active(): boolean {
    return this.mesh.geometry.instanceCount > 0;
  }
  private readonly cam = new Vector3();
  private readonly ahead = new Vector3();

  constructor() {
    const quad = new PlaneGeometry(1, 1);
    const g = new InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    g.setAttribute('uv', quad.getAttribute('uv'));
    const seeds = new Float32Array(MAX_RAIN * 3);
    let s = 7;
    for (let i = 0; i < seeds.length; i++) {
      s = (s * 16807) % 2147483647;
      seeds[i] = s / 2147483647;
    }
    g.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 3));
    // Particle k in box k mod 3: any instance count shares out evenly
    const cascade = new Float32Array(MAX_RAIN);
    for (let k = 0; k < MAX_RAIN; k++) cascade[k] = k % CASCADES.length;
    g.setAttribute('aCascade', new InstancedBufferAttribute(cascade, 1));
    g.instanceCount = 0;
    quad.dispose();
    const material = new ShaderMaterial({
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        {
          uTime: { value: 0 },
          uCenters: { value: CASCADES.map(() => new Vector3()) },
          uSizes: { value: [...CASCADES] },
          uLight: { value: 1 },
          // Kind and cover are uniforms, not defines: a change of weather never compiles a program
          uKind: { value: 0 },
          uHasCover: { value: 0 },
          uCover: { value: null },
          uCoverGrid: { value: new Vector4() },
          uCoverSize: { value: new Vector2(1, 1) },
          uCoverFrame: { value: new Vector2() },
        },
      ]),
      vertexShader: WEATHER_VERTEX,
      fragmentShader: WEATHER_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      fog: true,
    });
    material.uniforms['uWindDir'] = WIND_UNIFORMS.uWindDir;
    material.uniforms['uWindStrength'] = WIND_UNIFORMS.uWindStrength;
    material.name = 'custom-map-weather';
    this.mesh = new Mesh(g, material);
    this.mesh.name = 'custom-map-weather';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.userData['losTransparent'] = true;
    this.mesh.visible = false;
  }

  /** The terrain and roof tops particles stop at (no rain indoors or under the ground) */
  setCover(cover: CoverMap): void {
    Object.assign(this.mesh.material.uniforms, cover.uniforms);
    this.mesh.material.uniforms['uHasCover'].value = 1;
  }

  /** Particle kind and strength 0..1 (clear and fog show none); `light` dims lit particles at night */
  set(kind: WeatherParticles, strength: number, light: number): void {
    const m = this.mesh.material;
    const spec = KINDS[kind];
    if (spec) {
      m.uniforms['uKind'].value = spec.id;
      // Embers glow: added, not blended
      m.blending = kind === 'embers' ? AdditiveBlending : NormalBlending;
    }
    const k = Math.min(1, Math.max(0, strength));
    this.mesh.geometry.instanceCount = spec ? Math.round(spec.max * k) : 0;
    this.mesh.visible = this.active;
    m.uniforms['uLight'].value = light;
  }

  /** Puts the boxes ahead of the camera, in the map group's space */
  update(dt: number, camera: Camera): void {
    if (!this.mesh.visible) return;
    camera.getWorldPosition(this.cam);
    camera.getWorldDirection(this.ahead).add(this.cam);
    this.mesh.parent?.worldToLocal(this.cam);
    this.mesh.parent?.worldToLocal(this.ahead);
    this.ahead.sub(this.cam).normalize();
    const u = this.mesh.material.uniforms;
    const centers = u['uCenters'].value as Vector3[];
    CASCADES.forEach((size, c) => centers[c].copy(this.cam).addScaledVector(this.ahead, size * AHEAD));
    u['uTime'].value += dt;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
}

const WEATHER_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
attribute vec3 aSeed;
attribute float aCascade;
uniform float uTime;
uniform vec3 uCenters[${CASCADES.length}];
uniform float uSizes[${CASCADES.length}];
varying vec2 vUv;
varying float vFade;
uniform int uKind;
uniform float uHasCover;
uniform vec2 uWindDir;
uniform float uWindStrength;
${COVER_GLSL}
void main() {
  // The map's wind carries everything sideways (metres per second along uWindDir)
  vec3 wind = vec3(uWindDir.x, 0.0, uWindDir.y);
  vec3 rainDrift = wind * (0.4 + 4.0 * uWindStrength);
  vec3 fall = rainDrift * uTime + vec3(0.0, -uTime * 11.0, 0.0);
  if (uKind == 1) {
    fall = vec3(sin(uTime * 0.6 + aSeed.x * 20.0) * 0.6, -uTime * 1.1, cos(uTime * 0.5 + aSeed.z * 20.0) * 0.6) + wind * uTime * (0.2 + 2.0 * uWindStrength);
  } else if (uKind == 2) {
    // Embers rise and wander
    fall = vec3(sin(uTime * 0.9 + aSeed.x * 30.0) * 1.5, uTime * 1.6, cos(uTime * 0.7 + aSeed.z * 30.0) * 1.5) + wind * uTime * (0.2 + 1.5 * uWindStrength);
  } else if (uKind == 3) {
    // Ash sinks slowly, tumbling
    fall = vec3(sin(uTime * 0.4 + aSeed.x * 20.0) * 1.2, -uTime * 0.45, cos(uTime * 0.3 + aSeed.z * 20.0) * 1.2) + wind * uTime * (0.2 + 1.6 * uWindStrength);
  } else if (uKind == 4) {
    // Dust blows along near the ground
    fall = vec3(0.0, sin(uTime * 0.8 + aSeed.y * 20.0) * 0.8, sin(uTime + aSeed.x * 10.0)) + wind * uTime * (1.5 + 9.0 * uWindStrength);
  }
  int cascade = int(aCascade + 0.5);
  vec3 center = uCenters[0];
  float size = uSizes[0];
  if (cascade == 1) {
    center = uCenters[1];
    size = uSizes[1];
  } else if (cascade == 2) {
    center = uCenters[2];
    size = uSizes[2];
  }
  vec3 box = vec3(size);
  vec3 local = aSeed * box + fall;
  vec3 p = center + mod(local - center, box) - box * 0.5;
  // Thin out towards the walls of the box, so they never show: the next box goes on there
  vec3 rel = abs(p - center) / (box * 0.5);
  vFade = 1.0 - smoothstep(0.5, 1.0, max(rel.x, max(rel.y, rel.z)));
  vFade = min(1.0, vFade * 1.6);
  // Under a roof or below the ground: not drawn (ash and dust stay above the ground as well)
  if (uHasCover > 0.5) vFade *= step(coverTopAt(p), p.y);
  vUv = uv;
  // Far from the camera particles grow (a game camera looks from 100 m and more), and thin out
  float camDist = length(cameraPosition - p);
  // Up to GROW_MAX: the largest box reaches some 500 m, where flakes grown without a bound were metres
  // wide and veiled the whole picture in grey (and cost their overdraw)
  float grow = clamp(camDist / 35.0, 1.0, ${GROW_MAX.toFixed(1)});
  // Ash and embers stay small: grown with the distance they read as a field of pale dots over the
  // map from the game camera (they hang everywhere, rain and snow show as a veil)
  if (uKind == 2 || uKind == 3) grow = min(grow, 1.8);
  // Right in front of the lens a streak or flake would fill the screen
  vFade *= smoothstep(3.0, 9.0, camDist);
  if (uKind == 4) {
    // Dust stays low: within some 20 m of the ground (the boxes hang round the camera, not on the land);
    // without a cover map in the lower half of its box
    vFade *= uHasCover > 0.5
      ? 1.0 - smoothstep(6.0, 20.0, p.y - coverTopAt(p))
      : 1.0 - smoothstep(0.0, 0.5, (p.y - (center.y - size * 0.5)) / size);
  }
  vec4 mvPosition;
  if (uKind != 0) {
    vFade /= sqrt(grow);
    float flake = uKind == 4 ? 0.6 : uKind == 2 ? 0.12 : 0.14;
    mvPosition = viewMatrix * vec4(p, 1.0);
    mvPosition.xy += position.xy * flake * grow * 1.6;
  } else {
    vFade /= grow;
    // A streak standing upright, turned towards the camera
    vec3 toCam = normalize(cameraPosition - p);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam) + 1e-5);
    // Slanted along its fall: the wind's drift against 11 m/s down
    vec3 world = p + right * position.x * 0.035 * grow + vec3(-rainDrift.x / 11.0, 1.0, -rainDrift.z / 11.0) * position.y * 1.3 * sqrt(grow);
    mvPosition = viewMatrix * vec4(world, 1.0);
  }
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const WEATHER_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
uniform float uLight;
uniform int uKind;
varying vec2 vUv;
varying float vFade;
void main() {
  #include <logdepthbuf_fragment>
  float disc = max(1.0 - length(vUv - 0.5) * 2.0, 0.0);
  float a = (1.0 - abs(vUv.x - 0.5) * 2.0) * smoothstep(0.0, 0.3, vUv.y) * 0.3;
  vec3 c = vec3(0.75, 0.8, 0.85);
  if (uKind == 1) {
    a = pow(disc, 1.5) * 0.9;
    c = vec3(1.0);
  } else if (uKind == 2) {
    a = pow(disc, 2.0);
    // Orange at most: twice this burnt to a yellow-white
    c = vec3(1.0, 0.42, 0.08) * 1.3;
  } else if (uKind == 3) {
    a = pow(disc, 1.2) * 0.7;
    c = vec3(0.36, 0.35, 0.33);
  } else if (uKind == 4) {
    a = disc * 0.18;
    c = vec3(0.82, 0.68, 0.5);
  }
  a *= vFade;
  if (a < 0.004) discard;
  gl_FragColor = uKind == 2 ? vec4(c * a, 1.0) : vec4(c * uLight, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
