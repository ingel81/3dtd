// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import {
  Room, TICK_MS, MAX_AHEAD_TICKS, HANG_MS, MAX_RESYNCS, MAX_RESYNCS_PER_GUEST, RESYNC_GAP_MS, RESYNC_TIMEOUT_MS, type RoomPlayer,
} from './room.ts';
import { HASH_EVERY_TICKS, HASH_PARTS } from '../../src/app/coop/hash-check.ts';
import { DEFAULT_ROOM_OPTIONS } from '../../src/app/coop/room-options.ts';
import type { ServerMessage } from '../../src/app/coop/protocol.ts';

const player = (id: string, over: Partial<RoomPlayer> = {}): RoomPlayer => ({
  id, name: id.toUpperCase(), gameVersion: 'v1', configHash: 'h', ...over,
});

describe('Room (COOP_PLAN C4)', () => {
  let inbox: Map<string, ServerMessage[]>;
  let room: Room;
  /** The room's wall clock, ms */
  let clock = 0;
  /** Close `n` ticks, so hash reports up to that tick count as the room's */
  const closeTicks = (n: number) => {
    for (let i = 0; i < n; i++) room.closeTick();
  };
  const last = <T extends ServerMessage['t']>(id: string, t: T) =>
    [...(inbox.get(id) ?? [])].reverse().find((m) => m.t === t) as Extract<ServerMessage, { t: T }> | undefined;
  const all = <T extends ServerMessage['t']>(id: string, t: T) =>
    (inbox.get(id) ?? []).filter((m) => m.t === t) as Extract<ServerMessage, { t: T }>[];

  /** Host a, b joined, world with two spawns, both on a lane and ready */
  const lobby = () => {
    room.join(player('b'));
    room.receive('a', { t: 'world', world: { any: 'thing' }, spawnIds: ['s1', 's2'] });
    room.receive('a', { t: 'pick', spawnId: 's1' });
    room.receive('b', { t: 'pick', spawnId: 's2' });
    room.receive('a', { t: 'ready', ready: true });
    room.receive('b', { t: 'ready', ready: true });
  };

  beforeEach(() => {
    inbox = new Map();
    clock = 0;
    room = new Room('ABCDEF', player('a'), (id, message) => {
      if (!inbox.has(id)) inbox.set(id, []);
      inbox.get(id)!.push(message);
    }, { now: () => clock });
  });

  it('lets players join the lobby, up to four, with the same game and balance only', () => {
    expect(room.join(player('b', { gameVersion: 'v2' }))).toBe('version');
    expect(room.join(player('b', { configHash: 'x' }))).toBe('balance');
    expect(room.join(player('b'))).toBeNull();
    expect(room.join(player('c'))).toBeNull();
    expect(room.join(player('d'))).toBeNull();
    expect(room.join(player('e'))).toBe('full');
    expect(last('d', 'room')!.room.players.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('shows and logs what each player plays with', () => {
    const lines: string[] = [];
    room = new Room('CLIENT', player('a'), (id, message) => {
      if (!inbox.has(id)) inbox.set(id, []);
      inbox.get(id)!.push(message);
    }, { log: (line) => lines.push(line) });
    room.join(player('b', { client: { engine: 'Firefox', version: '143.0', family: 'gecko', os: 'Linux' } }));
    expect(last('a', 'room')!.room.players.map((p) => p.client)).toEqual([
      null, { engine: 'Firefox', version: '143.0', family: 'gecko', os: 'Linux' },
    ]);
    expect(lines[1]).toBe('B (b) joined (2 players), on Firefox 143.0, Linux');
  });

  it('numbers a name that is in the room already', () => {
    room.join(player('b', { name: 'A' }));
    room.join(player('c', { name: 'A' }));
    expect(last('c', 'room')!.room.players.map((p) => p.name)).toEqual(['A', 'A 2', 'A 3']);
  });

  it('lets a player change their name in the lobby, numbered where it is taken, not after the start', () => {
    room.join(player('b'));
    room.receive('b', { t: 'rename', name: '  Bea  ' });
    expect(last('a', 'room')!.room.players.map((p) => p.name)).toEqual(['A', 'Bea']);
    room.receive('a', { t: 'rename', name: 'Bea' });
    expect(last('b', 'room')!.room.players.map((p) => p.name)).toEqual(['Bea 2', 'Bea']);
    room.receive('b', { t: 'rename', name: '' }); // empty: nothing
    expect(last('b', 'room')!.room.players[1].name).toBe('Bea');
    lobby();
    room.receive('a', { t: 'start', seed: 1 });
    room.receive('b', { t: 'rename', name: 'Late' });
    expect(last('b', 'refused')!.reason).toBe('started');
  });

  it('hands the host world to everyone, also to who joins later', () => {
    room.join(player('b'));
    room.receive('a', { t: 'world', world: { w: 1 }, spawnIds: ['s1'] });
    room.join(player('c'));
    expect(last('b', 'world')!.world).toEqual({ w: 1 });
    expect(last('c', 'world')!.world).toEqual({ w: 1 });
    room.receive('b', { t: 'world', world: {}, spawnIds: [] });
    expect(last('b', 'refused')!.reason).toBe('not-host');
  });

  it("keeps and passes on what each player's client does in the lobby, known values only", () => {
    const lines: string[] = [];
    room = new Room('STATUS', player('a'), (id, message) => {
      if (!inbox.has(id)) inbox.set(id, []);
      inbox.get(id)!.push(message);
    }, { log: (line) => lines.push(line) });
    room.join(player('b'));
    expect(last('a', 'room')!.room.players[1].status).toBeNull();
    room.receive('b', { t: 'status', status: 'loading' });
    expect(last('a', 'room')!.room.players[1].status).toBe('loading');
    expect(lines.at(-1)).toBe('B (b) loads the map');
    room.receive('b', { t: 'status', status: 'napping' } as never);
    expect(last('a', 'room')!.room.players[1].status).toBe('loading');
    room.receive('b', { t: 'status', status: 'ready' });
    expect(last('a', 'room')!.room.players[1].status).toBe('ready');
  });

  it('tells the guests the host changes the map, in the lobby only and from the host only (PLAYTEST T25)', () => {
    room.join(player('b'));
    room.receive('a', { t: 'moving' });
    expect(all('b', 'moving')).toHaveLength(1);
    expect(all('a', 'moving')).toHaveLength(0);
    room.receive('b', { t: 'moving' });
    expect(last('b', 'refused')!.reason).toBe('not-host');
    lobby();
    room.receive('a', { t: 'start', seed: 1 });
    room.receive('a', { t: 'moving' });
    expect(all('b', 'moving')).toHaveLength(1);
  });

  it('gives each lane to one player, a player as many as they take, and ready only with a lane', () => {
    room.join(player('b'));
    room.receive('a', { t: 'world', world: {}, spawnIds: ['s1', 's2'] });
    room.receive('b', { t: 'ready', ready: true });
    expect(last('b', 'room')!.room.players[1].ready).toBe(false);
    room.receive('a', { t: 'pick', spawnId: 's1' });
    room.receive('b', { t: 'pick', spawnId: 's1' });
    expect(last('b', 'refused')!.reason).toBe('lane-taken');
    room.receive('b', { t: 'pick', spawnId: 's9' });
    expect(all('b', 'refused')).toHaveLength(2);
    room.receive('b', { t: 'pick', spawnId: 's2' });
    expect(last('a', 'room')!.room.players.map((p) => p.spawnIds)).toEqual([['s1'], ['s2']]);
    // b gives s2 back, a takes it too; a hands s1 back alone
    room.receive('b', { t: 'pick', spawnId: 's2', take: false });
    room.receive('a', { t: 'pick', spawnId: 's2' });
    expect(last('a', 'room')!.room.players.map((p) => p.spawnIds)).toEqual([['s1', 's2'], []]);
    room.receive('a', { t: 'pick', spawnId: 's1', take: false });
    expect(last('a', 'room')!.room.players.map((p) => p.spawnIds)).toEqual([['s2'], []]);
    room.receive('a', { t: 'pick', spawnId: null });
    expect(last('a', 'room')!.room.players.map((p) => p.spawnIds)).toEqual([[], []]);
  });

  it('starts only when every lane has a player, and hands every pair of a player with two lanes', () => {
    room.join(player('b'));
    room.receive('a', { t: 'world', world: {}, spawnIds: ['s1', 's2', 's3'] });
    room.receive('a', { t: 'pick', spawnId: 's1' });
    room.receive('b', { t: 'pick', spawnId: 's2' });
    room.receive('b', { t: 'ready', ready: true });
    // s3 has nobody
    room.receive('a', { t: 'start', seed: 3 });
    expect(last('a', 'refused')!.reason).toBe('not-ready');
    room.receive('a', { t: 'pick', spawnId: 's3' });
    room.receive('a', { t: 'start', seed: 3 });
    expect(last('b', 'started')!.lanes).toEqual([['a', 's1'], ['a', 's3'], ['b', 's2']]);
  });

  it('starts only when the host says so and every guest is ready, with roster, lanes, host and options', () => {
    // Alone, with a lane: a coop game needs a second player
    room.receive('a', { t: 'world', world: { any: 'thing' }, spawnIds: ['s1', 's2'] });
    room.receive('a', { t: 'pick', spawnId: 's1' });
    room.receive('a', { t: 'start', seed: 7 });
    expect(last('a', 'refused')!.reason).toBe('alone');
    room.join(player('b'));
    room.receive('a', { t: 'start', seed: 7 });
    expect(last('a', 'refused')!.reason).toBe('not-ready');
    room.receive('b', { t: 'pick', spawnId: 's2' });
    room.receive('b', { t: 'ready', ready: true });
    room.receive('b', { t: 'start', seed: 7 });
    expect(last('b', 'refused')!.reason).toBe('not-host');
    // The host never said ready: they are, always (D40)
    room.receive('a', { t: 'start', seed: 7 });
    expect(last('b', 'started')).toEqual({
      t: 'started', seed: 7, players: ['a', 'b'], lanes: [['a', 's1'], ['b', 's2']], speed: 1,
      hostId: 'a', options: DEFAULT_ROOM_OPTIONS,
    });
    expect(room.join(player('c'))).toBe('started');
  });

  it('closes ticks at the game time the wall clock gives, with the commands in arrival order', () => {
    lobby();
    expect(room.advance(1000)).toBe(0); // not started
    room.receive('a', { t: 'start', seed: 1 });
    room.receive('b', { t: 'cmd', command: { type: 'command:x' } });
    room.receive('a', { t: 'cmd', command: { type: 'command:y' } });
    expect(room.advance(TICK_MS * 2.5)).toBe(2);
    const ticks = all('a', 'tick');
    expect(ticks.map((t) => t.tick)).toEqual([0, 1]);
    expect(ticks[0].commands).toEqual([
      { tick: 0, seq: 0, playerId: 'b', command: { type: 'command:x' } },
      { tick: 0, seq: 1, playerId: 'a', command: { type: 'command:y' } },
    ]);
    expect(ticks[1].commands).toEqual([]);
    expect(all('b', 'tick')).toEqual(ticks);
    // The half tick left over counts toward the next
    expect(room.advance(TICK_MS / 2)).toBe(1);
    // The dev tools' commands and anything that is no game command stay out (R3)
    room.receive('a', { t: 'cmd', command: { type: 'debug:add-credits' } });
    room.receive('a', { t: 'cmd', command: {} as never });
    room.advance(TICK_MS);
    expect(all('a', 'tick').at(-1)!.commands).toEqual([]);
    expect(last('a', 'room')!.room.cheats).toBe(false);
  });

  it('holds at most 2000 commands of a player while no tick closes, the others still get in', () => {
    lobby();
    room.receive('a', { t: 'start', seed: 1 });
    room.receive('a', { t: 'speed', speed: 0 });
    for (let i = 0; i < 2100; i++) room.receive('b', { t: 'cmd', command: { type: 'command:x' } });
    room.receive('a', { t: 'cmd', command: { type: 'command:y' } });
    room.receive('a', { t: 'speed', speed: 1 });
    room.advance(TICK_MS);
    const commands = all('a', 'tick').flatMap((t) => t.commands);
    expect(commands.filter((c) => c.playerId === 'b')).toHaveLength(2000);
    expect(commands.filter((c) => c.playerId === 'a')).toHaveLength(1);
    // The next tick has room again
    room.receive('b', { t: 'cmd', command: { type: 'command:x' } });
    room.advance(TICK_MS);
    expect(all('a', 'tick').at(-1)!.commands).toHaveLength(1);
  });

  it('lets the cheats through as the relay and the room allow them, and says so to the room (D38)', () => {
    room = new Room('CHEATS', player('a'), (id, message) => {
      if (!inbox.has(id)) inbox.set(id, []);
      inbox.get(id)!.push(message);
    }, { cheats: true });
    lobby();
    expect(last('b', 'room')!.room.cheats).toBe(true);
    room.receive('a', { t: 'options', options: { ...DEFAULT_ROOM_OPTIONS, cheats: 'host' } });
    room.receive('a', { t: 'ready', ready: true });
    room.receive('b', { t: 'ready', ready: true });
    room.receive('a', { t: 'start', seed: 1 });
    room.receive('a', { t: 'cmd', command: { type: 'debug:kill-all' } });
    room.receive('b', { t: 'cmd', command: { type: 'debug:kill-all' } });
    room.receive('a', { t: 'cmd', command: { type: 'lobby:anything' } as never });
    room.advance(TICK_MS);
    const commands = all('b', 'tick').at(-1)!.commands;
    expect(commands.map((c) => [c.playerId, c.command.type])).toEqual([['a', 'debug:kill-all']]);
  });

  it('takes the options from the host in the lobby only, asks the guests for ready again, refuses made up ones', () => {
    lobby();
    expect(last('b', 'room')!.room.options).toEqual(DEFAULT_ROOM_OPTIONS);
    room.receive('b', { t: 'options', options: { ...DEFAULT_ROOM_OPTIONS, pause: 'all' } });
    expect(last('b', 'refused')!.reason).toBe('not-host');
    room.receive('a', { t: 'options', options: { ...DEFAULT_ROOM_OPTIONS, cheats: 'god' } as never });
    expect(last('b', 'room')!.room.options).toEqual(DEFAULT_ROOM_OPTIONS);
    room.receive('a', { t: 'options', options: { ...DEFAULT_ROOM_OPTIONS, pause: 'all' } });
    const info = last('b', 'room')!.room;
    expect(info.options.pause).toBe('all');
    expect(info.players.find((p) => p.id === 'b')!.ready).toBe(false);
    room.receive('b', { t: 'ready', ready: true });
    room.receive('a', { t: 'start', seed: 1 });
    room.receive('a', { t: 'options', options: DEFAULT_ROOM_OPTIONS });
    expect(last('a', 'refused')!.reason).toBe('started');
  });

  it('asks the guests for ready again when the host sends another map; lanes that remain stay', () => {
    lobby();
    // At most one world a second goes out; one that comes sooner waits, a newer one replaces it (relay review H2)
    room.receive('a', { t: 'world', world: { too: 'soon' }, spawnIds: ['s1'] });
    room.receive('a', { t: 'world', world: { other: 'map' }, spawnIds: ['s1', 's2', 's3'] });
    expect(last('b', 'world')!.world).toEqual({ any: 'thing' });
    clock += 1000;
    room.advance(0);
    expect(all('b', 'world')).toHaveLength(2);
    const b = last('b', 'room')!.room.players.find((p) => p.id === 'b')!;
    expect(b).toMatchObject({ spawnIds: ['s2'], ready: false });
    expect(last('b', 'world')!.world).toEqual({ other: 'map' });
  });

  it("tells everyone each player's round trip to the relay", () => {
    lobby();
    room.sendRtt((id) => (id === 'a' ? 12 : null));
    expect(last('b', 'rtt')!.rtt).toEqual([['a', 12], ['b', null]]);
  });

  it('logs how smoothly each client runs, in the game only', () => {
    const lines: string[] = [];
    room = new Room('STATS', player('a'), () => undefined, { log: (line) => lines.push(line) });
    lobby();
    const stats = {
      frames: 600, blocked: 0.35, steps: [210, 300, 60, 30] as [number, number, number, number], behindAvg: 0.4, behindMin: 0,
      tickGapAvg: 66, tickGapSd: 12, inputAvg: 95, inputMax: 140, inputs: 12,
    };
    room.receive('b', { t: 'stats', stats });
    room.receive('a', { t: 'start', seed: 1 });
    room.receive('b', { t: 'stats', stats });
    expect(lines.filter((l) => l.startsWith('stats'))).toEqual([
      'stats B (b): 600 frames, blocked 35%, steps 0:210 1:300 2:60 3+:30, behind 0.4 (min 0), ticks 66±12 ms, input 95 ms (max 140, n 12)',
    ]);
  });

  it('waits for a client that falls too far behind, and goes on once it caught up (R2)', () => {
    lobby();
    room.receive('a', { t: 'start', seed: 1 });
    // A reports its hashes as it goes, B stays at the start
    for (let t = 0; t < MAX_AHEAD_TICKS + 20; t++) {
      room.advance(TICK_MS);
      if ((t + 1) % HASH_EVERY_TICKS === 0) room.receive('a', { t: 'hash', tick: t + 1, hash: 7 });
    }
    expect(room.lastTick).toBe(MAX_AHEAD_TICKS);
    expect(last('a', 'waiting')!.playerId).toBe('b');
    expect(room.advance(TICK_MS * 10)).toBe(0);
    // B reports where it is now: the room goes on
    room.receive('b', { t: 'hash', tick: HASH_EVERY_TICKS * 2, hash: 7 });
    expect(room.advance(TICK_MS)).toBe(1);
    expect(last('a', 'waiting')!.playerId).toBeNull();
  });

  it('lets a player go who does not catch up for HANG_MS; their lane closes, the room goes on (relay review M4)', () => {
    lobby();
    room.receive('a', { t: 'start', seed: 1 });
    for (let t = 0; t < MAX_AHEAD_TICKS + 20; t++) {
      room.advance(TICK_MS);
      if ((t + 1) % HASH_EVERY_TICKS === 0) room.receive('a', { t: 'hash', tick: t + 1, hash: 7 });
    }
    expect(last('a', 'waiting')!.playerId).toBe('b');
    clock += HANG_MS - 1;
    expect(room.advance(TICK_MS)).toBe(0);
    expect(room.status().players.map((p) => p.id)).toEqual(['a', 'b']);
    clock += 1;
    room.advance(TICK_MS);
    expect(room.status().players.map((p) => p.id)).toEqual(['a']);
    expect(last('a', 'left')!.playerId).toBe('b');
    expect(last('a', 'waiting')!.playerId).toBeNull();
    // B's lane closes at the next tick, and A plays on
    room.advance(TICK_MS);
    expect(last('a', 'tick')!.commands).toEqual([expect.objectContaining({ playerId: 'b', command: { type: 'command:leave-game' } })]);
  });

  it('lets the host take a player out in the game as well; the lane closes (relay review M4)', () => {
    lobby();
    room.receive('a', { t: 'start', seed: 1 });
    room.receive('a', { t: 'kick', playerId: 'b' });
    expect(last('b', 'refused')!.reason).toBe('kicked');
    expect(room.status().players.map((p) => p.id)).toEqual(['a']);
    room.closeTick();
    expect(last('a', 'tick')!.commands).toEqual([expect.objectContaining({ playerId: 'b', command: { type: 'command:leave-game' } })]);
  });

  it('logs at most 30 lobby lines a minute per player, and says how many it left out (relay review M1)', () => {
    const lines: string[] = [];
    room = new Room('NOISY1', player('a'), () => undefined, { log: (line) => lines.push(line), now: () => clock });
    room.join(player('b'));
    room.receive('a', { t: 'world', world: {}, spawnIds: ['s1', 's2'] });
    room.receive('b', { t: 'pick', spawnId: 's2' });
    const before = lines.length;
    for (let i = 0; i < 50; i++) room.receive('b', { t: 'ready', ready: i % 2 === 0 });
    expect(lines.length - before).toBe(30);
    clock += 60_000;
    room.receive('b', { t: 'ready', ready: true });
    expect(lines.slice(-2)).toEqual(['B (b): 20 lines left out', 'B (b) ready']);
  });

  it('lets the host take a player out and close the room to new ones (R9)', () => {
    lobby();
    room.receive('b', { t: 'kick', playerId: 'a' });
    expect(last('b', 'refused')!.reason).toBe('not-host');
    room.receive('a', { t: 'kick', playerId: 'b' });
    expect(last('b', 'refused')!.reason).toBe('kicked');
    expect(last('a', 'room')!.room.players.map((p) => p.id)).toEqual(['a']);
    room.receive('a', { t: 'lock', locked: true });
    expect(last('a', 'room')!.room.locked).toBe(true);
    expect(room.join(player('c'))).toBe('locked');
    room.receive('a', { t: 'lock', locked: false });
    expect(room.join(player('c'))).toBeNull();
  });

  it('passes a map ping on to everyone with its height, and drops one with no place (R13)', () => {
    lobby();
    room.receive('b', { t: 'ping', lat: 48.1, lon: 9.2, height: 240 });
    expect(last('a', 'ping')).toEqual({ t: 'ping', from: 'b', lat: 48.1, lon: 9.2, height: 240 });
    expect(last('b', 'ping')).toEqual({ t: 'ping', from: 'b', lat: 48.1, lon: 9.2, height: 240 });
    room.receive('b', { t: 'ping', lat: NaN, lon: 9.2, height: 240 });
    expect(all('a', 'ping')).toHaveLength(1);
  });

  it('passes at most two pings a second of a player, and none off the earth', () => {
    lobby();
    for (let i = 0; i < 10; i++) room.receive('b', { t: 'ping', lat: 48.1, lon: 9.2, height: 240 });
    expect(all('a', 'ping')).toHaveLength(1);
    room.receive('a', { t: 'ping', lat: 48.1, lon: 9.2, height: 240 });
    expect(all('b', 'ping')).toHaveLength(2);
    clock += 500;
    room.receive('b', { t: 'ping', lat: 95, lon: 9.2, height: 240 });
    room.receive('b', { t: 'ping', lat: 48.1, lon: 9.2, height: 240 });
    expect(all('a', 'ping').filter((p) => p.from === 'b')).toHaveLength(2);
  });

  it('follows the host speed, and stands still at 0', () => {
    lobby();
    room.receive('a', { t: 'start', seed: 1 });
    room.receive('b', { t: 'speed', speed: 4 });
    expect(last('b', 'refused')!.reason).toBe('not-host');
    room.receive('a', { t: 'speed', speed: 2 });
    expect(last('b', 'speed')!.speed).toBe(2);
    expect(room.advance(TICK_MS * 2)).toBe(4);
    room.receive('a', { t: 'speed', speed: 0 });
    expect(room.advance(5000)).toBe(0);
    room.receive('a', { t: 'speed', speed: 7 }); // not a speed: ignored
    expect(room.advance(TICK_MS)).toBe(0);
  });

  it('lets a guest pause and resume at the room speed where the room allows it, but not change it (T12, D38)', () => {
    lobby();
    room.receive('a', { t: 'options', options: { ...DEFAULT_ROOM_OPTIONS, pause: 'all' } });
    room.receive('b', { t: 'ready', ready: true });
    room.receive('a', { t: 'start', seed: 1 });
    room.receive('a', { t: 'speed', speed: 2 });
    room.receive('b', { t: 'speed', speed: 0 });
    expect(last('a', 'speed')!.speed).toBe(0);
    expect(room.advance(5000)).toBe(0);
    room.receive('b', { t: 'speed', speed: 4 });
    expect(last('b', 'refused')!.reason).toBe('not-host');
    room.receive('b', { t: 'speed', speed: 2 });
    expect(last('a', 'speed')!.speed).toBe(2);
    expect(room.advance(TICK_MS)).toBe(2);
  });

  it('lets only the host pause by default, and nobody with pause off (D38)', () => {
    lobby();
    room.receive('a', { t: 'start', seed: 1 });
    room.receive('b', { t: 'speed', speed: 0 });
    expect(last('b', 'refused')!.reason).toBe('not-host');
    room.receive('a', { t: 'speed', speed: 0 });
    expect(last('b', 'speed')!.speed).toBe(0);

    room = new Room('NOPAUSE', player('a'), (id, message) => {
      if (!inbox.has(id)) inbox.set(id, []);
      inbox.get(id)!.push(message);
    });
    inbox.clear();
    lobby();
    room.receive('a', { t: 'options', options: { ...DEFAULT_ROOM_OPTIONS, pause: 'off' } });
    room.receive('b', { t: 'ready', ready: true });
    room.receive('a', { t: 'start', seed: 1 });
    room.receive('a', { t: 'speed', speed: 0 });
    expect(last('a', 'refused')!.reason).toBe('not-host');
    expect(all('a', 'speed')).toHaveLength(0);
  });

  it('closes the lane of who leaves the game at the next tick, and passes the host on', () => {
    lobby();
    room.receive('a', { t: 'start', seed: 1 });
    room.leave('a');
    expect(last('b', 'left')!.playerId).toBe('a');
    expect(last('b', 'host')!.hostId).toBe('b');
    room.advance(TICK_MS);
    expect(last('b', 'tick')!.commands).toEqual([
      { tick: 0, seq: 0, playerId: 'a', command: { type: 'command:leave-game' } },
    ]);
    room.leave('b');
    expect(room.isEmpty).toBe(true);
  });

  it('takes a report at every tick where the relay says so (--hash-every 1)', () => {
    room = new Room('ABCDEF', player('a'), (id, message) => {
      if (!inbox.has(id)) inbox.set(id, []);
      inbox.get(id)!.push(message);
    }, { now: () => clock, hashEvery: 1 });
    lobby();
    room.receive('a', { t: 'start', seed: 1 });
    closeTicks(3);
    room.receive('a', { t: 'hash', tick: 1, hash: 7 });
    room.receive('b', { t: 'hash', tick: 1, hash: 7 });
    room.receive('a', { t: 'hash', tick: 2, hash: 8 });
    room.receive('b', { t: 'hash', tick: 2, hash: 9 });
    expect(all('a', 'desync')).toEqual([{ t: 'desync', tick: 2, hashes: [['a', 8], ['b', 9]], outOfStep: [], parts: [] }]);
  });

  it('compares the hashes of a tick and tells everyone the first one that differs, once (C5)', () => {
    lobby();
    room.receive('a', { t: 'hash', tick: 0, hash: 1 }); // before the start: ignored
    room.receive('a', { t: 'start', seed: 1 });
    room.receive('a', { t: 'hash', tick: 0, hash: 7 });
    room.receive('b', { t: 'hash', tick: 0, hash: 7 });
    expect(all('a', 'desync')).toHaveLength(0);
    // Not closed yet, and off a report boundary: dropped (relay review M3)
    room.receive('a', { t: 'hash', tick: 30, hash: 8 });
    closeTicks(2 * HASH_EVERY_TICKS);
    room.receive('b', { t: 'hash', tick: 15, hash: 9 });
    room.receive('a', { t: 'hash', tick: 30, hash: 8 });
    room.receive('b', { t: 'hash', tick: 30, hash: 9 });
    room.receive('a', { t: 'hash', tick: 60, hash: 10 });
    room.receive('b', { t: 'hash', tick: 60, hash: 11 });
    expect(all('a', 'desync')).toEqual([{ t: 'desync', tick: 30, hashes: [['a', 8], ['b', 9]], outOfStep: [], parts: [] }]);
    expect(all('b', 'desync')).toHaveLength(1);
    // The room holds for a resync (C5b): reports while it does are not judged
    const status = room.status();
    expect(status).toMatchObject({ started: true, desyncs: 1, firstDesync: 30 });
    expect(status.players.map((p) => p.lastHash)).toEqual([{ tick: 30, hash: 8 }, { tick: 30, hash: 9 }]);
  });

  describe('resync after a desync (C5b)', () => {
    /** Started, ticks closed, a and b report different hashes at tick 30 */
    const diverged = () => {
      lobby();
      room.receive('a', { t: 'start', seed: 1 });
      closeTicks(2 * HASH_EVERY_TICKS);
      room.receive('a', { t: 'hash', tick: 30, hash: 8 });
      room.receive('b', { t: 'hash', tick: 30, hash: 9 });
      return last('a', 'resync')!.tick;
    };

    it('holds every tick from the next one on and tells everyone where', () => {
      const tick = diverged();
      expect(tick).toBe(2 * HASH_EVERY_TICKS);
      expect(last('b', 'resync')).toEqual({ t: 'resync', tick });
      const before = room.lastTick;
      clock += 10 * TICK_MS;
      expect(room.advance(10 * TICK_MS)).toBe(0);
      expect(room.lastTick).toBe(before);
    });

    it("sends the host's state to the guests and goes on once they loaded it", () => {
      const tick = diverged();
      room.receive('b', { t: 'resync-state', tick, gz: 'QUJD' }); // not the host: ignored
      expect(last('a', 'resync-state')).toBeUndefined();
      room.receive('a', { t: 'resync-state', tick, gz: 'QUJD' });
      expect(last('b', 'resync-state')).toEqual({ t: 'resync-state', tick, gz: 'QUJD', part: 0, parts: 1 });
      expect(last('a', 'resync-state')).toBeUndefined();
      room.receive('b', { t: 'resynced', tick, ok: true });
      expect(last('a', 'resync-done')).toEqual({ t: 'resync-done', tick, ok: true });
      clock += 3 * TICK_MS;
      expect(room.advance(3 * TICK_MS)).toBeGreaterThan(0);
      // A new state: an old tick's report says nothing, a new divergence starts the next resync
      room.receive('a', { t: 'hash', tick: 30, hash: 1 });
      room.receive('b', { t: 'hash', tick: 30, hash: 2 });
      expect(all('a', 'desync')).toHaveLength(1);
      closeTicks(HASH_EVERY_TICKS);
      clock += RESYNC_GAP_MS;
      room.receive('a', { t: 'hash', tick: 90, hash: 3 });
      room.receive('b', { t: 'hash', tick: 90, hash: 4 });
      expect(all('a', 'desync')).toHaveLength(2);
      expect(all('a', 'resync')).toHaveLength(2);
    });

    it('starts a resync no sooner than RESYNC_GAP_MS after the last', () => {
      const tick = diverged();
      room.receive('a', { t: 'resync-state', tick, gz: null });
      closeTicks(HASH_EVERY_TICKS);
      room.receive('a', { t: 'hash', tick: 90, hash: 3 });
      room.receive('b', { t: 'hash', tick: 90, hash: 4 });
      expect(all('a', 'desync')).toHaveLength(2);
      // The divergence waits; the room plays on meanwhile
      expect(all('a', 'resync')).toHaveLength(1);
      clock += RESYNC_GAP_MS / 2;
      expect(room.advance(3 * TICK_MS)).toBeGreaterThan(0);
      expect(all('a', 'resync')).toHaveLength(1);
      clock += RESYNC_GAP_MS / 2;
      room.advance(TICK_MS);
      expect(all('a', 'resync')).toHaveLength(2);
      expect(last('b', 'resync')!.tick).toBe(room.lastTick + 1);
    });

    it('passes a state in pieces on as they come and counts it sent with the last', () => {
      const tick = diverged();
      room.receive('a', { t: 'resync-state', tick, gz: 'QUJD', part: 0, parts: 3 });
      room.receive('a', { t: 'resync-state', tick, gz: 'REVG', part: 1, parts: 3 });
      expect(all('b', 'resync-state')).toEqual([
        { t: 'resync-state', tick, gz: 'QUJD', part: 0, parts: 3 },
        { t: 'resync-state', tick, gz: 'REVG', part: 1, parts: 3 },
      ]);
      room.receive('a', { t: 'resync-state', tick, gz: 'R0hJ', part: 2, parts: 3 });
      expect(last('b', 'resync-state')).toEqual({ t: 'resync-state', tick, gz: 'R0hJ', part: 2, parts: 3 });
      expect(last('a', 'resync-done')).toBeUndefined();
      room.receive('b', { t: 'resynced', tick, ok: true });
      expect(last('a', 'resync-done')).toEqual({ t: 'resync-done', tick, ok: true });
    });

    it('fails the resync on a piece out of order', () => {
      const tick = diverged();
      room.receive('a', { t: 'resync-state', tick, gz: 'QUJD', part: 1, parts: 3 });
      expect(last('b', 'resync-state')).toBeUndefined();
      expect(last('b', 'resync-done')).toEqual({ t: 'resync-done', tick, ok: false });
    });

    it('goes on without when the host cannot send or nobody answers', () => {
      let tick = diverged();
      room.receive('a', { t: 'resync-state', tick, gz: null });
      expect(last('b', 'resync-done')).toEqual({ t: 'resync-done', tick, ok: false });

      closeTicks(HASH_EVERY_TICKS);
      clock += RESYNC_GAP_MS;
      room.receive('a', { t: 'hash', tick: 90, hash: 3 });
      room.receive('b', { t: 'hash', tick: 90, hash: 4 });
      tick = last('a', 'resync')!.tick;
      clock += RESYNC_TIMEOUT_MS;
      room.advance(TICK_MS);
      expect(last('a', 'resync-done')).toEqual({ t: 'resync-done', tick, ok: false });
    });

    it('goes on at once when the host leaves before its state went out', () => {
      const tick = diverged();
      room.leave('a');
      expect(last('b', 'resync-done')).toEqual({ t: 'resync-done', tick, ok: false });
      expect(last('b', 'host')).toEqual({ t: 'host', hostId: 'b' });
      clock += 3 * TICK_MS;
      expect(room.advance(3 * TICK_MS)).toBeGreaterThan(0);
    });

    /** Let the running resync fail, close ticks past the gap and let `off` report another hash than the rest */
    const divergeAgain = (ids: string[], off: string, i: number) => {
      const tick = last('a', 'resync')!.tick;
      room.receive('a', { t: 'resync-state', tick, gz: null });
      closeTicks(HASH_EVERY_TICKS);
      clock += RESYNC_GAP_MS;
      const at = Math.floor(room.lastTick / HASH_EVERY_TICKS) * HASH_EVERY_TICKS;
      for (const id of ids) room.receive(id, { t: 'hash', tick: at, hash: id === off ? 200 + i : 100 + i });
    };

    it('replaces one guest at most MAX_RESYNCS_PER_GUEST times', () => {
      diverged();
      for (let i = 0; i < MAX_RESYNCS + 2; i++) divergeAgain(['a', 'b'], 'b', i);
      expect(all('a', 'resync')).toHaveLength(MAX_RESYNCS_PER_GUEST);
    });

    it('stops trying after MAX_RESYNCS in the room and only counts from there', () => {
      room.join(player('b'));
      room.join(player('c'));
      room.receive('a', { t: 'world', world: {}, spawnIds: ['s1', 's2', 's3'] });
      room.receive('a', { t: 'pick', spawnId: 's1' });
      room.receive('b', { t: 'pick', spawnId: 's2' });
      room.receive('c', { t: 'pick', spawnId: 's3' });
      room.receive('b', { t: 'ready', ready: true });
      room.receive('c', { t: 'ready', ready: true });
      room.receive('a', { t: 'start', seed: 1 });
      closeTicks(2 * HASH_EVERY_TICKS);
      for (const id of ['a', 'b', 'c']) room.receive(id, { t: 'hash', tick: 30, hash: id === 'b' ? 9 : 8 });
      expect(all('a', 'resync')).toHaveLength(1);
      // b and c in turn: neither reaches its own limit before the room's
      for (let i = 0; i < MAX_RESYNCS + 2; i++) divergeAgain(['a', 'b', 'c'], i % 2 === 0 ? 'c' : 'b', i);
      expect(all('a', 'resync')).toHaveLength(MAX_RESYNCS);
    });
  });

  it('logs what happens in the room, one line each', () => {
    const lines: string[] = [];
    room = new Room('LOGGED', player('a'), () => undefined, { log: (line) => lines.push(line) });
    lobby();
    room.receive('a', { t: 'start', seed: 5 });
    room.receive('a', { t: 'speed', speed: 0 });
    room.receive('b', { t: 'cmd', command: { type: 'command:x' } });
    room.leave('a', 'no heartbeat');
    expect(lines).toEqual([
      'opened by A (a), game v1, balance h',
      'B (b) joined (2 players)',
      'world from the host, 0 kB, spawns s1, s2',
      'A (a) took lane s1',
      'B (b) took lane s2',
      'A (a) ready',
      'B (b) ready',
      'started, seed 5, speed 1, lanes A (a) on s1, B (b) on s2',
      'paused by A (a)',
      'A (a) left (no heartbeat), lane closes after tick -1',
      'host is now B (b)',
    ]);
    expect(room.status().commands).toBe(1);
  });

  it('logs the commands before the first desync, to find what acted apart', () => {
    const lines: string[] = [];
    room = new Room('APART', player('a'), () => undefined, { log: (line) => lines.push(line) });
    lobby();
    room.receive('a', { t: 'start', seed: 5 });
    room.receive('b', { t: 'cmd', command: { type: 'command:place-tower', typeId: 'archer' } });
    closeTicks(HASH_EVERY_TICKS);
    room.receive('a', { t: 'hash', tick: HASH_EVERY_TICKS, hash: 1 });
    room.receive('b', { t: 'hash', tick: HASH_EVERY_TICKS, hash: 2 });
    // Then the resync holds the room (C5b)
    expect(lines.slice(-3)).toEqual([
      `DESYNC at tick ${HASH_EVERY_TICKS}: A (a) 00000001, B (b) 00000002`,
      '  command at tick 0 from B (b): {"type":"command:place-tower","typeId":"archer"}',
      `resync 1: holding at tick ${HASH_EVERY_TICKS}, the host's state goes to B (b)`,
    ]);
  });

  it('names the parts that differ and, from both details, the first entities (TODO E32)', () => {
    const lines: string[] = [];
    room = new Room('APART', player('a'), () => undefined, { log: (line) => lines.push(line) });
    lobby();
    room.receive('a', { t: 'start', seed: 5 });
    closeTicks(HASH_EVERY_TICKS);
    const parts = HASH_PARTS.map((_, i) => i);
    const enemies = HASH_PARTS.indexOf('enemies');
    room.receive('a', { t: 'hash', tick: HASH_EVERY_TICKS, hash: 1, parts });
    room.receive('b', { t: 'hash', tick: HASH_EVERY_TICKS, hash: 2, parts: parts.map((h, i) => (i === enemies ? h + 1 : h)) });
    expect(lines.at(-2)).toBe(`DESYNC at tick ${HASH_EVERY_TICKS}: A (a) 00000001, B (b) 00000002; parts: enemies`);

    // Another tick than the desync's, and a malformed detail, do nothing
    room.receive('a', { t: 'hash-detail', tick: 0, entities: { enemies: [['enemy-1', 3]] } });
    room.receive('b', { t: 'hash-detail', tick: HASH_EVERY_TICKS, entities: { enemies: 'x' } as never });
    room.receive('a', { t: 'hash-detail', tick: HASH_EVERY_TICKS, entities: { enemies: [['enemy-1', 48.1, 3]] } });
    expect(lines.at(-1)).toContain('resync 1: holding');
    room.receive('b', { t: 'hash-detail', tick: HASH_EVERY_TICKS, entities: { enemies: [['enemy-1', 48.1, 3.5]] } });
    expect(lines.at(-1)).toBe(`  differs at tick ${HASH_EVERY_TICKS}: enemies enemy-1: A (a) [48.1,3] / B (b) [48.1,3.5]`);
    // Once
    room.receive('b', { t: 'hash-detail', tick: HASH_EVERY_TICKS, entities: { enemies: [['enemy-1', 1]] } });
    expect(lines.filter((l) => l.includes('differs'))).toHaveLength(1);
  });
});
