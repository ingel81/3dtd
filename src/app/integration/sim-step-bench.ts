/**
 * Harness for the benchmark of the whole simulation sub-step
 * (sim-step.perf.spec.ts, docs/SIMULATOR_PLAN.md, P5).
 *
 * The real GameStateManager with the real GlobalRouteGridService (cells from
 * straight routes on a flat frame at the equator), SpatialGridService,
 * StatusEffectService, CombatVfxService, DamageApplicationService,
 * CombatEffectService and TowerCombatService. Everything else the loop
 * injects and the whole engine are no-op stubs (noopStub): no vi.fn, so no
 * call is recorded and a long run does not grow memory.
 *
 * Stubbed on purpose:
 *  - Line of sight: markAllVisible() writes a clear view into the route cells
 *    in a tower's range, the answers resolveTowerLos (route-grid-los.ts) gives
 *    with nothing in the way. With the stub engine TowerLosRegistry never runs,
 *    so without it losReady stays false and no tower fires. When the sight
 *    data changes shape (SIMULATOR_PLAN.md, P3), only that function follows.
 *  - The renderer: turrets count as aligned, the raycast fallback sees.
 *  - Rendering is off (renderingEnabled false), as in a training tab and the
 *    headless fast-forward of a replay: presentFrame does not run.
 *
 * Load: the towers stand along the routes, every type that fights in turn.
 * Enemies of mixed types (air included) walk the routes with `hpFactor`
 * times their HP and are topped up to `enemies` after every sub-step, each
 * at a random point of a route, so the load stays steady while it is
 * measured. The HQ has HP to spare, leaks never end the run. All randomness
 * is seeded: gsm.rng, the harness's own spawn draws, and Math.random, which
 * only the presentation draws from (decal spread, sound intervals). Two runs
 * of a scenario do the same, down to the presentation calls.
 */
import { Vector3 } from 'three';
import { GameStateManager } from '../managers/game-state.manager';
import { CombatEffectService } from '../services/combat/combat-effect.service';
import { CombatVfxService } from '../services/combat/combat-vfx.service';
import { DamageApplicationService } from '../services/combat/damage-application.service';
import { StatusEffectService } from '../services/combat/status-effect.service';
import { TowerCombatService } from '../services/combat/tower-combat.service';
import { GlobalRouteGridService } from '../services/world/global-route-grid.service';
import { SpatialGridService } from '../services/world/spatial-grid.service';
import { GameObject } from '../core/game-object';
import { ENEMY_TYPES, type EnemyTypeId } from '../configs/enemy-types.config';
import type { TowerTypeId } from '../configs/tower-types.config';
import { canTargetAirEffective } from '../entities/tower-targeting.util';
import type { Tower } from '../entities/tower.entity';
import type { GeoPosition, RouteWaypoint } from '../models/game.types';
import { mulberry32 } from '../utils/game-rng';
import { METERS_PER_DEGREE_LAT as M } from '../utils/geo-utils';
import { noopStub } from './noop-stub';

export interface SimScenario {
  name: string;
  /** Parallel straight routes, 200 m apart */
  routes: number;
  routeLengthM: number;
  /** Spread evenly over the routes */
  towers: number;
  /** Enemies kept alive */
  enemies: number;
  /** Multiplier on every enemy's base HP */
  hpFactor: number;
}

/** Tower types that fight: projectile, beam (fire), melee (tentacle), chain (lightning) */
export const BENCH_TOWER_TYPES: readonly TowerTypeId[] = [
  'archer', 'dual-gatling', 'cannon', 'magic', 'rocket', 'ice',
  'fire', 'tentacle', 'poison', 'lightning', 'chaos',
];

/** Ground and air enemies, the skeleton splits on death; no bodies, worms or bosses */
export const BENCH_ENEMY_TYPES: readonly EnemyTypeId[] = [
  'zombie', 'rat', 'zombie-soldier', 'tank', 'skeleton', 'spider', 'penguin', 'bat', 'hornet',
];

export const BENCH_SEED = 0x5eed;

const WAYPOINT_SPACING_M = 10;
const ROUTE_SPACING_M = 200;
/** Most enemies topped up per sub-step, so a mass kill refills over a few steps */
const MAX_REFILL_PER_STEP = 20;

/** Geo to local on a flat frame at the equator, x east, z south */
const flatSync = {
  getOrigin: () => ({ lat: 0, lon: 0, height: 0 }),
  geoToLocalSimple: (lat: number, lon: number, height: number) => new Vector3(lon * M, height, -lat * M),
  geoToLocalSimpleInto: (lat: number, lon: number, height: number, target: Vector3): Vector3 =>
    target.set(lon * M, height, -lat * M),
  geoToLocal: (lat: number, lon: number, height: number) => new Vector3(lon * M, height, -lat * M),
  localToGeo: (p: { x: number; y: number; z: number }) => ({ lat: -p.z / M, lon: p.x / M, height: p.y }),
};

