import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  Raycaster,
  type Intersection,
  Vector3,
  Vector2,
  Matrix4,
  Mesh,
  Object3D,
  Group,
  SRGBColorSpace,
  Fog,
  HemisphereLight,
  DirectionalLight,
  AmbientLight,
  TextureLoader,
  EquirectangularReflectionMapping,
  Color,
  BoxGeometry,
  Box3,
  MeshBasicMaterial,
  DoubleSide,
  ShaderMaterial,
  AxesHelper,
  Material,
  MathUtils,
} from 'three';
import {
  TilesRenderer,
  GlobeControls,
  EnvironmentControls,
  WGS84_ELLIPSOID,
} from '3d-tiles-renderer';
// Frame constants for coordinate transformations
import { CAMERA_FRAME } from '3d-tiles-renderer/src/three/renderer/math/Ellipsoid.js';
import {
  TilesFadePlugin,
  TileCompressionPlugin,
  UpdateOnChangePlugin,
  UnloadTilesPlugin,
  GLTFExtensionsPlugin,
  ReorientationPlugin,
} from '3d-tiles-renderer/plugins';
import { CesiumIonAuthPlugin, GoogleCloudAuthPlugin } from '3d-tiles-renderer/core/plugins';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { ColorGradingPreset } from './post-processing/color-grading';
import { PostProcessingPipeline } from './post-processing/post-processing-pipeline';
import { EllipsoidSync } from './ellipsoid-sync';
import { METERS_PER_DEGREE_LAT, DEG_TO_RAD } from '../utils/geo-utils';
import { ColumnHit, ColumnSample, isBetterLod, selectColumnSample } from './column-sample';
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
import { SpatialAudioManager } from '../managers/audio/spatial-audio.manager';
import { AssetManagerService } from '../services/infrastructure/asset-manager.service';
import { DevWorldService } from '../devworld/devworld.service';
import { TerrainProvider } from '../interfaces/terrain-provider.interface';
import { DevTerrainProvider } from '../devworld/dev-terrain.provider';
import { TowerShadowMapper } from './tower-shadow-mapper';

/**
 * Vertical tolerance (meters) around a route anchor when validating
 * top-down terrain raycasts. Hits more than this far from the anchor are
 * treated as overhead clutter (bridge decks, tree canopies) or sub-ground
 * artifacts (basements, mesh holes). 3m comfortably accepts curbs, low
 * ramps and tile-seam noise while rejecting typical bridge decks (4-6m)
 * and most tree crowns.
 */
/** Shape of a 3D-Tiles tile as far as the tile-info map needs it. */
interface ActiveTile {
  geometricError?: number;
  internal?: { depth?: number };
  engineData?: { scene?: Object3D | null } | null;
}

/** Straight down — the terrain probe is always vertical. */
const COLUMN_RAY_DIRECTION = new Vector3(0, -1, 0);

/** Column cache granularity: 2 buckets per metre (0.5 m grid). */
const COLUMN_CACHE_SCALE = 2;

/**
 * Initial camera position for pre-computed framing
 */
