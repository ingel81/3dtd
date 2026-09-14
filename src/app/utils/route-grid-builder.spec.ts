import { describe, it, expect } from 'vitest';
import type { RouteWaypoint } from '../models/game.types';
import type { RouteCell } from './route-cell';
import {
  RouteCellLattice,
  TUNNEL_PORTAL_OFFSET_M,
  claimRouteCells,
  claimSegmentCells,
  segmentTouchesCell,
  tunnelSegments,
} from './route-grid-builder';

/** 2 m cells, keyed like GlobalRouteGrid keys them. */
const lattice: RouteCellLattice = {
  cellSize: 2,
  index: (v) => Math.floor(v / 2),
  key: (gx, gz) => ((gx & 0xFFFF) << 16) | (gz & 0xFFFF),
};

const cellAt = (cells: Map<number, RouteCell>, x: number, z: number) =>
  cells.get(lattice.key(lattice.index(x), lattice.index(z)));

const p = (x: number, z: number, y = 0) => ({ x, y, z });

describe('tunnelSegments', () => {
  it('puts the portals of a tunnel stretch outside its mouths and splits the way between them', () => {
    const route = [{}, { inTunnel: true }, { inTunnel: true }, {}, {}] as RouteWaypoint[];
    const points = [p(0, 0), p(10, 0), p(20, 0), p(40, 0), p(50, 0)];
    const [before, first, second, after] = tunnelSegments(route, points);

    expect(before).toBeNull();
    expect(after).toBeNull();
    // Mouths at x = 10 and 40, portals 2 m outside, 34 m apart.
    const total = 30 + 2 * TUNNEL_PORTAL_OFFSET_M;
    expect(first).toEqual({ ax: 8, az: 0, bx: 42, bz: 0, from: 2 / total, to: 12 / total });
    expect(second).toEqual({ ax: 8, az: 0, bx: 42, bz: 0, from: 12 / total, to: 32 / total });
  });
});

describe('segmentTouchesCell', () => {
  it('counts the edges of the square', () => {
    expect(segmentTouchesCell(2, { x: 0, z: 0 }, { x: 10, z: 0 }, 2, 0)).toBe(true);
    expect(segmentTouchesCell(2, { x: 0, z: 0 }, { x: 10, z: 0 }, 2, -1)).toBe(true); // runs along its lower edge
    expect(segmentTouchesCell(2, { x: 0, z: 0 }, { x: 10, z: 0 }, 2, 1)).toBe(false);
    expect(segmentTouchesCell(2, { x: 0, z: 0 }, { x: 3, z: 0 }, 2, 0)).toBe(false); // ends before it
  });
});

describe('claimSegmentCells', () => {
  it('claims the cells within the half width on each side and anchors them on the route height', () => {
    const cells = new Map<number, RouteCell>();
    // Eastbound along z = 1: right of travel is +z. 2 m left, 4 m right.
    claimSegmentCells(cells, lattice, p(0, 1, 10), p(40, 1, 30), 2, 4, false, null);

    expect(cellAt(cells, 20.5, 4.5)).toBeDefined(); // centre (21, 5), 4 m right
    expect(cellAt(cells, 20.5, -2.5)).toBeUndefined(); // centre (21, -3), 4 m left
    const onLine = cellAt(cells, 20.5, 1.5)!;
    expect(onLine).toMatchObject({ x: 21, z: 1, axisX: 21, axisZ: 1, surface: 'ground', heightSampled: false });
    expect(onLine.routeAnchorY).toBeCloseTo(20.5, 9);
    expect(onLine.terrainHeight).toBe(onLine.routeAnchorY);
    // An edge cell points at the centre line spot beside it.
    expect(cellAt(cells, 20.5, 4.5)).toMatchObject({ axisX: 21, axisZ: 1 });
  });

  it('keeps a cell on the ground when a segment off the bridge reaches it too, and lets a tunnel win', () => {
    const cells = new Map<number, RouteCell>();
    claimSegmentCells(cells, lattice, p(0, 1), p(20, 1), 3, 3, true, null);
    expect(cellAt(cells, 10.5, 1.5)!.surface).toBe('deck');

    claimSegmentCells(cells, lattice, p(10, -10), p(10, 10), 3, 3, false, null);
    expect(cellAt(cells, 10.5, 1.5)!.surface).toBe('ground');

    const tunnel = { ax: 0, az: 0, bx: 1, bz: 0, from: 0, to: 1 };
    claimSegmentCells(cells, lattice, p(0, 1), p(20, 1), 3, 3, false, tunnel);
    expect(cellAt(cells, 10.5, 1.5)).toMatchObject({ surface: 'tunnel', tunnelSpan: { ax: 0, bx: 1 } });
  });
});

