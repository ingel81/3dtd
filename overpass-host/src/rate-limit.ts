/**
 * How much one client may ask: a token bucket of queries per address and the
 * queries it may have running at once. Only in memory, never written; an
 * address is forgotten once its bucket is full again and nothing of it runs.
 * IPv6 addresses count per /64, the block one connection usually gets, so a
 * client cannot hop between the addresses of its own block.
 */

export interface RateLimitOptions {
  /** Queries a client may ask at once after a quiet while */
  burst: number;
  /** Queries per minute that come back into the bucket */
  perMinute: number;
  /** Queries of one client running at once */
  concurrent: number;
  /** Clients kept at most; past that the bucket of a new one starts empty (a flood of addresses gets nothing) */
  maxClients: number;
}

interface Client {
  tokens: number;
  /** When `tokens` was last brought up to date, ms */
  at: number;
  running: number;
}

export type Admission =
  | { ok: true; release: () => void }
  | { ok: false; reason: 'rate' | 'concurrent'; retryAfterS: number };

/** The key an address counts under: an IPv4 address as it is, an IPv6 one by its first 64 bits */
export function clientKey(address: string): string {
  const plain = address.trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '');
  if (!plain.includes(':')) return plain;
  const [head, tail = ''] = plain.toLowerCase().split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = plain.includes('::') ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

export class RateLimiter {
  private readonly clients = new Map<string, Client>();
  private readonly options: RateLimitOptions;
  private readonly now: () => number;
  private readonly refillPerMs: number;

  constructor(options: RateLimitOptions, now: () => number = Date.now) {
    this.options = options;
    this.now = now;
    this.refillPerMs = options.perMinute / 60_000;
  }

  /** Clients known right now */
  get size(): number {
    return this.clients.size;
  }

  /**
   * Admit a query of the client `key`: one token and one of its running
   * slots, given back through `release` when the query ends; else why not
   * and how many seconds until it may ask again.
   */
  admit(key: string): Admission {
    const now = this.now();
    let client = this.clients.get(key);
    if (!client) {
      const full = this.clients.size < this.options.maxClients;
      client = { tokens: full ? this.options.burst : 0, at: now, running: 0 };
      this.clients.set(key, client);
    } else {
      client.tokens = Math.min(this.options.burst, client.tokens + (now - client.at) * this.refillPerMs);
      client.at = now;
    }
    if (client.running >= this.options.concurrent) return { ok: false, reason: 'concurrent', retryAfterS: 5 };
    if (client.tokens < 1) {
      return { ok: false, reason: 'rate', retryAfterS: Math.max(1, Math.ceil((1 - client.tokens) / this.refillPerMs / 1000)) };
    }
    client.tokens -= 1;
    client.running++;
    let released = false;
    const held = client;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        held.running--;
      },
    };
  }

  /** Forget the clients whose bucket is full again and who have nothing running */
  sweep(): void {
    const now = this.now();
    for (const [key, client] of this.clients) {
      const tokens = client.tokens + (now - client.at) * this.refillPerMs;
      if (client.running === 0 && tokens >= this.options.burst) this.clients.delete(key);
    }
  }
}

/**
 * The queries running at once on the Overpass server, and a queue in front
 * of it: a query waits for a slot at most `maxWaitMs`, and no more than
 * `maxQueue` wait; past that the proxy answers busy, so the game asks another
 * server instead of waiting on this one.
 */
export class Gate {
  private running = 0;
  private readonly waiting: { resolve: (release: (() => void) | null) => void; timer: ReturnType<typeof setTimeout> }[] = [];
  private readonly slots: number;
  private readonly maxQueue: number;
  private readonly maxWaitMs: number;

  constructor(slots: number, maxQueue: number, maxWaitMs: number) {
    this.slots = slots;
    this.maxQueue = maxQueue;
    this.maxWaitMs = maxWaitMs;
  }

  get load(): { running: number; waiting: number } {
    return { running: this.running, waiting: this.waiting.length };
  }

  /** A slot's release, or null when the queue is full, the wait ran out or `signal` aborted the wait */
  acquire(signal?: AbortSignal): Promise<(() => void) | null> {
    if (this.running < this.slots) {
      this.running++;
      return Promise.resolve(this.releaser());
    }
    if (this.waiting.length >= this.maxQueue || signal?.aborted) return Promise.resolve(null);
    return new Promise((resolve) => {
      const leave = (): void => {
        const at = this.waiting.indexOf(entry);
        if (at >= 0) this.waiting.splice(at, 1);
        clearTimeout(entry.timer);
        signal?.removeEventListener('abort', leave);
        resolve(null);
      };
      const entry = {
        resolve: (release: (() => void) | null) => {
          signal?.removeEventListener('abort', leave);
          resolve(release);
        },
        timer: setTimeout(leave, this.maxWaitMs),
      };
      signal?.addEventListener('abort', leave, { once: true });
      this.waiting.push(entry);
    });
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiting.shift();
      if (next) {
        clearTimeout(next.timer);
        next.resolve(this.releaser());
      } else {
        this.running--;
      }
    };
  }
}
