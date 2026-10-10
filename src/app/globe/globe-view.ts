import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  MathUtils,
  FrontSide,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  type CompressedTexture,
  type Matrix4,
  type Texture,
} from 'three';
import { EARTH_A, EARTH_B, directionOf, ecefOf, gmst, type LatLon } from './globe-geo';
import {
  EARTH_FRAGMENT,
  EARTH_VERTEX,
  RIM_FRAGMENT,
  RIM_VERTEX,
  STAR_FRAGMENT,
  STAR_VERTEX,
  SUN_FRAGMENT,
  SUN_VERTEX,
} from './globe-shaders';
import { GLOBE_ASSETS, GlobeTextures, type GlobeMaps, type GlobeQuality, type RegionTile } from './globe-textures';

/** Where the view runs: the canvas' pixel ratio and the app's base for its assets */
export interface GlobeViewOptions {
  pixelRatio: number;
  baseUrl: string;
}

/** Clouds are gone below this altitude and full above the other, metres */
const CLOUDS_GONE_BELOW = 450_000;
const CLOUDS_FULL_ABOVE = 1_800_000;

/** Height of the atmosphere's top above the ellipsoid, metres (the shaders' RA - RP) */
const ATMOSPHERE_HEIGHT = 100_000;

/** What a quality tier costs: pixel ratio cap, scattering steps, the sharp stage */
const TIERS: Record<GlobeQuality, { pixelRatio: number; steps: number; sharp: boolean; segments: [number, number] }> = {
  high: { pixelRatio: 2, steps: 12, sharp: true, segments: [384, 192] },
  low: { pixelRatio: 1, steps: 6, sharp: false, segments: [192, 96] },
};

/**
 * A lat-lon grid on the WGS84 ellipsoid `height` metres up, in ECEF, with
 * UVs of an equirectangular map (u from 180 W, v down from the north pole).
 * The seam at 180 has its own vertices, so mipmaps do not smear across it.
 */
