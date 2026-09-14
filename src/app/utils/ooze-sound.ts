/**
 * The ooze's sounds, synthesised in code (there is no slime asset): a
 * bubbling loop for its body, a wet splat and the slump of its collapse when
 * it breaks up and a slurp while it flows into the HQ. Seeded, so every run
 * builds the same samples; built on first use (oozeSoundUrls) and kept as
 * WAV data URLs (utils/pcm-wav.ts).
 */
import { pcmWav, wavDataUrl } from './pcm-wav';

export const OOZE_SOUND_RATE = 22050;

/** Length of the bubbling loop; the end runs seamlessly into the start */
export const OOZE_BUBBLE_LOOP_S = 3;
/** The splat runs on over the band's collapse (OOZE_LOOK.collapse, 2 s) and a little past it */
export const OOZE_SPLAT_S = 2.2;
export const OOZE_SLURP_S = 1.1;

/** The wet burst at the start of the splat, over which its droplets thin out (the whole splat until 2026-09-14) */
const SPLAT_BURST_S = 0.9;

const TWO_PI = Math.PI * 2;

/** Seeded PRNG (mulberry32), 0..1 */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (rnd: () => number, lo: number, hi: number) => lo + (hi - lo) * rnd();
/** Log-uniform between lo and hi, for pitches */
const pitch = (rnd: () => number, lo: number, hi: number) => lo * Math.pow(hi / lo, rnd());
const samplesOf = (seconds: number) => Math.round(seconds * OOZE_SOUND_RATE);

/**
 * One bubble added into `out` from sample `start`: a sine whose pitch rises
 * by `rise` times over its length as it closes, 4 ms attack, exponential
 * decay. With `wrap` it runs past the end into the start (the loop).
 */
function addBubble(
  out: Float32Array,
  start: number,
  freq: number,
  seconds: number,
  amp: number,
  rise: number,
  wrap: boolean,
): void {
  const len = samplesOf(seconds);
  const attack = samplesOf(0.004);
  let phase = 0;
  for (let s = 0; s < len; s++) {
    let i = start + s;
    if (i >= out.length) {
      if (!wrap) return;
      i -= out.length;
    }
    const t = s / len;
    const env = Math.min(1, s / attack) * Math.exp(-5 * t);
    phase += (TWO_PI * freq * (1 + (rise - 1) * t)) / OOZE_SOUND_RATE;
    out[i] += Math.sin(phase) * amp * env;
  }
}

/** One-pole low-pass coefficient for cutoff `hz` */
const lowPassCoefficient = (hz: number) => 1 - Math.exp((-TWO_PI * hz) / OOZE_SOUND_RATE);

/** Scale `out` so its loudest sample is `peak`. */
function normalise(out: Float32Array, peak: number): Float32Array {
  let max = 0;
  for (const v of out) max = Math.max(max, Math.abs(v));
  if (max > 0) {
    const k = peak / max;
    for (let i = 0; i < out.length; i++) out[i] *= k;
  }
  return out;
}

/** Fade the last `seconds` of a one-shot to silence, so it ends without a click. */
function fadeOut(out: Float32Array, seconds: number): void {
  const len = Math.min(out.length, samplesOf(seconds));
  for (let s = 0; s < len; s++) out[out.length - 1 - s] *= s / len;
}

/**
 * The body's bubbling, OOZE_BUBBLE_LOOP_S long: a dark rumble (low-passed
 * noise, filtered around the loop so its end meets its start, swelling twice
 * per loop) under bubbles that rise in pitch and a few deep gloops, all
 * wrapped around the end.
 */
export function oozeBubbleLoop(): Float32Array {
  const n = samplesOf(OOZE_BUBBLE_LOOP_S);
  const rnd = seeded(0x5117e);
  const noise = new Float32Array(n);
  for (let i = 0; i < n; i++) noise[i] = rnd() * 2 - 1;

  // Two one-pole stages at 180 Hz, each run twice around the loop so the
  // filter state at the end is the one the start continues from
  const out = new Float32Array(n);
  const a = lowPassCoefficient(180);
  let y1 = 0;
  let y2 = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      y1 += a * (noise[i] - y1);
      y2 += a * (y1 - y2);
      out[i] = y2;
    }
  }
  normalise(out, 0.25);
  for (let i = 0; i < n; i++) out[i] *= 0.7 + 0.3 * Math.sin((TWO_PI * 2 * i) / n);

  for (let b = 0; b < 22; b++) {
    const start = Math.floor(rnd() * n);
    addBubble(out, start, pitch(rnd, 120, 420), between(rnd, 0.05, 0.14), between(rnd, 0.25, 0.6), between(rnd, 1, 2.2), true);
  }
  for (let g = 0; g < 3; g++) {
    const start = Math.floor(rnd() * n);
    addBubble(out, start, pitch(rnd, 70, 110), between(rnd, 0.2, 0.26), 0.5, 0.6 + rnd() * 0.2, true);
  }
  return normalise(out, 0.8);
}

