/**
 * A small real world for specs that run the whole simulation: the real
 * GameStateManager with the real route grid, combat, damage and projectiles
 * on a flat frame (the benchmark's harness, sim-step-bench.ts), two routes,
 * eight towers of different kinds. Used by the re-simulation acceptance and
 * the coop lockstep spec.
 *
 * The spec mocks `inject` onto its `services` record (see
 * resimulation.scenario.spec.ts); buildSimWorld fills that record before the
 * GameStateManager is made, so every manager gets its own instances. Two
 * worlds built one after the other are two independent simulations.
 */
import { GameStateManager } from '../managers/game-state.manager';
import { GlobalRouteGridService } from '../services/world/global-route-grid.service';
import { SpatialGridService } from '../services/world/spatial-grid.service';
import { StatusEffectService } from '../services/combat/status-effect.service';
import { CombatVfxService } from '../services/combat/combat-vfx.service';
import { DamageApplicationService } from '../services/combat/damage-application.service';
import { CombatEffectService } from '../services/combat/combat-effect.service';
import { TowerCombatService } from '../services/combat/tower-combat.service';
import { EconomyService } from '../services/economy.service';
import type { Tower } from '../entities/tower.entity';
import type { GeoPosition, RouteWaypoint } from '../models/game.types';
import type { SpawnPoint } from '../managers/wave.manager';
import type { ColumnSample } from '../three-engine/column-sample';
import { losMaskToJson, type LosMask } from '../utils/los-mask';
import type { GameEventBus } from '../game-engine/game-event-bus';
import { METERS_PER_DEGREE_LAT as M } from '../utils/geo-utils';
import { noopStub } from './noop-stub';
import { DetMath } from '../utils/det-math';
import { buildRoute, createBenchEngine, flatSync, localSync, markAllVisible, type LocalSync } from './sim-step-bench';

/**
 * The line of sight side of TowerPlacementService, on the real grid, no GPU.
 * A tower placed in the single player game gets no line of sight (the
 * specs mark theirs with markAllVisible). In coop it does what
 * TowerLosRegistry does with the host's GPU answering "everything visible":
 * every client waits, the host resolves after the frame and sends
 * command:los-mask on `bus()`.
 */
export function losPlacement(
  grid: GlobalRouteGridService,
  bus: () => GameEventBus | null = () => null,
  sync: LocalSync = flatSync,
) {
  const queue: Tower[] = [];
  let role: 'host' | 'guest' | null = null;
  const awaiting: Tower[] = [];
  const sent = new Set<Tower>();
  const fromMask = (tower: Tower, mask: LosMask) => {
    const { x, z } = sync.geoToLocalSimple(tower.position.lat, tower.position.lon, 0);
    tower.visibleCells = grid.applyLosMask(tower.id, x, z, mask);
    tower.losMask = mask;
    tower.losReady = true;
  };
  const unregister = (tower: Tower) => {
    grid.unregisterTower(tower.id);
    tower.visibleCells = [];
    tower.losMask = null;
    const i = awaiting.indexOf(tower);
    if (i >= 0) awaiting.splice(i, 1);
    sent.delete(tower);
  };
  return noopStub({
    registerTowerOnGrid: (tower: Tower) => {
      if (!role) return;
      tower.losReady = false;
      awaiting.push(tower);
    },
    registerTowerFromMask: fromMask,
    unregisterTowerFromGrid: unregister,
    clearAllTowerOverlays: (towers: Tower[]) => towers.forEach(unregister),
    queuedLosTowerIds: () => queue.map((t) => t.id),
    requeueLos: (towers: Tower[]) => queue.splice(0, queue.length, ...towers),
    setLosMaskSource: () => undefined,
    setCoopLosRole: (next: 'host' | 'guest' | null) => { role = next; },
    awaitingLosTowerIds: () => awaiting.map((t) => t.id),
    applyCoopLosMask: (tower: Tower, mask: LosMask) => {
      const i = awaiting.indexOf(tower);
      if (i < 0) return;
      awaiting.splice(i, 1);
      sent.delete(tower);
      grid.unregisterTower(tower.id);
      fromMask(tower, mask);
    },
    drainLosQueue: () => {
      if (role !== 'host') return;
      const tower = awaiting.find((t) => !sent.has(t));
      if (!tower) return;
      markAllVisible(grid, tower, sync);
      const mask = tower.losMask!;
      grid.unregisterTower(tower.id);
      tower.visibleCells = [];
      tower.losMask = null;
      tower.losReady = false;
      sent.add(tower);
      bus()?.emit({ type: 'command:los-mask', towerId: tower.id, reason: 'place', mask: losMaskToJson(mask) });
    },
  });
}

export interface SimWorld {
  gsm: GameStateManager;
  grid: GlobalRouteGridService;
  towers: Tower[];
  routes: GeoPosition[][];
}

export interface SimWorldOptions {
  /** The ground a cell samples (local x, z); flat at 0 by default, null for no hit */
  ground?: (x: number, z: number) => number | null;
  /**
   * Routes, spawns and cell heights to build on instead of the two default
   * routes: a coop world package. The heights go in right after the cells
   * are generated, before any tower stands, as a joiner does it.
   */
  world?: { paths: Map<string, RouteWaypoint[]>; spawns: SpawnPoint[]; heights: [number, number, number][] };
  /**
   * The world around this place instead of the equator, with two routes that
   * bend (curvedRoute): cosines of real latitudes and corners in the corridor,
   * where engines' native sin and cos would differ (TODO E28).
   */
  origin?: { lat: number; lon: number };
}

