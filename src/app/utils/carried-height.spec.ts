import { describe, expect, it } from 'vitest';
import type { ColumnSample } from '../three-engine/column-sample';
import type { Street, StreetNode } from '../interfaces/street-network-provider.interface';
import { METERS_PER_DEGREE_LAT } from './geo-utils';
import {
  DECK_APPROACH_M,
  approachY,
  carriedY,
  nearestApproach,
  pointOnApproach,
  routeApproaches,
  segmentApproaches,
  streetDeckApproaches,
} from './carried-height';

const p = (x: number, z: number) => ({ x, z });
const column = (groundY: number, topY: number): ColumnSample => ({ groundY, topY, tileDepth: 20, tileGeometricError: 2 });

describe('approachY', () => {
  it('takes the hit nearest to the height the route carries there', () => {
    // The deck at 80 m over a quay at 70 m, with a rise or an underside a little below it.
    expect(approachY(column(70, 80), 80)).toBe(80);
    expect(approachY(column(70, 81.5), 80)).toBe(81.5);
    expect(approachY(column(78.5, 80), 80)).toBe(80);
    // A crown 8 m, a lamp, a car over a street on the level of the deck: the street.
    expect(approachY(column(80, 88), 80)).toBe(80);
    expect(approachY(column(80, 81.4), 80)).toBe(80);
    // A street far below with nothing over it: its ground.
    expect(approachY(column(70, 70), 80)).toBe(70);
  });
});

describe('carriedY', () => {
  it('stays on the level of the deck round a corner over a road below', () => {
    // A square at 80 m past the bridge end at (0, 0), a road under it at
    // 71 m from z = 3 to 20; the route turns south at (10, 0).
    const square = (x: number, z: number) => (z > 3 && z < 20 ? column(71, 80) : column(80, 80));
    const deck = { path: [p(0, 0), p(10, 0), p(10, 30)], m: 30 };
    expect(carriedY(deck, square)).toBe(80);
    expect(approachY(square(12, 11), carriedY({ ...deck, m: 21 }, square)!)).toBe(80);
  });

  it('goes down stairs to the quay and keeps it under a deck there', () => {
    // The deck at 80 m over the quay at 70 m to z = 9, stairs down to the
    // quay from z = 9 to 25 (1.25 m every 2 m), another deck at 80 m over
    // the quay from z = 36 to 44.
    const quay = (_x: number, z: number) => (z < 9 ? column(70, 80)
      : z < 25 ? column(80 - (z - 9) * 0.625, 80 - (z - 9) * 0.625)
        : z > 36 && z < 44 ? column(70, 80) : column(70, 70));
    const deck = { path: [p(0, 0), p(0, 9), p(0, 60)], m: 40 };
    // The last point before 17 m is 16 m on, 7 m down the stairs.
    expect(carriedY({ ...deck, m: 17 }, quay)).toBe(75.625);
    expect(carriedY(deck, quay)).toBe(70);
    expect(approachY(quay(0, 40), carriedY(deck, quay)!)).toBe(70);
  });

  it('neither drops through a gap in the mesh nor climbs a crown with no ground under it', () => {
    // The deck at 80 m over the quay at 70 m; at x = 10 a crown alone at 88 m, at x = 14 a gap onto the quay.
    const head = (x: number) => (Math.abs(x - 10) < 1 ? column(88, 88) : Math.abs(x - 14) < 1 ? column(70, 70) : column(70, 80));
    const deck = { path: [p(0, 0), p(30, 0)], m: 20 };
    expect(carriedY(deck, head)).toBe(80);
    // A point without a column keeps the height so far.
    expect(carriedY(deck, (x) => (x > 5 && x < 15 ? null : head(x)))).toBe(80);
  });

  it('waits for a column at the bridge end, and keeps a bus there out of the cells', () => {
    expect(carriedY({ path: [p(0, 0), p(10, 0)], m: 10 }, (x) => (x < 1 ? null : column(70, 80)))).toBeNull();
    // A bus 3 m up at the bridge end: the height stays there, and still the deck lies nearer than the quay.
    const bus = (x: number) => (x < 1 ? column(83, 83) : column(70, 80));
    const carried = carriedY({ path: [p(0, 0), p(10, 0)], m: 10 }, bus)!;
    expect(carried).toBe(83);
    expect(approachY(bus(10), carried)).toBe(80);
  });
});

