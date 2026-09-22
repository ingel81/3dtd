/**
 * Named parameter sets for the director.
 *
 * A batch of bot runs plays one of these, and the name goes into the run
 * log's head; the analysis groups by it and an A/B compares two sets on the
 * same seeds (BALANCING_PLAN.md, phase 2b and 3b).
 *
 * Only the knobs the tuning actually turns are in here. They are read where
 * they are used, not copied into the callers, so a set that is switched on
 * mid-run takes effect on the next wave rather than the next reload.
 *
 * **Bot mode only.** A player's game always runs `default`: a run that is
 * secretly played under other constants would make its log worthless.
 */

/** What a set may change. */
export interface DirectorParams {
  /** Wave at which the difficulty ramp reaches full strength. */
  rampFullWave: number;
  /**
   * Faktor auf den Zieldruck (`targetPressure`). 1 spielt die Kurve, die aus
   * der Ziel-Lauflänge folgt; darunter wird der Lauf länger und milder,
   * darüber kürzer und härter.
   */
  pressureTargetScale: number;
  /** Proportionalverstärkung des Druck-Reglers, je Welle. */
  pressureGain: number;
  /**
   * How far the count follows the defense's DPS rather than the campaign.
   *
   * 1 is what the game plays: the top of a template's count range opens up
   * with the player's DPS, so a stronger defense meets a bigger wave and the
   * leaks stay where they were. The first baseline showed what that costs —
   * the weaker bot outlived the stronger one (BALANCING_PLAN.md, Baseline).
   * 0 takes the whole range from the template and leaves the answer to the
   * defense entirely to the survivability cap.
   */
  dpsRampWeight: number;
  /**
   * Headroom over the survivability cap, as a factor.
   *
   * At 1 the wave is cut to exactly what the defense can plausibly kill,
   * which is why it is never quite in danger. Above 1 the cap stops being the
   * size of the wave and becomes the line below which a wave would be
   * unwinnable. 1.5 since the first tuning round (BALANCING_PLAN.md).
   */
  capSlack: number;
}

export const DEFAULT_DIRECTOR_PARAMS: DirectorParams = {
  rampFullWave: 60,
  pressureTargetScale: 1,
  pressureGain: 0.5,
  dpsRampWeight: 1,
  // 1.5 out of the first tuning round, 749 runs over four settings: at 1 the
  // weaker bot outlived the stronger one and twelve mid-game waves in a row
  // cost nothing; at 2 both bots collapse to wave 13. At 1.5 the expert
  // reaches wave 26 against the beginner's 19, 27% of its waves 10 to 20 cost
  // HP instead of 17%, and the run gets no shorter (BALANCING_PLAN.md).
  capSlack: 1.5,
};

/**
 * The sets a batch can ask for. `default` is what the game plays.
 *
 * The others are starting points for the first tuning rounds, not decisions:
 * a steeper ramp, a harder or milder target pressure, and a loop that reacts
 * faster or slower.
 */
export const DIRECTOR_PARAM_SETS: Record<string, DirectorParams> = {
  default: DEFAULT_DIRECTOR_PARAMS,
  'steep-ramp': { ...DEFAULT_DIRECTOR_PARAMS, rampFullWave: 40 },
  /** Härterer Lauf: jede Welle soll die Hälfte mehr kosten. */
  'pressure-high': { ...DEFAULT_DIRECTOR_PARAMS, pressureTargetScale: 1.5 },
  /** Milderer Lauf, zur Gegenprobe. */
  'pressure-low': { ...DEFAULT_DIRECTOR_PARAMS, pressureTargetScale: 0.7 },
  'fast-loop': { ...DEFAULT_DIRECTOR_PARAMS, pressureGain: 0.8 },
  'slow-loop': { ...DEFAULT_DIRECTOR_PARAMS, pressureGain: 0.3 },
  /**
   * The close neighbours of the current `capSlack`.
   *
   * 1.25 and 2.0 answered the first, coarse question; these two ask whether
   * 1.5 is really the top of the curve now that the late campaign carries its
   * own intensity factors.
   */
  'cap-tight': { ...DEFAULT_DIRECTOR_PARAMS, capSlack: 1.35 },
  'cap-loose': { ...DEFAULT_DIRECTOR_PARAMS, capSlack: 1.65 },
  /**
   * The wave follows the campaign instead of the player's DPS.
   *
   * Measured once over 430 runs and it changed almost nothing, because the
   * survivability cap binds in nearly every wave and sits below the ramp's
   * ceiling anyway. Kept so the next round can ask again once the cap is
   * looser, which is where the ramp would start to matter.
   */
  'campaign-size': { ...DEFAULT_DIRECTOR_PARAMS, dpsRampWeight: 0 },
};

let active: DirectorParams = DEFAULT_DIRECTOR_PARAMS;
let activeName = 'default';

/** The parameters in force. */
export function directorParams(): DirectorParams {
  return active;
}

/** The name of the set in force, for the run log's head. */
export function directorParamsName(): string {
  return activeName;
}

/**
 * Switch to a named set. An unknown name keeps what is in force and answers
 * false, so a typo in a batch is visible instead of silently playing
 * something else.
 */
export function useDirectorParams(name: string): boolean {
  const params = DIRECTOR_PARAM_SETS[name];
  if (!params) return false;
  active = params;
  activeName = name;
  return true;
}

/** Back to the set the game plays. */
export function resetDirectorParams(): void {
  active = DEFAULT_DIRECTOR_PARAMS;
  activeName = 'default';
}
