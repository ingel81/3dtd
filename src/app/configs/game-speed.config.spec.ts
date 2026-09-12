import { describe, expect, it } from 'vitest';
import { stepGameSpeed } from './game-speed.config';

describe('stepGameSpeed', () => {
  it('steps along 1x, 2x, 4x', () => {
    expect(stepGameSpeed(1, 1)).toBe(2);
    expect(stepGameSpeed(2, 1)).toBe(4);
    expect(stepGameSpeed(4, -1)).toBe(2);
    expect(stepGameSpeed(2, -1)).toBe(1);
  });

  it('holds at the ends instead of wrapping', () => {
    expect(stepGameSpeed(4, 1)).toBe(4);
    expect(stepGameSpeed(1, -1)).toBe(1);
  });

  it('brings a training timescale back to the nearest step', () => {
    expect(stepGameSpeed(75, -1)).toBe(4);
    expect(stepGameSpeed(75, 1)).toBe(75);
    expect(stepGameSpeed(0.5, 1)).toBe(1);
    expect(stepGameSpeed(3, -1)).toBe(2);
  });
});
