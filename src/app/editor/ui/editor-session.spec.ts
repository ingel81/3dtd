import '@angular/compiler';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { createMapDocument } from '../../world/custom-map/map-create';
import { MapStore, MemoryMapBackend } from '../../world/custom-map/map-store';
import { MemoryVersionBackend, VersionHistory } from '../model/version-store';
import { DOWNLOAD_REMINDER_MS } from '../model/storage-safety';
import { MAX_FILE_BYTES, MapFileError, contentHash, packMapFile, unpackMapFile } from '../../world/custom-map/map-file';
import { EditorSession } from './editor-session.service';
import { CHECK_DELAY_MS } from '../services/check-service';
import { saveErrorText } from '../services/save-service';
import { EditorHeldError } from '../model/editor-document';
import { SnapshotCommand } from '../model/commands/snapshot';
import { LandscapeContext } from '../ops/landscape/landscape-context';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CatalogIndex, normalizeCatalog } from '../../map-ops/asset-catalog';
import { EditorAgent, type ScriptSandbox } from '../agent/editor-agent';
import { runMapScript } from '../agent/map-script';
import { contentFingerprint } from '../agent/agent-reads';
import { STOPPED } from '../agent/editor-agent';
import { MemoryStampBackend, StampLibrary } from '../model/stamp-store';
import { encodePng16, gridToImage } from '../ops/heightmap';
import type { ScriptRunResult } from '../agent/map-script';
import { WorldSession } from '../../world/world-session.service';
import { AppScreen } from '../../world/app-screen.service';
import { PLAIN_START, type WorldStart } from '../../world/world-start';
import type { MapTrialResult } from '../../world/map-trial';
import { patch } from '../tools/tool';
import { en } from '../../i18n/messages/en';

function session(): { s: EditorSession; backend: MemoryMapBackend; history: VersionHistory; versions: MemoryVersionBackend } {
  const s = TestBed.runInInjectionContext(() => new EditorSession());
  const backend = new MemoryMapBackend();
  const versions = new MemoryVersionBackend();
  const history = new VersionHistory(versions);
  Object.assign(s.library, { store: new MapStore({ backend, fetch: async () => new Response('', { status: 404 }), baseUrl: 'http://x/' }), history });
  s.maps.setDocument(createMapDocument({ id: 'm', name: 'M', width: 64, depth: 64, now: new Date(0) }));
  return { s, backend, history, versions };
}

beforeAll(() => {
  getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
});

afterAll(() => getTestBed().resetTestEnvironment());

/**
 * A view standing in for EditorViewport with the parts a test needs: the
 * overlay takes what the session draws meanwhile (the worker's routes, the
 * build areas arrive at their own time)
 */
function fakeViewport(parts: object): object {
  return { overlay: { routes: { set: () => undefined }, buildAreas: { set: () => undefined } }, dispose: () => undefined, ...parts };
}

describe('editor session opening', () => {
  it('opens a shipped or a coop map as it is; the first save with a change makes the own copy (decision 8)', async () => {
    const { s, backend } = session();
    const shipped = createMapDocument({ id: 'harbour', name: 'Harbour', width: 32, depth: 32 });
    const files: Record<string, Uint8Array> = { 'http://x/maps/harbour.3dtdmap': packMapFile(shipped) };
    const fetch = async (url: string) =>
      url.endsWith('index.json')
        ? Response.json({ maps: [{ id: 'harbour', name: 'Harbour', file: 'harbour.3dtdmap' }] })
        : new Response(files[url] as Uint8Array<ArrayBuffer>, { status: files[url] ? 200 : 404 });
    Object.assign(s.library, { store: new MapStore({ backend, fetch, baseUrl: 'http://x/' }) });
    Object.assign(s, { catalogReady: Promise.resolve() });
    const id = await s.maps.open('harbour');
    expect(id).toBe('harbour');
    expect(s.doc!.meta).toMatchObject({ id: 'harbour', name: 'Harbour' });
    expect(s.maps.readOnly()).toBe(false);
    expect(s.notices.status()).toContain('your own copy comes with the first change');
    // Saving with nothing changed keeps nothing
    expect(await s.saves.save(true)).toBe(true);
    expect(await s.library.store.listOwn()).toEqual([]);
    s.editMeta({ description: 'Mine' });
    expect(await s.saves.save(false)).toBe(true);
    expect(s.doc!.meta).toMatchObject({ id: 'harbour-copy', name: 'Harbour (copy)', description: 'Mine' });
    expect((await backend.get('harbour-copy'))?.summary.origin).toBe('own');
    expect(s.notices.status()).toContain('own copy of Harbour');

    const host = createMapDocument({ id: 'hosts-map', name: 'Host', width: 32, depth: 32 });
    await s.library.store.saveShared(host, null, packMapFile(host));
    expect(await s.maps.open('hosts-map')).toBe('hosts-map');
    s.editMeta({ description: 'Ours' });
    await s.saves.save(true);
    expect(s.doc!.meta.id).toBe('host-copy');
    expect((await backend.get('hosts-map'))?.summary.origin).toBe('shared');
    expect(await s.maps.open('harbour-copy')).toBe('harbour-copy');
    s.ngOnDestroy();
  });
});

describe('editor session and copies', () => {
  it('an OpenStreetMap map leaves its world with the first save that changes it (decision 5)', async () => {
    const { s } = session();
    const made = createMapDocument({ id: 'miltenberg', name: 'Miltenberg', width: 32, depth: 32 });
    made.meta.generated = true;
    await s.library.store.save(made);
    await s.maps.open('miltenberg');
    expect(await s.saves.save(true)).toBe(true);
    expect((await s.library.store.listOwn()).find((m) => m.id === 'miltenberg')?.generated).toBe(true);
    s.editMeta({ description: 'Mine now' });
    await s.saves.save(true);
    expect(s.doc!.meta.generated).toBeUndefined();
    expect((await s.library.store.listOwn()).find((m) => m.id === 'miltenberg')?.generated).toBeUndefined();
    s.ngOnDestroy();
  });

  it('opens the copy made before on a second Edit, and offers a fresh one when the original changed', async () => {
    const { s, backend } = session();
    let shipped = createMapDocument({ id: 'harbour', name: 'Harbour', width: 32, depth: 32 });
    let hash = await contentHash(shipped);
    const fetch = async (url: string) =>
      url.endsWith('index.json')
        ? Response.json({ maps: [{ id: 'harbour', name: 'Harbour', file: 'harbour.3dtdmap', contentHash: hash }] })
        : new Response(packMapFile(shipped) as Uint8Array<ArrayBuffer>, { status: 200 });
    Object.assign(s.library, { store: new MapStore({ backend, fetch, baseUrl: 'http://x/' }) });
    Object.assign(s, { catalogReady: Promise.resolve() });
    expect(await s.maps.open('harbour')).toBe('harbour');
    s.editMeta({ description: 'Mine' });
    await s.saves.save(true);
    expect(s.doc!.meta.copyOf).toEqual({ id: 'harbour', hash });
    expect(await s.maps.open('harbour')).toBe('harbour-copy');
    expect(s.doc!.meta.description).toBe('Mine');
    expect(s.maps.staleCopy()).toBeNull();
    // A game update changes the original
    shipped = createMapDocument({ id: 'harbour', name: 'Harbour', width: 48, depth: 48 });
    hash = await contentHash(shipped);
    Object.assign(s.library, { store: new MapStore({ backend, fetch, baseUrl: 'http://x/' }) });
    expect(await s.maps.open('harbour')).toBe('harbour-copy');
    expect(s.maps.staleCopy()).toMatchObject({ original: 'harbour' });
    // Saved a moment later than the first copy, so it is the newest
    await new Promise((r) => setTimeout(r, 5));
    expect(await s.maps.freshCopy()).toBe('harbour-copy-2');
    expect(s.doc!.terrain.width).toBe(48);
    expect(s.doc!.meta.copyOf).toEqual({ id: 'harbour', hash });
    expect((await s.library.store.listOwn()).map((m) => m.id).sort()).toEqual(['harbour-copy', 'harbour-copy-2']);
    // The newest copy opens from now on
    expect(await s.maps.open('harbour')).toBe('harbour-copy-2');
    expect(s.maps.staleCopy()).toBeNull();
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
    expect(s.notices.error()).toContain('lowest and a highest height');
    s.ngOnDestroy();
  });
});

