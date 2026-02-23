import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PLACEMENT_CONFIG } from '../configs/placement.config';
import { findNearestRouteDistance, haversineDistance } from '../utils/geo-utils';

/**
 * Tests for route-based tower placement validation.
 *
 * Instead of mocking the full Angular DI tree for TowerPlacementService,
 * we test the core validation logic via findNearestRouteDistance() and
 * verify the placement rules that the service implements.
 */

// Base coords (Munich area)
const BASE = { lat: 48.137, lon: 11.575 };

// A simple route: south-north along lon=11.575
const ROUTE: { lat: number; lon: number }[] = [
  { lat: 48.136, lon: 11.575 },
  { lat: 48.1365, lon: 11.575 },
  { lat: 48.137, lon: 11.575 },
  { lat: 48.1375, lon: 11.575 },
  { lat: 48.138, lon: 11.575 },
];

describe('Route-based tower placement validation', () => {
  /**
   * Simulates the placement validation logic from TowerPlacementService:
   * - If routes exist and distance < MIN_DISTANCE_TO_ROUTE → invalid
   * - If routes exist and distance >= MIN_DISTANCE_TO_ROUTE → valid
   * - If no routes exist → valid (allow placement before game start)
   */
  function validateAgainstRoutes(
    routes: { lat: number; lon: number }[][],
    lat: number,
    lon: number
  ): { valid: boolean; reason?: string } {
    if (routes.length > 0) {
      const routeDistance = findNearestRouteDistance(routes, lat, lon);
      if (routeDistance < PLACEMENT_CONFIG.MIN_DISTANCE_TO_ROUTE) {
        return { valid: false, reason: 'Too close to route' };
      }
    }
    return { valid: true };
  }

  it('position directly on route → invalid', () => {
    // Point exactly on route
    const result = validateAgainstRoutes([ROUTE], 48.1365, 11.575);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('route');
  });

  it('position 5m from route → invalid (under MIN_DISTANCE_TO_ROUTE)', () => {
    // ~5m east of route: 0.000048 degrees lon at lat 48
    const offsetLon = 11.575 + 0.000048;
    const dist = findNearestRouteDistance([ROUTE], 48.1365, offsetLon);
    expect(dist).toBeLessThan(PLACEMENT_CONFIG.MIN_DISTANCE_TO_ROUTE);

    const result = validateAgainstRoutes([ROUTE], 48.1365, offsetLon);
    expect(result.valid).toBe(false);
  });

  it('position 15m from route → valid', () => {
    // ~15m east of route: 0.000145 degrees lon at lat 48
    const offsetLon = 11.575 + 0.000200;
    const dist = findNearestRouteDistance([ROUTE], 48.1365, offsetLon);
    expect(dist).toBeGreaterThan(PLACEMENT_CONFIG.MIN_DISTANCE_TO_ROUTE);

    const result = validateAgainstRoutes([ROUTE], 48.1365, offsetLon);
    expect(result.valid).toBe(true);
  });

  it('position next to a non-route street → valid (street not in routes)', () => {
    // Simulate: there is a street at 48.140 but the only route is at 48.137
    // Position at 48.140 is far from the route → should be valid
    const result = validateAgainstRoutes([ROUTE], 48.140, 11.575);
    // 48.140 - 48.138 = 0.002 degrees ≈ 222m, well above MIN_DISTANCE_TO_ROUTE
    expect(result.valid).toBe(true);
  });

  it('no routes available (before game start) → valid', () => {
    const result = validateAgainstRoutes([], 48.137, 11.575);
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

    // Point very close to route1 (on route1)
    const result = validateAgainstRoutes([route1, route2], 48.137, 11.575);
    expect(result.valid).toBe(false);

    // Point far from both routes
    const result2 = validateAgainstRoutes([route1, route2], 48.137, 11.578);
    expect(result2.valid).toBe(true);
  });
});
