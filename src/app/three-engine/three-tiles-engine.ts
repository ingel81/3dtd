import * as THREE from 'three';
import { MathUtils } from 'three';
import {
  TilesRenderer,
  GlobeControls,
  WGS84_ELLIPSOID,
} from '3d-tiles-renderer';
// CAMERA_FRAME is used for getObjectFrame coordinate transformations
import { CAMERA_FRAME } from '3d-tiles-renderer/src/three/renderer/math/Ellipsoid.js';
import {
  TilesFadePlugin,
  TileCompressionPlugin,
  UpdateOnChangePlugin,
  UnloadTilesPlugin,
  GLTFExtensionsPlugin,
  CesiumIonAuthPlugin,
  ReorientationPlugin,
} from '3d-tiles-renderer/plugins';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { EllipsoidSync } from './ellipsoid-sync';
import {
  CoordinateSync,
  ThreeEnemyRenderer,
  ThreeTowerRenderer,
  ThreeProjectileRenderer,
  ThreeEffectsRenderer,
} from './renderers';
import { SpatialAudioManager } from '../managers/spatial-audio.manager';

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
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: GlobeControls | null = null;
  private tilesRenderer: TilesRenderer | null = null;
  private reorientationPlugin: ReorientationPlugin | null = null;

  // Coordinate sync
  readonly sync: EllipsoidSync;

  // Raycaster for terrain height queries
  private raycaster: THREE.Raycaster;
  private heightCache = new Map<string, number>();
  private readonly CACHE_PRECISION = 5;
  private readonly HEIGHT_CHANGE_THRESHOLD = 2.0; // Only refresh if height changed by >2m
  private lastOriginHeight: number | null = null;

  // Debug flag: reset when tiles are loaded so we get debug output
  private tilesWereLoaded = false;

  // Pre-computed initial camera position (set before initialize())
  private initialCameraPosition: InitialCameraPosition | null = null;

  // Entity renderers
  readonly enemies: ThreeEnemyRenderer;
  readonly towers: ThreeTowerRenderer;
  readonly projectiles: ThreeProjectileRenderer;
  readonly effects: ThreeEffectsRenderer;

  // Spatial audio manager
  readonly spatialAudio: SpatialAudioManager;

  // Callback for when camera controls drag ends (for distinguishing clicks from pans)
  onControlsDragEnd: (() => void) | null = null;
  private controlsStartTime = 0;
  private controlsStartCameraPos = new THREE.Vector3();
  private lastCameraMovement = 0;

  // Test entities (for debugging)
  private testCube: THREE.Mesh | null = null;
  private debugHelpers: THREE.Object3D[] = [];


  // Overlay group for markers, streets, routes
  // Added to scene root, but synced with tiles movement each frame
  private overlayGroup: THREE.Group;

  // Track initial tiles position to calculate movement delta
  private initialTilesPos = new THREE.Vector3();
  private tilesPosInitialized = false;

  // Base Y position for overlay group (terrain height at origin)
  // This ensures overlays are placed on the terrain surface, not at world Y=0
  private overlayBaseY = 0;

  // Callback when tiles finish loading (for terrain height refresh)
  private onTilesLoadCallback: (() => void) | null = null;
  private tilesLoadDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly TILES_LOAD_DEBOUNCE_MS = 500; // Wait 500ms after last tile load

  // Callback when first tiles are loaded (for loading indicator)
  private onFirstTilesLoadedCallback: (() => void) | null = null;
  private firstTilesLoaded = false;

  // Callback for per-frame updates (animations)
  private onUpdateCallback: ((deltaTime: number) => void) | null = null;

  // Performance stats
  private lastFrameTime = 0;
  private frameCount = 0;
  private fps = 0;

  // Animation
  private animationFrameId: number | null = null;
  private isRunning = false;

  // Cesium Ion credentials
  private cesiumIonToken: string;
  private cesiumAssetId: string;

  constructor(
    canvas: HTMLCanvasElement,
    cesiumIonToken: string,
    cesiumAssetId: string,
    originLat: number,
    originLon: number,
    originHeight: number = 0
  ) {
    this.cesiumIonToken = cesiumIonToken;
    this.cesiumAssetId = cesiumAssetId;

    // Initialize coordinate sync
    this.sync = new EllipsoidSync(originLat, originLon, originHeight);

    // Raycaster for terrain queries
    this.raycaster = new THREE.Raycaster();

    // Create WebGL renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      logarithmicDepthBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x151c1f);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Distance limits - keep in sync!
    const VIEW_DISTANCE = 8000; // Max tile loading distance
    const FOG_START = VIEW_DISTANCE * 0.25; // 2000m - fog begins
    const FOG_END = VIEW_DISTANCE * 0.75; // 6000m - fully in fog

    // Create scene with distance fog
    this.scene = new THREE.Scene();
    const fogColor = 0x1a1f25; // Slightly lighter than background for depth
    this.scene.fog = new THREE.Fog(fogColor, FOG_START, FOG_END);

    // Create overlay group for markers, streets, routes
    // Will be added to SCENE (not tilesGroup) and synced each frame
    this.overlayGroup = new THREE.Group();
    this.scene.add(this.overlayGroup);

    // Create camera - far plane limits tile loading distance
    this.camera = new THREE.PerspectiveCamera(
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
      localToGeo: (vec: THREE.Vector3) => this.sync.localToGeo(vec),
    };

    this.enemies = new ThreeEnemyRenderer(this.scene, coordinateSync);
    this.towers = new ThreeTowerRenderer(this.scene, coordinateSync);
    this.projectiles = new ThreeProjectileRenderer(this.scene, coordinateSync);
    this.effects = new ThreeEffectsRenderer(this.scene, coordinateSync);

    // Initialize spatial audio with camera listener
    this.spatialAudio = new SpatialAudioManager(this.scene, this.camera);
    this.spatialAudio.setGeoToLocal((lat, lon, height) =>
      this.sync.geoToLocalSimple(lat, lon, height)
    );

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
   * Initialize 3D Tiles (async - must be called after constructor)
   */
  async initialize(): Promise<void> {
    // Create TilesRenderer
    this.tilesRenderer = new TilesRenderer();

    // Register plugins - Cesium Ion 3D Tiles
    this.tilesRenderer.registerPlugin(
      new CesiumIonAuthPlugin({
        apiToken: this.cesiumIonToken,
        assetId: this.cesiumAssetId,
      })
    );
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

    // Performance settings
    this.tilesRenderer.errorTarget = 20;

    // Listen for tile loading events to refresh terrain heights
    // 'tiles-load-end' fires when ALL currently visible tiles have finished loading
    this.tilesRenderer.addEventListener('tiles-load-end', () => {
      this.onTilesLoadEnd();
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

      if (freshOriginHeight !== null) {
        // Fire first tiles loaded callback (only once)
        if (!this.firstTilesLoaded) {
          this.firstTilesLoaded = true;
          if (this.onFirstTilesLoadedCallback) {
            this.onFirstTilesLoadedCallback();
          }
        }

        const heightDelta = this.lastOriginHeight !== null
          ? Math.abs(freshOriginHeight - this.lastOriginHeight)
          : Infinity; // First load always triggers refresh

        if (heightDelta > this.HEIGHT_CHANGE_THRESHOLD) {
          this.lastOriginHeight = freshOriginHeight;

          // Clear cache and notify for full refresh
          this.heightCache.clear();

          if (this.onTilesLoadCallback) {
            this.onTilesLoadCallback();
          }
        }
      }
    }, this.TILES_LOAD_DEBOUNCE_MS);
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
    const hemi = new THREE.HemisphereLight(
      0xffeedd, // Warm sky color
      0x806040, // Warm ground color
      1.5
    );
    this.scene.add(hemi);

    // Main sun light (key light) - warm bright sun
    const sun = new THREE.DirectionalLight(0xffeecc, 3.0); // Warm and bright
    sun.position.set(-50, 100, -30); // SW direction, high angle
    this.scene.add(sun);

    // Fill light - warm from opposite side
    const fill = new THREE.DirectionalLight(0xfff0e0, 1.5); // Warm
    fill.position.set(50, 50, 30); // NE direction
    this.scene.add(fill);

    // Warm ambient for overall brightness
    const ambient = new THREE.AmbientLight(0xffe8d0, 0.8); // Warm tint
    this.scene.add(ambient);
  }

  /**
   * Setup sky background from equirectangular texture
   */
  private setupSky(): void {
    const loader = new THREE.TextureLoader();

    loader.load(
      '/assets/images/kloppenheim_06_puresky.jpg',
      (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        this.scene.background = texture;
      },
      undefined,
      (error) => {
        console.warn('[ThreeTilesEngine] Failed to load sky texture, using fallback color', error);
        this.scene.background = new THREE.Color(0x87ceeb); // Light blue fallback
      }
    );
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
    this.controls.addEventListener('start', () => {
      this.controlsStartTime = performance.now();
      this.controlsStartCameraPos.copy(this.camera.position);
    });

    this.controls.addEventListener('end', () => {
      // Record camera movement for debugging
      this.lastCameraMovement = this.camera.position.distanceTo(this.controlsStartCameraPos);

      if (this.onControlsDragEnd) {
        // Only consider it a drag if camera actually moved significantly
        // Threshold of 5 units to ignore tiny jitter during normal clicks
        if (this.lastCameraMovement > 5) {
          this.onControlsDragEnd();
        }
      }
    });

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
    azimuth: number = 0,
    elevation: number = -45,
    roll: number = 0
  ): void {
    if (!this.tilesRenderer) return;

    this.tilesRenderer.group.updateMatrixWorld();

    // Use getObjectFrame for proper camera positioning in globe view
    const tempMatrix = new THREE.Matrix4();
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
    targetX: number = 0,
    targetY: number = 0,
    targetZ: number = 0
  ): void {
    this.camera.position.set(x, y, z);
    this.camera.lookAt(targetX, targetY, targetZ);
  }

  /**
   * Fly camera to a position (animated)
   */
  flyTo(lat: number, lon: number, height: number, duration: number = 1.5): void {
    // For now, just set position directly
    // TODO: Implement smooth animation
    this.setCameraPosition(lat, lon, height, 0, -45);
  }

  /**
   * Update origin (when game location changes)
   * Also resets firstTilesLoaded so the callback fires again for the new location
   */
  setOrigin(lat: number, lon: number, height: number = 0): void {
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
    this.tilesWereLoaded = false;
    this.lastOriginHeight = null;
    this.tilesLoadedForRaycast = false;
    this.raycastDebugCount = 0;
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
  }

  /**
   * Get ground Y position at scene X,Z coordinates using raycasting
   * Returns the Y value where the ray hits the terrain
   */
  getGroundYAtScenePos(x: number, z: number): number | null {
    if (!this.tilesRenderer) return null;

    // Cast ray from high above straight down
    const rayOrigin = new THREE.Vector3(x, 5000, z);
    const rayDir = new THREE.Vector3(0, -1, 0);

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
  private raycastDebugCount = 0;
  private tilesLoadedForRaycast = false;

  /**
   * Check if tiles are loaded enough for raycasting
   */
  areTilesReadyForRaycast(): boolean {
    if (!this.tilesRenderer) return false;

    // Cast from camera toward origin
    const camPos = this.camera.position.clone();
    const direction = new THREE.Vector3(0, 0, 0).sub(camPos).normalize();
    this.raycaster.set(camPos, direction);

    const results = this.raycaster.intersectObject(this.tilesRenderer.group, true);
    return results.length > 0;
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
   * Internal raycast for terrain height - no caching, just the raw raycast.
   * Used for cache invalidation checks and actual height lookups.
   *
   * @param localX - Local X coordinate (meters from origin)
   * @param localZ - Local Z coordinate (meters from origin)
   * @returns Height in local Y coordinates, or null if no hit
   */
  private raycastTerrainHeight(localX: number, localZ: number): number | null {
    if (!this.tilesRenderer) return null;

    // Check if tiles are loaded (only on first call)
    if (!this.tilesWereLoaded) {
      let meshCount = 0;
      this.tilesRenderer.group.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) meshCount++;
      });

      if (meshCount === 0) {
        return null;
      }

      this.tilesWereLoaded = true;
      this.raycastDebugCount = 0;
    }

    // Raycast from high above straight down
    const rayOrigin = new THREE.Vector3(localX, 10000, localZ);
    const direction = new THREE.Vector3(0, -1, 0);

    this.raycaster.set(rayOrigin, direction);
    this.raycaster.far = 20000;

    const results = this.raycaster.intersectObject(this.tilesRenderer.group, true);

    if (results.length > 0) {
      return results[0].point.y;
    }

    return null;
  }

  /**
   * Raycast between two 3D points to check Line-of-Sight
   * Returns true if the ray is BLOCKED (hits terrain/building before reaching target)
   *
   * @param originX, originY, originZ - Starting point (e.g., tower tip)
   * @param targetX, targetY, targetZ - End point (e.g., hex cell or enemy position)
   * @returns true if blocked, false if clear line of sight
   */
  private raycastLineOfSight(
    originX: number, originY: number, originZ: number,
    targetX: number, targetY: number, targetZ: number
  ): boolean {
    if (!this.tilesRenderer) return false;

    // Calculate direction and distance
    const origin = new THREE.Vector3(originX, originY, originZ);
    const target = new THREE.Vector3(targetX, targetY, targetZ);
    const direction = target.clone().sub(origin);
    const distance = direction.length();
    direction.normalize();

    // Set up raycaster
    this.raycaster.set(origin, direction);
    this.raycaster.far = distance - 0.5; // Stop slightly before target

    // Check for intersections
    const results = this.raycaster.intersectObject(this.tilesRenderer.group, true);

    // If we hit something before reaching the target, LoS is blocked
    return results.length > 0;
  }

  /**
   * @deprecated Use getTerrainHeightAtGeo() instead - this method uses incorrect local raycast
   */
  getOverlayTerrainHeight(localX: number, localZ: number): number | null {
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
  getOverlayTerrainHeightAtGeo(lat: number, lon: number, heightAboveGround: number = 0): number | null {
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
    const position = new THREE.Vector3();
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

  private getHeightCacheKey(lat: number, lon: number): string {
    return `${lat.toFixed(this.CACHE_PRECISION)}_${lon.toFixed(this.CACHE_PRECISION)}`;
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
    const mouse = new THREE.Vector2(
      ((screenX - rect.left) / rect.width) * 2 - 1,
      -((screenY - rect.top) / rect.height) * 2 + 1
    );

    // Create a FRESH raycaster - reusing this.raycaster causes issues after LoS checks
    const raycaster = new THREE.Raycaster();
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
   */
  raycastTerrain(screenX: number, screenY: number): THREE.Vector3 | null {
    if (!this.tilesRenderer) return null;

    // Convert screen coords to NDC
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((screenX - rect.left) / rect.width) * 2 - 1,
      -((screenY - rect.top) / rect.height) * 2 + 1
    );

    this.raycaster.setFromCamera(mouse, this.camera);

    const results = this.raycaster.intersectObject(this.tilesRenderer.group, true);

    if (results.length > 0) {
      return results[0].point.clone();
    }

    return null;
  }

  /**
   * Main render loop - call this each frame
   */
  render(): void {
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

    // Render scene
    this.renderer.render(this.scene, this.camera);

    // Update FPS
    this.updateFPS();
  }

  /**
   * Update game entities (call before render)
   */
  update(deltaTime: number): void {
    const deltaSeconds = deltaTime / 1000;

    // Update enemy animations
    this.enemies.updateAnimations(deltaSeconds);

    // Update tower selection animations
    this.towers.updateAnimations(deltaTime);

    // Commit projectile instance changes to GPU
    this.projectiles.commitToGPU();

    // Update particle effects
    this.effects.update(deltaTime);

    // Rotate test cube if exists
    if (this.testCube) {
      this.testCube.rotation.y += deltaTime * 0.001;
    }

    // Call external update callback (for component animations)
    if (this.onUpdateCallback) {
      this.onUpdateCallback(deltaTime);
    }
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
  async addTestCube(lat: number, lon: number): Promise<THREE.Mesh> {
    const height = await this.getTerrainHeight(lat, lon);
    const localPos = this.sync.geoToLocal(lat, lon, height + 5);

    const geometry = new THREE.BoxGeometry(10, 10, 10);
    const material = new THREE.MeshStandardMaterial({
      color: 0x22c55e,
      metalness: 0.3,
      roughness: 0.7,
    });
    const cube = new THREE.Mesh(geometry, material);
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
  addTestCubeAtOrigin(height: number = 50): THREE.Mesh | null {
    if (!this.tilesRenderer) {
      console.error('[ThreeTilesEngine] Cannot add test cube: tilesRenderer not initialized');
      return null;
    }

    // Create cube with overlay-friendly material
    const geometry = new THREE.BoxGeometry(20, 20, 20);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      depthTest: false, // Ignore depth - always draw
      depthWrite: false, // Don't affect depth buffer
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide, // Visible from all angles
    });

    const cube = new THREE.Mesh(geometry, material);

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

      const geometry = new THREE.BoxGeometry(8, 8, 8);
      const material = new THREE.MeshStandardMaterial({
        color: colors[i % colors.length],
        metalness: 0.3,
        roughness: 0.7,
      });
      const cube = new THREE.Mesh(geometry, material);
      cube.position.copy(localPos);
      this.scene.add(cube);
      this.debugHelpers.push(cube);
    }

    console.log('[ThreeTilesEngine] Added', spawns.length, 'test cubes at spawns');
  }

  /**
   * Add axis helper at origin
   */
  addAxisHelper(): void {
    const axisHelper = new THREE.AxesHelper(50);
    this.scene.add(axisHelper);
    this.debugHelpers.push(axisHelper);
  }

  /**
   * Clear debug helpers
   */
  clearDebugHelpers(): void {
    for (const helper of this.debugHelpers) {
      this.scene.remove(helper);
      if ((helper as THREE.Mesh).geometry) {
        (helper as THREE.Mesh).geometry.dispose();
      }
      if ((helper as THREE.Mesh).material) {
        const mat = (helper as THREE.Mesh).material;
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
      (this.testCube.material as THREE.Material).dispose();
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
  getScene(): THREE.Scene {
    return this.scene;
  }

  /**
   * Get overlay group for markers, streets, routes
   * Objects added here use local coordinates (X=East, Y=Up, Z=-North)
   */
  getOverlayGroup(): THREE.Group {
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
  getTilesGroup(): THREE.Group | null {
    return this.tilesRenderer?.group ?? null;
  }

  /**
   * Get Three.js renderer
   */
  getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  /**
   * Get camera
   */
  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  // Cached tile stats (updated every 500ms to avoid performance overhead)
  private cachedTileStats = { parsing: 0, downloading: 0, total: 0, visible: 0 };
  private lastTileStatsUpdate = 0;

  /**
   * Get tile loading statistics by counting meshes in the tiles group
   * Cached and updated every 500ms for performance
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
      if (obj instanceof THREE.Mesh) {
        totalMeshes++;
        if (obj.visible) {
          visibleMeshes++;
        }
      }
    });

    this.cachedTileStats = {
      parsing: 0,
      downloading: 0,
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

  /**
   * Convert world position to screen coordinates
   */
  worldToScreen(worldPos: THREE.Vector3): { x: number; y: number } | null {
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
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.stopRenderLoop();
    this.clearDebugHelpers();

    // Dispose entity renderers
    this.enemies.dispose();
    this.towers.dispose();
    this.projectiles.dispose();
    this.effects.dispose();

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
      if ((obj as THREE.Mesh).geometry) {
        (obj as THREE.Mesh).geometry.dispose();
      }
      if ((obj as THREE.Mesh).material) {
        const mat = (obj as THREE.Mesh).material;
        if (Array.isArray(mat)) {
          mat.forEach((m) => m.dispose());
        } else {
          mat.dispose();
        }
      }
    });

    // Dispose renderer
    this.renderer.dispose();
  }
}
