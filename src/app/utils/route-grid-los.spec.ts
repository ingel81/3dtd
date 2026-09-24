import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { RouteCell } from './route-cell';
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

const ctx = { referencePos: { x: 0, y: 20, z: 0 } } as unknown as LosResolveContext;
const ownHeight = (c: RouteCell) => c.terrainHeight;
const cube = isCubeVisible as unknown as MockInstance;

describe('resolveTowerLos', () => {
  // Ground and air below the wall, ground only, neither. The caller hands
  // over the cells in reach (GlobalRouteGrid.forEachSlotInReach).
  let low: RouteCell;
  let mid: RouteCell;
  let high: RouteCell;

  beforeEach(() => {
    cube.mockClear();
    low = cell(3, 0, -10);
    mid = cell(4, 0, 0);
    high = cell(5, 0, 9);
  });

  it('answers ground and air for every candidate and lists the cells it sees anything in', () => {
    const visible = resolveTowerLos([low, mid, high], 't1', 0, 0, ctx, true, true, ownHeight);

    expect(visible).toEqual([low, mid]);
    expect([low, mid, high].map((c) => [c.towerVisibility.get('t1'), c.airVisibility.get('t1')]))
      .toEqual([[true, true], [true, false], [false, false]]);
  });

  it('sees the cell it stands on without asking the cube', () => {
    const own = cell(0.05, 0, 50);
    expect(resolveTowerLos([own], 't1', 0, 0, ctx, true, true, ownHeight)).toEqual([own]);
    expect(cube).not.toHaveBeenCalled();
  });

  it('answers only for what the tower targets', () => {
    const visible = resolveTowerLos([low, mid], 't1', 0, 0, ctx, false, true, ownHeight);
    expect(visible).toEqual([low]);
    expect(low.towerVisibility.has('t1')).toBe(false);
    expect(mid.airVisibility.get('t1')).toBe(false);
  });

  it('samples above the height enemies stand on, not the anchor a cell without a height holds', () => {
    // Playtest 743: a cell without a height of its own keeps its route
    // anchor, 30 m under the square the enemies walk on beside it.
    const hole = cell(3, 0, -30);
    const onSquare = (c: RouteCell) => (c === hole ? 9 : c.terrainHeight);

    resolveTowerLos([hole], 't1', 0, 0, ctx, true, true, onSquare);

    expect(cube.mock.calls.map((args) => args[4])).toEqual([10.5, 24]);
    expect([hole.towerVisibility.get('t1'), hole.airVisibility.get('t1')]).toEqual([false, false]);
  });

  it('samples no cell height: the cells are the ones the corridor build froze', () => {
    const frozen = cell(3, 0, 0);
    resolveTowerLos([frozen], 't1', 0, 0, ctx, true, false, ownHeight);
    expect(frozen.terrainHeight).toBe(0);
  });
});

describe('resolveTowerLosIncremental', () => {
  beforeEach(() => cube.mockClear());

  it('reuses the answers it has and asks the cube only for the new cells', () => {
    const inner = cell(3, 0, 0);
    const outer = cell(8, 0, 0);
    resolveTowerLos([inner], 't1', 0, 0, ctx, true, false, ownHeight);
    cube.mockClear();

    const visible = resolveTowerLosIncremental([inner, outer], 't1', 0, 0, ctx, true, false, ownHeight);
    expect(visible).toEqual([inner, outer]);
    expect(cube).toHaveBeenCalledOnce();
    expect(cube.mock.calls[0][3]).toBe(8);
  });

  it('answers a cell whose entry the caller dropped, as after a research retrofit', () => {
    const retrofitted = cell(3, 0, 0);
    retrofitted.towerVisibility.set('t1', false);
    retrofitted.towerVisibility.delete('t1');
    const visible = resolveTowerLosIncremental([retrofitted], 't1', 0, 0, ctx, true, false, ownHeight);
    expect(visible).toEqual([retrofitted]);
    expect(retrofitted.towerVisibility.get('t1')).toBe(true);
  });

  it('drops the answers for a capability the tower lost', () => {
    const inside = cell(3, 0, 0);
    inside.towerVisibility.set('t1', true);
    inside.airVisibility.set('t1', true);
    resolveTowerLosIncremental([inside], 't1', 0, 0, ctx, true, false, ownHeight);
    expect(inside.towerVisibility.get('t1')).toBe(true);
    expect(inside.airVisibility.has('t1')).toBe(false);
  });
});
