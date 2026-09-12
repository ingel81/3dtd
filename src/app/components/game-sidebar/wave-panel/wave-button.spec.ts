import { describe, expect, it } from 'vitest';
import { waveButtonView } from './wave-button';

describe('waveButtonView', () => {
  it('idle: "Start Wave N" with the upcoming wave, no count, no bar', () => {
    expect(waveButtonView(7, false, 0, 0)).toEqual({
      label: 'Start Wave 7',
      left: null,
      barPercent: 0,
      countdown: null,
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
      countdown: null,
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
    expect(waveButtonView(5, true, 0, 0)).toEqual({ label: 'Wave 5', left: null, barPercent: 0, countdown: null });
  });

  describe('auto-start countdown', () => {
    it('idle: the seconds left and the bar at the share of time left', () => {
      expect(waveButtonView(6, false, 0, 0, 7, 10)).toEqual({
        label: 'Start Wave 6',
        left: null,
        barPercent: 70,
        countdown: '7s',
      });
    });

    it('clamps into 0..total', () => {
      expect(waveButtonView(6, false, 0, 0, 12, 10)).toMatchObject({ countdown: '10s', barPercent: 100 });
      expect(waveButtonView(6, false, 0, 0, -1, 10)).toMatchObject({ countdown: '0s', barPercent: 0 });
    });

    it('a running wave shows no countdown', () => {
      expect(waveButtonView(6, true, 10, 5, 7, 10).countdown).toBeNull();
    });
  });
});
