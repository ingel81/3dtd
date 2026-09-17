/**
 * Integration Test: route corridor cells + enemy movement
 *
 * Towers only see enemies that stand in a route cell. The grid sizes its
 * corridor per segment and side and MovementComponent bounds the lateral
 * offset by the same widths, so an enemy must never leave the cells, not on
 * a narrow stretch, not on the taper towards it, not on the narrow side of
 * an uneven street and not on the arc it rounds a corner on (RouteCorners).
 */
import { describe, expect, it } from 'vitest';
import { GameObject } from '../core/game-object';
import { ComponentType } from '../core/component';
import { TransformComponent } from '../game-components/transform.component';
import { MovementComponent } from '../game-components/movement.component';
import { GlobalRouteGrid } from '../utils/global-route-grid';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from '../utils/geo-utils';
import { getRouteProfile } from '../utils/route-corridor';
import type { RouteWaypoint } from '../models/game.types';

const ORIGIN = { lat: 48.776, lon: 9.183 };
const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(ORIGIN.lat * DEG_TO_RAD);

/**
 * A flat projection with x east and z south: EllipsoidSync.geoToLocalSimple
 * (x west, z north) turned by 180 degrees, which keeps distances and sides.
 */
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

/**
 * The furthest a lane of `route` moves on arc `arc` (RouteCorners) per metre
 * the enemy progresses along the route, placed at 400 steps of its stretch.
 */
