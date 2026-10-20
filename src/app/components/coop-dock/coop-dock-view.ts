import type { CoopStatus } from '../../services/coop.service';
import type { VacantLanes } from '../../world/custom-map/lane-choice';
import { MAX_PLAYERS, type CoopRoomInfo, type PlayerStatus } from '../../coop/protocol';
import type { ClientInfo } from '../../coop/client-info';
import type { LaneStat } from '../../coop/lane-stats';
import { laneCss } from '../../coop/lane-color';
import { formatClock } from '../../utils/format-clock';
import type { Messages } from '../../i18n/messages/en';
import { splitBold } from '../../i18n/format';

/**
 * What the coop dock shows, as pure functions of the room and the service's
 * state (docs/archive/COOP_UI_REWORK_PLAN.md, P5): the joining steps, the status
 * line, why Start is off, the table of lanes and players, the banners. The
 * components only bind them; the words are the player's language's
 * (`coop.dock`).
 */

/** What a player's client is doing, in their row (User, 2026-09-25); 'ready' says nothing */
function statusText(t: Messages, status: PlayerStatus): string | null {
  return status === 'ready' ? null : t.coop.dock.doing[status];
}

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
  /** Pieces of the host's custom map here so far, while they come through the relay */
  mapReceived?: { done: number; total: number } | null;
  worldReady: boolean;
  /** This player's lane, null without one */
  mySpawn: string | null;
}

/** Share of a map transfer done, whole percent */
export function transferPercent(t: { done: number; total: number }): number {
  return t.total > 0 ? Math.round((t.done / t.total) * 100) : 0;
}

