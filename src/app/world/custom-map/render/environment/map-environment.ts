import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DirectionalLight,
  EquirectangularReflectionMapping,
  FogExp2,
  Group,
  HemisphereLight,
  LinearFilter,
  Mesh,
  NeutralToneMapping,
  OrthographicCamera,
  PMREMGenerator,
  RGBAFormat,
  Scene as ThreeScene,
  SRGBColorSpace,
  UnsignedByteType,
  Vector3,
  type Camera,
  type Fog,
  type Material,
  type Scene,
  type ToneMapping,
  type WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import type { MapEnvironment } from '../../map-document';
import { HEIGHT_FOG_UNIFORMS } from './height-fog';
import { biomeLook, type BiomeLook } from './biomes';
import { SkyDome } from './sky-dome';
import { WeatherLayer } from './weather';
import { setWind, windOf, WIND_UNIFORMS } from './wind';

/**
 * Sky, sun, fill light and fog of a custom map, from its MapEnvironment.
 *
 * - Sky: an equirectangular gradient with sun glow, computed on the CPU;
 *   prefiltered (PMREM), the environment map that lights and reflects on
 *   every standard material. What shows is the SkyDome; the background is
 *   a plain clear in the haze's colour behind it (the LOS cube saves and
 *   restores `scene.background`).
 * - Sun: a directional light with a shadow map; its shadow box follows a
 *   focus point (`focus`), the camera's target in the game and editor.
 * - Hemisphere light for sky and ground bounce, exponential fog in the
 *   horizon colour.
 *
 * `apply(scene, renderer)` installs all of it and remembers what was there;
 * `detach()` puts that back. The map is tone mapped (Khronos PBR Neutral,
 * the look's exposure): `apply` sets the renderer's tone mapping, `detach`
 * gives the one it had back exactly, so tiles and the globe never see it.
 * Neutral leaves colours below about 0.76 as they are and rolls off the
 * highlights, so towers, enemies and effects keep their look. The renderer
 * needs `shadowMap.enabled` for the sun's shadows (see `enableShadows`).
 */

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
  /** Where the haze starts (the map's look and weather) and the clear air the editor asks for on top */
  private fogStart = 450;
  private clearAir = 0;
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
  private envTarget: WebGLRenderTarget | null = null;
  private pmrem: PMREMGenerator | null = null;
  /** Whether the PMREM programs are linked; until then a sky change waits for them */
  private pmremReady = false;
  private envDirty = false;
  /**
   * Resolves once the environment map holds the sky. The first one waits for
   * PMREM's programs to link off the main thread; `warmUp` waits for it.
   */
  envReady: Promise<void> = Promise.resolve();
  private shadowRadius = 300;
  /**
   * The sun's shadow map renders only when something it shows changed: the
   * map is static, the game's objects cast none. `invalidateShadows` for
   * changed objects or ground; a new sun, a moved or resized shadow box
   * set it here.
   */
  private shadowDirty = true;
  private readonly shadowCenter = new Vector3(Number.NaN, 0, 0);
  private shadowBoxRadius = 0;
  private previousShadowAuto: boolean | null = null;
  private previousToneMapping: { mapping: ToneMapping; exposure: number } | null = null;
  private scene: Scene | null = null;
  private renderer: WebGLRenderer | null = null;
  /** The scene's background: a plain clear in the haze's colour, the dome over it */
  private readonly backdrop = new Color();
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
    const skyChanged =
      env.sky !== this.env.sky ||
      env.biome !== this.env.biome ||
      env.sunAzimuth !== this.env.sunAzimuth ||
      env.sunElevation !== this.env.sunElevation ||
      // The tint colours the sky's pixels and so the environment map (fillSky)
      (env.tint || '#ffffff') !== (this.env.tint || '#ffffff');
    this.env = env;
    const p = this.look();
    if (this.renderer && this.previousToneMapping) this.renderer.toneMappingExposure = p.exposure;
    const tint = new Color(env.tint || '#ffffff');
    sunDirection(env.sunAzimuth, env.sunElevation, this.sunDir);
    // Low sun: warmer and weaker
    const low = Math.max(0, Math.min(1, env.sunElevation / 25));
    this.sun.color.set(p.sun).lerp(new Color(0xffa060), (1 - low) * 0.5).multiply(tint);
    this.sun.intensity = p.sunIntensity * (0.35 + 0.65 * low);
    this.hemi.color.set(p.hemiSky).multiply(tint);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    // Moonlight: a night map lit cool and bright enough to read from the game camera; sky untouched
    const moon = env.sky === 'night' ? Math.min(1, Math.max(0, env.moonlight ?? 0)) : 0;
    if (moon > 0) {
      this.sun.color.lerp(new Color(0xa8c0ff).multiply(tint), moon * 0.7);
      this.sun.intensity += 1.5 * moon;
      this.hemi.color.lerp(new Color(0x6078b0).multiply(tint), moon * 0.5);
      this.hemi.intensity += 0.8 * moon;
    }
    this.ambient.color.set(p.hemiSky).multiply(tint);
    this.ambient.intensity = p.ambient;
    // Haze: the horizon lifted a little towards the zenith's blue, so distance reads blue, not green
    // The map's tint colours its light fully, its sky and air only a little: a green or orange
    // mood tint over the whole haze made the far land olive or brown
    const airTint = new Color(1, 1, 1).lerp(tint, 0.3);
    // Haze: between horizon and zenith, a little desaturated, so distance reads blue-grey, not the horizon's hue
    this.fog.color.set(p.horizon).lerp(new Color(p.zenith), 0.3).multiply(airTint);
    const fogGrey = (this.fog.color.r + this.fog.color.g + this.fog.color.b) / 3;
    this.fog.color.lerp(new Color(fogGrey, fogGrey, fogGrey), 0.3);
    this.zenith.set(p.zenith).multiply(airTint);
    this.horizon.set(p.horizon).multiply(airTint);
    // Capped: imported maps (Warcraft fog ends) can ask for densities that hide the map in milk
    const baseFog = Math.min(env.fogDensity, 0.004) * p.fogScale;
    this.fog.density = baseFog;
    HEIGHT_FOG_UNIFORMS.uFogFalloff.value = p.fogFalloff;
    // Weather: rain and snow close the sky, dim the sun and thicken the air; fog weather thickens it most
    const weather = env.weather ?? 'clear';
    const k = weather === 'clear' ? 0 : Math.min(1, Math.max(0, env.weatherStrength ?? 0.6));
    let cover = p.cover;
    // Rain, snow and fog grey the air towards their own colour, which at night is dark as well
    const airLight = 1 - this.darkness * 0.85;
    if (weather === 'rain' || weather === 'snow') {
      cover = Math.max(0.15, p.cover - 0.35 * k);
      this.sun.intensity *= 1 - 0.55 * k;
      this.hemi.intensity *= 1 + 0.3 * k;
      this.fog.density = baseFog * (1 + 2 * k);
      this.fog.color.lerp(new Color(weather === 'snow' ? 0xd8dde2 : 0x8e969c).multiplyScalar(airLight), 0.5 * k);
    } else if (weather === 'fog') {
      this.sun.intensity *= 1 - 0.4 * k;
      this.fog.density = Math.max(baseFog, 0.0008) * (1 + 5 * k);
      this.fog.color.lerp(new Color(0xc0c6ca).multiplyScalar(airLight), 0.4 * k);
    }
    // The weather's particles, or the biome's own ambient ones (embers, ash, dust, drifting snow)
    if (weather === 'rain' || weather === 'snow') this.weather.set(weather, k, 1 - this.darkness * 0.85);
    else if (p.particles) this.weather.set(p.particles, p.particles === 'snow' ? 0.25 : 0.5, 1 - this.darkness * 0.85);
    else this.weather.set('clear', 0, 1);
    HEIGHT_FOG_UNIFORMS.uFogDensity.value = this.fog.density;
    // The clear behind the dome follows the haze (the scene holds this Color)
    this.backdrop.copy(this.fog.color);
    // Clear air before the haze: shorter in fog weather and in a swamp
    this.fogStart = weather === 'fog' ? 450 * (1 - 0.85 * k) : env.biome === 'swamp' ? 120 : 450;
    HEIGHT_FOG_UNIFORMS.uFogStart.value = Math.max(this.fogStart, this.clearAir);
    // Snow on everything facing up, wetness in rain (and a little in a swamp)
    const snowFromWeather = weather === 'snow' ? k * 0.9 : 0;
    const snowFromBiome = env.biome === 'arctic' ? 0.65 : 0;
    HEIGHT_FOG_UNIFORMS.uSnowCover.value = Math.min(1, Math.max(0, env.snowCover ?? Math.max(snowFromWeather, snowFromBiome)));
    HEIGHT_FOG_UNIFORMS.uWetness.value = weather === 'rain' ? k * 0.85 : env.biome === 'swamp' ? 0.25 : 0;
    setWind(windOf(env));
    this.placeSun(this.sun.target.position, true);
    // The haze towards the sun takes its light; the moon's is faint, or a night horizon glows in a pale band
    HEIGHT_FOG_UNIFORMS.uFogSunColor.value.copy(this.sun.color).multiplyScalar(airLight).lerp(this.fog.color, 0.35);
    HEIGHT_FOG_UNIFORMS.uFogSunDir.value.copy(this.sunDir);
    HEIGHT_FOG_UNIFORMS.uGradeContrast.value = p.grade[0];
    HEIGHT_FOG_UNIFORMS.uGradeSaturation.value = p.grade[1];
    HEIGHT_FOG_UNIFORMS.uGradeTint.value.set(p.grade[2]);
    HEIGHT_FOG_UNIFORMS.uGradeShadow.value.set(p.split[0]);
    HEIGHT_FOG_UNIFORMS.uGradeLight.value.set(p.split[1]);
    this.skyDome.set({
      zenith: this.zenith,
      horizon: this.horizon,
      sunDir: this.sunDir,
      sunColor: this.sun.color,
      cover,
      glow: p.glow * (1 - k * 0.7),
      cloudColor: new Color(p.cloudColor).multiply(tint),
      cloudShadow: new Color(p.cloudShadow).multiply(tint),
      haze: this.fog.color,
      stars: p.stars,
      planet: p.planet,
      aurora: p.aurora,
    });
    if (skyChanged) {
      // The same texture and the same environment target, refilled: a new object would make three
      // re-check every material (and on the first change compile programs for a frame of seconds)
      this.fillSky(this.sky.image.data as Uint8Array);
      this.sky.needsUpdate = true;
      if (this.scene) this.installSky();
    }
  }

  /** Installs sky, environment map, fog and lights; remembers the scene's own */
  apply(scene: Scene, renderer: WebGLRenderer): void {
    this.detach();
    this.scene = scene;
    this.renderer = renderer;
    this.previousShadowAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    this.previousToneMapping = { mapping: renderer.toneMapping, exposure: renderer.toneMappingExposure };
    renderer.toneMapping = NeutralToneMapping;
    renderer.toneMappingExposure = this.look().exposure;
    this.shadowDirty = true;
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
    if (this.renderer && this.previousShadowAuto !== null) {
      this.renderer.shadowMap.autoUpdate = this.previousShadowAuto;
      this.previousShadowAuto = null;
    }
    if (this.renderer && this.previousToneMapping) {
      this.renderer.toneMapping = this.previousToneMapping.mapping;
      this.renderer.toneMappingExposure = this.previousToneMapping.exposure;
      this.previousToneMapping = null;
    }
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

  /**
   * Centres the sun's shadow box on a scene point; `radius` in metres around
   * it. The box moves only once the point left the middle of it and grows or
   * shrinks in steps of a fifth, so a panning or zooming camera re-renders
   * the shadow map now and then instead of every frame. Returns the radius
   * in those steps, for what else follows the box (which objects cast).
   */
  focus(point: Vector3, radius = this.shadowRadius): number {
    this.shadowRadius = Math.pow(2, Math.round(Math.log2(Math.max(radius, 1)) * 4) / 4);
    this.placeSun(point, false);
    return this.shadowRadius;
  }

  /** The shadow map renders again on the next frame (objects or ground changed) */
  invalidateShadows(): void {
    this.shadowDirty = true;
  }

  /**
   * The quality level's shadow map: its size (texels a side) and how soft
   * its edge is (PCF spread). A new size allocates the map anew and renders
   * it on the next frame
   */
  setShadowQuality(size: number, radius: number): void {
    const shadow = this.sun.shadow;
    shadow.radius = radius;
    if (shadow.mapSize.x !== size) {
      shadow.mapSize.set(size, size);
      shadow.map?.dispose();
      shadow.map = null;
      // The focus snaps to whole texels of the new size
      if (Number.isFinite(this.shadowCenter.x)) this.placeSun(this.shadowCenter.clone(), true);
    }
    this.shadowDirty = true;
  }

  /** 0 by day, 1 at night: how much map lights (lanterns, torches) matter */
  get darkness(): number {
    let base = { day: 0, overcast: 0.2, dusk: 0.6, night: 1 }[this.env.sky] ?? 0;
    // Under hell's dark sky and on the moon lights matter by day too
    if (this.env.biome === 'hell' || this.env.biome === 'apocalypse') base = Math.max(base, 0.5);
    // A low sun darkens any sky
    return Math.min(1, Math.max(base, 1 - this.env.sunElevation / 12));
  }

  /**
   * Clear air out to `distance` (the editor's camera distance): the haze
   * starts no nearer, so an overview of the whole map is not lost in it.
   * 0 gives the map's own start back. The game never sets it.
   */
  setClearAir(distance: number): void {
    this.clearAir = Math.max(0, distance);
    HEIGHT_FOG_UNIFORMS.uFogStart.value = Math.max(this.fogStart, this.clearAir);
  }

  /**
   * The scene's FogExp2 density that gives other materials (towers, enemies,
   * effects of the game) the same fog as the map's height fog at `point`
   * seen from `eye` (both group space): the map's own materials use the
   * height fog, everything else exponential fog, and where the action is
   * both agree.
   */
  matchFog(eye: Vector3, point: Vector3): void {
    const u = HEIGHT_FOG_UNIFORMS;
    const k = u.uFogFalloff.value;
    const dist = eye.distanceTo(point);
    const kdy = k * (point.y - eye.y);
    const along = Math.abs(kdy) > 1e-4 ? (1 - Math.exp(-kdy)) / kdy : 1;
    const camHeight = Math.max(eye.y - u.uFogBase.value, -50);
    const start = u.uFogStart.value;
    const amount =
      u.uFogDensity.value * 2 * (Math.max(dist - start, 0) * (Math.exp(-k * camHeight) * along + 0.1) + Math.max(dist - start * 3, 0) * 0.9);
    // FogExp2: factor = 1 - exp(-(density * d)^2); the height fog: 1 - exp(-amount)
    this.fog.density = dist > 1 ? Math.sqrt(Math.max(amount, 0)) / dist : 0;
  }

  /** Sky preset with the biome's look on top */
  private look(): BiomeLook {
    return biomeLook(this.env.biome, this.env.sky);
  }

  /** The map's extent in the scene: its centre and half sizes (x, z), for the haze over the land beyond */
  setFogMap(centerX: number, centerZ: number, halfX: number, halfZ: number): void {
    HEIGHT_FOG_UNIFORMS.uFogMap.value.set(centerX, centerZ, halfX, halfZ);
  }

  /** The renderer `apply` installed the environment on (passes of the map's own run with it), null before */
  get activeRenderer(): WebGLRenderer | null {
    return this.renderer;
  }

  /** Height the fog is densest at (the map's low ground), metres in the scene */
  setFogBase(height: number): void {
    HEIGHT_FOG_UNIFORMS.uFogBase.value = height;
  }

  /** Per frame: the wind's clock runs, the sky dome follows the camera, clouds drift, weather follows the focus */
  update(dt: number, camera: Camera, focus: Vector3): void {
    WIND_UNIFORMS.uWindTime.value += dt;
    this.skyDome.update(dt, camera);
    if (this.renderer) this.skyDome.bake(this.renderer);
    this.weather.update(dt, camera, focus);
    if (this.shadowDirty && this.renderer) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowDirty = false;
    }
  }

  /** Turns on soft shadow maps on a renderer that has none */
  static enableShadows(renderer: WebGLRenderer): void {
    renderer.shadowMap.enabled = true;
  }

  dispose(): void {
    this.detach();
    this.sky.dispose();
    this.envTarget?.dispose();
    this.pmrem?.dispose();
    this.envTarget = null;
    this.pmrem = null;
    this.sun.shadow.dispose();
    this.skyDome.dispose();
    this.weather.dispose();
  }

  private placeSun(focus: Vector3, force: boolean): void {
    const r = this.shadowRadius;
    const moved = Math.hypot(focus.x - this.shadowCenter.x, focus.z - this.shadowCenter.z);
    if (!force && r === this.shadowBoxRadius && moved < r * 0.08 && Math.abs(focus.y - this.shadowCenter.y) < r * 0.1) return;
    this.shadowCenter.copy(focus);
    this.shadowBoxRadius = r;
    this.shadowDirty = true;
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
    const p = this.look();
    // The dome draws the visible sky (sky-dome.ts); behind it only a clear in the horizon's haze,
    // not the equirect sky as a second full-screen pass (review 2026-10-11)
    scene.background = this.backdrop.copy(this.fog.color);
    this.envDirty = true;
    if (!this.pmrem) {
      // PMREM links its programs (equirect to cube, GGX) on first use, synchronously: 280 to 500 ms
      // on the main thread. The target is set up now, so materials compile with the environment map
      // they will have, and filled once the programs have linked in parallel (then 10 to 20 ms)
      const pmrem = new PMREMGenerator(renderer);
      const inside = pmrem as unknown as PmremInternals;
      inside._setSize(this.sky.image.width / 4);
      this.pmrem = pmrem;
      this.envTarget = inside._allocateTargets();
      this.envReady = linkPmrem(renderer, pmrem, this.envTarget).then(() => {
        if (this.pmrem !== pmrem) return;
        this.pmremReady = true;
        this.fillEnvironment();
      });
    } else if (this.pmremReady) {
      this.fillEnvironment();
    }
    scene.environment = this.envTarget?.texture ?? null;
    scene.environmentIntensity = p.envIntensity;
  }

  private fillEnvironment(): void {
    if (!this.envDirty || !this.pmrem || !this.envTarget) return;
    this.envDirty = false;
    this.pmrem.fromEquirectangular(this.sky, this.envTarget);
  }

  private buildSky(): DataTexture {
    const data = new Uint8Array(SKY_WIDTH * SKY_HEIGHT * 4);
    this.fillSky(data);
    const t = new DataTexture(data, SKY_WIDTH, SKY_HEIGHT, RGBAFormat, UnsignedByteType);
    t.colorSpace = SRGBColorSpace;
    t.mapping = EquirectangularReflectionMapping;
    t.magFilter = LinearFilter;
    t.minFilter = LinearFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  }

  /** The sky's pixels for the current environment */
  private fillSky(data: Uint8Array): void {
    const p = this.look();
    const tint = new Color(this.env.tint || '#ffffff');
    const zenith = new Color(p.zenith).multiply(tint);
    const horizon = new Color(p.horizon).multiply(tint);
    const ground = new Color(p.ground);
    const sunCol = new Color(p.sun);
    const sun = sunDirection(this.env.sunAzimuth, this.env.sunElevation, new Vector3());
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
  }
}

