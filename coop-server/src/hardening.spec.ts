// @vitest-environment node
/**
 * The relay under hostile and broken clients (relay review 2026-09-26): a
 * fuzz of every message type, the limits on connections, the hello, the
 * heartbeat, room codes, and the status page's health check and actions.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import { CLOSE_RESTART, startRelay, type RelayMetricsView, type RelayServer } from './server.ts';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '../../src/app/coop/protocol.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until `ok`, up to 3 s */
async function until(ok: () => boolean): Promise<void> {
  const end = Date.now() + 3000;
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out');
    await sleep(10);
  }
}

async function socketTo(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://localhost:${port}`);
  await new Promise<void>((resolve, reject) => {
    socket.on('open', () => resolve());
    socket.on('error', reject);
  });
  return socket;
}

/** A client on a real socket that keeps what it heard. */
async function client(port: number, name: string) {
  const socket = await socketTo(port);
  const heard: ServerMessage[] = [];
  const waiters: (() => void)[] = [];
  socket.on('message', (data) => {
    heard.push(JSON.parse(String(data)) as ServerMessage);
    for (const w of waiters.splice(0)) w();
  });
  const send = (message: ClientMessage | string) => socket.send(typeof message === 'string' ? message : JSON.stringify(message));
  const until = async <T extends ServerMessage['t']>(t: T, where: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true) => {
    for (;;) {
      const found = heard.find((m) => m.t === t && where(m as Extract<ServerMessage, { t: T }>));
      if (found) return found as Extract<ServerMessage, { t: T }>;
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };
  send({ t: 'hello', protocol: PROTOCOL_VERSION, name, gameVersion: 'v1', configHash: 'h' });
  const { playerId } = await until('welcome');
  return { socket, heard, send, until, playerId };
}

const closed = (socket: WebSocket) => new Promise<number>((resolve) => {
  if (socket.readyState === socket.CLOSED) resolve(1006);
  socket.on('close', (code) => resolve(code));
});

const metricsOf = async (relay: RelayServer) =>
  (await (await fetch(`http://localhost:${relay.port}/metrics.json`)).json()) as RelayMetricsView;

/** A good message of every type the client may send, the base the fuzz breaks field by field */
const GOOD: Record<string, Record<string, unknown>> = {
  hello: { protocol: PROTOCOL_VERSION, name: 'Zed', gameVersion: 'v1', configHash: 'h', client: { engine: 'x', version: '1', family: 'blink', os: 'y' } },
  create: {},
  join: { room: 'NOPE42' },
  world: { world: { a: 1 }, spawnIds: ['s1', 's2'] },
  moving: {},
  status: { status: 'ready' },
  pick: { spawnId: 's9' },
  rename: { name: 'Zed' },
  kick: { playerId: 'nobody' },
  lock: { locked: false },
  listing: { listing: { public: true, title: 'T', city: 'C' } },
  rooms: {},
  options: { options: { cheats: 'host', pause: 'host', wave: 'all' } },
  ready: { ready: true },
  start: { seed: 1 },
  cmd: { command: { type: 'command:fuzz', value: 1 } },
  hash: { tick: 0, hash: 1, parts: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
  'hash-detail': { tick: 0, entities: { enemies: [['e1', 1]] } },
  stats: { stats: { frames: 1, blocked: 0, steps: [1, 0, 0, 0], behindAvg: 0, behindMin: 0, tickGapAvg: 33, tickGapSd: 1, inputAvg: null, inputMax: null, inputs: 0 } },
  speed: { speed: 1 },
  chat: { text: 'hi' },
  ping: { lat: 48.1, lon: 9.1, height: 3 },
};

/** What a hostile or broken client puts where a field belongs (JSON has no NaN: it becomes null) */
const BAD: unknown[] = [
  null, 0, -1, 1e308, '', 'x'.repeat(200_000), [], [[[[]]]], {}, { toString: 1 }, true,
  JSON.parse('{"__proto__": {"polluted": 1}}'), Array.from({ length: 10_000 }, () => 1),
];

/** Every message of the fuzz: each type without fields, each field of each type set to each bad value */
function fuzzMessages(): string[] {
  const out = ['null', '[]', '1', '"hello"', 'not json', '{"t":1}', '{"t":{"toString":1}}', '{}', '{"t":"no-such-type"}'];
  for (const [t, good] of Object.entries(GOOD)) {
    out.push(JSON.stringify({ t }));
    for (const field of Object.keys(good)) {
      for (const bad of BAD) out.push(JSON.stringify({ t, ...good, [field]: bad }));
      // Nested fields as well: one bad value inside the object a field holds
      const inner = good[field];
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
        for (const key of Object.keys(inner)) {
          for (const bad of BAD) out.push(JSON.stringify({ t, ...good, [field]: { ...inner, [key]: bad } }));
        }
      }
    }
  }
  return out;
}

describe('the relay under a fuzz of every message type (relay review K1, H1)', () => {
  let relay: RelayServer | null = null;
  afterEach(async () => {
    await relay?.close();
    relay = null;
  });

  it('never fails on a message: no error, the game goes on, the relay stays up', async () => {
    const lines: string[] = [];
    relay = await startRelay({ port: 0, cheats: true, maxMessagesPerSecond: 100_000, log: (line) => lines.push(line) });
    const port = relay.port;

    // A game of two, and a lobby of its own for the fuzz that only a lobby host reaches
    const a = await client(port, 'Ann');
    const b = await client(port, 'Bob');
    a.send({ t: 'create' });
    const code = (await a.until('room')).room.code;
    b.send({ t: 'join', room: code });
    await b.until('room', (m) => m.room.players.length === 2);
    a.send({ t: 'world', world: { w: 1 }, spawnIds: ['s1', 's2'] });
    a.send({ t: 'pick', spawnId: 's1' });
    b.send({ t: 'pick', spawnId: 's2' });
    b.send({ t: 'ready', ready: true });
    await a.until('room', (m) => m.room.players.length === 2 && m.room.players.every((p) => p.ready || p.id === m.room.hostId));
    a.send({ t: 'start', seed: 1 });
    await b.until('started');
    const lobbyHost = await client(port, 'Lou');
    lobbyHost.send({ t: 'create' });
    await lobbyHost.until('room');

    const messages = fuzzMessages();
    expect(messages.length).toBeGreaterThan(500);
    // Before any hello, from the game's host, from a lobby's host
    const stranger = await socketTo(port);
    for (const text of messages) {
      stranger.send(text);
      a.socket.send(text);
      lobbyHost.socket.send(text);
    }
    await sleep(500);

    const metrics = await metricsOf(relay);
    expect(metrics.errors, lines.filter((l) => l.includes('failed')).join('\n')).toBe(0);
    expect(metrics.dropped.malformed).toBeGreaterThan(500);
    expect((await fetch(`http://localhost:${port}/healthz`)).status).toBe(200);
    // The game still runs: Bob gets ticks after the fuzz (which paused it with a speed of 0, as a host may)
    a.send({ t: 'speed', speed: 1 });
    await sleep(100);
    const ticksBefore = b.heard.filter((m) => m.t === 'tick').length;
    await sleep(200);
    expect(b.heard.filter((m) => m.t === 'tick').length).toBeGreaterThan(ticksBefore);
    expect(b.socket.readyState).toBe(b.socket.OPEN);
    // Nothing reached a prototype
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    // No log line longer than a sane one: long strings were cut
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThan(2000);
    for (const s of [stranger, a.socket, b.socket, lobbyHost.socket]) s.close();
  }, 30_000);
});

describe('the relay\'s limits (relay review H3, N3, M5, N4)', () => {
  let relay: RelayServer | null = null;
  afterEach(async () => {
    await relay?.close();
    relay = null;
  });

  it('closes a connection that never says hello', async () => {
    relay = await startRelay({ port: 0, helloTimeoutMs: 50 });
    const socket = await socketTo(relay.port);
    await closed(socket);
    expect((await metricsOf(relay)).dropped['no-hello']).toBe(1);
  });

  it('refuses connections beyond the cap per address and in all', async () => {
    relay = await startRelay({ port: 0, maxPerAddress: 2, maxConnections: 10 });
    const first = [await socketTo(relay.port), await socketTo(relay.port)];
    await expect(socketTo(relay.port)).rejects.toBeTruthy();
    first[0].close();
    await closed(first[0]);
    await sleep(20);
    const again = await socketTo(relay.port);
    expect((await metricsOf(relay)).refused['per-address']).toBe(1);
    for (const s of [first[1], again]) s.close();

    await relay.close();
    relay = await startRelay({ port: 0, maxPerAddress: 10, maxConnections: 1 });
    const one = await socketTo(relay.port);
    await expect(socketTo(relay.port)).rejects.toBeTruthy();
    expect((await metricsOf(relay)).refused.full).toBe(1);
    one.close();
  });

  it('closes a connection that guesses room codes', async () => {
    relay = await startRelay({ port: 0, maxMessagesPerSecond: 1000 });
    const c = await client(relay.port, 'Guess');
    for (let i = 0; i < 25; i++) c.send({ t: 'join', room: `NOPE${String(i).padStart(2, '0')}` });
    await closed(c.socket);
    expect((await metricsOf(relay)).dropped['join-guessing']).toBe(1);
  });

  it('keeps a player through two missed heartbeats and lets them go after the third', async () => {
    relay = await startRelay({ port: 0, heartbeatMs: 40 });
    const c = await client(relay.port, 'Quiet');
    // No pongs from here on: ws answers pings by itself, so stop the socket from reading
    c.socket.pause();
    const at = Date.now();
    await until(() => relay!.status().connections === 0);
    expect(Date.now() - at).toBeGreaterThanOrEqual(3 * 40 - 10);
    expect((await metricsOf(relay)).dropped.hanging).toBe(1);
    c.socket.terminate();
  });

  it('closes a game nobody gave a command for too long', async () => {
    relay = await startRelay({ port: 0, gameIdleMaxMs: 80, heartbeatMs: 30 });
    const a = await client(relay.port, 'Ann');
    const b = await client(relay.port, 'Bob');
    a.send({ t: 'create' });
    const code = (await a.until('room')).room.code;
    b.send({ t: 'join', room: code });
    await b.until('room', (m) => m.room.players.length === 2);
    a.send({ t: 'world', world: {}, spawnIds: ['s1', 's2'] });
    a.send({ t: 'pick', spawnId: 's1' });
    b.send({ t: 'pick', spawnId: 's2' });
    b.send({ t: 'ready', ready: true });
    await a.until('room', (m) => m.room.players.length === 2 && m.room.players.every((p) => p.ready || p.id === m.room.hostId));
    a.send({ t: 'start', seed: 1 });
    await b.until('started');
    await Promise.all([closed(a.socket), closed(b.socket)]);
    await until(() => relay!.status().rooms.length === 0);
  });
});

describe('the status page (relay review ideas 2 and 3)', () => {
  let relay: RelayServer | null = null;
  afterEach(async () => {
    await relay?.close();
    relay = null;
  });

  it('answers the health check even where the status page is local only', async () => {
    relay = await startRelay({ port: 0, statusAccess: 'local' });
    const health = await fetch(`http://localhost:${relay.port}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.text()).toBe('ok\n');
    // Through a tunnel: the health check yes, the page no
    const tunnel = { headers: { 'cf-connecting-ip': '203.0.113.9' } };
    expect((await fetch(`http://localhost:${relay.port}/healthz`, tunnel)).status).toBe(200);
    expect((await fetch(`http://localhost:${relay.port}/status`, tunnel)).status).toBe(404);
  });

  it('writes the metrics line only when something changed, not every idle minute', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const lines: string[] = [];
      relay = await startRelay({ port: 0, log: (line) => lines.push(line) });
      vi.advanceTimersByTime(5 * 60_000);
      expect(lines.filter((l) => l.startsWith('metrics:'))).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the page, metrics and the log, and has no actions without a token', async () => {
    relay = await startRelay({ port: 0, log: () => undefined });
    const page = await fetch(`http://localhost:${relay.port}/`);
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
    const metrics = await metricsOf(relay);
    expect(metrics.actions).toBe(false);
    const log = (await (await fetch(`http://localhost:${relay.port}/log.json`)).json()) as string[];
    expect(log.some((l) => l.startsWith('coop relay on port'))).toBe(true);
    const refused = await fetch(`http://localhost:${relay.port}/admin/close-room`, { method: 'POST', body: '{"code":"X"}' });
    expect(refused.status).toBe(403);
  });

  it('drops a player and closes a room with the admin token', async () => {
    relay = await startRelay({ port: 0, adminToken: 'secret' });
    const post = (path: string, body: unknown, token = 'secret') =>
      fetch(`http://localhost:${relay!.port}${path}`, { method: 'POST', headers: { 'x-admin-token': token }, body: JSON.stringify(body) });
    const a = await client(relay.port, 'Ann');
    const b = await client(relay.port, 'Bob');
    a.send({ t: 'create' });
    const code = (await a.until('room')).room.code;
    b.send({ t: 'join', room: code });
    await b.until('room', (m) => m.room.players.length === 2);

    // The page asks first whether its token is right
    expect((await post('/admin/check', {}, 'wrong')).status).toBe(403);
    expect((await post('/admin/check', {})).status).toBe(200);
    expect((await post('/admin/drop-player', { id: b.playerId }, 'wrong')).status).toBe(403);
    expect((await post('/admin/drop-player', { id: b.playerId })).status).toBe(200);
    await closed(b.socket);
    expect((await post('/admin/close-room', { code })).status).toBe(200);
    await closed(a.socket);
    await until(() => relay!.status().rooms.length === 0);
    expect((await post('/admin/close-room', { code })).status).toBe(404);
  });

  it('tells the clients a restart when it stops with a reason (review M6)', async () => {
    relay = await startRelay({ port: 0 });
    const a = await client(relay.port, 'Ann');
    const code = closed(a.socket);
    await relay.close('The coop server restarts');
    expect(await code).toBe(CLOSE_RESTART);
    // A second close does nothing more (review N7)
    await relay.close();
    relay = null;
  });
});
