import { Injectable, inject, DestroyRef, Injector } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { OsmStreetService } from '../location/osm-street.service';
import { MarkerVisualizationService, SpawnPoint } from '../world/marker-visualization.service';
import { PathAndRouteService } from '../world/path-route.service';
import { LocationManagementService } from '../location/location-management.service';
import { HeightUpdateService } from '../world/height-update.service';
import { EngineInitializationService } from '../infrastructure/engine-initialization.service';
import { GeolocationService } from '../location/geolocation.service';
import { UrlLocationService } from '../location/url-location.service';
import { DevWorldService, DEV_WORLD_ORIGIN } from '../../devworld/devworld.service';
import { RouteAnimationService } from '../world/route-animation.service';
import { StreetRenderingService } from '../world/street-rendering.service';
import { DebugFacadeService } from '../debug/debug-facade.service';
import {
  LOCATION_DIALOG_OPEN_FAILED,
  LocationDialogLoadError,
  openLocationDialog,
} from '../../components/location-dialog/open-location-dialog';
import { LocationDialogData, LocationDialogResult } from '../../models/location.types';
import { GameStateManager } from '../../managers/game-state.manager';
import { DevTerrainProvider } from '../../devworld/dev-terrain.provider';
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
  gameState: GameStateManager;
  /** Component injector, for the DestroyRef of the location dialog. */
  injector: Injector;
}

/**
 * Sub-facade for location management, DevWorld, spawns, and street loading.
 *
 * Responsibilities:
 * - Location detection (URL, geolocation, dialog)
 * - DevWorld regeneration
 * - Spawn point management
 * - Street network loading
 * - Map entity cleanup
 *
 * Moving HQ or spawn on the map is done by MapRelocationService.
 */
@Injectable({ providedIn: 'root' })
export class LocationFacadeService {
  private readonly osmService = inject(OsmStreetService);
  private readonly markerViz = inject(MarkerVisualizationService);
  private readonly pathRoute = inject(PathAndRouteService);
  private readonly locationMgmt = inject(LocationManagementService);
  private readonly heightUpdate = inject(HeightUpdateService);
  private readonly engineInit = inject(EngineInitializationService);
  private readonly geolocation = inject(GeolocationService);
  private readonly urlLocation = inject(UrlLocationService);
  private readonly devWorld = inject(DevWorldService);
  private readonly routeAnimation = inject(RouteAnimationService);
  private readonly streetRendering = inject(StreetRenderingService);
  private readonly debugFacade = inject(DebugFacadeService);
  private readonly locationCoordinator = inject(LocationChangeCoordinatorService);
  private readonly mapPlacement = inject(MapPlacementService);
  private readonly mapRelocation = inject(MapRelocationService);
  private readonly dialog = inject(MatDialog);
  private readonly store = inject(TowerDefenseStore);

