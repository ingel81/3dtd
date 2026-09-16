import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CorridorSnapshotReader, type CorridorSnapshotReaderDeps } from './corridor-snapshot-reader';
import type { CorridorSnapshotData } from './corridor-snapshot';
import { CorridorBuild } from '../world/corridor-build';
import type { RouteCellDump } from '../../utils/route-grid-diagnostics';

/**
 * The reader takes what the corridor snapshot saves off the game: the
 * screenshot first, then the stored corridor, and every cell the way
 * `__corridor.pick()` reads it with the column at its centre, in slices over
 * frames. These tests pin what it reads, when it refuses or stops, and that
 * the tile loads it holds back go to the game again, against fakes of the
 * engine and the grid.
 */
describe('CorridorSnapshotReader', () => {
  /** What one column ray costs on the fake clock, ms. */
  const RAY_MS = 10;

  let clock: number;
  let frames: number;
  let engine: ReturnType<typeof fakeEngine> | null;
  let grid: ReturnType<typeof fakeGrid>;
  let loading: boolean;
  let building: boolean;
  let probing: boolean;
  let screenshot: ReturnType<typeof vi.fn>;
  /** Runs at every frame between two slices. */
  let onFrame: () => void;

  const dump = (x: number, z: number, over: Partial<RouteCellDump> = {}): RouteCellDump => ({
    key: x * 1000 + z, x, z, terrainHeight: 5, surface: 'ground', routeAnchorY: 5, deltaFromAnchor: 0,
    state: 'stable', tileDepth: 20, tileGeometricError: 2, heightSampled: true, ...over,
  });

  function fakeGrid(count: number) {
    const cells = Array.from({ length: count }, (_, i) => dump(2 * i + 1, 1, i === 1 ? { heightSampled: false, state: 'unsampled' } : {}));
    return {
      cells,
      dumpCellsInBox: vi.fn(() => cells),
      getCellSize: () => 2,
      getCellAt: (x: number, z: number) => {
        const cell = cells.find((c) => c.x === x && c.z === z);
        return cell && { ...cell, tunnelSpan: x === 1 ? { ax: 0, az: 0, bx: 4, bz: 0, f: 0.25, passage: true } : null };
      },
      describeCellsAround: vi.fn((x: number, z: number, radius: number, tower: string | null) => [
        { x, z, radius, tower, routeM: 0.5, cell: true, walkable: x !== 5, walkCheck: x !== 5 ? 'band' : 'roof' },
      ]),
      missOf: vi.fn((cell: { heightSampled: boolean }) => (cell.heightSampled ? null : 'refused')),
    };
  }

  function fakeEngine() {
    return {
      sync: { geoToLocalSimple: (lat: number, lon: number) => ({ x: (lon - 10) * 1000.123, y: 0, z: (lat - 49) * -1000 }) },
      terrain: {
        lodVersion: 7,
        inspectColumn: vi.fn((x: number) => {
          clock += RAY_MS;
          return x === 5 ? null : {
            hits: [{ y: 9.5, depth: 20, geometricError: 2 }, { y: 5, depth: 20, geometricError: 2 }],
            fresh: { groundY: 5, topY: 9.5, tileDepth: 20, tileGeometricError: 2 },
            cached: null,
          };
        }),
      },
      holdSettled: vi.fn(),
      tilesLodDebug() {
        return { snapshot: () => ({ regionErrorTarget: 5, cameraErrorTarget: 20, active: 180 }), holdSettled: this.holdSettled };
      },
      routeCorridorLod: () => ({ tiles: 120, fine: 100, finest: 3, coarse: 20, tileSet: '0123abcd', pending: 0 }),
      routeCorridorTilePaths: () => ['a.glb', 'b.glb'],
    };
  }

  function reader(): CorridorSnapshotReader {
    const deps = {
      gameState: () => ({ getGlobalRouteGrid: () => ({ getGrid: () => grid }) }),
      engineInit: { getEngine: () => engine, loading: () => loading },
      pathRoute: { corridorState: () => ({ routes: [{ key: 'r', band: [] }], stations: [] }) },
      store: {
        baseCoords: () => ({ lat: 49, lon: 10 }),
        spawnPoints: () => [{ id: 'spawn-1', name: 'Spawn', lat: 49.002, lon: 10.003, color: 0 }],
      },
      corridorBuilding: () => building,
      lodProbeRunning: () => probing,
      nextFrame: async () => {
        frames++;
        onFrame();
      },
      now: () => clock,
      screenshot,
    };
    return new CorridorSnapshotReader(deps as unknown as CorridorSnapshotReaderDeps);
  }

  beforeEach(() => {
    clock = 0;
    frames = 0;
    engine = fakeEngine();
    grid = fakeGrid(10);
    loading = false;
    building = false;
    probing = false;
    screenshot = vi.fn(async () => {
      clock += 20;
      return 'data:image/png;base64,AAAA';
    });
    onFrame = () => undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses without a location, while it loads, while the corridor is built and while a LOD probe runs', () => {
    const snapshots = reader();
    expect(snapshots.blocker()).toBeNull();
    probing = true;
    expect(snapshots.blocker()).toBe('__corridor.probeLod() is running: take the snapshot after it.');
    building = true;
    expect(snapshots.blocker()).toBe('The corridor is being built: take the snapshot once it stands.');
    loading = true;
    expect(snapshots.blocker()).toBe('The location is loading: take the snapshot once the loading screen is gone.');
    engine = null;
    expect(snapshots.blocker()).toBe('No location loaded.');
  });

  it('reads every cell the way pick reads it, with the column at its centre, and the corridor, the tiles and the places', async () => {
    const data = await reader().read(() => undefined) as CorridorSnapshotData;

    expect(screenshot).toHaveBeenCalledWith(engine);
    expect(data.screenshot).toBe('data:image/png;base64,AAAA');
    expect(data.cells).toBe(grid.cells);
    expect(data.probes).toHaveLength(10);
    expect(engine!.terrain.inspectColumn).toHaveBeenCalledTimes(10);
    // The spot of the cell alone, without a tower's answers
    expect(grid.describeCellsAround).toHaveBeenCalledWith(1, 1, 0.5, null);
    expect(data.probes[0]).toEqual({
      row: expect.objectContaining({ x: 1, z: 1, walkable: true, walkCheck: 'band' }),
      passage: true,
      miss: null,
      column: { cached: null, fresh: 'ground 5 top 9.5 depth 20', hits: '9.5@20/2 5@20/2' },
    });
    expect(data.probes[1]).toMatchObject({ passage: false, miss: 'refused' });
    expect(data.probes[2]).toMatchObject({ row: expect.objectContaining({ walkable: false, walkCheck: 'roof' }), column: null });

    expect(data.state.routes).toEqual([{ key: 'r', band: [] }]);
    expect(data.tiles).toEqual({ regionErrorTarget: 5, cameraErrorTarget: 20, active: 180, lodVersion: 7 });
    expect(data.region?.tileSet).toBe('0123abcd');
    expect(data.tilePaths).toEqual(['a.glb', 'b.glb']);
    expect(data.hq).toEqual({ lat: 49, lon: 10, x: 0, z: 0 });
    expect(data.spawns).toEqual([{ id: 'spawn-1', lat: 49.002, lon: 10.003, x: 3, z: -2 }]);
    expect(data.cellSize).toBe(2);
  });

  it('reads the cells in slices over frames, says how far it is and holds the tile loads back until the end', async () => {
    const progress: [number, number][] = [];
    const cellsPerSlice = Math.ceil(CorridorBuild.SLICE_MS / RAY_MS);
    onFrame = () => {
      // Between two slices the game gets no settled tile loads
      expect(engine!.holdSettled).toHaveBeenLastCalledWith(true);
    };

    const data = await reader().read((done, total) => progress.push([done, total])) as CorridorSnapshotData;

    const slices = Math.ceil(10 / cellsPerSlice);
    expect(frames).toBe(slices - 1);
    expect(progress.at(-1)).toEqual([10, 10]);
    expect(progress[0]).toEqual([cellsPerSlice, 10]);
    expect(engine!.holdSettled.mock.calls).toEqual([[true], [false]]);
    expect(data.cost).toEqual({
      cells: 10,
      cellsMs: 10 * RAY_MS,
      columnsMs: 10 * RAY_MS,
      slices,
      screenshotMs: 20,
      wallMs: 20 + 10 * RAY_MS,
    });
  });

  it('stops when the corridor is built again or the location changes between two slices, and lets the tile loads go', async () => {
    onFrame = () => {
      building = true;
    };
    await expect(reader().read(() => undefined)).resolves.toBe('The corridor is being built: take the snapshot once it stands.');
    expect(engine!.holdSettled.mock.calls).toEqual([[true], [false]]);

    building = false;
    onFrame = () => {
      grid = fakeGrid(10);
    };
    await expect(reader().read(() => undefined)).resolves.toBe('The location changed during the snapshot: take it again.');
  });

  it('stops before the cells when the location starts loading while the picture is taken', async () => {
    screenshot.mockImplementation(async () => {
      loading = true;
      return null;
    });
    await expect(reader().read(() => undefined)).resolves.toBe('The location is loading: take the snapshot once the loading screen is gone.');
    expect(engine!.terrain.inspectColumn).not.toHaveBeenCalled();
    expect(engine!.holdSettled).not.toHaveBeenCalled();
  });
});
