import { describe, expect, it } from 'vitest';
import { waveButtonView } from './wave-button';

describe('waveButtonView', () => {
  it('idle: "Start Wave N" with the upcoming wave, no count, no bar', () => {
    expect(waveButtonView(7, false, 0, 0)).toEqual({
      label: 'Start Wave 7',
      left: null,
      barPercent: 0,
    });
  });

  it('idle ignores a stale wave size', () => {
    expect(waveButtonView(3, false, 20, 5).left).toBeNull();
  });

  it('running: "Wave N", enemies left and the bar at their share', () => {
    expect(waveButtonView(7, true, 40, 18)).toEqual({
      label: 'Wave 7',
      left: '18 left',
      barPercent: 45,
    });
  });

  it('a fresh wave fills the bar, a finished one empties it', () => {
    expect(waveButtonView(2, true, 12, 12).barPercent).toBe(100);
    expect(waveButtonView(2, true, 12, 0)).toMatchObject({ left: '0 left', barPercent: 0 });
  });

  it('clamps left into 0..total', () => {
    expect(waveButtonView(1, true, 10, 14)).toMatchObject({ left: '10 left', barPercent: 100 });
    expect(waveButtonView(1, true, 10, -2)).toMatchObject({ left: '0 left', barPercent: 0 });
  });

  it('a manual debug wave without a known size shows no count and no bar', () => {
    expect(waveButtonView(5, true, 0, 0)).toEqual({ label: 'Wave 5', left: null, barPercent: 0 });
  });
});
