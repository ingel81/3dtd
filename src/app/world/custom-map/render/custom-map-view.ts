import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  FrontSide,
  Group,
  InstancedMesh,
  MeshDepthMaterial,
  Ray,
  Vector2,
  Vector3,
  VSMShadowMap,
  WebGLRenderTarget,
  type Camera,
  type Material,
  Mesh,
  type Object3D,
  Scene,
  type ShaderMaterial,
  type ShadowMapType,
  type WebGLRenderer,
} from 'three';
import type { CustomMapDocument, MapEnvironment, MapObject, MapWaterKind } from '../map-document';
import { HeightField } from './height-field';
import type { MapAssetLibrary } from './map-asset-library';
import type { AssetCatalog, CatalogObject } from './asset-catalog';
import { mapToScene, sceneToMap } from './map-coords';
import { CustomMapEnvironment } from './environment/map-environment';
import { fitShadowBox } from './environment/shadow-fit';
import { EffectLayer, glowStandIn } from './effects/effect-layer';
import { circleFlock, type Flock } from './effects/bird-flocks';
import { LifeBoats } from './effects/life-boats';
import { areaShown, lifeSwitches } from '../map-life';
import type { MapBiome } from '../map-document';
import { CoverMap } from './environment/cover-map';
import { setPlantSway, WIND_UNIFORMS } from './environment/wind';
import { MapObjectLayer, type ObjectHit } from './objects/object-layer';
import { IMPOSTOR_SUN } from './objects/impostor';
import { BridgeLayer } from './paths/path-bridges';
import { LAVA_GLOW_UNIFORMS } from './environment/height-fog';
import { MapTerrainLayer } from './terrain/map-terrain';
import { ApronField, EDGE_TREE_BAND, edgeTreeObjects } from './objects/edge-trees';
import { NIGHT_WINDOW_UNIFORMS } from './objects/night-windows';
import { BACKDROP_HEIGHT } from './terrain/terrain-apron';
import type { HeightTexture } from './terrain/height-texture';
import { RiverSurface, sampleRiver } from './water/river-surface';
import { WaterSurface } from './water/water-surface';
import type { CustomMapQuality } from '../../../three-engine/render-quality';
import { SceneCopy } from './water/scene-copy';
import { createWaterMaterial, setWaterEffects, setWaterSky } from './water/water-material';
import { setHeatHaze } from './water/heat-haze';
import { ParticleField } from './effects/particle-field';
import { WaterReflection } from './water/water-reflection';
import { GroundDecals } from './terrain/ground-decals';
import { NO_MAP_EFFECTS, type MapEffects } from './map-effects';
import type { GridRect } from './terrain/terrain-chunks';
import { programsReady } from '../../../three-engine/programs-ready';
import { waterLevelAt } from '../water-level';

/** Biomes with fireflies at night, and with birds by day */
const FIREFLY_BIOMES: ReadonlySet<MapBiome> = new Set(['temperate', 'swamp', 'mountain']);
const BIRD_BIOMES: ReadonlySet<MapBiome> = new Set(['temperate', 'mountain', 'swamp', 'desert', 'arctic', 'city', 'apocalypse']);
/** Woods for fireflies and open land for birds are counted in squares of this size, metres; a wood has this many trees */
const WOOD_CELL = 30;
const WOOD_TREES = 6;
/** Shore samples for fireflies every this many metres, and at most this many swarms */
const SHORE_STEP = 12;
const MAX_FIREFLY_SPOTS = 60;

/**
 * CustomMapView: draws a custom map document. The editor and the game use
 * the same view (docs/CUSTOM_MAPS.md).
 *
 * ```ts
 * const view = new CustomMapView(doc, MapAssetLibrary.shared(), { anisotropy });
 * view.attach(scene);                     // group + losBlockers as direct scene children
 * view.environment.apply(scene, renderer); // sky, environment light, sun with shadows, fog
 * await view.ready;                        // ground materials and models are in
 * view.update(dt, camera, focus?);         // every frame: LOD, wind, water, culling, shadow box
 * view.heightAt(x, y);                     // map space, metres
 * view.raycast(ray); view.raycastObjects(ray);
 * ```
 *
 * Frame: see map-coords.ts (scene x = -map x, scene z = map y, y up). The
 * group sits at the scene origin; it may be moved but not rotated, and the
 * map space queries (`heightAt`) do not follow a move.
 *
 * Editor updates: change the document in place, then call the matching
 * update with the changed rectangle in map metres (`updateHeights`,
 * `updateSplat`), or the whole part (`updateLayers`, `updateWater`,
 * `setObjects`, `updateObject`, `updatePaths`, `setEnvironment`).
 *
 * Line of sight: `losBlockers` holds the terrain and the objects that block
 * sight; it is the group a world provider hands to the LOS cube. Everything
 * else in `group` (water, decoration, bridges, the apron) is outside it and
 * marked `userData.losTransparent`. The LOS cube hides every direct scene
 * child except its group, so `losBlockers` must be a direct child of the
 * scene: `attach(scene)` adds `group` and lifts `losBlockers` beside it
 * (same transform, the group sits at the origin).
 */


/** Rectangle in map metres */
export interface MapRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface MapRayHit {
  /** Scene position of the hit */
  point: Vector3;
  distance: number;
  /** Map position and surface height */
  x: number;
  y: number;
  height: number;
}

export interface CustomMapViewOptions {
  /** Anisotropic filtering of the ground textures (renderer.capabilities.getMaxAnisotropy()) */
  anisotropy?: number;
  /** Grass blades near the camera (default on) */
  grass?: boolean;
  /** The renderer the map is drawn with: bakes impostors for far trees (without it they keep their model) */
  renderer?: WebGLRenderer;
  /** Effects that cost more than the base look (map-effects.ts); all off when missing */
  effects?: Partial<MapEffects>;
}

export class CustomMapView {
  /** All render content of the map */
  readonly group = new Group();
  /** The terrain's height texture uniforms (TERRAIN_HEIGHT_GLSL), for shaders outside the map that lie on its ground */
  get heightUniforms(): HeightTexture['uniforms'] {
    return this.terrain.heightTexture.uniforms;
  }

  /** Terrain and sight-blocking objects, the LOS cube's group */
  readonly losBlockers = new Group();
  readonly heights: HeightField;
  readonly ready: Promise<void>;
  /** Sky, lights and fog; the owner applies it to its scene (`environment.apply(scene, renderer)`) */
  readonly environment: CustomMapEnvironment;

