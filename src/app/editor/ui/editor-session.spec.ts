import '@angular/compiler';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { createMapDocument } from '../../world/custom-map/map-create';
import { MapStore, MemoryMapBackend } from '../../world/custom-map/map-store';
import { MemoryVersionBackend, VersionHistory } from '../model/version-store';
import { DOWNLOAD_REMINDER_MS } from '../model/storage-safety';
import { MapFileError, packMapFile } from '../../world/custom-map/map-file';
import { EditorSession, saveErrorText } from './editor-session.service';

function session(): { s: EditorSession; backend: MemoryMapBackend; history: VersionHistory; versions: MemoryVersionBackend } {
  const s = TestBed.runInInjectionContext(() => new EditorSession());
  const backend = new MemoryMapBackend();
  const versions = new MemoryVersionBackend();
  const history = new VersionHistory(versions);
  Object.assign(s, { store: new MapStore({ backend, fetch: async () => new Response('', { status: 404 }), baseUrl: 'http://x/' }), history });
  s.setDocument(createMapDocument({ id: 'm', name: 'M', width: 64, depth: 64, now: new Date(0) }));
  return { s, backend, history, versions };
}

beforeAll(() => {
  getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
});

afterAll(() => getTestBed().resetTestEnvironment());

describe('editor session opening', () => {
  it('opens a shipped or a coop map as an own copy at once', async () => {
    const { s, backend } = session();
    const shipped = createMapDocument({ id: 'harbour', name: 'Harbour', width: 32, depth: 32 });
    const files: Record<string, Uint8Array> = { 'http://x/maps/harbour.3dtdmap': packMapFile(shipped) };
    const fetch = async (url: string) =>
      url.endsWith('index.json')
        ? Response.json({ maps: [{ id: 'harbour', name: 'Harbour', file: 'harbour.3dtdmap' }] })
        : new Response(files[url] as Uint8Array<ArrayBuffer>, { status: files[url] ? 200 : 404 });
    Object.assign(s, { store: new MapStore({ backend, fetch, baseUrl: 'http://x/' }), catalogReady: Promise.resolve() });
    const id = await s.open('harbour');
    expect(id).toBe('harbour-copy');
    expect(s.doc!.meta).toMatchObject({ id: 'harbour-copy', name: 'Harbour (copy)' });
    expect(s.readOnly()).toBe(false);
    expect((await backend.get('harbour-copy'))?.summary.origin).toBe('own');
    expect(s.status()).toContain('own copy of Harbour');

    const host = createMapDocument({ id: 'hosts-map', name: 'Host', width: 32, depth: 32 });
    await s.store.saveShared(host, null, packMapFile(host));
    expect(await s.open('hosts-map')).toBe('host-copy');
    expect((await backend.get('hosts-map'))?.summary.origin).toBe('shared');
    expect(await s.open('harbour-copy')).toBe('harbour-copy');
    s.ngOnDestroy();
  });
});

describe('editor session heightmap import', () => {
  it('takes no heightmap without a usable range, as heights that are no numbers would make the map unreadable', async () => {
    const { s } = session();
    const raw = new File([new Uint8Array(8 * 8 * 2).fill(128)], 'h.raw');
    const before = s.doc!.terrain.grid.heights.slice();
    expect(await s.importHeightmap(raw, Number.NaN, 20)).toBe(false);
    expect(await s.importHeightmap(raw, 0, 1e6)).toBe(false);
    expect(s.doc!.terrain.grid.heights).toEqual(before);
    expect(s.error()).toContain('lowest and a highest height');
    s.ngOnDestroy();
  });
});

describe('editor session and other tabs', () => {
  it('turns read-only when another tab takes the map, and reads it again when it gets it back', async () => {
    const { s } = session();
    await s.save(true);
    const lock = s['lock']!;
    s['lockLost'](lock);
    expect(s.readOnly()).toBe(true);
    s.editMeta({ name: 'Mine' });
    s.undo();
    expect(s.doc!.meta.name).toBe('Mine');
    expect(await s.save(true)).toBe(false);
    expect(s.status()).toContain('another tab edits');
    // The other tab saved a change and let go
    const theirs = structuredClone(s.doc!);
    theirs.meta.name = 'Theirs';
    await s.store.save(theirs);
    await s['lockGranted'](lock);
    expect(s.readOnly()).toBe(false);
    expect(s.doc!.meta.name).toBe('Theirs');
    s.editMeta({ name: 'Mine' });
    expect(s.doc!.meta.name).toBe('Mine');
    s.ngOnDestroy();
  });
});

