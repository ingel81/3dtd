/**
 * Playtest 2026-09-15 replayed: a cluster of Archer and Dual-Gatling towers,
 * the hero sent into it, then the next waves. Reported: in the wave after the
 * hero came, the towers did not fire at all, and sending him away did not
 * bring them back.
 *
 * The real GameStateManager sub-step loop with the real GlobalRouteGridService
 * (cells from the route, enemies in their cells), SpatialGridService (the
 * towers' wake check), TowerCombatService, CombatEffectService,
 * DamageApplicationService, ProjectileManager and HeroManager. Stubbed: the
 * GPU line of sight (every cell in a tower's range is visible to it, the
 * answers TowerLosRegistry writes for a clear view) and the renderer (turrets
 * count as aligned). What this covers is the simulation: whether anything the
 * hero does reaches a tower's candidates, target, sleep or cooldown. The
 * cubemap is not in it; the hero's meshes are no child of the tiles group the
 * cube renders (TowerShadowMapper, Regel 8).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('three', async () => await import('@/test/mocks/three.mock'));

const mockServices: Record<string, unknown> = {};
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
    effect: vi.fn(),
    inject: (token: { name?: string }) => {
      const name = token?.name ?? 'unknown';
      if (!mockServices[name]) mockServices[name] = withAutoStubs({});
      return mockServices[name];
    },
  };
});

import { Vector3 } from 'three';
import { createMockTilesEngine, withAutoStubs, TEST_PATH, TEST_SPAWN_POINTS } from './test-helpers';
import { GameStateManager } from '../managers/game-state.manager';
import { CombatEffectService } from '../services/combat/combat-effect.service';
import { DamageApplicationService } from '../services/combat/damage-application.service';
import { TowerCombatService } from '../services/combat/tower-combat.service';
import { GlobalRouteGridService } from '../services/world/global-route-grid.service';
import { SpatialGridService } from '../services/world/spatial-grid.service';
import { GameObject } from '../core/game-object';
import { HERO } from '../configs/hero.config';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT, geoDistanceFast } from '../utils/geo-utils';
import type { Tower } from '../entities/tower.entity';
import type { TowerTypeId } from '../configs/tower-types.config';
import type { GeoPosition, RouteWaypoint } from '../models/game.types';

/** The origin of the helper's engine */
const ORIGIN = { lat: 48.776, lon: 9.183, height: 300 };
const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(ORIGIN.lat * DEG_TO_RAD);
/** Geo to local on a flat frame around the origin, as the engine's sync near it */
const flatSync = {
  getOrigin: () => ({ ...ORIGIN }),
  geoToLocalSimple: (lat: number, lon: number, height: number) =>
    new Vector3((lon - ORIGIN.lon) * M_PER_DEG_LON, height - ORIGIN.height, -(lat - ORIGIN.lat) * METERS_PER_DEGREE_LAT),
  geoToLocalSimpleInto: (lat: number, lon: number, height: number, target: Vector3): Vector3 =>
    target.set((lon - ORIGIN.lon) * M_PER_DEG_LON, height - ORIGIN.height, -(lat - ORIGIN.lat) * METERS_PER_DEGREE_LAT),
};

/** The 111 m test path, 3 m of corridor to each side */
const ROUTE: RouteWaypoint[] = TEST_PATH.map((p) => ({ ...p, corridorLeft: 3, corridorRight: 3 }));
/** HQ at the north end */
const BASE: GeoPosition = ROUTE[ROUTE.length - 1];
/** The middle of the cluster, on the route, 56 m north of the spawn */
const POST: GeoPosition = ROUTE[5];

/** Three Archers east of the route, three Dual-Gatlings west of it, some 7 m off it */
const CLUSTER: { type: TowerTypeId; lat: number; lon: number }[] = [
  { type: 'archer', lat: 48.7762, lon: 9.183 },
  { type: 'archer', lat: 48.7763, lon: 9.183 },
  { type: 'archer', lat: 48.7764, lon: 9.183 },
  { type: 'dual-gatling', lat: 48.7762, lon: 9.1828 },
  { type: 'dual-gatling', lat: 48.7763, lon: 9.1828 },
  { type: 'dual-gatling', lat: 48.7764, lon: 9.1828 },
];

