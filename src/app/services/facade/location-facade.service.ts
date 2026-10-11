import { Injectable, inject, DestroyRef, Injector } from '@angular/core';
import { RouteGridVizService } from '../world/route-grid-viz.service';
import { MarkerVisualizationService, SpawnPoint } from '../world/marker-visualization.service';
import { PathAndRouteService } from '../world/path-route.service';
import { LocationManagementService } from '../location/location-management.service';
import { HeightUpdateService } from '../world/height-update.service';
import { EngineInitializationService } from '../infrastructure/engine-initialization.service';
import { UrlLocationService } from '../location/url-location.service';
import { WorldContext } from '../../world/world-context.service';
import { worldLabel } from '../../world/world-ref';
import { RouteAnimationService } from '../world/route-animation.service';
import { StreetRenderingService } from '../world/street-rendering.service';
import { DebugFacadeService } from '../debug/debug-facade.service';
import { SavedSpawn } from '../../models/location.types';
import { startSpawns } from '../location/place-choice';
import { MainWorldService } from '../world/main-world.service';
import { GlobalRouteGridService } from '../world/global-route-grid.service';
import { PresentationService } from '../../presentation/presentation.service';
import { LocationChangeCoordinatorService, LocationFlowDelegate } from '../location/location-change-coordinator.service';
import { LocationChangeCallbacks } from '../location/location-change-executor.service';
import { FacadeComponentBridge } from './tower-defense-facade.service';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { MapPlacementService } from '../world/map-placement.service';
import { MapRelocationService, RelocationHost } from './map-relocation.service';
import type { CorridorBuildResult, CorridorProgress } from '../world/corridor-build';
import { SPAWN_COLORS, MIN_SPAWN_DISTANCE, MAX_SPAWN_DISTANCE } from '../../configs/map-constants.config';
import { bearingToPortalHeading } from '../../three-engine/renderers/marker/spawn-portal-pose';
import { canonicalCoords } from '../../utils/geo-utils';
import { isInsideCoverage } from '../../world/world-coverage';

/**
 * Callbacks to visualization sub-facade methods,
 * used for both the coordinator flow and in-place operations.
 */
export interface VizCallbacks {
  initializeTowerPlacement: () => void;
  filterStreetNetworkToRoutes: () => void;
  scheduleOverlayHeightUpdate: () => Promise<void>;
  initializeVisualizationServices: () => void;
  reframeCameraWithRoutes: () => void;
  renderStreets: () => void;
  saveInitialCameraPosition: () => void;
  /**
   * Build the corridor of the routes a move built (CorridorBuild.build):
   * `report` is told each step, the result is null when it stopped.
   */
  buildCorridor: (reason: string, report: (progress: CorridorProgress) => void) => Promise<CorridorBuildResult | null>;
}

/** The game component went away, or was never there, before a location was picked. */
class ComponentGoneError extends Error {}

/** What the game component hands over in initialize(). */
interface ComponentContext {
  bridge: FacadeComponentBridge;
  /** Component injector, for the DestroyRef the wait for a place ends with. */
  injector: Injector;
}

/**
 * Sub-facade for location management, a world's own layout, spawns, and street loading.
 *
 * Responsibilities:
 * - Location at the start (the world's own HQ, the URL, or the place chosen in the menu)
 * - Regenerating a world in place (DevWorld)
 * - Spawn point management
 * - Street network loading
 * - Map entity cleanup
 *
 * Moving HQ or spawn on the map is done by MapRelocationService.
 */
@Injectable({ providedIn: 'root' })
export class LocationFacadeService {
  private readonly world = inject(MainWorldService);
  private readonly grid = inject(GlobalRouteGridService);
  private readonly gridViz = inject(RouteGridVizService);
  private readonly presentation = inject(PresentationService);
  private readonly markerViz = inject(MarkerVisualizationService);
  private readonly pathRoute = inject(PathAndRouteService);
  private readonly locationMgmt = inject(LocationManagementService);
  private readonly heightUpdate = inject(HeightUpdateService);
  private readonly engineInit = inject(EngineInitializationService);
  private readonly urlLocation = inject(UrlLocationService);
  private readonly worldContext = inject(WorldContext);
  private readonly routeAnimation = inject(RouteAnimationService);
  private readonly streetRendering = inject(StreetRenderingService);
  private readonly debugFacade = inject(DebugFacadeService);
  private readonly locationCoordinator = inject(LocationChangeCoordinatorService);
  private readonly mapPlacement = inject(MapPlacementService);
  private readonly mapRelocation = inject(MapRelocationService);
  private readonly store = inject(TowerDefenseStore);

