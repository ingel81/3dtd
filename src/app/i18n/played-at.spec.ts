import { describe, expect, it } from 'vitest';
import { calendarAge } from './format';
import { de } from './messages/de';
import { en } from './messages/en';

/** When a run was last played, as the Continue entries say it: today, yesterday, a date, a date with its year */
describe('playedAt', () => {
  const now = new Date(2026, 9, 20, 20, 0);
  const at = (y: number, m: number, d: number, h: number, min: number) => new Date(y, m, d, h, min).toISOString();

  it('counts calendar days, not 24 hours', () => {
    expect(calendarAge(at(2026, 9, 20, 0, 5), now)).toEqual({ days: 0, sameYear: true });
    expect(calendarAge(at(2026, 9, 19, 23, 50), now)).toEqual({ days: 1, sameYear: true });
    expect(calendarAge(at(2025, 11, 31, 12, 0), now)).toEqual({ days: 293, sameYear: false });
    // A save ahead of the clock counts as today
    expect(calendarAge(at(2026, 9, 21, 9, 0), now).days).toBe(0);
  });

  it('in German: heute, gestern, day and month, with the year from another year', () => {
    expect(de.worlds.playedAt(at(2026, 9, 20, 18, 42), now)).toBe('heute 18:42');
    expect(de.worlds.playedAt(at(2026, 9, 19, 21, 10), now)).toBe('gestern 21:10');
    expect(de.worlds.playedAt(at(2026, 9, 18, 14, 3), now)).toBe('18.10. 14:03');
    expect(de.worlds.playedAt(at(2025, 9, 18, 14, 3), now)).toBe('18.10.2025 14:03');
  });

  it('in English: today, yesterday, month and day, with the year from another year', () => {
    expect(en.worlds.playedAt(at(2026, 9, 20, 18, 42), now)).toBe('today 6:42 PM');
    expect(en.worlds.playedAt(at(2026, 9, 19, 21, 10), now)).toBe('yesterday 9:10 PM');
    expect(en.worlds.playedAt(at(2026, 9, 18, 14, 3), now)).toBe('Oct 18, 2:03 PM');
    expect(en.worlds.playedAt(at(2025, 9, 18, 14, 3), now)).toBe('Oct 18, 2025, 2:03 PM');
  });
});
