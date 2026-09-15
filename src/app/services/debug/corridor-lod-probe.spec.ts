import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CorridorLodProbe, type CorridorLodProbeDeps, type LodProbeResult, type ProbeClipboard } from './corridor-lod-probe';
import { MUTED_CAMERA_ERROR_TARGET } from '../../three-engine/tiles-lod-debug';
import type { CorridorState } from '../world/path-route.service';
import type { StationProbe } from '../../utils/route-corridor';
import type { RouteCellDump } from '../../utils/route-grid-diagnostics';

/**
 * `__corridor.probeLod()` loads the route corridor region at other error
 * targets with the camera's refinement muted and measures every station on
 * each. It must put the region's and the camera's error target back exactly,
 * also after a timeout or an error, hand the settled tile loads back to the
 * game, and refuse to run under towers or a wave. The console command is
 * for a playtest without explanations: one line per target, the report on
 * the clipboard or on a button, one last line; nothing but console.log.
 * These tests drive it on a fake clock against a fake tile handle and a
 * fake clipboard.
 */
describe('CorridorLodProbe', () => {
  /** Frames of 10 ms on the fake clock. */
  const FRAME_MS = 10;
  let clock: number;
  /** How long the fake tiles load after a region target was set; per target, ms. */
  let loadMs: Record<number, number>;
  let alwaysBusy: boolean;
  let loadingUntil: number;
  let region: number | null;
  let camera: number;
  let tiles: ReturnType<typeof fakeTiles>;
  let engine: object | null;
  let loading: boolean;
  let towers: number;
  let phase: string;
  let enemies: number;
  let intro: boolean;
  let progress: { done: number; total: number } | null;
  let probes: (StationProbe | null)[];
  let measureAll: ReturnType<typeof vi.fn>;
  let scratch: ReturnType<typeof vi.fn>;
  let cells: RouteCellDump[];
  let clipboard: { copy: ReturnType<typeof vi.fn>; offerButton: ReturnType<typeof vi.fn> };
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
    vi.spyOn(console, 'warn');
    clock = 0;
    loadMs = { 2.5: 1000, 0: 2000 };
    alwaysBusy = false;
    loadingUntil = 0;
    region = 5;
    camera = 20;
    tiles = fakeTiles();
    loading = false;
    towers = 0;
    phase = 'build';
    enemies = 0;
    intro = false;
    progress = null;
    probes = [station(1.5), station(2), station(2.5), station(4), station(8), { unmeasured: 'no tile', tileError: Infinity, left: [], right: [] }, null];
    measureAll = vi.fn(() => probes);
    scratch = vi.fn((measure: () => unknown) => measure());
    engine = { tilesLodDebug: () => tiles, terrain: { withScratchColumnCache: scratch, lodVersion: 17 } };
    cells = [cell(1, 10), cell(3, 10.5)];
    clipboard = { copy: vi.fn(async () => true), offerButton: vi.fn() };
    const deps = {
      gameState: () => ({
        towerCount: () => towers,
        waveManager: { phase: () => phase },
        enemyManager: { getAliveCount: () => enemies },
        getGlobalRouteGrid: () => ({ getGrid: () => ({ dumpCellsInBox: () => cells }) }),
      }),
      engineInit: { getEngine: () => engine, loading: () => loading },
      introFlight: { isRunning: () => intro },
      pathRoute: { measureAllStations: measureAll, corridorState },
      corridorBuilding: () => progress !== null,
      nextFrame: async () => {
        clock += FRAME_MS;
      },
      now: () => clock,
      clipboard: clipboard as ProbeClipboard,
      pageUrl: () => 'http://localhost:4200/?l=49.17337,9.26851&s=49.17556,9.26401',
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

  /** The lines the probe printed, without the `[Corridor] probeLod: ` in front. */
  const lines = () => vi.mocked(console.log).mock.calls.map(([line]) => String(line).replace('[Corridor] probeLod: ', ''));

  describe('probe', () => {
    it('loads each target with the camera muted, measures every station on it, and puts both targets back', async () => {
      const result = await probe.probe() as LodProbeResult;

      expect(tiles.setRegionErrorTarget.mock.calls.map(([m]) => m)).toEqual([5, 2.5, 0, 5]);
      expect(tiles.setCameraErrorTarget.mock.calls.map(([px]) => px)).toEqual([MUTED_CAMERA_ERROR_TARGET, 20]);
      expectRestored();
      expect(result.restored).toEqual({ regionErrorTarget: 5, cameraErrorTarget: 20 });
      expect(result.stoppedEarly).toBeNull();
      expect(result.restoreTimedOut).toBe(false);
      expect(result.corridorUnchanged).toBe(true);
      expect(result.tilesBefore).toMatchObject({ regionErrorTarget: 5, cameraErrorTarget: 20, lodVersion: 17 });

      // Each target measured once, against a column cache of its own
      expect(measureAll).toHaveBeenCalledTimes(3);
      expect(scratch).toHaveBeenCalledTimes(3);
      expect(result.rows.map((row) => [row.target, row.loadS, row.timedOut])).toEqual([[5, 0, false], [2.5, 1, false], [0, 2, false]]);
      expect(result.rows[0]).toMatchObject({
        stations: 7, upTo2: 2, upTo2_5: 1, upTo5: 1, over5: 1, none: 2,
        active: 40, activeMB: 12.5, cachedTiles: 80, cachedMB: 30.2, cacheFull: false,
      });
      // One line per target
      expect(lines()).toEqual([
        '1/3: 5 m geladen in 0 s, 7 Stationen gemessen in 0 ms',
        '2/3: 2.5 m geladen in 1 s, 7 Stationen gemessen in 0 ms',
        '3/3: 0 m geladen in 2 s, 7 Stationen gemessen in 0 ms',
      ]);
    });

    it('refuses while the location loads, towers stand, a wave runs or the intro flies, and leaves the tiles alone', async () => {
      loading = true;
      expect(await probe.probe()).toBe('Ort lädt noch: Ladebildschirm abwarten und Befehl nochmal');
      loading = false;
      towers = 1;
      expect(await probe.probe()).toBe('Tower stehen: Seite neu laden, keinen Tower setzen, Befehl nochmal');
      towers = 0;
      phase = 'wave';
      expect(await probe.probe()).toBe('Welle läuft: Seite neu laden und Befehl nochmal');
      phase = 'build';
      enemies = 2;
      expect(await probe.probe()).toBe('Gegner auf der Karte: Seite neu laden und Befehl nochmal');
      enemies = 0;
      intro = true;
      expect(await probe.probe()).toBe('Intro noch aktiv: warten und Befehl nochmal');
      intro = false;
      progress = { done: 3, total: 90 };
      expect(await probe.probe()).toBe('Korridor wird noch gebaut: ein paar Sekunden warten und Befehl nochmal');

      expect(tiles.setRegionErrorTarget).not.toHaveBeenCalled();
      expect(tiles.setCameraErrorTarget).not.toHaveBeenCalled();
      expect(tiles.holdSettled).not.toHaveBeenCalled();
      expect(measureAll).not.toHaveBeenCalled();
    });

    it('refuses without tiles, without a corridor region and with targets that are no metres', async () => {
      expect(await probe.probe([5, -1])).toMatch(/^Ziele sind Meter ab 0/);
      expect(await probe.probe([])).toMatch(/^Ziele sind Meter ab 0/);
      expect(await probe.probe([5], 0)).toMatch(/^Wartezeit in Sekunden über 0/);
      region = null;
      expect(await probe.probe()).toBe('Routen stehen noch nicht: Ladebildschirm abwarten und Befehl nochmal');
      engine = null;
      expect(await probe.probe()).toBe('Kein Ort mit 3D-Tiles geladen: Ort laden und Befehl nochmal');
      expect(tiles.holdSettled).not.toHaveBeenCalled();
    });

    it('puts both targets back when a target times out', async () => {
      loadMs[0] = Infinity;

      // 2.5 loads for 1 s and stays quiet for 0.5 s, within the 2 s
      const result = await probe.probe([2.5, 0], 2) as LodProbeResult;

      expect(result.rows.map((row) => [row.target, row.timedOut])).toEqual([[2.5, false], [0, true]]);
      expect(result.rows[1].loadS).toBe(2);
      expectRestored();
    });

    it('puts both targets back and hands the tile loads on when the tiles never settle', async () => {
      alwaysBusy = true;

      const result = await probe.probe([0], 1) as LodProbeResult;

      expect(result.rows[0].timedOut).toBe(true);
      expect(result.restoreTimedOut).toBe(true);
      expectRestored();
    });

    it('puts both targets back when measuring fails', async () => {
      measureAll.mockImplementation(() => {
        throw new Error('ray exploded');
      });

      const result = await probe.probe() as LodProbeResult;

      expect(result.stoppedEarly).toBe('ray exploded');
      expect(result.rows).toEqual([]);
      expectRestored();
    });

    it('stops between two targets when a tower comes up, and puts both targets back', async () => {
      measureAll.mockImplementation(() => {
        towers = 1;
        return probes;
      });

      const result = await probe.probe() as LodProbeResult;

      expect(result.rows.map((row) => row.target)).toEqual([5]);
      expect(result.stoppedEarly).toBe('Tower stehen');
      expectRestored();
    });

    it('runs one probe at a time', async () => {
      const first = probe.probe([0]);
      expect(probe.running).toBe(true);
      expect(await probe.probe()).toBe("Läuft schon: auf die Zeile 'Fertig' warten");
      await first;
      expect(probe.running).toBe(false);
    });

    it('tells when the corridor changed while it ran', async () => {
      measureAll.mockImplementation(() => {
        cells = [cell(1, 10), cell(3, 12)];
        return probes;
      });

      const result = await probe.probe([5]) as LodProbeResult;

      expect(result.corridorUnchanged).toBe(false);
    });
  });

  describe('the console command', () => {
    /** The report the last copy put on the clipboard. */
    const copied = () => JSON.parse(clipboard.copy.mock.calls.at(-1)![0] as string) as Record<string, unknown>;

    it('prints a line per target, copies the report and ends with one line to paste it', async () => {
      const last = await probe.run();

      expect(last).toBe('Fertig: Ergebnis kopiert, bitte in den Chat einfügen');
      // Three targets, the last line, nothing else
      expect(lines()).toHaveLength(4);
      expect(lines().at(-1)).toBe(last);
      expect(console.table).not.toHaveBeenCalled();
      expect(console.warn).not.toHaveBeenCalled();
      expect(clipboard.offerButton).not.toHaveBeenCalled();

      const report = copied();
      expect(report).toMatchObject({
        report: 'corridor-lod-probe',
        url: 'http://localhost:4200/?l=49.17337,9.26851&s=49.17556,9.26401',
        tiles: { regionErrorTarget: 5, cameraErrorTarget: 20, lodVersion: 17 },
        restored: { regionErrorTarget: 5, cameraErrorTarget: 20 },
        stoppedEarly: null,
        corridorUnchanged: true,
      });
      expect(report['rows']).toHaveLength(3);
      const fingerprint = report['fingerprint'] as { hash: string; parts: Record<string, [number, string]> };
      expect(fingerprint.hash).toMatch(/^[0-9a-f]{8}$/);
      expect(fingerprint.parts['cells']).toEqual([2, expect.stringMatching(/^[0-9a-f]{8}$/)]);
      // One line of JSON
      expect(clipboard.copy.mock.calls[0][0]).not.toContain('\n');
    });

    it('says in one line why it cannot run and what to do', async () => {
      intro = true;

      const line = await probe.run();

      expect(line).toBe('Intro noch aktiv: warten und Befehl nochmal');
      expect(lines()).toEqual([line]);
      expect(clipboard.copy).not.toHaveBeenCalled();
      expect(clipboard.offerButton).not.toHaveBeenCalled();
    });

    it('puts the report on a button at the top of the page when the clipboard refuses', async () => {
      clipboard.copy.mockResolvedValue(false);

      const last = await probe.run([5]);

      expect(clipboard.offerButton).toHaveBeenCalledWith(clipboard.copy.mock.calls[0][0]);
      expect(last).toBe("Fertig: Klick oben auf 'Ergebnis kopieren', dann in den Chat einfügen");
      expect(lines()).toHaveLength(2);
      expect(console.warn).not.toHaveBeenCalled();
    });

    it('names an early stop in the last line and still hands on what it measured', async () => {
      measureAll.mockImplementation(() => {
        towers = 1;
        return probes;
      });

      const last = await probe.run();

      expect(last).toBe('Abgebrochen (Tower stehen): Ergebnis kopiert, bitte in den Chat einfügen');
      expect(copied()['rows']).toHaveLength(1);
      expectRestored();
    });
  });

  it('prints the fingerprint of the corridor in use', () => {
    const print = probe.fingerprint();
    expect(print).toMatchObject({ hash: expect.stringMatching(/^[0-9a-f]{8}$/) });
    expect(console.log).toHaveBeenCalledWith(`[Corridor] fingerprint ${(print as { hash: string }).hash}`);

    engine = null;
    expect(probe.fingerprint()).toBe('No location loaded.');
  });
});
