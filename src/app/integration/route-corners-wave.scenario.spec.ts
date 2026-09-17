/**
 * Scenario: the enemies of a wave walk the very route arrays whose corner
 * arcs CorridorBuild sized before the freeze (sizeRouteCorners), so no arc
 * is sized while a wave runs: not for the enemies out of the portal, not
 * for the minions a kill splits off, not for the segments of a worm. Arcs
 * are kept per array (getRouteProfile), so any other array would size its
 * own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('three', async () => {
  const mod = await import('@/test/mocks/three.mock');
  return { ...mod };
});

import { createTestManagers, makeSingleTypeWaveConfig, TEST_SPAWN_POINTS, TestManagers, tickEngine } from './test-helpers';
import { METERS_PER_DEGREE_LAT } from '../utils/geo-utils';
import { getRouteProfile, sizeRouteCorners } from '../utils/route-corridor';
import type { RouteWaypoint } from '../models/game.types';
import type { RouteCorners } from '../utils/route-corners';

describe('The enemies of a wave walk the routes whose corner arcs were sized at the freeze', () => {
  const { lat, lon } = TEST_SPAWN_POINTS[0];
  const cos = Math.cos((lat * Math.PI) / 180);
  /** North and east in turns, 15 m each, from the spawn: eight right angles. */
  const route: RouteWaypoint[] = Array.from({ length: 10 }, (_, i) => ({
    lat: lat + (15 * Math.ceil(i / 2)) / METERS_PER_DEGREE_LAT,
    lon: lon + (15 * Math.floor(i / 2)) / (METERS_PER_DEGREE_LAT * cos),
    height: 300,
    corridorLeft: 4,
    corridorRight: 4,
  }));

  let m: TestManagers;
  let sized: RouteCorners;

  beforeEach(() => {
    m = createTestManagers();
    const paths = new Map([[TEST_SPAWN_POINTS[0].id, route]]);
    m.waveManager.initialize(TEST_SPAWN_POINTS, paths);
    // As CorridorBuild does in step 6, slice by slice
    for (const path of paths.values()) while (!sizeRouteCorners(path, 32));
    sized = getRouteProfile(route).corners;
    expect(sized.radius.length).toBe(8);
  });

  afterEach(() => {
    m.enemyManager.clear();
  });

  /** Every enemy on the route walks that array, and its arcs are the ones sized before. */
  const expectSizedRoutes = () => {
    const enemies = m.enemyManager.getAll();
    expect(enemies.length).toBeGreaterThan(0);
    for (const enemy of enemies) expect(enemy.movement.path).toBe(route);
    expect(getRouteProfile(route).corners).toBe(sized);
  };

  it('for enemies out of the portal and the minions a kill splits off', () => {
    m.waveManager.startWave(makeSingleTypeWaveConfig({ count: 3, type: 'skeleton', spawnDelay: 0 }));
    const clock = tickEngine(m, 2000);
    const skeletons = m.enemyManager.getAll().filter((enemy) => enemy.typeConfig.id === 'skeleton');
    expect(skeletons).toHaveLength(3);
    for (const skeleton of skeletons) m.enemyManager.kill(skeleton);
    expect(m.enemyManager.getAll().filter((enemy) => enemy.typeConfig.id === 'skeleton-minion')).toHaveLength(6);
    tickEngine(m, 2000, clock);
    expectSizedRoutes();
  });

  it('for the segments of a worm', () => {
    m.waveManager.startWave(makeSingleTypeWaveConfig({ count: 1, type: 'worm', spawnDelay: 0 }));
    tickEngine(m, 2000);
    expect(m.enemyManager.getAll().length).toBeGreaterThan(1);
    expectSizedRoutes();
  });
});