  private readonly terrain: MapTerrainLayer;
  /** Main water body first (null without one), then the further bodies */
  private readonly waters: (WaterSurface | null)[] = [];
  private rivers: RiverSurface[] = [];
  private readonly objects: MapObjectLayer;
  /** The border's trees mirrored onto the apron (edge-trees.ts) */
  private readonly edgeTrees: MapObjectLayer;
  private edgeTreesDue: ReturnType<typeof setTimeout> | null = null;
  private readonly bridges: BridgeLayer;
  private readonly effects: EffectLayer;
  /** Boats of the life areas drifting on the water (effects/life-boats.ts) */
  private readonly boats: LifeBoats;
  /** The quality level's share of the map's life (render-quality.ts `life`) */
  private lifeShare = 1;
  /** Terrain and roof tops for the weather; rebuilt lazily (coverDirty) */
  private readonly cover: CoverMap;
  private coverDirty = true;
  private coverAge = 0;
  private readonly camPos = new Vector3();
  private readonly hitPoint = new Vector3();
  private readonly mapPoint = { x: 0, y: 0 };
  private readonly focusPoint = new Vector3();
  private readonly grassCenter = new Vector3();
  /** Centre of the ground the camera sees, the sun's shadow box's (group and scene space) */
  private readonly shadowCenter = new Vector3();
  private readonly worldShadowCenter = new Vector3();
  /** Object and terrain versions the sun's shadow map was last rendered for */
  private shadowVersion = -1;
  /** Beyond this camera distance to its focus the grass blades are not drawn (the quality level's; 140 m in High) */
  private grassDistance = 140;
  private readonly viewRay = new Ray();
  /** The switchable effects (map-effects.ts) and the frame copy refraction reads */
  private mapEffects: MapEffects = { ...NO_MAP_EFFECTS };
  private readonly sceneCopy = new SceneCopy();
  /** The scene mirrored in the level of the area body in view (the reflection effect) */
  private readonly reflection = new WaterReflection(() => [
    ...this.waters.flatMap((w) => (w ? [w.object] : [])),
    ...this.rivers.map((r) => r.mesh),
    this.terrain.grass.mesh,
    this.decals.mesh,
    this.effects.group,
    ...this.objects.decorMeshes(),
  ], () => [this.group, this.losBlockers, this.environment.lights, this.environment.skyDome.mesh]);
  /** The body the reflection mirrors, picked a few times a second */
  private mirrored: WaterSurface | null = null;
  private mirrorAge = Infinity;
  private readonly mirrorLevel = new Vector3();
  private lavaDue: ReturnType<typeof setTimeout> | null = null;
  /** Leaves, trodden soil and puddles from the map's rules (ground-decals.ts) */
  private readonly decals: GroundDecals;
  /** The objects and paths the decals were laid for (lists and lengths); a change lays them again after a pause */
  private decalsFor = { objects: null as unknown, count: -1, paths: null as unknown, edges: -1 };
  private decalsDue: ReturnType<typeof setTimeout> | null = null;
  private lavaBaked = false;
  /** The far shadow cascade's next bake after an edit (shadowCascade); null when none is due */
  private farShadowDue: ReturnType<typeof setTimeout> | null = null;
  private readonly shadowArea = new Vector3();
  private disposed = false;
  /** Depth materials like the ones the shadow pass derives, by the material's uuid (warmUpAssets) */
  private readonly depthTwins = new Map<string, MeshDepthMaterial>();
  /** The next refreshAmbient, once edits pause */
  private ambientDue: ReturnType<typeof setTimeout> | null = null;
  /** Stand-ins of what an edit brings in later (effectTwins), kept so their programs stay */
  private effectMeshes: Mesh[] | null = null;
  /** A render target to compile the shadow pass's programs for (linear output, no tone mapping) */
  private offscreen: WebGLRenderTarget | null = null;

  constructor(
    readonly doc: CustomMapDocument,
    readonly assets: MapAssetLibrary,
    private readonly options: CustomMapViewOptions = {},
  ) {
    const t = doc.terrain;
    this.heights = new HeightField(t.grid, t.width, t.depth);
    this.group.name = 'custom-map';
    this.losBlockers.name = 'custom-map-los-blockers';
    this.group.add(this.losBlockers);

    this.terrain = new MapTerrainLayer(t, this.heights, BACKDROP_HEIGHT[doc.environment.biome ?? 'temperate']);
    this.losBlockers.add(this.terrain.chunks.group);
    this.group.add(this.terrain.apron);
    if (options.grass !== false) this.group.add(this.terrain.grass.mesh);

    this.mapEffects = { ...NO_MAP_EFFECTS, ...options.effects };
    this.environment = new CustomMapEnvironment(doc.environment);
    this.cover = new CoverMap(this.heights);
    this.environment.weather.setCover(this.cover);
    this.terrain.grass.setCover(this.cover);
    this.environment.setFogBase(lowGround(t.grid.heights, t.water?.level));
    this.updateWater();
    this.objects = new MapObjectLayer(this.heights, assets, this.losBlockers, {
      renderer: options.renderer,
      waterLevelAt: (x, y) => this.waterLevelAt(x, y),
    });
    this.group.add(this.objects.group);
    // The border's trees mirrored onto the apron: drawn only, their sight blockers in a group of the view's own,
    // not among the LOS blockers
    const edgeSight = new Group();
    edgeSight.name = 'custom-map-edge-trees';
    this.group.add(edgeSight);
    this.edgeTrees = new MapObjectLayer(new ApronField(this.heights, t.width, t.depth, () => this.terrain.apronProfile), assets, edgeSight, {
      renderer: options.renderer,
    });
    this.edgeTrees.group.name = 'custom-map-edge-trees';
    this.group.add(this.edgeTrees.group);
    this.bridges = new BridgeLayer(this.heights, assets);
    this.group.add(this.bridges.group);
    this.effects = new EffectLayer(this.heights, (x, y) => this.waterLevelAt(x, y));
    this.effects.setLife(doc.life);
    this.boats = new LifeBoats(assets, this.heights, (x, y) => this.waterLevelAt(x, y));
    this.group.add(this.boats.group);
    this.waveBanners();
    this.decals = new GroundDecals(this.terrain.heightTexture);
    this.group.add(this.decals.mesh);
    this.group.add(this.effects.group);
    this.refreshLava();
    this.applyShadowCascade();
    this.ready = this.load();
    // Ground material, objects and bridges are in: the shadow map shows them
    void this.ready.then(() => this.environment.invalidateShadows(), () => undefined);
  }

  /**
   * Adds the map to a scene: `group`, and `losBlockers` as a direct child of
   * the scene (the LOS cube renders only one direct child). Without it,
   * `scene.add(view.group)` draws the same but the LOS cube would hide the
   * blockers with the group.
   */
  attach(scene: Object3D): void {
    scene.add(this.group);
    scene.add(this.losBlockers);
    // Measurement hook: a page that set `__mapProbe` before loading (Playwright init script) gets the view
    const g = globalThis as { __mapProbe?: unknown };
    if (g.__mapProbe) g.__mapProbe = this;
  }

  /**
   * Compiles every shader the map needs once its assets are in, off the
   * main thread where the driver allows (KHR_parallel_shader_compile), so
   * the first frames do not stall on compiles. Hidden levels, cells and
   * effects count too (three's compile walks hidden objects). `target` is
   * what the frames draw into: a game with bloom or grading draws into a
   * linear post-processing target, and programs built for the screen would
   * all link again in its first frame (output colour space and tone mapping
   * are part of a program). Resolves with the number of programs it built.
   */
  async warmUp(renderer: WebGLRenderer, scene: Object3D, camera: Camera, target: WebGLRenderTarget | null = null): Promise<number> {
    await Promise.all([this.ready, this.environment.envReady]);
    if (this.disposed) return 0;
    const before = renderer.info.programs?.length ?? 0;
    const previous = renderer.getRenderTarget();
    let compiled: Promise<unknown>;
    try {
      // compileAsync builds the programs before it returns its promise: the target only around the call
      renderer.setRenderTarget(target);
      compiled = renderer.compileAsync(scene, camera);
    } finally {
      renderer.setRenderTarget(previous);
    }
    await compiled;
    if (this.disposed) return 0;
    // The shadow pass's depth programs too, off the main thread: the shadow frame below finds them built
    if (renderer.shadowMap.enabled && scene instanceof Scene) {
      const casters: Mesh[] = [];
      this.group.traverse((o) => {
        if (o instanceof Mesh && o.castShadow) casters.push(o);
      });
      await this.compileShadowTwins(renderer, scene, camera, casters);
    }
    // Frames that drew meanwhile (other worlds' parts, a waited-for frame) make compileAsync settle early:
    // wait until every program is built, or the shadow frame below and the first frames link them
    await programsReady(renderer);
    if (this.disposed) return 0;
    // compileAsync leaves out the shadow pass: its depth programs (instanced, alpha-tested cards,
    // per material) compiled on the first frame a caster entered the sun's box, a stall of seconds.
    // One frame with a cell of every asset casting compiles them now, during loading, into the same target
    if (renderer.shadowMap.enabled) {
      this.objects.showAllForWarmUp(true);
      const wasAuto = renderer.shadowMap.autoUpdate;
      renderer.shadowMap.autoUpdate = true;
      renderer.shadowMap.needsUpdate = true;
      try {
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
      } finally {
        renderer.setRenderTarget(previous);
        renderer.shadowMap.autoUpdate = wasAuto;
        this.objects.showAllForWarmUp(false);
        // The warm-up frame drew every cell into the shadow map: the next frame draws the real one, whole
        this.environment.invalidateShadowsNow();
      }
    }
    return (renderer.info.programs?.length ?? 0) - before;
  }

