/**
 * The orbital laser's sound, synthesised in code (no asset): the strike
 * where the beam comes down and two pieces of burn that follow it in game
 * time while the beam runs along the route (GAME_SOUNDS.orbitalLaser in
 * audio.config.ts, played by the AudioService). Seeded, so every run builds
 * the same samples; built when the AudioService registers them
 * (laserSoundUrls) and kept as WAV data URLs (utils/pcm-wav.ts).
 *
 * Strike (LASER_STRIKE_S): a zap falling from 3.2 kHz to 200 Hz in a few
 * hundredths of a second, the beam arriving; a crack and a thump where it
 * hits, a sine gliding from 90 to 38 Hz; then the burn sets in.
 *
 * Burn (the rest of the strike, and LASER_BURN_S each piece): the beam's
 * drone, two sawtooths 15 cents apart at DRONE_HZ with a slow vibrato and a
 * 23 Hz buzz, low-passed at 1.4 kHz; over it the sizzle of the ground,
 * noise above 2.5 kHz with crackles popping in it at random. The sum goes
 * through a tanh. The pieces fade in and out, so one runs into the next;
 * the last one powers down, its drone falling an octave over its last
 * POWER_DOWN_S.
 */
import { pcmWav, wavDataUrl } from './pcm-wav';
import { normalise, onePoleCoefficient, seeded } from './synth';

export const LASER_SOUND_RATE = 24000;
export const LASER_STRIKE_S = 1.8;
export const LASER_BURN_S = 1.9;
/** One seed per piece of burn */
const BURN_SEEDS = [0x1a5e1, 0x1a5e2] as const;
export const LASER_BURNS = BURN_SEEDS.length;
/** A piece of burn fades in over this long; every piece fades out over the fade-out */
export const LASER_FADE_IN_S = 0.3;
export const LASER_FADE_OUT_S = 0.5;
/** The last piece's drone falls an octave over this long at its end */
export const LASER_POWER_DOWN_S = 0.6;
/** Pitch of the drone, Hz */
export const LASER_DRONE_HZ = 55;
/** Crackles a second in the sizzle */
const CRACKLES_PER_S = 30;

const TWO_PI = Math.PI * 2;
const samplesOf = (seconds: number) => Math.round(seconds * LASER_SOUND_RATE);
const lowPass = (hz: number) => onePoleCoefficient(hz, LASER_SOUND_RATE);
const between = (rnd: () => number, lo: number, hi: number) => lo + (hi - lo) * rnd();

/** Fade the first `seconds` of `out` in from silence along a quarter sine. */
function fadeIn(out: Float32Array, seconds: number): void {
  const len = Math.min(out.length, samplesOf(seconds));
  for (let s = 0; s < len; s++) out[s] *= Math.sin((s / len) * Math.PI * 0.5) ** 2;
}

/** Fade the last `seconds` of `out` to silence along a quarter sine, so it ends without a click. */
function fadeOut(out: Float32Array, seconds: number): void {
  const len = Math.min(out.length, samplesOf(seconds));
  for (let s = 0; s < len; s++) out[out.length - 1 - s] *= Math.sin((s / len) * Math.PI * 0.5) ** 2;
}

/**
 * The burn added into `out` from sample `start` to its end: drone and
 * sizzle (see the file comment), swelling in over 0.12 s; with `powerDown`
 * the drone falls an octave and loses half its level over the last
 * LASER_POWER_DOWN_S.
 */
function addBurn(out: Float32Array, start: number, rnd: () => number, powerDown: boolean): void {
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
  const downFrom = n - samplesOf(LASER_POWER_DOWN_S);
  let p1 = rnd();
  let p2 = rnd();
  let drone1 = 0;
  let drone2 = 0;
  let hissFloor = 0;
  for (let i = start; i < n; i++) {
    const t = (i - start) / LASER_SOUND_RATE;
    const down = powerDown && i > downFrom ? (i - downFrom) / (n - downFrom) : 0;
    const f = LASER_DRONE_HZ * (1 + 0.012 * Math.sin(TWO_PI * 5.5 * t + vibratoPhase)) * 2 ** -down;
    p1 = (p1 + f / LASER_SOUND_RATE) % 1;
    p2 = (p2 + (f * 1.0087) / LASER_SOUND_RATE) % 1;
    const buzz = 0.75 + 0.25 * Math.sin(TWO_PI * 23 * t);
    drone1 += droneLow * ((2 * p1 - 1 + 2 * p2 - 1) * buzz - drone1);
    drone2 += droneLow * (drone1 - drone2);

    const white = rnd() * 2 - 1;
    hissFloor += hissLow * (white - hissFloor);
    const sizzle = (white - hissFloor) * (0.35 + crackle[i]);

    const swell = Math.min(1, t / 0.12);
    out[i] += swell * (1 - 0.5 * down) * (0.6 * drone2 + 0.3 * sizzle);
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
  addBurn(out, samplesOf(0.05), rnd, false);
  for (let i = 0; i < n; i++) out[i] = Math.tanh(1.5 * out[i]);
  fadeOut(out, LASER_FADE_OUT_S);
  return normalise(out, 0.95);
}

/** Piece `piece` (0 to LASER_BURNS - 1) of the burn, LASER_BURN_S long; the last one powers down. */
export function laserBurn(piece: number): Float32Array {
  const out = new Float32Array(samplesOf(LASER_BURN_S));
  addBurn(out, 0, seeded(BURN_SEEDS[piece]), piece === LASER_BURNS - 1);
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(1.3 * out[i]);
  fadeIn(out, LASER_FADE_IN_S);
  fadeOut(out, LASER_FADE_OUT_S);
  return normalise(out, 0.8);
}

export interface LaserSoundUrls {
  strike: string;
  /** One per piece */
  burn: readonly string[];
}

let urls: LaserSoundUrls | null = null;

/** The strike and the pieces of burn as WAV data URLs, synthesised on the first call and kept. */
export function laserSoundUrls(): LaserSoundUrls {
  urls ??= {
    strike: wavDataUrl(pcmWav(laserStrike(), LASER_SOUND_RATE)),
    burn: BURN_SEEDS.map((_, piece) => wavDataUrl(pcmWav(laserBurn(piece), LASER_SOUND_RATE))),
  };
  return urls;
}
