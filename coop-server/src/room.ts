/**
 * One coop room of the relay (docs/COOP_PLAN.md, C4): lobby, then the game.
 *
 * In the lobby the host sends the world, everyone picks a spawn as their
 * lane and says ready, the host starts. In the game the room stamps every
 * command into the next open tick and closes ticks at the room's pace: one
 * tick is TICK_SUB_STEPS sub-steps of game time, so at speed 2 ticks close
 * twice as fast. A client never runs past a tick that is not closed (the
 * barrier in the GameStateManager), so the next open tick is always safe
 * to put a command in.
 *
 * In the game every client reports its state hash every HASH_EVERY_TICKS
 * ticks; the room compares them (HashCheck) and tells everyone the first
 * tick where they differ (C5).
 *
 * Pure: messages come in through receive(), go out through `send`, time
 * comes in through advance(). The server (server.ts) wires sockets and a
 * timer to it; the spec drives it by hand. What happens goes to `log`, one
 * line per event, for the diagnosis of a run (C5).
 */
import { statsLine } from '../../src/app/coop/lockstep-stats.ts';
import type {
  ClientMessage,
  CoopPlayerInfo,
  CoopRoomInfo,
  PlayerStatus,
  RefusalReason,
  ServerMessage,
} from '../../src/app/coop/protocol.ts';
import type { StampedCommand } from '../../src/app/coop/lockstep.ts';
import { MAX_PLAYERS, PLAYER_STATUSES } from '../../src/app/coop/protocol.ts';
import { TICK_SUB_STEPS } from '../../src/app/coop/lockstep.ts';
import { GameClock } from '../../src/app/managers/game-state/game-clock.ts';
import { HashCheck, HASH_EVERY_TICKS } from '../../src/app/coop/hash-check.ts';
import { clientLabel, type ClientInfo } from '../../src/app/coop/client-info.ts';
import {
  DEFAULT_ROOM_OPTIONS,
  changedOptions,
  mayCheat,
  mayPause,
  optionLabel,
  validOptions,
  type CoopRoomOptions,
} from '../../src/app/coop/room-options.ts';

/** Game time one tick stands for, ms. */
export const TICK_MS = TICK_SUB_STEPS * GameClock.FIXED_STEP_MS;

/**
 * Ticks the relay runs past the slowest client's last hash report at most
 * (review R2): 3 game seconds. A client reports every HASH_EVERY_TICKS, so
 * the room stops closing ticks once one is about 3 to 4 s behind, and goes
 * on when they caught up.
 */
export const MAX_AHEAD_TICKS = 3 * HASH_EVERY_TICKS;

/** Longest real time advance() catches up at once, ms: a stalled timer does not flood the clients. */
const MAX_ADVANCE_MS = 1000;

/** Game speeds the host may set; 0 pauses. */
const SPEEDS = new Set([0, 0.5, 1, 2, 3, 4]);
/** A player's status as the log says it */
const STATUS_LOG: Record<PlayerStatus, string> = {
  key: 'enters a map key',
  loading: 'loads the map',
  reloading: 'reloads for a new place',
  ready: 'has the map',
};
/** Commands kept to log with the first desync */
const RECENT_COMMANDS = 40;

export interface RoomPlayer {
  id: string;
  name: string;
  gameVersion: string;
  configHash: string;
  client?: ClientInfo | null;
}

type Send = (playerId: string, message: ServerMessage) => void;

export interface RoomOptions {
  /** One line per event, without the room code (the server puts it in front) */
  log?: (line: string) => void;
  /** Wall clock, ms */
  now?: () => number;
  /** Let the dev tools' cheats (debug:* commands) through; off by default */
  cheats?: boolean;
}

/** A room as the status page and the relay's status line show it. */
export interface RoomStatus {
  code: string;
  hostId: string;
  /** The host's game version, which every guest must have */
  gameVersion: string;
  started: boolean;
  /** Closed to new players by the host */
  locked: boolean;
  speed: number;
  /** The last tick closed, -1 before the first */
  tick: number;
  ageMs: number;
  /** Commands stamped since the start */
  commands: number;
  /** Hash reports that disagreed, the first one included */
  desyncs: number;
  /** The first tick with different hashes, null while none */
  firstDesync: number | null;
  players: {
    id: string;
    name: string;
    spawnId: string | null;
    ready: boolean;
    client: ClientInfo | null;
    /** The last hash the player reported, null before the first */
    lastHash: { tick: number; hash: number } | null;
  }[];
}

