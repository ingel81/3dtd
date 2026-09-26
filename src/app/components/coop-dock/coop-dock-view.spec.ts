import { describe, expect, it } from 'vitest';
import type { CoopRoomInfo, CoopPlayerInfo } from '../../coop/protocol';
import { DEFAULT_ROOM_OPTIONS } from '../../coop/room-options';
import { desyncText, dockBanners, joinSteps, roomStatus, roomTable, startBlocked } from './coop-dock-view';

function player(id: string, spawnId: string | null, extra: Partial<CoopPlayerInfo> = {}): CoopPlayerInfo {
  return { id, name: id.toUpperCase(), spawnId, ready: false, client: null, status: 'ready', ...extra };
}

function room(players: CoopPlayerInfo[], spawnIds = ['s1', 's2', 's3']): CoopRoomInfo {
  return {
    code: 'ABC123', hostId: 'ann', players, spawnIds, started: false, cheats: false, locked: false,
    options: DEFAULT_ROOM_OPTIONS, listing: { public: false, title: '', city: '' },
  } as CoopRoomInfo;
}

describe('joinSteps', () => {
  it('marks what is done and what runs, by kind, not by label', () => {
    const steps = joinSteps({ status: 'loading-world', room: room([player('ann', 's1')]), relay: 'EU', mapPercent: 40, worldReady: false, mySpawn: null });
    expect(steps.map((s) => [s.kind, s.state, s.meta])).toEqual([
      ['server', 'done', 'EU'],
      ['room', 'done', '1/4 players'],
      ['map', 'now', '40 %'],
      ['seat', 'todo', ''],
    ]);
  });
});

describe('roomStatus and startBlocked', () => {
  const base = { isHost: true, myId: 'ann', worldReady: true, hostName: 'ANN' };

  it('alone: waits for a second player, with a free segment', () => {
    const status = roomStatus({ ...base, room: room([player('ann', 's1')]) })!;
    expect(status.text).toBe('Waiting for a second player · share the code');
    expect(status.segments).toEqual([true, false]);
    expect(startBlocked(room([player('ann', 's1')]), true)).toBe('Needs a second player');
  });

  it('names who loads, who has no lane, who is not ready; then everyone is ready', () => {
    const loading = room([player('ann', 's1'), player('bob', null, { status: 'loading' })]);
    expect(roomStatus({ ...base, room: loading })).toMatchObject({ bold: 'BOB', text: ' to load the map' });
    const noLane = room([player('ann', 's1'), player('bob', null)]);
    expect(roomStatus({ ...base, room: noLane })).toMatchObject({ bold: 'BOB', text: ' to take a lane' });
    const notReady = room([player('ann', 's1'), player('bob', 's2')]);
    expect(roomStatus({ ...base, room: notReady })).toMatchObject({ bold: 'BOB', text: ' to ready up (1/2)' });
    expect(startBlocked(notReady, true)).toBe('Waiting for BOB');
    const ready = room([player('ann', 's1'), player('bob', 's2', { ready: true })]);
    expect(roomStatus({ ...base, room: ready })).toMatchObject({ go: true, bold: 'Everyone is ready.' });
    expect(startBlocked(ready, true)).toBeNull();
    expect(startBlocked(ready, false)).toBe('The map is still being sent');
    // A taken lane without a route does not start (TODO E34, point 7)
    expect(startBlocked(ready, true, ['s2'])).toBe('Spawn 2 has no route');
  });

  it('a guest who is not ready is told to pick a lane and ready up', () => {
    const r = room([player('ann', 's1'), player('bob', 's2')]);
    expect(roomStatus({ ...base, isHost: false, myId: 'bob', room: r })).toMatchObject({ lead: 'Pick a lane, then ', bold: 'ready up' });
  });
});

describe('roomTable', () => {
  it('one row per lane with its player, free lanes empty, players without a lane after', () => {
    const r = room([player('ann', 's1'), player('bob', 's3', { ready: true }), player('carl', null, { status: 'loading' })]);
    const table = roomTable({
      room: r,
      myId: 'bob',
      lanes: new Map([['s1', { meters: 820, seconds: 227, share: 1 }]]),
      latencyOf: (id) => (id === 'ann' ? 30 : null),
      laggingOf: () => false,
      leftIds: new Set(),
    });
    expect(table.lanes.map((l) => [l.label, l.player?.name ?? null])).toEqual([['Spawn 1', 'ANN'], ['Spawn 2', null], ['Spawn 3', 'BOB']]);
    expect(table.lanes[0]).toMatchObject({ length: '820 m · 3:47', share: 1, color: '#ef4444' });
    expect(table.lanes[0].player).toMatchObject({ host: true, ready: true, latency: 30 });
    expect(table.lanes[2].player).toMatchObject({ me: true, ready: true });
    expect(table.seatless.map((p) => [p.name, p.doing])).toEqual([['CARL', 'Loading the map…']]);
  });
});

describe('dockBanners and desyncText', () => {
  it('puts the warnings first and the map change last', () => {
    const banners = dockBanners({ desync: 'Out of step', hostChangingMap: true, mixedEngines: true });
    expect(banners.map((b) => [b.kind, b.warn])).toEqual([['desync', true], ['engines', true], ['map', false]]);
    expect(dockBanners({ desync: null, hostChangingMap: false, mixedEngines: false })).toEqual([]);
  });

  it('says whose game ran apart', () => {
    const nameOf = (id: string) => id.toUpperCase();
    expect(desyncText(['bob'], '94', 'bob', nameOf)).toMatch(/^Your game ran apart from the others at game second 94:/);
    expect(desyncText(['bob', 'carl'], '94', 'ann', nameOf)).toMatch(/^BOB and CARL's game ran apart/);
    expect(desyncText([], '94', 'ann', nameOf)).toMatch(/^The games ran apart/);
  });
});

