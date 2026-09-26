import type { CoopStatus } from '../../services/coop.service';
import { MAX_PLAYERS, type CoopRoomInfo, type PlayerStatus } from '../../coop/protocol';
import type { ClientInfo } from '../../coop/client-info';
import type { LaneStat } from '../../coop/lane-stats';
import { laneCss } from '../../coop/lane-color';
import { formatClock } from '../../utils/format-clock';

/**
 * What the coop dock shows, as pure functions of the room and the service's
 * state (docs/COOP_UI_REWORK_PLAN.md, P5): the joining steps, the status
 * line, why Start is off, the table of lanes and players, the banners. The
 * components only bind them.
 */

/** What a player's client is doing, in their row (User, 2026-09-25); 'ready' says nothing */
const STATUS_TEXT: Partial<Record<PlayerStatus, string>> = {
  key: 'Entering their map key…',
  loading: 'Loading the map…',
  reloading: 'Reloading for the new place…',
};

// ── Joining ──────────────────────────────────────────────────────────

export type JoinStepKind = 'server' | 'room' | 'map' | 'seat';

/** A step of joining a room as it goes (the guest's handshake) */
export interface JoinStep {
  kind: JoinStepKind;
  label: string;
  meta: string;
  state: 'done' | 'now' | 'todo';
}

export interface JoinInput {
  status: CoopStatus;
  room: CoopRoomInfo | null;
  /** The relay's name, empty before there is one */
  relay: string;
  /** Share of the loading screen's steps done, null while no place loads */
  mapPercent: number | null;
  worldReady: boolean;
  /** This player's lane, null without one */
  mySpawn: string | null;
}

export function joinSteps(i: JoinInput): JoinStep[] {
  const step = (kind: JoinStepKind, label: string, meta: string, done: boolean, now: boolean): JoinStep =>
    ({ kind, label, meta, state: done ? 'done' : now ? 'now' : 'todo' });
  return [
    step('server', 'Connected to server', i.relay, !!i.room || i.status === 'lobby', i.status === 'connecting'),
    step('room', 'Room found', i.room ? `${i.room.players.length}/${MAX_PLAYERS} players` : '', !!i.room, false),
    step('map', "Loading the host's map", i.mapPercent === null ? '' : `${i.mapPercent} %`, i.worldReady, i.status === 'loading-world'),
    step('seat', 'Taking a seat', '', !!i.mySpawn, i.worldReady),
  ];
}

// ── Status line, Start ───────────────────────────────────────────────

export interface RoomStatus {
  /** Everyone is ready: the line turns teal */
  go: boolean;
  /** One segment per player, on when ready; a free one while alone */
  segments: boolean[];
  lead: string;
  bold: string;
  text: string;
}

export interface StatusInput {
  room: CoopRoomInfo | null;
  isHost: boolean;
  myId: string | null;
  worldReady: boolean;
  hostName: string;
}

/** Every guest is ready; the host always is (D40) */
export function guestsReady(room: CoopRoomInfo): boolean {
  return room.players.every((p) => p.id === room.hostId || p.ready);
}

/** The status line: who we wait on, or that all are ready */
export function roomStatus(i: StatusInput): RoomStatus | null {
  const room = i.room;
  if (!room) return null;
  const line = (lead: string, bold: string, text: string, go = false) => ({ go, segments, lead, bold, text });
  const ready = room.players.filter((p) => p.id === room.hostId || p.ready).length;
  const segments = room.players.map((p) => p.id === room.hostId || p.ready);
  if (room.players.length < 2) {
    return { ...line('', '', 'Waiting for a second player · share the code'), segments: [...segments, false] };
  }
  if (!i.worldReady) return line('', '', i.isHost ? 'Sending the map…' : "Waiting for the host's map…");
  const busy = room.players.find((p) => p.id !== i.myId && (p.status === 'key' || p.status === 'loading' || p.status === 'reloading'));
  if (busy) {
    const what = busy.status === 'key' ? ' to enter their map key' : busy.status === 'reloading' ? ' to reload' : ' to load the map';
    return line('Waiting for ', busy.name, what);
  }
  const noLane = room.players.find((p) => p.spawnId === null);
  if (noLane) return line('Waiting for ', noLane.name, ' to take a lane');
  if (guestsReady(room)) {
    return i.isHost
      ? line('', 'Everyone is ready.', ' Start when you like.', true)
      : line('', "You're ready.", ` Waiting for ${i.hostName} to start.`, true);
  }
  const me = room.players.find((p) => p.id === i.myId);
  if (!i.isHost && !me?.ready) return line('Pick a lane, then ', 'ready up', '');
  const waiting = room.players.find((p) => p.id !== room.hostId && !p.ready)!;
  return line('Waiting for ', waiting.name, ` to ready up (${ready}/${room.players.length})`);
}

