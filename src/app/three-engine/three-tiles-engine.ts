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
  MathUtils,
  Matrix4,
} from 'three';
import type { TilesRenderer, GlobeControls } from '3d-tiles-renderer';
import {
  DebugTilesPlugin,
  type ReorientationPlugin,
  type LoadRegionPlugin,
  type ColorMode,
} from '3d-tiles-renderer/plugins';
import { ColorGradingPreset } from './post-processing/color-grading';
import { PostProcessingPipeline } from './post-processing/post-processing-pipeline';
import { CameraRig } from './camera-rig';
import { TileLoadingTracker, type TileStats } from './tile-loading-tracker';
import { EllipsoidSync } from './ellipsoid-sync';
import { RenderLoop } from './render-loop';
import { CanvasSizeFollower } from './canvas-size-follower';
import { TerrainQueries } from './terrain-queries';
import { SkyBackground, addSceneLights } from './scene-environment';
import { ScreenPicker } from './screen-picker';
import { applyStreamingBudget, createTilesRenderer } from './tiles-renderer-setup';
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
import { TowerPlinthRenderer } from './renderers/tower-plinth/tower-plinth.renderer';
import { TowerBadgeRenderer } from './renderers/tower-badge/tower-badge.renderer';
import { AbilityMarkerRenderer } from './renderers/ability-marker.renderer';
import { MushroomCloudRenderer } from './renderers/mushroom-cloud.renderer';
import { OozeBandRenderer } from './renderers/ooze/ooze-band.renderer';
import { BloodMoonLook } from './blood-moon/blood-moon-look';
import { BloodMoonMood } from './blood-moon/blood-moon-mood';
import { SearchlightRenderer } from './renderers/searchlight/searchlight.renderer';
import { HeroRenderer } from './renderers/hero.renderer';
import { FrostBurstRenderer } from './renderers/frost-burst.renderer';
import { SpatialAudioManager } from '../managers/audio/spatial-audio.manager';
import { AssetManagerService } from '../services/infrastructure/asset-manager.service';
import { DevWorldService } from '../devworld/devworld.service';
import { TerrainProvider } from '../interfaces/terrain-provider.interface';
import { DevTerrainProvider } from '../devworld/dev-terrain.provider';
import { TowerShadowMapper } from './tower-shadow-mapper';
import { RouteCorridorRegion } from './route-corridor-region';
import { warmUpScene } from './scene-warmup';
import { logTileMaterialTypes } from './tile-material-log';
import { instrumentRaycasts } from '../utils/raycast-stats';
import { ScreenShake, offsetProjection } from './screen-shake';
import { ShakeBenchmark, type ShakeBenchResult } from './screen-shake-benchmark';
import { MUSHROOM_CLOUD_LOOK, SCREEN_SHAKE_CONFIG } from '../configs/visual-effects.config';
import type { GeoPosition } from '../models/game.types';

/**
 * Route corridor load region, see {@link RouteCorridorRegion}. The half width
 * reaches past the 7 m cell corridor; tile bounding spheres add their radius.
 */
const ROUTE_CORRIDOR_HALF_WIDTH = 20;
/**
 * Geometric error in metres the corridor refines to. The camera's 20 px budget
 * reaches about 9 m at 400 m distance, so 5 m is one LOD step finer than what
 * the player sees up close. Tune against the route grid's `err=` log.
 */
const ROUTE_CORRIDOR_ERROR_TARGET = 5;

/**
 * Top of the LOD debug color scale, in metres of geometric error. The auto
 * scale spans the whole hierarchy up to the root's kilometres and paints every
 * loaded tile the same black. At 20 m, the 5 m corridor tiles read dark.
 */
const TILE_LOD_DEBUG_MAX_ERROR = 20;

/**
 * ThreeTilesEngine - Main Three.js rendering engine for Tower Defense
 *
 * Uses 3DTilesRendererJS (NASA JPL) to render Cesium Ion 3D Tiles
 * directly in Three.js.
 *
 * Key advantages:
 * - Single WebGL context - automatic depth occlusion for all objects
 * - Native Three.js raycasting against 3D tiles
 * - Simpler coordinate transformations
 */