/** The engine: no-op except where the loop needs an answer. */
function createBenchEngine(): never {
  const resolved = () => Promise.resolve(null);
  return noopStub({
    renderingEnabled: false,
    // Flat ground, where the route grid does not answer (the spawn)
    getTerrainHeightAtGeo: () => 0,
    // ScreenShakeService measures the impact's distance to it
    getCamera: () => ({ position: new Vector3(0, 500, 0) }),
    sync: noopStub({ ...flatSync }),
    terrain: noopStub({ lodVersion: 1 }),
    towers: noopStub({
      isTurretAligned: () => true,
      hasLineOfSight: () => true,
      get: () => undefined,
    }),
    enemies: noopStub({ create: resolved }),
    spatialAudio: noopStub({
      playAtGeo: resolved,
      playAt: resolved,
      playGlobal: resolved,
      createLoop: resolved,
      playOneShot: resolved,
      // BackgroundMusicService builds three.js Audio channels on it
      getListener: () => noopStub({
        context: noopStub({ state: 'running', currentTime: 0, resume: () => Promise.resolve() }, true),
        getWorldPosition: (t: Vector3) => t.set(0, 0, 0),
      }, true),
    }),
  });
}

/** One route: north from (x, 0), a waypoint every 10 m, 3 m of corridor to each side */
function buildRoute(eastM: number, lengthM: number): RouteWaypoint[] {
  const route: RouteWaypoint[] = [];
  for (let s = 0; s <= lengthM; s += WAYPOINT_SPACING_M) {
    route.push({ lat: s / M, lon: eastM / M, height: 0, corridorLeft: 3, corridorRight: 3 });
  }
  return route;
}

/**
 * A clear view for `tower`: every route cell in its range visible on the
 * layers it may target, as resolveTowerLos writes it with nothing in the way.
 */
function markAllVisible(grid: GlobalRouteGridService, tower: Tower): void {
  const x = tower.position.lon * M;
  const z = -tower.position.lat * M;
  const ground = tower.typeConfig.canTargetGround ?? true;
  const air = canTargetAirEffective(tower.typeConfig.id as TowerTypeId, true);
  const cells = grid.getCellsInRange(x, z, tower.combat.range);
  for (const cell of cells) {
    if (ground) cell.towerVisibility.set(tower.id, true);
    if (air) cell.airVisibility.set(tower.id, true);
  }
  tower.visibleCells = cells;
  tower.losReady = true;
}

export interface SimBench {
  gsm: GameStateManager;
  towers: Tower[];
  /**
   * Run at least `steps` sub-steps at `timescale`; the last frame runs to its
   * end, so a few more may follow. Returns the count. With `times`, times[k] gets the
   * wall time of sub-step k + 2: from the end of one sub-step's callback to
   * the start of the next (runSubStep, replay recorder, wave checks, and once
   * per frame the frame's own work). The enemy top-up is not in it.
   */
  run(steps: number, timescale: number, times?: Float64Array): number;
  /** Damage all towers dealt so far */
  damageDealt(): number;
  kills(): number;
  /** Puts Math.random back */
  dispose(): void;
}

/**
 * Build a game for `scenario`: routes, towers with a clear view, the wave
 * running and the enemies spawned. `services` is the map the spec's
 * `inject()` stub reads by class name; it is cleared and filled here.
 */
