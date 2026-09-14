/**
 * Playtest 363, finding of playtest 2 (2026-09-14): towers that stood when
 * the ooze died (Ice, Poison, Fire) were reported to leave some of its clumps
 * alone, while towers placed afterwards shot at them.
 *
 * The ooze on a straight 200 m route, killed by the towers themselves: the
 * real GlobalRouteGridService (cells from the route), SpatialGridService,
 * EnemyManager with OozeBodies and the split, TowerCombatService with BodyAim
 * (projectile and flame loops), CombatEffectService, DamageApplicationService,
 * StatusEffectService and ProjectileManager, in GameStateManager's sub-step
 * order. Stubbed: the GPU line of sight (every cell in a tower's range is
 * visible to it, as registerTower resolves it with nothing in the way) and
 * the renderer (turrets count as aligned). The wall clock runs at game time
 * divided by the timescale.
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
import { GameEventBus } from '../game-engine/game-event-bus';
import { GameObject } from '../core/game-object';
import { Tower } from '../entities/tower.entity';
import type { Enemy } from '../entities/enemy.entity';
import type { TowerTypeId } from '../configs/tower-types.config';
import type { RouteWaypoint } from '../models/game.types';
import { METERS_PER_DEGREE_LAT as M } from '../utils/geo-utils';
import { createMockTilesEngine } from './test-helpers';

const STEP = 16;
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

describe('Towers against the clumps of a killed ooze (playtest 363)', () => {
  let bus: GameEventBus;
  let grid: GlobalRouteGridService;
  let enemies: EnemyManager;
  let projectiles: ProjectileManager;
  let combat: TowerCombatService;
  let towers: Tower[];
  let towerManager: { getAllActive: () => Tower[]; getById: (id: string) => Tower | undefined };
  let now: number;
  let wall: number;

  beforeEach(() => {
    GameObject.resetIdCounter();
    Object.keys(mockInjections).forEach((k) => delete mockInjections[k]);
    bus = new GameEventBus();
    grid = new GlobalRouteGridService();
    grid.initialize(() => ({ groundY: 0, topY: 0, tileDepth: 20, tileGeometricError: 1 }), flatSync as never);
    grid.generateFromRoutes([ROUTE]);
    const spatial = new SpatialGridService();
    const mock = createMockTilesEngine();
    const engine = {
      ...mock,
      sync: flatSync,
      terrain: { lodVersion: 1 },
      towers: {
        updateRotation: vi.fn(),
        isTurretAligned: () => true,
        releaseTarget: vi.fn(),
        hasLineOfSight: () => true,
        setIdleHeading: vi.fn(),
        get: () => undefined,
      },
      enemies: { ...mock.enemies, triggerHitFlash: vi.fn() },
      flameBeams: { startBeam: vi.fn(), stopBeam: vi.fn(), clear: vi.fn() },
    };
    enemies = new EnemyManager(bus, grid, spatial);
    enemies.initialize(engine as never);
    projectiles = new ProjectileManager(bus);
    projectiles.initialize(engine as never);
    towers = [];
    towerManager = { getAllActive: () => towers, getById: (id) => towers.find((t) => t.id === id) };
    now = 0;
    wall = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => wall);

    const status = new StatusEffectService();
    status.setGameClockProvider(() => now);
    mockInjections['GlobalRouteGridService'] = grid;
    mockInjections['SpatialGridService'] = spatial;
    mockInjections['StatusEffectService'] = status;
    mockInjections['CombatVfxService'] = new CombatVfxService();
    mockInjections['DamageApplicationService'] = new DamageApplicationService();
    mockInjections['ResearchStore'] = { airTargetingUnlocked: () => false };
    const effects = new CombatEffectService();
    effects.initialize(engine as never, bus, towerManager as never, enemies);
    mockInjections['CombatEffectService'] = effects;
    combat = new TowerCombatService();
    combat.initialize(engine as never);
  });

  afterEach(() => {
    enemies.clear();
    vi.restoreAllMocks();
  });

  /** A tower `east` metres east of the route, level with `s` metres along it, registered as TowerLosRegistry does with a clear view */
  const place = (type: TowerTypeId, s: number, east: number): Tower => {
    const tower = new Tower({ lat: s / M, lon: east / M, height: 0 }, type);
    const cells = grid.getCellsInRange(east, -s, tower.combat.range);
    for (const cell of cells) cell.towerVisibility.set(tower.id, true);
    tower.visibleCells = cells;
    tower.losReady = true;
    towers.push(tower);
    return tower;
  };

  /** One sub-step in GameStateManager.runSubStep's order; the wall clock at game time / `timescale` */
  const step = (timescale: number): void => {
    now += STEP;
    wall += STEP / timescale;
    projectiles.update(STEP);
    bus.processQueue();
    enemies.update(STEP, now);
    combat.updateTowerShooting(now, STEP, towerManager as never, enemies, projectiles);
    combat.updateBeamTowers(STEP, towerManager as never, enemies, now);
  };

  const clumps = (): Enemy[] => enemies.getAlive().filter((e) => e.typeConfig.id === 'slime-clump');
  const onClump = (tower: Tower): boolean =>
    tower.currentTarget !== null && tower.currentTarget.alive && tower.currentTarget.typeConfig.id === 'slime-clump';
  const clumpInRange = (tower: Tower): boolean =>
    clumps().some((c) =>
      Math.hypot((c.position.lat - tower.position.lat) * M, (c.position.lon - tower.position.lon) * M) <= tower.combat.range - 2,
    );

  /** Fire, Poison and Ice along the body, as the ooze dies there with the layout below */
  const placeAlongTheBody = (): Tower[] => [place('fire', 50, 8), place('poison', 30, 15), place('ice', 70, 15)];

  /** Spawns the ooze and runs until the towers have killed it */
  const killOoze = (timescale: number): void => {
    const ooze = enemies.spawn(ROUTE, 'ooze');
    for (let i = 0; ooze.alive && i < 90_000 / STEP; i++) step(timescale);
    expect(ooze.alive).toBe(false);
  };

  it.each([1, 4])('363: at %ix every tower that stood at the death takes a clump in range and hurts it', (timescale) => {
    const stood = placeAlongTheBody();
    killOoze(timescale);
    expect(clumps().length).toBeGreaterThanOrEqual(8);
    for (const tower of stood) expect(clumpInRange(tower), tower.typeConfig.id).toBe(true);

    // All three in the same sub-steps; Ice fires every 3 s and may have just shot at the ooze
    const dealt = new Map(stood.map((t) => [t, t.combat.damageDealt]));
    const firstTarget = new Map<Tower, number>();
    const firstDamage = new Map<Tower, number>();
    for (let i = 1; i <= 3_500 / STEP; i++) {
      step(timescale);
      for (const tower of stood) {
        if (!firstTarget.has(tower) && onClump(tower)) firstTarget.set(tower, i);
        if (!firstDamage.has(tower) && tower.combat.damageDealt > dealt.get(tower)!) firstDamage.set(tower, i);
      }
    }
    // A target within half a second (a sleeping tower's wake check runs every 500 ms),
    // damage once the cooldown allows; the ooze is gone, so only clumps take it
    for (const tower of stood) {
      expect(firstTarget.get(tower), tower.typeConfig.id).toBeLessThanOrEqual(500 / STEP);
      expect(firstDamage.get(tower), tower.typeConfig.id).toBeDefined();
    }
    const [fire, poison] = stood;
    expect(firstDamage.get(fire)).toBeLessThanOrEqual(3);
    expect(firstDamage.get(poison)).toBeLessThanOrEqual(1_500 / STEP);
  });

  it.each([1, 4])('363: at %ix a tower placed after the death takes a clump at once and hurts it', (timescale) => {
    placeAlongTheBody();
    killOoze(timescale);
    const late = place('ice', 60, -15);
    expect(clumpInRange(late)).toBe(true);

    const dealt = late.combat.damageDealt;
    let target = -1;
    let damage = -1;
    for (let i = 1; i <= 3_500 / STEP && (target < 0 || damage < 0); i++) {
      step(timescale);
      if (target < 0 && onClump(late)) target = i;
      if (damage < 0 && late.combat.damageDealt > dealt) damage = i;
    }
    expect(target).toBeGreaterThan(0);
    expect(target).toBeLessThanOrEqual(3);
    // Ready to fire at once: the shard's flight and splash
    expect(damage).toBeGreaterThan(0);
    expect(damage).toBeLessThanOrEqual(1_500 / STEP);
  });
});