export class ThreeTilesEngine {
  private renderer: WebGLRenderer;
  private scene: Scene;
  private camera: PerspectiveCamera;
  // GlobeControls/EnvironmentControls + Startposition der Kamera
  private readonly cameraRig: CameraRig;
  // First-Load-Erkennung, Debounce, Retry, Auth-Fehler, Tile-Stats
  private readonly tileLoading: TileLoadingTracker;
  private tilesRenderer: TilesRenderer | null = null;
  private reorientationPlugin: ReorientationPlugin | null = null;
  private routeRegions: LoadRegionPlugin | null = null;
  private tileLodDebug: DebugTilesPlugin | null = null;

  // Post-processing pipeline (composer + bloom + color grading + output pass)
  private postProcessing: PostProcessingPipeline | null = null;

  // Scene background, the image arrives after the constructor
  private readonly sky: SkyBackground;
  // Set by dispose(); preloadModels() skips the shader warm-up then
  private disposed = false;

  // Game speed multiplier for animations (turret rotation etc.)
  private gameTimescale = 1.0;
  /** Phase 5.14: headless mode, skips all per-frame rendering work. */
  private _renderingEnabled = true;

  // DevWorld support
  private devWorld: DevWorldService | null = null;
  private devTerrainProvider: TerrainProvider | null = null;

  // Coordinate sync
  readonly sync: EllipsoidSync;

  /**
   * Terrain and tile raycasts: ground columns with their cache, street
   * clearance, line of sight, tile-LOD peek. Reached as `engine.terrain`.
   */
  readonly terrain: TerrainQueries;

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
  /** Bodies of the oozes along the route, see OozeBodies */
  readonly oozes: OozeBandRenderer;
  /** Searchlights on the towers, lit by the blood moon */
  readonly searchlights: SearchlightRenderer;
  /** Look of the blood moon waves, switched by BloodMoonService */
  readonly bloodMoon: BloodMoonLook;
  readonly hero: HeroRenderer;
  readonly frostBursts: FrostBurstRenderer;

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

  // Track initial tiles position to calculate movement delta
  private initialTilesPos = new Vector3();
  /** Reused scratch for the per-frame overlay-sync delta (avoids clone()). */
  private readonly _overlayDelta = new Vector3();
  private tilesPosInitialized = false;

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

  // Callback for per-frame updates (animations)
  private onUpdateCallback: ((deltaTime: number) => void) | null = null;

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

  // Tile provider credentials
  private cesiumIonToken: string;
  private cesiumAssetId: string;
  private tileProvider: 'cesium' | 'google';
  private googleMapsApiKey: string;


