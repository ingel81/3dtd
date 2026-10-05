import { Injectable, inject } from '@angular/core';
import { ConfigService } from '../../core/services/config.service';
import { EngineInitializationService } from '../infrastructure/engine-initialization.service';
import { LocationManagementService } from '../location/location-management.service';
import { LocationChangeCoordinatorService } from '../location/location-change-coordinator.service';
import { LocationFacadeService } from '../facade/location-facade.service';
import { PathAndRouteService } from './path-route.service';
import { GlobalRouteGridService } from './global-route-grid.service';
import { MainWorldService } from './main-world.service';
import { packagePaths, type WorldPackage } from '../../coop/world-package';
import { coordKey } from '../../utils/geo-utils';
import type { GeoPosition } from '../../models/game.types';

/** Longest wait for the load of a place before giving up on it, ms */
export const WORLD_LOAD_TIMEOUT_MS = 120_000;

/** Two points are the same place at the precision the URL keeps. */
function samePlace(a: GeoPosition, b: GeoPosition): boolean {
  return coordKey(a) === coordKey(b);
}

/**
 * Standing on a world package (coop/world-package.ts): the coop guest takes
 * the host's world (docs/COOP_PLAN.md, C1), a save game its own (TODO
 * E110). The place loads as usual (tiles, streets) to be looked at; then
 * its routes, cells and heights are replaced by the package's, and the
 * world key must come out as the package's.
 */
@Injectable({ providedIn: 'root' })
export class WorldPackageLoader {
  private readonly config = inject(ConfigService);
  private readonly engineInit = inject(EngineInitializationService);
  private readonly locationMgmt = inject(LocationManagementService);
  private readonly locationChange = inject(LocationChangeCoordinatorService);
  private readonly locationFacade = inject(LocationFacadeService);
  private readonly pathRoute = inject(PathAndRouteService);
  private readonly grid = inject(GlobalRouteGridService);
  private readonly world = inject(MainWorldService);

  /**
   * Wait until the place stands here: an engine, loading screen gone,
   * corridor frozen. While the player still has to enter a map key (review
   * R8) there is no engine yet and no limit on the wait; the load itself has
   * WORLD_LOAD_TIMEOUT_MS. False once `stillWanted` says no or the time ran out.
   */
  async placeLoaded(stillWanted: () => boolean = () => true): Promise<boolean> {
    let end = performance.now() + WORLD_LOAD_TIMEOUT_MS;
    const needsKey = () => this.config.needsCredentials();
    while (needsKey() || !this.engineInit.getEngine() || this.engineInit.loading() || this.world.corridorPending()) {
      if (!stillWanted()) return false;
      if (needsKey()) end = performance.now() + WORLD_LOAD_TIMEOUT_MS;
      if (performance.now() > end) return false;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return true;
  }

  /** The place loaded here has the world's HQ */
  sameHq(world: Pick<WorldPackage, 'hq'>): boolean {
    const hq = this.locationMgmt.hq();
    return hq !== null && samePlace(hq, world.hq);
  }

  /** The place loaded here is the world's: same HQ, same spawns in the same order. */
  standsOn(world: Pick<WorldPackage, 'hq' | 'spawns'>): boolean {
    const spawns = this.world.spawnPoints;
    return this.sameHq(world)
      && spawns.length === world.spawns.length
      && spawns.every((spawn, i) => samePlace(spawn, world.spawns[i]));
  }

  /** Same HQ, other spawns: set the world's here, no new place; false when the rebuild did not finish */
  async takeSpawns(world: Pick<WorldPackage, 'spawns'>, stillWanted: () => boolean = () => true): Promise<boolean> {
    await this.locationFacade.replaceSpawns(world.spawns.map(({ lat, lon }) => ({ lat, lon })));
    return this.placeLoaded(stillWanted);
  }

  /**
   * Go to the world's place without a reload: its HQ with the first spawn,
   * then all of its spawns. False when the place did not come out as the
   * world's; `name` is what the place is called meanwhile.
   */
  async moveTo(world: Pick<WorldPackage, 'hq' | 'spawns'>, name = 'Loading...', stillWanted: () => boolean = () => true): Promise<boolean> {
    const [first] = world.spawns;
    if (!first) return false;
    await this.locationChange.applyNewLocation({
      hq: { lat: world.hq.lat, lon: world.hq.lon, name },
      spawn: { lat: first.lat, lon: first.lon, name: first.name },
    });
    if (!(await this.placeLoaded(stillWanted))) return false;
    if (!this.standsOn(world) && !(await this.takeSpawns(world, stillWanted))) return false;
    return this.standsOn(world);
  }

  /**
   * Routes, cells and heights of the package in place of those measured
   * here; once the world key is the package's, the simulation stands on it.
   * Returns the key that came out; it is the package's when this worked.
   */
  adopt(world: WorldPackage): string {
    this.pathRoute.adoptPaths(packagePaths(world));
    this.world.setSpawns(world.spawns);
    this.world.rebuildCells();
    this.grid.restoreHeights(world.heights);
    const key = this.world.key();
    if (key === world.worldKey) this.world.sendToSim();
    return key;
  }
}
