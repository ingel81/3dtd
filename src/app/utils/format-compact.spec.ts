import { describe, it, expect } from 'vitest';
import { formatCompact } from './format-compact';

describe('formatCompact', () => {
  it('keeps small numbers whole', () => {
    expect(formatCompact(0)).toBe('0');
    expect(formatCompact(999.9)).toBe('999');
  });

  it('shortens thousands and millions, rounding down', () => {
    expect(formatCompact(1_000)).toBe('1k');
    expect(formatCompact(1_250)).toBe('1.2k');
    expect(formatCompact(9_999)).toBe('9.9k');
    expect(formatCompact(12_345)).toBe('12k');
    expect(formatCompact(999_999)).toBe('999k');
    expect(formatCompact(1_050_000)).toBe('1M');
    expect(formatCompact(2_345_678)).toBe('2.3M');
    expect(formatCompact(12_345_678)).toBe('12M');
  });

  it('reads negative input as 0', () => {
    expect(formatCompact(-5)).toBe('0');
  });
});
