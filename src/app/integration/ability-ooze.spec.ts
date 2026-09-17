/**
 * Integration Test: frost bomb, EMP and orbital laser against the ooze,
 * whose body lies along the route (utils/route-body.ts).
 *
 * The real AbilityManager asks the real GlobalRouteGrid for its targets and
 * sweeps the real route for the laser; the status effects are the real
 * ones. The ooze has to be hit wherever the circle (or the beam's circle)
 * touches its body, not only at its tip, and the laser's boss cap of 20 %
 * has to hold while the beam runs along a long stretch of body.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Injectable decorator a no-op: StatusEffectService has no inject() of its own
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return { ...actual, Injectable: () => (target: unknown) => target };
});

import { Vector3 } from 'three';
import { AbilityManager, type AbilityWorld } from '../managers/ability.manager';
import { GameEventBus, type GameEvent } from '../game-engine/game-event-bus';
import { GlobalRouteGrid } from '../utils/global-route-grid';
import { RouteBody, RouteBodyStations } from '../utils/route-body';
import { routeSweepToward } from '../utils/route-sweep';
import { METERS_PER_DEGREE_LAT } from '../utils/geo-utils';
import { StatusEffectService } from '../services/combat/status-effect.service';
import { Enemy } from '../entities/enemy.entity';
import { ABILITIES, type AbilityId } from '../configs/abilities.config';
import type { GeoPosition, RouteWaypoint } from '../models/game.types';

/** GameClock.FIXED_STEP_MS */
const STEP_MS = 16.667;

// At the equator a degree of longitude is as long as one of latitude
const flatSync = {
  geoToLocalSimple: (lat: number, lon: number, height: number) =>
    new Vector3(lon * METERS_PER_DEGREE_LAT, height, -lat * METERS_PER_DEGREE_LAT),
  geoToLocalSimpleInto: (lat: number, lon: number, height: number, target: Vector3): Vector3 =>
    target.set(lon * METERS_PER_DEGREE_LAT, height, -lat * METERS_PER_DEGREE_LAT),
};

/** 200 m straight north, 3 m of corridor to each side */
const ROUTE: RouteWaypoint[] = [
  { lat: 0, lon: 0, corridorLeft: 3, corridorRight: 3 },
  { lat: 200 / METERS_PER_DEGREE_LAT, lon: 0, corridorLeft: 3, corridorRight: 3 },
];
/** A point `metres` along the route */
const along = (metres: number): GeoPosition => ({ lat: metres / METERS_PER_DEGREE_LAT, lon: 0, height: 200 });

/** The ooze's body: 80 m from its tail to its tip (OozeConfig.maxLengthM) */
const TAIL_M = 70;
const TIP_M = 150;

