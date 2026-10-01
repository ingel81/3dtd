import type { TilesRenderer } from '3d-tiles-renderer';
import { DebugTilesPlugin, type LoadRegionPlugin, type ColorMode } from '3d-tiles-renderer/plugins';
import type { GeoPosition } from '../models/game.types';
import type { EllipsoidSync } from './ellipsoid-sync';
import { ROUTE_CORRIDOR_ERROR_TARGET, RouteCorridorRegion, type RegionLodState, type RegionTile } from './route-corridor-region';
import { type SettleHold, type TilesLodDebug, createTilesLodDebug } from './tiles-lod-debug';
import { tilesPending } from './tiles-internals';

/**
 * Route corridor load region, see {@link RouteCorridorRegion}. The half width
 * reaches past the 7 m cell corridor; tile bounding spheres add their radius.
 */
const ROUTE_CORRIDOR_HALF_WIDTH = 20;

/**
 * Top of the LOD debug color scale, in metres of geometric error. The auto
 * scale spans the whole hierarchy up to the root's kilometres and paints every
 * loaded tile the same black. At 20 m, the 2.5 m corridor tiles read dark.
 */
const TILE_LOD_DEBUG_MAX_ERROR = 20;

/**
 * The tiles along the enemy routes (ThreeTilesEngine): the load region that
 * keeps the route corridor fine wherever the camera looks, how far it is
 * refined, and the LOD debug paint.
 */
export class RouteCorridorTiles {
  private tiles: TilesRenderer | null = null;
  private regions: LoadRegionPlugin | null = null;
  /** The region `regions` holds, see setRoutes(); null before the first routes and after an origin change. */
  private region: RouteCorridorRegion | null = null;
  /** The routes the region was built from, for building it again in a new group frame (refreshFrame) */
  private routes: GeoPosition[][] | null = null;
  /** Times the region was built again because the group moved, for the trace (lod) */
  private reframes = 0;
  private lodDebugPlugin: DebugTilesPlugin | null = null;
  /** The root tileset placed the group (ReorientationPlugin): a region built before stands in the old frame */
  private readonly onRootLoaded = (): void => {
    this.refreshFrame();
  };

  constructor(
    private readonly sync: EllipsoidSync,
    private readonly settleHold: SettleHold,
  ) {}

  /** The tiles renderer and its load-region plugin, once the tiles are created */
  attach(tiles: TilesRenderer, regions: LoadRegionPlugin | null): void {
    this.tiles = tiles;
    this.regions = regions;
    // After the ReorientationPlugin's own listener, which it added when it registered
    tiles.addEventListener('load-root-tileset', this.onRootLoaded);
  }

  /** The tiles renderer is gone (dispose) */
  detach(): void {
    this.tiles?.removeEventListener('load-root-tileset', this.onRootLoaded);
    this.routes = null;
    this.tiles = null;
    this.regions = null;
    this.region = null;
    this.lodDebugPlugin = null;
  }

  /** The corridor was built in the old group frame; the new routes rebuild it */
  dropForNewOrigin(): void {
    this.regions?.clearRegions();
    this.region = null;
    this.routes = null;
  }

  /**
   * Build the region again from the same routes when the tiles group moved
   * since it was built. The streets of a cached place are there before the
   * root tileset: a region built then stood in the frame before the
   * ReorientationPlugin placed the group, beside the route, and reached a
   * handful of tiles that never refine, so no station of the build found a
   * fine one and the route stayed in the air until a reload (2026-10-01).
   * @returns whether it was built again
   */
  refreshFrame(): boolean {
    if (!this.tiles || !this.region || !this.routes) return false;
    const group = this.tiles.group;
    group.updateMatrixWorld();
    if (this.region.builtIn(group.matrixWorld)) return false;
    this.reframes++;
    console.warn('[RouteCorridorTiles] the tiles group moved since the corridor region was built: building it again');
    this.setRoutes(this.routes);
    return true;
  }

