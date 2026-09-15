import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrthographicCamera, Vector3 } from 'three';
import { CorridorConsole, type CorridorConsoleDeps } from './corridor-console';
import type { CellReportSource } from './cell-report.service';
import { CORRIDOR_DEFAULTS, corridorConfig, resetCorridorConfig } from '../../utils/route-corridor';

/**
 * `__corridor` is the playtest console for the route corridor: settings
 * that rebuild routes and cells, a table of the cells in a tower's range
 * against its LOS display, a pick that explains the grid and the corridor
 * width at the next map click, and the cells the cell report reads the same
 * way. These tests pin what it prints and returns against fakes of the grid,
 * the tower manager and the engine.
 */
describe('CorridorConsole', () => {
  interface Api {
    get: () => Record<string, unknown> & { highwayWidths: Record<string, number> };
    set: (patch: object) => string;
    reset: () => string;
    towerCells: (id?: string) => unknown;
    pick: (radius?: number) => string;
    report: () => string;
    probeLod: (targets?: number[], timeoutS?: number) => unknown;
    fingerprint: () => unknown;
  }
  const api = () => (globalThis as Record<string, unknown>)['__corridor'] as Api;

  interface Cell { x: number; z: number; heightSampled?: boolean }
  const cellA: Cell = { x: 1, z: 1, heightSampled: true };
  const cellB: Cell = { x: 3, z: 1, heightSampled: true };
  const cellC: Cell = { x: 5, z: 1, heightSampled: true };
  const cellD: Cell = { x: 7, z: 1, heightSampled: false };

  let engine: object | null;
  let columnAt: ReturnType<typeof vi.fn>;
  let blocked: ReturnType<typeof vi.fn>;
  let inspect: ReturnType<typeof vi.fn>;
  let reference: { x: number; z: number };
  let selected: { id: string } | null;
  let layer: { cells: Cell[] } | null;
  let explanation: Record<string, unknown> | null;
  /** How far above its cells the red line runs (PathAndRouteService.routeLineLift). */
  let lift: number;
  let change: ReturnType<typeof vi.fn>;
  let armPick: ReturnType<typeof vi.fn>;
  let showCellSelection: ReturnType<typeof vi.fn>;
  let cellReport: { start: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };
  let lodProbe: { run: ReturnType<typeof vi.fn>; fingerprint: ReturnType<typeof vi.fn> };
  let grid: ReturnType<typeof fakeGrid>;
  let installed: CorridorConsole;

  const tower =(id: string) => ({ id, position: { lat: 10, lon: 20, height: 2 }, combat: { range: 8 } });
  const towers: Record<string, ReturnType<typeof tower>> = { t1: tower('t1'), t2: tower('t2') };

  function fakeGrid() {
    return {
      describeCellsAround: vi.fn((_x: number, _z: number, _radius?: number, _tower?: string | null): Record<string, unknown>[] => [
        { x: 1, z: 1, state: 'sampled' }, { x: 3, z: 3, state: 'unsampled' },
      ]),
      describeTowerRange: vi.fn(() => ({
        cells: 12, unsampled: 1,
        groundVisible: 7, groundBlocked: 3, groundMissing: 1,
        airVisible: 9, airBlocked: 2, airMissing: 0,
        holes: ['h1', 'h2'],
        raised: Array.from({ length: 25 }, (_, i) => `r${i}`),
        unwalkable: 2,
      })),
      centreLineCells: vi.fn(() => ({ cells: [cellA, cellC, cellD] })),
      describeCentreLine: vi.fn(() => ({
        cells: 3, holes: ['h1'], unsampled: 1, groundBlocked: 1, raised: ['r0'], unwalkable: 0,
      })),
      // cellB was replaced since the display was built.
      getCellAt: vi.fn((x: number) => (x === cellB.x ? { ...cellB } : [cellA, cellC].find((c) => c.x === x))),
      getCellsInRange: vi.fn(() => [cellA, cellB, cellC]),
      getCellSize: () => 2,
      dumpCellsInBox: vi.fn((_box: object): { x: number; z: number; terrainHeight: number }[] => []),
      getGroundLocalYAt: vi.fn((_x: number, _z: number): number | null => null),
    };
  }

  /**
   * Looks straight down from 100 m onto a 200 x 100 px canvas: the spot
   * (x, z) shows at client pixel (x + 100, z + 50).
   */
  function topCamera(): OrthographicCamera {
    const camera = new OrthographicCamera(-100, 100, 50, -50, 0.1, 1000);
    camera.position.set(0, 100, 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    return camera;
  }

  function install(): CorridorConsole {
    const towerManager = {
      getSelected: () => selected,
      getById: (id: string) => towers[id] ?? null,
      getSelectionViz: () => ({ getLayer: () => layer }),
    };
    const deps = {
      gameState: () => ({ towerManager, getGlobalRouteGrid: () => ({ getGrid: () => grid, showCellSelection }) }),
      engineInit: { getEngine: () => engine },
      inputHandler: { armPick },
      pathRoute: {
        explainCorridorAt: vi.fn(() => explanation),
        routeLineLift: () => lift,
        getCachedPaths: () => new Map([['spawn-1', []], ['spawn-2', []]]),
      },
      change,
      cellReport,
      lodProbe,
    };
    const corridorConsole = new CorridorConsole(deps as unknown as CorridorConsoleDeps);
    corridorConsole.install();
    return corridorConsole;
  }

  beforeEach(() => {
    for (const method of ['log', 'table'] as const) {
      vi.spyOn(console, method).mockImplementation(() => undefined);
    }
    reference = { x: 10, z: 20 };
    columnAt = vi.fn(() => null);
    blocked = vi.fn(() => false);
    inspect = vi.fn(() => null);
    const camera = topCamera();
    engine = {
      sync: {
        localToGeo: (hit: { x: number; z: number }) => ({ lat: hit.x, lon: hit.z }),
        geoToLocalSimple: (lat: number, lon: number, height: number) => ({ x: lat, y: height, z: lon }),
      },
      getTowerShadowMapper: () => ({ getReferencePos: () => reference }),
      getCamera: () => camera,
      getRenderer: () => ({ domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }) } }),
      terrain: { raycastColumnSample: columnAt, raycastLineOfSight: blocked, inspectColumn: inspect },
    };
    selected = null;
    layer = null;
    explanation = null;
    lift = 1;
    change = vi.fn(async (apply: () => string[]) => {
      const problems = apply();
      return problems.length > 0 ? `refused: ${problems.join('; ')}` : 'rebuilt';
    });
    armPick = vi.fn();
    showCellSelection = vi.fn();
    cellReport = { start: vi.fn(() => 'Cell report on'), connect: vi.fn(), disconnect: vi.fn() };
    lodProbe = { run: vi.fn(async () => 'probed'), fingerprint: vi.fn(() => ({ hash: '0123abcd' })) };
    grid = fakeGrid();
    installed = install();
  });

  afterEach(() => {
    resetCorridorConfig();
    delete (globalThis as Record<string, unknown>)['__corridor'];
    vi.restoreAllMocks();
  });

  describe('uninstall', () => {
    it('removes its own __corridor', () => {
      installed.uninstall();
      expect('__corridor' in globalThis).toBe(false);
    });

    it('leaves the __corridor of a newer instance in place', () => {
      install();
      const newer = api();

      installed.uninstall();

      expect(api()).toBe(newer);
    });
  });

  describe('settings', () => {
    it('hands out a copy of the config, the highway table included', () => {
      const config = api().get();
      config['maxHalfWidth'] = -1;
      config.highwayWidths['residential'] = -1;

      expect(corridorConfig.maxHalfWidth).toBe(CORRIDOR_DEFAULTS.maxHalfWidth);
      expect(corridorConfig.highwayWidths['residential']).toBe(CORRIDOR_DEFAULTS.highwayWidths['residential']);
    });

    it('changes and resets the config through the corridor build, and prints its last line', async () => {
      await expect(api().set({ maxHalfWidth: 6 })).resolves.toBe('rebuilt');
      expect(corridorConfig.maxHalfWidth).toBe(6);
      expect(console.log).toHaveBeenCalledWith('[Corridor] rebuilt');

      await expect(api().reset()).resolves.toBe('rebuilt');
      expect(corridorConfig.maxHalfWidth).toBe(CORRIDOR_DEFAULTS.maxHalfWidth);
      expect(change).toHaveBeenCalledTimes(2);
    });

    it('passes the problems of a rejected setting on', async () => {
      await expect(api().set({ noSuchSetting: 1 })).resolves.toMatch(/^refused: /);
    });
  });

  /** The measuring tools of Phase 0 live in CorridorLodProbe; the console hands the calls on. */
  describe('probeLod and fingerprint', () => {
    it('hands the targets and the timeout to the probe, and the fingerprint through', async () => {
      await expect(api().probeLod([5, 0], 30)).resolves.toBe('probed');
      expect(lodProbe.run).toHaveBeenCalledWith([5, 0], 30);
      await api().probeLod();
      expect(lodProbe.run).toHaveBeenLastCalledWith(undefined, undefined);
      expect(api().fingerprint()).toEqual({ hash: '0123abcd' });
    });
  });

  describe('pick', () => {
    const click = (x: number, z: number) => (armPick.mock.calls.at(-1)![0] as (hit: object) => void)({ x, y: 0, z });
    /** What coverAt adds for a spot without a column or a cell height. */
    const noCover = { columnBottomM: null, columnTopM: null, overM: null, cameraSees: null };

    it('arms the next click only with a location', () => {
      expect(api().pick()).toBe(
        'Click the map (left button): the grid within 4 m of the click and how the corridor width comes about there are printed here.',
      );
      expect(armPick).toHaveBeenCalledTimes(1);

      engine = null;
      expect(api().pick()).toBe('No location loaded.');
      expect(armPick).toHaveBeenCalledTimes(1);
    });

    it('prints the grid around the click without a selected tower', () => {
      api().pick(6);
      click(12.34, 56.78);

      expect(grid.describeCellsAround).toHaveBeenCalledWith(12.34, 56.78, 6, null);
      expect(console.log).toHaveBeenCalledTimes(1);
      expect(console.log).toHaveBeenCalledWith('[Corridor] pick at 12.3,56.8: 2 spots within 6 m, no tower selected');
      expect(console.table).toHaveBeenCalledWith([
        { x: 1, z: 1, state: 'sampled', displayed: null, ...noCover },
        { x: 3, z: 3, state: 'unsampled', displayed: null, ...noCover },
      ]);
    });

    it('tells what lies over each spot and whether the camera sees the red line there', () => {
      const column = (groundY: number, topY: number) => ({ groundY, topY, tileDepth: 20, tileGeometricError: 2 });
      grid.describeCellsAround.mockReturnValue([
        { x: 1, z: 1, cell: true, heightM: 30 }, // under a deck at 38 m
        { x: 3, z: 1, cell: true, heightM: 30.2 }, // open sky
        { x: 5, z: 1, cell: false, heightM: null },
      ]);
      columnAt.mockImplementation((x: number) => (x === 1 ? column(30, 38.04) : x === 3 ? column(30.2, 30.2) : null));
      blocked.mockImplementation((_ox: number, _oy: number, _oz: number, x: number) => x === 1);

      api().pick();
      click(3, 1);

      expect(console.table).toHaveBeenCalledWith([
        expect.objectContaining({ x: 1, columnBottomM: 30, columnTopM: 38.04, overM: 8, cameraSees: false }),
        expect.objectContaining({ x: 3, columnBottomM: 30.2, columnTopM: 30.2, overM: 0, cameraSees: true }),
        expect.objectContaining({ x: 5, ...noCover }),
      ]);
      // From the camera to where the red line runs, 1 m over the cell.
      expect(blocked).toHaveBeenCalledWith(0, 100, 0, 1, 31, 1);
      expect(columnAt).toHaveBeenCalledWith(5, 1, 'corridorPick');
    });

    /**
     * Playtest 2026-09-14, Erlenbach: cells on an Autobahn deck over the
     * street the route runs on. Whether the street is in the column at all,
     * only in a coarser tile, or only not yet in the cache, the column at the
     * click tells.
     */
    it('prints what the column at the click is made of, cached against a fresh ray', () => {
      const column = (groundY: number, topY: number, tileDepth: number) => ({ groundY, topY, tileDepth, tileGeometricError: 2 });
      inspect.mockReturnValue({
        hits: [{ y: 10.004, depth: 22, geometricError: 1 }, { y: 0, depth: 21, geometricError: 2 }],
        fresh: column(10.004, 10.004, 22),
        cached: column(10, 10, 22),
      });

      api().pick();
      click(3, 1);

      expect(inspect).toHaveBeenCalledWith(3, 1);
      expect(console.log).toHaveBeenCalledWith('[Corridor] column at the click', {
        cached: 'ground 10 top 10 depth 22',
        fresh: 'ground 10 top 10 depth 22',
        hits: '10@22/1 0@21/2',
      });
    });

    it('looks from the camera at the height the red line runs at, 3 m over the cells in DevWorld', () => {
      lift = 3;
      grid.describeCellsAround.mockReturnValue([{ x: 1, z: 1, cell: true, heightM: 30 }]);

      api().pick();
      click(1, 1);

      expect(blocked).toHaveBeenCalledWith(0, 100, 0, 1, 33, 1);
    });

    it('marks what the selected tower displays and explains the width at the nearest station', () => {
      selected = towers['t1'];
      layer = { cells: [cellA] };
      explanation = { way: 'w1', sides: ['left', 'right'], nearby: ['before', 'after'] };

      api().pick();
      click(1, 1);

      expect(grid.describeCellsAround).toHaveBeenCalledWith(1, 1, 4, 't1');
      expect(console.log).toHaveBeenCalledWith('[Corridor] pick at 1.0,1.0: 2 spots within 4 m, answers and display of t1');
      expect(console.table).toHaveBeenNthCalledWith(1, [
        { x: 1, z: 1, state: 'sampled', displayed: true, ...noCover },
        { x: 3, z: 3, state: 'unsampled', displayed: false, ...noCover },
      ]);
      expect(console.log).toHaveBeenCalledWith('[Corridor] width at the nearest route station', { way: 'w1' });
      expect(console.table).toHaveBeenNthCalledWith(2, ['left', 'right']);
      expect(console.table).toHaveBeenNthCalledWith(3, ['before', 'after']);
    });
  });

  describe('towerCells', () => {
    it('asks for a tower and needs an engine', () => {
      expect(api().towerCells()).toBe('No tower: select one or pass its id.');
      expect(api().towerCells('t9')).toBe('No tower: select one or pass its id.');
      engine = null;
      expect(api().towerCells('t1')).toBe('No engine.');
    });

    it('compares the cells in range of the selected tower with its display', () => {
      selected = towers['t1'];
      layer = { cells: [cellA, cellB] };
      reference = { x: 10.3, z: 20.3 };

      const result = api().towerCells() as Record<string, unknown>;

      expect(grid.describeTowerRange).toHaveBeenCalledWith('t1', 10, 20, 8);
      expect(result).toMatchObject({
        tower: 't1', range: 8, cells: 12, unsampled: 1,
        groundVisible: 7, groundBlocked: 3, groundMissing: 1, airVisible: 9, airBlocked: 2, airMissing: 0,
        holes: 2, raised: 25, unwalkable: 2,
        displayed: 2,
        displayOutdated: 1,
        notDisplayed: 1,
        cubeFromTower: true,
        centreCells: 3, centreMissing: 1, centreUnsampled: 1, centreBlocked: 1, centreRaised: 1,
        // cellC is sampled and not drawn, cellD is not sampled.
        centreNotDisplayed: 1,
        holeCells: ['h1', 'h2'],
        centreMissingCells: ['h1'],
      });
      expect(result['raisedCells']).toHaveLength(20);
      expect(console.table).toHaveBeenCalledWith(expect.objectContaining({ tower: 't1', displayed: 2 }));
      expect(console.table).not.toHaveBeenCalledWith(expect.objectContaining({ holeCells: expect.anything() }));
    });

    it('has no display to compare for a tower that is not selected', () => {
      selected = towers['t1'];
      layer = { cells: [cellA] };
      reference = { x: 11, z: 20 };

      const result = api().towerCells('t2') as Record<string, unknown>;

      expect(result).toMatchObject({
        tower: 't2',
        displayed: null,
        displayOutdated: null,
        notDisplayed: null,
        centreNotDisplayed: null,
        cubeFromTower: false,
      });
    });
  });

  /** The cell report (CellReportService) reads its cells through this console, the way pick() reads a click. */
  describe('report', () => {
    const source = () => cellReport.connect.mock.calls.at(-1)![0] as CellReportSource;

    it('starts the cell report and hands it the cells from install to uninstall', () => {
      expect(api().report()).toBe('Cell report on');
      expect(cellReport.start).toHaveBeenCalledTimes(1);
      const connected = source();

      installed.uninstall();

      expect(cellReport.disconnect).toHaveBeenCalledWith(connected);
    });

    it('takes the centre of the grid square under a click, at the height of the hit', () => {
      expect(source().spotAt(new Vector3(2.7, 4, -0.4))).toEqual({ x: 3, y: 4, z: -1 });

      engine = null;
      expect(source().spotAt(new Vector3(2.7, 4, -0.4))).toBeNull();
    });

    it('takes the cells whose centre shows in the box, nearest to its middle first, none behind the camera', () => {
      grid.dumpCellsInBox.mockReturnValue([
        { x: 11, z: 1, terrainHeight: 0 }, // at (111, 51)
        { x: 1, z: 1, terrainHeight: 0 }, // at (101, 51), its ground at 5 m
        { x: 1, z: 31, terrainHeight: 0 }, // at (101, 81), below the box
        { x: 5, z: 1, terrainHeight: 200 }, // above the camera
      ]);
      grid.getGroundLocalYAt.mockImplementation((x: number) => (x === 1 ? 5 : null));
      const box = { left: 95, top: 45, right: 115, bottom: 60 };

      expect(source().cellsInRect(box, 10)).toEqual([{ x: 1, y: 5, z: 1 }, { x: 11, y: 0, z: 1 }]);
      expect(source().cellsInRect(box, 1)).toEqual([{ x: 1, y: 5, z: 1 }]);
      expect(grid.dumpCellsInBox).toHaveBeenCalledWith({ xMin: -Infinity, xMax: Infinity, zMin: -Infinity, zMax: Infinity });
    });

    it('frames the selection through the grid service', () => {
      source().showSelection([{ x: 1, y: 0, z: 1 }]);
      expect(showCellSelection).toHaveBeenCalledWith([{ x: 1, y: 0, z: 1 }]);
    });

    it('reads each spot the way pick() reads a click on it, with its neighbours', () => {
      const column = (groundY: number, topY: number) => ({ groundY, topY, tileDepth: 20, tileGeometricError: 2 });
      // The spot and its eight neighbours, the spot itself last; no cell up and right of it
      grid.describeCellsAround.mockImplementation((x: number, z: number) => [-1, 0, 1]
        .flatMap((dz) => [-1, 0, 1].map((dx) => ({
          x: x + dx * 2, z: z + dz * 2, cell: !(dx === 1 && dz === -1), state: 'stable', heightM: 30 + dx, walkable: dx !== -1,
        })))
        .sort((a, b) => Number(a.x === x && a.z === z) - Number(b.x === x && b.z === z)));
      columnAt.mockImplementation((x: number) => (x === 3 ? column(30, 38.04) : null));
      inspect.mockReturnValue({ hits: [{ y: 38.04, depth: 20, geometricError: 2 }], fresh: column(30, 38.04), cached: column(30, 38.04) });
      explanation = { route: 'spawn-1', station: '7:3/32', sides: [], nearby: [] };

      const probe = source().describe([{ x: 3, y: 0, z: 1 }]);

      expect(grid.describeCellsAround).toHaveBeenCalledWith(3, 1, 3, null);
      expect(probe.tower).toBeNull();
      expect(probe.routes).toEqual(['spawn-1', 'spawn-2']);
      const [cell] = probe.cells;
      expect(cell.geo).toBe('3.0000000,1.0000000');
      expect(cell.row).toMatchObject({
        x: 3, z: 1, heightM: 30, displayed: null, columnBottomM: 30, columnTopM: 38.04, overM: 8, cameraSees: true,
      });
      expect(Object.keys(cell.neighbours).sort()).toEqual(['-1,-1', '-1,0', '-1,1', '0,-1', '0,1', '1,-1', '1,0', '1,1']);
      expect(cell.neighbours['1,-1']).toBeNull();
      expect(cell.neighbours['-1,0']).toEqual([29, false]);
      expect(cell.neighbours['1,1']).toEqual([31, true]);
      expect(cell.column).toEqual({ cached: 'ground 30 top 38.04 depth 20', fresh: 'ground 30 top 38.04 depth 20', hits: '38.04@20/2' });
      expect(cell.station).toBe(explanation);
      // The cover rays only for the spot itself, not for its neighbours
      expect(columnAt).toHaveBeenCalledTimes(1);
    });

    it('carries the answers of the selected tower, as pick() does', () => {
      selected = towers['t1'];
      source().describe([{ x: 3, y: 0, z: 1 }]);
      expect(grid.describeCellsAround).toHaveBeenCalledWith(3, 1, 3, 't1');
    });

    it('reads no cells without a location', () => {
      engine = null;
      expect(source().describe([{ x: 3, y: 0, z: 1 }])).toEqual({ tower: null, routes: ['spawn-1', 'spawn-2'], cells: [] });
      expect(source().cellsInRect({ left: 0, top: 0, right: 200, bottom: 100 }, 10)).toEqual([]);
    });
  });
});
