import { describe, it, expect } from 'vitest';
import {
  LASER_BURN_S,
  LASER_BURNS,
  LASER_POWER_DOWN_S,
  LASER_SOUND_RATE,
  LASER_STRIKE_S,
  laserBurn,
  laserSoundUrls,
  laserStrike,
} from './laser-sound';
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
/**
 * Share of the drone in s[from, to) that lies deep: below 35 Hz against
 * below 150 Hz. Rises as the drone's pitch falls, whatever its level; zero
 * crossings would not do, the two saws beat and read as twice the pitch
 * while they are half a period apart.
 */
function deepShare(s: Float32Array, from: number, to: number): number {
  return rms(lowPassed(s, 35), from, to) / rms(lowPassed(s, 150), from, to);
}

describe('orbital laser sound', () => {
  it('builds the same samples on every call', () => {
    expect(laserStrike()).toEqual(laserStrike());
    for (let piece = 0; piece < LASER_BURNS; piece++) expect(laserBurn(piece)).toEqual(laserBurn(piece));
    expect(laserBurn(0)).not.toEqual(laserBurn(1));
  });

  it('has the lengths and peaks it is set to', () => {
    const strike = laserStrike();
    expect(strike.length).toBe(at(LASER_STRIKE_S));
    expect(peak(strike)).toBeCloseTo(0.95, 5);
    for (let piece = 0; piece < LASER_BURNS; piece++) {
      const burn = laserBurn(piece);
      expect(burn.length).toBe(at(LASER_BURN_S));
      expect(peak(burn)).toBeCloseTo(0.8, 5);
    }
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
    for (let piece = 0; piece < LASER_BURNS; piece++) {
      const burn = laserBurn(piece);
      expect(rms(lowPassed(burn, 300), at(0.5), at(1.2))).toBeGreaterThan(0.1);
      expect(rms(highPassed(burn, 2500), at(0.5), at(1.2))).toBeGreaterThan(0.02);
    }
  });

  it('powers down at the end of the last piece: its drone falls in pitch', () => {
    const last = laserBurn(LASER_BURNS - 1);
    const first = laserBurn(0);
    const end = at(LASER_BURN_S) - at(0.02);
    const tail = end - at(LASER_POWER_DOWN_S * 0.4);
    expect(deepShare(last, tail, end)).toBeGreaterThan(1.5 * deepShare(last, at(0.5), at(1.1)));
    // Against the other piece over the same window, which fades out alike but keeps its pitch
    expect(deepShare(last, tail, end)).toBeGreaterThan(1.3 * deepShare(first, tail, end));
  });

  it('starts each piece of burn in silence and ends every piece in silence', () => {
    for (let piece = 0; piece < LASER_BURNS; piece++) {
      const burn = laserBurn(piece);
      expect(Math.abs(burn[0])).toBeLessThan(0.01);
      expect(Math.abs(burn[burn.length - 1])).toBeLessThan(0.01);
    }
    const strike = laserStrike();
    expect(Math.abs(strike[strike.length - 1])).toBeLessThan(0.01);
  });

  it('hands out WAV data URLs, built once', () => {
    const urls = laserSoundUrls();
    expect(urls.burn).toHaveLength(LASER_BURNS);
    for (const url of [urls.strike, ...urls.burn]) {
      expect(url.startsWith('data:audio/wav;base64,UklGR')).toBe(true); // "RIFF"
    }
    expect(laserSoundUrls()).toBe(urls);
  });
});
