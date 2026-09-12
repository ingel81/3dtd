import { Injectable, inject } from '@angular/core';
import { OsmStreetService } from '../location/osm-street.service';
import { MarkerVisualizationService } from '../world/marker-visualization.service';
import { PathAndRouteService } from '../world/path-route.service';
import { LocationManagementService } from '../location/location-management.service';
import { HeightUpdateService } from '../world/height-update.service';
import { RouteAnimationService } from '../world/route-animation.service';
import { StreetRenderingService } from '../world/street-rendering.service';
import { LocationChangeCoordinatorService } from '../location/location-change-coordinator.service';
import { MapPlacementService } from '../world/map-placement.service';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { GameStateManager } from '../../managers/game-state.manager';
import { SpawnPoint as WaveSpawnPoint } from '../../managers/wave.manager';
import { SPAWN_COLORS, MIN_SPAWN_DISTANCE, MAX_SPAWN_DISTANCE, SPAWN_DISCARD_DISTANCE } from '../../configs/map-constants.config';
import type { FacadeComponentBridge } from './tower-defense-facade.service';
import type { VizCallbacks } from './location-facade.service';

/** What a relocation needs from the location facade, read at the moment it is needed. */
export interface RelocationHost {
  /** The game component's bridge and game state; null once it went away. */
  context(): { bridge: FacadeComponentBridge; gameState: GameStateManager } | null;
  /** Viz callbacks for the in-place rebuild; null before the coordinator flow is set up. */
  vizCallbacks(): VizCallbacks | null;
  addSpawnPoint(id: string, name: string, lat: number, lon: number, color: number): void;
  syncUrlWithLocation(): void;
}

/**
 * Moves the HQ or the spawn to where the player clicked in map placement
 * mode. Inside the loaded street network the world is rebuilt in place (no
 * loading screen, no street reload); outside it the move becomes a full
 * location change through the coordinator.
 */
@Injectable({ providedIn: 'root' })
export class MapRelocationService {
  private readonly osmService = inject(OsmStreetService);
  private readonly markerViz = inject(MarkerVisualizationService);
  private readonly pathRoute = inject(PathAndRouteService);
  private readonly locationMgmt = inject(LocationManagementService);
  private readonly heightUpdate = inject(HeightUpdateService);
  private readonly routeAnimation = inject(RouteAnimationService);
  private readonly streetRendering = inject(StreetRenderingService);
  private readonly locationCoordinator = inject(LocationChangeCoordinatorService);
  private readonly mapPlacement = inject(MapPlacementService);
  private readonly store = inject(TowerDefenseStore);

  /**
   * Handle a map placement click.
   * Delegates validation to MapPlacementService, then applies the result.
   */
  async applyPlacementClick(host: RelocationHost): Promise<void> {
    const result = this.mapPlacement.handlePlacementClick();
    if (!result) return;

    if (result.mode === 'hq') {
      await this.applyNewHqPosition(result.lat, result.lon, host);
    } else {
      await this.applyNewSpawnPosition(result.lat, result.lon, host);
    }
  }

