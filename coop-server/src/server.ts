/**
 * The coop relay (docs/COOP_PLAN.md, C4, D2): WebSocket connections, rooms,
 * and the clock that closes their ticks. The rules of a room live in
 * room.ts; this file only connects sockets and time to them.
 *
 * Started by main.ts (npm run coop-server) on a machine of its own, or from
 * the desktop app's main process for a LAN game (D18).
 *
 * Diagnosis (C5): every room event goes to `log` with the room code in
 * front, a running room adds a status line every STATUS_MS (tick, commands
 * a second, players with their ping, last hashes), and GET /status answers
 * with the rooms as JSON; GET / with the same as text.
 */
import { createServer, type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '../../src/app/coop/protocol.ts';
import { PROTOCOL_VERSION } from '../../src/app/coop/protocol.ts';
import { Room, hex, type RoomPlayer, type RoomStatus } from './room.ts';
import { clientLabel, type ClientInfo } from '../../src/app/coop/client-info.ts';

/** How often the rooms' clocks run, ms. Ticks close at the room's pace, this only samples the wall clock. */
const CLOCK_MS = 5;

/**
 * Heartbeat, ms: every client gets a ping this often and is dropped when it
 * did not answer the last one. A browser that leaves a page may close its
 * socket late; without this the room kept the player for a minute or more.
 */
const HEARTBEAT_MS = 3000;

/** A running room writes a status line this often, ms */
const STATUS_MS = 10_000;

/** A lobby not started after this long closes, its players are let go (review R18) */
export const LOBBY_MAX_MS = 60 * 60 * 1000;
/** Rooms at most at once; a create beyond is refused as busy (review R18) */
export const MAX_ROOMS = 200;

/** Largest message the relay takes, bytes: a world package is some 300 kB (review R17) */
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

/**
 * Messages a connection may send in one second; more are dropped (R17). A
 * player sends an aim at most once a tick (15 a second) plus a few commands.
 */
const MAX_MESSAGES_PER_SECOND = 120;

/** Room codes: no 0/O, 1/I/L, easy to read out */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

interface Connection {
  socket: WebSocket;
  player: RoomPlayer | null;
  room: Room | null;
  /** Answered the last heartbeat */
  alive: boolean;
  /** When the last heartbeat went out, ms */
  pingAt: number;
  /** Round trip of the last heartbeat, ms; null before the first answer */
  rtt: number | null;
  /** Why the relay dropped it, where it did */
  dropReason: string | null;
  /** Messages in the current second, and when that second began */
  burst: number;
  burstAt: number;
  /** The rate limit was hit in this second and logged */
  throttled: boolean;
}

/** What GET /status answers. */
export interface RelayStatus {
  protocol: number;
  uptimeS: number;
  connections: number;
  rooms: (RoomStatus & { players: (RoomStatus['players'][number] & { rttMs: number | null })[] })[];
}

export interface RelayServer {
  readonly port: number;
  /** What GET /status answers, for the desktop app's LAN announcement */
  status(): RelayStatus;
  close(): Promise<void>;
}

export interface RelayOptions {
  port: number;
  /** Where the relay writes one line per event; silent by default */
  log?: (line: string) => void;
  /** Wall clock, ms; for the spec */
  now?: () => number;
  /** How often a running room writes its status line, ms; STATUS_MS by default */
  statusEveryMs?: number;
  /** Rooms let the dev tools' cheats through (RoomOptions.cheats); off by default */
  cheats?: boolean;
  /** LOBBY_MAX_MS and MAX_ROOMS by default; for the spec */
  lobbyMaxMs?: number;
  maxRooms?: number;
  /** HEARTBEAT_MS by default; for the spec */
  heartbeatMs?: number;
  /**
   * The pages allowed to connect, by their `Origin` (review R19), e.g.
   * `https://example.com` and `app://app` for the desktop app. A browser on
   * another site is refused; clients without an Origin (not a browser) pass.
   * Unset, everyone may: the dev machine and the LAN.
   */
  origins?: readonly string[];
}

/** Start the relay on `port` (0: any free port); rejects when the port is taken. */
export function startRelay(options: RelayOptions): Promise<RelayServer> {
  const log = options.log ?? (() => undefined);
  const now = options.now ?? (() => performance.now());
  const rooms = new Map<string, Room>();
  const connections = new Map<string, Connection>();
  let nextPlayer = 1;
  const startedAt = now();

  const status = (): RelayStatus => ({
    protocol: PROTOCOL_VERSION,
    uptimeS: Math.round((now() - startedAt) / 1000),
    connections: connections.size,
    rooms: [...rooms.values()].map((room) => {
      const s = room.status();
      return { ...s, players: s.players.map((p) => ({ ...p, rttMs: rttOf(p.id) })) };
    }),
  });
  const rttOf = (playerId: string): number | null => {
    const rtt = connections.get(playerId)?.rtt;
    return rtt === undefined || rtt === null ? null : Math.round(rtt);
  };

  const http: Server = createServer((request, response) => {
    if (request.url?.startsWith('/status')) {
      response.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      response.end(JSON.stringify(status(), null, 2));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(statusText(status()));
  });
  const origins = options.origins?.length ? new Set(options.origins.map((o) => o.replace(/\/$/, ''))) : null;
  const wss = new WebSocketServer({
    server: http,
    maxPayload: MAX_MESSAGE_BYTES,
    // Another site's page must not use its visitors' browsers on this relay (R19)
    verifyClient: origins
      ? ({ origin }: { origin?: string }) => {
        if (!origin || origins.has(origin)) return true;
        log(`refused a connection from ${origin.slice(0, 100)}`);
        return false;
      }
      : undefined,
  });
  // ws repeats the HTTP server's errors; a taken port is handled at listen below
  wss.on('error', () => undefined);

  const send = (playerId: string, message: ServerMessage): void => {
    const socket = connections.get(playerId)?.socket;
    if (socket && socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  };

  const newCode = (): string => {
    for (;;) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!rooms.has(code)) return code;
    }
  };

  wss.on('connection', (socket) => {
    const id = `p${nextPlayer++}`;
    const connection: Connection = {
      socket, player: null, room: null, alive: true, pingAt: 0, rtt: null, dropReason: null,
      burst: 0, burstAt: now(), throttled: false,
    };
    connections.set(id, connection);
    socket.on('pong', () => {
      connection.alive = true;
      connection.rtt = now() - connection.pingAt;
    });

    socket.on('message', (data) => {
      const at = now();
      if (at - connection.burstAt >= 1000) {
        connection.burst = 0;
        connection.burstAt = at;
        connection.throttled = false;
      }
      if (++connection.burst > MAX_MESSAGES_PER_SECOND) {
        if (!connection.throttled) log(`${connection.room ? `[${connection.room.code}] ` : ''}${id} sends too fast, dropping`);
        connection.throttled = true;
        return;
      }
      let message: ClientMessage;
      try {
        message = JSON.parse(String(data)) as ClientMessage;
      } catch {
        return;
      }
      if (message.t === 'hello') {
        if (message.protocol !== PROTOCOL_VERSION) {
          send(id, { t: 'refused', reason: 'protocol' });
          return;
        }
        connection.player = {
          id,
          name: String(message.name).slice(0, 32) || id,
          gameVersion: message.gameVersion,
          configHash: message.configHash,
          client: validClient(message.client),
        };
        send(id, { t: 'welcome', playerId: id });
        return;
      }
      const player = connection.player;
      if (!player) return;
      if (message.t === 'create') {
        if (connection.room) return;
        if (rooms.size >= (options.maxRooms ?? MAX_ROOMS)) {
          send(id, { t: 'refused', reason: 'busy' });
          return;
        }
        const code = newCode();
        const room = new Room(code, player, send, { log: (line) => log(`[${code}] ${line}`), now, cheats: options.cheats });
        rooms.set(room.code, room);
        connection.room = room;
        return;
      }
      if (message.t === 'join') {
        if (connection.room) return;
        const room = rooms.get(String(message.room).toUpperCase());
        if (!room) {
          send(id, { t: 'refused', reason: 'no-room' });
          return;
        }
        const refusal = room.join(player);
        if (refusal) {
          send(id, { t: 'refused', reason: refusal });
          return;
        }
        connection.room = room;
        return;
      }
      connection.room?.receive(id, message);
    });

    socket.on('close', () => {
      const room = connection.room;
      connections.delete(id);
      if (!room) return;
      room.leave(id, connection.dropReason ?? 'closed');
      if (room.isEmpty) {
        rooms.delete(room.code);
        const s = room.status();
        log(`[${room.code}] closed after ${Math.round(s.ageMs / 1000)} s, tick ${s.tick}, ${s.commands} commands, ${s.desyncs} desyncs`);
      }
    });
  });

  const heartbeat = setInterval(() => {
    // The round trips the last heartbeat measured, to each room
    for (const room of rooms.values()) room.sendRtt(rttOf);
    // A lobby open too long without a start closes: its players' sockets go
    for (const room of rooms.values()) {
      if (room.isStarted || room.status().ageMs < (options.lobbyMaxMs ?? LOBBY_MAX_MS)) continue;
      log(`[${room.code}] lobby open too long, closing it`);
      for (const connection of connections.values()) {
        if (connection.room !== room) continue;
        connection.dropReason = 'lobby open too long';
        connection.socket.close();
      }
    }
    for (const connection of connections.values()) {
      if (!connection.alive) {
        connection.dropReason = `no heartbeat for ${HEARTBEAT_MS / 1000} s`;
        connection.socket.terminate();
        continue;
      }
      connection.alive = false;
      connection.pingAt = now();
      connection.socket.ping();
    }
  }, options.heartbeatMs ?? HEARTBEAT_MS);

  // Per running room: commands at the last status line, for commands a second
  const commandsAtLine = new Map<string, number>();
  const statusEvery = options.statusEveryMs ?? STATUS_MS;
  const statusLines = setInterval(() => {
    for (const room of rooms.values()) {
      if (!room.isStarted) continue;
      const s = room.status();
      const perSecond = (s.commands - (commandsAtLine.get(s.code) ?? 0)) / (statusEvery / 1000);
      commandsAtLine.set(s.code, s.commands);
      const players = s.players.map((p) => {
        const rtt = rttOf(p.id);
        const hash = p.lastHash ? ` ${hex(p.lastHash.hash)}@${p.lastHash.tick}` : '';
        return `${room.who(p.id)} ${rtt === null ? '?' : rtt} ms${hash}`;
      });
      log(`[${s.code}] tick ${s.tick}, speed ${s.speed}, ${perSecond.toFixed(1)} cmd/s, ${players.join(', ')}; desyncs ${s.desyncs}`);
    }
    for (const code of commandsAtLine.keys()) if (!rooms.has(code)) commandsAtLine.delete(code);
  }, statusEvery);

  let last = now();
  const clock = setInterval(() => {
    const at = now();
    const elapsed = at - last;
    last = at;
    for (const room of rooms.values()) room.advance(elapsed);
  }, CLOCK_MS);

  return new Promise((resolve, reject) => {
    http.once('error', (error) => {
      clearInterval(clock);
      clearInterval(heartbeat);
      clearInterval(statusLines);
      reject(error);
    });
    http.listen(options.port, () => {
      const address = http.address();
      const port = typeof address === 'object' && address ? address.port : options.port;
      log(`coop relay on port ${port}`);
      resolve({
        port,
        status,
        close: () => new Promise<void>((done) => {
          clearInterval(clock);
          clearInterval(heartbeat);
          clearInterval(statusLines);
          for (const { socket } of connections.values()) socket.terminate();
          wss.close(() => http.close(() => done()));
        }),
      });
    });
  });
}

/** The status page as text: one block per room. */
export function statusText(status: RelayStatus): string {
  const lines = [
    `3dtd coop relay, protocol ${status.protocol}, up ${status.uptimeS} s, ${status.connections} connections, ${status.rooms.length} rooms`,
  ];
  for (const room of status.rooms) {
    const state = room.started ? `in game, tick ${room.tick}, speed ${room.speed}` : 'lobby';
    const desync = room.firstDesync === null ? 'in step' : `DESYNC since tick ${room.firstDesync} (${room.desyncs})`;
    lines.push('', `${room.code}  ${state}, ${Math.round(room.ageMs / 1000)} s old, ${room.commands} commands, ${desync}`);
    for (const p of room.players) {
      const host = p.id === room.hostId ? ' host' : '';
      const lane = p.spawnId ?? 'no lane';
      const ready = room.started ? '' : p.ready ? ', ready' : ', not ready';
      const rtt = p.rttMs === null ? '?' : `${p.rttMs}`;
      const hash = p.lastHash ? `, hash ${hex(p.lastHash.hash)} at tick ${p.lastHash.tick}` : '';
      const client = p.client ? `, ${clientLabel(p.client)}` : '';
      lines.push(`  ${p.name} (${p.id}${host}), ${lane}${ready}, ping ${rtt} ms${hash}${client}`);
    }
  }
  return lines.join('\n') + '\n';
}

const FAMILIES = new Set(['blink', 'gecko', 'webkit', 'other']);

/** The client info a hello carried, as far as it has the right shape and length; null otherwise. */
function validClient(value: unknown): ClientInfo | null {
  if (typeof value !== 'object' || value === null) return null;
  const { engine, version, family, os } = value as Record<string, unknown>;
  if (typeof engine !== 'string' || typeof version !== 'string' || typeof os !== 'string') return null;
  if (typeof family !== 'string' || !FAMILIES.has(family)) return null;
  return { engine: engine.slice(0, 32), version: version.slice(0, 48), family: family as ClientInfo['family'], os: os.slice(0, 32) };
}
