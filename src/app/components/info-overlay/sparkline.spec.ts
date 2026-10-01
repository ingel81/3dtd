import { describe, it, expect } from 'vitest';
import { sparkChart } from './sparkline';

describe('sparkChart', () => {
  it('spreads the values over the width on a fixed scale, 0 at the bottom', () => {
    const chart = sparkChart([0, 30, 60], 100, 20, 60, [0, 15]);
    expect(chart.points).toBe('0.0,20.0 50.0,10.0 100.0,0.0');
    expect(chart.dot).toEqual({ x: 100, y: 0 });
    expect([chart.last, chart.min, chart.max]).toEqual([60, 0, 60]);
  });

  it('draws a spike at the edge instead of stretching the scale', () => {
    expect(sparkChart([30, 300], 10, 20, 60, [0, 0]).points).toBe('0.0,10.0 10.0,0.0');
    expect(sparkChart([30, -5], 10, 20, 60, [0, 0]).points).toBe('0.0,10.0 10.0,20.0');
  });

  it('shades the bad range as a band, clipped to the scale', () => {
    // FPS below 30 on a scale to 150
    expect(sparkChart([], 96, 20, 150, [0, 30]).band).toEqual({ y: 16, height: 4 });
    // Sim over 90 %, up to beyond the top
    expect(sparkChart([], 96, 20, 1, [0.9, 2]).band).toEqual({ y: 0, height: 2 });
  });

  it('has no line for fewer than two values, a dot for one', () => {
    expect(sparkChart([], 100, 20, 60, [0, 0])).toMatchObject({ points: '', dot: null });
    expect(sparkChart([5], 100, 20, 60, [0, 0])).toMatchObject({ points: '', dot: { x: 0, y: 18.3 }, last: 5 });
  });
});