  /**
   * Apply a new HQ position.
   * Fast in-place if within street network bounds, full reload otherwise.
   */
  private async applyNewHqPosition(lat: number, lon: number, host: RelocationHost): Promise<void> {
    const ctx = host.context();
    if (!ctx) return;
    const streetNetwork = ctx.bridge.getStreetNetwork();

    // Fast path: HQ within loaded street bounds → in-place update
    if (streetNetwork && this.isWithinBounds(streetNetwork.bounds, lat, lon)) {
      await this.applyHqInPlace(lat, lon, host);
      return;
    }

    // Slow path: outside bounds → full 7-step location change
    // Check if old spawn is still usable or needs to be regenerated
    const existingSpawns = this.store.spawnPoints();
    let spawnLat: number;
    let spawnLon: number;
    let spawnName: string;

    const oldSpawn = existingSpawns.length > 0 ? existingSpawns[0] : null;
    const spawnTooFar = oldSpawn
      ? this.osmService.haversineDistance(oldSpawn.lat, oldSpawn.lon, lat, lon) > SPAWN_DISCARD_DISTANCE
      : true;

    if (oldSpawn && !spawnTooFar) {
      // Old spawn is close enough — let coordinator validate the path
      spawnLat = oldSpawn.lat;
      spawnLon = oldSpawn.lon;
      spawnName = oldSpawn.name;
    } else {
      // Old spawn too far or none exists — pre-load streets and find a random spawn
      // (same pattern as the location dialog's isRandom flow)
      try {
        const newNetwork = await this.osmService.loadStreets(lat, lon, 2000);

        // Cache in bridge so coordinator's step3 reuses it (avoids double-load).
        // The component may have gone away during the load.
        const bridge = host.context()?.bridge;
        bridge?.setStreetNetwork(newNetwork);
        bridge?.setStreetNetworkLocation({ lat, lon });

        const randomSpawn = this.osmService.findRandomStreetPoint(
          newNetwork, lat, lon, MIN_SPAWN_DISTANCE, MAX_SPAWN_DISTANCE,
        );
        if (randomSpawn) {
          spawnLat = randomSpawn.lat;
          spawnLon = randomSpawn.lon;
          spawnName = randomSpawn.streetName || 'Spawn';
        } else {
          // Fallback: ~700m north (coordinator will attempt pathfinding)
          spawnLat = lat + 0.0063;
          spawnLon = lon;
          spawnName = 'Fallback Spawn';
        }
      } catch {
        // Street loading failed — use fallback offset
        spawnLat = lat + 0.0063;
        spawnLon = lon;
        spawnName = 'Spawn';
      }
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
  private async applyHqInPlace(lat: number, lon: number, host: RelocationHost): Promise<void> {
    const ctx = host.context();
    const vizCallbacks = host.vizCallbacks();
    const engine = ctx?.bridge.getEngine();
    const streetNetwork = ctx?.bridge.getStreetNetwork();
    if (!ctx || !engine || !streetNetwork || !vizCallbacks) return;
    const { bridge, gameState } = ctx;

    // Save existing spawns before clearing
    const existingSpawns = this.store.spawnPoints().map(sp => ({
      id: sp.id, name: sp.name, lat: sp.lat, lon: sp.lon, color: sp.color,
    }));

    // 1. Stop animations and height updates
    this.routeAnimation.stopAnimation();
    this.heightUpdate.stopHeightUpdates();

    // 2. Reset game state (towers, enemies, etc.)
    gameState.reset();

    // 3. Targeted cleanup — keep street network + street network location
    this.markerViz.clearAllMarkers();
    this.pathRoute.clearAllRoutes();
    this.pathRoute.clearCachedPaths();
    this.streetRendering.dispose(engine.getOverlayGroup());
    this.store.spawnPoints.set([]);
    bridge.setFilteredStreetNetwork(null);

    // 4. Update engine coordinate system
    engine.setOrigin(lat, lon);

    // 5. Update store signals
    this.store.baseCoords.set({ lat, lon });
    this.store.centerCoords.set({ lat, lon, height: 400 });

    // 6. Re-initialize visualization services (markerViz + pathRoute with new baseCoords)
    vizCallbacks.initializeVisualizationServices();

    // 7. Re-add HQ marker
    this.markerViz.addBaseMarker();

    // 8. Re-add existing spawns — validate paths to new HQ
    let hasValidSpawn = false;
    for (const spawn of existingSpawns) {
      const path = this.osmService.findPath(streetNetwork, spawn.lat, spawn.lon, lat, lon);
      if (path && path.length >= 2) {
        host.addSpawnPoint(spawn.id, spawn.name, spawn.lat, spawn.lon, spawn.color);
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
        host.addSpawnPoint('spawn-1', randomSpawn.streetName || 'Spawn', randomSpawn.lat, randomSpawn.lon, SPAWN_COLORS[0]);
      }
    }

    // 10. Re-initialize game state with new routes
    const waveSpawns: WaveSpawnPoint[] = this.store.spawnPoints().map(sp => ({
      id: sp.id, name: sp.name, lat: sp.lat, lon: sp.lon,
    }));
    gameState.initialize(
      engine, { lat, lon }, waveSpawns, this.pathRoute.getCachedPaths(),
    );
    gameState.initializeGlobalRouteGrid();

    // 11. Re-initialize tower placement + street filter + rendering
    vizCallbacks.initializeTowerPlacement();
    vizCallbacks.filterStreetNetworkToRoutes();
    vizCallbacks.renderStreets();

    // 12. Camera reframe
    vizCallbacks.reframeCameraWithRoutes();
    vizCallbacks.saveInitialCameraPosition();

    // 13. Update location service + URL
    const spawns = this.store.spawnPoints();
    this.locationMgmt.setLocation(
      { lat, lon },
      spawns.map(s => ({ lat: s.lat, lon: s.lon })),
    );
    host.syncUrlWithLocation();

    // 14. Start route animation
    const cachedPaths = this.pathRoute.getCachedPaths();
    if (cachedPaths.size > 0) {
      this.routeAnimation.startAnimation(cachedPaths, spawns);
    }

    // 15. Update map placement dependencies
    this.mapPlacement.updateDependencies(streetNetwork, { lat, lon });

    // 16. Fit the corridor to the tiles: the route service started over at
    // step 6, the routes run with the street widths until it is measured.
    vizCallbacks.fitCorridorToTiles();
  }

  /**
   * Apply a new spawn position.
   * If within loaded street bounds, does a fast in-place update.
   * Otherwise triggers a full location change.
   */
  private async applyNewSpawnPosition(lat: number, lon: number, host: RelocationHost): Promise<void> {
    const ctx = host.context();
    if (!ctx) return;
    const streetNetwork = ctx.bridge.getStreetNetwork();
    const hq = this.store.baseCoords();

    if (streetNetwork && this.isWithinBounds(streetNetwork.bounds, lat, lon)) {
      // Fast in-place update (no street reload)
      await this.applySpawnInPlace(lat, lon, host);
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
  private async applySpawnInPlace(lat: number, lon: number, host: RelocationHost): Promise<void> {
    const ctx = host.context();
    const engine = ctx?.bridge.getEngine();
    const streetNetwork = ctx?.bridge.getStreetNetwork();
    if (!ctx || !engine || !streetNetwork) return;
    const { gameState } = ctx;

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
    gameState.reset();

    // 4. Add new spawn point
    host.addSpawnPoint('spawn-1', 'Spawn', lat, lon, SPAWN_COLORS[0]);

    // 5. Update location service + URL
    this.locationMgmt.setLocation(hq, [{ lat, lon }]);
    host.syncUrlWithLocation();

    // 6. Re-initialize game state with new routes
    const waveSpawns = [{ id: 'spawn-1', name: 'Spawn', lat, lon }];
    gameState.initialize(
      engine,
      { lat: hq.lat, lon: hq.lon },
      waveSpawns,
      this.pathRoute.getCachedPaths(),
    );
    gameState.initializeGlobalRouteGrid();

    // 7. Update map placement service dependencies
    this.mapPlacement.updateDependencies(streetNetwork, hq);

    // 8. Start route animation
    const cachedPaths = this.pathRoute.getCachedPaths();
    if (cachedPaths.size > 0) {
      this.routeAnimation.startAnimation(cachedPaths, this.store.spawnPoints());
    }

    // 9. Fit the corridor of the new route to the tiles: its new segments
    // run with the street widths until they are measured.
    host.vizCallbacks()?.fitCorridorToTiles();
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
}
