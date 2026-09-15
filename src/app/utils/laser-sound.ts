/**
 * The orbital laser's strike, synthesised in code (no asset): played where
 * the beam comes down (GAME_SOUNDS.orbitalLaser in audio.config.ts, by the
 * AudioService). The burn that follows the beam along the route is an asset
 * loop (AbilityImpactSound.beam). Seeded, so every run builds the same
 * sample; built when the AudioService registers it (laserSoundUrls) and kept
 * as a WAV data URL (utils/pcm-wav.ts).
 *
 * Strike (LASER_STRIKE_S): a zap falling from 3.2 kHz to 200 Hz in a few
 * hundredths of a second, the beam arriving; a crack and a thump where it
 * hits, a sine gliding from 90 to 38 Hz; then the burn sets in: the beam's
 * drone, two sawtooths 15 cents apart at DRONE_HZ with a slow vibrato and a
 * 23 Hz buzz, low-passed at 1.4 kHz, and over it the sizzle of the ground,
 * noise above 2.5 kHz with crackles popping in it at random. The sum goes
 * through a tanh and fades out over its last LASER_FADE_OUT_S.
 */
import { pcmWav, wavDataUrl } from './pcm-wav';
import { normalise, onePoleCoefficient, seeded } from './synth';

export const LASER_SOUND_RATE = 24000;
export const LASER_STRIKE_S = 1.8;
/** The strike fades out over this long at its end */
export const LASER_FADE_OUT_S = 0.5;
/** Pitch of the drone, Hz */
export const LASER_DRONE_HZ = 55;
/** Crackles a second in the sizzle */
const CRACKLES_PER_S = 30;

const TWO_PI = Math.PI * 2;
const samplesOf = (seconds: number) => Math.round(seconds * LASER_SOUND_RATE);
const lowPass = (hz: number) => onePoleCoefficient(hz, LASER_SOUND_RATE);
const between = (rnd: () => number, lo: number, hi: number) => lo + (hi - lo) * rnd();

/** Fade the last `seconds` of `out` to silence along a quarter sine, so it ends without a click. */
function fadeOut(out: Float32Array, seconds: number): void {
  const len = Math.min(out.length, samplesOf(seconds));
  for (let s = 0; s < len; s++) out[out.length - 1 - s] *= Math.sin((s / len) * Math.PI * 0.5) ** 2;
}

/** The burn added into `out` from sample `start` to its end: drone and sizzle (see the file comment), swelling in over 0.12 s. */
function addBurn(out: Float32Array, start: number, rnd: () => number): void {
  const n = out.length;
  // Crackles: short bursts at random times, an envelope over the sizzle
  const crackle = new Float32Array(n);
  const decay = samplesOf(0.006);
  const count = Math.round(((n - start) / LASER_SOUND_RATE) * CRACKLES_PER_S);
  for (let k = 0; k < count; k++) {
    const at = start + Math.floor(rnd() * (n - start));
    const amp = between(rnd, 0.6, 2.2);
    for (let s = 0; s < decay * 5 && at + s < n; s++) crackle[at + s] += amp * Math.exp(-s / decay);
  }

  const droneLow = lowPass(1400);
  const hissLow = lowPass(2500);
  const vibratoPhase = rnd() * TWO_PI;
  let p1 = rnd();
  let p2 = rnd();
  let drone1 = 0;
  let drone2 = 0;
  let hissFloor = 0;
  for (let i = start; i < n; i++) {
    const t = (i - start) / LASER_SOUND_RATE;
    const f = LASER_DRONE_HZ * (1 + 0.012 * Math.sin(TWO_PI * 5.5 * t + vibratoPhase));
    p1 = (p1 + f / LASER_SOUND_RATE) % 1;
    p2 = (p2 + (f * 1.0087) / LASER_SOUND_RATE) % 1;
    const buzz = 0.75 + 0.25 * Math.sin(TWO_PI * 23 * t);
    drone1 += droneLow * ((2 * p1 - 1 + 2 * p2 - 1) * buzz - drone1);
    drone2 += droneLow * (drone1 - drone2);

    const white = rnd() * 2 - 1;
    hissFloor += hissLow * (white - hissFloor);
    const sizzle = (white - hissFloor) * (0.35 + crackle[i]);

    const swell = Math.min(1, t / 0.12);
    out[i] += swell * (0.6 * drone2 + 0.3 * sizzle);
  }
}

/** The strike, LASER_STRIKE_S long: zap, crack, thump and the burn setting in (see the file comment). */
export function laserStrike(): Float32Array {
  const n = samplesOf(LASER_STRIKE_S);
  const rnd = seeded(0x1a5e0);
  const out = new Float32Array(n);
  const pulse = samplesOf(0.006);
  let zap = 0;
  let thump = 0;
  for (let i = 0; i < samplesOf(1); i++) {
    const t = i / LASER_SOUND_RATE;
    // Zap: the beam arriving, falling from 3.2 kHz to 200 Hz
    zap += (TWO_PI * (200 + 3000 * Math.exp(-t / 0.05))) / LASER_SOUND_RATE;
    const zapLevel = Math.min(1, t / 0.002) * Math.exp(-t / 0.12);
    // Crack: straight up, down through zero to the negative peak, back to rest
    const crack = i < pulse ? 1 - (2 * i) / pulse : 0;
    const burst = (rnd() * 2 - 1) * Math.exp(-t / 0.01);
    // Thump: 90 Hz gliding down to 38 Hz
    thump += (TWO_PI * (38 + 52 * Math.exp(-t / 0.08))) / LASER_SOUND_RATE;
    const thumpLevel = (1 - Math.exp(-t / 0.003)) * Math.exp(-t / 0.3);
    out[i] = 0.6 * Math.sin(zap) * zapLevel + 0.8 * crack + 0.6 * burst + 0.9 * Math.sin(thump) * thumpLevel;
  }
  addBurn(out, samplesOf(0.05), rnd);
  for (let i = 0; i < n; i++) out[i] = Math.tanh(1.5 * out[i]);
  fadeOut(out, LASER_FADE_OUT_S);
  return normalise(out, 0.95);
}

export interface LaserSoundUrls {
  strike: string;
}

let urls: LaserSoundUrls | null = null;

/** The strike as a WAV data URL, synthesised on the first call and kept. */
export function laserSoundUrls(): LaserSoundUrls {
  urls ??= { strike: wavDataUrl(pcmWav(laserStrike(), LASER_SOUND_RATE)) };
  return urls;
}
