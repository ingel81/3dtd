// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientKey, Gate, RateLimiter } from './rate-limit.ts';

describe('clientKey', () => {
  it('keeps an IPv4 address and takes an IPv6 one by its /64', () => {
    expect(clientKey('203.0.113.7')).toBe('203.0.113.7');
    expect(clientKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(clientKey('2001:db8:aa:bb:1:2:3:4')).toBe('2001:db8:aa:bb::/64');
    expect(clientKey('2001:db8:aa:bb::99')).toBe('2001:db8:aa:bb::/64');
    expect(clientKey('2001:0db8:00aa::1')).toBe('2001:db8:aa:0::/64');
    expect(clientKey('2001:db8::1')).toBe(clientKey('2001:db8:0:0:ffff::1'));
  });
});

describe('RateLimiter', () => {
  const options = { burst: 3, perMinute: 6, concurrent: 2, maxClients: 2 };

  it('lets a burst through, then one query per refill, and says how long to wait', () => {
    let now = 0;
    const limiter = new RateLimiter(options, () => now);
    for (let k = 0; k < 3; k++) {
      const a = limiter.admit('a');
      expect(a.ok).toBe(true);
      if (a.ok) a.release();
    }
    expect(limiter.admit('a')).toEqual({ ok: false, reason: 'rate', retryAfterS: 10 });
    now = 4000;
    expect(limiter.admit('a')).toEqual({ ok: false, reason: 'rate', retryAfterS: 6 });
    now = 10_500;
    expect(limiter.admit('a').ok).toBe(true);
    // Another client has its own bucket
    expect(limiter.admit('b').ok).toBe(true);
  });

  it('holds a client to its queries at once until one is released', () => {
    const limiter = new RateLimiter({ ...options, burst: 10 }, () => 0);
    const first = limiter.admit('a');
    const second = limiter.admit('a');
    expect(limiter.admit('a')).toMatchObject({ ok: false, reason: 'concurrent' });
    if (first.ok) {
      first.release();
      first.release();
    }
    expect(limiter.admit('a').ok).toBe(true);
    expect(limiter.admit('a').ok).toBe(false);
    expect(second.ok).toBe(true);
  });

  it('gives a new client nothing while it knows the most clients, and forgets the quiet ones', () => {
    let now = 0;
    const limiter = new RateLimiter(options, () => now);
    for (const key of ['a', 'b']) {
      const a = limiter.admit(key);
      if (a.ok) a.release();
    }
    expect(limiter.admit('c')).toMatchObject({ ok: false, reason: 'rate' });
    now = 60_000;
    limiter.sweep();
    expect(limiter.size).toBe(0);
    expect(limiter.admit('d').ok).toBe(true);
  });
});

describe('Gate', () => {
  afterEach(() => vi.useRealTimers());

  it('lets `slots` through, queues the next and hands a slot on in order', async () => {
    const gate = new Gate(1, 2, 1000);
    const first = await gate.acquire();
    expect(first).not.toBeNull();
    const order: number[] = [];
    const second = gate.acquire().then((r) => (order.push(2), r));
    const third = gate.acquire().then((r) => (order.push(3), r));
    expect(await gate.acquire()).toBeNull();
    expect(gate.load).toEqual({ running: 1, waiting: 2 });
    first!();
    const releaseSecond = await second;
    releaseSecond!();
    (await third)!();
    expect(order).toEqual([2, 3]);
    expect(gate.load).toEqual({ running: 0, waiting: 0 });
  });

  it('gives up a wait after its time or when its signal aborts', async () => {
    vi.useFakeTimers();
    const gate = new Gate(1, 5, 1000);
    const held = await gate.acquire();
    const late = gate.acquire();
    vi.advanceTimersByTime(1000);
    expect(await late).toBeNull();
    const controller = new AbortController();
    const left = gate.acquire(controller.signal);
    controller.abort();
    expect(await left).toBeNull();
    expect(gate.load).toEqual({ running: 1, waiting: 0 });
    held!();
    expect(gate.load).toEqual({ running: 0, waiting: 0 });
  });
});
