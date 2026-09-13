import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { RouteCell } from './route-cell';
import type { RouteCellSampler } from './route-cell-sampler';
import { RouteGridHeightSweep } from './route-grid-height-sweep';

const cells = (count: number, sampledFrom = count) =>
  Array.from({ length: count }, (_, key) =>
    ({ key, heightSampled: key >= sampledFrom, sample: { state: key >= sampledFrom ? 'stable' : 'unsampled' } }) as RouteCell);

/** A sampler whose sampleCellY reports a height change for the cells `moves` picks. */
function fakeSampler(moves: (cell: RouteCell) => boolean) {
  return {
    columnSampler: () => null,
    terrainPeekLOD: null,
    peekSkipCount: 7,
    raycastCount: 7,
    sampleCellY: vi.fn(moves),
  } as unknown as RouteCellSampler & { sampleCellY: MockInstance };
}

describe('RouteGridHeightSweep', () => {
  let warn: MockInstance;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => warn.mockRestore());

  it('runs every cell in one step with an unlimited budget and reports the moved ones once', () => {
    const onSlice = vi.fn();
    const sweep = new RouteGridHeightSweep(fakeSampler((c) => c.key % 2 === 0), onSlice);
    // Keys 0-4 unsampled, 5-9 sampled; the even ones move.
    sweep.begin(cells(10, 5));

    expect(sweep.step(Infinity)).toEqual({ done: true, processed: 10, changed: 5 });
    expect(onSlice).toHaveBeenCalledOnce();
    expect(onSlice.mock.calls[0][0].map((c: RouteCell) => c.key)).toEqual([0, 2, 4, 6, 8]);
    expect(sweep.active).toBe(false);

    expect(warn).toHaveBeenCalledOnce();
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain('[PerfTrace] updateTerrainHeights:');
    expect(line).toContain('slices=1 | cells=10 peekSkipped=0 (0.0%) raycasted=0 promoted=3 refreshed=2 peekAvailable=false');
  });

  it('yields every 32 cells once the budget is spent and hands over each slice on its own', () => {
    const onSlice = vi.fn();
    const sweep = new RouteGridHeightSweep(fakeSampler(() => true), onSlice);
    sweep.begin(cells(70));

    expect(sweep.step(0)).toEqual({ done: false, processed: 32, changed: 32 });
    expect(sweep.active).toBe(true);
    expect(sweep.step(0)).toEqual({ done: false, processed: 32, changed: 32 });
    expect(sweep.step(0)).toEqual({ done: true, processed: 6, changed: 6 });
    expect(onSlice.mock.calls.map(([changed]) => changed.length)).toEqual([32, 32, 6]);
    expect(String(warn.mock.calls[0][0])).toContain('slices=3');
  });

  it('starts over when begun again', () => {
    const sampler = fakeSampler(() => false);
    const sweep = new RouteGridHeightSweep(sampler, vi.fn());
    sweep.begin(cells(70));
    sweep.step(0);

    sweep.begin(cells(5));
    expect(sweep.step(Infinity)).toEqual({ done: true, processed: 5, changed: 0 });
  });

  it('drops a sweep in flight on abort', () => {
    const sampler = fakeSampler(() => true);
    const sweep = new RouteGridHeightSweep(sampler, vi.fn());
    sweep.begin(cells(5));
    sweep.abort();

    expect(sweep.active).toBe(false);
    expect(sweep.step(Infinity)).toEqual({ done: true, processed: 0, changed: 0 });
    expect(sampler.sampleCellY).not.toHaveBeenCalled();
  });

  it('does not start without a column sampler', () => {
    const sampler = fakeSampler(() => true);
    (sampler as { columnSampler: unknown }).columnSampler = null;
    const sweep = new RouteGridHeightSweep(sampler, vi.fn());
    sweep.begin(cells(5));
    expect(sweep.active).toBe(false);
  });
});
