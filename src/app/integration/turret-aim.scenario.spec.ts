/**
 * The turret aim is simulation state (Tower.aim, docs/SIMULATOR_PLAN.md P2):
 * a tower with a turret part fires once its turret has turned onto the
 * target, whether its model ever loaded or not. Until 2026-09-24 the aim
 * lived in the tower renderer, and a tower whose model was still loading (or
 * a headless run without one) counted as aligned and fired at once.
 *
 * Real: GlobalRouteGridService (cells from the route), SpatialGridService,
 * EnemyManager, ProjectileManager, TowerCombatService, CombatEffectService,
 * DamageApplicationService, StatusEffectService, in GameStateManager's
 * sub-step order with the aim step at its end. Stubbed: the GPU line of
 * sight (every cell in range visible) and the tower renderer, which never
 * has a model (`towers.get` answers undefined).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Vector3 } from 'three';

// inject() hands out the services registered per test
const mockInjections: Record<string, unknown> = {};
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
    inject: (token: { name?: string }) => mockInjections[token?.name ?? ''] ?? {},
  };
});

import { TowerCombatService } from '../services/combat/tower-combat.service';
import { CombatEffectService } from '../services/combat/combat-effect.service';
import { CombatVfxService } from '../services/combat/combat-vfx.service';
import { DamageApplicationService } from '../services/combat/damage-application.service';
import { StatusEffectService } from '../services/combat/status-effect.service';
import { GlobalRouteGridService } from '../services/world/global-route-grid.service';
import { SpatialGridService } from '../services/world/spatial-grid.service';
import { EnemyManager } from '../managers/enemy.manager';
import { ProjectileManager } from '../managers/projectile.manager';
import { NO_RESEARCH } from '../managers/research.manager';
import { GameEventBus } from '../game-engine/game-event-bus';
import { GameObject } from '../core/game-object';
import { Tower } from '../entities/tower.entity';
import { isAimAligned, stepTowerAim } from '../entities/tower-aim';
import type { TowerTypeId } from '../configs/tower-types.config';
import type { RouteWaypoint } from '../models/game.types';
import { METERS_PER_DEGREE_LAT as M } from '../utils/geo-utils';
import { createMockTilesEngine } from './test-helpers';

const STEP = 1000 / 60;
// At the equator a degree of longitude is as long as one of latitude; x east, z south
const flatSync = {
  getOrigin: () => ({ lat: 0, lon: 0, height: 0 }),
  geoToLocalSimple: (lat: number, lon: number, height: number) => new Vector3(lon * M, height, -lat * M),
  geoToLocalSimpleInto: (lat: number, lon: number, height: number, target: Vector3): Vector3 =>
    target.set(lon * M, height, -lat * M),
};
/** 200 m north, 3 m of corridor to each side */
const ROUTE: RouteWaypoint[] = [
  { lat: 0, lon: 0, height: 0, corridorLeft: 3, corridorRight: 3 },
  { lat: 200 / M, lon: 0, height: 0, corridorLeft: 3, corridorRight: 3 },
];

