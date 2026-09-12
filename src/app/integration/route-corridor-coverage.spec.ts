/**
 * Integration Test: route corridor cells + enemy movement
 *
 * Towers only see enemies that stand in a route cell. The grid sizes its
 * corridor per segment and side and MovementComponent bounds the lateral
 * offset by the same widths, so an enemy must never leave the cells, not on
 * a narrow stretch, not on the taper towards it, not on the narrow side of
 * an uneven street and not around a corner.
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

/** A waypoint `east`/`north` metres from the origin, half widths left and right of the segment it starts. */
const at = (east: number, north: number, left?: number, right = left): RouteWaypoint => ({
  lat: ORIGIN.lat + north / METERS_PER_DEGREE_LAT,
  lon: ORIGIN.lon + east / M_PER_DEG_LON,
  corridorLeft: left,
  corridorRight: right,
});

class Walker extends GameObject {
  constructor() {
    super('enemy');
    this.addComponent(new TransformComponent(this), ComponentType.TRANSFORM);
  }
}

/** Walk `route` with each lateral factor and list every position that has no cell under it. */
function positionsOutside(route: RouteWaypoint[], factors: number[]): string[] {
  const grid = new GlobalRouteGrid();
  grid.initialize((() => ({ groundY: 0, topY: 0, tileDepth: 20, tileGeometricError: 1 })) as never, sync as never);
  grid.generateFromRoutes([route]);

  const outside: string[] = [];
  for (const factor of factors) {
    const walker = new Walker();
    const movement = new MovementComponent(walker);
    const transform = walker.getComponent<TransformComponent>(ComponentType.TRANSFORM)!;
    movement.setPath(route);
    movement.speedMps = 4;
    movement.setLateralFactor(factor);

    let steps = 0;
    while (movement.move(16.667, 0) === 'moving' && steps++ < 20000) {
      const local = sync.geoToLocalSimple(transform.position.lat, transform.position.lon, 0);
      if (!grid.getCellAt(local.x, local.z)) {
        outside.push(`factor ${factor} segment ${movement.currentIndex} at ${local.x.toFixed(2)},${local.z.toFixed(2)}`);
      }
    }
    expect(steps).toBeGreaterThan(1000);
  }
  return outside;
}

describe('Route corridor coverage', () => {
  const factors = [-1, -0.6, 0.3, 1];

  it('keeps every enemy inside a route cell along the whole route', () => {
    // Wide north, narrow diagonal, medium north, widest west, then a footway.
    const route: RouteWaypoint[] = [
      at(0, 0, 6),
      at(0, 80, 2),
      at(60, 120, 3.5),
      at(60, 200, 7),
      at(-20, 200, 2),
      at(-20, 230),
    ];
    expect(positionsOutside(route, factors)).toEqual([]);
  });

  it('keeps every enemy inside a route cell where the two sides differ', () => {
    // Facades close on one side, front gardens or a parking lane on the
    // other, and the sides swap from one stretch to the next, around corners.
    const route: RouteWaypoint[] = [
      at(0, 0, 2, 7),
      at(0, 60, 7, 2),
      at(45, 100, 2.5, 5),
      at(45, 150, 6, 2),
      at(0, 170, 2, 2),
      at(-30, 140, 7, 3),
      at(-30, 100),
    ];
    expect(positionsOutside(route, factors)).toEqual([]);
  });

  it('keeps every enemy inside a route cell on random uneven routes', () => {
    // Deterministic pseudo-random routes: headings, lengths and both widths vary.
    let seed = 12345;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const outside: string[] = [];
    for (let r = 0; r < 6; r++) {
      const route: RouteWaypoint[] = [];
      let east = 0;
      let north = 0;
      let heading = random() * Math.PI * 2;
      for (let i = 0; i < 8; i++) {
        route.push(at(east, north, 2 + Math.floor(random() * 11) / 2, 2 + Math.floor(random() * 11) / 2));
        heading += (random() - 0.5) * Math.PI * 0.9;
        const length = 6 + random() * 40;
        east += Math.cos(heading) * length;
        north += Math.sin(heading) * length;
      }
      route.push(at(east, north));
      outside.push(...positionsOutside(route, factors).map((p) => `route ${r} ${p}`));
    }
    expect(outside).toEqual([]);
  });
});
