/**
 * The nuclear strike's sound, synthesised in code (no asset): the blast and
 * three rolls of rumble that follow it in game time (GAME_SOUNDS.nuclearStrike
 * in audio.config.ts, played by the AudioService). Seeded, so every run
 * builds the same samples; built when the AudioService registers them
 * (nukeSoundUrls) and kept as WAV data URLs (utils/pcm-wav.ts).
 *
 * Blast (NUKE_BLAST_S): a sharp crack, an N-shaped pressure pulse over a
 * burst of noise and ticks thinning out over 0.3 s, the air tearing; a
 * sub-bass boom, a sine gliding from 70 to 28 Hz and dying away over about
 * two seconds; the roar of the fireball, noise under a low-pass closing from
 * 1.8 kHz to 150 Hz. The sum goes through a tanh: louder, and the odd
 * harmonics carry the boom onto speakers without bass.
 *
 * Rumble (NUKE_RUMBLE_S each): low noise (two one-pole low-passes at 110 Hz)
 * with a band of roar between 250 and 700 Hz, swelling in five rolls at
 * random times, and two deep thumps like echoes from far away; faded in and
 * out, so one roll runs into the next.
 */
import { pcmWav, wavDataUrl } from './pcm-wav';
import { normalise, onePoleCoefficient, seeded } from './synth';

export const NUKE_SOUND_RATE = 24000;
export const NUKE_BLAST_S = 2.4;
export const NUKE_RUMBLE_S = 3;
/** One seed per roll of rumble */
const RUMBLE_SEEDS = [0x6e0c1, 0x6e0c2, 0x6e0c3] as const;
export const NUKE_RUMBLES = RUMBLE_SEEDS.length;
/** A roll of rumble fades in over this long and out over the fade-out */
export const NUKE_RUMBLE_FADE_IN_S = 0.35;
export const NUKE_RUMBLE_FADE_OUT_S = 0.7;
/** Samples per step of the rumble's swell envelope, 1.3 ms */
const SWELL_BLOCK = 32;

const TWO_PI = Math.PI * 2;
const samplesOf = (seconds: number) => Math.round(seconds * NUKE_SOUND_RATE);
const lowPass = (hz: number) => onePoleCoefficient(hz, NUKE_SOUND_RATE);
const between = (rnd: () => number, lo: number, hi: number) => lo + (hi - lo) * rnd();

/** Fade the last `seconds` of `out` to silence along a quarter sine, so it ends without a click. */
function fadeOut(out: Float32Array, seconds: number): void {
  const len = Math.min(out.length, samplesOf(seconds));
  for (let s = 0; s < len; s++) out[out.length - 1 - s] *= Math.sin((s / len) * Math.PI * 0.5) ** 2;
}

/** The blast, NUKE_BLAST_S long: crack, boom and roar (see the file comment). */
export function nukeBlast(): Float32Array {
  const n = samplesOf(NUKE_BLAST_S);
  const rnd = seeded(0x6e0b1);
  const out = new Float32Array(n);
  const pulse = samplesOf(0.007);
  let phase = 0;
  let roar1 = 0;
  let roar2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / NUKE_SOUND_RATE;
    const white = rnd() * 2 - 1;
    // Crack: straight up, down through zero to the negative peak, back to rest
    const crack = i < pulse ? 1 - (2 * i) / pulse : 0;
    const burst = white * Math.exp(-t / 0.006);
    // Boom: 70 Hz gliding down to 28 Hz
    phase += (TWO_PI * (28 + 42 * Math.exp(-t / 0.25))) / NUKE_SOUND_RATE;
    const boom = Math.sin(phase) * (1 - Math.exp(-t / 0.006)) * Math.exp(-t / 0.85);
    // Roar: the low-pass closes from 1.8 kHz to 150 Hz
    const a = lowPass(150 + 1650 * Math.exp(-t / 0.14));
    roar1 += a * (white - roar1);
    roar2 += a * (roar1 - roar2);
    const roar = 3.2 * roar2 * (1 - Math.exp(-t / 0.004)) * Math.exp(-t / 0.5);
    out[i] = 0.9 * crack + 0.7 * burst + boom + roar;
  }
  // Ticks thinning out over the first 0.3 s
  for (let k = 0; k < 90; k++) {
    const u = rnd();
    const t = 0.004 + 0.3 * u * u;
    const at = samplesOf(t);
    const amp = (0.25 + 0.35 * rnd()) * Math.exp(-t / 0.09) * (rnd() < 0.5 ? -1 : 1);
    out[at] += amp;
    out[at + 1] -= 0.6 * amp;
    out[at + 2] += 0.2 * amp;
  }
  for (let i = 0; i < n; i++) out[i] = Math.tanh(1.6 * out[i]);
  fadeOut(out, 0.35);
  return normalise(out, 0.95);
}