export class Room {
  private readonly players: (Omit<CoopPlayerInfo, 'client'> & { client: ClientInfo | null; gameVersion: string; configHash: string })[] = [];
  private hostId: string;
  private world: unknown = null;
  private spawnIds: string[] = [];
  private started = false;

  private speed = 1;
  /** No further players may join (review R9) */
  private locked = false;
  /** What the host set for the room (D38) */
  private options: CoopRoomOptions = { ...DEFAULT_ROOM_OPTIONS };
  /** The player the room waits for to catch up (MAX_AHEAD_TICKS), null while none */
  private waitingFor: string | null = null;
  /** The speed a resume goes back to: the last one that was not 0 */
  private resumeSpeed = 1;
  private nextTick = 0;
  private open: { playerId: string; command: StampedCommand['command'] }[] = [];
  private seq = 0;
  /** Game time run up and not yet closed into a tick, ms */
  private pending = 0;

  private readonly hashCheck = new HashCheck();
  private commandCount = 0;
  /** The last RECENT_COMMANDS commands, logged with the first desync to find its cause */
  private readonly recent: StampedCommand[] = [];
  private desyncCount = 0;
  private firstDesync: number | null = null;

  readonly code: string;
  private readonly send: Send;
  private readonly log: (line: string) => void;
  private readonly now: () => number;
  private readonly createdAt: number;
  private readonly cheats: boolean;

  constructor(code: string, host: RoomPlayer, send: Send, options: RoomOptions = {}) {
    this.code = code;
    this.send = send;
    this.log = options.log ?? (() => undefined);
    this.now = options.now ?? (() => performance.now());
    this.createdAt = this.now();
    this.cheats = options.cheats ?? false;
    this.hostId = host.id;
    this.players.push({ ...host, client: host.client ?? null, spawnId: null, ready: false, status: null });
    this.log(`opened by ${this.who(host.id)}, game ${host.gameVersion}, balance ${host.configHash}${this.clientOf(host.id)}`
      + `${this.cheats ? ', cheats allowed' : ''}`);
    this.broadcastRoom();
  }

  get isEmpty(): boolean {
    return this.players.length === 0;
  }

  get isStarted(): boolean {
    return this.started;
  }

  /** The last tick closed; -1 before the first. */
  get lastTick(): number {
    return this.nextTick - 1;
  }

  /** A player joins the lobby; refused when full, started or with another game or balance. */
  join(player: RoomPlayer): RefusalReason | null {
    if (this.players.some((p) => p.id === player.id)) return null;
    if (this.started) return 'started';
    if (this.locked) return 'locked';
    if (this.players.length >= MAX_PLAYERS) return 'full';
    const host = this.players.find((p) => p.id === this.hostId)!;
    if (player.gameVersion !== host.gameVersion) return 'version';
    if (player.configHash !== host.configHash) return 'balance';
    this.players.push({ ...player, client: player.client ?? null, name: this.freeName(player.name), spawnId: null, ready: false, status: null });
    this.log(`${this.who(player.id)} joined (${this.players.length} players)${this.clientOf(player.id)}`);
    if (this.world !== null) this.send(player.id, { t: 'world', world: this.world });
    this.broadcastRoom();
    return null;
  }

  /**
   * A player is gone. In the lobby they just leave; in the game their lane
   * closes: the room puts a command:leave-game from them into the next tick,
   * so every client closes it at the same boundary. The host goes to the
   * next player in join order (D22).
   */
  leave(playerId: string, reason = 'closed'): void {
    const index = this.players.findIndex((p) => p.id === playerId);
    if (index < 0) return;
    this.log(`${this.who(playerId)} left (${reason})${this.started ? `, lane closes after tick ${this.lastTick}` : ''}`);
    this.players.splice(index, 1);
    if (this.started) this.open.push({ playerId, command: { type: 'command:leave-game' } });
    this.broadcast({ t: 'left', playerId });
    if (playerId === this.hostId && this.players.length > 0) {
      this.hostId = this.players[0].id;
      this.log(`host is now ${this.who(this.hostId)}`);
      this.broadcast({ t: 'host', hostId: this.hostId });
    }
    if (this.players.length > 0) this.broadcastRoom();
  }

