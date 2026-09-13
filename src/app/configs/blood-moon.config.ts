/**
 * Blood moon waves: a look and nothing else. Every seventh wave from W14 the
 * night turns red, enemies glow and the towers sweep searchlights over the
 * ground. Stats, spawns and gold of the wave stay exactly as they are; no
 * game logic reads anything in here.
 */

/** First blood moon wave */
export const BLOOD_MOON_FIRST_WAVE = 14;
/** Waves from one blood moon to the next, past the curriculum and in endless play alike */
export const BLOOD_MOON_INTERVAL = 7;

/** Is `wave` a blood moon wave? W14, W21, W28, W35, ... without end. */
export function isBloodMoonWave(wave: number): boolean {
  return Number.isInteger(wave)
    && wave >= BLOOD_MOON_FIRST_WAVE
    && (wave - BLOOD_MOON_FIRST_WAVE) % BLOOD_MOON_INTERVAL === 0;
}

/** The first blood moon wave after `wave`. */
export function nextBloodMoonWave(wave: number): number {
  if (wave < BLOOD_MOON_FIRST_WAVE) return BLOOD_MOON_FIRST_WAVE;
  const since = Math.floor(wave) - BLOOD_MOON_FIRST_WAVE;
  return BLOOD_MOON_FIRST_WAVE + (Math.floor(since / BLOOD_MOON_INTERVAL) + 1) * BLOOD_MOON_INTERVAL;
}

/**
 * How the blood moon looks. Times are wall-clock ms while the game runs:
 * the look changes as fast at 4x as at 1x, and a pause holds it where it is.
 */
export const BLOOD_MOON_LOOK = {
  /** From the normal look to the blood moon at the wave start */
  fadeInMs: 3000,
  /** And back once the wave is over */
  fadeOutMs: 4500,
} as const;
