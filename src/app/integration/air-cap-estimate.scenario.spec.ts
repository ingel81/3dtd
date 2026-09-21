/**
 * What the survivability cap promises against what a defense delivers, for a
 * ground wave and an air wave.
 *
 * Measured over 5085 bot waves and one human run: where the cap said a wave
 * was comfortably within reach (cap about 1.6x the wave), ground defenses
 * killed 100% of it and air defenses 50%, at 10.9 HP lost against 4.2. The
 * human run ended on W8 Hornet Strike with the cap reading "645, not binding"
 * while 68 of 175 died (TODO E14, BALANCING_PLAN.md).
 *
 * The suspicion this spec exists to settle: `survivableCount` narrows *who*
 * shoots at air (gateDpsPerArmor.air, killThroughput.air) but not *how long*.
 * `engagementSeconds` divides the same `FAIRNESS_ENGAGEMENT_REACH_M` by the
 * enemy's speed for both, although only the anti-air towers cover any of that
 * stretch. A defense of mostly ground towers should then be overrated against
 * air by roughly the share of it that cannot shoot up.
 *
 * The real managers run: TowerManager, EnemyManager, ProjectileManager,
 * TowerCombatService, DamageApplicationService, CombatEffectService. Stubbed:
 * the GPU line of sight (every cell in range is visible) and the renderer.
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
import { createMockTilesEngine, withAutoStubs, TEST_SPAWN_POINTS } from './test-helpers';
import { GameStateManager } from '../managers/game-state.manager';
import { CombatEffectService } from '../services/combat/combat-effect.service';
import { DamageApplicationService } from '../services/combat/damage-application.service';
import { TowerCombatService } from '../services/combat/tower-combat.service';
import { GlobalRouteGridService } from '../services/world/global-route-grid.service';
import { SpatialGridService } from '../services/world/spatial-grid.service';
import { GameObject } from '../core/game-object';
import { analyzeDefense } from '../director/defense-analyzer';
import { survivableCount, TEMPLATES } from '../director/templates';
import { ENEMY_TYPES, type EnemyTypeId } from '../configs/enemy-types.config';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from '../utils/geo-utils';
import type { Tower } from '../entities/tower.entity';
import type { TowerTypeId } from '../configs/tower-types.config';
import type { GeoPosition, RouteWaypoint } from '../models/game.types';

const ORIGIN = { lat: 48.776, lon: 9.183, height: 300 };
const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(ORIGIN.lat * DEG_TO_RAD);

/** Geo to local on a flat frame around the origin, as the engine's sync near it. */
const flatSync = {
  getOrigin: () => ({ ...ORIGIN }),
  geoToLocalSimple: (lat: number, lon: number, height: number) =>
    new Vector3((lon - ORIGIN.lon) * M_PER_DEG_LON, height - ORIGIN.height, -(lat - ORIGIN.lat) * METERS_PER_DEGREE_LAT),
  geoToLocalSimpleInto: (lat: number, lon: number, height: number, target: Vector3): Vector3 =>
    target.set((lon - ORIGIN.lon) * M_PER_DEG_LON, height - ORIGIN.height, -(lat - ORIGIN.lat) * METERS_PER_DEGREE_LAT),
};

/** 400 m of straight route north from the spawn, 3 m of corridor to each side. */
const ROUTE: RouteWaypoint[] = Array.from({ length: 21 }, (_, i) => ({
  lat: TEST_SPAWN_POINTS[0].lat + (i * 20) / METERS_PER_DEGREE_LAT,
  lon: TEST_SPAWN_POINTS[0].lon,
  height: ORIGIN.height,
  corridorLeft: 3,
  corridorRight: 3,
}));
const BASE: GeoPosition = ROUTE[ROUTE.length - 1];

/**
 * The shape the measurement found in the wild: many towers, few that shoot up.
 * Two archers (air-capable) near the spawn, four flame towers (ground only)
 * spread over the rest of the route. Against ground every tower fires, against
 * air only the first stretch does.
 */
const DEFENSE: { type: TowerTypeId; at: number }[] = [
  { type: 'archer', at: 2 },
  { type: 'archer', at: 3 },
  { type: 'poison', at: 7 },
  { type: 'poison', at: 10 },
  { type: 'poison', at: 13 },
  { type: 'poison', at: 16 },
];

/**
 * How much headroom the cap promised in the field cases that went wrong: the
 * wave was about 1/1.6 of what the cap held for killable. That is the
 * situation the numbers were taken from, not a wave sized exactly at the cap.
 */
const FIELD_HEADROOM = 1.6;

