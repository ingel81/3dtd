import { describe, it, expect } from 'vitest';
import { PLACEMENT_CONFIG } from '../configs/placement.config';
import { findNearestRouteDistance, haversineDistance } from './geo-utils';
import { checkTowerPlacement, TowerPlacementContext } from './tower-placement-rules';

// A simple route: south-north along lon=11.575
const ROUTE: { lat: number; lon: number }[] = [
  { lat: 48.136, lon: 11.575 },
  { lat: 48.1365, lon: 11.575 },
  { lat: 48.137, lon: 11.575 },
  { lat: 48.1375, lon: 11.575 },
  { lat: 48.138, lon: 11.575 },
];

const HQ = { lat: 48.149, lon: 11.589 };
const SPAWN = { lat: 48.141, lon: 11.57 };
const TOWER = { lat: 48.142, lon: 11.57 };

/** Wide bounds, HQ far away, no spawns, towers or routes: everything inside is valid. */
function context(overrides: Partial<TowerPlacementContext> = {}): TowerPlacementContext {
  return {
    bounds: { minLat: 48.13, maxLat: 48.15, minLon: 11.56, maxLon: 11.59 },
    base: HQ,
    spawns: [],
    towers: [],
    routes: [],
    geo: { haversineDistance },
    ...overrides,
  };
}

/** Distance per target, keyed by the target's latitude; 1 km for anything not listed. */
function distancesByLat(byLat: Record<number, number>): TowerPlacementContext['geo'] {
  return { haversineDistance: (_lat1, _lon1, lat2) => byLat[lat2] ?? 1000 };
}

/** HQ, one spawn and one tower at the given distances from the candidate. */
function atDistances(base: number, spawn: number, tower: number): TowerPlacementContext {
  return context({
    spawns: [SPAWN],
    towers: [{ position: TOWER }],
    geo: distancesByLat({ [HQ.lat]: base, [SPAWN.lat]: spawn, [TOWER.lat]: tower }),
  });
}

const { MIN_DISTANCE_TO_BASE, MIN_DISTANCE_TO_SPAWN, MIN_DISTANCE_TO_OTHER_TOWER } = PLACEMENT_CONFIG;