/** Speeds of one wave's zombies, all spawned at its start */
const WAVE = [2.5, 3, 3.5, 4, 2.5, 3, 3.5, 4, 2.5, 3, 3.5, 4];
/**
 * Where they walk: the route from 33 m north of the spawn, at the south end
 * of the cluster. Every tower of it has them in range within seconds; from
 * the spawn the gatlings killed them before the northern archers saw one.
 */
const WAVE_PATH: RouteWaypoint[] = ROUTE.slice(3);

/** Longest a wave may take, frames of 16 ms */
const WAVE_FRAMES = 90_000 / 16;

function createEngine(): never {
  const engine = createMockTilesEngine() as unknown as Record<string, Record<string, unknown>>;
  for (const key of ['effects', 'towers', 'enemies', 'projectiles', 'trailStreaks', 'spatialAudio', 'oozes']) {
    engine[key] = withAutoStubs(engine[key]);
  }
  engine['sync'] = withAutoStubs({ ...engine['sync'], ...flatSync });
  engine['enemies']['create'] = vi.fn(() => Promise.resolve(null));
  // Turrets on target at once; no model data; the CPU line of sight clear
  engine['towers']['isTurretAligned'] = () => true;
  engine['towers']['hasLineOfSight'] = () => true;
  engine['towers']['get'] = () => undefined;
  engine['hero'] = withAutoStubs({});
  engine['flameBeams'] = withAutoStubs({});
  engine['tentacles'] = withAutoStubs({});
  engine['bloodMoon'] = withAutoStubs({});
  engine['spatialAudio']['playAtGeo'] = () => Promise.resolve();
  engine['spatialAudio']['getListener'] = () => ({
    context: { state: 'running', resume: () => Promise.resolve() },
    getWorldPosition: (target: Vector3) => target.set(0, 0, 0),
  });
  (engine as Record<string, unknown>)['renderingEnabled'] = false;
  return withAutoStubs(engine) as never;
}

interface Game {
  gsm: GameStateManager;
  grid: GlobalRouteGridService;
  towers: Tower[];
  /** Shots per tower id since the last reset() */
  towerShots: Map<string, number>;
  heroShots: () => number;
  /** Advance by one 16 ms frame */
  frame: () => void;
  reset: () => void;
}

function createGame(): Game {
  for (const key of Object.keys(mockServices)) delete mockServices[key];
  GameObject.resetIdCounter();

  const grid = new GlobalRouteGridService();
  grid.initialize((() => ({ groundY: 0, topY: 0, tileDepth: 20, tileGeometricError: 1 })) as never, flatSync as never);
  grid.generateFromRoutes([ROUTE]);
  const paths = new Map<string, GeoPosition[]>([['spawn-1', ROUTE]]);

  mockServices['GlobalRouteGridService'] = grid;
  mockServices['SpatialGridService'] = new SpatialGridService();
  mockServices['ResearchStore'] = withAutoStubs({ airTargetingUnlocked: () => false });
  mockServices['PathAndRouteService'] = withAutoStubs({ getCachedPaths: () => paths });
  mockServices['EnemyDebugService'] = withAutoStubs({ debugEnemies: () => [] });
  mockServices['EconomyService'] = withAutoStubs({ computeWaveCompletionBonus: () => 0 });
  mockServices['DamageApplicationService'] = new DamageApplicationService();
  mockServices['CombatEffectService'] = new CombatEffectService();
  mockServices['TowerCombatService'] = new TowerCombatService();

  const gsm = new GameStateManager();
  gsm.initialize(createEngine(), BASE, TEST_SPAWN_POINTS, paths);

  // Placed and registered as TowerLosRegistry.register does with a clear view
  const towers = CLUSTER.map(({ type, lat, lon }) => {
    const tower = gsm.towerManager.placeTower({ lat, lon, height: ORIGIN.height }, type, 0)!;
    const local = flatSync.geoToLocalSimple(lat, lon, ORIGIN.height);
    const cells = grid.getCellsInRange(local.x, local.z, tower.combat.range);
    for (const cell of cells) cell.towerVisibility.set(tower.id, true);
    tower.visibleCells = cells;
    tower.losReady = true;
    return tower;
  });

  const towerShots = new Map<string, number>();
  const spawn = gsm.projectileManager.spawn.bind(gsm.projectileManager);
  vi.spyOn(gsm.projectileManager, 'spawn').mockImplementation((...args: Parameters<typeof spawn>) => {
    const id = args[0].id;
    towerShots.set(id, (towerShots.get(id) ?? 0) + 1);
    return spawn(...args);
  });
  let heroShots = 0;
  const spawnShot = gsm.projectileManager.spawnShot.bind(gsm.projectileManager);
  vi.spyOn(gsm.projectileManager, 'spawnShot').mockImplementation((...args: Parameters<typeof spawnShot>) => {
    heroShots++;
    return spawnShot(...args);
  });

  let now = 1000;
  return {
    gsm,
    grid,
    towers,
    towerShots,
    heroShots: () => heroShots,
    frame: () => {
      now += 16;
      gsm.update(now);
    },
    reset: () => {
      towerShots.clear();
      heroShots = 0;
    },
  };
}