describe('editor session importing', () => {
  it('asks about a file of an own map: Replace keeps the id and makes the old content a version, Keep both adds a map', async () => {
    const { s, versions } = session();
    await s.save(true);
    await new Promise((r) => setTimeout(r, 0));
    const file = packMapFile(s.doc!);
    const read = () => new File([file as Uint8Array<ArrayBuffer>], 'm.3dtdmap');
    expect(await s.importFile(read())).toBeNull();
    expect(s.importMatch()?.existing.id).toBe('m');
    expect(await s.resolveImport('replace')).toBe('m');
    expect((await s.store.listOwn()).map((m) => m.id)).toEqual(['m']);
    expect((await versions.list('m')).length).toBeGreaterThanOrEqual(1);
    await s.importFile(read());
    expect(await s.resolveImport('copy')).toBe('m-2');
    await s.importFile(read());
    expect(await s.resolveImport('cancel')).toBeNull();
    expect((await s.store.listOwn()).map((m) => m.id).sort()).toEqual(['m', 'm-2']);
    s.ngOnDestroy();
  });
});

describe('editor session while busy', () => {
  it('holds undo, redo, saving and restoring while a terrain job runs or a stroke is held', async () => {
    const { s, backend } = session();
    s.editMeta({ name: 'Renamed' });
    s.terrainJob.set({ label: 'Eroding the map', progress: 0.3 });
    s.undo();
    expect(s.doc!.meta.name).toBe('Renamed');
    expect(s.status()).toContain('Undo waits');
    const puts = vi.spyOn(backend, 'put');
    expect(await s.save(true)).toBe(false);
    expect(await s.save(false)).toBe(false);
    expect(puts).not.toHaveBeenCalled();
    expect(await s.close()).toBe(false);
    // Changes to the ground from the panels wait too: Cancel would put the heights of before the job back over them
    const grid = s.doc!.terrain.grid;
    s.resize(s.doc!.terrain.width / 2, s.doc!.terrain.depth / 2);
    s.increaseDetail();
    expect(s.doc!.terrain.grid).toBe(grid);
    expect(s.groundEditor('Changing the water')).toBeNull();
    expect(s.status()).toContain('Changing the water waits');
    s.terrainJob.set(null);
    expect(s.groundEditor('Changing the water')).toBe(s.editor);

    // A held stroke in the view
    Object.assign(s, { viewport: { dragging: true, dispose: () => undefined } });
    s.undo();
    expect(s.doc!.meta.name).toBe('Renamed');
    expect(s.status()).toContain('finish the stroke');
    const version = { key: 'k', mapId: 'm', savedAt: '', manual: true, size: 1 };
    const bytes = vi.spyOn(s['history'], 'bytes');
    await s.restoreVersion(version as never);
    expect(bytes).not.toHaveBeenCalled();
    Object.assign(s, { viewport: null });
    s.undo();
    expect(s.doc!.meta.name).toBe('M');
    s.ngOnDestroy();
  });
});

