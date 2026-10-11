import '@angular/compiler';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { createMapDocument } from '../../world/custom-map/map-create';
import { MapStore, MemoryMapBackend } from '../../world/custom-map/map-store';
import { MemoryVersionBackend, VersionHistory } from '../model/version-store';
import { EditorSession } from './editor-session.service';

function session(): { s: EditorSession; backend: MemoryMapBackend; history: VersionHistory; versions: MemoryVersionBackend } {
  const s = TestBed.runInInjectionContext(() => new EditorSession());
  const backend = new MemoryMapBackend();
  const versions = new MemoryVersionBackend();
  const history = new VersionHistory(versions);
  Object.assign(s, { store: new MapStore({ backend, fetch: async () => new Response('', { status: 404 }), baseUrl: 'http://x/' }), history });
  s.setDocument(createMapDocument({ id: 'm', name: 'M', width: 64, depth: 64, now: new Date(0) }), 'own');
  return { s, backend, history, versions };
}

describe('editor session saving', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterAll(() => getTestBed().resetTestEnvironment());

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