/** Roll `roll` (0 to NUKE_RUMBLES - 1) of the rumble, NUKE_RUMBLE_S long (see the file comment). */
export function nukeRumble(roll: number): Float32Array {
  const n = samplesOf(NUKE_RUMBLE_S);
  const rnd = seeded(RUMBLE_SEEDS[roll]);
  const out = new Float32Array(n);
  const swells = Array.from({ length: 5 }, () => ({
    at: between(rnd, 0.25, NUKE_RUMBLE_S - 0.8),
    width: between(rnd, 0.18, 0.5),
    amp: between(rnd, 0.45, 1),
  }));
  const low = lowPass(110);
  const bandTop = lowPass(700);
  const bandFoot = lowPass(250);
  let low1 = 0;
  let low2 = 0;
  let top = 0;
  let foot = 0;
  let swell = 0;
  for (let i = 0; i < n; i++) {
    // The swells change slowly: worked out once per block of samples
    if (i % SWELL_BLOCK === 0) {
      const t = (i + SWELL_BLOCK / 2) / NUKE_SOUND_RATE;
      swell = 0.35;
      for (const s of swells) swell += s.amp * Math.exp(-(((t - s.at) / s.width) ** 2));
    }
    const white = rnd() * 2 - 1;
    low1 += low * (white - low1);
    low2 += low * (low1 - low2);
    top += bandTop * (white - top);
    foot += bandFoot * (white - foot);
    out[i] = (5 * low2 + 1.2 * (top - foot)) * swell;
  }
  // Thumps: echoes from far away
  const thump = samplesOf(0.6);
  for (let k = 0; k < 2; k++) {
    const start = samplesOf(between(rnd, 0.3, NUKE_RUMBLE_S - 1));
    const freq = between(rnd, 38, 55);
    for (let s = 0; s < thump && start + s < n; s++) {
      const t = s / NUKE_SOUND_RATE;
      out[start + s] += 0.5 * Math.sin(TWO_PI * freq * t) * Math.min(1, t / 0.01) * Math.exp(-t / 0.22);
    }
  }
  for (let i = 0; i < n; i++) out[i] = Math.tanh(1.3 * out[i]);
  const fadeIn = samplesOf(NUKE_RUMBLE_FADE_IN_S);
  for (let s = 0; s < fadeIn; s++) out[s] *= Math.sin((s / fadeIn) * Math.PI * 0.5) ** 2;
  fadeOut(out, NUKE_RUMBLE_FADE_OUT_S);
  return normalise(out, 0.8);
}

export interface NukeSoundUrls {
  blast: string;
  /** One per roll */
  rumble: readonly string[];
}

let urls: NukeSoundUrls | null = null;

/** The blast and the rolls of rumble as WAV data URLs, synthesised on the first call and kept. */
export function nukeSoundUrls(): NukeSoundUrls {
  urls ??= {
    blast: wavDataUrl(pcmWav(nukeBlast(), NUKE_SOUND_RATE)),
    rumble: RUMBLE_SEEDS.map((_, roll) => wavDataUrl(pcmWav(nukeRumble(roll), NUKE_SOUND_RATE))),
  };
  return urls;
}