describe('Frost bomb, EMP and orbital laser against the ooze body', () => {
  let bus: GameEventBus;
  let manager: AbilityManager;
  let ooze: Enemy;
  let clock: number;
  let resolved: Extract<GameEvent, { type: 'ability:resolved' }>[];

  beforeEach(() => {
    bus = new GameEventBus();
    clock = 0;
    resolved = [];
    bus.on('ability:resolved', (event) => resolved.push(event));

    const grid = new GlobalRouteGrid();
    grid.initialize((() => null) as never, flatSync as never);
    // The ooze stands with its tip at 150 m, as EnemyManager and OozeBodies put it
    ooze = new Enemy('ooze', ROUTE, undefined, 0, TIP_M / 200);
    ooze.transform.terrainHeight = 200;
    const body = new RouteBody(new RouteBodyStations(ROUTE, flatSync, 0));
    body.tailM = TAIL_M;
    body.tipM = TIP_M;
    ooze.body = body;
    grid.addBodyEnemy(ooze);

    const status = new StatusEffectService();
    status.setGameClockProvider(() => clock);
    const world: AbilityWorld = {
      launchSite: () => null,
      snapToRoute: (target) => ({ ...target }),
      enemiesInRadius: (center, radiusM, out) => grid.getEnemiesInRadiusGeo(center, radiusM, undefined, out),
      // The share of max HP, as DamageApplicationService.applyMaxHpFraction takes it
      strike: (targets, fractionOf) => {
        let kills = 0;
        for (const enemy of targets) {
          if (enemy.health.takeDamage(enemy.health.maxHp * fractionOf(enemy))) kills++;
        }
        return kills;
      },
      showDamage: () => undefined,
      // As CombatEffectService.applyAbilityHalt applies them
      halt: (targets, kind, durationMsOf, sourceId) => {
        for (const enemy of targets) {
          if (kind === 'freeze') status.applyFreeze(enemy, durationMsOf(enemy), sourceId);
          else status.applyStun(enemy, durationMsOf(enemy), sourceId);
        }
      },
      routeSweep: (target, maxDistanceM, lengthM) => routeSweepToward([ROUTE], target, maxDistanceM, lengthM),
    };
    manager = new AbilityManager(bus, world);
    manager.setPhaseProvider(() => 'wave');
    for (const id of ['frost-bomb', 'emp', 'orbital-laser'] as AbilityId[]) {
      bus.emit({
        type: 'research:completed',
        researchId: ABILITIES[id].researchId,
        effects: [{ kind: 'global-perk', perkId: ABILITIES[id].perkId, description: '' }],
      });
    }
  });

  /** `steps` sub-steps of game time */
  const tick = (steps: number) => {
    for (let i = 0; i < steps; i++) {
      clock += STEP_MS;
      manager.update(STEP_MS);
    }
  };

  it('freezes the whole ooze when the frost bomb reaches its tail, 95 m behind the tip', () => {
    // 15 m short of the tail: the 20 m circle reaches 5 m into the body
    expect(manager.use('frost-bomb', along(TAIL_M - 15)).ok).toBe(true);
    tick(30);
    expect(resolved).toEqual([expect.objectContaining({ abilityId: 'frost-bomb', hits: 1, kills: 0 })]);
    expect(ooze.movement.isFrozen(clock)).toBe(true);
    // A boss: frozen for 1 s
    tick(59);
    expect(ooze.movement.isFrozen(clock)).toBe(true);
    tick(2);
    expect(ooze.movement.isFrozen(clock)).toBe(false);
  });

  it('leaves the ooze alone when the frost bomb falls short of its body', () => {
    manager.use('frost-bomb', along(TAIL_M - 25));
    tick(30);
    expect(resolved).toEqual([expect.objectContaining({ abilityId: 'frost-bomb', hits: 0 })]);
    expect(ooze.movement.statusEffects).toEqual([]);
  });

  it('stuns the ooze when the EMP reaches its body, for a boss 0.75 s', () => {
    // 25 m short of the tail: the 30 m circle reaches 5 m in
    manager.use('emp', along(TAIL_M - 25));
    tick(30);
    expect(resolved).toEqual([expect.objectContaining({ abilityId: 'emp', hits: 1 })]);
    expect(ooze.movement.isStunned(clock)).toBe(true);
    expect(ooze.movement.isHalted(clock)).toBe(true);
    tick(44);
    expect(ooze.movement.isStunned(clock)).toBe(true);
    tick(2);
    expect(ooze.movement.isStunned(clock)).toBe(false);
  });

  it('burns the ooze where the beam runs over its body, off the tip, and stops at the boss cap of 20 %', () => {
    // From 100 m toward the spawn: the beam crosses 35 m of body (100 m down
    // to the tail at 70 m and 5 m of radius), about 1.9 s under it, far more
    // than the 0.44 s the cap takes at 0.3 x 1.5 of max HP per second
    manager.use('orbital-laser', along(100));
    tick(60 + 240);
    expect(resolved).toEqual([expect.objectContaining({ abilityId: 'orbital-laser', hits: 1, kills: 0 })]);
    expect(ooze.health.hp / ooze.health.maxHp).toBeCloseTo(0.8, 9);
  });

  it('holds the cap while the beam burns along the body for its whole 4 s', () => {
    // From the tip toward the spawn: all 72 m on the body
    manager.use('orbital-laser', along(TIP_M));
    tick(60 + 240);
    expect(resolved).toEqual([expect.objectContaining({ abilityId: 'orbital-laser', hits: 1, kills: 0 })]);
    expect(ooze.health.hp / ooze.health.maxHp).toBeCloseTo(0.8, 9);
  });

  it('misses the ooze when the beam runs from in front of its tail toward the spawn', () => {
    // 10 m short of the tail and away from it: the 5 m circle never touches the body
    manager.use('orbital-laser', along(TAIL_M - 10));
    tick(60 + 240);
    expect(resolved).toEqual([expect.objectContaining({ abilityId: 'orbital-laser', hits: 0 })]);
    expect(ooze.health.hp).toBe(ooze.health.maxHp);
  });
});
