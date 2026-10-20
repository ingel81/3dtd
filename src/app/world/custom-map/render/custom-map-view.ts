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
  type Side,
  type WebGLRenderer,
} from 'three';
import type { CustomMapDocument, MapEnvironment, MapHeightGrid, MapLifeArea, MapObject, MapWaterKind } from '../map-document';
import { HeightField } from './height-field';
import { StaticGroup } from '../../../three-engine/static-group';
import type { ShotLights } from '../../../three-engine/shot-lights/shot-lights';
import type { MapAssetLibrary } from './map-asset-library';
import type { AssetCatalog, CatalogObject } from './asset-catalog';
import { mapToScene, sceneToMap } from './map-coords';
import type { FallImpactAt } from '../../world-provider';
import { CustomMapEnvironment } from './environment/map-environment';
import { fitShadowBox } from './environment/shadow-fit';
import { EffectLayer, glowStandIn } from './effects/effect-layer';
import { shaftStandIn } from './effects/light-shafts';
import { circleFlock, type Flock } from './effects/bird-flocks';
import { LifeMovers } from './effects/life-movers';
import { cableRopes } from './effects/cable-ride';
import { LifeHaze } from './effects/life-haze';
import { areaShown, lifeSwitches } from '../map-life';
import type { MapBiome } from '../map-document';
import { CoverMap } from './environment/cover-map';
import { setPlantSway, WIND_UNIFORMS } from './environment/wind';
import { prepareNoiseTextures } from './noise-textures';
import { MapObjectLayer, type ObjectDamage, type ObjectHit } from './objects/object-layer';
import { DAMAGE_UNIFORMS, FELL_LONG_AGO, RUIN_HOLES, sceneHeading } from './objects/ruin-damage';
import { fontsReady, SignLayer } from './objects/sign-text';
import { IMPOSTOR_SUN } from './objects/impostor';
import { BridgeLayer } from './paths/path-bridges';
import type { RoadCover } from './paths/path-mask';
import type { TexelRect } from './terrain/texture-ranges';
import { LAVA_GLOW_UNIFORMS } from './environment/height-fog';
import { ImpostorCache } from './objects/impostor-cache';
import type { ImpostorLights } from './objects/impostor';
import { groundCuts } from './terrain/terrain-cuts';
import { MapTerrainLayer } from './terrain/map-terrain';
import { ApronField, EDGE_TREE_BAND, edgeTreeObjects } from './objects/edge-trees';
import { NIGHT_WINDOW_UNIFORMS } from './objects/night-windows';
import type { HeightTexture } from './terrain/height-texture';
import { RiverSurface } from './water/river-surface';
import { lavaSamples, type GroundBaker } from './terrain/ground-shape';
import { GroundWorker } from './terrain/ground-worker';
import { WaterSurface } from './water/water-surface';
import type { CustomMapQuality } from '../../../three-engine/render-quality';
import { SceneCopy } from './water/scene-copy';
import { createWaterMaterial, setWaterEffects, setWaterSky } from './water/water-material';
import { setHeatHaze } from './water/heat-haze';
import { ParticleField } from './effects/particle-field';
import { WaterReflection } from './water/water-reflection';
import { MirrorChoice, type MirrorCandidate } from './water/mirror-choice';
import { GroundDecals } from './terrain/ground-decals';
import { ImpactMarks } from './terrain/impact-marks';
import { RubblePieces } from './terrain/rubble-pieces';
import { FlyingDebris } from './terrain/flying-debris';
import type { ImpactMark } from '../custom-map-ground-damage';
import { NO_MAP_EFFECTS, type MapEffects } from './map-effects';
import type { GridRect } from './terrain/terrain-chunks';
import { firstUsePrograms, programsReady } from '../../../three-engine/programs-ready';
import { boundTexturesOf, uploadTextures } from '../../../three-engine/texture-upload';
import { waterLevelAt } from '../water-level';
import { massRadius } from '../object-mass';
import { PacedRefresh } from './paced-refresh';
import { selectNth } from '../../../utils/select-nth';

/** Biomes with fireflies at night, and with birds by day */
const FIREFLY_BIOMES: ReadonlySet<MapBiome> = new Set(['temperate', 'swamp', 'mountain']);
const BIRD_BIOMES: ReadonlySet<MapBiome> = new Set(['temperate', 'mountain', 'swamp', 'desert', 'arctic', 'city', 'apocalypse']);
/** Woods for fireflies and open land for birds are counted in squares of this size, metres; a wood has this many trees */
/** Milliseconds at least between two rebuilds of contact shadows and effects while objects keep changing */
const EDIT_REFRESH_MS = 120;
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
 * group sits at the scene origin; it may be moved (`placeAt`) but not
 * rotated, and the map space queries (`heightAt`) do not follow a move.
 *
 * The map stands still: `group` and `losBlockers` are StaticGroups, their
 * world matrices computed after a move or an addition, not every frame
 * (three-engine/static-group.ts). What moves on the map moves in instance
 * buffers or shaders (movers, birds, rotors, cloth, wind); the point lights
 * place their own matrices. An object that moves by its own transform goes
 * in with `addMoving`.
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
  /**
   * Who works the ground's shape out off the page's thread (occlusion, curvature and drainage, the closeness to
   * lava, the far shadow), from the first bake on: the editor's worker, which follows its edits. Missing: a
   * worker of the view's own on the map as it is made (GroundWorker; the game's map holds still); null: in place
   */
  groundBaker?: GroundBaker | null;
  /**
   * The scene's light buffer (three-engine/shot-lights): the real lights of
   * the lamps nearest the view go to it at night, for the map's materials,
   * towers and units. Without it the lamps light only the ground they are
   * baked onto (lamp-light.ts)
   */
  lights?: ShotLights;
  /**
   * The ground takes the fight's marks: craters and rubble (impact-marks.ts,
   * docs/DESTRUCTION_PLAN.md); their program is built with the map's, not in the game
   */
  impactMarks?: boolean;
  /**
   * Buildings take damage (docs/DESTRUCTION_PLAN.md, Z2): their ruins'
   * programs are built with the map's, and they stand on `standingGround`,
   * the heights as the map made them, not on the fight's craters and rubble
   */
  ruins?: boolean;
  standingGround?: MapHeightGrid;
}

export class CustomMapView {
  /** All render content of the map */
  readonly group = new StaticGroup();
  /** The terrain's height texture uniforms (TERRAIN_HEIGHT_GLSL), for shaders outside the map that lie on its ground */
  get heightUniforms(): HeightTexture['uniforms'] {
    return this.terrain.heightTexture.uniforms;
  }