  /**
   * The game component's bridge, game state and injector, from initialize()
   * until dispose(). This service is a root singleton and outlives the
   * component; without a component every entry point is a no-op, including
   * async work (street loads, DevWorld regeneration) that finishes after the
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
  initialize(bridge: FacadeComponentBridge, gameState: GameStateManager, injector: Injector): void {
    this.ctx = { bridge, gameState, injector };
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
          gameState: ctx.gameState,
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
      isGameInProgress: () => this.store.phase() !== 'setup' || this.store.waveNumber() > 0,
      getCurrentLocationName: () => this.locationMgmt.getLocationDisplayName(),
    };
  }

  // ══════════════════════════════════════════════════════════════
  // Location Detection
  // ══════════════════════════════════════════════════════════════

  /**
   * Initialize location from URL or geolocation cascade. False when the boot
   * cannot go on: the component went away while the location dialog was
   * open, or the dialog did not load (then the error screen says so).
   */
  async initializeLocation(): Promise<boolean> {
    await this.engineInit.setStepCurrent('location');

    // DevWorld mode: Use fake origin, skip real location
    if (this.devWorld.isActive) {
      this.locationMgmt.setLocation(
        { lat: DEV_WORLD_ORIGIN.lat, lon: DEV_WORLD_ORIGIN.lon },
        []
      );
      this.store.baseCoords.set({ lat: DEV_WORLD_ORIGIN.lat, lon: DEV_WORLD_ORIGIN.lon });
      this.store.centerCoords.set({ lat: DEV_WORLD_ORIGIN.lat, lon: DEV_WORLD_ORIGIN.lon, height: 400 });
      await this.engineInit.setStepDone('location', 'DevWorld');
      return true;
    }

    // URL is source of truth
    const urlData = this.urlLocation.parseFromUrl();

    if (urlData) {
      this.locationMgmt.setLocation(urlData.hq, urlData.spawns);
      await this.engineInit.setStepDone('location', 'from URL');
    } else {
      // No URL params → try geolocation cascade
      this.geolocation.onStepDetail = (detail) => this.engineInit.updateStepMeta('location', detail);
      const detected = await this.geolocation.detectLocation();

      if (detected) {
        this.locationMgmt.setLocation(detected, []);
        await this.engineInit.setStepDone('location', 'Browser');
      } else {
        this.engineInit.updateStepMeta('location', 'Select location...');
        try {
          await this.waitForLocationFromDialog();
        } catch (err) {
          // The component went away before the dialog closed: nothing to show
          if (err instanceof ComponentGoneError) return false;
          console.error('[LocationFacade] Location dialog failed:', err);
          this.engineInit.setError(
            err instanceof LocationDialogLoadError ? err.message : LOCATION_DIALOG_OPEN_FAILED,
          );
          this.engineInit.setLoading(false);
          return false;
        }
        await this.engineInit.setStepDone('location', 'manually selected');
      }
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
   * Open location dialog and wait for user to select a location.
   * Rejects with a ComponentGoneError if component is destroyed before dialog
   * closes, or if there is no component to begin with, with a
   * LocationDialogLoadError when the dialog's chunk does not load, and with
   * the error itself when the loaded dialog fails to open.
   */
  waitForLocationFromDialog(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return Promise.reject(new ComponentGoneError('Location facade is not initialized'));

    return new Promise((resolve, reject) => {
      const destroyRef = ctx.injector.get(DestroyRef);
      let settled = false;

      // Reject if component is destroyed before dialog closes
      destroyRef.onDestroy(() => {
        if (!settled) {
          settled = true;
          reject(new ComponentGoneError('Component destroyed before location was selected'));
        }
      });

      void openLocationDialog(this.dialog, {
        data: {
          currentLocation: null,
          currentSpawn: null,
          isGameInProgress: false,
        } as LocationDialogData,
        panelClass: 'td-dialog-panel',
        disableClose: true,
      }).then((dialogRef) => {
        // The component went away while the dialog chunk loaded
        if (settled) {
          dialogRef.close();
          return;
        }
        dialogRef.afterClosed()
          .pipe(takeUntilDestroyed(destroyRef))
          .subscribe((result: LocationDialogResult | null | undefined) => {
            if (settled) return;
            settled = true;
            if (result?.confirmed) {
              this.locationMgmt.setLocation(
                { lat: result.hq.lat, lon: result.hq.lon },
                result.spawn.isRandom ? [] : [{ lat: result.spawn.lat, lon: result.spawn.lon }]
              );
            }
            resolve();
          });
      }).catch((err: unknown) => {
        if (settled) return;
        settled = true;
        reject(err);
      });
    });
  }

  /**
   * Sync URL with current location (without reload).
   * Skipped in DevWorld mode.
   */
  syncUrlWithLocation(): void {
    if (this.devWorld.isActive) return;
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
      // DevWorld mode
      if (this.devWorld.isActive) {
        const engine = ctx.bridge.getEngine() || this.engineInit.getEngine();
        const devTerrainProvider = engine?.getDevTerrainProvider();

        if (devTerrainProvider) {
          // One spawn, matching the real-world default: the random-spawn path
          // below also creates exactly one, and multiple spawns are an explicit
          // opt-in via editable spawn locations.
          //
          // The street generator deliberately emits up to four — they are the
          // groundwork for a future multi-lane / multiplayer mode. Until that
          // exists, training on all four would mean learning a different and
          // much harder game than the one that ships: four approach routes
          // against the same tower budget.
          const generatedSpawns = devTerrainProvider.getSpawnPoints();
          if (generatedSpawns.length > 0) {
            const spawn = generatedSpawns[0];
            const spawnGeo = this.devWorld.localToGeo(spawn.position.x, spawn.position.z);
            this.locationMgmt.setGeneratedSpawns([{ lat: spawnGeo.lat, lon: spawnGeo.lon }]);
            this.addSpawnPoint(spawn.id, spawn.name, spawnGeo.lat, spawnGeo.lon, SPAWN_COLORS[0]);
            return 1;
          }
        }

        // Fallback
        const spawnConfig = this.devWorld.config.spawn;
        const spawnPos = this.devWorld.getSpawnPosition();
        const spawnGeo = this.devWorld.localToGeo(spawnPos.x, spawnPos.z);
        this.locationMgmt.setGeneratedSpawns([{ lat: spawnGeo.lat, lon: spawnGeo.lon }]);
        this.addSpawnPoint(`spawn-${spawnConfig}`, `Spawn ${spawnConfig}`, spawnGeo.lat, spawnGeo.lon, SPAWN_COLORS[0]);
        return 1;
      }

      // Real world: random spawn
      const randomSpawn = this.osmService.findRandomStreetPoint(streetNetwork, hq.lat, hq.lon, MIN_SPAWN_DISTANCE, MAX_SPAWN_DISTANCE);
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
   * @param portalBearing Compass bearing the player turned its portal to
   *   (SavedSpawn); without one the portal faces along its route
   */
  addSpawnPoint(id: string, name: string, lat: number, lon: number, color: number, portalBearing?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const engine = ctx.bridge.getEngine() || this.engineInit.getEngine();
    const streetNetwork = ctx.bridge.getStreetNetwork();
    if (!engine || !streetNetwork) return;

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
  startMapPlacement(mode: 'hq' | 'spawn'): void {
    this.mapPlacement.startPlacement(mode);
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
    ctx.gameState.getGlobalRouteGrid().clear();

    this.store.spawnPoints.set([]);
    this.pathRoute.clearCachedPaths();

    ctx.bridge.setFilteredStreetNetwork(null);
    ctx.bridge.setStreetNetworkLocation(null);
  }

  // ══════════════════════════════════════════════════════════════
  // DevWorld
  // ══════════════════════════════════════════════════════════════

  /**
   * Refresh terrain heights. In DevWorld: regenerates entire world.
   */
  refreshTerrainHeights(onTilesLoaded: () => void): void {
    const engine = this.ctx?.bridge.getEngine();
    if (!engine) return;

    if (this.devWorld.isActive) {
      const devTerrainProvider = engine.getDevTerrainProvider();
      if (devTerrainProvider) {
        this.store.isDevWorldRegenerating.set(true);
        this.clearDevWorldVisuals();
        engine.terrain.clearHeightCache();

        devTerrainProvider.regenerate().then(() => {
          this.onDevWorldRegenerated(devTerrainProvider);
          this.store.isDevWorldRegenerating.set(false);
        }).catch((error) => {
          console.error('[LocationFacade] DevWorld regeneration failed:', error);
          this.store.isDevWorldRegenerating.set(false);
        });
        return;
      }
    }

    engine.terrain.clearHeightCache();
    onTilesLoaded();
  }

  /**
   * Clear all DevWorld visuals before regeneration.
   */
  clearDevWorldVisuals(): void {
    const ctx = this.ctx;
    const engine = ctx?.bridge.getEngine();
    if (!ctx || !engine) return;

    const overlayGroup = engine.getOverlayGroup();

    this.routeAnimation.stopAnimation();
    this.heightUpdate.stopHeightUpdates();

    ctx.gameState.reset();
    ctx.gameState.getGlobalRouteGrid().disposeVisualization();

    this.markerViz.clearAllMarkers();
    this.pathRoute.clearAllRoutes();
    this.pathRoute.clearCachedPaths();
    this.streetRendering.dispose(overlayGroup);

    this.store.spawnPoints.set([]);
  }

  /**
   * Called after DevWorld terrain regeneration.
   */
  onDevWorldRegenerated(devTerrainProvider: DevTerrainProvider): void {
    const ctx = this.ctx;
    const engine = ctx?.bridge.getEngine();
    if (!ctx || !engine) return;
    const { bridge, gameState } = ctx;

    // Re-create base marker
    this.markerViz.addBaseMarker();

    // One spawn, matching the initial-load path.
    const generatedSpawns = devTerrainProvider.getSpawnPoints();
    if (generatedSpawns.length > 0) {
      const spawn = generatedSpawns[0];
      const spawnGeo = this.devWorld.localToGeo(spawn.position.x, spawn.position.z);
      this.addSpawnPoint(spawn.id, spawn.name, spawnGeo.lat, spawnGeo.lon, SPAWN_COLORS[0]);
    }

    // Re-filter and render streets
    bridge.setFilteredStreetNetwork(bridge.getStreetNetwork());

    // Update marker heights and render routes
    this.markerViz.updateMarkerHeights();

    // Rebuild the route-cell grid BEFORE resolving route-line heights: the
    // grid is what `getGroundLocalYAt` reads, and until it is regenerated it
    // still holds the previous world's cells.
    gameState.initializeGlobalRouteGrid();
    this.pathRoute.refreshRouteLines(this.store.spawnPoints());
    gameState.onTilesLoaded();

    // Hand the new spawns and routes to the wave pipeline. Without this the
    // WaveManager kept spawning at the old world's coordinates.
    gameState.reseatWavePipeline(
      this.store.spawnPoints().map((sp) => ({
        id: sp.id,
        name: sp.name,
        lat: sp.lat,
        lon: sp.lon,
        color: sp.color,
      })),
      this.pathRoute.getCachedPaths(),
    );

    // Start route animation
    const cachedPaths = this.pathRoute.getCachedPaths();
    if (cachedPaths.size > 0) {
      this.routeAnimation.startAnimation(cachedPaths, this.store.spawnPoints());
    }
  }
}
