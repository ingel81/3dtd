import { LockstepStats } from './lockstep-stats';
import type { LockstepLink, StampedCommand } from './lockstep';
import type { ClientInfo } from './client-info';
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type CoopRoomInfo,
  type RefusalReason,
  type ServerMessage,
} from './protocol';

type Command = StampedCommand['command'];

/** The socket a session talks over; the browser's WebSocket fits. */
export interface CoopSocket {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/** What the game needs to start: seed, roster, lanes, who is here, the link. */
export interface CoopStart {
  seed: number;
  players: string[];
  lanes: Map<string, string>;
  localId: string;
  speed: number;
  link: LockstepLink;
}

export class CoopRefusedError extends Error {
  readonly reason: RefusalReason;

  constructor(reason: RefusalReason) {
    super(`refused: ${reason}`);
    this.reason = reason;
  }
}

/**
 * The client's end of the relay's tick stream (LockstepLink over the
 * session's socket): commands go out as `cmd`, closed ticks come back as
 * `tick` and are kept until the simulation ran them.
 */
export class WebSocketLink implements LockstepLink {
  private readonly received = new Map<number, readonly StampedCommand[]>();
  private confirmed = -1;
  readonly playerId: string;
  private readonly out: (message: ClientMessage) => void;

  constructor(playerId: string, out: (message: ClientMessage) => void) {
    this.playerId = playerId;
    this.out = out;
  }

  /** How smoothly this client runs, reported to the relay (PLAYTEST T19) */
  private readonly stats = new LockstepStats();

  send(command: Command): void {
    this.stats.commandSent(performance.now());
    this.out({ t: 'cmd', command });
  }

  confirmedTick(): number {
    return this.confirmed;
  }

  /** Called once per tick, as its commands run: the own ones give the input delay */
  commandsAt(tick: number): readonly StampedCommand[] {
    const commands = this.received.get(tick) ?? [];
    for (const stamped of commands) {
      if (stamped.playerId === this.playerId) this.stats.commandRan(performance.now());
    }
    return commands;
  }

  release(tick: number): void {
    this.received.delete(tick);
  }

  reportHash(tick: number, hash: number): void {
    this.out({ t: 'hash', tick, hash });
  }

  noteFrame(steps: number, blocked: boolean, behind: number): void {
    this.stats.frame(steps, blocked, behind);
    const report = this.stats.reportDue(performance.now());
    if (report) this.out({ t: 'stats', stats: report });
  }

  /** From the session: a tick closed at the relay. Ticks come in order over the one socket. */
  receive(tick: number, commands: readonly StampedCommand[]): void {
    this.stats.tickArrived(performance.now());
    if (commands.length > 0) this.received.set(tick, commands);
    this.confirmed = tick;
  }
}

/**
 * One player's connection to a coop relay (docs/COOP_PLAN.md, C4): hello,
 * a room to create or join, the lobby (world, lanes, ready), the start and
 * the game's tick stream. Framework-free; CoopService wires it into the game.
 */
export class CoopSession {
  private socket: CoopSocket | null = null;
  private pendingReply: { resolve: (value: unknown) => void; reject: (error: Error) => void; wants: ServerMessage['t'] } | null = null;
  private linkNow: WebSocketLink | null = null;

  /** This player's id at the relay, once connected */
  playerId: string | null = null;
  /** The room as the relay last told it, null outside one */
  room: CoopRoomInfo | null = null;
  /** The host's world package, once it came (a host has its own) */
  world: unknown = null;

  /** Room changes, the host's world, the start, and the rest of the stream; one handler each */
  onRoom: ((room: CoopRoomInfo) => void) | null = null;
  onWorld: ((world: unknown) => void) | null = null;
  onStarted: ((start: CoopStart) => void) | null = null;
  onSpeed: ((speed: number) => void) | null = null;
  /** Each player's round trip to the relay, ms */
  onRtt: ((rtt: [string, number | null][]) => void) | null = null;
  /** The room waits for this player to catch up; null once it goes on */
  onWaiting: ((playerId: string | null) => void) | null = null;
  onHost: ((hostId: string) => void) | null = null;
  onLeft: ((playerId: string) => void) | null = null;
  onChat: ((from: string, text: string) => void) | null = null;
  onPing: ((from: string, lat: number, lon: number) => void) | null = null;
  /** The relay found the simulations apart (C5): the first tick, player id and hash each */
  onDesync: ((tick: number, hashes: [string, number][]) => void) | null = null;
  onRefused: ((reason: RefusalReason) => void) | null = null;
  onClosed: (() => void) | null = null;

  private readonly url: string;
  private readonly hello: { name: string; gameVersion: string; configHash: string; client?: ClientInfo };
  private readonly openSocket: (url: string) => CoopSocket;

  constructor(
    url: string,
    hello: { name: string; gameVersion: string; configHash: string; client?: ClientInfo },
    openSocket: (url: string) => CoopSocket = (to) => new WebSocket(to) as unknown as CoopSocket,
  ) {
    this.url = url;
    this.hello = hello;
    this.openSocket = openSocket;
  }

  /** The tick stream of a started game, null before. */
  get link(): LockstepLink | null {
    return this.linkNow;
  }

  get isHost(): boolean {
    return this.room !== null && this.room.hostId === this.playerId;
  }

