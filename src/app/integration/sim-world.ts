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
import type { LosMask } from '../utils/los-mask';
import { METERS_PER_DEGREE_LAT as M } from '../utils/geo-utils';
import { noopStub } from './noop-stub';
import { buildRoute, createBenchEngine, flatSync, markAllVisible } from './sim-step-bench';

/** The line of sight side of TowerPlacementService, on the real grid, no GPU. */
export function losPlacement(grid: GlobalRouteGridService) {
  const queue: Tower[] = [];
  const unregister = (tower: Tower) => {
    grid.unregisterTower(tower.id);
    tower.visibleCells = [];
    tower.losMask = null;
  };
  return noopStub({
    registerTowerFromMask: (tower: Tower, mask: LosMask) => {
      tower.visibleCells = grid.applyLosMask(tower.id, tower.position.lon * M, -tower.position.lat * M, mask);
      tower.losMask = mask;
      tower.losReady = true;
    },
    unregisterTowerFromGrid: unregister,
    clearAllTowerOverlays: (towers: Tower[]) => towers.forEach(unregister),
    queuedLosTowerIds: () => queue.map((t) => t.id),
    requeueLos: (towers: Tower[]) => queue.splice(0, queue.length, ...towers),
    setLosMaskSource: () => undefined,
    drainLosQueue: () => undefined,
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
}

/** Build the world on `services` with run seed `seed`; clears `services` first. */
export function buildSimWorld(services: Record<string, unknown>, seed: number, options: SimWorldOptions = {}): SimWorld {
  for (const key of Object.keys(services)) delete services[key];

  let paths: Map<string, RouteWaypoint[]>;
  let spawnPoints: SpawnPoint[];
  if (options.world) {
    paths = options.world.paths;
    spawnPoints = options.world.spawns;
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
  grid.initialize(sampler as never, flatSync as never);
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
  services['TowerPlacementService'] = losPlacement(grid);

  const gsm = new GameStateManager();
  gsm.rng.reset(seed);
  gsm.initialize(createBenchEngine(), routes[0][routes[0].length - 1], spawnPoints, paths as Map<string, GeoPosition[]>);
  gsm.researchManager.completeResearch('aa-retrofit');

  const types = ['archer', 'cannon', 'ice', 'fire', 'lightning', 'rocket', 'magic', 'poison'] as const;
  const towers = types.map((type, i) => {
    const route = i % 2;
    const s = 60 + Math.floor(i / 2) * 120;
    const east = route * 200 + (i % 4 < 2 ? 9 : -11);
    const tower = gsm.towerManager.placeTower({ lat: s / M, lon: east / M, height: 0 }, type, 0)!;
    markAllVisible(grid, tower);
    return tower;
  });
  return { gsm, grid, towers, routes };
}
