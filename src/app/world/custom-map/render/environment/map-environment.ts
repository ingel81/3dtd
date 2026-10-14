import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
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
  RepeatWrapping,
  RGBAFormat,
  Scene as ThreeScene,
  SRGBColorSpace,
  Texture,
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
import { ShadowParts } from './shadow-parts';
import { SkyDome } from './sky-dome';
import { fetchSkyImage, skyImageOf, skyImageYaw, type SkyImage } from './sky-images';
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
 * - An image sky (`environment.skyImage`, sky-images.ts) gives the dome its
 *   picture and the colours of light and air: the sun takes the picture's
 *   sun colour, the hemisphere light the hue of its sky (at the preset's
 *   brightness), haze and fog its horizon, the environment map its pixels
 *   above the horizon. The preset the picture names keeps intensities,
 *   exposure and darkness. The picture loads when a map first uses it; until
 *   then the dome shows a gradient in the picture's colours. `envReady`
 *   waits for it.
 *
 * `apply(scene, renderer)` installs all of it and remembers what was there;
 * `detach()` puts that back. The map is tone mapped (Khronos PBR Neutral,
 * the look's exposure): `apply` sets the renderer's tone mapping, `detach`
 * gives the one it had back exactly, so tiles and the globe never see it.
 * Neutral leaves colours below about 0.76 as they are and rolls off the
 * highlights, so towers, enemies and effects keep their look. The renderer
 * needs `shadowMap.enabled` for the sun's shadows (see `enableShadows`).
 */

/** The shadow box shrinks only once the view needs less than this share of it */
const SHRINK = 0.7;
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
  /** The image sky shown or loading (its id), its texture and its pixels at the environment map's size */
  private imageId: string | null = null;
  private imageTexture: Texture | null = null;
  private imagePixels: { id: string; data: Uint8ClampedArray } | null = null;
  private imageReady: Promise<void> = Promise.resolve();
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
  /**
   * The next build draws every tile in one frame: the first map, a new map
   * size, a new sun (the old map would be read in the wrong direction)
   */
  private shadowNow = true;
  /** Renders the map again over a few frames, a part of the objects each, and swaps it in (shadow-parts.ts) */
  private readonly shadowParts = new ShadowParts();
  private readonly shadowCenter = new Vector3(Number.NaN, 0, 0);
  private shadowBoxRadius = 0;
  /** Centre (scene space) and radius of the map the sun shows, which trails the box while a build runs */
  private readonly shownCenter = new Vector3();
  private shownRadius = 0;
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
    if (env.sunAzimuth !== this.env.sunAzimuth || env.sunElevation !== this.env.sunElevation) this.redrawShadowsNow();
    const skyChanged =
      env.sky !== this.env.sky ||
      env.biome !== this.env.biome ||
      env.skyImage !== this.env.skyImage ||
      env.sunAzimuth !== this.env.sunAzimuth ||
      env.sunElevation !== this.env.sunElevation ||
      // The tint colours the sky's pixels and so the environment map (fillSky)
      (env.tint || '#ffffff') !== (this.env.tint || '#ffffff');
    this.env = env;
    const p = this.look();
    if (this.renderer && this.previousToneMapping) this.renderer.toneMappingExposure = p.exposure;
    const tint = new Color(env.tint || '#ffffff');
    const image = skyImageOf(env);
    sunDirection(env.sunAzimuth, env.sunElevation, this.sunDir);
    // Low sun: warmer and weaker; a picture's sun has its own colour
    const low = Math.max(0, Math.min(1, env.sunElevation / 25));
    if (image?.sunColor) this.sun.color.setRGB(...image.sunColor).multiply(tint);
    else this.sun.color.set(p.sun).lerp(new Color(0xffa060), (1 - low) * 0.5).multiply(tint);
    this.sun.intensity = p.sunIntensity * (0.35 + 0.65 * low);
    this.hemi.color.set(p.hemiSky);
    if (image) withHueOf(this.hemi.color, image.sky);
    this.hemi.color.multiply(tint);
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
    this.ambient.color.set(p.hemiSky);
    if (image) withHueOf(this.ambient.color, image.sky);
    this.ambient.color.multiply(tint);
    this.ambient.intensity = p.ambient;
    // Haze: the horizon lifted a little towards the zenith's blue, so distance reads blue, not green
    // The map's tint colours its light fully, its sky and air only a little: a green or orange
    // mood tint over the whole haze made the far land olive or brown
    const airTint = new Color(1, 1, 1).lerp(tint, 0.3);
    // Haze: between horizon and zenith, a little desaturated, so distance reads blue-grey, not the horizon's hue
    if (image) {
      // The picture's horizon as it is: the dome's foot fades into this haze, no seam above the land
      this.fog.color.setRGB(...image.horizon).multiply(airTint);
      this.zenith.setRGB(...image.zenith).multiply(airTint);
      this.horizon.setRGB(...image.horizon).multiply(airTint);
    } else {
      this.fog.color.set(p.horizon).lerp(new Color(p.zenith), 0.3).multiply(airTint);
      const fogGrey = (this.fog.color.r + this.fog.color.g + this.fog.color.b) / 3;
      this.fog.color.lerp(new Color(fogGrey, fogGrey, fogGrey), 0.3);
      this.zenith.set(p.zenith).multiply(airTint);
      this.horizon.set(p.horizon).multiply(airTint);
    }
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
    const glowColor = p.glowColor === undefined ? this.sun.color : new Color(p.glowColor).multiply(tint);
    HEIGHT_FOG_UNIFORMS.uFogSunColor.value.copy(glowColor).multiplyScalar(airLight).lerp(this.fog.color, 0.35);
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
      glowColor,
      // A picture brings its own clouds and stars; until it has loaded the gradient shows bare
      cover: image ? 2 : cover,
      glow: p.glow * (1 - k * 0.7),
      cloudColor: new Color(p.cloudColor).multiply(tint),
      cloudShadow: new Color(p.cloudShadow).multiply(tint),
      haze: this.fog.color,
      stars: image ? 0 : p.stars,
      planet: !image && p.planet,
      aurora: image ? 0 : p.aurora,
    });
    this.showImage(image);
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
   * the shadow map now and then instead of every frame. It grows to the next
   * step at once (what the camera sees stays inside) and shrinks only once
   * `radius` falls under SHRINK of it: a zoom by a notch or two and back
   * keeps the box and the objects that cast in it. Returns the radius in
   * those steps, for what else follows the box (which objects cast).
   */
  focus(point: Vector3, radius = this.shadowRadius): number {
    const step = Math.pow(2, Math.ceil(Math.log2(Math.max(radius, 1)) * 4 - 1e-6) / 4);
    if (step > this.shadowRadius || radius < this.shadowRadius * SHRINK) this.shadowRadius = step;
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
      this.redrawShadowsNow();
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

  /** The centre (scene space) of the cached sun shadow map the sun shows into `target`; returns its radius */
  shadowArea(target: Vector3): number {
    target.copy(this.shownCenter);
    return this.shownRadius;
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
    if (this.renderer && this.scene && this.renderer.shadowMap.enabled) this.updateShadows(this.renderer, this.scene, camera);
  }

  /**
   * The sun's shadow map after a change: a build over a few frames, a part of
   * the objects each, the finished map swapped in at once (shadow-parts.ts).
   * A change while a build runs waits for it: changes during a pan come every
   * few frames, a build begun anew each time would never end. A new sun or
   * map size draws every part in one frame.
   */
  private updateShadows(renderer: WebGLRenderer, scene: Scene, camera: Camera): void {
    const parts = this.shadowParts;
    if (this.shadowDirty && (!parts.busy || this.shadowNow)) {
      parts.start(this.sun, scene);
      this.shadowDirty = false;
    }
    if (!parts.busy) return;
    if (!parts.step(renderer, camera, this.sun, this.shadowNow || !this.sun.shadow.map ? Infinity : 1)) return;
    this.shadowNow = false;
    this.shownCenter.copy(parts.center);
    this.shownRadius = parts.radius;
  }

  /** The next shadow build draws the whole map in one frame */
  private redrawShadowsNow(): void {
    this.shadowNow = true;
    this.shadowDirty = true;
    this.shadowParts.cancel();
  }

  /** Turns on soft shadow maps on a renderer that has none */
  static enableShadows(renderer: WebGLRenderer): void {
    renderer.shadowMap.enabled = true;
  }

  dispose(): void {
    this.detach();
    this.imageId = null;
    this.imageTexture?.dispose();
    this.imageTexture = null;
    this.sky.dispose();
    this.envTarget?.dispose();
    this.pmrem?.dispose();
    this.envTarget = null;
    this.pmrem = null;
    this.sun.shadow.dispose();
    this.shadowParts.dispose();
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

  /**
   * Shows the map's image sky on the dome, turned to the map's sun, or the
   * procedural one; a picture not loaded yet starts loading (once per id)
   */
  private showImage(image: SkyImage | null): void {
    if (!image) {
      this.imageId = null;
      this.skyDome.setImage(null);
      return;
    }
    if (image.id !== this.imageId) {
      this.imageId = image.id;
      this.skyDome.setImage(null);
      this.loadImage(image);
      return;
    }
    if (this.imageTexture?.name === image.id) this.skyDome.setImage(this.imageTexture, skyImageYaw(image, this.env.sunAzimuth));
  }

  /** Loads the picture: a texture for the dome and its pixels at the environment map's size; no picture without a decoder */
  private loadImage(image: SkyImage): void {
    if (typeof createImageBitmap === 'undefined' || typeof OffscreenCanvas === 'undefined') return;
    const rows = SKY_HEIGHT / 2;
    const load = fetchSkyImage(image)
      .then(async (blob) => {
        const options = { colorSpaceConversion: 'none', premultiplyAlpha: 'none' } as const;
        const [full, small] = await Promise.all([
          createImageBitmap(blob, options),
          createImageBitmap(blob, { ...options, resizeWidth: SKY_WIDTH, resizeHeight: rows, resizeQuality: 'high' }),
        ]);
        const ctx = new OffscreenCanvas(SKY_WIDTH, rows).getContext('2d', { willReadFrequently: true });
        ctx?.drawImage(small, 0, 0);
        small.close();
        const pixels = ctx?.getImageData(0, 0, SKY_WIDTH, rows).data;
        if (this.imageId !== image.id || !pixels) {
          full.close();
          return;
        }
        const texture = new Texture(full);
        texture.name = image.id;
        texture.colorSpace = SRGBColorSpace;
        // An ImageBitmap uploads as it is (top row first): the dome reads v = 0 at the zenith
        texture.flipY = false;
        texture.wrapS = RepeatWrapping;
        texture.wrapT = ClampToEdgeWrapping;
        texture.magFilter = LinearFilter;
        // No mipmaps: the lookup's u jumps at the seam, a mip chosen by that jump would draw a line
        texture.minFilter = LinearFilter;
        texture.generateMipmaps = false;
        texture.needsUpdate = true;
        this.imageTexture?.dispose();
        this.imageTexture = texture;
        this.imagePixels = { id: image.id, data: pixels };
        this.skyDome.setImage(texture, skyImageYaw(image, this.env.sunAzimuth));
        this.fillSky(this.sky.image.data as Uint8Array);
        this.sky.needsUpdate = true;
        if (this.scene) this.installSky();
      })
      .catch((error: unknown) => console.warn(`[CustomMapEnvironment] sky ${image.id} not loaded, the sky stays a gradient`, error));
    this.imageReady = load;
    this.envReady = Promise.all([this.envReady, load]).then(() => undefined);
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
      const linked = linkPmrem(renderer, pmrem, this.envTarget).then(() => {
        if (this.pmrem !== pmrem) return;
        this.pmremReady = true;
        this.fillEnvironment();
      });
      this.envReady = Promise.all([linked, this.imageReady]).then(() => undefined);
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
    const image = skyImageOf(this.env);
    const zenith = (image ? new Color().setRGB(...image.zenith) : new Color(p.zenith)).multiply(tint);
    const horizon = (image ? new Color().setRGB(...image.horizon) : new Color(p.horizon)).multiply(tint);
    const ground = new Color(p.ground);
    const sunCol = image?.sunColor ? new Color().setRGB(...image.sunColor) : new Color(p.sun);
    const glowCol = image?.sunColor ? sunCol : new Color(p.glowColor ?? p.sun);
    // The picture's pixels above the horizon once it has loaded (SKY_WIDTH x SKY_HEIGHT / 2, top row the zenith)
    const pixels = image && this.imagePixels?.id === image.id ? this.imagePixels.data : null;
    const turn = image ? skyImageYaw(image, this.env.sunAzimuth) / (2 * Math.PI) : 0;
    const rows = SKY_HEIGHT / 2;
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
        const q = (py * SKY_WIDTH + px) * 4;
        if (pixels && dir.y >= 0) {
          // The picture, turned as the dome turns it (sky-dome.ts skyImageColor), tinted like the gradient
          const iu = (((u + turn) % 1) + 1) % 1;
          const row = Math.min(rows - 1, Math.max(0, Math.floor((1 - theta / (Math.PI / 2)) * rows)));
          const s = (row * SKY_WIDTH + Math.min(SKY_WIDTH - 1, Math.floor(iu * SKY_WIDTH))) * 4;
          data[q] = toSrgbByte(SRGB_TO_LINEAR[pixels[s]] * tint.r);
          data[q + 1] = toSrgbByte(SRGB_TO_LINEAR[pixels[s + 1]] * tint.g);
          data[q + 2] = toSrgbByte(SRGB_TO_LINEAR[pixels[s + 2]] * tint.b);
          data[q + 3] = 255;
          continue;
        }
        if (dir.y >= 0) {
          c.copy(horizon).lerp(zenith, Math.pow(dir.y, 0.45));
        } else {
          // Below the horizon only the fogged far land shows: stay near the fog colour
          c.copy(horizon).lerp(ground, Math.min(1, Math.pow(-dir.y * 4, 0.6)) * 0.25);
        }
        const cosSun = Math.max(0, dir.dot(sun));
        const glow = (Math.pow(cosSun, 6) * 0.25 + Math.pow(cosSun, 48) * 0.45) * p.glow;
        const disc = cosSun > 0.99985 ? 4 : cosSun > 0.9995 ? 1.5 : 0;
        c.r += glowCol.r * glow + sunCol.r * disc;
        c.g += glowCol.g * glow + sunCol.g * disc;
        c.b += glowCol.b * glow + sunCol.b * disc;
        // Linear to sRGB bytes
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

/** sRGB bytes to linear 0..1 */
const SRGB_TO_LINEAR = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    t[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  return t;
})();

/**
 * `target` in the hue of `rgb` (linear), keeping its own luminance: the
 * preset sets how bright a light is, the picture what colour it has
 */
export function withHueOf(target: Color, rgb: readonly [number, number, number]): Color {
  const lum = (r: number, g: number, b: number): number => r * 0.2126 + g * 0.7152 + b * 0.0722;
  const from = lum(rgb[0], rgb[1], rgb[2]);
  if (from <= 0) return target;
  const k = lum(target.r, target.g, target.b) / from;
  return target.setRGB(rgb[0] * k, rgb[1] * k, rgb[2] * k);
}

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
