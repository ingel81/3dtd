import {
  AmbientLight,
  Color,
  DataTexture,
  DirectionalLight,
  EquirectangularReflectionMapping,
  FogExp2,
  Group,
  HemisphereLight,
  LinearFilter,
  PMREMGenerator,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  Vector3,
  type Camera,
  type Fog,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';
import type { MapEnvironment } from '../../map-document';
import { HEIGHT_FOG_UNIFORMS } from './height-fog';
import { SkyDome } from './sky-dome';
import { WeatherLayer } from './weather';

/**
 * Sky, sun, fill light and fog of a custom map, from its MapEnvironment.
 *
 * - Sky: an equirectangular gradient with sun glow, computed on the CPU
 *   (no sky mesh, so nothing to get wrong with the log depth buffer and the
 *   LOS cube, which saves and restores `scene.background`). It is the
 *   background and, prefiltered (PMREM), the environment map that lights
 *   and reflects on every standard material.
 * - Sun: a directional light with a shadow map; its shadow box follows a
 *   focus point (`focus`), the camera's target in the game and editor.
 * - Hemisphere light for sky and ground bounce, exponential fog in the
 *   horizon colour.
 *
 * `apply(scene, renderer)` installs all of it and remembers what was there;
 * `detach()` puts that back. Lights are tuned for the game's renderer
 * (no tone mapping, sRGB output). The renderer needs `shadowMap.enabled`
 * for the sun's shadows (see `enableShadows`).
 */

interface SkyPreset {
  zenith: number;
  horizon: number;
  ground: number;
  sun: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  ambient: number;
  envIntensity: number;
  /** Strength of the glow around the sun in the sky */
  glow: number;
  /** Cloud threshold: lower = more clouds */
  cover: number;
  cloudColor: number;
  cloudShadow: number;
  /** Grade: contrast, saturation, tint */
  grade: [number, number, number];
}

const SKY_PRESETS: Record<MapEnvironment['sky'], SkyPreset> = {
  day: {
    zenith: 0x3f78c4,
    horizon: 0xc4d8e6,
    ground: 0x6b6a5c,
    sun: 0xffe6c4,
    sunIntensity: 3.8,
    hemiSky: 0xd6e2ee,
    hemiGround: 0x5a5236,
    hemiIntensity: 0.45,
    ambient: 0.05,
    envIntensity: 0.35,
    glow: 0.6,
    cover: 0.52,
    cloudColor: 0xffffff,
    cloudShadow: 0x9aa6b4,
    grade: [1.08, 0.94, 0xfff8ee],
  },
  dusk: {
    zenith: 0x2a3c6e,
    horizon: 0xf0a070,
    ground: 0x403530,
    sun: 0xffb070,
    sunIntensity: 2.2,
    hemiSky: 0xa0a8d0,
    hemiGround: 0x503828,
    hemiIntensity: 0.8,
    ambient: 0.12,
    envIntensity: 0.5,
    glow: 1.2,
    cover: 0.5,
    cloudColor: 0xffd2b0,
    cloudShadow: 0x6a5a68,
    grade: [1.1, 1.0, 0xffe8d8],
  },
  night: {
    zenith: 0x060b1c,
    horizon: 0x1c2a44,
    ground: 0x10141a,
    sun: 0x9fb4ff,
    sunIntensity: 0.7,
    hemiSky: 0x40508a,
    hemiGround: 0x101418,
    hemiIntensity: 0.6,
    ambient: 0.1,
    envIntensity: 0.35,
    glow: 0.3,
    cover: 0.55,
    cloudColor: 0x3a4460,
    cloudShadow: 0x141a28,
    grade: [1.1, 0.8, 0xdfe6ff],
  },
  overcast: {
    zenith: 0x8a96a2,
    horizon: 0xc2c8cc,
    ground: 0x5e6058,
    sun: 0xf0f0ee,
    sunIntensity: 1.0,
    hemiSky: 0xdde4ea,
    hemiGround: 0x5a5a4c,
    hemiIntensity: 1.6,
    ambient: 0.2,
    envIntensity: 0.7,
    glow: 0.15,
    cover: 0.22,
    cloudColor: 0xd8dde2,
    cloudShadow: 0x7d858e,
    grade: [1.04, 0.85, 0xf4f6f8],
  },
};

const SKY_WIDTH = 512;
const SKY_HEIGHT = 256;

/** Scene-space direction towards the sun (map: azimuth from north clockwise) */
export function sunDirection(azimuthDeg: number, elevationDeg: number, target: Vector3): Vector3 {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  // Map east = sin(az), north = cos(az); scene x = -east, z = north
  return target.set(-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
}

export class CustomMapEnvironment {
  readonly lights = new Group();
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly ambient: AmbientLight;
  readonly fog: FogExp2;
  readonly skyDome = new SkyDome();
  readonly weather = new WeatherLayer();
  sky: DataTexture;
  /** Sky colours (linear) and the direction towards the sun, for materials that fake reflections */
  readonly zenith = new Color();
  readonly horizon = new Color();
  readonly sunDir = new Vector3();
  private envMap: Texture | null = null;
  private pmrem: PMREMGenerator | null = null;
  private shadowRadius = 300;
  private scene: Scene | null = null;
  private renderer: WebGLRenderer | null = null;
  private previous: {
    background: Scene['background'];
    environment: Scene['environment'];
    environmentIntensity: number;
    fog: Fog | FogExp2 | null;
  } | null = null;

  constructor(private env: MapEnvironment) {
    this.lights.name = 'custom-map-lights';
    this.hemi = new HemisphereLight();
    this.ambient = new AmbientLight();
    this.sun = new DirectionalLight();
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    // Soft edges: PCF taps spread over this many texels
    this.sun.shadow.radius = 1.5;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 2000;
    this.lights.add(this.hemi, this.ambient, this.sun, this.sun.target, this.skyDome.mesh, this.weather.mesh);
    this.fog = new FogExp2(0xffffff, env.fogDensity);
    this.sky = this.buildSky();
    this.set(env);
  }

  /** Recomputes lights, fog and sky for a changed environment */
  set(env: MapEnvironment): void {
    const skyChanged = env.sky !== this.env.sky || env.sunAzimuth !== this.env.sunAzimuth || env.sunElevation !== this.env.sunElevation;
    this.env = env;
    const p = SKY_PRESETS[env.sky] ?? SKY_PRESETS.day;
    const tint = new Color(env.tint || '#ffffff');
    sunDirection(env.sunAzimuth, env.sunElevation, this.sunDir);
    // Low sun: warmer and weaker
    const low = Math.max(0, Math.min(1, env.sunElevation / 25));
    this.sun.color.set(p.sun).lerp(new Color(0xffa060), (1 - low) * 0.5).multiply(tint);
    this.sun.intensity = p.sunIntensity * (0.35 + 0.65 * low);
    this.hemi.color.set(p.hemiSky).multiply(tint);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    this.ambient.color.set(p.hemiSky).multiply(tint);
    this.ambient.intensity = p.ambient;
    // Haze: the horizon lifted a little towards the zenith's blue, so distance reads blue, not green
    this.fog.color.set(p.horizon).lerp(new Color(p.zenith), 0.18).multiply(tint);
    this.zenith.set(p.zenith).multiply(tint);
    this.horizon.set(p.horizon).multiply(tint);
    this.fog.density = env.fogDensity;
    // Weather: rain and snow close the sky, dim the sun and thicken the air; fog weather thickens it most
    const weather = env.weather ?? 'clear';
    const k = weather === 'clear' ? 0 : Math.min(1, Math.max(0, env.weatherStrength ?? 0.6));
    let cover = p.cover;
    if (weather === 'rain' || weather === 'snow') {
      cover = Math.max(0.15, p.cover - 0.35 * k);
      this.sun.intensity *= 1 - 0.55 * k;
      this.hemi.intensity *= 1 + 0.3 * k;
      this.fog.density = env.fogDensity * (1 + 2 * k);
      this.fog.color.lerp(new Color(weather === 'snow' ? 0xd8dde2 : 0x8e969c), 0.5 * k);
    } else if (weather === 'fog') {
      this.sun.intensity *= 1 - 0.4 * k;
      this.fog.density = env.fogDensity * (1 + 5 * k);
      this.fog.color.lerp(new Color(0xc0c6ca), 0.4 * k);
    }
    this.weather.set(weather, k, 1 - this.darkness * 0.85);
    this.placeSun(this.sun.target.position);
    HEIGHT_FOG_UNIFORMS.uFogSunColor.value.copy(this.sun.color).lerp(this.fog.color, 0.35);
    HEIGHT_FOG_UNIFORMS.uFogSunDir.value.copy(this.sunDir);
    HEIGHT_FOG_UNIFORMS.uGradeContrast.value = p.grade[0];
    HEIGHT_FOG_UNIFORMS.uGradeSaturation.value = p.grade[1];
    HEIGHT_FOG_UNIFORMS.uGradeTint.value.set(p.grade[2]);
    this.skyDome.set({
      zenith: this.zenith,
      horizon: this.horizon,
      sunDir: this.sunDir,
      sunColor: this.sun.color,
      cover,
      glow: p.glow * (1 - k * 0.7),
      cloudColor: new Color(p.cloudColor).multiply(tint),
      cloudShadow: new Color(p.cloudShadow).multiply(tint),
    });
    if (skyChanged) {
      this.sky.dispose();
      this.sky = this.buildSky();
      if (this.scene) this.installSky();
    }
  }

  /** Installs sky, environment map, fog and lights; remembers the scene's own */
  apply(scene: Scene, renderer: WebGLRenderer): void {
    this.detach();
    this.scene = scene;
    this.renderer = renderer;
    this.previous = {
      background: scene.background,
      environment: scene.environment,
      environmentIntensity: scene.environmentIntensity,
      fog: scene.fog as Fog | FogExp2 | null,
    };
    scene.fog = this.fog;
    scene.add(this.lights);
    this.installSky();
  }

  /** Restores what `apply` replaced */
  detach(): void {
    if (this.scene && this.previous) {
      this.scene.background = this.previous.background;
      this.scene.environment = this.previous.environment;
      this.scene.environmentIntensity = this.previous.environmentIntensity;
      this.scene.fog = this.previous.fog;
    }
    this.lights.removeFromParent();
    this.scene = null;
    this.renderer = null;
    this.previous = null;
  }

  /** Centres the sun's shadow box on a scene point; `radius` in metres around it */
  focus(point: Vector3, radius = this.shadowRadius): void {
    this.shadowRadius = radius;
    this.placeSun(point);
  }

  /** 0 by day, 1 at night: how much map lights (lanterns, torches) matter */
  get darkness(): number {
    const base = { day: 0, overcast: 0.2, dusk: 0.6, night: 1 }[this.env.sky] ?? 0;
    // A low sun darkens any sky
    return Math.min(1, Math.max(base, 1 - this.env.sunElevation / 12));
  }

  /** Height the fog is densest at (the map's low ground), metres in the scene */
  setFogBase(height: number): void {
    HEIGHT_FOG_UNIFORMS.uFogBase.value = height;
  }

  /** Per frame: the sky dome follows the camera, clouds drift, weather follows the focus */
  update(dt: number, camera: Camera, focus: Vector3): void {
    this.skyDome.update(dt, camera);
    this.weather.update(dt, camera, focus);
  }

  /** Turns on soft shadow maps on a renderer that has none */
  static enableShadows(renderer: WebGLRenderer): void {
    renderer.shadowMap.enabled = true;
  }

  dispose(): void {
    this.detach();
    this.sky.dispose();
    this.envMap?.dispose();
    this.pmrem?.dispose();
    this.sun.shadow.dispose();
    this.skyDome.dispose();
    this.weather.dispose();
  }

  private placeSun(focus: Vector3): void {
    const r = this.shadowRadius;
    const cam = this.sun.shadow.camera;
    // Snap the focus to whole shadow texels, so shadows do not shimmer while the camera pans
    const texel = (2 * r) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 800);
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.far = 1800;
    cam.updateProjectionMatrix();
    this.sun.updateMatrixWorld();
    this.sun.target.updateMatrixWorld();
  }

  private installSky(): void {
    const scene = this.scene;
    const renderer = this.renderer;
    if (!scene || !renderer) return;
    const p = SKY_PRESETS[this.env.sky] ?? SKY_PRESETS.day;
    scene.background = this.sky;
    this.pmrem ??= new PMREMGenerator(renderer);
    this.envMap?.dispose();
    this.envMap = this.pmrem.fromEquirectangular(this.sky).texture;
    scene.environment = this.envMap;
    scene.environmentIntensity = p.envIntensity;
  }

  private buildSky(): DataTexture {
    const p = SKY_PRESETS[this.env.sky] ?? SKY_PRESETS.day;
    const tint = new Color(this.env.tint || '#ffffff');
    const zenith = new Color(p.zenith).multiply(tint);
    const horizon = new Color(p.horizon).multiply(tint);
    const ground = new Color(p.ground);
    const sunCol = new Color(p.sun);
    const sun = sunDirection(this.env.sunAzimuth, this.env.sunElevation, new Vector3());
    const data = new Uint8Array(SKY_WIDTH * SKY_HEIGHT * 4);
    const c = new Color();
    const dir = new Vector3();
    for (let py = 0; py < SKY_HEIGHT; py++) {
      const v = (py + 0.5) / SKY_HEIGHT;
      const theta = (v - 0.5) * Math.PI;
      for (let px = 0; px < SKY_WIDTH; px++) {
        const u = (px + 0.5) / SKY_WIDTH;
        const phi = (u - 0.5) * 2 * Math.PI;
        // three's equirect lookup: u = atan(z, x) / 2pi + 0.5, v = asin(y) / pi + 0.5
        dir.set(Math.cos(phi) * Math.cos(theta), Math.sin(theta), Math.sin(phi) * Math.cos(theta));
        if (dir.y >= 0) {
          c.copy(horizon).lerp(zenith, Math.pow(dir.y, 0.45));
        } else {
          // Below the horizon only the fogged far land shows: stay near the fog colour
          c.copy(horizon).lerp(ground, Math.min(1, Math.pow(-dir.y * 4, 0.6)) * 0.25);
        }
        const cosSun = Math.max(0, dir.dot(sun));
        const glow = (Math.pow(cosSun, 6) * 0.25 + Math.pow(cosSun, 48) * 0.45) * p.glow;
        const disc = cosSun > 0.99985 ? 4 : cosSun > 0.9995 ? 1.5 : 0;
        c.r += sunCol.r * (glow + disc);
        c.g += sunCol.g * (glow + disc);
        c.b += sunCol.b * (glow + disc);
        // Linear to sRGB bytes
        const q = (py * SKY_WIDTH + px) * 4;
        data[q] = toSrgbByte(c.r);
        data[q + 1] = toSrgbByte(c.g);
        data[q + 2] = toSrgbByte(c.b);
        data[q + 3] = 255;
      }
    }
    const t = new DataTexture(data, SKY_WIDTH, SKY_HEIGHT, RGBAFormat, UnsignedByteType);
    t.colorSpace = SRGBColorSpace;
    t.mapping = EquirectangularReflectionMapping;
    t.magFilter = LinearFilter;
    t.minFilter = LinearFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  }
}

function toSrgbByte(linear: number): number {
  const v = Math.min(1, Math.max(0, linear));
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(s * 255);
}