describe('editor session saving', () => {
  it('reminds of a download after long work where the browser may clear maps', async () => {
    const { s } = session();
    s.storage.set('evictable');
    await s.save(true);
    expect(s.downloadReminder()).toBe(false);
    Object.assign(s, { workSince: Date.now() - DOWNLOAD_REMINDER_MS - 1 });
    await s.save(true);
    expect(s.downloadReminder()).toBe(true);
    s.laterReminder();
    expect(s.downloadReminder()).toBe(false);
    s.storage.set('kept');
    Object.assign(s, { workSince: 0 });
    await s.save(true);
    expect(s.downloadReminder()).toBe(false);
    s.ngOnDestroy();
  });


  it('a save asked for during another waits for it instead of getting lost', async () => {
    const { s, backend } = session();
    const puts = vi.spyOn(backend, 'put');
    s.editor!.doc.meta.name = 'Changed';
    s.dirty.set(true);
    const [a, b] = await Promise.all([s.save(false), s.save(true)]);
    expect([a, b]).toEqual([true, true]);
    expect(puts).toHaveBeenCalledTimes(2);
    s.ngOnDestroy();
  });

  it('keeps the map open when it cannot be saved', async () => {
    const { s } = session();
    vi.spyOn(s.store, 'save').mockRejectedValue(new Error('disk full'));
    s.dirty.set(true);
    expect(await s.close()).toBe(false);
    expect(s.editor).not.toBeNull();
    s.ngOnDestroy();
  });

  it('deletes no map another tab edits: its next save would bring the map back', async () => {
    const { s } = session();
    await s.save(true);
    // The map's lock is held elsewhere
    const busy = { request: async (_n: string, _o: unknown, cb: (lock: unknown) => unknown) => cb(null) };
    Object.defineProperty(navigator, 'locks', { value: busy, configurable: true });
    try {
      expect(await s.deleteMap('m', 'M')).toBeNull();
      expect((await s.store.listOwn()).map((m) => m.id)).toEqual(['m']);
      expect(s.error()).toContain('open in another tab');
    } finally {
      delete (navigator as unknown as Record<string, unknown>)['locks'];
    }
    s.ngOnDestroy();
  });

  it('moves a map to the trash with its versions, back, and out for good; stops listening for the bot when it goes', async () => {
    const { s, versions } = session();
    await s.save(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(await versions.list('m')).toHaveLength(1);
    const key = await s.deleteMap('m');
    expect((await s.store.listOwn()).map((m) => m.id)).toEqual([]);
    expect((await s.listTrash()).map((m) => m.id)).toEqual([key]);
    expect(await versions.list('m')).toHaveLength(1);
    expect(await s.restoreMap(key!)).toBe('m');
    expect((await s.store.listOwn()).map((m) => m.id)).toEqual(['m']);
    expect(await s.listTrash()).toEqual([]);
    // A new map takes the id meanwhile: the old one comes back under a free id, its versions with it
    const key2 = await s.deleteMap('m');
    await s.store.save(createMapDocument({ id: 'm', name: 'Other', width: 64, depth: 64 }));
    expect(await s.restoreMap(key2!)).toBe('m-2');
    expect(await versions.list('m-2')).toHaveLength(1);
    expect(await versions.list('m')).toEqual([]);
    await s.store.delete('m');
    await s.deleteMap('m-2');
    await s.deleteForGood((await s.listTrash())[0]);
    expect(await s.listTrash()).toEqual([]);
    expect(await versions.list('m-2')).toEqual([]);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const remove = vi.spyOn(window, 'removeEventListener');
    await s.botCheck(2);
    s.ngOnDestroy();
    expect(remove).toHaveBeenCalledWith('message', expect.any(Function));
    open.mockRestore();
  });
});

describe('save errors in plain words', () => {
  it('say what happened, that nothing is lost and what to do', () => {
    const full = saveErrorText(Object.assign(new Error('x'), { name: 'QuotaExceededError' }));
    expect(full).toMatch(/no more room/);
    expect(full).toMatch(/still here/);
    expect(saveErrorText(new MapFileError('The map is not valid: a river needs two points'))).toMatch(/Fix it \(Check, V\)/);
    expect(saveErrorText(new Error('boom'))).toMatch(/boom.*still here/);
  });
});

describe('terrain jobs in the session', () => {

  it('generates in bands as one undo step, and Cancel puts the land back', async () => {
    const { s } = session();
    const heights = () => Array.from(s.editor!.doc.terrain.grid.heights);
    const flat = heights();
    expect(await s.generate({ preset: 'hills', seed: 4, strength: 0.6 }, false)).toBe(true);
    expect(heights()).not.toEqual(flat);
    expect(s.terrainJob()).toBeNull();
    s.undo();
    expect(heights()).toEqual(flat);
    // Stopped after its first band: nothing changed, nothing to undo
    const steps = s.editor!.historySteps;
    const run = s.generate({ preset: 'valleys', seed: 2, strength: 0.6 }, false);
    s.cancelTerrainJob();
    expect(await run).toBe(false);
    expect(heights()).toEqual(flat);
    expect(s.editor!.historySteps).toBe(steps);
    s.ngOnDestroy();
  });

  it('erodes the whole map as one undo step', async () => {
    const { s } = session();
    await s.generate({ preset: 'hills', seed: 4, strength: 0.9 }, false);
    const before = Array.from(s.editor!.doc.terrain.grid.heights);
    expect(await s.erodeWholeMap(0.3, 7)).toBe(true);
    expect(Array.from(s.editor!.doc.terrain.grid.heights)).not.toEqual(before);
    s.undo();
    expect(Array.from(s.editor!.doc.terrain.grid.heights)).toEqual(before);
    s.ngOnDestroy();
  });
});

describe('editor session brushes', () => {
  it('gives each tool its own brush, kept while another is in hand', () => {
    const { s } = session();
    expect(s.settings.brush.radius).toBe(40);
    s.patchSettings((st) => (st.brush.radius = 70));
    s.selectTool('paint');
    expect(s.settings.brush.radius).toBe(12);
    s.patchSettings((st) => (st.brush.radius = 5));
    s.selectTool('landscape');
    expect(s.settings.brush.radius).toBe(70);
    s.selectTool('paint');
    expect(s.settings.brush.radius).toBe(5);
    s.ngOnDestroy();
  });
});
