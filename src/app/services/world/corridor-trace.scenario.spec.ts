import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CorridorBuild, type CorridorBuildDeps } from './corridor-build';
import { corridorTrace } from '../../utils/corridor-trace';
import type { RouteWaypoint } from '../../models/game.types';

/**
 * The corridor trace follows a corridor build (CorridorBuild) from the end of
 * the height update to the frozen corridor: one line per step, each with the
 * chain that led to it. The measurement is a stub whose commit notes new free
 * space; the tiles are a fake handle that is quiet from the first frame; each
 * frame is 100 ms on a fake clock.
 */
describe('corridor trace, from the loading screen to the frozen corridor', () => {
  const SPAWNS = [{ id: 'spawn-1' }];
  /** About 10 m of latitude. */
  const TEN_M = 10 / 111_320;
  /** 20 m of route, `right` the half width on the right of both segments. */
  const path = (right: number): RouteWaypoint[] => [
    { lat: 48, lon: 9, corridorLeft: 3, corridorRight: right },
    { lat: 48 + TEN_M, lon: 9, corridorLeft: 3, corridorRight: right },
    { lat: 48 + 2 * TEN_M, lon: 9 },
  ];

  let clock: number;
  let lines: string[];
  let state: { narrow: number; epoch: number; cells: Map<number, number>; paths: Map<string, RouteWaypoint[]> };

  /** `event | trigger` of each line; LONG lines left out, they depend on the machine. */
  const events = () => lines
    .filter((line) => !line.startsWith('[CorridorTrace] LONG'))
    .map((line) => {
      const match = /^\[CorridorTrace\] \d+\.\d\ds (\S+)(?: .*)? \| (.*)$/.exec(line);
      return match ? `${match[1]} | ${match[2]}` : `unparsed: ${line}`;
    });
  const lineOf = (event: string) => lines.find((line) => line.includes(`s ${event} `)) ?? '';

  function create(): CorridorBuild {
    const grid = {
      getStats: () => ({ totalCells: state.cells.size }),
      snapshotHeights: () => new Map(state.cells),
      cellsWithoutHeight: () => 0,
      retryUnsampledCells: () => ({ promoted: 0 }),
      initSpatialGridVisualizationIfEnabled: vi.fn(),
      initAirSpatialGridVisualizationIfEnabled: vi.fn(),
      initAirRouteLayerIfEnabled: vi.fn(),
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
    };
    const pathRoute = {
      routesEpoch: () => state.epoch,
      beginClearanceMeasurement: vi.fn(() => {
        const run = {
          open: true,
          progress: { done: 0, total: 20 },
          step: () => {
            run.progress = { done: 20, total: 20 };
            return true;
          },
          commit: () => {
            run.open = false;
            corridorTrace.noteChange(['measured']);
            return true;
          },
          cancel: () => {
            run.open = false;
          },
        };
        return run;
      }),
      unmeasuredStations: () => 0,
      resetWalkCaps: vi.fn(),
      walkState: () => `caps left ${state.narrow}`,
      narrowToWalkable: () => state.narrow-- > 0,
      clearCorridorMeasurements: vi.fn(),
      // Built again: wider on the right.
      refreshRouteLines: vi.fn(() => {
        state.paths = new Map([['spawn-1', path(5)]]);
      }),
      getCachedPaths: () => state.paths,
    };
    const tiles = {
      snapshot: () => ({ cameraErrorTarget: 20 }),
      busy: () => false,
      setRegionErrorTarget: vi.fn(() => true),
      setCameraErrorTarget: vi.fn(),
      holdSettled: vi.fn(),
    };
    const engine = {
      tilesLodDebug: () => tiles,
      terrain: { clearHeightCache: vi.fn() },
      routeCorridorLod: () => ({ tiles: 12, fine: 12, finest: 0, coarse: 0, pending: 0 }),
    };
    return new CorridorBuild({
      gameState: () => gameState,
      engineInit: { getEngine: () => engine },
      pathRoute,
      routeAnimation: { isRunning: () => false, startAnimation: vi.fn() },
      store: { spawnPoints: () => SPAWNS },
      nextFrame: async () => {
        clock += 100;
      },
      now: () => clock,
    } as unknown as CorridorBuildDeps);
  }

  beforeEach(() => {
    clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    lines = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      if (typeof line === 'string' && line.startsWith('[CorridorTrace]')) lines.push(line);
    });
    state = { narrow: 0, epoch: 1, cells: new Map([[1, 10], [2, 10], [3, 10]]), paths: new Map([['spawn-1', path(3)]]) };
    corridorTrace.setEnabled(true);
    corridorTrace.begin('spec');
  });

  afterEach(() => {
    corridorTrace.setEnabled(false);
    vi.restoreAllMocks();
  });

  it('prints one line per step of a build, each with the chain from the height update to it', async () => {
    state.narrow = 1;
    const corridor = create();
    await corridorTrace.within('heightUpdate.done', () => corridor.build('location load'));

    const build = 'heightUpdate.done -> build location load';
    expect(events()).toEqual([
      'load | spec',
      `build.start | ${build}`,
      `build.tiles | ${build}`,
      `build.pass | ${build}`,
      `build.pass | ${build}`,
      `rebuild | ${build}`,
      `build.freeze | ${build}`,
    ]);
    // Quiet from the first frame on, 0.1 s in, then 0.5 s of quiet.
    expect(lineOf('build.tiles')).toMatch(/ target=2\.5 loadS=0\.1 timedOut=false tiles=12 fine=12 finest=0 coarse=0 pending=0 \| /);
    expect(lines.filter((line) => / build\.pass /.test(line)).map((line) => / changed=(\w+)/.exec(line)?.[1])).toEqual(['true', 'false']);
    // New free space; a cell more, one moved, one lost its height; the right side 2 m wider all along.
    expect(lineOf('rebuild')).toMatch(
      / by=measured rays=0 cells=3->4 added=1 removed=0 moved=1 maxMoveM=0\.5 lostHeight=1 gotHeight=0 widthPoints=10\/10 maxWidthChangeM=2 waypoints=3->3 passes=2 spawns=1 /,
    );
    expect(lineOf('build.freeze')).toMatch(/ stations=20 unmeasured=0 passes=2 timedOut=false fallbackStations=0 fallbackCells=0 cells=4 /);
  });

  it('names why a build stopped: a newer one began, or the routes were replaced', async () => {
    const corridor = create();
    const first = corridorTrace.within('heightUpdate.done', () => corridor.build('location load'));
    const second = corridorTrace.within('moved in place', () => corridor.build('HQ moved in place'));
    await Promise.all([first, second]);
    expect(await first).toBeNull();

    const load = 'heightUpdate.done -> build location load';
    const moved = 'moved in place -> build HQ moved in place';
    expect(events().slice(0, 4)).toEqual([
      'load | spec',
      `build.start | ${load}`,
      `build.start | ${moved}`,
      `build.cancel | ${load}`,
    ]);
    expect(lineOf('build.cancel')).toMatch(/ reason=superseded \| /);
    expect(events().at(-1)).toBe(`build.freeze | ${moved}`);

    lines.length = 0;
    const third = corridor.build('settings changed');
    state.epoch++;
    expect(await third).toBeNull();
    expect(lines.find((line) => / build\.cancel /.test(line))).toMatch(/ reason=routes replaced \| /);
  });
});
