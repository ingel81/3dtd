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
  /**
   * Red, dark mood over the whole picture (BloodMoonMood): the frame is
   * multiplied by `tint` in display values, so red keeps most of its
   * strength while green and blue drop; the corners darken by `vignette`
   * on top. The sky dims to `skyIntensity` first, the distance fog turns
   * to `fogColor` (sRGB).
   */
  mood: {
    tint: { r: 0.84, g: 0.38, b: 0.34 },
    vignette: 0.4,
    skyIntensity: 0.6,
    fogColor: 0x2b1311,
  },
  /**
   * Enemies glow (VAT shader, one uniform for every type): `color` times
   * `rim` where the surface turns away from the camera (squared falloff)
   * plus `base` all over, added before the shader's tone mapping. The mood
   * multiplies it afterwards, so an orange here ends up red on screen.
   */
  glow: {
    color: { r: 1.0, g: 0.2, b: 0.08 },
    rim: 2.4,
    base: 0.12,
  },
  /**
   * Searchlights on the towers (SearchlightRenderer): an additive cone from
   * a lamp on top of each tower, tipped `pitchDeg` below the horizontal,
   * sweeping `sweepArcDeg` to each side of the tower's guard heading. Each
   * tower takes a random sweep period in `sweepPeriodS` and a random phase,
   * so the beams never move in step. Passive buildings get none.
   */
  searchlights: {
    /** Warm white in display values, against the red night */
    color: { r: 1.0, g: 0.9, b: 0.72 },
    /** Light one wall of the cone adds at the lamp, display values; fades to 0 at the far end */
    intensity: 0.32,
    /** Beam length, m */
    length: 34,
    /** Half the opening angle, degrees */
    halfAngleDeg: 7,
    pitchDeg: 18,
    sweepArcDeg: 60,
    /** One sweep there and back, s */
    sweepPeriodS: [10, 16],
    /** Lamp above the tower's shoot height, m */
    lampLift: 0.8,
    /** Lowest lamp above the tower's foot, m, for models that shoot from low down */
    minLampHeight: 3,
  },
} as const;
