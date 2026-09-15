import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CorridorController, type CorridorControllerDeps } from './corridor-controller';
import { CorridorRefit } from './corridor-refit';
import { RouteGridConvergence, type RouteGridConvergenceDeps } from './route-grid-convergence';
import { corridorTrace } from '../../utils/corridor-trace';
import type { RouteWaypoint } from '../../models/game.types';

/**
 * The corridor trace follows a tile batch through the loop that settles it
 * (RouteGridConvergence), the re-measurement that asks for (CorridorRefit)
 * and the rebuild after it (CorridorController): one line per event, each
 * with the chain that led to it. The measurement is a stub whose commit
 * notes walk caps as the only change, like a run without stations that takes
 * the caps of the grid in use (path-route.service.spec.ts, "traces a run
 * without stations").
 */
describe('corridor trace, from a tile batch to a rebuild', () => {
  const SPAWNS = [{ id: 'spawn-1' }];
  /** About 10 m of latitude. */
  const TEN_M = 10 / 111_320;
  /** 20 m of route, `right` the half width on the right of both segments. */
  const path = (right: number): RouteWaypoint[] => [
    { lat: 48, lon: 9, corridorLeft: 3, corridorRight: right },
    { lat: 48 + TEN_M, lon: 9, corridorLeft: 3, corridorRight: right },
    { lat: 48 + 2 * TEN_M, lon: 9 },
  ];

  let frames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;
  let lines: string[];
  let state: { intro: boolean; slices: number; cells: Map<number, number>; paths: Map<string, RouteWaypoint[]> };

  /** `event | trigger` of each line; LONG lines left out, they depend on the machine. */
  const events = () => lines
    .filter((line) => !line.startsWith('[CorridorTrace] LONG'))
    .map((line) => {
      const match = /^\[CorridorTrace\] \d+\.\d\ds (\S+)(?: .*)? \| (.*)$/.exec(line);
      return match ? `${match[1]} | ${match[2]}` : `unparsed: ${line}`;
    });
  const lineOf = (event: string) => lines.find((line) => line.includes(`s ${event} `)) ?? '';

  const runFrames = (times = 1) => {
    for (let i = 0; i < times; i++) {
      const due = [...frames.values()];
      frames.clear();
      for (const callback of due) callback(0);
    }
  };

  function create() {
    const grid = {
      clear: vi.fn(),
      updateTerrainHeights: vi.fn(),
      initSpatialGridVisualizationIfEnabled: vi.fn(),
      initAirSpatialGridVisualizationIfEnabled: vi.fn(),
      initAirRouteLayerIfEnabled: vi.fn(),
      getStats: () => ({ totalCells: state.cells.size }),
      snapshotHeights: () => new Map(state.cells),
      addCellsChangedListener: vi.fn(() => () => undefined),
      isTerrainRefreshActive: () => false,
      stepTerrainHeightRefresh: vi.fn(),
      retryUnsampledCells: () => ({ promoted: 0 }),
    };
    const gameState = {
      towerCount: () => 0,
      enemyManager: { getAliveCount: () => 0 },
      waveManager: { phase: () => 'setup' },
      getGlobalRouteGrid: () => grid,
      // The new cells: one more, one 0.5 m higher, one without a height.
      rebuildRouteCells: vi.fn(() => {
        state.cells = new Map([[1, 10], [2, 10.5], [3, NaN], [4, 11]]);
      }),
      setBeforeCorridorLock: vi.fn(),
    };
    const pathRoute = {
      beginClearanceMeasurement: vi.fn(() => {
        let left = state.slices;
        const run = {
          open: true,
          step: (budget: number) => {
            if (budget === Infinity) left = 0;
            return !run.open || --left <= 0;
          },
          commit: () => {
            run.open = false;
            corridorTrace.noteChange(['walkCaps']);
            return true;
          },
          cancel: () => {
            run.open = false;
          },
        };
        return run;
      }),
      hasUnmeasuredStations: () => true,
      hasUnwalkableCells: () => false,
      narrowToWalkable: () => false,
      clearCorridorMeasurements: vi.fn(),
      // Built again: wider on the right.
      refreshRouteLines: vi.fn(() => {
        state.paths = new Map([['spawn-1', path(5)]]);
      }),
      getCachedPaths: () => state.paths,
    };
    const controller = new CorridorController({
      gameState: () => gameState,
      engineInit: { getEngine: () => ({}) },
      introFlight: { isRunning: () => state.intro },
      pathRoute,
      routeAnimation: { isRunning: () => false, startAnimation: vi.fn() },
      store: { spawnPoints: () => SPAWNS },
      relocationStatus: { status: () => null },
    } as unknown as CorridorControllerDeps);
    const convergence = new RouteGridConvergence({
      grid: () => grid,
      store: { spawnPoints: () => SPAWNS },
      pathRoute: { refreshRouteLines: vi.fn(), getCachedPaths: () => state.paths },
      markerViz: { updateMarkerHeights: vi.fn() },
      routeAnimation: { isRunning: () => false, startAnimation: vi.fn() },
      settled: () => controller.remeasure(),
    } as unknown as RouteGridConvergenceDeps);
    return { controller, convergence, gameState };
  }

  /** What VisualizationFacadeService.onTilesLoaded does with a settled tile batch, as far as the trace goes. */
  function tilePush(convergence: RouteGridConvergence, lodVersion: number): void {
    const trace = corridorTrace.enter(`tilesLoaded lod=${lodVersion}`);
    corridorTrace.tiles(lodVersion, () => ({ tiles: 12, fine: 12, finest: 3, coarse: 0, pending: 0 }));
    convergence.scheduleBakedHeightRefresh();
    convergence.schedule();
    corridorTrace.exit(trace);
  }

  beforeEach(() => {
    frames = new Map();
    nextFrameId = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    lines = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      if (typeof line === 'string' && line.startsWith('[CorridorTrace]')) lines.push(line);
    });
    state = { intro: false, slices: 1, cells: new Map([[1, 10], [2, 10], [3, 10]]), paths: new Map([['spawn-1', path(3)]]) };
    corridorTrace.setEnabled(true);
    corridorTrace.begin('spec');
  });

  afterEach(() => {
    corridorTrace.setEnabled(false);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('prints one line per event, each with the chain from the tile batch to it', () => {
    const { convergence } = create();
    tilePush(convergence, 7);
    runFrames(2);

    const tiles = 'tilesLoaded lod=7';
    const refit = `${tiles} -> convergence.settled -> refit.remeasure`;
    expect(events()).toEqual([
      'load | spec',
      `tiles | ${tiles}`,
      `region.complete | ${tiles}`,
      `convergence.schedule | ${tiles}`,
      `routeLines.refresh | ${tiles}`,
      `convergence.settled | ${tiles}`,
      `refit.remeasure | ${refit}`,
      `refit.fit | ${refit}`,
      `rebuild | ${refit} -> rebuild`,
    ]);
    expect(lineOf('convergence.settled')).toMatch(/ frames=2 sweepFrames=0 retryPromoted=0 capped=false /);
    expect(lineOf('refit.remeasure')).toMatch(/ outcome=measure \| /);
    // Walk caps alone, no rays; a cell more, one moved, one lost its height; the right side 2 m wider all along.
    expect(lineOf('rebuild')).toMatch(
      / by=walkCaps rays=0 cells=3->4 added=1 removed=0 moved=1 maxMoveM=0\.5 lostHeight=1 gotHeight=0 widthPoints=10\/10 maxWidthChangeM=2 waypoints=3->3 narrowed=0 spawns=1 /,
    );
  });

  it('names the retries that measure a fit the intro flight held back', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    state.intro = true;
    const { controller } = create();
    corridorTrace.within('heightUpdate.done', () => controller.fitToTiles());
    vi.advanceTimersByTime(CorridorRefit.REMEASURE_INTERVAL_MS);
    state.intro = false;
    vi.advanceTimersByTime(CorridorRefit.REMEASURE_INTERVAL_MS);
    controller.dispose();

    const fit = 'heightUpdate.done -> refit.fitToTiles';
    const second = `${fit} -> refit.retry -> refit.retry`;
    expect(events()).toEqual([
      'load | spec',
      `refit.fit | ${fit}`,
      `refit.remeasure | ${fit} -> refit.retry`,
      `refit.remeasure | ${second}`,
      `refit.fit | ${second}`,
      `rebuild | ${second} -> rebuild`,
    ]);
    const outcomes = lines.map((line) => / outcome=([^|]*) \|/.exec(line)?.[1]).filter(Boolean);
    expect(outcomes).toEqual([
      'held for the intro flight', 'wait 3000ms (intro flight)', 'measure the fit held for the intro', 'measure',
    ]);
  });

  it('names the frame a sliced run ends in, and the tower that finishes one', () => {
    state.slices = 2;
    const { controller, gameState } = create();
    controller.attach();
    corridorTrace.within('heightUpdate.done', () => controller.fitToTiles());
    runFrames();

    state.slices = 3;
    corridorTrace.within('moved in place', () => controller.fitToTiles());
    const hook = gameState.setBeforeCorridorLock.mock.calls[0][0] as (reason: string) => void;
    hook('tower');

    expect(events()).toEqual([
      'load | spec',
      'refit.fit | heightUpdate.done -> refit.fitToTiles',
      'rebuild | heightUpdate.done -> refit.fitToTiles -> refit.slice -> rebuild',
      'refit.fit | moved in place -> refit.fitToTiles',
      'refit.flush | refit.flush tower',
      'rebuild | refit.flush tower -> rebuild',
    ]);
    expect(lineOf('refit.flush')).toMatch(/ reason=tower outcome=finish the run in one go \| /);
  });
});
