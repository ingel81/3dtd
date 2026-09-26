// @vitest-environment node
/**
 * Run logs after a coop game (TODO E38): the check that keeps junk out, the
 * store's one-log-per-player rule and pruning, and the way through the relay
 * with the status page's download.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { WebSocket } from 'ws';
import { RunStore, checkRunLog } from './run-store.ts';
import { startRelay, type RelayServer } from './server.ts';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '../../src/app/coop/protocol.ts';
import { reconcileWave } from '../../src/app/run-log/run-log-check.ts';

/** A wave record that adds up; `mismatches` as the game would write them */
function wave(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const record: Record<string, unknown> = {
    kind: 'wave', wave: 1, income: { kill: 10 }, spending: { build: 45 }, creditsStart: 100, creditsEnd: 65,
    killsByTower: 3, killsByHero: 0, killsByAbility: 0, killsByDebug: 0, killsByOther: 0,
    enemiesAtStart: 0, enemiesSpawned: 4, enemiesAlive: 0, leaked: 1, towers: [{ kills: 3 }], ...extra,
  };
  const found = reconcileWave(record as never);
  if (found.length > 0) record['mismatches'] = found;
  return record;
}

const head = { kind: 'head', format: 3, runId: 'r1', gameVersion: 'v0.5.0', coop: { players: ['Ann', 'Bob'], you: 'Ann' } };
const jsonl = (...records: unknown[]) => records.map((r) => JSON.stringify(r)).join('\n') + '\n';
const packed = (text: string) => gzipSync(Buffer.from(text)).toString('base64');

describe('checkRunLog', () => {
  it('takes a real log, a hole in its bookkeeping included, and nothing made up', () => {
    expect(checkRunLog(jsonl(head, wave()))).toBeNull();
    // The game found a hole and wrote it down: still a real run
    expect(checkRunLog(jsonl(head, wave({ creditsEnd: 999 })))).toBeNull();

    expect(checkRunLog('hello')).toBe('not JSONL');
    expect(checkRunLog(jsonl({ kind: 'head', format: 2, runId: 'r', gameVersion: 'v' }, wave()))).toMatch(/format/);
    expect(checkRunLog(jsonl(head))).toBe('no wave played');
    // Numbers changed by hand without the game's own note of the hole
    const forged: Record<string, unknown> = { ...wave(), creditsEnd: 999 };
    delete forged['mismatches'];
    expect(checkRunLog(jsonl(head, forged))).toMatch(/does not add up/);
  });
});

describe('RunStore', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('keeps one log per player and room, lists and reads it, and refuses paths outside', () => {
    dir = mkdtempSync(join(tmpdir(), 'runs-'));
    const store = new RunStore({ dir, maxBytes: 1e9, maxAgeMs: 1e12, now: () => Date.parse('2026-09-26T12:00:00Z') });
    const result = store.accept('ABC123', 'p1', 'Ann', packed(jsonl(head, wave())));
    expect(result).toEqual({ ok: true, path: 'coop/2026-09-26_ABC123/Ann_p1.jsonl.gz' });
    expect(store.accept('ABC123', 'p1', 'Ann', packed(jsonl(head, wave())))).toEqual({ ok: false, reason: 'already sent' });
    expect(store.accept('ABC123', 'p2', 'Bob', 'not base64 gzip')).toMatchObject({ ok: false });
    expect(store.list().map((r) => r.path)).toEqual(['coop/2026-09-26_ABC123/Ann_p1.jsonl.gz']);
    expect(store.read('coop/2026-09-26_ABC123/Ann_p1.jsonl.gz')?.length).toBeGreaterThan(0);
    expect(store.read('../../etc/passwd')).toBeNull();
  });

  it('lets the oldest go once the total is over the cap', () => {
    dir = mkdtempSync(join(tmpdir(), 'runs-'));
    const store = new RunStore({ dir, maxBytes: 1, maxAgeMs: 1e12, now: () => Date.now() });
    store.accept('ROOM1', 'p1', 'Ann', packed(jsonl(head, wave())));
    // Over the cap with a single file: nothing is left
    expect(store.list()).toEqual([]);
    expect(existsSync(join(dir, 'coop'))).toBe(true);
  });
});

describe('a run log through the relay', () => {
  let relay: RelayServer | null = null;
  let dir = '';
  afterEach(async () => {
    await relay?.close();
    relay = null;
    rmSync(dir, { recursive: true, force: true });
  });

  async function client(port: number, name: string) {
    const socket = await new Promise<WebSocket>((resolve, reject) => {
      const s = new WebSocket(`ws://localhost:${port}`);
      s.once('open', () => resolve(s));
      s.once('error', reject);
    });
    const heard: ServerMessage[] = [];
    const waiters: (() => void)[] = [];
    socket.on('message', (data) => {
      heard.push(JSON.parse(String(data)) as ServerMessage);
      for (const w of waiters.splice(0)) w();
    });
    const send = (message: ClientMessage) => socket.send(JSON.stringify(message));
    const until = async <T extends ServerMessage['t']>(t: T, where: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true) => {
      for (;;) {
        const found = heard.find((m) => m.t === t && where(m as Extract<ServerMessage, { t: T }>));
        if (found) return found as Extract<ServerMessage, { t: T }>;
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
    };
    send({ t: 'hello', protocol: PROTOCOL_VERSION, name, gameVersion: 'v1', configHash: 'h' });
    const welcome = await until('welcome');
    return { socket, send, until, heard, welcome };
  }

  it('says it collects, takes a player log after a game once, and hands it to the token', async () => {
    dir = mkdtempSync(join(tmpdir(), 'runs-'));
    relay = await startRelay({
      port: 0, log: () => undefined, adminToken: 'secret',
      collectRuns: { dir, maxBytes: 1e9, maxAgeMs: 1e12 },
    });
    const a = await client(relay.port, 'Ann');
    const b = await client(relay.port, 'Bob');
    expect(a.welcome.collectRuns).toBe(true);

    // Not in a game: nothing to keep
    a.send({ t: 'run-log', gz: packed(jsonl(head, wave())) });
    expect(await a.until('run-log')).toMatchObject({ ok: false });

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

    b.send({ t: 'run-log', gz: packed(jsonl(head, wave())) });
    expect(await b.until('run-log')).toEqual({ t: 'run-log', ok: true });
    b.send({ t: 'run-log', gz: packed(jsonl(head, wave())) });
    expect(await b.until('run-log', (m) => !m.ok)).toMatchObject({ reason: 'already sent' });

    const base = `http://localhost:${relay.port}`;
    expect((await fetch(`${base}/admin/runs`)).status).toBe(403);
    const list = (await (await fetch(`${base}/admin/runs`, { headers: { 'x-admin-token': 'secret' } })).json()) as { path: string }[];
    expect(list).toHaveLength(1);
    expect(list[0].path).toContain(code);
    const file = await fetch(`${base}/admin/runs/file?path=${encodeURIComponent(list[0].path)}`, { headers: { 'x-admin-token': 'secret' } });
    expect(file.status).toBe(200);
    expect((await file.arrayBuffer()).byteLength).toBeGreaterThan(0);
    a.socket.close();
    b.socket.close();
  });

  it('does not say it collects when it does not', async () => {
    relay = await startRelay({ port: 0, log: () => undefined });
    const a = await client(relay.port, 'Ann');
    expect(a.welcome.collectRuns).toBeUndefined();
    a.socket.close();
  });
});
