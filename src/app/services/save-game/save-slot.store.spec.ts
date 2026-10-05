/**
 * The save slots in IndexedDB when the browser does not play along: an open
 * that never answers gives up and is tried again, another tab's newer
 * version is let through, and a slot the browser would not hand out is
 * unreadable, not empty.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdbSaveSlotStore, UNREADABLE } from './save-slot.store';

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
