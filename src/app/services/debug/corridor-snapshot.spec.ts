import { describe, expect, it } from 'vitest';
import {
  buildCorridorSnapshot,
  describeLoad,
  loadKind,
  snapshotFileName,
  type CorridorSnapshotData,
  type CorridorSnapshotMeta,
  type SnapshotCellProbe,
} from './corridor-snapshot';
import { FINGERPRINT_PARTS, corridorFingerprint } from './corridor-fingerprint';
import { CORRIDOR_DEFAULTS } from '../../utils/route-corridor';
import { PAGE_LOAD, type CorridorLoad } from '../../utils/corridor-trace';
import type { CorridorState } from '../world/path-route.service';
import type { BandStation } from '../../utils/corridor-band';
import type { RouteCellDump } from '../../utils/route-grid-diagnostics';
import type { RecentLocation } from '../location/recent-locations';

/**
 * The corridor snapshot saves everything of the corridor at a place as one
 * file, so that a load with the page and one reached in the game compare
 * entry by entry. These tests pin what the file holds, that it lists one
 * entry per line, how it tells the two kinds of load apart and what the
 * file is called.
 */
describe('corridor snapshot', () => {
  const station = (k: number, over: Partial<BandStation> = {}): BandStation => ({
    segment: 0, k, n: 2, s: 2 * k + 1, x: k, z: 0, rx: 0, rz: 1,
    kind: 'band', backbone: { offset: 0.5, y: 12.25 }, street: 12.25, left: -3.2, right: 4, centre: 0.4,
    ...over,
  });

  const state = (): CorridorState => ({
    routes: [
      { key: 'r-b', band: [station(0), station(1, { kind: 'passage', backbone: null })] },
      { key: 'r-a', band: [station(0)] },
    ],
    stations: [
      { key: 's-2', left: [5.2, NaN], right: [7, NaN], tileError: [2, Infinity], unmeasured: [null, 'no tile'], shiftM: [null, 1.5] },
      { key: 's-1', left: [4], right: [4.25], tileError: [2], unmeasured: [null], shiftM: [null] },
    ],
  });

  const cell = (x: number, z: number, over: Partial<RouteCellDump> = {}): RouteCellDump => ({
    key: x * 1000 + z, x, z, terrainHeight: 10.123, surface: 'ground', routeAnchorY: 9, deltaFromAnchor: 1.123,
    state: 'stable', tileDepth: 21, tileGeometricError: 2, heightSampled: true,
    ...over,
  });

  const probe = (over: Partial<SnapshotCellProbe> = {}): SnapshotCellProbe => ({
    row: {
      x: 0, z: 0, routeM: 0.5, cell: true, state: 'stable', heightM: 10.12, walkable: true, walkCheck: 'band',
      overLineM: 0.1, aboveNeighboursM: 0, surface: 'ground', ground: '-', air: '-',
    },
    passage: false,
    miss: null,
    column: { cached: 'ground 10.12 top 14 depth 21', fresh: 'ground 10.12 top 14 depth 21', hits: '14@21/2 10.12@21/2' },
    ...over,
  });

  function data(over: Partial<CorridorSnapshotData> = {}): CorridorSnapshotData {
    const cells = [
      cell(1, 1),
      cell(1, 3, { surface: 'tunnel' }),
      cell(3, 1, { state: 'unsampled', heightSampled: false, tileDepth: 0, tileGeometricError: Infinity }),
    ];
    return {
      hq: { lat: 49.37721, lon: 10.17904, x: 0, z: 0 },
      spawns: [{ id: 'spawn-1', lat: 49.37944, lon: 10.18365, x: 334.6, z: -248.1 }],
      cellSize: 2,
      camera: { x: 1, y: 200, z: 3, yaw: 10, pitch: -60 },
      state: state(),
      cells,
      probes: [probe(), probe({ passage: true }), probe({ miss: 'noColumn', column: null, row: null })],
      trace: [
        { s: 0, event: 'load', detail: 'label=location change', trigger: 'location change' },
        { s: 12.35, event: 'build.tiles', detail: 'target=2.5 tileSet=0123abcd', trigger: 'build location load' },
      ],
      tiles: {
        regionErrorTarget: 5, cameraErrorTarget: 20, active: 180, visible: 70, activeMB: 99.876, cachedTiles: 900,
        cachedMB: 400, cacheFull: false, queued: 0, downloading: 0, parsing: 0, lodVersion: 7,
      },
      region: { tiles: 120, fine: 100, finest: 3, coarse: 20, tileSet: '0123abcd', pending: 0 },
      tilePaths: ['a.glb', 'b.glb'],
      screenshot: 'data:image/png;base64,AAAA',
      cost: { cells: 3, cellsMs: 1.234, columnsMs: 1.1, slices: 1, screenshotMs: 20, wallMs: 25.5 },
      ...over,
    };
  }

  const load = (): CorridorSnapshotMeta['load'] => ({
    kind: 'nav', label: 'location change', loads: 2, sinceLoadS: 40,
    history: [{ label: PAGE_LOAD, atS: 0 }, { label: 'location change', atS: 60 }], previous: null,
  });

  const meta = (): CorridorSnapshotMeta => ({
    time: '2026-09-16T20:15:30.000Z',
    version: '1.2.3',
    url: 'http://localhost:4200/?l=49.37721,10.17904&s=49.37944,10.18365',
    location: 'Herrngasse, Rothenburg ob der Tauber',
    load: load(),
    corridor: { ...CORRIDOR_DEFAULTS, highwayWidths: { ...CORRIDOR_DEFAULTS.highwayWidths } },
    corridorChanged: {},
  });

  /** The lines of a list in the file, `"name":[` to its closing bracket; the last list of that name (`cells`, not `lines.cells`). */
  function listLines(text: string, name: string): string[] {
    const lines = text.split('\n');
    const start = lines.lastIndexOf(`"${name}":[`);
    const end = lines.findIndex((line, i) => i > start && (line === ']' || line === '],' || line === ']},'));
    return lines.slice(start + 1, end).map((line) => line.replace(/,$/, ''));
  }

  describe('buildCorridorSnapshot', () => {
    it('is JSON with the head, the fingerprint of __corridor.fingerprint() and the entries of each part', () => {
      const file = JSON.parse(buildCorridorSnapshot(meta(), data()));

      expect(Object.keys(file)).toEqual([
        'snapshot', 'meta', 'cost', 'fingerprint', 'lines', 'tiles', 'region', 'tilePaths', 'band', 'stations', 'cells',
        'trace', 'screenshot',
      ]);
      expect(file.meta).toMatchObject({
        url: 'http://localhost:4200/?l=49.37721,10.17904&s=49.37944,10.18365',
        load: { kind: 'nav', loads: 2, history: [{ label: PAGE_LOAD, atS: 0 }, { label: 'location change', atS: 60 }] },
        hq: { lat: 49.37721, lon: 10.17904, x: 0, z: 0 },
        spawns: [{ id: 'spawn-1', lat: 49.37944, lon: 10.18365, x: 334.6, z: -248.1 }],
        cellSize: 2,
        corridor: { maxHalfWidth: CORRIDOR_DEFAULTS.maxHalfWidth },
      });

      const print = corridorFingerprint(state(), data().cells);
      expect(file.fingerprint).toEqual(print);
      expect(Object.keys(file.lines)).toEqual([...FINGERPRINT_PARTS]);
      for (const part of FINGERPRINT_PARTS) expect(file.lines[part]).toHaveLength(print.parts[part].entries);
      expect(file.lines.stations).toEqual(['s-1#0:4,4.25,-', 's-2#0:5.2,7,-', 's-2#1:nan,nan,no tile']);

      expect(file.tiles).toMatchObject({ activeMB: 99.88, lodVersion: 7 });
      expect(file.region.tileSet).toBe('0123abcd');
      expect(file.tilePaths).toEqual(['a.glb', 'b.glb']);
      expect(file.screenshot).toBe('data:image/png;base64,AAAA');
    });

    it('lists the band, the stations and every cell with what pick knows of it, not finite numbers as null', () => {
      const file = JSON.parse(buildCorridorSnapshot(meta(), data()));

      // Routes and segments in the order of the fingerprint
      expect(file.band.map((s: { route: string; k: number }) => `${s.route}:${s.k}`)).toEqual(['r-a:0', 'r-b:0', 'r-b:1']);
      expect(file.band[1]).toMatchObject({ kind: 'band', backbone: { offset: 0.5, y: 12.25 }, street: 12.25, left: -3.2, right: 4, centre: 0.4 });
      expect(file.stations).toEqual([
        { segment: 's-1', k: 0, leftM: 4, rightM: 4.25, tileError: 2, unmeasured: null, shiftM: null },
        { segment: 's-2', k: 0, leftM: 5.2, rightM: 7, tileError: 2, unmeasured: null, shiftM: null },
        { segment: 's-2', k: 1, leftM: null, rightM: null, tileError: null, unmeasured: 'no tile', shiftM: 1.5 },
      ]);

      expect(file.cells).toHaveLength(3);
      expect(file.cells[0]).toEqual({
        key: 1001, x: 1, z: 1, state: 'stable', heightM: 10.12, anchorM: 9, surface: 'ground', passage: false,
        tileDepth: 21, tileError: 2, miss: null, routeM: 0.5, walkable: true, walkCheck: 'band', overLineM: 0.1,
        aboveNeighboursM: 0,
        column: { cached: 'ground 10.12 top 14 depth 21', fresh: 'ground 10.12 top 14 depth 21', hits: '14@21/2 10.12@21/2' },
      });
      expect(file.cells[1]).toMatchObject({ surface: 'tunnel', passage: true });
      expect(file.cells[2]).toMatchObject({
        state: 'unsampled', tileDepth: 0, tileError: null, miss: 'noColumn', walkable: null, column: null,
      });
      expect(file.trace[1]).toEqual({ s: 12.35, event: 'build.tiles', detail: 'target=2.5 tileSet=0123abcd', trigger: 'build location load' });
    });

    it('writes one entry per line, so that two files compare line by line', () => {
      const text = buildCorridorSnapshot(meta(), data());

      for (const [name, count] of [['band', 3], ['stations', 3], ['cells', 3], ['trace', 2], ['tilePaths', 2], ['heights', 3]] as const) {
        const lines = listLines(text, name);
        expect(lines, name).toHaveLength(count);
        for (const line of lines) expect(() => JSON.parse(line), `${name}: ${line}`).not.toThrow();
      }
      expect(listLines(text, 'cells')[1]).toMatch(/^\{"key":1003,"x":1,"z":3,/);
      // The picture last, on a line of its own
      expect(text.split('\n').at(-1)).toBe('"screenshot":"data:image/png;base64,AAAA"}');
    });

    it('writes no tiles, no region, no paths and no picture where there are none (DevWorld, a hidden tab)', () => {
      const file = JSON.parse(buildCorridorSnapshot(meta(), data({ tiles: null, region: null, tilePaths: null, screenshot: null, trace: [] })));
      expect(file).toMatchObject({ tiles: null, region: null, tilePaths: null, screenshot: null, trace: [] });
    });

    /**
     * Tokyo has about 1900 cells. Under Node this took 8 to 12 ms for 775 kB
     * without a picture; the columns the reader casts cost more than this.
     */
    it('puts 2000 cells with their columns together in a few milliseconds', () => {
      const cells = Array.from({ length: 2000 }, (_, i) => cell(i % 40, Math.floor(i / 40)));
      const input = data({ cells, probes: cells.map(() => probe()) });
      const t0 = performance.now();
      const text = buildCorridorSnapshot(meta(), input);
      const ms = performance.now() - t0;
      expect(JSON.parse(text).cells).toHaveLength(2000);
      expect(ms).toBeLessThan(100);
    });
  });

  describe('describeLoad', () => {
    const pageStart = Date.UTC(2026, 8, 16, 20, 0, 0);
    const recent = (name: string, lat: number, minutes: number): RecentLocation => ({
      hq: { lat, lon: 10 }, spawns: [], name, visitedAt: pageStart + minutes * 60_000,
    });

    it('calls the page load cold and every location load after it nav', () => {
      expect(loadKind(PAGE_LOAD)).toBe('cold');
      expect(loadKind('location change')).toBe('nav');
      expect(loadKind('HQ moved, new origin')).toBe('nav');

      const cold = describeLoad([{ label: PAGE_LOAD, atS: 0 }], [], null, pageStart, 95.25);
      expect(cold).toMatchObject({ kind: 'cold', label: PAGE_LOAD, loads: 1, sinceLoadS: 95.3, previous: null });

      const loads: CorridorLoad[] = [{ label: PAGE_LOAD, atS: 0 }, { label: 'location change', atS: 60 }];
      expect(describeLoad(loads, [], null, pageStart, 100)).toMatchObject({ kind: 'nav', loads: 2, sinceLoadS: 40, history: loads });
    });

    it('names the place played before this one since the page load, not this one and not one of an earlier session', () => {
      const here = { lat: 49.37721, lon: 10 };
      const recents = [
        recent('Rothenburg', here.lat, 5),
        recent('Erlenbach', 49.17337, 2),
        recent('Berlin', 52.5163, -30),
      ];
      const loads: CorridorLoad[] = [{ label: PAGE_LOAD, atS: 0 }, { label: 'location change', atS: 200 }];

      expect(describeLoad(loads, recents, here, pageStart, 300).previous).toEqual({
        name: 'Erlenbach', lat: 49.17337, lon: 10, visitedAt: '2026-09-16T20:02:00.000Z',
      });
      // Berlin was played before this page was loaded
      expect(describeLoad([{ label: PAGE_LOAD, atS: 0 }], [recents[0], recents[2]], here, pageStart, 300).previous).toBeNull();
    });
  });

  describe('snapshotFileName', () => {
    const date = new Date(2026, 8, 16, 22, 5, 9);

    it('names the place, how it was loaded and the local time', () => {
      expect(snapshotFileName('Rothenburg ob der Tauber', 'cold', date)).toBe('corridor-rothenburg-ob-der-tauber-cold-220509.json');
      expect(snapshotFileName('Nürnberg', 'nav', date)).toBe('corridor-nurnberg-nav-220509.json');
    });

    it('keeps the place short and falls back where nothing of it is left', () => {
      expect(snapshotFileName('Avenida Nossa Senhora de Copacabana', 'nav', date)).toBe('corridor-avenida-nossa-senhora-de-nav-220509.json');
      expect(snapshotFileName('渋谷区', 'cold', date)).toBe('corridor-unknown-cold-220509.json');
    });
  });
});
