/**
 * The messages between a coop client and the relay (docs/COOP_PLAN.md, C4),
 * JSON over one WebSocket. Types only: the relay (coop-server/) imports
 * them as types, so nothing here may need a runtime import.
 *
 * The relay knows rooms, players and ticks, nothing of the game: the
 * world package and the commands pass through it as opaque data.
 */
import type { StampedCommand } from './lockstep';

/** Bumped whenever a message changes shape; client and relay must agree. */
export const PROTOCOL_VERSION = 1;

/** Players per room at most (D16). */
export const MAX_PLAYERS = 4;

/** A player as the lobby shows them. */
export interface CoopPlayerInfo {
  id: string;
  name: string;
  /** The spawn they picked as their lane, null before they did */
  spawnId: string | null;
  /** Ready to start (lobby) */
  ready: boolean;
}

/** What a room looks like to everyone in it. */
export interface CoopRoomInfo {
  code: string;
  hostId: string;
  /** In the order they joined; the roster order of the game */
  players: CoopPlayerInfo[];
  /** The spawn points of the host's world, the lanes to pick from; empty until the host sent it */
  spawnIds: string[];
  started: boolean;
}

export type RefusalReason =
  | 'protocol'
  | 'version'
  | 'balance'
  | 'no-room'
  | 'full'
  | 'started'
  | 'not-host'
  | 'lane-taken'
  | 'not-ready';

export type ClientMessage =
  /** First message: who is there and with what game */
  | { t: 'hello'; protocol: number; name: string; gameVersion: string; configHash: string }
  /** Open a room and be its host */
  | { t: 'create' }
  | { t: 'join'; room: string }
  /** Host: the room's world (coop/world-package.ts) and its spawn points */
  | { t: 'world'; world: unknown; spawnIds: string[] }
  /** Lobby: take a spawn as one's lane, or give it back (null) */
  | { t: 'pick'; spawnId: string | null }
  | { t: 'ready'; ready: boolean }
  /** Host: start the game once everyone has a lane and is ready */
  | { t: 'start'; seed: number }
  /** In the game: a command, stamped into the next tick by the relay */
  | { t: 'cmd'; command: StampedCommand['command'] }
  /** Host: game speed; 0 pauses */
  | { t: 'speed'; speed: number }
  | { t: 'chat'; text: string }
  | { t: 'ping'; lat: number; lon: number };

export type ServerMessage =
  | { t: 'welcome'; playerId: string }
  | { t: 'refused'; reason: RefusalReason }
  | { t: 'room'; room: CoopRoomInfo }
  /** The host's world, to a player who joins or when the host sends it */
  | { t: 'world'; world: unknown }
  /** The game starts: seed, roster and lanes; ticks follow */
  | { t: 'started'; seed: number; players: string[]; lanes: [string, string][]; speed: number }
  /** A closed tick with the commands that act at it */
  | { t: 'tick'; tick: number; commands: StampedCommand[] }
  | { t: 'speed'; speed: number }
  | { t: 'chat'; from: string; text: string }
  | { t: 'ping'; from: string; lat: number; lon: number }
  /** A player left; in the game their lane closes with the command:leave-game the relay puts in a tick */
  | { t: 'left'; playerId: string }
  /** The host changed (D22) */
  | { t: 'host'; hostId: string };
