import { describe, it, expect } from 'vitest';
import { formatClock } from './format-clock';

describe('formatClock', () => {
  it('writes minutes and two-digit seconds, rounded down', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(9_999)).toBe('0:09');
    expect(formatClock(72_000)).toBe('1:12');
    expect(formatClock(227_000)).toBe('3:47');
  });

  it('adds the hours from an hour on', () => {
    expect(formatClock(3_600_000)).toBe('1:00:00');
    expect(formatClock(3_725_000)).toBe('1:02:05');
  });

  it('writes a time below zero as 0:00', () => {
    expect(formatClock(-5)).toBe('0:00');
  });
});
