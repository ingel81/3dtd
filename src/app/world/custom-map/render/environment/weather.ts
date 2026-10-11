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
  Vector3,
  type Camera,
} from 'three';
import type { MapWeather } from '../../map-document';
import { COVER_GLSL, type CoverMap } from './cover-map';

/**
 * Rain or snow where the camera looks: a box of streaks or flakes around the
 * camera's focus on the ground (a game camera hangs far above the action),
 * reaching up towards the camera, that wraps as the view moves (each particle's spot is fixed in the world
 * and folded into the box), so the weather fills the view without
 * simulating anything. Fog weather has no particles; the environment
 * thickens its fog instead (CustomMapEnvironment).
 */

const BOX = new Vector3(160, 70, 160);
const MAX_RAIN = 24000;

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
  private readonly cam = new Vector3();

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
    g.instanceCount = 0;
    quad.dispose();
    const material = new ShaderMaterial({
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        {
          uTime: { value: 0 },
          uCam: { value: new Vector3() },
          uBox: { value: BOX.clone() },
          uLight: { value: 1 },
        },
      ]),
      defines: { KIND: 0 },
      vertexShader: WEATHER_VERTEX,
      fragmentShader: WEATHER_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      fog: true,
    });
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
    this.mesh.material.defines['COVER'] = 1;
    this.mesh.material.needsUpdate = true;
  }

  /** Particle kind and strength 0..1 (clear and fog show none); `light` dims lit particles at night */
  set(kind: WeatherParticles, strength: number, light: number): void {
    const m = this.mesh.material;
    const spec = KINDS[kind];
    if (spec && m.defines['KIND'] !== spec.id) {
      m.defines['KIND'] = spec.id;
      // Embers glow: added, not blended
      m.blending = kind === 'embers' ? AdditiveBlending : NormalBlending;
      m.needsUpdate = true;
    }
    const k = Math.min(1, Math.max(0, strength));
    this.mesh.geometry.instanceCount = spec ? Math.round(spec.max * k) : 0;
    this.mesh.visible = this.mesh.geometry.instanceCount > 0;
    m.uniforms['uLight'].value = light;
  }

  /** `focus`: the ground point the camera looks at, in the map group's space */
  update(dt: number, camera: Camera, focus: Vector3): void {
    if (!this.mesh.visible) return;
    camera.getWorldPosition(this.cam);
    this.mesh.parent?.worldToLocal(this.cam);
    // Centre between the focus and the camera, at most half the box above the ground
    this.cam.lerp(focus, 0.6);
    this.cam.y = Math.min(this.cam.y, focus.y + BOX.y * 0.45);
    const u = this.mesh.material.uniforms;
    u['uCam'].value.copy(this.cam);
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
uniform float uTime;
uniform vec3 uCam;
uniform vec3 uBox;
varying vec2 vUv;
varying float vFade;
#ifdef COVER
${COVER_GLSL}
#endif
void main() {
#if KIND == 1
  vec3 fall = vec3(sin(uTime * 0.6 + aSeed.x * 20.0) * 0.6 + uTime * 0.4, -uTime * 1.1, cos(uTime * 0.5 + aSeed.z * 20.0) * 0.6);
#elif KIND == 2
  // Embers rise and wander
  vec3 fall = vec3(sin(uTime * 0.9 + aSeed.x * 30.0) * 1.5, uTime * 1.6, cos(uTime * 0.7 + aSeed.z * 30.0) * 1.5);
#elif KIND == 3
  // Ash sinks slowly, tumbling
  vec3 fall = vec3(sin(uTime * 0.4 + aSeed.x * 20.0) * 1.2 + uTime * 0.6, -uTime * 0.45, cos(uTime * 0.3 + aSeed.z * 20.0) * 1.2);
#elif KIND == 4
  // Dust blows along near the ground
  vec3 fall = vec3(uTime * 5.0, sin(uTime * 0.8 + aSeed.y * 20.0) * 0.8, uTime * 1.5 + sin(uTime + aSeed.x * 10.0));
#else
  vec3 fall = vec3(uTime * 1.2, -uTime * 11.0, uTime * 0.4);
#endif
  vec3 local = aSeed * uBox + fall;
  vec3 p = uCam + mod(local - uCam, uBox) - uBox * 0.5;
  // Thin out at the edges of the box, so its walls never show
  vec3 rel = abs(p - uCam) / (uBox * 0.5);
  vFade = 1.0 - smoothstep(0.7, 1.0, max(rel.x, max(rel.y, rel.z)));
  vFade = min(1.0, vFade * 1.6);
#ifdef COVER
  // Under a roof or below the ground: not drawn (ash and dust stay above the ground as well)
  vFade *= step(coverTopAt(p), p.y);
#endif
  vUv = uv;
  // Far from the camera particles grow (a game camera looks from 100 m and more), and thin out
  float camDist = length(cameraPosition - p);
  float grow = max(1.0, camDist / 35.0);
  // Right in front of the lens a streak or flake would fill the screen
  vFade *= smoothstep(3.0, 9.0, camDist);
#if KIND == 4
  // Dust stays low: fade with height over the box's floor
  vFade *= 1.0 - smoothstep(0.0, 0.5, (p.y - (uCam.y - uBox.y * 0.5)) / uBox.y);
#endif
#if KIND != 0
  vFade /= sqrt(grow);
  #if KIND == 4
  float size = 0.6;
  #elif KIND == 2
  float size = 0.12;
  #else
  float size = 0.14;
  #endif
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  mvPosition.xy += position.xy * size * grow * 1.6;
#else
  vFade /= grow;
  // A streak standing upright, turned towards the camera
  vec3 toCam = normalize(cameraPosition - p);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam) + 1e-5);
  vec3 world = p + right * position.x * 0.035 * grow + vec3(0.12, 1.0, 0.04) * position.y * 1.3 * sqrt(grow);
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
#endif
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
varying vec2 vUv;
varying float vFade;
void main() {
  #include <logdepthbuf_fragment>
#if KIND == 1
  float a = pow(max(1.0 - length(vUv - 0.5) * 2.0, 0.0), 1.5) * 0.9;
  vec3 c = vec3(1.0);
#elif KIND == 2
  float a = pow(max(1.0 - length(vUv - 0.5) * 2.0, 0.0), 2.0);
  vec3 c = vec3(1.0, 0.55, 0.18) * 2.0;
#elif KIND == 3
  float a = pow(max(1.0 - length(vUv - 0.5) * 2.0, 0.0), 1.2) * 0.8;
  vec3 c = vec3(0.55, 0.54, 0.5);
#elif KIND == 4
  float a = pow(max(1.0 - length(vUv - 0.5) * 2.0, 0.0), 1.0) * 0.18;
  vec3 c = vec3(0.82, 0.68, 0.5);
#else
  float a = (1.0 - abs(vUv.x - 0.5) * 2.0) * smoothstep(0.0, 0.3, vUv.y) * 0.3;
  vec3 c = vec3(0.75, 0.8, 0.85);
#endif
  a *= vFade;
  if (a < 0.004) discard;
#if KIND == 2
  gl_FragColor = vec4(c * a, 1.0);
#else
  gl_FragColor = vec4(c * uLight, a);
#endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