/**
 * The break-up, OOZE_SPLAT_S long, one voice over the band's collapse: a
 * low thump falling from 90 to 45 Hz, a wet burst (noise under a low-pass
 * that closes from 3.5 kHz to 250 Hz) and droplets that thin out over its
 * first 0.9 s; then the mass slumping, a dark rumble (low-passed noise)
 * swelling from 0.15 s and gone at the end, with bubbles bursting in it,
 * denser early and softer late, and a few deep gloops.
 */
export function oozeSplat(): Float32Array {
  const n = samplesOf(OOZE_SPLAT_S);
  const rnd = seeded(0x5b1a7);
  const out = new Float32Array(n);
  const attack = samplesOf(0.003);
  const rumbleA = lowPassCoefficient(160);
  const slumpFrom = 0.15;
  const slumpS = OOZE_SPLAT_S - slumpFrom - 0.1;

  let phase = 0;
  let y = 0;
  let r1 = 0;
  let r2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / OOZE_SOUND_RATE;
    const rise = Math.min(1, i / attack);
    phase += (TWO_PI * (45 + 45 * Math.exp(-t / 0.08))) / OOZE_SOUND_RATE;
    const thump = Math.sin(phase) * Math.exp(-t / 0.06) * 0.9;
    const cutoff = 250 + 3250 * Math.exp(-t / 0.12);
    y += lowPassCoefficient(cutoff) * (rnd() * 2 - 1 - y);
    const burst = y * Math.exp(-t / 0.11) * 1.6;
    r1 += rumbleA * (rnd() * 2 - 1 - r1);
    r2 += rumbleA * (r1 - r2);
    const slump = Math.sin(Math.PI * Math.min(1, Math.max(0, (t - slumpFrom) / slumpS))) ** 1.5;
    out[i] = (thump + burst) * rise + r2 * slump * 6;
  }

  for (let d = 0; d < 14; d++) {
    const u = rnd();
    const t = 0.03 + 0.62 * u * u;
    addBubble(out, samplesOf(t), pitch(rnd, 350, 1100), between(rnd, 0.018, 0.055), between(rnd, 0.15, 0.4) * (1 - t / SPLAT_BURST_S), between(rnd, 1.3, 2.5), false);
  }
  // Bubbles bursting as the body collapses, fewer and softer towards the end
  for (let b = 0; b < 18; b++) {
    const t = 0.3 + (OOZE_SPLAT_S - 0.55) * rnd() ** 1.4;
    addBubble(out, samplesOf(t), pitch(rnd, 160, 650), between(rnd, 0.03, 0.09), between(rnd, 0.25, 0.55) * (1 - 0.6 * (t / OOZE_SPLAT_S)), between(rnd, 1.4, 2.6), false);
  }
  // Deep gloops as the mass settles
  for (let g = 0; g < 5; g++) {
    const t = between(rnd, 0.35, 1.7);
    addBubble(out, samplesOf(t), pitch(rnd, 65, 120), between(rnd, 0.14, 0.24), between(rnd, 0.35, 0.55), 0.6 + rnd() * 0.25, false);
  }
  fadeOut(out, 0.15);
  return normalise(out, 0.9);
}

/**
 * The flow into the HQ, OOZE_SLURP_S long: suction (noise through a band-pass
 * sweeping up from 250 Hz to 1.3 kHz, swelling in and cut off at the end)
 * over a few gurgles.
 */
export function oozeSlurp(): Float32Array {
  const n = samplesOf(OOZE_SLURP_S);
  const rnd = seeded(0x51c9);
  const out = new Float32Array(n);
  const q = 4;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    // RBJ band-pass (0 dB peak), centre moved every sample
    const w0 = (TWO_PI * 250 * Math.pow(1300 / 250, t)) / OOZE_SOUND_RATE;
    const alpha = Math.sin(w0) / (2 * q);
    const a0 = 1 + alpha;
    const x0 = rnd() * 2 - 1;
    const y0 = (alpha * x0 - alpha * x2 + 2 * Math.cos(w0) * y1 - (1 - alpha) * y2) / a0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    const swell = Math.sin(Math.min(1, (i / OOZE_SOUND_RATE) / 0.25) * Math.PI * 0.5) ** 2;
    out[i] = y0 * swell * 2.2;
  }
  for (let g = 0; g < 9; g++) {
    const t = between(rnd, 0.05, 0.9);
    addBubble(out, samplesOf(t), pitch(rnd, 90, 260), between(rnd, 0.06, 0.15), between(rnd, 0.3, 0.55), between(rnd, 1.2, 1.8), false);
  }
  fadeOut(out, 0.12);
  return normalise(out, 0.7);
}

export interface OozeSoundUrls {
  bubble: string;
  splat: string;
  slurp: string;
}

let urls: OozeSoundUrls | null = null;

/** The three sounds as WAV data URLs, synthesised on the first call (a few ms) and kept. */
export function oozeSoundUrls(): OozeSoundUrls {
  urls ??= {
    bubble: wavDataUrl(pcmWav(oozeBubbleLoop(), OOZE_SOUND_RATE)),
    splat: wavDataUrl(pcmWav(oozeSplat(), OOZE_SOUND_RATE)),
    slurp: wavDataUrl(pcmWav(oozeSlurp(), OOZE_SOUND_RATE)),
  };
  return urls;
}
