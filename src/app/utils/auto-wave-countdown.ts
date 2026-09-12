/** Game time between a completed wave and the auto-started next one (ms). */
export const AUTO_WAVE_DELAY_MS = 10_000;

/**
 * Countdown to the auto-started next wave, on the game clock
 * (GameStateManager.gameTimeMs). Game time because the break then follows
 * the chosen speed like everything else between waves (research), and a
 * pause stops it without a special case: no sub-step runs, the clock stands.
 */
export class AutoWaveCountdown {
  private deadlineMs: number | null = null;

  constructor(private readonly delayMs = AUTO_WAVE_DELAY_MS) {}

  get armed(): boolean {
    return this.deadlineMs !== null;
  }

  /** Start counting from `nowMs`; arming again restarts it. */
  arm(nowMs: number): void {
    this.deadlineMs = nowMs + this.delayMs;
  }

  cancel(): void {
    this.deadlineMs = null;
  }

  /** Whole seconds left, rounded up for the display; null when not armed. */
  secondsLeft(nowMs: number): number | null {
    if (this.deadlineMs === null) return null;
    return Math.max(0, Math.ceil((this.deadlineMs - nowMs) / 1000));
  }

  /** True once, when the deadline has passed; the countdown is then over. */
  tick(nowMs: number): boolean {
    if (this.deadlineMs === null || nowMs < this.deadlineMs) return false;
    this.deadlineMs = null;
    return true;
  }
}
