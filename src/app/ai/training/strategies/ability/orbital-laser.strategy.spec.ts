import { describe, it, expect, beforeEach } from 'vitest';
import { OrbitalLaserStrategy } from './orbital-laser.strategy';
import type { GameStateSnapshot } from '../../../core/models/game-state-snapshot';
import type { AbilityRejectReason } from '../../../../configs/abilities.config';
import { ENEMY_TYPES } from '../../../../configs/enemy-types.config';
import { AbilityManager, type AbilityWorld } from '../../../../managers/ability.manager';
import { GameEventBus } from '../../../../game-engine';
import { routeSweepToward } from '../../../../utils/route-sweep';
import { METERS_PER_DEGREE_LAT } from '../../../../utils/geo-utils';
import { getRouteProfile } from '../../../../utils/route-corridor';
import type { GeoPosition } from '../../../../models/game.types';

const ORIGIN = { lat: 48.0, lon: 9.0 };
const M_PER_LON = METERS_PER_DEGREE_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);

/** A point `north` and `east` metres from the origin */
const at = (north: number, east = 0): GeoPosition =>
  ({ lat: ORIGIN.lat + north / METERS_PER_DEGREE_LAT, lon: ORIGIN.lon + east / M_PER_LON });
/** Metres north of the origin */
const northOf = (p: { lat: number }) => (p.lat - ORIGIN.lat) * METERS_PER_DEGREE_LAT;

type Route = GeoPosition[];

/**
 * The point `metres` along `route` (straight segments, flat metres), `off`
 * metres to the right of the direction of travel.
 */
function onRoute(route: Route, metres: number, off: number): GeoPosition {
  let left = metres;
  for (let i = 0; i < route.length - 1; i++) {
    const north = (route[i + 1].lat - route[i].lat) * METERS_PER_DEGREE_LAT;
    const east = (route[i + 1].lon - route[i].lon) * M_PER_LON;
    const length = Math.hypot(north, east);
    if (left <= length || i === route.length - 2) {
      const t = left / length;
      const n = (route[i].lat - ORIGIN.lat) * METERS_PER_DEGREE_LAT + north * t;
      const e = (route[i].lon - ORIGIN.lon) * M_PER_LON + east * t;
      // Right of travel: (north, east) turned clockwise is (-east, north)
      return at(n - (east / length) * off, e + (north / length) * off);
    }
    left -= length;
  }
  return route[0];
}

function routeLength(route: Route): number {
  let length = 0;
  for (let i = 0; i < route.length - 1; i++) {
    length += Math.hypot(
      (route[i + 1].lat - route[i].lat) * METERS_PER_DEGREE_LAT,
      (route[i + 1].lon - route[i].lon) * M_PER_LON,
    );
  }
  return length;
}

/**
 * A zombie (5 m/s, unarmored) `metres` along `route`, `off` metres right of
 * its centre line. Its distance along the path is measured like the game's,
 * on the route profile (haversine), a little shorter than the flat metres.
 */
function zombieOn(route: Route, metres: number, off = 0) {
  const type = ENEMY_TYPES['zombie'];
  const flat = routeLength(route);
  const measured = (metres * getRouteProfile(route).totalLength) / flat;
  return {
    alive: true,
    position: onRoute(route, metres, off),
    typeConfig: type,
    getEffectiveArmorType: () => type.armorType,
    health: { hp: 100, maxHp: 100 },
    movement: {
      path: route,
      getPathProgress: () => metres / flat,
      getDistanceAlongPath: () => measured,
      getEffectiveSpeed: () => type.baseSpeed,
    },
  };
}

/** Straight north, 400 m */
const NORTH = [at(0), at(400)];
/** `count` zombies every `spacing` m from `head` back toward the spawn */
function column(route: Route, head: number, count: number, spacing: number, off = 0) {
  return Array.from({ length: count }, (_, i) => zombieOn(route, head - i * spacing, off));
}