/** Longest a wave may take here, in 16 ms frames. */
const MAX_FRAMES = 240_000 / 16;

function createEngine(): never {
  const engine = createMockTilesEngine() as unknown as Record<string, Record<string, unknown>>;
  for (const key of ['effects', 'towers', 'enemies', 'projectiles', 'trailStreaks', 'spatialAudio', 'oozes']) {
    engine[key] = withAutoStubs(engine[key]);
  }
  engine['sync'] = withAutoStubs({ ...engine['sync'], ...flatSync });
  engine['enemies']['create'] = vi.fn(() => Promise.resolve(null));
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
  towers: Tower[];
  frame: () => void;
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

  const towers = DEFENSE.map(({ type, at }) => {
    const point = ROUTE[at];
    // Just off the route, as a placed tower stands
    const tower = gsm.towerManager.placeTower(
      { lat: point.lat, lon: point.lon + 6 / M_PER_DEG_LON, height: ORIGIN.height },
      type,
      0,
    )!;
    const local = flatSync.geoToLocalSimple(tower.position.lat, tower.position.lon, ORIGIN.height);
    const cells = grid.getCellsInRange(local.x, local.z, tower.combat.range);
    for (const cell of cells) cell.towerVisibility.set(tower.id, true);
    tower.visibleCells = cells;
    tower.losReady = true;
    return tower;
  });

  let now = 1000;
  return { gsm, towers, frame: () => { now += 16; gsm.update(now); } };
}

/** What `survivableCount` promises this defense against `templateId`. */
function predict(game: Game, templateId: string, spawnDelayMs: number): number | null {
  const template = TEMPLATES.find((t) => t.id === templateId)!;
  const defense = analyzeDefense(game.towers, false, null);
  return survivableCount(
    template,
    1,
    spawnDelayMs,
    defense.gateDpsPerArmor,
    defense.killThroughput,
    (id) => ENEMY_TYPES[id as EnemyTypeId]?.armorType ?? 'unarmored',
    (id) => ENEMY_TYPES[id as EnemyTypeId]?.isAirUnit === true,
    (id) => ENEMY_TYPES[id as EnemyTypeId]?.baseHp ?? 1,
    (id) => ENEMY_TYPES[id as EnemyTypeId]?.baseSpeed ?? 5,
    () => 1,
    () => 1,
    100,
    1,
    1,
  );
}

/**
 * Send `count` enemies of `type` down the route and run the wave out.
 *
 * All of them at once, as the reference scenario does, so the wave manager
 * sees a wave it can finish; `predict` is asked with the same spawn delay of
 * zero, so the model is compared against the situation it was asked about.
 */
function fight(game: Game, type: EnemyTypeId, count: number): { killed: number; leaked: number } {
  let killed = 0;
  let leaked = 0;
  const bus = game.gsm.getEventBus();
  bus.on('enemy:died', () => { killed++; });
  bus.on('enemy:reached-base', () => { leaked++; });

  const speed = ENEMY_TYPES[type].baseSpeed;
  game.gsm.beginWave();
  for (let i = 0; i < count; i++) game.gsm.enemyManager.spawn(ROUTE, type, speed);
  for (let f = 0; f < MAX_FRAMES && game.gsm.waveManager.phase() === 'wave'; f++) game.frame();

  return { killed, leaked };
}

describe('the survivability cap against what the defense delivers', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps its promise on the ground, where every tower fires', () => {
    const game = createGame();
    const cap = predict(game, 'rat_tide', 0);
    expect(cap).not.toBeNull();
    const count = Math.max(1, Math.round(cap! / FIELD_HEADROOM));

    const { killed, leaked } = fight(game, 'rat', count);
    console.log(`Boden: Deckel ${cap}, geschickt ${count}, getoetet ${killed}, durch ${leaked}`);

    expect(killed / count).toBeGreaterThan(0.9);
  });

  it('keeps it in the air as well, where only two of six towers shoot up', () => {
    // The cap knows the difference: 15 here against 60 on the ground, out of
    // the same six towers. What the field measured (TODO E14) does not
    // reproduce without line of sight, dragons and scale.
    const game = createGame();
    const cap = predict(game, 'bat_swarm', 0);
    expect(cap).not.toBeNull();
    const count = Math.max(1, Math.round(cap! / FIELD_HEADROOM));

    const { killed, leaked } = fight(game, 'bat', count);
    console.log(`Luft:  Deckel ${cap}, geschickt ${count}, getoetet ${killed}, durch ${leaked}`);

    expect(killed / count).toBeGreaterThan(0.9);
  });
});
