import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Only their DI tokens are needed; the real ones pull in geocoding, markers and combat effects.
vi.mock('../location/location-management.service', () => ({ LocationManagementService: class LocationManagementService {} }));
vi.mock('./debug-facade.service', () => ({ DebugFacadeService: class DebugFacadeService {} }));

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { Vector3 } from 'three';
import { CellReportService, type CellReportSource } from './cell-report.service';
import { LocationManagementService } from '../location/location-management.service';
import { DebugFacadeService } from './debug-facade.service';
import { MAX_REPORT_CELLS, type CellProbe, type CellSpot, type ScreenRect } from './cell-report';
import { BUILD_VERSION } from '../../configs/build-info.config';
import { DEFAULT_VFX_SETTINGS, withVfxPreset } from '../../three-engine/vfx-settings';
import { resetCorridorConfig, setCorridorConfig } from '../../utils/route-corridor';

/**
 * The cell report collects grid cells by click and by box while it is on
 * and copies them as one JSON with a note, in place of a pick and three
 * screenshots per cell. These tests pin the mode, the selection and the
 * clipboard against a fake of the game (the source CorridorConsole gives).
 */
describe('CellReportService', () => {
  const spot = (x: number, z: number): CellSpot => ({ x, y: 0, z });
  const hit = (x: number, z: number) => new Vector3(x, 0, z);
  const rect: ScreenRect = { left: 0, top: 0, right: 100, bottom: 100 };

  let service: CellReportService;
  let hq: ReturnType<typeof signal<{ lat: number; lon: number } | null>>;
  let source: {
    spotAt: ReturnType<typeof vi.fn>;
    cellsInRect: ReturnType<typeof vi.fn>;
    showSelection: ReturnType<typeof vi.fn>;
    describe: ReturnType<typeof vi.fn>;
  };
  let writeText: ReturnType<typeof vi.fn>;

  const connect = () => service.connect(source as unknown as CellReportSource);
  const lastFramed = () => source.showSelection.mock.calls.at(-1)?.[0];
  const setClipboard = (value: unknown) => Object.defineProperty(navigator, 'clipboard', { value, configurable: true });

  beforeEach(() => {
    hq = signal<{ lat: number; lon: number } | null>({ lat: 49.17327, lon: 9.26859 });
    source = {
      spotAt: vi.fn((point: Vector3) => spot(point.x, point.z)),
      cellsInRect: vi.fn((): CellSpot[] => []),
      showSelection: vi.fn(),
      describe: vi.fn((spots: CellSpot[]): CellProbe => ({
        tower: null,
        routes: ['spawn-1'],
        cells: spots.map((s) => ({
          geo: `${s.x},${s.z}`,
          row: { x: s.x, z: s.z, heightM: 10.123 },
          neighbours: {},
          column: null,
          station: null,
        })),
      })),
    };
    writeText = vi.fn(async () => undefined);
    setClipboard({ writeText });

    const injector = Injector.create({
      providers: [
        { provide: LocationManagementService, useValue: { hq, displayName: signal('Erlenbach') } },
        { provide: DebugFacadeService, useValue: { vfx: signal(withVfxPreset(DEFAULT_VFX_SETTINGS, 'medium')) } },
      ],
    });
    service = runInInjectionContext(injector, () => new CellReportService());
  });

  afterEach(() => {
    resetCorridorConfig();
    localStorage.clear();
    window.history.replaceState({}, '', '/');
    setClipboard(undefined);
    vi.restoreAllMocks();
  });

  describe('mode', () => {
    it('starts only with a location', () => {
      expect(service.start()).toBe('No location loaded.');
      expect(service.active()).toBe(false);

      connect();
      expect(service.start()).toMatch(/^Cell report on/);
      expect(service.active()).toBe(true);
    });

    it('frames the selection while on and keeps it when it ends', () => {
      connect();
      service.start();
      service.click(hit(1, 1));
      expect(lastFramed()).toEqual([spot(1, 1)]);

      service.stop();
      expect(service.active()).toBe(false);
      expect(lastFramed()).toEqual([]);
      expect(service.spots()).toEqual([spot(1, 1)]);

      service.toggle();
      expect(service.active()).toBe(true);
      expect(lastFramed()).toEqual([spot(1, 1)]);
      service.toggle();
      expect(service.active()).toBe(false);
    });

    it('ends when its source goes, not when another one does', () => {
      connect();
      service.start();

      service.disconnect({} as CellReportSource);
      expect(service.active()).toBe(true);

      service.disconnect(source as unknown as CellReportSource);
      expect(service.active()).toBe(false);
      expect(service.start()).toBe('No location loaded.');
    });
  });

  describe('selection', () => {
    beforeEach(() => {
      connect();
      service.start();
    });

    it('puts a clicked cell in and takes it out with a second click', () => {
      service.click(hit(1, 1));
      service.click(hit(3, 1));
      expect(service.spots()).toEqual([spot(1, 1), spot(3, 1)]);

      service.click(hit(1, 1));
      expect(service.spots()).toEqual([spot(3, 1)]);
      expect(lastFramed()).toEqual([spot(3, 1)]);
    });

    it('takes no clicks while off', () => {
      service.stop();
      service.click(hit(1, 1));
      service.select(rect);
      expect(service.spots()).toEqual([]);
      expect(source.cellsInRect).not.toHaveBeenCalled();
    });

    it('adds the cells of a box once each and drops the box', () => {
      service.click(hit(1, 1));
      service.box.set(rect);
      source.cellsInRect.mockReturnValue([spot(1, 1), spot(3, 1), spot(5, 1)]);

      service.select(rect);

      expect(source.cellsInRect).toHaveBeenCalledWith(rect, MAX_REPORT_CELLS + 1);
      expect(service.spots()).toEqual([spot(1, 1), spot(3, 1), spot(5, 1)]);
      expect(service.box()).toBeNull();
      expect(lastFramed()).toHaveLength(3);
    });

    it('holds at most MAX_REPORT_CELLS and says how many were left out', () => {
      source.cellsInRect.mockReturnValue(Array.from({ length: MAX_REPORT_CELLS + 5 }, (_, i) => spot(i * 2 + 1, 1)));

      service.select(rect);
      expect(service.spots()).toHaveLength(MAX_REPORT_CELLS);
      expect(service.status()).toBe(`Limit: ${MAX_REPORT_CELLS} cells, 5 left out`);

      service.click(hit(-1, -1));
      expect(service.spots()).toHaveLength(MAX_REPORT_CELLS);
      expect(service.status()).toBe(`Limit: ${MAX_REPORT_CELLS} cells`);
    });

    it('forgets cells picked around another HQ: they lie in another local frame', () => {
      service.click(hit(1, 1));
      hq.set({ lat: 48.1, lon: 11.5 });

      service.click(hit(3, 1));

      expect(service.spots()).toEqual([spot(3, 1)]);
    });

    it('empties on clear', () => {
      service.click(hit(1, 1));
      service.clear();
      expect(service.spots()).toEqual([]);
      expect(lastFramed()).toEqual([]);
    });
  });

  describe('copy', () => {
    beforeEach(() => {
      connect();
      service.start();
    });

    it('copies the report of the selected cells with meta and note', async () => {
      window.history.replaceState({}, '', '/?l=49.17327,9.26859&s=49.17555,9.26387');
      setCorridorConfig({ maxHalfWidth: 5 });
      service.note.set('Auto am Rand');
      service.click(hit(1, 1));
      service.click(hit(3, 1));

      await service.copy();

      expect(source.describe).toHaveBeenCalledWith([spot(1, 1), spot(3, 1)]);
      const report = JSON.parse(writeText.mock.calls[0][0]);
      expect(report.meta).toMatchObject({
        url: `${window.location.origin}/?l=49.17327,9.26859&s=49.17555,9.26387`,
        version: BUILD_VERSION,
        location: 'Erlenbach',
        effects: 'medium',
        corridor: { maxHalfWidth: 5 },
        routes: ['spawn-1'],
        cells: 2,
      });
      expect(new Date(report.meta.time).toISOString()).toBe(report.meta.time);
      expect(report.note).toBe('Auto am Rand');
      expect(report.cells.map((c: { heightM: number }) => c.heightM)).toEqual([10.12, 10.12]);
      expect(service.status()).toMatch(/^Copied 2 cells, \d+\.\d kB$/);
    });

    it('carries no tile credentials, from the stored ones or the URL', async () => {
      localStorage.setItem('3dtd-tile-credentials', JSON.stringify({ provider: 'cesium', token: 'SECRET-TOKEN-123' }));
      window.history.replaceState({}, '', '/?l=49.17327,9.26859&token=SECRET-TOKEN-123&key=SECRET-KEY-456');
      service.click(hit(1, 1));

      await service.copy();

      const json = writeText.mock.calls[0][0] as string;
      expect(json).not.toContain('SECRET-TOKEN-123');
      expect(json).not.toContain('SECRET-KEY-456');
      expect(JSON.parse(json).meta.url).toBe(`${window.location.origin}/?l=49.17327,9.26859`);
    });

    it('logs the report to the console where the clipboard refuses, and says so', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      writeText.mockRejectedValue(new Error('Document is not focused'));
      service.click(hit(1, 1));

      await service.copy();

      expect(JSON.parse(log.mock.calls[0][0]).cells).toHaveLength(1);
      expect(service.status()).toBe('Clipboard refused: JSON logged to the console');

      // No clipboard at all (no secure context)
      setClipboard(undefined);
      log.mockClear();
      await service.copy();
      expect(JSON.parse(log.mock.calls[0][0]).cells).toHaveLength(1);
    });

    it('says what is missing instead of copying nothing', async () => {
      await service.copy();
      expect(service.status()).toBe('Select cells first.');

      service.disconnect(source as unknown as CellReportSource);
      await service.copy();
      expect(service.status()).toBe('No location loaded.');
      expect(writeText).not.toHaveBeenCalled();
    });
  });
});