describe('checkTowerPlacement', () => {
  describe('rules and reasons', () => {
    it('open position inside the play area is valid', () => {
      expect(checkTowerPlacement(48.14, 11.57, context())).toEqual({ valid: true });
    });

    it('outside the bounds', () => {
      expect(checkTowerPlacement(48.16, 11.57, context())).toEqual({
        valid: false, reason: 'Outside play area',
      });
    });

    it('too close to the HQ (real distance, ~7 m)', () => {
      const result = checkTowerPlacement(48.14, 11.57, context({ base: { lat: 48.14, lon: 11.5701 } }));
      expect(result).toEqual({ valid: false, reason: 'Too close to HQ' });
    });

    it('too close to a spawn (real distance, ~33 m)', () => {
      const result = checkTowerPlacement(48.14, 11.57, context({ spawns: [{ lat: 48.1403, lon: 11.57 }] }));
      expect(result).toEqual({ valid: false, reason: 'Too close to spawn' });
    });

    it('too close to another tower (real distance, ~4 m)', () => {
      const result = checkTowerPlacement(48.14, 11.57, context({
        towers: [{ position: { lat: 48.14, lon: 11.57005 } }],
      }));
      expect(result).toEqual({ valid: false, reason: 'Too close to another tower' });
    });
  });

  describe('order of checks', () => {
    it('bounds win over every distance rule', () => {
      const result = checkTowerPlacement(48.16, 11.57, { ...atDistances(0, 0, 0), routes: [ROUTE] });
      expect(result.reason).toBe('Outside play area');
    });

    it('HQ before spawns, towers and routes', () => {
      const result = checkTowerPlacement(48.137, 11.575, { ...atDistances(0, 0, 0), routes: [ROUTE] });
      expect(result.reason).toBe('Too close to HQ');
    });

    it('spawns before towers', () => {
      const result = checkTowerPlacement(48.137, 11.575, { ...atDistances(1000, 0, 0), routes: [ROUTE] });
      expect(result.reason).toBe('Too close to spawn');
    });

    it('towers before routes', () => {
      const result = checkTowerPlacement(48.137, 11.575, { ...atDistances(1000, 1000, 0), routes: [ROUTE] });
      expect(result.reason).toBe('Too close to another tower');
    });
  });

  describe('thresholds are strict', () => {
    it('a distance equal to each minimum is still valid', () => {
      const ctx = atDistances(MIN_DISTANCE_TO_BASE, MIN_DISTANCE_TO_SPAWN, MIN_DISTANCE_TO_OTHER_TOWER);
      expect(checkTowerPlacement(48.14, 11.57, ctx)).toEqual({ valid: true });
    });

    it('just under each minimum is invalid', () => {
      const under = (m: number) => m - 0.01;
      expect(checkTowerPlacement(48.14, 11.57,
        atDistances(under(MIN_DISTANCE_TO_BASE), 1000, 1000)).reason).toBe('Too close to HQ');
      expect(checkTowerPlacement(48.14, 11.57,
        atDistances(1000, under(MIN_DISTANCE_TO_SPAWN), 1000)).reason).toBe('Too close to spawn');
      expect(checkTowerPlacement(48.14, 11.57,
        atDistances(1000, 1000, under(MIN_DISTANCE_TO_OTHER_TOWER))).reason).toBe('Too close to another tower');
    });
  });

  describe('routes', () => {
    it('position directly on route → invalid', () => {
      const result = checkTowerPlacement(48.1365, 11.575, context({ routes: [ROUTE] }));
      expect(result).toEqual({ valid: false, reason: 'Too close to route' });
    });

    it('position 5m from route → invalid (under MIN_DISTANCE_TO_ROUTE)', () => {
      // ~5m east of route: 0.000048 degrees lon at lat 48
      const offsetLon = 11.575 + 0.000048;
      const dist = findNearestRouteDistance([ROUTE], 48.1365, offsetLon);
      expect(dist).toBeLessThan(PLACEMENT_CONFIG.MIN_DISTANCE_TO_ROUTE);

      const result = checkTowerPlacement(48.1365, offsetLon, context({ routes: [ROUTE] }));
      expect(result.valid).toBe(false);
    });

    it('position 15m from route → valid', () => {
      const offsetLon = 11.575 + 0.000200;
      const dist = findNearestRouteDistance([ROUTE], 48.1365, offsetLon);
      expect(dist).toBeGreaterThan(PLACEMENT_CONFIG.MIN_DISTANCE_TO_ROUTE);

      const result = checkTowerPlacement(48.1365, offsetLon, context({ routes: [ROUTE] }));
      expect(result.valid).toBe(true);
    });

    it('position next to a non-route street → valid (street not in routes)', () => {
      // 48.140 - 48.138 = 0.002 degrees ≈ 222m, well above MIN_DISTANCE_TO_ROUTE
      const result = checkTowerPlacement(48.140, 11.575, context({ routes: [ROUTE] }));
      expect(result.valid).toBe(true);
    });

    it('no routes available (before game start) → valid', () => {
      const result = checkTowerPlacement(48.137, 11.575, context());
      expect(result.valid).toBe(true);
    });

    it('position between two routes picks closest', () => {
      const route1 = [
        { lat: 48.136, lon: 11.575 },
        { lat: 48.138, lon: 11.575 },
      ];
      const route2 = [
        { lat: 48.136, lon: 11.576 },
        { lat: 48.138, lon: 11.576 },
      ];

      expect(checkTowerPlacement(48.137, 11.575, context({ routes: [route1, route2] })).valid).toBe(false);
      expect(checkTowerPlacement(48.137, 11.578, context({ routes: [route1, route2] })).valid).toBe(true);
    });
  });
});