/** Why Start is off, for its tooltip; null when it can start */
export function startBlocked(room: CoopRoomInfo | null, worldReady: boolean): string | null {
  if (!room) return 'No room';
  if (room.players.length < 2) return 'Needs a second player';
  if (!worldReady) return 'The map is still being sent';
  const waiting = room.players.find((p) => p.spawnId === null || (p.id !== room.hostId && !p.ready));
  return waiting ? `Waiting for ${waiting.name}` : null;
}

// ── Lanes and players, one table ─────────────────────────────────────

/** A player in the room table */
export interface SeatPlayer {
  id: string;
  name: string;
  me: boolean;
  host: boolean;
  /** The host always is (D40) */
  ready: boolean;
  /** What their client is doing in the lobby: loading, entering a key; null when nothing to say */
  doing: string | null;
  client: ClientInfo | null;
  latency: number | null;
  lagging: boolean;
  left: boolean;
}

/** A lane of the room with the player on it, null when free */
export interface LaneRow {
  spawnId: string;
  index: number;
  label: string;
  color: string;
  /** Length over the longest lane's, 0 to 1 */
  share: number;
  /** "820 m · 3:47", empty before the routes stand */
  length: string;
  player: SeatPlayer | null;
}

export interface TableInput {
  room: CoopRoomInfo;
  myId: string | null;
  lanes: ReadonlyMap<string, LaneStat>;
  latencyOf: (id: string) => number | null;
  laggingOf: (id: string) => boolean;
  leftIds: ReadonlySet<string>;
}

/**
 * One row per lane with its player (plan U4): the lane showed its owner and
 * the player their lane, twice the same. Players without a lane come after.
 */
export function roomTable(i: TableInput): { lanes: LaneRow[]; seatless: SeatPlayer[] } {
  const { room } = i;
  const seat = (p: CoopRoomInfo['players'][number]): SeatPlayer => ({
    id: p.id,
    name: p.name,
    me: p.id === i.myId,
    host: p.id === room.hostId,
    ready: p.id === room.hostId || p.ready,
    doing: p.status ? STATUS_TEXT[p.status] ?? null : null,
    client: p.client,
    latency: i.latencyOf(p.id),
    lagging: i.laggingOf(p.id),
    left: i.leftIds.has(p.id),
  });
  const lanes = room.spawnIds.map((spawnId, index): LaneRow => {
    const owner = room.players.find((p) => p.spawnId === spawnId);
    const stat = i.lanes.get(spawnId);
    return {
      spawnId,
      index,
      label: `Spawn ${index + 1}`,
      color: laneCss(index),
      share: stat?.share ?? 0,
      length: stat ? `${stat.meters} m · ${formatClock(stat.seconds * 1000)}` : '',
      player: owner ? seat(owner) : null,
    };
  });
  const seatless = room.players.filter((p) => p.spawnId === null || !room.spawnIds.includes(p.spawnId)).map(seat);
  return { lanes, seatless };
}

// ── Banners ──────────────────────────────────────────────────────────

export interface DockBanner {
  kind: 'desync' | 'map' | 'engines';
  warn: boolean;
  text: string;
}

export interface BannerInput {
  /** The desync line, null while in step */
  desync: string | null;
  hostChangingMap: boolean;
  mixedEngines: boolean;
}

/** What the dock warns about, the worst first; the dock shows the first and folds the rest (plan G7) */
export function dockBanners(i: BannerInput): DockBanner[] {
  const banners: DockBanner[] = [];
  if (i.desync) banners.push({ kind: 'desync', warn: true, text: i.desync });
  if (i.mixedEngines) {
    banners.push({
      kind: 'engines',
      warn: true,
      text: 'Not everyone plays on the same engine (Chrome and Firefox, say). They compute the game slightly differently and drift apart after a while.',
    });
  }
  if (i.hostChangingMap) banners.push({ kind: 'map', warn: false, text: 'The host is changing the map; it loads here once it stands…' });
  return banners;
}

/** "Bob's game ran apart from the others at game second 94: …" */
export function desyncText(outOfStep: readonly string[], second: string, myId: string | null, nameOf: (id: string) => string): string {
  const who = myId !== null && outOfStep.includes(myId)
    ? 'Your game ran apart from the others'
    : outOfStep.length
      ? `${outOfStep.map(nameOf).join(' and ')}'s game ran apart from the others`
      : 'The games ran apart';
  return `${who} at game second ${second}: from there on, what you see may differ from what the others see.`;
}