  /**
   * Keep the enemy route corridor loaded at fine LOD, wherever the camera
   * looks. Without it, route cells outside the view had no tiles to sample
   * and cells seen from afar were baked from coarse ones. Call whenever the
   * routes change; an origin change drops the corridor.
   */
  setRoutes(routes: GeoPosition[][]): void {
    if (!this.tiles || !this.regions) return;
    this.routes = routes;
    const group = this.tiles.group;
    group.updateMatrixWorld();
    const localRoutes = routes.map((route) =>
      route.map((p) => this.sync.geoToLocalSimple(p.lat, p.lon, p.height ?? 0)),
    );
    this.regions.clearRegions();
    this.region = new RouteCorridorRegion(
      localRoutes, group.matrixWorld, ROUTE_CORRIDOR_HALF_WIDTH, ROUTE_CORRIDOR_ERROR_TARGET,
    );
    this.regions.addRegion(this.region);
    // UpdateOnChangePlugin does not notice region changes on its own.
    this.tiles.dispatchEvent({ type: 'needs-update' });
  }

  /**
   * Debug: the LOD the tiles load at, for `__tiles.stats()` and
   * `__corridor.probeLod()`. Sets the corridor region's error target and the
   * camera's, and holds the settled tile loads back from the game for a
   * probe (SettleHold). Null in DevWorld and before initialize().
   */
  lodDebug(): TilesLodDebug | null {
    if (!this.tiles) return null;
    return createTilesLodDebug(this.tiles, {
      region: () => this.region,
      holdSettled: (hold) => this.settleHold.hold(hold),
    });
  }

  /**
   * How far the active tiles of the route corridor are refined, and how many
   * tiles wait to load anywhere, for the corridor trace
   * (VisualizationFacadeService.onTilesLoaded). Null without a corridor.
   */
  lod(): (RegionLodState & { pending: number; frame: 'ok' | 'stale'; reframes: number }) | null {
    if (!this.tiles || !this.region) return null;
    return {
      ...this.region.lodState(this.tiles.activeTiles as unknown as Iterable<RegionTile>),
      pending: tilesPending(this.tiles),
      // The region in the group's frame now, and how often it had to be built again for it
      frame: this.region.builtIn(this.tiles.group.matrixWorld) ? 'ok' : 'stale',
      reframes: this.reframes,
    };
  }

  /**
   * The content paths of the fine tiles of the route corridor, whose hash
   * lod() gives as `tileSet` (RouteCorridorRegion.finePaths), for the
   * corridor snapshot. Null without a corridor.
   */
  tilePaths(): string[] | null {
    if (!this.tiles || !this.region) return null;
    return this.region.finePaths(this.tiles.activeTiles as unknown as Iterable<RegionTile>);
  }

  /**
   * Debug: paint tiles black to white by geometric error, white at
   * {@link TILE_LOD_DEBUG_MAX_ERROR} or coarser. Shows whether the route
   * corridor is really refined. The plugin registers on first use.
   */
  setLodDebugEnabled(enabled: boolean): void {
    if (!this.tiles) return;
    if (!this.lodDebugPlugin) {
      if (!enabled) return;
      this.lodDebugPlugin = new DebugTilesPlugin({ maxDebugError: TILE_LOD_DEBUG_MAX_ERROR });
      this.tiles.registerPlugin(this.lodDebugPlugin);
    } else {
      this.lodDebugPlugin.enabled = enabled;
    }
    if (enabled) {
      // Disabling resets the color mode to NONE, so it is set on every enable.
      // The typings declare named color-mode exports the module does not have;
      // the modes only exist on the static ColorModes.
      const modes = DebugTilesPlugin.ColorModes as unknown as Record<'GEOMETRIC_ERROR', ColorMode>;
      this.lodDebugPlugin.colorMode = modes.GEOMETRIC_ERROR;
    }
    // Repaint without waiting for the camera to move.
    this.tiles.dispatchEvent({ type: 'needs-update' });
  }
}
