// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { Room, TICK_MS, type RoomPlayer } from './room.ts';
import type { ServerMessage } from '../../src/app/coop/protocol.ts';

const player = (id: string, over: Partial<RoomPlayer> = {}): RoomPlayer => ({
  id, name: id.toUpperCase(), gameVersion: 'v1', configHash: 'h', ...over,
});

describe('Room (COOP_PLAN C4)', () => {
  let inbox: Map<string, ServerMessage[]>;
  let room: Room;
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
    room = new Room('ABCDEF', player('a'), (id, message) => {
      if (!inbox.has(id)) inbox.set(id, []);
      inbox.get(id)!.push(message);
    });
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

  it('gives each lane to one player, and ready only with a lane', () => {
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
    expect(last('a', 'room')!.room.players.map((p) => p.spawnId)).toEqual(['s1', 's2']);
  });

  it('starts only when the host says so and everyone is ready, with roster and lanes', () => {
    // Alone, even with a lane and ready: a coop game needs a second player
    room.receive('a', { t: 'world', world: { any: 'thing' }, spawnIds: ['s1', 's2'] });
    room.receive('a', { t: 'pick', spawnId: 's1' });
    room.receive('a', { t: 'ready', ready: true });
    room.receive('a', { t: 'start', seed: 7 });
    expect(last('a', 'refused')!.reason).toBe('alone');
    room.join(player('b'));
    room.receive('a', { t: 'start', seed: 7 });
    expect(last('a', 'refused')!.reason).toBe('not-ready');
    room.receive('b', { t: 'pick', spawnId: 's2' });
    room.receive('b', { t: 'ready', ready: true });
    room.receive('b', { t: 'start', seed: 7 });
    expect(last('b', 'refused')!.reason).toBe('not-host');
    room.receive('a', { t: 'start', seed: 7 });
    expect(last('b', 'started')).toEqual({
      t: 'started', seed: 7, players: ['a', 'b'], lanes: [['a', 's1'], ['b', 's2']], speed: 1,
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

  it('lets the cheats through where the relay allows them, and says so to the room', () => {
    room = new Room('CHEATS', player('a'), (id, message) => {
      if (!inbox.has(id)) inbox.set(id, []);
      inbox.get(id)!.push(message);
    }, { cheats: true });
    lobby();
    expect(last('b', 'room')!.room.cheats).toBe(true);
    room.receive('a', { t: 'start', seed: 1 });
    room.receive('a', { t: 'cmd', command: { type: 'debug:kill-all' } });
    room.receive('a', { t: 'cmd', command: { type: 'lobby:anything' } as never });
    room.advance(TICK_MS);
    expect(all('b', 'tick').at(-1)!.commands.map((c) => c.command.type)).toEqual(['debug:kill-all']);
  });

  it('asks the guests for ready again when the host sends another map; lanes that remain stay', () => {
    lobby();
    room.receive('a', { t: 'world', world: { other: 'map' }, spawnIds: ['s1', 's2', 's3'] });
    const b = last('b', 'room')!.room.players.find((p) => p.id === 'b')!;
    expect(b).toMatchObject({ spawnId: 's2', ready: false });
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

  it('lets a guest pause and resume at the room speed, but not change it (playtest T12)', () => {
    lobby();
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

  it('compares the hashes of a tick and tells everyone the first one that differs, once (C5)', () => {
    lobby();
    room.receive('a', { t: 'hash', tick: 0, hash: 1 }); // before the start: ignored
    room.receive('a', { t: 'start', seed: 1 });
    room.receive('a', { t: 'hash', tick: 15, hash: 7 });
    room.receive('b', { t: 'hash', tick: 15, hash: 7 });
    expect(all('a', 'desync')).toHaveLength(0);
    room.receive('a', { t: 'hash', tick: 30, hash: 8 });
    room.receive('b', { t: 'hash', tick: 30, hash: 9 });
    room.receive('a', { t: 'hash', tick: 45, hash: 10 });
    room.receive('b', { t: 'hash', tick: 45, hash: 11 });
    expect(all('a', 'desync')).toEqual([{ t: 'desync', tick: 30, hashes: [['a', 8], ['b', 9]] }]);
    expect(all('b', 'desync')).toHaveLength(1);
    const status = room.status();
    expect(status).toMatchObject({ started: true, desyncs: 2, firstDesync: 30 });
    expect(status.players.map((p) => p.lastHash)).toEqual([{ tick: 45, hash: 10 }, { tick: 45, hash: 11 }]);
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
});