  receive(playerId: string, message: ClientMessage): void {
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return;
    const host = playerId === this.hostId;
    switch (message.t) {
      case 'world':
        if (!host) return this.refuse(playerId, 'not-host');
        if (this.started) return this.refuse(playerId, 'started');
        this.world = message.world;
        this.spawnIds = [...message.spawnIds];
        // Another map: the lanes stay where they still exist, ready is asked again
        for (const p of this.players) if (p.id !== this.hostId) p.ready = false;
        this.log(`world from the host, ${Math.round(JSON.stringify(this.world).length / 1024)} kB, spawns ${this.spawnIds.join(', ') || 'none'}`);
        for (const p of this.players) {
          if (p.spawnId !== null && !this.spawnIds.includes(p.spawnId)) p.spawnId = null;
          if (p.id !== playerId) this.send(p.id, { t: 'world', world: this.world });
        }
        return this.broadcastRoom();
      case 'pick': {
        if (this.started) return this.refuse(playerId, 'started');
        const spawnId = message.spawnId;
        if (spawnId !== null) {
          if (!this.spawnIds.includes(spawnId) || this.players.some((p) => p.id !== playerId && p.spawnId === spawnId)) {
            return this.refuse(playerId, 'lane-taken');
          }
        }
        player.spawnId = spawnId;
        if (spawnId === null) player.ready = false;
        this.log(`${this.who(playerId)} ${spawnId === null ? 'gave the lane back' : `took lane ${spawnId}`}`);
        return this.broadcastRoom();
      }
      case 'kick': {
        if (!host) return this.refuse(playerId, 'not-host');
        if (this.started || message.playerId === playerId || !this.players.some((p) => p.id === message.playerId)) return;
        this.send(message.playerId, { t: 'refused', reason: 'kicked' });
        return this.leave(message.playerId, `taken out by ${this.who(playerId)}`);
      }
      case 'moving':
        // The guests learn before the new world comes (PLAYTEST T25)
        if (!host) return this.refuse(playerId, 'not-host');
        if (this.started) return;
        for (const p of this.players) if (p.id !== playerId) this.send(p.id, { t: 'moving' });
        return;
      case 'options': {
        if (!host) return this.refuse(playerId, 'not-host');
        if (this.started) return this.refuse(playerId, 'started');
        const options = validOptions(message.options);
        if (!options) return;
        const changed = changedOptions(this.options, options);
        if (changed.length === 0) return;
        this.options = options;
        // A change is asked again: every guest says ready anew (D38)
        for (const p of this.players) if (p.id !== this.hostId) p.ready = false;
        this.log(`options: ${changed.map((key) => `${key} ${optionLabel(key, options[key])}`).join(', ')}`);
        return this.broadcastRoom();
      }
      case 'status': {
        // What the client does (User, 2026-09-25): the others see it in the lobby
        if (this.started || !PLAYER_STATUSES.includes(message.status) || player.status === message.status) return;
        player.status = message.status as PlayerStatus;
        this.log(`${this.who(playerId)} ${STATUS_LOG[player.status]}`);
        return this.broadcastRoom();
      }
      case 'lock':
        if (!host) return this.refuse(playerId, 'not-host');
        if (this.locked === !!message.locked) return;
        this.locked = !!message.locked;
        this.log(this.locked ? 'closed to new players' : 'open to new players again');
        return this.broadcastRoom();
      case 'rename': {
        if (this.started) return this.refuse(playerId, 'started');
        const before = this.who(playerId);
        const name = String(message.name).trim().slice(0, 32);
        if (!name || name === player.name) return;
        player.name = this.freeName(name, playerId);
        this.log(`${before} is now ${player.name}`);
        return this.broadcastRoom();
      }
      case 'ready':
        if (this.started) return;
        player.ready = message.ready && player.spawnId !== null;
        this.log(`${this.who(playerId)} ${player.ready ? 'ready' : 'not ready'}`);
        return this.broadcastRoom();
      case 'start':
        if (!host) return this.refuse(playerId, 'not-host');
        if (this.started) return this.refuse(playerId, 'started');
        if (this.players.length < 2) return this.refuse(playerId, 'alone');
        // The host is always ready (D40); every guest says so
        if (this.world === null || this.players.some((p) => p.spawnId === null || (p.id !== this.hostId && !p.ready))) {
          return this.refuse(playerId, 'not-ready');
        }
        this.started = true;
        this.pending = 0;
        this.log(`started, seed ${message.seed >>> 0}, speed ${this.speed}, lanes ${this.players.map((p) => `${this.who(p.id)} on ${p.spawnId}`).join(', ')}`);
        this.broadcast({
          t: 'started',
          seed: message.seed >>> 0,
          players: this.players.map((p) => p.id),
          lanes: this.players.map((p) => [p.id, p.spawnId!]),
          speed: this.speed,
          hostId: this.hostId,
          options: { ...this.options },
        });
        return this.broadcastRoom();
      case 'cmd':
        // Game commands; the dev tools' debug:* only as the room's cheat rule lets them (D38)
        if (!this.started || typeof message.command?.type !== 'string' || !this.accepts(message.command.type, playerId)) return;
        this.open.push({ playerId, command: message.command });
        this.commandCount++;
        return;
      case 'hash':
        if (!this.started) return;
        return this.checkHash(playerId, message.tick, message.hash);
      case 'stats':
        if (!this.started || typeof message.stats?.frames !== 'number') return;
        return this.log(`stats ${this.who(playerId)}: ${statsLine(message.stats)}`);
      case 'speed': {
        if (!SPEEDS.has(message.speed)) return;
        // The speed is the host's; who may pause and resume at the room's speed, the room says (D38)
        const pauseOrResume = message.speed === 0 || (this.speed === 0 && message.speed === this.resumeSpeed);
        if (pauseOrResume ? !mayPause(this.options, host) : !host) return this.refuse(playerId, 'not-host');
        if (message.speed === this.speed) return;
        this.speed = message.speed;
        if (this.speed !== 0) this.resumeSpeed = this.speed;
        this.log(message.speed === 0 ? `paused by ${this.who(playerId)}` : `speed ${message.speed} (${this.who(playerId)})`);
        return this.broadcast({ t: 'speed', speed: this.speed });
      }
      case 'chat':
        return this.broadcast({ t: 'chat', from: playerId, text: message.text.slice(0, 500) });
      case 'ping':
        if (![message.lat, message.lon, message.height].every(Number.isFinite)) return;
        return this.broadcast({ t: 'ping', from: playerId, lat: message.lat, lon: message.lon, height: message.height });
      default:
        return;
    }
  }

