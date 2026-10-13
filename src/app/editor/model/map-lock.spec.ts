import { MapLock, TAKE_OVER_WAIT_MS, type ChannelLike, type LockManagerLike, type MapLockEvents } from './map-lock';

const abortError = () => Object.assign(new Error('aborted'), { name: 'AbortError' });

/** Web Locks in memory: exclusive locks with a queue, `ifAvailable`, `steal` and `signal` */
class FakeLocks implements LockManagerLike {
  private holder = new Map<string, { reject: (e: Error) => void }>();
  private queues = new Map<string, (() => void)[]>();

  request(name: string, options: { ifAvailable?: boolean; steal?: boolean; signal?: AbortSignal }, callback: (lock: unknown) => unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const grant = () => {
        const entry = { reject };
        this.holder.set(name, entry);
        Promise.resolve(callback({ name })).then(
          (v) => {
            if (this.holder.get(name) !== entry) return;
            this.holder.delete(name);
            this.queues.get(name)?.shift()?.();
            resolve(v);
          },
          reject,
        );
      };
      const held = this.holder.get(name);
      if (options.steal) {
        held?.reject(abortError());
        grant();
      } else if (!held) grant();
      else if (options.ifAvailable) Promise.resolve(callback(null)).then(resolve, reject);
      else {
        const queue = this.queues.get(name) ?? [];
        this.queues.set(name, queue);
        queue.push(grant);
        options.signal?.addEventListener('abort', () => {
          const k = queue.indexOf(grant);
          if (k >= 0) queue.splice(k, 1);
          reject(abortError());
        });
      }
    });
  }
}

/** BroadcastChannel between the tabs of one test: a message reaches every other channel of the name */
function bus(): (name: string) => ChannelLike {
  const all = new Set<ChannelLike>();
  return () => {
    const channel: ChannelLike = {
      onmessage: null,
      postMessage(message) {
        for (const other of all) if (other !== channel) setTimeout(() => other.onmessage?.({ data: message } as MessageEvent));
      },
      close() {
        all.delete(channel);
      },
    };
    all.add(channel);
    return channel;
  };
}

function tab(locks: FakeLocks, channels: (name: string) => ChannelLike) {
  const log: string[] = [];
  const events: MapLockEvents = {
    granted: () => log.push('granted'),
    lost: () => log.push('lost'),
    beforeRelease: async () => log.push('saved'),
  };
  return { lock: new MapLock('valley', events, locks, channels), log };
}

const settle = () => new Promise((r) => setTimeout(r));

describe('MapLock', () => {
  it('lets the first tab edit, opens the second read-only and hands over when the first closes', async () => {
    const locks = new FakeLocks();
    const channels = bus();
    const a = tab(locks, channels);
    const b = tab(locks, channels);
    expect(await a.lock.start()).toBe(true);
    expect(await b.lock.start()).toBe(false);
    expect(b.lock.holding).toBe(false);
    a.lock.close();
    await settle();
    expect(b.lock.holding).toBe(true);
    expect(b.log).toEqual(['granted']);
  });

  it('takes over: the holder saves, lets go and waits read-only in turn', async () => {
    const locks = new FakeLocks();
    const channels = bus();
    const a = tab(locks, channels);
    const b = tab(locks, channels);
    await a.lock.start();
    await b.lock.start();
    vi.useFakeTimers();
    try {
      const taking = b.lock.takeOver();
      await vi.advanceTimersByTimeAsync(10);
      expect(a.log).toEqual(['saved', 'lost']);
      expect(a.lock.holding).toBe(false);
      expect(b.lock.holding).toBe(true);
      expect(b.log).toEqual(['granted']);
      await vi.advanceTimersByTimeAsync(TAKE_OVER_WAIT_MS);
      await taking;
      // And back again the same way
      const back = a.lock.takeOver();
      await vi.advanceTimersByTimeAsync(TAKE_OVER_WAIT_MS + 10);
      await back;
      expect(a.lock.holding).toBe(true);
      expect(b.lock.holding).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes the lock by force from a holder that does not answer', async () => {
    const locks = new FakeLocks();
    const silent = () => ({ onmessage: null, postMessage: () => undefined, close: () => undefined }) as ChannelLike;
    const a = tab(locks, silent);
    const b = tab(locks, silent);
    await a.lock.start();
    await b.lock.start();
    vi.useFakeTimers();
    try {
      const taking = b.lock.takeOver();
      await vi.advanceTimersByTimeAsync(TAKE_OVER_WAIT_MS + 10);
      await taking;
    } finally {
      vi.useRealTimers();
    }
    await settle();
    expect(b.lock.holding).toBe(true);
    expect(a.lock.holding).toBe(false);
    expect(a.log).toEqual(['lost']);
  });

  it('lets every tab edit where the browser has no Web Locks', async () => {
    const lock = new MapLock('valley', { granted: () => undefined, lost: () => undefined, beforeRelease: async () => undefined }, null);
    expect(await lock.start()).toBe(true);
    expect(lock.holding).toBe(true);
  });
});
