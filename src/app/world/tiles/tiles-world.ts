import { MathUtils, type Group, type Matrix4, type Object3D, type PerspectiveCamera, type Scene, Vector3, type WebGLRenderer } from 'three';
import type { TilesRenderer } from '3d-tiles-renderer';
import type { ReorientationPlugin } from '3d-tiles-renderer/plugins';
import { EllipsoidSync } from '../../three-engine/ellipsoid-sync';
import { TerrainQueries } from '../../three-engine/terrain-queries';
import { RouteCorridorTiles } from '../../three-engine/route-corridor-tiles';
import { SettleHold } from '../../three-engine/tiles-lod-debug';
import { TileLoadingTracker, type RootLoadFailure, type TileStats } from '../../three-engine/tile-loading-tracker';
import { applyQueueBudget, applyStreamingBudget, createTilesRenderer } from '../../three-engine/tiles-renderer-setup';
import { logTileMaterialTypes } from '../../three-engine/tile-material-log';
import { tilesInternals } from '../../three-engine/tiles-internals';
import { instrumentRaycasts } from '../../utils/raycast-stats';
import { OSM_MAP_ATTRIBUTION } from '../../configs/attributions.config';
import type { WorldRef } from '../world-ref';
import {
  NO_TILE_STATS,
  type StreetStyle,
  type WorldAttachContext,
  type WorldCapabilities,
  type WorldLogo,
  type WorldProvider,
  type WorldStartLayout,
  type WorldStreetSource,
  type WorldTiles,
} from '../world-provider';

/** A real place from Google Photorealistic 3D Tiles */
export const TILES_CAPABILITIES: WorldCapabilities = {
  realPlace: true,
  streaming: true,
  ecef: true,
  credentials: true,
  regenerate: false,
  destructible: false,
  ownEnvironment: false,
  controls: 'globe',
};

/** OSM streets over the photogrammetry: bridges, approaches, lateral samples, the street's own nodes */
export const TILES_STREET_STYLE: StreetStyle = {
  overlayLift: 0.5,
  routeLineLift: 1,
  subdivideM: 0,
  plainGround: false,
  carryOffStreet: true,
};

/** The tiles' data credit until the visible tiles name their own */
export const TILES_DATA_CREDIT = 'Map data ©Google';

/** Google's logo always, Cesium ion's beside it when the tiles come through Cesium */
export function tilesLogos(source: 'cesium' | 'google'): WorldLogo[] {
  const google: WorldLogo = { src: 'assets/images/ui/google-maps-logo.svg', alt: 'Google Maps', cssClass: 'td-google-logo' };
  const cesium: WorldLogo = { src: 'assets/images/ui/cesium-ion-logo.svg', alt: 'Cesium ion', cssClass: 'td-cesium-logo' };
  return source === 'cesium' ? [google, cesium] : [google];
}

/** Where the tiles come from, with the credentials (they live here and in ConfigService only) */
export interface TilesWorldConfig {
  source: 'cesium' | 'google';
  cesiumIonToken: string;
  cesiumAssetId: string;
  googleMapsApiKey: string;
  origin: { lat: number; lon: number; height: number };
  /** OsmStreetService */
  streets: WorldStreetSource;
}

/**
 * The world of Google Photorealistic 3D Tiles, through Cesium Ion or the
 * Google Maps API, with OSM streets. Holds what was the tiles path of
 * ThreeTilesEngine: the TilesRenderer and its plugins, the load tracking
 * (first tiles, settled loads, refused credentials), the route corridor's
 * load region, the overlay that follows the tiles group, GlobeControls.
 */
export class TilesWorld implements WorldProvider, WorldTiles {
  readonly ref: WorldRef;
  readonly capabilities = TILES_CAPABILITIES;
  readonly sync: EllipsoidSync;
  readonly surface: TerrainQueries;
  readonly streets: WorldStreetSource;
  readonly streetStyle = TILES_STREET_STYLE;
  /** The route corridor's load region and LOD debug, see RouteCorridorTiles */
  readonly corridor: RouteCorridorTiles;

  private tilesRenderer: TilesRenderer | null = null;
  private reorientationPlugin: ReorientationPlugin | null = null;
  private scene: Scene | null = null;
  /** First-load detection, debounce, retry, auth errors, tile stats; made in attach() */
  private tileLoading: TileLoadingTracker | null = null;
  /** Holds settled tile loads back from the game while `__corridor.probeLod()` runs, see lodDebug() */
  private readonly settleHold = new SettleHold(() => this.onTileSetSettled());
  /** The engine's reaction to a settled load, from attach() */
  private groundChanged: (() => void) | null = null;

