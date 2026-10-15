import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  Vector3,
  Mesh,
  Object3D,
  Group,
  SRGBColorSpace,
  Fog,
  Matrix4,
  Vector4,
  WebGLRenderTarget,
} from 'three';
import type { GlobeControls } from '3d-tiles-renderer';
import { ColorGradingPreset } from './post-processing/color-grading';
import { PostProcessingPipeline } from './post-processing/post-processing-pipeline';
import { CameraRig } from './camera-rig';
import type { RootLoadFailure, TileStats } from './tile-loading-tracker';
import type { EllipsoidSync } from './ellipsoid-sync';
import { RenderLoop } from './render-loop';
import { CanvasSizeFollower } from './canvas-size-follower';
import { SkyBackground, addSceneLights } from './scene-environment';
import { DiveView, FOG_FAR, FOG_NEAR, VIEW_DISTANCE } from './dive-view';
import { ScreenPicker } from './screen-picker';
import { skipLostContextDeletes } from './lost-context-deletes';
import {
  CoordinateSync,
  ThreeTowerRenderer,
  ThreeProjectileRenderer,
  ThreeEffectsRenderer,
  ThreeFlameBeamRenderer,
  ThreeTentacleRenderer,
  TrailStreakRenderer,
  LightningBoltRenderer,
} from './renderers';
import { InstancedEnemyRenderer } from './renderers/instanced-enemy/instanced-enemy.renderer';
import { setBlobGround } from './renderers/instanced-enemy/blob-shadow';
import { TowerPlinthRenderer } from './renderers/tower-plinth/tower-plinth.renderer';
import { TowerBadgeRenderer } from './renderers/tower-badge/tower-badge.renderer';
import { AbilityMarkerRenderer } from './renderers/ability-marker.renderer';
import { MushroomCloudRenderer } from './renderers/mushroom-cloud.renderer';
import { MissileLaunchRenderer } from './renderers/missile-launch.renderer';
import { OozeBandRenderer } from './renderers/ooze/ooze-band.renderer';
import { OozeDebrisRenderer } from './renderers/ooze/ooze-debris.renderer';
import { createPortalClipUniforms } from './renderers/portal-clip';
import { BloodMoonLook } from './blood-moon/blood-moon-look';
import { BloodMoonMood } from './blood-moon/blood-moon-mood';
import { SearchlightRenderer } from './renderers/searchlight/searchlight.renderer';
import { HeroRenderer } from './renderers/hero.renderer';
import { FrostBurstRenderer } from './renderers/frost-burst.renderer';
import { EmpPulseRenderer } from './renderers/emp-pulse.renderer';
import { OrbitalBeamRenderer } from './renderers/orbital-beam.renderer';
import { SpatialAudioManager } from '../managers/audio/spatial-audio.manager';
import { AssetManagerService } from '../services/infrastructure/asset-manager.service';
import { TowerShadowMapper } from './tower-shadow-mapper';
import type { RouteCorridorTiles } from './route-corridor-tiles';
import type { TilesLodDebug } from './tiles-lod-debug';
import { perfTrace } from '../utils/perf-trace';
import { warmUpScene } from './scene-warmup';
import { ScreenShake, offsetProjection } from './screen-shake';
import { ShakeBenchmark, type ShakeBenchResult } from './screen-shake-benchmark';
import { MISSILE_LAUNCH_LOOK, MUSHROOM_CLOUD_LOOK, SCREEN_SHAKE_CONFIG } from '../configs/visual-effects.config';
import { ABILITIES } from '../configs/abilities.config';
import { TOWER_TYPES } from '../configs/tower-types.config';
import type { GeoPosition } from '../models/game.types';
import { NO_TILE_STATS, type WorldProvider, type WorldSurface } from '../world/world-provider';
import { GpuFrameMeter, type GpuTimeReader } from './gpu-timer';
import { ProgramCompileHold } from './program-compile-hold';
import { DisplayRefresh } from './dynamic-resolution';
import { DynamicResolution, MIN_SAMPLES } from './dynamic-resolution';
import { pixelRatioFor, type QualityKnobs, type QualityWorld } from './render-quality';

/** Strength of the enemies' rim light on worlds that ask for it (WorldCapabilities.enemyRimLight) */
const ENEMY_RIM_LIGHT = 0.2;

/** Called right before and right after a frame is drawn (ThreeTilesEngine.setFrameProbe) */
export interface FrameProbe {
  begin(): void;
  end(): void;
}

/** Options of the canvas renderer, without the canvas. */
export const CANVAS_RENDERER_OPTIONS = {
  antialias: true,
  // Required for the 1m..8000m depth range over the 3D tiles (kept to
  // avoid far-field z-fighting).
  logarithmicDepthBuffer: true,
  powerPreference: 'high-performance', // prefer dGPU on hybrid laptops
  // The tower range rings find the surface they lie on with the
  // stencil buffer; without one they paint their whole volume
  // (range-ring.ts). The composer target has one as well.
  stencil: true,
} as const;

/**
 * ThreeTilesEngine - Main Three.js rendering engine for Tower Defense
 *
 * Draws the game over a world it gets ready made (WorldProvider,
 * docs/WORLD_PROVIDER_PLAN.md): the Google 3D tiles through
 * 3DTilesRendererJS (TilesWorld), DevWorld's procedural terrain, later
 * custom maps. The engine never asks which world it is; the ground queries
 * are the world's surface (`terrain`), its tiles a facet (`world.tiles`).
 *
 * Key advantages:
 * - Single WebGL context - automatic depth occlusion for all objects
 * - Native Three.js raycasting against the ground
 * - Simpler coordinate transformations
 */
export class ThreeTilesEngine {
  private renderer: WebGLRenderer;
  private scene: Scene;
  private camera: PerspectiveCamera;
  // GlobeControls/EnvironmentControls + Startposition der Kamera; the world sets the controls up
  private readonly cameraRig: CameraRig;

  // Post-processing pipeline (composer + bloom + color grading + output pass)
  private postProcessing: PostProcessingPipeline | null = null;

  // Scene background, the image arrives after the constructor
  private readonly sky: SkyBackground | null = null;
  // Set by dispose(); preloadModels() skips the shader warm-up then
  private disposed = false;
  /** Puts the context's delete calls back (skipLostContextDeletes). */
  private readonly restoreGLDeletes: () => void;

  // Game speed multiplier for animations (turret rotation etc.)
  private gameTimescale = 1.0;
  /** Phase 5.14: headless mode, skips all per-frame rendering work. */
  private _renderingEnabled = true;

  // Coordinate sync, the world's
  readonly sync: EllipsoidSync;

  /**
   * The world's ground queries: columns with their cache, street clearance,
   * line of sight, LOD peek, screen picks (WorldSurface). Reached as
   * `engine.terrain`.
   */
  readonly terrain: WorldSurface;

  /**
   * Where the spawn portals hide the enemies still behind their plane
   * (portal-clip.ts): shared by the enemies, their health bars and the
   * oozes, written by the SpawnPortalManager (MarkerVisualizationService).
   */
  readonly portalClip = createPortalClipUniforms();