export function ellipsoidGeometry(widthSegments: number, heightSegments: number, height = 0): BufferGeometry {
  const positions = new Float32Array((widthSegments + 1) * (heightSegments + 1) * 3);
  const uvs = new Float32Array((widthSegments + 1) * (heightSegments + 1) * 2);
  const p = new Vector3();
  let i = 0;
  for (let iy = 0; iy <= heightSegments; iy++) {
    const v = iy / heightSegments;
    const lat = 90 - v * 180;
    for (let ix = 0; ix <= widthSegments; ix++) {
      const u = ix / widthSegments;
      ecefOf(lat, u * 360 - 180, height, p);
      positions.set([p.x, p.y, p.z], i * 3);
      uvs.set([u, v], i * 2);
      i++;
    }
  }
  const indices: number[] = [];
  const row = widthSegments + 1;
  for (let iy = 0; iy < heightSegments; iy++) {
    for (let ix = 0; ix < widthSegments; ix++) {
      const a = iy * row + ix;
      const b = a + row;
      // Counter-clockwise seen from outside
      if (iy > 0) indices.push(a, b, a + 1);
      if (iy < heightSegments - 1) indices.push(a + 1, b, b + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

/** Star colour from B-V: temperature (Ballesteros), then a blackbody tint */
export function starColor(bv: number, target: Color): Color {
  const t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  const k = t / 100;
  const r = k <= 66 ? 255 : 329.7 * Math.pow(k - 60, -0.1332);
  const g = k <= 66 ? 99.47 * Math.log(k) - 161.12 : 288.12 * Math.pow(k - 60, -0.0755);
  const b = k >= 66 ? 255 : k <= 19 ? 0 : 138.52 * Math.log(k - 10) - 305.04;
  const clamp = (x: number) => Math.min(255, Math.max(0, x)) / 255;
  return target.setRGB(clamp(r), clamp(g), clamp(b), SRGBColorSpace);
}

/** Stars from stars.bin (right ascension, declination, V magnitude, B-V per star) as points at infinity */
export function starGeometry(data: Float32Array): BufferGeometry {
  const count = data.length / 4;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const color = new Color();
  for (let i = 0; i < count; i++) {
    const ra = data[i * 4];
    const dec = data[i * 4 + 1];
    const mag = data[i * 4 + 2];
    positions.set([Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)], i * 3);
    const flux = Math.pow(10, -0.4 * (mag - 1));
    starColor(data[i * 4 + 3], color);
    const brightness = Math.min(1.6, 0.12 + flux * 0.9);
    colors.set([color.r * brightness, color.g * brightness, color.b * brightness], i * 3);
    sizes[i] = Math.min(7, 1.6 + Math.sqrt(flux) * 2.2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.setAttribute('size', new BufferAttribute(sizes, 1));
  return geometry;
}

/** A point's place on the canvas, CSS pixels */
export interface ScreenSpot {
  x: number;
  y: number;
  /** On the side of the earth facing the camera */
  facing: boolean;
}

/**
 * The menu globe (docs/GLOBE_PLAN.md): its own WebGL context on its own
 * canvas, the earth in ECEF metres. The owner moves the camera (setPose,
 * followMatrix), sets sun and time, and calls render() each frame it wants
 * one; nothing here runs a loop of its own.
 */
export class GlobeView {
  readonly camera = new PerspectiveCamera(60, 1, 1000, 1e9);
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly textures: GlobeTextures;
  private readonly earth: Mesh<BufferGeometry, ShaderMaterial>;
  private readonly rim: Mesh<BufferGeometry, ShaderMaterial>;
  private readonly sun: Mesh<PlaneGeometry, ShaderMaterial>;
  private stars: Points<BufferGeometry, ShaderMaterial> | null = null;
  private readonly tier: (typeof TIERS)[GlobeQuality];
  private maps: GlobeMaps | null = null;
  private regionTextures: CompressedTexture[] = [];
  private regionFor: string | null = null;
  private disposed = false;
  private readonly sunDir = new Vector3(1, 0, 0);
  private readonly tmp = new Vector3();

  private firstRender = true;
  /** The canvas' CSS size, for project() */
  private width = 1;
  private height = 1;

  /** Main-thread time of the globe's own work, ms: the largest of each kind (`__globe.timing()`) */
  static readonly timing: Record<string, number> = {};
  private static note(kind: string, ms: number): void {
    GlobeView.timing[kind] = Math.max(GlobeView.timing[kind] ?? 0, ms);
  }

  /** Resolves when the first textures are on the GPU and a frame can show the earth */
  readonly ready: Promise<void>;

  constructor(
    canvas: HTMLCanvasElement | OffscreenCanvas,
    quality: GlobeQuality,
    private readonly options: GlobeViewOptions,
  ) {
    this.tier = TIERS[quality];
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', depth: false, stencil: false });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    // The ground is lit physically (albedo E / pi under a sun of 22): bright, the exposure takes it down
    this.renderer.toneMappingExposure = 0.17;
    this.renderer.setPixelRatio(Math.min(options.pixelRatio, this.tier.pixelRatio));
    this.scene.matrixAutoUpdate = false;
    this.textures = new GlobeTextures(this.renderer, options.baseUrl);

    const common = {
      sunDir: { value: this.sunDir },
      camPos: { value: new Vector3() },
      sunIntensity: { value: 22 },
      scatterSteps: { value: this.tier.steps },
    };
    const [w, h] = this.tier.segments;
    this.earth = new Mesh(
      ellipsoidGeometry(w, h),
      new ShaderMaterial({
        vertexShader: EARTH_VERTEX,
        fragmentShader: EARTH_FRAGMENT,
        uniforms: {
          ...common,
          dayMap: { value: null },
          nightMap: { value: null },
          reliefMap: { value: null },
          reliefTexel: { value: new Vector2(1 / 2048, 1 / 1024) },
          region0: { value: null },
          region1: { value: null },
          region2: { value: null },
          region3: { value: null },
          regionRect: { value: [new Vector4(), new Vector4(), new Vector4(), new Vector4()] },
          regionOn: { value: new Vector4() },
          cloudShift: { value: 0 },
          cloudCover: { value: 1 },
          holeDir: { value: new Vector3(1, 0, 0) },
          holeRadius: { value: 0 },
          nightGain: { value: 14 },
          nightAmbient: { value: 0.08 },
          bumpScale: { value: 60_000 },
        },
        side: FrontSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.earth.renderOrder = 2;
    this.earth.visible = false;

    this.rim = new Mesh(
      ellipsoidGeometry(128, 64, ATMOSPHERE_HEIGHT),
      new ShaderMaterial({
        vertexShader: RIM_VERTEX,
        fragmentShader: RIM_FRAGMENT,
        // The thin blue band at the limb reads stronger than one scattering pass gives
        uniforms: { ...common, rimGain: { value: 3 } },
        side: BackSide,
        transparent: true,
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: OneMinusSrcAlphaFactor,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.rim.renderOrder = 3;

    this.sun = new Mesh(
      new PlaneGeometry(2, 2),
      new ShaderMaterial({
        vertexShader: SUN_VERTEX,
        fragmentShader: SUN_FRAGMENT,
        uniforms: { sunDir: { value: this.sunDir }, size: { value: 0.35 }, glow: { value: 8 } },
        transparent: true,
        blending: AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.sun.renderOrder = 1;
    this.sun.frustumCulled = false;

    for (const object of [this.earth, this.rim, this.sun]) {
      object.matrixAutoUpdate = false;
      object.updateMatrixWorld();
      this.scene.add(object);
    }
    this.earth.frustumCulled = false;
    this.rim.frustumCulled = false;

    this.ready = Promise.all([this.loadStage('base'), this.loadStars()])
      // The programs compile off the main thread where the driver can, before the first frame needs them
      .then(() => (this.disposed ? undefined : this.renderer.compileAsync(this.scene, this.camera)))
      .then(() => {
        if (this.tier.sharp && !this.disposed) void this.loadStage('sharp');
      });
  }

  private async loadStage(stage: 'base' | 'sharp'): Promise<void> {
    const maps = await this.textures.loadStage(stage).catch(() => null);
    if (!maps || this.disposed) return;
    const old = this.maps;
    this.maps = maps;
    const u = this.earth.material.uniforms;
    u['dayMap'].value = maps.day;
    u['nightMap'].value = maps.night;
    u['reliefMap'].value = maps.relief;
    const image = maps.relief.image as { width: number; height: number };
    (u['reliefTexel'].value as Vector2).set(1 / image.width, 1 / image.height);
    // Upload now, not inside the frame that first draws them
    const t0 = performance.now();
    for (const texture of [maps.day, maps.night, maps.relief] as Texture[]) this.renderer.initTexture(texture);
    GlobeView.note(`upload ${stage}`, performance.now() - t0);
    this.earth.visible = true;
    if (old) for (const texture of [old.day, old.night, old.relief]) this.textures.release(texture);
  }

  private async loadStars(): Promise<void> {
    try {
      const response = await fetch(new URL(`${GLOBE_ASSETS}stars.bin`, this.options.baseUrl).href);
      if (!response.ok || this.disposed) return;
      const data = new Float32Array(await response.arrayBuffer());
      if (this.disposed) return;
      this.stars = new Points(
        starGeometry(data),
        new ShaderMaterial({
          vertexShader: STAR_VERTEX,
          fragmentShader: STAR_FRAGMENT,
          uniforms: { pixelRatio: { value: this.renderer.getPixelRatio() }, starGain: { value: 1 } },
          transparent: true,
          blending: AdditiveBlending,
          depthTest: false,
          depthWrite: false,
        }),
      );
      this.stars.renderOrder = 0;
      this.stars.frustumCulled = false;
      this.stars.matrixAutoUpdate = false;
      this.scene.add(this.stars);
    } catch {
      // No stars: the globe stands on black
    }
  }

  /** Sharp tiles around a place; the ones of an earlier place go */
  async focusRegion(place: LatLon): Promise<void> {
    const key = `${place.lat.toFixed(2)},${place.lon.toFixed(2)}`;
    if (this.regionFor === key || !this.tier.sharp) return;
    this.regionFor = key;
    const loaded = await this.textures.loadRegion(place.lat, place.lon);
    if (this.disposed || this.regionFor !== key) {
      for (const { texture } of loaded) this.textures.release(texture);
      return;
    }
    const u = this.earth.material.uniforms;
    const on = u['regionOn'].value as Vector4;
    const rects = u['regionRect'].value as Vector4[];
    for (const texture of this.regionTextures) this.textures.release(texture);
    this.regionTextures = loaded.map(({ texture }) => texture);
    on.set(0, 0, 0, 0);
    const t0 = performance.now();
    loaded.forEach(({ tile, texture }: { tile: RegionTile; texture: CompressedTexture }, i) => {
      this.renderer.initTexture(texture);
      u[`region${i}`].value = texture;
      rects[i].set(...tile.rect);
      on.setComponent(i, 1);
    });
    GlobeView.note('upload region', performance.now() - t0);
  }

  /** The earth's and the rim's shader uniforms and the renderer, for tuning in DevTools (`__globe.uniforms()`) */
  uniforms(): { earth: ShaderMaterial['uniforms']; rim: ShaderMaterial['uniforms']; renderer: WebGLRenderer } {
    return { earth: this.earth.material.uniforms, rim: this.rim.material.uniforms, renderer: this.renderer };
  }

  /** Where the sun stands overhead, and the time for the stars and the clouds' drift */
  setSky(subsolar: LatLon, date: Date, cloudShift: number): void {
    directionOf(subsolar.lat, subsolar.lon, this.sunDir);
    this.earth.material.uniforms['cloudShift'].value = cloudShift;
    if (this.stars) {
      this.stars.rotation.z = -gmst(date);
      this.stars.updateMatrix();
      this.stars.updateMatrixWorld();
    }
  }

  /** Clouds thinned out within `radius` (radians) of a place, 0 for none */
  setCloudHole(place: LatLon, radius: number): void {
    directionOf(place.lat, place.lon, this.earth.material.uniforms['holeDir'].value as Vector3);
    this.earth.material.uniforms['holeRadius'].value = radius;
  }

  /** Camera position (ECEF), looking at `target`, `up` as the screen's top */
  setPose(position: Vector3, target: Vector3, up: Vector3): void {
    this.camera.position.copy(position);
    this.camera.up.copy(up);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();
  }

  /** Camera pose from a world matrix in ECEF (the game camera's, handed over) */
  followMatrix(matrixWorld: Matrix4, fov: number): void {
    matrixWorld.decompose(this.camera.position, this.camera.quaternion, this.tmp);
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
  }

  /** Shift of the view sideways, a share of the canvas width (positive: the earth to the right) */
  setShift(share: number): void {
    const offset = -share * this.camera.getFilmWidth();
    if (this.camera.filmOffset === offset) return;
    this.camera.filmOffset = offset;
    this.camera.updateProjectionMatrix();
  }

  /** The canvas' CSS size; call when it changes */
  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Altitude of the camera above the ellipsoid, metres (close enough for the HUD and the near plane) */
  altitude(): number {
    const p = this.camera.position;
    const r = Math.hypot(p.x, p.y, p.z * (EARTH_A / EARTH_B));
    return r - EARTH_A;
  }

  render(): void {
    if (this.disposed || !this.earth.visible) return;
    const alt = Math.max(this.altitude(), 1000);
    const near = Math.max(100, alt * 0.05);
    if (Math.abs(this.camera.near - near) > near * 0.25) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
    this.earth.material.uniforms['camPos'].value.copy(this.camera.position);
    // Clouds thin out on the way down: their texture is coarse up close, and the tiles have none
    this.earth.material.uniforms['cloudCover'].value = MathUtils.smoothstep(alt, CLOUDS_GONE_BELOW, CLOUDS_FULL_ABOVE);
    this.rim.material.uniforms['camPos'].value.copy(this.camera.position);
    const t0 = performance.now();
    const programs = this.renderer.info.programs?.length ?? 0;
    this.renderer.render(this.scene, this.camera);
    GlobeView.note(this.firstRender ? 'render first' : 'render', performance.now() - t0);
    const compiled = (this.renderer.info.programs?.length ?? 0) - programs;
    if (compiled > 0) GlobeView.note(`programs at render (${this.firstRender ? 'first' : 'later'})`, compiled);
    this.firstRender = false;
  }

  /** Where an ECEF point shows on the canvas */
  project(point: Vector3, out: ScreenSpot): ScreenSpot {
    const toCamera = this.tmp.copy(this.camera.position).sub(point);
    out.facing = toCamera.dot(point) > 0;
    const ndc = this.tmp.copy(point).project(this.camera);
    out.x = ((ndc.x + 1) / 2) * this.width;
    out.y = ((1 - ndc.y) / 2) * this.height;
    out.facing &&= ndc.z < 1;
    return out;
  }

  dispose(): void {
    if (this.disposed) return;
    const t0 = performance.now();
    this.disposed = true;
    this.textures.dispose();
    for (const object of [this.earth, this.rim, this.sun, this.stars]) {
      if (!object) continue;
      object.geometry.dispose();
      object.material.dispose();
    }
    this.renderer.dispose();
    // The context goes back to the browser at once, not with the next GC
    this.renderer.forceContextLoss();
    GlobeView.note('dispose', performance.now() - t0);
  }
}