  // Track initial tiles position to calculate the overlay's movement delta
  private readonly initialTilesPos = new Vector3();
  /** Reused scratch for the per-frame overlay-sync delta (avoids clone()). */
  private readonly overlayDelta = new Vector3();
  private tilesPosInitialized = false;

  constructor(private readonly config: TilesWorldConfig) {
    this.ref = { kind: 'tiles', source: config.source };
    const { lat, lon, height } = config.origin;
    this.sync = new EllipsoidSync(lat, lon, height);
    this.corridor = new RouteCorridorTiles(this.sync, this.settleHold);
    this.surface = new TerrainQueries(this.sync, { tiles: () => this.tilesRenderer });
    this.streets = config.streets;
  }

  get tiles(): WorldTiles {
    return this;
  }

  async attach(ctx: WorldAttachContext): Promise<void> {
    const { scene, camera, renderer } = ctx;
    this.scene = scene;
    this.groundChanged = ctx.groundChanged;
    this.tileLoading = new TileLoadingTracker(camera, renderer, {
      probeOriginGround: () => this.surface.raycastTerrainHeight(0, 0, 'tileProbe'),
      onTileSetSettled: () => this.onTileSetSettled(),
    });

    // TilesRenderer with the auth, streaming, reorientation and region
    // plugins, group rotated to Y-up
    const tiles = createTilesRenderer({
      provider: this.config.source,
      googleMapsApiKey: this.config.googleMapsApiKey,
      cesiumIonToken: this.config.cesiumIonToken,
      cesiumAssetId: this.config.cesiumAssetId,
      origin: this.sync.getOrigin(),
    });
    this.tilesRenderer = tiles.tilesRenderer;
    this.reorientationPlugin = tiles.reorientationPlugin;
    this.corridor.attach(tiles.tilesRenderer, tiles.routeRegions);

    scene.add(this.tilesRenderer.group);

    // Update sync with tiles renderer reference
    this.sync.setTilesRenderer(this.tilesRenderer);

    // Setup camera and controls
    ctx.cameraRig.setupGlobeControls(scene, this.tilesRenderer);

    // Configure tiles renderer
    this.tilesRenderer.setResolutionFromRenderer(camera, renderer);
    this.tilesRenderer.setCamera(camera);

    // Refinement error, distance falloff, download and parse queues, LRU cache
    applyStreamingBudget(this.tilesRenderer);
    // Made under the menu globe: it loads with the wider queues already
    applyQueueBudget(this.tilesRenderer, ctx.drawSuppressed);

    // tiles-load-end (first load, debounce), load-tileset, load-error (auth)
    this.tileLoading.attach(this.tilesRenderer);

    // R10: do the tile materials run the scene lights? Logged once per type.
    logTileMaterialTypes(this.tilesRenderer);

    // Every raycast into the tiles is timed per caller, see `__raycastStats()`.
    instrumentRaycasts(this.tilesRenderer.group);
  }

  ready(): boolean {
    return this.tilesRenderer !== null;
  }

  /**
   * Called by the TileLoadingTracker on every settled tiles-load-end, after
   * its first-tiles check, and by the SettleHold when a probe released one.
   */
  private onTileSetSettled(): void {
    // A LOD probe runs (tilesLodDebug): the game keeps its view of the tiles until it ends.
    if (this.settleHold.intercept()) return;

    // The loaded-tile set has changed, that is true on EVERY settled
    // load-end, not only when the origin column happens to shift. Bumps
    // `lodVersion`, which is what invalidates individual column samples,
    // no global cache clear needed (see ThreeTilesEngine.onGroundChanged).
    this.surface.markTileSetChanged();
    this.groundChanged?.();
  }

  setOrigin(lat: number, lon: number, height: number): void {
    this.sync.setOrigin(lat, lon, height);

    // The corridor was built in the old group frame; the new routes rebuild it.
    this.corridor.dropForNewOrigin();

    // Update ReorientationPlugin
    if (this.reorientationPlugin && this.tilesRenderer) {
      this.reorientationPlugin.transformLatLonHeightToOrigin(
        lat * MathUtils.DEG2RAD,
        lon * MathUtils.DEG2RAD,
        height
      );
    }

    // Clear height cache
    this.surface.clearHeightCache();

    // Cancel pending debounce/retry timers from the previous location and
    // reset first-load, nudge and auth state
    this.tileLoading?.reset();

    // CRITICAL: Reset tiles position tracking - otherwise overlay delta calculation
    // will use old location's initialTilesPos and position overlays incorrectly
    this.tilesPosInitialized = false;
    this.initialTilesPos.set(0, 0, 0);
  }

