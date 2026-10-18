import { describe, it, expect } from 'vitest';
import { buildSimWorld } from './sim-world-builder';
import { worldKeyOf } from '../protocol/world-key';
import type { ThreeTilesEngine } from '../../three-engine';
import type { GlobalRouteGridService } from '../../services/world/global-route-grid.service';
import type { RouteWaypoint } from '../../models/game.types';

const ORIGIN = { lat: 48, lon: 9, height: 300 };
const engine = {
  sync: { getOrigin: () => ORIGIN },
  getTerrainHeightAtGeo: () => 2,
  world: { runRules: () => null },
} as unknown as ThreeTilesEngine;
const grid = { exportHeights: () => [], snapshotHeights: () => [] } as unknown as GlobalRouteGridService;
const route = (lat: number): RouteWaypoint[] => [{ lat, lon: 9 }, { lat: 48, lon: 9 }];

describe('buildSimWorld', () => {
  it('carries only the spawns with a route, in their order, as the lanes (TODO E232)', () => {
    const spawns = [
      { id: 'a', name: 'A', lat: 48.01, lon: 9 },
      { id: 'lost', name: 'Lost', lat: 48.02, lon: 9 },
      { id: 'b', name: 'B', lat: 48.03, lon: 9 },
    ];
    const paths = new Map([['a', route(48.01)], ['b', route(48.03)]]);
    const world = buildSimWorld(engine, grid, { lat: 48, lon: 9 }, spawns, paths)!;
    expect(world.spawns.map((spawn) => spawn.id)).toEqual(['a', 'b']);
    expect(Object.keys(world.spawnGround)).toEqual(['a', 'b']);
    expect(world.spawnGround['a']).toBe(302);
    // The key is the routes' alone: the lost spawn changes nothing of it
    expect(world.worldKey).toBe(worldKeyOf([], paths.values(), ORIGIN));
  });
});
