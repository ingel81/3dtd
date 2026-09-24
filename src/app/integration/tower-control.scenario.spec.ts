/**
 * Scenario: the player mans a tower (docs/TOWER_CONTROL.md), through the
 * real GameStateManager sub-step loop with real enemies, projectiles and
 * the real damage path. Getting in, the trigger and getting out go over the
 * command bus as TowerControlService sends them; the aim is set every
 * sub-step as the mouse would.
 *
 * What it pins: a manned tower does not fire by itself; with the trigger
 * held it fires at its own fire rate at the enemy on the crosshair, which
 * dies on its hits and counts as the tower's kill; it fires at exactly the
 * rate of its upgrade level, between waves as well; a miss or an enemy out
 * of range is a blank; out of the tower it fires by itself again; selling
 * it gets the player out; a flame tower cannot be manned.
 *
 * The engine is the mock one with a real flat geo-to-local conversion, so
 * the aim ray and the enemies lie in one frame. The route grid's radius
 * query is a plain filter over the living enemies.
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

import { createMockTilesEngine, createTestCachedPaths, withAutoStubs, TEST_PATH, TEST_SPAWN_POINTS } from './test-helpers';
import { GameStateManager } from '../managers/game-state.manager';
import { CombatEffectService } from '../services/combat/combat-effect.service';
import { DamageApplicationService } from '../services/combat/damage-application.service';
import { TowerCombatService } from '../services/combat/tower-combat.service';
import { GameObject } from '../core/game-object';
import { GameClock } from '../managers/game-state/game-clock';
import { METERS_PER_DEGREE_LAT, DEG_TO_RAD } from '../utils/geo-utils';
import { getEnemyAimOffsetY } from '../utils/enemy-aim.util';
import { headingOfLocal } from '../utils/manual-aim';
import { Vector3 } from 'three';
import type { Enemy } from '../entities/enemy.entity';
import type { Tower } from '../entities/tower.entity';
import type { GeoPosition } from '../models/game.types';
import type { TowerTypeId } from '../configs/tower-types.config';

const BASE: GeoPosition = TEST_PATH[TEST_PATH.length - 1];
/** 7 m east of the path, level with its sixth point */
const TOWER_AT: GeoPosition = { lat: TEST_PATH[5].lat, lon: 9.1830, height: 300 };
/** The path from its sixth point on: an enemy there starts 7 m west of the tower */
const NEAR_PATH = TEST_PATH.slice(5);

/** Flat local frame round the HQ, as EllipsoidSync.geoToLocalSimpleInto: -X east, +Z north */
function flatSync() {
  const cosLat = Math.cos(BASE.lat * DEG_TO_RAD);
  const into = (lat: number, lon: number, height: number, out: { x: number; y: number; z: number }) => {
    out.x = -(lon - BASE.lon) * METERS_PER_DEGREE_LAT * cosLat;
    out.y = height;
    out.z = (lat - BASE.lat) * METERS_PER_DEGREE_LAT;
    return out;
  };
  return {
    geoToLocalSimpleInto: into,
    geoToLocalSimple: (lat: number, lon: number, height: number) => into(lat, lon, height, new Vector3()),
  };
}

function createEngine(): never {
  const engine = createMockTilesEngine() as unknown as Record<string, Record<string, unknown>>;
  for (const key of ['effects', 'towers', 'enemies', 'projectiles', 'trailStreaks', 'spatialAudio', 'flameBeams']) {
    engine[key] = withAutoStubs(engine[key] ?? {});
  }
  engine['sync'] = withAutoStubs({ ...engine['sync'], ...flatSync() });
  engine['enemies']['create'] = vi.fn(() => Promise.resolve(null));
  engine['hero'] = withAutoStubs({});
  engine['towers']['hasLineOfSight'] = () => true;
  engine['towers']['aimHeading'] = () => null;
  engine['spatialAudio']['getListener'] = () => ({ context: { state: 'running', resume: () => Promise.resolve() } });
  (engine as Record<string, unknown>)['renderingEnabled'] = false;
  return withAutoStubs(engine) as never;
}