describe('claimRouteCells', () => {
  it('claims each segment with the half widths and flags of its start waypoint', () => {
    const cells = new Map<number, RouteCell>();
    const route: RouteWaypoint[] = [
      { lat: 0, lon: 0, corridorLeft: 1, corridorRight: 1 },
      { lat: 0, lon: 0, corridorLeft: 6, corridorRight: 6, onBridge: true },
      { lat: 0, lon: 0 },
    ];
    claimRouteCells(cells, lattice, route, [p(0, 1), p(20, 1), p(40, 1)]);
    expect(cellAt(cells, 10.5, 5.5)).toBeUndefined();
    expect(cellAt(cells, 30.5, 5.5)).toMatchObject({ surface: 'deck' });
  });

  it('keeps the width of a wide piece out of the narrow piece after it', () => {
    // Eastbound along z = 1, right of travel is +z: 7 m on the first 20 m
    // (a front garden), then 2.5 m (the house at the street).
    const cells = new Map<number, RouteCell>();
    const route: RouteWaypoint[] = [
      { lat: 0, lon: 0, corridorLeft: 2.5, corridorRight: 7 },
      { lat: 0, lon: 0, corridorLeft: 2.5, corridorRight: 2.5 },
      { lat: 0, lon: 0 },
    ];
    claimRouteCells(cells, lattice, route, [p(0, 1), p(20, 1), p(40, 1)]);

    expect(cellAt(cells, 18.5, 6.5)).toBeDefined(); // centre (19, 7): 6 m right on the wide piece
    expect(cellAt(cells, 22.5, 2.5)).toBeDefined(); // centre (23, 3): 2 m right on the narrow piece
    // Centre (23, 5): 3 m past the joint and 4 m right, 5 m from the joint.
    // The wide piece's round end of 7 m took it, inside the house.
    expect(cellAt(cells, 22.5, 4.5)).toBeUndefined();
    // Nor in front of the joint, mirrored.
    const back = new Map<number, RouteCell>();
    claimRouteCells(back, lattice, [
      { lat: 0, lon: 0, corridorLeft: 2.5, corridorRight: 2.5 },
      { lat: 0, lon: 0, corridorLeft: 2.5, corridorRight: 7 },
      { lat: 0, lon: 0 },
    ], [p(0, 1), p(20, 1), p(40, 1)]);
    expect(cellAt(back, 16.5, 4.5)).toBeUndefined(); // centre (17, 5)
    expect(cellAt(back, 20.5, 6.5)).toBeDefined(); // centre (21, 7)
  });

  it('rounds the outer side of a corner to the narrower of its two pieces', () => {
    // East along z = 1 to x = 20, then south (+z). Left of travel is the
    // outer side, north-east of the corner: 6 m before it, 2 m after.
    const cells = new Map<number, RouteCell>();
    const route: RouteWaypoint[] = [
      { lat: 0, lon: 0, corridorLeft: 6, corridorRight: 2 },
      { lat: 0, lon: 0, corridorLeft: 2, corridorRight: 2 },
      { lat: 0, lon: 0 },
    ];
    claimRouteCells(cells, lattice, route, [p(0, 1), p(20, 1), p(20, 30)]);

    expect(cellAt(cells, 18.5, -4.5)).toBeDefined(); // centre (19, -5): 6 m left before the corner
    expect(cellAt(cells, 20.5, 0.5)).toBeDefined(); // centre (21, 1): round the corner
    expect(cellAt(cells, 22.5, -2.5)).toBeUndefined(); // centre (23, -3): 5 m from the corner
  });

  it('keeps a round end of the full half width at the ends of the route', () => {
    const cells = new Map<number, RouteCell>();
    claimRouteCells(cells, lattice, [
      { lat: 0, lon: 0, corridorLeft: 4, corridorRight: 4 },
      { lat: 0, lon: 0, corridorLeft: 1, corridorRight: 1 },
      { lat: 0, lon: 0 },
    ], [p(0, 1), p(20, 1), p(40, 1)]);
    expect(cellAt(cells, -2.5, 2.5)).toBeDefined(); // centre (-3, 3): 3.6 m behind the start
  });
});
