import {
  BackSide,
  Color,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  ClampToEdgeWrapping,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Camera,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { SHADER_NOISE } from '../shader-noise';
import { HEIGHT_FOG_PARS, HEIGHT_FOG_UNIFORMS } from './height-fog';
import { WIND_UNIFORMS } from './wind';

/**
 * The visible sky: a dome around the camera with a gradient from horizon
 * haze to zenith, the sun with its glow and procedural clouds (two fbm
 * layers drifting with the wind, lit from the sun's side, thinning towards
 * the horizon where the haze takes over).
 *
 * Drawn last of the opaque objects, on the far plane and with the depth
 * test (review 2026-10-11): its noise runs only where no ground or object
 * stands, and early-z keeps the covered pixels out. It writes no depth of
 * its own (no logdepthbuf chunks: a fragment depth would turn early-z off;
 * the vertex puts it on the far plane, behind every logarithmic depth the
 * map writes). The equirect sky of CustomMapEnvironment is only the source
 * of the environment light, no longer a second full-screen pass behind it.
 * It is a sibling of the map, so the LOS cube hides it.
 *
 * Water reflects the same sky from a small texture (`uSkyTex`, the upper
 * hemisphere, 256 x 64, linear half float) that `bake` renders now and then
 * (`SKY_BAKE_FRAMES`), not the full function per water pixel: it ran
 * two or three times per pixel, two cloud layers of five octaves each.
 * SKY_TEXTURE_GLSL reads it.
 *
 * An image sky (sky-images.ts) replaces the function's gradient, clouds,
 * stars and sun with a picture of the upper hemisphere (`setImage`), turned
 * about the vertical so its sun stands where the map's does; haze at the
 * foot, grading and the baked texture for the water stay the same.
 */

/** Frames between two bakes of the sky texture: clouds drift slowly */
const SKY_BAKE_FRAMES = 3;
export class SkyDome {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly bakeTarget = new WebGLRenderTarget(256, 64, {
    type: HalfFloatType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    wrapS: RepeatWrapping,
    wrapT: ClampToEdgeWrapping,
    depthBuffer: false,
    generateMipmaps: false,
  });
  private readonly bakeScene = new Scene();
  private readonly bakeCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private bakeAge = SKY_BAKE_FRAMES;

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
        // The glow around the sun, usually its light (Mars: a blue halo at dusk)
        uGlowColor: { value: new Color() },
        uCloudColor: { value: new Color(1, 1, 1) },
        uCloudShadow: { value: new Color(0.55, 0.6, 0.68) },
        uCover: { value: 0.5 },
        uGlow: { value: 0.6 },
        uSkyTime: { value: 0 },
        // How far the clouds have drifted with the wind (cloud plane units), integrated so a change of wind never jumps
        uCloudOffset: { value: new Vector2() },
        // The haze colour (linear): the dome's foot fades into it, as the far land does
        uSkyHaze: { value: new Color() },
        uStars: { value: 0 },
        uPlanet: { value: 0 },
        uAurora: { value: 0 },
        // An image sky: the upper hemisphere (top row the zenith), its turn about the vertical (radians)
        uSkyImage: { value: null },
        uSkyImageOn: { value: 0 },
        uSkyImageYaw: { value: 0 },
      },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: BackSide,
      depthTest: true,
      depthWrite: false,
      fog: false,
    });
    Object.assign(material.uniforms, HEIGHT_FOG_UNIFORMS);
    material.name = 'custom-map-sky';
    this.mesh = new Mesh(new SphereGeometry(1000, 48, 24), material);
    this.mesh.name = 'custom-map-sky';
    // After every opaque object of the scene (three sorts opaques by renderOrder first)
    this.mesh.renderOrder = 1e6;
    this.mesh.frustumCulled = false;
    this.mesh.userData['losTransparent'] = true;
    // The baked texture shares the uniform objects; reflecting materials take uSkyTex with them
    material.uniforms['uSkyTex'] = { value: this.bakeTarget.texture };
    const bake = new ShaderMaterial({ uniforms: material.uniforms, vertexShader: BAKE_VERTEX, fragmentShader: BAKE_FRAGMENT, depthTest: false, depthWrite: false });
    bake.name = 'custom-map-sky-bake';
    const quad = new Mesh(new PlaneGeometry(2, 2), bake);
    quad.frustumCulled = false;
    this.bakeScene.add(quad);
  }

  /**
   * Renders the sky into its texture every few frames, or on the next call
   * after `set` (a new sky). The renderer's target is put back.
   */
  bake(renderer: WebGLRenderer): void {
    if (++this.bakeAge < SKY_BAKE_FRAMES) return;
    this.bakeAge = 0;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.bakeTarget);
    renderer.render(this.bakeScene, this.bakeCamera);
    renderer.setRenderTarget(previous);
  }

  set(p: {
    zenith: Color;
    horizon: Color;
    sunDir: Vector3;
    sunColor: Color;
    glowColor?: Color;
    cover: number;
    glow: number;
    cloudColor: Color;
    cloudShadow: Color;
    haze: Color;
    stars?: number;
    planet?: boolean;
    aurora?: number;
  }): void {
    const u = this.mesh.material.uniforms;
    u['uZenith'].value.copy(p.zenith);
    u['uHorizon'].value.copy(p.horizon);
    u['uSunDir'].value.copy(p.sunDir);
    u['uSunColor'].value.copy(p.sunColor);
    u['uGlowColor'].value.copy(p.glowColor ?? p.sunColor);
    u['uCover'].value = p.cover;
    u['uGlow'].value = p.glow;
    u['uCloudColor'].value.copy(p.cloudColor);
    u['uCloudShadow'].value.copy(p.cloudShadow);
    u['uSkyHaze'].value.copy(p.haze);
    u['uStars'].value = p.stars ?? 0;
    u['uPlanet'].value = p.planet ? 1 : 0;
    u['uAurora'].value = p.aurora ?? 0;
    this.bakeAge = SKY_BAKE_FRAMES;
  }

  /** Shows a picture instead of the procedural sky, turned by `yaw` (sky-images.ts); null: procedural */
  setImage(texture: Texture | null, yaw = 0): void {
    const u = this.mesh.material.uniforms;
    u['uSkyImage'].value = texture;
    u['uSkyImageOn'].value = texture ? 1 : 0;
    u['uSkyImageYaw'].value = yaw;
    this.bakeAge = SKY_BAKE_FRAMES;
  }

  /** Follows the camera and moves the clouds */
  update(dt: number, camera: Camera): void {
    camera.getWorldPosition(this.mesh.position);
    this.mesh.parent?.worldToLocal(this.mesh.position);
    this.mesh.updateMatrix();
    this.mesh.updateMatrixWorld();
    const u = this.mesh.material.uniforms;
    u['uSkyTime'].value += dt;
    // The wind's direction on the cloud plane; a calm day still lets them creep
    const w = WIND_UNIFORMS;
    const speed = (0.0015 + 0.008 * w.uWindStrength.value) * dt;
    u['uCloudOffset'].value.addScaledVector(w.uWindDir.value, speed);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.bakeTarget.dispose();
    for (const m of this.bakeScene.children as Mesh<PlaneGeometry, ShaderMaterial>[]) {
      m.geometry.dispose();
      m.material.dispose();
    }
    this.mesh.removeFromParent();
  }
}

