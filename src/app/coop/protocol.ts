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
import type { CoopRoomOptions } from './room-options';

/**
 * Bumped whenever a message changes shape; client and relay must agree.
 * Back to 1 before the first release (User, 2026-09-25): the numbers up to
 * then were development steps only.
 */
export const PROTOCOL_VERSION = 1;

/** Players per room at most (D16). */
export const MAX_PLAYERS = 4;

/**
 * What a player's client is doing in the lobby, as it tells the room (User,
 * 2026-09-25): entering a map key, loading the host's map, reloading the page
 * for a new place, or the map stands. Null before it said anything.
 */
export type PlayerStatus = 'key' | 'loading' | 'reloading' | 'ready';
export const PLAYER_STATUSES: readonly PlayerStatus[] = ['key', 'loading', 'reloading', 'ready'];

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
  /** What their client is doing (lobby), null before it said */
  status: PlayerStatus | null;
}

/** Longest room title (D63) */
export const TITLE_MAX = 32;

/**
 * How a room shows in the lobby's public list (D62, D63): whether it does,
 * its title and the host's city. Never a street: the client sends city and
 * country only.
 */
export interface RoomListing {
  public: boolean;
  title: string;
  city: string;
}

/** A room as the public list shows it to someone not in it (D63). */
export interface PublicRoom {
  code: string;
  title: string;
  host: string;
  city: string;
  players: number;
  started: boolean;
  /** Waves started so far, 0 in the lobby */
  wave: number;
  /** Cheats may act in that room */
  cheats: boolean;
  gameVersion: string;
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
  /** The host closed the room to further players */
  locked: boolean;
  /** What the host set for the room (coop/room-options.ts, D38) */
  options: CoopRoomOptions;
  /** How it shows in the public list (D62) */
  listing: RoomListing;
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
  | 'alone'
  /** The relay holds as many rooms as it takes (review R18) */
  | 'busy'
  /** The host took this player out of the room (review R9) */
  | 'kicked'
  /** The host closed the room to further players (review R9) */
  | 'locked';

export type ClientMessage =
  /** First message: who is there and with what game */
  | { t: 'hello'; protocol: number; name: string; gameVersion: string; configHash: string; client?: ClientInfo }
  /** Open a room and be its host */
  | { t: 'create' }
  | { t: 'join'; room: string }
  /** Host: the room's world (coop/world-package.ts) and its spawn points */
  | { t: 'world'; world: unknown; spawnIds: string[] }
  /** Host, lobby: the map is changing here, a new world follows (PLAYTEST T25) */
  | { t: 'moving' }
  /** Lobby: what this client is doing now (PlayerStatus) */
  | { t: 'status'; status: PlayerStatus }
  /** Lobby: take a spawn as one's lane, or give it back (null) */
  | { t: 'pick'; spawnId: string | null }
  /** Lobby: another name; the relay numbers it where someone has it already */
  | { t: 'rename'; name: string }
  /** Host, lobby: take a player out of the room (review R9) */
  | { t: 'kick'; playerId: string }
  /** Host: no further players may join (review R9) */
  | { t: 'lock'; locked: boolean }
  /** Host: the room in the public list or not, its title, the city (D62, D63) */
  | { t: 'listing'; listing: RoomListing }
  /** Not in a room: the public rooms of this relay (D62) */
  | { t: 'rooms' }
  /** Host, lobby: the room's options (D38); the guests' ready falls */
  | { t: 'options'; options: CoopRoomOptions }
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
  /** A mark on the map for the others (D25, review R13); height of the ground there */
  | { t: 'ping'; lat: number; lon: number; height: number };

export type ServerMessage =
  | { t: 'welcome'; playerId: string }
  /** `hostVersion` with 'version': the game version the host runs (D60) */
  | { t: 'refused'; reason: RefusalReason; hostVersion?: string }
  | { t: 'room'; room: CoopRoomInfo }
  /** The host's world, to a player who joins or when the host sends it */
  | { t: 'world'; world: unknown }
  /** Lobby: the host changes the map, its world follows */
  | { t: 'moving' }
  /** The game starts: seed, roster and lanes; ticks follow */
  | {
    t: 'started';
    seed: number;
    players: string[];
    lanes: [string, string][];
    speed: number;
    /** The host at the start and the room's options: the cheat rule acts alike on every client */
    hostId: string;
    options: CoopRoomOptions;
  }
  /** A closed tick with the commands that act at it */
  | { t: 'tick'; tick: number; commands: StampedCommand[] }
  /** The simulations ran apart: the first tick with different hashes, player id and hash each (C5) */
  /** `outOfStep`: who is off the majority's hash, from three players on (S3); empty without one */
  | { t: 'desync'; tick: number; hashes: [string, number][]; outOfStep: string[] }
  | { t: 'speed'; speed: number }
  | { t: 'chat'; from: string; text: string }
  | { t: 'ping'; from: string; lat: number; lon: number; height: number }
  /** A player left; in the game their lane closes with the command:leave-game the relay puts in a tick */
  | { t: 'left'; playerId: string }
  /** The host changed (D22) */
  | { t: 'host'; hostId: string }
  /** In the game: the room waits for this player to catch up (review R2); null once it goes on */
  | { t: 'waiting'; playerId: string | null }
  /** Each player's round trip to the relay, ms, null before the first; every few seconds */
  | { t: 'rtt'; rtt: [string, number | null][] }
  /** The public rooms, answer to `rooms` */
  | { t: 'rooms'; rooms: PublicRoom[] };
