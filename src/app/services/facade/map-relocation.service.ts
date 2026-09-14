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
import { RelocationStatusService } from '../world/relocation-status.service';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { GameStateManager } from '../../managers/game-state.manager';
import { SpawnPoint as WaveSpawnPoint } from '../../managers/wave.manager';
import { SPAWN_COLORS, MIN_SPAWN_DISTANCE, MAX_SPAWN_DISTANCE, SPAWN_DISCARD_DISTANCE } from '../../configs/map-constants.config';
import { portalHeadingToBearing } from '../../three-engine/renderers/marker/spawn-portal-pose';
import type { FacadeComponentBridge } from './tower-defense-facade.service';
import type { VizCallbacks } from './location-facade.service';

/** What a relocation needs from the location facade, read at the moment it is needed. */
export interface RelocationHost {
  /** The game component's bridge and game state; null once it went away. */
  context(): { bridge: FacadeComponentBridge; gameState: GameStateManager } | null;
  /** Viz callbacks for the in-place rebuild; null before the coordinator flow is set up. */
  vizCallbacks(): VizCallbacks | null;
  /** @param portalBearing Which way its portal faces, see SavedSpawn; along its route without one */
  addSpawnPoint(id: string, name: string, lat: number, lon: number, color: number, portalBearing?: number): void;
  syncUrlWithLocation(): void;
}

/** Title of the hint over the map while the HQ moves */
const MOVING_HQ = 'Moving HQ';