export interface InitialCameraPosition {
  x: number;
  y: number;
  z: number;
  lookAtX: number;
  lookAtY: number;
  lookAtZ: number;
}

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
  private controls: GlobeControls | null = null;
  private tilesRenderer: TilesRenderer | null = null;
  private reorientationPlugin: ReorientationPlugin | null = null;

  // Post-processing pipeline (composer + bloom + color grading + output pass)
  private postProcessing: PostProcessingPipeline | null = null;

  // Game speed multiplier for animations (turret rotation etc.)
  private gameTimescale = 1.0;
  /** Phase 5.14: headless mode — skips all per-frame rendering work. */
  private _renderingEnabled = true;

  // DevWorld support
  private devWorld: DevWorldService | null = null;
  private devTerrainProvider: TerrainProvider | null = null;

  // Coordinate sync
  readonly sync: EllipsoidSync;

  // Raycaster for terrain height queries
  private raycaster: Raycaster;
  private readonly CACHE_PRECISION = 5;
  private readonly CACHE_SCALE = 1e5; // 10^CACHE_PRECISION
  private readonly HEIGHT_CHANGE_THRESHOLD = 2.0; // Only refresh if height changed by >2m
  private lastOriginHeight: number | null = null;

  // Debug flag: reset when tiles are loaded so we get debug output
  private tilesWereLoaded = false;
  // Tile quality tracking for route protection (active only during route calculation)

  /**
   * Persistent tile-info map for per-raycast LOD lookup. Rebuilt on every
   * tile-load-end event (debounced) so any caller of
   * `getTerrainSampleAtLocal` gets accurate LOD info for the hit tile.
   * Separate from the lazy `tileSceneMap` used by `startTileQualityTracking`
   * (which is opt-in around route generation).
   */
  private persistentTileInfoMap: Map<Object3D, { geometricError: number, depth: number }> | null = null;
  /**
   * Lazy cache of per-tile horizontal AABB (min/max x,z). Built on demand
   * by `peekBestTileLODAtLocal` and cached for the lifetime of each tile
   * scene — tile geometry is immutable once loaded, so the AABB never
   * changes until the scene unloads. WeakMap keys die with their scene,
   * so no manual eviction needed.
   */
  private tileBoundsCache = new WeakMap<Object3D, { minX: number; maxX: number; minZ: number; maxZ: number }>();

  /** Tiles-group position the cached AABBs were taken at. */
  private readonly boundsCacheGroupPos = new Vector3(NaN, NaN, NaN);

  /**
   * Column samples keyed by quantised local (x,z), each stamped with the
   * {@link lodVersion} it was taken at. Replaces the old lat/lon height cache
   * and its all-or-nothing clear.
   */
  private columnCache = new Map<number, { sample: ColumnSample; lodVersion: number }>();

  /**
   * Raycaster reserved for terrain columns. Separate from `this.raycaster`
   * because LOS checks set `far` to their segment length and screen picking
   * sets its own origin — sharing one instance made the effective range
   * depend on whatever ran last.
   */
  private readonly terrainRaycaster = new Raycaster();
  private readonly _columnRayOrigin = new Vector3();
  private readonly _columnResults: Intersection[] = [];
  private readonly _columnHits: ColumnHit[] = [];

  /**
   * Monotonic counter of loaded-tile-set changes. Every cached column sample
   * records the version it was taken at; a newer version means "re-verify",
   * which replaces the old all-or-nothing `heightCache.clear()`.
   */
  private lodVersion = 0;

  // Pre-computed initial camera position (set before initialize())
  private initialCameraPosition: InitialCameraPosition | null = null;

  // Entity renderers
  readonly enemies: InstancedEnemyRenderer;
  readonly towers: ThreeTowerRenderer;
  readonly projectiles: ThreeProjectileRenderer;
  readonly effects: ThreeEffectsRenderer;
  readonly flameBeams: ThreeFlameBeamRenderer;
  readonly tentacles: ThreeTentacleRenderer;
  readonly trailStreaks: TrailStreakRenderer;
  readonly lightningBolts: LightningBoltRenderer;

  // Spatial audio manager
  readonly spatialAudio: SpatialAudioManager;

  // Callback for when camera controls drag ends (for distinguishing clicks from pans)
  onControlsDragEnd: (() => void) | null = null;
  private controlsStartTime = 0;
  private controlsStartCameraPos = new Vector3();
  private lastCameraMovement = 0;

  // Test entities (for debugging)
  private testCube: Mesh | null = null;
  private debugHelpers: Object3D[] = [];

  // GPU-LOS-Pipeline: lazy-initialised auf erste Anforderung. Shared
  // zwischen Build-Preview und Tower-Selection-Viz (Lesson 9 — beide
  // dürfen nicht gleichzeitig aktiv sein).
  private towerShadowMapper: TowerShadowMapper | null = null;

  // Event handlers (stored for cleanup in dispose)
  private tilesLoadEndHandler = () => this.onTilesLoadEnd();
  private controlsStartHandler = () => {
    this.controlsStartTime = performance.now();
    this.controlsStartCameraPos.copy(this.camera.position);
  };
  private controlsEndHandler = () => {
    this.lastCameraMovement = this.camera.position.distanceTo(this.controlsStartCameraPos);
    if (this.onControlsDragEnd && this.lastCameraMovement > 5) {
      this.onControlsDragEnd();
    }
  };


  // Overlay group for markers, streets, routes
  // Added to scene root, but synced with tiles movement each frame
  private overlayGroup: Group;

  // Track initial tiles position to calculate movement delta
  private initialTilesPos = new Vector3();
  private tilesPosInitialized = false;

  // Base Y position for overlay group (terrain height at origin)
  // This ensures overlays are placed on the terrain surface, not at world Y=0

  // Callback when tiles finish loading (for terrain height refresh)
  private onTilesLoadCallback: (() => void) | null = null;
  private tilesLoadDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private firstTilesRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private firstTilesRetryCount = 0;
  private readonly TILES_LOAD_DEBOUNCE_MS = 500; // Wait 500ms after last tile load
  private readonly FIRST_TILES_RETRY_MS = 200; // Retry interval when meshes not ready
  private readonly FIRST_TILES_MAX_RETRIES = 50; // Max 10 seconds of retries

  // Callback when first tiles are loaded (for loading indicator)
  private onFirstTilesLoadedCallback: (() => void) | null = null;
  private firstTilesLoaded = false;
  private tilesetLoadCount = 0; // Track how many tilesets have been loaded
  private cameraNudgeCount = 0; // Track camera nudges to prevent infinite loop
  private readonly MAX_CAMERA_NUDGES = 3;

  // Tiles update throttling - only update when camera moves significantly
  private lastTilesUpdateCameraPos = new Vector3();
  private readonly TILES_UPDATE_THRESHOLD = 5; // meters

  // Screen shake system
  private shakeIntensity = 0;
  private shakeDecay = 0;
  private shakeOffset = new Vector3();

  // Callback for per-frame updates (animations)
  private onUpdateCallback: ((deltaTime: number) => void) | null = null;

  // Performance stats
  private lastFrameTime = 0;
  private frameCount = 0;
  private fps = 0;

  // Animation
  private animationFrameId: number | null = null;
  private isRunning = false;

  /** Target FPS limit (0 = unlimited/vsync) */
  private _fpsLimit = 0;
  /** Minimum frame interval in ms (derived from _fpsLimit) */
  private _minFrameInterval = 0;

  // Tile provider credentials
  private cesiumIonToken: string;
  private cesiumAssetId: string;
  private tileProvider: 'cesium' | 'google';
  private googleMapsApiKey: string;

  // Origin coordinates (stored for DevWorld transformation)
  private originLat: number;
  private originLon: number;
  private originHeight: number;

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

    // Store origin for DevWorld transformation
    this.originLat = originLat;
    this.originLon = originLon;
    this.originHeight = originHeight;

    // Initialize coordinate sync
    this.sync = new EllipsoidSync(originLat, originLon, originHeight);

    // Raycaster for terrain queries
    this.raycaster = new Raycaster();

    // Create WebGL renderer with error handling
    try {
      this.renderer = new WebGLRenderer({
        canvas,
        antialias: true,
        logarithmicDepthBuffer: true,
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

    // Setup lighting and sky
    this.setupLighting();
    this.setupSky();

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
    this.towers = new ThreeTowerRenderer(this.scene, coordinateSync, this.assetManager);
    this.projectiles = new ThreeProjectileRenderer(this.scene, coordinateSync);
    this.effects = new ThreeEffectsRenderer(this.scene, coordinateSync);
    this.flameBeams = new ThreeFlameBeamRenderer();
    this.flameBeams.setEffectsRenderer(this.effects);
    this.tentacles = new ThreeTentacleRenderer(this.scene);
    this.trailStreaks = new TrailStreakRenderer(this.scene);
    this.lightningBolts = new LightningBoltRenderer(this.scene);

    // Initialize spatial audio with camera listener
    this.spatialAudio = new SpatialAudioManager(this.scene, this.camera);
    this.spatialAudio.setGeoToLocal((lat, lon, height) =>
      this.sync.geoToLocalSimple(lat, lon, height)
    );

    // Setup post-processing pipeline (bloom off by default)
    this.setupPostProcessing();

    // Load saved FPS limit from localStorage
    const savedFps = localStorage.getItem('3dtd-fps-limit');
    if (savedFps !== null) {
      this.setFpsLimit(Number(savedFps));
    }

  }

  /**
   * Set initial camera position before initialize().
   * This allows pre-computed framing to be applied immediately,
   * avoiding camera jumps and unnecessary tile loading.
   *
   * @param position Pre-computed camera position from CameraFramingService
   */
  setInitialCameraPosition(position: InitialCameraPosition): void {
    this.initialCameraPosition = position;
  }

  /**
   * Trigger camera screen shake (e.g., on explosion)
   * @param intensity - Shake strength in meters (default 0.5)
   * @param duration - Duration in ms (default 200)
   */
  triggerScreenShake(intensity = 0.5, duration = 200): void {
    // Max-wins: only override if new shake is stronger than current
    if (intensity > this.shakeIntensity) {
      this.shakeIntensity = intensity;
      this.shakeDecay = intensity / (duration / 16.67); // Decay per frame at ~60fps
    }
  }

  setTimescale(scale: number): void {
    this.gameTimescale = scale;
  }

  /**
   * Phase 5.14: Enable/disable per-frame rendering (headless training mode).
   * When disabled, `update()` and `render()` become no-ops — only the
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

    // Create TilesRenderer
    this.tilesRenderer = new TilesRenderer();

    // Register auth plugin based on tile provider
    if (this.tileProvider === 'google') {
      console.log('[ThreeTilesEngine] Using Google Cloud 3D Tiles (direct)');
      this.tilesRenderer.registerPlugin(
        new GoogleCloudAuthPlugin({ apiToken: this.googleMapsApiKey })
      );
    } else {
      console.log('[ThreeTilesEngine] Using Cesium Ion 3D Tiles');
      this.tilesRenderer.registerPlugin(
        new CesiumIonAuthPlugin({
          apiToken: this.cesiumIonToken,
          assetId: this.cesiumAssetId,
        })
      );
    }
    this.tilesRenderer.registerPlugin(new TileCompressionPlugin());
    this.tilesRenderer.registerPlugin(new UpdateOnChangePlugin());
    this.tilesRenderer.registerPlugin(new UnloadTilesPlugin());
    this.tilesRenderer.registerPlugin(new TilesFadePlugin());
    this.tilesRenderer.registerPlugin(
      new GLTFExtensionsPlugin({
        dracoLoader: new DRACOLoader().setDecoderPath(
          'https://unpkg.com/three@0.153.0/examples/jsm/libs/draco/gltf/'
        ),
      })
    );

    // Reorientation plugin - centers tiles on origin
    const origin = this.sync.getOrigin();
    this.reorientationPlugin = new ReorientationPlugin({
      lat: origin.lat * MathUtils.DEG2RAD,
      lon: origin.lon * MathUtils.DEG2RAD,
      height: origin.height,
      recenter: true,
    });
    this.tilesRenderer.registerPlugin(this.reorientationPlugin);

    // Important: rotate tiles group so Y is up (default is Z-up)
    this.tilesRenderer.group.rotation.x = -Math.PI / 2;

    // Add to scene
    this.scene.add(this.tilesRenderer.group);

    // overlayGroup is already in scene (added in constructor)
    // We'll sync its position with tiles movement in render()

    // Update sync with tiles renderer reference
    this.sync.setTilesRenderer(this.tilesRenderer);

    // Setup camera and controls
    this.setupControls();

    // Configure tiles renderer
    this.tilesRenderer.setResolutionFromRenderer(this.camera, this.renderer);
    this.tilesRenderer.setCamera(this.camera);

    // === QUALITY SETTINGS (keep high - critical for raycasting!) ===
    this.tilesRenderer.errorTarget = 20; // High quality for accurate terrain raycasting

    // === ASYNC LOADING STRATEGY ===
    // Limit concurrent downloads to prevent network congestion
    this.tilesRenderer.downloadQueue.maxJobs = 4; // Reduced from 6

    // Reduce concurrent parsing to prevent main thread blocking
    // Tiles parse asynchronously but still block on finalization
    this.tilesRenderer.parseQueue.maxJobs = 1; // Process one at a time for smoother frames

    // === CACHE OPTIMIZATION ===
    // Increase LRU cache to reduce re-loading when camera returns to previous area
    this.tilesRenderer.lruCache.minSize = 1000; // Default is much lower
    this.tilesRenderer.lruCache.maxSize = 2000; // Keep more tiles in memory

    // Listen for tile loading events to refresh terrain heights
    // 'tiles-load-end' fires when ALL currently visible tiles have finished loading
    this.tilesRenderer.addEventListener('tiles-load-end', this.tilesLoadEndHandler);

    // Track tileset loading count (for debugging)
    this.tilesRenderer.addEventListener('load-tileset', () => {
      this.tilesetLoadCount++;
    });

    // Debug: Listen for errors
    this.tilesRenderer.addEventListener('load-error', (event: unknown) => {
      console.error('[TilesEngine] load-error event:', event);
    });

    // Set up terrain height sampler for tower range indicators (legacy)
    this.towers.setTerrainHeightSampler((lat, lon) => this.getTerrainHeightAtGeo(lat, lon));

    // Set up direct terrain raycaster for accurate terrain-conforming range indicators
    // This raycasts directly at local X,Z coordinates for exact terrain mesh intersection
    this.towers.setTerrainRaycaster((localX, localZ) => this.raycastTerrainHeight(localX, localZ));

    // Set up Line-of-Sight raycaster for visibility checks
    // Returns true if line of sight is BLOCKED
    this.towers.setLineOfSightRaycaster((ox, oy, oz, tx, ty, tz) =>
      this.raycastLineOfSight(ox, oy, oz, tx, ty, tz)
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

    const LOG = '[DevWorld]';
    console.log(`${LOG} ========== INITIALIZATION ==========`);
    console.log(`${LOG} Mode: Flat terrain with EnvironmentControls`);
    console.log(`${LOG} Origin: lat=${this.originLat}, lon=${this.originLon} (fake)`);

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

    console.log(`${LOG} Terrain added to devWorldGroup at local origin`);

    // Setup EnvironmentControls - works with flat local terrain
    this.setupDevWorldControls();

    // Set up terrain height sampler for tower range indicators
    this.towers.setTerrainHeightSampler((lat, lon) => this.getTerrainHeightAtGeo(lat, lon));

    // Set up direct terrain raycaster
    this.towers.setTerrainRaycaster((localX, localZ) => this.raycastTerrainHeight(localX, localZ));

    // Set up Line-of-Sight raycaster
    this.towers.setLineOfSightRaycaster((ox, oy, oz, tx, ty, tz) =>
      this.raycastLineOfSight(ox, oy, oz, tx, ty, tz)
    );

    // Mark as loaded immediately (no async tile loading in DevWorld)
    this.firstTilesLoaded = true;
    this.tilesWereLoaded = true;

    // Trigger first tiles loaded callback
    if (this.onFirstTilesLoadedCallback) {
      this.onFirstTilesLoadedCallback();
    }

    console.log(`${LOG} DevWorld initialized with EnvironmentControls`);
  }

  /**
   * Setup EnvironmentControls for DevWorld
   *
   * Uses EnvironmentControls instead of GlobeControls because:
   * - GlobeControls is designed for globe navigation at Earth-radius distances
   * - DevWorld has flat terrain at local origin
   * - EnvironmentControls raycasts against scene geometry for pivoting/panning
   *
   * Control scheme (same interaction model as GlobeControls):
   * - Left mouse drag: Pan (slide camera along terrain)
   * - Right mouse drag: Rotate (orbit around pivot point)
   * - Scroll wheel: Zoom in/out
   */
  private setupDevWorldControls(): void {
    if (!this.devWorldGroup) return;

    const LOG = '[DevWorld]';
    console.log(`${LOG} ========== CONTROLS SETUP ==========`);

    // EnvironmentControls - works with flat local terrain
    // Cast to any because controls type is GlobeControls | null but EnvironmentControls is compatible
    const envControls = new EnvironmentControls(
      this.scene,
      this.camera,
      this.renderer.domElement
    );

    // Configure controls
    envControls.enableDamping = true;
    envControls.minDistance = 5;       // Minimum zoom distance
    envControls.maxDistance = 2000;    // Maximum zoom distance
    envControls.minAltitude = 0.1;     // Min camera altitude (radians from ground)
    envControls.maxAltitude = Math.PI / 2 - 0.1; // Max altitude (near vertical)

    // Set scene for raycasting (against devWorldGroup which contains terrain)
    envControls.setScene(this.devWorldGroup);

    // Store as GlobeControls type (EnvironmentControls is parent class)
    this.controls = envControls as unknown as GlobeControls;

    // Listen for drag start/end to distinguish clicks from pans
    this.controls.addEventListener('start', this.controlsStartHandler);
    this.controls.addEventListener('end', this.controlsEndHandler);

    // Position camera - steep 70° view (same as real game)
    if (this.initialCameraPosition) {
      const pos = this.initialCameraPosition;
      this.camera.position.set(pos.x, pos.y, pos.z);
      this.camera.lookAt(pos.lookAtX, pos.lookAtY, pos.lookAtZ);
      console.log(`${LOG} Camera from initialCameraPosition: (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);
    } else {
      // Default: view from above - position camera above origin looking down
      // 70° angle: at 400m height, offset 145m horizontally
      this.camera.position.set(0, 400, -145);
      this.camera.lookAt(0, 0, 0);
      console.log(`${LOG} Camera default: pos=(0, 400, -145), lookAt=(0, 0, 0)`);
    }

    // Update controls after camera positioning
    this.controls.update();

    console.log(`${LOG} EnvironmentControls configured`);
    console.log(`${LOG} Camera position: (${this.camera.position.x.toFixed(1)}, ${this.camera.position.y.toFixed(1)}, ${this.camera.position.z.toFixed(1)})`);
    console.log(`${LOG} Controls: pan=left-drag, rotate=right-drag, zoom=scroll`);
  }

  /**
   * Called when all visible tiles finish loading
   * Uses debounce to avoid multiple rapid refreshes during camera movement
   * Only triggers refresh if terrain height actually changed significantly
   */
  private onTilesLoadEnd(): void {

    // Clear existing debounce timer
    if (this.tilesLoadDebounceTimer) {
      clearTimeout(this.tilesLoadDebounceTimer);
    }

    // Start new debounce timer - wait for camera to settle
    this.tilesLoadDebounceTimer = setTimeout(() => {
      // Check if origin height changed significantly (bypass cache for this check)
      const freshOriginHeight = this.raycastTerrainHeight(0, 0);
      const stats = this.getTileStats();

      // FIRST TILES LOADED - primarily wait for raycast success
      // Raycast hitting terrain means tiles are loaded AND stable (not mid-LOD-transition)
      // Fallback: 50+ visible tiles without raycast (e.g., origin over water/gap)
      const MIN_VISIBLE_TILES = 50;
      if (!this.firstTilesLoaded) {
        if (freshOriginHeight !== null) {
          this.firstTilesLoaded = true;
          // Build the persistent tile-info map for the first time so any
          // detailed terrain raycast right after this can attach LOD info.
          this.rebuildPersistentTileInfoMap();
          if (this.onFirstTilesLoadedCallback) {
            this.onFirstTilesLoadedCallback();
          }
        } else if (stats.visible >= MIN_VISIBLE_TILES) {
          this.firstTilesLoaded = true;
          this.rebuildPersistentTileInfoMap();
          if (this.onFirstTilesLoadedCallback) {
            this.onFirstTilesLoadedCallback();
          }
        } else {
          // Not ready yet - schedule retry
          this.scheduleFirstTilesRetry();
        }
      }

      // The loaded-tile set has changed — that is true on EVERY settled
      // load-end, not only when the origin column happens to shift.
      //
      // This used to sit behind a `heightDelta > HEIGHT_CHANGE_THRESHOLD`
      // gate measured at (0,0). LOD refinement anywhere else in the world
      // — the whole enemy corridor, for instance — never moves the origin
      // column, so the tile-info map went stale, `peekBestTileLODAtLocal`
      // reported outdated LODs, `sampleCellY`'s skip gate then refused to
      // re-sample, and the convergence loop spun without healing anything.
      // The same gate also withheld the cubemap invalidation and the route
      // refresh, which is how a route baked during the coarse phase stayed
      // baked (enemies walking at rooftop height in dense cities).
      const tPre0 = performance.now();

      // Bumps `lodVersion`, which is what invalidates individual column
      // samples — no global cache clear needed.
      this.rebuildPersistentTileInfoMap();
      const tRebuildMap = performance.now();

      this.towerShadowMapper?.invalidate();
      const tShadowInvalidate = performance.now();

      if (freshOriginHeight !== null) {
        this.lastOriginHeight = freshOriginHeight;
      }

      if (this.onTilesLoadCallback) {
        this.onTilesLoadCallback();
        const tEnd = performance.now();
        console.warn(
          `[PerfTrace] onTilesLoadCallback: ${(tEnd - tPre0).toFixed(1)}ms total | ` +
          `rebuildTileMap=${(tRebuildMap - tPre0).toFixed(1)} ` +
          `shadowInvalidate=${(tShadowInvalidate - tRebuildMap).toFixed(1)} ` +
          `facadeCallback=${(tEnd - tShadowInvalidate).toFixed(1)}ms ` +
          `(lodVersion=${this.lodVersion})`
        );
      }
    }, this.TILES_LOAD_DEBOUNCE_MS);
  }

  /**
   * Retry checking for first tiles when tiles-load-end fired but meshes weren't ready.
   * This handles the race condition where 3DTilesRenderer fires event before meshes are in scene.
   */
  private scheduleFirstTilesRetry(): void {
    // Clear any existing retry timer
    if (this.firstTilesRetryTimer) {
      clearTimeout(this.firstTilesRetryTimer);
    }

    // Don't retry forever - but try camera nudge first
    if (this.firstTilesRetryCount >= this.FIRST_TILES_MAX_RETRIES) {
      const stats = this.getTileStats();
      if (stats.visible === 0 && this.cameraNudgeCount < this.MAX_CAMERA_NUDGES) {
        // No tiles after max retries - try forcing tile update
        this.cameraNudgeCount++;
        console.warn(`[TilesEngine] Max retries reached with 0 tiles - forcing update #${this.cameraNudgeCount}`);

        // Force camera matrix update and tile refresh
        this.camera.updateMatrixWorld(true);
        if (this.tilesRenderer) {
          this.tilesRenderer.setResolutionFromRenderer(this.camera, this.renderer);
          this.tilesRenderer.setCamera(this.camera);
          this.tilesRenderer.update();
        }

        // Reset retry counter and try again
        this.firstTilesRetryCount = 0;
        this.scheduleFirstTilesRetry();
        return;
      }
      // Either some tiles loaded, or we've exhausted nudges - accept current state
      console.warn(`[TilesEngine] Max retries reached (visible=${stats.visible}, nudges=${this.cameraNudgeCount}), marking as loaded`);
      this.firstTilesLoaded = true;
      if (this.onFirstTilesLoadedCallback) {
        this.onFirstTilesLoadedCallback();
      }
      return;
    }

    this.firstTilesRetryCount++;

    this.firstTilesRetryTimer = setTimeout(() => {
      if (this.firstTilesLoaded) return; // Already loaded via another path

      const freshOriginHeight = this.raycastTerrainHeight(0, 0);
      const stats = this.getTileStats();

      // Primarily wait for raycast success - means tiles are stable
      // Fallback: 50+ visible tiles (e.g., origin over water/gap)
      const MIN_VISIBLE_TILES = 50;
      if (freshOriginHeight !== null) {
        this.firstTilesLoaded = true;
        if (this.onFirstTilesLoadedCallback) {
          this.onFirstTilesLoadedCallback();
        }
      } else if (stats.visible >= MIN_VISIBLE_TILES) {
        this.firstTilesLoaded = true;
        if (this.onFirstTilesLoadedCallback) {
          this.onFirstTilesLoadedCallback();
        }
      } else {
        // Not ready yet - continue retrying
        this.scheduleFirstTilesRetry();
      }
    }, this.FIRST_TILES_RETRY_MS);
  }

  /**
   * Register a callback to be called when tiles finish loading
   * Used by component to refresh terrain heights after LOD changes
   */
  setOnTilesLoadCallback(callback: () => void): void {
    this.onTilesLoadCallback = callback;
  }

  /**
   * Register a callback to be called when first tiles are loaded
   * Used by component to hide "loading tiles" indicator
   */
  setOnFirstTilesLoadedCallback(callback: () => void): void {
    this.onFirstTilesLoadedCallback = callback;
    // If tiles already loaded, call immediately
    if (this.firstTilesLoaded) {
      callback();
    }
  }

  /**
   * Register a callback to be called each frame for animations
   */
  setOnUpdateCallback(callback: (deltaTime: number) => void): void {
    this.onUpdateCallback = callback;
  }

  private setupLighting(): void {
    // Hemisphere light - warm sky/ground gradient
    const hemi = new HemisphereLight(
      0xffeedd, // Warm sky color
      0x806040, // Warm ground color
      1.5
    );
    this.scene.add(hemi);

    // Main sun light (key light) - warm bright sun
    const sun = new DirectionalLight(0xffeecc, 3.0); // Warm and bright
    sun.position.set(-50, 100, -30); // SW direction, high angle
    this.scene.add(sun);

    // Fill light - warm from opposite side
    const fill = new DirectionalLight(0xfff0e0, 1.5); // Warm
    fill.position.set(50, 50, 30); // NE direction
    this.scene.add(fill);

    // Warm ambient for overall brightness
    const ambient = new AmbientLight(0xffe8d0, 0.8); // Warm tint
    this.scene.add(ambient);
  }

  /**
   * Setup sky background from equirectangular texture
   */
  private setupSky(): void {
    const loader = new TextureLoader();

    loader.load(
      '/assets/images/skybox/day.webp',
      (texture) => {
        texture.mapping = EquirectangularReflectionMapping;
        texture.colorSpace = SRGBColorSpace;
        this.scene.background = texture;
      },
      undefined,
      (error) => {
        console.warn('[ThreeTilesEngine] Failed to load sky texture, using fallback color', error);
        this.scene.background = new Color(0x87ceeb); // Light blue fallback
      }
    );
  }

  private setupPostProcessing(): void {
    this.postProcessing = new PostProcessingPipeline(this.renderer, this.scene, this.camera);
  }

  private setupControls(): void {
    if (!this.tilesRenderer) return;

    // GlobeControls for earth-like navigation
    // Don't pass tilesRenderer to constructor (deprecated), use setScene/setEllipsoid instead
    this.controls = new GlobeControls(
      this.scene,
      this.camera,
      this.renderer.domElement
    );
    this.controls.enableDamping = true;

    // Set scene and ellipsoid for controls (new API)
    this.controls.setScene(this.scene);
    this.controls.setEllipsoid(this.tilesRenderer.ellipsoid, this.tilesRenderer.group);

    // Listen for drag start/end to distinguish clicks from pans
    this.controls.addEventListener('start', this.controlsStartHandler);
    this.controls.addEventListener('end', this.controlsEndHandler);

    // With ReorientationPlugin (recenter: true) and tiles.group.rotation.x = -PI/2:
    // - Origin (HQ) is at (0,0,0) in local space
    // - Y is up, -Z is South, +Z is North

    if (this.initialCameraPosition) {
      // Use pre-computed framing position (optimal for game area)
      const pos = this.initialCameraPosition;
      this.camera.position.set(pos.x, pos.y, pos.z);
      this.camera.lookAt(pos.lookAtX, pos.lookAtY, pos.lookAtZ);
    } else {
      // Fallback: steep 70° view over origin (minimal horizon, fewer tiles)
      // 70° angle: height = tan(70°) * distance ≈ 2.75 * distance
      // For 150m horizontal offset: height ≈ 412m
      this.camera.position.set(0, 400, -145); // ~70° angle, looking north
      this.camera.lookAt(0, 0, 0);
    }
  }

  /**
   * Set camera position using lat/lon/height and orientation
   */
  setCameraPosition(
    lat: number,
    lon: number,
    height: number,
    azimuth = 0,
    elevation = -45,
    roll = 0
  ): void {
    if (!this.tilesRenderer) return;

    this.tilesRenderer.group.updateMatrixWorld();

    // Use getObjectFrame for proper camera positioning in globe view
    const tempMatrix = new Matrix4();
    WGS84_ELLIPSOID.getObjectFrame(
      lat * MathUtils.DEG2RAD,
      lon * MathUtils.DEG2RAD,
      height,
      azimuth * MathUtils.DEG2RAD,
      elevation * MathUtils.DEG2RAD,
      roll * MathUtils.DEG2RAD,
      tempMatrix,
      CAMERA_FRAME
    );

    // Apply tiles group transformation
    tempMatrix.premultiply(this.tilesRenderer.group.matrixWorld);
    tempMatrix.decompose(
      this.camera.position,
      this.camera.quaternion,
      this.camera.scale
    );

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
    this.camera.position.set(x, y, z);
    this.camera.lookAt(targetX, targetY, targetZ);
  }

  /**
   * Fly camera to a position (animated)
   */
  flyTo(lat: number, lon: number, height: number, _duration = 1.5): void {
    // For now, just set position directly
    // TODO: Implement smooth animation
    this.setCameraPosition(lat, lon, height, 0, -45);
  }

  /**
   * Update origin (when game location changes)
   * Also resets firstTilesLoaded so the callback fires again for the new location
   */
  setOrigin(lat: number, lon: number, height = 0): void {
    this.sync.setOrigin(lat, lon, height);

    // Update ReorientationPlugin
    if (this.reorientationPlugin && this.tilesRenderer) {
      this.reorientationPlugin.transformLatLonHeightToOrigin(
        lat * MathUtils.DEG2RAD,
        lon * MathUtils.DEG2RAD,
        height
      );
    }

    // Clear height cache
    this.clearHeightCache();

    // Cancel any pending debounce timer from previous location
    if (this.tilesLoadDebounceTimer) {
      clearTimeout(this.tilesLoadDebounceTimer);
      this.tilesLoadDebounceTimer = null;
    }

    // Reset ALL tiles-related flags so everything recalculates for new location
    this.firstTilesLoaded = false;
    this.firstTilesRetryCount = 0;
    this.tilesetLoadCount = 0;
    this.cameraNudgeCount = 0;
    if (this.firstTilesRetryTimer) {
      clearTimeout(this.firstTilesRetryTimer);
      this.firstTilesRetryTimer = null;
    }
    this.tilesWereLoaded = false;
    this.lastOriginHeight = null;
    this.tilesLoadedForRaycast = false;

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
  }

  /**
   * Get terrain height for overlay objects at a given local X,Z position
   * Returns the Y value in overlayGroup local coordinates
   *
   * With ReorientationPlugin (recenter:true), the origin is at world (0,0,0).
   * Tiles geometry is transformed so origin point is centered.
   * We raycast directly in this coordinate space.
   *
   * @param localX - X position in local coords (from geoToLocalSimple)
   * @param localZ - Z position in local coords (from geoToLocalSimple)
   * @returns Y position for the overlay, or null if terrain not hit
   */
  private tilesLoadedForRaycast = false;

  /**
   * Get DevTerrainProvider for wiring up street provider.
   * Only available when DevWorld mode is active.
   */
  getDevTerrainProvider(): DevTerrainProvider | null {
    return this.devTerrainProvider as DevTerrainProvider | null;
  }

  /**
   * Get terrain height at geographic coordinates using LOCAL coordinate raycast.
   * Uses cache to avoid expensive raycasts for the same positions.
   *
   * With ReorientationPlugin (recenter: true):
   * - Tiles are centered at local origin (0,0,0) - NOT in ECEF!
   * - tiles.group.rotation.x = -PI/2 converts Z-up to Y-up
   * - We raycast from high above (Y=10000) straight down (0,-1,0)
   * - geoToLocalSimple() gives local offsets in the same coordinate system
   *
   * @param lat - Latitude in degrees
   * @param lon - Longitude in degrees
   * @returns Height in local Y coordinates, or null if no hit
   */
  getTerrainHeightAtGeo(lat: number, lon: number): number | null {
    // DevWorld: delegate to provider
    if (this.devTerrainProvider) {
      return this.devTerrainProvider.getHeightAtGeo(lat, lon);
    }

    // Caching happens per column in `sampleColumn`, keyed on local (x,z) —
    // one keyspace for the whole engine instead of a second lat/lon one.
    const localPos = this.sync.geoToLocalSimple(lat, lon, 0);
    return this.sampleColumn(localPos.x, localPos.z)?.groundY ?? null;
  }

  /**
   * Estimate ground height by sampling center + lateral points perpendicular to path direction.
   * Detects obstacles (trees, buildings) by comparing center height with lateral samples.
   *
   * If center is significantly higher than the lateral minimum, the raycast likely hit
   * a tree canopy or building roof. In that case, returns the lateral minimum as ground estimate.
   *
   * Preserves bridges: bridge decks are wide enough (6-12m+) that lateral samples at ±3m/±6m
   * still hit the bridge surface, so center ≈ lateral → no correction applied.
   *
   * @param lat - Latitude of the path point
   * @param lon - Longitude of the path point
   * @param prevLat - Latitude of the previous path point (for direction)
   * @param prevLon - Longitude of the previous path point
   * @param nextLat - Latitude of the next path point (for direction)
   * @param nextLon - Longitude of the next path point
   * @returns Estimated ground height, or null if no hit
   */
  getGroundHeightEstimate(
    lat: number, lon: number,
    prevLat: number, prevLon: number,
    nextLat: number, nextLon: number
  ): number | null {
    const centerHeight = this.getTerrainHeightAtGeo(lat, lon);
    if (centerHeight === null) return null;

    // DevWorld uses procedural terrain without tree/building issues
    if (this.devTerrainProvider) return centerHeight;

    // Calculate path direction vector (in degrees)
    const dLat = nextLat - prevLat;
    const dLon = nextLon - prevLon;
    const len = Math.sqrt(dLat * dLat + dLon * dLon);

    // If no direction available (single point), return center height
    if (len < 1e-10) return centerHeight;

    // Perpendicular direction (rotate 90°): swap and negate one component
    const perpLat = -dLon / len;
    const perpLon = dLat / len;

    // Convert meter offsets to degree offsets
    const METERS_TO_DEG_LAT = 1 / METERS_PER_DEGREE_LAT;
    const cosLat = Math.cos(lat * DEG_TO_RAD);

    // Sample at ±3m and ±6m perpendicular to path
    const OFFSETS_M = [3, 6];
    // If center is this much higher than lateral minimum, it's an obstacle (tree/building)
    const OBSTACLE_THRESHOLD = 3;

    let minLateralHeight = centerHeight;
    let lateralSampleCount = 0;

    for (const offsetM of OFFSETS_M) {
      const offsetLat = perpLat * offsetM * METERS_TO_DEG_LAT;
      const offsetLon = perpLon * offsetM * METERS_TO_DEG_LAT / cosLat;

      // Left side of path
      const leftH = this.getTerrainHeightAtGeo(lat + offsetLat, lon + offsetLon);
      if (leftH !== null) {
        minLateralHeight = Math.min(minLateralHeight, leftH);
        lateralSampleCount++;
      }

      // Right side of path
      const rightH = this.getTerrainHeightAtGeo(lat - offsetLat, lon - offsetLon);
      if (rightH !== null) {
        minLateralHeight = Math.min(minLateralHeight, rightH);
        lateralSampleCount++;
      }
    }

    // If lateral samples exist and center is significantly higher → obstacle detected
    if (lateralSampleCount > 0 && (centerHeight - minLateralHeight) > OBSTACLE_THRESHOLD) {
      return minLateralHeight;
    }

    return centerHeight;
  }

  /**
   * The one vertical terrain probe. Everything that needs to know how high
   * the ground is goes through here.
   *
   * Casts a single top-down ray, resolves each hit to its tile's LOD, and
   * hands the set to {@link selectColumnSample}, which keeps only the finest
   * LOD present and reads ground and top off that. See that function for why
   * the finest-LOD filter is the whole point.
   *
   * Results are cached per 0.5 m column and invalidated per entry via
   * {@link lodVersion} — a stale entry is only re-raycast when the peek says
   * better tile data actually exists, otherwise it is just re-stamped.
   *
   * @returns null if nothing usable was hit; the cache is left untouched so
   *   callers keep whatever value they already had.
   */
  sampleColumn(localX: number, localZ: number): ColumnSample | null {
    if (this.devTerrainProvider) {
      const y = this.devTerrainProvider.getHeightAtLocal(localX, localZ);
      if (y === null) return null;
      // DevWorld has no streaming LOD and no overhead clutter.
      return { groundY: y, topY: y, tileDepth: 99, tileGeometricError: 0 };
    }

    const key = this.columnCacheKey(localX, localZ);
    const entry = this.columnCache.get(key);
    if (entry) {
      if (entry.lodVersion === this.lodVersion) return entry.sample;
      // Tile set changed. Only pay for a ray if finer data is actually there.
      const peek = this.peekBestTileLODAtLocal(localX, localZ);
      if (peek && !isBetterLod(peek, entry.sample)) {
        entry.lodVersion = this.lodVersion;
        return entry.sample;
      }
    }

    const sample = this.raycastColumn(localX, localZ);
    if (sample === null) return null;

    this.columnCache.set(key, { sample, lodVersion: this.lodVersion });
    return sample;
  }

  /** Uncached ray + LOD resolution behind {@link sampleColumn}. */
  private raycastColumn(localX: number, localZ: number): ColumnSample | null {
    if (!this.tilesRenderer) return null;

    // Check if tiles are loaded (only on first call)
    if (!this.tilesWereLoaded) {
      let meshCount = 0;
      this.tilesRenderer.group.traverse((obj) => {
        if ((obj as Mesh).isMesh) meshCount++;
      });
      if (meshCount === 0) return null;
      this.tilesWereLoaded = true;
    }

    this._columnRayOrigin.set(localX, 10000, localZ);
    this.terrainRaycaster.set(this._columnRayOrigin, COLUMN_RAY_DIRECTION);
    this.terrainRaycaster.far = 20000;

    this._columnResults.length = 0;
    this.terrainRaycaster.intersectObject(this.tilesRenderer.group, true, this._columnResults);
    if (this._columnResults.length === 0) return null;

    this._columnHits.length = 0;
    for (const r of this._columnResults) {
      const info = this.getTileInfoForObject(r.object);
      this._columnHits.push({
        y: r.point.y,
        depth: info?.depth ?? 0,
        geometricError: info?.geometricError ?? Infinity,
      });
    }

    return selectColumnSample(this._columnHits);
  }

  /** Quantised column key — 0.5 m grid, Szudzik pairing (negatives safe). */
  private columnCacheKey(localX: number, localZ: number): number {
    const xi = Math.round(localX * COLUMN_CACHE_SCALE);
    const zi = Math.round(localZ * COLUMN_CACHE_SCALE);
    const a = xi >= 0 ? 2 * xi : -2 * xi - 1;
    const b = zi >= 0 ? 2 * zi : -2 * zi - 1;
    return a >= b ? a * a + a + b : b * b + a;
  }

  /**
   * Ground height at a local position. Thin read of {@link sampleColumn}.
   */
  private raycastTerrainHeight(localX: number, localZ: number): number | null {
    return this.sampleColumn(localX, localZ)?.groundY ?? null;
  }

  /**
   * Rebuild the persistent tile-info map. Called on every settled
   * tile-load-end. Cheap (one iteration over the active tile set) and it is
   * what bumps {@link lodVersion}, which in turn invalidates cached column
   * samples one entry at a time instead of by a global cache wipe.
   *
   * Built from `activeTiles`, NOT `forEachLoadedModel`: the latter also
   * yields LRU-cached tiles that are loaded but not part of the current
   * refinement, and those are invisible to the raycast
   * (`TilesRenderer.raycast` walks the active traversal only). Reporting
   * their LOD made the peek promise a quality the ray could never deliver —
   * cells were re-sampled for nothing and then accepted the coarse hit.
   */
  rebuildPersistentTileInfoMap(): void {
    if (!this.tilesRenderer) {
      this.persistentTileInfoMap = null;
      return;
    }
    const map = new Map<Object3D, { geometricError: number, depth: number }>();
    // `tile.internal.depth` is the 3d-tiles-renderer tile depth. It was named
    // `tile.__depth` until the 0.4.20+ internal tile-data refactor (which also
    // renamed `tile.cached` → `tile.engineData`, `tile.__used` → `tile.traversal`).
    for (const tile of this.tilesRenderer.activeTiles as Set<ActiveTile>) {
      const scene = tile.engineData?.scene;
      if (!scene) continue;
      map.set(scene, {
        geometricError: tile.geometricError ?? Infinity,
        depth: tile.internal?.depth ?? 0,
      });
    }
    this.persistentTileInfoMap = map;

    // Tile churn invalidates the lazily-computed AABBs, and a new version
    // marks every cached column sample as "verify against the new LOD".
    this.tileBoundsCache = new WeakMap();
    this.lodVersion++;
  }

  /**
   * Tile-LOD peek WITHOUT raycast. Walks the persistent tile-info map and
   * returns the best (deepest / lowest geometricError) tile whose horizontal
   * AABB contains the local (x,z). Used by the route-grid to skip stable
   * cells whose Tile-LOD hasn't improved since the last sample — eliminates
   * the per-cell raycast cost in the post-tile-load full-sweep.
   *
   * Returns `null` when:
   *  - tile info map not yet built (first frame)
   *  - no loaded tile horizontally contains (x,z)
   *
   * Cost: O(loaded tiles), typically ~50-200. AABB computed lazily on first
   * touch per scene and cached in `tileBoundsCache` until the scene unloads.
   */
  peekBestTileLODAtLocal(localX: number, localZ: number): { depth: number; geometricError: number } | null {
    if (this.devTerrainProvider) {
      // DevWorld has no streaming LOD — synthetic high quality so the
      // route-grid never re-raycasts stable cells in dev mode.
      return { depth: 99, geometricError: 0 };
    }
    if (!this.persistentTileInfoMap) return null;

    // Bounds are world-space, so they are only valid while the tiles group
    // sits where it did when they were taken. The group re-centres as the
    // camera travels; without this check the cache would quietly answer for
    // the wrong patch of ground.
    if (this.tilesRenderer && !this.tilesRenderer.group.position.equals(this.boundsCacheGroupPos)) {
      this.tileBoundsCache = new WeakMap();
      this.boundsCacheGroupPos.copy(this.tilesRenderer.group.position);
    }

    let bestDepth = -1;
    let bestErr = Infinity;
    let any = false;
    for (const [scene, info] of this.persistentTileInfoMap.entries()) {
      let bounds = this.tileBoundsCache.get(scene);
      if (!bounds) {
        // `setFromObject` reads matrixWorld. Touching a scene before the
        // renderer has updated it bakes an AABB around an identity
        // transform — permanently wrong, since the WeakMap has no eviction
        // short of the scene unloading.
        scene.updateWorldMatrix(true, true);
        const box = new Box3().setFromObject(scene);
        if (box.isEmpty()) continue;
        bounds = {
          minX: box.min.x,
          maxX: box.max.x,
          minZ: box.min.z,
          maxZ: box.max.z,
        };
        this.tileBoundsCache.set(scene, bounds);
      }
      if (localX < bounds.minX || localX > bounds.maxX) continue;
      if (localZ < bounds.minZ || localZ > bounds.maxZ) continue;
      any = true;
      // "Better" = strictly deeper depth, or same depth + lower geom-error.
      if (info.depth > bestDepth || (info.depth === bestDepth && info.geometricError < bestErr)) {
        bestDepth = info.depth;
        bestErr = info.geometricError;
      }
    }
    return any ? { depth: bestDepth, geometricError: bestErr } : null;
  }

  /**
   * Resolve tile LOD info for a raycast hit. Walks up the hit object's
   * parent chain until it finds a node in `persistentTileInfoMap`.
   * Returns null if the map is not built or the hit doesn't belong to
   * any tracked tile (e.g. non-tile geometry).
   */
  private getTileInfoForObject(obj: Object3D | null): { geometricError: number; depth: number } | null {
    if (!this.persistentTileInfoMap) return null;
    let cursor: Object3D | null = obj;
    while (cursor && !this.persistentTileInfoMap.has(cursor)) {
      cursor = cursor.parent;
    }
    return cursor ? this.persistentTileInfoMap.get(cursor) ?? null : null;
  }


  /**
   * Raycast between two 3D points to check Line-of-Sight
   * Returns true if the ray is BLOCKED (hits terrain/building before reaching target)
   *
   * @param originX, originY, originZ - Starting point (e.g., tower tip)
   * @param targetX, targetY, targetZ - End point (e.g., hex cell or enemy position)
   * @returns true if blocked, false if clear line of sight
   */
  // Reused buffers for hot-path raycasts (called hundreds of times per LOS preview frame)
  private readonly _losOrigin = new Vector3();
  private readonly _losDirection = new Vector3();
  private readonly _losResults: import('three').Intersection[] = [];

  private raycastLineOfSight(
    originX: number, originY: number, originZ: number,
    targetX: number, targetY: number, targetZ: number
  ): boolean {
    // DevWorld: delegate to provider
    if (this.devTerrainProvider) {
      return this.devTerrainProvider.hasLineOfSightBlocked(
        originX, originY, originZ,
        targetX, targetY, targetZ
      );
    }

    if (!this.tilesRenderer) return false;

    this._losOrigin.set(originX, originY, originZ);
    this._losDirection.set(targetX - originX, targetY - originY, targetZ - originZ);
    const distance = this._losDirection.length();
    this._losDirection.multiplyScalar(1 / distance);

    this.raycaster.set(this._losOrigin, this._losDirection);
    this.raycaster.far = distance - 0.5; // Stop slightly before target

    // Reuse intersection array — intersectObject appends, so clear first
    this._losResults.length = 0;
    this.raycaster.intersectObject(this.tilesRenderer.group, true, this._losResults);

    return this._losResults.length > 0;
  }

  /**
   * Get terrain height at local coordinates (public wrapper for raycastTerrainHeight).
   * Pass `anchorY` to validate the hit against a route-anchored band so
   * bridges/trees don't pull the result up to canopy/deck level.
   *
   * @param localX - Local X coordinate (meters from origin)
   * @param localZ - Local Z coordinate (meters from origin)
   * @param anchorY - Optional route-anchor Y for validation
   * @returns Height in local Y coordinates, or null if no hit (and no anchor)
   */
  getTerrainHeightAtLocal(localX: number, localZ: number): number | null {
    return this.raycastTerrainHeight(localX, localZ);
  }


  private getHeightCacheKey(lat: number, lon: number): number {
    // Integer key via Cantor pairing — avoids toFixed() string allocation
    const latI = (lat * this.CACHE_SCALE) | 0;
    const lonI = (lon * this.CACHE_SCALE) | 0;
    // Szudzik pairing (handles negatives better than Cantor)
    const a = latI >= 0 ? 2 * latI : -2 * latI - 1;
    const b = lonI >= 0 ? 2 * lonI : -2 * lonI - 1;
    return a >= b ? a * a + a + b : b * b + a;
  }

  /**
   * Clear height cache
   */
  clearHeightCache(): void {
    this.columnCache.clear();
    this.tileBoundsCache = new WeakMap();
  }

  /**
   * Raycast against towers at screen coordinates
   * Returns the tower ID if a tower was hit, null otherwise
   */
  raycastTowers(screenX: number, screenY: number): string | null {
    // Convert screen coords to NDC
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new Vector2(
      ((screenX - rect.left) / rect.width) * 2 - 1,
      -((screenY - rect.top) / rect.height) * 2 + 1
    );

    // Create a FRESH raycaster - reusing this.raycaster causes issues after LoS checks
    const raycaster = new Raycaster();
    raycaster.setFromCamera(mouse, this.camera);

    // Test each tower mesh
    const towerMeshes = this.towers.getAllMeshes();
    for (const { id, mesh } of towerMeshes) {
      const intersects = raycaster.intersectObject(mesh, true);
      if (intersects.length > 0) {
        return id;
      }
    }

    return null;
  }

  /**
   * Raycast against terrain at screen coordinates
   *
   * IMPORTANT: Uses a fresh Raycaster instance each call.
   * See ARCHITECTURE.md "Raycaster Corruption Issue" for details.
   */
  raycastTerrain(screenX: number, screenY: number): Vector3 | null {
    // DevWorld: delegate to provider
    if (this.devTerrainProvider) {
      return this.devTerrainProvider.raycastFromScreen(
        screenX, screenY, this.camera, this.renderer
      );
    }

    if (!this.tilesRenderer) return null;

    // Convert screen coords to NDC
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new Vector2(
      ((screenX - rect.left) / rect.width) * 2 - 1,
      -((screenY - rect.top) / rect.height) * 2 + 1
    );

    // Create a FRESH raycaster - reusing this.raycaster causes issues after LoS checks
    // The shared raycaster gets corrupted state from LOS raycasting with custom origins
    const raycaster = new Raycaster();
    raycaster.setFromCamera(mouse, this.camera);

    const results = raycaster.intersectObject(this.tilesRenderer.group, true);

    if (results.length > 0) {
      return results[0].point.clone();
    }

    return null;
  }

  /**
   * Main render loop - call this each frame.
   * Headless-mode: when rendering is disabled, we skip all per-frame visual
   * work (tilesRenderer.update, camera updates, renderer.render, FPS tracking).
   * Gameplay still runs — it's driven by `onUpdateCallback` in `update()`,
   * which is called from the animate loop regardless of rendering state.
   */
  render(): void {
    if (!this._renderingEnabled) return;

    // DevWorld render path
    if (this.devTerrainProvider) {
      // Update controls (if any)
      if (this.controls) {
        this.controls.update();
      }

      // Update camera
      this.camera.updateMatrixWorld();

      // Position overlayGroup at terrain base height (no tiles movement in DevWorld)
      this.overlayGroup.position.y = 0;

      // Render scene (use composer if any post-processing is active)
      if (this.postProcessing?.needsRender()) {
        this.postProcessing.render();
      } else {
        this.renderer.render(this.scene, this.camera);
      }

      // Update FPS
      this.updateFPS();
      return;
    }

    // Normal tiles render path
    if (!this.tilesRenderer) return;

    // Update controls
    if (this.controls) {
      this.controls.update();
    }

    // Force camera far plane to limit tile loading (GlobeControls may override it)
    const VIEW_DISTANCE = 8000;
    if (this.camera.far > VIEW_DISTANCE) {
      this.camera.far = VIEW_DISTANCE;
      this.camera.updateProjectionMatrix();
    }

    // Update tiles
    this.camera.updateMatrixWorld();
    this.tilesRenderer.setResolutionFromRenderer(this.camera, this.renderer);
    this.tilesRenderer.setCamera(this.camera);

    // TODO: Tiles throttling was here (only update when camera moves >5m) but broke
    // initial tile loading — tiles never loaded because update() was never called.
    // Needs a smarter approach (e.g. always update until tiles are loaded, then throttle).
    this.tilesRenderer.update();

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
      const deltaPos = this.tilesRenderer.group.position.clone().sub(this.initialTilesPos);

      // Apply delta X/Z, but Y = delta + base terrain height
      this.overlayGroup.position.copy(deltaPos);
    }

    // Render scene (use composer if any post-processing is active)
    if (this.postProcessing?.needsRender()) {
      this.postProcessing.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    // Update FPS
    this.updateFPS();
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
    // Phase 5.14: Gameplay MUST run even in headless mode — it's driven by
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

    // Rotate test cube if exists
    if (this.testCube) {
      this.testCube.rotation.y += deltaTime * 0.001;
    }

    // Screen shake (XZ plane only — no vertical shake to avoid nausea)
    // Always remove previous frame's offset first, then apply new one
    if (this.shakeOffset.lengthSq() > 0) {
      this.camera.position.sub(this.shakeOffset);
    }
    if (this.shakeIntensity > 0) {
      this.shakeOffset.set(
        (Math.random() - 0.5) * 2 * this.shakeIntensity,
        0,
        (Math.random() - 0.5) * 2 * this.shakeIntensity
      );
      this.camera.position.add(this.shakeOffset);
      this.shakeIntensity = Math.max(0, this.shakeIntensity - this.shakeDecay);
    } else {
      this.shakeOffset.set(0, 0, 0);
    }
  }

  /**
   * Set the FPS limit. 0 = unlimited (vsync), 30 = 30fps, 60 = 60fps.
   * Persisted to localStorage.
   */
  setFpsLimit(fps: number): void {
    this._fpsLimit = fps;
    this._minFrameInterval = fps > 0 ? 1000 / fps : 0;
    localStorage.setItem('3dtd-fps-limit', String(fps));
  }

  getFpsLimit(): number {
    return this._fpsLimit;
  }

  /**
   * Start the render loop
   */
  startRenderLoop(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    let lastTime = performance.now();
    const animate = (currentTime: number) => {
      if (!this.isRunning) return;

      // FPS limiting: skip frame if not enough time has elapsed
      if (this._minFrameInterval > 0) {
        const elapsed = currentTime - lastTime;
        if (elapsed < this._minFrameInterval) {
          this.animationFrameId = requestAnimationFrame(animate);
          return;
        }
      }

      const deltaTime = currentTime - lastTime;
      lastTime = currentTime;

      this.update(deltaTime);
      this.render();

      this.animationFrameId = requestAnimationFrame(animate);
    };

    this.animationFrameId = requestAnimationFrame(animate);
  }

  /**
   * Stop the render loop
   */
  stopRenderLoop(): void {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Add a test cube at the origin (0, height, 0) inside tilesRenderer.group
   * This cube should stay fixed relative to the tiles when using GlobeControls
   *
   * @param height - Height above ground in meters (in group's local Y-up coordinates)
   * @returns The created mesh or null if no tiles renderer
   */
  addTestCubeAtOrigin(height = 50): Mesh | null {
    if (!this.tilesRenderer) {
      console.error('[ThreeTilesEngine] Cannot add test cube: tilesRenderer not initialized');
      return null;
    }

    // Create cube with overlay-friendly material
    const geometry = new BoxGeometry(20, 20, 20);
    const material = new MeshBasicMaterial({
      color: 0xff0000,
      depthTest: false, // Ignore depth - always draw
      depthWrite: false, // Don't affect depth buffer
      transparent: true,
      opacity: 0.9,
      side: DoubleSide, // Visible from all angles
    });

    const cube = new Mesh(geometry, material);

    // Add to overlayGroup (which is synced with tiles movement)
    cube.position.set(0, height, 0);
    cube.renderOrder = 9999;

    this.overlayGroup.add(cube);
    this.testCube = cube;

    return cube;
  }

  /**
   * Add axis helper at origin
   */
  addAxisHelper(): void {
    const axisHelper = new AxesHelper(50);
    this.scene.add(axisHelper);
    this.debugHelpers.push(axisHelper);
  }

  /**
   * DEBUG: Test ShaderMaterial with a simple cube
   * Call this to verify if ShaderMaterial renders at all
   */
  addShaderTestCube(x: number, y: number, z: number): void {
    const geometry = new BoxGeometry(5, 5, 5);

    const vertexShader = `
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      precision highp float;
      void main() {
        gl_FragColor = vec4(1.0, 0.0, 1.0, 0.8);
      }
    `;

    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      side: DoubleSide,
    });

    const cube = new Mesh(geometry, material);
    cube.position.set(x, y, z);
    cube.frustumCulled = false;
    this.scene.add(cube);
    this.debugHelpers.push(cube);

    console.log('[ThreeTilesEngine] Shader test cube added at', x, y, z);
  }

  /**
   * Clear debug helpers
   */
  clearDebugHelpers(): void {
    for (const helper of this.debugHelpers) {
      this.scene.remove(helper);
      if ((helper as Mesh).geometry) {
        (helper as Mesh).geometry.dispose();
      }
      if ((helper as Mesh).material) {
        const mat = (helper as Mesh).material;
        if (Array.isArray(mat)) {
          mat.forEach((m) => m.dispose());
        } else {
          mat.dispose();
        }
      }
    }
    this.debugHelpers = [];

    if (this.testCube) {
      this.scene.remove(this.testCube);
      this.testCube.geometry.dispose();
      (this.testCube.material as Material).dispose();
      this.testCube = null;
    }
  }

  private updateFPS(): void {
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFrameTime >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFrameTime = now;
    }
  }

  /**
   * Get current FPS
   */
  getFPS(): number {
    return this.fps;
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
   * Selection — nicht beim Engine-Boot, um die Initialisierung schlank
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
        console.log('[ThreeTilesEngine] 3D Tiles visible');
      }
    } else {
      if (this.tilesRenderer.group.parent) {
        this.scene.remove(this.tilesRenderer.group);
        console.log('[ThreeTilesEngine] 3D Tiles hidden');
      }
    }
  }

  /**
   * Check if 3D tiles are currently visible
   */
  areTilesVisible(): boolean {
    return this.tilesRenderer?.group.parent !== null;
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
   * EnvironmentControls in DevWorld — both share the same base class).
   *
   * Needed by scripted camera moves (intro flight) which take over the
   * camera for the duration of the move: setting `controls.enabled = false`
   * clears inertia + pending state and makes `controls.update()` a no-op,
   * so manual per-frame camera writes are not fought. Re-enabling resets
   * the control state, which re-derives the pivot from the camera.
   */
  getControls(): GlobeControls | null {
    return this.controls;
  }

  // Cached tile stats (updated every 500ms to avoid performance overhead)
  private cachedTileStats = { parsing: 0, downloading: 0, total: 0, visible: 0 };
  private lastTileStatsUpdate = 0;

  /**
   * Get tile loading statistics by counting meshes in the tiles group
   * and querying download/parse queue lengths.
   * Cached and updated every 500ms for performance.
   */
  getTileStats(): { parsing: number; downloading: number; total: number; visible: number } {
    const now = performance.now();
    if (now - this.lastTileStatsUpdate < 500) {
      return this.cachedTileStats;
    }

    if (!this.tilesRenderer) {
      return this.cachedTileStats;
    }

    // Count visible meshes in the tiles group
    let visibleMeshes = 0;
    let totalMeshes = 0;

    this.tilesRenderer.group.traverse((obj) => {
      if (obj instanceof Mesh) {
        totalMeshes++;
        if (obj.visible) {
          visibleMeshes++;
        }
      }
    });

    // Get queue lengths for downloading/parsing stats
    // PriorityQueue has 'length' property for queued items
    const downloadQueue = this.tilesRenderer.downloadQueue as { length?: number };
    const parseQueue = this.tilesRenderer.parseQueue as { length?: number };
    const downloading = downloadQueue?.length ?? 0;
    const parsing = parseQueue?.length ?? 0;

    this.cachedTileStats = {
      parsing,
      downloading,
      total: totalMeshes,
      visible: visibleMeshes,
    };
    this.lastTileStatsUpdate = now;

    return this.cachedTileStats;
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
   * Get the last recorded camera movement distance (for debugging click vs pan)
   */
  getLastCameraMovement(): number {
    return this.lastCameraMovement;
  }

  // ---- Bloom post-processing controls (delegate to PostProcessingPipeline) ----

  setBloomEnabled(enabled: boolean): void {
    this.postProcessing?.setBloomEnabled(enabled);
  }

  isBloomEnabled(): boolean {
    return this.postProcessing?.isBloomEnabled() ?? false;
  }

  setBloomStrength(strength: number): void {
    this.postProcessing?.setBloomStrength(strength);
  }

  setBloomThreshold(threshold: number): void {
    this.postProcessing?.setBloomThreshold(threshold);
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
   * Convert world position to screen coordinates
   */
  worldToScreen(worldPos: Vector3): { x: number; y: number } | null {
    const vector = worldPos.clone();
    vector.project(this.camera);

    // Check if behind camera
    if (vector.z > 1) {
      return null;
    }

    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: ((vector.x + 1) / 2) * rect.width + rect.left,
      y: ((-vector.y + 1) / 2) * rect.height + rect.top,
    };
  }

  /**
   * Preload all entity models
   */
  async preloadModels(): Promise<void> {
    await Promise.all([
      this.enemies.preloadAllModels(),
      this.towers.preloadAllModels(),
    ]);
  }

  /**
   * Clear all game entities
   */
  clearEntities(): void {
    this.enemies.clear();
    this.towers.clear();
    this.projectiles.clear();
    this.effects.clear();
    this.flameBeams.clear();
    this.tentacles.clear();
    this.trailStreaks.clear();
    this.lightningBolts.clear();
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.stopRenderLoop();
    this.clearDebugHelpers();

    // Remove event listeners to prevent memory leaks
    if (this.tilesRenderer) {
      this.tilesRenderer.removeEventListener('tiles-load-end', this.tilesLoadEndHandler);
    }
    if (this.controls) {
      this.controls.removeEventListener('start', this.controlsStartHandler);
      this.controls.removeEventListener('end', this.controlsEndHandler);
    }

    // Dispose GPU-LOS resources
    if (this.towerShadowMapper) {
      this.towerShadowMapper.dispose();
      this.towerShadowMapper = null;
    }

    // Dispose entity renderers
    this.enemies.dispose();
    this.towers.dispose();
    this.projectiles.dispose();
    this.effects.dispose();
    this.flameBeams.dispose();
    this.tentacles.dispose();
    this.trailStreaks.dispose();
    this.lightningBolts.dispose();

    // Dispose spatial audio
    this.spatialAudio.dispose();

    // Dispose tiles renderer
    if (this.tilesRenderer) {
      this.scene.remove(this.tilesRenderer.group);
      this.tilesRenderer.dispose();
      this.tilesRenderer = null;
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

    // Dispose renderer
    this.renderer.dispose();
  }
}