  // Entity renderers
  readonly enemies: InstancedEnemyRenderer;
  readonly towers: ThreeTowerRenderer;
  /** Stone plinths under towers on uneven ground */
  readonly plinths: TowerPlinthRenderer;
  /** Veteran insignia above towers with a rank */
  readonly towerBadges: TowerBadgeRenderer;
  readonly projectiles: ThreeProjectileRenderer;
  readonly effects: ThreeEffectsRenderer;
  readonly flameBeams: ThreeFlameBeamRenderer;
  readonly tentacles: ThreeTentacleRenderer;
  readonly trailStreaks: TrailStreakRenderer;
  readonly lightningBolts: LightningBoltRenderer;
  readonly abilityMarkers: AbilityMarkerRenderer;
  readonly mushroomClouds: MushroomCloudRenderer;
  /** The nuclear strike's missile from its silo to the target, with its smoke */
  readonly missileLaunches: MissileLaunchRenderer;
  /** Bodies of the oozes along the route, see OozeBodies */
  readonly oozes: OozeBandRenderer;
  /** Searchlights on the towers, lit by the blood moon */
  readonly searchlights: SearchlightRenderer;
  /** Look of the blood moon waves, switched by BloodMoonService */
  readonly bloodMoon: BloodMoonLook;
  readonly hero: HeroRenderer;
  /** Coop partners' heroes (review R15): drawn, never picked; made by createPartnerHero */
  private readonly partnerHeroes = new Set<HeroRenderer>();
  /** Geo to scene for renderers made after the constructor */
  private readonly coordinateSync: CoordinateSync;
  readonly frostBursts: FrostBurstRenderer;
  readonly empPulses: EmpPulseRenderer;
  readonly orbitalBeams: OrbitalBeamRenderer;

  // Spatial audio manager
  readonly spatialAudio: SpatialAudioManager;

  /** Screen picking: ground under the pointer, clicked tower. Reached as `engine.picker`. */
  readonly picker: ScreenPicker;

  // GPU-LOS-Pipeline: lazy-initialised auf erste Anforderung. Shared
  // zwischen Build-Preview und Tower-Selection-Viz (Lesson 9, beide
  // dürfen nicht gleichzeitig aktiv sein).
  private towerShadowMapper: TowerShadowMapper | null = null;

  // Overlay group for markers, streets, routes
  // Added to scene root, but synced with tiles movement each frame
  private overlayGroup: Group;

  /**
   * The dive from the menu globe into the tiles and the rise back out
   * (docs/GLOBE_PLAN.md): view distance and fog over the altitude, the
   * warm-up of the dive's tiles. Driven by DiveFlightService.
   */
  readonly dive: DiveView;
  /** The globe covers the canvas: frames skip the draw (the tiles still update), see setDrawSuppressed() */
  private drawSuppressed = false;

  // Callback when tiles finish loading (for terrain height refresh)
  private onTilesLoadCallback: (() => void) | null = null;

  // Screen shake: a screen-space offset of the projection matrix, applied
  // only while a frame is drawn (drawFrame), never seen by the tiles update
  // or by raycasts between frames
  private readonly screenShake = new ScreenShake();
  private readonly unshakenProjection = new Matrix4();
  private readonly unshakenProjectionInverse = new Matrix4();
  /** Running __perf.shakeBench() measurement, null otherwise */
  private shakeBench: ShakeBenchmark | null = null;
  /** Called around each frame's draw while the render benchmark measures (setFrameProbe) */
  private frameProbe: FrameProbe | null = null;
  /** GPU time of every frame's draw for whoever reads it (dynamic resolution, Auto, the benchmark) */
  readonly gpuMeter: GpuFrameMeter;
  /** The canvas was made with MSAA (fixed for the context's life, render-quality.ts) */
  private readonly canvasMsaa: boolean;
  /** The quality level drawn with, null before applyQuality (the picture as before the levels) */
  private quality: { knobs: QualityKnobs; world: QualityWorld } | null = null;
  /** The draw waits while the programs of a new quality level compile (applyQuality) */
  private readonly qualityCompile = new ProgramCompileHold();
  /** The display's frame interval, from frames that drew nothing (the dynamic resolution without a GPU timer) */
  private readonly displayRefresh = new DisplayRefresh();
  /** When the last frame that drew nothing ran, ms; 0 after a drawn one */
  private idleFrameAt = 0;
  /** The bloom switch as the effect settings have it; the level may still hold it off */
  private bloomWanted = false;
  /** Low and Medium: the resolution follows the frame cost (dynamic-resolution.ts) */
  private dynamic: {
    controller: DynamicResolution;
    gpu: GpuTimeReader | null;
    gpuTimes: number[];
    intervals: number[];
    lastFrameAt: number;
    windowStart: number;
    /** A scale the controller answered after a draw, applied before the next one */
    pendingScale: number | null;
  } | null = null;
  /** The graphics benchmark holds the resolution still while it measures */
  private dynamicPaused = false;

  // Callback for per-frame updates (animations)
  private onUpdateCallback: ((deltaTime: number) => void) | null = null;
  /** Camera choreographies of their own (the dive from the menu globe), after the game's update, see addFrameHook() */
  private readonly frameHooks = new Set<() => void>();

  /**
   * Drives update() and render(): rAF, the hidden-tab heartbeat for
   * training, the frame cap and the FPS counter.
   */
  readonly renderLoop = new RenderLoop({
    update: (deltaTime) => this.update(deltaTime),
    render: () => this.render(),
    isRendering: () => this._renderingEnabled,
  });

  /** Resizes the drawing buffer with the canvas, see fitToCanvas() */
  private readonly canvasSize: CanvasSizeFollower;

