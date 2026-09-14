import { describe, it, expect } from 'vitest';
import type { RouteCell } from './route-cell';
import type { RouteCellLattice } from './route-grid-builder';
import { RouteGridView, collectCentreLineCells, findCorridorHoles, probeCellsAround } from './route-grid-diagnostics';

/** 2 m cells, keyed like GlobalRouteGrid keys them. */
const lattice: RouteCellLattice = {
  cellSize: 2,
  index: (v) => Math.floor(v / 2),
  key: (gx, gz) => ((gx & 0xFFFF) << 16) | (gz & 0xFFFF),
};

/** A sampled cell on grid spot (gx, gz). */
const cellOn = (gx: number, gz: number): RouteCell => ({
  key: lattice.key(gx, gz),
  x: (gx + 0.5) * 2,
  z: (gz + 0.5) * 2,
  axisX: (gx + 0.5) * 2,
  axisZ: (gz + 0.5) * 2,
  terrainHeight: 0,
  surface: 'ground',
  tunnelSpan: null,
  routeAnchorY: 0,
  sample: { state: 'stable', sampledAt: 0, tileDepth: 20, tileGeometricError: 2 },
  heightSampled: true,
  enemies: new Set(),
  towerVisibility: new Map(),
  airVisibility: new Map(),
});

function view(spots: [number, number][], routes: RouteGridView['routes'] = []): RouteGridView {
  const cells = new Map<number, RouteCell>();
  for (const [gx, gz] of spots) cells.set(lattice.key(gx, gz), cellOn(gx, gz));
  // Local x = lon, z = lat.
  const sync = { geoToLocalSimple: (lat: number, lon: number) => ({ x: lon, y: 0, z: lat }) };
  return { cells, lattice, routes, sync: sync as unknown as RouteGridView['sync'] };
}

/** Every spot of the block gx0..gx1 x gz0..gz1. */
const block = (gx0: number, gx1: number, gz0: number, gz1: number) => {
  const spots: [number, number][] = [];
  for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) spots.push([gx, gz]);
  return spots;
};

describe('findCorridorHoles', () => {
  it('finds a spot without a cell between cells on all four sides, and nothing at the corridor edge', () => {
    const spots = block(0, 4, 0, 4).filter(([gx, gz]) => !(gx === 2 && gz === 2) && !(gx === 4 && gz === 0));
    expect(findCorridorHoles(view(spots), 5, 5, 20)).toEqual([{ x: 5, z: 5 }]);
  });
});

describe('collectCentreLineCells', () => {
  it('lists the cells on the centre line and the spots on it without one', () => {
    const route = [{ lat: 1, lon: 0 }, { lat: 1, lon: 10 }];
    const { cells, missing } = collectCentreLineCells(view(block(0, 2, 0, 0), [route]), 5, 1, 50);
    expect(cells.map((c) => c.x)).toEqual([1, 3, 5]);
    expect(missing).toEqual([{ x: 7, z: 1 }, { x: 9, z: 1 }, { x: 11, z: 1 }]);
  });

  it('finds nothing before the grid has a coordinate sync', () => {
    const grid = { ...view(block(0, 2, 0, 0), [[{ lat: 1, lon: 0 }, { lat: 1, lon: 10 }]]), sync: null };
    expect(collectCentreLineCells(grid, 5, 1, 50)).toEqual({ cells: [], missing: [] });
  });
});

describe('probeCellsAround', () => {
  it('lists the spots around a point, nearest to the route line first', () => {
    const route = [{ lat: 1, lon: -10 }, { lat: 1, lon: 10 }];
    const rows = probeCellsAround(view([[0, 0]], [route]), 1, 3, 2, null, () => null, () => false);

    expect(rows[0]).toMatchObject({ x: 1, z: 1, routeM: 0, cell: true, state: 'stable', walkable: false });
    expect(rows.find((r) => r.x === 1 && r.z === 3)).toMatchObject({ routeM: 2, cell: false, walkable: null });
    expect(rows.every((r, k) => k === 0 || r.routeM >= rows[k - 1].routeM)).toBe(true);
  });
});
