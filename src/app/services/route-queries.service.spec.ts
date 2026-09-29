import { describe, it, expect, vi } from 'vitest';

vi.mock('./world/path-route.service', () => ({ PathAndRouteService: class PathAndRouteService {} }));
vi.mock('./world/global-route-grid.service', () => ({ GlobalRouteGridService: class GlobalRouteGridService {} }));

import { Injector, runInInjectionContext } from '@angular/core';
import { RouteQueriesService } from './route-queries.service';
import { PathAndRouteService } from './world/path-route.service';
import { GlobalRouteGridService } from './world/global-route-grid.service';
import { HeroManager, type HeroWorld } from '../managers/hero.manager';
import { GameEventBus } from '../game-engine/game-event-bus';
import { routeSweepToward } from '../utils/route-sweep';
import { ABILITIES, abilityBeamReachM } from '../configs/abilities.config';
import { at, line } from '../../test/geo-test-points';
import type { GeoPosition } from '../models/game.types';

/** Two routes joining at (0, 150) and running north to the HQ at (0, 300) */
const ROUTES = new Map([
  ['spawn-south', line([0, 0], [0, 100], [0, 150], [0, 300])],
  ['spawn-west', line([-150, 150], [-50, 150], [0, 150], [0, 300])],
]);

function service(routes: Map<string, GeoPosition[]>, snap: GeoPosition | null = null) {
  const snapToRouteCell = vi.fn(() => snap);
  const injector = Injector.create({
    providers: [
      { provide: PathAndRouteService, useValue: { getCachedPaths: () => routes } },
      { provide: GlobalRouteGridService, useValue: { snapToRouteCell } },
    ],
  });
  return { queries: runInInjectionContext(injector, () => new RouteQueriesService()), snapToRouteCell };
}

describe('RouteQueriesService', () => {
  it('sends the hero where the simulation\'s HeroManager would, and nowhere without a route in reach', () => {
    const { queries } = service(ROUTES);
    const hero = new HeroManager(new GameEventBus(), { routes: () => ROUTES } as unknown as HeroWorld);
    for (const target of [at(10, 120), at(-100, 160), at(3, 290)]) {
      expect(queries.resolveHeroMoveTarget(target)).toEqual(hero.resolveMoveTarget(target));
    }
    expect(queries.resolveHeroMoveTarget(at(200, 50))).toBeNull();
  });

  it('builds the route graph again when the routes change', () => {
    const routes = new Map(ROUTES);
    const { queries } = service(routes);
    expect(queries.resolveHeroMoveTarget(at(100, 20))).toBeNull();
    routes.set('spawn-east', line([100, 0], [100, 150], [0, 150]));
    expect(queries.resolveHeroMoveTarget(at(100, 20))).not.toBeNull();
  });

  it('snaps a strike to the route cell like the AbilityManager, a beam to where its sweep starts', () => {
    const cell = at(0, 100);
    const { queries, snapToRouteCell } = service(ROUTES, cell);
    expect(queries.resolveAbilityTarget('nuclear-strike', at(5, 100))).toBe(cell);
    expect(snapToRouteCell).toHaveBeenCalledWith(at(5, 100), ABILITIES['nuclear-strike'].snapRadiusM);

    const laser = ABILITIES['orbital-laser'];
    if (laser.effect.kind !== 'beam') throw new Error('the orbital laser is a beam');
    const expected = routeSweepToward(ROUTES.values(), at(5, 200), laser.snapRadiusM, abilityBeamReachM(laser.effect));
    expect(queries.previewSweep('orbital-laser', at(5, 200))).toEqual(expected);
    expect(queries.resolveAbilityTarget('orbital-laser', at(5, 200))).toEqual(expected!.points[0]);
    expect(queries.previewSweep('nuclear-strike', at(5, 200))).toBeNull();
  });
});