  /**
   * @param world The world to draw, made around the run's origin
   *   (WorldContext.open); attached in initialize(), disposed with the engine
   * @param options.antialias The canvas' MSAA (the quality level's, fixed
   *   for the context's life); on by default
   */
  constructor(
    canvas: HTMLCanvasElement,
    readonly world: WorldProvider,
    private assetManager?: AssetManagerService,
    options: { antialias?: boolean } = {},
  ) {
    // Coordinates and ground queries are the world's
    this.sync = world.sync;
    this.terrain = world.surface;

    // Create WebGL renderer with error handling
    try {
      this.renderer = new WebGLRenderer({ canvas, ...CANVAS_RENDERER_OPTIONS, antialias: options.antialias ?? CANVAS_RENDERER_OPTIONS.antialias });
    } catch {
      throw new Error('WebGL is not supported. Enable hardware acceleration in your browser.');
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.canvasMsaa = options.antialias ?? CANVAS_RENDERER_OPTIONS.antialias;
    this.gpuMeter = new GpuFrameMeter(this.renderer.getContext() as WebGL2RenderingContext);
    this.renderer.setClearColor(0x151c1f);
    this.renderer.outputColorSpace = SRGBColorSpace;
    // A tower being built is cut off above its course by a plane on its materials (TowerBuild)
    this.renderer.localClippingEnabled = true;
    // After a context loss, objects three used before (tiles, pools, targets)
    // would delete their lost handles in the restored context when disposed.
    this.restoreGLDeletes = skipLostContextDeletes(this.renderer.getContext() as WebGL2RenderingContext, canvas);

    // Create scene with distance fog: 2000 m to 6000 m, the view ends at 8000 m (dive-view.ts)
    this.scene = new Scene();
    const fogColor = 0x1a1f25; // Slightly lighter than background for depth
    this.scene.fog = new Fog(fogColor, FOG_NEAR, FOG_FAR);

    // R1: the scene root is permanently at the origin. Disabling matrixAutoUpdate
    // stops Three.js from re-composing its (identity) matrix every frame and, more
    // importantly, force-propagating a matrixWorld refresh down to every child.
    // Children that still need updates keep matrixWorldAutoUpdate=true (the dynamic
    // overlay/tiles/entity roots); genuinely static children (lights, lightning
    // pool, health-bar roots) opt out and are skipped entirely each frame.
    this.scene.matrixAutoUpdate = false;

    // Create overlay group for markers, streets, routes
    // Will be added to SCENE (not tilesGroup) and synced each frame
    this.overlayGroup = new Group();
    this.scene.add(this.overlayGroup);

    // Create camera - far plane limits tile loading distance
    this.camera = new PerspectiveCamera(
      60,
      canvas.width / canvas.height,
      1,
      VIEW_DISTANCE // GlobeControls may override, enforced in render()
    );

    // Controls kommen erst in initialize() dazu, der Rig hält bis dahin nur Kamera und Canvas
    this.cameraRig = new CameraRig(this.camera, this.renderer.domElement);

    this.dive = new DiveView({
      tiles: () => this.world.tiles?.renderer() ?? null,
      renderer: this.renderer,
      camera: this.camera,
      fog: () => (this.scene.fog instanceof Fog ? this.scene.fog : null),
      prerender: (camera) => this.prerender(camera),
    });

    // Lighting and sky, unless the world brings its own (a custom map installs them when it attaches)
    if (!world.capabilities.ownEnvironment) {
      addSceneLights(this.scene);
      this.sky = new SkyBackground(this.renderer, this.scene);
      // The sky cube is drawn once; a restored context comes back without its pixels
      this.sky.convertAgainOnContextRestore(this.renderer.domElement);
    }

    // Initialize entity renderers with coordinate sync adapter
    // Use geoToLocalSimple for consistency with raycast results
    const coordinateSync: CoordinateSync = {
      geoToLocal: (lat: number, lon: number, height: number) => this.sync.geoToLocalSimple(lat, lon, height),
      geoToLocalSimple: (lat: number, lon: number, height: number) => this.sync.geoToLocalSimple(lat, lon, height),
      geoToLocalSimpleInto: (lat: number, lon: number, height: number, target: Vector3) => this.sync.geoToLocalSimpleInto(lat, lon, height, target),
      localToGeo: (vec: Vector3) => this.sync.localToGeo(vec),
    };

    // AssetManager is required for enemy and tower renderers
    if (!this.assetManager) {
      throw new Error('[ThreeTilesEngine] AssetManagerService is required');
    }

    this.enemies = new InstancedEnemyRenderer(this.scene, coordinateSync, this.assetManager, this.portalClip);
    // A rim light lifts enemies off a custom map's lit, detailed ground; tiles keep their look
    this.enemies.setRimLight(world.capabilities.enemyRimLight ? ENEMY_RIM_LIGHT : 0);
    // Units on a world with cast shadows would float: blobs under enemies and the hero, towers into the sun's map
    this.enemies.setBlobShadows(world.capabilities.groundShadows);
    // ... lying on the world's ground where it gives its heights
    setBlobGround(world.capabilities.groundShadows && world.groundHeights ? () => world.groundHeights!() : null);
    // A restored WebGL context comes back empty and three uploads every texture
    // again from its CPU copy, which the VATs drop after their first upload.
    this.enemies.rebakeOnContextRestore(this.renderer.domElement);
    this.towers = new ThreeTowerRenderer(this.scene, coordinateSync, this.assetManager);
    this.plinths = new TowerPlinthRenderer(this.scene, coordinateSync);
    this.towerBadges = new TowerBadgeRenderer(this.scene, (id) => this.towers.get(id)?.mesh ?? null);
    this.projectiles = new ThreeProjectileRenderer(this.scene, coordinateSync);
    // One clock for everything that slides between two states (state-lerp.ts)
    this.projectiles.stateLerp = this.enemies.stateLerp;
    this.effects = new ThreeEffectsRenderer(this.scene, coordinateSync);
    this.flameBeams = new ThreeFlameBeamRenderer();
    this.flameBeams.setEffectsRenderer(this.effects);
    this.tentacles = new ThreeTentacleRenderer(this.scene);
    this.trailStreaks = new TrailStreakRenderer(this.scene);
    this.lightningBolts = new LightningBoltRenderer(this.scene);
    this.abilityMarkers = new AbilityMarkerRenderer(this.scene);
    this.mushroomClouds = new MushroomCloudRenderer(this.scene);
    // Its smoke and fire take the mushroom clouds' sprite materials; the missile is the silo model's,
    // loaded with the silo it launches from
    const assets = this.assetManager;
    const siloType = ABILITIES['nuclear-strike'].launchFrom;
    const siloUrl = siloType ? TOWER_TYPES[siloType].modelUrl : null;
    this.missileLaunches = new MissileLaunchRenderer(this.scene, this.mushroomClouds.spriteMaterials, () =>
      (siloUrl ? assets.getCachedModel(siloUrl)?.scene.getObjectByName(MISSILE_LAUNCH_LOOK.missile.node) : null) ?? null);
    // A killed ooze's bubbles and splashes go through the effects, its debris to a renderer of its own
    this.oozes = new OozeBandRenderer(
      this.scene, { effects: this.effects, debris: new OozeDebrisRenderer(this.scene) }, this.portalClip,
    );
    this.searchlights = new SearchlightRenderer(this.scene, coordinateSync, this.towers);
    // Takes the fog colour set above as the one to return to
    this.bloodMoon = new BloodMoonLook({
      mood: new BloodMoonMood(this.scene),
      enemies: this.enemies,
      searchlights: this.searchlights,
      oozes: this.oozes,
      groundMarks: this.effects,
    });
    this.hero = new HeroRenderer(this.scene, coordinateSync, this.assetManager);
    this.hero.stateLerp = this.enemies.stateLerp;
    this.hero.setBlobShadow(world.capabilities.groundShadows);
    if (world.capabilities.groundShadows) {
      this.towers.onShadowsChanged = () => world.invalidateShadows?.();
      this.towers.setShadowCasting(true);
    }
    this.coordinateSync = coordinateSync;
    this.frostBursts = new FrostBurstRenderer(this.scene, this.effects.particleShaderMaterials);
    this.empPulses = new EmpPulseRenderer(this.scene, this.effects.particleShaderMaterials);
    // Its embers take the ground marks' blood moon tint
    this.orbitalBeams = new OrbitalBeamRenderer(this.scene, this.effects.particleShaderMaterials, this.effects.groundMarkTint);

    // Initialize spatial audio with camera listener
    this.spatialAudio = new SpatialAudioManager(this.scene, this.camera);
    this.spatialAudio.setGeoToLocal((lat, lon, height, target) =>
      this.sync.geoToLocalSimpleInto(lat, lon, height, target)
    );

    // Screen picking against the world's ground and the tower meshes; a
    // plinth picks the tower on it
    const pickableTowers = {
      getAllMeshes: () => [...this.towers.getAllMeshes(), ...this.plinths.getAllMeshes()],
    };
    this.picker = new ScreenPicker(this.camera, this.renderer, pickableTowers, this.terrain);

    // Setup post-processing pipeline (bloom off by default)
    this.setupPostProcessing();

    // The drawing buffer follows the canvas' CSS size from here on
    this.canvasSize = new CanvasSizeFollower(canvas, () => this.fitToCanvas());
  }

  /**
   * Trigger screen shake (e.g. on explosion). Max-wins: a weaker shake is
   * dropped while a stronger one still runs.
   * @param amplitude - Peak offset as a share of the view height (0.005 = about 5 px at 1080p)
   * @param duration - ms until the offset is back to 0, falling linearly
   */
  triggerScreenShake(amplitude: number, duration: number): void {
    this.screenShake.trigger(amplitude, duration, performance.now());
  }

  /**
   * Measure what the screen shake costs per frame (`__perf.shakeBench()`).
   * Three phases of `seconds` each: no shake; the shake running the whole
   * time (rocket strength, even when shake is off in the display options);
   * the camera moved every frame the way the shake did before 2026-09-12.
   * Keep the camera still while it runs. Resolves with one row per phase.
   */
  runShakeBenchmark(seconds = 5): Promise<ShakeBenchResult[]> {
    if (!this.world.tiles) {
      return Promise.reject(new Error('The shake benchmark measures the 3D tiles; this world has none'));
    }
    if (!this.shakeBench) {
      const { amplitude } = SCREEN_SHAKE_CONFIG.presets.rocket;
      this.shakeBench = new ShakeBenchmark(seconds * 1000, performance.now(), (now) =>
        this.screenShake.trigger(amplitude, 100, now)
      );
    }
    return this.shakeBench.done;
  }

  setTimescale(scale: number): void {
    this.gameTimescale = scale;
    this.spatialAudio.setTimescale(scale);
  }

  /**
   * Phase 5.14: Enable/disable per-frame rendering (headless training mode).
   * When disabled, `update()` and `render()` become no-ops, only the
   * gameplay tick (`onUpdateCallback`) continues via the animate loop.
   */
  /** True while the render path runs; false in headless training. */
  get renderingEnabled(): boolean {
    return this._renderingEnabled;
  }

  setRenderingEnabled(enabled: boolean): void {
    this._renderingEnabled = enabled;
  }

  /**
   * Put the world into the scene (async, after the constructor): its
   * ground, the camera controls, its load events.
   */
  async initialize(): Promise<void> {
    await this.world.attach({
      scene: this.scene,
      camera: this.camera,
      renderer: this.renderer,
      cameraRig: this.cameraRig,
      drawSuppressed: this.drawSuppressed,
      groundChanged: () => this.onGroundChanged(),
      drawsToTarget: () => this.postProcessing?.needsRender() ?? false,
      audio: {
        context: this.spatialAudio.getListener().context,
        destination: this.spatialAudio.getListener().getInput(),
        volume: () => this.spatialAudio.masterVolume,
      },
    });
  }

  /**
   * The world's loaded ground changed: on the tiles every settled
   * tiles-load-end, after the world bumped its column cache's `lodVersion`.
   *
   * This used to sit behind a 2 m height-delta gate measured at (0,0). LOD
   * refinement anywhere else in the world, the whole enemy corridor, for
   * instance, never moves the origin column, so the tile-info map went
   * stale, `peekBestTileLODAtLocal` reported outdated LODs, `sampleCellY`'s
   * skip gate then refused to re-sample, and the convergence loop spun
   * without healing anything. The same gate also withheld the cubemap
   * invalidation and the route refresh, which is how a route baked during
   * the coarse phase stayed baked (enemies walking at rooftop height in
   * dense cities).
   */
  private onGroundChanged(): void {
    const tPre0 = performance.now();

    this.towerShadowMapper?.invalidate();
    const tShadowInvalidate = performance.now();

    if (this.onTilesLoadCallback) {
      this.onTilesLoadCallback();
      const tEnd = performance.now();
      perfTrace.log(() =>
        `[PerfTrace] onTilesLoadCallback: ${(tEnd - tPre0).toFixed(1)}ms total | ` +
        `shadowInvalidate=${(tShadowInvalidate - tPre0).toFixed(1)} ` +
        `facadeCallback=${(tEnd - tShadowInvalidate).toFixed(1)}ms ` +
        `(lodVersion=${this.terrain.lodVersion})`,
      );
    }
  }

  /**
   * Register a callback to be called when tiles finish loading
   * Used by component to refresh terrain heights after LOD changes
   */
  setOnTilesLoadCallback(callback: () => void): void {
    this.onTilesLoadCallback = callback;
  }

  /**
   * Register a callback for a root tileset that failed, with why
   * (RootLoadFailure): refused credentials or a server not reached.
   */
  setOnAuthErrorCallback(callback: (failure: RootLoadFailure | null) => void): void {
    // Registration usually happens after the tileset request already failed,
    // the world replays a remembered error.
    this.world.onLoadFailure(callback);
  }

  /** Try a failed root tileset again now */
  retryWorldLoad(): void {
    this.world.retryLoad();
  }

  /**
   * Register a callback to be called when first tiles are loaded
   * Used by component to hide "loading tiles" indicator
   */
  setOnFirstTilesLoadedCallback(callback: () => void): void {
    // If the ground stands already, the world calls it immediately
    this.world.onFirstGround(callback);
  }

  /**
   * Run `hook` every drawn frame, after the game's update and before the
   * draw; returns the function that takes it off again.
   */
  addFrameHook(hook: () => void): () => void {
    this.frameHooks.add(hook);
    return () => this.frameHooks.delete(hook);
  }

  /**
   * Register a callback to be called each frame for animations
   */
  setOnUpdateCallback(callback: (deltaTime: number) => void): void {
    this.onUpdateCallback = callback;
  }

  private setupPostProcessing(): void {
    this.postProcessing = new PostProcessingPipeline(this.renderer, this.scene, this.camera);
  }

  /**
   * Set camera position in local coordinates (meters relative to origin)
   * With ReorientationPlugin (recenter: true), origin is at (0,0,0)
   *
   * @param x - East/West offset in meters (positive = East)
   * @param y - Height above ground in meters
   * @param z - North/South offset in meters (positive = South)
   * @param targetX - Look-at target X (default 0)
   * @param targetY - Look-at target Y (default 0)
   * @param targetZ - Look-at target Z (default 0)
   */
  setLocalCameraPosition(
    x: number,
    y: number,
    z: number,
    targetX = 0,
    targetY = 0,
    targetZ = 0
  ): void {
    this.cameraRig.setLocalPosition(x, y, z, targetX, targetY, targetZ);
  }

  /**
   * Update origin (when game location changes)
   * Also resets firstTilesLoaded so the callback fires again for the new location
   */
  setOrigin(lat: number, lon: number, height = 0): void {
    // Sync, corridor, ground caches, first-load state, the overlay's anchor:
    // all the world's
    this.world.setOrigin(lat, lon, height);
  }

  private readonly prerenderViewport = new Vector4();
  private readonly prerenderScissor = new Vector4();

  /**
   * Draw the scene once from `camera` into a corner of 4 x 4 pixels of the
   * canvas, which the menu globe covers. The tiles it shows upload their
   * geometry now: the warm-up of the dive (DiveView) does it behind the
   * globe, so the first frames of the dive do not. The canvas, not a render
   * target: a target draws without tone mapping and in linear colour, and
   * every material would compile a variant of its own for it. Fog is pushed
   * away for the same reason, not taken off. The scissor keeps the render's
   * clear in the corner too: a clear ignores the viewport, and on a rise the
   * globe does not cover the canvas yet, each warm-up step flashed it empty.
   */
  private prerender(camera: PerspectiveCamera): void {
    const fog = this.scene.fog instanceof Fog ? this.scene.fog : null;
    const [near, far] = [fog?.near ?? 0, fog?.far ?? 0];
    if (fog) [fog.near, fog.far] = [1e9, 2e9];
    const renderer = this.renderer;
    const scissorTest = renderer.getScissorTest();
    renderer.getViewport(this.prerenderViewport);
    renderer.getScissor(this.prerenderScissor);
    renderer.setViewport(0, 0, 4, 4);
    renderer.setScissor(0, 0, 4, 4);
    renderer.setScissorTest(true);
    renderer.render(this.scene, camera);
    renderer.setScissorTest(scissorTest);
    renderer.setScissor(this.prerenderScissor);
    renderer.setViewport(this.prerenderViewport);
    if (fog) [fog.near, fog.far] = [near, far];
  }

  /**
   * Skip drawing frames while the menu globe covers the canvas (docs/GLOBE_PLAN.md):
   * the tiles go on updating and loading, the GPU draws nothing here.
   */
  setDrawSuppressed(suppressed: boolean): void {
    if (this.drawSuppressed === suppressed) return;
    this.drawSuppressed = suppressed;
    // Nothing to keep smooth here meanwhile: the world may load faster
    this.world.setDrawSuppressed(suppressed);
  }

  /**
   * The matrix from the scene's frame to ECEF (the tiles' own frame), for a
   * pose handed to the menu globe. Null without `capabilities.ecef`.
   */
  sceneToEcef(target: Matrix4): Matrix4 | null {
    return this.world.sceneToEcef(target);
  }

  /**
   * Resize renderer
   */
  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.postProcessing?.setSize(width, height);
    // Drawing-buffer size changed: the world's tiles follow the resolution
    this.world.resize(this.camera, this.renderer);
  }