  /** Terrain and sight-blocking objects, the LOS cube's group */
  readonly losBlockers = new StaticGroup();
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
  /** The writing on the objects' signs (MapObject.sign), one draw call */
  private readonly signs = new SignLayer();
  /** Far trees' and rocks' impostors, baked once for both object layers */
  private readonly impostors: ImpostorCache | undefined;
  private edgeTreesDue: ReturnType<typeof setTimeout> | null = null;
  private readonly bridges: BridgeLayer;
  private readonly effects: EffectLayer;
  /** Boats drifting on the water and movers going over the ground, of the life areas (effects/life-movers.ts) */
  private readonly movers: LifeMovers;
  /** Heat shimmer over the life areas of hot ground (effects/life-haze.ts), with the lava glow effect */
  private readonly haze: LifeHaze;
  /** The quality level's share of the map's life (render-quality.ts `life`) */
  private lifeShare = 1;
  /** Terrain and roof tops for the weather; rebuilt lazily (markCover): the samples of `coverRect`, all while it is null */
  private readonly cover: CoverMap;
  private coverDirty = true;
  private coverRect: GridRect | null = null;
  private coverAge = 0;
  private readonly camPos = new Vector3();
  private readonly hitPoint = new Vector3();
  private readonly mapPoint = { x: 0, y: 0 };
  private readonly focusPoint = new Vector3();
  /** Centre of the ground the camera sees, the sun's shadow box's (group and scene space) */
  private readonly shadowCenter = new Vector3();
  private readonly worldShadowCenter = new Vector3();
  /** Object and terrain versions the sun's shadow map was last rendered for */
  private shadowVersion = -1;
  private readonly viewRay = new Ray();
  /** The switchable effects (map-effects.ts) and the frame copy refraction reads */
  private mapEffects: MapEffects = { ...NO_MAP_EFFECTS };
  private readonly sceneCopy = new SceneCopy();
  /** The scene mirrored in the level of the area body in view (the reflection effect) */
  private readonly reflection = new WaterReflection(() => [
    ...this.waters.flatMap((w) => (w ? [w.object] : [])),
    ...this.rivers.map((r) => r.mesh),
    ...this.terrain.grass.meshes,
    this.decals.mesh,
    this.effects.group,
    this.movers.group,
    this.haze.group,
    ...this.objects.decorMeshes(),
  ], () => [this.group, this.losBlockers, this.environment.lights, this.environment.skyDome.mesh], this.sceneCopy, (on) => this.objects.nearOnly(on));
  /** Which level the reflection mirrors and how strongly (mirror-choice.ts) */
  private readonly mirrorChoice = new MirrorChoice<WaterSurface>();
  private readonly mirrorLevel = new Vector3();
  private lavaDue: ReturnType<typeof setTimeout> | null = null;
  /** The lava's lights and embers after an edit, once edits pause (refreshLava) */
  private lavaLightsDue: ReturnType<typeof setTimeout> | null = null;
  /** Leaves, trodden soil and puddles from the map's rules (ground-decals.ts) */
  private readonly decals: GroundDecals;
  /** Craters and rubble of the fight (impact-marks.ts), with options.impactMarks */
  private readonly impactMarks: ImpactMarks | null = null;
  /** Pieces thrown out by a fall (flying-debris.ts), with options.impactMarks */
  private readonly flyingDebris: FlyingDebris | null = null;
  /** Samples where the fight tore the ground up: no grass (setGroundBare) */
  private groundBare: Uint8Array | null = null;
  /** The pieces on the fallen structures' heaps (rubble-pieces.ts), with options.impactMarks */
  private readonly rubblePieces: RubblePieces | null = null;
  /** Which objects the view shows (an editor hides categories); null shows all */
  private visible: ((o: MapObject) => boolean) | null = null;
  /** Objects a crater wiped out (setGone) */
  private readonly gone = new Set<string>();
  /** The ruins' smouldering nests as last set (refreshEmbers) */
  private embersKey: string | null = null;
  /** The objects shown, by id, as they were last shown: a change finds what it replaces (objectsChanged) */
  private shown = new Map<string, MapObject>();
  /** The shown objects in the document's order while some are hidden; null until asked for after a change */
  private shownList: MapObject[] | null = null;
  /** The environment shown: the view reads the document and never writes it */
  private env: MapEnvironment;
  /** The objects and paths the decals were laid for (lists and lengths); a change lays them again after a pause */
  private decalsFor = { objects: null as unknown, count: -1, paths: null as unknown, edges: -1 };
  private decalsDue: ReturnType<typeof setTimeout> | null = null;
  private lavaBaked = false;
  /** The water surfaces stand (updateWater once); before, the terrain's banks are those of its constructor */
  private watersPlaced = false;
  /** The view's own baker (CustomMapViewOptions.groundBaker), ended with the view */
  private ownBaker: GroundWorker | null = null;
  /** The first bakes of the far shadow and of the closeness to lava, which `ready` waits for */
  private farShadowFirst: Promise<unknown> = Promise.resolve();
  private lavaFirst: Promise<unknown> = Promise.resolve();
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
  /** The light state of the map's cached shadow build (ShadowParts: an empty scene), to compile its depth programs for */
  private lightless: Scene | null = null;