describe('Turret aim in the simulation', () => {
  let enemies: EnemyManager;
  let projectiles: ProjectileManager;
  let combat: TowerCombatService;
  let grid: GlobalRouteGridService;
  let towers: Tower[];
  let now: number;

  beforeEach(() => {
    GameObject.resetIdCounter();
    Object.keys(mockInjections).forEach((k) => delete mockInjections[k]);
    const bus = new GameEventBus();
    grid = new GlobalRouteGridService();
    grid.initialize(() => ({ groundY: 0, topY: 0, tileDepth: 20, tileGeometricError: 1 }), flatSync as never);
    grid.generateFromRoutes([ROUTE]);
    const spatial = new SpatialGridService();
    const mock = createMockTilesEngine();
    const engine = {
      ...mock,
      sync: flatSync,
      terrain: { lodVersion: 1 },
      // No model, ever
      towers: { hasLineOfSight: () => true, get: () => undefined },
      enemies: { ...mock.enemies, triggerHitFlash: vi.fn() },
    };
    enemies = new EnemyManager(bus, grid, spatial);
    enemies.initialize(engine as never);
    projectiles = new ProjectileManager(bus);
    projectiles.initialize(engine as never);
    towers = [];
    now = 0;

    const status = new StatusEffectService();
    status.setGameClockProvider(() => now);
    mockInjections['GlobalRouteGridService'] = grid;
    mockInjections['SpatialGridService'] = spatial;
    mockInjections['StatusEffectService'] = status;
    mockInjections['CombatVfxService'] = new CombatVfxService();
    mockInjections['DamageApplicationService'] = new DamageApplicationService();
    const effects = new CombatEffectService();
    const towerManager = { getAllActive: () => towers, getById: (id: string) => towers.find((t) => t.id === id) };
    effects.initialize(engine as never, bus, towerManager as never, enemies, NO_RESEARCH);
    mockInjections['CombatEffectService'] = effects;
    combat = new TowerCombatService();
    combat.initialize(engine as never, NO_RESEARCH);
  });

  afterEach(() => {
    enemies.clear();
    vi.restoreAllMocks();
  });

  /**
   * A tower 15 m east of the route, level with 40 m along it, turned so its
   * turret faces north (away from an enemy coming up from the south), its
   * line of sight resolved with a clear view.
   */
  const place = (type: TowerTypeId): Tower => {
    const probe = new Tower({ lat: 0, lon: 0, height: 0 }, type);
    // customRotation that makes the placement heading north
    const customRotation = -(probe.typeConfig.rotationY ?? 0) - (probe.typeConfig.turretBarrelOffset ?? 0)
      - (probe.typeConfig.turretRestY ?? 0);
    const tower = new Tower({ lat: 40 / M, lon: 15 / M, height: 0 }, type, customRotation);
    const cells = grid.getCellsInRange(15, -40, tower.combat.range);
    for (const cell of cells) cell.towerVisibility.set(tower.id, true);
    tower.visibleCells = cells;
    tower.losReady = true;
    towers.push(tower);
    return tower;
  };

  /**
   * Run until the tower's first shot; the sub-step it took its first
   * target, the one it fired, and whether it was aligned then.
   */
  const firstShot = (tower: Tower) => {
    const spawn = vi.spyOn(projectiles, 'spawn');
    const towerManager = { getAllActive: () => towers };
    let targetAt = -1;
    for (let i = 1; i <= 10_000 / STEP; i++) {
      now += STEP;
      projectiles.update(STEP);
      enemies.update(STEP, now);
      combat.updateTowerShooting(now, STEP, towerManager as never, enemies, projectiles);
      if (targetAt < 0 && tower.currentTarget) targetAt = i;
      if (spawn.mock.calls.length > 0) return { targetAt, shotAt: i, aligned: isAimAligned(tower.aim) };
      for (const t of towers) stepTowerAim(t.aim, STEP);
    }
    return { targetAt, shotAt: -1, aligned: false };
  };

  it('a cannon without a model turns onto the target before its first shot', () => {
    const cannon = place('cannon');
    expect(cannon.aim.current).toBeCloseTo(0, 9);
    enemies.spawn(ROUTE, 'zombie');

    const { targetAt, shotAt, aligned } = firstShot(cannon);
    expect(targetAt).toBeGreaterThan(0);
    expect(shotAt).toBeGreaterThan(0);
    expect(aligned).toBe(true);
    // Its cooldown is ready from the start: only the turn (π rad/s, the
    // target about 160° off north, less the 15° tolerance) holds the shot back
    const heldMs = (shotAt - targetAt) * STEP;
    expect(heldMs).toBeGreaterThan(500);
    expect(heldMs).toBeLessThan(1000);
  });

  it('a tower without a turret part fires in the sub-step it takes the target', () => {
    const archer = place('archer');
    enemies.spawn(ROUTE, 'zombie');

    const { targetAt, shotAt } = firstShot(archer);
    expect(targetAt).toBeGreaterThan(0);
    expect(shotAt).toBe(targetAt);
  });
});
