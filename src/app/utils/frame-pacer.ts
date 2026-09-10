/**
 * Frame pacing for a requestAnimationFrame loop capped below the display
 * refresh rate.
 *
 * rAF fires at the display rate; the pacer decides which callbacks do the
 * work. It keeps a phase anchor that advances by exactly one interval per
 * frame that runs, instead of snapping to that frame's timestamp. Snapping
 * collapses a cap to a divisor of the refresh rate (50 fps on a 60 Hz display
 * would run every other frame, i.e. 30); the anchor runs five frames of six.
 *
 * A frame runs once it is at least half an interval past the anchor. rAF
 * timestamps jitter around the vsync, and a strict `elapsed >= interval`
 * turns a 60 fps cap on a 60 Hz display into random dropped frames whenever
 * the phase lines up with the frames.
 *
 * A frame more than half an interval late re-seeds the phase: the first one,
 * one after a stall, and on a display slower than the cap (a "60 Hz" panel at
 * 59.94) the one where the anchor has fallen that far behind. Every frame
 * still runs there, and the anchor never slips a whole interval onto the
 * threshold.
 */
export class FramePacer {
  private intervalMs = 0;
  /** Ideal time of the last frame that ran. -Infinity makes the next frame re-seed. */
  private anchorMs = -Infinity;

  /** @param fps Cap in frames per second, 0 = every frame runs. */
  constructor(fps = 0) {
    this.setLimit(fps);
  }

  /** Cap in frames per second, 0 = every frame runs. */
  setLimit(fps: number): void {
    this.intervalMs = fps > 0 ? 1000 / fps : 0;
    this.reset();
  }

  /** Forget the phase; the next frame runs and seeds a fresh one. */
  reset(): void {
    this.anchorMs = -Infinity;
  }

  /** Whether the frame at `nowMs` should run. Call once per rAF callback. */
  shouldRun(nowMs: number): boolean {
    const interval = this.intervalMs;
    if (interval === 0) return true;

    const elapsed = nowMs - this.anchorMs;
    if (elapsed < interval / 2) return false;

    if (elapsed <= interval * 1.5) {
      this.anchorMs += interval;
    } else {
      // Seed the phase 3/8 of an interval ahead of this frame. rAF timestamps
      // sit on the vsync grid, and at refresh rates one to four times the cap
      // (60 Hz with 60 or 30, 120 Hz with 60 or 30, 90 Hz with 30) every later
      // frame then lands at least an eighth of an interval clear of the
      // threshold. Any other offset puts some of those grids right on it,
      // where jitter alternates short and long gaps.
      this.anchorMs = nowMs + (interval * 3) / 8;
    }
    return true;
  }
}
