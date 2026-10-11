import { describe, expect, it, vi } from 'vitest';
import type { DesktopMapFolder } from '../../core/desktop-bridge';
import { FolderMapBackend, mapFolderId, type FolderMarks } from './folder-map-backend';
import { createMapDocument } from './map-create';
import { packMapFile } from './map-file';
import { MapStore, MemoryMapBackend } from './map-store';

/** The desktop app's folder as a Map of name to bytes, each write a later time */
class FakeFolder implements DesktopMapFolder {
  readonly files = new Map<string, { bytes: Uint8Array; mtime: number }>();
  private clock = 1000;
  async list() {
    return [...this.files].map(([name, f]) => ({ name, size: f.bytes.byteLength, mtime: f.mtime }));
  }
  async read(name: string) {
    return this.files.get(name)?.bytes ?? null;
  }
  async write(name: string, bytes: Uint8Array) {
    const mtime = (this.clock += 10);
    this.files.set(name, { bytes, mtime });
    return { mtime };
  }
  async remove(name: string) {
    this.files.delete(name);
    return true;
  }
  readonly reveal = vi.fn();
  readonly onOpen = vi.fn(() => () => undefined);
}

function memoryMarks(): FolderMarks & { value: Record<string, number> | null } {
  return {
    value: null,
    read() {
      return this.value ? { ...this.value } : null;
    },
    write(marks) {
      this.value = { ...marks };
    },
  };
}

const mapFile = (id: string, name = id) => packMapFile(createMapDocument({ id, name, width: 64, depth: 64, cellSize: 4, starter: false }));
const noShipped = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ maps: [] }) } as Response);

describe('FolderMapBackend', () => {
  it('writes an own map from before the folder out, and every save after', async () => {
    const inner = new MemoryMapBackend();
    await new MapStore({ backend: inner, fetch: noShipped }).save(createMapDocument({ id: 'old', name: 'Old', width: 64, depth: 64, starter: false }));
    const folder = new FakeFolder();
    const store = new MapStore({ backend: new FolderMapBackend(inner, folder, memoryMarks()), fetch: noShipped });

    expect((await store.listOwn()).map((m) => m.id)).toEqual(['old']);
    expect([...folder.files.keys()]).toEqual(['old.3dtdmap']);

    await store.save(createMapDocument({ id: 'fresh', name: 'Fresh', width: 64, depth: 64, starter: false }));
    expect([...folder.files.keys()].sort()).toEqual(['fresh.3dtdmap', 'old.3dtdmap']);
  });

  it('takes a file the player put in the folder, under a map id made of its name', async () => {
    const folder = new FakeFolder();
    await folder.write('Witch Marsh.3dtdmap', mapFile('something-else', 'Witch Marsh'));
    const inner = new MemoryMapBackend();
    const store = new MapStore({ backend: new FolderMapBackend(inner, folder, memoryMarks()), fetch: noShipped });

    const list = await store.listOwn();
    expect(list.map((m) => [m.id, m.name, m.origin])).toEqual([['witch-marsh', 'Witch Marsh', 'own']]);
    expect((await store.load('witch-marsh')).doc.meta.id).toBe('witch-marsh');
    // The file now goes by the id, so the next save writes the same one
    expect([...folder.files.keys()]).toEqual(['witch-marsh.3dtdmap']);
  });

  it('follows a changed file and a deleted one at the next start, not a file it wrote itself', async () => {
    const folder = new FakeFolder();
    const inner = new MemoryMapBackend();
    const marks = memoryMarks();
    const first = new MapStore({ backend: new FolderMapBackend(inner, folder, marks), fetch: noShipped });
    await first.save(createMapDocument({ id: 'a', name: 'A', width: 64, depth: 64, starter: false }));
    await first.save(createMapDocument({ id: 'b', name: 'B', width: 64, depth: 64, starter: false }));

    // Outside the game: a is replaced, b deleted
    await folder.write('a.3dtdmap', mapFile('a', 'A changed'));
    folder.files.delete('b.3dtdmap');

    const next = new MapStore({ backend: new FolderMapBackend(inner, folder, marks), fetch: noShipped });
    expect((await next.listOwn()).map((m) => [m.id, m.name])).toEqual([['a', 'A changed']]);
  });

  it('deletes the file with the map, keeps maps received in coop out of the folder', async () => {
    const folder = new FakeFolder();
    const store = new MapStore({ backend: new FolderMapBackend(new MemoryMapBackend(), folder, memoryMarks()), fetch: noShipped });
    await store.save(createMapDocument({ id: 'mine', name: 'Mine', width: 64, depth: 64, starter: false }));
    const shared = createMapDocument({ id: 'hosts', name: 'Host map', width: 64, depth: 64, starter: false });
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
    const store = new MapStore({ backend: new FolderMapBackend(new MemoryMapBackend(), folder, memoryMarks()), fetch: noShipped });
    expect((await store.listOwn()).map((m) => m.id)).toEqual(['good']);
  });
});

describe('mapFolderId', () => {
  it('keeps a map id, makes a slug of anything else', () => {
    expect(mapFolderId('mafa-td-queen-v14-6.3dtdmap')).toBe('mafa-td-queen-v14-6');
    expect(mapFolderId('Witch Marsh.3dtdmap')).toBe('witch-marsh');
    expect(mapFolderId('witch_marsh.3dtdmap')).toBe('witch-marsh');
  });
});
