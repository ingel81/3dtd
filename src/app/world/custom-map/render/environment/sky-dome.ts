import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3, type Camera } from 'three';
import { SHADER_NOISE } from '../shader-noise';
import { HEIGHT_FOG_PARS, HEIGHT_FOG_UNIFORMS } from './height-fog';

/**
 * The visible sky: a dome around the camera drawn first, without depth test,
 * with a gradient from horizon haze to zenith, the sun with its glow and
 * procedural clouds (two fbm layers drifting with the wind, lit from the
 * sun's side, thinning towards the horizon where the haze takes over).
 *
 * The equirect sky of CustomMapEnvironment stays the background behind it
 * and the source of the environment light; the dome only adds what a low
 * resolution texture cannot show (crisp clouds, a sharp sun). It is a
 * sibling of the map, so the LOS cube hides it.
 */
export class SkyDome {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;

  /** The sky's uniforms; materials that reflect the sky share these objects (SKY_FUNCTIONS) */
  get uniforms(): ShaderMaterial['uniforms'] {
    return this.mesh.material.uniforms;
  }

  constructor() {
    const material = new ShaderMaterial({
      uniforms: {
        uZenith: { value: new Color() },
        uHorizon: { value: new Color() },
        uSunDir: { value: new Vector3(0, 1, 0) },
        uSunColor: { value: new Color() },
        uCloudColor: { value: new Color(1, 1, 1) },
        uCloudShadow: { value: new Color(0.55, 0.6, 0.68) },
        uCover: { value: 0.5 },
        uGlow: { value: 0.6 },
        uSkyTime: { value: 0 },
        uStars: { value: 0 },
        uPlanet: { value: 0 },
        uAurora: { value: 0 },
      },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    Object.assign(material.uniforms, HEIGHT_FOG_UNIFORMS);
    material.name = 'custom-map-sky';
    this.mesh = new Mesh(new SphereGeometry(1000, 48, 24), material);
    this.mesh.name = 'custom-map-sky';
    this.mesh.renderOrder = -1e6;
    this.mesh.frustumCulled = false;
    this.mesh.userData['losTransparent'] = true;
  }

  set(p: {
    zenith: Color;
    horizon: Color;
    sunDir: Vector3;
    sunColor: Color;
    cover: number;
    glow: number;
    cloudColor: Color;
    cloudShadow: Color;
    stars?: number;
    planet?: boolean;
    aurora?: number;
  }): void {
    const u = this.mesh.material.uniforms;
    u['uZenith'].value.copy(p.zenith);
    u['uHorizon'].value.copy(p.horizon);
    u['uSunDir'].value.copy(p.sunDir);
    u['uSunColor'].value.copy(p.sunColor);
    u['uCover'].value = p.cover;
    u['uGlow'].value = p.glow;
    u['uCloudColor'].value.copy(p.cloudColor);
    u['uCloudShadow'].value.copy(p.cloudShadow);
    u['uStars'].value = p.stars ?? 0;
    u['uPlanet'].value = p.planet ? 1 : 0;
    u['uAurora'].value = p.aurora ?? 0;
  }

  /** Follows the camera and moves the clouds */
  update(dt: number, camera: Camera): void {
    camera.getWorldPosition(this.mesh.position);
    this.mesh.parent?.worldToLocal(this.mesh.position);
    this.mesh.updateMatrix();
    this.mesh.updateMatrixWorld();
    this.mesh.material.uniforms['uSkyTime'].value += dt;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.removeFromParent();
  }
}

const SKY_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // On the far plane, never clipped by it (a camera with a short far plane still sees the sky)
  gl_Position.z = gl_Position.w * 0.99999;
  #include <logdepthbuf_vertex>
}
`;

/**
 * Sky colour for a direction (gradient, sun glow, clouds), shared by the
 * dome and the water's reflection. Needs SHADER_NOISE before it.
 */
export const SKY_FUNCTIONS = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uCloudColor;
uniform vec3 uCloudShadow;
uniform float uCover;
uniform float uGlow;
uniform float uSkyTime;
uniform float uStars;
uniform float uPlanet;
uniform float uAurora;

float skyFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += valueNoise(p) * a;
    p = p * 2.03 + vec2(17.3, -9.1);
    a *= 0.5;
  }
  return s;
}

vec3 skyColor(vec3 dir, bool withSun) {
  float up = max(dir.y, 0.0);
  // Gradient: haze at the horizon, deep colour at the zenith
  vec3 sky = mix(uHorizon, uZenith, pow(up, 0.45));
  float cosSun = max(dot(dir, uSunDir), 0.0);
  // Glow around the sun, brightest where it meets the horizon haze
  sky += uSunColor * (pow(cosSun, 6.0) * 0.22 + pow(cosSun, 64.0) * 0.5) * uGlow * (1.0 - up * 0.5);
  // Clouds on a plane above the camera, thinning towards the horizon
  if (dir.y > 0.0) {
    vec2 p = dir.xz / (dir.y + 0.12) * 0.9;
    vec2 wind = vec2(uSkyTime * 0.004, uSkyTime * 0.0015);
    float base = skyFbm(p + wind);
    float detail = skyFbm(p * 3.1 - wind * 2.0);
    float d = base * 0.75 + detail * 0.25;
    float density = smoothstep(uCover, uCover + 0.28, d);
    // Lit from the sun's side: compare with the density a step towards the sun
    vec2 toSun = normalize(uSunDir.xz + 1e-4) * 0.06;
    float ahead = skyFbm(p + wind + toSun) * 0.75 + detail * 0.25;
    float lit = clamp(0.55 + (d - ahead) * 3.0, 0.0, 1.0);
    vec3 cloud = mix(uCloudShadow, uCloudColor, lit);
    // Silver lining near the sun
    cloud += uSunColor * pow(cosSun, 12.0) * 0.6 * (1.0 - density);
    float fade = smoothstep(0.0, 0.25, dir.y);
    sky = mix(sky, cloud, density * fade * 0.92);
  }
  if (dir.y > 0.0) {
    // Stars: a hash per cell of a direction grid, twinkling a little, faint near the horizon
    if (uStars > 0.0) {
      vec3 sd = dir * 380.0;
      vec3 cell = floor(sd);
      float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      vec3 f = fract(sd) - 0.5;
      float star = step(0.9965, h) * smoothstep(0.35, 0.0, length(f)) * (0.6 + 0.4 * sin(uSkyTime * 2.0 + h * 50.0));
      sky += vec3(0.9, 0.93, 1.0) * star * uStars * 1.6 * smoothstep(0.0, 0.25, dir.y);
    }
    // A planet (the earth over the moon): a disc lit from the sun's side, oceans, land and clouds
    if (uPlanet > 0.5) {
      vec3 pd = normalize(vec3(-0.45, 0.55, 0.7));
      vec3 t1 = normalize(cross(pd, vec3(0.0, 1.0, 0.0)));
      vec3 t2 = cross(t1, pd);
      float size = 0.035;
      vec2 q = vec2(dot(dir, t1), dot(dir, t2)) / size;
      float r = length(q);
      if (dot(dir, pd) > 0.0 && r < 1.0) {
        vec3 nrm = normalize(q.x * t1 + q.y * t2 - pd * sqrt(1.0 - r * r));
        float lit = smoothstep(-0.1, 0.25, dot(-nrm, -uSunDir));
        float land = smoothstep(0.5, 0.58, skyFbm(q * 2.2 + 4.0));
        float clouds = smoothstep(0.55, 0.72, skyFbm(q * 3.5 + vec2(uSkyTime * 0.002, 9.0)));
        vec3 surface = mix(vec3(0.06, 0.18, 0.5), vec3(0.28, 0.38, 0.2), land);
        surface = mix(surface, vec3(0.92), clouds);
        // A thin bright rim of atmosphere
        surface += vec3(0.25, 0.45, 0.9) * pow(r, 6.0) * 0.6;
        sky = mix(sky, surface * (0.04 + lit * 1.1), smoothstep(1.0, 0.97, r));
      }
    }
    // Aurora: green curtains waving along the sky at night
    if (uAurora > 0.0) {
      float az = atan(dir.z, dir.x);
      float wave = skyFbm(vec2(az * 3.0 + uSkyTime * 0.02, uSkyTime * 0.03));
      float band = smoothstep(0.12, 0.25, dir.y - wave * 0.15) * smoothstep(0.65, 0.35, dir.y - wave * 0.15);
      float rays = 0.6 + 0.4 * sin(az * 90.0 + wave * 20.0 + uSkyTime * 0.5);
      sky += mix(vec3(0.1, 0.9, 0.45), vec3(0.5, 0.2, 0.8), smoothstep(0.35, 0.6, dir.y)) * band * rays * uAurora * 0.6;
    }
  }
  // Sun disc
  if (withSun) sky += uSunColor * smoothstep(0.9996, 0.9999, cosSun) * 6.0;
  return sky;
}
`;

const SKY_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vDir;

${SHADER_NOISE}
${SKY_FUNCTIONS}
${HEIGHT_FOG_PARS}

void main() {
  #include <logdepthbuf_fragment>
  gl_FragColor = vec4(skyColor(normalize(vDir), true), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb = mapGrade(gl_FragColor.rgb);
}
`;