  update(_camera: PerspectiveCamera, overlay: Group): void {
    const tiles = this.tilesRenderer;
    if (!tiles) return;

    // UpdateOnChangePlugin skips the traversal while camera and tiles are unchanged.
    tiles.update();

    // Capture initial tiles position only when tiles have loaded (position is non-zero)
    if (!this.tilesPosInitialized) {
      const pos = tiles.group.position;
      // Wait until tilesGroup has a real ECEF position (Y will be negative millions)
      if (Math.abs(pos.y) > 1000000) {
        this.initialTilesPos.copy(pos);
        this.tilesPosInitialized = true;
      }
    }

    // Sync the overlay with the tiles movement (only after initial pos is captured):
    // a straight delta on all three axes, the overlay lives in absolute scene-Y.
    if (this.tilesPosInitialized) {
      overlay.position.copy(this.overlayDelta.copy(tiles.group.position).sub(this.initialTilesPos));
    }
  }

  resize(camera: PerspectiveCamera, renderer: WebGLRenderer): void {
    // Drawing-buffer size changed: refresh the tiles renderer resolution here
    // (not per frame).
    this.tilesRenderer?.setResolutionFromRenderer(camera, renderer);
  }

  setDrawSuppressed(suppressed: boolean): void {
    // Nothing to keep smooth meanwhile: the tiles may load faster
    if (this.tilesRenderer) applyQueueBudget(this.tilesRenderer, suppressed);
  }

  /** The 3D tiles group, a direct child of the scene */
  losBlockers(): Object3D | null {
    return this.tilesRenderer?.group ?? null;
  }

  sceneToEcef(target: Matrix4): Matrix4 | null {
    if (!this.tilesRenderer) return null;
    this.tilesRenderer.group.updateMatrixWorld();
    return target.copy(this.tilesRenderer.group.matrixWorld).invert();
  }

  /**
   * Google's data credit, the string attributions of the visible tiles
   * joined with semicolons (TILES_DATA_CREDIT while none came yet), and the
   * OSM credit of the routes and the street overlay
   */
  attribution(): string[] {
    const strings = (this.tilesRenderer?.getAttributions() ?? [])
      .filter((a: { type: string; value: string }) => a.type === 'string')
      .map((a: { type: string; value: string }) => a.value);
    return [strings.length > 0 ? strings.join('; ') : TILES_DATA_CREDIT, OSM_MAP_ATTRIBUTION];
  }

  onFirstGround(callback: () => void): void {
    // If tiles already loaded, the tracker calls it immediately
    this.tileLoading?.setOnFirstTilesLoaded(callback);
  }

  onLoadFailure(callback: (failure: RootLoadFailure) => void): void {
    // Registration usually happens after the tileset request already failed,
    // the tracker replays a remembered error.
    this.tileLoading?.setOnAuthError(callback);
  }

  /** The player picks HQ and spawns on a real place */
  startLayout(): WorldStartLayout | null {
    return null;
  }

  /** A real place plays the game's rules */
  runRules(): null {
    return null;
  }

  /** The game's waves */
  worldWaves(): null {
    return null;
  }

  regenerate(): Promise<void> {
    return Promise.reject(new Error('The 3D tiles cannot be regenerated'));
  }

  // ---- WorldTiles ----

  renderer(): TilesRenderer | null {
    return this.tilesRenderer;
  }

  tileStats(): TileStats {
    return this.tileLoading?.getTileStats() ?? NO_TILE_STATS;
  }

  /**
   * Traversals the tiles renderer has run. TilesRendererBase bumps its
   * (untyped) frameCount once per traversal and not when
   * UpdateOnChangePlugin skips one. Only the shake benchmark reads it.
   */
  traversalCount(): number {
    return this.tilesRenderer ? tilesInternals(this.tilesRenderer).frameCount : 0;
  }

  /** When hidden, the tiles leave the scene but still update in the background */
  setVisible(visible: boolean): void {
    const tiles = this.tilesRenderer;
    if (!tiles || !this.scene) return;
    if (visible) {
      if (!tiles.group.parent) this.scene.add(tiles.group);
    } else if (tiles.group.parent) {
      this.scene.remove(tiles.group);
    }
  }

  visible(): boolean {
    const group = this.tilesRenderer?.group;
    return !!group && group.parent !== null;
  }

  dispose(): void {
    // Remove event listeners, no settled load reaches a disposed engine
    this.tileLoading?.dispose();
    this.groundChanged = null;
    if (this.tilesRenderer) {
      this.scene?.remove(this.tilesRenderer.group);
      this.tilesRenderer.dispose();
      this.tilesRenderer = null;
      this.corridor.detach();
    }
  }
}
