import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CorridorController, type CorridorControllerDeps } from './corridor-controller';
import { CorridorRefit } from './corridor-refit';

/**
 * CorridorController hooks CorridorRefit into the game: the animation
 * frames and timers it measures and retries in, the flush before a tower or
 * a wave, and the rebuild of routes, cells and route line when a
 * measurement changes a corridor. The rules themselves are pinned in
 * corridor-refit.spec.ts.
 */
describe('CorridorController', () => {
  const SPAWNS = [{ id: 'spawn-1' }];
  const PATHS = new Map([['spawn-1', []]]);

  let frames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;
  let state: { towers: number; engine: object | null; intro: boolean; unmeasured: boolean; changed: boolean; slices: number };
  let calls: string[];
  let runs: { open: boolean; step: ReturnType<typeof vi.fn>; commit: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }[];
  let gameState: ReturnType<typeof fakeGameState>;
  let routeAnimation: { isRunning: ReturnType<typeof vi.fn>; startAnimation: ReturnType<typeof vi.fn> };
  let pathRoute: ReturnType<typeof fakePathRoute>;

  const record = (name: string) => vi.fn(() => { calls.push(name); });

  function fakeGameState() {
    const grid = {
      clear: record('clear'),
      updateTerrainHeights: record('updateTerrainHeights'),
      initSpatialGridVisualizationIfEnabled: record('initSpatialGridVisualization'),
      initAirSpatialGridVisualizationIfEnabled: record('initAirSpatialGridVisualization'),
      initAirRouteLayerIfEnabled: record('initAirRouteLayer'),
      getStats: () => ({ totalCells: 42 }),
    };
    return {
      grid,
      towerCount: () => state.towers,
      enemyManager: { getAliveCount: () => 0 },
      waveManager: { phase: () => 'setup' },
      getGlobalRouteGrid: () => grid,
      initializeGlobalRouteGrid: record('initializeGlobalRouteGrid'),
      setBeforeCorridorLock: vi.fn(),
    };
  }

  function fakePathRoute() {
    return {
      beginClearanceMeasurement: vi.fn(() => {
        calls.push('measure');
        let left = state.slices;
        const run = {
          open: true,
          step: vi.fn((budget: number) => {
            if (budget === Infinity) left = 0;
            return !run.open || --left <= 0;
          }),
          commit: vi.fn(() => {
            const changed = run.open && state.changed;
            run.open = false;
            return changed;
          }),
          cancel: vi.fn(() => { run.open = false; }),
        };
        runs.push(run);
        return run;
      }),
      hasUnmeasuredStations: () => state.unmeasured,
      clearCorridorMeasurements: record('clearCorridorMeasurements'),
      refreshRouteLines: vi.fn((spawns: unknown) => {
        expect(spawns).toBe(SPAWNS);
        calls.push('refreshRouteLines');
      }),
      getCachedPaths: () => PATHS,
    };
  }

  function create(): CorridorController {
    const deps = {
      gameState: () => gameState,
      engineInit: { getEngine: () => state.engine },
      introFlight: { isRunning: () => state.intro },
      pathRoute,
      routeAnimation,
      store: { spawnPoints: () => SPAWNS },
    };
    return new CorridorController(deps as unknown as CorridorControllerDeps);
  }

  const runFrames = (times = 1) => {
    for (let i = 0; i < times; i++) {
      const due = [...frames.values()];
      frames.clear();
      for (const callback of due) callback(0);
    }
  };

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    frames = new Map();
    nextFrameId = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    state = { towers: 0, engine: {}, intro: false, unmeasured: true, changed: true, slices: 1 };
    calls = [];
    runs = [];
    gameState = fakeGameState();
    routeAnimation = { isRunning: vi.fn(() => false), startAnimation: vi.fn() };
    pathRoute = fakePathRoute();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('rebuild', () => {
    it('rebuilds routes, then cells, then the route line on their heights, then the overlays', () => {
      create().fitToTiles();

      expect(calls).toEqual([
        'measure',
        'refreshRouteLines',
        'clear',
        'initializeGlobalRouteGrid',
        'updateTerrainHeights',
        'refreshRouteLines',
        'initSpatialGridVisualization',
        'initAirSpatialGridVisualization',
        'initAirRouteLayer',
      ]);
      expect(routeAnimation.startAnimation).not.toHaveBeenCalled();
    });

    it('logs the time of each part, the spawns and the cells', () => {
      create().fitToTiles();

      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(vi.mocked(console.warn).mock.calls[0][0]).toMatch(
        /^\[Corridor\] rebuild: routes=\d+\.\d grid=\d+\.\d heights=\d+\.\d lines=\d+\.\d overlays=\d+\.\d total=\d+\.\dms spawns=1 cells=42$/,
      );
    });

    it('restarts a running route animation on the rebuilt routes', () => {
      routeAnimation.isRunning.mockReturnValue(true);
      create().fitToTiles();
      expect(routeAnimation.startAnimation).toHaveBeenCalledWith(PATHS, SPAWNS);
    });

    it('does not rebuild when the measurement changes no corridor', () => {
      state.changed = false;
      create().fitToTiles();
      expect(calls).toEqual(['measure']);
    });
  });

  describe('frames and timers', () => {
    it('measures a slice per animation frame and rebuilds once the run is done', () => {
      state.slices = 3;
      create().fitToTiles();
      expect(runs[0].step).toHaveBeenCalledTimes(1);
      expect(runs[0].step).toHaveBeenCalledWith(CorridorRefit.MEASURE_BUDGET_MS);

      runFrames();
      expect(calls).not.toContain('clear');
      runFrames();

      expect(runs[0].step).toHaveBeenCalledTimes(3);
      expect(calls.filter((call) => call === 'clear')).toHaveLength(1);
      expect(frames.size).toBe(0);
    });

    it('measures again after the interval when the intro flight held it back', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      state.intro = true;
      const controller = create();

      controller.remeasure();
      expect(pathRoute.beginClearanceMeasurement).not.toHaveBeenCalled();

      state.intro = false;
      vi.advanceTimersByTime(CorridorRefit.REMEASURE_INTERVAL_MS);
      expect(pathRoute.beginClearanceMeasurement).toHaveBeenCalledTimes(1);
      controller.dispose();
    });

    it('cancels the retry timer on dispose', () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      state.intro = true;
      const controller = create();
      controller.remeasure();

      controller.dispose();
      state.intro = false;
      vi.advanceTimersByTime(CorridorRefit.REMEASURE_INTERVAL_MS * 2);

      expect(pathRoute.beginClearanceMeasurement).not.toHaveBeenCalled();
    });
  });

  describe('flush hook and dispose', () => {
    it('hands the game state a hook that finishes a run under way', () => {
      state.slices = 3;
      const controller = create();
      controller.attach();
      controller.fitToTiles();
      const hook = gameState.setBeforeCorridorLock.mock.calls[0][0] as (reason: string) => void;

      hook('wave');

      expect(runs[0].step).toHaveBeenLastCalledWith(Infinity);
      expect(runs[0].commit).toHaveBeenCalledWith('wave');
      expect(calls).toContain('clear');
      expect(frames.size).toBe(0);
    });

    it('takes the hook back on dispose, once, and only after attach', () => {
      const controller = create();
      controller.dispose();
      expect(gameState.setBeforeCorridorLock).not.toHaveBeenCalled();

      controller.attach();
      controller.dispose();
      controller.dispose();

      expect(gameState.setBeforeCorridorLock.mock.calls.map(([hook]) => hook === null)).toEqual([false, true]);
    });

    it('drops a run under way and its frames on dispose', () => {
      state.slices = 3;
      const controller = create();
      controller.fitToTiles();

      controller.dispose();
      runFrames(3);

      expect(runs[0].cancel).toHaveBeenCalledWith('disposed');
      expect(calls).not.toContain('clear');
      expect(frames.size).toBe(0);
    });
  });

  describe('change', () => {
    it('refuses without a location and rebuilds with one', () => {
      state.engine = null;
      const controller = create();
      expect(controller.change(() => [])).toBe('Not changed: no location loaded.');
      expect(calls).toEqual([]);

      state.engine = {};
      expect(controller.change(() => [])).toBe(
        'Corridor rebuilt: 42 cells. Widths per stretch: __routes.describe()',
      );
      expect(calls).toContain('clear');
    });

    it('refuses while towers stand', () => {
      state.towers = 1;
      expect(create().change(() => [])).toBe('Not changed: towers stand on the map, sell them first.');
    });
  });
});