  /**
   * The game component's bridge, game state and injector, from initialize()
   * until dispose(). This service is a root singleton and outlives the
   * component; without a component every entry point is a no-op, including
   * async work (street loads, a world's regeneration) that finishes after the
   * component went away.
   */
  private ctx: ComponentContext | null = null;

  /** Visualization callbacks for in-place operations (stored from initializeCoordinator) */
  private vizCallbacks: VizCallbacks | null = null;

  /** This facade as seen by MapRelocationService, read at the moment it is needed. */
  private readonly relocationHost: RelocationHost = {
    context: () => this.ctx,
    vizCallbacks: () => this.vizCallbacks,
    addSpawnPoint: (id, name, lat, lon, color, portalBearing) => this.addSpawnPoint(id, name, lat, lon, color, portalBearing),
    syncUrlWithLocation: () => this.syncUrlWithLocation(),
  };

  /**
   * Initialize sub-facade with bridge, game state, and component injector.
   */
  initialize(bridge: FacadeComponentBridge, injector: Injector): void {
    this.ctx = { bridge, injector };
  }

  /**
   * Release the component: drop the bridge, the game state, the injector and
   * the viz callbacks, so the root service no longer keeps the destroyed
   * component reachable. initialize() and initializeCoordinator() set them
   * again for the next one.
   */
  dispose(): void {
    this.ctx = null;
    this.vizCallbacks = null;
  }

  // ══════════════════════════════════════════════════════════════
  // Location Coordinator
  // ══════════════════════════════════════════════════════════════

  /**
   * Initialize the LocationChangeCoordinator with the flow delegate.
   * Also stores vizCallbacks for in-place operations.
   * @param vizCallbacks Callbacks to visualization sub-facade methods
   */
  initializeCoordinator(vizCallbacks: VizCallbacks): void {
    this.vizCallbacks = vizCallbacks;
    this.locationCoordinator.initializeFlow(this.buildLocationFlowDelegate(vizCallbacks));
  }

  /**
   * Build the LocationFlowDelegate for the coordinator service.
   */
  private buildLocationFlowDelegate(vizCallbacks: VizCallbacks): LocationFlowDelegate {
    return {
      getChangeContext: () => {
        const ctx = this.ctx;
        const engine = ctx?.bridge.getEngine();
        if (!ctx || !engine) return null;
        return {
          engine,
          streetNetwork: ctx.bridge.getStreetNetwork(),
          streetNetworkLocation: ctx.bridge.getStreetNetworkLocation(),
          heightDebugVisible: this.store.heightDebugVisible,
        };
      },
      getChangeCallbacks: (): LocationChangeCallbacks => ({
        setBaseCoords: (c) => this.store.baseCoords.set(c),
        setCenterCoords: (c) => this.store.centerCoords.set(c),
        setSpawnPoints: (p) => this.store.spawnPoints.set(p),
        addSpawnPoint: (id, name, lat, lon, color, portalBearing) => this.addSpawnPoint(id, name, lat, lon, color, portalBearing),
        setStreetCount: (c) => this.store.streetCount.set(c),
        setStreetNetwork: (n) => this.ctx?.bridge.setStreetNetwork(n),
        setStreetNetworkLocation: (l) => this.ctx?.bridge.setStreetNetworkLocation(l),
        syncUrlWithLocation: () => this.syncUrlWithLocation(),
        clearMapEntities: () => this.clearMapEntities(),
        appendDebugLog: (msg) => this.debugFacade.appendDebugLog(msg),
        initializeTowerPlacement: () => vizCallbacks.initializeTowerPlacement(),
        filterStreetNetworkToRoutes: () => vizCallbacks.filterStreetNetworkToRoutes(),
        scheduleOverlayHeightUpdate: () => Promise.resolve(vizCallbacks.scheduleOverlayHeightUpdate()),
        getSpawnPoints: () => this.store.spawnPoints(),
        getBaseCoords: () => this.store.baseCoords(),
      }),
    };
  }

  // ══════════════════════════════════════════════════════════════
  // Location Detection
  // ══════════════════════════════════════════════════════════════