function fastestLane(route: RouteWaypoint[], arc: number): number {
  const { corners, segmentLengths, cumulativeLength } = getRouteProfile(route);
  const step = (corners.to[arc] - corners.from[arc]) / 400;
  let fastest = 0;
  for (const factor of [-1, -0.5, 0, 0.5, 1]) {
    const walker = new Walker();
    const movement = new MovementComponent(walker);
    const transform = walker.getComponent<TransformComponent>(ComponentType.TRANSFORM)!;
    movement.setLateralFactor(factor);
    let before: { x: number; z: number } | null = null;
    for (let i = 0; i <= 400; i++) {
      const along = corners.from[arc] + i * step;
      let segment = 0;
      while (segment < segmentLengths.length - 1 && along > cumulativeLength[segment + 1]) segment++;
      movement.setPath(route, segment, (along - cumulativeLength[segment]) / segmentLengths[segment]);
      const here = sync.geoToLocalSimple(transform.position.lat, transform.position.lon, 0);
      if (before) fastest = Math.max(fastest, Math.hypot(here.x - before.x, here.z - before.z) / step);
      before = here;
    }
  }
  return fastest;
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

  it('keeps every enemy inside a route cell at a bottleneck one cell wide', () => {
    // Stretches half a cell either side between wide ones, straight north
    // and on a diagonal.
    const route: RouteWaypoint[] = [
      at(0, 0, 6),
      at(0, 60, 1),
      at(0, 100, 6),
      at(40, 130, 1),
      at(80, 160, 5),
      at(80, 200),
    ];
    expect(positionsOutside(route, factors)).toEqual([]);
  });

  it('keeps every enemy inside a route cell with one side a single cell and the other wide', () => {
    const route: RouteWaypoint[] = [
      at(0, 0, 1, 7),
      at(0, 60, 7, 1),
      at(40, 100, 1, 6),
      at(80, 110, 6, 1),
      at(80, 150),
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
        route.push(at(east, north, 1 + Math.floor(random() * 13) / 2, 1 + Math.floor(random() * 13) / 2));
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
  describe('on the arcs of corners', () => {
    const lanes = [-1, -0.5, 0, 0.5, 1];

    /** How many arcs enemies round the corners of `route` on. */
    const arcs = (route: RouteWaypoint[]) => getRouteProfile(route).corners.radius.length;

    it('keeps every enemy inside a route cell at corners of every angle, both ways, with uneven sides', () => {
      const outside: string[] = [];
      let rounded = 0;
      for (const degrees of [20, 45, 90, 135, 160]) {
        for (const sign of [1, -1]) {
          // Even; narrow right, wide left; wide left, narrow right; and the
          // sides swapping at the corner
          for (const [[l1, r1], [l2, r2]] of [
            [[4.5, 4.5], [4.5, 4.5]],
            [[7, 2], [7, 2]],
            [[2.5, 7], [2.5, 7]],
            [[6, 3], [3, 6]],
          ]) {
            const turn = sign * degrees * DEG_TO_RAD;
            const route = [at(0, 0, l1, r1), at(0, 50, l2, r2), at(50 * Math.sin(turn), 50 + 50 * Math.cos(turn))];
            rounded += arcs(route);
            outside.push(...positionsOutside(route, lanes).map((p) => `${degrees * sign} ${l1}/${r1} ${l2}/${r2} ${p}`));
          }
        }
      }
      expect(outside).toEqual([]);
      expect(rounded).toBe(40);
    });

    it('keeps every enemy inside a route cell where short segments cut the arcs down', () => {
      const routes: RouteWaypoint[][] = [
        // Right and left on a 2 m segment
        [at(0, 0, 5), at(0, 40, 5), at(2, 40, 5), at(2, 80)],
        // Three kinks of 45 degrees 3 m apart, narrow on the inside
        [at(0, 0, 6, 2.5), at(0, 30, 6, 2.5), at(2.12, 32.12, 6, 2.5), at(5.12, 32.12, 6, 2.5), at(7.24, 30, 6, 2.5), at(7.24, 0)],
        // A corner as the band lays it: stations 1 m either side of the waypoint
        [at(0, 0, 4, 6), at(0, 39, 4, 6), at(0, 40, 4, 6), at(1, 40, 4, 6), at(41, 40)],
        // A hairpin of two right angles 4 m apart, wide outside
        [at(0, 0, 7, 3), at(0, 40, 7, 3), at(4, 40, 7, 3), at(4, 0)],
      ];
      const outside: string[] = [];
      routes.forEach((route, r) => {
        expect(arcs(route), `route ${r}`).toBeGreaterThan(0);
        outside.push(...positionsOutside(route, lanes).map((p) => `route ${r} ${p}`));
      });
      expect(outside).toEqual([]);
    });

    it('rounds corners the band laid on real streets on one wide arc over their pieces, every enemy inside a route cell', () => {
      // The enemies' line through a corner as bandPath laid it, metres east
      // and north, half widths left and right (snapshots of 2026-09-16): in
      // Stuttgart 87 degrees on pieces of 0.8 and 1.2 m, in Berlin 113
      // degrees on pieces of 0.8 m between stations 2 m apart. Before the
      // groups each waypoint had an arc of its own of 0.41 and 0.27 m, its
      // outer lane swinging round at 10 and 14 times the enemy's speed.
      const corners: [string, number, [number, number, number, number][]][] = [
        ['stuttgart', 6, [
          [0, 0, 5.63, 6.47], [2.019, -1.068, 5.82, 6.53], [4.058, -2.111, 5.7, 6.63], [5.087, -2.619, 5.7, 6.63],
          [6.175, -3.176, 5.7, 6.67], [8.365, -4.285, 6.79, 5.82], [9.464, -4.802, 6.79, 5.82], [9.164, -5.531, 6.8, 5.17],
          [8.578, -7.029, 6.65, 4.36], [8.331, -7.672, 6.65, 4.36], [8.765, -8.563, 6.51, 4.36], [9.685, -10.583, 6.38, 5.47],
          [10.596, -12.606, 6.23, 6.57], [11.066, -13.58, 6.23, 6.57], [11.49, -14.318, 6.06, 7.57],
        ]],
        ['berlin', 8, [
          [0, 0, 5.63, 4.26], [-0.526, -0.905, 5.83, 5.05], [-1.557, -2.721, 6.04, 5.88], [-2.579, -4.541, 6.24, 6.72],
          [-3.583, -6.369, 6.42, 7.42], [-4.568, -8.205, 6.58, 7.28], [-5.536, -10.049, 6.72, 7.17], [-6.476, -11.905, 6.83, 7.09],
          [-6.851, -12.662, 6.83, 7.09], [-6.03, -12.707, 6.91, 7.03], [-4.01, -12.777, 6.97, 6.99], [-1.991, -12.827, 7.01, 6.96],
          [0.039, -12.867, 7.04, 6.94], [2.059, -12.897, 7.06, 6.94], [4.088, -12.907, 7.06, 6.94], [6.108, -12.917, 7.05, 6.94],
          [8.128, -12.917, 7.04, 6.95],
        ]],
      ];
      const outside: string[] = [];
      for (const [name, corner, points] of corners) {
        // 30 m on along the first and the last piece, for a walk long enough
        const [a, b] = [points[0], points[1]];
        const [y, z] = [points[points.length - 2], points[points.length - 1]];
        const lead = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const tail = Math.hypot(z[0] - y[0], z[1] - y[1]);
        const route = [
          at(a[0] - ((b[0] - a[0]) * 30) / lead, a[1] - ((b[1] - a[1]) * 30) / lead, a[2], a[3]),
          ...points.map(([east, north, left, right]) => at(east, north, left, right)),
          at(z[0] + ((z[0] - y[0]) * 30) / tail, z[1] + ((z[1] - y[1]) * 30) / tail),
        ];
        const profile = getRouteProfile(route);
        const { arcOf, radius, inside } = profile.corners;
        const arc = arcOf[corner + 1];
        const [first, last] = [arcOf.indexOf(arc), arcOf.lastIndexOf(arc)];
        expect(arc, name).toBeGreaterThanOrEqual(0);
        expect(last - first, name).toBeGreaterThanOrEqual(2);
        // At least the smallest lateral limit on the inside over the corner's waypoints
        const inner = (inside[arc] > 0 ? profile.right : profile.left).node.slice(first, last + 1);
        expect(radius[arc], name).toBeGreaterThanOrEqual(Math.min(...inner) - 0.01);
        // No lane runs more than two and a half times as far as the enemy progresses
        expect(fastestLane(route, arc), name).toBeLessThan(2.5);
        outside.push(...positionsOutside(route, lanes).map((p) => `${name} ${p}`));
      }
      expect(outside).toEqual([]);
    });

    it('keeps every enemy inside a route cell along a curve of small kinks', () => {
      // 120 degrees in 20 kinks of 6 degrees, 2 m apart, like the stations of a band
      const route: RouteWaypoint[] = [at(0, 0, 3, 6), at(0, 30, 3, 6)];
      let east = 0;
      let north = 30;
      let heading = 0;
      for (let i = 0; i < 20; i++) {
        heading += (6 * Math.PI) / 180;
        east += 2 * Math.sin(heading);
        north += 2 * Math.cos(heading);
        route.push(at(east, north, i % 2 ? 3 : 3.5, i % 2 ? 6 : 5.5));
      }
      route.push(at(east + 30 * Math.sin(heading), north + 30 * Math.cos(heading)));
      // Every kink on an arc
      expect(arcs(route)).toBeGreaterThan(0);
      expect(Array.from(getRouteProfile(route).corners.arcOf).slice(1, 21).every((arc) => arc >= 0)).toBe(true);
      expect(positionsOutside(route, lanes)).toEqual([]);
    });
  });
});
