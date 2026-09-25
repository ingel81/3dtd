// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { startRelay, type RelayServer, type RelayStatus } from './server.ts';
import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '../../src/app/coop/protocol.ts';

/** A client on a real socket that keeps what it heard. */
async function client(port: number, name: string) {
  const socket = new WebSocket(`ws://localhost:${port}`);
  const heard: ServerMessage[] = [];
  const waiters: (() => void)[] = [];
  socket.on('message', (data) => {
    heard.push(JSON.parse(String(data)) as ServerMessage);
    for (const w of waiters.splice(0)) w();
  });
  await new Promise<void>((resolve) => socket.on('open', () => resolve()));
  const send = (message: ClientMessage) => socket.send(JSON.stringify(message));
  const until = async <T extends ServerMessage['t']>(t: T, where: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true) => {
    for (;;) {
      const found = heard.find((m) => m.t === t && where(m as Extract<ServerMessage, { t: T }>));
      if (found) return found as Extract<ServerMessage, { t: T }>;
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };
  send({ t: 'hello', protocol: PROTOCOL_VERSION, name, gameVersion: 'v1', configHash: 'h' });
  const { playerId } = await until('welcome');
  return { socket, heard, send, until, playerId, close: () => socket.close() };
}

describe('coop relay over sockets (COOP_PLAN C4)', () => {
  let relay: RelayServer | null = null;
  afterEach(async () => {
    await relay?.close();
    relay = null;
  });

  it('refuses a taken port instead of crashing, and tells a lobby from its status (C4d)', async () => {
    relay = await startRelay({ port: 0 });
    await expect(startRelay({ port: relay.port })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    const a = await client(relay.port, 'Ann');
    a.send({ t: 'create' });
    await a.until('room');
    expect(relay.status().rooms[0]).toMatchObject({ gameVersion: 'v1', started: false, locked: false });
    a.close();
  });

  it('runs a room from create to ticks for two clients', async () => {
    relay = await startRelay({ port: 0 });
    const a = await client(relay.port, 'Ann');
    const b = await client(relay.port, 'Bob');

    a.send({ t: 'create' });
    const { room } = await a.until('room');
    b.send({ t: 'join', room: room.code.toLowerCase() });
    await b.until('room', (m) => m.room.players.length === 2);

    a.send({ t: 'world', world: { spawns: 2 }, spawnIds: ['s1', 's2'] });
    expect((await b.until('world')).world).toEqual({ spawns: 2 });
    a.send({ t: 'pick', spawnId: 's1' });
    b.send({ t: 'pick', spawnId: 's2' });
    a.send({ t: 'ready', ready: true });
    b.send({ t: 'ready', ready: true });
    await a.until('room', (m) => m.room.players.every((p) => p.ready));
    a.send({ t: 'start', seed: 42 });
    const started = await b.until('started');
    expect(started.players).toEqual([a.playerId, b.playerId]);

    b.send({ t: 'cmd', command: { type: 'command:place-tower' } });
    const withCommand = await a.until('tick', (m) => m.commands.length > 0);
    expect(withCommand.commands[0]).toMatchObject({ playerId: b.playerId, command: { type: 'command:place-tower' } });
    const same = await b.until('tick', (m) => m.tick === withCommand.tick);
    expect(same).toEqual(withCommand);

    a.close();
    expect((await b.until('host')).hostId).toBe(b.playerId);
    const leave = await b.until('tick', (m) => m.commands.some((c) => c.command.type === 'command:leave-game'));
    expect(leave.commands.find((c) => c.command.type === 'command:leave-game')!.playerId).toBe(a.playerId);
    b.close();
  });

  it('reports a desync to both, logs with the room code and shows the room on the status page (C5)', async () => {
    const lines: string[] = [];
    relay = await startRelay({ port: 0, log: (line) => lines.push(line) });
    const a = await client(relay.port, 'Ann');
    const b = await client(relay.port, 'Bob');
    a.send({ t: 'create' });
    const { room } = await a.until('room');
    b.send({ t: 'join', room: room.code });
    await b.until('room', (m) => m.room.players.length === 2);
    a.send({ t: 'world', world: {}, spawnIds: ['s1', 's2'] });
    a.send({ t: 'pick', spawnId: 's1' });
    b.send({ t: 'pick', spawnId: 's2' });
    a.send({ t: 'ready', ready: true });
    b.send({ t: 'ready', ready: true });
    await a.until('room', (m) => m.room.players.every((p) => p.ready));
    a.send({ t: 'start', seed: 42 });
    await b.until('started');

    a.send({ t: 'hash', tick: 15, hash: 0xabc });
    b.send({ t: 'hash', tick: 15, hash: 0xdef });
    const desync = await a.until('desync');
    expect(desync).toEqual({ t: 'desync', tick: 15, hashes: [[a.playerId, 0xabc], [b.playerId, 0xdef]] });
    await b.until('desync');

    const status = await (await fetch(`http://localhost:${relay.port}/status`)).json() as RelayStatus;
    expect(status.rooms).toHaveLength(1);
    expect(status.rooms[0]).toMatchObject({ code: room.code, started: true, firstDesync: 15, desyncs: 1 });
    expect(status.rooms[0].players.map((p) => p.name)).toEqual(['Ann', 'Bob']);
    const text = await (await fetch(`http://localhost:${relay.port}/`)).text();
    expect(text).toContain(`${room.code}  in game`);
    expect(text).toContain('DESYNC since tick 15');

    expect(lines.some((l) => l.startsWith(`[${room.code}] opened by Ann`))).toBe(true);
    expect(lines.some((l) => l.startsWith(`[${room.code}] DESYNC at tick 15`))).toBe(true);
    a.close();
    await b.until('left');
    b.close();
  });

  it('drops what a client sends beyond the rate limit (R17)', async () => {
    const lines: string[] = [];
    relay = await startRelay({ port: 0, log: (line) => lines.push(line) });
    const a = await client(relay.port, 'Ann');
    a.send({ t: 'create' });
    const { room } = await a.until('room');
    // 300 chat lines at once: the relay passes some and drops the rest
    for (let i = 0; i < 300; i++) a.send({ t: 'chat', text: `line ${i}` });
    await a.until('chat', (m) => m.text === 'line 100');
    await new Promise((resolve) => setTimeout(resolve, 100));
    const chats = a.heard.filter((m) => m.t === 'chat').length;
    expect(chats).toBeLessThan(300);
    expect(lines.some((l) => l.startsWith(`[${room.code}]`) && l.includes('sends too fast'))).toBe(true);
    a.close();
  });

  it('refuses a room beyond the cap and closes a lobby open too long (R18)', async () => {
    relay = await startRelay({ port: 0, maxRooms: 1, lobbyMaxMs: 50, heartbeatMs: 30 });
    const a = await client(relay.port, 'Ann');
    const b = await client(relay.port, 'Bob');
    a.send({ t: 'create' });
    await a.until('room');
    b.send({ t: 'create' });
    expect((await b.until('refused')).reason).toBe('busy');
    // Never started: after lobbyMaxMs the next heartbeat lets Ann go
    await new Promise<void>((resolve) => a.socket.on('close', () => resolve()));
    const status = await (await fetch(`http://localhost:${relay.port}/status`)).json() as RelayStatus;
    expect(status.rooms).toEqual([]);
  });

  it('refuses a client of another protocol and a room that is not there', async () => {
    relay = await startRelay({ port: 0 });
    const socket = new WebSocket(`ws://localhost:${relay.port}`);
    await new Promise<void>((resolve) => socket.on('open', () => resolve()));
    const reply = new Promise<ServerMessage>((resolve) => socket.once('message', (d) => resolve(JSON.parse(String(d)))));
    socket.send(JSON.stringify({ t: 'hello', protocol: PROTOCOL_VERSION + 1, name: 'x', gameVersion: 'v1', configHash: 'h' }));
    expect(await reply).toEqual({ t: 'refused', reason: 'protocol' });
    socket.close();

    const c = await client(relay.port, 'C');
    c.send({ t: 'join', room: 'NOPE42' });
    expect((await c.until('refused')).reason).toBe('no-room');
    c.close();
  });
});