/** Linear 0..1 to sRGB bytes, by table (4096 steps): a pow per channel and pixel cost milliseconds per sky */
const SRGB_TABLE = (() => {
  const t = new Uint8Array(4097);
  for (let i = 0; i <= 4096; i++) {
    const v = i / 4096;
    t[i] = Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255);
  }
  return t;
})();

function toSrgbByte(linear: number): number {
  return SRGB_TABLE[linear <= 0 ? 0 : linear >= 1 ? 4096 : (linear * 4096) | 0];
}

/** The parts of three's PMREMGenerator (r186) the environment sets up ahead of its first use */
interface PmremInternals {
  _setSize(cubeSize: number): void;
  _allocateTargets(): WebGLRenderTarget;
  _equirectMaterial: Material | null;
  _ggxMaterial: Material | null;
  _compileMaterial(material: Material): void;
}

/**
 * Links PMREM's programs off the main thread: compiled for a linear render
 * target as PMREM draws them (compileEquirectangularShader alone compiles
 * the equirect program for the screen, a variant PMREM never uses), then
 * awaited with compileAsync. compileEquirectangularShader alone compiles
 * on a mesh without positions, also a variant PMREM never draws.
 */
async function linkPmrem(renderer: WebGLRenderer, pmrem: PMREMGenerator, target: WebGLRenderTarget): Promise<void> {
  const inside = pmrem as unknown as PmremInternals;
  const previous = renderer.getRenderTarget();
  const scene = new ThreeScene();
  // A position attribute is part of the program key (three r186); PMREM's planes have one
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
  try {
    renderer.setRenderTarget(target);
    // Creates the equirect material; its own compile (a mesh without positions) is skipped
    inside._compileMaterial = () => undefined;
    pmrem.compileEquirectangularShader();
    delete (inside as Partial<PmremInternals>)._compileMaterial;
    // The blur runs only for PMREM from a scene; from a texture it is the GGX convolution
    for (const material of [inside._equirectMaterial, inside._ggxMaterial]) {
      if (material) scene.add(new Mesh(geometry, material));
    }
    const linked = renderer.compileAsync(scene, new OrthographicCamera());
    renderer.setRenderTarget(previous);
    await linked;
  } catch {
    // Without the internals PMREM links on first use as before
    renderer.setRenderTarget(previous);
  } finally {
    geometry.dispose();
  }
}
