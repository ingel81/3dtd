/**
 * Integration Test: route corridor cells + enemy movement
 *
 * Towers only see enemies that stand in a route cell. The grid sizes its
 * corridor per segment and MovementComponent bounds the lateral offset by
 * the same width, so an enemy must never leave the cells, not on a narrow
 * stretch, not on the taper towards it and not around a corner.
 */
import { describe, expect, it } from 'vitest';
import { GameObject } from '../core/game-object';
import { ComponentType } from '../core/component';
import { TransformComponent } from '../game-components/transform.component';
import { MovementComponent } from '../game-components/movement.component';
import { GlobalRouteGrid } from '../utils/global-route-grid';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from '../utils/geo-utils';
import type { RouteWaypoint } from '../models/game.types';

const ORIGIN = { lat: 48.776, lon: 9.183 };
const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(ORIGIN.lat * DEG_TO_RAD);

/** The flat projection EllipsoidSync.geoToLocalSimple uses: x east, z south. */
const sync = {
  geoToLocalSimple: (lat: number, lon: number, height: number) => ({
    x: (lon - ORIGIN.lon) * M_PER_DEG_LON,
    y: height,
    z: -(lat - ORIGIN.lat) * METERS_PER_DEGREE_LAT,
  }),
};

/** A waypoint `east`/`north` metres from the origin. */
const at = (east: number, north: number, corridorHalfWidth?: number): RouteWaypoint => ({
  lat: ORIGIN.lat + north / METERS_PER_DEGREE_LAT,
  lon: ORIGIN.lon + east / M_PER_DEG_LON,
  corridorHalfWidth,
});

class Walker extends GameObject {
  constructor() {
    super('enemy');
    this.addComponent(new TransformComponent(this), ComponentType.TRANSFORM);
  }
}

describe('Route corridor coverage', () => {
  // Wide north, narrow diagonal, medium north, widest west, then a footway.
  const route: RouteWaypoint[] = [
    at(0, 0, 6),
    at(0, 80, 2),
    at(60, 120, 3.5),
    at(60, 200, 7),
    at(-20, 200, 2),
    at(-20, 230),
  ];

  it('keeps every enemy inside a route cell along the whole route', () => {
    const grid = new GlobalRouteGrid();
    grid.initialize((() => ({ groundY: 0, topY: 0, tileDepth: 20, tileGeometricError: 1 })) as never, sync as never);
    grid.generateFromRoutes([route]);

    for (const factor of [-1, -0.6, 0.3, 1]) {
      const walker = new Walker();
      const movement = new MovementComponent(walker);
      const transform = walker.getComponent<TransformComponent>(ComponentType.TRANSFORM)!;
      movement.setPath(route);
      movement.speedMps = 4;
      movement.setLateralFactor(factor);

      let steps = 0;
      const outside: string[] = [];
      while (movement.move(16.667, 0) === 'moving' && steps++ < 10000) {
        const local = sync.geoToLocalSimple(transform.position.lat, transform.position.lon, 0);
        if (!grid.getCellAt(local.x, local.z)) {
          outside.push(`segment ${movement.currentIndex} at ${local.x.toFixed(2)},${local.z.toFixed(2)}`);
        }
      }

      expect(steps).toBeGreaterThan(1000);
      expect(outside, `factor ${factor}`).toEqual([]);
    }
  });
});