const SKY_VERTEX = /* glsl */ `
#include <common>
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // On the far plane, never clipped by it (a camera with a short far plane still sees the sky); no
  // logdepthbuf chunks: this depth is the dome's, behind everything, and early-z stays on
  gl_Position.z = gl_Position.w * 0.99999;
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
uniform vec3 uGlowColor;
uniform vec3 uCloudColor;
uniform vec3 uCloudShadow;
uniform float uCover;
uniform float uGlow;
uniform float uSkyTime;
uniform vec2 uCloudOffset;
uniform float uStars;
uniform float uPlanet;
uniform float uAurora;
uniform sampler2D uSkyImage;
uniform float uSkyImageOn;
uniform float uSkyImageYaw;

// The image sky in a direction: the picture holds the upper hemisphere, below it its horizon row
vec3 skyImageColor(vec3 dir) {
  float u = fract((atan(dir.z, dir.x) + uSkyImageYaw) / (2.0 * PI) + 0.5);
  float v = 1.0 - asin(clamp(dir.y, 0.0, 1.0)) / (0.5 * PI);
  return texture2D(uSkyImage, vec2(u, v)).rgb;
}

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
  sky += uGlowColor * (pow(cosSun, 6.0) * 0.22 + pow(cosSun, 64.0) * 0.5) * uGlow * (1.0 - up * 0.5);
  // Clouds on a plane above the camera, thinning towards the horizon
  if (dir.y > 0.0) {
    vec2 p = dir.xz / (dir.y + 0.12) * 0.9;
    // Sampled against the drift: the pattern moves along the wind, the detail a little faster
    float base = skyFbm(p - uCloudOffset);
    float detail = skyFbm(p * 3.1 - uCloudOffset * 3.6);
    float d = base * 0.75 + detail * 0.25;
    float density = smoothstep(uCover, uCover + 0.28, d);
    // Lit from the sun's side: compare with the density a step towards the sun
    vec2 toSun = normalize(uSunDir.xz + 1e-4) * 0.06;
    float ahead = skyFbm(p - uCloudOffset + toSun) * 0.75 + detail * 0.25;
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
varying vec3 vDir;
uniform vec3 uSkyHaze;

${SHADER_NOISE}
${SKY_FUNCTIONS}
${HEIGHT_FOG_PARS}

void main() {
  vec3 dir = normalize(vDir);
  // A uniform branch: an image sky skips the clouds' noise
  vec3 sky;
  if (uSkyImageOn > 0.5) sky = skyImageColor(dir);
  else sky = skyColor(dir, true);
  gl_FragColor = vec4(sky, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // The lowest few degrees fade into the haze the far land sinks into (height-fog.ts, same colour and
  // the same pull towards the sun, in output space as there): no bright seam over the hills beyond
  float sunward = pow(max(dot(dir, uFogSunDir), 0.0), 8.0);
  vec3 haze = mix(linearToOutputTexel(vec4(uSkyHaze, 1.0)).rgb, linearToOutputTexel(vec4(uFogSunColor, 1.0)).rgb, sunward * 0.2);
  gl_FragColor.rgb = mix(haze, gl_FragColor.rgb, smoothstep(-0.02, 0.1, dir.y));
  gl_FragColor.rgb = mapGrade(gl_FragColor.rgb);
}
`;

