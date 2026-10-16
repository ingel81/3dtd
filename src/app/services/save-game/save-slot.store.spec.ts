/**
 * The save slots in IndexedDB when the browser does not play along: an open
 * that never answers gives up and is tried again, another tab's newer
 * version is let through, and a slot the browser would not hand out is
 * unreadable, not empty. The shared store over it moves the slot of
 * before and tells its watchers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdbSaveSlotStore, UNREADABLE, WatchedSlotStore, type StoredSlotMeta } from './save-slot.store';
import { AUTOSAVE_BUILT_SLOT, LEGACY_AUTOSAVE_MAP_SLOT } from './save-game.port';
import { MemorySlotStore } from '../../../test/memory-slot-store';

interface FakeDb {
  onclose: (() => void) | null;
  onversionchange: (() => void) | null;
  close: ReturnType<typeof vi.fn>;
  transaction: () => unknown;
}

/** A request that answers `result` on the next microtask, or fails */
function request(result: unknown, fail = false): Record<string, unknown> {
  const req: Record<string, unknown> = { result };
  queueMicrotask(() => {
    if (fail) {
      req['error'] = new Error('denied');
      (req['onerror'] as () => void)();
    } else {
      (req['onsuccess'] as () => void)();
    }
  });
  return req;
}

/**
 * An indexedDB whose opens answer as `answers` says, one each: never, or a
 * database whose reads give `rows` (a slot id missing is an empty slot) or
 * fail with `readsFail`.
 */
function stubIndexedDb(answers: ('hang' | 'ok')[], rows: Record<string, string> = {}, readsFail = false) {
  const dbs: FakeDb[] = [];
  const open = vi.fn(() => {
    const req: Record<string, unknown> = {};
    if (answers.shift() === 'hang') return req;
    queueMicrotask(() => {
      const db: FakeDb = {
        onclose: null,
        onversionchange: null,
        close: vi.fn(),
        transaction: () => ({
          objectStore: () => ({
            get: (id: string) => request(id in rows ? { id, text: rows[id] } : undefined, readsFail),
            getAll: () => request([]),
          }),
        }),
      };
      dbs.push(db);
      req['result'] = db;
      (req['onsuccess'] as () => void)();
    });
    return req;
  });
  vi.stubGlobal('indexedDB', { open });
  return { open, dbs };
}

describe('IdbSaveSlotStore', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('gives up on an open that never answers and opens again the next time', async () => {
    vi.useFakeTimers();
    const { open } = stubIndexedDb(['hang', 'ok'], { slot: 'text' });
    const store = new IdbSaveSlotStore(1000);
    const first = store.read('slot');
    await vi.advanceTimersByTimeAsync(1000);
    expect(await first).toBe(UNREADABLE);
    expect(await store.read('slot')).toBe('text');
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('lets another tab upgrade the database and opens again afterwards', async () => {
    const { open, dbs } = stubIndexedDb(['ok', 'ok'], { slot: 'text' });
    const store = new IdbSaveSlotStore();
    expect(await store.read('slot')).toBe('text');
    dbs[0].onversionchange?.();
    expect(dbs[0].close).toHaveBeenCalled();
    expect(await store.read('slot')).toBe('text');
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('tells an empty slot from one the browser would not hand out', async () => {
    stubIndexedDb(['ok'], {});
    expect(await new IdbSaveSlotStore().read('slot')).toBeNull();
    vi.unstubAllGlobals();
    stubIndexedDb(['ok'], { slot: 'text' }, true);
    expect(await new IdbSaveSlotStore().read('slot')).toBe(UNREADABLE);
  });
});

describe('WatchedSlotStore', () => {
  const meta = (id: string): StoredSlotMeta => ({
    id, name: 'Demo Valley, wave 4', wave: 4, location: 'Demo Valley', savedAt: '2026-10-15T08:00:00Z', gameVersion: 'v', configHash: 'x',
    map: { id: 'demo-valley', name: 'Demo Valley' },
  });

  it('moves the shared map autosave of before to the Built Worlds\' own, once, before the first list', async () => {
    const inner = new MemorySlotStore([meta(LEGACY_AUTOSAVE_MAP_SLOT)]);
    inner.texts.set(LEGACY_AUTOSAVE_MAP_SLOT, 'save');
    const store = new WatchedSlotStore(inner);
    expect((await store.list()).map((m) => [m.id, m.world])).toEqual([[AUTOSAVE_BUILT_SLOT, 'maps']]);
    expect(await store.read(AUTOSAVE_BUILT_SLOT)).toBe('save');
    expect(await store.read(LEGACY_AUTOSAVE_MAP_SLOT)).toBeNull();
  });

  it('keeps a Built Worlds autosave there already and drops the old one', async () => {
    const inner = new MemorySlotStore([meta(LEGACY_AUTOSAVE_MAP_SLOT), { ...meta(AUTOSAVE_BUILT_SLOT), wave: 9 }]);
    inner.texts.set(LEGACY_AUTOSAVE_MAP_SLOT, 'old');
    const store = new WatchedSlotStore(inner);
    expect((await store.list()).map((m) => [m.id, m.wave])).toEqual([[AUTOSAVE_BUILT_SLOT, 9]]);
  });

  it('tells its watchers of every write and removal', async () => {
    const store = new WatchedSlotStore(new MemorySlotStore());
    const heard = vi.fn();
    const off = store.watch(heard);
    await store.write(meta('slot-1'), 'save');
    await store.remove('slot-1');
    expect(heard).toHaveBeenCalledTimes(2);
    off();
    await store.write(meta('slot-1'), 'save');
    expect(heard).toHaveBeenCalledTimes(2);
  });
});
