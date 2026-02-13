/**
 * Central timing configuration - eliminates magic numbers for all timing-related values.
 *
 * All values are in milliseconds unless otherwise noted.
 */
export const TIMING = {
  /** Death animation duration before enemy removal (ms) */
  deathAnimationDuration: 2000,

  /** Default delay between starting each paused enemy (ms, game-time) */
  defaultSpawnStartDelay: 300,

  /** Line-of-sight recheck interval for tower targeting (ms) */
  losRecheckInterval: 300,

  /** Delay before showing game-over screen after base destroyed (ms) */
  gameOverScreenDelay: 3000,

  /** Duration of floating reward text popup (ms) */
  rewardPopupDuration: 1200,

  /** Duration of floating damage number popup (ms) — shorter than reward to avoid clutter */
  damagePopupDuration: 800,
} as const;