describe('editor session and other tabs', () => {
  it('turns read-only when another tab takes the map, and reads it again when it gets it back', async () => {
    const { s } = session();
    await s.saves.save(true);
    const lock = s.maps['lock']!;
    s.maps['lockLost'](lock);
    expect(s.maps.readOnly()).toBe(true);
    // The map is held: nothing here writes to it, the status bar says why
    s.editMeta({ name: 'Mine' });
    expect(s.doc!.meta.name).toBe('M');
    expect(s.notices.status()).toContain('Map details waits: another tab edits');
    s.undo();
    expect(await s.saves.save(true)).toBe(false);
    expect(s.notices.status()).toContain('another tab edits');
    // The other tab saved a change and let go
    const theirs = structuredClone(s.doc!);
    theirs.meta.name = 'Theirs';
    await s.library.store.save(theirs);
    await s.maps['lockGranted'](lock);
    expect(s.maps.readOnly()).toBe(false);
    expect(s.doc!.meta.name).toBe('Theirs');
    s.editMeta({ name: 'Mine' });
    expect(s.doc!.meta.name).toBe('Mine');
    s.ngOnDestroy();
  });
});

describe('editor session importing', () => {
  it('refuses a map file larger than any map without reading it', async () => {
    const { s } = session();
    const file = new File([], 'huge.3dtdmap');
    Object.defineProperty(file, 'size', { value: MAX_FILE_BYTES + 1 });
    const read = vi.spyOn(file, 'arrayBuffer');
    expect(await s.library.importFile(file)).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(s.notices.error()).toMatch(/too large for a map/);
    s.ngOnDestroy();
  });

  it('asks about a file of an own map: Replace keeps the id and makes the old content a version, Keep both adds a map', async () => {
    const { s, versions } = session();
    await s.saves.save(true);
    await new Promise((r) => setTimeout(r, 0));
    const file = packMapFile(s.doc!);
    const read = () => new File([file as Uint8Array<ArrayBuffer>], 'm.3dtdmap');
    expect(await s.library.importFile(read())).toBeNull();
    expect(s.library.importMatch()?.existing.id).toBe('m');
    expect(await s.library.resolveImport('replace')).toBe('m');
    expect((await s.library.store.listOwn()).map((m) => m.id)).toEqual(['m']);
    expect((await versions.list('m')).length).toBeGreaterThanOrEqual(1);
    await s.library.importFile(read());
    expect(await s.library.resolveImport('copy')).toBe('m-2');
    await s.library.importFile(read());
    expect(await s.library.resolveImport('cancel')).toBeNull();
    expect((await s.library.store.listOwn()).map((m) => m.id).sort()).toEqual(['m', 'm-2']);
    s.ngOnDestroy();
  });
});

describe('editor session while busy', () => {
  it('holds undo, redo, saving and restoring while a terrain job runs or a stroke is held', async () => {
    const { s, backend } = session();
    s.editMeta({ name: 'Renamed' });
    s.jobs.job.set({ label: 'Eroding the map', progress: 0.3 });
    s.undo();
    expect(s.doc!.meta.name).toBe('Renamed');
    expect(s.notices.status()).toContain('Undo waits');
    const puts = vi.spyOn(backend, 'put');
    expect(await s.saves.save(true)).toBe(false);
    expect(await s.saves.save(false)).toBe(false);
    expect(puts).not.toHaveBeenCalled();
    expect(await s.maps.close()).toBe(false);
    // Changes to the ground from the panels wait too: Cancel would put the heights of before the job back over them
    const grid = s.doc!.terrain.grid;
    s.resize(s.doc!.terrain.width / 2, s.doc!.terrain.depth / 2);
    s.increaseDetail();
    expect(s.doc!.terrain.grid).toBe(grid);
    expect(s.edit('Changing the water', () => undefined)).toBe(false);
    expect(s.notices.status()).toContain('Changing the water waits');
    s.jobs.job.set(null);
    expect(s.edit('Changing the water', () => undefined)).toBe(true);

    // A held stroke in the view
    Object.assign(s['viewHost'], { viewport: fakeViewport({ input: { dragging: true } }) });
    s.undo();
    expect(s.doc!.meta.name).toBe('Renamed');
    expect(s.notices.status()).toContain('finish the stroke');
    const version = { key: 'k', mapId: 'm', savedAt: '', manual: true, size: 1 };
    const bytes = vi.spyOn(s.library.history, 'bytes');
    await s.restoreVersion(version as never);
    expect(bytes).not.toHaveBeenCalled();
    Object.assign(s['viewHost'], { viewport: null });
    s.undo();
    expect(s.doc!.meta.name).toBe('M');
    s.ngOnDestroy();
  });
});

