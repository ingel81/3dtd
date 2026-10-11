import '@angular/compiler';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { createMapDocument } from '../../world/custom-map/map-create';
import { MapStore, MemoryMapBackend } from '../../world/custom-map/map-store';
import { MemoryVersionBackend, VersionHistory } from '../model/version-store';
import { MapFileError } from '../../world/custom-map/map-file';
import { EditorSession, saveErrorText } from './editor-session.service';

function session(): { s: EditorSession; backend: MemoryMapBackend; history: VersionHistory; versions: MemoryVersionBackend } {
  const s = TestBed.runInInjectionContext(() => new EditorSession());
  const backend = new MemoryMapBackend();
  const versions = new MemoryVersionBackend();
  const history = new VersionHistory(versions);
  Object.assign(s, { store: new MapStore({ backend, fetch: async () => new Response('', { status: 404 }), baseUrl: 'http://x/' }), history });
  s.setDocument(createMapDocument({ id: 'm', name: 'M', width: 64, depth: 64, now: new Date(0) }), 'own');
  return { s, backend, history, versions };
}

beforeAll(() => {
  getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
});

afterAll(() => getTestBed().resetTestEnvironment());

describe('editor session saving', () => {

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

  it('deletes a map with its versions and stops listening for the bot when it goes', async () => {
    const { s, versions } = session();
    await s.save(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(await versions.list('m')).toHaveLength(1);
    await s.deleteMap('m');
    expect(await versions.list('m')).toEqual([]);
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