describe('routeApproaches', () => {
  it('runs along the route from both ends of a bridge and stops past DECK_APPROACH_M', () => {
    // Eastbound: road 0 to 10, ways of 20 and 8 m, the bridge 38 to 98, then 30, 20, 70 and 12 m.
    const points = [p(0, 0), p(10, 0), p(30, 0), p(38, 0), p(98, 0), p(128, 0), p(148, 0), p(218, 0), p(230, 0)];
    const onBridge = [false, false, false, true, false, false, false, false];
    const approaches = routeApproaches(points, onBridge, onBridge.map(() => false));

    // Back from the bridge start (point 3): 8 m, then 20 m, then 10 m of the road.
    expect(approaches[2]).toEqual([{ path: [3, 2], from: 8, to: 0 }]);
    expect(approaches[1]).toEqual([{ path: [3, 2, 1], from: 28, to: 8 }]);
    expect(approaches[0]).toEqual([{ path: [3, 2, 1, 0], from: 38, to: 28 }]);
    expect(approaches[3]).toEqual([]);
    // On from the bridge end (point 4): 30 m, 20 m, then 70 m, which starts within the limit; not the 12 m after.
    expect(approaches[4]).toEqual([{ path: [4, 5], from: 0, to: 30 }]);
    expect(approaches[5]).toEqual([{ path: [4, 5, 6], from: 30, to: 50 }]);
    expect(approaches[6]).toEqual([{ path: [4, 5, 6, 7], from: 50, to: 120 }]);
    expect(approaches[7]).toEqual([]);
    expect(DECK_APPROACH_M).toBe(60);
  });

  it('follows the route round a corner, and stops at a tunnel and at the next bridge', () => {
    // A bridge east to (60, 0), then a way south: the route turns 90 degrees.
    expect(routeApproaches([p(0, 0), p(60, 0), p(60, 30)], [true, false], [false, false])[1])
      .toEqual([{ path: [1, 2], from: 0, to: 30 }]);

    const tunnel = routeApproaches([p(0, 0), p(60, 0), p(70, 0), p(90, 0)], [true, false, false], [false, true, false]);
    expect(tunnel[1]).toEqual([]);
    expect(tunnel[2]).toEqual([]);

    // A 20 m way between two bridges belongs to both ends.
    const between = routeApproaches([p(0, 0), p(60, 0), p(80, 0), p(140, 0)], [true, false, true], [false, false, false]);
    expect(between[1]).toEqual([{ path: [1, 2], from: 0, to: 20 }, { path: [2, 1], from: 20, to: 0 }]);
  });

  it('hands the cells and stations of a segment the route from the bridge end to their point', () => {
    const points = [p(0, 0), p(60, 0), p(60, 30)];
    const [approach] = segmentApproaches(routeApproaches(points, [true, false], [false, false])[1], points);
    expect(approach.path).toEqual([p(60, 0), p(60, 30)]);
    expect(pointOnApproach(approach, 0.5)).toEqual({ path: approach.path, m: 15 });
  });
});

describe('nearestApproach', () => {
  it('picks the nearer bridge end at a point of the segment, none past DECK_APPROACH_M', () => {
    const a = { from: 0, to: 20 };
    const b = { from: 20, to: 0 };
    expect(nearestApproach([a, b], 0.2)).toBe(a);
    expect(nearestApproach([a, b], 0.8)).toBe(b);
    const far = { from: DECK_APPROACH_M - 5, to: DECK_APPROACH_M + 5 };
    expect(nearestApproach([far], 0.4)).toBe(far);
    expect(nearestApproach([far], 0.6)).toBeNull();
    expect(nearestApproach([], 0.5)).toBeNull();
  });
});

describe('streetDeckApproaches', () => {
  /** A node `x` metres east and `z` north of (0, 0). */
  const node = (id: number, x: number, z: number): StreetNode => ({ id, lat: z / METERS_PER_DEGREE_LAT, lon: x / METERS_PER_DEGREE_LAT });
  const way = (id: number, nodes: StreetNode[], tags: Partial<Street> = {}): Street =>
    ({ id, name: '', type: 'service', nodes, ...tags });

  // The bridge way east from (0, 0) to (60, 0); past its east end ways of
  // 7 and 2 m, then a road; stairs off the east end at a right angle; past
  // its west end a way of 31 m, then a tunnel; a quay road under the bridge.
  const n = {
    west: node(1, 0, 0), east: node(2, 60, 0), a: node(3, 67, 0), b: node(4, 69, 0), c: node(5, 99, 0), d: node(6, 130, 0),
    stairs1: node(7, 60, 15), stairs2: node(8, 60, 30), w: node(11, -31, 0), tunnel: node(12, -50, 0),
    quay1: node(9, 30, -20), quay2: node(10, 30, 20),
  };
  const streets = [
    way(100, [n.west, n.east], { bridge: 'yes', layer: 1 }),
    way(200, [n.east, n.a]),
    way(300, [n.a, n.b]),
    way(400, [n.b, n.c, n.d], { type: 'secondary' }),
    way(500, [n.east, n.stairs1, n.stairs2], { type: 'steps' }),
    way(700, [n.w, n.west]),
    way(800, [n.w, n.tunnel], { tunnel: 'yes' }),
    way(600, [n.quay1, n.quay2]),
  ];

  it('runs from both ends of a bridge way along the ways off them, whichever way they turn, as far as DECK_APPROACH_M', () => {
    const found = streetDeckApproaches(streets);
    const at = (p: StreetNode) => {
      const hit = found.get(p.id);
      return hit ? [hit.path.map((q) => q.id).join(','), Math.round(hit.distanceM * 10) / 10] : null;
    };
    expect(at(n.east)).toEqual(['2', 0]);
    expect(at(n.a)).toEqual(['2,3', 7]);
    expect(at(n.b)).toEqual(['2,3,4', 9]);
    expect(at(n.c)).toEqual(['2,3,4,5', 39]);
    expect(at(n.d)).toBeNull();
    // The stairs down at a right angle: followed, their heights come from the columns along them (carriedY).
    expect(at(n.stairs2)).toEqual(['2,7,8', 30]);
    expect(at(n.west)).toEqual(['1', 0]);
    expect(at(n.w)).toEqual(['1,11', 31]);
    // Into a tunnel, not connected (the quay road under the bridge).
    expect(at(n.tunnel)).toBeNull();
    expect(at(n.quay1)).toBeNull();
    expect(at(n.quay2)).toBeNull();
  });
});
