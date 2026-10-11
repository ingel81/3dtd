import { describe, expect, it, vi } from 'vitest';
import type { DesktopMapFolder } from '../../core/desktop-bridge';
import { FolderMapBackend, localStorageMarks, mapFolderId, type FolderMark, type FolderMarks } from './folder-map-backend';
import { createMapDocument } from './map-create';
import { packMapFile } from './map-file';
import { MapStore, MemoryMapBackend } from './map-store';

/**
 * The desktop app's folder as a Map of name to bytes, each write a later
 * time. Like Windows by default it does not tell "MyMap" from "mymap": a
 * write keeps the name the file has, a remove takes it whatever the case.
 */
class FakeFolder implements DesktopMapFolder {
  readonly files = new Map<string, { bytes: Uint8Array; mtime: number }>();
  private clock = 1000;
  private find(name: string): string | undefined {
    return [...this.files.keys()].find((k) => k.toLowerCase() === name.toLowerCase());
  }
  async list() {
    return [...this.files].map(([name, f]) => ({ name, size: f.bytes.byteLength, mtime: f.mtime }));
  }
  async read(name: string) {
    const k = this.find(name);
    return k ? this.files.get(k)!.bytes : null;
  }
  async write(name: string, bytes: Uint8Array) {
    const mtime = (this.clock += 10);
    this.files.set(this.find(name) ?? name, { bytes, mtime });
    return { mtime };
  }
  async remove(name: string) {
    const k = this.find(name);
    if (k) this.files.delete(k);
    return true;
  }
  readonly reveal = vi.fn();
  readonly onOpen = vi.fn(() => () => undefined);
}

function memoryMarks(): FolderMarks & { value: Record<string, FolderMark> | null } {
  return {
    value: null,
    read() {
      return this.value ? structuredClone(this.value) : null;
    },
    write(marks) {
      this.value = structuredClone(marks);
    },
  };
}

const doc = (id: string, name = id) => createMapDocument({ id, name, width: 64, depth: 64, cellSize: 4, starter: false });
const mapFile = (id: string, name = id) => packMapFile(doc(id, name));
const noShipped = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ maps: [] }) } as Response);
const storeOn = (folder: FakeFolder, inner = new MemoryMapBackend(), marks = memoryMarks()) =>
  new MapStore({ backend: new FolderMapBackend(inner, folder, marks), fetch: noShipped });

