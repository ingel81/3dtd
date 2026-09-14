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

  it('gives a cell the surface of the segment it lies along, not of a round end reaching it', () => {
    // Eastbound along z = 1: the approach to x = 20, 7 m either side, then
    // the bridge. Playtest 2026-09-14, Paris: the approach's round end took
    // the first 7 m of the deck to the ground, under the deck.
    const claims = new Set<number>();
    const cells = new Map<number, RouteCell>();
    claimSegmentCells(cells, lattice, p(0, 1), p(20, 1), 7, 7, false, null, undefined, claims);
    claimSegmentCells(cells, lattice, p(20, 1), p(60, 1), 7, 7, true, null, undefined, claims);

    // Centre (21, 5): on the deck, 1 m past the approach's end.
    expect(cellAt(cells, 20.5, 4.5)).toMatchObject({ surface: 'deck', axisX: 21, axisZ: 1 });
    // Centre (19, 5): on the approach, 1 m before the bridge's start.
    expect(cellAt(cells, 18.5, 4.5)).toMatchObject({ surface: 'ground', axisX: 19, axisZ: 1 });

    // The same the other way round, the bridge claimed first.
    const reversed = new Map<number, RouteCell>();
    const reversedClaims = new Set<number>();
    claimSegmentCells(reversed, lattice, p(20, 1), p(60, 1), 7, 7, true, null, undefined, reversedClaims);
    claimSegmentCells(reversed, lattice, p(0, 1), p(20, 1), 7, 7, false, null, undefined, reversedClaims);
    expect(cellAt(reversed, 20.5, 4.5)).toMatchObject({ surface: 'deck', axisX: 21 });
    expect(cellAt(reversed, 18.5, 4.5)).toMatchObject({ surface: 'ground', axisX: 19 });
  });

  it('puts the ground before the stretch off a bridge end, and that before the deck, whichever comes first', () => {
    const deckEnd = { x: 0, z: 1 };
    // The bridge east along z = 1 to x = 0, the way off it on at 30 degrees to the south-east, 20 m.
    const bridge = (cells: Map<number, RouteCell>, claims: Set<number>) =>
      claimSegmentCells(cells, lattice, p(-40, 1), p(0, 1), 3, 3, true, null, undefined, claims);
    const offBridge = (cells: Map<number, RouteCell>, claims: Set<number>) =>
      claimSegmentCells(cells, lattice, p(0, 1), p(20 * Math.cos(Math.PI / 6), 11), 3, 3, false, null, undefined, claims,
        [{ deckEnd, from: 0, to: 20 }]);
    // A street under both, along x = -11 and x = 9.
    const under = (cells: Map<number, RouteCell>, claims: Set<number>) => {
      claimSegmentCells(cells, lattice, p(-11, -10), p(-11, 10), 1, 1, false, null, undefined, claims);
      claimSegmentCells(cells, lattice, p(9, -10), p(9, 20), 1, 1, false, null, undefined, claims);
    };

    for (const order of [[bridge, offBridge, under], [under, offBridge, bridge]]) {
      const cells = new Map<number, RouteCell>();
      const claims = new Set<number>();
      for (const claim of order) claim(cells, claims);
      // Centre (5, 5): along the way off the bridge, compared with the deck at its end.
      expect(cellAt(cells, 4.5, 4.5)).toMatchObject({ surface: 'approach', deckEnd });
      // Centre (-1, 3), inside the bend: along both.
      expect(cellAt(cells, -1.5, 2.5)).toMatchObject({ surface: 'approach', deckEnd });
      expect(cellAt(cells, -21.5, 2.5)).toMatchObject({ surface: 'deck', deckEnd: null });
      // Where the street under them crosses.
      expect(cellAt(cells, -11.5, 0.5)).toMatchObject({ surface: 'ground', deckEnd: null });
      expect(cellAt(cells, 8.5, 6.5)).toMatchObject({ surface: 'ground', deckEnd: null });
    }
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

  it('makes the cells of the ways off a bridge end approach cells, as far as DECK_APPROACH_M along the route', () => {
    const cells = new Map<number, RouteCell>();
    const at = (onBridge?: boolean): RouteWaypoint => ({ lat: 0, lon: 0, corridorLeft: 3, corridorRight: 3, onBridge });
    // Eastbound along z = 1: a way to the bridge, the bridge 30 to 90, then 60 m of way off it.
    claimRouteCells(cells, lattice, [at(), at(true), at(), at()], [p(0, 1), p(30, 1), p(90, 1), p(150, 1)]);

    expect(cellAt(cells, 10.5, 2.5)).toMatchObject({ surface: 'approach', deckEnd: { x: 30, z: 1 } });
    expect(cellAt(cells, 60.5, 2.5)).toMatchObject({ surface: 'deck', deckEnd: null });
    expect(cellAt(cells, 128.5, 2.5)).toMatchObject({ surface: 'approach', deckEnd: { x: 90, z: 1 } });
    // Centre (133, 3): 43 m past the bridge end.
    expect(cellAt(cells, 132.5, 2.5)).toMatchObject({ surface: 'ground', deckEnd: null });

    // Turning off the bridge at its end: the ground.
    const turn = new Map<number, RouteCell>();
    claimRouteCells(turn, lattice, [at(true), at(), at()], [p(0, 1), p(60, 1), p(60, 40)]);
    expect(cellAt(turn, 60.5, 20.5)).toMatchObject({ surface: 'ground' });
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