  /**
   * `realMs` of wall clock went by: close as many ticks as that is game time
   * at the room's speed. None before the start or while paused.
   */
  advance(realMs: number): number {
    if (!this.started || this.speed === 0) return 0;
    // No further than MAX_AHEAD_TICKS past the slowest client (review R2):
    // the room waits for them rather than they trail on for good
    const slowest = this.slowestPlayer();
    const waitFor = slowest && this.nextTick - slowest.tick > MAX_AHEAD_TICKS ? slowest.id : null;
    if (waitFor !== this.waitingFor) {
      this.waitingFor = waitFor;
      if (waitFor) this.log(`waiting for ${this.who(waitFor)} to catch up`);
      this.broadcast({ t: 'waiting', playerId: waitFor });
    }
    if (waitFor) return 0;
    this.pending += Math.min(realMs, MAX_ADVANCE_MS) * this.speed;
    let closed = 0;
    while (this.pending >= TICK_MS) {
      this.pending -= TICK_MS;
      this.closeTick();
      closed++;
    }
    return closed;
  }

  /** The player whose last hash report is the oldest, with its tick (0 before any); null alone or empty */
  private slowestPlayer(): { id: string; tick: number } | null {
    let slowest: { id: string; tick: number } | null = null;
    for (const p of this.players) {
      const tick = this.hashCheck.last.get(p.id)?.tick ?? 0;
      if (!slowest || tick < slowest.tick) slowest = { id: p.id, tick };
    }
    return slowest;
  }

  /** Close the next tick with everything that came in since the last. */
  closeTick(): void {
    const tick = this.nextTick++;
    const commands: StampedCommand[] = this.open.map(({ playerId, command }) => ({
      tick,
      seq: this.seq++,
      playerId,
      command,
    }));
    this.open = [];
    this.recent.push(...commands);
    if (this.recent.length > RECENT_COMMANDS) this.recent.splice(0, this.recent.length - RECENT_COMMANDS);
    this.broadcast({ t: 'tick', tick, commands });
  }