/** Hire the hero and send him into the cluster. */
function hireIntoCluster(game: Game): void {
  const bus = game.gsm.getEventBus();
  bus.emit({
    type: 'research:completed',
    researchId: HERO.researchId,
    effects: [{ kind: 'global-perk', perkId: HERO.perkId, description: '' }],
  });
  game.gsm.addCredits(HERO.cost);
  bus.emit({ type: 'command:hire-hero' });
  expect(game.gsm.heroManager.getHero()).not.toBeNull();
  walkHero(game, POST);
}

/** Frames until the hero holds a spot within 1 m of `spot`. */
function walkHero(game: Game, spot: GeoPosition): void {
  game.gsm.getEventBus().emit({ type: 'command:hero-move', target: { lat: spot.lat, lon: spot.lon } });
  for (let i = 0; i < 2000; i++) {
    game.frame();
    const hero = game.gsm.heroManager.getHero()!;
    if (!game.gsm.heroManager.isWalking() && geoDistanceFast(hero.position, spot) < 1) return;
  }
  throw new Error('the hero did not arrive');
}

/** One wave of zombies along WAVE_PATH, run until the loop ends it. */
function runWave(game: Game): void {
  game.reset();
  game.gsm.beginWave();
  for (const speed of WAVE) game.gsm.enemyManager.spawn(WAVE_PATH, 'zombie', speed);
  for (let i = 0; i < WAVE_FRAMES && game.gsm.waveManager.phase() === 'wave'; i++) game.frame();
  expect(game.gsm.waveManager.phase()).toBe('setup');
}

describe('A tower cluster with the hero in it, playtest 2026-09-15 replayed', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('control: every tower fires in each wave without the hero', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // centre line
    const game = createGame();
    runWave(game);
    runWave(game);
    for (const tower of game.towers) {
      expect(game.towerShots.get(tower.id) ?? 0, `${tower.typeConfig.id} ${tower.id}`).toBeGreaterThan(0);
    }
  });

  it('every tower fires in the waves after the hero came into the cluster, and after he left it', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // centre line
    const game = createGame();
    hireIntoCluster(game);

    // The wave he came into, then the next one with him still in the cluster
    runWave(game);
    const inCluster = game.gsm.heroManager.getHero()!.position;
    expect(geoDistanceFast(inCluster, POST)).toBeLessThanOrEqual(HERO.leashM + 0.5);
    runWave(game);
    expect(game.heroShots()).toBeGreaterThan(0);
    for (const tower of game.towers) {
      expect(game.towerShots.get(tower.id) ?? 0, `${tower.typeConfig.id} ${tower.id} in the next wave`).toBeGreaterThan(0);
    }

    // Sent back to the HQ: the towers carry on as well
    walkHero(game, BASE);
    runWave(game);
    for (const tower of game.towers) {
      expect(game.towerShots.get(tower.id) ?? 0, `${tower.typeConfig.id} ${tower.id} after he left`).toBeGreaterThan(0);
    }
  });
});
