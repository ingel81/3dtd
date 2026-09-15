import { describe, it, expect } from 'vitest';
import { LASER_SOUND_RATE, LASER_STRIKE_S, laserSoundUrls, laserStrike } from './laser-sound';
import { onePoleCoefficient } from './synth';

const at = (seconds: number) => Math.round(seconds * LASER_SOUND_RATE);
const peak = (s: Float32Array, from = 0, to = s.length) => {
  let max = 0;
  for (let i = from; i < to; i++) max = Math.max(max, Math.abs(s[i]));
  return max;
};
/** Root mean square of s[from, to) */
const rms = (s: Float32Array, from: number, to: number) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += s[i] * s[i];
  return Math.sqrt(sum / (to - from));
};
/** `s` through two one-pole low-passes at `hz` */
function lowPassed(s: Float32Array, hz: number): Float32Array {
  const a = onePoleCoefficient(hz, LASER_SOUND_RATE);
  const out = new Float32Array(s.length);
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < s.length; i++) {
    y1 += a * (s[i] - y1);
    y2 += a * (y1 - y2);
    out[i] = y2;
  }
  return out;
}
/** What of `s` lies above `hz`: `s` minus its low-passed self */
function highPassed(s: Float32Array, hz: number): Float32Array {
  const low = lowPassed(s, hz);
  return s.map((v, i) => v - low[i]);
}

describe('orbital laser strike sound', () => {
  it('builds the same sample on every call', () => {
    expect(laserStrike()).toEqual(laserStrike());
  });

  it('has the length and peak it is set to', () => {
    const strike = laserStrike();
    expect(strike.length).toBe(at(LASER_STRIKE_S));
    expect(peak(strike)).toBeCloseTo(0.95, 5);
  });

  it('strikes at once: near full level within the first 10 ms', () => {
    expect(peak(laserStrike(), 0, at(0.01))).toBeGreaterThan(0.8);
  });

  it('burns on after the strike: a low drone with a sizzle above it', () => {
    const strike = laserStrike();
    const from = at(0.6);
    const to = at(1.2);
    const drone = rms(lowPassed(strike, 300), from, to);
    const sizzle = rms(highPassed(strike, 2500), from, to);
    expect(drone).toBeGreaterThan(0.1);
    expect(sizzle).toBeGreaterThan(0.1 * drone);
  });

  it('ends in silence', () => {
    const strike = laserStrike();
    expect(Math.abs(strike[strike.length - 1])).toBeLessThan(0.01);
  });

  it('hands out a WAV data URL, built once', () => {
    const urls = laserSoundUrls();
    expect(urls.strike.startsWith('data:audio/wav;base64,UklGR')).toBe(true); // "RIFF"
    expect(laserSoundUrls()).toBe(urls);
  });
});
