import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { RouteCell } from './route-cell';
import type { RouteCellSampler } from './route-cell-sampler';
import type { LosResolveContext } from './gpu-cube-resolve';

// Stand-in for the cubemap: a wall at 10 m, so what a tower sees follows
// the target height. Ground targets sit 1.5 m, air targets 15 m above the cell.
vi.mock('./gpu-cube-resolve', () => ({
  isCubeVisible: vi.fn((...args: number[]) => args[4] < 10),
}));

import { isCubeVisible } from './gpu-cube-resolve';
import { resolveTowerLos, resolveTowerLosIncremental } from './route-grid-los';

const cell = (x: number, z: number, terrainHeight: number) =>
  ({ x, z, terrainHeight, towerVisibility: new Map(), airVisibility: new Map() }) as unknown as RouteCell;

/** A sampler whose sampleCellY reports a height change for the cells `moved` picks. */
const sampler = (moved: (c: RouteCell) => boolean = () => false) =>
  ({ sampleCellY: vi.fn(moved) }) as unknown as RouteCellSampler;

const ctx = { referencePos: { x: 0, y: 20, z: 0 } } as unknown as LosResolveContext;
const cube = isCubeVisible as unknown as MockInstance;

describe('resolveTowerLos', () => {
  // Ground and air below the wall, ground only, neither; one out of range.
  let low: RouteCell;
  let mid: RouteCell;
  let high: RouteCell;
  let far: RouteCell;

  beforeEach(() => {
    cube.mockClear();
    low = cell(3, 0, -10);
    mid = cell(4, 0, 0);
    high = cell(5, 0, 9);
    far = cell(20, 0, 0);
  });

  it('answers ground and air and lists the cells it sees anything in', () => {
    const pass = resolveTowerLos([low, mid, high, far], sampler(), 't1', 0, 0, 10, ctx, true, true);

    expect(pass).toEqual({ visible: [low, mid], changed: [] });
    expect([low, mid, high].map((c) => [c.towerVisibility.get('t1'), c.airVisibility.get('t1')]))
      .toEqual([[true, true], [true, false], [false, false]]);
    expect(far.towerVisibility.size + far.airVisibility.size).toBe(0);
  });

  it('sees the cell it stands on without asking the cube', () => {
    const own = cell(0.05, 0, 50);
    expect(resolveTowerLos([own], sampler(), 't1', 0, 0, 10, ctx, true, true).visible).toEqual([own]);
    expect(cube).not.toHaveBeenCalled();
  });

  it('answers only for what the tower targets and reports the heights it moved', () => {
    const pass = resolveTowerLos([low, mid], sampler((c) => c === mid), 't1', 0, 0, 10, ctx, false, true);
    expect(pass).toEqual({ visible: [low], changed: [mid] });
    expect(low.towerVisibility.has('t1')).toBe(false);
    expect(mid.airVisibility.get('t1')).toBe(false);
  });
});

describe('resolveTowerLosIncremental', () => {
  beforeEach(() => cube.mockClear());

  it('reuses the answers it has and asks the cube only for the new cells', () => {
    const inner = cell(3, 0, 0);
    const outer = cell(8, 0, 0);
    resolveTowerLos([inner], sampler(), 't1', 0, 0, 5, ctx, true, false);
    cube.mockClear();

    const pass = resolveTowerLosIncremental([inner, outer], sampler(), 't1', 0, 0, 10, ctx, true, false);
    expect(pass.visible).toEqual([inner, outer]);
    expect(cube).toHaveBeenCalledOnce();
    expect(cube.mock.calls[0][3]).toBe(8);
  });

  it('asks again where the sampling moved the height under a cached answer', () => {
    const moved = cell(3, 0, 0);
    moved.towerVisibility.set('t1', false); // answered for the old height
    const pass = resolveTowerLosIncremental([moved], sampler(() => true), 't1', 0, 0, 10, ctx, true, false);
    expect(pass).toEqual({ visible: [moved], changed: [moved] });
    expect(moved.towerVisibility.get('t1')).toBe(true);
  });

  it('drops answers outside the new circle and for a capability the tower lost', () => {
    const corner = cell(8, 8, 0); // in the range box, 11.3 m off
    const inside = cell(3, 0, 0);
    for (const c of [corner, inside]) {
      c.towerVisibility.set('t1', true);
      c.airVisibility.set('t1', true);
    }
    resolveTowerLosIncremental([corner, inside], sampler(), 't1', 0, 0, 10, ctx, true, false);
    expect(corner.towerVisibility.has('t1') || corner.airVisibility.has('t1')).toBe(false);
    expect(inside.towerVisibility.get('t1')).toBe(true);
    expect(inside.airVisibility.has('t1')).toBe(false);
  });
});