describe('OrbitalLaserStrategy', () => {
  let routes: Route[];
  let enemies: ReturnType<typeof zombieOn>[];
  let useCheck: AbilityRejectReason | null;
  /** Reads of the enemy list: two per aim, the candidates and the enemies under the beam */
  let scans: number;
  let strategy: OrbitalLaserStrategy;
  const inWave = { phase: 'wave' } as GameStateSnapshot;

  /** Metres north the strategy aims at, and the hits its reason names */
  const aimed = () => {
    const action = strategy.execute(inWave)!;
    expect(action).toMatchObject({ type: 'use-ability', abilityId: 'orbital-laser' });
    return { north: northOf({ lat: action.position!.z }), reason: action.reason };
  };

  beforeEach(() => {
    routes = [NORTH];
    enemies = [];
    useCheck = null;
    scans = 0;
    // The real manager for the stretch the beam burns along
    const abilities = new AbilityManager(new GameEventBus(), {
      routeSweep: (target, maxDistanceM, lengthM) => routeSweepToward(routes, target, maxDistanceM, lengthM),
    } as AbilityWorld);
    const gameState = {
      gameTimeMs: 0,
      abilityManager: {
        checkUse: () => useCheck,
        previewSweep: abilities.previewSweep.bind(abilities),
      },
      enemyManager: { getAlive: () => (scans++, enemies) },
    };
    strategy = new OrbitalLaserStrategy(gameState as never);
  });

  it('ranks under the EMP', () => {
    expect(strategy.priority).toBe(93);
  });

  it('waits for a wave and for its charge', () => {
    enemies.push(...column(NORTH, 300, 12, 5));
    expect(strategy.canExecute({ phase: 'setup' } as GameStateSnapshot)).toBe(false);
    useCheck = 'no-charge';
    expect(strategy.canExecute(inWave)).toBe(false);
  });

  it('aims where the head of a column stands when the beam lands and burns back through it', () => {
    enemies.push(...column(NORTH, 300, 12, 5)); // 300 m down to 245 m
    expect(strategy.canExecute(inWave)).toBe(true);
    const { north, reason } = aimed();
    expect(north).toBeCloseTo(305, 0); // 1 s of warning at 5 m/s
    expect(reason).toContain('12 enemies');
  });

  it('keeps the charge while fewer than 10 would burn', () => {
    enemies.push(...column(NORTH, 300, 9, 5));
    expect(strategy.canExecute(inWave)).toBe(false);
  });

  it('counts the enemies that walk into the beam past its 72 m', () => {
    // A: 14 zombies 7 m apart, 91 m long. Head-on at 18 + 5 m/s the beam
    // meets the last one 3.7 s into its 4 s. B: 12 zombies 5 m apart.
    // Counting 72 m behind a leader gives A 11 and B 12.
    enemies.push(...column(NORTH, 380, 14, 7));
    enemies.push(...column(NORTH, 260, 12, 5));
    const { north, reason } = aimed();
    expect(north).toBeCloseTo(385, 0);
    expect(reason).toContain('14 enemies');
  });

  it('leaves out a group walking beside the beam', () => {
    // A: 12 zombies 7 m right of the centre line, out of the 5 m radius; the
    // count along the centre line took them. B: 11 on the centre line.
    enemies.push(...column(NORTH, 300, 12, 5, 7));
    enemies.push(...column(NORTH, 380, 11, 5));
    const { north, reason } = aimed();
    expect(north).toBeCloseTo(385, 0);
    expect(reason).toContain('11 enemies');
  });

  it('counts the enemies of another route on the same street', () => {
    // Route B comes from the east and joins A's street 100 m north of A's
    // spawn. On the street 6 of A and 6 of B walk mixed, 12 under one beam;
    // counting the leader's own route gave them 6. Farther back 11 of A.
    const a = [at(0), at(100), at(800)];
    const b = [at(100, 200), at(100, 0), at(800, 0)]; // B's metres = north + 100
    routes = [a, b];
    for (let i = 0; i < 6; i++) {
      enemies.push(zombieOn(a, 700 - i * 10)); // north 700 down to 650
      enemies.push(zombieOn(b, 795 - i * 10)); // north 695 down to 645
    }
    enemies.push(...column(a, 500, 11, 5));
    const { north, reason } = aimed();
    expect(north).toBeCloseTo(705, 0);
    expect(reason).toContain('12 enemies');
  });

  it('aims once per decision: execute takes the aim canExecute found for the same snapshot', () => {
    enemies.push(...column(NORTH, 300, 12, 5));
    const decision = { phase: 'wave' } as GameStateSnapshot;
    expect(strategy.canExecute(decision)).toBe(true);
    expect(scans).toBe(2);
    expect(strategy.execute(decision)!.reason).toContain('12 enemies');
    expect(scans).toBe(2);

    strategy.execute({ phase: 'wave' } as GameStateSnapshot); // the next decision aims anew
    expect(scans).toBe(4);
  });
});
