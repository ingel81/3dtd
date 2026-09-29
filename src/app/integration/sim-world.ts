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
import { SimCoords } from '../sim/core/sim-coords';
import { SimOps } from '../sim/core/sim-sink';
import type { Tower } from '../entities/tower.entity';
import type { GeoPosition, RouteWaypoint } from '../models/game.types';
import type { SpawnPoint } from '../managers/wave.manager';
import type { ColumnSample } from '../three-engine/column-sample';
import { losMaskToJson, type LosMaskJson } from '../utils/los-mask';
import type { LosResolveReason } from '../game-engine/events/event-types';
import { METERS_PER_DEGREE_LAT as M } from '../utils/geo-utils';
import { DetMath } from '../utils/det-math';
import { buildRoute, flatSync, localSync, markAllVisible, type LocalSync } from './sim-step-bench';

/**
 * A clear view for `tower` as the main thread's TowerLosRegistry would send
 * it with nothing in the way (markAllVisible), without leaving it in the
 * grid: the simulation applies it when the command comes back.
 */
export function clearViewMask(grid: GlobalRouteGridService, tower: Tower, sync: LocalSync = flatSync): LosMaskJson {
  const before = { cells: tower.visibleCells, mask: tower.losMask, ready: tower.losReady };
  markAllVisible(grid, tower, sync);
  const mask = losMaskToJson(tower.losMask!);
  grid.unregisterTower(tower.id);
  if (before.mask) {
    const { x, z } = sync.geoToLocalSimple(tower.position.lat, tower.position.lon, 0);
    grid.applyLosMask(tower.id, x, z, before.mask);
  }
  tower.visibleCells = before.cells;
  tower.losMask = before.mask;
  tower.losReady = before.ready;
  return mask;
}

export interface SimWorld {
  gsm: GameStateManager;
  grid: GlobalRouteGridService;
  towers: Tower[];
  routes: GeoPosition[][];
  /**
   * Answer every line of sight the simulation asked for since the last call
   * with a clear view (command:los-mask on its bus), as the main thread's
   * TowerLosRegistry does after a frame; a coop guest's spec never calls it.
   */
  answerLos(): void;
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

  const coords = new SimCoords();
  coords.use(sync);
  services['SimCoords'] = coords;
  services['SimOps'] = new SimOps();
  services['GlobalRouteGridService'] = grid;
  services['SpatialGridService'] = new SpatialGridService();
  services['StatusEffectService'] = new StatusEffectService();
  services['EconomyService'] = new EconomyService();
  services['CombatVfxService'] = new CombatVfxService();
  services['DamageApplicationService'] = new DamageApplicationService();
  services['CombatEffectService'] = new CombatEffectService();
  services['TowerCombatService'] = new TowerCombatService();

  const gsm = new GameStateManager();
  gsm.rng.reset(seed);
  gsm.initialize(routes[0][routes[0].length - 1], spawnPoints, paths);
  gsm.researchManager.completeResearch('aa-retrofit');
  // What asked for its line of sight, answered by answerLos
  const needed: [string, LosResolveReason][] = [];
  gsm.getEventBus().on('tower:los-needed', (event) => needed.push([event.towerId, event.reason]));
  gsm.getEventBus().on('game:reset', () => { needed.length = 0; });

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
  const answerLos = (): void => {
    for (const [towerId, reason] of needed.splice(0)) {
      const tower = gsm.towerManager.getById(towerId);
      if (!tower) continue;
      gsm.getEventBus().emit({ type: 'command:los-mask', towerId, reason, mask: clearViewMask(grid, tower, sync) });
    }
  };
  return { gsm, grid, towers, routes, answerLos };
}
