import { Injectable, inject, DestroyRef, Injector } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatDialog } from '@angular/material/dialog';
import { OsmStreetService } from './osm-street.service';
import { MarkerVisualizationService, SpawnPoint } from './marker-visualization.service';
import { PathAndRouteService } from './path-route.service';
import { LocationManagementService } from './location-management.service';
import { HeightUpdateService } from './height-update.service';
import { EngineInitializationService } from './engine-initialization.service';
import { GeolocationService } from './geolocation.service';
import { UrlLocationService } from './url-location.service';
import { DevWorldService, DEV_WORLD_ORIGIN } from '../devworld/devworld.service';
import { RouteAnimationService } from './route-animation.service';
import { StreetRenderingService } from './street-rendering.service';
import { WaveDebugService } from './wave-debug.service';
import { DebugFacadeService } from './debug-facade.service';
import { LocationDialogComponent } from '../components/location-dialog/location-dialog.component';
import { LocationDialogData, LocationDialogResult } from '../models/location.types';
import { GameStateManager } from '../managers/game-state.manager';
import { DevTerrainProvider } from '../devworld/dev-terrain.provider';
import { LocationChangeCoordinatorService, LocationFlowDelegate, LocationChangeCallbacks } from './location-change-coordinator.service';
import { FacadeComponentBridge } from './tower-defense-facade.service';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { MapPlacementService } from './map-placement.service';
import { TowerPlacementService } from './tower-placement.service';
import { SPAWN_COLORS, MIN_SPAWN_DISTANCE, MAX_SPAWN_DISTANCE } from '../configs/map-constants.config';
import { SpawnPoint as WaveSpawnPoint } from '../managers/wave.manager';

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
  private readonly waveDebug = inject(WaveDebugService);
  private readonly debugFacade = inject(DebugFacadeService);
  private readonly locationCoordinator = inject(LocationChangeCoordinatorService);
  private readonly mapPlacement = inject(MapPlacementService);
  private readonly towerPlacement = inject(TowerPlacementService);
  private readonly dialog = inject(MatDialog);
  private readonly store = inject(TowerDefenseStore);

  /** Component bridge — set via initialize() */
  private bridge!: FacadeComponentBridge;

  /** Game state manager — set via initialize() */
  private gameState!: GameStateManager;

  /** Component injector — needed for DestroyRef */
  private componentInjector!: Injector;

  /** Whether this sub-facade has been initialized */
  private initialized = false;

  /** Visualization callbacks for in-place operations (stored from initializeCoordinator) */
  private vizCallbacks: VizCallbacks | null = null;

  /**
   * Initialize sub-facade with bridge, game state, and component injector.
   */
  initialize(bridge: FacadeComponentBridge, gameState: GameStateManager, injector: Injector): void {
    this.bridge = bridge;
    this.gameState = gameState;
    this.componentInjector = injector;
    this.initialized = true;
  }

  /**
   * Reset state on dispose.
   */
  dispose(): void {
    this.initialized = false;
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
        const engine = this.bridge.getEngine();
        if (!engine) return null;
        return {
          engine,
          gameState: this.gameState,
          streetNetwork: this.bridge.getStreetNetwork(),
          streetNetworkLocation: this.bridge.getStreetNetworkLocation(),
          heightDebugVisible: this.store.heightDebugVisible,
        };
      },
      getChangeCallbacks: (): LocationChangeCallbacks => ({
        setBaseCoords: (c) => this.store.baseCoords.set(c),
        setCenterCoords: (c) => this.store.centerCoords.set(c),
        setSpawnPoints: (p) => this.store.spawnPoints.set(p),
        addSpawnPoint: (id, name, lat, lon, color) => this.addSpawnPoint(id, name, lat, lon, color),
        setStreetCount: (c) => this.store.streetCount.set(c),
        setStreetNetwork: (n) => this.bridge.setStreetNetwork(n),
        setStreetNetworkLocation: (l) => this.bridge.setStreetNetworkLocation(l),
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
   * Initialize location from URL or geolocation cascade.
   */
  async initializeLocation(): Promise<void> {
    await this.engineInit.setStepActive('location');

    // DevWorld mode: Use fake origin, skip real location
    if (this.devWorld.isActive) {
      this.locationMgmt.setLocation(
        { lat: DEV_WORLD_ORIGIN.lat, lon: DEV_WORLD_ORIGIN.lon },
        []
      );
      this.store.baseCoords.set({ lat: DEV_WORLD_ORIGIN.lat, lon: DEV_WORLD_ORIGIN.lon });
      this.store.centerCoords.set({ lat: DEV_WORLD_ORIGIN.lat, lon: DEV_WORLD_ORIGIN.lon, height: 400 });
      await this.engineInit.setStepDone('location', 'DevWorld');
      return;
    }

    // URL is source of truth
    const urlData = this.urlLocation.parseFromUrl();

    if (urlData) {
      this.locationMgmt.setLocation(urlData.hq, urlData.spawns);
      await this.engineInit.setStepDone('location', 'from URL');
    } else {
      // No URL params → try geolocation cascade
      this.geolocation.onStepDetail = (detail) => this.engineInit.updateStepDetail('location', detail);
      const detected = await this.geolocation.detectLocation();

      if (detected) {
        this.locationMgmt.setLocation(detected, []);
        const sourceLabel = detected.source === 'browser' ? 'Browser' : 'IP-based';
        await this.engineInit.setStepDone('location', sourceLabel);
      } else {
        this.engineInit.updateStepDetail('location', 'Select location...');
        try {
          await this.waitForLocationFromDialog();
        } catch {
          // Component destroyed before dialog closed — abort initialization gracefully
          return;
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
  }

  /**
   * Open location dialog and wait for user to select a location.
   * Rejects if component is destroyed before dialog closes.
   */
  waitForLocationFromDialog(): Promise<void> {
    return new Promise((resolve, reject) => {
      const destroyRef = this.componentInjector.get(DestroyRef);
      let settled = false;

      // Reject if component is destroyed before dialog closes
      destroyRef.onDestroy(() => {
        if (!settled) {
          settled = true;
          reject(new Error('Component destroyed before location was selected'));
        }
      });

      const dialogRef = this.dialog.open(LocationDialogComponent, {
        data: {
          currentLocation: null,
          currentSpawn: null,
          isGameInProgress: false,
        } as LocationDialogData,
        panelClass: 'td-dialog-panel',
        disableClose: true,
      });

      dialogRef.afterClosed()
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe((result: LocationDialogResult | null) => {
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
    const hq = this.locationMgmt.hq();
    const streetNetwork = this.bridge.getStreetNetwork();

    if (!hq) {
      console.warn('[addPredefinedSpawns] No HQ location set');
      return 0;
    }

    if (this.locationMgmt.needsRandomSpawn() && streetNetwork) {
      // DevWorld mode
      if (this.devWorld.isActive) {
        const engine = this.bridge.getEngine() || this.engineInit.getEngine();
        const devTerrainProvider = engine?.getDevTerrainProvider();

        if (devTerrainProvider) {
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

    // Use spawn locations from URL/service
    const spawns = this.locationMgmt.editableSpawnLocations();
    let count = 0;
    if (spawns.length > 0 && spawns.every(s => s.lat !== 0 && s.lon !== 0)) {
      spawns.forEach((spawn, index) => {
        this.addSpawnPoint(spawn.id, spawn.name || `Spawn ${index + 1}`, spawn.lat, spawn.lon, SPAWN_COLORS[index % SPAWN_COLORS.length]);
        count++;
      });
    }
    return count;
  }

  /**
   * Add a spawn point (delegates to services).
   */
  addSpawnPoint(id: string, name: string, lat: number, lon: number, color: number): void {
    const engine = this.bridge.getEngine() || this.engineInit.getEngine();
    const streetNetwork = this.bridge.getStreetNetwork();
    if (!engine || !streetNetwork) return;

    const spawn: SpawnPoint = { id, name, lat, lon, color };
    this.store.spawnPoints.update((points) => [...points, spawn]);

    this.markerViz.addSpawnMarker(id, name, lat, lon, color);
    this.pathRoute.updateSpawnMarkers(this.markerViz.getSpawnMarkers());
    this.pathRoute.showPathFromSpawn(spawn);
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
   * Handle a map placement click.
   * Delegates validation to MapPlacementService, then applies the result.
   */
  async handleMapPlacementClick(lat: number, lon: number, height: number): Promise<void> {
    const result = this.mapPlacement.handlePlacementClick();
    if (!result) return;

    if (result.mode === 'hq') {
      await this.applyNewHqPosition(result.lat, result.lon);
    } else {
      await this.applyNewSpawnPosition(result.lat, result.lon);
    }
  }

  /**
   * Apply a new HQ position.
   * Fast in-place if within street network bounds, full reload otherwise.
   */
  private async applyNewHqPosition(lat: number, lon: number): Promise<void> {
    const streetNetwork = this.bridge.getStreetNetwork();

    // Fast path: HQ within loaded street bounds → in-place update
    if (streetNetwork && this.isWithinBounds(streetNetwork.bounds, lat, lon)) {
      await this.applyHqInPlace(lat, lon);
      return;
    }

    // Slow path: outside bounds → full 7-step location change
    const existingSpawns = this.store.spawnPoints();
    let spawnLat: number;
    let spawnLon: number;
    let spawnName = 'Spawn';

    if (existingSpawns.length > 0) {
      spawnLat = existingSpawns[0].lat;
      spawnLon = existingSpawns[0].lon;
      spawnName = existingSpawns[0].name;
    } else {
      spawnLat = lat + 0.005;
      spawnLon = lon;
    }

    await this.locationCoordinator.applyNewLocation({
      hq: { lat, lon, name: 'Loading...' },
      spawn: { lat: spawnLat, lon: spawnLon, name: spawnName },
    });
  }

  /**
   * Fast HQ repositioning within loaded street network bounds.
   * Calls engine.setOrigin() to update coordinate system, then rebuilds
   * markers, paths, and game state without loading screen or street reload.
   */
  private async applyHqInPlace(lat: number, lon: number): Promise<void> {
    const engine = this.bridge.getEngine();
    const streetNetwork = this.bridge.getStreetNetwork();
    if (!engine || !streetNetwork || !this.vizCallbacks) return;

    // Save existing spawns before clearing
    const existingSpawns = this.store.spawnPoints().map(sp => ({
      id: sp.id, name: sp.name, lat: sp.lat, lon: sp.lon, color: sp.color,
    }));

    // 1. Stop animations and height updates
    this.routeAnimation.stopAnimation();
    this.heightUpdate.stopHeightUpdates();

    // 2. Reset game state (towers, enemies, etc.)
    this.gameState.reset();

    // 3. Targeted cleanup — keep street network + street network location
    this.markerViz.clearAllMarkers();
    this.pathRoute.clearAllRoutes();
    this.pathRoute.clearCachedPaths();
    this.streetRendering.dispose(engine.getOverlayGroup());
    this.store.spawnPoints.set([]);
    this.bridge.setFilteredStreetNetwork(null);

    // 4. Update engine coordinate system
    engine.setOrigin(lat, lon);

    // 5. Update store signals
    this.store.baseCoords.set({ lat, lon });
    this.store.centerCoords.set({ lat, lon, height: 400 });

    // 6. Re-initialize visualization services (markerViz + pathRoute with new baseCoords)
    this.vizCallbacks.initializeVisualizationServices();

    // 7. Re-add HQ marker
    this.markerViz.addBaseMarker();

    // 8. Re-add existing spawns — validate paths to new HQ
    let hasValidSpawn = false;
    for (const spawn of existingSpawns) {
      const path = this.osmService.findPath(streetNetwork, spawn.lat, spawn.lon, lat, lon);
      if (path && path.length >= 2) {
        this.addSpawnPoint(spawn.id, spawn.name, spawn.lat, spawn.lon, spawn.color);
        hasValidSpawn = true;
        break; // Only 1 spawn supported
      }
    }

    // 9. If no valid spawn, generate a random one
    if (!hasValidSpawn) {
      const randomSpawn = this.osmService.findRandomStreetPoint(
        streetNetwork, lat, lon, MIN_SPAWN_DISTANCE, MAX_SPAWN_DISTANCE,
      );
      if (randomSpawn) {
        this.addSpawnPoint('spawn-1', randomSpawn.streetName || 'Spawn', randomSpawn.lat, randomSpawn.lon, SPAWN_COLORS[0]);
      }
    }

    // 10. Re-initialize game state with new routes
    const waveSpawns: WaveSpawnPoint[] = this.store.spawnPoints().map(sp => ({
      id: sp.id, name: sp.name, lat: sp.lat, lon: sp.lon,
    }));
    this.gameState.initialize(
      engine, streetNetwork, { lat, lon }, waveSpawns, this.pathRoute.getCachedPaths(),
    );
    this.gameState.initializeGlobalRouteGrid();

    // 11. Re-initialize tower placement + street filter + rendering
    this.vizCallbacks.initializeTowerPlacement();
    this.vizCallbacks.filterStreetNetworkToRoutes();
    this.vizCallbacks.renderStreets();

    // 12. Camera reframe
    this.vizCallbacks.reframeCameraWithRoutes();
    this.vizCallbacks.saveInitialCameraPosition();

    // 13. Update location service + URL
    const spawns = this.store.spawnPoints();
    this.locationMgmt.setLocation(
      { lat, lon },
      spawns.map(s => ({ lat: s.lat, lon: s.lon })),
    );
    this.syncUrlWithLocation();

    // 14. Start route animation
    const cachedPaths = this.pathRoute.getCachedPaths();
    if (cachedPaths.size > 0) {
      this.routeAnimation.startAnimation(cachedPaths, spawns);
    }

    // 15. Update map placement dependencies
    this.mapPlacement.updateDependencies(streetNetwork, { lat, lon });
  }

  /**
   * Apply a new spawn position.
   * If within loaded street bounds, does a fast in-place update.
   * Otherwise triggers a full location change.
   */
  private async applyNewSpawnPosition(lat: number, lon: number): Promise<void> {
    const streetNetwork = this.bridge.getStreetNetwork();
    const hq = this.store.baseCoords();

    if (streetNetwork && this.isWithinBounds(streetNetwork.bounds, lat, lon)) {
      // Fast in-place update (no street reload)
      await this.applySpawnInPlace(lat, lon);
    } else {
      // Outside bounds — full location change
      await this.locationCoordinator.applyNewLocation({
        hq: { lat: hq.lat, lon: hq.lon, name: 'Loading...' },
        spawn: { lat, lon, name: 'Spawn' },
      });
    }
  }

  /**
   * Fast spawn replacement within loaded street network bounds.
   * Avoids reloading streets — only recalculates paths and game state.
   */
  private async applySpawnInPlace(lat: number, lon: number): Promise<void> {
    const engine = this.bridge.getEngine();
    const streetNetwork = this.bridge.getStreetNetwork();
    if (!engine || !streetNetwork) return;

    const hq = this.store.baseCoords();

    // 1. Check if a route exists from new spawn to HQ
    const path = this.osmService.findPath(streetNetwork, lat, lon, hq.lat, hq.lon);
    if (!path || path.length < 2) {
      console.warn('[MapPlacement] No route from new spawn to HQ — placement rejected');
      return;
    }

    // 2. Stop animations and clear old visuals
    this.routeAnimation.stopAnimation();
    this.markerViz.clearSpawnMarkers();
    this.pathRoute.clearAllRoutes();
    this.pathRoute.clearCachedPaths();
    this.store.spawnPoints.set([]);

    // 3. Reset game state (towers, enemies, etc.)
    this.gameState.reset();

    // 4. Add new spawn point
    this.addSpawnPoint('spawn-1', 'Spawn', lat, lon, SPAWN_COLORS[0]);

    // 5. Update location service + URL
    this.locationMgmt.setLocation(hq, [{ lat, lon }]);
    this.syncUrlWithLocation();

    // 6. Re-initialize game state with new routes
    const waveSpawns = [{ id: 'spawn-1', name: 'Spawn', lat, lon }];
    this.gameState.initialize(
      engine,
      streetNetwork,
      { lat: hq.lat, lon: hq.lon },
      waveSpawns,
      this.pathRoute.getCachedPaths(),
    );
    this.gameState.initializeGlobalRouteGrid();

    // 7. Update map placement service dependencies
    this.mapPlacement.updateDependencies(streetNetwork, hq);

    // 8. Start route animation
    const cachedPaths = this.pathRoute.getCachedPaths();
    if (cachedPaths.size > 0) {
      this.routeAnimation.startAnimation(cachedPaths, this.store.spawnPoints());
    }
  }

  /**
   * Check if a geo position is within the loaded street network bounds.
   */
  private isWithinBounds(
    bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number },
    lat: number,
    lon: number,
  ): boolean {
    return lat >= bounds.minLat && lat <= bounds.maxLat
      && lon >= bounds.minLon && lon <= bounds.maxLon;
  }

  // ══════════════════════════════════════════════════════════════
  // Map Cleanup
  // ══════════════════════════════════════════════════════════════

  /**
   * Clear all map entities (markers, routes, streets, spawns).
   */
  clearMapEntities(): void {
    const engine = this.bridge.getEngine();
    if (!engine) return;

    const overlayGroup = engine.getOverlayGroup();

    this.markerViz.clearAllMarkers();
    this.pathRoute.clearAllRoutes();
    this.streetRendering.dispose(overlayGroup);

    this.store.spawnPoints.set([]);
    this.pathRoute.clearCachedPaths();

    this.bridge.setFilteredStreetNetwork(null);
    this.bridge.setStreetNetworkLocation(null);

    this.engineInit.stopTileStatsPolling();
  }

  // ══════════════════════════════════════════════════════════════
  // DevWorld
  // ══════════════════════════════════════════════════════════════

  /**
   * Refresh terrain heights. In DevWorld: regenerates entire world.
   */
  refreshTerrainHeights(onTilesLoaded: () => void): void {
    const engine = this.bridge.getEngine();
    if (!engine) return;

    if (this.devWorld.isActive) {
      const devTerrainProvider = engine.getDevTerrainProvider();
      if (devTerrainProvider) {
        this.store.isDevWorldRegenerating.set(true);
        this.clearDevWorldVisuals();
        engine.clearHeightCache();

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

    engine.clearHeightCache();
    onTilesLoaded();
  }

  /**
   * Clear all DevWorld visuals before regeneration.
   */
  clearDevWorldVisuals(): void {
    const engine = this.bridge.getEngine();
    if (!engine) return;

    const overlayGroup = engine.getOverlayGroup();

    this.routeAnimation.stopAnimation();
    this.heightUpdate.stopHeightUpdates();

    this.gameState.reset();
    this.gameState.getGlobalRouteGrid().disposeVisualization();

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
    const engine = this.bridge.getEngine();
    if (!engine) return;

    // Re-create base marker
    this.markerViz.addBaseMarker();

    // Create new spawn from terrain provider
    const generatedSpawns = devTerrainProvider.getSpawnPoints();
    if (generatedSpawns.length > 0) {
      const spawn = generatedSpawns[0];
      const spawnGeo = this.devWorld.localToGeo(spawn.position.x, spawn.position.z);
      this.addSpawnPoint(spawn.id, spawn.name, spawnGeo.lat, spawnGeo.lon, SPAWN_COLORS[0]);
    }

    this.pathRoute.updateSpawnMarkers(this.markerViz.getSpawnMarkers());

    // Re-filter and render streets
    this.bridge.setFilteredStreetNetwork(this.bridge.getStreetNetwork());

    // Update marker heights and render routes
    const spawnPointsForMarkers = this.store.spawnPoints().map(sp => ({
      id: sp.id,
      name: sp.name,
      lat: sp.lat,
      lon: sp.lon,
      color: sp.color,
    }));
    this.markerViz.updateMarkerHeights(spawnPointsForMarkers);
    this.pathRoute.refreshRouteLines(this.store.spawnPoints());

    // Re-initialize game state
    this.gameState.initializeGlobalRouteGrid();
    this.gameState.onTilesLoaded();

    // Start route animation
    const cachedPaths = this.pathRoute.getCachedPaths();
    if (cachedPaths.size > 0) {
      this.routeAnimation.startAnimation(cachedPaths, this.store.spawnPoints());
    }
  }
}
