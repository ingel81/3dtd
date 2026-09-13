import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteGridConvergence, type RouteGridConvergenceDeps } from './route-grid-convergence';

/**
 * After a tile load the route grid refreshes its cell heights in a
 * frame-budgeted sweep, then retries unsampled cells until two frames in a
 * row promote none. Route line, markers and route animation copy cell
 * heights, so they are rebuilt when cells change, at most once a frame and,
 * while a sweep runs, once at its end.
 */
describe('RouteGridConvergence', () => {
  const SPAWNS = [{ id: 'spawn-1' }];

  let frames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;
  let sweepFrames: number;
  let cachedPaths: Map<string, unknown[]>;
  let cellsChanged: (() => void) | null;
  let grid: ReturnType<typeof fakeGrid>;
  let deps: ReturnType<typeof fakeDeps>;
  let convergence: RouteGridConvergence;

  function fakeGrid() {
    return {
      cellsOff: vi.fn(),
      addCellsChangedListener: vi.fn((listener: () => void) => {
        cellsChanged = listener;
        return grid.cellsOff;
      }),
      isTerrainRefreshActive: vi.fn(() => sweepFrames > 0),
      stepTerrainHeightRefresh: vi.fn(() => { sweepFrames--; }),
      retryUnsampledCells: vi.fn(() => ({ promoted: 0 })),
    };
  }

  function fakeDeps() {
    return {
      grid: () => grid,
      store: { spawnPoints: () => SPAWNS },
      pathRoute: { refreshRouteLines: vi.fn(), getCachedPaths: vi.fn(() => cachedPaths) },
      markerViz: { updateMarkerHeights: vi.fn() },
      routeAnimation: { isRunning: vi.fn(() => false), startAnimation: vi.fn() },
      settled: vi.fn(),
    };
  }

  const runFrames = (times = 1) => {
    for (let i = 0; i < times; i++) {
      const due = [...frames.values()];
      frames.clear();
      for (const callback of due) callback(0);
    }
  };

  beforeEach(() => {
    frames = new Map();
    nextFrameId = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    sweepFrames = 0;
    cachedPaths = new Map([['spawn-1', []]]);
    cellsChanged = null;
    grid = fakeGrid();
    deps = fakeDeps();
    convergence = new RouteGridConvergence(deps as unknown as RouteGridConvergenceDeps);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('baked heights', () => {
    it('rebuilds route line and markers once per frame when cells change', () => {
      convergence.followCells();
      cellsChanged!();
      cellsChanged!();
      expect(deps.pathRoute.refreshRouteLines).not.toHaveBeenCalled();

      runFrames();

      expect(deps.pathRoute.refreshRouteLines).toHaveBeenCalledTimes(1);
      expect(deps.pathRoute.refreshRouteLines).toHaveBeenCalledWith(SPAWNS);
      expect(deps.markerViz.updateMarkerHeights).toHaveBeenCalledTimes(1);
      expect(deps.routeAnimation.startAnimation).not.toHaveBeenCalled();
    });

    it('restarts a running route animation, but only with routes', () => {
      deps.routeAnimation.isRunning.mockReturnValue(true);
      convergence.scheduleBakedHeightRefresh();
      runFrames();
      expect(deps.routeAnimation.startAnimation).toHaveBeenCalledWith(cachedPaths, SPAWNS);

      cachedPaths = new Map();
      convergence.scheduleBakedHeightRefresh();
      runFrames();
      expect(deps.routeAnimation.startAnimation).toHaveBeenCalledTimes(1);
    });

    it('keeps one cells-changed subscription across location changes', () => {
      convergence.followCells();
      convergence.followCells();
      expect(grid.addCellsChangedListener).toHaveBeenCalledTimes(2);
      expect(grid.cellsOff).toHaveBeenCalledTimes(1);
    });
  });

  describe('convergence loop', () => {
    it('steps the sweep, retries unsampled cells until two empty frames, then rebuilds once', () => {
      sweepFrames = 2;
      grid.retryUnsampledCells
        .mockReturnValueOnce({ promoted: 3 })
        .mockReturnValueOnce({ promoted: 0 })
        .mockReturnValueOnce({ promoted: 0 });

      convergence.scheduleBakedHeightRefresh();
      convergence.schedule();
      runFrames(2);
      expect(grid.stepTerrainHeightRefresh.mock.calls).toEqual([
        [RouteGridConvergence.TERRAIN_REFRESH_BUDGET_MS],
        [RouteGridConvergence.TERRAIN_REFRESH_BUDGET_MS],
      ]);
      expect(grid.retryUnsampledCells).not.toHaveBeenCalled();

      runFrames(3);
      expect(grid.retryUnsampledCells).toHaveBeenCalledTimes(3);
      expect(deps.settled).toHaveBeenCalledTimes(1);
      // The rebuild held back during the sweep runs in the next frame.
      expect(deps.pathRoute.refreshRouteLines).not.toHaveBeenCalled();
      runFrames();
      expect(deps.pathRoute.refreshRouteLines).toHaveBeenCalledTimes(1);
      expect(frames.size).toBe(0);
    });

    it('settles without a rebuild when nothing was held back', () => {
      convergence.schedule();
      runFrames(2);
      expect(deps.settled).toHaveBeenCalledTimes(1);
      expect(frames.size).toBe(0);
      expect(deps.pathRoute.refreshRouteLines).not.toHaveBeenCalled();
    });

    it('gives up retrying after 120 frames that keep promoting cells', () => {
      grid.retryUnsampledCells.mockReturnValue({ promoted: 1 });
      convergence.schedule();
      runFrames(125);
      expect(grid.retryUnsampledCells).toHaveBeenCalledTimes(120);
      expect(deps.settled).toHaveBeenCalledTimes(1);
      expect(frames.size).toBe(0);
    });

    it('does not let the cap end a sweep in flight', () => {
      sweepFrames = 200;
      convergence.schedule();
      runFrames(200);
      expect(grid.stepTerrainHeightRefresh).toHaveBeenCalledTimes(200);
      expect(deps.settled).not.toHaveBeenCalled();
    });

    it('runs one loop however often it is scheduled', () => {
      convergence.schedule();
      convergence.schedule();
      runFrames();
      expect(grid.retryUnsampledCells).toHaveBeenCalledTimes(1);
    });
  });

  describe('dispose', () => {
    it('stops the loop, drops the listener and forgets a held-back rebuild', () => {
      convergence.followCells();
      sweepFrames = 1;
      convergence.scheduleBakedHeightRefresh();
      grid.retryUnsampledCells.mockReturnValue({ promoted: 1 });
      convergence.schedule();
      runFrames(3);

      convergence.dispose();
      runFrames(3);

      expect(grid.cellsOff).toHaveBeenCalledTimes(1);
      expect(grid.retryUnsampledCells).toHaveBeenCalledTimes(2);
      expect(deps.settled).not.toHaveBeenCalled();
      expect(deps.pathRoute.refreshRouteLines).not.toHaveBeenCalled();
      expect(frames.size).toBe(0);
    });
  });
});
