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
    room.receive('a', { t: 'start', seed: 7 });
    expect(last('a', 'refused')!.reason).toBe('not-ready');
    lobby();
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
});
