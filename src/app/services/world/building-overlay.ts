import { BUILDING_CORRIDOR_RADIUS } from '../../configs/map-constants.config';
import type { BuildingFootprint, OsmStreetService } from '../location/osm-street.service';
import type { PathAndRouteService } from './path-route.service';
import type { BuildingRenderingService } from './building-rendering.service';
import type { UIStore } from '../../store/ui.store';
import type { TowerDefenseStore } from '../../store/tower-defense.store';
import type { ThreeTilesEngine } from '../../three-engine';

/** What BuildingOverlay needs; VisualizationFacadeService passes its services. */
export interface BuildingOverlayDeps {
  osm: Pick<OsmStreetService, 'loadBuildingsNearRoutes'>;
  pathRoute: Pick<PathAndRouteService, 'getCachedPaths'>;
  buildingRendering: Pick<BuildingRenderingService, 'renderBuildings' | 'toggleVisibility' | 'reset' | 'clear'>;
  uiStore: Pick<UIStore, 'buildingsVisible'>;
  store: Pick<TowerDefenseStore, 'baseCoords'>;
  /** The engine to draw on, looked up when the buildings are loaded. */
  engine: () => ThreeTilesEngine | null;
}

/** Route length is told apart to this step for routesKey, m */
const ROUTE_KEY_STEP_M = 25;

/** Length of a route along its points, m (flat over a few km) */
function routeLength(path: readonly { lat: number; lon: number }[]): number {
  let length = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const k = Math.PI / 180;
    const x = (b.lon - a.lon) * k * Math.cos(((a.lat + b.lat) / 2) * k);
    length += Math.hypot(x, (b.lat - a.lat) * k) * 6_371_000;
  }
  return length;
}

/** Quiet time after a change of the routes before the buildings load: a place builds its routes one by one, ms */
export const BUILDING_RELOAD_DELAY_MS = 1500;

/**
 * OSM building footprints within BUILDING_CORRIDOR_RADIUS of the routes, and
 * only those: loaded on the first toggle-on once routes exist, drawn again
 * after tile loads. They belong to the routes and the place they were loaded
 * for: when either changes (another place, a new or moved spawn) they leave
 * the map, and while the layer is on the buildings of the new routes load
 * by themselves (routesChanged). Dropped on dispose.
 */
export class BuildingOverlay {
  /** Cached building footprints of the route corridor */
  private cachedBuildings: BuildingFootprint[] | null = null;
  /** The routes and place `cachedBuildings` were loaded for (routesKey) */
  private loadedFor: string | null = null;
  /** The routes and place a load under way asks for */
  private loadingFor: string | null = null;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: BuildingOverlayDeps) {}

  /**
   * Toggle building footprints visibility.
   * Loads buildings on the first toggle-on, and again when the routes changed since.
   */
  toggled(): void {
    const visible = this.deps.uiStore.buildingsVisible();
    if (visible && !this.loadedForNow()) {
      this.loadAndRenderBuildings();
    } else {
      this.deps.buildingRendering.toggleVisibility();
    }
  }

  /**
   * The routes changed (PathAndRouteService.routesVersion): buildings of
   * other routes or another place leave the map; while the layer is on, the
   * new routes' buildings load once the routes have settled.
   */
  routesChanged(): void {
    if (this.cachedBuildings && !this.loadedForNow()) this.drop();
    this.cancelReload();
    if (!this.deps.uiStore.buildingsVisible()) return;
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      if (this.deps.uiStore.buildingsVisible() && !this.loadedForNow()) this.loadAndRenderBuildings();
    }, BUILDING_RELOAD_DELAY_MS);
  }

  /** Draw the loaded buildings again on the tiles just streamed, if they are shown and still those of the routes. */
  rerender(engine: ThreeTilesEngine): void {
    if (this.cachedBuildings && this.deps.uiStore.buildingsVisible() && this.loadedForNow()) {
      const base = this.deps.store.baseCoords();
      this.deps.buildingRendering.renderBuildings(
        engine,
        this.cachedBuildings,
        { lat: base.lat, lon: base.lon },
        true
      );
    }
  }

  /** Forget the buildings, so the next toggle-on loads them for the new location. */
  reset(): void {
    this.cancelReload();
    this.cachedBuildings = null;
    this.loadedFor = null;
    this.loadingFor = null;
    this.deps.buildingRendering.reset();
  }

  /** The buildings off the map and out of the cache; the next toggle-on or routesChanged loads anew */
  private drop(): void {
    this.cachedBuildings = null;
    this.loadedFor = null;
    const engine = this.deps.engine();
    if (engine) this.deps.buildingRendering.clear(engine);
  }

  private cancelReload(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = null;
  }

  /** Whether the cached buildings are those of the routes and place now */
  private loadedForNow(): boolean {
    return this.cachedBuildings !== null && this.loadedFor === this.routesKey();
  }

  /**
   * The routes and the place, as far as they decide which buildings are near:
   * each route's ends and its length to ROUTE_KEY_STEP_M. Not its waypoints:
   * the corridor fit splits the segments of the same route after measuring.
   */
  private routesKey(): string {
    const base = this.deps.store.baseCoords();
    const at = (p: { lat: number; lon: number }) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
    const routes = [...this.deps.pathRoute.getCachedPaths()]
      .filter(([, path]) => path.length > 0)
      .map(([id, path]) => `${id}:${at(path[0])}:${at(path[path.length - 1])}:${Math.round(routeLength(path) / ROUTE_KEY_STEP_M)}`)
      .sort();
    return `${at(base)}|${routes.join('|')}`;
  }

  /**
   * Load building footprints from OSM and render them.
   */
  private async loadAndRenderBuildings(): Promise<void> {
    const engine = this.deps.engine();
    if (!engine) return;

    const routes: { lat: number; lon: number }[][] = [];
    this.deps.pathRoute.getCachedPaths().forEach((path) => {
      routes.push(path.map(p => ({ lat: p.lat, lon: p.lon })));
    });
    // No routes yet: nothing to load; the next toggle-on or change of the routes asks again.
    if (routes.length === 0) return;

    const key = this.routesKey();
    // The same routes asked for already
    if (this.loadingFor === key) return;
    this.loadingFor = key;

    try {
      const buildingData = await this.deps.osm.loadBuildingsNearRoutes(routes, BUILDING_CORRIDOR_RADIUS);
      // The routes changed while the answer was on its way: it belongs to the old ones
      if (this.loadingFor !== key || this.routesKey() !== key) return;
      this.cachedBuildings = buildingData.buildings;
      this.loadedFor = key;

      const base = this.deps.store.baseCoords();
      this.deps.buildingRendering.renderBuildings(
        engine,
        this.cachedBuildings,
        { lat: base.lat, lon: base.lon },
        this.deps.uiStore.buildingsVisible()
      );
    } catch (err) {
      console.error('[Buildings] Failed to load:', err);
    } finally {
      if (this.loadingFor === key) this.loadingFor = null;
    }
  }
}