describe('editor session check', () => {
  it('checks an open map again after the last change, not while a stroke is held', async () => {
    vi.useFakeTimers();
    try {
      const { s } = session();
      await s.check.runCheck();
      const check = vi.spyOn(s.check, 'runCheck');
      const input = { dragging: true };
      Object.assign(s['viewHost'], { viewport: fakeViewport({ input }) });
      // Every poll of a stroke finds a change: the check waits for the stroke's end
      for (let k = 0; k < 10; k++) {
        s.editMeta({ description: `step ${k}` });
        s.state.refresh();
        vi.advanceTimersByTime(150);
      }
      vi.advanceTimersByTime(CHECK_DELAY_MS * 3);
      expect(check).not.toHaveBeenCalled();
      input.dragging = false;
      vi.advanceTimersByTime(CHECK_DELAY_MS);
      expect(check).toHaveBeenCalledTimes(1);
      Object.assign(s['viewHost'], { viewport: null });
      s.ngOnDestroy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('editor session saving', () => {
  it('reminds of a download after long work where the browser may clear maps', async () => {
    const { s } = session();
    s.saves.storage.set('evictable');
    await s.saves.save(true);
    expect(s.saves.downloadReminder()).toBe(false);
    Object.assign(s.saves, { workSince: Date.now() - DOWNLOAD_REMINDER_MS - 1 });
    await s.saves.save(true);
    expect(s.saves.downloadReminder()).toBe(true);
    s.saves.laterReminder();
    expect(s.saves.downloadReminder()).toBe(false);
    s.saves.storage.set('kept');
    Object.assign(s.saves, { workSince: 0 });
    await s.saves.save(true);
    expect(s.saves.downloadReminder()).toBe(false);
    s.ngOnDestroy();
  });


  it('a save asked for during another waits for it instead of getting lost', async () => {
    const { s, backend } = session();
    const puts = vi.spyOn(backend, 'put');
    s.editor!.doc.meta.name = 'Changed';
    s.saves.dirty.set(true);
    const [a, b] = await Promise.all([s.saves.save(false), s.saves.save(true)]);
    expect([a, b]).toEqual([true, true]);
    expect(puts).toHaveBeenCalledTimes(2);
    s.ngOnDestroy();
  });

  it('keeps the map open when it cannot be saved', async () => {
    const { s } = session();
    vi.spyOn(s.library.store, 'save').mockRejectedValue(new Error('disk full'));
    s.saves.dirty.set(true);
    expect(await s.maps.close()).toBe(false);
    expect(s.editor).not.toBeNull();
    s.ngOnDestroy();
  });

  it('deletes no map another tab edits: its next save would bring the map back', async () => {
    const { s } = session();
    await s.saves.save(true);
    // The map's lock is held elsewhere
    const busy = { request: async (_n: string, _o: unknown, cb: (lock: unknown) => unknown) => cb(null) };
    Object.defineProperty(navigator, 'locks', { value: busy, configurable: true });
    try {
      expect(await s.library.deleteMap('m', 'M')).toBeNull();
      expect((await s.library.store.listOwn()).map((m) => m.id)).toEqual(['m']);
      expect(s.notices.error()).toContain('open in another tab');
    } finally {
      delete (navigator as unknown as Record<string, unknown>)['locks'];
    }
    s.ngOnDestroy();
  });

  it('moves a map to the trash with its versions, back, and out for good', async () => {
    const { s, versions } = session();
    await s.saves.save(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(await versions.list('m')).toHaveLength(1);
    const key = await s.library.deleteMap('m');
    expect((await s.library.store.listOwn()).map((m) => m.id)).toEqual([]);
    expect((await s.library.listTrash()).map((m) => m.id)).toEqual([key]);
    expect(await versions.list('m')).toHaveLength(1);
    expect(await s.library.restoreMap(key!)).toBe('m');
    expect((await s.library.store.listOwn()).map((m) => m.id)).toEqual(['m']);
    expect(await s.library.listTrash()).toEqual([]);
    // A new map takes the id meanwhile: the old one comes back under a free id, its versions with it
    const key2 = await s.library.deleteMap('m');
    await s.library.store.save(createMapDocument({ id: 'm', name: 'Other', width: 64, depth: 64 }));
    expect(await s.library.restoreMap(key2!)).toBe('m-2');
    expect(await versions.list('m-2')).toHaveLength(1);
    expect(await versions.list('m')).toEqual([]);
    await s.library.store.delete('m');
    await s.library.deleteMap('m-2');
    await s.library.deleteForGood((await s.library.listTrash())[0]);
    expect(await s.library.listTrash()).toEqual([]);
    expect(await versions.list('m-2')).toEqual([]);
    s.ngOnDestroy();
  });
});

describe('editor session saving', () => {
  it('stores file, content hash and summary of one state, though the map changes while it saves', async () => {
    const { s, backend } = session();
    s.editMeta({ name: 'Packed' });
    const save = s.library.store.save.bind(s.library.store);
    // The player renames the map right after the copy for the file was taken
    vi.spyOn(s.library.store, 'save').mockImplementation((doc, preview, file, options) => {
      s.editMeta({ name: 'Later' });
      return save(doc, preview, file, options);
    });
    expect(await s.saves.save(true)).toBe(true);
    const stored = (await backend.get('m'))!;
    const { doc } = unpackMapFile(stored.file);
    expect(doc.meta.name).toBe('Packed');
    expect(stored.summary.name).toBe('Packed');
    expect(stored.summary.contentHash).toBe(await contentHash(doc));
    expect(s.saves.dirty()).toBe(true);
    s.ngOnDestroy();
  });
});

describe('editor session versions', () => {
  it('keeps no second version for Ctrl+S on a map that did not change', async () => {
    const { s, versions } = session();
    s.editMeta({ name: 'Once' });
    expect(await s.saves.save(true)).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(await versions.list('m')).toHaveLength(1);
    const updated = s.doc!.meta.updatedAt;
    expect(await s.saves.save(true)).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(await versions.list('m')).toHaveLength(1);
    expect(s.doc!.meta.updatedAt).toBe(updated);
    expect(s.notices.status()).toBe('Saved');
    s.ngOnDestroy();
  });

  it('restores all of a kept version: life, intro flight and prefabs too, the name stays', async () => {
    const { s } = session();
    s.editLife((life) => (life.flags = true), 'Banners wave');
    await s.saves.save(true);
    await s.saves.loadVersions();
    const [version] = s.saves.versions();
    s.editLife((life) => (life.flags = false), 'Banners still');
    s.editIntro({ kind: 'orbit', distance: 80, height: 40, angle: 0, seconds: 10 } as never);
    s.editMeta({ name: 'Renamed' });
    s.editor!.doc.prefabs = [];
    await s.restoreVersion(version);
    expect(s.doc!.life?.flags).toBe(true);
    expect(s.doc!.intro).toBeUndefined();
    expect(s.doc!.prefabs).toBeUndefined();
    expect(s.doc!.meta.name).toBe('Renamed');
    expect(s.state.undoLabel()).toBe('Restore version');
    s.undo();
    expect(s.doc!.intro).toBeDefined();
    s.ngOnDestroy();
  });
});

describe('editor session holds the map during a job', () => {
  it('refuses ground edits from the panels while a job runs, so Cancel leaves map and history matching', async () => {
    const { s } = session();
    const editor = s.editor!;
    s.editMeta({ name: 'Before' });
    const steps = editor.historySteps;
    const heights = editor.doc.terrain.grid.heights.slice();
    // A stroke begun before the job: it may write, but not land while the job runs
    const early = new LandscapeContext(editor.begin('Raise'), 1, s.catalog());
    let finish!: () => void;
    const job = s.jobs.agentEdit('Agent: slow', (_ed, signal) =>
      new Promise<void>((resolve, reject) => {
        finish = resolve;
        signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')));
      }),
    );
    // The panels' road and river buttons write the ground in a transaction (path-panel flatten, water-panel recarve)
    expect(() => editor.begin('Carve the river bed')).toThrow(EditorHeldError);
    expect(s.notices.status()).toBe('Carve the river bed waits: a job runs (Cancel stops it)');
    const all = { i0: 0, j0: 0, i1: 4, j1: 4 };
    early.tx.touch('heights', all);
    editor.doc.terrain.grid.heights.fill(-3, 0, 4);
    early.changed({ heights: all });
    expect(() => early.finish()).toThrow(EditorHeldError);
    s['execute'](SnapshotCommand.record(editor.doc, 'Map details', ['meta'], (d) => (d.meta = { ...d.meta, name: 'During' })));
    expect(s.notices.status()).toBe('Map details waits: a job runs (Cancel stops it)');
    expect(editor.doc.meta.name).toBe('Before');
    expect(editor.doc.terrain.grid.heights).toEqual(heights);
    expect(editor.historySteps).toBe(steps);
    s.jobs.cancel();
    await expect(job).rejects.toThrow('stopped');
    expect(editor.historySteps).toBe(steps);
    expect(editor.heldReason).toBeNull();
    // Free again: the next step lands
    s.editMeta({ name: 'After' });
    expect(editor.historySteps).toBe(steps + 1);
    void finish;
    s.ngOnDestroy();
  });
});

describe('save errors in plain words', () => {
  it('say what happened, that nothing is lost and what to do', () => {
    const full = saveErrorText(en, Object.assign(new Error('x'), { name: 'QuotaExceededError' }));
    expect(full).toMatch(/no more room/);
    expect(full).toMatch(/still here/);
    const invalid = saveErrorText(en, new MapFileError('The map is not valid: river r needs two points', ['river r needs two points', 'object o has a bad placement']));
    expect(invalid).toBe('The map was not saved: river r needs two points (and 1 more). Your changes are still here; the check (V) lists each problem and where to fix it, then save again.');
    expect(saveErrorText(en, new MapFileError('x', ['x']), 'downloaded')).toMatch(/^The map was not downloaded: x\. /);
    expect(saveErrorText(en, new Error('boom'))).toMatch(/boom.*still here/);
  });
});

describe('terrain jobs in the session', () => {

  it('generates in bands as one undo step, and Cancel puts the land back', async () => {
    const { s } = session();
    const heights = () => Array.from(s.editor!.doc.terrain.grid.heights);
    const flat = heights();
    expect(await s.jobs.generate({ preset: 'hills', seed: 4, strength: 0.6 }, false)).toBe(true);
    expect(heights()).not.toEqual(flat);
    expect(s.jobs.job()).toBeNull();
    s.undo();
    expect(heights()).toEqual(flat);
    // Stopped after its first band: nothing changed, nothing to undo
    const steps = s.editor!.historySteps;
    const run = s.jobs.generate({ preset: 'valleys', seed: 2, strength: 0.6 }, false);
    s.jobs.cancel();
    expect(await run).toBe(false);
    expect(heights()).toEqual(flat);
    expect(s.editor!.historySteps).toBe(steps);
    s.ngOnDestroy();
  });

  it('erodes the whole map as one undo step', async () => {
    const { s } = session();
    await s.jobs.generate({ preset: 'hills', seed: 4, strength: 0.9 }, false);
    const before = Array.from(s.editor!.doc.terrain.grid.heights);
    expect(await s.jobs.erodeWholeMap(0.3, 7)).toBe(true);
    expect(Array.from(s.editor!.doc.terrain.grid.heights)).not.toEqual(before);
    s.undo();
    expect(Array.from(s.editor!.doc.terrain.grid.heights)).toEqual(before);
    s.ngOnDestroy();
  });
});

describe('editor session brushes', () => {
  it('gives each tool its own brush, kept while another is in hand', () => {
    const { s } = session();
    // A map opens on Look; Landscape's brush starts at its own size
    expect(s.tools.tool()).toBe('look');
    s.tools.select('landscape');
    expect(s.tools.settings.brush().radius).toBe(40);
    patch(s.tools.settings.brush, { radius: 70 });
    s.tools.select('paint');
    expect(s.tools.settings.brush().radius).toBe(12);
    patch(s.tools.settings.brush, { radius: 5 });
    s.tools.select('landscape');
    expect(s.tools.settings.brush().radius).toBe(70);
    s.tools.select('paint');
    expect(s.tools.settings.brush().radius).toBe(5);
    s.ngOnDestroy();
  });
});

describe('editor session tests in the window (E195 phase 5)', () => {
  it('plays the map in this window once it is saved, from the wave asked, and never as a run to keep', async () => {
    const { s } = session();
    const opened: WorldStart[] = [];
    const open = vi.spyOn(TestBed.inject(WorldSession), 'open').mockImplementation((order) => void opened.push(order));
    vi.spyOn(s.saves, 'save').mockResolvedValue(true);
    await s.check.testPlay();
    expect(opened).toEqual([{ ...PLAIN_START, world: { kind: 'custom-map', mapId: 'm', contentHash: '' }, startWave: 1, trial: { bot: null }, play: true, label: 'M' }]);
    s.check.testFromWave.set(15);
    await s.check.testPlay();
    expect(opened[1].startWave).toBe(15);
    // A failed save keeps the editor
    vi.spyOn(s.saves, 'save').mockResolvedValue(false);
    await s.check.testPlay();
    expect(open).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
    s.ngOnDestroy();
  });

  it("runs the bot's check in this window and shows its result once it is back", async () => {
    const { s } = session();
    const opened: WorldStart[] = [];
    vi.spyOn(TestBed.inject(WorldSession), 'open').mockImplementation((order) => void opened.push(order));
    vi.spyOn(s.saves, 'save').mockResolvedValue(true);
    s.check.testFromWave.set(9);
    await s.check.botCheck(3);
    expect(opened[0]).toMatchObject({ startWave: 1, trial: { bot: 3 } });
    expect(s.check.botTrial()).toEqual({ waves: 3, result: null });
    const result: MapTrialResult = { outcome: 'passed', waves: 3, wavesHeld: 3, hqStart: 500, hqEnd: 480, hpLostByWave: [0, 20, 0], towers: 6, gameTimeMs: 1 };
    TestBed.inject(AppScreen).trialEnded(result);
    expect(s.check.botTrial()).toEqual({ waves: 3, result });
    vi.restoreAllMocks();
    s.ngOnDestroy();
  });
});

describe('editor session and the AI agent', () => {
  const catalog = new CatalogIndex(normalizeCatalog(JSON.parse(readFileSync(resolve('public/maps/assets/catalog.json'), 'utf8')), 'http://x/maps/assets/'));
  const inProcess: ScriptSandbox = async (source, doc, c, seed) => runMapScript(source, doc, c.catalog, { seed });

  async function agentSession(sandbox = inProcess): Promise<{ s: EditorSession; agent: EditorAgent }> {
    const { s } = session();
    // The page's catalogue does not load here; the shipped one stands in after it gave up
    await s.catalogReady.catch(() => undefined);
    s.catalog.set(catalog);
    return { s, agent: new EditorAgent(s.agent, sandbox) };
  }

  const call = (agent: EditorAgent, tool: string, args: Record<string, unknown> = {}) => agent.handle({ tool, args });

  it('lands a script as one undo step that takes everything back', async () => {
    const { s, agent } = await agentSession();
    const editor = s.editor!;
    const heights = editor.doc.terrain.grid.heights.slice();
    const spawns = structuredClone(editor.doc.spawns);
    const steps = editor.historySteps;
    const answer = await call(agent, 'run_script', {
      source: `map.raise({ x: 0, y: 0 }, { radius: 12 }, 3); map.paint('dirt', [{ x: -20, y: -20 }, { x: 20, y: -20 }], { radius: 6 }); map.spawn('North', 0, 28); map.environment({ sky: 'dusk' });`,
      label: 'hill',
      animate: false,
    });
    expect(answer.isError).toBeFalsy();
    expect(JSON.parse(answer.text)).toMatchObject({ ok: true, changed: true, step: 'Agent: hill', commands: 4, sameAsSandbox: true });
    expect(editor.historySteps).toBe(steps + 1);
    expect(editor.undoLabel).toBe('Agent: hill');
    expect(editor.doc.environment.sky).toBe('dusk');
    expect(s.jobs.job()).toBeNull();
    s.undo();
    expect(Array.from(editor.doc.terrain.grid.heights)).toEqual(Array.from(heights));
    expect(editor.doc.spawns).toEqual(spawns);
    expect(editor.doc.environment.sky).not.toBe('dusk');
    s.redo();
    expect(editor.doc.environment.sky).toBe('dusk');
    s.ngOnDestroy();
  });

  it('keeps nothing of a script that fails, and says why', async () => {
    const { s, agent } = await agentSession();
    const before = s.editor!.historySteps;
    const answer = await call(agent, 'run_script', { source: `map.raise({ x: 0, y: 0 }, { radius: 12 }, 3);\nmap.place('no-such-thing', 0, 0);` });
    expect(answer.isError).toBe(true);
    expect(JSON.parse(answer.text).error).toMatch(/no asset no-such-thing;.*\(line 2\)/);
    expect(s.editor!.historySteps).toBe(before);
    s.ngOnDestroy();
  });

  it('puts the map back when the player cancels a play, and refuses a second edit meanwhile', async () => {
    const { s, agent } = await agentSession();
    const editor = s.editor!;
    const heights = editor.doc.terrain.grid.heights.slice();
    const steps = editor.historySteps;
    const play = s.jobs.agentEdit('Agent: long', async (ed, signal) => {
      ed.doc.terrain.grid.heights.fill(9);
      const second = await call(agent, 'move_marker', { target: 'hq', x: 1, y: 1 });
      expect(second).toMatchObject({ isError: true, text: expect.stringMatching(/cannot change now/) });
      s.jobs.cancel();
      if (signal.aborted) throw new DOMException('stopped', 'AbortError');
    });
    await expect(play).rejects.toThrow(/stopped/);
    expect(Array.from(editor.doc.terrain.grid.heights)).toEqual(Array.from(heights));
    expect(editor.historySteps).toBe(steps);
    s.ngOnDestroy();
  });

  it('makes each direct edit one step, and undoes only its own', async () => {
    const { s, agent } = await agentSession();
    const editor = s.editor!;
    expect(JSON.parse((await call(agent, 'move_marker', { target: 'hq', x: 5, y: -6 })).text)).toMatchObject({ ok: true, step: 'Agent: move HQ' });
    expect(editor.doc.hq).toEqual({ x: 5, y: -6 });
    const placed = JSON.parse((await call(agent, 'place_object', { asset: 'rock-small', x: 3, y: 4, scale: 2 })).text);
    const id = editor.doc.objects.at(-1)!.id;
    expect(placed.done).toBe(`${id} placed`);
    expect((await call(agent, 'move_object', { id, x: 8 })).isError).toBeFalsy();
    expect(editor.doc.objects.at(-1)!.x).toBe(8);
    expect((await call(agent, 'delete_objects', { ids: [id] })).isError).toBeFalsy();
    expect(editor.doc.objects.some((o) => o.id === id)).toBe(false);
    expect((await call(agent, 'set_sky', { environment: { sky: 'green' } })).isError).toBe(true);
    expect((await call(agent, 'set_rules', { rules: { startCredits: -5 } })).text).toMatch(/would not save/);
    expect(editor.undoLabel).toBe('Agent: delete 1 objects');
    expect(JSON.parse((await call(agent, 'undo_last')).text)).toMatchObject({ undone: 'Agent: delete 1 objects' });
    s.editMeta({ description: 'mine' });
    expect((await call(agent, 'undo_last')).text).toMatch(/not the agent's/);
    s.ngOnDestroy();
  });

  it('reads the open map, other maps only as copies, and answers without a map', async () => {
    const { s, agent } = await agentSession();
    const summary = JSON.parse((await call(agent, 'map_summary')).text);
    expect(summary).toMatchObject({ open: true, meta: { id: 'm' }, size: { width: 64, depth: 64 } });
    const heights = JSON.parse((await call(agent, 'map_heights', { x0: -32, y0: -32, x1: 32, y1: 32, samples: 5 })).text);
    expect(heights.heights).toHaveLength(heights.rows);
    expect(JSON.parse((await call(agent, 'check_map')).text)).toHaveProperty('issues');
    expect((await call(agent, 'script_api')).text).toContain('map.raise(');
    await s.saves.save(true);
    const copied = JSON.parse((await call(agent, 'copy_map', { id: 'm', name: 'Agent copy' })).text);
    expect(copied).toMatchObject({ id: 'agent-copy', name: 'Agent copy' });
    expect(s.editor!.doc.meta.id).toBe('m');
    expect(JSON.parse((await call(agent, 'read_map', { id: 'agent-copy' })).text).meta.name).toBe('Agent copy');
    expect(JSON.parse((await call(agent, 'list_maps')).text).maps.map((m: { id: string }) => m.id)).toEqual(expect.arrayContaining(['m', 'agent-copy']));
    expect((await call(agent, 'teleport')).isError).toBe(true);
    Object.assign(s.maps, { current: null });
    expect((await call(agent, 'map_summary')).text).toMatch(/No map is open/);
    s.ngOnDestroy();
  });

  it('says the asset catalogue did not load instead of answering with empty lists', async () => {
    const { s } = session();
    await s.catalogReady.catch(() => undefined);
    const agent = new EditorAgent(s.agent, inProcess);
    for (const answer of [await call(agent, 'catalog'), await call(agent, 'place_object', { asset: 'tree-fir', x: 0, y: 0 })]) {
      expect(answer.isError).toBe(true);
      expect(answer.text).toMatch(/asset catalogue did not load/);
    }
    const painted = await call(agent, 'run_script', { source: `map.biome('forest', { x: 0, y: 0 }, { radius: 10 });` });
    expect(painted.isError).toBe(true);
    expect(JSON.parse(painted.text).error).toMatch(/did not load.*map\.biome/);
    // Shaping the ground needs no catalogue
    expect(JSON.parse((await call(agent, 'run_script', { source: `map.raise({ x: 0, y: 0 }, { radius: 10 }, 2);`, animate: false })).text)).toMatchObject({ changed: true });
    s.ngOnDestroy();
  });

  it('lists the catalogue compactly without a filter, materials as a category, and names an unknown one', async () => {
    const { s, agent } = await agentSession();
    const all = JSON.parse((await call(agent, 'catalog')).text);
    expect(all.materials).toContain('grass');
    expect(all.objects['Trees']).toContain('tree-fir');
    expect(all.categories[0]).toBe('Materials');
    expect(JSON.stringify(all).length).toBeLessThan(30_000);
    const materials = JSON.parse((await call(agent, 'catalog', { category: 'materials' })).text);
    expect(materials.materials.length).toBeGreaterThan(10);
    expect(materials.objects).toEqual([]);
    expect(JSON.parse((await call(agent, 'catalog', { category: 'ground' })).text).note).toMatch(/no category ground; the categories are Materials, /);
    s.ngOnDestroy();
  });

  it('tries a script on a copy with dry_run, and makes no undo step for one that changes nothing', async () => {
    const { s, agent } = await agentSession();
    const steps = s.editor!.historySteps;
    const before = contentFingerprint(s.editor!.doc);
    const dry = JSON.parse((await call(agent, 'run_script', { source: `map.raise({ x: 0, y: 0 }, { radius: 10 }, 4); return map.h(0, 0) > 3;`, dry_run: true })).text);
    expect(dry).toMatchObject({ ok: true, dryRun: true, answer: { changed: true, commands: 1, value: true }, changes: { ground: { maxRise: 4 } } });
    const hq = s.editor!.doc.hq;
    const same = JSON.parse((await call(agent, 'run_script', { source: `map.hq(${hq.x}, ${hq.y});` })).text);
    expect(same).toMatchObject({ ok: true, changed: false, commands: 1 });
    expect(s.editor!.historySteps).toBe(steps);
    expect(contentFingerprint(s.editor!.doc)).toBe(before);
    s.ngOnDestroy();
  });

  it('points a road id given to delete_objects to removeRoads, which deletes it as one step', async () => {
    const { s, agent } = await agentSession();
    expect(JSON.parse((await call(agent, 'run_script', { source: `map.road([{ x: -20, y: 0 }, { x: 20, y: 0 }]);`, animate: false })).text)).toMatchObject({ changed: true });
    const edge = s.editor!.doc.paths.edges[0].id;
    const refused = await call(agent, 'delete_objects', { ids: [edge] });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(new RegExp(`${edge} is a road: run_script with map\\.removeRoads`));
    expect(JSON.parse((await call(agent, 'run_script', { source: `map.removeRoads(['${edge}']);`, animate: false })).text)).toMatchObject({ changed: true });
    expect(s.editor!.doc.paths.edges.some((e) => e.id === edge)).toBe(false);
    s.ngOnDestroy();
  });

  it('explains the shape of waves and the known rules, in set_rules and in a script', async () => {
    const { s, agent } = await agentSession();
    const count = await call(agent, 'set_rules', { rules: { waves: 30, difficulty: 120 } });
    expect(count.isError).toBe(true);
    expect(count.text).toMatch(/waves is \{ kind: 'budget' \}.*there is no wave count\. Example: \{ waves: \{ kind: 'budget' \}, difficulty: 120 \}, not 30/);
    expect((await call(agent, 'set_rules', { rules: { waveCount: 30 } })).text).toMatch(/know no waveCount; they are startCredits, hqHealth/);
    const script = JSON.parse((await call(agent, 'run_script', { source: `map.gameplay({ waves: 25 });` })).text);
    expect(script.error).toMatch(/there is no wave count.*\(line 1\)/);
    expect(JSON.parse((await call(agent, 'set_rules', { rules: { waves: { kind: 'budget' }, difficulty: 120 } })).text)).toMatchObject({ ok: true });
    expect(s.editor!.doc.gameplay).toMatchObject({ waves: { kind: 'budget' }, difficulty: 120 });
    // Wave events: the shape explained, one that the file refuses not taken, a good list taken (TODO E170)
    expect((await call(agent, 'set_rules', { rules: { events: 'wave 5 rain' } })).text).toMatch(/events is a list of what happens before a wave.*Example/);
    expect((await call(agent, 'set_rules', { rules: { events: [{ wave: 5, kind: 'weather', weather: 'hail' }] } })).text).toMatch(/would not save.*weather hail is unknown/);
    const spawn = s.editor!.doc.spawns[0].id;
    const events = [{ wave: 5, kind: 'weather', weather: 'rain' }, { wave: 6, kind: 'portal', spawn }];
    expect(JSON.parse((await call(agent, 'set_rules', { rules: { events } })).text)).toMatchObject({ ok: true });
    expect(s.editor!.doc.gameplay?.events).toEqual(events);
    s.ngOnDestroy();
  });

  it('pictures the map from above with roads and markers drawn and the relief shaded', async () => {
    const { s, agent } = await agentSession();
    const g = s.editor!.doc.terrain.grid;
    for (let k = 0; k < g.heights.length; k++) g.heights[k] = (k % g.columns) * 0.5;
    const pixels = new Uint8ClampedArray(16 * 16 * 4).fill(100);
    const canvas = {
      width: 16,
      height: 16,
      getContext: () => ({ getImageData: () => ({ data: pixels }), putImageData: vi.fn() }),
      toDataURL: () => 'data:image/jpeg;base64,AAAA',
    };
    const renderTopDown = vi.fn(async () => canvas);
    Object.assign(s['viewHost'], { viewport: fakeViewport({ topDown: { render: renderTopDown } }) });
    const answer = await call(agent, 'top_down_picture', { size: 128 });
    expect(renderTopDown).toHaveBeenCalledWith(128, 128, true, undefined);
    expect(answer.image).toEqual({ mimeType: 'image/jpeg', data: 'AAAA' });
    expect(JSON.parse(answer.text).shows).toMatch(/roads, spawns and the HQ.*relief shaded/);
    // Ground rising to the east faces west, half toward a north-west light
    expect(pixels[0]).toBeGreaterThan(100);
    Object.assign(s['viewHost'], { viewport: null });
    s.ngOnDestroy();
  });

  it('names and describes the open map as one undo step, keeping its id', async () => {
    const { s, agent } = await agentSession();
    const answer = JSON.parse((await call(agent, 'set_map_info', { name: 'Ash Isle', description: 'A volcano island with three landings.' })).text);
    expect(answer).toMatchObject({ ok: true, step: 'Agent: map details' });
    expect(s.editor!.doc.meta).toMatchObject({ id: 'm', name: 'Ash Isle', description: 'A volcano island with three landings.' });
    expect((await call(agent, 'set_map_info', {})).isError).toBe(true);
    expect((await call(agent, 'set_map_info', { name: '  ' })).isError).toBe(true);
    s.ngOnDestroy();
  });

  it('runs every changing tool dry on a copy: same answer, what it would change, the map and its history untouched', async () => {
    const { s, agent } = await agentSession();
    const editor = s.editor!;
    const steps = editor.historySteps;
    const before = contentFingerprint(editor.doc);
    const hq = JSON.parse((await call(agent, 'move_marker', { target: 'hq', x: 7, y: -3, dry_run: true })).text);
    expect(hq).toMatchObject({ dryRun: true, ok: true, answer: { step: 'Agent: move HQ' }, changes: { hq: { x: 7, y: -3 } } });
    const placed = JSON.parse((await call(agent, 'place_object', { asset: 'rock-small', x: 3, y: 4, dry_run: true })).text);
    expect(placed.changes.objects).toMatchObject({ added: 1, addedByAsset: { 'rock-small': 1 } });
    const resized = JSON.parse((await call(agent, 'resize_map', { width: 128, depth: 64, dry_run: true })).text);
    expect(resized.changes.size.to).toMatchObject({ width: 128, depth: 64 });
    const eroded = JSON.parse((await call(agent, 'erode_map', { strength: 0.3, seed: 2, dry_run: true })).text);
    expect(eroded).toMatchObject({ dryRun: true, ok: true });
    // A refusal stays one, also dry
    const bad = await call(agent, 'set_sky', { environment: { sky: 'green' }, dry_run: true });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/sky must be one of/);
    expect(editor.historySteps).toBe(steps);
    expect(contentFingerprint(editor.doc)).toBe(before);
    s.ngOnDestroy();
  });

  it('erodes, resizes and refines the map, each as one undo step of its own', async () => {
    const { s, agent } = await agentSession();
    const editor = s.editor!;
    const g = editor.doc.terrain.grid;
    for (let k = 0; k < g.heights.length; k++) g.heights[k] = Math.sin(k * 0.37) * 6 + (k % g.columns) * 0.4;
    const heights = g.heights.slice();
    const eroded = JSON.parse((await call(agent, 'erode_map', { strength: 0.5, seed: 3 })).text);
    expect(eroded).toMatchObject({ ok: true, step: 'Agent: erode the map' });
    expect(Array.from(editor.doc.terrain.grid.heights)).not.toEqual(Array.from(heights));
    expect(editor.undoLabel).toBe('Agent: erode the map');
    s.undo();
    expect(Array.from(editor.doc.terrain.grid.heights)).toEqual(Array.from(heights));
    expect(JSON.parse((await call(agent, 'resize_map', { width: 96, depth: 64 })).text)).toMatchObject({ ok: true, step: 'Agent: resize the map' });
    expect(editor.doc.terrain.width).toBe(96);
    expect((await call(agent, 'resize_map', { width: 10, depth: 64 })).text).toMatch(/64\.\.8192/);
    // A new map has the fine detail already
    expect((await call(agent, 'increase_detail')).text).toMatch(/detail of new maps already/);
    s.ngOnDestroy();
  });

  it('sets the ground from a heightmap and pastes pieces of this map, another map or a stamp', async () => {
    const { s, agent } = await agentSession();
    Object.assign(s.library, { stamps: new StampLibrary(new MemoryStampBackend()) });
    const editor = s.editor!;
    const g = editor.doc.terrain.grid;
    const ramp = { ...g, heights: Float32Array.from(g.heights, (_, k) => (k % g.columns) * 0.25) };
    const png = encodePng16(gridToImage(ramp).image);
    const base64 = btoa(String.fromCharCode(...png));
    const imported = JSON.parse((await call(agent, 'import_heightmap', { data: base64, format: 'png', low: 0, high: 20 })).text);
    expect(imported).toMatchObject({ ok: true, step: 'Agent: import heightmap' });
    expect(g.heights[g.columns - 1]).toBeCloseTo(20, 0);
    expect((await call(agent, 'import_heightmap', { data: btoa('not a png'), low: 0, high: 1 })).text).toMatch(/Not a heightmap/);
    // A hill copied from the east edge to the middle
    const pasted = JSON.parse((await call(agent, 'paste_stamp', { x0: 16, y0: -8, x1: 32, y1: 8, x: 0, y: 0 })).text);
    expect(pasted).toMatchObject({ ok: true, step: 'Agent: paste' });
    expect((await call(agent, 'save_stamp', { name: 'ridge', x0: 16, y0: -8, x1: 32, y1: 8 })).isError).toBeFalsy();
    const stamps = JSON.parse((await call(agent, 'list_stamps')).text).stamps;
    expect(stamps).toEqual([expect.objectContaining({ name: 'ridge', width: 16, depth: 16 })]);
    const steps = editor.historySteps;
    expect(JSON.parse((await call(agent, 'paste_stamp', { stamp: 'ridge', x: -16, y: 0, rotation: 1, parts: { objects: false } })).text)).toMatchObject({ ok: true });
    expect(editor.historySteps).toBe(steps + 1);
    expect((await call(agent, 'paste_stamp', { stamp: 'none', x: 0, y: 0 })).text).toMatch(/no stamp none; stamps: .*ridge/);
    // A prefab of objects kept in the map's file, one undo step, listed first and placed by name as one group
    editor.doc.objects.push({ id: 'p1', asset: 'tree-oak', x: 10, y: 10, z: 0, rotation: 0, scale: 1 }, { id: 'p2', asset: 'tree-oak', x: 14, y: 10, z: 0, rotation: 0, scale: 1 });
    const kept = JSON.parse((await call(agent, 'save_stamp', { name: 'pair', ids: ['p1', 'p2'], keep: 'map' })).text);
    expect(kept).toMatchObject({ ok: true, keep: 'map', prefab: true, objects: 2 });
    expect(editor.doc.prefabs?.map((p) => p.name)).toEqual(['pair']);
    expect(JSON.parse((await call(agent, 'list_stamps')).text).stamps.map((st: { name: string; keep: string }) => `${st.name}:${st.keep}`)).toEqual(['pair:map', 'ridge:library']);
    const count = editor.doc.objects.length;
    expect(JSON.parse((await call(agent, 'paste_stamp', { stamp: 'pair', x: -20, y: -20 })).text)).toMatchObject({ ok: true });
    const placed = editor.doc.objects.slice(count);
    expect(placed).toHaveLength(2);
    expect(placed[0].group).toBeDefined();
    expect(placed[1].group).toBe(placed[0].group);
    expect((await call(agent, 'save_stamp', { name: 'x', ids: ['nope'] })).text).toMatch(/no objects nope/);
    s.ngOnDestroy();
  });

  it('opens, creates, saves and closes maps; a shipped map only as an own copy', async () => {
    const { s, agent } = await agentSession();
    await s.saves.save(true);
    const made = JSON.parse((await call(agent, 'create_map', { name: 'Agent Isle', width: 128, depth: 96, preset: 'hills', seed: 4, strength: 0.4 })).text);
    expect(made).toMatchObject({ id: 'agent-isle', open: true, width: 128, depth: 96 });
    expect(s.editor!.doc.meta.id).toBe('agent-isle');
    expect((await call(agent, 'create_map', { name: 'X', template: 'nowhere' })).text).toMatch(/no template nowhere; templates: meadows/);
    expect(JSON.parse((await call(agent, 'save_map')).text)).toMatchObject({ ok: true, saved: 'agent-isle' });
    expect(JSON.parse((await call(agent, 'open_map', { id: 'm' })).text)).toMatchObject({ id: 'm', open: true });
    expect(s.editor!.doc.meta.id).toBe('m');
    expect((await call(agent, 'open_map', { id: 'nowhere' })).text).toMatch(/no map nowhere/);
    const copied = JSON.parse((await call(agent, 'copy_map', { id: 'agent-isle', name: 'Isle two', open: true })).text);
    expect(copied).toMatchObject({ id: 'isle-two', open: true });
    expect(s.editor!.doc.meta.id).toBe('isle-two');
    expect(JSON.parse((await call(agent, 'close_map')).text)).toMatchObject({ ok: true, closed: 'isle-two' });
    expect(s.editor).toBeNull();
    expect(JSON.parse((await call(agent, 'list_maps')).text).open).toBeNull();
    s.ngOnDestroy();
  });

  it('opens a map in place of the open one, which the page follows (openMap)', async () => {
    const { s, agent } = await agentSession();
    await s.saves.save(true);
    await call(agent, 'copy_map', { id: 'm', name: 'Second' });
    expect(JSON.parse((await call(agent, 'open_map', { id: 'second' })).text)).toMatchObject({ id: 'second' });
    expect(s.maps.openMap()).toBe('second');
    s.ngOnDestroy();
  });

  it('stops at Stop: a script still in the sandbox lands nowhere, and the map is as it was', async () => {
    let started!: () => void;
    const running = new Promise<void>((r) => (started = r));
    const slow: ScriptSandbox = (source, doc, c, seed, signal) =>
      new Promise<ScriptRunResult>((resolve) => {
        started();
        const result = runMapScript(source, doc, c.catalog, { seed });
        signal?.addEventListener('abort', () => resolve({ ok: false, error: 'stopped', logs: [] }));
        setTimeout(() => resolve(result), 200);
      });
    const { s, agent } = await agentSession(slow);
    const editor = s.editor!;
    const before = contentFingerprint(editor.doc);
    const steps = editor.historySteps;
    const answer = call(agent, 'run_script', { source: `map.raise({ x: 0, y: 0 }, { radius: 10 }, 4);`, animate: false });
    await running;
    agent.stop();
    expect(await answer).toEqual({ text: STOPPED, isError: true });
    expect(contentFingerprint(editor.doc)).toBe(before);
    expect(editor.historySteps).toBe(steps);
    // The calls after Stop are refused in the desktop app's server; the editor itself answers again
    expect((await call(agent, 'map_summary')).isError).toBeFalsy();
    s.ngOnDestroy();
  });

  it('stops a script while it plays: the map goes back and the call says so', async () => {
    const { s, agent } = await agentSession();
    const editor = s.editor!;
    const before = contentFingerprint(editor.doc);
    const answer = call(agent, 'run_script', { source: `for (let k = 0; k < 40; k++) map.raise({ x: k - 20, y: 0 }, { radius: 6 }, 1);` });
    while (!s.jobs.job()) await new Promise((r) => setTimeout(r, 5));
    expect(s.jobs.job()!.label).toBe('Agent: script');
    agent.stop();
    expect(await answer).toEqual({ text: STOPPED, isError: true });
    expect(contentFingerprint(editor.doc)).toBe(before);
    expect(s.jobs.job()).toBeNull();
    s.ngOnDestroy();
  });

  it('lists the kept versions and puts one back as one step', async () => {
    const { s, agent } = await agentSession();
    const editor = s.editor!;
    await s.saves.save(true);
    await s.saves.loadVersions();
    const [first] = JSON.parse((await call(agent, 'list_versions')).text).versions;
    expect(first).toMatchObject({ manual: true });
    await call(agent, 'move_marker', { target: 'hq', x: 9, y: 9 });
    s.editIntro({ kind: 'orbit', distance: 80, height: 40, angle: 0, seconds: 10 } as never);
    const hq = { ...editor.doc.hq };
    const restored = JSON.parse((await call(agent, 'restore_version', { id: first.id })).text);
    expect(restored).toMatchObject({ ok: true, step: 'Agent: restore version' });
    expect(editor.doc.hq).not.toEqual(hq);
    expect(editor.doc.intro).toBeUndefined();
    expect((await call(agent, 'restore_version', { id: 'never' })).text).toMatch(/no version never/);
    s.ngOnDestroy();
  });

  it('answers every tool through the bridge reply as plain data, whatever its handler returns', async () => {
    // The desktop server's tools (desktop/src/agent-mcp.js TOOLS) that the editor answers
    const tools: [string, Record<string, unknown>][] = [
      ['map_summary', {}],
      ['map_heights', { x0: -8, y0: -8, x1: 8, y1: 8, samples: 3 }],
      ['map_objects', {}],
      ['check_map', {}],
      ['catalog', { search: 'rock' }],
      ['script_api', {}],
      ['top_down_picture', {}],
      ['list_maps', {}],
      ['read_map', { id: 'm' }],
      ['run_script', { source: 'return 1' }],
      ['move_marker', { target: 'hq', x: 2, y: 2 }],
      ['place_object', { asset: 'rock-small', x: 1, y: 1 }],
      ['move_object', { id: 'nope', x: 1 }],
      ['delete_objects', { ids: ['nope'] }],
      ['set_rules', { rules: { startCredits: 500 } }],
      ['set_sky', { environment: { sky: 'dusk' } }],
      ['set_map_info', { name: 'Renamed' }],
      ['undo_last', {}],
      ['copy_map', { id: 'm' }],
      ['erode_map', { strength: 0.1, dry_run: true }],
      ['resize_map', { width: 64, depth: 96, dry_run: true }],
      ['increase_detail', { dry_run: true }],
      ['import_heightmap', { data: 'AAAA', low: 0, high: 10 }],
      ['list_stamps', {}],
      ['save_stamp', { name: 'piece', x0: -8, y0: -8, x1: 8, y1: 8 }],
      ['paste_stamp', { x: 0, y: 0, x0: -8, y0: -8, x1: 8, y1: 8, dry_run: true }],
      ['list_versions', {}],
      ['restore_version', { id: 'nope' }],
      ['save_map', {}],
      ['open_map', { id: 'm' }],
      ['create_map', { name: 'Fresh', width: 64, depth: 64 }],
      ['close_map', {}],
    ];
    let handler: ((call: { tool: string; args: Record<string, unknown> }, reply: (answer: unknown) => void) => unknown) | null = null;
    (window as unknown as { desktop?: unknown }).desktop = {
      version: '0.7.1',
      onUpdateReady: () => () => undefined,
      installUpdateNow: () => undefined,
      saveRun: async () => true,
      agent: { onCall: (h: typeof handler) => ((handler = h), () => (handler = null)), status: async () => ({ enabled: true, url: null }), setEnabled: async () => ({ enabled: true, url: null }) },
    };
    try {
      const { s } = session();
      Object.assign(s.library, { stamps: new StampLibrary(new MemoryStampBackend()) });
      await s.catalogReady.catch(() => undefined);
      s.catalog.set(catalog);
      await s.saves.save(true);
      expect(handler).not.toBeNull();
      for (const [tool, args] of tools) {
        const answer = await new Promise<unknown>((resolve) => handler!({ tool, args }, resolve));
        // What crosses the bridge: a plain, cloneable answer with text
        expect(structuredClone(answer), tool).toEqual(answer);
        expect(typeof (answer as { text?: unknown }).text, tool).toBe('string');
        expect((answer as { text: string }).text.length, tool).toBeGreaterThan(0);
      }
      s.ngOnDestroy();
      expect(handler).toBeNull();
    } finally {
      delete (window as unknown as { desktop?: unknown }).desktop;
    }
  });
});
