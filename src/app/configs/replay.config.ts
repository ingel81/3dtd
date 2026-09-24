/**
 * Replay of a wave (docs/REPLAY.md): a re-simulation of the wave from its
 * wave-start snapshot and the command log (docs/SIMULATOR_PLAN.md, P6).
 */
export const REPLAY_CONFIG = {
  /** Speeds of the replay bar, slowest first */
  speeds: [0.25, 0.5, 1, 2, 4] as readonly number[],
  /**
   * The player gets a way in: the replay link in the WAVE panel and the
   * button on the game-over screen (ReplayService.offered). Hidden from
   * 2026-09-16 until the replay was tested; on again with the replay as a
   * re-simulation on the simulator branch, for its playtest.
   */
  offered: true as boolean,
} as const;
