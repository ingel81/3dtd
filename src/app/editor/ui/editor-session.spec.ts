import '@angular/compiler';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { createMapDocument } from '../../world/custom-map/map-create';
import { MapStore, MemoryMapBackend } from '../../world/custom-map/map-store';
import { MemoryVersionBackend, VersionHistory } from '../model/version-store';
import { DOWNLOAD_REMINDER_MS } from '../model/storage-safety';
import { MapFileError, contentHash, packMapFile } from '../../world/custom-map/map-file';
import { EditorSession, saveErrorText } from './editor-session.service';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CatalogIndex, normalizeCatalog } from '../catalog/asset-catalog';
import { EditorAgent, type ScriptSandbox } from '../agent/editor-agent';
import { runMapScript } from '../agent/map-script';
import { contentFingerprint } from '../agent/agent-reads';

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

describe('editor session and copies', () => {
  it('opens the copy made before on a second Edit, and offers a fresh one when the original changed', async () => {
    const { s, backend } = session();
    let shipped = createMapDocument({ id: 'harbour', name: 'Harbour', width: 32, depth: 32 });
    let hash = await contentHash(shipped);
    const fetch = async (url: string) =>
      url.endsWith('index.json')
        ? Response.json({ maps: [{ id: 'harbour', name: 'Harbour', file: 'harbour.3dtdmap', contentHash: hash }] })
        : new Response(packMapFile(shipped) as Uint8Array<ArrayBuffer>, { status: 200 });
    Object.assign(s, { store: new MapStore({ backend, fetch, baseUrl: 'http://x/' }), catalogReady: Promise.resolve() });
    expect(await s.open('harbour')).toBe('harbour-copy');
    expect(s.doc!.meta.copyOf).toEqual({ id: 'harbour', hash });
    s.editMeta({ description: 'Mine' });
    await s.save(true);
    expect(await s.open('harbour')).toBe('harbour-copy');
    expect(s.doc!.meta.description).toBe('Mine');
    expect(s.staleCopy()).toBeNull();
    // A game update changes the original
    shipped = createMapDocument({ id: 'harbour', name: 'Harbour', width: 48, depth: 48 });
    hash = await contentHash(shipped);
    Object.assign(s, { store: new MapStore({ backend, fetch, baseUrl: 'http://x/' }) });
    expect(await s.open('harbour')).toBe('harbour-copy');
    expect(s.staleCopy()).toMatchObject({ original: 'harbour' });
    // Saved a moment later than the first copy, so it is the newest
    await new Promise((r) => setTimeout(r, 5));
    expect(await s.freshCopy()).toBe('harbour-copy-2');
    expect(s.doc!.terrain.width).toBe(48);
    expect(s.doc!.meta.copyOf).toEqual({ id: 'harbour', hash });
    expect((await s.store.listOwn()).map((m) => m.id).sort()).toEqual(['harbour-copy', 'harbour-copy-2']);
    // The newest copy opens from now on
    expect(await s.open('harbour')).toBe('harbour-copy-2');
    expect(s.staleCopy()).toBeNull();
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
    // A map opens on Look; Landscape's brush starts at its own size
    expect(s.tool()).toBe('look');
    s.selectTool('landscape');
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

describe('editor session test tab', () => {
  it('takes the test tab within the click and sends it to the game once the map is saved', async () => {
    const { s } = session();
    let saved = false;
    const calls: string[] = [];
    const tab = { closed: false, location: { href: 'about:blank' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockImplementation(((url: string) => {
      calls.push(`${url}|saved:${saved}`);
      return tab as unknown as Window;
    }) as typeof window.open);
    vi.spyOn(s, 'save').mockImplementation(async () => {
      saved = true;
      return true;
    });
    const run = s.testPlay();
    // Taken before the save could outlast the click's user activation
    expect(calls).toEqual(['|saved:false']);
    await run;
    expect(tab.location.href).toContain('world=map');
    expect(tab.location.href).not.toContain('fromWave');
    expect(open).toHaveBeenCalledTimes(1);
    // From a later wave: the link names it
    s.testFromWave.set(15);
    await s.testPlay();
    expect(tab.location.href).toContain('fromWave=15');
    s.testFromWave.set(1);
    // A failed save closes a tab opened blank for it, and leaves an earlier test's tab
    vi.spyOn(s, 'save').mockResolvedValue(false);
    tab.location.href = 'about:blank';
    await s.testPlay();
    expect(tab.close).toHaveBeenCalledTimes(1);
    tab.location.href = 'http://x/?world=map%3Am';
    await s.testPlay();
    expect(tab.close).toHaveBeenCalledTimes(1);
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
    return { s, agent: new EditorAgent(s, sandbox) };
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
    expect(s.terrainJob()).toBeNull();
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
    const play = s.agentEdit('Agent: long', async (ed, signal) => {
      ed.doc.terrain.grid.heights.fill(9);
      const second = await call(agent, 'move_marker', { target: 'hq', x: 1, y: 1 });
      expect(second).toMatchObject({ isError: true, text: expect.stringMatching(/cannot change now/) });
      s.cancelTerrainJob();
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
    await s.save(true);
    const copied = JSON.parse((await call(agent, 'copy_map', { id: 'm', name: 'Agent copy' })).text);
    expect(copied).toMatchObject({ id: 'agent-copy', name: 'Agent copy' });
    expect(s.editor!.doc.meta.id).toBe('m');
    expect(JSON.parse((await call(agent, 'read_map', { id: 'agent-copy' })).text).meta.name).toBe('Agent copy');
    expect(JSON.parse((await call(agent, 'list_maps')).text).maps.map((m: { id: string }) => m.id)).toEqual(expect.arrayContaining(['m', 'agent-copy']));
    expect((await call(agent, 'teleport')).isError).toBe(true);
    s.editor = null;
    expect((await call(agent, 'map_summary')).text).toMatch(/No map is open/);
    s.ngOnDestroy();
  });

  it('says the asset catalogue did not load instead of answering with empty lists', async () => {
    const { s } = session();
    await s.catalogReady.catch(() => undefined);
    const agent = new EditorAgent(s, inProcess);
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
    expect(dry).toMatchObject({ ok: true, dryRun: true, changed: false, commands: 1, value: true });
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
      ['undo_last', {}],
      ['copy_map', { id: 'm' }],
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
      await s.catalogReady.catch(() => undefined);
      s.catalog.set(catalog);
      await s.save(true);
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
