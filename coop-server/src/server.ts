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
import { RunStore } from './run-store.ts';

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
/** How often kept run logs are checked for age and size */
const RUN_PRUNE_MS = 60 * 60_000;

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
  /** The room of the last game this connection played in, for its run log (TODO E38) */
  playedRoom: string | null;
  /** Rooms this connection sent a run log for; one each */
  sentRuns: Set<string>;
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
  /**
   * Keep the run logs players agree to send after a coop game (TODO E38):
   * where, and how much for how long. Off without it.
   */
  collectRuns?: { dir: string; maxBytes: number; maxAgeMs: number };
}

/** Start the relay on `port` (0: any free port); rejects when the port is taken. */
export function startRelay(options: RelayOptions): Promise<RelayServer> {
  return new Relay(options).listen();
}

/** A connection's room code for a log line, "[CODE] " or nothing */
const roomTag = (connection: Connection): string => (connection.room ? `[${connection.room.code}] ` : '');
const errorText = (error: unknown): string => String((error as Error)?.message ?? error).slice(0, 200);

/**
 * One running relay: its rooms and connections, the HTTP side (status page,
 * health check, actions), the WebSocket side and the timers. startRelay()
 * is the way in; the class only splits what used to be one long closure.
 */
class Relay {
  private readonly recentLines: string[] = [];
  private readonly now: () => number;
  private readonly rooms = new Map<string, Room>();
  private readonly connections = new Map<string, Connection>();
  /** Open connections per address, in memory only (review H3, D64) */
  private readonly perAddress = new Map<string, number>();
  private readonly metrics = new RelayMetrics();
  private readonly startedAt: number;
  private readonly origins: Set<string> | null;
  /** Refusals of the same kind are logged at most once in ten seconds, with how many came (review M1) */
  private readonly refusalLog = new Map<string, { at: number; count: number }>();
  /** The JSON of a message, once for every player a broadcast sends it to (review H2) */
  private readonly serialized = new WeakMap<ServerMessage, string>();
  /** Per running room: commands at the last status line, for commands a second */
  private readonly commandsAtLine = new Map<string, number>();
  private readonly timers: ReturnType<typeof setInterval>[] = [];
  private readonly http: Server;
  private readonly wss: WebSocketServer;
  private nextPlayer = 1;
  private closing = false;
  private closed: Promise<void> | null = null;

  private readonly options: RelayOptions;
  /** The kept run logs, when the relay collects them (TODO E38) */
  private readonly runStore: RunStore | null;

  constructor(options: RelayOptions) {
    this.options = options;
    this.now = options.now ?? (() => performance.now());
    this.runStore = options.collectRuns ? new RunStore({ ...options.collectRuns, now: () => Date.now() }) : null;
    this.startedAt = this.now();
    this.origins = options.origins?.length ? new Set(options.origins.map((o) => o.replace(/\/$/, ''))) : null;
    this.http = createServer((request, response) => {
      try {
        this.handleHttp(request, response);
      } catch (error) {
        this.metrics.errors++;
        this.log(`status page failed: ${errorText(error)}`);
        if (!response.headersSent) response.writeHead(500);
        response.end();
      }
    });
    this.wss = new WebSocketServer({
      server: this.http,
      maxPayload: MAX_MESSAGE_BYTES,
      verifyClient: ({ origin, req }: { origin?: string; req: IncomingMessage }) => this.admits(origin, req),
    });
    // ws repeats the HTTP server's errors; a taken port is handled at listen below
    this.wss.on('error', () => undefined);
    this.wss.on('connection', (socket, request) => this.connect(socket, request));
  }

  listen(): Promise<RelayServer> {
    this.startTimers();
    return new Promise((resolve, reject) => {
      this.http.once('error', (error) => {
        this.stopTimers();
        reject(error);
      });
      this.http.listen(this.options.port, () => {
        const address = this.http.address();
        const port = typeof address === 'object' && address ? address.port : this.options.port;
        this.log(`coop relay on port ${port}`);
        resolve({ port, status: () => this.status(), close: (reason) => this.close(reason) });
      });
    });
  }

  // ── State ──────────────────────────────────────────────────────────

