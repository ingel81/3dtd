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
import { corridorTrace } from '../../utils/corridor-trace';
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

/** Title of the hint over the map while the spawn moves */
const MOVING_SPAWN = 'Moving spawn';

/** Title of the hint over the map while a spawn is added */
const ADDING_SPAWN = 'Adding spawn';

/** Random street points drawn for an added spawn; the one furthest round from the others wins */
const RANDOM_SPAWN_CANDIDATES = 8;

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
    } else if (result.add) {
      await this.applySpawnAdded(result.lat, result.lon, host, result.heading);
    } else {
      await this.applySpawnInPlace(result.lat, result.lon, host, result.heading);
    }
  }

  /**
   * Add a spawn on a street 500 to 1000 m from the HQ, as far round from the
   * spawns there as the candidates allow (docs/COOP_PLAN.md, D26: a coop
   * room fills up the lanes it lacks). Some candidates are drawn and the one
   * whose bearing from the HQ lies furthest from every other spawn's wins.
   * @returns false when there is no street for one, or four spawns stand
   */
  async addRandomSpawn(host: RelocationHost): Promise<boolean> {
    const ctx = host.context();
    const streetNetwork = ctx?.bridge.getStreetNetwork();
    if (!ctx || !streetNetwork) return false;
    const hq = this.store.baseCoords();
    const bearingOf = (lat: number, lon: number) =>
      Math.atan2((lon - hq.lon) * Math.cos((hq.lat * Math.PI) / 180), lat - hq.lat);
    const taken = this.store.spawnPoints().map((spawn) => bearingOf(spawn.lat, spawn.lon));
    const gap = (bearing: number) => taken.reduce((least, other) => {
      const d = Math.abs(Math.atan2(Math.sin(bearing - other), Math.cos(bearing - other)));
      return Math.min(least, d);
    }, Math.PI);
    let best: { lat: number; lon: number; gap: number } | null = null;
    for (let i = 0; i < RANDOM_SPAWN_CANDIDATES; i++) {
      const candidate = this.osmService.findRandomStreetPoint(streetNetwork, hq.lat, hq.lon, MIN_SPAWN_DISTANCE, MAX_SPAWN_DISTANCE);
      if (!candidate) break;
      const g = gap(bearingOf(candidate.lat, candidate.lon));
      if (!best || g > best.gap) best = { lat: candidate.lat, lon: candidate.lon, gap: g };
    }
    if (!best) return false;
    return this.applySpawnAdded(best.lat, best.lon, host);
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
   * Everything up to the corridor build runs in one go on the main thread;
   * `[Relocation] HQ in place:` logs how long each step took (StepTimes):
   * reset, clear, services, paths (A* from the kept spawn to the new HQ),
   * route (the spawn's route: A* again, turn-off, corridor fit, line),
   * random (a new spawn when none is kept: up to 50 A* runs, and its
   * route), state, grid (cells and their first height sample), placement,
   * streets, camera, rest, corridor (the start of the corridor build, which
   * runs over the next frames and logs `[Corridor] build`).
   *
   * A hint over the map says so (RelocationStatusService): shown and
   * painted before the work, then the steps of the corridor build until it
   * has frozen the corridor; `[Relocation] HQ done:` sums up the whole wait
   * and says how the build ended (`ended=frozen|stopped`). The route
   * animation starts on the frozen routes. A step that throws takes the hint
   * away and passes the error on.
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
    // The corridor build puts its steps on the hint shown above.
    const hint = this.relocationStatus.follow();
    // A step that throws leaves the world half rebuilt, as it did before
    // the hint; the hint goes with it instead of standing until the next move.
    try {
      const times = new StepTimes([
        'reset', 'clear', 'services', 'paths', 'route', 'random', 'state', 'grid',
        'placement', 'streets', 'camera', 'rest',
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

      // 4. Update engine coordinate system; the corridor trace counts a new location load from here
      corridorTrace.begin('HQ moved, new origin');
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

      // 14. Update map placement dependencies
      this.mapPlacement.updateDependencies(streetNetwork, { lat, lon });
      times.lap('rest');

      console.warn(`[Relocation] HQ in place: ${times} spawnFrom=${spawnFrom} spawns=${spawns.length}`);
    } catch (error) {
      this.relocationStatus.clear();
      throw error;
    }

    // The corridor of the new routes: the route service started over at step
    // 6. The build loads the tiles, measures and builds routes and cells over
    // the next frames; the hint shows its steps until then. The route
    // animation starts on the routes it froze.
    const workEnd = performance.now();
    const result = await vizCallbacks.buildCorridor('HQ moved in place', hint.report);
    hint.end();
    if (result) this.startRouteAnimation();
    const end = performance.now();
    const ms = (from: number, to: number) => (to - from).toFixed(1);
    console.warn(
      `[Relocation] HQ done: paint=${ms(clickedAt, workStart)} work=${ms(workStart, workEnd)} ` +
      `corridor=${ms(workEnd, end)} total=${ms(clickedAt, end)}ms ended=${result ? 'frozen' : 'stopped'}`,
    );
  }

  /** Start the route animation on the routes in use, if there are any. */
  private startRouteAnimation(): void {
    const cachedPaths = this.pathRoute.getCachedPaths();
    if (cachedPaths.size > 0) {
      this.routeAnimation.startAnimation(cachedPaths, this.store.spawnPoints());
    }
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

    // 8. Build the corridor of the new route under a hint, as for the HQ;
    // segments it shares with the old route keep their measurement. The
    // route animation starts on the routes it froze.
    const viz = host.vizCallbacks();
    if (!viz) return;
    this.relocationStatus.show(MOVING_SPAWN, 'Finding the route');
    const hint = this.relocationStatus.follow();
    const result = await viz.buildCorridor('spawn moved in place', hint.report);
    hint.end();
    if (result) this.startRouteAnimation();
  }

  /** Add a spawn at `lat`, `lon` (a coop joiner takes the host's), see applySpawnAdded. */
  addSpawnAt(lat: number, lon: number, host: RelocationHost): Promise<boolean> {
    return this.applySpawnAdded(lat, lon, host);
  }

  /**
   * Add a spawn to the ones there (at most four, one per spawn colour): its
   * route is found, the run starts over as after a move, and the corridor
   * of all routes is built again under a hint.
   * @returns false when refused: no route to the HQ, or four spawns stand
   */
  private async applySpawnAdded(lat: number, lon: number, host: RelocationHost, heading?: number): Promise<boolean> {
    const ctx = host.context();
    const engine = ctx?.bridge.getEngine();
    const streetNetwork = ctx?.bridge.getStreetNetwork();
    if (!ctx || !engine || !streetNetwork) return false;
    const { gameState } = ctx;
    const existing = this.store.spawnPoints();
    if (existing.length >= SPAWN_COLORS.length) {
      console.warn('[MapPlacement] Four spawns stand already — spawn not added');
      return false;
    }

    const hq = this.store.baseCoords();
    const path = this.osmService.findPath(streetNetwork, lat, lon, hq.lat, hq.lon);
    if (!path || path.length < 2) {
      console.warn('[MapPlacement] No route from the added spawn to HQ — placement rejected');
      return false;
    }

    this.routeAnimation.stopAnimation();
    gameState.reset();

    // The ids follow the order, as a load from the URL gives them (spawn-1, spawn-2, ...)
    const index = existing.length;
    const id = `spawn-${index + 1}`;
    const portalBearing = heading === undefined ? undefined : portalHeadingToBearing(heading);
    host.addSpawnPoint(id, 'Spawn', lat, lon, SPAWN_COLORS[index], portalBearing);

    this.locationMgmt.setLocation(hq, [...this.locationMgmt.spawns(), { lat, lon, portalBearing }]);
    host.syncUrlWithLocation();

    const waveSpawns = this.store.spawnPoints().map((spawn) => ({ id: spawn.id, name: spawn.name, lat: spawn.lat, lon: spawn.lon }));
    gameState.initialize(engine, { lat: hq.lat, lon: hq.lon }, waveSpawns, this.pathRoute.getCachedPaths());
    gameState.initializeGlobalRouteGrid();
    this.mapPlacement.updateDependencies(streetNetwork, hq);

    const viz = host.vizCallbacks();
    if (!viz) return true;
    this.relocationStatus.show(ADDING_SPAWN, 'Finding the route');
    const hint = this.relocationStatus.follow();
    const result = await viz.buildCorridor('spawn added', hint.report);
    hint.end();
    if (result) this.startRouteAnimation();
    return result !== null;
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