  /**
   * Initialize the location from the URL or, without one there, from the
   * place chosen in the menu (LocationChangeCoordinatorService.choosePlace).
   * The browser's location is asked only from the menu's "Use my location".
   * False when the component went away before a place was chosen.
   */
  async initializeLocation(): Promise<boolean> {
    await this.engineInit.setStepCurrent('location');

    // A world with its own HQ (DevWorld, a map): no place to choose; its
    // spawns come with the world (addPredefinedSpawns)
    const ownHq = this.worldContext.startHq();
    if (ownHq) {
      let hq: { lat: number; lon: number };
      try {
        hq = await ownHq;
      } catch (err) {
        // A map that is missing or changed: say so instead of loading forever
        this.engineInit.setError(err instanceof Error ? err.message : String(err));
        this.engineInit.setLoading(false);
        return false;
      }
      this.locationMgmt.setLocation({ lat: hq.lat, lon: hq.lon }, []);
      this.store.baseCoords.set({ lat: hq.lat, lon: hq.lon });
      this.store.centerCoords.set({ lat: hq.lat, lon: hq.lon, height: 400 });
      await this.engineInit.setStepDone('location', worldLabel(this.worldContext.ref()));
      return true;
    }

    // URL is source of truth
    const urlData = this.urlLocation.parseFromUrl();

    // A link's place outside the world's area (an own tileset's) waits for a choice like no place
    if (urlData && isInsideCoverage(this.worldContext.coverage(), urlData.hq.lat, urlData.hq.lon)) {
      this.locationMgmt.setLocation(urlData.hq, urlData.spawns);
      await this.engineInit.setStepDone('location', 'from URL');
    } else {
      this.engineInit.updateStepMeta('location', 'Choose a place');
      try {
        await this.waitForPlaceChoice();
      } catch (err) {
        // The component went away before a place was chosen: nothing to show
        if (err instanceof ComponentGoneError) return false;
        throw err;
      }
      await this.engineInit.setStepDone('location', 'chosen');
    }

    // Sync URL with current location
    const hq = this.locationMgmt.hq();
    if (hq) {
      this.syncUrlWithLocation();
      this.store.baseCoords.set({ lat: hq.lat, lon: hq.lon });
      this.store.centerCoords.set({ lat: hq.lat, lon: hq.lon, height: 400 });
    }
    return true;
  }

