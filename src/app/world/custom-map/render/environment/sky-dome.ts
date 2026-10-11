import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3, type Camera } from 'three';
import { SHADER_NOISE } from '../shader-noise';

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
        uTime: { value: 0 },
      },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
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
  }

  /** Follows the camera and moves the clouds */
  update(dt: number, camera: Camera): void {
    camera.getWorldPosition(this.mesh.position);
    this.mesh.parent?.worldToLocal(this.mesh.position);
    this.mesh.updateMatrix();
    this.mesh.updateMatrixWorld();
    this.mesh.material.uniforms['uTime'].value += dt;
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

const SKY_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uCloudColor;
uniform vec3 uCloudShadow;
uniform float uCover;
uniform float uGlow;
uniform float uTime;
varying vec3 vDir;

${SHADER_NOISE}

float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += valueNoise(p) * a;
    p = p * 2.03 + vec2(17.3, -9.1);
    a *= 0.5;
  }
  return s;
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 dir = normalize(vDir);
  float up = max(dir.y, 0.0);
  // Gradient: haze at the horizon, deep colour at the zenith
  vec3 sky = mix(uHorizon, uZenith, pow(up, 0.45));
  float cosSun = max(dot(dir, uSunDir), 0.0);
  // Glow around the sun, brightest where it meets the horizon haze
  sky += uSunColor * (pow(cosSun, 6.0) * 0.22 + pow(cosSun, 64.0) * 0.5) * uGlow * (1.0 - up * 0.5);
  // Clouds on a plane above the camera, thinning towards the horizon
  if (dir.y > 0.0) {
    vec2 p = dir.xz / (dir.y + 0.12) * 0.9;
    vec2 wind = vec2(uTime * 0.004, uTime * 0.0015);
    float base = fbm(p + wind);
    float detail = fbm(p * 3.1 - wind * 2.0);
    float d = base * 0.75 + detail * 0.25;
    float density = smoothstep(uCover, uCover + 0.28, d);
    // Lit from the sun's side: compare with the density a step towards the sun
    vec2 toSun = normalize(uSunDir.xz + 1e-4) * 0.06;
    float ahead = fbm(p + wind + toSun) * 0.75 + detail * 0.25;
    float lit = clamp(0.55 + (d - ahead) * 3.0, 0.0, 1.0);
    vec3 cloud = mix(uCloudShadow, uCloudColor, lit);
    // Silver lining near the sun
    cloud += uSunColor * pow(cosSun, 12.0) * 0.6 * (1.0 - density);
    float fade = smoothstep(0.0, 0.25, dir.y);
    sky = mix(sky, cloud, density * fade * 0.92);
  }
  // Sun disc over the clouds' thin parts
  sky += uSunColor * smoothstep(0.9996, 0.9999, cosSun) * 6.0;
  gl_FragColor = vec4(sky, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
