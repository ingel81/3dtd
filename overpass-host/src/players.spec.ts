// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { dayOf, DailyPlayers } from './players.ts';

const DAY = 86_400_000;
const T0 = Date.parse('2026-10-18T08:00:00Z');

describe('DailyPlayers', () => {
  it('counts each client once a day', () => {
    const players = new DailyPlayers({ now: () => T0 });
    for (const key of ['203.0.113.1', '203.0.113.1', '2001:db8:aa:bb::/64', '203.0.113.2']) players.see(key);
    expect(players.current()).toEqual({ day: '2026-10-18', players: 3 });
  });

  it('hands on a day\'s count when the next begins, and counts a client of yesterday anew under the new key', () => {
    let now = T0;
    const ended: [string, number][] = [];
    const players = new DailyPlayers({ now: () => now, onDayEnd: (day, n) => ended.push([day, n]) });
    players.see('a');
    players.see('b');
    now += DAY;
    players.see('a');
    expect(ended).toEqual([['2026-10-18', 2]]);
    expect(players.current()).toEqual({ day: '2026-10-19', players: 1 });
  });

  it('keeps no address and no hash of one day to the next', () => {
    let now = T0;
    const players = new DailyPlayers({ now: () => now });
    players.see('203.0.113.1');
    const state = (p: DailyPlayers) => JSON.stringify(Object.values(p as unknown as Record<string, unknown>), (_, v) => (v instanceof Set ? [...v] : v));
    expect(state(players)).not.toContain('203.0.113.1');
    const first = (players as unknown as { seen: Set<string> }).seen;
    now += DAY;
    players.see('203.0.113.1');
    const second = (players as unknown as { seen: Set<string> }).seen;
    expect(second).not.toBe(first);
    // The same address hashes to something else under the next day's key
    expect([...second][0]).not.toBe([...first][0]);
  });

  it('adds to the count written before a restart, and stops at the most it holds', () => {
    const players = new DailyPlayers({ now: () => T0, baseOf: (day) => (day === dayOf(T0) ? 40 : 0), maxPerDay: 2 });
    for (const key of ['a', 'b', 'c']) players.see(key);
    expect(players.current().players).toBe(42);
  });
});
