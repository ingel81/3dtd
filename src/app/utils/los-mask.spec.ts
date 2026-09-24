import { describe, expect, it, vi } from 'vitest';
import type { LosResolveContext } from './gpu-cube-resolve';

// Stand-in for the cubemap: a pattern over the sample point, so ground and
// air answers differ from cell to cell and a slot mix-up shows.
vi.mock('./gpu-cube-resolve', () => ({
  isCubeVisible: vi.fn((_tx: number, _ty: number, _tz: number, x: number, y: number, z: number) =>
    (Math.floor(x) * 7 + Math.floor(z) * 13 + Math.round(y)) % 3 !== 0),
}));

import { GlobalRouteGrid } from './global-route-grid';
import type { RouteCell } from './route-cell';
import type { RouteWaypoint } from '../models/game.types';
import { losMaskByteSize, losMaskFromJson, losMaskToJson } from './los-mask';

const coordinateSync = {
  geoToLocalSimple: (lat: number, lon: number) => ({ x: lon, y: 0, z: lat }),
} as never;
const flat = () => ({ groundY: 0, topY: 0, tileDepth: 20, tileGeometricError: 2 });
const at = (x: number, z: number, side?: number): RouteWaypoint =>
  ({ lat: z, lon: x, corridorLeft: side, corridorRight: side });

/** A cross of two wide streets, so a tower's reach holds cells in all directions. */
const routes = [
  [at(-80, 1, 6), at(80, 1)],
  [at(1, -80, 6), at(1, 80)],
];

function makeGrid(): GlobalRouteGrid {
  const grid = new GlobalRouteGrid();
  grid.initialize(flat as never, coordinateSync);
  grid.generateFromRoutes(routes);
  return grid;
}

const ctxAt = (x: number, z: number): LosResolveContext =>
  ({ referencePos: { x, y: 12, z } }) as unknown as LosResolveContext;

/** What the tower holds in every cell of the grid, by cell position. */
function answers(grid: GlobalRouteGrid, towerId: string): string[] {
  const rows: string[] = [];
  for (const cell of grid.getCellsInRange(0, 0, 200)) {
    const g = cell.towerVisibility.get(towerId);
    const a = cell.airVisibility.get(towerId);
    if (g !== undefined || a !== undefined) rows.push(`${cell.x},${cell.z}:${g},${a}`);
  }
  return rows.sort();
}
const keys = (cells: RouteCell[]) => cells.map((c) => `${c.x},${c.z}`);

