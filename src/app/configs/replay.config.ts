/**
 * Replay of the last wave (docs/REPLAY.md): how densely it is recorded, how
 * much memory it may take, and the speeds it plays at.
 */
export const REPLAY_CONFIG = {
  /**
   * Sub-steps between two recorded frames at the start of a wave: 6 steps of
   * 16.667 ms, 10 frames per second of game time. The player interpolates in
   * between.
   */
  stepsPerFrame: 6,
  /**
   * Coarsest spacing the memory budget may thin the frames to (sub-steps):
   * 48 steps, 1.25 frames per second. A wave that still does not fit stops
   * recording there, the replay ends early.
   */
  maxStepsPerFrame: 48,
  /**
   * Bytes the frame samples of enemies, projectiles and towers may take
   * together. Reached, every second frame goes and the spacing doubles.
   */
  sampleBudgetBytes: 48 * 1024 * 1024,
  /**
   * Effect and sound events kept per wave (impacts, muzzle flashes, blood,
   * sounds, abilities). Past it the rest of the wave plays without them.
   */
  maxEvents: 150_000,
  /** Speeds of the replay bar, slowest first */
  speeds: [0.25, 0.5, 1, 2, 4] as readonly number[],
  /** Above this speed the replay plays no sounds; they would pile up */
  maxAudioSpeed: 1,
} as const;