function createGame(): GameStateManager {
  for (const key of Object.keys(mockServices)) delete mockServices[key];
  GameObject.resetIdCounter();
  const ref: { gsm?: GameStateManager } = {};
  const alive = (out: Enemy[]) => {
    out.length = 0;
    for (const enemy of ref.gsm!.enemyManager.getAlive()) out.push(enemy);
    return out;
  };
  mockServices['GlobalRouteGridService'] = withAutoStubs({
    isInitialized: () => false,
    getBodyEnemies: () => [],
    hasBodyWithin: () => false,
    getEnemiesInRadius: (_x: number, _z: number, _r: number, _exclude: unknown, out: Enemy[]) => alive(out),
    getEnemiesInRadiusGeo: (_c: GeoPosition, _r: number, _exclude: unknown, out: Enemy[]) => alive(out),
  });
  const paths = createTestCachedPaths();
  mockServices['PathAndRouteService'] = withAutoStubs({ getCachedPaths: () => paths });
  mockServices['SpatialGridService'] = withAutoStubs({ updateEnemyTracked: () => null, hasEnemyInRadius: () => true });
  mockServices['EnemyDebugService'] = withAutoStubs({ debugEnemies: () => [] });
  mockServices['EconomyService'] = withAutoStubs({ computeWaveCompletionBonus: () => 0 });
  mockServices['ResearchStore'] = withAutoStubs({ airTargetingUnlocked: () => false });
  mockServices['DamageApplicationService'] = new DamageApplicationService();
  mockServices['CombatEffectService'] = new CombatEffectService();
  mockServices['TowerCombatService'] = new TowerCombatService();

  const gsm = new GameStateManager();
  ref.gsm = gsm;
  gsm.initialize(createEngine(), BASE, TEST_SPAWN_POINTS, paths);
  return gsm;
}

function placeTower(gsm: GameStateManager, typeId: TowerTypeId = 'archer'): Tower {
  const tower = gsm.towerManager.placeTower(TOWER_AT, typeId, 0)!;
  tower.losReady = true;
  return tower;
}

/** Heading and pitch from the tower's eye to the point a shot at `enemy` flies to */
function aimAt(gsm: GameStateManager, tower: Tower, enemy: Enemy): { heading: number; pitch: number } {
  const sync = flatSync();
  const combat = mockServices['TowerCombatService'] as TowerCombatService;
  const eye = combat.mannedEyeInto(tower, new Vector3());
  const target = sync.geoToLocalSimple(
    enemy.position.lat,
    enemy.position.lon,
    enemy.transform.terrainHeight + enemy.heightOffset,
  );
  target.y += getEnemyAimOffsetY(enemy);
  // The eye moves with heading and pitch: a few passes from where the last
  // one put it settle it
  let heading = 0;
  let pitch = 0;
  for (let pass = 0; pass < 3; pass++) {
    heading = headingOfLocal(target.x - eye.x, target.z - eye.z);
    pitch = Math.atan2(target.y - eye.y, Math.hypot(target.x - eye.x, target.z - eye.z));
    gsm.setMannedAim(heading, pitch);
    combat.mannedEyeInto(tower, eye);
  }
  return { heading, pitch };
}

/** Run `steps` sub-steps of 16 ms, calling `each` in every one */
function steps(gsm: GameStateManager, clock: { now: number }, count: number, each?: () => void): void {
  for (let i = 0; i < count; i++) {
    clock.now += 16;
    gsm.update(clock.now, () => each?.());
  }
}