describe('LosMask', () => {
  it('round trip: a fresh grid gets the same answers and visible cells without a cube', () => {
    const live = makeGrid();
    const visible = live.registerTower('t1', 7.3, 9.6, 30, ctxAt(7.3, 9.6), true, true);
    const mask = live.encodeLosMask('t1', 7.3, 9.6, 30, true, true);

    const fresh = makeGrid();
    const applied = fresh.applyLosMask('t1', 7.3, 9.6, mask);

    expect(answers(fresh, 't1')).toEqual(answers(live, 't1'));
    expect(answers(live, 't1').length).toBeGreaterThan(100);
    expect(keys(applied)).toEqual(keys(visible));
    // Both kinds of answer and both values are in there
    const rows = answers(live, 't1');
    expect(rows.some((r) => r.endsWith('true,false'))).toBe(true);
    expect(rows.some((r) => r.endsWith('false,true'))).toBe(true);
  });

  it('round trip after a range upgrade and an air retrofit: the mask holds the mixed result', () => {
    const live = makeGrid();
    live.registerTower('t1', -3.1, 4.2, 16, ctxAt(-3.1, 4.2), true, false);
    live.registerTowerIncremental('t1', -3.1, 4.2, 24, ctxAt(-3.1, 4.2), true, false);
    const visible = live.registerTowerIncremental('t1', -3.1, 4.2, 24, ctxAt(-3.1, 4.2), true, true);
    const mask = live.encodeLosMask('t1', -3.1, 4.2, 24, true, true);

    const fresh = makeGrid();
    expect(keys(fresh.applyLosMask('t1', -3.1, 4.2, mask))).toEqual(keys(visible));
    expect(answers(fresh, 't1')).toEqual(answers(live, 't1'));
  });

  it('only holds the answers the tower has: no air answers for a ground-only mask', () => {
    const live = makeGrid();
    live.registerTower('t1', 0, 0, 20, ctxAt(0, 0), true, false);
    const mask = live.encodeLosMask('t1', 0, 0, 20, true, false);
    const fresh = makeGrid();
    fresh.applyLosMask('t1', 0, 0, mask);
    expect(answers(fresh, 't1').every((r) => r.endsWith(',undefined'))).toBe(true);
    expect(answers(fresh, 't1')).toEqual(answers(live, 't1'));
  });

  it('survives JSON as plain data', () => {
    const live = makeGrid();
    live.registerTower('t1', 7.3, 9.6, 30, ctxAt(7.3, 9.6), true, true);
    const mask = live.encodeLosMask('t1', 7.3, 9.6, 30, true, true);
    const back = losMaskFromJson(JSON.parse(JSON.stringify(losMaskToJson(mask))));
    expect(back).toEqual(mask);
  });

  it('refuses a mask taken at another range', () => {
    const live = makeGrid();
    live.registerTower('t1', 0, 0, 20, ctxAt(0, 0), true, true);
    const mask = live.encodeLosMask('t1', 0, 0, 20, true, true);
    expect(() => live.applyLosMask('t1', 0, 0, { ...mask, range: 40 })).toThrow(/LosMask of t1/);
  });

  it('includes the cells whose square touches the range, not only those with the centre in it (D2)', () => {
    const grid = makeGrid();
    // Cell (21, 1): centre 12.53 m off, square [20, 22] x [0, 2] 11.5 m off
    grid.registerTower('t1', 20.2, 13.5, 12, ctxAt(20.2, 13.5), true, true);
    const edge = grid.getCellAt(21, 1)!;
    expect(Math.hypot(edge.x - 20.2, edge.z - 13.5)).toBeGreaterThan(12);
    expect(edge.towerVisibility.has('t1')).toBe(true);
    expect(edge.airVisibility.has('t1')).toBe(true);
    // Cell (21, -1): square 13.5 m off, beyond the reach
    expect(grid.getCellAt(21, -1)!.towerVisibility.has('t1')).toBe(false);
  });

  it('size and time per tower', () => {
    const grid = makeGrid();
    const rows: string[] = [];
    for (const range of [20, 30, 40, 60]) {
      grid.registerTower(`r${range}`, 0.4, 0.7, range, ctxAt(0.4, 0.7), true, true);
      const runs = 200;
      let t0 = performance.now();
      let mask = grid.encodeLosMask(`r${range}`, 0.4, 0.7, range, true, true);
      for (let i = 1; i < runs; i++) mask = grid.encodeLosMask(`r${range}`, 0.4, 0.7, range, true, true);
      const encodeUs = ((performance.now() - t0) / runs) * 1000;
      t0 = performance.now();
      for (let i = 0; i < runs; i++) grid.applyLosMask(`r${range}`, 0.4, 0.7, mask);
      const applyUs = ((performance.now() - t0) / runs) * 1000;
      const bytes = losMaskByteSize(mask);
      // Slots: the disc grown by a 2 m square, (4 + 8 r + pi r^2) / 4 cells for r in m
      const slots = (4 + 8 * range + Math.PI * range * range) / 4;
      expect(mask.bits.length).toBeGreaterThan((slots * 0.9) / 4);
      expect(mask.bits.length).toBeLessThan((slots * 1.1) / 4);
      rows.push(`range ${range} m: ${bytes} B, encode ${encodeUs.toFixed(0)} us, apply ${applyUs.toFixed(0)} us`);
    }
    console.log(`[LosMask] ${rows.join('; ')}`);
  });
});
