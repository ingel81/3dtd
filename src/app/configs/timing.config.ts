/**
 * Central timing configuration - eliminates magic numbers for all timing-related values.
 *
 * All values are in milliseconds unless otherwise noted.
 */
/**
 * Sub-steps the simulation runs per second of game time (TODO E86). The one
 * place the rate stands: the sub-step's length (GameClock.FIXED_STEP_MS),
 * the coop tick (TICK_SUB_STEPS, coop/lockstep.ts, which the relay takes
 * too) and every count of sub-steps (GameClock.stepsIn) derive from it.
 *
 * Changing it changes what a recorded sub-step means: REPLAY_FILE_VERSION,
 * SIM_SNAPSHOT_VERSION, WAVE_SNAPSHOT_VERSION (simulator/) and
 * PROTOCOL_VERSION (coop/protocol.ts) go up with it, and the relay has to
 * run the same build. 60 until 2026-09-30.
 */
export const SIM_STEPS_PER_SECOND = 30;

export const TIMING = {
  /** Death animation duration before enemy removal (ms) */
  deathAnimationDuration: 2000,

  /** Line-of-sight recheck interval for tower targeting (ms) */
  losRecheckInterval: 300,

  /** Duration of floating reward text popup (ms) */
  rewardPopupDuration: 1200,

  /** Duration of floating damage number popup (ms) — shorter than reward to avoid clutter */
  damagePopupDuration: 800,
} as const;
