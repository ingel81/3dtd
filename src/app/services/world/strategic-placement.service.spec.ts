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
 * checker and drops every position it rejects. The best candidates also
 * need a footprint to stand on (placementAt), probed only until one does.
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
  let placementAt: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    injectionRegistry['OsmStreetService'] = {
      haversineDistance,
      // The path is the street: every lookup lands on its one segment.
      findNearestStreetPoint: () => ({ street: { nodes: path }, nodeIndex: 0, distance: 20 }),
    };
    injectionRegistry['GlobalRouteGridService'] = { onCellsChanged: () => () => undefined };
    injectionRegistry['TowerLosRegistry'] = { canProbeSight: () => false };
    injectionRegistry['ResearchStore'] = { airTargetingUnlocked: () => false };
    // Stand-in rule: only the east side of the street is buildable.
    check = vi.fn<(lat: number, lon: number) => TowerPlacementResult>(
      (_lat, lon) => ({ valid: lon > hq.lon }),
    );
    placementChecker = vi.fn(() => check);
    placementAt = vi.fn(() => ({ footprint: { footY: 0, plinthHeight: 0 }, result: { valid: true } }));
    injectionRegistry['TowerPlacementService'] = { placementChecker, placementAt };

    service = new StrategicPlacementService();
    service.initialize({} as never);
  });

  it('findStrategicPositions keeps only positions the rules accept', () => {
    const candidates = service.findStrategicPositions(spawnPoints, paths, 'archer');

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.position.lon > hq.lon)).toBe(true);
    // Both sides were offered, half of them rejected.
    expect(check.mock.calls.length).toBe(2 * candidates.length);
    expect(placementChecker).toHaveBeenCalledTimes(1);
  });

  it('findDistributedPositions keeps only positions the rules accept', () => {
    const candidates = service.findDistributedPositions(spawnPoints, paths, 'archer');

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.position.lon > hq.lon)).toBe(true);
    expect(placementChecker).toHaveBeenCalledTimes(1);
  });

  it('returns no candidates when the rules reject everything', () => {
    check.mockReturnValue({ valid: false, reason: 'No streets loaded' });
    expect(service.findStrategicPositions(spawnPoints, paths, 'archer')).toEqual([]);
    expect(service.findDistributedPositions(spawnPoints, paths, 'archer')).toEqual([]);
  });

  it('probes the footprint of the best candidate only, where it stands (C10)', () => {
    const candidates = service.findStrategicPositions(spawnPoints, paths, 'cannon');

    expect(placementAt).toHaveBeenCalledTimes(1);
    expect(placementAt).toHaveBeenCalledWith(candidates[0].position.lat, candidates[0].position.lon, 'cannon');
  });

  it('leaves out the best candidates whose footprint stands in a wall or over a drop, up to the first that stands', () => {
    const refused = { footprint: { footY: 0, plinthHeight: 0, refusal: 'wall' }, result: { valid: false, reason: 'Not enough room' } };
    for (const find of [
      () => service.findStrategicPositions(spawnPoints, paths, 'archer'),
      () => service.findDistributedPositions(spawnPoints, paths, 'archer'),
    ]) {
      placementAt.mockClear();
      const all = find();
      placementAt.mockReturnValueOnce(refused).mockReturnValueOnce(null);

      expect(find()).toEqual(all.slice(2));
      expect(placementAt).toHaveBeenCalledTimes(1 + 3);
    }
  });

  it('returns no candidates when no footprint stands', () => {
    placementAt.mockReturnValue({ footprint: { footY: 0, plinthHeight: 0, refusal: 'edge' }, result: { valid: false } });
    expect(service.findStrategicPositions(spawnPoints, paths, 'archer')).toEqual([]);
    expect(service.findDistributedPositions(spawnPoints, paths, 'archer')).toEqual([]);
  });

  /**
   * With the engine up the bot looks at a few standing spots the way a player
   * looks at the build preview (B2, docs/BOT_PLAYER_PLAN.md): a spot behind a
   * facade drops behind one that sees the route.
   */
  describe('with a line of sight to probe', () => {
    let probeSight: ReturnType<typeof vi.fn>;
    /** Sight per probe call, in candidate order; what is not listed sees everything */
    let sights: { reach: number; ground: number; air: number }[];

    beforeEach(() => {
      sights = [];
      let call = 0;
      probeSight = vi.fn(() => sights[call++] ?? { reach: 10, ground: 10, air: 10 });
      injectionRegistry['TowerLosRegistry'] = { canProbeSight: () => true, probeSight };
      service = new StrategicPlacementService();
      service.initialize({} as never);
    });

    it('probes the best four standing spots, from the foot the placement gives them', () => {
      placementAt.mockReturnValue({ footprint: { footY: 7, plinthHeight: 0 }, result: { valid: true } });
      service.findStrategicPositions(spawnPoints, paths, 'archer');

      expect(placementAt).toHaveBeenCalledTimes(4);
      expect(probeSight).toHaveBeenCalledTimes(4);
      expect(probeSight.mock.calls[0][0]).toEqual(expect.objectContaining({ height: 7 }));
      expect(probeSight.mock.calls[0][1]).toBe('archer');
    });

    it('puts a spot that sees the route ahead of a better scored one behind a wall', () => {
      injectionRegistry['TowerLosRegistry'] = { canProbeSight: () => false };
      const blind = new StrategicPlacementService();
      blind.initialize({} as never);
      const byScore = blind.findStrategicPositions(spawnPoints, paths, 'archer');

      // The best spot sees nothing, the second sees all
      sights = [{ reach: 10, ground: 0, air: 0 }, { reach: 10, ground: 10, air: 10 }];
      const bySight = service.findStrategicPositions(spawnPoints, paths, 'archer');

      expect(bySight[0].position).toEqual(byScore[1].position);
      expect(bySight[0].reason).toContain('sees 100%');
      expect(bySight).toHaveLength(byScore.length);
    });

    it('asks a spot once: towers do not block the cube, so a second search reads the cache', () => {
      service.findStrategicPositions(spawnPoints, paths, 'archer');
      service.findStrategicPositions(spawnPoints, paths, 'archer');
      expect(probeSight).toHaveBeenCalledTimes(4);
    });

    it('does not probe a building without range', () => {
      service.findStrategicPositions(spawnPoints, paths, 'research-center');
      expect(probeSight).not.toHaveBeenCalled();
      expect(placementAt).toHaveBeenCalledTimes(1);
    });

    it('keeps the order by score when a probe cannot answer', () => {
      injectionRegistry['TowerLosRegistry'] = { canProbeSight: () => false };
      const blind = new StrategicPlacementService();
      blind.initialize({} as never);
      const byScore = blind.findStrategicPositions(spawnPoints, paths, 'archer');

      probeSight.mockReturnValue(null);
      expect(service.findStrategicPositions(spawnPoints, paths, 'archer')).toEqual(byScore);
    });
  });
});
