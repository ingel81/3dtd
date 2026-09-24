/**
 * Playtest 361 (night 2, docs/archive/REVIEW_SPRINT_2026-09-14.md) replayed: Custom
 * Wave Ooze, Cheat Abilities, K on a stretch of body far behind the tip: the
 * boss bar drops by 20 %.
 *
 * Set up as ability-ooze.spec.ts does for frost bomb, EMP and laser: the real
 * AbilityManager asks the real GlobalRouteGrid, which counts the ooze once as
 * soon as the strike's circle touches its body (utils/route-body.ts); the
 * damage is the share of max HP as DamageApplicationService.applyMaxHpFraction
 * takes it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Injectable decorator a no-op, as in ability-ooze.spec.ts
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return { ...actual, Injectable: () => (target: unknown) => target };
});

import { Vector3 } from 'three';
import { AbilityManager, type AbilityWorld } from '../managers/ability.manager';
import { GameEventBus, type GameEvent } from '../game-engine/game-event-bus';
import { GlobalRouteGrid } from '../utils/global-route-grid';
import { RouteBody, RouteBodyStations } from '../utils/route-body';
import { METERS_PER_DEGREE_LAT } from '../utils/geo-utils';
import { Enemy } from '../entities/enemy.entity';
import { ABILITIES } from '../configs/abilities.config';
import type { GeoPosition, RouteWaypoint } from '../models/game.types';

/** GameClock.FIXED_STEP_MS */
const STEP_MS = 16.667;
/** 6500 ms of warning in sub-steps */
const WARNING_STEPS = 390;
const NUKE = ABILITIES['nuclear-strike'];

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

describe('Nuclear strike on the ooze body, playtest 361 replayed', () => {
  let bus: GameEventBus;
  let manager: AbilityManager;
  let ooze: Enemy;
  let resolved: Extract<GameEvent, { type: 'ability:resolved' }>[];

  beforeEach(() => {
    bus = new GameEventBus();
    resolved = [];
    bus.on('ability:resolved', (event) => resolved.push(event));

    const grid = new GlobalRouteGrid();
    grid.initialize((() => null) as never, flatSync as never);
    ooze = new Enemy('ooze', ROUTE, undefined, 0, TIP_M / 200);
    ooze.transform.terrainHeight = 200;
    const body = new RouteBody(new RouteBodyStations(ROUTE, flatSync, 0));
    body.tailM = TAIL_M;
    body.tipM = TIP_M;
    ooze.body = body;
    grid.addBodyEnemy(ooze);

    const world: AbilityWorld = {
      snapToRoute: (target) => ({ ...target }),
      enemiesInRadius: (center, radiusM, out) => grid.getEnemiesInRadiusGeo(center, radiusM, undefined, out),
      strike: (targets, fractionOf) => {
        let kills = 0;
        for (const enemy of targets) {
          if (enemy.health.takeDamage(enemy.health.maxHp * fractionOf(enemy))) kills++;
        }
        return kills;
      },
      showDamage: () => undefined,
      halt: () => undefined,
      routeSweep: () => null,
      // A missile silo stands: the nuclear strike has its launch site
      launchSite: () => ({ towerId: 'silo', position: { lat: 0, lon: 0, height: 0 } }),
    };
    manager = new AbilityManager(bus, world);
    manager.setPhaseProvider(() => 'wave');
    bus.emit({
      type: 'research:completed', playerId: 'local', local: true,
      researchId: NUKE.researchId,
      effects: [{ kind: 'global-perk', perkId: NUKE.perkId, description: '' }],
    });
  });

  const tick = (steps: number) => {
    for (let i = 0; i < steps; i++) manager.update(STEP_MS);
  };

  it('K 50 m behind the tip, well inside the body: one hit, the one HP pool down by 20 %', () => {
    // The 25 m circle spans 75 to 125 m: body all over, the tip 25 m beyond it
    expect(manager.use('nuclear-strike', along(TIP_M - 50)).ok).toBe(true);
    tick(WARNING_STEPS);
    expect(resolved).toEqual([expect.objectContaining({ abilityId: 'nuclear-strike', hits: 1, kills: 0 })]);
    expect(ooze.health.hp / ooze.health.maxHp).toBeCloseTo(0.8, 9);
  });

  it('counter-check: K 30 m short of the tail misses the ooze', () => {
    manager.use('nuclear-strike', along(TAIL_M - 30));
    tick(WARNING_STEPS);
    expect(resolved).toEqual([expect.objectContaining({ abilityId: 'nuclear-strike', hits: 0 })]);
    expect(ooze.health.hp).toBe(ooze.health.maxHp);
  });
});
