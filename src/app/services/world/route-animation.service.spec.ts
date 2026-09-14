import { describe, it, expect, vi } from 'vitest';
import { Group, Vector2, Vector3 } from 'three';

/**
 * RouteAnimationService reads the route line lift from PathAndRouteService
 * (routeLineLift, 3 in DevWorld, otherwise 1) instead of a hard-wired
 * constant, so the animated line matches the static route line's height.
 * `inject()` needs an Angular injection context; outside TestBed the field
 * initializer would throw, so this stubs it by token name, same as the
 * sibling PathAndRouteService spec.
 */
const lift = vi.hoisted(() => ({ value: 1 }));

vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  const stubs: Record<string, unknown> = {
    PathAndRouteService: { routeLineLift: () => lift.value },
  };
  return {
    ...actual,
    inject: (token: { name?: string }) => stubs[token?.name ?? ''] ?? {},
  };
});

import { RouteAnimationService } from './route-animation.service';
import type { ThreeTilesEngine } from '../../three-engine';

const ORIGIN = { lat: 48.0, lon: 9.0, height: 0 };

/** Minimal engine stub: flat plate-carree conversion around ORIGIN. */
function makeEngine(overlay: Group): ThreeTilesEngine {
  return {
    getOverlayGroup: () => overlay,
    getTerrainHeightAtGeo: () => 0,
    getRenderer: () => ({ getSize: (target: Vector2) => target.set(800, 600) }),
    sync: {
      getOrigin: () => ORIGIN,
      geoToLocalSimple: (lat: number, lon: number, h: number) =>
        new Vector3((lon - ORIGIN.lon) * 100000, h, -(lat - ORIGIN.lat) * 100000),
    },
  } as unknown as ThreeTilesEngine;
}

describe('RouteAnimationService', () => {
  it('lifts the animated line by PathAndRouteService.routeLineLift(), like the static route line', () => {
    lift.value = 3; // e.g. DevWorld active
    const overlay = new Group();
    const service = new RouteAnimationService();
    service.initialize(makeEngine(overlay));

    const path = [
      { lat: 48.0, lon: 9.0, height: 10 },
      { lat: 48.001, lon: 9.0, height: 10 },
    ];
    service.startAnimation(new Map([['spawn-1', path]]), []);

    const mainLine = overlay.children.find((c) => c.renderOrder === 3);
    expect(mainLine).toBeDefined();
    const start = (mainLine as unknown as { geometry: { attributes: { instanceStart: { getY(i: number): number } } } })
      .geometry.attributes.instanceStart;
    // pos.height (10) - origin.height (0) + lift (3), not the old hard-wired 1.
    expect(start.getY(0)).toBeCloseTo(13);
  });
});