/** The sky texture's direction per texel: x the azimuth all round, y the elevation 0 to 90 degrees */
const BAKE_VERTEX = /* glsl */ `
varying vec2 vSkyUv;
void main() {
  vSkyUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const BAKE_FRAGMENT = /* glsl */ `
#include <common>
varying vec2 vSkyUv;
${SHADER_NOISE}
${SKY_FUNCTIONS}
void main() {
  float az = (vSkyUv.x - 0.5) * 2.0 * PI;
  float el = vSkyUv.y * 0.5 * PI;
  vec3 dir = vec3(cos(az) * cos(el), sin(el), sin(az) * cos(el));
  // A uniform branch: an image sky skips the clouds' noise
  vec3 sky;
  if (uSkyImageOn > 0.5) sky = skyImageColor(dir);
  else sky = skyColor(dir, false);
  gl_FragColor = vec4(sky, 1.0);
}
`;

/**
 * Reads the baked sky (`uSkyTex`, linear) in a direction; below the
 * horizon the horizon's row. Without the sky dome's texture the haze.
 */
export const SKY_TEXTURE_GLSL = /* glsl */ `
uniform sampler2D uSkyTex;
vec3 skyTex(vec3 dir) {
  vec2 uv = vec2(atan(dir.z, dir.x) / (2.0 * PI) + 0.5, asin(clamp(dir.y, 0.0, 1.0)) / (0.5 * PI));
  return texture2D(uSkyTex, uv).rgb;
}
`;
