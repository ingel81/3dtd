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
 * a second, players with their ping, last hashes), a metrics line every
 * minute. The status page (status-page.ts) shows the same live: GET / as a
 * page, /status and /metrics.json as JSON, /text as text; /healthz answers
 * "ok" for Docker's health check.
 *
 * Hardening (relay review 2026-09-26): every message is checked
 * (validate.ts) and handled inside a try/catch, one bad message never takes
 * the process down; connections are bounded in number, per address and in
 * what they may leave unread; a hello is due within HELLO_TIMEOUT_MS.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ServerMessage } from '../../src/app/coop/protocol.ts';
import { PROTOCOL_VERSION } from '../../src/app/coop/protocol.ts';
import { Room, hex, type RoomPlayer, type RoomStatus } from './room.ts';
import { clientLabel, type ClientInfo } from '../../src/app/coop/client-info.ts';
import { parseClientMessage } from './validate.ts';
import { RelayMetrics, SAMPLE_MS, type DropReason, type MetricsSample } from './metrics.ts';
import { statusPage } from './status-page.ts';

/** How often the rooms' clocks run, ms. Ticks close at the room's pace, this only samples the wall clock. */
const CLOCK_MS = 5;

/**
 * Heartbeat, ms: every client gets a ping this often and is dropped after
 * MISSED_HEARTBEATS unanswered ones in a row, some 15 s (review M5): a
 * switch of the WLAN access point or a long GC pause must not end the game.
 */
const HEARTBEAT_MS = 5000;
const MISSED_HEARTBEATS = 3;

/** A running room writes a status line this often, ms */
const STATUS_MS = 10_000;
/** The metrics line goes to the log this often, ms */
const METRICS_LINE_MS = 60_000;

/** A lobby not started after this long closes, its players are let go (review R18) */
export const LOBBY_MAX_MS = 60 * 60 * 1000;
/** A game without a command this long closes: a forgotten, paused game (review N4) */
export const GAME_IDLE_MAX_MS = 3 * 60 * 60 * 1000;
/** Rooms at most at once; a create beyond is refused as busy (review R18) */
export const MAX_ROOMS = 200;

/** Connections at most at once, and from one address (review H3); the address is counted in memory, never logged */
export const MAX_CONNECTIONS = 500;
export const MAX_PER_ADDRESS = 8;
/** A connection says hello within this, or is closed (review H3) */
export const HELLO_TIMEOUT_MS = 10_000;

/** Largest message the relay takes, bytes: a world package is some 300 kB (review R17, H3) */
const MAX_MESSAGE_BYTES = 1024 * 1024;

/** A client that leaves more than this unread is dropped: it would hold the relay's memory (review H2) */
const MAX_UNREAD_BYTES = 8 * 1024 * 1024;

/**
 * Messages a connection may send in one second; more are dropped (R17). A
 * player sends an aim at most once a tick (15 a second) plus a few commands.
 */
const MAX_MESSAGES_PER_SECOND = 120;

/** Room codes a connection may try that do not exist before it is closed (review N3) */
const MAX_JOIN_MISSES = 20;

/** Log lines the status page shows */
const LOG_LINES_KEPT = 200;

/** Close code for a relay that stops: 1012 "service restart" (review M6) */
export const CLOSE_RESTART = 1012;

/** Room codes: no 0/O, 1/I/L, easy to read out */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

interface Connection {
  socket: WebSocket;
  /** Where it comes from, for the per-address limit only; never logged */
  address: string;
  player: RoomPlayer | null;
  room: Room | null;
  /** Heartbeats not answered in a row */
  missed: number;
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
  /** Room codes tried that did not exist */
  joinMisses: number;
  helloTimer: ReturnType<typeof setTimeout> | null;
}

/** What GET /status answers. */
export interface RelayStatus {
  /** Which build runs: "0.5.0 (a1b2c3d4)", "coop (a1b2c3d4)", "dev" */
  build: string;
  protocol: number;
  uptimeS: number;
  connections: number;
  rooms: (RoomStatus & { players: (RoomStatus['players'][number] & { rttMs: number | null })[] })[];
}

