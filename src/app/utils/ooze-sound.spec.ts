import { describe, it, expect } from 'vitest';
import {
  OOZE_BUBBLE_LOOP_S,
  OOZE_SLURP_S,
  OOZE_SOUND_RATE,
  OOZE_SPLAT_S,
  oozeBubbleLoop,
  oozeSlurp,
  oozeSoundUrls,
  oozeSplat,
} from './ooze-sound';

const peak = (s: Float32Array) => s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
/** Largest jump between two neighbouring samples inside the buffer */
const largestStep = (s: Float32Array) => {
  let max = 0;
  for (let i = 1; i < s.length; i++) max = Math.max(max, Math.abs(s[i] - s[i - 1]));
  return max;
};

describe('ooze sounds', () => {
  it('builds the same samples on every call', () => {
    expect(oozeBubbleLoop()).toEqual(oozeBubbleLoop());
    expect(oozeSplat()).toEqual(oozeSplat());
    expect(oozeSlurp()).toEqual(oozeSlurp());
  });

  it('has the lengths and peaks it is set to', () => {
    const cases: [Float32Array, number, number][] = [
      [oozeBubbleLoop(), OOZE_BUBBLE_LOOP_S, 0.8],
      [oozeSplat(), OOZE_SPLAT_S, 0.9],
      [oozeSlurp(), OOZE_SLURP_S, 0.7],
    ];
    for (const [samples, seconds, level] of cases) {
      expect(samples.length).toBe(Math.round(seconds * OOZE_SOUND_RATE));
      expect(peak(samples)).toBeCloseTo(level, 5);
    }
  });

  it('loops the bubbling without a jump from its end to its start', () => {
    const loop = oozeBubbleLoop();
    const seam = Math.abs(loop[0] - loop[loop.length - 1]);
    expect(seam).toBeLessThanOrEqual(largestStep(loop));
  });

  it('starts and ends the one-shots in silence', () => {
    for (const shot of [oozeSplat(), oozeSlurp()]) {
      expect(Math.abs(shot[0])).toBeLessThan(0.01);
      expect(Math.abs(shot[shot.length - 1])).toBeLessThan(0.01);
    }
  });

  it('hands out WAV data URLs, built once', () => {
    const urls = oozeSoundUrls();
    for (const url of [urls.bubble, urls.splat, urls.slurp]) {
      expect(url.startsWith('data:audio/wav;base64,UklGR')).toBe(true); // "RIFF"
    }
    expect(oozeSoundUrls()).toBe(urls);
  });
});
