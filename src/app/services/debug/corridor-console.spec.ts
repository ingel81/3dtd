import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CorridorConsole, type CorridorConsoleDeps } from './corridor-console';
import { CORRIDOR_DEFAULTS, corridorConfig, resetCorridorConfig } from '../../utils/route-corridor';

/**
 * `__corridor` is the playtest console for the route corridor: settings
 * that rebuild routes and cells, a table of the cells in a tower's range
 * against its LOS display, and a pick that explains the grid and the
 * corridor width at the next map click. These tests pin what it prints and
 * returns against fakes of the grid, the tower manager and the engine.
 */
describe('CorridorConsole', () => {
  interface Api {
    get: () => Record<string, unknown> & { highwayWidths: Record<string, number> };
    set: (patch: object) => string;
    reset: () => string;
    towerCells: (id?: string) => unknown;
    pick: (radius?: number) => string;
  }
  const api = () => (globalThis as Record<string, unknown>)['__corridor'] as Api;

  interface Cell { x: number; z: number; heightSampled?: boolean }
  const cellA: Cell = { x: 1, z: 1, heightSampled: true };
  const cellB: Cell = { x: 3, z: 1, heightSampled: true };
  const cellC: Cell = { x: 5, z: 1, heightSampled: true };
  const cellD: Cell = { x: 7, z: 1, heightSampled: false };

  let engine: object | null;
  let reference: { x: number; z: number };
  let selected: { id: string } | null;
  let layer: { cells: Cell[] } | null;
  let explanation: Record<string, unknown> | null;
  let change: ReturnType<typeof vi.fn>;
  let armPick: ReturnType<typeof vi.fn>;
  let grid: ReturnType<typeof fakeGrid>;
  let installed: CorridorConsole;

  const tower =(id: string) => ({ id, position: { lat: 10, lon: 20, height: 2 }, combat: { range: 8 } });
  const towers: Record<string, ReturnType<typeof tower>> = { t1: tower('t1'), t2: tower('t2') };

  function fakeGrid() {
    return {
      describeCellsAround: vi.fn(() => [{ x: 1, z: 1, state: 'sampled' }, { x: 3, z: 3, state: 'unsampled' }]),
      describeTowerRange: vi.fn(() => ({
        cells: 12, unsampled: 1,
        groundVisible: 7, groundBlocked: 3, groundMissing: 1,
        airVisible: 9, airBlocked: 2, airMissing: 0,
        holes: ['h1', 'h2'],
        raised: Array.from({ length: 25 }, (_, i) => `r${i}`),
        clamped: 2,
      })),
      centreLineCells: vi.fn(() => ({ cells: [cellA, cellC, cellD] })),
      describeCentreLine: vi.fn(() => ({
        cells: 3, holes: ['h1'], unsampled: 1, groundBlocked: 1, raised: ['r0'], clamped: 0,
      })),
      // cellB was replaced since the display was built.
      getCellAt: vi.fn((x: number) => (x === cellB.x ? { ...cellB } : [cellA, cellC].find((c) => c.x === x))),
      getCellsInRange: vi.fn(() => [cellA, cellB, cellC]),
    };
  }

  function install(): CorridorConsole {
    const towerManager = {
      getSelected: () => selected,
      getById: (id: string) => towers[id] ?? null,
      getSelectionViz: () => ({ getLayer: () => layer }),
    };
    const deps = {
      gameState: () => ({ towerManager, getGlobalRouteGrid: () => ({ getGrid: () => grid }) }),
      engineInit: { getEngine: () => engine },
      inputHandler: { armPick },
      pathRoute: { explainCorridorAt: vi.fn(() => explanation) },
      change,
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
    engine = {
      sync: {
        localToGeo: (hit: { x: number; z: number }) => ({ lat: hit.x, lon: hit.z }),
        geoToLocalSimple: (lat: number, lon: number, height: number) => ({ x: lat, y: height, z: lon }),
      },
      getTowerShadowMapper: () => ({ getReferencePos: () => reference }),
    };
    selected = null;
    layer = null;
    explanation = null;
    change = vi.fn((apply: () => string[]) => {
      const problems = apply();
      return problems.length > 0 ? `refused: ${problems.join('; ')}` : 'rebuilt';
    });
    armPick = vi.fn();
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

    it('changes and resets the config through the rebuild', () => {
      expect(api().set({ maxHalfWidth: 6 })).toBe('rebuilt');
      expect(corridorConfig.maxHalfWidth).toBe(6);

      expect(api().reset()).toBe('rebuilt');
      expect(corridorConfig.maxHalfWidth).toBe(CORRIDOR_DEFAULTS.maxHalfWidth);
      expect(change).toHaveBeenCalledTimes(2);
    });

    it('passes the problems of a rejected setting on', () => {
      expect(api().set({ noSuchSetting: 1 })).toMatch(/^refused: /);
    });
  });

  describe('pick', () => {
    const click = (x: number, z: number) => (armPick.mock.calls.at(-1)![0] as (hit: object) => void)({ x, y: 0, z });

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
        { x: 1, z: 1, state: 'sampled', displayed: null },
        { x: 3, z: 3, state: 'unsampled', displayed: null },
      ]);
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
        { x: 1, z: 1, state: 'sampled', displayed: true },
        { x: 3, z: 3, state: 'unsampled', displayed: false },
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
        holes: 2, raised: 25, clamped: 2,
        displayed: 2,
        displayOutdated: 1,
        notDisplayed: 1,
        cubeFromTower: true,
        centreCells: 3, centreMissing: 1, centreUnsampled: 1, centreBlocked: 1, centreRaised: 1, centreClamped: 0,
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
});