  private log(line: string): void {
    this.recentLines.push(line);
    if (this.recentLines.length > LOG_LINES_KEPT) this.recentLines.shift();
    this.options.log?.(line);
  }

  private counts(): { connections: number; lobbies: number; games: number } {
    let games = 0;
    for (const room of this.rooms.values()) if (room.isStarted) games++;
    return { connections: this.connections.size, lobbies: this.rooms.size - games, games };
  }

  private uptimeS(): number {
    return Math.round((this.now() - this.startedAt) / 1000);
  }

  private status(): RelayStatus {
    return {
      build: this.options.build ?? 'dev',
      protocol: PROTOCOL_VERSION,
      uptimeS: this.uptimeS(),
      connections: this.connections.size,
      rooms: [...this.rooms.values()].map((room) => {
        const s = room.status();
        return { ...s, players: s.players.map((p) => ({ ...p, rttMs: this.rttOf(p.id) })) };
      }),
    };
  }

  private metricsView(): RelayMetricsView {
    const m = this.metrics;
    return {
      uptimeS: this.uptimeS(),
      rssMb: Math.round(process.memoryUsage().rss / 2 ** 20),
      ...this.counts(),
      bytesIn: m.bytesIn,
      bytesOut: m.bytesOut,
      messagesIn: m.messagesIn,
      connectionsOpened: m.connectionsOpened,
      errors: m.errors,
      dropped: { ...m.dropped },
      refused: { ...m.refused },
      samples: m.samples,
      actions: !!this.options.adminToken,
    };
  }

  private rttOf(playerId: string): number | null {
    const rtt = this.connections.get(playerId)?.rtt;
    return rtt === undefined || rtt === null ? null : Math.round(rtt);
  }

  /** Close a connection for `reason`; its close handler takes it out of its room. */
  private dropConnection(playerId: string, reason: string, why: DropReason): void {
    const connection = this.connections.get(playerId);
    // Once: messages already read may still come in after the first drop
    if (!connection || connection.dropReason !== null) return;
    connection.dropReason = reason;
    this.metrics.drop(why);
    connection.socket.terminate();
  }

  private dropRoom(room: Room, reason: string, why: DropReason): void {
    for (const [id, connection] of this.connections) {
      if (connection.room === room) this.dropConnection(id, reason, why);
    }
  }

  // ── HTTP: status page, health check, actions ─────────────────────