  /**
   * Wait for the place the menu chooses and set it. Rejects with a
   * ComponentGoneError if the component is destroyed first, or if there is
   * no component to begin with.
   */
  async waitForPlaceChoice(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) throw new ComponentGoneError('Location facade is not initialized');
    const destroyRef = ctx.injector.get(DestroyRef);
    const gone = new Promise<never>((_, reject) => {
      destroyRef.onDestroy(() => {
        this.locationCoordinator.cancelStartChoice();
        reject(new ComponentGoneError('Component destroyed before a place was chosen'));
      });
    });
    const choice = await Promise.race([this.locationCoordinator.waitForStartChoice(), gone]);
    this.locationMgmt.setLocation({ lat: choice.hq.lat, lon: choice.hq.lon }, startSpawns(choice));
  }

  /**
   * Sync URL with current location (without reload).
   * Only for a real place: a world of its own keeps its link (`?devworld…`, `?world=`).
   */
  syncUrlWithLocation(): void {
    if (!this.worldContext.capabilities().realPlace) return;
    const hq = this.locationMgmt.hq();
    if (!hq) return;
    const spawns = this.locationMgmt.spawns();
    this.urlLocation.updateUrl(hq, spawns);
  }

  // ══════════════════════════════════════════════════════════════
  // Spawn Points
  // ══════════════════════════════════════════════════════════════

  /**
   * Add predefined spawn points.
   */
  addPredefinedSpawns(): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    const hq = this.locationMgmt.hq();
    const streetNetwork = ctx.bridge.getStreetNetwork();

    if (!hq) {
      console.warn('[addPredefinedSpawns] No HQ location set');
      return 0;
    }

    if (this.locationMgmt.needsRandomSpawn() && streetNetwork) {
      // A world that brings its spawns (DevWorld: the street generator's,
      // `?devworld&spawns=N` of them, a lane per coop player)
      const layout = this.worldContext.provider()?.startLayout() ?? null;
      if (layout) {
        this.locationMgmt.setGeneratedSpawns(layout.spawns.map(({ lat, lon }) => ({ lat, lon })));
        layout.spawns.forEach((spawn, i) =>
          this.addSpawnPoint(spawn.id, spawn.name, spawn.lat, spawn.lon, SPAWN_COLORS[i % SPAWN_COLORS.length]));
        return layout.spawns.length;
      }

      // A real place: a random spawn
      const randomSpawn = this.worldContext.streets.findRandomStreetPoint(
        streetNetwork, hq.lat, hq.lon, MIN_SPAWN_DISTANCE, MAX_SPAWN_DISTANCE, this.worldContext.coverage(),
      );
      if (randomSpawn) {
        this.locationMgmt.setGeneratedSpawns([{ lat: randomSpawn.lat, lon: randomSpawn.lon }]);
        this.syncUrlWithLocation();
        this.addSpawnPoint('spawn-1', randomSpawn.streetName || 'Spawn', randomSpawn.lat, randomSpawn.lon, SPAWN_COLORS[0]);
        return 1;
      } else {
        console.warn('[addPredefinedSpawns] No valid random spawn found');
        return 0;
      }
    }

    // Use spawn locations from URL/service, each portal turned the way it was saved
    const spawns = this.locationMgmt.editableSpawnLocations();
    let count = 0;
    if (spawns.length > 0 && spawns.every(s => s.lat !== 0 && s.lon !== 0)) {
      spawns.forEach((spawn, index) => {
        this.addSpawnPoint(
          spawn.id, spawn.name || `Spawn ${index + 1}`, spawn.lat, spawn.lon,
          SPAWN_COLORS[index % SPAWN_COLORS.length], spawn.portalBearing,
        );
        count++;
      });
    }
    return count;
  }

  /**
   * Add a spawn point (delegates to services), at its canonical coordinates
   * (canonicalCoords): a random spawn on a street node comes with more
   * digits than the URL keeps of it.
   * @param name Kept where the streets have no names to tell (DevWorld). On
   *   a real map every spawn is named after its street here
   *   (WorldStreetSource.spawnLabel), whichever way it came about, so a
   *   reload and a location change show the same label.
   * @param portalBearing Compass bearing the player turned its portal to
   *   (SavedSpawn); without one the portal faces along its route
   */
  addSpawnPoint(id: string, name: string, lat: number, lon: number, color: number, portalBearing?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const engine = ctx.bridge.getEngine() || this.engineInit.getEngine();
    const streetNetwork = ctx.bridge.getStreetNetwork();
    if (!engine || !streetNetwork) return;

    name = this.worldContext.streets.spawnLabel(streetNetwork, lat, lon, name);
    const spawn: SpawnPoint = canonicalCoords({ id, name, lat, lon, color });
    this.store.spawnPoints.update((points) => [...points, spawn]);

    this.markerViz.addSpawnMarker(id, name, spawn.lat, spawn.lon, color);
    this.pathRoute.showPathFromSpawn(spawn);
    // After the route: the turn is held in the range the enemies still get out through
    if (portalBearing !== undefined) this.markerViz.setPortalHeading(id, bearingToPortalHeading(portalBearing));
  }

  // ══════════════════════════════════════════════════════════════
  // Map Placement (HQ / Spawn)
  // ══════════════════════════════════════════════════════════════

  /**
   * Start map placement mode for HQ or Spawn.
   * Build mode should be exited by the caller before invoking this.
   */
  /**
   * @param add a spawn in addition to the ones there, not in place of them
   * @param move the index of the one spawn to move, the others stay
   */
  startMapPlacement(mode: 'hq' | 'spawn', add = false, move: number | null = null): void {
    this.mapPlacement.startPlacement(mode, add, move);
  }

  /** Take a spawn away, never the last (MapRelocationService.removeSpawn). */
  removeSpawn(index: number): Promise<boolean> {
    return this.mapRelocation.removeSpawn(index, this.relocationHost);
  }

  /** Set these spawns in place of the ones there, same HQ (MapRelocationService.replaceSpawns). */
  replaceSpawns(spawns: SavedSpawn[]): Promise<boolean> {
    return this.mapRelocation.replaceSpawns(spawns, this.relocationHost);
  }

  /** Add a spawn at a given place (MapRelocationService.addSpawnAt). */
  addSpawnAt(lat: number, lon: number): Promise<boolean> {
    return this.mapRelocation.addSpawnAt(lat, lon, this.relocationHost);
  }

  /** Add a spawn on a street round from the others (MapRelocationService.addRandomSpawn). */
  addRandomSpawn(): Promise<boolean> {
    return this.mapRelocation.addRandomSpawn(this.relocationHost);
  }

  /**
   * Handle a map placement click: MapPlacementService validates it,
   * MapRelocationService moves HQ or spawn there.
   */
  async handleMapPlacementClick(_lat: number, _lon: number, _height: number): Promise<void> {
    await this.mapRelocation.applyPlacementClick(this.relocationHost);
  }

  // ══════════════════════════════════════════════════════════════
  // Map Cleanup
  // ══════════════════════════════════════════════════════════════

  /**
   * Clear all map entities (markers, routes, streets, spawns, route cells)
   * at the start of a location change. The route cells go with their
   * overlays (Route Grid, Air Route Grid, air route): the new location
   * builds its own in step 6, and until then the old corridor would stand
   * on the map, shifted to the new origin.
   */
  clearMapEntities(): void {
    const ctx = this.ctx;
    const engine = ctx?.bridge.getEngine();
    if (!ctx || !engine) return;

    const overlayGroup = engine.getOverlayGroup();

    this.markerViz.clearAllMarkers();
    this.pathRoute.clearAllRoutes();
    this.streetRendering.dispose(overlayGroup);
    this.grid.clear();

    this.store.spawnPoints.set([]);
    this.pathRoute.clearCachedPaths();

    ctx.bridge.setFilteredStreetNetwork(null);
    ctx.bridge.setStreetNetworkLocation(null);
  }

  // ══════════════════════════════════════════════════════════════
  // Regenerating the world (DevWorld)
  // ══════════════════════════════════════════════════════════════

  /**
   * Refresh terrain heights. A world that regenerates (DevWorld) rolls
   * itself anew from its configuration, with streets, spawns and a fresh run.
   */
  refreshTerrainHeights(onTilesLoaded: () => void): void {
    const engine = this.ctx?.bridge.getEngine();
    if (!engine) return;

    const world = engine.world;
    if (world.capabilities.regenerate) {
      this.store.isDevWorldRegenerating.set(true);
      this.clearWorldVisuals();
      engine.terrain.clearHeightCache();

      world.regenerate()
        .then(() => world.streets.loadStreets(world.sync.getOrigin().lat, world.sync.getOrigin().lon))
        .then((network) => {
          // The new streets before the spawns and routes are laid on them
          this.ctx?.bridge.setStreetNetwork(network);
          this.store.streetCount.set(network.streets.length);
          this.worldContext.refreshRef();
          this.onWorldRegenerated();
          this.store.isDevWorldRegenerating.set(false);
        }).catch((error) => {
          console.error('[LocationFacade] world regeneration failed:', error);
          this.store.isDevWorldRegenerating.set(false);
        });
      return;
    }

    engine.terrain.clearHeightCache();
    onTilesLoaded();
  }

  /**
   * Clear all world visuals before a regeneration.
   */
  clearWorldVisuals(): void {
    const ctx = this.ctx;
    const engine = ctx?.bridge.getEngine();
    if (!ctx || !engine) return;

    const overlayGroup = engine.getOverlayGroup();

    this.routeAnimation.stopAnimation();
    this.heightUpdate.stopHeightUpdates();

    this.world.resetRun();
    this.gridViz.disposeVisualization();

    this.markerViz.clearAllMarkers();
    this.pathRoute.clearAllRoutes();
    this.pathRoute.clearCachedPaths();
    this.streetRendering.dispose(overlayGroup);

    this.store.spawnPoints.set([]);
  }

  /**
   * Called after the world regenerated and its streets were loaded again.
   */
  onWorldRegenerated(): void {
    const ctx = this.ctx;
    const engine = ctx?.bridge.getEngine();
    if (!ctx || !engine) return;
    const { bridge } = ctx;

    // Re-create base marker
    this.markerViz.addBaseMarker();

    // As many spawns as on the initial load (the world's start layout)
    const layout = engine.world.startLayout();
    layout?.spawns.forEach((spawn, i) =>
      this.addSpawnPoint(spawn.id, spawn.name, spawn.lat, spawn.lon, SPAWN_COLORS[i % SPAWN_COLORS.length]));

    // Re-filter and render streets
    bridge.setFilteredStreetNetwork(bridge.getStreetNetwork());

    // Update marker heights and render routes
    this.markerViz.updateMarkerHeights();

    // Rebuild the route-cell grid BEFORE resolving route-line heights: the
    // grid is what `getGroundLocalYAt` reads, and until it is regenerated it
    // still holds the previous world's cells.
    this.world.setSpawns(this.store.spawnPoints().map((sp) => ({
      id: sp.id,
      name: sp.name,
      lat: sp.lat,
      lon: sp.lon,
      color: sp.color,
    })));
    this.world.buildCells(true);
    this.pathRoute.refreshRouteLines(this.store.spawnPoints());
    this.presentation.host?.onTilesLoaded();

    // The new world to the simulation, a fresh run on it. Without it the
    // wave pipeline kept spawning at the old world's coordinates.
    this.world.sendToSim();

    // Start route animation
    const cachedPaths = this.pathRoute.getCachedPaths();
    if (cachedPaths.size > 0) {
      this.routeAnimation.startAnimation(cachedPaths, this.store.spawnPoints());
    }
  }
}