/** What GET /metrics.json answers. */
export interface RelayMetricsView {
  uptimeS: number;
  rssMb: number;
  connections: number;
  lobbies: number;
  games: number;
  bytesIn: number;
  bytesOut: number;
  messagesIn: number;
  connectionsOpened: number;
  errors: number;
  dropped: Record<string, number>;
  refused: Record<string, number>;
  samples: MetricsSample[];
  /** The page may show its actions: the relay was started with an admin token */
  actions: boolean;
}

export interface RelayServer {
  readonly port: number;
  /** What GET /status answers, for the desktop app's LAN announcement */
  status(): RelayStatus;
  /** Close every connection (with `reason`, as a restart where given) and stop. */
  close(reason?: string): Promise<void>;
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
  /** LOBBY_MAX_MS, GAME_IDLE_MAX_MS, MAX_ROOMS, MAX_CONNECTIONS, MAX_PER_ADDRESS, HELLO_TIMEOUT_MS by default; for the spec */
  lobbyMaxMs?: number;
  gameIdleMaxMs?: number;
  maxRooms?: number;
  maxConnections?: number;
  maxPerAddress?: number;
  helloTimeoutMs?: number;
  /** HEARTBEAT_MS and MAX_MESSAGES_PER_SECOND by default; for the spec */
  heartbeatMs?: number;
  maxMessagesPerSecond?: number;
  /**
   * The pages allowed to connect, by their `Origin` (review R19), e.g.
   * `https://example.com` and `app://app` for the desktop app. A browser on
   * another site is refused; clients without an Origin (not a browser) pass.
   * Unset, everyone may: the dev machine and the LAN.
   */
  origins?: readonly string[];
  /**
   * Who may read the status page: 'all' (default; the desktop app's LAN
   * probe reads it), or 'local', only requests from this machine or the
   * local network that did not come through a Cloudflare tunnel (D66).
   * /healthz answers everyone.
   */
  statusAccess?: 'all' | 'local';
  /** Lets the status page close rooms and drop players with this token; no actions without it */
  adminToken?: string;
  /** Which build this is, for the log and the status page; 'dev' by default */
  build?: string;
}