describe('FolderMapBackend', () => {
  it('writes an own map from before the folder out, and every save after', async () => {
    const inner = new MemoryMapBackend();
    await new MapStore({ backend: inner, fetch: noShipped }).save(doc('old', 'Old'));
    const folder = new FakeFolder();
    const store = storeOn(folder, inner);

    expect((await store.listOwn()).map((m) => m.id)).toEqual(['old']);
    expect([...folder.files.keys()]).toEqual(['old.3dtdmap']);

    await store.save(doc('fresh', 'Fresh'));
    expect([...folder.files.keys()].sort()).toEqual(['fresh.3dtdmap', 'old.3dtdmap']);
  });

  it('takes a file the player put in the folder under an id from its name, and leaves the file as it is', async () => {
    const folder = new FakeFolder();
    await folder.write('Witch Marsh - Copy.3dtdmap', mapFile('something-else', 'Witch Marsh'));
    const store = storeOn(folder);

    const list = await store.listOwn();
    expect(list.map((m) => [m.id, m.name, m.origin])).toEqual([['witch-marsh-copy', 'Witch Marsh', 'own']]);
    expect((await store.load('witch-marsh-copy')).doc.meta.id).toBe('witch-marsh-copy');
    // Saving writes the same file, never a second one
    await store.save((await store.load('witch-marsh-copy')).doc);
    expect([...folder.files.keys()]).toEqual(['Witch Marsh - Copy.3dtdmap']);
  });

  it('keeps a map whose file name differs from its id only in case, from one start to the next', async () => {
    const folder = new FakeFolder();
    await folder.write('MyMap.3dtdmap', mapFile('mymap', 'Mine'));
    const inner = new MemoryMapBackend();
    const marks = memoryMarks();
    expect((await storeOn(folder, inner, marks).listOwn()).map((m) => m.id)).toEqual(['mymap']);
    expect([...folder.files.keys()]).toEqual(['MyMap.3dtdmap']);
    // The next start finds the file and the map
    expect((await storeOn(folder, inner, marks).listOwn()).map((m) => m.id)).toEqual(['mymap']);
    expect(folder.files.size).toBe(1);
  });

  it('gives two files that suggest one id two maps, and writes neither over the other', async () => {
    const folder = new FakeFolder();
    await folder.write('my-map.3dtdmap', mapFile('a', 'First'));
    await folder.write('my_map.3dtdmap', mapFile('b', 'Second'));
    const before = new Map([...folder.files].map(([k, v]) => [k, v.bytes]));
    const store = storeOn(folder);
    const list = await store.listOwn();
    expect(list.map((m) => m.name).sort()).toEqual(['First', 'Second']);
    expect(list.map((m) => m.id).sort()).toEqual(['my-map', 'my-map-2']);
    for (const [k, bytes] of before) expect(folder.files.get(k)!.bytes).toBe(bytes);
  });

  it('follows a changed file and a deleted one at the next start, not a file it wrote itself', async () => {
    const folder = new FakeFolder();
    const inner = new MemoryMapBackend();
    const marks = memoryMarks();
    const first = storeOn(folder, inner, marks);
    for (const id of ['a', 'b', 'c', 'd']) await first.save(doc(id, id.toUpperCase()));

    // Outside the game: a is replaced, b deleted
    await folder.write('a.3dtdmap', mapFile('a', 'A changed'));
    folder.files.delete('b.3dtdmap');

    const next = storeOn(folder, inner, marks);
    expect((await next.listOwn()).map((m) => [m.id, m.name]).sort()).toEqual([
      ['a', 'A changed'],
      ['c', 'C'],
      ['d', 'D'],
    ]);
  });

  it('writes the maps out again when the folder comes back empty, rather than deleting them', async () => {
    const folder = new FakeFolder();
    const inner = new MemoryMapBackend();
    const marks = memoryMarks();
    const first = storeOn(folder, inner, marks);
    await first.save(doc('a', 'A'));
    await first.save(doc('b', 'B'));
    // The folder moved (another Documents, a sync tool): it is there again, empty
    folder.files.clear();
    const next = storeOn(folder, inner, marks);
    expect((await next.listOwn()).map((m) => m.id).sort()).toEqual(['a', 'b']);
    expect([...folder.files.keys()].sort()).toEqual(['a.3dtdmap', 'b.3dtdmap']);
  });

  it('a renamed file stays one map, under its new name', async () => {
    const folder = new FakeFolder();
    const inner = new MemoryMapBackend();
    const marks = memoryMarks();
    const first = storeOn(folder, inner, marks);
    for (const id of ['keep-1', 'keep-2', 'old-name']) await first.save(doc(id, id));
    const file = folder.files.get('old-name.3dtdmap')!;
    folder.files.delete('old-name.3dtdmap');
    folder.files.set('New Name.3dtdmap', file);
    const next = storeOn(folder, inner, marks);
    expect((await next.listOwn()).map((m) => m.id).sort()).toEqual(['keep-1', 'keep-2', 'new-name']);
  });

  it('deletes the file with the map, keeps maps received in coop out of the folder', async () => {
    const folder = new FakeFolder();
    const store = storeOn(folder);
    await store.save(doc('mine', 'Mine'));
    const shared = doc('hosts', 'Host map');
    await store.saveShared(shared, null, packMapFile(shared));
    expect([...folder.files.keys()]).toEqual(['mine.3dtdmap']);

    await store.delete('mine');
    expect(folder.files.size).toBe(0);
    expect((await store.listOwn()).map((m) => m.id)).toEqual(['hosts']);
  });

  it('skips a file that is no map, and the rest still loads', async () => {
    const folder = new FakeFolder();
    await folder.write('broken.3dtdmap', new Uint8Array([1, 2, 3]));
    await folder.write('good.3dtdmap', mapFile('good'));
    const store = storeOn(folder);
    expect((await store.listOwn()).map((m) => m.id)).toEqual(['good']);
  });

  it('finds the map id of a double-clicked file', async () => {
    const folder = new FakeFolder();
    await folder.write('my-map.3dtdmap', mapFile('a'));
    await folder.write('my_map.3dtdmap', mapFile('b'));
    const store = storeOn(folder);
    expect(await store.folderMapId('my_map.3dtdmap')).toBe('my-map-2');
  });
});

describe('mapFolderId', () => {
  it('keeps a map id, makes a slug of anything else', () => {
    expect(mapFolderId('mafa-td-queen-v14-6.3dtdmap')).toBe('mafa-td-queen-v14-6');
    expect(mapFolderId('Witch Marsh.3dtdmap')).toBe('witch-marsh');
    expect(mapFolderId('witch_marsh.3dtdmap')).toBe('witch-marsh');
  });
});

describe('localStorageMarks', () => {
  it('reads the first marks, a time alone, as the file of the id', () => {
    localStorage.setItem('3dtd-map-folder-marks', JSON.stringify({ a: 5, b: { file: 'B b.3dtdmap', mtime: 7 } }));
    expect(localStorageMarks.read()).toEqual({ a: { file: 'a.3dtdmap', mtime: 5 }, b: { file: 'B b.3dtdmap', mtime: 7 } });
    localStorage.removeItem('3dtd-map-folder-marks');
  });
});