  /** Connect and say hello; resolves with this player's id, rejects after `timeoutMs` without a welcome. */
  connect(timeoutMs = 5000): Promise<string> {
    return new Promise((done, reject) => {
      const socket = this.openSocket(this.url);
      this.socket = socket;
      const timer = setTimeout(() => {
        this.fail(new Error(`no answer from ${this.url}`), reject);
        this.close();
      }, timeoutMs);
      const resolve = (id: string) => {
        clearTimeout(timer);
        done(id);
      };
      socket.onopen = () => {
        this.expect('welcome', resolve as (value: unknown) => void, (err) => {
          clearTimeout(timer);
          reject(err);
        });
        this.out({ t: 'hello', protocol: PROTOCOL_VERSION, ...this.hello });
      };
      socket.onmessage = (event) => this.receive(String(event.data));
      socket.onerror = () => {
        clearTimeout(timer);
        this.fail(new Error(`no coop relay at ${this.url}`), reject);
      };
      socket.onclose = () => {
        clearTimeout(timer);
        this.fail(new Error('the connection to the coop relay closed'), reject);
        this.socket = null;
        this.onClosed?.();
      };
    });
  }

  /** Open a room as its host. */
  create(): Promise<CoopRoomInfo> {
    return this.request({ t: 'create' }, 'room') as Promise<CoopRoomInfo>;
  }

  /** Join the room `code`; rejects with CoopRefusedError. */
  join(code: string): Promise<CoopRoomInfo> {
    return this.request({ t: 'join', room: code.trim().toUpperCase() }, 'room') as Promise<CoopRoomInfo>;
  }

  /** Host: the room's world and its spawns, the lanes to pick from. */
  sendWorld(world: unknown, spawnIds: string[]): void {
    this.world = world;
    this.out({ t: 'world', world, spawnIds });
  }

  pick(spawnId: string | null): void {
    this.out({ t: 'pick', spawnId });
  }

  /** Lobby: another name for this player. */
  rename(name: string): void {
    this.out({ t: 'rename', name });
  }

  /** Host, lobby: take `playerId` out of the room. */
  kick(playerId: string): void {
    this.out({ t: 'kick', playerId });
  }

  /** Host: close the room to further players, or open it again. */
  lock(locked: boolean): void {
    this.out({ t: 'lock', locked });
  }

  ready(ready: boolean): void {
    this.out({ t: 'ready', ready });
  }

  /** Host: start with `seed` once everyone is ready. */
  start(seed: number): void {
    this.out({ t: 'start', seed });
  }

  /** Host: game speed, 0 pauses (D15). */
  setSpeed(speed: number): void {
    this.out({ t: 'speed', speed });
  }

  chat(text: string): void {
    this.out({ t: 'chat', text });
  }

  ping(lat: number, lon: number): void {
    this.out({ t: 'ping', lat, lon });
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  private out(message: ClientMessage): void {
    const socket = this.socket;
    if (socket && socket.readyState === 1) socket.send(JSON.stringify(message));
  }

  private request(message: ClientMessage, wants: ServerMessage['t']): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.expect(wants, resolve, reject);
      this.out(message);
    });
  }

  private expect(wants: ServerMessage['t'], resolve: (value: unknown) => void, reject: (error: Error) => void): void {
    this.pendingReply = { wants, resolve, reject };
  }

  private fail(error: Error, reject?: (error: Error) => void): void {
    const pending = this.pendingReply;
    this.pendingReply = null;
    if (pending) pending.reject(error);
    else reject?.(error);
  }

  private settle(t: ServerMessage['t'], value: unknown): void {
    const pending = this.pendingReply;
    if (pending?.wants !== t) return;
    this.pendingReply = null;
    pending.resolve(value);
  }

  private receive(text: string): void {
    let message: ServerMessage;
    try {
      message = JSON.parse(text) as ServerMessage;
    } catch {
      return;
    }
    switch (message.t) {
      case 'welcome':
        this.playerId = message.playerId;
        return this.settle('welcome', message.playerId);
      case 'refused':
        if (this.pendingReply) return this.fail(new CoopRefusedError(message.reason));
        return this.onRefused?.(message.reason);
      case 'room':
        this.room = message.room;
        this.onRoom?.(message.room);
        return this.settle('room', message.room);
      case 'world':
        this.world = message.world;
        return this.onWorld?.(message.world);
      case 'started': {
        const link = new WebSocketLink(this.playerId!, (m) => this.out(m));
        this.linkNow = link;
        return this.onStarted?.({
          seed: message.seed,
          players: message.players,
          lanes: new Map(message.lanes),
          localId: this.playerId!,
          speed: message.speed,
          link,
        });
      }
      case 'tick':
        return this.linkNow?.receive(message.tick, message.commands);
      case 'speed':
        return this.onSpeed?.(message.speed);
      case 'rtt':
        return this.onRtt?.(message.rtt);
      case 'waiting':
        return this.onWaiting?.(message.playerId);
      case 'host':
        if (this.room) this.room = { ...this.room, hostId: message.hostId };
        return this.onHost?.(message.hostId);
      case 'left':
        return this.onLeft?.(message.playerId);
      case 'chat':
        return this.onChat?.(message.from, message.text);
      case 'ping':
        return this.onPing?.(message.from, message.lat, message.lon);
      case 'desync':
        return this.onDesync?.(message.tick, message.hashes);
    }
  }
}
