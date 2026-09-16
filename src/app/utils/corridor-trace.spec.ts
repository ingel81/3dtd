import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HEIGHT_MOVE_M,
  LONG_STEP_MS,
  cellDelta,
  corridorTrace,
  countLod,
  emptyLod,
  formatLod,
  widthDelta,
  widthProfile,
} from './corridor-trace';
import { cameraTimeline } from './camera-timeline';
import { GlobalRouteGrid } from './global-route-grid';
import type { RouteWaypoint } from '../models/game.types';

/** About 10 m of latitude. */
const TEN_M = 10 / 111_320;

/**
 * The corridor trace prints one line per event that changes or may change
 * the route corridor, with the chain that led to it, and a delta against
 * the corridor before each rebuild. Off under vitest; these specs turn it on.
 */
describe('corridor trace', () => {
  let lines: string[];

  beforeEach(() => {
    lines = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      if (typeof line === 'string' && line.startsWith('[CorridorTrace]')) lines.push(line);
    });
    corridorTrace.setEnabled(true);
    corridorTrace.begin('spec');
    lines.length = 0;
  });

  afterEach(() => {
    corridorTrace.setEnabled(false);
    vi.restoreAllMocks();
  });

  describe('lines', () => {
    it('give the seconds since the load, the event, its numbers and the trigger', () => {
      corridorTrace.within('tilesLoaded lod=3', () =>
        corridorTrace.log('heights', { cells: 1200, maxMoveM: 0.3456, lod: '2m:1', none: null, skipped: undefined }),
      );
      expect(lines).toEqual([
        expect.stringMatching(/^\[CorridorTrace\] \d+\.\d\ds heights cells=1200 maxMoveM=0\.35 lod=2m:1 none=null \| tilesLoaded lod=3$/),
      ]);
    });

    it('name the callers where no chain leads to the event', () => {
      function generateFromRoutes() {
        corridorTrace.log('grid.generate');
      }
      function initializeGlobalRouteGrid() {
        generateFromRoutes();
      }
      initializeGlobalRouteGrid();
      expect(lines[0]).toMatch(/ grid\.generate \| caller .*initializeGlobalRouteGrid/);
    });

    it('chain the labels of nested calls, and a chain captured for a later frame', () => {
      let later = '';
      corridorTrace.within('tilesLoaded lod=7', () => {
        corridorTrace.within('convergence.settled', () => {
          later = corridorTrace.capture();
        });
      });
      expect(later).toBe('tilesLoaded lod=7 -> convergence.settled');

      corridorTrace.within('refit.retry', () => corridorTrace.log('refit.remeasure'), later);
      const saved = corridorTrace.enter('rebuild');
      corridorTrace.log('grid.generate');
      corridorTrace.exit(saved);
      corridorTrace.log('given', {}, 'a trigger');

      expect(lines.map((line) => line.split(' | ')[1])).toEqual([
        'tilesLoaded lod=7 -> convergence.settled -> refit.retry',
        'rebuild',
        'a trigger',
      ]);
    });

    it('drop the label again when the code under it throws', () => {
      expect(() => corridorTrace.within('rebuild', () => {
        throw new Error('boom');
      })).toThrow('boom');
      expect(corridorTrace.capture()).toMatch(/^caller /);
    });

    it('flag a step longer than a frame, and only such a step', () => {
      corridorTrace.cost('rebuild', LONG_STEP_MS, {}, LONG_STEP_MS, 'x');
      corridorTrace.cost('rebuild', 183.5, { cells: 988 }, LONG_STEP_MS, 'x');
      expect(lines).toEqual([expect.stringMatching(/^\[CorridorTrace\] LONG \d+\.\d\ds rebuild ms=183\.5 cells=988 \| x$/)]);
    });

    /**
     * Work that is sliced on purpose is measured against the budget it was
     * given: the clearance runs in slices of CorridorBuild.SLICE_MS (32 ms),
     * so against LONG_STEP_MS every single slice came out LONG, 15 to 33
     * lines of noise per location load (playtest 2026-09-16).
     */
    it('measure sliced work against its own budget, not against a frame', () => {
      corridorTrace.cost('clearance.slice', 31, { stations: 9, budgetMs: 32 }, 32, 'x');
      expect(lines).toEqual([]);
      corridorTrace.cost('clearance.slice', 40, { stations: 9, budgetMs: 32 }, 32, 'x');
      expect(lines).toEqual([expect.stringMatching(/LONG \d+\.\d\ds clearance\.slice ms=40 stations=9 budgetMs=32 \| x$/)]);
    });

    it('stay away while the trace is off, and the code under a label still runs', () => {
      corridorTrace.setEnabled(false);
      expect(corridorTrace.within('rebuild', () => 42)).toBe(42);
      corridorTrace.log('rebuild');
      corridorTrace.cost('rebuild', 1000);
      expect(corridorTrace.capture()).toBe('');
      expect(lines).toEqual([]);
    });

    it('start the clock and the timeline anew with a location load, which prints as a table', () => {
      corridorTrace.log('before', {}, 'x');
      corridorTrace.begin('location change');
      corridorTrace.log('tiles', { lod: 1 }, 'tilesLoaded lod=1');
      const table = vi.spyOn(console, 'table').mockImplementation(() => undefined);

      expect(corridorTrace.print()).toBe('2 corridor events since location change');
      const rows = table.mock.calls[0][0] as { s: number }[];
      expect(rows).toEqual([
        { s: expect.any(Number), event: 'load', detail: 'label=location change', trigger: 'location change' },
        { s: expect.any(Number), event: 'tiles', detail: 'lod=1', trigger: 'tilesLoaded lod=1' },
      ]);
      expect(rows[0].s).toBeLessThan(1);
    });

    it('follow the intro phases and the height cycles off the camera timeline', () => {
      cameraTimeline.record('intro.phase', { phase: 'travel', distance: 120 });
      cameraTimeline.record('camera.set');
      expect(lines).toEqual([expect.stringMatching(/ intro\.phase phase=travel distance=120 \| camera timeline$/)]);
    });

    it('mark the route corridor region complete the first time none of its tiles is left to refine', () => {
      const region = { tiles: 10, fine: 8, finest: 2, coarse: 2, tileSet: '0badf00d', pending: 5 };
      corridorTrace.tiles(3, () => region);
      corridorTrace.tiles(4, () => ({ ...region, fine: 10, coarse: 0, pending: 0 }));
      corridorTrace.tiles(5, () => ({ ...region, fine: 10, coarse: 0, pending: 0 }));
      expect(lines.map((line) => /s (\S+)/.exec(line)?.[1])).toEqual(['tiles', 'tiles', 'region.complete', 'tiles']);
      expect(lines[0]).toContain(' tiles lod=3 tiles=10 fine=8 finest=2 coarse=2 tileSet=0badf00d pending=5 ');
    });
  });

  it('sorts the tile errors of the columns into five buckets: the region target 2.5 m, the fallback level 5 m', () => {
    const lod = emptyLod();
    for (const error of [0.5, 2, 2.006, 2.5, 5, 5.01, 40, Infinity]) countLod(lod, error);
    expect(lod).toEqual({ fine: 2, region: 2, fallback: 1, coarse: 2, none: 1 });
    expect(formatLod(lod)).toBe('2m:2,2.5m:2,5m:1,coarse:2,none:1');
  });

  describe('delta of a rebuild', () => {
    it('counts the cells added, removed, moved by more than a quarter metre, and those that lost or got a height', () => {
      const before = new Map([[1, 10], [2, 10], [3, 10], [4, NaN], [5, 10]]);
      const after = new Map([[1, 10 + HEIGHT_MOVE_M], [2, 10.4], [3, NaN], [4, 12], [6, 11]]);
      expect(cellDelta(before, after)).toEqual({
        added: 1, removed: 1, moved: 1, maxMoveM: expect.closeTo(0.4), lostHeight: 1, gotHeight: 1,
      });
    });

    it('compares the half widths every 2 m along each route, as the stations', () => {
      const route = (right: number): RouteWaypoint[] => [
        { lat: 48, lon: 9, corridorLeft: 3, corridorRight: 3 },
        { lat: 48 + TEN_M, lon: 9, corridorLeft: 3, corridorRight: right },
        { lat: 48 + 2 * TEN_M, lon: 9 },
      ];
      const before = widthProfile(new Map([['a', route(3)]]));
      // 20 m: ten points, left and right each.
      expect(before.get('a')).toHaveLength(20);
      expect(widthDelta(before, widthProfile(new Map([['a', route(4.5)]])))).toEqual({ points: 10, changed: 5, maxChangeM: 1.5 });
      expect(widthDelta(before, before)).toEqual({ points: 10, changed: 0, maxChangeM: 0 });
    });

    it('counts the points of a route that got longer, or is new, as changed', () => {
      const before = new Map([['a', [3, 3, 3, 3]]]);
      const after = new Map([['a', [3, 3, 3, 3, 3, 3]], ['b', [2, 2]]]);
      expect(widthDelta(before, after)).toEqual({ points: 4, changed: 2, maxChangeM: 0 });
    });

    it('names what changed the data since the last rebuild, and forgets it with the rebuild', () => {
      const snapshot = { cells: new Map([[1, 0]]), widths: new Map<string, number[]>(), waypoints: 5 };
      corridorTrace.noteChange(['measured'], 944);
      corridorTrace.noteChange(['band', 'measured']);
      corridorTrace.rebuilt(snapshot, snapshot, { narrowed: 2 }, 183.5);
      corridorTrace.rebuilt(snapshot, snapshot, {}, 1);

      const rebuilds = lines.filter((line) => line.includes(' rebuild ') && !line.includes(' LONG '));
      expect(rebuilds[0]).toMatch(
        / rebuild by=measured\+band rays=944 cells=1->1 added=0 removed=0 moved=0 maxMoveM=0 lostHeight=0 gotHeight=0 widthPoints=0\/0 maxWidthChangeM=0 waypoints=5->5 narrowed=2 ms=183\.5 deltaMs=/,
      );
      expect(rebuilds[1]).toMatch(/ rebuild by=none rays=0 /);
      expect(lines.some((line) => line.startsWith('[CorridorTrace] LONG') && line.includes(' rebuild ms=183.5'))).toBe(true);
    });
  });

  describe('cost', () => {
    it('snapshots and compares a corridor of more than 1000 cells in well under a frame', () => {
      const grid = new GlobalRouteGrid();
      grid.initialize(
        (() => ({ groundY: 0, topY: 0, tileDepth: 20, tileGeometricError: 2 })) as never,
        { geoToLocalSimple: (lat: number, lon: number) => ({ x: lon, y: 0, z: lat }) } as never,
      );
      grid.generateFromRoutes([[0, 200, 400, 600].map((x): RouteWaypoint => ({ lat: 0, lon: x, corridorLeft: 3, corridorRight: 3 }))]);
      expect(grid.getStats().totalCells).toBeGreaterThan(1000);
      // Two routes of 1.2 km, a waypoint every 4 m: about 1200 width points.
      const step = TEN_M * 0.4;
      const paths = new Map(['a', 'b'].map((id) => [
        id, Array.from({ length: 300 }, (_, i): RouteWaypoint => ({ lat: 48 + i * step, lon: 9, corridorLeft: 3, corridorRight: 4 })),
      ]));

      const runs = 20;
      const t0 = performance.now();
      for (let i = 0; i < runs; i++) {
        const before = { cells: grid.snapshotHeights(), widths: widthProfile(paths) };
        const after = { cells: grid.snapshotHeights(), widths: widthProfile(paths) };
        cellDelta(before.cells, after.cells);
        widthDelta(before.widths, after.widths);
      }
      const perRebuildMs = (performance.now() - t0) / runs;
      expect(perRebuildMs).toBeLessThan(5);
    });
  });
});