/** Start the relay on `port` (0: any free port); rejects when the port is taken. */
export function startRelay(options: RelayOptions): Promise<RelayServer> {
  const recentLines: string[] = [];
  const log = (line: string): void => {
    recentLines.push(line);
    if (recentLines.length > LOG_LINES_KEPT) recentLines.shift();
    options.log?.(line);
  };
  const now = options.now ?? (() => performance.now());
  const rooms = new Map<string, Room>();
  const connections = new Map<string, Connection>();
  /** Open connections per address, in memory only (review H3, D64) */
  const perAddress = new Map<string, number>();
  const metrics = new RelayMetrics();
  let nextPlayer = 1;
  let closing = false;
  const startedAt = now();

  const counts = () => {
    let games = 0;
    for (const room of rooms.values()) if (room.isStarted) games++;
    return { connections: connections.size, lobbies: rooms.size - games, games };
  };
  const status = (): RelayStatus => ({
    build: options.build ?? 'dev',
    protocol: PROTOCOL_VERSION,
    uptimeS: Math.round((now() - startedAt) / 1000),
    connections: connections.size,
    rooms: [...rooms.values()].map((room) => {
      const s = room.status();
      return { ...s, players: s.players.map((p) => ({ ...p, rttMs: rttOf(p.id) })) };
    }),
  });
  const metricsView = (): RelayMetricsView => ({
    uptimeS: Math.round((now() - startedAt) / 1000),
    rssMb: Math.round(process.memoryUsage().rss / 2 ** 20),
    ...counts(),
    bytesIn: metrics.bytesIn,
    bytesOut: metrics.bytesOut,
    messagesIn: metrics.messagesIn,
    connectionsOpened: metrics.connectionsOpened,
    errors: metrics.errors,
    dropped: { ...metrics.dropped },
    refused: { ...metrics.refused },
    samples: metrics.samples,
    actions: !!options.adminToken,
  });
  const rttOf = (playerId: string): number | null => {
    const rtt = connections.get(playerId)?.rtt;
    return rtt === undefined || rtt === null ? null : Math.round(rtt);
  };

  /** Close a connection for `reason`; its close handler takes it out of its room. */
  const dropConnection = (playerId: string, reason: string, why: DropReason): void => {
    const connection = connections.get(playerId);
    // Once: messages already read may still come in after the first drop
    if (!connection || connection.dropReason !== null) return;
    connection.dropReason = reason;
    metrics.drop(why);
    connection.socket.terminate();
  };

  const http: Server = createServer((request, response) => {
    try {
      handleHttp(request, response);
    } catch (error) {
      metrics.errors++;
      log(`status page failed: ${String((error as Error)?.message ?? error).slice(0, 200)}`);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    }
  });
  const handleHttp = (request: IncomingMessage, response: ServerResponse): void => {
    const path = (request.url ?? '/').split('?')[0];
    // The health check answers everyone: it says nothing but that the relay runs (review idea 2)
    if (path === '/healthz') {
      response.writeHead(closing ? 503 : 200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(closing ? 'stopping\n' : 'ok\n');
      return;
    }
    if (options.statusAccess === 'local' && !isLocalRequest(request.socket.remoteAddress, request.headers)) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('not here\n');
      return;
    }
    if (request.method === 'POST' && path.startsWith('/admin/')) return admin(request, response, path);
    const json = (body: unknown) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body, null, 2));
    };
    if (path === '/status') return json(status());
    if (path === '/metrics.json') return json(metricsView());
    if (path === '/log.json') return json(recentLines);
    if (path === '/text') {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(statusText(status()));
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      // Only its own inline script and requests to this relay
      'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
    });
    response.end(statusPage());
  };

  /**
   * The status page's actions, with the admin token in `x-admin-token`: a
   * header another site's page cannot set without a preflight this relay
   * never answers. POST /admin/close-room {code}, /admin/drop-player {id}.
   */
  const admin = (request: IncomingMessage, response: ServerResponse, path: string): void => {
    const answer = (code: number, text: string) => {
      response.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(`${text}\n`);
    };
    if (!options.adminToken || request.headers['x-admin-token'] !== options.adminToken) return answer(403, 'no');
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > 1024) request.destroy();
    });
    request.on('end', () => {
      let target: Record<string, unknown>;
      try {
        target = JSON.parse(body) as Record<string, unknown>;
      } catch {
        return answer(400, 'bad body');
      }
      if (path === '/admin/close-room') {
        const room = rooms.get(String(target['code']));
        if (!room) return answer(404, 'no such room');
        log(`[${room.code}] closed from the status page`);
        for (const [id, connection] of connections) {
          if (connection.room === room) dropConnection(id, 'room closed by the relay', 'kicked');
        }
        return answer(200, 'closed');
      }
      if (path === '/admin/drop-player') {
        const id = String(target['id']);
        if (!connections.has(id)) return answer(404, 'no such player');
        log(`${id} dropped from the status page`);
        dropConnection(id, 'dropped by the relay', 'kicked');
        return answer(200, 'dropped');
      }
      answer(404, 'no such action');
    });
  };

  const origins = options.origins?.length ? new Set(options.origins.map((o) => o.replace(/\/$/, ''))) : null;
  /** Refusals of the same kind are logged at most once in REFUSAL_LOG_MS, with how many came (review M1) */
  const refusalLog = new Map<string, { at: number; count: number }>();
  const logRefusal = (kind: string, line: string): void => {
    const entry = refusalLog.get(kind);
    if (entry && now() - entry.at < 10_000) {
      entry.count++;
      return;
    }
    log(entry && entry.count > 0 ? `${line} (and ${entry.count} more like it)` : line);
    refusalLog.set(kind, { at: now(), count: 0 });
  };
  const wss = new WebSocketServer({
    server: http,
    maxPayload: MAX_MESSAGE_BYTES,
    verifyClient: ({ origin, req }: { origin?: string; req: IncomingMessage }) => {
      // Another site's page must not use its visitors' browsers on this relay (R19)
      if (origins && origin && !origins.has(origin)) {
        metrics.refused.origin++;
        logRefusal('origin', `refused a connection from ${origin.slice(0, 100)}`);
        return false;
      }
      if (closing || connections.size >= (options.maxConnections ?? MAX_CONNECTIONS)) {
        metrics.refused.full++;
        logRefusal('full', 'refused a connection: relay full');
        return false;
      }
      if ((perAddress.get(addressOf(req)) ?? 0) >= (options.maxPerAddress ?? MAX_PER_ADDRESS)) {
        metrics.refused['per-address']++;
        logRefusal('per-address', 'refused a connection: too many from one address');
        return false;
      }
      return true;
    },
  });
  // ws repeats the HTTP server's errors; a taken port is handled at listen below
  wss.on('error', () => undefined);

  /** The JSON of a message, once for every player a broadcast sends it to (review H2) */
  const serialized = new WeakMap<ServerMessage, string>();
  const send = (playerId: string, message: ServerMessage): void => {
    const connection = connections.get(playerId);
    const socket = connection?.socket;
    if (!connection || !socket || socket.readyState !== socket.OPEN) return;
    // A client that does not read would hold the relay's memory (review H2)
    if (socket.bufferedAmount > MAX_UNREAD_BYTES) {
      if (connection.dropReason === null) {
        log(`${connection.room ? `[${connection.room.code}] ` : ''}${playerId} reads too slowly, dropping`);
        dropConnection(playerId, 'reads too slowly', 'slow');
      }
      return;
    }
    let text = serialized.get(message);
    if (text === undefined) {
      text = JSON.stringify(message);
      serialized.set(message, text);
    }
    metrics.bytesOut += text.length;
    socket.send(text);
  };

  const newCode = (): string => {
    for (;;) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!rooms.has(code)) return code;
    }
  };

  /** The room of a connection is gone for this player (left, taken out, let go) */
  const removedFromRoom = (playerId: string): void => {
    const connection = connections.get(playerId);
    if (connection) connection.room = null;
  };

  const handleMessage = (id: string, connection: Connection, data: unknown): void => {
    let raw: unknown;
    try {
      raw = JSON.parse(String(data));
    } catch {
      metrics.drop('malformed');
      return;
    }
    const message = parseClientMessage(raw);
    if (!message) {
      metrics.drop('malformed');
      return;
    }
    if (message.t === 'hello') {
      if (message.protocol !== PROTOCOL_VERSION) {
        send(id, { t: 'refused', reason: 'protocol' });
        return;
      }
      if (connection.helloTimer) clearTimeout(connection.helloTimer);
      connection.helloTimer = null;
      connection.player = {
        id,
        name: message.name || id,
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
      if (connection.room || closing) return;
      if (rooms.size >= (options.maxRooms ?? MAX_ROOMS)) {
        send(id, { t: 'refused', reason: 'busy' });
        return;
      }
      const code = newCode();
      const room = new Room(code, player, send, {
        log: (line) => log(`[${code}] ${line}`),
        now,
        cheats: options.cheats,
        drop: (playerId, reason) => dropConnection(playerId, reason, 'hanging'),
        removed: removedFromRoom,
      });
      rooms.set(room.code, room);
      connection.room = room;
      return;
    }
    // The public list (D62): open to anyone said hello, in a room or not
    if (message.t === 'rooms') {
      const list = [...rooms.values()].flatMap((room) => room.publicEntry() ?? []);
      send(id, { t: 'rooms', rooms: list });
      return;
    }
    if (message.t === 'join') {
      if (connection.room) return;
      const room = rooms.get(message.room.toUpperCase());
      if (!room) {
        send(id, { t: 'refused', reason: 'no-room' });
        // Guessing private codes (review N3)
        if (++connection.joinMisses >= MAX_JOIN_MISSES) {
          log(`${id} tried ${MAX_JOIN_MISSES} room codes that do not exist, dropping`);
          dropConnection(id, 'guessed room codes', 'join-guessing');
        }
        return;
      }
      const refusal = room.join(player);
      if (refusal) {
        // Another version: say which, so the player knows what to update (D60)
        send(id, refusal === 'version'
          ? { t: 'refused', reason: refusal, hostVersion: room.status().gameVersion }
          : { t: 'refused', reason: refusal });
        return;
      }
      connection.room = room;
      return;
    }
    connection.room?.receive(id, message);
  };

  wss.on('connection', (socket, request) => {
    const id = `p${nextPlayer++}`;
    const address = addressOf(request);
    perAddress.set(address, (perAddress.get(address) ?? 0) + 1);
    metrics.connectionsOpened++;
    const connection: Connection = {
      socket, address, player: null, room: null, missed: 0, pingAt: 0, rtt: null, dropReason: null,
      burst: 0, burstAt: now(), throttled: false, joinMisses: 0, helloTimer: null,
    };
    connections.set(id, connection);
    // A connection that never says hello holds a slot for nothing (review H3)
    connection.helloTimer = setTimeout(() => {
      if (connection.player === null) dropConnection(id, 'no hello', 'no-hello');
    }, options.helloTimeoutMs ?? HELLO_TIMEOUT_MS);
    socket.on('pong', () => {
      connection.missed = 0;
      connection.rtt = now() - connection.pingAt;
    });
    // A socket error (a reset, a protocol violation) ends in close; nothing to add
    socket.on('error', () => undefined);

    socket.on('message', (data) => {
      const at = now();
      metrics.messagesIn++;
      metrics.bytesIn += (data as Buffer).length ?? 0;
      if (at - connection.burstAt >= 1000) {
        connection.burst = 0;
        connection.burstAt = at;
        connection.throttled = false;
      }
      if (++connection.burst > (options.maxMessagesPerSecond ?? MAX_MESSAGES_PER_SECOND)) {
        if (!connection.throttled) log(`${connection.room ? `[${connection.room.code}] ` : ''}${id} sends too fast, dropping`);
        connection.throttled = true;
        metrics.drop('rate');
        return;
      }
      // One bad message never takes the relay down: log it, drop that connection (review K1)
      try {
        handleMessage(id, connection, data);
      } catch (error) {
        metrics.errors++;
        log(`${connection.room ? `[${connection.room.code}] ` : ''}${id}: a message failed (${String((error as Error)?.message ?? error).slice(0, 200)}), dropping`);
        dropConnection(id, 'a message failed', 'error');
      }
    });

    socket.on('close', () => {
      if (connection.helloTimer) clearTimeout(connection.helloTimer);
      const left = (perAddress.get(address) ?? 1) - 1;
      if (left > 0) perAddress.set(address, left);
      else perAddress.delete(address);
      const room = connection.room;
      connections.delete(id);
      if (!room) return;
      try {
        room.leave(id, connection.dropReason ?? 'closed');
      } catch (error) {
        metrics.errors++;
        log(`[${room.code}] leave failed: ${String((error as Error)?.message ?? error).slice(0, 200)}`);
      }
      closeIfEmpty(room);
    });
  });

  const closeIfEmpty = (room: Room): void => {
    if (!room.isEmpty || !rooms.has(room.code)) return;
    rooms.delete(room.code);
    const s = room.status();
    log(`[${room.code}] closed after ${Math.round(s.ageMs / 1000)} s, tick ${s.tick}, ${s.commands} commands, ${s.desyncs} desyncs`);
  };

  /** Run `work` in a timer without letting a throw end the relay */
  const guarded = (what: string, work: () => void) => () => {
    try {
      work();
    } catch (error) {
      metrics.errors++;
      log(`${what} failed: ${String((error as Error)?.message ?? error).slice(0, 200)}`);
    }
  };

  const heartbeat = setInterval(guarded('heartbeat', () => {
    // The round trips the last heartbeat measured, to each room
    for (const room of rooms.values()) room.sendRtt(rttOf);
    // A lobby open too long without a start, a game nobody plays any more: its players go
    for (const room of rooms.values()) {
      const s = room.status();
      const reason = !room.isStarted && s.ageMs >= (options.lobbyMaxMs ?? LOBBY_MAX_MS) ? 'lobby open too long'
        : room.isStarted && s.idleMs >= (options.gameIdleMaxMs ?? GAME_IDLE_MAX_MS) ? 'game without commands too long'
          : null;
      if (!reason) continue;
      log(`[${room.code}] ${reason}, closing it`);
      for (const connection of connections.values()) {
        if (connection.room !== room) continue;
        connection.dropReason = reason;
        connection.socket.close();
      }
    }
    for (const [id, connection] of connections) {
      if (connection.missed >= MISSED_HEARTBEATS) {
        dropConnection(id, `no heartbeat for ${Math.round((MISSED_HEARTBEATS * (options.heartbeatMs ?? HEARTBEAT_MS)) / 1000)} s`, 'hanging');
        continue;
      }
      connection.missed++;
      connection.pingAt = now();
      connection.socket.ping();
    }
  }), options.heartbeatMs ?? HEARTBEAT_MS);

  // Per running room: commands at the last status line, for commands a second
  const commandsAtLine = new Map<string, number>();
  const statusEvery = options.statusEveryMs ?? STATUS_MS;
  const statusLines = setInterval(guarded('status line', () => {
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
  }), statusEvery);

  const takeSample = guarded('metrics', () => {
    metrics.sample(Math.round((now() - startedAt) / 1000), counts());
  });
  // One at the start, so the curves have a point before the first interval
  takeSample();
  const samples = setInterval(takeSample, SAMPLE_MS);
  const metricsLines = setInterval(guarded('metrics line', () => log(metrics.line(counts()))), METRICS_LINE_MS);

  let last = now();
  const clock = setInterval(() => {
    const at = now();
    const elapsed = at - last;
    last = at;
    for (const room of rooms.values()) {
      // One room that throws stops only itself: its players are let go (review K1)
      try {
        room.advance(elapsed);
      } catch (error) {
        metrics.errors++;
        log(`[${room.code}] failed (${String((error as Error)?.message ?? error).slice(0, 200)}), closing it`);
        for (const [id, connection] of connections) {
          if (connection.room === room) dropConnection(id, 'the room failed', 'error');
        }
      }
    }
  }, CLOCK_MS);

  const stopTimers = () => {
    clearInterval(clock);
    clearInterval(heartbeat);
    clearInterval(statusLines);
    clearInterval(samples);
    clearInterval(metricsLines);
  };

  return new Promise((resolve, reject) => {
    http.once('error', (error) => {
      stopTimers();
      reject(error);
    });
    http.listen(options.port, () => {
      const address = http.address();
      const port = typeof address === 'object' && address ? address.port : options.port;
      log(`coop relay on port ${port}`);
      let closed: Promise<void> | null = null;
      resolve({
        port,
        status,
        // Once, however often it is called (review N7)
        close: (reason?: string) => (closed ??= new Promise<void>((done) => {
          closing = true;
          stopTimers();
          // Tell the clients why: a restart reads as such, not as a lost connection (review M6)
          for (const { socket } of connections.values()) {
            if (reason) socket.close(CLOSE_RESTART, reason.slice(0, 100));
            else socket.terminate();
          }
          const finish = () => wss.close(() => http.close(() => done()));
          if (!reason) return finish();
          // The close frames go out, then whatever did not answer goes
          setTimeout(() => {
            for (const { socket } of connections.values()) socket.terminate();
            finish();
          }, 500);
        })),
      });
    });
  });
}

/**
 * Where a connection comes from: behind a Cloudflare tunnel the visitor's
 * address, otherwise the socket's. Only counted in memory (review H3, D64).
 */
function addressOf(request: IncomingMessage): string {
  const forwarded = request.headers['cf-connecting-ip'];
  return (typeof forwarded === 'string' && forwarded) || request.socket.remoteAddress || 'unknown';
}

/**
 * A request from this machine or the local network, not one that came in
 * through a Cloudflare tunnel (which adds CF-Connecting-IP; the tunnel's own
 * connector sits on the local network).
 */
export function isLocalRequest(remote: string | undefined, headers: Record<string, string | string[] | undefined>): boolean {
  if (headers['cf-connecting-ip'] !== undefined || headers['cf-ray'] !== undefined) return false;
  const address = (remote ?? '').replace(/^::ffff:/, '');
  if (address === '::1' || address.startsWith('127.')) return true;
  const [a, b] = address.split('.').map(Number);
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/** The status page as text: one block per room. */
export function statusText(status: RelayStatus): string {
  const lines = [
    `3dtd coop relay ${status.build}, protocol ${status.protocol}, up ${status.uptimeS} s, ${status.connections} connections, ${status.rooms.length} rooms`,
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