  constructor(
    canvas: HTMLCanvasElement,
    cesiumIonToken: string,
    cesiumAssetId: string,
    originLat: number,
    originLon: number,
    originHeight = 0,
    private assetManager?: AssetManagerService,
    devWorldService?: DevWorldService,
    tileProvider: 'cesium' | 'google' = 'cesium',
    googleMapsApiKey = '',
  ) {
    // Store DevWorld service reference
    this.devWorld = devWorldService ?? null;
    this.cesiumIonToken = cesiumIonToken;
    this.cesiumAssetId = cesiumAssetId;
    this.tileProvider = tileProvider;
    this.googleMapsApiKey = googleMapsApiKey;

    // Initialize coordinate sync
    this.sync = new EllipsoidSync(originLat, originLon, originHeight);

    // Terrain and tile raycasts. They read tilesRenderer and devTerrainProvider,
    // which initialize() sets.
    this.terrain = new TerrainQueries(this.sync, {
      tiles: () => this.tilesRenderer,
      devTerrain: () => this.devTerrainProvider,
    });

    // Create WebGL renderer with error handling
    try {
      this.renderer = new WebGLRenderer({
        canvas,
        antialias: true,
        // Required for the 1m..8000m depth range over the 3D tiles (kept to
        // avoid far-field z-fighting). The remaining flags are pure wins:
        logarithmicDepthBuffer: true,
        powerPreference: 'high-performance', // prefer dGPU on hybrid laptops
        stencil: false, // no stencil buffer in use → save bandwidth
      });
    } catch {
      throw new Error('WebGL is not supported. Enable hardware acceleration in your browser.');
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x151c1f);
    this.renderer.outputColorSpace = SRGBColorSpace;

    // Distance limits - keep in sync!
    const VIEW_DISTANCE = 8000; // Max tile loading distance
    const FOG_START = VIEW_DISTANCE * 0.25; // 2000m - fog begins
    const FOG_END = VIEW_DISTANCE * 0.75; // 6000m - fully in fog

    // Create scene with distance fog
    this.scene = new Scene();
    const fogColor = 0x1a1f25; // Slightly lighter than background for depth
    this.scene.fog = new Fog(fogColor, FOG_START, FOG_END);

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

    // Lade-Events hängen sich erst in initialize() an den TilesRenderer
    this.tileLoading = new TileLoadingTracker(this.camera, this.renderer, {
      probeOriginGround: () => this.terrain.raycastTerrainHeight(0, 0, 'tileProbe'),
      onTileSetSettled: () => this.onTileSetSettled(),
    });

    // Setup lighting and sky
    addSceneLights(this.scene);
    this.sky = new SkyBackground(this.renderer, this.scene);

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

    this.enemies = new InstancedEnemyRenderer(this.scene, coordinateSync, this.assetManager);
    // A restored WebGL context comes back empty and three uploads every texture
    // again from its CPU copy, which the VATs drop after their first upload.
    this.enemies.rebakeOnContextRestore(this.renderer.domElement);
    this.towers = new ThreeTowerRenderer(this.scene, coordinateSync, this.assetManager);
    this.plinths = new TowerPlinthRenderer(this.scene, coordinateSync);
    this.towerBadges = new TowerBadgeRenderer(this.scene, (id) => this.towers.get(id)?.mesh ?? null);
    this.projectiles = new ThreeProjectileRenderer(this.scene, coordinateSync);
    this.effects = new ThreeEffectsRenderer(this.scene, coordinateSync);
    this.flameBeams = new ThreeFlameBeamRenderer();
    this.flameBeams.setEffectsRenderer(this.effects);
    this.tentacles = new ThreeTentacleRenderer(this.scene);
    this.trailStreaks = new TrailStreakRenderer(this.scene);
    this.lightningBolts = new LightningBoltRenderer(this.scene);
    this.abilityMarkers = new AbilityMarkerRenderer(this.scene);
    this.mushroomClouds = new MushroomCloudRenderer(this.scene, this.effects.particleShaderMaterials);
    this.oozes = new OozeBandRenderer(this.scene);
    this.searchlights = new SearchlightRenderer(this.scene, coordinateSync);
    // Takes the fog colour set above as the one to return to
    this.bloodMoon = new BloodMoonLook({
      mood: new BloodMoonMood(this.scene),
      enemies: this.enemies,
      searchlights: this.searchlights,
      oozes: this.oozes,
    });
    this.hero = new HeroRenderer(this.scene, coordinateSync, this.assetManager);
    this.frostBursts = new FrostBurstRenderer(this.scene, this.effects.particleShaderMaterials);

    // Initialize spatial audio with camera listener
    this.spatialAudio = new SpatialAudioManager(this.scene, this.camera);
    this.spatialAudio.setGeoToLocal((lat, lon, height) =>
      this.sync.geoToLocalSimple(lat, lon, height)
    );

    // Screen picking against the tiles (DevWorld: its terrain) and the tower
    // meshes; a plinth picks the tower on it
    const pickableTowers = {
      getAllMeshes: () => [...this.towers.getAllMeshes(), ...this.plinths.getAllMeshes()],
    };
    this.picker = new ScreenPicker(this.camera, this.renderer, pickableTowers, {
      tiles: () => this.tilesRenderer,
      devTerrain: () => this.devTerrainProvider,
    });

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
    if (this.devTerrainProvider) {
      return Promise.reject(new Error('The shake benchmark measures the 3D tiles; DevWorld has none'));
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
   * Initialize 3D Tiles (async - must be called after constructor)
   */
  async initialize(): Promise<void> {
    // ========================================
    // DEVWORLD MODE - Use fake terrain instead of Google 3D Tiles
    // ========================================
    if (this.devWorld?.isActive) {
      console.log('[ThreeTilesEngine] DevWorld mode active - using fake terrain');
      await this.initializeDevWorld();
      return;
    }

    // ========================================
    // NORMAL MODE - Load Google 3D Tiles
    // ========================================

    // TilesRenderer with the auth, streaming, reorientation and region
    // plugins, group rotated to Y-up
    const tiles = createTilesRenderer({
      provider: this.tileProvider,
      googleMapsApiKey: this.googleMapsApiKey,
      cesiumIonToken: this.cesiumIonToken,
      cesiumAssetId: this.cesiumAssetId,
      origin: this.sync.getOrigin(),
    });
    this.tilesRenderer = tiles.tilesRenderer;
    this.reorientationPlugin = tiles.reorientationPlugin;
    this.routeRegions = tiles.routeRegions;

    // Add to scene
    this.scene.add(this.tilesRenderer.group);

    // overlayGroup is already in scene (added in constructor)
    // We'll sync its position with tiles movement in render()

    // Update sync with tiles renderer reference
    this.sync.setTilesRenderer(this.tilesRenderer);

    // Setup camera and controls
    this.cameraRig.setupGlobeControls(this.scene, this.tilesRenderer);

    // Configure tiles renderer
    this.tilesRenderer.setResolutionFromRenderer(this.camera, this.renderer);
    this.tilesRenderer.setCamera(this.camera);

    // Refinement error, distance falloff, download and parse queues, LRU cache
    applyStreamingBudget(this.tilesRenderer);

    // tiles-load-end (first load, debounce), load-tileset, load-error (auth)
    this.tileLoading.attach(this.tilesRenderer);

    // R10: do the tile materials run the scene lights? Logged once per type.
    logTileMaterialTypes(this.tilesRenderer);

    // Every raycast into the tiles is timed per caller, see `__raycastStats()`.
    instrumentRaycasts(this.tilesRenderer.group);

    // Set up terrain height sampler for tower range indicators (legacy)
    this.towers.setTerrainHeightSampler((lat, lon) => this.terrain.getTerrainHeightAtGeo(lat, lon));

    // Set up direct terrain raycaster for accurate terrain-conforming range indicators
    // This raycasts directly at local X,Z coordinates for exact terrain mesh intersection
    this.towers.setTerrainRaycaster((localX, localZ) => this.terrain.raycastTerrainHeight(localX, localZ, 'towerRange'));

    // Set up Line-of-Sight raycaster for visibility checks
    // Returns true if line of sight is BLOCKED
    this.towers.setLineOfSightRaycaster((ox, oy, oz, tx, ty, tz) =>
      this.terrain.raycastLineOfSight(ox, oy, oz, tx, ty, tz)
    );

  }

  /** DevWorld group - contains terrain directly at local coordinates */
  private devWorldGroup: Group | null = null;

  /**
   * Initialize DevWorld mode with fake terrain
   * Called instead of normal TilesRenderer initialization when ?devworld is set
   *
   * DevWorld uses EnvironmentControls (not GlobeControls) because:
   * - GlobeControls is designed for navigating around a globe at Earth-radius distances
   * - DevWorld has flat terrain at local origin (0,0,0)
   * - EnvironmentControls raycasts against scene geometry and works with local coordinates
   */
  private async initializeDevWorld(): Promise<void> {
    if (!this.devWorld) return;

    // Create devWorldGroup - simple group at local origin (no ECEF transformation)
    // This is different from real game where tilesRenderer.group has inverse ENU
    this.devWorldGroup = new Group();
    this.devWorldGroup.name = 'DevWorldGroup';
    this.scene.add(this.devWorldGroup);

    // Create and initialize terrain provider
    this.devTerrainProvider = new DevTerrainProvider(this.devWorld);

    // Initialize terrain directly into devWorldGroup (no nested transforms)
    // Terrain is at local coordinates: Y-up, centered at origin
    await this.devTerrainProvider.initialize(this.devWorldGroup as unknown as Scene);

    // Setup EnvironmentControls - works with flat local terrain
    this.cameraRig.setupEnvironmentControls(this.scene, this.devWorldGroup);

    // Set up terrain height sampler for tower range indicators
    this.towers.setTerrainHeightSampler((lat, lon) => this.terrain.getTerrainHeightAtGeo(lat, lon));

    // Set up direct terrain raycaster
    this.towers.setTerrainRaycaster((localX, localZ) => this.terrain.raycastTerrainHeight(localX, localZ, 'towerRange'));

    // Set up Line-of-Sight raycaster
    this.towers.setLineOfSightRaycaster((ox, oy, oz, tx, ty, tz) =>
      this.terrain.raycastLineOfSight(ox, oy, oz, tx, ty, tz)
    );

    // Mark as loaded immediately (no async tile loading in DevWorld)
    this.tileLoading.markFirstTilesLoaded();
  }

  /**
   * Called by the {@link TileLoadingTracker} on every settled tiles-load-end,
   * after its first-tiles check.
   */
  private onTileSetSettled(): void {
    // The loaded-tile set has changed, that is true on EVERY settled
    // load-end, not only when the origin column happens to shift.
    //
    // This used to sit behind a 2 m height-delta gate measured at (0,0). LOD refinement anywhere else in the world
    //, the whole enemy corridor, for instance, never moves the origin
    // column, so the tile-info map went stale, `peekBestTileLODAtLocal`
    // reported outdated LODs, `sampleCellY`'s skip gate then refused to
    // re-sample, and the convergence loop spun without healing anything.
    // The same gate also withheld the cubemap invalidation and the route
    // refresh, which is how a route baked during the coarse phase stayed
    // baked (enemies walking at rooftop height in dense cities).
    const tPre0 = performance.now();

    // Bumps `lodVersion`, which is what invalidates individual column
    // samples, no global cache clear needed.
    this.terrain.markTileSetChanged();

    this.towerShadowMapper?.invalidate();
    const tShadowInvalidate = performance.now();

    if (this.onTilesLoadCallback) {
      this.onTilesLoadCallback();
      const tEnd = performance.now();
      console.warn(
        `[PerfTrace] onTilesLoadCallback: ${(tEnd - tPre0).toFixed(1)}ms total | ` +
        `shadowInvalidate=${(tShadowInvalidate - tPre0).toFixed(1)} ` +
        `facadeCallback=${(tEnd - tShadowInvalidate).toFixed(1)}ms ` +
        `(lodVersion=${this.terrain.lodVersion})`
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
   * Register a callback for a rejected tile-server credential.
   * Used to send the player back to the token screen instead of leaving them
   * on a loading indicator that never finishes.
   */
  setOnAuthErrorCallback(callback: () => void): void {
    // Registration usually happens after the tileset request already failed,
    // the tracker replays a remembered error.
    this.tileLoading.setOnAuthError(callback);
  }

  /**
   * Register a callback to be called when first tiles are loaded
   * Used by component to hide "loading tiles" indicator
   */
  setOnFirstTilesLoadedCallback(callback: () => void): void {
    // If tiles already loaded, the tracker calls it immediately
    this.tileLoading.setOnFirstTilesLoaded(callback);
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
    this.sync.setOrigin(lat, lon, height);

    // The corridor was built in the old group frame; the new routes rebuild it.
    this.routeRegions?.clearRegions();

    // Update ReorientationPlugin
    if (this.reorientationPlugin && this.tilesRenderer) {
      this.reorientationPlugin.transformLatLonHeightToOrigin(
        lat * MathUtils.DEG2RAD,
        lon * MathUtils.DEG2RAD,
        height
      );
    }

    // Clear height cache
    this.terrain.clearHeightCache();

    // Cancel pending debounce/retry timers from the previous location and
    // reset first-load, nudge and auth state
    this.tileLoading.reset();

    // CRITICAL: Reset tiles position tracking - otherwise overlay delta calculation
    // will use old location's initialTilesPos and position overlays incorrectly
    this.tilesPosInitialized = false;
    this.initialTilesPos.set(0, 0, 0);

  }

  /**
   * Resize renderer
   */
  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.postProcessing?.setSize(width, height);
    // Drawing-buffer size changed → refresh the tiles renderer resolution here
    // (moved out of the per-frame render() path).
    this.tilesRenderer?.setResolutionFromRenderer(this.camera, this.renderer);
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
   * Get DevTerrainProvider for wiring up street provider.
   * Only available when DevWorld mode is active.
   */
  getDevTerrainProvider(): DevTerrainProvider | null {
    return this.devTerrainProvider as DevTerrainProvider | null;
  }

  /**
   * Ground height at geographic coordinates, in local Y. See
   * {@link TerrainQueries.getTerrainHeightAtGeo}; stays on the engine for
   * its two dozen callers. The other terrain queries are on `terrain`.
   */
  getTerrainHeightAtGeo(lat: number, lon: number): number | null {
    return this.terrain.getTerrainHeightAtGeo(lat, lon);
  }

  /**
   * Keep the enemy route corridor loaded at fine LOD, wherever the camera
   * looks. Without it, route cells outside the view had no tiles to sample
   * and cells seen from afar were baked from coarse ones. Call whenever the
   * routes change; an origin change drops the corridor.
   */
  setRouteCorridor(routes: GeoPosition[][]): void {
    if (!this.tilesRenderer || !this.routeRegions) return;
    const group = this.tilesRenderer.group;
    group.updateMatrixWorld();
    const localRoutes = routes.map((route) =>
      route.map((p) => this.sync.geoToLocalSimple(p.lat, p.lon, p.height ?? 0)),
    );
    this.routeRegions.clearRegions();
    this.routeRegions.addRegion(new RouteCorridorRegion(
      localRoutes, group.matrixWorld, ROUTE_CORRIDOR_HALF_WIDTH, ROUTE_CORRIDOR_ERROR_TARGET,
    ));
    // UpdateOnChangePlugin does not notice region changes on its own.
    this.tilesRenderer.dispatchEvent({ type: 'needs-update' });
  }

  /**
   * Debug: paint tiles black to white by geometric error, white at
   * {@link TILE_LOD_DEBUG_MAX_ERROR} or coarser. Shows whether the route
   * corridor is really refined. The plugin registers on first use.
   */
  setTileLodDebugEnabled(enabled: boolean): void {
    if (!this.tilesRenderer) return;
    if (!this.tileLodDebug) {
      if (!enabled) return;
      this.tileLodDebug = new DebugTilesPlugin({ maxDebugError: TILE_LOD_DEBUG_MAX_ERROR });
      this.tilesRenderer.registerPlugin(this.tileLodDebug);
    } else {
      this.tileLodDebug.enabled = enabled;
    }
    if (enabled) {
      // Disabling resets the color mode to NONE, so it is set on every enable.
      // The typings declare named color-mode exports the module does not have;
      // the modes only exist on the static ColorModes.
      const modes = DebugTilesPlugin.ColorModes as unknown as Record<'GEOMETRIC_ERROR', ColorMode>;
      this.tileLodDebug.colorMode = modes.GEOMETRIC_ERROR;
    }
    // Repaint without waiting for the camera to move.
    this.tilesRenderer.dispatchEvent({ type: 'needs-update' });
  }

  /**
   * Main render loop - call this each frame.
   * Headless-mode: when rendering is disabled, we skip all per-frame visual
   * work (tilesRenderer.update, camera updates, renderer.render, FPS tracking).
   * Gameplay still runs, it's driven by `onUpdateCallback` in `update()`,
   * which is called from the animate loop regardless of rendering state.
   */
  render(): void {
    if (!this._renderingEnabled) return;

    // DevWorld render path
    if (this.devTerrainProvider) {
      // Update controls (if any)
      this.cameraRig.update();

      // Update camera
      this.camera.updateMatrixWorld();

      // Position overlayGroup at terrain base height (no tiles movement in DevWorld)
      this.overlayGroup.position.y = 0;

      // Render scene, shaken if a screen shake runs. drawFrame() has put the
      // unshaken projection back before any frame waiter is released.
      this.drawFrame();
      this.renderLoop.frameRendered();
      return;
    }

    // Normal tiles render path
    if (!this.tilesRenderer) return;

    // Shake benchmark (__perf.shakeBench): its camera-move phase moves the
    // camera, so it starts before controls and tiles see it
    let bench = this.shakeBench;
    if (bench && !bench.beginFrame(performance.now(), this.camera)) {
      bench = this.shakeBench = null;
    }

    // Update controls
    this.cameraRig.update();

    // Force camera far plane to limit tile loading (GlobeControls may override it)
    const VIEW_DISTANCE = 8000;
    if (this.camera.far > VIEW_DISTANCE) {
      this.camera.far = VIEW_DISTANCE;
      this.camera.updateProjectionMatrix();
    }

    // Update tiles. Camera matrix must be current before tilesRenderer.update()
    // reads it for LOD/frustum (controls.update() above moved the camera).
    // setResolutionFromRenderer / setCamera are NOT per-frame work, resolution
    // only changes on resize() and the camera reference is registered once at
    // init (and on the no-tiles nudge); calling them every frame was wasted work.
    this.camera.updateMatrixWorld();

    // UpdateOnChangePlugin skips the traversal while camera and tiles are unchanged.
    const traversalsBefore = bench ? this.tilesTraversalCount() : 0;
    const tilesStart = bench ? performance.now() : 0;
    this.tilesRenderer.update();
    const tilesMs = bench ? performance.now() - tilesStart : 0;

    // Capture initial tiles position only when tiles have loaded (position is non-zero)
    if (!this.tilesPosInitialized) {
      const pos = this.tilesRenderer.group.position;
      // Wait until tilesGroup has a real ECEF position (Y will be negative millions)
      if (Math.abs(pos.y) > 1000000) {
        this.initialTilesPos.copy(pos);
        this.tilesPosInitialized = true;
      }
    }

    // Sync overlayGroup with tiles movement (only after initial pos is captured)
    if (this.tilesPosInitialized) {
      const deltaPos = this._overlayDelta
        .copy(this.tilesRenderer.group.position)
        .sub(this.initialTilesPos);

      // Straight delta on all three axes, the overlay lives in absolute
      // scene-Y now, there is no separate base-terrain offset any more.
      this.overlayGroup.position.copy(deltaPos);
    }

    // Render scene, shaken if a screen shake runs
    this.drawFrame();

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
    return (this.tilesRenderer as unknown as { frameCount?: number } | null)?.frameCount ?? 0;
  }

  /**
   * Update game entities (call before render).
   * - Enemy walking animation runs in GAME-TIME so feet match foot-speed at
   *   every training timescale (sub-stepping is invisible at the renderer).
   * - Tower visuals (selection ring, magic hover, GLTF mixer) run in real-time;
   *   gameplay-affecting turret aim is driven separately per sub-step from
   *   GameStateManager via towers.advanceTurretAim().
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

    const realDeltaSeconds = deltaTime / 1000;
    const gameDeltaSeconds = realDeltaSeconds * this.gameTimescale;

    // Enemy animation walks at game-time → feet stay synced with ground speed
    this.enemies.updateAnimations(gameDeltaSeconds, this.camera);

    // Tower visuals only (selection ring pulse, magic hover, GLTF mixer LOD)
    this.towers.updateAnimations(deltaTime, this.camera);

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
    this.trailStreaks.updateAll();

    // Tick lightning bolt shader clocks and spawn idle-crackle micro-bolts
    this.lightningBolts.update(performance.now() / 1000);

    // Strike markers: the countdown runs in game time, the pulse in real time
    this.abilityMarkers.update(deltaTime, gameDeltaSeconds * 1000);

    // Mushroom clouds run in game time: a pause (timescale 0) holds them
    this.mushroomClouds.update(gameDeltaSeconds * 1000, this.camera, this.renderer.domElement.height);
    // Their flash kicks the bloom, where bloom is on
    this.postProcessing?.setBloomKick(this.mushroomClouds.bloomKick, MUSHROOM_CLOUD_LOOK.bloomKick);
    // Frost bursts run in game time as well
    this.frostBursts.update(gameDeltaSeconds * 1000, this.camera, this.renderer.domElement.height);

    // The oozes' slime wobbles and sinks away in game time
    this.oozes.animate(gameDeltaSeconds * 1000);

    // Blood moon on wall time while the game runs; a pause holds it
    this.bloodMoon.update(deltaTime, this.gameTimescale > 0, this.postProcessing?.needsRender() ?? false);

    // Hero: his animation in game time, the selection pulse in real time
    this.hero.update(deltaTime, gameDeltaSeconds * 1000);

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
   * Get tiles renderer group (for debugging)
   */
  getTilesGroup(): Group | null {
    return this.tilesRenderer?.group ?? null;
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
   * wird. In DevWorld der DevTerrain-Mesh-Container, sonst die
   * 3DTilesRenderer-Group.
   */
  getLosBlockerGroup(): Object3D | null {
    if (this.devWorld?.isActive) {
      // DevWorld: devWorldGroup ist der direkte Scene-Child, der den
      // gesamten DevWorld-Inhalt enthält. Der TowerShadowMapper hidet
      // alle Scene-Children außer dem includeOnly-Argument; ein nested
      // child wie terrainGroup würde versehentlich mit-hidden werden.
      return this.devWorldGroup;
    }
    return this.tilesRenderer?.group ?? null;
  }

  /**
   * Toggle 3D tiles visibility (for debugging particle rendering issues)
   * When hidden, tiles are removed from scene but still update in background
   */
  setTilesVisible(visible: boolean): void {
    if (!this.tilesRenderer) return;

    if (visible) {
      if (!this.tilesRenderer.group.parent) {
        this.scene.add(this.tilesRenderer.group);
      }
    } else {
      if (this.tilesRenderer.group.parent) {
        this.scene.remove(this.tilesRenderer.group);
      }
    }
  }

  /**
   * Check if 3D tiles are currently visible
   */
  areTilesVisible(): boolean {
    // `?.` yields undefined when there is no tiles renderer at all (DevWorld),
    // and `undefined !== null` is true, so this used to claim tiles were
    // visible in a world that has none.
    const group = this.tilesRenderer?.group;
    return !!group && group.parent !== null;
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
    return this.tileLoading.getTileStats();
  }

  /**
   * Get map data attributions from visible tiles
   * Returns aggregated copyright string for display
   */
  getAttributions(): string {
    if (!this.tilesRenderer) return '';

    const attributions = this.tilesRenderer.getAttributions();
    if (!attributions || attributions.length === 0) return '';

    // Filter string attributions and join with semicolon
    const strings = attributions
      .filter((a: { type: string; value: string }) => a.type === 'string')
      .map((a: { type: string; value: string }) => a.value);

    return strings.join('; ');
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
    this.frostBursts.setFull(settings.impactEffects);
    this.trailStreaks.setEnabled(settings.projectileTrails);
    this.towers.setMuzzleFlashEnabled(settings.muzzleFlash);
    this.enemies.setFreezeTintEnabled(settings.freezeTint);
    this.postProcessing?.setBloomEnabled(settings.bloom);
    this.postProcessing?.setColorGradingPreset(settings.colorGrading);
    this.bloodMoon.setEnabled(settings.bloodMoon);
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
   * Preload all entity models, then compile the shaders of everything in the
   * scene (enemy, projectile, particle and VFX pools) during loading.
   */
  async preloadModels(): Promise<void> {
    await Promise.all([
      this.enemies.preloadAllModels(),
      this.towers.preloadAllModels(),
      this.projectiles.whenLoaded(),
    ]);
    await this.towers.precompile(this.renderer, this.camera);
    if (this.disposed) return;
    await this.plinths.precompile(this.renderer, this.camera);
    if (this.disposed) return;

    const warmup = await warmUpScene(this.renderer, this.scene, this.camera, () => this.renderLoop.waitForRenderedFrame());
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
  dispose(): void {
    this.disposed = true;
    this.renderLoop.dispose();
    this.canvasSize.dispose();

    // DevWorld owns a generation Web Worker and a set of raycast-only building
    // meshes that live outside the scene graph. Nothing else disposes them, so
    // every engine teardown (a training tab reload, for instance) leaked one.
    this.devTerrainProvider?.dispose();

    // Remove event listeners to prevent memory leaks
    this.tileLoading.dispose();
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
    this.mushroomClouds.dispose();
    this.oozes.dispose();
    this.searchlights.dispose();
    this.bloodMoon.dispose();
    this.hero.dispose();
    this.frostBursts.dispose();

    // Dispose spatial audio
    this.spatialAudio.dispose();

    // Dispose tiles renderer
    if (this.tilesRenderer) {
      this.scene.remove(this.tilesRenderer.group);
      this.tilesRenderer.dispose();
      this.tilesRenderer = null;
      this.routeRegions = null;
      this.tileLodDebug = null;
    }

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
    this.sky.dispose();

    // Dispose renderer
    this.renderer.dispose();
  }
}