  /**
   * Compiles the programs of assets that are not on the map yet (a biome's
   * palette, a template's objects), off the main thread where the driver
   * allows, so placing the first one does not stall on a synchronous link.
   * Bakes their impostors as well. `scene` gives the lights and fog the
   * programs are built for; `compile` may build them for more than one
   * picture (the editor's view and its top-down render). The sun's shadow
   * pass draws the same meshes with depth materials into its map: their
   * programs are built here too, from twins of those materials (three's
   * shadow pass derives them per material the same way, getDepthMaterial),
   * kept so the programs stay. Resolves with the number of programs built.
   */
  async warmUpAssets(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    assetIds: string[],
    compile: (object: Object3D) => Promise<unknown> = (object) => renderer.compileAsync(object, camera, scene),
  ): Promise<number> {
    const meshes = await this.objects.warmUpMeshes(assetIds);
    if (this.disposed) {
      for (const m of meshes) m.dispose();
      return 0;
    }
    const group = new Group();
    for (const m of meshes) group.add(m);
    const before = renderer.info.programs?.length ?? 0;
    try {
      await Promise.all([compile(group), this.compileShadowTwins(renderer, scene, camera, meshes)]);
    } finally {
      for (const m of meshes) m.dispose();
    }
    return (renderer.info.programs?.length ?? 0) - before;
  }

  /**
   * Compiles, off the main thread, the programs the sun's shadow pass draws
   * `meshes` with: twins with the depth materials three derives for them
   * (getDepthMaterial), kept so the programs stay
   */
  private compileShadowTwins(renderer: WebGLRenderer, scene: Scene, camera: Camera, meshes: readonly Mesh[]): Promise<unknown> {
    if (!renderer.shadowMap.enabled) return Promise.resolve();
    const depth = new Group();
    for (const m of meshes) {
      if (Array.isArray(m.material)) continue;
      // A mesh with a depth material of its own (an impostor) casts with that one
      const material = (m.customDepthMaterial as MeshDepthMaterial | undefined) ?? this.depthTwinOf(m.material, renderer.shadowMap.type);
      let twin: Mesh;
      if (m instanceof InstancedMesh) {
        const instanced = new InstancedMesh(m.geometry, material, 1);
        instanced.instanceColor = m.instanceColor;
        twin = instanced;
      } else {
        twin = new Mesh(m.geometry, material);
      }
      twin.frustumCulled = false;
      depth.add(twin);
    }
    if (!depth.children.length) return Promise.resolve();
    this.offscreen ??= new WebGLRenderTarget(1, 1);
    const previous = renderer.getRenderTarget();
    const { fog, environment } = scene;
    try {
      // The shadow pass draws into its map without the scene's fog and environment, and both are part
      // of a program's key even where its shader does not use them. compileAsync builds the programs
      // before it returns its promise: target, fog and environment change only around the call
      renderer.setRenderTarget(this.offscreen);
      scene.fog = null;
      scene.environment = null;
      return renderer.compileAsync(depth, camera, scene);
    } finally {
      renderer.setRenderTarget(previous);
      scene.fog = fog;
      scene.environment = environment;
    }
  }

  /** Meshes for the terrain shader's variants with more material layers (MapTerrainLayer.layerTwins) */
  terrainLayerTwins(): Mesh[] {
    return this.terrain.layerTwins();
  }

