/**
 * The messages between a coop client and the relay (docs/COOP_PLAN.md, C4),
 * JSON over one WebSocket. Types only: the relay (coop-server/) imports
 * them as types, so nothing here may need a runtime import.
 *
 * The relay knows rooms, players and ticks, nothing of the game: the
 * world package and the commands pass through it as opaque data.
 */
import type { LockstepStatsReport } from './lockstep-stats';
import type { StampedCommand } from './lockstep';
import type { ClientInfo } from './client-info';

/** Bumped whenever a message changes shape; client and relay must agree. */
export const PROTOCOL_VERSION = 5;

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
  /** What they play with (browser or desktop build, version, system); null when the client did not say */
  client: ClientInfo | null;
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
  /** The relay lets the dev tools' cheats (debug:* commands) through; they act on every client alike */
  cheats: boolean;
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
  | 'not-ready'
  /** A coop game needs a second player (User, 2026-09-24) */
  | 'alone';

export type ClientMessage =
  /** First message: who is there and with what game */
  | { t: 'hello'; protocol: number; name: string; gameVersion: string; configHash: string; client?: ClientInfo }
  /** Open a room and be its host */
  | { t: 'create' }
  | { t: 'join'; room: string }
  /** Host: the room's world (coop/world-package.ts) and its spawn points */
  | { t: 'world'; world: unknown; spawnIds: string[] }
  /** Lobby: take a spawn as one's lane, or give it back (null) */
  | { t: 'pick'; spawnId: string | null }
  /** Lobby: another name; the relay numbers it where someone has it already */
  | { t: 'rename'; name: string }
  | { t: 'ready'; ready: boolean }
  /** Host: start the game once everyone has a lane and is ready */
  | { t: 'start'; seed: number }
  /** In the game: a command, stamped into the next tick by the relay */
  | { t: 'cmd'; command: StampedCommand['command'] }
  /** In the game: the state hash at the boundary of `tick`, every HASH_EVERY_TICKS ticks (C5) */
  | { t: 'hash'; tick: number; hash: number }
  /** In the game: how smoothly this client runs, every REPORT_EVERY_MS (coop/lockstep-stats.ts) */
  | { t: 'stats'; stats: LockstepStatsReport }
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
  /** The simulations ran apart: the first tick with different hashes, player id and hash each (C5) */
  | { t: 'desync'; tick: number; hashes: [string, number][] }
  | { t: 'speed'; speed: number }
  | { t: 'chat'; from: string; text: string }
  | { t: 'ping'; from: string; lat: number; lon: number }
  /** A player left; in the game their lane closes with the command:leave-game the relay puts in a tick */
  | { t: 'left'; playerId: string }
  /** The host changed (D22) */
  | { t: 'host'; hostId: string }
  /** Each player's round trip to the relay, ms, null before the first; every few seconds */
  | { t: 'rtt'; rtt: [string, number | null][] };
