import { describe, it, expect, vi, beforeEach } from 'vitest';

// Angular DI replaced by a registry: inject() hands out what the test put there.
const injectionRegistry: Record<string, unknown> = {};
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
    inject: (token: { name?: string }) => injectionRegistry[token?.name ?? ''],
  };
});

import { endZoneProximity, StrategicPlacementService } from './strategic-placement.service';
import { haversineDistance } from '../../utils/geo-utils';
import type { TowerPlacementResult } from '../../utils/tower-placement-rules';

/**
 * The placement weight used to be linear in spawn proximity ("build from spawn
 * outward"). Together with an upgrade strategy that also only funded the
 * spawn-nearest towers, that produced a defense with a single killzone at the
 * spawn and nothing behind it. Measured over 1834 waves: in waves that leaked
 * nothing the furthest enemy died at a median of 12% along the path, and once
 * any enemy passed 80% one reached the base in 95% of cases.
 *
 * These assert the shape that replaces it.
 */
describe('endZoneProximity', () => {
  it('scores both ends above the middle', () => {
    const middle = endZoneProximity(0.5);
    expect(endZoneProximity(0)).toBeGreaterThan(middle);
    expect(endZoneProximity(1)).toBeGreaterThan(middle);
  });

  it('keeps the spawn end ahead, so early placements are unchanged', () => {
    expect(endZoneProximity(0)).toBeGreaterThan(endZoneProximity(1));
  });

  it('has its trough where the two branches cross, slightly past centre', () => {
    // 1 - t = W * t  =>  t = 1 / (1 + W) = 0.5555... for W = 0.8.
    // Not at 0.5: the spawn branch stays on top a little longer because it is
    // the steeper of the two.
    const samples = Array.from({ length: 1001 }, (_, i) => i / 1000);
    const trough = samples.reduce((a, b) =>
      endZoneProximity(b) < endZoneProximity(a) ? b : a);
    expect(trough).toBeCloseTo(1 / 1.8, 2);
  });

  it('rises monotonically towards the HQ past the trough', () => {
    // The regression that mattered: under the old linear weight this stretch
    // fell away to zero, so the last part of the path never got a tower.
    for (let t = 0.60; t < 1; t += 0.05) {
      expect(endZoneProximity(t)).toBeGreaterThan(endZoneProximity(t - 0.05));
    }
  });

  it('falls monotonically from the spawn to the trough', () => {
    for (let t = 0.05; t < 0.55; t += 0.05) {
      expect(endZoneProximity(t)).toBeLessThan(endZoneProximity(t - 0.05));
    }
  });

  it('clamps out-of-range input instead of extrapolating', () => {
    expect(endZoneProximity(-1)).toBe(endZoneProximity(0));
    expect(endZoneProximity(2)).toBe(endZoneProximity(1));
  });
});

/**
 * The bots' candidates go through the same placement rules as the player's
 * clicks (TowerPlacementService.placementChecker). The search builds one
 * checker and drops every position it rejects.
 */
describe('StrategicPlacementService candidate filter', () => {
  /** Straight 400 m street from the spawn (north) down to the HQ. */
  const spawn = { lat: 48.0036, lon: 9.0 };
  const hq = { lat: 48.0, lon: 9.0 };
  const path = [{ ...spawn, height: 0 }, { ...hq, height: 0 }];
  const spawnPoints = [{ id: 'sp-1', name: 'North', ...spawn }];
  const paths = new Map([['sp-1', path]]);

  let service: StrategicPlacementService;
  let check: ReturnType<typeof vi.fn<(lat: number, lon: number) => TowerPlacementResult>>;
  let placementChecker: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    injectionRegistry['OsmStreetService'] = {
      haversineDistance,
      // The path is the street: every lookup lands on its one segment.
      findNearestStreetPoint: () => ({ street: { nodes: path }, nodeIndex: 0, distance: 20 }),
    };
    injectionRegistry['GlobalRouteGridService'] = {};
    // Stand-in rule: only the east side of the street is buildable.
    check = vi.fn<(lat: number, lon: number) => TowerPlacementResult>(
      (_lat, lon) => ({ valid: lon > hq.lon }),
    );
    placementChecker = vi.fn(() => check);
    injectionRegistry['TowerPlacementService'] = { placementChecker };

    service = new StrategicPlacementService();
    service.initialize({} as never);
  });

  it('findStrategicPositions keeps only positions the rules accept', () => {
    const candidates = service.findStrategicPositions(spawnPoints, paths, 40);

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.position.lon > hq.lon)).toBe(true);
    // Both sides were offered, half of them rejected.
    expect(check.mock.calls.length).toBe(2 * candidates.length);
    expect(placementChecker).toHaveBeenCalledTimes(1);
  });

  it('findDistributedPositions keeps only positions the rules accept', () => {
    const candidates = service.findDistributedPositions(spawnPoints, paths, 40);

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.position.lon > hq.lon)).toBe(true);
    expect(placementChecker).toHaveBeenCalledTimes(1);
  });

  it('returns no candidates when the rules reject everything', () => {
    check.mockReturnValue({ valid: false, reason: 'No streets loaded' });
    expect(service.findStrategicPositions(spawnPoints, paths, 40)).toEqual([]);
    expect(service.findDistributedPositions(spawnPoints, paths, 40)).toEqual([]);
  });
});