describe('Manning a tower, through the sub-step loop', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not fire by itself while manned and the trigger is not held', () => {
    const gsm = createGame();
    const tower = placeTower(gsm);
    const spawn = vi.spyOn(gsm.projectileManager, 'spawn');
    gsm.beginWave();
    gsm.enemyManager.spawn(NEAR_PATH, 'zombie', 0.01);
    const clock = { now: 1000 };

    gsm.getEventBus().emit({ type: 'command:man-tower', towerId: tower.id });
    expect(gsm.getMannedTower()).toBe(tower);
    steps(gsm, clock, 200);
    expect(spawn).not.toHaveBeenCalled();

    // Out again: it finds the enemy by itself
    gsm.getEventBus().emit({ type: 'command:leave-tower' });
    expect(tower.manned).toBe(false);
    steps(gsm, clock, 200);
    expect(spawn).toHaveBeenCalled();
  });

  it('fires at its own rate at the enemy on the crosshair, which dies on its hits and counts as its kill', () => {
    const gsm = createGame();
    const tower = placeTower(gsm);
    const spawn = vi.spyOn(gsm.projectileManager, 'spawn');
    const blank = vi.spyOn(gsm.projectileManager, 'fireBlank');
    const shots: (Enemy | null)[] = [];
    gsm.getEventBus().on('tower:manual-shot', (event) => shots.push(event.target));
    gsm.beginWave();
    // Nearly standing, 7 m west of the tower
    const enemy = gsm.enemyManager.spawn(NEAR_PATH, 'zombie', 0.01);
    const clock = { now: 1000 };

    gsm.getEventBus().emit({ type: 'command:man-tower', towerId: tower.id });
    // Aimed before the trigger goes down, as a player does
    const first = aimAt(gsm, tower, enemy);
    gsm.setMannedAim(first.heading, first.pitch);
    gsm.getEventBus().emit({ type: 'command:tower-trigger', held: true });
    // 3 s of game time, aim kept on the enemy as the mouse would
    steps(gsm, clock, 188, () => {
      if (!enemy.alive) return;
      const aim = aimAt(gsm, tower, enemy);
      gsm.setMannedAim(aim.heading, aim.pitch);
    });

    expect(blank).not.toHaveBeenCalled();
    expect(spawn.mock.calls.every(([from, at]) => from === tower && at === enemy)).toBe(true);
    // Archer: 1 shot a second. 3 s with the first at once: 3 or 4, never more
    expect(spawn.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(spawn.mock.calls.length).toBeLessThanOrEqual(Math.ceil(3 * tower.combat.fireRate) + 1);
    expect(shots.length).toBe(spawn.mock.calls.length);
    // Enough time for the hits; the zombie's 80 HP against the archer's arrows
    steps(gsm, clock, 600, () => {
      if (!enemy.alive) return;
      const aim = aimAt(gsm, tower, enemy);
      gsm.setMannedAim(aim.heading, aim.pitch);
    });
    expect(enemy.alive).toBe(false);
    expect(tower.combat.kills).toBe(1);
  });

  it('a shot past the enemy flies along the aim to the tower range and hits nothing, the cooldown spent', () => {
    const gsm = createGame();
    const tower = placeTower(gsm);
    const spawn = vi.spyOn(gsm.projectileManager, 'spawn');
    const blank = vi.spyOn(gsm.projectileManager, 'fireBlank');
    const hits = vi.fn();
    gsm.getEventBus().on('projectile:hit', hits);
    gsm.beginWave();
    const enemy = gsm.enemyManager.spawn(NEAR_PATH, 'zombie', 0.01);
    const clock = { now: 1000 };

    gsm.getEventBus().emit({ type: 'command:man-tower', towerId: tower.id });
    gsm.getEventBus().emit({ type: 'command:tower-trigger', held: true });
    // Away from the enemy (it stands to the west, the aim goes east), level
    gsm.setMannedAim(Math.PI / 2, 0);
    let first = 0;
    while (gsm.projectileManager.getAll().length === 0 && first++ < 10) steps(gsm, clock, 1);

    // The shot is a projectile of the tower's type without a target, on its way east to the range
    const [free] = gsm.projectileManager.getAll();
    expect(free.targetEnemy).toBeNull();
    expect(free.typeConfig.id).toBe(tower.typeConfig.projectileType);
    const end = free.aimPoint!;
    const eastM = (end.lon - tower.position.lon) * METERS_PER_DEGREE_LAT * Math.cos(tower.position.lat * DEG_TO_RAD);
    expect(eastM).toBeGreaterThan(tower.combat.range - 3);
    expect(Math.abs((end.lat - tower.position.lat) * METERS_PER_DEGREE_LAT)).toBeLessThan(1);

    steps(gsm, clock, 125 - first, () => gsm.setMannedAim(Math.PI / 2, 0));
    expect(spawn).not.toHaveBeenCalled();
    // 2 s at 1 shot a second
    expect(blank.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(blank.mock.calls.length).toBeLessThanOrEqual(3);
    // Flown out and gone, without a hit
    steps(gsm, clock, 300);
    gsm.getEventBus().emit({ type: 'command:tower-trigger', held: false });
    steps(gsm, clock, 300);
    expect(gsm.projectileManager.getAll()).toHaveLength(0);
    expect(hits).not.toHaveBeenCalled();
    expect(enemy.health.hp).toBe(enemy.health.maxHp);
  });

  it('fires between waves too, at nothing', () => {
    const gsm = createGame();
    const tower = placeTower(gsm);
    const blank = vi.spyOn(gsm.projectileManager, 'fireBlank');
    const clock = { now: 1000 };

    gsm.getEventBus().emit({ type: 'command:man-tower', towerId: tower.id });
    gsm.getEventBus().emit({ type: 'command:tower-trigger', held: true });
    // No wave: 2 s at 1 shot a second
    steps(gsm, clock, 125);

    expect(blank.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(blank.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('fires at exactly the fire rate of its upgrade level', () => {
    const gsm = createGame();
    const tower = placeTower(gsm, 'dual-gatling');
    for (let i = 0; i < 8; i++) tower.applyUpgrade('speed');
    const rate = tower.combat.fireRate;
    expect(rate).toBeGreaterThan(tower.typeConfig.fireRate);
    const blank = vi.spyOn(gsm.projectileManager, 'fireBlank');
    const clock = { now: 1000 };

    gsm.getEventBus().emit({ type: 'command:man-tower', towerId: tower.id });
    gsm.getEventBus().emit({ type: 'command:tower-trigger', held: true });
    let subSteps = 0;
    steps(gsm, clock, 300, () => subSteps++);

    // The same sub-steps on the CombatComponent's clock: a shot each time the
    // cooldown of 1000 / rate ms has run down, none held back or added
    let cooldown = 0;
    let expected = 0;
    for (let i = 0; i < subSteps; i++) {
      cooldown = Math.max(0, cooldown - GameClock.FIXED_STEP_MS);
      if (cooldown <= 0) {
        cooldown = 1000 / rate;
        expected++;
      }
    }
    expect(subSteps).toBeGreaterThan(200);
    expect(blank.mock.calls.length).toBe(expected);
  });

  it('an enemy on the crosshair but out of the tower\'s range is a blank', () => {
    const gsm = createGame();
    const tower = placeTower(gsm);
    const spawn = vi.spyOn(gsm.projectileManager, 'spawn');
    const blank = vi.spyOn(gsm.projectileManager, 'fireBlank');
    gsm.beginWave();
    // At the start of the path, 55 m south-west of the tower, past the archer's 30 m
    const enemy = gsm.enemyManager.spawn(TEST_PATH, 'zombie', 0.01);
    const clock = { now: 1000 };

    gsm.getEventBus().emit({ type: 'command:man-tower', towerId: tower.id });
    gsm.getEventBus().emit({ type: 'command:tower-trigger', held: true });
    steps(gsm, clock, 70, () => {
      const aim = aimAt(gsm, tower, enemy);
      gsm.setMannedAim(aim.heading, aim.pitch);
    });

    expect(spawn).not.toHaveBeenCalled();
    expect(blank).toHaveBeenCalled();
  });

  it('selling the manned tower gets the player out; a flame tower cannot be manned', () => {
    const gsm = createGame();
    const manned: (string | null)[] = [];
    gsm.getEventBus().on('tower:manned', (event) => manned.push(event.towerId));
    const tower = placeTower(gsm);

    gsm.getEventBus().emit({ type: 'command:man-tower', towerId: tower.id });
    gsm.sellTower(tower);
    expect(gsm.getMannedTower()).toBeNull();
    expect(manned).toEqual([tower.id, null]);

    const flame = placeTower(gsm, 'fire');
    gsm.getEventBus().emit({ type: 'command:man-tower', towerId: flame.id });
    expect(gsm.getMannedTower()).toBeNull();
    expect(flame.manned).toBe(false);
  });
});
