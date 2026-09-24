/**
 * Playtest 359, 360 and 424 (night 2026-09-14): towers against the ooze's
 * body along the route. A real RouteBody on a straight 200 m route, the real
 * BodyAim, TowerCombatService's flame cone, CombatEffectService's hit and DoT
 * paths and the real StatusEffectService; the route grid, the engine and the
 * damage application are stubs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Vector3 } from 'three';

// inject() hands out the stubs registered per test
const mockInjections: Record<string, unknown> = {};
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
    inject: (token: { name?: string }) => mockInjections[token?.name ?? ''] ?? {},
  };
});

import { TowerCombatService } from './tower-combat.service';
import { NO_RESEARCH } from '../../managers/research.manager';
import { CombatEffectService } from './combat-effect.service';
import { StatusEffectService } from './status-effect.service';
import { BodyAim, type BodyAimGrid, type BodyAimPoint } from './body-aim';
import { Tower } from '../../entities/tower.entity';
import { Enemy } from '../../entities/enemy.entity';
import { PROJECTILE_TYPES, type ProjectileTypeId } from '../../configs/projectile-types.config';
import type { TowerTypeId } from '../../configs/tower-types.config';
import { METERS_PER_DEGREE_LAT as M } from '../../utils/geo-utils';
import { ROUTE_BODY_AIM_HEIGHT_M, RouteBody, RouteBodyStations } from '../../utils/route-body';
import { lateralLimit } from '../../utils/route-corridor';
import type { RouteCell } from '../../utils/route-cell';

const ORIGIN_HEIGHT = 100;
/** Local ground under the route */
const GROUND_Y = 2;
// At the equator a degree of longitude is as long as one of latitude; x east, z south
const flatSync = {
  geoToLocalSimpleInto: (lat: number, lon: number, height: number, target: Vector3): Vector3 =>
    target.set(lon * M, height - ORIGIN_HEIGHT, -lat * M),
};
// 200 m north, 3 m of corridor to each side, a station every 2 m
const ROUTE = [
  { lat: 0, lon: 0, height: ORIGIN_HEIGHT, corridorLeft: 3, corridorRight: 3 },
  { lat: 200 / M, lon: 0, height: ORIGIN_HEIGHT, corridorLeft: 3, corridorRight: 3 },
];
const stations = new RouteBodyStations(ROUTE, flatSync, ORIGIN_HEIGHT);
/** How far an aim point lies off the centre line toward a tower: inside the route cells */
const LATERAL = lateralLimit(3);

/** An ooze whose body lies between `tail` and `tip`, metres along the route */
function oozeBetween(tail: number, tip: number): Enemy {
  const ooze = new Enemy('ooze', ROUTE);
  const body = new RouteBody(stations);
  body.tailM = tail;
  body.tipM = tip;
  ooze.body = body;
  return ooze;
}

/** A tower `east` metres east of the route, level with `s` metres along it */
function towerAt(type: TowerTypeId, s: number, east: number): Tower {
  return new Tower({ lat: s / M, lon: east / M, height: ORIGIN_HEIGHT }, type);
}

/** The route grid: every cell seen by `towers`, ground at GROUND_Y */
function gridFor(towers: Tower[]): BodyAimGrid {
  const cell = { towerVisibility: new Map(towers.map((t) => [t.id, true])) } as unknown as RouteCell;
  return { getCellAt: () => cell, getGroundLocalYAt: () => GROUND_Y, getGeneration: () => 1 };
}

const point = (): BodyAimPoint => ({ lat: 0, lon: 0, height: 0, x: 0, y: 0, z: 0 });