  /**
   * A player's hash for `tick`. The first tick where two players differ
   * goes to everyone, with who is off the majority from three players on
   * (S3); later ones only count, since a divergence stays.
   */
  private checkHash(playerId: string, tick: number, hash: number): void {
    const divergence = this.hashCheck.report(tick, playerId, hash >>> 0, this.players.length);
    if (!divergence) return;
    this.desyncCount++;
    if (this.firstDesync !== null) return;
    this.firstDesync = divergence.tick;
    const hashes = divergence.hashes.map(([id, h]) => `${this.who(id)} ${hex(h)}`).join(', ');
    const off = divergence.outOfStep.map((id) => this.who(id)).join(', ');
    this.log(`DESYNC at tick ${divergence.tick}: ${hashes}${off ? `; out of step: ${off}` : ''}`);
    // What went in before it: most divergences follow a command acting apart
    const since = divergence.tick - 2 * HASH_EVERY_TICKS;
    for (const c of this.recent.filter((c) => c.tick >= since)) {
      this.log(`  command at tick ${c.tick} from ${this.who(c.playerId)}: ${JSON.stringify(c.command).slice(0, 300)}`);
    }
    this.broadcast({ t: 'desync', tick: divergence.tick, hashes: divergence.hashes, outOfStep: divergence.outOfStep });
  }

  status(): RoomStatus {
    return {
      code: this.code,
      hostId: this.hostId,
      gameVersion: this.players.find((p) => p.id === this.hostId)?.gameVersion ?? '',
      started: this.started,
      locked: this.locked,
      speed: this.speed,
      tick: this.lastTick,
      ageMs: this.now() - this.createdAt,
      commands: this.commandCount,
      desyncs: this.desyncCount,
      firstDesync: this.firstDesync,
      players: this.players.map(({ id, name, spawnId, ready, client }) => ({
        id, name, spawnId, ready, client, lastHash: this.hashCheck.last.get(id) ?? null,
      })),
    };
  }

  /** ", on Chrome 140, Windows" for the log; "" when the client did not say */
  private clientOf(playerId: string): string {
    const client = this.players.find((p) => p.id === playerId)?.client;
    return client ? `, on ${clientLabel(client)}` : '';
  }

  /** "Ann (p1)" for the log */
  who(playerId: string): string {
    const name = this.players.find((p) => p.id === playerId)?.name;
    return name ? `${name} (${playerId})` : playerId;
  }

  /** Tell everyone each player's round trip to the relay (`rttOf`, ms) */
  sendRtt(rttOf: (playerId: string) => number | null): void {
    this.broadcast({ t: 'rtt', rtt: this.players.map((p) => [p.id, rttOf(p.id)]) });
  }

  /** A game command, or a cheat where the relay and the room's rule let `playerId` use one */
  private accepts(type: string, playerId: string): boolean {
    return type.startsWith('command:')
      || (type.startsWith('debug:') && mayCheat(this.options, this.cheats, playerId, this.hostId));
  }

  info(): CoopRoomInfo {
    return {
      code: this.code,
      hostId: this.hostId,
      players: this.players.map(({ id, name, spawnId, ready, client, status }) => ({ id, name, spawnId, ready, client, status })),
      spawnIds: [...this.spawnIds],
      started: this.started,
      cheats: this.cheats,
      locked: this.locked,
      options: { ...this.options },
    };
  }

  /** `name`, or with a number after it when someone in the room has it already ("Joerg 2") */
  private freeName(name: string, self?: string): string {
    const taken = new Set(this.players.filter((p) => p.id !== self).map((p) => p.name));
    if (!taken.has(name)) return name;
    let n = 2;
    while (taken.has(`${name} ${n}`)) n++;
    return `${name} ${n}`;
  }

  private refuse(playerId: string, reason: RefusalReason): void {
    this.send(playerId, { t: 'refused', reason });
  }

  private broadcastRoom(): void {
    this.broadcast({ t: 'room', room: this.info() });
  }

  private broadcast(message: ServerMessage): void {
    for (const p of this.players) this.send(p.id, message);
  }
}

/** A hash as the log shows it, eight hex digits */
export function hex(hash: number): string {
  return (hash >>> 0).toString(16).padStart(8, '0');
}
