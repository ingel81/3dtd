import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CorridorLodProbe, type CorridorLodProbeDeps, type LodProbeResult, MUTED_CAMERA_ERROR_TARGET } from './corridor-lod-probe';
import type { CorridorState } from '../world/path-route.service';
import type { StationProbe } from '../../utils/route-corridor';
import type { RouteCellDump } from '../../utils/route-grid-diagnostics';

/**
 * `__corridor.probeLod()` loads the route corridor region at other error
 * targets with the camera's refinement muted and measures every station on
 * each. It must put the region's and the camera's error target back exactly,
 * also after a timeout or an error, hand the settled tile loads back to the
 * game, and refuse to run under towers or a wave. These tests drive it on a
 * fake clock against a fake tile handle.
 */
describe('CorridorLodProbe', () => {
  /** Frames of 10 ms on the fake clock. */
  const FRAME_MS = 10;
  let clock: number;
  /** Until when the fake tiles load after a region target was set; per target, ms. */
  let loadMs: Record<number, number>;
  let alwaysBusy: boolean;
  let loadingUntil: number;
  let region: number | null;
  let camera: number;
  let tiles: ReturnType<typeof fakeTiles>;
  let engine: object | null;
  let towers: number;
  let phase: string;
  let enemies: number;
  let intro: boolean;
  let progress: { done: number; total: number } | null;
  let probes: (StationProbe | null)[];
  let measureAll: ReturnType<typeof vi.fn>;
  let scratch: ReturnType<typeof vi.fn>;
  let cells: RouteCellDump[];
  let probe: CorridorLodProbe;

  const station = (tileError: number): StationProbe => ({ unmeasured: null, tileError, left: [5, 5], right: [5, 5] });

  function fakeTiles() {
    return {
      snapshot: vi.fn(() => ({
        regionErrorTarget: region, cameraErrorTarget: camera, active: 40, visible: 30, activeMB: 12.5,
        cachedTiles: 80, cachedMB: 30.2, cacheFull: false, queued: 0, downloading: 0, parsing: 0,
      })),
      busy: vi.fn(() => alwaysBusy || clock < loadingUntil),
      setRegionErrorTarget: vi.fn((metres: number) => {
        region = metres;
        loadingUntil = clock + (loadMs[metres] ?? 0);
        return true;
      }),
      setCameraErrorTarget: vi.fn((px: number) => {
        camera = px;
      }),
      holdSettled: vi.fn(),
    };
  }

  const corridorState = (): CorridorState => ({ routes: [{ key: 'r', pieces: [[{ t: 0, left: 3, right: 3 }]] }], walkCaps: [], detours: [], stations: [] });

  function cell(x: number, terrainHeight: number): RouteCellDump {
    return {
      key: x, x, z: 0, terrainHeight, surface: 'ground', routeAnchorY: 0, deltaFromAnchor: terrainHeight,
      state: 'stable', tileDepth: 20, tileGeometricError: 2, heightSampled: true,
    };
  }

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'table').mockImplementation(() => undefined);
    clock = 0;
    loadMs = { 2.5: 1000, 0: 2000 };
    alwaysBusy = false;
    loadingUntil = 0;
    region = 5;
    camera = 20;
    tiles = fakeTiles();
    towers = 0;
    phase = 'build';
    enemies = 0;
    intro = false;
    progress = null;
    probes = [station(1.5), station(2), station(2.5), station(4), station(8), { unmeasured: 'no tile', tileError: Infinity, left: [], right: [] }, null];
    measureAll = vi.fn(() => probes);
    scratch = vi.fn((measure: () => unknown) => measure());
    engine = { tilesLodDebug: () => tiles, terrain: { withScratchColumnCache: scratch } };
    cells = [cell(1, 10), cell(3, 10.5)];
    const deps = {
      gameState: () => ({
        towerCount: () => towers,
        waveManager: { phase: () => phase },
        enemyManager: { getAliveCount: () => enemies },
        getGlobalRouteGrid: () => ({ getGrid: () => ({ dumpCellsInBox: () => cells }) }),
      }),
      engineInit: { getEngine: () => engine },
      introFlight: { isRunning: () => intro },
      pathRoute: { measureAllStations: measureAll, clearanceProgress: () => progress, corridorState },
      nextFrame: async () => {
        clock += FRAME_MS;
      },
      now: () => clock,
    };
    probe = new CorridorLodProbe(deps as unknown as CorridorLodProbeDeps);
  });

  afterEach(() => vi.restoreAllMocks());

  /** Region and camera as the run left them, and whether the game got its tile loads back. */
  function expectRestored(): void {
    expect(region).toBe(5);
    expect(camera).toBe(20);
    expect(tiles.holdSettled.mock.calls).toEqual([[true], [false]]);
    expect(probe.running).toBe(false);
  }

  it('loads each target with the camera muted, measures every station on it, and puts both targets back', async () => {
    const result = await probe.run() as LodProbeResult;

    expect(tiles.setRegionErrorTarget.mock.calls.map(([m]) => m)).toEqual([5, 2.5, 0, 5]);
    expect(tiles.setCameraErrorTarget.mock.calls.map(([px]) => px)).toEqual([MUTED_CAMERA_ERROR_TARGET, 20]);
    expectRestored();
    expect(result.restored).toEqual({ regionErrorTarget: 5, cameraErrorTarget: 20 });
    expect(result.stoppedEarly).toBeNull();
    expect(result.restoreTimedOut).toBe(false);
    expect(result.corridorUnchanged).toBe(true);

    // Each target measured once, against a column cache of its own
    expect(measureAll).toHaveBeenCalledTimes(3);
    expect(scratch).toHaveBeenCalledTimes(3);
    expect(result.rows.map((row) => [row.target, row.loadS, row.timedOut])).toEqual([[5, 0, false], [2.5, 1, false], [0, 2, false]]);
    expect(result.rows[0]).toMatchObject({
      stations: 7, upTo2: 2, upTo2_5: 1, upTo5: 1, over5: 1, none: 2,
      active: 40, activeMB: 12.5, cachedTiles: 80, cachedMB: 30.2, cacheFull: false,
    });
    expect(console.table).toHaveBeenCalledWith(result.rows);
  });

  it('refuses while towers stand or a wave runs, and leaves the tiles alone', async () => {
    towers = 1;
    expect(await probe.run()).toBe('Not started: towers stand on the map, sell them first.');
    towers = 0;
    phase = 'wave';
    expect(await probe.run()).toBe('Not started: a wave is running.');
    phase = 'build';
    enemies = 2;
    expect(await probe.run()).toBe('Not started: enemies are on the map.');
    enemies = 0;
    intro = true;
    expect(await probe.run()).toBe('Not started: the intro flight is running.');
    intro = false;
    progress = { done: 3, total: 90 };
    expect(await probe.run()).toMatch(/^Not started: a corridor measurement is under way/);

    expect(tiles.setRegionErrorTarget).not.toHaveBeenCalled();
    expect(tiles.setCameraErrorTarget).not.toHaveBeenCalled();
    expect(tiles.holdSettled).not.toHaveBeenCalled();
    expect(measureAll).not.toHaveBeenCalled();
  });

  it('refuses without tiles, without a corridor region and with targets that are no metres', async () => {
    expect(await probe.run([5, -1])).toMatch(/^Not started: targets are metres/);
    expect(await probe.run([])).toMatch(/^Not started: targets are metres/);
    expect(await probe.run([5], 0)).toBe('Not started: the timeout is seconds, more than 0.');
    region = null;
    expect(await probe.run()).toBe('Not started: the route corridor region is not set yet (no routes).');
    engine = null;
    expect(await probe.run()).toBe('Not started: no 3D tiles (no location loaded, or DevWorld).');
    expect(tiles.holdSettled).not.toHaveBeenCalled();
  });

  it('puts both targets back when a target times out', async () => {
    loadMs[0] = Infinity;

    // 2.5 loads for 1 s and stays quiet for 0.5 s, within the 2 s
    const result = await probe.run([2.5, 0], 2) as LodProbeResult;

    expect(result.rows.map((row) => [row.target, row.timedOut])).toEqual([[2.5, false], [0, true]]);
    expect(result.rows[1].loadS).toBe(2);
    expectRestored();
  });

  it('puts both targets back and hands the tile loads on when the tiles never settle', async () => {
    alwaysBusy = true;

    const result = await probe.run([0], 1) as LodProbeResult;

    expect(result.rows[0].timedOut).toBe(true);
    expect(result.restoreTimedOut).toBe(true);
    expectRestored();
  });

  it('puts both targets back when measuring fails', async () => {
    measureAll.mockImplementation(() => {
      throw new Error('ray exploded');
    });

    const result = await probe.run() as LodProbeResult;

    expect(result.stoppedEarly).toBe('ray exploded');
    expect(result.rows).toEqual([]);
    expectRestored();
  });

  it('stops between two targets when a tower comes up, and puts both targets back', async () => {
    measureAll.mockImplementation(() => {
      towers = 1;
      return probes;
    });

    const result = await probe.run() as LodProbeResult;

    expect(result.rows.map((row) => row.target)).toEqual([5]);
    expect(result.stoppedEarly).toBe('towers stand on the map, sell them first');
    expectRestored();
  });

  it('runs one probe at a time', async () => {
    const first = probe.run([0]);
    expect(probe.running).toBe(true);
    expect(await probe.run()).toBe('Not started: a probe is running.');
    await first;
    expect(probe.running).toBe(false);
  });

  it('tells when the corridor changed while it ran', async () => {
    measureAll.mockImplementation(() => {
      cells = [cell(1, 10), cell(3, 12)];
      return probes;
    });

    const result = await probe.run([5]) as LodProbeResult;

    expect(result.corridorUnchanged).toBe(false);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('the corridor CHANGED while the probe ran'));
  });

  it('prints the fingerprint of the corridor in use', () => {
    const print = probe.fingerprint();
    expect(print).toMatchObject({ hash: expect.stringMatching(/^[0-9a-f]{8}$/) });
    expect(console.log).toHaveBeenCalledWith(`[Corridor] fingerprint ${(print as { hash: string }).hash}`);

    engine = null;
    expect(probe.fingerprint()).toBe('No location loaded.');
  });
});