  constructor(
    readonly doc: CustomMapDocument,
    readonly assets: MapAssetLibrary,
    private readonly options: CustomMapViewOptions = {},
  ) {
    assets.retain(doc.meta.id);
    // A row per ruin of this map from here on (one destructible world at a time)
    if (options.ruins) RUIN_HOLES.clear();
    const t = doc.terrain;
    this.env = doc.environment;
    this.heights = new HeightField(t.grid, t.width, t.depth);
    this.group.name = 'custom-map';
    this.losBlockers.name = 'custom-map-los-blockers';
    this.group.add(this.losBlockers);

    if (options.groundBaker === undefined) this.ownBaker = new GroundWorker(t);
    this.terrain = new MapTerrainLayer(t, this.heights, doc.environment.biome ?? 'temperate', options.groundBaker ?? this.ownBaker);
    this.losBlockers.add(this.terrain.chunks.group);
    this.group.add(this.terrain.apron);
    this.group.add(this.terrain.roads.group);
    // Before the ground loads: its path mask leaves the ground under the surfaces to them
    this.terrain.surfaces.set(doc.surfaces ?? []);
    this.group.add(this.terrain.surfaces.group);
    if (options.grass !== false) this.group.add(...this.terrain.grass.meshes);

    this.mapEffects = { ...NO_MAP_EFFECTS, ...options.effects };
    this.environment = new CustomMapEnvironment(doc.environment);
    this.cover = new CoverMap(this.heights);
    this.environment.weather.setCover(this.cover);
    // A storm's bolts end on the ground (scene space; the group may be moved, not turned)
    this.environment.lightning.setGround((x, z) => this.heights.heightAt(this.group.position.x - x, z - this.group.position.z) + this.group.position.y);
    this.terrain.grass.setCover(this.cover);
    this.environment.setFogBase(lowGround(t.grid.heights, t.water?.level));
    this.updateWater();
    // One bake per asset for both object layers, all of them in the view's texture arrays (impostor-array.ts); the
    // tone probe measures under the map's own sun, sky, ambient and environment map, once that is filled
    this.impostors = options.renderer
      ? new ImpostorCache(
          options.renderer,
          () => impostorLights(this.environment),
          () => this.environment.envReady,
        )
      : undefined;
    const standing = options.standingGround ? new HeightField(options.standingGround, t.width, t.depth) : null;
    this.objects = new MapObjectLayer(this.heights, assets, this.losBlockers, {
      impostors: this.impostors,
      waterLevelAt: (x, y) => this.waterLevelAt(x, y),
      ruins: options.ruins,
      ...(standing ? { standingAt: (x: number, y: number) => standing.heightAt(x, y) } : {}),
    });
    this.group.add(this.objects.group);
    this.group.add(this.signs.group);
    // The border's trees mirrored onto the apron: drawn only, their sight blockers in a group of the view's own,
    // not among the LOS blockers
    const edgeSight = new Group();
    edgeSight.name = 'custom-map-edge-trees';
    this.group.add(edgeSight);
    this.edgeTrees = new MapObjectLayer(new ApronField(this.heights, t.width, t.depth, () => this.terrain.apronProfile), assets, edgeSight, {
      impostors: this.impostors,
    });
    this.edgeTrees.group.name = 'custom-map-edge-trees';
    this.group.add(this.edgeTrees.group);
    this.bridges = new BridgeLayer(this.heights, assets);
    this.group.add(this.bridges.group);
    this.effects = new EffectLayer(
      this.heights,
      (x, y) => this.waterLevelAt(x, y),
      (x, y) => waterLevelAt(this.doc.terrain, x, y, this.heights.heightAt(x, y) - 1, 'lava') !== null,
      this.terrain.light,
    );
    this.effects.setLife(doc.life);
    // A hidden nest of embers for the warm-up: the ruins' smoulder draws with programs built with the map's
    if (options.ruins) this.effects.setRuinEmbers([], true);
    options.lights?.addSteadySource(this.effects);
    this.movers = new LifeMovers(assets, this.heights, (x, y) => this.waterLevelAt(x, y));
    this.group.add(this.movers.group);
    this.haze = new LifeHaze(this.heights);
    this.group.add(this.haze.group);
    this.refreshHaze();
    this.waveBanners();
    this.decals = new GroundDecals(this.terrain.heightTexture);
    this.group.add(this.decals.mesh);
    if (options.impactMarks) {
      this.impactMarks = new ImpactMarks(this.terrain.heightTexture);
      this.group.add(this.impactMarks.mesh);
      this.rubblePieces = new RubblePieces(this.terrain.heightTexture);
      this.group.add(...this.rubblePieces.meshes);
      this.flyingDebris = new FlyingDebris();
      this.group.add(this.flyingDebris.mesh);
    }
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
   * Moves the map so that its middle (map 0, 0) lies at scene (x, 0, z),
   * `group` and `losBlockers` alike, their world matrices at once
   */
  placeAt(x: number, z: number): void {
    for (const g of [this.group, this.losBlockers]) {
      g.position.set(x, 0, z);
      g.updateMatrix();
      g.updateMatrixWorld(true);
    }
  }

  /**
   * Compiles every shader the map needs once its assets are in, off the
   * main thread where the driver allows (KHR_parallel_shader_compile), so
   * the first frames do not stall on compiles. Hidden levels, cells and
   * effects count too (three's compile walks hidden objects). `target` is
   * what the frames draw into: a game with bloom or grading draws into a
   * linear post-processing target, and programs built for the screen would
   * all link again in its first frame (output colour space and tone mapping
   * are part of a program). The lamps' lights change no program (they go to
   * the light buffer, `lights`): day and night draw with the same ones. A
   * frame is drawn too: the first draw of a program does work of its own
   * (uniform locations, the driver's own translation). Resolves with the
   * number of programs it built.
   */
  async warmUp(
    renderer: WebGLRenderer,
    scene: Object3D,
    camera: Camera,
    target: WebGLRenderTarget | null = null,
  ): Promise<number> {
    await Promise.all([this.ready, this.environment.envReady]);
    if (this.disposed) return 0;
    // The ruins no building is in yet wait out of the scene: their programs are built after the game stands
    // (warmLater), not before it (E274: 52 of the 294 programs of an OSM world's load)
    this.warmContext = { renderer, scene, camera };
    this.parkRuins();
    const before = renderer.info.programs?.length ?? 0;
    const previous = renderer.getRenderTarget();
    const compiled: Promise<unknown>[] = [];
    try {
      // compileAsync builds the programs before it returns its promise: the target only around the call
      renderer.setRenderTarget(target);
      compiled.push(renderer.compileAsync(scene, camera));
    } finally {
      renderer.setRenderTarget(previous);
    }
    // The water's mirror draws the map into a linear target without tone mapping: when the frames go to the screen,
    // other programs of everything it shows (a first rain in it linked the weather's in its frame)
    if (!target && this.mapEffects.reflection && this.waters.some((w) => w)) {
      const mirror = new WebGLRenderTarget(1, 1);
      try {
        renderer.setRenderTarget(mirror);
        this.withAllShown(() => {
          for (const part of this.mirroredParts()) compiled.push(renderer.compileAsync(part, camera, scene instanceof Scene ? scene : null));
        });
      } finally {
        renderer.setRenderTarget(previous);
        mirror.dispose();
      }
    }
    await Promise.all(compiled);
    if (this.disposed) return 0;
    // The shadow pass's depth programs too, off the main thread: the shadow frame below finds them built. Every
    // caster the objects can bring (showAllForWarmUp), not only the ones that cast now: an asset that first cast
    // in the game (an intact tower stump in the sun's box after a fall nearby) linked its program in that frame
    if (renderer.shadowMap.enabled && scene instanceof Scene) {
      const casters = this.withAllShown(() => {
        const out: Mesh[] = [];
        for (const root of this.roots()) {
          root.traverse((o) => {
            if (o instanceof Mesh && o.castShadow) out.push(o);
          });
        }
        return out;
      });
      await this.compileShadowTwins(renderer, scene, camera, casters);
    }
    // Frames that drew meanwhile (other worlds' parts, a waited-for frame) make compileAsync settle early:
    // wait until every program is built, or the frames below and the first frames link them
    await programsReady(renderer);
    if (this.disposed) return 0;
    // The ground's colour for the grass and the water's view of the land, before the first frame shows them
    await this.terrain.bakeGroundColor(renderer);
    if (this.disposed) return 0;
    // The frame below otherwise did the programs' first-use work and uploaded every texture it binds in one long
    // task (demo valley after the editor: 212 ms info logs, 332 ms uploads): a task for each that takes time
    const gone = () => this.disposed;
    await firstUsePrograms(renderer, gone);
    await uploadTextures(renderer, this.withAllShown(() => boundTexturesOf(renderer, scene)), gone);
    if (this.disposed) return 0;
    // compileAsync leaves out the shadow pass: its depth programs (instanced, alpha-tested cards,
    // per material) compiled on the first frame a caster entered the sun's box, a stall of seconds.
    // One frame with a cell of every asset casting and all else shown (withAllShown) compiles them now,
    // during loading, into the same target
    const shadows = renderer.shadowMap.enabled;
    const wasAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = shadows;
    renderer.shadowMap.needsUpdate = shadows;
    try {
      renderer.setRenderTarget(target);
      this.withAllShown(() => renderer.render(scene, camera));
    } finally {
      renderer.setRenderTarget(previous);
      renderer.shadowMap.autoUpdate = wasAuto;
      // The warm-up frame drew every cell into the shadow map: the next frame draws the real one, whole
      if (shadows) this.environment.invalidateShadowsNow();
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
   * (getDepthMaterial), kept so the programs stay. Twice: for three's own
   * pass in a frame of `scene` (the warm-up frame), and for the map's cached
   * shadow build, which draws its parts inside the render of an empty scene
   * (ShadowParts): no lights there, and the lights are part of a program's
   * key even where a depth shader does not use them
   */
  private compileShadowTwins(renderer: WebGLRenderer, scene: Scene, camera: Camera, meshes: readonly Mesh[]): Promise<unknown> {
    if (!renderer.shadowMap.enabled) return Promise.resolve();
    const depth = new Group();
    for (const m of meshes) {
      if (Array.isArray(m.material)) continue;
      // A mesh with a depth material of its own (an impostor, a ruin) casts with that one, which the shadow pass
      // gives the mesh material's side and maps as it does a twin (a ruin's are double-sided, a wall's textured);
      // one depth material serves many meshes, so a copy per mesh material holds each one's state
      const own = m.customDepthMaterial as MeshDepthMaterial | undefined;
      const material = own ? this.ownTwinOf(own, m.material, renderer.shadowMap.type) : this.depthTwinOf(m.material, renderer.shadowMap.type);
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
      return Promise.all([renderer.compileAsync(depth, camera, scene), renderer.compileAsync(depth, camera, (this.lightless ??= new Scene()))]);
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
   * (every kind shares one program), the light halos, the light shafts and
   * the surfaces' material (a first surface drawn). The first lava
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
      setWaterSky(material, e.skyDome.uniforms, e.sun.intensity, e.darkness);
      const mesh = new Mesh(geometry, material) as Mesh<BufferGeometry, ShaderMaterial>;
      mesh.receiveShadow = true;
      if (kind === 'lava' && this.mapEffects.lavaGlow) setHeatHaze(mesh, this.sceneCopy);
      out.push(mesh);
    }
    const particles = new ParticleField('smoke', [{ kind: 'smoke', origin: new Vector3(), radius: 1, height: 1, count: 1, color: undefined, scale: 1 }], { value: 0 }, { value: 1 });
    out.push(particles.mesh, glowStandIn(), shaftStandIn());
    // The surfaces' material: the first surface drawn in the editor links no program in its frame
    const surface = new Mesh(geometry, this.terrain.surfaces.material);
    surface.receiveShadow = true;
    out.push(surface);
    for (const m of out) m.frustumCulled = false;
    this.effectMeshes = out;
    return out;
  }

  /**
   * A copy of a mesh's own depth material as the shadow pass sets it for
   * `material` (same program key: the pass finds the program built), one
   * per pair, kept with the twins
   */
  private ownTwinOf(own: MeshDepthMaterial, material: Material, type: ShadowMapType): MeshDepthMaterial {
    const key = `${own.uuid}|${material.uuid}`;
    let twin = this.depthTwins.get(key);
    if (!twin) {
      twin = own.clone();
      twin.onBeforeCompile = own.onBeforeCompile;
      twin.customProgramCacheKey = own.customProgramCacheKey;
      this.depthTwins.set(key, twin);
    }
    return asShadowPass(twin, material, type);
  }

  /** The depth material three's shadow pass would draw `material` with (WebGLShadowMap getDepthMaterial) */
  private depthTwinOf(material: Material, type: ShadowMapType): MeshDepthMaterial {
    let twin = this.depthTwins.get(material.uuid);
    if (!twin) {
      twin = new MeshDepthMaterial();
      this.depthTwins.set(material.uuid, twin);
    }
    return asShadowPass(twin, material, type);
  }

  /**
   * What the water's mirror draws (WaterReflection's keep), without the
   * lights: three's compile counts an object's own lights on top of its
   * scene's, which gave programs with two suns
   */
  private mirroredParts(): Object3D[] {
    return [this.group, this.losBlockers, this.environment.skyDome.mesh, this.environment.weather.mesh, this.environment.lightning.mesh];
  }

  /**
   * Runs `run` with everything the map hides until it is needed shown, and
   * hides it again: an instance of every asset at each level
   * (objects.showAllForWarmUp), the terrain's other levels and what waits for
   * its moment (weather particles, beams and glows by night, fireflies). A
   * warm-up frame drawn inside gives each its first draw, which the GPU
   * process otherwise translated in the frame of a first rain (185 ms in the
   * editor) or night
   */
  /**
   * The map's own roots: its group, and the line of sight's blockers once
   * attach lifted them beside it (the ruins a raised building warms up wait
   * hidden there)
   */
  private roots(): Object3D[] {
    return this.losBlockers.parent === this.group ? [this.group] : [this.group, this.losBlockers];
  }

  withAllShown<T>(run: () => T): T {
    this.objects.showAllForWarmUp(true);
    const shown: Object3D[] = [];
    const reveal = (root: Object3D) =>
      root.traverse((o) => {
        // The object layer's meshes as showAllForWarmUp chose them; nothing that holds a light (the shadow build's stage)
        if (o.visible || o.userData['batch'] || o.getObjectByProperty('isLight', true)) return;
        o.visible = true;
        shown.push(o);
      });
    for (const root of this.roots()) reveal(root);
    reveal(this.environment.lights);
    try {
      return run();
    } finally {
      for (const o of shown) o.visible = false;
      this.objects.showAllForWarmUp(false);
    }
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
    if (this.flyingDebris) this.flyingDebris.time += dtSeconds;
    if (this.options.ruins) {
      DAMAGE_UNIFORMS.uDamageTime.value = this.damageTime += dtSeconds;
      for (let k = this.landing.length - 1; k >= 0; k--) {
        const due = this.landing[k];
        if (due.at > this.damageTime) continue;
        this.landing.splice(k, 1);
        this.onImpact?.(due.id, due.hit);
      }
    }
    this.updateFrame(dtSeconds, camera, focus);
    const ms = performance.now() - t0;
    this.stats.updateMs = this.stats.frames ? this.stats.updateMs * 0.95 + ms * 0.05 : ms;
    this.stats.frames++;
  }

  /** The clock the buildings fall on, s (DAMAGE_UNIFORMS) */
  private damageTime = 0;

  /**
   * Damage of buildings, walls and structures (MapObjectLayer.setDamage):
   * a stage-3 one `now` falls from this moment, else it lies as it fell;
   * each gives way to the `heading` of the hit that brought its stage
   * (STRUCTURE_HEADING_STEPS in map space, -1 none: its id rolls one)
   */
  setObjectDamage(changes: readonly { id: string; stage: number; heading?: number; now: boolean }[]): void {
    this.whenRuinsReady(changes.some((c) => c.stage > 0), () => this.applyDamage(changes));
  }

  private applyDamage(changes: readonly { id: string; stage: number; heading?: number; now: boolean }[]): void {
    this.objects.setDamage(changes.map((c): ObjectDamage => ({
      id: c.id,
      stage: c.stage,
      fallStart: c.now && c.stage >= 3 ? this.damageTime : FELL_LONG_AGO,
      heading: sceneHeading(c.heading ?? -1),
    })));
    this.embersKey = null;
    this.refreshEmbers();
    // A fall just now comes down a moment later, on the clock it falls by (update hands it to onImpact)
    for (const c of changes) {
      if (!c.now || c.stage < 3) continue;
      const hit = this.impactOf(c.id);
      if (hit) this.landing.push({ id: c.id, at: this.damageTime + hit.delay, hit });
    }
  }

  /**
   * Object `id`'s holes as the simulation keeps them (HOLE_SLOTS of
   * HOLE_STRIDE whole numbers): `now` when a hit made or grew one just now
   * (it opens from this moment), else they stand as they are
   */
  setObjectHoles(id: string, holes: Int32Array, now: boolean): void {
    const copy = holes.slice();
    this.whenRuinsReady(false, () => this.applyHoles(id, copy, now));
  }

  private applyHoles(id: string, holes: Int32Array, now: boolean): void {
    const was = this.holes.get(id) ?? null;
    this.holes.set(id, holes.slice());
    this.objects.setHoles(id, holes, now ? was : holes, now ? this.damageTime : FELL_LONG_AGO);
  }

  /** The holes as last set, per object: what a new hole is told from */
  private readonly holes = new Map<string, Int32Array>();

  /** Falls on their way down: when each comes down (damageTime) and where */
  private readonly landing: { id: string; at: number; hit: FallImpactAt }[] = [];

  /** Hears each fall coming down, on the view's clock (its dust; CustomMapDestruction.onImpact) */
  onImpact: ((id: string, hit: FallImpactAt) => void) | null = null;

  /**
   * Where and when object `id` comes down as it falls now (map metres,
   * the ground's height, the length it lands along `dx`, `dy`, the seconds
   * after its fall began), null where it is no ruin here
   */
  impactOf(id: string): FallImpactAt | null {
    const hit = this.objects.impactOf(id);
    if (!hit) return null;
    const p = sceneToMap({ x: hit.x, z: hit.z }, { x: 0, y: 0 });
    return { x: p.x, y: p.y, height: hit.y, length: hit.length, dx: -hit.dx, dy: hit.dz, delay: hit.delay };
  }

  /** Where the first warm-up compiled (warmUp): what the ruins' programs are built for later */
  private warmContext: { renderer: WebGLRenderer; scene: Object3D; camera: Camera } | null = null;
  /** The ruins' stand-ins taken out of the scene until their programs are built, with where each hung */
  private parked: { mesh: Object3D; parent: Object3D }[] | null = null;

  /** The ruins no building is in yet out of the scene (objects.ruinStandIns): a compile of the scene leaves them */
  private parkRuins(): void {
    if (!this.options.ruins || this.parked) return;
    this.parked = [];
    for (const mesh of this.objects.ruinStandIns()) {
      if (!mesh.parent) continue;
      this.parked.push({ mesh, parent: mesh.parent });
      mesh.removeFromParent();
    }
  }

  /** The ruins' stand-ins back where they hung; what waits for them goes on */
  private unparkRuins(): void {
    const parked = this.parked;
    if (!parked) return;
    this.parked = null;
    for (const { mesh, parent } of parked) if (!mesh.parent) parent.add(mesh);
    this.ruinsBack.resolve();
  }

  /** Resolved once the ruins' stand-ins are back (unparkRuins) */
  private readonly ruinsBack = settles();
  /** Resolved when a building is hit before that: the engine builds the ruins' programs by frames from then on */
  private readonly ruinsHurry = settles();
  /** Whether the engine took the ruins' programs over (warmLater) */
  private ruinsClaimed = false;

  /**
   * The ruins' programs, left out of the first warm-up, for the engine to
   * build once the game stands (WorldProvider.warmLater): the stand-ins
   * (compiled in quiet moments, by frames once `hurry` resolves), their
   * shadow twins, and putting them back when done. Null when nothing waits
   */
  warmLater(): { objects: Object3D[]; shadows: () => Promise<unknown>; done: () => void; hurry: Promise<void> } | null {
    const parked = this.parked;
    const at = this.warmContext;
    if (!parked?.length || !at || this.ruinsClaimed) return null;
    this.ruinsClaimed = true;
    const meshes = parked.map((p) => p.mesh);
    return {
      objects: meshes,
      shadows: () => this.ruinShadows(meshes),
      done: () => this.unparkRuins(),
      hurry: this.ruinsHurry.promise,
    };
  }

  /** The shadow pass's programs of the ruins' stand-ins (compileShadowTwins), with the first warm-up's renderer */
  private ruinShadows(meshes: readonly Object3D[]): Promise<unknown> {
    const at = this.warmContext;
    if (!at || !(at.scene instanceof Scene) || !at.renderer.shadowMap.enabled) return Promise.resolve();
    return this.compileShadowTwins(at.renderer, at.scene, at.camera, meshes.filter((m): m is Mesh => m instanceof Mesh));
  }

  /** Damage and holes that wait for the ruins' programs, in order; null while nothing waits */
  private damageWaits: (() => void)[] | null = null;

  /**
   * `apply` now, or after what waits for the ruins' programs. With `ruin`
   * (a building hit) before those are built, the engine hurries them
   * (warmLater) and the damage waits for them, under a second: a ruin
   * drawn with programs compiled for it outside the frame's state, or still
   * linking, held its frame for a third of a second and more. Without the
   * engine (nothing took them) the stand-ins go back at once
   */
  private whenRuinsReady(ruin: boolean, apply: () => void): void {
    if (this.damageWaits) {
      this.damageWaits.push(apply);
      return;
    }
    if (!ruin || !this.parked) {
      apply();
      return;
    }
    if (!this.ruinsClaimed) {
      this.unparkRuins();
      apply();
      return;
    }
    this.damageWaits = [apply];
    this.ruinsHurry.resolve();
    void this.ruinsBack.promise.then(() => {
      const waits = this.damageWaits ?? [];
      this.damageWaits = null;
      if (this.disposed) return;
      for (const run of waits) run();
    });
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
    this.terrain.updateGroundColor(dtSeconds, this.options.renderer);
    // The decals round the focus (map metres: scene x is map -x)
    this.decals.update(-this.focusPoint.x, this.focusPoint.z);
    const reach = this.camPos.distanceTo(this.focusPoint);
    this.armReflection(camera, dtSeconds);
    // Shadow box fitted to the ground the camera sees: sharp up close, wide from high up or looking far
    const fit = fitShadowBox(camera, this.group, this.focusPoint, this.shadowCenter);
    // The box's radius in its steps (shrinking only well below it), for the casters round its centre too:
    // following the view every frame, objects at its edge switched casting on and off and the shadow map
    // rendered again each frame (shimmer)
    const shadowRadius = this.environment.focus(this.group.localToWorld(this.worldShadowCenter.copy(this.shadowCenter)), fit);
    this.effects.update(clock, this.focusPoint);
    this.movers.update(clock);
    this.objects.shadowRadius = shadowRadius * 1.2;
    this.objects.update(dtSeconds, camera, this.shadowCenter);
    this.edgeTrees.shadowRadius = this.objects.shadowRadius;
    this.edgeTrees.update(dtSeconds, camera, this.shadowCenter);
    IMPOSTOR_SUN.uImpSun.value.copy(this.environment.sunDir);
    // Grass from the camera's foot towards the focus (a low camera looking far, a tower's view, keeps
    // blades at its feet), a far ring beyond; each thins out as the camera draws away from its focus
    const camHeight = this.camPos.y - this.heights.heightAt(-this.camPos.x, this.camPos.z);
    this.terrain.grass.update(this.camPos, this.focusPoint, camHeight, reach);
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

  /**
   * Samples where the fight tore the ground up (custom-map-ground-damage.ts),
   * kept by reference and read with the next cover: no grass grows there
   */
  setGroundBare(bare: Uint8Array | null): void {
    // Its samples change with the heights of their rectangle (CustomMapGroundDamage.flush, updateHeights);
    // a first one is bare nowhere else yet, only another one in its place can change the rest
    const had = this.groundBare;
    this.groundBare = bare;
    if (had && bare !== had) this.markCover();
  }

  /**
   * A structure at map (`x`, `y`) falls: pieces of `colour` (linear RGB) thrown
   * up and out of its body, `count` of them, rolled from `seed`
   */
  throwDebris(x: number, y: number, radius: number, height: number, colour: readonly [number, number, number], count: number, seed: number): void {
    this.flyingDebris?.burst(-x, this.heightAt(x, y), y, radius, height, colour, count, seed);
  }

  /** The fight's marks on the ground as they stand now (with options.impactMarks) */
  setImpactMarks(marks: Iterable<ImpactMark>): void {
    const list = [...marks];
    this.impactMarks?.set(list);
    this.rubblePieces?.set(list);
  }

  /** Heights changed inside `rect` (map metres); whole map when omitted. Objects and water follow. */
  updateHeights(rect?: MapRect): void {
    const apron = this.terrain.rebuild(rect ? this.gridRect(rect) : undefined);
    this.objects.refreshHeights(rect);
    // Ruins that sank with a crater smoulder where they lie now
    this.refreshEmbers();
    if (this.signs.count) void this.refreshSigns();
    // The openings sit where their objects sit
    if (this.cutObjects.length) this.refreshCuts();
    this.markCover(rect && this.gridRect(rect));
    // Water and bridges only when the change reaches them: a brush on a big map must stay cheap
    if (!rect) this.updateWater();
    else this.refreshWaterNear(rect, apron);
    if (!rect || this.bridgeNear(rect)) void this.refreshBridges();
    // The apron beyond the border follows its heights, the mirrored trees the apron
    if (!rect || this.nearBorder(rect)) this.edgeTreesLater(this.shownObjects());
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
    else if (!this.disposed) this.farShadowFirst = this.terrain.bakeFarShadow(this.environment.sunDir);
  }

  private async refreshBridges(): Promise<void> {
    await this.bridges.set(this.doc.paths, this.doc.terrain);
    this.environment.invalidateShadows();
  }

  /**
   * Heights changed in `rect`: only the water bodies whose mask reaches it
   * rebuild their surface (which cells it covers, its depth per vertex),
   * the main water's part beyond the border only when the apron changed with
   * them (`apron`: the border's heights; MapTerrainLayer.rebuild made it
   * anew). The wet banks follow the mask, not the heights: they stay. Rivers
   * keep theirs: a ribbon follows its line, the depth comes from the height
   * texture per pixel.
   */
  private refreshWaterNear(rect: MapRect, apron: boolean): void {
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
    let lava = false;
    [t.water, ...(t.waterBodies ?? [])].forEach((body, k) => {
      const surface = this.waters[k];
      if (!body || !surface || !near(body.mask)) return;
      // Only the tiles the change reaches; the part beyond the border on the apron as it is now
      surface.set(body, k === 0 && apron ? this.terrain.apronProfile : null, g);
      lava ||= body.kind === 'lava';
      this.markCover(g);
    });
    if (lava) this.refreshLava(true);
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
    // The terrain just made built its wet banks and apron from this water: the first time they stand
    if (this.watersPlaced) this.terrain.refreshWater();
    this.watersPlaced = true;
    // Rain stops and grass ends at the new surfaces, the mirrored trees beyond the border at the sea
    this.markCover();
    this.edgeTreesLater(this.shownObjects());
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
        const created = new WaterSurface(this.heights, this.terrain.heightTexture, body, apron, k === 0);
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
    this.markCover();
    if (border) this.edgeTreesLater(this.shownObjects());
    if (wasLava || water.kind === 'lava') this.refreshLavaLights(true);
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
    this.markCover();
    if (wasLava || water.kind === 'lava') this.refreshLava(rect !== undefined);
    this.objects.refreshHeights(rect, true);
    if (!rect || this.bridgeNear(rect)) void this.refreshBridges();
    this.lightWater();
  }

  /**
   * The document's objects were replaced (or the filter changed): all of
   * them shown anew; resolves when their models are in
   */
  setObjects(): Promise<void> {
    this.refreshHangingMovers();
    return Promise.all([this.objects.setObjects(this.takeShown()), this.refreshEffects(), this.refreshSigns(), this.refreshContact(), this.refreshEdgeTrees()]).then(
      () => undefined,
    );
  }

  /** Shows only the objects `visible` accepts (null: all); builds the objects anew */
  setVisible(visible: ((o: MapObject) => boolean) | null): Promise<void> {
    this.visible = visible;
    return this.setObjects();
  }

  /**
   * Objects of the document added, removed or changed, by id (a change in
   * place too): new ones go in and gone ones out cell by cell (only their
   * 192 m object cells are rebuilt), the others move in place; one the
   * filter now hides goes out, one it shows again comes in. Resolves when
   * the new ones show.
   */
  objectsChanged(ids: readonly string[]): Promise<void> {
    if (!ids.length) return Promise.resolve();
    // One pass over the map's objects for the few that changed, no map over all of them
    const wanted = new Set(ids);
    const now = new Map<string, MapObject>();
    for (const o of this.doc.objects) if (wanted.has(o.id)) now.set(o.id, o);
    const added: MapObject[] = [];
    const removed: MapObject[] = [];
    const moved: MapObject[] = [];
    const was: MapObject[] = [];
    for (const id of wanted) {
      const o = now.get(id);
      const show = !!o && this.shows(o);
      const had = this.shown.get(id);
      if (show && !had) {
        added.push(o!);
        this.shown.set(id, o!);
      } else if (!show && had) {
        removed.push(had);
        this.shown.delete(id);
      } else if (show && had) {
        moved.push(o!);
        was.push(had);
        this.shown.set(id, o!);
      }
    }
    this.shownList = null;
    // A cable placed, moved or taken away: the gondolas riding it follow
    const cables = this.entries?.map;
    if (!cables || [...added, ...removed, ...moved, ...was].some((o) => cables.get(o.asset)?.cable)) this.refreshHangingMovers();
    this.moveObjects(moved, was);
    this.removeObjects(removed);
    return this.addObjects(added);
  }

  /** The objects the view shows: the document's, less the hidden ones */
  private shownObjects(): MapObject[] {
    if (!this.visible && !this.gone.size) return this.doc.objects;
    return (this.shownList ??= this.doc.objects.filter((o) => this.shows(o)));
  }

  /** Whether object `o` shows: the filter (setVisible) lets it and no crater wiped it out (setGone) */
  private shows(o: MapObject): boolean {
    return (!this.visible || this.visible(o)) && !this.gone.has(o.id);
  }

  /**
   * Objects a crater wiped out (crater-obliteration.ts) leave the view, those
   * it gives back come in again: no model, sight blocker, floor or embers of
   * what is gone
   */
  setGone(gone: readonly string[], back: readonly string[]): void {
    if (!gone.length && !back.length) return;
    for (const id of gone) this.gone.add(id);
    for (const id of back) this.gone.delete(id);
    this.shownList = null;
    void this.objectsChanged([...gone, ...back]);
    this.refreshEmbers();
  }

  /** The ruins' smouldering nests where the ruins lie now, set anew only when one moved, came or went */
  private refreshEmbers(): void {
    if (!this.options.ruins) return;
    const points = this.objects.embers();
    const key = points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`).join(';');
    if (key === this.embersKey) return;
    this.embersKey = key;
    this.effects.setRuinEmbers(points, true);
  }

  /** The objects to show from now, noted as shown */
  private takeShown(): MapObject[] {
    this.shownList = null;
    const list = this.shownObjects();
    this.shown = new Map(list.map((o) => [o.id, o]));
    return list;
  }

  /**
   * Objects coming into the view: only the object cells (192 m) they land
   * in are rebuilt, and the contact shadows around them. Resolves when they
   * show.
   */
  private async addObjects(objects: MapObject[]): Promise<void> {
    if (!objects.length) return;
    const shown = this.objects.addObjects(objects);
    this.contactPaced.request(objects);
    this.edgeTreesLater(objects);
    if (await this.hasEffects(objects)) this.effectsPaced.request();
    if (hasSigns(objects)) this.signsPaced.request();
    await shown;
  }

  /** Objects leaving the view (the objects, not only their ids: their spots clear) */
  private removeObjects(objects: MapObject[]): void {
    if (!objects.length) return;
    this.objects.removeObjects(objects.map((o) => o.id));
    this.contactPaced.request(objects);
    this.edgeTreesLater(objects);
    void this.hasEffects(objects).then((has) => has && this.effectsPaced.request());
    if (hasSigns(objects)) this.signsPaced.request();
  }

  /**
   * Objects moved, turned, scaled or changed asset, `before` their last
   * states: in place where they can, else out of their cells and into the
   * new ones; effects and contact shadows once for all of them, the shadows
   * only around the old and new spots.
   */
  private moveObjects(objects: readonly MapObject[], before: readonly MapObject[]): void {
    if (!objects.length) return;
    this.decalsMoved();
    const rest = this.objects.updateObjects(objects);
    if (rest.length) {
      this.objects.removeObjects(rest.map((o) => o.id));
      void this.objects.addObjects(rest);
    }
    const all = [...before, ...objects];
    void this.hasEffects(all).then((has) => has && this.effectsPaced.request());
    this.contactPaced.request(all);
    if (hasSigns(all)) this.signsPaced.request();
    this.edgeTreesLater(all);
  }

  /**
   * Builds the programs of new ground materials before they draw (MapTerrainLayer.prepare): the editor's, off
   * the main thread for each picture it draws. Without one a new layer count links them in the next frame
   */
  set terrainPrepare(fn: ((meshes: Mesh[]) => Promise<unknown>) | null) {
    this.terrain.prepare = fn;
  }

  /**
   * Settles once the programs of assets new to the map are built (MapObjectLayer.prepareAssets): the editor's
   * warm-up. Without one an asset's first objects link them in the frame they first draw
   */
  set objectsPrepare(fn: ((assetIds: string[]) => Promise<unknown>) | null) {
    this.objects.prepareAssets = fn;
  }

  /**
   * Compiles `object`'s programs, off the main thread where the driver allows, for the water's mirror (a
   * linear target without tone mapping, other programs than the screen's); null when no mirror draws
   */
  compileForMirror(renderer: WebGLRenderer, object: Object3D, camera: Camera, scene: Scene): Promise<unknown> | null {
    if (!this.mapEffects.reflection || !this.waters.some((w) => w)) return null;
    this.mirrorProbe ??= new WebGLRenderTarget(1, 1);
    const previous = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(this.mirrorProbe);
      return renderer.compileAsync(object, camera, scene);
    } finally {
      renderer.setRenderTarget(previous);
    }
  }

  /** Stands in for the mirror's target when compiling for it (compileForMirror) */
  private mirrorProbe: WebGLRenderTarget | null = null;

  /** The roads and bridges follow the paths; the path mask follows from the editor's worker (setPathMask) */
  updatePaths(): void {
    this.terrain.refreshPaths(this.doc.paths);
    void this.refreshBridges();
  }

  /** The surfaces changed: they lay what changed (the path mask follows from the editor's worker, setPathMask) */
  setSurfaces(): void {
    this.terrain.surfaces.set(this.doc.surfaces ?? []);
  }

  /** Hears when the path mask was painted from the map as it is now (the editor's worker keeps it from there) */
  set pathMaskBuilt(fn: (() => void) | null) {
    this.terrain.pathMaskBuilt = fn;
  }

  /** Where the paved road surface hides the ground, as laid now (the path mask's covers) */
  roadCovers(): RoadCover[] {
    return this.terrain.roads.covers();
  }

  /** Texels of the path mask painted elsewhere (MapTerrainLayer.setPathMask); false when they are of another mask */
  setPathMask(m: { width: number; depth: number; resolution: number; rect: TexelRect; data: Uint8Array }): boolean {
    return this.terrain.setPathMask(m.width, m.depth, m.resolution, m.rect, m.data);
  }

  /** Shows `env` (the owner keeps its document's environment) */
  setEnvironment(env: MapEnvironment): void {
    const docBiome = this.env.biome;
    const biome = this.environment.biome;
    this.env = env;
    const sun = this.environment.sunDir.clone();
    this.environment.set(env);
    this.terrain.setBiome(env.biome ?? 'temperate');
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
    this.refreshLavaLights();
    void this.refreshMovers();
    this.waveBanners();
    this.refreshHaze();
  }

  /** Heat shimmer over the life areas of hot ground, on levels that show them and with the lava glow effect on */
  private refreshHaze(): void {
    const shown = (this.doc.life?.areas ?? []).filter((a) => a.kind === 'haze' && areaShown(a, this.lifeShare));
    this.haze.set(shown, this.mapEffects.lavaGlow && lifeSwitches(this.doc.life).density > 0 ? this.sceneCopy : null);
  }

  /** The life areas' boats and movers, on levels that show them; hanging movers ride the ropes of the cables placed */
  private async refreshMovers(): Promise<void> {
    const shown = (this.doc.life?.areas ?? []).filter((a) => (a.kind === 'boats' || a.kind === 'movers') && areaShown(a, this.lifeShare));
    let ropes: ReturnType<typeof cableRopes> = [];
    if (shown.some(hangs)) {
      const entries = this.catalogEntries(await this.assets.catalog());
      if (this.disposed) return;
      ropes = cableRopes(this.doc.objects, (asset) => entries.get(asset), (x, y) => this.heights.heightAt(x, y));
    }
    return this.movers.set(shown, lifeSwitches(this.doc.life).density, ropes);
  }

  /** Movers hanging from a line follow the cables: after objects change that may be some */
  private refreshHangingMovers(): void {
    if ((this.doc.life?.areas ?? []).some((a) => hangs(a) && areaShown(a, this.lifeShare))) void this.refreshMovers();
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
  /** The lava changed (`edit`: a brush or a crater in a rectangle, whose lights follow once edits pause) */
  private refreshLava(edit = false): void {
    this.refreshLavaLights(edit);
    this.refreshAmbientSoon();
    // The ground's closeness to lava: right away the first time, edits once they pause for a quarter second
    if (this.lavaDue) clearTimeout(this.lavaDue);
    this.lavaDue = null;
    if (this.lavaBaked) this.lavaDue = setTimeout(() => this.bakeLava(), 250);
    else this.bakeLava();
  }

  /**
   * The lava's lights, embers, smoke and sparks (effects.setLavaLights) from
   * where it lies now; after an edit once edits pause for a quarter second, as
   * the ground's closeness to it: rebuilt for every step of a pool brush they
   * took 2 to 5 ms of each (257² map, perf spec)
   */
  private refreshLavaLights(edit = false): void {
    if (this.lavaLightsDue) clearTimeout(this.lavaLightsDue);
    this.lavaLightsDue = null;
    const lights = (): void => {
      this.lavaLightsDue = null;
      if (!this.disposed) this.effects.setLavaLights(this.lavaLightPoints());
    };
    if (edit) this.lavaLightsDue = setTimeout(lights, 250);
    else lights();
  }

  private bakeLava(): void {
    this.lavaDue = null;
    if (this.disposed) return;
    this.lavaBaked = true;
    const baker = this.terrain.occlusion.baker;
    if (baker) {
      // The closeness (a chamfer distance over the whole grid) from the worker
      const done = baker.lava().then((lava) => {
        if (!lava || this.disposed || this.terrain.occlusion.baker !== baker) return;
        this.terrain.occlusion.setLavaCloseness(lava.closeness);
        this.lavaGlow(lava.any);
      });
      this.lavaFirst = done;
      return;
    }
    const lava = lavaSamples(this.doc.terrain, this.heights);
    this.terrain.occlusion.setLava(lava);
    this.lavaGlow(lava.includes(1));
  }

  /** Objects near lava glow from below by the ground's closeness to it (height-fog.ts) */
  private lavaGlow(any: boolean): void {
    const t = this.doc.terrain;
    const f = this.heights;
    const g = LAVA_GLOW_UNIFORMS;
    g.uLavaGlowOn.value = any ? 1 : 0;
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
    const biome = this.env.biome ?? 'temperate';
    const trees = new Set(catalog.objects.filter((o) => o.category === 'tree').map((o) => o.id));
    const woods = new Map<number, { x: number; y: number; n: number }>();
    const t = this.doc.terrain;
    const bin = (x: number, y: number) => Math.floor((y + t.depth / 2) / WOOD_CELL) * 4096 + Math.floor((x + t.width / 2) / WOOD_CELL);
    for (const o of this.shownObjects()) {
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

  /** The cover changed in a sample rectangle (all of it when omitted): rebuilt with a later frame */
  private markCover(rect?: GridRect): void {
    const was = this.coverRect;
    if (!rect) this.coverRect = null;
    else if (!this.coverDirty) this.coverRect = { ...rect };
    else if (was) this.coverRect = { i0: Math.min(was.i0, rect.i0), j0: Math.min(was.j0, rect.j0), i1: Math.max(was.i1, rect.i1), j1: Math.max(was.j1, rect.j1) };
    this.coverDirty = true;
  }

  private async refreshCover(): Promise<void> {
    const rect = this.coverRect;
    this.coverDirty = false;
    this.coverRect = null;
    this.coverAge = 0;
    const catalog = await this.assets.catalog();
    if (this.disposed) return;
    this.cover.set(this.shownObjects(), this.catalogEntries(catalog), this.doc.terrain, this.groundBare, rect ?? undefined);
  }

  /** Contact shadows of the objects in the baked ground occlusion */
  /** Contact shadows of the objects; with `changed` only around those */
  /** Lays the ground decals for the objects and paths now in the document */
  private async refreshDecals(): Promise<void> {
    this.decalsDue = null;
    const catalog = await this.assets.catalog();
    if (this.disposed) return;
    const objects = this.shownObjects();
    this.decalsFor = { objects, count: objects.length, paths: this.doc.paths, edges: this.doc.paths.edges.length };
    this.decals.set({ objects, paths: this.doc.paths, environment: this.env }, new Map(catalog.objects.map((o) => [o.id, o])));
  }

  /**
   * Objects moved in place (a gizmo drag changes `doc.objects` without a new
   * list): the decals under them follow once the moves pause
   */
  private decalsMoved(): void {
    if (this.decalsFor.count < 0) return;
    if (this.decalsDue) clearTimeout(this.decalsDue);
    this.decalsDue = null;
    this.decalsFor.objects = null;
  }

  /** Objects or paths added, removed or moved (the editor): the decals follow once the changes pause */
  private watchDecals(): void {
    const f = this.decalsFor;
    if (f.count < 0 || this.decalsDue) return;
    const objects = this.shownObjects();
    const paths = this.doc.paths;
    if (f.objects === objects && f.count === objects.length && f.paths === paths && f.edges === paths.edges.length) return;
    this.decalsDue = setTimeout(() => void this.refreshDecals(), 400);
  }

  private async refreshContact(changed?: MapObject[]): Promise<void> {
    this.markCover();
    const catalog = await this.assets.catalog();
    if (this.disposed) return;
    const entries = this.catalogEntries(catalog);
    let rect: MapRect | undefined;
    if (changed) {
      for (const o of changed) {
        const r = (o.mass ? massRadius(o.mass) + 4 : (entries.get(o.asset)?.footprint ?? 1) * 1.5) * (o.scale || 1) + 1;
        rect = rect
          ? { minX: Math.min(rect.minX, o.x - r), minY: Math.min(rect.minY, o.y - r), maxX: Math.max(rect.maxX, o.x + r), maxY: Math.max(rect.maxY, o.y + r) }
          : { minX: o.x - r, minY: o.y - r, maxX: o.x + r, maxY: o.y + r };
      }
    }
    const objects = this.shownObjects();
    this.terrain.occlusion.setObjects(objects, entries, rect ? this.gridRect(rect) : undefined);
    this.cutObjects = objects.filter((o) => entries.get(o.asset)?.groundCut);
    this.refreshCuts();
  }

  /** The placed objects with an opening into the ground (catalogue `groundCut`), as of the last refreshContact */
  private cutObjects: MapObject[] = [];

  /** The terrain cut away inside the openings of `cutObjects`, at their seats now */
  private refreshCuts(): void {
    const entries = this.entries?.map;
    if (!entries) return;
    const cuts = groundCuts(this.cutObjects, entries, (x, y) => this.heights.heightAt(x, y), (x, y) => this.waterLevelAt(x, y));
    if (cuts.length || this.terrain.cuts.size) this.terrain.cuts.set(cuts);
  }

  private entries: { catalog: AssetCatalog; map: Map<string, CatalogObject> } | null = null;

  /**
   * Contact shadows, effects and signs of objects added, moved or taken away: at once
   * after a rest, then at most every EDIT_REFRESH_MS while the changes go on (a
   * drag of thousands rebuilt every fire and lamp and the shadows round all of
   * them each frame), and once after the last
   */
  private readonly contactPaced = new PacedRefresh<MapObject>(EDIT_REFRESH_MS, (changed) => {
    if (!changed || changed.length) void this.refreshContact(changed ?? undefined);
  });
  private readonly effectsPaced = new PacedRefresh<never>(EDIT_REFRESH_MS, () => void this.refreshEffects());
  private readonly signsPaced = new PacedRefresh<never>(EDIT_REFRESH_MS, () => void this.refreshSigns());

  /** The catalogue's objects by id, made once per catalogue */
  private catalogEntries(catalog: AssetCatalog): Map<string, CatalogObject> {
    if (this.entries?.catalog !== catalog) this.entries = { catalog, map: new Map(catalog.objects.map((o) => [o.id, o])) };
    return this.entries.map;
  }

  /** Whether any of the objects has effects or a light */
  /** Writes the shown objects' signs anew, once the catalogue and the game's font are in */
  private async refreshSigns(): Promise<void> {
    const [catalog] = await Promise.all([this.assets.catalog(), fontsReady()]);
    if (this.disposed) return;
    this.signs.set(this.shownObjects(), catalog, (x, y) => this.heights.heightAt(x, y), (x, y) => this.waterLevelAt(x, y));
  }

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
    this.setEffects(effectsOfQuality(q));
    this.objects.setDetail({ lodBias: q.lodBias, impostorFrom: q.impostorFrom });
    this.edgeTrees.setDetail({ lodBias: q.lodBias, impostorFrom: q.impostorFrom });
    this.terrain.grass.setQuality(q.grassBlades, q.grassDistance, q.grassFarBlades, q.grassFarDistance);
    this.environment.weather.setShare(q.particles);
    this.environment.lightning.setDetail(q.particles);
    this.environment.lightning.setFlashShare(q.lightningFlash);
    const lifeChanged = q.life !== this.lifeShare;
    this.lifeShare = q.life;
    if (this.effects.setQuality({ particles: q.particles, pointLights: q.pointLights, life: q.life })) {
      void this.refreshEffects();
      this.refreshLavaLights();
    }
    if (lifeChanged) {
      void this.refreshMovers();
      this.waveBanners();
      this.refreshHaze();
    }
  }

  /**
   * Runs `run` with the materials as level `q` builds them, the level drawn
   * now put back after: the water's effects (defines of its shader; the
   * engine makes a frame at that level ready ahead,
   * WorldProvider.withQuality). Nothing is built or loaded: what else a level
   * changes (grass, detail, particles, the lamps' lights) keeps its programs
   */
  withQuality(q: CustomMapQuality, run: () => void): void {
    const effects = this.mapEffects;
    this.mapEffects = { ...effects, ...effectsOfQuality(q) };
    this.applyEffects();
    try {
      run();
    } finally {
      this.mapEffects = effects;
      this.applyEffects();
    }
  }

  /** The border's trees mirrored onto the apron (edge-trees.ts), from the objects shown */
  private async refreshEdgeTrees(): Promise<void> {
    const catalog = await this.assets.catalog();
    if (this.disposed) return;
    const trees = new Set(catalog.objects.filter((e) => e.category === 'tree').map((e) => e.id));
    const t = this.doc.terrain;
    // None in the sea beyond a coast: from above they stood in the water as dark cones with their shadows
    const apron = this.terrain.apronProfile;
    await this.edgeTrees.setObjects(edgeTreeObjects(this.shownObjects(), (a) => trees.has(a), t.width, t.depth, (x, y) => !apron.underWater(x, y, 0.3)));
  }

  /** Again once an edit pauses, when it touched the border's band */
  private edgeTreesLater(objects: readonly MapObject[]): void {
    const t = this.doc.terrain;
    const near = (o: MapObject) => Math.abs(o.x) > t.width / 2 - EDGE_TREE_BAND || Math.abs(o.y) > t.depth / 2 - EDGE_TREE_BAND;
    if (!objects.some(near)) return;
    if (this.edgeTreesDue) clearTimeout(this.edgeTreesDue);
    this.contactPaced.cancel();
    this.effectsPaced.cancel();
    this.signsPaced.cancel();
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
    this.effects.set(this.shownObjects(), catalog);
    this.effects.setDarkness(this.environment.darkness);
    NIGHT_WINDOW_UNIFORMS.uNightWindows.value = this.environment.darkness;
  }

  private lightWater(): void {
    const e = this.environment;
    for (const w of this.waters) w?.setSky(e.skyDome.uniforms, e.sun.intensity, e.darkness);
    for (const r of this.rivers) r.setSky(e.skyDome.uniforms, e.sun.intensity, e.darkness);
    this.applyEffects();
  }

  /**
   * The reflection for this frame: the level of the reflective bodies the
   * camera sees most of, faded in and out (mirror-choice.ts)
   */
  private armReflection(camera: Camera, dt: number): void {
    if (!this.mapEffects.reflection || this.reflection.scale <= 0) {
      this.reflection.arm(null, 0, null);
      for (const w of this.waters) w?.setMirrored(0);
      return;
    }
    const bodies = [this.doc.terrain.water, ...(this.doc.terrain.waterBodies ?? [])];
    const candidates: MirrorCandidate<WaterSurface>[] = [];
    bodies.forEach((body, k) => {
      const surface = this.waters[k];
      if (body && surface?.reflective) candidates.push({ owner: surface, level: body.level, meshes: surface.meshes() });
    });
    const pick = this.mirrorChoice.update(dt, camera, this.reflection.far, candidates);
    for (const w of this.waters) w?.setMirrored(pick?.owners.has(w) ? pick.weight : 0);
    const on = pick && pick.weight > 0 ? pick : null;
    this.reflection.arm(on ? camera : null, on ? this.group.localToWorld(this.mirrorLevel.set(0, on.level, 0)).y : 0, on?.owners ?? null);
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
    if (this.mapEffects.shadowCascade !== cascade) this.applyShadowCascade(true);
    this.refreshHaze();
  }

  /** The far shadow on or off; `spread` bakes it over frames (a switch in play: the whole bake held that frame 60 ms) */
  private applyShadowCascade(spread = false): void {
    if (!this.mapEffects.shadowCascade) this.terrain.farShadow.setArea(0, 0, 1, false);
    else if (!spread) this.refreshFarShadow(false);
    else if (!this.disposed) void this.terrain.bakeFarShadowSliced(this.environment.sunDir);
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
    // The library stays a while for the next view of its map (MapAssetLibrary.release)
    if (!this.disposed) this.assets.release();
    this.disposed = true;
    if (LAVA_GLOW_UNIFORMS.uLavaGlowTex.value === this.terrain.occlusion.texture) LAVA_GLOW_UNIFORMS.uLavaGlowOn.value = 0;
    this.terrain.dispose();
    for (const w of this.waters) w?.dispose();
    for (const r of this.rivers) r.dispose();
    this.options.lights?.removeSteadySource(this.effects);
    this.effects.dispose();
    this.signs.dispose();
    this.movers.dispose();
    this.haze.dispose();
    WIND_UNIFORMS.uClothWave.value = 0;
    this.cover.dispose();
    this.objects.dispose();
    this.edgeTrees.dispose();
    this.impostors?.dispose();
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
    this.mirrorProbe?.dispose();
    this.sceneCopy.dispose();
    this.reflection.dispose();
    if (this.lavaDue) clearTimeout(this.lavaDue);
    if (this.lavaLightsDue) clearTimeout(this.lavaLightsDue);
    this.ownBaker?.dispose();
    this.ownBaker = null;
    if (this.ambientDue) clearTimeout(this.ambientDue);
    if (this.farShadowDue) clearTimeout(this.farShadowDue);
    if (this.decalsDue) clearTimeout(this.decalsDue);
    this.decals.dispose();
    this.impactMarks?.dispose();
    this.rubblePieces?.dispose();
    this.flyingDebris?.dispose();
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
      this.objects.setObjects(this.takeShown()),
      this.refreshEdgeTrees(),
      this.refreshEffects(),
      this.refreshSigns(),
      this.refreshMovers(),
      this.refreshContact(),
      this.bridges.set(this.doc.paths, this.doc.terrain),
      this.refreshDecals(),
      // The noise textures, in a worker (started as the app starts): the ground's variation and the waves shown
      // here, the shore foam's and the lava's for water poured later (the editor)
      prepareNoiseTextures(),
      // The ground's shape and the water's first bakes, off the page's thread where there is a baker
      this.terrain.occlusion.settled,
      this.terrain.normalsSettled,
      this.farShadowFirst,
      this.lavaFirst,
      ...this.waters.map((w) => w?.settled),
    ]);
  }
}

/** The low ground of a map for the height fog: the water level, or near the lowest heights */
function lowGround(heights: Float32Array, waterLevel: number | undefined): number {
  if (waterLevel !== undefined) return waterLevel;
  if (!heights.length) return 0;
  // The 5th percentile by selection, not a sort of the whole grid (40 ms on a 2048 m map in a dev build)
  return selectNth(Float32Array.from(heights), Math.floor(heights.length * 0.05));
}

/** The switchable map effects a quality level sets */
function effectsOfQuality(q: CustomMapQuality): Partial<MapEffects> {
  return { refraction: q.refraction, seaWaves: q.seaWaves, lavaGlow: q.lavaGlow, shadowCascade: q.shadowCascade, waterDetail: q.waterDetail, reflection: q.waterReflection > 0 };
}

/** A mover hanging from a line (a gondola), which rides the cables placed under its route */
function hangs(a: MapLifeArea): boolean {
  return a.kind === 'movers' && a.height !== undefined;
}

/** Whether any of `objects` writes a sign */
function hasSigns(objects: readonly MapObject[]): boolean {
  return objects.some((o) => !!o.sign);
}

/** The lights of a map's environment as the impostors' tone probe takes them (colours times intensities) */
function impostorLights(env: CustomMapEnvironment): ImpostorLights {
  return {
    sunDir: env.sunDir.clone(),
    sun: env.sun.color.clone().multiplyScalar(env.sun.intensity),
    sky: env.hemi.color.clone().multiplyScalar(env.hemi.intensity),
    ground: env.hemi.groundColor.clone().multiplyScalar(env.hemi.intensity),
    ambient: env.ambient.color.clone().multiplyScalar(env.ambient.intensity),
    environment: env.environmentMap?.texture ?? null,
    environmentIntensity: env.environmentMap?.intensity ?? 0,
  };
}

/**
 * A depth material as three's shadow pass sets it for a mesh of `material`
 * (WebGLShadowMap.getDepthMaterial: side, maps, alpha test, clipping,
 * displacement), so a program built ahead has the key the pass asks for
 */
function asShadowPass(depth: MeshDepthMaterial, material: Material, type: ShadowMapType): MeshDepthMaterial {
  const m = material as Material & Partial<MeshDepthMaterial>;
  const flipped: Record<Side, Side> = { [FrontSide]: BackSide, [BackSide]: FrontSide, [DoubleSide]: DoubleSide };
  depth.side = material.shadowSide ?? (type === VSMShadowMap ? material.side : flipped[material.side]);
  depth.visible = material.visible;
  depth.wireframe = m.wireframe ?? false;
  depth.alphaMap = m.alphaMap ?? null;
  depth.alphaTest = material.alphaToCoverage ? 0.5 : material.alphaTest;
  depth.map = m.map ?? null;
  depth.clipShadows = material.clipShadows;
  depth.clippingPlanes = material.clippingPlanes;
  depth.clipIntersection = material.clipIntersection;
  depth.displacementMap = m.displacementMap ?? null;
  depth.displacementScale = m.displacementScale ?? 1;
  depth.displacementBias = m.displacementBias ?? 0;
  return depth;
}

/** A promise and what resolves it */
function settles(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
