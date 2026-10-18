// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProxyConfig } from './config.ts';
import { startProxy, type RunningProxy } from './proxy.ts';
import type { RequestRow } from './stats-store.ts';

const GAME = 'https://3dtd.sgeht.net';
const BOX = 'way["highway"](49.79,9.93,49.81,9.96);out;';

/** A stand-in for Overpass: answers what `reply` says and keeps what it was asked */
interface FakeOverpass {
  server: Server;
  url: string;
  asked: { body: string; headers: IncomingMessage['headers'] }[];
  reply: (res: ServerResponse) => void;
}

async function fakeOverpass(): Promise<FakeOverpass> {
  const fake = {
    asked: [],
    reply: (res: ServerResponse) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"elements":[]}');
    },
  } as unknown as FakeOverpass;
  fake.server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      fake.asked.push({ body, headers: req.headers });
      fake.reply(res);
    });
  });
  await new Promise<void>((r) => fake.server.listen(0, '127.0.0.1', r));
  fake.url = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}/api/interpreter`;
  return fake;
}

const config = (upstream: string, extra: Partial<ProxyConfig> = {}): ProxyConfig => ({
  port: 0,
  upstream,
  origins: [GAME, 'app://app', 'http://localhost:4200'],
  allowNoOrigin: true,
  trustCloudflare: true,
  maxEdgeKm: 5,
  maxAreaKm2: 30,
  maxTimeoutS: 90,
  maxsizeBytes: 256 * 1024 * 1024,
  maxBodyBytes: 4096,
  rateBurst: 50,
  ratePerMinute: 60,
  rateConcurrent: 4,
  rateMaxClients: 1000,
  slots: 4,
  queueMax: 4,
  queueWaitMs: 2000,
  statsDb: '',
  statsDays: 0,
  maintenanceFile: '',
  ...extra,
});

describe('proxy', () => {
  let fake: FakeOverpass;
  let proxy: RunningProxy;
  let base: string;
  let rows: RequestRow[];
  let dir: string;

  const start = async (extra: Partial<ProxyConfig> = {}): Promise<void> => {
    await proxy?.close();
    rows = [];
    proxy = await startProxy(config(extra.upstream ?? fake.url, extra), { record: (row) => rows.push(row), log: () => undefined });
    base = `http://127.0.0.1:${(proxy.server.address() as AddressInfo).port}`;
  };

  const post = (query: string, headers: Record<string, string> = {}) =>
    fetch(`${base}/api/interpreter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: GAME, ...headers },
      body: `data=${encodeURIComponent(query)}`,
    });

  /** The rows are written when the answer has ended, a tick after the client read it */
  const settled = () => new Promise((r) => setTimeout(r, 20));

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ovhost-'));
    fake = await fakeOverpass();
    await start();
  });

  afterEach(async () => {
    await proxy.close();
    fake.server.closeAllConnections();
    await new Promise((r) => fake.server.close(r));
    rmSync(dir, { recursive: true, force: true });
  });

  it('forwards a query in a small box with the caps put in, and lets the game read the answer', async () => {
    const res = await post(`[out:json][timeout:900];${BOX}`, { 'CF-Connecting-IP': '203.0.113.9', 'CF-IPCountry': 'DE' });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(GAME);
    expect(res.headers.get('access-control-expose-headers')).toBe('Retry-After');
    expect(await res.json()).toEqual({ elements: [] });
    const sent = new URLSearchParams(fake.asked[0].body).get('data');
    expect(sent).toBe(`[out:json][timeout:90][maxsize:${256 * 1024 * 1024}];${BOX}`);
    // Overpass does not learn who asked
    expect(JSON.stringify(fake.asked[0].headers)).not.toContain('203.0.113.9');
    await settled();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 200, outcome: 'ok', country: 'DE', reason: null });
    expect(rows[0].box).toEqual({ s: 49.79, w: 9.93, n: 49.81, e: 9.96 });
    expect(JSON.stringify(rows[0])).not.toContain('203.0.113');
  });

  it('takes GET with data= and a raw POST body as well', async () => {
    const get = await fetch(`${base}/api/interpreter?data=${encodeURIComponent(BOX)}`, { headers: { Origin: 'app://app' } });
    expect(get.status).toBe(200);
    expect(get.headers.get('access-control-allow-origin')).toBe('app://app');
    const raw = await fetch(`${base}/api/interpreter`, { method: 'POST', body: BOX });
    expect(raw.status).toBe(200);
    expect(fake.asked.map((a) => new URLSearchParams(a.body).get('data'))).toEqual([expect.stringContaining(BOX), expect.stringContaining(BOX)]);
  });

  it('passes a compressed answer through as it is', async () => {
    const body = JSON.stringify({ elements: [{ type: 'node', id: 1, lat: 49.8, lon: 9.95 }] });
    fake.reply = (res) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' });
      res.end(gzipSync(body));
    };
    const res = await post(BOX, { 'Accept-Encoding': 'gzip' });
    expect(fake.asked[0].headers['accept-encoding']).toBe('gzip');
    expect(await res.text()).toBe(body);
    await settled();
    expect(rows[0].bytes).toBe(gzipSync(body).length);
  });

  it('refuses a query without a box with 400, readable by the game, without asking Overpass', async () => {
    const res = await post('[out:json];way["highway"];out;');
    expect(res.status).toBe(400);
    expect(res.headers.get('access-control-allow-origin')).toBe(GAME);
    expect(await res.text()).toMatch(/without a box/);
    const big = await post('way(49.0,9.0,49.2,9.2);out;');
    expect(big.status).toBe(400);
    const broken = await post('way["highway"(1,2,3,4);out;');
    expect(broken.status).toBe(400);
    expect(fake.asked).toHaveLength(0);
    await settled();
    expect(rows.map((r) => [r.outcome, r.reason])).toEqual([['refused', 'unbounded'], ['refused', 'too-large'], ['refused', 'syntax']]);
    expect(rows[1].box).not.toBeNull();
  });

  it('refuses foreign pages, and pages at all when a request must name one', async () => {
    const foreign = await post(BOX, { Origin: 'https://example.com' });
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
    const none = await fetch(`${base}/api/interpreter`, { method: 'POST', body: BOX });
    expect(none.status).toBe(200);
    await start({ allowNoOrigin: false });
    expect((await fetch(`${base}/api/interpreter`, { method: 'POST', body: BOX })).status).toBe(403);
    expect((await post(BOX)).status).toBe(200);
  });

  it('answers a preflight, and nothing but the interpreter', async () => {
    const pre = await fetch(`${base}/api/interpreter`, { method: 'OPTIONS', headers: { Origin: GAME, 'Access-Control-Request-Method': 'POST' } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-methods')).toContain('POST');
    expect((await fetch(`${base}/api/status`, { headers: { Origin: GAME } })).status).toBe(404);
    expect((await fetch(`${base}/api/interpreter`, { method: 'PUT', body: BOX })).status).toBe(405);
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });

  it('holds a client to its rate with 429 and Retry-After, per address from Cloudflare', async () => {
    await start({ rateBurst: 2, ratePerMinute: 6 });
    const ip = { 'CF-Connecting-IP': '198.51.100.1' };
    expect((await post(BOX, ip)).status).toBe(200);
    expect((await post(BOX, ip)).status).toBe(200);
    const limited = await post(BOX, ip);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('10');
    expect(limited.headers.get('access-control-allow-origin')).toBe(GAME);
    expect((await post(BOX, { 'CF-Connecting-IP': '198.51.100.2' })).status).toBe(200);
    await settled();
    expect(rows.map((r) => r.outcome)).toEqual(['ok', 'ok', 'rate', 'ok']);
  });

  it('turns a query away busy when every slot is taken and the queue is full', async () => {
    await start({ slots: 1, queueMax: 0 });
    let hold!: () => void;
    fake.reply = (res) => {
      hold = () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"elements":[]}');
      };
    };
    const first = post(BOX, { 'CF-Connecting-IP': '198.51.100.3' });
    while (!fake.asked.length) await new Promise((r) => setTimeout(r, 5));
    const second = await post(BOX, { 'CF-Connecting-IP': '198.51.100.4' });
    expect(second.status).toBe(503);
    expect(second.headers.get('retry-after')).toBe('15');
    hold();
    expect((await first).status).toBe(200);
  });

  it('says 503 with a long Retry-After while the database is renewed, and a shorter one when Overpass is down', async () => {
    const flag = join(dir, 'maintenance');
    writeFileSync(flag, '');
    await start({ maintenanceFile: flag });
    const renewing = await post(BOX);
    expect(renewing.status).toBe(503);
    expect(renewing.headers.get('retry-after')).toBe('1800');
    await start({ upstream: 'http://127.0.0.1:1/api/interpreter' });
    const down = await post(BOX);
    expect(down.status).toBe(503);
    expect(down.headers.get('retry-after')).toBe('300');
    expect(down.headers.get('access-control-allow-origin')).toBe(GAME);
  });

  it('passes Overpass\'s own refusals on, with a Retry-After where it gave none', async () => {
    fake.reply = (res) => {
      res.writeHead(429, { 'Content-Type': 'text/html' });
      res.end('rate_limited');
    };
    const res = await post(BOX);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('15');
    await settled();
    expect(rows[0].outcome).toBe('upstream');
  });

  it('refuses a body over the limit with 413', async () => {
    const res = await post(`${BOX}/*${'x'.repeat(5000)}*/`);
    expect(res.status).toBe(413);
    expect(fake.asked).toHaveLength(0);
  });
});
