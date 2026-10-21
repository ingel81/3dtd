/**
 * TODO E232, the route drawn but no enemy: the streets of a place came late
 * (Overpass busy, retries) or not whole, and a run stood on a world without
 * a route. Its autosave held that world; a Continue on the next day, with
 * the streets loaded and the red route drawn, put the simulation back on it,
 * and every wave came without an enemy.
 *
 * The real MainWorldService, WorldPackageLoader and PathAndRouteService with
 * the simulation as a recorder: what the simulation stands on is what was
 * sent last, the gate of the wave start follows that, and a package without
 * a route is not taken.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Injector, signal } from '@angular/core';
import { MainWorldService } from './main-world.service';
import { WorldPackageLoader } from './world-package-loader.service';
import { PathAndRouteService } from './path-route.service';
import { GlobalRouteGridService } from './global-route-grid.service';
import { RouteGridVizService } from './route-grid-viz.service';
import { SimClient } from '../../sim/client/sim-client.service';
import { SimMirror } from '../../sim/client/mirror/sim-mirror';
import { PresentationService } from '../../presentation/presentation.service';
import { LocationStore } from '../../store/location.store';
import { UIStore } from '../../store/ui.store';
import { ConfigService } from '../../core/services/config.service';
import { EngineInitializationService } from '../infrastructure/engine-initialization.service';
import { LocationManagementService } from '../location/location-management.service';
import { LocationChangeCoordinatorService } from '../location/location-change-coordinator.service';
import { LocationFacadeService } from '../facade/location-facade.service';
import { WorldContext } from '../../world/world-context.service';
import type { ThreeTilesEngine } from '../../three-engine';
import type { WorldPackage } from '../../coop/world-package';
import type { SimWorld } from '../../sim/protocol/messages';
import type { RouteWaypoint } from '../../models/game.types';

const HQ = { lat: 48, lon: 9 };
const SPAWNS = [
  { id: 'spawn-1', name: 'North', lat: 48.01, lon: 9 },
  { id: 'spawn-2', name: 'East', lat: 48, lon: 9.01 },
];
const route = (from: { lat: number; lon: number }): RouteWaypoint[] => [{ ...from }, { lat: 48.005, lon: 9.002 }, { ...HQ }];
const ROUTES = () => new Map([['spawn-1', route(SPAWNS[0])]]);

const engine = {
  sync: { getOrigin: () => ({ ...HQ, height: 300 }) },
  getTerrainHeightAtGeo: () => 0,
  setRouteCorridor: () => undefined,
  terrain: { sampleColumn: () => null, peekBestTileLODAtLocal: () => 0 },
  world: { runRules: () => null, streetStyle: { plainGround: false } },
} as unknown as ThreeTilesEngine;

describe('Streets that come late, or a save without a route (TODO E232)', () => {
  let world: MainWorldService;
  let loader: WorldPackageLoader;
  let pathRoute: PathAndRouteService;
  let store: LocationStore;
  /** Every world the simulation was given, the last one is what it stands on */
  let sent: SimWorld[];
  let mirrorSet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sent = [];
    mirrorSet = vi.fn();
    const grid = {
      onStampsChanged: () => () => undefined,
      initialize: () => undefined,
      generateFromRoutes: () => undefined,
      clear: () => undefined,
      exportHeights: () => [],
      snapshotHeights: () => [],
      restoreHeights: () => [],
    };
    const injector = Injector.create({
      providers: [
        // The real ones, made in the injector's context
        { provide: MainWorldService, useFactory: () => new MainWorldService() },
        { provide: WorldPackageLoader, useFactory: () => new WorldPackageLoader() },
        { provide: PathAndRouteService, useFactory: () => new PathAndRouteService() },
        { provide: LocationStore, useFactory: () => new LocationStore() },
        { provide: GlobalRouteGridService, useValue: grid },
        { provide: RouteGridVizService, useValue: {} },
        { provide: UIStore, useValue: { routesVisible: () => false, notice: signal(null) } },
        {
          provide: SimClient,
          useValue: { started: true, loadWorld: (w: SimWorld) => sent.push(w), newRun: () => undefined, rpc: async () => undefined, configure: () => undefined },
        },
        { provide: SimMirror, useValue: { setWorld: mirrorSet } },
        { provide: PresentationService, useValue: { host: null } },
        ...[ConfigService, EngineInitializationService, LocationManagementService, LocationChangeCoordinatorService,
          LocationFacadeService, WorldContext].map((token) => ({ provide: token, useValue: {} })),
      ],
    });
    world = injector.get(MainWorldService);
    loader = injector.get(WorldPackageLoader);
    pathRoute = injector.get(PathAndRouteService);
    store = injector.get(LocationStore);
    world.attach(engine, HQ, SPAWNS);
  });

  /** The world as it stands here, packed as a save or a coop host packs it */
  const pack = (paths: Map<string, RouteWaypoint[]>, worldKey?: string): WorldPackage => {
    const before = pathRoute.getCachedPaths();
    pathRoute.adoptPaths(paths);
    const key = world.key();
    pathRoute.adoptPaths(before);
    return {
      format: '3dtd-world', version: 1, gameVersion: 'v', configHash: 'c', worldKey: worldKey ?? key,
      origin: { ...HQ, height: 300 }, hq: HQ, spawns: SPAWNS, paths: [...paths.entries()], heights: [],
    } as unknown as WorldPackage;
  };

  it('keeps the simulation on the world sent last, and its gate with it, while routes come later', () => {
    // The streets did not come in time: the corridor build froze a world without a route
    expect(world.sendToSim()).toBe(true);
    expect(sent.at(-1)!.spawns).toEqual([]);
    expect(store.hasLanes()).toBe(false);

    // Now they came and the route is drawn here: the simulation has not got it, no wave starts yet
    pathRoute.adoptPaths(ROUTES());
    expect(pathRoute.hasRoutes()).toBe(true);
    expect(sent).toHaveLength(1);
    expect(store.hasLanes()).toBe(false);

    // The build that follows the routes sends them: the lane with its route, the spawn without stays out
    world.sendToSim();
    expect(sent.at(-1)!.spawns.map((spawn) => spawn.id)).toEqual(['spawn-1']);
    expect(sent.at(-1)!.paths.map(([id]) => id)).toEqual(['spawn-1']);
    expect(store.hasLanes()).toBe(true);

    // The mirror reads the routes as sent, not the cache a later build rewrites
    const [ids, routes] = mirrorSet.mock.calls.at(-1)! as [string[], Map<string, RouteWaypoint[]>];
    expect(ids).toEqual(['spawn-1']);
    pathRoute.adoptPaths(new Map());
    expect([...routes.keys()]).toEqual(['spawn-1']);
  });

  it('drops the gate with the world when a new run begins on a place that changes', () => {
    pathRoute.adoptPaths(ROUTES());
    world.sendToSim();
    expect(store.hasLanes()).toBe(true);
    world.resetRun();
    expect(store.hasLanes()).toBe(false);
  });

  it('does not take a save without a route: the simulation stays on the world measured here', () => {
    pathRoute.adoptPaths(ROUTES());
    world.sendToSim();
    const save = pack(new Map());
    const routesHere = pathRoute.getCachedPaths();

    expect(loader.adopt(save)).toBeNull();
    expect(sent).toHaveLength(1);
    expect(pathRoute.getCachedPaths()).toBe(routesHere);
    expect(store.hasLanes()).toBe(true);
  });

  it('takes a package with a route whole: sent, and the routes here are its own', () => {
    world.sendToSim();
    const host = pack(ROUTES());
    expect(loader.adopt(host)).toBe(host.worldKey);
    expect(sent).toHaveLength(2);
    expect([...pathRoute.getCachedPaths().keys()]).toEqual(['spawn-1']);
    expect(store.hasLanes()).toBe(true);
  });

  it('puts back what stood here when the key does not come out, nothing is sent', () => {
    const routesHere = new Map([['spawn-1', route(SPAWNS[0])], ['spawn-2', route(SPAWNS[1])]]);
    pathRoute.adoptPaths(routesHere);
    world.sendToSim();
    const keyHere = world.key();

    const other = pack(ROUTES(), 'another key');
    expect(loader.adopt(other)).not.toBe('another key');
    expect(sent).toHaveLength(1);
    expect([...pathRoute.getCachedPaths().keys()]).toEqual(['spawn-1', 'spawn-2']);
    expect(world.spawnPoints).toEqual(SPAWNS);
    expect(world.key()).toBe(keyHere);
  });
});
