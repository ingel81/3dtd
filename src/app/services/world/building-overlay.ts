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
  buildingRendering: Pick<BuildingRenderingService, 'renderBuildings' | 'toggleVisibility' | 'reset'>;
  uiStore: Pick<UIStore, 'buildingsVisible'>;
  store: Pick<TowerDefenseStore, 'baseCoords'>;
  /** The engine to draw on, looked up when the buildings are loaded. */
  engine: () => ThreeTilesEngine | null;
}

/**
 * OSM building footprints within BUILDING_CORRIDOR_RADIUS of the routes, and
 * only those: loaded on the first toggle-on once routes exist, drawn again
 * after tile loads, dropped on dispose.
 */
export class BuildingOverlay {
  /** Cached building footprints of the route corridor */
  private cachedBuildings: BuildingFootprint[] | null = null;

  constructor(private readonly deps: BuildingOverlayDeps) {}

  /**
   * Toggle building footprints visibility.
   * Loads buildings on first toggle-on.
   */
  toggled(): void {
    const visible = this.deps.uiStore.buildingsVisible();

    if (visible && !this.cachedBuildings) {
      // First time: load and render buildings
      this.loadAndRenderBuildings();
    } else {
      this.deps.buildingRendering.toggleVisibility();
    }
  }

  /** Draw the loaded buildings again on the tiles just streamed, if they are shown. */
  rerender(engine: ThreeTilesEngine): void {
    if (this.cachedBuildings && this.deps.uiStore.buildingsVisible()) {
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
    this.cachedBuildings = null;
    this.deps.buildingRendering.reset();
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
    // No routes yet: nothing to load; the next toggle-on asks again.
    if (routes.length === 0) return;

    const base = this.deps.store.baseCoords();

    try {
      const buildingData = await this.deps.osm.loadBuildingsNearRoutes(routes, BUILDING_CORRIDOR_RADIUS);
      this.cachedBuildings = buildingData.buildings;

      this.deps.buildingRendering.renderBuildings(
        engine,
        this.cachedBuildings,
        { lat: base.lat, lon: base.lon },
        this.deps.uiStore.buildingsVisible()
      );
    } catch (err) {
      console.error('[Buildings] Failed to load:', err);
    }
  }
}
