import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CorridorBuild, type CorridorBuildDeps, type CorridorMeasurement } from './corridor-build';
import { MUTED_CAMERA_ERROR_TARGET, QUIET_MS } from '../../three-engine/tiles-lod-debug';
import { ROUTE_CORRIDOR_COARSE_ERROR_TARGET, ROUTE_CORRIDOR_ERROR_TARGET } from '../../three-engine/route-corridor-region';
import { resetCorridorConfig, setCorridorConfig } from '../../utils/route-corridor';

/**
 * CorridorBuild builds the route corridor once per route set and freezes it:
 * camera muted and region at the finest level until the tiles are quiet,
 * every station measured in slices, the fallback level for stations and
 * cells the finest has no column for, routes and cells until the walk check
 * narrows nothing more, the route line last, camera and region back. These
 * tests drive it on a fake clock (16 ms a frame) against a fake tile handle,
 * route service and grid, and pin the order of what it asks of them.
 */
describe('CorridorBuild', () => {
  const FRAME_MS = 16;
  const SPAWNS = [{ id: 'spawn-1' }];
  const PATHS = new Map([['spawn-1', []]]);
  const FINE = `region ${ROUTE_CORRIDOR_ERROR_TARGET}`;
  /** The build falls back to this level, and the region rests at it once the build freezes. */
  const COARSE = `region ${ROUTE_CORRIDOR_COARSE_ERROR_TARGET}`;
  const MUTED = `camera ${MUTED_CAMERA_ERROR_TARGET}`;

  let clock: number;
  let calls: string[];
  let camera: number;
  let runs: (CorridorMeasurement & { budgets: number[] })[];
  let state: {
    towers: number;
    enemies: number;
    phase: string;
    engine: boolean;
    tiles: boolean;
    /** The tiles load until this time on the clock; Infinity: they never settle. */
    loadingUntil: number;
    epoch: number;
    /** Slices each measurement takes. */
    slices: number;
    /** What unmeasuredStations answers, one per call, the last one repeats. */
    unmeasured: number[];
    /** narrowToWalkable answers true this many times more. */
    narrow: number;
    /** What walkState answers, one per call, the last one repeats; null: a new state each call. */
    walkStates: string[] | null;
    /** Cells without a height, and how many of them the fallback level gives one. */
    bare: number;
    promoted: number;
    animation: boolean;
  };
  let corridor: CorridorBuild;

  function create(): CorridorBuild {
    const tiles = {
      snapshot: () => ({ cameraErrorTarget: camera }),
      busy: () => clock < state.loadingUntil,
      setRegionErrorTarget: (metres: number) => {
        calls.push(`region ${metres}`);
        return true;
      },
      setCameraErrorTarget: (px: number) => {
        calls.push(`camera ${px}`);
        camera = px;
      },
      holdSettled: vi.fn(),
    };
    const engine = {
      tilesLodDebug: () => (state.tiles ? tiles : null),
      terrain: { clearHeightCache: () => calls.push('clearColumns') },
      routeCorridorLod: () => null,
    };
    const grid = {
      getStats: () => ({ totalCells: 42 }),
      snapshotHeights: () => new Map(),
      cellsWithoutHeight: () => state.bare,
      retryUnsampledCells: () => {
        calls.push('retryCells');
        state.bare = 0;
        return { promoted: state.promoted };
      },
      initSpatialGridVisualizationIfEnabled: () => calls.push('overlays'),
      initAirSpatialGridVisualizationIfEnabled: vi.fn(),
      initAirRouteLayerIfEnabled: vi.fn(),
    };
    let walkCall = 0;
    const pathRoute = {
      routesEpoch: () => state.epoch,
      beginClearanceMeasurement: () => {
        calls.push('measure');
        let left = state.slices;
        const run = {
          open: true,
          budgets: [] as number[],
          get progress() {
            return { done: state.slices - left, total: state.slices };
          },
          step: (budget: number) => {
            run.budgets.push(budget);
            left = budget === Infinity ? 0 : left - 1;
            return left <= 0;
          },
          commit: () => {
            calls.push('commit');
            run.open = false;
            return true;
          },
          cancel: (reason: string) => {
            calls.push(`cancel ${reason}`);
            run.open = false;
          },
        };
        runs.push(run);
        return run;
      },
      unmeasuredStations: () => (state.unmeasured.length > 1 ? state.unmeasured.shift()! : state.unmeasured[0]),
      resetWalkCaps: () => calls.push('resetWalkCaps'),
      walkState: () => {
        if (state.walkStates === null) return `state ${walkCall++}`;
        return state.walkStates.length > 1 ? state.walkStates.shift()! : state.walkStates[0];
      },
      narrowToWalkable: () => {
        calls.push('narrow');
        return state.narrow-- > 0;
      },
      clearCorridorMeasurements: () => calls.push('clearMeasurements'),
      refreshRouteLines: (spawns: unknown) => {
        expect(spawns).toBe(SPAWNS);
        calls.push('routes');
      },
      getCachedPaths: () => PATHS,
    };
    const gameState = {
      towerCount: () => state.towers,
      enemyManager: { getAliveCount: () => state.enemies },
      waveManager: { phase: () => state.phase },
      getGlobalRouteGrid: () => grid,
      rebuildRouteCells: () => calls.push('cells'),
    };
    return new CorridorBuild({
      gameState: () => gameState,
      engineInit: { getEngine: () => (state.engine ? engine : null) },
      pathRoute,
      routeAnimation: { isRunning: () => state.animation, startAnimation: () => calls.push('animation') },
      store: { spawnPoints: () => SPAWNS },
      nextFrame: async () => {
        clock += FRAME_MS;
      },
      now: () => clock,
    } as unknown as CorridorBuildDeps);
  }

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    clock = 0;
    calls = [];
    camera = 20;
    runs = [];
    state = {
      towers: 0, enemies: 0, phase: 'setup', engine: true, tiles: true, loadingUntil: 0, epoch: 1, slices: 1,
      unmeasured: [0], narrow: 0, walkStates: null, bare: 0, promoted: 0, animation: false,
    };
    corridor = create();
  });

  afterEach(() => {
    corridor.dispose();
    resetCorridorConfig();
    vi.restoreAllMocks();
  });

  describe('build', () => {
    it('mutes the camera, loads the region at the finest level, measures in slices, builds until nothing narrows, then the line; camera back', async () => {
      state.loadingUntil = 100;
      state.slices = 3;
      state.narrow = 1;

      const result = await corridor.build('location load');

      expect(calls).toEqual([
        MUTED, FINE,
        // Columns from these tiles only; walk caps from this build's grids only
        'clearColumns', 'resetWalkCaps', 'measure', 'commit',
        'routes', 'cells', 'narrow',
        'routes', 'cells', 'narrow',
        'routes', 'overlays',
        'camera 20', COARSE,
      ]);
      expect(runs[0].budgets).toEqual([CorridorBuild.SLICE_MS, CorridorBuild.SLICE_MS, CorridorBuild.SLICE_MS]);
      expect(result).toMatchObject({ stations: 3, unmeasured: 0, passes: 2, timedOut: false, fallbackStations: 0, fallbackCells: 0, cells: 42 });
      // The tiles loaded until 100 ms, then half a second of quiet
      expect(clock).toBeGreaterThanOrEqual(100 + QUIET_MS);
      expect(vi.mocked(console.log)).toHaveBeenCalledWith(expect.stringMatching(
        /^\[Corridor\] build: reason=location load tiles=\d+\.\d measure=\d+\.\d fallback=0\.0 passes=2 \(\d+\.\d\) lines=\d+\.\d wall=\d+\.\dms stations=3 unmeasured=0 cells=42$/,
      ));
    });

    it('is pending from expect() until the corridor is frozen', async () => {
      const ticket = corridor.expect();
      expect(corridor.pending()).toBe(true);
      const building = corridor.build('location load', undefined, ticket);
      expect(corridor.pending()).toBe(true);
      await building;
      expect(corridor.pending()).toBe(false);
    });

    it('reports its steps and the share of the stations measured', async () => {
      state.slices = 4;
      const steps: string[] = [];
      await corridor.build('location load', ({ step, percent }) => steps.push(percent === null ? step : `${step} ${percent}`));
      expect(steps).toEqual([
        'Loading the corridor tiles',
        'Measuring the corridor 25', 'Measuring the corridor 50', 'Measuring the corridor 75',
        'Building the corridor',
      ]);
    });

    it('builds with what came when the tiles do not settle within the timeout, and says so', async () => {
      state.loadingUntil = Infinity;
      const result = await corridor.build('location load');
      expect(result?.timedOut).toBe(true);
      expect(clock).toBeGreaterThanOrEqual(CorridorBuild.TILES_TIMEOUT_MS);
      expect(calls).toContain('measure');
      expect(vi.mocked(console.log)).toHaveBeenCalledWith(expect.stringMatching(/ tiles timed out$/));
    });

    it('measures the stations the finest level has no column for on the fallback level, then goes back', async () => {
      state.unmeasured = [4, 0];
      const result = await corridor.build('location load');

      expect(calls.slice(0, 13)).toEqual([
        MUTED, FINE, 'clearColumns', 'resetWalkCaps', 'measure', 'commit',
        COARSE, 'clearColumns', 'measure', 'commit', FINE, 'clearColumns',
        'routes',
      ]);
      // What is left, in one go
      expect(runs[1].budgets).toEqual([Infinity]);
      expect(result).toMatchObject({ fallbackStations: 4, unmeasured: 0 });
    });

    it('gives cells without a height a sample on the fallback level once the passes are done, before the line', async () => {
      state.bare = 3;
      state.promoted = 2;
      const result = await corridor.build('location load');

      const retry = calls.indexOf('retryCells');
      expect(calls.slice(retry - 3, retry + 4)).toEqual(['narrow', COARSE, 'clearColumns', 'retryCells', FINE, 'clearColumns', 'routes']);
      expect(result?.fallbackCells).toBe(2);
    });

    /**
     * Only a build needs the finest level. Holding it for the whole session
     * cost 39 to 166 MB of active tiles (phase 0). The region stays, at the
     * coarse level: it keeps the corridor tiles active off screen, which the
     * tower LOS cubemap and the CPU raycast fallback need.
     */
    it('leaves the region at the coarse level when it freezes, and raises it again for the next build', async () => {
      await corridor.build('location load');
      expect(calls.slice(-2)).toEqual(['camera 20', COARSE]);

      calls.length = 0;
      await corridor.build('HQ moved in place');
      expect(calls.slice(0, 2)).toEqual([MUTED, FINE]);
      expect(calls.slice(-2)).toEqual(['camera 20', COARSE]);
    });

    it('without tiles (DevWorld) measures and builds at once: no tile wait, no fallback level', async () => {
      state.tiles = false;
      state.unmeasured = [4];
      state.bare = 3;
      const result = await corridor.build('location load');

      expect(calls).toEqual(['clearColumns', 'resetWalkCaps', 'measure', 'commit', 'routes', 'cells', 'narrow', 'routes', 'overlays']);
      expect(clock).toBe(0);
      expect(result).toMatchObject({ unmeasured: 4, fallbackStations: 0, fallbackCells: 0 });
    });

    it('restarts a running route animation on the frozen routes', async () => {
      state.animation = true;
      await corridor.build('location load');
      expect(calls.slice(-5, -2)).toEqual(['routes', 'overlays', 'animation']);
    });
  });

  describe('until nothing narrows', () => {
    it('stops passes that come back to an earlier state, builds the last plan once more and warns', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      state.narrow = 100;
      state.walkStates = ['empty', 'a', 'b', 'a'];

      const result = await corridor.build('location load');

      expect(result?.passes).toBe(3);
      expect(warn).toHaveBeenCalledWith(
        '[Corridor] build did not settle: walk caps and detours came back to an earlier state; frozen with the last plan',
      );
      expect(calls.slice(-7)).toEqual(['narrow', 'routes', 'cells', 'routes', 'overlays', 'camera 20', COARSE]);
    });

    it('stops after MAX_PASSES passes that keep narrowing', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      state.narrow = 1000;
      const result = await corridor.build('location load');
      expect(result?.passes).toBe(CorridorBuild.MAX_PASSES);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(`still narrowing after ${CorridorBuild.MAX_PASSES} passes`));
    });
  });

  describe('stopping', () => {
    it('stops when a newer build begins; the newer one gives the camera back', async () => {
      state.loadingUntil = 1000;
      const first = corridor.build('location load');
      const second = corridor.build('HQ moved in place');

      expect(await first).toBeNull();
      expect(await second).not.toBeNull();
      expect(calls.filter((call) => call === 'measure')).toHaveLength(1);
      expect(camera).toBe(20);
      expect(corridor.pending()).toBe(false);
    });

    it('stops when the routes are replaced while the tiles load, and gives the camera back', async () => {
      state.loadingUntil = 1000;
      const building = corridor.build('location load');
      state.epoch++;
      expect(await building).toBeNull();
      expect(calls).toEqual([MUTED, FINE, 'camera 20', COARSE]);
      expect(corridor.pending()).toBe(false);
    });

    it('cancels its measurement when the routes are replaced in the middle of it', async () => {
      state.tiles = false;
      state.slices = 5;
      const building = corridor.build('location load');
      state.epoch++;
      expect(await building).toBeNull();
      expect(calls).toEqual(['clearColumns', 'resetWalkCaps', 'measure', 'cancel routes replaced']);
    });

    it('stops a build under way on dispose and gives the camera back at once', async () => {
      state.loadingUntil = 1000;
      const building = corridor.build('location load');
      corridor.dispose();
      expect(camera).toBe(20);
      expect(corridor.pending()).toBe(false);
      expect(await building).toBeNull();
      expect(calls).not.toContain('measure');
    });
  });

  describe('change, for __corridor.set() and reset()', () => {
    it('refuses without a location, under towers, a wave or enemies, and while a build is under way', async () => {
      state.engine = false;
      expect(await corridor.change(() => [])).toBe('Not changed: no location loaded.');
      state.engine = true;
      state.towers = 1;
      expect(await corridor.change(() => [])).toBe('Not changed: towers stand on the map, sell them first.');
      state.towers = 0;
      state.phase = 'wave';
      expect(await corridor.change(() => [])).toBe('Not changed: a wave is running.');
      state.phase = 'setup';
      state.enemies = 1;
      expect(await corridor.change(() => [])).toBe('Not changed: enemies are on the map.');
      state.enemies = 0;
      corridor.expect();
      expect(await corridor.change(() => [])).toBe('Not changed: the corridor is being built.');
      expect(calls).toEqual([]);
    });

    it('builds with the new settings, measuring every station again where they move the stations or the rays', async () => {
      await expect(corridor.change(() => setCorridorConfig({ bulgeLength: 12 })))
        .resolves.toBe('Corridor rebuilt: 42 cells. Widths per stretch: __routes.describe()');
      expect(calls).not.toContain('clearMeasurements');

      calls.length = 0;
      await expect(corridor.change(() => setCorridorConfig({ maxHalfWidth: 6 })))
        .resolves.toBe('Corridor rebuilt, measured again: 42 cells. Widths per stretch: __routes.describe()');
      expect(calls.indexOf('clearMeasurements')).toBeLessThan(calls.indexOf('measure'));
    });

    it('passes the problems of a rejected setting on and builds nothing', async () => {
      expect(await corridor.change(() => ['noSuchSetting is no corridor setting'])).toBe('Not changed: noSuchSetting is no corridor setting.');
      expect(calls).toEqual([]);
    });
  });
});