/**
 * Moves the HQ or the spawn to where the player clicked in map placement
 * mode. Inside the loaded street network the world is rebuilt in place (no
 * loading screen, no street reload); an HQ outside it becomes a full
 * location change through the coordinator. A spawn always moves in place:
 * MapPlacementService only takes one on a loaded way.
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
  private readonly relocationStatus = inject(RelocationStatusService);
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
      await this.applySpawnInPlace(result.lat, result.lon, host, result.heading);
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
    const times = new StepTimes(['streets', 'spawn']);
    const existingSpawns = this.store.spawnPoints();
    let spawnLat: number;
    let spawnLon: number;
    let spawnName: string;
    let spawnFrom: 'old' | 'random' | 'fallback';

    const oldSpawn = existingSpawns.length > 0 ? existingSpawns[0] : null;
    const spawnTooFar = oldSpawn
      ? this.osmService.haversineDistance(oldSpawn.lat, oldSpawn.lon, lat, lon) > SPAWN_DISCARD_DISTANCE
      : true;

    if (oldSpawn && !spawnTooFar) {
      // Old spawn is close enough — let coordinator validate the path
      spawnLat = oldSpawn.lat;
      spawnLon = oldSpawn.lon;
      spawnName = oldSpawn.name;
      spawnFrom = 'old';
    } else {
      // Old spawn too far or none exists — pre-load streets and find a random spawn
      // (same pattern as the location dialog's isRandom flow). Up to three
      // Overpass servers at 15 s each before the loading screen: say so.
      this.relocationStatus.show(MOVING_HQ, 'Loading streets');
      try {
        const newNetwork = await this.osmService.loadStreets(lat, lon, 2000);
        times.lap('streets');

        // Cache in bridge so coordinator's step3 reuses it (avoids double-load).
        // The component may have gone away during the load.
        const bridge = host.context()?.bridge;
        bridge?.setStreetNetwork(newNetwork);
        bridge?.setStreetNetworkLocation({ lat, lon });

        const randomSpawn = this.osmService.findRandomStreetPoint(
          newNetwork, lat, lon, MIN_SPAWN_DISTANCE, MAX_SPAWN_DISTANCE,
        );
        times.lap('spawn');
        if (randomSpawn) {
          spawnLat = randomSpawn.lat;
          spawnLon = randomSpawn.lon;
          spawnName = randomSpawn.streetName || 'Spawn';
          spawnFrom = 'random';
        } else {
          // Fallback: ~700m north (coordinator will attempt pathfinding)
          spawnLat = lat + 0.0063;
          spawnLon = lon;
          spawnName = 'Fallback Spawn';
          spawnFrom = 'fallback';
        }
      } catch {
        // Street loading failed — use fallback offset
        times.lap('streets');
        spawnLat = lat + 0.0063;
        spawnLon = lon;
        spawnName = 'Spawn';
        spawnFrom = 'fallback';
      }
    }

    // Before the loading screen of the location change: what the player
    // waited for without one. The change itself reports its steps there.
    console.warn(`[Relocation] HQ outside the streets: ${times} spawnFrom=${spawnFrom}`);

    // The loading screen of the change takes over from the hint
    this.relocationStatus.clear();
    await this.locationCoordinator.applyNewLocation({
      hq: { lat, lon, name: 'Loading...' },
      spawn: { lat: spawnLat, lon: spawnLon, name: spawnName },
    });
  }

  /**
   * Fast HQ repositioning within loaded street network bounds.
   * Calls engine.setOrigin() to update coordinate system, then rebuilds
   * markers, paths, and game state without loading screen or street reload.
   *
   * Everything up to the corridor fit runs in one go on the main thread;
   * `[Relocation] HQ in place:` logs how long each step took (StepTimes):
   * reset, clear, services, paths (A* from the kept spawn to the new HQ),
   * route (the spawn's route: A* again, turn-off, corridor fit, line),
   * random (a new spawn when none is kept: up to 50 A* runs, and its
   * route), state, grid (cells and their first height sample), placement,
   * streets, camera, rest, corridor (the first slice of the measurement,
   * whose remainder runs over the next frames and logs `[Corridor]
   * clearance`).
   *
   * A hint over the map says so (RelocationStatusService): shown and
   * painted before the work, then the corridor measurement in percent
   * until it is done; `[Relocation] HQ done:` sums up the whole wait and
   * says how the measurement ended (`ended=commit|cancel`). A step that
   * throws takes the hint away and passes the error on.
   */
  private async applyHqInPlace(lat: number, lon: number, host: RelocationHost): Promise<void> {
    if (!this.inPlaceContext(host)) return;
    const clickedAt = performance.now();
    // Nothing paints while the work below runs: show the hint and let it
    // paint first. The component may go away meanwhile, so read it again.
    this.relocationStatus.show(MOVING_HQ, 'Finding the route');
    await this.relocationStatus.painted();
    const context = this.inPlaceContext(host);
    if (!context) {
      this.relocationStatus.clear();
      return;
    }
    const { ctx, engine, streetNetwork, vizCallbacks } = context;
    const { bridge, gameState } = ctx;
    const workStart = performance.now();
    // A step that throws leaves the world half rebuilt, as it did before
    // the hint; the hint goes with it instead of standing until the next move.
    try {
      const times = new StepTimes([
        'reset', 'clear', 'services', 'paths', 'route', 'random', 'state', 'grid',
        'placement', 'streets', 'camera', 'rest', 'corridor',
      ]);
      let spawnFrom: 'old' | 'random' | 'none' = 'none';

      // Save existing spawns before clearing
      const existingSpawns = this.store.spawnPoints().map(sp => ({
        id: sp.id, name: sp.name, lat: sp.lat, lon: sp.lon, color: sp.color,
      }));

      // 1. Stop animations and height updates
      this.routeAnimation.stopAnimation();
      this.heightUpdate.stopHeightUpdates();

      // 2. Reset game state (towers, enemies, etc.)
      gameState.reset();
      times.lap('reset');

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
      times.lap('clear');

      // 6. Re-initialize visualization services (markerViz + pathRoute with new baseCoords)
      vizCallbacks.initializeVisualizationServices();

      // 7. Re-add HQ marker
      this.markerViz.addBaseMarker();
      times.lap('services');

      // 8. Re-add existing spawns — validate paths to new HQ
      let hasValidSpawn = false;
      for (const spawn of existingSpawns) {
        const path = this.osmService.findPath(streetNetwork, spawn.lat, spawn.lon, lat, lon);
        times.lap('paths');
        if (path && path.length >= 2) {
          host.addSpawnPoint(spawn.id, spawn.name, spawn.lat, spawn.lon, spawn.color);
          times.lap('route');
          hasValidSpawn = true;
          spawnFrom = 'old';
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
          spawnFrom = 'random';
        }
        times.lap('random');
      }

      // 10. Re-initialize game state with new routes
      const waveSpawns: WaveSpawnPoint[] = this.store.spawnPoints().map(sp => ({
        id: sp.id, name: sp.name, lat: sp.lat, lon: sp.lon,
      }));
      gameState.initialize(
        engine, { lat, lon }, waveSpawns, this.pathRoute.getCachedPaths(),
      );
      times.lap('state');
      gameState.initializeGlobalRouteGrid();
      times.lap('grid');

      // 11. Re-initialize tower placement + street filter + rendering
      vizCallbacks.initializeTowerPlacement();
      times.lap('placement');
      vizCallbacks.filterStreetNetworkToRoutes();
      vizCallbacks.renderStreets();
      times.lap('streets');

      // 12. Camera reframe
      vizCallbacks.reframeCameraWithRoutes();
      vizCallbacks.saveInitialCameraPosition();
      times.lap('camera');

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
      times.lap('rest');

      // 16. Fit the corridor to the tiles: the route service started over at
      // step 6, the routes run with the street widths until it is measured.
      vizCallbacks.fitCorridorToTiles();
      times.lap('corridor');

      console.warn(`[Relocation] HQ in place: ${times} spawnFrom=${spawnFrom} spawns=${spawns.length}`);
    } catch (error) {
      this.relocationStatus.clear();
      throw error;
    }

    // The measurement runs over the next frames and rebuilds routes and
    // cells at its end; the hint shows it in percent until then.
    const workEnd = performance.now();
    this.relocationStatus.followCorridor(
      () => this.pathRoute.clearanceProgress(),
      () => {
        const end = performance.now();
        const ms = (from: number, to: number) => (to - from).toFixed(1);
        console.warn(
          `[Relocation] HQ done: paint=${ms(clickedAt, workStart)} work=${ms(workStart, workEnd)} ` +
          `corridor=${ms(workEnd, end)} total=${ms(clickedAt, end)}ms ended=${this.pathRoute.clearanceEnding() ?? 'none'}`,
        );
      },
    );
  }

  /** What a move in place needs from the host, null while any of it is missing. */
  private inPlaceContext(host: RelocationHost) {
    const ctx = host.context();
    const vizCallbacks = host.vizCallbacks();
    const engine = ctx?.bridge.getEngine();
    const streetNetwork = ctx?.bridge.getStreetNetwork();
    if (!ctx || !engine || !streetNetwork || !vizCallbacks) return null;
    return { ctx, engine, streetNetwork, vizCallbacks };
  }

  /**
   * Replace the spawn on the loaded street network, also where the click
   * lies outside its box (on a way reaching out of it): no street reload,
   * only paths and game state are rebuilt.
   * @param heading Portal heading the player turned the spawn to, see
   *   PlacementResult
   */
  private async applySpawnInPlace(lat: number, lon: number, host: RelocationHost, heading?: number): Promise<void> {
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

    // 4. Add new spawn point; its portal faces along the route unless the
    // player turned it. The turn is kept as a compass bearing, in the
    // location and so in the URL and in favorites saved from here.
    const portalBearing = heading === undefined ? undefined : portalHeadingToBearing(heading);
    host.addSpawnPoint('spawn-1', 'Spawn', lat, lon, SPAWN_COLORS[0], portalBearing);

    // 5. Update location service + URL
    this.locationMgmt.setLocation(hq, [{ lat, lon, portalBearing }]);
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

/**
 * Time per step of a move, for the `[Relocation]` log: "reset=1.2 clear=0.4
 * ... total=812.3ms". Every step named up front is printed, 0.0 when it did
 * not run; a step lapped twice adds up.
 */
class StepTimes {
  private readonly start = performance.now();
  private last = this.start;
  private readonly ms: Map<string, number>;

  constructor(steps: readonly string[]) {
    this.ms = new Map(steps.map((step) => [step, 0]));
  }

  /** Book the time since the previous lap (or the start) to `step`. */
  lap(step: string): void {
    const now = performance.now();
    this.ms.set(step, (this.ms.get(step) ?? 0) + now - this.last);
    this.last = now;
  }

  toString(): string {
    const parts = [...this.ms].map(([step, ms]) => `${step}=${ms.toFixed(1)}`);
    return `${parts.join(' ')} total=${(this.last - this.start).toFixed(1)}ms`;
  }
}
