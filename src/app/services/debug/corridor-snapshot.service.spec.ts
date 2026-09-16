import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Only its DI token and the two names are needed; the real one pulls in geocoding and the route service.
vi.mock('../location/location-management.service', () => ({
  LocationManagementService: class LocationManagementService {},
  NO_LOCATION_NAME: 'No location',
  LOADING_NAME: 'Loading...',
}));

// The browser download: the spec reads what would be saved.
const download = vi.hoisted(() => ({ downloadBlob: vi.fn() }));
vi.mock('../../utils/download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/download')>()),
  ...download,
}));

import { Injector, runInInjectionContext, signal } from '@angular/core';
import { CorridorSnapshotService, type CorridorSnapshotSource } from './corridor-snapshot.service';
import type { CorridorSnapshotData } from './corridor-snapshot';
import { LocationManagementService } from '../location/location-management.service';
import { BUILD_VERSION } from '../../configs/build-info.config';
import { corridorTrace } from '../../utils/corridor-trace';
import { resetCorridorConfig, setCorridorConfig } from '../../utils/route-corridor';

/**
 * One click on the Snapshot tile saves the corridor at this place as one
 * file, and the tile says how far it is and what the file is called. These
 * tests pin the refusals, the head of the file, its name and the line on the
 * tile, against a fake of the game (the reader the facade connects).
 */
describe('CorridorSnapshotService', () => {
  let service: CorridorSnapshotService;
  let source: { blocker: ReturnType<typeof vi.fn>; read: ReturnType<typeof vi.fn> };
  let location: {
    hq: ReturnType<typeof signal<{ lat: number; lon: number } | null>>;
    displayName: ReturnType<typeof signal<string>>;
    missionInfo: ReturnType<typeof signal<{ city: string } | null>>;
    recents: ReturnType<typeof signal<unknown[]>>;
  };

  const data = (): CorridorSnapshotData => ({
    hq: { lat: 49.37721, lon: 10.17904, x: 0, z: 0 },
    spawns: [],
    cellSize: 2,
    camera: null,
    state: { routes: [], stations: [] },
    cells: [],
    probes: [],
    trace: [],
    tiles: null,
    region: null,
    tilePaths: null,
    screenshot: null,
    cost: { cells: 0, cellsMs: 0, columnsMs: 0, slices: 0, screenshotMs: 0, wallMs: 0 },
  });

  const connect = () => service.connect(source as unknown as CorridorSnapshotSource);

  /** The last file handed to the download: its name and its JSON. */
  async function saved(): Promise<{ name: string; file: { meta: { time: string; load: object } } }> {
    const [blob, name] = download.downloadBlob.mock.calls.at(-1) as [Blob, string];
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsText(blob);
    });
    return { name, file: JSON.parse(text) };
  }

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    download.downloadBlob.mockClear();
    source = { blocker: vi.fn(() => null), read: vi.fn(async () => data()) };
    location = {
      hq: signal<{ lat: number; lon: number } | null>({ lat: 49.37721, lon: 10.17904 }),
      displayName: signal('Herrngasse, Rothenburg ob der Tauber'),
      missionInfo: signal<{ city: string } | null>({ city: 'Rothenburg ob der Tauber' }),
      recents: signal<unknown[]>([]),
    };
    const injector = Injector.create({ providers: [{ provide: LocationManagementService, useValue: location }] });
    service = runInInjectionContext(injector, () => new CorridorSnapshotService());
    window.history.replaceState({}, '', '/?l=49.37721,10.17904&s=49.37944,10.18365&key=secret');
  });

  afterEach(() => {
    resetCorridorConfig();
    window.history.replaceState({}, '', '/');
    vi.restoreAllMocks();
  });

  it('says why there is no snapshot without a location or while the game refuses one, and saves nothing', async () => {
    await expect(service.take()).resolves.toBe('No location loaded.');
    expect(service.status()).toBe('No location loaded.');

    connect();
    source.blocker.mockReturnValue('The corridor is being built: take the snapshot once it stands.');
    await expect(service.take()).resolves.toBe('The corridor is being built: take the snapshot once it stands.');
    expect(service.status()).toBe('The corridor is being built: take the snapshot once it stands.');
    expect(source.read).not.toHaveBeenCalled();
    expect(download.downloadBlob).not.toHaveBeenCalled();
  });

  it('saves the snapshot of a page load as corridor-<town>-cold-<time>.json, with its head, and names the file on the tile', async () => {
    connect();
    setCorridorConfig({ maxHalfWidth: 6 });

    const line = await service.take();

    expect(download.downloadBlob).toHaveBeenCalledTimes(1);
    const { name, file } = await saved();
    expect(name).toMatch(/^corridor-rothenburg-ob-der-tauber-cold-\d{6}\.json$/);
    expect(line).toMatch(new RegExp(`^Saved ${name.replace(/\./g, '\\.')}, \\d+ kB$`));
    expect(service.status()).toBe(line);
    expect(service.busy()).toBe(false);
    expect(console.log).toHaveBeenCalledWith(`[Corridor] snapshot: ${line}`);

    expect(file.meta).toMatchObject({
      version: BUILD_VERSION,
      url: 'http://localhost:3000/?l=49.37721,10.17904&s=49.37944,10.18365',
      location: 'Herrngasse, Rothenburg ob der Tauber',
      load: { kind: 'cold', label: 'page load', loads: 1, previous: null },
      corridor: { maxHalfWidth: 6 },
      corridorChanged: { maxHalfWidth: 6 },
      hq: { lat: 49.37721, lon: 10.17904, x: 0, z: 0 },
    });
    expect(Date.parse(file.meta.time)).not.toBeNaN();
  });

  it('calls a place reached in the game nav, and names the file after the header or the HQ without a town', async () => {
    connect();
    corridorTrace.begin('location change');
    location.missionInfo.set(null);

    await service.take();
    expect((await saved()).name).toMatch(/^corridor-herrngasse-rothenburg-ob-nav-\d{6}\.json$/);
    expect((await saved()).file.meta.load).toMatchObject({ kind: 'nav', label: 'location change', loads: 2 });

    location.displayName.set('Loading...');
    await service.take();
    expect((await saved()).name).toMatch(/^corridor-49-3772-10-1790-nav-\d{6}\.json$/);
  });

  it('shows how far it is while it reads, takes one at a time and says what stopped it', async () => {
    connect();
    let finish!: (value: CorridorSnapshotData | string) => void;
    source.read.mockImplementation((progress: (done: number, total: number) => void) => new Promise((resolve) => {
      progress(500, 2000);
      finish = resolve;
    }));

    const first = service.take();
    expect(service.busy()).toBe(true);
    expect(service.status()).toBe('Snapshot: cells 25 %');
    await expect(service.take()).resolves.toBe('A snapshot is being taken.');
    expect(source.read).toHaveBeenCalledTimes(1);

    finish('The location changed during the snapshot: take it again.');
    await expect(first).resolves.toBe('The location changed during the snapshot: take it again.');
    expect(service.busy()).toBe(false);
    expect(download.downloadBlob).not.toHaveBeenCalled();
  });

  it('keeps the source of the game in use when another one goes', async () => {
    connect();
    service.disconnect({ blocker: () => null, read: async () => data() });
    await service.take();
    expect(source.read).toHaveBeenCalledTimes(1);

    service.disconnect(source as unknown as CorridorSnapshotSource);
    await expect(service.take()).resolves.toBe('No location loaded.');
  });
});
