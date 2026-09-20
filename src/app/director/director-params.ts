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
  /** Share of a wave that may reach the base before the loop closes. */
  leakTargetLo: number;
  leakTargetHi: number;
  /** Proportional gain of the leak loop, per adapt window. */
  leakGain: number;
}

export const DEFAULT_DIRECTOR_PARAMS: DirectorParams = {
  rampFullWave: 60,
  leakTargetLo: 0.08,
  leakTargetHi: 0.16,
  leakGain: 0.35,
};

/**
 * The sets a batch can ask for. `default` is what the game plays.
 *
 * The others are starting points for the first tuning rounds, not decisions:
 * a steeper ramp, a wider leak band, and a loop that reacts faster.
 */
export const DIRECTOR_PARAM_SETS: Record<string, DirectorParams> = {
  default: DEFAULT_DIRECTOR_PARAMS,
  'steep-ramp': { ...DEFAULT_DIRECTOR_PARAMS, rampFullWave: 40 },
  'wide-band': { ...DEFAULT_DIRECTOR_PARAMS, leakTargetLo: 0.12, leakTargetHi: 0.24 },
  'fast-loop': { ...DEFAULT_DIRECTOR_PARAMS, leakGain: 0.6 },
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
