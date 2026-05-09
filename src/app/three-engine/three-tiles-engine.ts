import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  Raycaster,
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
  MeshStandardMaterial,
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
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { createColorGradingPass, ColorGradingPreset } from './post-processing/color-grading';
import { EllipsoidSync } from './ellipsoid-sync';
import {
  CoordinateSync,
  ThreeTowerRenderer,
  ThreeProjectileRenderer,
  ThreeEffectsRenderer,
  ThreeFlameBeamRenderer,
  ThreeTentacleRenderer,
  TrailStreakRenderer,
} from './renderers';
import { InstancedEnemyRenderer } from './renderers/instanced-enemy/instanced-enemy.renderer';
import { SpatialAudioManager } from '../managers/audio/spatial-audio.manager';
import { AssetManagerService } from '../services/asset-manager.service';
import { DevWorldService } from '../devworld/devworld.service';
import { TerrainProvider } from '../interfaces/terrain-provider.interface';
import { DevTerrainProvider } from '../devworld/dev-terrain.provider';

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

  // Post-processing
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private bloomEnabled = false;

  // Color grading (LUT post-processing)
  private colorGrading: ReturnType<typeof createColorGradingPass> | null = null;
  private colorGradingPreset: ColorGradingPreset = 'none';

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
  private heightCache = new Map<number, number>();
  private readonly CACHE_PRECISION = 5;
  private readonly CACHE_SCALE = 1e5; // 10^CACHE_PRECISION
  private readonly HEIGHT_CHANGE_THRESHOLD = 2.0; // Only refresh if height changed by >2m
  private lastOriginHeight: number | null = null;

  // Debug flag: reset when tiles are loaded so we get debug output
  private tilesWereLoaded = false;
  // Tile quality tracking for route protection (active only during route calculation)
  private tileQualityTracker: { errors: number[], depths: number[] } | null = null;
  private tileSceneMap: Map<Object3D, { geometricError: number, depth: number }> | null = null;

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
  private overlayBaseY = 0;

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
          if (this.onFirstTilesLoadedCallback) {
            this.onFirstTilesLoadedCallback();
          }
        } else if (stats.visible >= MIN_VISIBLE_TILES) {
          this.firstTilesLoaded = true;
          if (this.onFirstTilesLoadedCallback) {
            this.onFirstTilesLoadedCallback();
          }
        } else {
          // Not ready yet - schedule retry
          this.scheduleFirstTilesRetry();
        }
      }

      // HEIGHT REFRESH - only if raycast succeeded
      if (freshOriginHeight !== null) {
        const heightDelta = this.lastOriginHeight !== null
          ? Math.abs(freshOriginHeight - this.lastOriginHeight)
          : Infinity; // First load always triggers refresh

        if (heightDelta > this.HEIGHT_CHANGE_THRESHOLD) {
          this.lastOriginHeight = freshOriginHeight;

          // Clear cache and notify for full refresh
          const cacheSize = this.heightCache.size;
          this.heightCache.clear();

          if (this.onTilesLoadCallback) {
            const t0 = performance.now();
            this.onTilesLoadCallback();
            console.warn(`[PerfTrace] onTilesLoadCallback: ${(performance.now() - t0).toFixed(1)}ms (cleared ${cacheSize} cache entries, delta=${heightDelta.toFixed(2)}m)`);
          }
        }
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
    this.composer = new EffectComposer(this.renderer);

    const renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);

    const bloomPass = new UnrealBloomPass(
      new Vector2(window.innerWidth, window.innerHeight),
      0.3,  // strength (subtle)
      0.4,  // radius
      0.85  // threshold (only bright things bloom)
    );
    this.bloomPass = bloomPass;
    this.composer.addPass(bloomPass);

    // Color grading LUT pass (inserted before output, disabled by default)
    this.colorGrading = createColorGradingPass();
    this.composer.addPass(this.colorGrading.pass);

    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);
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
    this.overlayBaseY = 0; // Reset overlay offset - will be set when new terrain loads

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
    if (this.composer) {
      this.composer.setSize(width, height);
    }
  }

  /**
   * Get ground Y position at scene X,Z coordinates using raycasting
   * Returns the Y value where the ray hits the terrain
   */
  getGroundYAtScenePos(x: number, z: number): number | null {
    if (!this.tilesRenderer) return null;

    // Cast ray from high above straight down
    const rayOrigin = new Vector3(x, 5000, z);
    const rayDir = new Vector3(0, -1, 0);

    this.raycaster.set(rayOrigin, rayDir);
    const results = this.raycaster.intersectObject(this.tilesRenderer.group, true);

    if (results.length > 0) {
      return results[0].point.y;
    }
    return null;
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
   * Check if tiles are loaded enough for raycasting
   */
  areTilesReadyForRaycast(): boolean {
    // DevWorld: always ready
    if (this.devTerrainProvider) {
      return this.devTerrainProvider.isReady();
    }

    if (!this.tilesRenderer) return false;

    // Cast from camera toward origin
    const camPos = this.camera.position.clone();
    const direction = new Vector3(0, 0, 0).sub(camPos).normalize();
    this.raycaster.set(camPos, direction);

    const results = this.raycaster.intersectObject(this.tilesRenderer.group, true);
    return results.length > 0;
  }

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

    // Check cache first
    const cacheKey = this.getHeightCacheKey(lat, lon);
    if (this.heightCache.has(cacheKey)) {
      return this.heightCache.get(cacheKey)!;
    }

    // Get local position
    const localPos = this.sync.geoToLocalSimple(lat, lon, 0);

    // Do the raycast
    const height = this.raycastTerrainHeight(localPos.x, localPos.z);

    // Cache the result (even nulls as a special value)
    if (height !== null) {
      this.heightCache.set(cacheKey, height);
    }

    return height;
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
    const METERS_TO_DEG_LAT = 1 / 111320;
    const cosLat = Math.cos(lat * Math.PI / 180);

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
   * Internal raycast for terrain height - no caching, just the raw raycast.
   * Used for cache invalidation checks and actual height lookups.
   *
   * @param localX - Local X coordinate (meters from origin)
   * @param localZ - Local Z coordinate (meters from origin)
   * @returns Height in local Y coordinates, or null if no hit
   */
  private raycastTerrainHeight(localX: number, localZ: number): number | null {
    // DevWorld: delegate to provider
    if (this.devTerrainProvider) {
      return this.devTerrainProvider.getHeightAtLocal(localX, localZ);
    }

    if (!this.tilesRenderer) return null;

    // Check if tiles are loaded (only on first call)
    if (!this.tilesWereLoaded) {
      let meshCount = 0;
      this.tilesRenderer.group.traverse((obj) => {
        if ((obj as Mesh).isMesh) meshCount++;
      });

      if (meshCount === 0) {
        return null;
      }

      this.tilesWereLoaded = true;
    }

    // Raycast from high above straight down
    const rayOrigin = new Vector3(localX, 10000, localZ);
    const direction = new Vector3(0, -1, 0);

    this.raycaster.set(rayOrigin, direction);
    this.raycaster.far = 20000;

    const results = this.raycaster.intersectObject(this.tilesRenderer.group, true);

    if (results.length > 0) {
      // If tile quality tracking is active, record tile info from hit
      if (this.tileQualityTracker && this.tileSceneMap) {
        let obj: Object3D | null = results[0].object;
        while (obj && !this.tileSceneMap.has(obj)) {
          obj = obj.parent;
        }
        const info = obj ? this.tileSceneMap.get(obj) : null;
        if (info) {
          this.tileQualityTracker.errors.push(info.geometricError);
          this.tileQualityTracker.depths.push(info.depth);
        }
      }
      return results[0].point.y;
    }

    return null;
  }

  /**
   * Start tracking tile quality during raycasts.
   * Builds a Scene→TileInfo lookup from all loaded tiles, then records
   * geometricError/depth for each subsequent raycast hit.
   * Call stopTileQualityTracking() after raycasts to get results.
   */
  startTileQualityTracking(): void {
    if (!this.tilesRenderer) return;
    this.tileSceneMap = new Map();
    this.tilesRenderer.forEachLoadedModel((scene: Object3D, tile: any) => {
      this.tileSceneMap!.set(scene, {
        geometricError: tile.geometricError ?? Infinity,
        depth: tile.__depth ?? 0
      });
    });
    this.tileQualityTracker = { errors: [], depths: [] };
  }

  /**
   * Stop tile quality tracking and return aggregated results.
   * Returns null if no raycasts were tracked.
   */
  stopTileQualityTracking(): { avgGeometricError: number, minDepth: number, samples: number } | null {
    const tracker = this.tileQualityTracker;
    this.tileQualityTracker = null;
    this.tileSceneMap = null;
    if (!tracker || tracker.errors.length === 0) return null;
    return {
      avgGeometricError: tracker.errors.reduce((a, b) => a + b, 0) / tracker.errors.length,
      minDepth: Math.min(...tracker.depths),
      samples: tracker.errors.length
    };
  }

  /**
   * Raycast between two 3D points to check Line-of-Sight
   * Returns true if the ray is BLOCKED (hits terrain/building before reaching target)
   *
   * @param originX, originY, originZ - Starting point (e.g., tower tip)
   * @param targetX, targetY, targetZ - End point (e.g., hex cell or enemy position)
   * @returns true if blocked, false if clear line of sight
   */
  // Debug counter for LOS raycasts
  private losDebugCounter = 0;

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

    // Calculate direction and distance
    const origin = new Vector3(originX, originY, originZ);
    const target = new Vector3(targetX, targetY, targetZ);
    const direction = target.clone().sub(origin);
    const distance = direction.length();
    direction.normalize();

    // Set up raycaster
    this.raycaster.set(origin, direction);
    this.raycaster.far = distance - 0.5; // Stop slightly before target

    // Check for intersections
    const results = this.raycaster.intersectObject(this.tilesRenderer.group, true);

    // Debug: log first few raycasts
    if (this.losDebugCounter < 5) {
      console.log(`[LOS Raycast #${this.losDebugCounter}] origin=(${originX.toFixed(1)}, ${originY.toFixed(1)}, ${originZ.toFixed(1)}) → target=(${targetX.toFixed(1)}, ${targetY.toFixed(1)}, ${targetZ.toFixed(1)}) dist=${distance.toFixed(1)} hits=${results.length}`);
      this.losDebugCounter++;
    }

    // If we hit something before reaching the target, LoS is blocked
    return results.length > 0;
  }

  /**
   * Get terrain height at local coordinates (public wrapper for raycastTerrainHeight)
   * Used for debug visualizations that work in local coordinate space.
   *
   * @param localX - Local X coordinate (meters from origin)
   * @param localZ - Local Z coordinate (meters from origin)
   * @returns Height in local Y coordinates, or null if no hit
   */
  getTerrainHeightAtLocal(localX: number, localZ: number): number | null {
    return this.raycastTerrainHeight(localX, localZ);
  }

  /**
   * Get the skyline height at local coordinates — i.e. the highest hit
   * (terrain or building roof) in a small neighbourhood around (x, z).
   *
   * In Real-World 3D-Tiles this samples the loaded tileset; the top-down
   * raycast naturally hits whatever is highest, so the returned value is
   * already "ground or roof, whichever wins". The 4-corner neighbourhood
   * makes the result robust against tile-mesh seams and the cell granularity.
   *
   * In DevWorld this delegates to the provider's skyline sampler which
   * raycasts against terrain + building meshes.
   *
   * @param localX - Local X coordinate (meters from origin)
   * @param localZ - Local Z coordinate (meters from origin)
   * @param sampleRadius - Neighbourhood radius in meters (default 1.5m, ~cell size)
   * @returns Skyline Y in local coordinates, or null if no hit
   */
  getSkylineHeightAtLocal(localX: number, localZ: number, sampleRadius = 1.5): number | null {
    // DevWorld: delegate to provider (top-down raycast against buildings + terrain)
    if (this.devTerrainProvider) {
      return this.devTerrainProvider.getSkylineHeightAtLocal(localX, localZ, sampleRadius);
    }

    if (!this.tilesRenderer) return null;

    // 5-sample max: centre + 4 corner offsets at ±sampleRadius
    const offsets: [number, number][] = [
      [0, 0],
      [sampleRadius, sampleRadius],
      [sampleRadius, -sampleRadius],
      [-sampleRadius, sampleRadius],
      [-sampleRadius, -sampleRadius],
    ];

    let maxY: number | null = null;
    for (const [dx, dz] of offsets) {
      const y = this.raycastTerrainHeight(localX + dx, localZ + dz);
      if (y !== null && (maxY === null || y > maxY)) {
        maxY = y;
      }
    }
    return maxY;
  }

  /**
   * @deprecated Use getTerrainHeightAtGeo() instead - this method uses incorrect local raycast
   */
  getOverlayTerrainHeight(_localX: number, _localZ: number): number | null {
    console.warn('[Terrain] getOverlayTerrainHeight is deprecated - use getTerrainHeightAtGeo');
    return null;
  }

  /**
   * Get terrain height at geo coordinates for overlay objects.
   * Uses correct ECEF raycast via getTerrainHeightAtGeo.
   *
   * @param lat - Latitude in degrees
   * @param lon - Longitude in degrees
   * @param heightAboveGround - Additional height above terrain (default 0)
   * @returns Height above ellipsoid + offset, or null if tiles not loaded
   */
  getOverlayTerrainHeightAtGeo(lat: number, lon: number, heightAboveGround = 0): number | null {
    const terrainHeight = this.getTerrainHeightAtGeo(lat, lon);

    if (terrainHeight !== null) {
      return terrainHeight + heightAboveGround;
    }

    // No fallback - return null so caller knows tiles aren't ready
    return null;
  }

  /**
   * Get terrain height at geo position using raycasting
   */
  async getTerrainHeight(lat: number, lon: number): Promise<number> {
    const key = this.getHeightCacheKey(lat, lon);
    if (this.heightCache.has(key)) {
      return this.heightCache.get(key)!;
    }

    if (!this.tilesRenderer) return 0;

    // Position 10km above the point
    const position = new Vector3();
    WGS84_ELLIPSOID.getCartographicToPosition(
      lat * MathUtils.DEG2RAD,
      lon * MathUtils.DEG2RAD,
      10000,
      position
    );

    // Apply tiles group transform
    position.applyMatrix4(this.tilesRenderer.group.matrixWorld);

    // Direction toward ellipsoid center (down)
    const direction = position.clone().negate().normalize();

    this.raycaster.set(position, direction);

    const results = this.raycaster.intersectObject(this.tilesRenderer.group, true);

    if (results.length > 0) {
      // Convert hit point back to cartographic to get height
      const hitPoint = results[0].point.clone();
      const invMatrix = this.tilesRenderer.group.matrixWorld.clone().invert();
      hitPoint.applyMatrix4(invMatrix);

      const cartographic: { lat: number; lon: number; height: number } = { lat: 0, lon: 0, height: 0 };
      WGS84_ELLIPSOID.getPositionToCartographic(hitPoint, cartographic);

      const height = cartographic.height;
      this.heightCache.set(key, height);
      return height;
    }

    return 0;
  }

  /**
   * Get terrain height synchronously (from cache only)
   */
  getTerrainHeightSync(lat: number, lon: number): number | null {
    const key = this.getHeightCacheKey(lat, lon);
    return this.heightCache.get(key) ?? null;
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
    this.heightCache.clear();
  }

  /**
   * Preload heights for a path
   */
  async preloadHeightsForPath(path: { lat: number; lon: number }[]): Promise<void> {
    for (const point of path) {
      await this.getTerrainHeight(point.lat, point.lon);
    }
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
      this.overlayGroup.position.y = this.overlayBaseY;

      // Render scene (use composer if any post-processing is active)
      if (this.needsPostProcessing() && this.composer) {
        this.composer.render();
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
      this.overlayGroup.position.set(deltaPos.x, deltaPos.y + this.overlayBaseY, deltaPos.z);
    }

    // Render scene (use composer if any post-processing is active)
    if (this.needsPostProcessing() && this.composer) {
      this.composer.render();
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
   * Add a test cube at a geo position (for debugging)
   */
  async addTestCube(lat: number, lon: number): Promise<Mesh> {
    const height = await this.getTerrainHeight(lat, lon);
    const localPos = this.sync.geoToLocal(lat, lon, height + 5);

    const geometry = new BoxGeometry(10, 10, 10);
    const material = new MeshStandardMaterial({
      color: 0x22c55e,
      metalness: 0.3,
      roughness: 0.7,
    });
    const cube = new Mesh(geometry, material);
    cube.position.copy(localPos);

    this.scene.add(cube);
    this.testCube = cube;

    return cube;
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
   * Add test cubes at spawn positions
   */
  async addTestCubesAtSpawns(spawns: { lat: number; lon: number }[]): Promise<void> {
    const colors = [0xef4444, 0xf97316, 0x3b82f6, 0x8b5cf6];

    for (let i = 0; i < spawns.length; i++) {
      const spawn = spawns[i];
      const height = await this.getTerrainHeight(spawn.lat, spawn.lon);
      const localPos = this.sync.geoToLocal(spawn.lat, spawn.lon, height + 5);

      const geometry = new BoxGeometry(8, 8, 8);
      const material = new MeshStandardMaterial({
        color: colors[i % colors.length],
        metalness: 0.3,
        roughness: 0.7,
      });
      const cube = new Mesh(geometry, material);
      cube.position.copy(localPos);
      this.scene.add(cube);
      this.debugHelpers.push(cube);
    }
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
   * Set the base Y position for the overlay group
   * This should be set to the terrain height at the origin point
   * so that overlays with Y=0 appear at terrain surface level
   *
   * @param y - Terrain Y at origin (from getTerrainHeightAtGeo at HQ)
   */
  setOverlayBaseY(y: number): void {
    this.overlayBaseY = y;
  }

  /**
   * Get tiles renderer group (for debugging)
   */
  getTilesGroup(): Group | null {
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

  // ---- Bloom post-processing controls ----

  /** Check if any post-processing pass is active (bloom or color grading) */
  private needsPostProcessing(): boolean {
    return this.bloomEnabled || this.colorGradingPreset !== 'none';
  }

  setBloomEnabled(enabled: boolean): void {
    this.bloomEnabled = enabled;
  }

  isBloomEnabled(): boolean {
    return this.bloomEnabled;
  }

  setBloomStrength(strength: number): void {
    if (this.bloomPass) this.bloomPass.strength = strength;
  }

  setBloomThreshold(threshold: number): void {
    if (this.bloomPass) this.bloomPass.threshold = threshold;
  }

  // ---- Color Grading (LUT) ----

  setColorGradingPreset(preset: ColorGradingPreset): void {
    this.colorGradingPreset = preset;
    if (this.colorGrading) {
      this.colorGrading.setPreset(preset);
    }
  }

  getColorGradingPreset(): ColorGradingPreset {
    return this.colorGradingPreset;
  }

  setColorGradingIntensity(value: number): void {
    if (this.colorGrading) {
      this.colorGrading.setIntensity(value);
    }
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

    // Dispose entity renderers
    this.enemies.dispose();
    this.towers.dispose();
    this.projectiles.dispose();
    this.effects.dispose();
    this.flameBeams.dispose();
    this.tentacles.dispose();
    this.trailStreaks.dispose();

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

    // Dispose color grading LUT textures
    if (this.colorGrading) {
      this.colorGrading.dispose();
      this.colorGrading = null;
    }

    // Dispose post-processing composer
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }

    // Dispose renderer
    this.renderer.dispose();
  }
}
