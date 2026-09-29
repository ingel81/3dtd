import { Injectable, inject } from '@angular/core';
import { RouteGridVizService } from './route-grid-viz.service';
import type { ThreeTilesEngine } from '../../three-engine';
import type { GeoPosition, RouteWaypoint } from '../../models/game.types';
import type { SpawnPoint } from '../../managers/wave.manager';
import type { WorldSource } from '../../coop/world-package';
import { GlobalRouteGridService } from './global-route-grid.service';
import { PathAndRouteService } from './path-route.service';
import { raycastStats } from '../../utils/raycast-stats';
import { SimClient } from '../../sim/client/sim-client.service';
import { SimMirror } from '../../sim/client/mirror/sim-mirror';
import { buildSimWorld } from '../../sim/client/sim-world-builder';
import { worldKeyOf } from '../../sim/protocol/world-key';

/**
 * The world on the main thread (docs/SIM_WORKER.md): the route grid's cells
 * sampled from the tiles along the routes in use, frozen by the corridor
 * build, and handed to the simulation as a SimWorld once it stands. The
 * simulation builds its own grid from that, without a tile; this grid stays
 * for the lines of sight, the views of the grid and the renderers' ground.
 *
 * Also the gate the corridor build holds (corridorPending): no tower and no
 * wave while the cells are being rebuilt, on this thread and in the
 * simulation (SimConfig.corridorPending).
 */
@Injectable({ providedIn: 'root' })
export class MainWorldService {
  private readonly grid = inject(GlobalRouteGridService);
  private readonly gridViz = inject(RouteGridVizService);
  private readonly pathRoute = inject(PathAndRouteService);
  private readonly sim = inject(SimClient);
  private readonly mirror = inject(SimMirror);

  private engine: ThreeTilesEngine | null = null;
  private hq: GeoPosition | null = null;
  private spawns: SpawnPoint[] = [];
  private corridorBuilding: (() => boolean) | null = null;
  private pendingSent: boolean | null = null;
  /** Called after the cells were built anew (the towers' guard headings follow the routes) */
  private readonly rebuilt = new Set<() => void>();

  /** The engine, HQ and spawn points of a (new) place. */
  attach(engine: ThreeTilesEngine, hq: GeoPosition, spawns: readonly SpawnPoint[]): void {
    this.engine = engine;
    this.hq = { ...hq };
    this.spawns = [...spawns];
  }

  /**
   * A new run on a place that is about to change (a move, another location,
   * a DevWorld): the simulation drops its world and pauses until the new one
   * is sent (sendToSim), and starts a fresh run. The old run goes from the
   * main thread at once (SimClient.newRun: mirror, show, stores), not only
   * with the new world's first packet.
   */
  resetRun(): void {
    if (!this.sim.started) return;
    this.sim.newRun();
    this.sim.unloadWorld();
    void this.sim.rpc('reset');
  }

  /** New spawn points on the same place (DevWorld, a coop package, a spawn moved). */
  setSpawns(spawns: readonly SpawnPoint[]): void {
    this.spawns = [...spawns];
  }

  get spawnPoints(): readonly SpawnPoint[] {
    return this.spawns;
  }

  get basePosition(): GeoPosition | null {
    return this.hq;
  }

  onRebuilt(listener: () => void): () => void {
    this.rebuilt.add(listener);
    return () => this.rebuilt.delete(listener);
  }

  /** See corridorPending; set by the visualization facade to the corridor build's state. */
  setCorridorPending(pending: (() => boolean) | null): void {
    this.corridorBuilding = pending;
    this.syncPending();
  }

  /**
   * The route corridor of a new location or of a move is still being built
   * (CorridorBuild): no tower is placed and no wave starts until it is done.
   * Both would stand on the cells the build replaces.
   */
  corridorPending(): boolean {
    return this.corridorBuilding?.() ?? false;
  }

  /** Tell the simulation when the gate changed; called by the game loop every frame. */
  syncPending(): void {
    const pending = this.corridorPending();
    if (pending === this.pendingSent || !this.sim.started) return;
    this.pendingSent = pending;
    this.sim.configure({ corridorPending: pending });
  }

  /** The enemy routes in use */
  routes(): RouteWaypoint[][] {
    return Array.from(this.pathRoute.getCachedPaths().values());
  }

  /** Initialize the grid and generate the cells of the routes in use; with `region`, set the tile region to them as well. */
  buildCells(region: boolean): void {
    const engine = this.engine;
    if (!engine) {
      console.warn('[MainWorld] Cannot initialize GlobalRouteGrid - no engine');
      return;
    }
    // One terrain probe for the grid: ground plus the tile LOD it came from,
    // which `sampleCellY` uses so a coarse streaming pass cannot overwrite a
    // finer sample. The engine caches per column, so repeated cells are free.
    // Its rays are booked as routeGrid (`__raycastStats()`).
    const columnSampler = (x: number, z: number) => {
      const scope = raycastStats.enter('routeGrid');
      try {
        return engine.terrain.sampleColumn(x, z);
      } finally {
        raycastStats.exit(scope);
      }
    };
    // Cheap LOD probe the grid's full sweep uses to skip stable cells whose
    // tile LOD has not improved
    const terrainPeekLOD = (x: number, z: number) => engine.terrain.peekBestTileLODAtLocal(x, z);
    this.grid.initialize(columnSampler, engine.sync, terrainPeekLOD);

    const routes = this.routes();
    // Fine tiles along the whole corridor, so the cells sample real ground
    // even where the camera does not look.
    if (region) engine.setRouteCorridor(routes);
    if (routes.length > 0) this.grid.generateFromRoutes(routes);
    for (const listener of this.rebuilt) listener();
  }

  /**
   * The cells of the routes in use built again from nothing, without setting
   * the tile region anew: the corridor build narrows the routes pass by pass,
   * and the tiles it measures on stay the ones of the street routes the
   * location was loaded with.
   */
  rebuildCells(): void {
    this.grid.clear();
    this.buildCells(false);
  }

  /** Defense reach percent of the routes in use, see RouteGridVizService.getDefenseReachPercent */
  defenseReachPercent(): number {
    return this.gridViz.getDefenseReachPercent(this.routes());
  }

  /** The key of the world as it stands here, see worldKeyOf. */
  key(): string {
    return worldKeyOf(this.grid.snapshotHeights(), this.pathRoute.getCachedPaths().values(), this.engine?.sync.getOrigin() ?? null);
  }

  /** The finished world as a coop host packs it (coop/world-package.ts). Null before the world stands. */
  source(): WorldSource | null {
    const origin = this.engine?.sync.getOrigin();
    const hq = this.hq;
    if (!origin || !hq) return null;
    return {
      origin: { lat: origin.lat, lon: origin.lon, height: origin.height },
      hq,
      spawns: this.spawns,
      paths: this.pathRoute.getCachedPaths(),
      heights: this.grid.exportHeights(),
      worldKey: this.key(),
    };
  }

  /**
   * Hand the finished world to the simulation (a fresh run on it) and to the
   * mirror. After the corridor build, a move, a DevWorld, a coop package.
   * False when the world does not stand yet.
   */
  sendToSim(): boolean {
    const engine = this.engine;
    const hq = this.hq;
    if (!engine || !hq || !this.sim.started) return false;
    const paths = this.pathRoute.getCachedPaths();
    const world = buildSimWorld(engine, this.grid, hq, this.spawns, paths);
    if (!world) return false;
    this.mirror.setWorld(world.spawns.map((s) => s.id), paths);
    this.sim.loadWorld(world);
    this.pendingSent = null;
    this.syncPending();
    return true;
  }
}
