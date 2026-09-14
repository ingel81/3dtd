import { describe, it, expect } from 'vitest';
import {
  NUKE_BLAST_S,
  NUKE_RUMBLE_S,
  NUKE_RUMBLES,
  NUKE_SOUND_RATE,
  nukeBlast,
  nukeRumble,
  nukeSoundUrls,
} from './nuke-sound';
import { onePoleCoefficient } from './synth';

const at = (seconds: number) => Math.round(seconds * NUKE_SOUND_RATE);
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
  const a = onePoleCoefficient(hz, NUKE_SOUND_RATE);
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

describe('nuclear strike sound', () => {
  it('builds the same samples on every call', () => {
    expect(nukeBlast()).toEqual(nukeBlast());
    for (let roll = 0; roll < NUKE_RUMBLES; roll++) expect(nukeRumble(roll)).toEqual(nukeRumble(roll));
  });

  it('has the lengths and peaks it is set to', () => {
    const blast = nukeBlast();
    expect(blast.length).toBe(at(NUKE_BLAST_S));
    expect(peak(blast)).toBeCloseTo(0.95, 5);
    for (let roll = 0; roll < NUKE_RUMBLES; roll++) {
      const rumble = nukeRumble(roll);
      expect(rumble.length).toBe(at(NUKE_RUMBLE_S));
      expect(peak(rumble)).toBeCloseTo(0.8, 5);
    }
  });

  it('cracks at once: near full level within the first 10 ms, and far brighter there than later', () => {
    const blast = nukeBlast();
    expect(peak(blast, 0, at(0.01))).toBeGreaterThan(0.85);
    const bright = highPassed(blast, 2000);
    expect(rms(bright, 0, at(0.03))).toBeGreaterThan(5 * rms(bright, at(0.3), at(1.6)));
  });

  it('booms deep after the crack: from 0.3 s on mostly below 120 Hz, still strong a second in', () => {
    const blast = nukeBlast();
    const from = at(0.3);
    const to = at(1.6);
    expect(rms(lowPassed(blast, 120), from, to)).toBeGreaterThan(4 * rms(highPassed(blast, 1000), from, to));
    expect(rms(blast, at(1), at(1.3))).toBeGreaterThan(0.1);
  });

  it('rumbles low, with a band of roar above it, and each roll differently', () => {
    for (let roll = 0; roll < NUKE_RUMBLES; roll++) {
      const rumble = nukeRumble(roll);
      const low = rms(lowPassed(rumble, 150), 0, rumble.length);
      const roar = rms(highPassed(rumble, 250), 0, rumble.length);
      expect(low).toBeGreaterThan(roar);
      expect(roar).toBeGreaterThan(0.15 * low);
    }
    expect(nukeRumble(0)).not.toEqual(nukeRumble(1));
  });

  it('starts each roll in silence and ends every piece in silence', () => {
    for (let roll = 0; roll < NUKE_RUMBLES; roll++) {
      const rumble = nukeRumble(roll);
      expect(Math.abs(rumble[0])).toBeLessThan(0.01);
      expect(Math.abs(rumble[rumble.length - 1])).toBeLessThan(0.01);
    }
    const blast = nukeBlast();
    expect(Math.abs(blast[blast.length - 1])).toBeLessThan(0.01);
  });

  it('hands out WAV data URLs, built once', () => {
    const urls = nukeSoundUrls();
    expect(urls.rumble).toHaveLength(NUKE_RUMBLES);
    for (const url of [urls.blast, ...urls.rumble]) {
      expect(url.startsWith('data:audio/wav;base64,UklGR')).toBe(true); // "RIFF"
    }
    expect(nukeSoundUrls()).toBe(urls);
  });
});
