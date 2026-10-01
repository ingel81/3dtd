import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunLogStore } from './run-log.store';
import { StreetCacheService } from '../services/location/street-cache.service';

/**
 * An indexedDB whose opens answer as `answers` says, one each: a failure, or
 * a database whose every transaction throws (enough to tell a second open).
 */
function stubIndexedDb(answers: ('fail' | 'ok')[]) {
  const dbs: { onclose: (() => void) | null }[] = [];
  const open = vi.fn(() => {
    const request: Record<string, unknown> = {};
    const answer = answers.shift();
    queueMicrotask(() => {
      if (answer === 'fail') {
        request['error'] = new Error('blocked');
        (request['onerror'] as () => void)();
        return;
      }
      const db = { onclose: null, transaction: () => { throw new Error('no store'); } };
      dbs.push(db);
      request['result'] = db;
      (request['onsuccess'] as () => void)();
    });
    return request;
  });
  vi.stubGlobal('indexedDB', { open });
  return { open, dbs };
}

describe('IndexedDB opens that failed once are tried again', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('run log store: after a failed open, and after the browser closed the database', async () => {
    const { open, dbs } = stubIndexedDb(['fail', 'ok', 'ok']);
    const store = new RunLogStore();
    expect(await store.list()).toEqual([]);
    await store.list();
    expect(open).toHaveBeenCalledTimes(2);
    // The same connection while it stands
    await store.list();
    expect(open).toHaveBeenCalledTimes(2);
    dbs[0].onclose?.();
    await store.list();
    expect(open).toHaveBeenCalledTimes(3);
  });

  it('street cache: after a failed open, and after the browser closed the database', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { open, dbs } = stubIndexedDb(['fail', 'ok', 'ok']);
    const cache = new StreetCacheService();
    expect(await cache.load('k')).toBeNull();
    await cache.load('k');
    expect(open).toHaveBeenCalledTimes(2);
    await cache.load('k');
    expect(open).toHaveBeenCalledTimes(2);
    dbs[0].onclose?.();
    await cache.load('k');
    expect(open).toHaveBeenCalledTimes(3);
  });
});