  private handleHttp(request: IncomingMessage, response: ServerResponse): void {
    const path = (request.url ?? '/').split('?')[0];
    // The health check answers everyone: it says nothing but that the relay runs (review idea 2)
    if (path === '/healthz') {
      response.writeHead(this.closing ? 503 : 200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(this.closing ? 'stopping\n' : 'ok\n');
      return;
    }
    if (this.options.statusAccess === 'local' && !isLocalRequest(request.socket.remoteAddress, request.headers)) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('not here\n');
      return;
    }
    if (request.method === 'GET' && path.startsWith('/admin/runs')) return this.runsAdmin(request, response, path);
    if (request.method === 'POST' && path.startsWith('/admin/')) return this.admin(request, response, path);
    const json = (body: unknown) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body, null, 2));
    };
    if (path === '/status') return json(this.status());
    if (path === '/metrics.json') return json(this.metricsView());
    if (path === '/log.json') return json(this.recentLines);
    if (path === '/text') {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(statusText(this.status()));
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      // Only its own inline script, requests to this relay and data: images (logo, favicon)
      'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:",
    });
    response.end(statusPage());
  }

  /**
   * The status page's actions, with the admin token in `x-admin-token`: a
   * header another site's page cannot set without a preflight this relay
   * never answers. POST /admin/close-room {code}, /admin/drop-player {id}.
   */
  private admin(request: IncomingMessage, response: ServerResponse, path: string): void {
    const answer = (code: number, text: string) => {
      response.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(`${text}\n`);
    };
    const token = this.options.adminToken;
    if (!token || request.headers['x-admin-token'] !== token) return answer(403, 'no');
    // The page asks whether its token is the right one before it shows the buttons
    if (path === '/admin/check') return answer(200, 'ok');
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
        const room = this.rooms.get(String(target['code']));
        if (!room) return answer(404, 'no such room');
        this.log(`[${room.code}] closed from the status page`);
        this.dropRoom(room, 'room closed by the relay', 'kicked');
        return answer(200, 'closed');
      }
      if (path === '/admin/drop-player') {
        const id = String(target['id']);
        if (!this.connections.has(id)) return answer(404, 'no such player');
        this.log(`${id} dropped from the status page`);
        this.dropConnection(id, 'dropped by the relay', 'kicked');
        return answer(200, 'dropped');
      }
      answer(404, 'no such action');
    });
  }

  /**
   * The kept run logs, with the admin token (TODO E38): GET /admin/runs
   * lists them, GET /admin/runs/file?path=... hands one over.
   */
  private runsAdmin(request: IncomingMessage, response: ServerResponse, path: string): void {
    const token = this.options.adminToken;
    if (!token || request.headers['x-admin-token'] !== token || !this.runStore) {
      response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('no\n');
      return;
    }
    if (path === '/admin/runs') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(this.runStore.list()));
      return;
    }
    const wanted = new URL(request.url ?? '', 'http://relay').searchParams.get('path') ?? '';
    const bytes = path === '/admin/runs/file' ? this.runStore.read(wanted) : null;
    if (!bytes) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('no such log\n');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/gzip' });
    response.end(bytes);
  }

  // ── WebSocket: who may connect, a connection's life, its messages ─

  private logRefusal(kind: string, line: string): void {
    const entry = this.refusalLog.get(kind);
    if (entry && this.now() - entry.at < 10_000) {
      entry.count++;
      return;
    }
    this.log(entry && entry.count > 0 ? `${line} (and ${entry.count} more like it)` : line);
    this.refusalLog.set(kind, { at: this.now(), count: 0 });
  }

  /** A new connection may open: the right page, room for it, not too many from its address */
  private admits(origin: string | undefined, req: IncomingMessage): boolean {
    const { metrics, options } = this;
    // Another site's page must not use its visitors' browsers on this relay (R19)
    if (this.origins && origin && !this.origins.has(origin)) {
      metrics.refused.origin++;
      this.logRefusal('origin', `refused a connection from ${origin.slice(0, 100)}`);
      return false;
    }
    if (this.closing || this.connections.size >= (options.maxConnections ?? MAX_CONNECTIONS)) {
      metrics.refused.full++;
      this.logRefusal('full', 'refused a connection: relay full');
      return false;
    }
    if ((this.perAddress.get(addressOf(req)) ?? 0) >= (options.maxPerAddress ?? MAX_PER_ADDRESS)) {
      metrics.refused['per-address']++;
      this.logRefusal('per-address', 'refused a connection: too many from one address');
      return false;
    }
    return true;
  }

  private send(playerId: string, message: ServerMessage): void {
    const connection = this.connections.get(playerId);
    const socket = connection?.socket;
    if (!connection || !socket || socket.readyState !== socket.OPEN) return;
    // A client that does not read would hold the relay's memory (review H2)
    if (socket.bufferedAmount > MAX_UNREAD_BYTES) {
      if (connection.dropReason === null) {
        this.log(`${roomTag(connection)}${playerId} reads too slowly, dropping`);
        this.dropConnection(playerId, 'reads too slowly', 'slow');
      }
      return;
    }
    let text = this.serialized.get(message);
    if (text === undefined) {
      text = JSON.stringify(message);
      this.serialized.set(message, text);
    }
    this.metrics.bytesOut += text.length;
    socket.send(text);
  }

  private connect(socket: WebSocket, request: IncomingMessage): void {
    const id = `p${this.nextPlayer++}`;
    const address = addressOf(request);
    this.perAddress.set(address, (this.perAddress.get(address) ?? 0) + 1);
    this.metrics.connectionsOpened++;
    const connection: Connection = {
      socket, address, player: null, room: null, missed: 0, pingAt: 0, rtt: null, dropReason: null,
      burst: 0, burstAt: this.now(), throttled: false, joinMisses: 0, helloTimer: null,
      playedRoom: null, sentRuns: new Set(),
    };
    this.connections.set(id, connection);
    // A connection that never says hello holds a slot for nothing (review H3)
    connection.helloTimer = setTimeout(() => {
      if (connection.player === null) this.dropConnection(id, 'no hello', 'no-hello');
    }, this.options.helloTimeoutMs ?? HELLO_TIMEOUT_MS);
    socket.on('pong', () => {
      connection.missed = 0;
      connection.rtt = this.now() - connection.pingAt;
    });
    // A socket error (a reset, a protocol violation) ends in close; nothing to add
    socket.on('error', () => undefined);
    socket.on('message', (data) => this.received(id, connection, data));
    socket.on('close', () => this.disconnected(id, connection));
  }

  private received(id: string, connection: Connection, data: unknown): void {
    const at = this.now();
    this.metrics.messagesIn++;
    this.metrics.bytesIn += (data as Buffer).length ?? 0;
    if (at - connection.burstAt >= 1000) {
      connection.burst = 0;
      connection.burstAt = at;
      connection.throttled = false;
    }
    if (++connection.burst > (this.options.maxMessagesPerSecond ?? MAX_MESSAGES_PER_SECOND)) {
      if (!connection.throttled) this.log(`${roomTag(connection)}${id} sends too fast, dropping`);
      connection.throttled = true;
      this.metrics.drop('rate');
      return;
    }
    // One bad message never takes the relay down: log it, drop that connection (review K1)
    try {
      this.handleMessage(id, connection, data);
    } catch (error) {
      this.metrics.errors++;
      this.log(`${roomTag(connection)}${id}: a message failed (${errorText(error)}), dropping`);
      this.dropConnection(id, 'a message failed', 'error');
    }
  }

  private disconnected(id: string, connection: Connection): void {
    if (connection.helloTimer) clearTimeout(connection.helloTimer);
    const left = (this.perAddress.get(connection.address) ?? 1) - 1;
    if (left > 0) this.perAddress.set(connection.address, left);
    else this.perAddress.delete(connection.address);
    const room = connection.room;
    this.connections.delete(id);
    if (!room) return;
    try {
      room.leave(id, connection.dropReason ?? 'closed');
    } catch (error) {
      this.metrics.errors++;
      this.log(`[${room.code}] leave failed: ${errorText(error)}`);
    }
    this.closeIfEmpty(room);
  }

  private handleMessage(id: string, connection: Connection, data: unknown): void {
    let raw: unknown;
    try {
      raw = JSON.parse(String(data));
    } catch {
      this.metrics.drop('malformed');
      return;
    }
    const message = parseClientMessage(raw);
    if (!message) {
      this.metrics.drop('malformed');
      return;
    }
    if (message.t === 'hello') {
      if (message.protocol !== PROTOCOL_VERSION) return this.send(id, { t: 'refused', reason: 'protocol' });
      if (connection.helloTimer) clearTimeout(connection.helloTimer);
      connection.helloTimer = null;
      connection.player = {
        id,
        name: message.name || id,
        gameVersion: message.gameVersion,
        configHash: message.configHash,
        client: validClient(message.client),
      };
      return this.send(id, { t: 'welcome', playerId: id, ...(this.runStore ? { collectRuns: true } : {}) });
    }
    const player = connection.player;
    if (!player) return;
    if (message.t === 'create') return this.create(id, connection, player);
    // The public list (D62): open to anyone said hello, in a room or not
    if (message.t === 'rooms') {
      const list = [...this.rooms.values()].flatMap((room) => room.publicEntry() ?? []);
      return this.send(id, { t: 'rooms', rooms: list });
    }
    if (message.t === 'join') return this.join(id, connection, player, message.room);
    if (message.t === 'run-log') return this.runLog(id, connection, player, message.gz);
    if (connection.room?.hasStarted) connection.playedRoom = connection.room.code;
    connection.room?.receive(id, message);
  }

  /**
   * A player's run log after a game (TODO E38): only to a relay that
   * collects, only from someone who played in a room, once per room. The
   * store checks the content.
   */
  private runLog(id: string, connection: Connection, player: RoomPlayer, gz: string): void {
    const room = connection.room?.hasStarted ? connection.room.code : connection.playedRoom;
    if (!this.runStore || !room) return this.send(id, { t: 'run-log', ok: false, reason: 'not collected here' });
    if (connection.sentRuns.has(room)) return this.send(id, { t: 'run-log', ok: false, reason: 'already sent' });
    connection.sentRuns.add(room);
    const result = this.runStore.accept(room, id, player.name, gz);
    if (result.ok) {
      this.log(`[${room}] run log of ${player.name} (${id}) kept, ${Math.round(gz.length * 0.75 / 1024)} kB`);
      return this.send(id, { t: 'run-log', ok: true });
    }
    this.log(`[${room}] run log of ${player.name} (${id}) refused: ${result.reason}`);
    this.send(id, { t: 'run-log', ok: false, reason: result.reason });
  }

  private create(id: string, connection: Connection, player: RoomPlayer): void {
    if (connection.room || this.closing) return;
    if (this.rooms.size >= (this.options.maxRooms ?? MAX_ROOMS)) return this.send(id, { t: 'refused', reason: 'busy' });
    const code = this.newCode();
    const room = new Room(code, player, (playerId, message) => this.send(playerId, message), {
      log: (line) => this.log(`[${code}] ${line}`),
      now: this.now,
      cheats: this.options.cheats,
      drop: (playerId, reason) => this.dropConnection(playerId, reason, 'hanging'),
      // The room of a connection is gone for this player (left, taken out, let go)
      removed: (playerId) => {
        const gone = this.connections.get(playerId);
        if (gone) gone.room = null;
      },
    });
    this.rooms.set(room.code, room);
    connection.room = room;
  }

  private join(id: string, connection: Connection, player: RoomPlayer, code: string): void {
    if (connection.room) return;
    const room = this.rooms.get(code.toUpperCase());
    if (!room) {
      this.send(id, { t: 'refused', reason: 'no-room' });
      // Guessing private codes (review N3)
      if (++connection.joinMisses >= MAX_JOIN_MISSES) {
        this.log(`${id} tried ${MAX_JOIN_MISSES} room codes that do not exist, dropping`);
        this.dropConnection(id, 'guessed room codes', 'join-guessing');
      }
      return;
    }
    const refusal = room.join(player);
    if (refusal) {
      // Another version: say which, so the player knows what to update (D60)
      return this.send(id, refusal === 'version'
        ? { t: 'refused', reason: refusal, hostVersion: room.status().gameVersion }
        : { t: 'refused', reason: refusal });
    }
    connection.room = room;
  }

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  private closeIfEmpty(room: Room): void {
    if (!room.isEmpty || !this.rooms.has(room.code)) return;
    this.rooms.delete(room.code);
    const s = room.status();
    this.log(`[${room.code}] closed after ${Math.round(s.ageMs / 1000)} s, tick ${s.tick}, ${s.commands} commands, ${s.desyncs} desyncs`);
  }

  // ── Timers ───────────────────────────────────────────────────────

  /** Run `work` every `ms` without letting a throw end the relay */
  private every(ms: number, what: string, work: () => void): void {
    this.timers.push(setInterval(() => {
      try {
        work();
      } catch (error) {
        this.metrics.errors++;
        this.log(`${what} failed: ${errorText(error)}`);
      }
    }, ms));
  }

  private startTimers(): void {
    const { options } = this;
    this.every(options.heartbeatMs ?? HEARTBEAT_MS, 'heartbeat', () => this.heartbeat());
    const statusEvery = options.statusEveryMs ?? STATUS_MS;
    this.every(statusEvery, 'status line', () => this.statusLines(statusEvery));
    const sample = () => this.metrics.sample(this.uptimeS(), this.counts());
    // One at the start, so the curves have a point before the first interval
    sample();
    this.every(SAMPLE_MS, 'metrics', sample);
    // Only when something changed: an idle relay wrote the same line every
    // minute (1440 a day). The memory alone moves by a MB and is no change.
    let lastMetrics = '';
    this.every(METRICS_LINE_MS, 'metrics line', () => {
      const line = this.metrics.line(this.counts());
      const key = line.replace(/, rss \d+ MB$/, '');
      if (key === lastMetrics) return;
      lastMetrics = key;
      this.log(line);
    });
    let last = this.now();
    // Kept run logs age out even on a day nobody sends one (TODO E38)
    if (this.runStore) this.every(RUN_PRUNE_MS, 'run log pruning', () => this.runStore?.prune());
    this.every(CLOCK_MS, 'clock', () => {
      const at = this.now();
      const elapsed = at - last;
      last = at;
      for (const room of this.rooms.values()) {
        // One room that throws stops only itself: its players are let go (review K1)
        try {
          room.advance(elapsed);
        } catch (error) {
          this.metrics.errors++;
          this.log(`[${room.code}] failed (${errorText(error)}), closing it`);
          this.dropRoom(room, 'the room failed', 'error');
        }
      }
    });
  }

  private stopTimers(): void {
    for (const timer of this.timers.splice(0)) clearInterval(timer);
  }

  private heartbeat(): void {
    const { options } = this;
    // The round trips the last heartbeat measured, to each room
    for (const room of this.rooms.values()) room.sendRtt((id) => this.rttOf(id));
    // A lobby open too long without a start, a game nobody plays any more: its players go
    for (const room of this.rooms.values()) {
      const s = room.status();
      const reason = !room.isStarted && s.ageMs >= (options.lobbyMaxMs ?? LOBBY_MAX_MS) ? 'lobby open too long'
        : room.isStarted && s.idleMs >= (options.gameIdleMaxMs ?? GAME_IDLE_MAX_MS) ? 'game without commands too long'
          : null;
      if (!reason) continue;
      this.log(`[${room.code}] ${reason}, closing it`);
      for (const connection of this.connections.values()) {
        if (connection.room !== room) continue;
        connection.dropReason = reason;
        connection.socket.close();
      }
    }
    const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
    for (const [id, connection] of this.connections) {
      if (connection.missed >= MISSED_HEARTBEATS) {
        this.dropConnection(id, `no heartbeat for ${Math.round((MISSED_HEARTBEATS * heartbeatMs) / 1000)} s`, 'hanging');
        continue;
      }
      connection.missed++;
      connection.pingAt = this.now();
      connection.socket.ping();
    }
  }

  private statusLines(statusEvery: number): void {
    for (const room of this.rooms.values()) {
      if (!room.isStarted) continue;
      const s = room.status();
      const perSecond = (s.commands - (this.commandsAtLine.get(s.code) ?? 0)) / (statusEvery / 1000);
      this.commandsAtLine.set(s.code, s.commands);
      const players = s.players.map((p) => {
        const rtt = this.rttOf(p.id);
        const hash = p.lastHash ? ` ${hex(p.lastHash.hash)}@${p.lastHash.tick}` : '';
        return `${room.who(p.id)} ${rtt === null ? '?' : rtt} ms${hash}`;
      });
      this.log(`[${s.code}] tick ${s.tick}, speed ${s.speed}, ${perSecond.toFixed(1)} cmd/s, ${players.join(', ')}; desyncs ${s.desyncs}`);
    }
    for (const code of this.commandsAtLine.keys()) if (!this.rooms.has(code)) this.commandsAtLine.delete(code);
  }

  // ── Stop ─────────────────────────────────────────────────────────

  /** Close every connection (as a restart where `reason` is given) and stop; once, however often called (review N7) */
  private close(reason?: string): Promise<void> {
    return (this.closed ??= new Promise<void>((done) => {
      this.closing = true;
      this.stopTimers();
      // Tell the clients why: a restart reads as such, not as a lost connection (review M6)
      for (const { socket } of this.connections.values()) {
        if (reason) socket.close(CLOSE_RESTART, reason.slice(0, 100));
        else socket.terminate();
      }
      const finish = () => this.wss.close(() => this.http.close(() => done()));
      if (!reason) return finish();
      // The close frames go out, then whatever did not answer goes
      setTimeout(() => {
        for (const { socket } of this.connections.values()) socket.terminate();
        finish();
      }, 500);
    }));
  }
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
