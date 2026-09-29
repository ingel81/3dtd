import { describe, it, expect } from 'vitest';
import { sparkPoints } from './sparkline';

describe('sparkPoints', () => {
  it('spreads the values over the width, 0 at the bottom, the top at max or the largest value', () => {
    expect(sparkPoints([0, 30, 60], 100, 20, 60)).toBe('0.0,20.0 50.0,10.0 100.0,0.0');
    expect(sparkPoints([0, 120], 10, 20, 60)).toBe('0.0,20.0 10.0,0.0');
  });

  it('draws nothing for fewer than two values', () => {
    expect(sparkPoints([5], 100, 20)).toBe('');
  });
});