describe('Towers against the ooze body (playtest 359, 360, 424)', () => {
  let spawnFloatingText: ReturnType<typeof vi.fn>;
  let status: StatusEffectService;

  beforeEach(() => {
    Object.keys(mockInjections).forEach((k) => delete mockInjections[k]);
    spawnFloatingText = vi.fn();
    status = new StatusEffectService();
    status.setGameClockProvider(() => 5_000);
  });

  /** CombatEffectService on `grid`, damage applied as 12 */
  function combatEffects(grid: BodyAimGrid): CombatEffectService {
    mockInjections['GlobalRouteGridService'] = { ...grid, getEnemiesInRadiusGeo: () => [] };
    mockInjections['StatusEffectService'] = status;
    mockInjections['CombatVfxService'] = { emitIceExplosion: vi.fn(), emitIceDecal: vi.fn() };
    mockInjections['DamageApplicationService'] = { applyDamage: vi.fn(() => ({ finalDamage: 12, effectiveness: 'normal' })) };
    const service = new CombatEffectService();
    (service as unknown as { tilesEngine: unknown }).tilesEngine = { sync: flatSync, effects: { spawnFloatingText } };
    return service;
  }

  /** A shot of `type` from `tower` lands at its aim point `at` on `ooze`. */
  function shoot(service: CombatEffectService, type: ProjectileTypeId, tower: Tower, ooze: Enemy, at: BodyAimPoint): void {
    const aimPoint = { lat: at.lat, lon: at.lon, height: at.height + ROUTE_BODY_AIM_HEIGHT_M };
    const projectile = {
      typeConfig: PROJECTILE_TYPES[type],
      damage: 20,
      sourceTowerId: tower.id,
      sourceTowerType: tower.typeConfig.id,
      targetLost: false,
      position: aimPoint,
      flightHeight: aimPoint.height,
      aimPoint,
    };
    (service as unknown as { handleProjectileHit: (p: unknown, e: Enemy, d: string) => void })
      .handleProjectileHit(projectile, ooze, 'physical');
  }

  it('359: towers along the body aim at the body point level with them, also 160 m behind the tip; the number goes up there', () => {
    const behind = towerAt('archer', 40, 15);
    const middle = towerAt('archer', 120, 15);
    const grid = gridFor([behind, middle]);
    const aim = new BodyAim(grid);
    const ooze = oozeBetween(20, 200);
    const out = point();

    for (const [tower, s] of [[middle, 120], [behind, 40]] as const) {
      tower.combat.range = 30;
      aim.beginTower(tower, 15, stations.z[s / 2]);
      expect(aim.aim(ooze, out)).toBe(true);
      expect(out.z).toBeCloseTo(stations.z[s / 2], 9);
      expect(out.x).toBeCloseTo(LATERAL, 6);
    }

    // The arrow of the tower 160 m behind the tip lands where it aimed
    shoot(combatEffects(grid), 'arrow', behind, ooze, out);
    expect(spawnFloatingText).toHaveBeenCalledTimes(1);
    const [, lat, lon] = spawnFloatingText.mock.calls[0];
    expect([lat, lon]).toEqual([out.lat, out.lon]);
    expect(lat).toBeCloseTo(stations.lat[20], 12);
    expect(lon * M).toBeCloseTo(LATERAL, 6);
  });

  it('360: an ice shard on the body 150 m behind the tip slows the one ooze, its tip with it', () => {
    const ice = towerAt('ice', 50, 15);
    const grid = gridFor([ice]);
    const aim = new BodyAim(grid);
    const ooze = oozeBetween(20, 200);
    const out = point();
    ice.combat.range = 30;
    aim.beginTower(ice, 15, stations.z[25]);
    expect(aim.aim(ooze, out)).toBe(true);
    expect(ooze.movement.isSlowed(5_000)).toBe(false);

    shoot(combatEffects(grid), 'ice-shard', ice, ooze, out);

    // One movement for the whole body: OozeBodies grows and flows it at this pace
    expect(ooze.movement.isSlowed(5_000)).toBe(true);
    expect(ooze.movement.getSlowMultiplier(5_000)).toBeLessThan(1);
  });

  it('424: a poison tick shows its number on the body where the tail has got to, not on the road behind it', () => {
    const ooze = oozeBetween(20, 200);
    const service = combatEffects(gridFor([]));
    // The last glob landed 30 m along the route; the tail has passed that point since
    ooze.body!.setHit(15, 0, GROUND_Y);
    ooze.body!.tailM = 60;

    (service as unknown as { handleDotDamage: (e: Enemy, d: number, t: string, f: string, s: string) => void })
      .handleDotDamage(ooze, 7, 'poison', 'poison', 't-1');

    expect(spawnFloatingText).toHaveBeenCalledTimes(1);
    const [, lat, , height, options] = spawnFloatingText.mock.calls[0];
    // Station 30, 60 m along the route: the tail, the body point nearest the old hit
    expect(lat).toBeCloseTo(stations.lat[30], 12);
    expect(height).toBe(ORIGIN_HEIGHT + GROUND_Y + 5);
    expect(options.color).toBe('#44CC22');
  });

  it('424: the flame on a zombie crosses the ooze beside it: the ooze is in the cone, hit where the flame crosses it', () => {
    const fire = towerAt('fire', 100, 10);
    mockInjections['GlobalRouteGridService'] = gridFor([fire]);
    const service = new TowerCombatService();
    service.initialize({ sync: flatSync } as never, NO_RESEARCH);
    const combat = service as unknown as {
      bodyAim: BodyAim;
      getEnemiesInCone: (source: Vector3, target: Vector3, length: number, width: number, candidates: Enemy[]) => Enemy[];
    };
    const ooze = oozeBetween(105, 200);
    combat.bodyAim.beginTower(fire, 10, -100);

    // The tower's aim point on the ooze is its tail, nearest to the tower
    const aimed = point();
    expect(combat.bodyAim.aim(ooze, aimed)).toBe(true);
    expect(-aimed.z).toBeLessThan(107);

    // The flame points at a zombie on the route 15 m further on, 18 m away
    const apex = new Vector3(10, GROUND_Y + ROUTE_BODY_AIM_HEIGHT_M, -100);
    const zombie = new Vector3(0, GROUND_Y + ROUTE_BODY_AIM_HEIGHT_M, -115);
    expect(apex.distanceTo(zombie)).toBeLessThan(fire.combat.range);
    const inCone = combat.getEnemiesInCone(apex, zombie, fire.combat.range, fire.typeConfig.beamWidth ?? 8, [ooze]);

    expect(inCone).toEqual([ooze]);
    // Its hit moved off the aim point to where the flame crosses the body
    const s = ooze.body!.hit.lat * M;
    expect(s).toBeGreaterThan(107);
    expect(s).toBeLessThanOrEqual(118);
  });
});
