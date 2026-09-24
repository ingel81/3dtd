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
 * Pure: messages come in through receive(), go out through `send`, time
 * comes in through advance(). The server (server.ts) wires sockets and a
 * timer to it; the spec drives it by hand.
 */
import type {
  ClientMessage,
  CoopPlayerInfo,
  CoopRoomInfo,
  RefusalReason,
  ServerMessage,
} from '../../src/app/coop/protocol.ts';
import type { StampedCommand } from '../../src/app/coop/lockstep.ts';
import { MAX_PLAYERS } from '../../src/app/coop/protocol.ts';
import { TICK_SUB_STEPS } from '../../src/app/coop/lockstep.ts';
import { GameClock } from '../../src/app/managers/game-state/game-clock.ts';

/** Game time one tick stands for, ms. */
export const TICK_MS = TICK_SUB_STEPS * GameClock.FIXED_STEP_MS;

/** Longest real time advance() catches up at once, ms: a stalled timer does not flood the clients. */
const MAX_ADVANCE_MS = 1000;

/** Game speeds the host may set; 0 pauses. */
const SPEEDS = new Set([0, 0.5, 1, 2, 3, 4]);

export interface RoomPlayer {
  id: string;
  name: string;
  gameVersion: string;
  configHash: string;
}

type Send = (playerId: string, message: ServerMessage) => void;

export class Room {
  private readonly players: (CoopPlayerInfo & { gameVersion: string; configHash: string })[] = [];
  private hostId: string;
  private world: unknown = null;
  private spawnIds: string[] = [];
  private started = false;

  private speed = 1;
  private nextTick = 0;
  private open: { playerId: string; command: StampedCommand['command'] }[] = [];
  private seq = 0;
  /** Game time run up and not yet closed into a tick, ms */
  private pending = 0;

  readonly code: string;
  private readonly send: Send;

  constructor(code: string, host: RoomPlayer, send: Send) {
    this.code = code;
    this.send = send;
    this.hostId = host.id;
    this.players.push({ ...host, spawnId: null, ready: false });
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
    if (this.players.length >= MAX_PLAYERS) return 'full';
    const host = this.players.find((p) => p.id === this.hostId)!;
    if (player.gameVersion !== host.gameVersion) return 'version';
    if (player.configHash !== host.configHash) return 'balance';
    this.players.push({ ...player, spawnId: null, ready: false });
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
  leave(playerId: string): void {
    const index = this.players.findIndex((p) => p.id === playerId);
    if (index < 0) return;
    this.players.splice(index, 1);
    if (this.started) this.open.push({ playerId, command: { type: 'command:leave-game' } });
    this.broadcast({ t: 'left', playerId });
    if (playerId === this.hostId && this.players.length > 0) {
      this.hostId = this.players[0].id;
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
        return this.broadcastRoom();
      }
      case 'ready':
        if (this.started) return;
        player.ready = message.ready && player.spawnId !== null;
        return this.broadcastRoom();
      case 'start':
        if (!host) return this.refuse(playerId, 'not-host');
        if (this.started) return this.refuse(playerId, 'started');
        if (this.world === null || this.players.some((p) => p.spawnId === null || !p.ready)) {
          return this.refuse(playerId, 'not-ready');
        }
        this.started = true;
        this.pending = 0;
        this.broadcast({
          t: 'started',
          seed: message.seed >>> 0,
          players: this.players.map((p) => p.id),
          lanes: this.players.map((p) => [p.id, p.spawnId!]),
          speed: this.speed,
        });
        return this.broadcastRoom();
      case 'cmd':
        if (!this.started) return;
        this.open.push({ playerId, command: message.command });
        return;
      case 'speed':
        if (!host) return this.refuse(playerId, 'not-host');
        if (!SPEEDS.has(message.speed)) return;
        this.speed = message.speed;
        return this.broadcast({ t: 'speed', speed: this.speed });
      case 'chat':
        return this.broadcast({ t: 'chat', from: playerId, text: message.text.slice(0, 500) });
      case 'ping':
        return this.broadcast({ t: 'ping', from: playerId, lat: message.lat, lon: message.lon });
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
    this.pending += Math.min(realMs, MAX_ADVANCE_MS) * this.speed;
    let closed = 0;
    while (this.pending >= TICK_MS) {
      this.pending -= TICK_MS;
      this.closeTick();
      closed++;
    }
    return closed;
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
    this.broadcast({ t: 'tick', tick, commands });
  }

  info(): CoopRoomInfo {
    return {
      code: this.code,
      hostId: this.hostId,
      players: this.players.map(({ id, name, spawnId, ready }) => ({ id, name, spawnId, ready })),
      spawnIds: [...this.spawnIds],
      started: this.started,
    };
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
