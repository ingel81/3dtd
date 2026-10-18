import {
  NO_RETRY,
  OverpassError,
  STREET_RETRY,
  busyRemark,
  fetchOverpass,
  httpFailureKind,
  isOverpassCancelled,
  overpassRetryText,
  retryAfterMs,
  retryDelayMs,
  type OverpassRequest,
  type OverpassRetry,
} from './overpass-client';
import { OverpassHealth } from './overpass-health';
import type { OverpassServer } from './overpass-servers';

/**
 * The Overpass client's failures and retries, on a fake fetch: each kind of
 * failure sorted into one that may pass or not, the waits between the
 * rounds with fake timers, Retry-After, the pause after a 429, the budget,
 * the rotation of the servers, the servers chosen by the query's box and by
 * their health, at most two requests at once, and a cancel in a round and in
 * a wait.
 */

const global = (name: string): OverpassServer => ({ url: `https://${name}.example/api/interpreter`, name, coverage: null });
const A = global('a');
const B = global('b');
const C = global('c');
/** A regional server holding the box 47..48 N, 8..9 E */
const R: OverpassServer = {
  url: 'https://r.example/api/interpreter',
  name: 'r',
  coverage: [{ minLat: 47, minLon: 8, maxLat: 48, maxLon: 9 }],
};
const INSIDE = { minLat: 47.3, minLon: 8.5, maxLat: 47.4, maxLon: 8.6 };
const ACROSS = { minLat: 47.9, minLon: 8.5, maxLat: 48.1, maxLon: 8.6 };

/** What a fake server does with one request */
type Reply =
  | { status: number; body?: string; retryAfter?: string }
  | { network: true }
  | { hang: true };

const ok = (elements: unknown[] = [{ type: 'node', id: 1, lat: 1, lon: 2 }], extra: object = {}): Reply => ({
  status: 200,
  body: JSON.stringify({ elements, ...extra }),
});