export function joinSteps(t: Messages, i: JoinInput): JoinStep[] {
  const w = t.coop.dock.join;
  const step = (kind: JoinStepKind, label: string, meta: string, done: boolean, now: boolean): JoinStep =>
    ({ kind, label, meta, state: done ? 'done' : now ? 'now' : 'todo' });
  const mapMeta = i.mapReceived ? w.receiving(transferPercent(i.mapReceived)) : i.mapPercent === null ? '' : t.units.percent(i.mapPercent);
  return [
    step('server', w.server, i.relay, !!i.room || i.status === 'lobby', i.status === 'connecting'),
    step('room', w.room, i.room ? w.players(i.room.players.length, MAX_PLAYERS) : '', !!i.room, false),
    step('map', w.map, mapMeta, i.worldReady, i.status === 'loading-world' || !!i.mapReceived),
    step('seat', w.seat, '', !!i.mySpawn, i.worldReady),
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
  /** The map's rule for lanes nobody holds (TODO E130); null or missing: every lane needs a player */
  vacant?: VacantLanes | null;
  /** Host: pieces of its custom map through the relay so far, while they go */
  mapSending?: { done: number; total: number } | null;
}

/** Every guest is ready; the host always is (D40) */
export function guestsReady(room: CoopRoomInfo): boolean {
  return room.players.every((p) => p.id === room.hostId || p.ready);
}

/** The status line: who we wait on, or that all are ready */
export function roomStatus(t: Messages, i: StatusInput): RoomStatus | null {
  const room = i.room;
  if (!room) return null;
  const w = t.coop.dock.status;
  const line = (words: string, go = false) => ({ go, segments, ...splitBold(words) });
  const ready = room.players.filter((p) => p.id === room.hostId || p.ready).length;
  const segments = room.players.map((p) => p.id === room.hostId || p.ready);
  if (room.players.length < 2) return { ...line(w.alone), segments: [...segments, false] };
  if (i.isHost && i.mapSending) return line(w.sendingMap(transferPercent(i.mapSending)));
  if (!i.worldReady) return line(i.isHost ? w.sending : w.waitingMap);
  const busy = room.players.find((p) => p.id !== i.myId && (p.status === 'key' || p.status === 'loading' || p.status === 'reloading'));
  if (busy) return line(busy.status === 'key' ? w.waitKey(busy.name) : busy.status === 'reloading' ? w.waitReload(busy.name) : w.waitLoad(busy.name));
  const noLane = room.players.find((p) => p.spawnIds.length === 0);
  if (noLane) return line(w.waitLane(noLane.name));
  // Every lane needs a player (docs/WAVE_SYSTEM.md (Spuren), L4); anyone may take one more
  const free = room.spawnIds.findIndex((id) => !room.players.some((p) => p.spawnIds.includes(id)));
  if (free >= 0 && !i.vacant) return line(w.freeLane(t.coop.dock.spawn(free + 1)));
  if (guestsReady(room)) return line(i.isHost ? w.allReady : w.youReady(i.hostName), true);
  const me = room.players.find((p) => p.id === i.myId);
  if (!i.isHost && !me?.ready) return line(w.pickLane);
  const waiting = room.players.find((p) => p.id !== room.hostId && !p.ready)!;
  return line(w.waitReady(waiting.name, ready, room.players.length));
}

/** Why Start is off, for its tooltip; null when it can start */
export function startBlocked(
  t: Messages,
  room: CoopRoomInfo | null,
  worldReady: boolean,
  /** Lanes a player took that have no route to the base (TODO E34, point 7) */
  routeless: readonly string[] = [],
  /** The map's rule for lanes nobody holds (TODO E130); null: every lane needs a player */
  vacant: VacantLanes | null = null,
): string | null {
  const w = t.coop.dock.blocked;
  if (!room) return w.noRoom;
  if (room.players.length < 2) return w.alone;
  if (!worldReady) return w.mapSending;
  const lost = room.spawnIds.findIndex((id) => routeless.includes(id));
  if (lost >= 0) return w.noRoute(t.coop.dock.spawn(lost + 1));
  const free = room.spawnIds.findIndex((id) => !room.players.some((p) => p.spawnIds.includes(id)));
  if (free >= 0 && vacant === null) return w.nobody(t.coop.dock.spawn(free + 1));
  const waiting = room.players.find((p) => p.spawnIds.length === 0 || (p.id !== room.hostId && !p.ready));
  return waiting ? w.waitingFor(waiting.name) : null;
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
  /** "820 m | 3:47", empty before the routes stand */
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
export function roomTable(t: Messages, i: TableInput): { lanes: LaneRow[]; seatless: SeatPlayer[] } {
  const { room } = i;
  const seat = (p: CoopRoomInfo['players'][number]): SeatPlayer => ({
    id: p.id,
    name: p.name,
    me: p.id === i.myId,
    host: p.id === room.hostId,
    ready: p.id === room.hostId || p.ready,
    doing: p.status ? statusText(t, p.status) : null,
    client: p.client,
    latency: i.latencyOf(p.id),
    lagging: i.laggingOf(p.id),
    left: i.leftIds.has(p.id),
  });
  const lanes = room.spawnIds.map((spawnId, index): LaneRow => {
    const owner = room.players.find((p) => p.spawnIds.includes(spawnId));
    const stat = i.lanes.get(spawnId);
    return {
      spawnId,
      index,
      label: t.coop.dock.spawn(index + 1),
      color: laneCss(index),
      share: stat?.share ?? 0,
      length: stat ? t.coop.dock.laneLength(stat.meters, formatClock(stat.seconds * 1000)) : '',
      player: owner ? seat(owner) : null,
    };
  });
  const seatless = room.players.filter((p) => !p.spawnIds.some((id) => room.spawnIds.includes(id))).map(seat);
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
export function dockBanners(t: Messages, i: BannerInput): DockBanner[] {
  const banners: DockBanner[] = [];
  if (i.desync) banners.push({ kind: 'desync', warn: true, text: i.desync });
  if (i.mixedEngines) banners.push({ kind: 'engines', warn: true, text: t.coop.dock.engines });
  if (i.hostChangingMap) banners.push({ kind: 'map', warn: false, text: t.coop.dock.hostChangingMap });
  return banners;
}

/** "Bob's game ran apart from the others at game second 94: …" */
export function desyncText(t: Messages, outOfStep: readonly string[], second: string, myId: string | null, nameOf: (id: string) => string): string {
  const w = t.coop.dock.desync;
  const who = myId !== null && outOfStep.includes(myId) ? w.mine : outOfStep.length ? w.theirs(t.coop.and(outOfStep.map(nameOf))) : w.all;
  return w.at(who, second);
}
