/**
 * Lets a UI pulse start at most once per interval. Feedback that reacts to
 * game events (a leak, HQ damage) would otherwise restart its animation for
 * every event of a burst, and a swarm of 20k leaking in one wave would read
 * as a steady glow instead of a pulse.
 *
 * Wall-clock, not game time: it limits what the player sees.
 */
export class PulseThrottle {
  private last = Number.NEGATIVE_INFINITY;

  constructor(private readonly minIntervalMs: number) {}

  /** True when a pulse may start at `nowMs`, which then counts as the last one. */
  tryPulse(nowMs: number): boolean {
    if (nowMs - this.last < this.minIntervalMs) return false;
    this.last = nowMs;
    return true;
  }
}
