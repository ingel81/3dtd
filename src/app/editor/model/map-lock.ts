/**
 * One tab edits a map at a time. The tab that opens a map first holds a Web
 * Lock named after it (`3dtd-map:<id>`); another tab on the same map opens
 * it read-only and waits in the lock's queue. "Take over editing" asks the
 * holder over a BroadcastChannel to save and let go; the holder becomes
 * read-only and queues again, the asking tab gets the lock. The holder
 * answers at once that it is saving; the asking tab then waits for the lock
 * as long as the save takes (up to SAVE_WAIT_MS), as a large map can take
 * longer to store than a frozen tab is given. A holder that does not answer
 * (frozen, its page asleep) loses the lock by force after TAKE_OVER_WAIT_MS. When the holder closes, the next tab in the queue gets
 * the lock by itself.
 *
 * Without Web Locks (old browsers, tests) every tab may edit, as before.
 */

/** How long a take-over waits for the holder to save and let go before it takes the lock anyway */
export const TAKE_OVER_WAIT_MS = 3000;
/** How long a take-over waits for a holder that answered it is saving */
export const SAVE_WAIT_MS = 60000;

export interface MapLockEvents {
  /** This tab holds the lock now: the map may be edited (read it again first, another tab may have saved it) */
  granted(): void;
  /** Another tab took the lock: stop editing */
  lost(): void;
  /** Another tab asks for the map: save what is not saved yet */
  beforeRelease(): Promise<unknown>;
}

/** The parts of `navigator.locks` and `BroadcastChannel` the lock needs */
export interface LockManagerLike {
  request(name: string, options: { ifAvailable?: boolean; steal?: boolean; signal?: AbortSignal }, callback: (lock: unknown) => Promise<unknown> | unknown): Promise<unknown>;
}
export interface ChannelLike {
  postMessage(message: unknown): void;
  onmessage: ((e: MessageEvent) => void) | null;
  close(): void;
}

interface LockMessage {
  /** release: let go, please; saving: the holder saves and lets go, wait for it */
  type: 'release' | 'saving';
  from: string;
  to?: string;
}

export class MapLock {
  /** Whether this tab may edit the map */
  holding = false;
  private release: (() => void) | null = null;
  private queue: AbortController | null = null;
  private readonly channel: ChannelLike | null;
  private readonly name: string;
  private readonly tab = Math.random().toString(36).slice(2);
  private closed = false;
  /** Called when the holder answers a take-over or this tab gets the lock */
  private wake: (() => void) | null = null;

  constructor(
    mapId: string,
    private readonly events: MapLockEvents,
    private readonly locks: LockManagerLike | null = typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null,
    channel: (name: string) => ChannelLike | null = (name) => (typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(name)),
  ) {
    this.name = `3dtd-map:${mapId}`;
    this.channel = this.locks ? channel(this.name) : null;
    if (this.channel) this.channel.onmessage = (e) => void this.onMessage(e.data as LockMessage);
  }

  /** Tries to take the lock; true when this tab may edit now, false when another holds it (this one queues) */
  async start(): Promise<boolean> {
    if (!this.locks) {
      this.holding = true;
      return true;
    }
    const got = await this.acquire({ ifAvailable: true }, false);
    if (!got) this.wait();
    return got;
  }

  /** Asks the tab that edits the map to save and let go; takes the lock by force when it does not answer */
  async takeOver(): Promise<void> {
    if (!this.locks || this.holding || this.closed) return;
    let answered = false;
    const wait = (ms: number) =>
      new Promise<void>((r) => {
        const timer = setTimeout(done, ms);
        function done() {
          clearTimeout(timer);
          r();
        }
        this.wake = () => {
          answered = true;
          done();
        };
      });
    this.channel?.postMessage({ type: 'release', from: this.tab } satisfies LockMessage);
    await wait(TAKE_OVER_WAIT_MS);
    // The holder saves: the lock comes when it is done (the queue hands it over)
    if (answered && !this.holding && !this.closed) await wait(SAVE_WAIT_MS);
    this.wake = null;
    if (this.holding || this.closed) return;
    this.queue?.abort();
    this.queue = null;
    await this.acquire({ steal: true }, true);
  }

  /** Lets the map go (the map closes) */
  close(): void {
    this.closed = true;
    this.queue?.abort();
    this.queue = null;
    this.release?.();
    this.release = null;
    this.holding = false;
    this.channel?.close();
  }

  /**
   * Requests the lock and holds it until `release` runs or another tab
   * steals it; resolves true once held, false when it was taken
   * (`ifAvailable`) or the request was dropped
   */
  private acquire(options: { ifAvailable?: boolean; steal?: boolean; signal?: AbortSignal }, announce: boolean): Promise<boolean> {
    return new Promise((resolve) => {
      let held = false;
      this.locks!.request(this.name, options, (lock) => {
        if (!lock || this.closed) {
          resolve(false);
          return undefined;
        }
        held = true;
        this.queue = null;
        this.holding = true;
        const holding = new Promise<void>((r) => (this.release = r));
        resolve(true);
        this.wake?.();
        if (announce) this.events.granted();
        return holding;
      }).then(
        () => held && this.afterHeld(),
        () => (held ? this.afterHeld() : resolve(false)),
      );
    });
  }

  /** Queues for the lock; gets it when the holder lets go */
  private wait(): void {
    if (!this.locks || this.closed || this.queue) return;
    this.queue = new AbortController();
    void this.acquire({ signal: this.queue.signal }, true);
  }

  /** The lock is gone, let go on request or stolen: back into the queue unless the map closed */
  private afterHeld(): void {
    if (this.closed) return;
    if (this.holding) {
      this.holding = false;
      this.release = null;
      this.events.lost();
    }
    this.wait();
  }

  private async onMessage(m: LockMessage): Promise<void> {
    if (m?.type === 'saving' && m.to === this.tab) {
      this.wake?.();
      return;
    }
    if (m?.type !== 'release' || m.from === this.tab || !this.holding || this.closed) return;
    this.channel?.postMessage({ type: 'saving', from: this.tab, to: m.from } satisfies LockMessage);
    await this.events.beforeRelease().catch(() => undefined);
    const release = this.release;
    this.release = null;
    this.holding = false;
    this.events.lost();
    release?.();
  }
}

/**
 * Runs `work` while holding the map's lock, so no tab edits the map
 * meanwhile (a tab editing it would save its own state over the work).
 * Resolves `{ done: false }` without running it when another tab holds the
 * map. Without Web Locks it just runs.
 */
export async function whileMapFree<T>(
  mapId: string,
  work: () => Promise<T>,
  locks: LockManagerLike | null = typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null,
): Promise<{ done: true; value: T } | { done: false }> {
  if (!locks) return { done: true, value: await work() };
  let result: { done: true; value: T } | { done: false } = { done: false };
  await locks.request(`3dtd-map:${mapId}`, { ifAvailable: true }, async (lock) => {
    if (lock) result = { done: true, value: await work() };
  });
  return result;
}
