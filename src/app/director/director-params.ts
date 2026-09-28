/**
 * Named parameter sets for the pressure loop.
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
  /**
   * Faktor auf den Zieldruck (`targetPressure`). 1 spielt die Kurve, die aus
   * der Ziel-Lauflänge folgt; darunter wird der Lauf länger und milder,
   * darüber kürzer und härter.
   */
  pressureTargetScale: number;
  /** Proportionalverstärkung des Druck-Reglers, je Welle. */
  pressureGain: number;
}

export const DEFAULT_DIRECTOR_PARAMS: DirectorParams = {
  pressureTargetScale: 1,
  pressureGain: 0.5,
};

/**
 * The sets a batch can ask for. `default` is what the game plays.
 *
 * The others are starting points for tuning rounds, not decisions: a harder
 * or milder target pressure, and a loop that reacts faster or slower.
 */
export const DIRECTOR_PARAM_SETS: Record<string, DirectorParams> = {
  default: DEFAULT_DIRECTOR_PARAMS,
  /** Härterer Lauf: jede Welle soll die Hälfte mehr kosten. */
  'pressure-high': { ...DEFAULT_DIRECTOR_PARAMS, pressureTargetScale: 1.5 },
  /** Milderer Lauf, zur Gegenprobe. */
  'pressure-low': { ...DEFAULT_DIRECTOR_PARAMS, pressureTargetScale: 0.7 },
  'fast-loop': { ...DEFAULT_DIRECTOR_PARAMS, pressureGain: 0.8 },
  'slow-loop': { ...DEFAULT_DIRECTOR_PARAMS, pressureGain: 0.3 },
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