/** Local x east and z south along a route that runs north and bends: straights and arcs of 25 m radius */
function curvedRoute(eastM: number, mirror: boolean): { x: number; z: number }[] {
  // [straight m, then a turn in degrees, right positive]
  const legs: [number, number][] = [[100, 70], [120, -110], [90, 45], [110, -30], [120, 0]];
  const out = [{ x: eastM, z: 0 }];
  let x = eastM, z = 0, heading = 0;
  const step = (length: number) => {
    const { s, c } = DetMath.sincos(heading);
    x += s * length;
    z -= c * length;
    out.push({ x, z });
  };
  for (const [straight, turn] of legs) {
    for (let d = 10; d <= straight; d += 10) step(10);
    const turnRad = (mirror ? -turn : turn) * (Math.PI / 180);
    const arcSteps = Math.ceil((Math.abs(turnRad) * 25) / 10);
    for (let i = 0; i < arcSteps; i++) {
      heading += turnRad / arcSteps;
      step((Math.abs(turnRad) * 25) / arcSteps);
    }
  }
  return out;
}

/** Build the world on `services` with run seed `seed`; clears `services` first. */
export function buildSimWorld(services: Record<string, unknown>, seed: number, options: SimWorldOptions = {}): SimWorld {
  for (const key of Object.keys(services)) delete services[key];

  let paths: Map<string, RouteWaypoint[]>;
  let spawnPoints: SpawnPoint[];
  const sync = options.origin ? localSync(options.origin) : flatSync;
  if (options.world) {
    paths = options.world.paths;
    spawnPoints = options.world.spawns;
  } else if (options.origin) {
    const built = [curvedRoute(0, false), curvedRoute(220, true)].map((points) => points.map((p): RouteWaypoint => {
      const geo = sync.localToGeo({ x: p.x, y: 0, z: p.z });
      return { lat: geo.lat, lon: geo.lon, height: 0, corridorLeft: 3, corridorRight: 3 };
    }));
    paths = new Map(built.map((route, i) => [`spawn-${i + 1}`, route]));
    spawnPoints = built.map((route, i) => ({ id: `spawn-${i + 1}`, name: `Spawn ${i + 1}`, ...route[0] }));
  } else {
    const built = [buildRoute(0, 600), buildRoute(200, 600)];
    paths = new Map(built.map((route, i) => [`spawn-${i + 1}`, route]));
    spawnPoints = built.map((route, i) => ({ id: `spawn-${i + 1}`, name: `Spawn ${i + 1}`, ...route[0] }));
  }
  const routes = [...paths.values()];
  const ground = options.ground ?? (() => 0);
  const sampler = (x: number, z: number): ColumnSample | null => {
    const y = ground(x, z);
    return y === null ? null : { groundY: y, topY: y, tileDepth: 20, tileGeometricError: 1 };
  };
  const grid = new GlobalRouteGridService();
  grid.initialize(sampler as never, sync as never);
  grid.generateFromRoutes(routes);
  if (options.world) {
    const missing = grid.restoreHeights(options.world.heights);
    if (missing.length > 0) throw new Error(`world package: ${missing.length} cells not in the grid`);
  }

  services['GlobalRouteGridService'] = grid;
  services['SpatialGridService'] = new SpatialGridService();
  services['StatusEffectService'] = new StatusEffectService();
  services['ResearchStore'] = noopStub();
  services['PathAndRouteService'] = noopStub({ getCachedPaths: () => paths });
  services['EnemyDebugService'] = noopStub({ debugEnemies: () => [], clearDebugEnemies: () => undefined });
  services['EconomyService'] = new EconomyService();
  services['CombatVfxService'] = new CombatVfxService();
  services['DamageApplicationService'] = new DamageApplicationService();
  services['CombatEffectService'] = new CombatEffectService();
  services['TowerCombatService'] = new TowerCombatService();
  let gameState: GameStateManager | null = null;
  services['TowerPlacementService'] = losPlacement(grid, () => gameState?.getEventBus() ?? null, sync);

  const gsm = new GameStateManager();
  gameState = gsm;
  gsm.rng.reset(seed);
  gsm.initialize(createBenchEngine(sync), routes[0][routes[0].length - 1], spawnPoints, paths as Map<string, GeoPosition[]>);
  gsm.researchManager.completeResearch('aa-retrofit');

  const types = ['archer', 'cannon', 'ice', 'fire', 'lightning', 'rocket', 'magic', 'poison'] as const;
  const towers = types.map((type, i) => {
    const route = i % 2;
    const s = 60 + Math.floor(i / 2) * 120;
    const side = i % 4 < 2 ? 9 : -11;
    let position: GeoPosition;
    if (options.origin) {
      // Beside the waypoint s m along, off to the side of the leg there
      const points = routes[route];
      const k = Math.min(points.length - 2, Math.round(s / 10));
      const a = sync.geoToLocalSimple(points[k].lat, points[k].lon, 0);
      const b = sync.geoToLocalSimple(points[k + 1].lat, points[k + 1].lon, 0);
      const len = Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2);
      const geo = sync.localToGeo({ x: a.x - ((b.z - a.z) / len) * side, y: 0, z: a.z + ((b.x - a.x) / len) * side });
      position = { lat: geo.lat, lon: geo.lon, height: 0 };
    } else {
      position = { lat: s / M, lon: (route * 200 + side) / M, height: 0 };
    }
    const tower = gsm.towerManager.placeTower(position, type, 0)!;
    markAllVisible(grid, tower, sync);
    return tower;
  });
  return { gsm, grid, towers, routes };
}