  /**
   * Match the drawing buffer to the canvas' current CSS size. CanvasSizeFollower
   * calls it for every change of that size: the window, photo mode hiding
   * header and sidebar.
   */
  fitToCanvas(): void {
    const canvas = this.renderer.domElement;
    if (canvas.clientWidth > 0 && canvas.clientHeight > 0) {
      this.resize(canvas.clientWidth, canvas.clientHeight);
    }
  }

  /**
   * Copy of the next drawn frame as a 2D canvas in drawing-buffer pixels, for
   * screenshots. Copied inside the frame (RenderLoop.onNextFrameRendered), so
   * it works without preserveDrawingBuffer. Null while nothing draws
   * (headless training) or when no frame comes within a second (hidden tab).
   */
  captureFrame(): Promise<HTMLCanvasElement | null> {
    if (!this._renderingEnabled) return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        resolve(null);
      }, 1000);
      this.renderLoop.onNextFrameRendered(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const source = this.renderer.domElement;
        const copy = document.createElement('canvas');
        copy.width = source.width;
        copy.height = source.height;
        const ctx = copy.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(source, 0, 0);
        resolve(copy);
      });
    });
  }

  /**
   * Ground height at geographic coordinates, in local Y. See
   * {@link TerrainQueries.getTerrainHeightAtGeo}; stays on the engine for
   * its two dozen callers. The other terrain queries are on `terrain`.
   */
  getTerrainHeightAtGeo(lat: number, lon: number): number | null {
    return this.terrain.getTerrainHeightAtGeo(lat, lon);
  }

  /** Keep the enemy route corridor loaded at fine LOD, see RouteCorridorTiles.setRoutes */
  setRouteCorridor(routes: GeoPosition[][]): void {
    this.world.tiles?.corridor.setRoutes(routes);
  }

  /** Debug: the LOD the tiles load at, see RouteCorridorTiles.lodDebug; null without tiles */
  tilesLodDebug(): TilesLodDebug | null {
    return this.world.tiles?.corridor.lodDebug() ?? null;
  }

  /** How far the route corridor's tiles are refined, see RouteCorridorTiles.lod */
  routeCorridorLod(): ReturnType<RouteCorridorTiles['lod']> {
    return this.world.tiles?.corridor.lod() ?? null;
  }

  /** The corridor region in the tiles group's frame now, see RouteCorridorTiles.refreshFrame */
  refreshRouteCorridorFrame(): boolean {
    return this.world.tiles?.corridor.refreshFrame() ?? false;
  }

  /** The content paths of the corridor's fine tiles, see RouteCorridorTiles.tilePaths */
  routeCorridorTilePaths(): string[] | null {
    return this.world.tiles?.corridor.tilePaths() ?? null;
  }

  /** Debug: paint tiles by geometric error, see RouteCorridorTiles.setLodDebugEnabled */
  setTileLodDebugEnabled(enabled: boolean): void {
    this.world.tiles?.corridor.setLodDebugEnabled(enabled);
  }

  /**
   * Main render loop - call this each frame.
   * Headless-mode: when rendering is disabled, we skip all per-frame visual
   * work (world update, camera updates, renderer.render, FPS tracking).
   * Gameplay still runs, it's driven by `onUpdateCallback` in `update()`,
   * which is called from the animate loop regardless of rendering state.
   */
  render(): void {
    if (!this._renderingEnabled) return;

    // The tiles draw nothing before their renderer stands
    const world = this.world;
    if (!world.ready()) {
      this.idleFrame();
      return;
    }

    // Shake benchmark (__perf.shakeBench, tiles only): its camera-move phase
    // moves the camera, so it starts before controls and tiles see it
    let bench = this.shakeBench;
    if (bench && !bench.beginFrame(performance.now(), this.camera)) {
      bench = this.shakeBench = null;
    }

    // Update controls
    this.cameraRig.update();

    // Force camera far plane to limit tile loading (GlobeControls may override it);
    // a dive reaches further, see DiveView. Nothing changes the far plane
    // over a flat world (EnvironmentControls leave it), so this holds still there.
    const viewDistance = this.dive.viewDistance();
    if (this.camera.far > viewDistance || (viewDistance > VIEW_DISTANCE && this.camera.far !== viewDistance)) {
      this.camera.far = viewDistance;
      this.camera.updateProjectionMatrix();
    }

    // Camera matrix must be current before the world's update (the tiles'
    // LOD and frustum) reads it: controls.update() above moved the camera.
    // setResolutionFromRenderer / setCamera are NOT per-frame work, resolution
    // only changes on resize() and the camera reference is registered once at
    // attach (and on the no-tiles nudge); calling them every frame was wasted work.
    this.camera.updateMatrixWorld();

    // Stream the ground and keep the overlay on it
    const traversalsBefore = bench ? this.tilesTraversalCount() : 0;
    const tilesStart = bench ? performance.now() : 0;
    world.update(this.camera, this.overlayGroup);
    const tilesMs = bench ? performance.now() - tilesStart : 0;

    // Under the menu globe nothing shows, and while a new quality level's programs compile the
    // picture stands: no draw, unless a frame is waited for (the shader warm-up uploads in a
    // drawn frame, a screenshot reads one)
    if ((this.drawSuppressed || this.qualityCompile.holding) && !this.renderLoop.hasFrameWaiters()) {
      this.idleFrame();
      return;
    }
    this.idleFrameAt = 0;

    // A new resolution from the last frame's cost: set now, so this frame draws into the resized canvas. Set
    // after the draw, the resize cleared the canvas and the browser showed that empty frame (a black frame
    // every few seconds while the scale climbed)
    const d = this.dynamic;
    if (d && d.pendingScale !== null) {
      this.setRenderScale(d.pendingScale);
      d.pendingScale = null;
    }

    // Render scene, shaken if a screen shake runs
    const probe = this.frameProbe;
    probe?.begin();
    this.gpuMeter.begin();
    this.drawFrame();
    this.gpuMeter.end();
    probe?.end();
    if (this.dynamic && !this.dynamicPaused) this.followFrameCost(this.dynamic);

    // Put a benchmark-moved camera back, then release the frame waiters
    // (warm-up): they only ever see the still camera and projection.
    bench?.endFrame(performance.now(), this.camera, tilesMs, this.tilesTraversalCount() !== traversalsBefore);
    this.renderLoop.frameRendered();
  }

  /**
   * Draw the scene (through the composer if any post-processing is active),
   * shaken if a screen shake runs.
   *
   * The shake offsets the projection matrix in screen space for this draw
   * only and puts the exact matrices back afterwards, so the tiles update
   * before it and every raycast between frames see the still camera. Until
   * 2026-09-12 the shake moved camera.position instead: UpdateOnChangePlugin
   * compares the view-projection matrix exactly, so every shaken frame ran
   * the full tile traversal, and tower placement raycast from a shaking
   * camera.
   */
  private drawFrame(): void {
    const amplitude = this.screenShake.amplitudeAt(performance.now());
    const camera = this.camera;
    if (amplitude > 0) {
      this.unshakenProjection.copy(camera.projectionMatrix);
      this.unshakenProjectionInverse.copy(camera.projectionMatrixInverse);
      // amplitude is a share of the view height; NDC spans 2 over the height
      // and over the width, so X is divided by the aspect for equal pixels
      const ndcY = (Math.random() * 2 - 1) * amplitude * 2;
      const ndcX = ((Math.random() * 2 - 1) * amplitude * 2) / camera.aspect;
      offsetProjection(camera.projectionMatrix, ndcX, ndcY);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    }

    if (this.postProcessing?.needsRender()) {
      this.postProcessing.render();
    } else {
      this.renderer.render(this.scene, camera);
    }

    if (amplitude > 0) {
      camera.projectionMatrix.copy(this.unshakenProjection);
      camera.projectionMatrixInverse.copy(this.unshakenProjectionInverse);
    }
  }

  /**
   * Traversals the tiles renderer has run. TilesRendererBase bumps its
   * (untyped) frameCount once per traversal and not when
   * UpdateOnChangePlugin skips one. Only the shake benchmark reads it.
   */
  private tilesTraversalCount(): number {
    return this.world.tiles?.traversalCount() ?? 0;
  }

  /**
   * Update game entities (call before render).
   * - Enemy walking animation runs in GAME-TIME so feet match foot-speed at
   *   every training timescale (sub-stepping is invisible at the renderer).
   * - Tower visuals (selection ring, magic hover, GLTF mixer) run in real-time;
   *   the turret aim is simulation state (Tower.aim), turned per sub-step in
   *   GameStateManager.runSubStep; the tower renderer only draws it.
   */
  update(deltaTime: number): void {
    // Phase 5.14: Gameplay MUST run even in headless mode, it's driven by
    // `onUpdateCallback` (game-loop-facade → GameStateManager sub-step loop).
    // All other work here is purely visual and gets skipped when rendering
    // is disabled.
    if (this.onUpdateCallback) {
      this.onUpdateCallback(deltaTime);
    }

    if (!this._renderingEnabled) return;

    // After the game moved its camera, before anything is drawn for it
    for (const hook of this.frameHooks) hook();

    const realDeltaSeconds = deltaTime / 1000;
    const gameDeltaSeconds = realDeltaSeconds * this.gameTimescale;

    // Enemy animation walks at game-time → feet stay synced with ground speed
    this.enemies.updateAnimations(gameDeltaSeconds, this.camera);

    // Tower visuals only (selection ring pulse, magic hover, GLTF mixer LOD)
    this.towers.updateAnimations(deltaTime, this.camera);
    // Scaffolds count the build down in game time (Tower.builtAtMs)
    this.towers.updateBuilds(gameDeltaSeconds * 1000);

    // Veteran badges face the camera; their size is set in CSS pixels. The
    // drawing buffer's height, not clientHeight, which could force a layout
    this.towerBadges.update(this.camera, this.renderer.domElement.height / this.renderer.getPixelRatio());

    // Commit projectile instance changes to GPU
    this.projectiles.commitToGPU();

    // Update projectile shader uniforms (for animated shaders like magic orb)
    this.projectiles.updateShaderUniforms(performance.now() / 1000);

    // Update particle effects
    this.effects.update(deltaTime);

    // Update GPU-instanced floating texts (needs camera for billboard orientation)
    this.effects.updateFloatingTexts(this.camera);

    // Update flame beam shader animations
    this.flameBeams.update(deltaTime);

    // Update tentacle animations
    this.tentacles.update(deltaTime, this.camera.position);

    // Rebuild trail streak geometries
    this.trailStreaks.updateAll(this.enemies.stateLerp.uniform.value);

    // Tick lightning bolt shader clocks and spawn idle-crackle micro-bolts
    this.lightningBolts.update(performance.now() / 1000);

    // Strike markers: the countdown runs in game time, the pulse in real time
    this.abilityMarkers.update(deltaTime, gameDeltaSeconds * 1000);

    // Mushroom clouds run in game time: a pause (timescale 0) holds them
    this.mushroomClouds.update(gameDeltaSeconds * 1000, this.camera);
    // Their flash kicks the bloom, where bloom is on
    this.postProcessing?.setBloomKick(this.mushroomClouds.bloomKick, MUSHROOM_CLOUD_LOOK.bloomKick);
    // The missile flies in game time too, onto the impact the simulation counts down to
    this.missileLaunches.update(gameDeltaSeconds * 1000, this.camera);
    // Frost bursts run in game time as well
    this.frostBursts.update(gameDeltaSeconds * 1000, this.camera, this.renderer.domElement.height);
    this.empPulses.update(gameDeltaSeconds * 1000, this.camera, this.renderer.domElement.height);
    this.orbitalBeams.update(gameDeltaSeconds * 1000, this.camera, this.renderer.domElement.height);

    // The oozes' slime wobbles and sinks away in game time
    this.oozes.animate(gameDeltaSeconds * 1000);

    // Blood moon on wall time while the game runs; a pause holds it
    this.bloodMoon.update(deltaTime, this.gameTimescale > 0, this.postProcessing?.needsRender() ?? false);

    // Hero: his animation in game time, the selection pulse in real time
    this.hero.update(deltaTime, gameDeltaSeconds * 1000);
    for (const partner of this.partnerHeroes) partner.update(deltaTime, gameDeltaSeconds * 1000);

    // Screen shake is applied in render() (drawFrame), not to the camera
  }

  /**
   * Get Three.js scene
   */
  getScene(): Scene {
    return this.scene;
  }

  /**
   * Get overlay group for markers, streets, routes
   * Objects added here use local coordinates (X=East, Y=Up, Z=-North)
   */
  getOverlayGroup(): Group {
    return this.overlayGroup;
  }

  /**
   * Lazy-getter für den shared TowerShadowMapper. Erste Anforderung
   * instanziiert (passiert in Tower-Placement-Service / TowerManager-
   * Selection, nicht beim Engine-Boot, um die Initialisierung schlank
   * zu halten).
   */
  getTowerShadowMapper(): TowerShadowMapper {
    if (!this.towerShadowMapper) {
      this.towerShadowMapper = new TowerShadowMapper(this.renderer, this.scene);
    }
    return this.towerShadowMapper;
  }

  /**
   * Group die bei einem Cube-Render als `includeOnly` durchgereicht
   * wird: die der Welt (WorldProvider.losBlockers), ein direktes Kind der
   * Szene. Der TowerShadowMapper hidet alle Scene-Children außer diesem.
   */
  getLosBlockerGroup(): Object3D | null {
    return this.world.losBlockers();
  }

  /**
   * Toggle 3D tiles visibility (for debugging particle rendering issues)
   * When hidden, tiles are removed from scene but still update in background
   */
  setTilesVisible(visible: boolean): void {
    this.world.tiles?.setVisible(visible);
  }

  /** Check if 3D tiles are currently visible; false in a world without them */
  areTilesVisible(): boolean {
    return this.world.tiles?.visible() ?? false;
  }

  /** Call `probe` around every frame's draw (the render benchmark's counters); null takes it off */
  setFrameProbe(probe: FrameProbe | null): void {
    this.frameProbe = probe;
  }

  /**
   * Draw at a quality level (render-quality.ts): the general part here
   * (resolution, antialiasing, whether bloom may run), the rest by the
   * world (custom maps: shadows, detail, grass; tiles: their detail target)
   */
  applyQuality(knobs: QualityKnobs, world: QualityWorld): void {
    const previous = this.quality;
    this.quality = { knobs, world };
    this.dynamic?.gpu?.close();
    const range = knobs.general.dynamic;
    this.dynamic = range
      ? { controller: new DynamicResolution(knobs.general.scale, range), gpu: this.gpuMeter.open(), gpuTimes: [], intervals: [], lastFrameAt: 0, windowStart: performance.now(), pendingScale: null }
      : null;
    // Another level or part of one while the world stands: its programs (point lights, the output
    // through the composer, a map effect switched) compile off the main thread before the next draw,
    // instead of linking in it. The canvas keeps the last picture meanwhile; a new resolution resized
    // (and so cleared) it at once, and the frames held back showed black for the seconds of the compile
    const recompile = !!previous && JSON.stringify(previous.knobs) !== JSON.stringify(knobs) && !this.disposed;
    if (!recompile) this.setRenderScale(knobs.general.scale);
    this.postProcessing?.setAntialias(knobs.general.antialias, this.canvasMsaa);
    this.postProcessing?.setBloomEnabled(this.bloomWanted && knobs.general.bloom);
    this.world.applyQuality?.(knobs);
    if (recompile) {
      void this.qualityCompile
        .hold(() => this.compilingForOutput(() => this.renderer.compileAsync(this.scene, this.camera)))
        .then(() => {
          if (this.quality?.knobs === knobs && !this.disposed) this.setRenderScale(knobs.general.scale);
        });
    }
  }

  /** A frame that drew nothing: its interval tells the display's pace (DisplayRefresh) */
  private idleFrame(): void {
    const now = performance.now();
    if (this.idleFrameAt > 0) this.displayRefresh.add(now - this.idleFrameAt);
    this.idleFrameAt = now;
  }

  /** The graphics benchmark: the resolution stays at the level's start while it measures */
  setDynamicResolutionPaused(paused: boolean): void {
    this.dynamicPaused = paused;
    if (this.dynamic) this.dynamic.pendingScale = null;
    if (paused && this.quality) this.setRenderScale(this.quality.knobs.general.scale);
  }

  /** The render resolution now, as a share of the level's pixel ratio; 1 without a level */
  renderScale(): number {
    return this.dynamic?.controller.scale ?? this.quality?.knobs.general.scale ?? 1;
  }

  private setRenderScale(scale: number): void {
    const q = this.quality;
    if (!q) return;
    if (this.dynamic) this.dynamic.controller.scale = scale;
    const ratio = pixelRatioFor(q.knobs, q.world, window.devicePixelRatio, scale);
    if (Math.abs(ratio - this.renderer.getPixelRatio()) < 1e-3) return;
    this.renderer.setPixelRatio(ratio);
    this.fitToCanvas();
  }

  /**
   * One frame of the dynamic resolution: its interval and GPU times, and
   * once a second with enough of them the controller's answer, which the
   * next frame applies before it draws (render). A gap over a second (a
   * hidden tab, a load) is no frame cost
   */
  private followFrameCost(d: NonNullable<ThreeTilesEngine['dynamic']>): void {
    const now = performance.now();
    if (d.lastFrameAt > 0 && now - d.lastFrameAt < 1000) d.intervals.push(now - d.lastFrameAt);
    d.lastFrameAt = now;
    if (d.gpu) d.gpuTimes.push(...d.gpu.take());
    const costs = d.gpu ? d.gpuTimes : d.intervals;
    if (now - d.windowStart < 1000 || costs.length < MIN_SAMPLES) return;
    d.windowStart = now;
    const scale = d.controller.evaluate(costs, d.gpu ? 'gpu' : 'interval', this.displayRefresh.interval);
    d.intervals.length = 0;
    d.gpuTimes.length = 0;
    if (scale !== null) d.pendingScale = scale;
  }

  /**
   * Get Three.js renderer
   */
  getRenderer(): WebGLRenderer {
    return this.renderer;
  }

  /**
   * Get camera
   */
  getCamera(): PerspectiveCamera {
    return this.camera;
  }

  /**
   * Get the active camera controls (GlobeControls in the tiles path,
   * EnvironmentControls in DevWorld, both share the same base class).
   *
   * Needed by scripted camera moves (intro flight) which take over the
   * camera for the duration of the move: setting `controls.enabled = false`
   * clears inertia + pending state and makes `controls.update()` a no-op,
   * so manual per-frame camera writes are not fought. Re-enabling resets
   * the control state, which re-derives the pivot from the camera.
   */
  getControls(): GlobeControls | null {
    return this.cameraRig.getControls();
  }

  /**
   * Tile loading statistics: renderer counters, active and visible tiles,
   * cache size. Cached and updated every 500ms for performance.
   */
  getTileStats(): TileStats {
    return this.world.tiles?.tileStats() ?? NO_TILE_STATS;
  }

  /** The credits of the map on screen, the world's (WorldProvider.attribution) */
  getAttributions(): string[] {
    return this.world.attribution();
  }

  /**
   * Hand the VFX settings to the renderers and the post-processing
   * pipeline. An effect that is off is neither spawned nor drawn, and a
   * post pass that is off leaves the pipeline (with both off the scene is
   * drawn without the composer). Visual only: game logic never reads them.
   */
  applyVfxSettings(settings: import('./vfx-settings').VfxSettings): void {
    this.effects.setVfxSettings(settings);
    this.mushroomClouds.setFullCloud(settings.impactEffects);
    this.missileLaunches.setFull(settings.impactEffects);
    this.frostBursts.setFull(settings.impactEffects);
    this.empPulses.setFull(settings.impactEffects);
    this.orbitalBeams.setFull(settings.impactEffects);
    this.trailStreaks.setEnabled(settings.projectileTrails);
    this.towers.setMuzzleFlashEnabled(settings.muzzleFlash);
    this.enemies.setFreezeTintEnabled(settings.freezeTint);
    // The quality level may hold bloom off (Low)
    this.bloomWanted = settings.bloom;
    this.postProcessing?.setBloomEnabled(settings.bloom && (this.quality?.knobs.general.bloom ?? true));
    this.postProcessing?.setColorGradingPreset(settings.colorGrading);
    this.bloodMoon.setEnabled(settings.bloodMoon);
  }

  // ---- Render diagnostics (__bloom, PerformanceProfilerService) ----

  /** Mark NaN and infinite pixels of the frame (PostProcessingPipeline.setPixelMarks). false without the pipeline. */
  setPixelMarks(on: boolean): boolean {
    if (!this.postProcessing) return false;
    this.postProcessing.setPixelMarks(on);
    return true;
  }

  /** The bloom's NaN guard on or off (PostProcessingPipeline.setBloomGuard). false without the pipeline. */
  setBloomGuard(on: boolean): boolean {
    if (!this.postProcessing) return false;
    this.postProcessing.setBloomGuard(on);
    return true;
  }

  // ---- Color Grading (LUT) ----

  setColorGradingPreset(preset: ColorGradingPreset): void {
    this.postProcessing?.setColorGradingPreset(preset);
  }

  getColorGradingPreset(): ColorGradingPreset {
    return this.postProcessing?.getColorGradingPreset() ?? 'none';
  }

  setColorGradingIntensity(value: number): void {
    this.postProcessing?.setColorGradingIntensity(value);
  }

  /**
   * Run `work` with every compileAsync of the renderer compiling for the
   * output the frames draw to. A program differs by its output: through the
   * composer (FXAA of the Low and Medium levels, bloom, grading) a linear
   * target, else the screen in sRGB; compiled for the screen, every program
   * linked again in the first frame through the composer (demo valley: 157
   * programs, some 50 of them twice). Only the synchronous part of each call
   * sees the target, so no frame in between draws into it.
   */
  private async compilingForOutput<T>(work: () => Promise<T>): Promise<T> {
    if (!this.postProcessing?.needsRender()) return work();
    const renderer = this.renderer;
    const target = new WebGLRenderTarget(1, 1);
    const original = renderer.compileAsync;
    renderer.compileAsync = (scene, camera, targetScene) => {
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      try {
        return original.call(renderer, scene, camera, targetScene);
      } finally {
        renderer.setRenderTarget(previous);
      }
    };
    try {
      return await work();
    } finally {
      renderer.compileAsync = original;
      target.dispose();
    }
  }

  /**
   * Preload all entity models, then compile the shaders of everything in the
   * scene (enemy, projectile, particle and VFX pools) during loading.
   */
  async preloadModels(): Promise<void> {
    await Promise.all([
      this.enemies.preloadAllModels(),
      this.towers.preloadAllModels(),
      this.projectiles.whenLoaded(),
    ]);
    const warmup = await this.compilingForOutput(async () => {
      await this.towers.precompile(this.renderer, this.camera);
      if (this.disposed) return null;
      await this.plinths.precompile(this.renderer, this.camera);
      if (this.disposed) return null;
      return warmUpScene(this.renderer, this.scene, this.camera, () => this.renderLoop.waitForRenderedFrame());
    });
    if (!warmup) return;
    console.log(
      `[Warmup] ${warmup.newPrograms} new shader programs, ` +
      `compile ${warmup.syncMs.toFixed(1)} ms on the main thread, ` +
      `ready after ${warmup.compileMs.toFixed(1)} ms; ` +
      `${warmup.pools} empty pools drawn for one frame (${warmup.frameMs.toFixed(1)} ms)`
    );
  }

  /**
   * Dispose all resources
   */
  /** A coop partner's hero on the map (review R15); gone with disposePartnerHero */
  createPartnerHero(): HeroRenderer {
    const view = new HeroRenderer(this.scene, this.coordinateSync, this.assetManager ?? null);
    view.stateLerp = this.enemies.stateLerp;
    this.partnerHeroes.add(view);
    return view;
  }

  disposePartnerHero(view: HeroRenderer): void {
    if (!this.partnerHeroes.delete(view)) return;
    view.dispose();
  }

  dispose(): void {
    this.disposed = true;
    this.dynamic?.gpu?.close();
    this.dynamic = null;
    this.gpuMeter.dispose();
    this.dive.dispose();
    this.renderLoop.dispose();
    this.canvasSize.dispose();

    // Remove event listeners to prevent memory leaks
    this.cameraRig.dispose();

    // Dispose GPU-LOS resources
    if (this.towerShadowMapper) {
      this.towerShadowMapper.dispose();
      this.towerShadowMapper = null;
    }

    // Dispose entity renderers
    this.enemies.dispose();
    this.towers.dispose();
    this.plinths.dispose();
    this.towerBadges.dispose();
    this.projectiles.dispose();
    this.effects.dispose();
    this.flameBeams.dispose();
    this.tentacles.dispose();
    this.trailStreaks.dispose();
    this.lightningBolts.dispose();
    this.abilityMarkers.dispose();
    // Before the clouds, whose sprite materials it shares
    this.missileLaunches.dispose();
    this.mushroomClouds.dispose();
    this.oozes.dispose();
    this.searchlights.dispose();
    this.bloodMoon.dispose();
    this.hero.dispose();
    for (const partner of this.partnerHeroes) partner.dispose();
    this.partnerHeroes.clear();
    this.frostBursts.dispose();
    this.empPulses.dispose();
    this.orbitalBeams.dispose();

    // Dispose spatial audio
    this.spatialAudio.dispose();

    // The world: tiles renderer and load listeners, DevWorld's generation
    // worker and raycast-only meshes outside the scene graph (nothing else
    // disposes those; every engine teardown leaked one before)
    this.world.dispose();

    // Dispose scene contents
    this.scene.traverse((obj) => {
      if ((obj as Mesh).geometry) {
        (obj as Mesh).geometry.dispose();
      }
      if ((obj as Mesh).material) {
        const mat = (obj as Mesh).material;
        if (Array.isArray(mat)) {
          mat.forEach((m) => m.dispose());
        } else {
          mat.dispose();
        }
      }
    });

    // Dispose post-processing pipeline (composer + color grading LUT textures)
    if (this.postProcessing) {
      this.postProcessing.dispose();
      this.postProcessing = null;
    }

    // The sky cube is the scene background, the traverse above does not reach it
    this.sky?.dispose();

    // Dispose renderer
    this.renderer.dispose();
    this.restoreGLDeletes();
  }
}