describe('overpass-client', () => {
  let replies: Reply[];
  let asked: string[];
  let health: OverpassHealth;
  let warn: ReturnType<typeof vi.spyOn>;
  const logged = (): string[] => warn.mock.calls.map((call: unknown[]) => String(call[0]));

  beforeEach(() => {
    replies = [];
    asked = [];
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    health = new OverpassHealth(null);
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
      asked.push(new URL(url).host);
      const reply = replies.shift() ?? { hang: true };
      const signal = init.signal as AbortSignal;
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
        if ('hang' in reply) return;
        // A busy server's error page without a CORS header: the browser says only this
        if ('network' in reply) return reject(new TypeError('Failed to fetch'));
        resolve({
          ok: reply.status < 400,
          status: reply.status,
          headers: new Headers(reply.retryAfter ? { 'Retry-After': reply.retryAfter } : {}),
          text: async () => reply.body ?? '',
        });
      });
    }));
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const load = (extra: Partial<OverpassRequest<unknown>> = {}) =>
    fetchOverpass({ what: 'streets', query: 'q', servers: [A, B], health, accept: (data) => data, random: () => 0.5, ...extra });

  /** Run timers and promises until the load has nothing left to do before `ms` */
  const run = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  describe('sorting a failure', () => {
    it('takes the statuses of a busy or failing server as passing, a refused query as not', () => {
      for (const status of [429, 502, 503, 504, 406, 408, 425]) expect(httpFailureKind(status)).toBe('busy');
      for (const status of [500, 501, 599]) expect(httpFailureKind(status)).toBe('server');
      for (const status of [400, 403, 404, 413]) expect(httpFailureKind(status)).toBe('refused');
      expect(new OverpassError('x', 'busy').transient).toBe(true);
      expect(new OverpassError('x', 'network').transient).toBe(true);
      expect(new OverpassError('x', 'timeout').transient).toBe(true);
      expect(new OverpassError('x', 'malformed').transient).toBe(true);
      expect(new OverpassError('x', 'refused').transient).toBe(false);
      expect(new OverpassError('x', 'rejected').transient).toBe(false);
      expect(new OverpassError('x', 'cancelled').transient).toBe(false);
    });

    it('tells a remark of a busy server from one of a query that ran into its limits', () => {
      expect(busyRemark('runtime error: open64: 0 Success /osm3s_v0.7.62_osm_base Dispatcher_Client::request_read_and_idx::timeout. The server is probably too busy to handle your request.')).toBe(true);
      expect(busyRemark('runtime error: Query run out of memory using about 4 MB of RAM.')).toBe(false);
      expect(busyRemark(undefined)).toBe(false);
    });

    it('reads Retry-After as seconds or as a date', () => {
      expect(retryAfterMs('7')).toBe(7000);
      expect(retryAfterMs(new Date(Date.now() + 5000).toUTCString())).toBeGreaterThan(3000);
      expect(retryAfterMs('soon')).toBeNull();
      expect(retryAfterMs(null)).toBeNull();
    });

    it.each<[string, Reply, string]>([
      ['a 502 at capacity', { status: 502, body: 'server is currently at capacity' }, 'busy, HTTP 502'],
      ['a 500', { status: 500 }, 'server, HTTP 500'],
      ['an error page without CORS header', { network: true }, 'network, Failed to fetch'],
      ['a body cut off', { status: 200, body: '{"elements":[{"type":"no' }, 'malformed, no JSON in the answer'],
      ['an HTML page with 200', { status: 200, body: '<html>busy</html>' }, 'malformed, no JSON in the answer'],
      ['an answer without elements', { status: 200, body: '{"remark":"x"}' }, 'malformed, no elements in the answer'],
      ['a 200 of a server too busy', ok([], { remark: 'runtime error: ... The server is probably too busy to handle your request.' }), 'busy, too busy'],
    ])('asks again after %s, and logs the attempt with its server, time, try and kind', async (_name, reply, logs) => {
      replies.push(reply, reply, ok());
      const loading = load();
      await run(0);
      // Round 1: both servers failed; the wait before round 2 is half to all of 3 s (0.5: 2.25 s)
      expect(asked).toEqual(['a.example', 'b.example']);
      expect(logged()).toContainEqual(expect.stringMatching(new RegExp(`^\\[OSM\\] streets from a\\.example failed after \\d+ms \\(try 1 of 8\\): ${logs.replace(/[()]/g, '\\$&')}`)));
      expect(logged()).toContainEqual('[OSM] streets: no server answered (' + logs.split(',')[0] + '), trying again in 1.5s (try 2 of 8)');
      await run(1500);
      await expect(loading).resolves.toMatchObject({ elements: [{ id: 1 }] });
      // Round 2 begins with the second server
      expect(asked).toEqual(['a.example', 'b.example', 'b.example']);
    });

    it('asks again after a server that does not start its answer in time', async () => {
      replies.push({ hang: true }, { hang: true }, ok());
      const loading = load({ limits: { headerTimeoutMs: 1000, bodyTimeoutMs: 1000, hedgeMs: 500 } });
      await run(1000);
      expect(logged()).toContainEqual(expect.stringMatching(/a\.example failed after \d+ms \(try 1 of 8\): timeout, no answer within 1000ms$/));
      await run(500 + 1500);
      await expect(loading).resolves.toMatchObject({ elements: [{ id: 1 }] });
    });

    it('does not ask again when every server refuses the query', async () => {
      replies.push({ status: 400 }, { status: 400 });
      const loading = load();
      const failed = expect(loading).rejects.toMatchObject({ kind: 'refused', message: 'a.example: HTTP 400; b.example: HTTP 400' });
      await run(0);
      await failed;
      expect(asked).toHaveLength(2);
    });

    it('gives the caller its own error when every server answered and it refused each answer', async () => {
      replies.push(ok(), ok());
      const loading = load({
        accept: () => {
          throw new Error('No streets found in this area. Choose a different location.');
        },
      });
      const failed = expect(loading).rejects.toThrow(/^No streets found in this area/);
      await run(0);
      await failed;
      expect(asked).toHaveLength(2);
    });

    it('asks again while one server refused the answer and the other was busy', async () => {
      replies.push(ok([]), { status: 504 }, ok([{ type: 'node', id: 9, lat: 0, lon: 0 }]));
      const loading = load({
        accept: (data) => {
          if (!data.elements.length) throw new Error('No streets found in this area');
          return data;
        },
      });
      await run(0);
      await run(1500);
      await expect(loading).resolves.toMatchObject({ elements: [{ id: 9 }] });
    });
  });

  describe('the waits between the rounds', () => {
    it('doubles the wait, draws it between half and all of it, caps it', () => {
      const policy = { rounds: 9, budgetMs: 1e9, baseDelayMs: 3000, maxDelayMs: 24_000 };
      expect([1, 2, 3, 4, 5].map((r) => retryDelayMs(r, policy, 0))).toEqual([1500, 3000, 6000, 12000, 12000]);
      expect([1, 2, 3, 4, 5].map((r) => retryDelayMs(r, policy, 0.999999))).toEqual([3000, 6000, 12000, 24000, 24000]);
    });

    it('asks eight rounds when every server stays busy, tells each round, and names what each server said last', async () => {
      for (let i = 0; i < 16; i++) replies.push(i % 2 ? { status: 500 } : { status: 502 });
      const retries: OverpassRetry[] = [];
      const loading = load({ onRetry: (r) => retries.push(r) });
      const failed = expect(loading).rejects.toMatchObject({ kind: 'busy', transient: true });

      await run(0);
      expect(asked).toHaveLength(2);
      // The waits at random 0.5: 1.5, 3, 6, 12 and then 15 s
      const waits = [1500, 3000, 6000, 12000, 15000, 15000, 15000];
      for (const [k, wait] of waits.entries()) {
        await run(wait - 1);
        expect(asked).toHaveLength(2 * k + 2);
        await run(1);
        expect(asked).toHaveLength(2 * k + 4);
      }
      await failed;
      expect(retries).toEqual(waits.map((waitMs, k) => ({ attempt: k + 2, of: 8, waitMs, kind: 'busy' })));
      // Each round begins with the other server: round 8 with the second; the first failure of a round answered 502
      expect(asked.slice(-2)).toEqual(['b.example', 'a.example']);
      await expect(loading).rejects.toThrow('b.example: HTTP 502; a.example: HTTP 500; 8 tries');
      expect(overpassRetryText(retries[0])).toBe('The map server is busy, trying again (2 of 8)');
      expect(overpassRetryText({ ...retries[0], kind: 'timeout' }, 3.2)).toBe('The map server did not answer in time, trying again in 4 s (2 of 8)');
      expect(overpassRetryText({ ...retries[0], kind: 'network' }, 0)).toBe('The map server cannot be reached, asking again (2 of 8)');
    });

    it('leaves a server that answered 429 alone for 30 s and asks the others meanwhile', async () => {
      replies.push({ status: 429 }, { status: 502 }, ok());
      const loading = load();
      await run(0);
      expect(logged()).toContainEqual(expect.stringMatching(/a\.example failed after \d+ms \(try 1 of 8\): busy, HTTP 429$/));
      expect(health.pausedUntil(A.url)).toBe(Date.now() + 30_000);
      await run(1500);
      await expect(loading).resolves.toBeTruthy();
      // Round 2 asked only b
      expect(asked).toEqual(['a.example', 'b.example', 'b.example']);
    });

    it('waits for the first pause to end when every server asked for one, at least as long as it asked', async () => {
      replies.push({ status: 429, retryAfter: '40' }, { status: 503, retryAfter: '10' }, ok());
      const retries: OverpassRetry[] = [];
      const loading = load({ onRetry: (r) => retries.push(r) });
      await run(0);
      // a: 40 s (its Retry-After over the 30 s after a 429), b: its Retry-After
      expect(retries[0].waitMs).toBe(10_000);
      await run(9999);
      expect(asked).toHaveLength(2);
      await run(1);
      await expect(loading).resolves.toBeTruthy();
      expect(asked).toEqual(['a.example', 'b.example', 'b.example']);
    });

    it('starts no round past its budget', async () => {
      replies.push({ status: 503 }, { status: 503 }, { status: 503, retryAfter: '60' }, { status: 503, retryAfter: '60' });
      const loading = load({ retry: { ...STREET_RETRY, budgetMs: 30_000 } });
      const failed = expect(loading).rejects.toMatchObject({ kind: 'busy' });
      await run(0);
      await run(1500);
      await failed;
      // Both servers asked for 60 s: the third round would begin past the budget
      expect(asked).toHaveLength(4);
      expect(logged()).toContainEqual(expect.stringMatching(/^\[OSM\] streets: no time left to ask again/));
    });

    it('asks once without retries', async () => {
      replies.push({ status: 502 }, { status: 502 });
      const loading = load({ retry: NO_RETRY });
      const failed = expect(loading).rejects.toThrow('a.example: HTTP 502; b.example: HTTP 502');
      await run(0);
      await failed;
      expect(logged().some((line) => line.includes('trying again'))).toBe(false);
    });
  });

  describe('choosing the servers', () => {
    const names = (servers: OverpassServer[]) => servers.map((s) => s.name);

    it('asks a regional server first for a box inside its region, and not for one across its border or without a box', async () => {
      replies.push(ok());
      await load({ servers: [A, R], box: INSIDE });
      expect(asked).toEqual(['r.example']);

      for (const box of [ACROSS, undefined]) {
        asked = [];
        health = new OverpassHealth(null);
        replies.push({ status: 502 }, ok());
        const loading = load({ servers: [A, R, B], box });
        await run(0);
        await loading;
        expect(asked).toEqual(['a.example', 'b.example']);
      }
    });

    it('takes no element from a regional server as no data, asks the others and leaves it out of the later rounds', async () => {
      replies.push(ok([]), { status: 502 }, ok([{ type: 'node', id: 7, lat: 47.35, lon: 8.55 }]));
      const loading = load({ servers: [A, R], box: INSIDE });
      await run(0);
      expect(logged()).toContainEqual(expect.stringMatching(/r\.example failed after \d+ms \(try 1 of 8\): rejected, no data for this area$/));
      await run(1500);
      await expect(loading).resolves.toMatchObject({ elements: [{ id: 7 }] });
      expect(asked).toEqual(['r.example', 'a.example', 'a.example']);
    });

    it('names the others, not the regional server without data, when the load fails', async () => {
      replies.push(ok([]), { status: 400 });
      const loading = load({ servers: [A, R], box: INSIDE });
      const failed = expect(loading).rejects.toMatchObject({ kind: 'refused', message: 'a.example: HTTP 400' });
      await run(0);
      await failed;
    });

    it('asks first the servers that answered lately, the fast before the slow, and puts one that just failed behind', async () => {
      // c answered twice, b once and slower, a failed
      health.record(C.url, true, 800);
      health.record(C.url, true, 900);
      health.record(B.url, true, 5000);
      health.record(A.url, false, 15000);
      replies.push(ok());
      await load({ servers: [A, B, C] });
      expect(asked).toEqual(['c.example']);
      expect(names(health.order([A, B, C]))).toEqual(['c', 'b', 'a']);
      // Three minutes later a's failure no longer puts it behind, b's fresh one does
      vi.advanceTimersByTime(3 * 60_000);
      health.record(B.url, false, 15000);
      expect(names(health.order([A, B]))).toEqual(['a', 'b']);
    });

    it('counts each answer and each failure that may pass, not a refused query', async () => {
      replies.push({ status: 400 }, ok());
      await load();
      // a's refusal did not put it behind c, of which nothing is known
      expect(names(health.order([A, C]))).toEqual(['a', 'c']);
      replies.push({ status: 502 }, ok());
      const loading = load({ servers: [A, C] });
      await run(0);
      await loading;
      expect(names(health.order([A, C]))).toEqual(['c', 'a']);
    });

    it('has at most two requests under way, also when both hang past the hedge time', async () => {
      replies.push({ hang: true }, { hang: true }, ok());
      const told: string[] = [];
      const loading = load({
        servers: [A, B, C],
        limits: { headerTimeoutMs: 10_000, bodyTimeoutMs: 1000, hedgeMs: 500 },
        onAsk: (host) => told.push(host),
      });
      await run(9999);
      expect(asked).toEqual(['a.example', 'b.example']);
      // a times out: c takes its place
      await run(1);
      expect(asked).toEqual(['a.example', 'b.example', 'c.example']);
      expect(told).toEqual(asked);
      await expect(loading).resolves.toBeTruthy();
    });
  });

  describe('cancelled', () => {
    it('ends a wait between the rounds at once, asks nothing more', async () => {
      replies.push({ status: 502 }, { status: 502 }, ok());
      const controller = new AbortController();
      const loading = load({ signal: controller.signal });
      const failed = expect(loading).rejects.toSatisfy(isOverpassCancelled);
      await run(1000);
      controller.abort();
      await failed;
      await run(60_000);
      expect(asked).toHaveLength(2);
    });

    it('ends the requests of a round', async () => {
      const controller = new AbortController();
      const loading = load({ signal: controller.signal });
      const failed = expect(loading).rejects.toSatisfy(isOverpassCancelled);
      await run(5000);
      expect(asked).toHaveLength(2);
      controller.abort();
      await failed;
      expect(vi.mocked(fetch).mock.calls.every(([, init]) => (init!.signal as AbortSignal).aborted)).toBe(true);
    });

    it('does not begin when the signal is aborted already', async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(load({ signal: controller.signal })).rejects.toSatisfy(isOverpassCancelled);
      expect(asked).toEqual([]);
    });
  });
});