  /**
   * Stand-ins for what a brush brings onto a map that has none yet, to
   * compile ahead: a water body and a river of every kind (lava with its heat
   * shimmer) with the map's switchable effects and sky, a particle field
   * (every kind shares one program) and the light halos. The first lava
   * pool of a hell stroke linked them in its frames (frames of 550 to 600
   * ms in a dev build). Built once and kept, so three keeps their programs;
   * the effects as they are now (a later switch recompiles anyway).
   */
  effectTwins(): Mesh[] {
    if (this.effectMeshes) return this.effectMeshes;
    const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(9), 3));
    const f = this.heights;
    const mapHalf = new Vector2(((f.columns - 1) * f.cellSize) / 2, ((f.rows - 1) * f.cellSize) / 2);
    const e = this.environment;
    const out: Mesh[] = [];
    const kinds: [MapWaterKind, boolean][] = [
      ...(['water', 'sea', 'swamp', 'ice', 'lava'] as MapWaterKind[]).map((k): [MapWaterKind, boolean] => [k, false]),
      ['water', true],
      ['lava', true],
    ];
    for (const [kind, river] of kinds) {
      const material = createWaterMaterial({ kind, river, heights: this.terrain.heightTexture, color: '', mapHalf });
      setWaterEffects(material, kind, this.mapEffects, this.sceneCopy);
      setWaterSky(material, e.skyDome.uniforms, e.sun.intensity);
      const mesh = new Mesh(geometry, material) as Mesh<BufferGeometry, ShaderMaterial>;
      mesh.receiveShadow = true;
      if (kind === 'lava' && this.mapEffects.lavaGlow) setHeatHaze(mesh, this.sceneCopy);
      out.push(mesh);
    }
    const particles = new ParticleField('smoke', [{ kind: 'smoke', origin: new Vector3(), radius: 1, height: 1, count: 1, color: undefined, scale: 1 }], { value: 0 }, { value: 1 });
    out.push(particles.mesh, glowStandIn());
    for (const m of out) m.frustumCulled = false;
    this.effectMeshes = out;
    return out;
  }

  /** The depth material three's shadow pass would draw `material` with (WebGLShadowMap getDepthMaterial) */
  private depthTwinOf(material: Material, type: ShadowMapType): MeshDepthMaterial {
    let twin = this.depthTwins.get(material.uuid);
    if (!twin) {
      twin = new MeshDepthMaterial();
      this.depthTwins.set(material.uuid, twin);
    }
    const m = material as Material & Partial<MeshDepthMaterial>;
    const flipped = { [FrontSide]: BackSide, [BackSide]: FrontSide, [DoubleSide]: DoubleSide };
    twin.side = material.shadowSide ?? (type === VSMShadowMap ? material.side : flipped[material.side]);
    twin.visible = material.visible;
    twin.wireframe = m.wireframe ?? false;
    twin.alphaMap = m.alphaMap ?? null;
    twin.alphaTest = material.alphaToCoverage ? 0.5 : material.alphaTest;
    twin.map = m.map ?? null;
    twin.clipShadows = material.clipShadows;
    twin.clippingPlanes = material.clippingPlanes;
    twin.clipIntersection = material.clipIntersection;
    twin.displacementMap = m.displacementMap ?? null;
    twin.displacementScale = m.displacementScale ?? 1;
    twin.displacementBias = m.displacementBias ?? 0;
    return twin;
  }

  /**
   * Runs `run` once with the map's point lights as they are and once in the
   * other state (night on, day off; effect-layer.ts withPool), for compiles
   * that build the programs of both
   */
  withEitherLights(run: (current: boolean) => void): void {
    const shown = this.effects.poolShown;
    run(true);
    this.effects.withPool(!shown, () => run(false));
  }

  /**
   * Shows or hides everything in the air: weather and ambient particles
   * (rain, snow, embers, ash, dust), object effects and light glows. For
   * renders that are not the player's view, like a top-down minimap, where the
   * particle box around the focus would show as a square.
   */
  setParticlesVisible(visible: boolean): void {
    this.environment.weather.mesh.visible = visible && this.environment.weather.active;
    this.effects.group.visible = visible;
  }

  /**
   * The highest water surface over the terrain at map point (x, y), null on
   * dry ground: the main water, further bodies (by their masks) and rivers
   */
  waterLevelAt(x: number, y: number): number | null {
    return waterLevelAt(this.doc.terrain, x, y, this.heights.heightAt(x, y));
  }

  /** Surface height at map point (x, y), the surface the finest terrain level shows */
  heightAt(x: number, y: number): number {
    return this.heights.heightAt(x, y);
  }

  /** First terrain hit of a scene-space ray, or null */
  raycast(ray: Ray): MapRayHit | null {
    const distance = this.heights.raycast(ray, this.hitPoint);
    if (distance === null) return null;
    const p = sceneToMap(this.hitPoint, this.mapPoint);
    return { point: this.hitPoint.clone(), distance, x: p.x, y: p.y, height: this.hitPoint.y };
  }

  /**
   * Per frame: terrain levels by camera distance, and the sun's shadow box
   * around `focus` (scene space; default: where the camera looks at the ground).
   */
  update(dtSeconds: number, camera: Camera, focus?: Vector3): void {
    if (this.disposed) return;
    const t0 = performance.now();
    this.updateFrame(dtSeconds, camera, focus);
    const ms = performance.now() - t0;
    this.stats.updateMs = this.stats.frames ? this.stats.updateMs * 0.95 + ms * 0.05 : ms;
    this.stats.frames++;
  }

  /** Main-thread cost of update(), smoothed, for measurements (sim-load --world, the preview) */
  readonly stats = { updateMs: 0, frames: 0 };

  /**
   * Holds every clock of the map still: wind in plants and grass, water and
   * lava flow, waterfalls, clouds, weather, particles and flames. The camera,
   * detail levels and shadows go on. The editor's still frame; the game
   * never sets it.
   */
  setAnimationPaused(paused: boolean): void {
    this.animationPaused = paused;
  }

  private animationPaused = false;

  private updateFrame(dtSeconds: number, camera: Camera, focus?: Vector3): void {
    // The map's clocks (wind, water, effects, sky); detail levels and the cover keep real time
    const clock = this.animationPaused ? 0 : dtSeconds;
    for (const w of this.waters) w?.update(clock);
    for (const r of this.rivers) r.update(clock);
    camera.getWorldPosition(this.camPos);
    this.group.worldToLocal(this.camPos);
    // focusPoint is in the group's frame (the map's): the game moves the group so that its HQ sits at
    // the scene origin, and the lights and sky live in the scene
    if (focus) {
      this.group.worldToLocal(this.focusPoint.copy(focus));
    } else {
      this.viewRay.origin.copy(this.camPos);
      camera.getWorldDirection(this.viewRay.direction);
      if (this.heights.raycast(this.viewRay, this.focusPoint, 3000) === null) this.heights.groundAhead(this.camPos, this.viewRay.direction, this.focusPoint);
    }
    this.terrain.update(this.camPos, clock, this.focusPoint);
    const reach = this.camPos.distanceTo(this.focusPoint);
    this.armReflection(camera, reach, dtSeconds);
    // Shadow box fitted to the ground the camera sees: sharp up close, wide from high up or looking far
    const fit = fitShadowBox(camera, this.group, this.focusPoint, this.shadowCenter);
    // The box's radius in its steps (shrinking only well below it), for the casters round its centre too:
    // following the view every frame, objects at its edge switched casting on and off and the shadow map
    // rendered again each frame (shimmer)
    const shadowRadius = this.environment.focus(this.group.localToWorld(this.worldShadowCenter.copy(this.shadowCenter)), fit);
    this.effects.update(clock, this.focusPoint);
    this.boats.update(clock);
    this.objects.shadowRadius = shadowRadius * 1.2;
    this.objects.update(dtSeconds, camera, this.shadowCenter);
    this.edgeTrees.shadowRadius = this.objects.shadowRadius;
    this.edgeTrees.update(dtSeconds, camera, this.shadowCenter);
    IMPOSTOR_SUN.uImpSun.value.copy(this.environment.sunDir);
    // Grass between the camera's foot and the focus; from far up blades are below a pixel, skip them
    this.grassCenter.copy(this.camPos).lerp(this.focusPoint, 0.6);
    this.terrain.grass.update(clock, this.grassCenter);
    this.terrain.grass.setNear(reach < this.grassDistance);
    // The weather's cover: at most four times a second, and only when something changed
    this.coverAge += dtSeconds;
    if (this.coverDirty && this.coverAge > 0.25) void this.refreshCover();
    this.cover.setFrame(this.group.position.x, this.group.position.z);
    // The shadow map renders only after a change: objects moved or switched level, the ground changed
    const shadowVersion = this.objects.version + this.terrain.chunks.version;
    if (shadowVersion !== this.shadowVersion) {
      this.shadowVersion = shadowVersion;
      this.environment.invalidateShadows();
    }
    this.watchDecals();
    this.environment.update(clock, camera);
    if (this.mapEffects.shadowCascade) {
      // The cached map's reach on the map, where the far cascade takes over
      const r = this.environment.shadowArea(this.shadowArea);
      this.group.worldToLocal(this.shadowArea);
      this.terrain.farShadow.setArea(-this.shadowArea.x, this.shadowArea.z, r, true);
    }
    this.environment.matchFog(this.camPos, this.focusPoint);
    this.environment.setFogMap(this.group.position.x, this.group.position.z, this.doc.terrain.width / 2, this.doc.terrain.depth / 2);
  }

  /** Heights changed inside `rect` (map metres); whole map when omitted. Objects and water follow. */
  updateHeights(rect?: MapRect): void {
    this.terrain.rebuild(rect ? this.gridRect(rect) : undefined);
    this.objects.refreshHeights(rect);
    this.coverDirty = true;
    // Water and bridges only when the change reaches them: a brush on a big map must stay cheap
    if (!rect) this.updateWater();
    else this.refreshWaterNear(rect);
    if (!rect || this.bridgeNear(rect)) void this.refreshBridges();
    // The apron beyond the border follows its heights, the mirrored trees the apron
    if (!rect || this.nearBorder(rect)) this.edgeTreesLater(this.doc.objects);
    this.environment.invalidateShadows();
    this.refreshFarShadow(true);
  }

  /** Whether a rectangle reaches into the border band whose trees are mirrored beyond it */
  private nearBorder(rect: MapRect): boolean {
    const hw = this.doc.terrain.width / 2 - EDGE_TREE_BAND;
    const hd = this.doc.terrain.depth / 2 - EDGE_TREE_BAND;
    return rect.minX < -hw || rect.maxX > hw || rect.minY < -hd || rect.maxY > hd;
  }

  /** Bakes the far shadow cascade again when it is on: right away, or after edits pause for 0.4 s */
  private refreshFarShadow(edit: boolean): void {
    if (this.farShadowDue) clearTimeout(this.farShadowDue);
    this.farShadowDue = null;
    if (!this.mapEffects.shadowCascade) return;
    // After an edit spread over frames: the whole bake (20 to 60 ms) held the frame it ran in
    const bake = (): void => {
      this.farShadowDue = null;
      if (!this.disposed) void this.terrain.bakeFarShadowSliced(this.environment.sunDir);
    };
    if (edit) this.farShadowDue = setTimeout(bake, 400);
    else if (!this.disposed) this.terrain.bakeFarShadow(this.environment.sunDir);
  }

  private async refreshBridges(): Promise<void> {
    await this.bridges.set(this.doc.paths, this.doc.terrain);
    this.environment.invalidateShadows();
  }

  /** Whether a water body's mask or a river comes within a few metres of a rectangle */
  /**
   * Heights changed in `rect`: only the water bodies whose mask reaches it
   * rebuild their surface (which cells it covers, its depth per vertex),
   * the apron's sea floor only when the change touches the border. Rivers
   * keep theirs: a ribbon follows its line, the depth comes from the
   * height texture per pixel.
   */
  private refreshWaterNear(rect: MapRect): void {
    const t = this.doc.terrain;
    const f = this.heights;
    const g = this.gridRect({ minX: rect.minX - 4, minY: rect.minY - 4, maxX: rect.maxX + 4, maxY: rect.maxY + 4 });
    const near = (mask: Uint8Array): boolean => {
      for (let j = Math.max(0, g.j0); j <= Math.min(f.rows - 1, g.j1); j++) {
        for (let i = Math.max(0, g.i0); i <= Math.min(f.columns - 1, g.i1); i++) {
          if (mask[j * f.columns + i]) return true;
        }
      }
      return false;
    };
    const border = g.i0 <= 0 || g.j0 <= 0 || g.i1 >= f.columns - 1 || g.j1 >= f.rows - 1;
    let lava = false;
    [t.water, ...(t.waterBodies ?? [])].forEach((body, k) => {
      const surface = this.waters[k];
      if (!body || !surface || !near(body.mask)) return;
      if (k === 0 && border) this.terrain.refreshWater();
      // Only the tiles the change reaches; the part beyond the border when the border changed
      surface.set(body, k === 0 && border ? this.terrain.apronProfile : null, g);
      lava ||= body.kind === 'lava';
      this.coverDirty = true;
    });
    if (lava) this.refreshLava();
  }

  private bridgeNear(rect: MapRect): boolean {
    const nodes = new Map(this.doc.paths.nodes.map((n) => [n.id, n]));
    return this.doc.paths.edges.some((e) => {
      if (e.kind !== 'bridge') return false;
      return [nodes.get(e.a), nodes.get(e.b), ...(e.via ?? [])].some(
        (p) => p && p.x > rect.minX - 20 && p.x < rect.maxX + 20 && p.y > rect.minY - 20 && p.y < rect.maxY + 20,
      );
    });
  }

  /** First placed object a scene-space ray hits (editor picking) */
  raycastObjects(ray: Ray): ObjectHit | null {
    return this.objects.raycast(ray);
  }

  /** The ground layers or the cliff material changed: reloads the terrain's materials */
  updateLayers(): Promise<void> {
    return this.terrain.load(this.assets, this.doc.paths, this.options.anisotropy ?? 8);
  }

  /** Splat weights changed inside `rect` */
  updateSplat(rect?: MapRect): void {
    if (!rect) {
      this.terrain.refreshSplat();
      return;
    }
    // Map metres to splat texels (texel (0, 0) at the south-west corner), one texel of margin
    const t = this.doc.terrain;
    const r = t.splat.resolution;
    this.terrain.refreshSplat({
      i0: Math.floor(((rect.minX + t.width / 2) / t.width) * r) - 1,
      j0: Math.floor(((rect.minY + t.depth / 2) / t.depth) * r) - 1,
      i1: Math.ceil(((rect.maxX + t.width / 2) / t.width) * r) + 1,
      j1: Math.ceil(((rect.maxY + t.depth / 2) / t.depth) * r) + 1,
    });
  }

  /**
   * Water changed: level, mask, colour or kind of the main body or of the
   * further bodies (`terrain.waterBodies`), the rivers, or heights under them
   */
  /**
   * Water changed. With `body` (0 the main water, 1.. the `waterBodies`) only
   * that body's surface is rebuilt, the objects floating in `rect` (map
   * metres) follow, and lava lights only when lava is involved: a pool brush
   * painting one mask stays cheap. Without, everything: all bodies, rivers,
   * river banks, the apron.
   */
  updateWater(rect?: MapRect, body?: number): void {
    const known = this.waters.length === 1 + (this.doc.terrain.waterBodies?.length ?? 0);
    if (body !== undefined && body > 0 && known) {
      this.updateWaterBody(body, rect);
      return;
    }
    if (body === 0 && rect && known && this.doc.terrain.water && this.waters[0]) {
      this.updateMainMask(rect);
      return;
    }
    this.terrain.refreshWater(this.doc.paths);
    // Rain stops and grass ends at the new surfaces, the mirrored trees beyond the border at the sea
    this.coverDirty = true;
    this.edgeTreesLater(this.doc.objects);
    const bodies = [this.doc.terrain.water, ...(this.doc.terrain.waterBodies ?? [])];
    // Slot 0 is the main body (it may be null); further bodies follow
    while (this.waters.length > bodies.length) this.waters.pop()?.dispose();
    bodies.forEach((body, k) => {
      const surface = this.waters[k] ?? null;
      if (!body) {
        surface?.dispose();
        this.waters[k] = null;
        return;
      }
      const apron = k === 0 ? this.terrain.apronProfile : null;
      if (surface) {
        surface.set(body, apron);
      } else {
        const created = new WaterSurface(this.heights, this.terrain.heightTexture, body, apron);
        this.waters[k] = created;
        this.group.add(created.object);
      }
    });
    // Rivers: rebuilt from their lines each time (cheap: a ribbon per river)
    for (const r of this.rivers) r.dispose();
    this.rivers = (this.doc.terrain.rivers ?? [])
      .filter((r) => r.points.length >= 2)
      .map((r) => new RiverSurface(this.heights, this.terrain.heightTexture, r));
    for (const r of this.rivers) this.group.add(r.mesh);
    // The constructor sets up the water before the effects exist and lights the lava after
    if (this.effects) this.refreshLava();
    // Floating objects follow the water, bridge decks clear the water they cross
    if (this.objects) this.objects.refreshHeights(undefined, true);
    if (this.bridges) void this.refreshBridges();
    this.lightWater();
  }

  /**
   * The main water's mask changed in `rect` (a brush on it): its wet banks
   * and surface tiles there, the part beyond the border when the change
   * reaches the border; level, paths and rivers stay
   */
  private updateMainMask(rect: MapRect): void {
    const water = this.doc.terrain.water!;
    const surface = this.waters[0]!;
    const g = this.gridRect({ minX: rect.minX - 4, minY: rect.minY - 4, maxX: rect.maxX + 4, maxY: rect.maxY + 4 });
    const f = this.heights;
    const border = g.i0 <= 0 || g.j0 <= 0 || g.i1 >= f.columns - 1 || g.j1 >= f.rows - 1;
    const wasLava = surface.kind === 'lava';
    if (border) this.terrain.refreshWater();
    else this.terrain.refreshWaterMask(g);
    surface.set(water, border ? this.terrain.apronProfile : null, g);
    this.coverDirty = true;
    if (border) this.edgeTreesLater(this.doc.objects);
    if (wasLava || water.kind === 'lava') this.effects.setLavaLights(this.lavaLightPoints());
    this.objects.refreshHeights(rect, true);
    if (this.bridgeNear(rect)) void this.refreshBridges();
  }

  private updateWaterBody(k: number, rect?: MapRect): void {
    const water = this.doc.terrain.waterBodies?.[k - 1];
    const surface = this.waters[k];
    if (!water || !surface) {
      this.updateWater();
      return;
    }
    const wasLava = surface.kind === 'lava';
    surface.set(water, null, rect ? this.gridRect(rect) : undefined);
    this.coverDirty = true;
    if (wasLava || water.kind === 'lava') this.refreshLava();
    this.objects.refreshHeights(rect, true);
    if (!rect || this.bridgeNear(rect)) void this.refreshBridges();
    this.lightWater();
  }

  /** Replaces the placed objects (also `doc.objects`); resolves when their models are in */
  setObjects(objects: MapObject[]): Promise<void> {
    this.doc.objects = objects;
    return Promise.all([this.objects.setObjects(objects), this.refreshEffects(), this.refreshContact(), this.refreshEdgeTrees()]).then(
      () => undefined,
    );
  }

  /**
   * Objects added to `doc.objects` by the caller: only the object cells
   * (192 m) they land in are rebuilt, and the contact shadows around them.
   * Resolves when they show.
   */
  async addObjects(objects: MapObject[]): Promise<void> {
    if (!objects.length) return;
    const shown = this.objects.addObjects(objects);
    void this.refreshContact(objects);
    this.edgeTreesLater(objects);
    if (await this.hasEffects(objects)) void this.refreshEffects();
    await shown;
  }

  /** Objects removed from `doc.objects` by the caller (pass them, not only their ids: their spots clear) */
  removeObjects(objects: MapObject[]): void {
    if (!objects.length) return;
    this.objects.removeObjects(objects.map((o) => o.id));
    void this.refreshContact(objects);
    this.edgeTreesLater(objects);
    void this.hasEffects(objects).then((has) => (has ? this.refreshEffects() : undefined));
  }

  /**
   * Objects moved, turned, scaled or changed asset (already changed in
   * `doc.objects`), `before` their last states: in place where they can, else
   * out of their cells and into the new ones; effects and contact shadows
   * once for all of them, the shadows only around the old and new spots.
   */
  updateObjects(objects: readonly MapObject[], before: readonly MapObject[] = objects): void {
    if (!objects.length) return;
    const rest = this.objects.updateObjects(objects);
    if (rest.length) {
      this.objects.removeObjects(rest.map((o) => o.id));
      void this.objects.addObjects(rest);
    }
    const all = [...before, ...objects];
    void this.hasEffects(all).then((has) => (has ? this.refreshEffects() : undefined));
    void this.refreshContact(all);
    this.edgeTreesLater(all);
  }

  updatePaths(): void {
    this.terrain.refreshPaths(this.doc.paths);
    void this.refreshBridges();
  }

  setEnvironment(env: MapEnvironment): void {
    const docBiome = this.doc.environment.biome;
    const biome = this.environment.biome;
    this.doc.environment = env;
    const sun = this.environment.sunDir.clone();
    this.environment.set(env);
    this.terrain.setBackdrop(BACKDROP_HEIGHT[env.biome ?? 'temperate']);
    // The far shadow only follows the sun and the backdrop's mountains (a sky, a weather or the fog leave it), spread
    // over frames once the sun stands: the whole bake (20 to 60 ms, 80 in a dev build) held every step of a sun slider
    // and the click of a sky
    if (!this.environment.sunDir.equals(sun) || env.biome !== docBiome) this.refreshFarShadow(true);
    // Fireflies and birds belong to some biomes only
    if (this.environment.biome !== biome) this.refreshAmbientSoon();
    this.lightWater();
    this.effects.setDarkness(this.environment.darkness);
    NIGHT_WINDOW_UNIFORMS.uNightWindows.value = this.environment.darkness;
  }

  /**
   * The map's life changed (the document's `life`: switches, density,
   * areas): effects, sparks over lava and the map's own fireflies and birds
   * follow
   */
  setLife(): void {
    this.effects.setLife(this.doc.life);
    void this.refreshEffects();
    this.effects.setLavaLights(this.lavaLightPoints());
    void this.refreshBoats();
    this.waveBanners();
  }

  /** The life areas' boats, on levels that show them */
  private refreshBoats(): Promise<void> {
    const shown = (this.doc.life?.areas ?? []).filter((a) => a.kind === 'boats' && areaShown(a, this.lifeShare));
    return this.boats.set(shown, lifeSwitches(this.doc.life).density);
  }

  /** Banners' cloth waves on maps that ask for it (life.flags), on levels that show the map's life */
  private waveBanners(): void {
    WIND_UNIFORMS.uClothWave.value = lifeSwitches(this.doc.life).flags && this.lifeShare > 0 ? 1 : 0;
  }

  /**
   * Lava's reach on the land around it: lights, embers and smoke over it
   * (effects), and the baked closeness the ground turns to cooled rock and
   * glows orange from below by (ground-occlusion.ts, channel A)
   */
  private refreshLava(): void {
    this.effects.setLavaLights(this.lavaLightPoints());
    this.refreshAmbientSoon();
    // The ground's closeness to lava: right away the first time, edits once they pause for a quarter second
    if (this.lavaDue) clearTimeout(this.lavaDue);
    this.lavaDue = null;
    if (this.lavaBaked) this.lavaDue = setTimeout(() => this.bakeLava(), 250);
    else this.bakeLava();
  }

  private bakeLava(): void {
    this.lavaDue = null;
    if (this.disposed) return;
    this.lavaBaked = true;
    const t = this.doc.terrain;
    const f = this.heights;
    const lava = new Uint8Array(f.columns * f.rows);
    for (const body of [t.water, ...(t.waterBodies ?? [])]) {
      if (!body || body.kind !== 'lava') continue;
      for (let k = 0; k < lava.length; k++) {
        if (body.mask[k] && f.grid.heights[k] < body.level) lava[k] = 1;
      }
    }
    for (const r of t.rivers ?? []) {
      if (r.kind !== 'lava' || r.points.length < 2) continue;
      for (const p of sampleRiver(r.points)) {
        const reach = Math.ceil(p.width / 2 / f.cellSize);
        const ci = Math.round((p.x - f.originX) / f.cellSize);
        const cj = Math.round((p.y - f.originY) / f.cellSize);
        for (let j = Math.max(0, cj - reach); j <= Math.min(f.rows - 1, cj + reach); j++) {
          for (let i = Math.max(0, ci - reach); i <= Math.min(f.columns - 1, ci + reach); i++) {
            if (Math.hypot(i - ci, j - cj) * f.cellSize <= p.width / 2) lava[j * f.columns + i] = 1;
          }
        }
      }
    }
    this.terrain.occlusion.setLava(lava);
    // Objects near lava glow from below by the same closeness (height-fog.ts)
    const g = LAVA_GLOW_UNIFORMS;
    g.uLavaGlowOn.value = lava.includes(1) ? 1 : 0;
    g.uLavaGlowTex.value = this.terrain.occlusion.texture;
    const sx = 1 / (f.cellSize * f.columns);
    const sy = 1 / (f.cellSize * f.rows);
    g.uLavaGridUv.value.set(sx, sy, (t.width / 2) * sx + 0.5 / f.columns, (t.depth / 2) * sy + 0.5 / f.rows);
  }

  /** refreshAmbient once edits pause for half a second */
  private refreshAmbientSoon(): void {
    if (this.ambientDue) clearTimeout(this.ambientDue);
    this.ambientDue = setTimeout(() => {
      this.ambientDue = null;
      void this.refreshAmbient();
    }, 500);
  }

  /**
   * Life the map brings by itself, from its content (effects.setAmbient):
   * fireflies over the shores of lakes and swamps and in woods, in the
   * biomes that have them; bird flocks circling over the most open land,
   * one per 300 m square of map (at most five), where there is air and
   * birds. Nothing to edit: a map with water and woods gets it.
   */
  private async refreshAmbient(): Promise<void> {
    const catalog = await this.assets.catalog();
    if (this.disposed) return;
    const biome = this.doc.environment.biome ?? 'temperate';
    const trees = new Set(catalog.objects.filter((o) => o.category === 'tree').map((o) => o.id));
    const woods = new Map<number, { x: number; y: number; n: number }>();
    const t = this.doc.terrain;
    const bin = (x: number, y: number) => Math.floor((y + t.depth / 2) / WOOD_CELL) * 4096 + Math.floor((x + t.width / 2) / WOOD_CELL);
    for (const o of this.doc.objects) {
      if (!trees.has(o.asset)) continue;
      const k = bin(o.x, o.y);
      const w = woods.get(k) ?? { x: 0, y: 0, n: 0 };
      w.x += o.x;
      w.y += o.y;
      w.n++;
      woods.set(k, w);
    }
    const fireflies = FIREFLY_BIOMES.has(biome) ? this.fireflyPoints(woods) : [];
    const flocks = BIRD_BIOMES.has(biome) ? this.flockSpots(woods, bin) : [];
    this.effects.setAmbient({ fireflies, flocks });
  }

  /** Points along the shores of lakes and swamps and in the middle of woods, at most MAX_FIREFLY_SPOTS, spread over the map */
  private fireflyPoints(woods: Map<number, { x: number; y: number; n: number }>): Vector3[] {
    const t = this.doc.terrain;
    const f = this.heights;
    const step = Math.max(1, Math.round(SHORE_STEP / f.cellSize));
    const out: Vector3[] = [];
    for (const body of [t.water, ...(t.waterBodies ?? [])]) {
      if (!body || (body.kind && body.kind !== 'water' && body.kind !== 'swamp')) continue;
      const wet = (i: number, j: number) => i >= 0 && j >= 0 && i < f.columns && j < f.rows && !!body.mask[j * f.columns + i] && f.sample(i, j) < body.level;
      for (let j = 0; j < f.rows; j += step) {
        for (let i = 0; i < f.columns; i += step) {
          if (!wet(i, j) || (wet(i + step, j) && wet(i - step, j) && wet(i, j + step) && wet(i, j - step))) continue;
          out.push(mapToScene(f.originX + i * f.cellSize, f.originY + j * f.cellSize, body.level + 0.3, new Vector3()));
        }
      }
    }
    for (const w of woods.values()) {
      if (w.n < WOOD_TREES) continue;
      const x = w.x / w.n;
      const y = w.y / w.n;
      out.push(mapToScene(x, y, f.heightAt(x, y) + 0.3, new Vector3()));
    }
    // Spread over the map: every k-th of them
    const k = Math.ceil(out.length / MAX_FIREFLY_SPOTS);
    return out.filter((_, n) => n % k === 0);
  }

  /** Centres of flocks over the land with the fewest trees, apart from each other, the map's edge and the water */
  private flockSpots(woods: Map<number, { x: number; y: number; n: number }>, bin: (x: number, y: number) => number): Flock[] {
    const t = this.doc.terrain;
    const f = this.heights;
    const wanted = Math.min(5, Math.max(1, Math.round((t.width * t.depth) / (300 * 300))));
    const candidates: { x: number; y: number; score: number }[] = [];
    for (let y = -t.depth / 2 + 80; y <= t.depth / 2 - 80; y += 60) {
      for (let x = -t.width / 2 + 80; x <= t.width / 2 - 80; x += 60) {
        if (this.waterLevelAt(x, y) !== null) continue;
        candidates.push({ x, y, score: woods.get(bin(x, y))?.n ?? 0 });
      }
    }
    candidates.sort((a, b) => a.score - b.score || a.x - b.x || a.y - b.y);
    const out: Flock[] = [];
    const centres: { x: number; y: number }[] = [];
    for (const c of candidates) {
      if (out.length >= wanted) break;
      if (centres.some((o) => Math.hypot(o.x - c.x, o.y - c.y) < 180)) continue;
      const k = out.length;
      centres.push(c);
      out.push(
        circleFlock(
          mapToScene(c.x, c.y, f.heightAt(c.x, c.y) + 45 + 12 * k, new Vector3()),
          40 + 8 * (k % 3),
          9 + (k % 3) * 2,
          ((Math.abs(Math.sin(c.x * 12.9898 + c.y * 78.233)) * 43758.5453) % 1) || 0.37,
        ),
      );
    }
    return out;
  }

  /** Where glowing lava lights its surroundings: one point per 40 m patch of a lava body, every 30 m along lava flows */
  private lavaLightPoints(): Vector3[] {
    const t = this.doc.terrain;
    const f = this.heights;
    const out: Vector3[] = [];
    const patch = 40;
    for (const body of [t.water, ...(t.waterBodies ?? [])]) {
      if (!body || body.kind !== 'lava') continue;
      const cells = new Map<number, { x: number; y: number; n: number }>();
      for (let j = 0; j < f.rows; j += 2) {
        for (let i = 0; i < f.columns; i += 2) {
          if (!body.mask[j * f.columns + i] || f.sample(i, j) > body.level) continue;
          const x = f.originX + i * f.cellSize;
          const y = f.originY + j * f.cellSize;
          const key = Math.floor(x / patch) * 4096 + Math.floor(y / patch);
          const c = cells.get(key) ?? { x: 0, y: 0, n: 0 };
          c.x += x;
          c.y += y;
          c.n++;
          cells.set(key, c);
        }
      }
      for (const c of cells.values()) out.push(mapToScene(c.x / c.n, c.y / c.n, body.level + 5, new Vector3()));
    }
    for (const r of t.rivers ?? []) {
      if (r.kind !== 'lava') continue;
      let walked = 30;
      for (let k = 0; k < r.points.length - 1; k++) {
        const a = r.points[k];
        const b = r.points[k + 1];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        for (; walked < len; walked += 30) {
          const u = walked / len;
          out.push(mapToScene(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.height + (b.height - a.height) * u + 5, new Vector3()));
        }
        walked -= len;
      }
    }
    return out.slice(0, 256);
  }

  private async refreshCover(): Promise<void> {
    this.coverDirty = false;
    this.coverAge = 0;
    const catalog = await this.assets.catalog();
    if (this.disposed) return;
    this.cover.set(this.doc.objects, this.catalogEntries(catalog), this.doc.terrain);
  }

  /** Contact shadows of the objects in the baked ground occlusion */
  /** Contact shadows of the objects; with `changed` only around those */
  /** Lays the ground decals for the objects and paths now in the document */
  private async refreshDecals(): Promise<void> {
    this.decalsDue = null;
    const catalog = await this.assets.catalog();
    if (this.disposed) return;
    this.decalsFor = { objects: this.doc.objects, count: this.doc.objects.length, paths: this.doc.paths, edges: this.doc.paths.edges.length };
    this.decals.set(this.doc, new Map(catalog.objects.map((o) => [o.id, o])));
  }

  /** Objects or paths added or removed (the editor): the decals follow once the changes pause. A move keeps them */
  private watchDecals(): void {
    const f = this.decalsFor;
    if (f.count < 0 || this.decalsDue) return;
    const d = this.doc;
    if (f.objects === d.objects && f.count === d.objects.length && f.paths === d.paths && f.edges === d.paths.edges.length) return;
    this.decalsDue = setTimeout(() => void this.refreshDecals(), 400);
  }

  private async refreshContact(changed?: MapObject[]): Promise<void> {
    this.coverDirty = true;
    const catalog = await this.assets.catalog();
    if (this.disposed) return;
    const entries = this.catalogEntries(catalog);
    let rect: MapRect | undefined;
    if (changed) {
      for (const o of changed) {
        const r = (entries.get(o.asset)?.footprint ?? 1) * (o.scale || 1) * 1.5 + 1;
        rect = rect
          ? { minX: Math.min(rect.minX, o.x - r), minY: Math.min(rect.minY, o.y - r), maxX: Math.max(rect.maxX, o.x + r), maxY: Math.max(rect.maxY, o.y + r) }
          : { minX: o.x - r, minY: o.y - r, maxX: o.x + r, maxY: o.y + r };
      }
    }
    this.terrain.occlusion.setObjects(this.doc.objects, entries, rect ? this.gridRect(rect) : undefined);
  }

  private entries: { catalog: AssetCatalog; map: Map<string, CatalogObject> } | null = null;

  /** The catalogue's objects by id, made once per catalogue */
  private catalogEntries(catalog: AssetCatalog): Map<string, CatalogObject> {
    if (this.entries?.catalog !== catalog) this.entries = { catalog, map: new Map(catalog.objects.map((o) => [o.id, o])) };
    return this.entries.map;
  }

  /** Whether any of the objects has effects or a light */
  private async hasEffects(objects: MapObject[]): Promise<boolean> {
    const catalog = await this.assets.catalog();
    const assets = new Set(objects.map((o) => o.asset));
    return catalog.objects.some((e) => assets.has(e.id) && (!!e.effects || !!e.light));
  }

  /**
   * The quality level's custom-map part (render-quality.ts): the sun's
   * shadow map, object detail and impostors, grass, the map's particles and
   * point lights, where the ground gets cheaper, the switchable effects, how
   * far plants sway. High is the picture as before the levels, with the
   * effects on
   */
  applyQuality(q: CustomMapQuality): void {
    setPlantSway(q.plantSway);
    this.environment.setShadowQuality(q.shadowMapSize, q.shadowRadius);
    this.setFarGround(q.farSingle, q.farFlat, q.steepNear);
    this.reflection.scale = q.waterReflection;
    this.reflection.every = q.waterReflectionEvery;
    this.setEffects({ refraction: q.refraction, seaWaves: q.seaWaves, lavaGlow: q.lavaGlow, shadowCascade: q.shadowCascade, waterDetail: q.waterDetail, reflection: q.waterReflection > 0 });
    this.objects.setDetail({ lodBias: q.lodBias, impostorFrom: q.impostorFrom });
    this.edgeTrees.setDetail({ lodBias: q.lodBias, impostorFrom: q.impostorFrom });
    this.terrain.grass.setBlades(q.grassBlades);
    this.grassDistance = q.grassDistance;
    this.environment.weather.setShare(q.particles);
    const lifeChanged = q.life !== this.lifeShare;
    this.lifeShare = q.life;
    if (this.effects.setQuality({ particles: q.particles, pointLights: q.pointLights, life: q.life })) {
      void this.refreshEffects();
      this.effects.setLavaLights(this.lavaLightPoints());
    }
    if (lifeChanged) {
      void this.refreshBoats();
      this.waveBanners();
    }
  }

  /** The border's trees mirrored onto the apron (edge-trees.ts), from `doc.objects` */
  private async refreshEdgeTrees(): Promise<void> {
    const catalog = await this.assets.catalog();
    if (this.disposed) return;
    const trees = new Set(catalog.objects.filter((e) => e.category === 'tree').map((e) => e.id));
    const t = this.doc.terrain;
    // None in the sea beyond a coast: from above they stood in the water as dark cones with their shadows
    const apron = this.terrain.apronProfile;
    await this.edgeTrees.setObjects(edgeTreeObjects(this.doc.objects, (a) => trees.has(a), t.width, t.depth, (x, y) => !apron.underWater(x, y, 0.3)));
  }

  /** Again once an edit pauses, when it touched the border's band */
  private edgeTreesLater(objects: readonly MapObject[]): void {
    const t = this.doc.terrain;
    const near = (o: MapObject) => Math.abs(o.x) > t.width / 2 - EDGE_TREE_BAND || Math.abs(o.y) > t.depth / 2 - EDGE_TREE_BAND;
    if (!objects.some(near)) return;
    if (this.edgeTreesDue) clearTimeout(this.edgeTreesDue);
    this.edgeTreesDue = setTimeout(() => {
      this.edgeTreesDue = null;
      void this.refreshEdgeTrees();
    }, 400);
  }

  /** Rebuilds effects and lights; with an asset id only when that asset has any */
  private async refreshEffects(asset?: string): Promise<void> {
    const catalog = await this.assets.catalog();
    if (this.disposed) return;
    // Woods grown or felled change where fireflies and birds go: once the edits pause
    this.refreshAmbientSoon();
    if (asset) {
      const e = catalog.objects.find((o) => o.id === asset);
      if (!e?.effects && !e?.light) return;
    }
    this.effects.set(this.doc.objects, catalog);
    this.effects.setDarkness(this.environment.darkness);
    NIGHT_WINDOW_UNIFORMS.uNightWindows.value = this.environment.darkness;
  }

  private lightWater(): void {
    const e = this.environment;
    for (const w of this.waters) w?.setSky(e.skyDome.uniforms, e.sun.intensity);
    for (const r of this.rivers) r.setSky(e.skyDome.uniforms, e.sun.intensity);
    this.applyEffects();
  }

  /**
   * The reflection for this frame: the area body with the most water round
   * the focus (picked four times a second) mirrored in its level
   */
  private armReflection(camera: Camera, reach: number, dt: number): void {
    if (!this.mapEffects.reflection) {
      this.reflection.arm(null, 0, null);
      return;
    }
    this.mirrorAge += dt;
    if (this.mirrorAge > 0.25) {
      this.mirrorAge = 0;
      const picked = this.pickMirrored(reach);
      if (picked !== this.mirrored) {
        this.mirrored = picked;
        for (const w of this.waters) w?.setMirrored(w === picked);
      }
    }
    const s = this.mirrored;
    this.reflection.arm(s ? camera : null, s ? this.group.localToWorld(this.mirrorLevel.set(0, s.level, 0)).y : 0, s);
  }

  /** The reflective body with the most wet samples within reach of the focus (a sparse grid), or none */
  private pickMirrored(reach: number): WaterSurface | null {
    const f = this.heights;
    const bodies = [this.doc.terrain.water, ...(this.doc.terrain.waterBodies ?? [])];
    const radius = Math.min(250, Math.max(40, reach * 0.8));
    const step = Math.max(1, Math.round(radius / f.cellSize / 10));
    const ci = Math.round((-this.focusPoint.x - f.originX) / f.cellSize);
    const cj = Math.round((this.focusPoint.z - f.originY) / f.cellSize);
    const r = Math.ceil(radius / f.cellSize);
    let best: WaterSurface | null = null;
    let most = 0;
    bodies.forEach((body, k) => {
      const surface = this.waters[k];
      if (!body || !surface?.reflective) return;
      let wet = 0;
      for (let j = Math.max(0, cj - r); j <= Math.min(f.rows - 1, cj + r); j += step) {
        for (let i = Math.max(0, ci - r); i <= Math.min(f.columns - 1, ci + r); i += step) {
          const at = j * f.columns + i;
          if (body.mask[at] > 0 && f.grid.heights[at] < body.level) wet++;
        }
      }
      if (wet > most) {
        most = wet;
        best = surface;
      }
    });
    return best;
  }

  /** Share of the frame's size the reflection renders at (quality levels), 0 off */
  setReflectionScale(scale: number): void {
    this.reflection.scale = scale;
  }

  /** Turns switchable effects on or off (map-effects.ts); the rest stay as they are */
  setEffects(effects: Partial<MapEffects>): void {
    const cascade = this.mapEffects.shadowCascade;
    this.mapEffects = { ...this.mapEffects, ...effects };
    this.applyEffects();
    if (this.mapEffects.shadowCascade !== cascade) this.applyShadowCascade();
  }

  private applyShadowCascade(): void {
    if (this.mapEffects.shadowCascade) this.refreshFarShadow(false);
    else this.terrain.farShadow.setArea(0, 0, 1, false);
  }

  /**
   * Distances (m) from which the ground gets cheaper: one layer lookup at a
   * larger scale from `single` (default 150), only the layers' average colours
   * from `flat` (default 400); painted ground on steep slopes reads its side
   * planes up to `steep` (default `single`, 0 none). For the quality levels
   */
  setFarGround(single: number, flat: number, steep = single): void {
    this.terrain.setFarDistances(single, flat, steep);
  }

  /** The switchable effects now on */
  get effectsOn(): Readonly<MapEffects> {
    return this.mapEffects;
  }

  private applyEffects(): void {
    for (const w of this.waters) w?.setEffects(this.mapEffects, this.sceneCopy, this.reflection);
    const rivers = this.doc.terrain.rivers?.filter((r) => r.points.length >= 2) ?? [];
    this.rivers.forEach((r, k) => r.setEffects(this.mapEffects, this.sceneCopy, rivers[k]?.kind ?? 'water'));
  }

  dispose(): void {
    this.disposed = true;
    if (LAVA_GLOW_UNIFORMS.uLavaGlowTex.value === this.terrain.occlusion.texture) LAVA_GLOW_UNIFORMS.uLavaGlowOn.value = 0;
    this.terrain.dispose();
    for (const w of this.waters) w?.dispose();
    for (const r of this.rivers) r.dispose();
    this.effects.dispose();
    this.boats.dispose();
    WIND_UNIFORMS.uClothWave.value = 0;
    this.cover.dispose();
    this.objects.dispose();
    this.edgeTrees.dispose();
    if (this.edgeTreesDue) clearTimeout(this.edgeTreesDue);
    this.bridges.dispose();
    this.environment.dispose();
    for (const twin of this.depthTwins.values()) twin.dispose();
    for (const m of this.effectMeshes ?? []) {
      setHeatHaze(m as Mesh<BufferGeometry, ShaderMaterial>, null);
      (m.material as ShaderMaterial).dispose();
      m.geometry.dispose();
    }
    this.effectMeshes = null;
    this.offscreen?.dispose();
    this.sceneCopy.dispose();
    this.reflection.dispose();
    if (this.lavaDue) clearTimeout(this.lavaDue);
    if (this.ambientDue) clearTimeout(this.ambientDue);
    if (this.farShadowDue) clearTimeout(this.farShadowDue);
    if (this.decalsDue) clearTimeout(this.decalsDue);
    this.decals.dispose();
    this.group.removeFromParent();
    this.losBlockers.removeFromParent();
    this.group.clear();
  }

  /** Grid samples covering a map rectangle, one sample of margin */
  private gridRect(rect: MapRect): GridRect {
    const f = this.heights;
    return {
      i0: Math.floor((rect.minX - f.originX) / f.cellSize) - 1,
      j0: Math.floor((rect.minY - f.originY) / f.cellSize) - 1,
      i1: Math.ceil((rect.maxX - f.originX) / f.cellSize) + 1,
      j1: Math.ceil((rect.maxY - f.originY) / f.cellSize) + 1,
    };
  }

  private async load(): Promise<void> {
    await Promise.all([
      this.terrain.load(this.assets, this.doc.paths, this.options.anisotropy ?? 8),
      this.objects.setObjects(this.doc.objects),
      this.refreshEdgeTrees(),
      this.refreshEffects(),
      this.refreshBoats(),
      this.refreshContact(),
      this.bridges.set(this.doc.paths, this.doc.terrain),
      this.refreshDecals(),
    ]);
  }
}

/** The low ground of a map for the height fog: the water level, or near the lowest heights */
function lowGround(heights: Float32Array, waterLevel: number | undefined): number {
  if (waterLevel !== undefined) return waterLevel;
  const sorted = Float32Array.from(heights).sort();
  return sorted[Math.floor(sorted.length * 0.05)] ?? 0;
}