export function createSimBench(scenario: SimScenario, services: Record<string, unknown>): SimBench {
  for (const key of Object.keys(services)) delete services[key];
  GameObject.resetIdCounter();
  // Where the harness spawns; Math.random apart, the presentation draws from it
  const random = mulberry32(BENCH_SEED);
  const mathRandom = Math.random;
  Math.random = mulberry32(BENCH_SEED + 1);

  const routes = Array.from({ length: scenario.routes }, (_, i) => buildRoute(i * ROUTE_SPACING_M, scenario.routeLengthM));
  const grid = new GlobalRouteGridService();
  grid.initialize((() => ({ groundY: 0, topY: 0, tileDepth: 20, tileGeometricError: 1 })) as never, flatSync as never);
  grid.generateFromRoutes(routes);
  const paths = new Map<string, GeoPosition[]>(routes.map((route, i) => [`spawn-${i + 1}`, route]));
  const spawnPoints = routes.map((route, i) => ({ id: `spawn-${i + 1}`, name: `Spawn ${i + 1}`, ...route[0] }));

  services['GlobalRouteGridService'] = grid;
  services['SpatialGridService'] = new SpatialGridService();
  services['StatusEffectService'] = new StatusEffectService();
  services['ResearchStore'] = noopStub({ airTargetingUnlocked: () => true });
  services['PathAndRouteService'] = noopStub({ getCachedPaths: () => paths });
  services['EnemyDebugService'] = noopStub({ debugEnemies: () => [] });
  services['EconomyService'] = noopStub({ computeWaveCompletionBonus: () => 0 });
  services['CombatVfxService'] = new CombatVfxService();
  services['DamageApplicationService'] = new DamageApplicationService();
  services['CombatEffectService'] = new CombatEffectService();
  services['TowerCombatService'] = new TowerCombatService();

  const gsm = new GameStateManager();
  // Before initialize: the managers take their streams there
  gsm.rng.reset(BENCH_SEED);
  gsm.initialize(createBenchEngine(), routes[0][routes[0].length - 1], spawnPoints, paths);
  gsm.adjustBaseHealth(1e12);

  // Towers alternate sides, 8 to 14 m off the route
  const towers: Tower[] = [];
  const perRoute = Math.ceil(scenario.towers / scenario.routes);
  for (let i = 0; i < scenario.towers; i++) {
    const r = i % scenario.routes;
    const k = Math.floor(i / scenario.routes);
    const s = ((k + 0.5) / perRoute) * scenario.routeLengthM;
    const east = r * ROUTE_SPACING_M + (k % 2 === 0 ? 1 : -1) * (8 + (k % 4) * 2);
    const type = BENCH_TOWER_TYPES[i % BENCH_TOWER_TYPES.length];
    const tower = gsm.towerManager.placeTower({ lat: s / M, lon: east / M, height: 0 }, type, 0)!;
    markAllVisible(grid, tower);
    towers.push(tower);
  }

  gsm.beginWave();
  // No spawn plan, so the wave has no weight of its own: every kill gets a share
  gsm.enemyManager.setWaveWeightProvider(() => scenario.enemies);

  let spawned = 0;
  const spawnOne = (): void => {
    const route = routes[spawned % routes.length];
    const from = Math.floor(random() * (route.length - 2));
    const type = BENCH_ENEMY_TYPES[spawned % BENCH_ENEMY_TYPES.length];
    gsm.enemyManager.spawn(route.slice(from), type, undefined, false, ENEMY_TYPES[type].baseHp * scenario.hpFactor);
    spawned++;
  };
  const topUp = (limit: number): void => {
    // The signal, not getAlive(): that fills a cache the loop would then reuse
    const missing = Math.min(limit, scenario.enemies - gsm.enemyManager.aliveCount());
    for (let i = 0; i < missing; i++) spawnOne();
  };
  topUp(scenario.enemies);

  let kills = 0;
  gsm.getEventBus().on('enemy:died', () => kills++);

  let now = 1000;
  return {
    gsm,
    towers,
    run(steps, timescale, times) {
      gsm.gameSpeed.set(timescale);
      let done = 0;
      let last = 0;
      while (done < steps) {
        now += 16.667;
        gsm.update(now, () => {
          if (times && done > 0 && done <= times.length) times[done - 1] = performance.now() - last;
          done++;
          topUp(MAX_REFILL_PER_STEP);
          last = performance.now();
        });
      }
      return done;
    },
    damageDealt: () => towers.reduce((sum, t) => sum + t.combat.damageDealt, 0),
    kills: () => kills,
    dispose: () => {
      Math.random = mathRandom;
    },
  };
}

export interface StepStats {
  steps: number;
  medianMs: number;
  p95Ms: number;
  meanMs: number;
  /** Sub-steps per second of wall time, from the mean */
  stepsPerSecond: number;
  /** Per sub-step, from the GameStateManager's profiler sums */
  projectileMs: number;
  combatMs: number;
  eventsMs: number;
}

/** Warm up, then time `steps` sub-steps one by one (see SimBench.run). */
export function measureSteps(bench: SimBench, warmup: number, steps: number, timescale = 10): StepStats {
  bench.run(warmup, timescale);

  const sums = { projectile: 0, combat: 0, events: 0 };
  bench.gsm.setProfiler({
    accumulateFrameTiming: (_tower: number, projectile: number, combat: number, events: number) => {
      sums.projectile += projectile;
      sums.combat += combat;
      sums.events += events;
    },
  } as never);
  const times = new Float64Array(steps);
  // One more: the first sub-step only starts the clock. The profiler sums
  // cover every sub-step run, the last frame's overshoot included
  const done = bench.run(steps + 1, timescale, times);
  bench.gsm.setProfiler(null);

  const sorted = Array.from(times).sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / steps;
  return {
    steps,
    medianMs: sorted[Math.floor(steps / 2)],
    p95Ms: sorted[Math.min(steps - 1, Math.floor(steps * 0.95))],
    meanMs: mean,
    stepsPerSecond: 1000 / mean,
    projectileMs: sums.projectile / done,
    combatMs: sums.combat / done,
    eventsMs: sums.events / done,
  };
}

/**
 * Headless fast-forward as a replay seek would do it: `steps` sub-steps at
 * timescale 75 (75 sub-steps per update call), wall time for all of them.
 * The enemy top-up is in it, as a wave's own spawns would be.
 */
export function measureFastForward(bench: SimBench, steps: number): { totalMs: number; stepsPerSecond: number } {
  const t0 = performance.now();
  const done = bench.run(steps, 75);
  const totalMs = performance.now() - t0;
  return { totalMs, stepsPerSecond: (done / totalMs) * 1000 };
}
