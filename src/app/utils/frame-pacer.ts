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
 * The anchor never lags the frame that just ran by more than half an
 * interval. On a display slower than the cap (a "60 Hz" panel at 59.94) it
 * follows the display, so every frame runs. Without that bound the anchor
 * would eventually slip a whole interval behind and land on the threshold.
 */
export class FramePacer {
  private intervalMs = 0;
  /** Ideal time of the last frame that ran. NaN until the first frame after a reset. */
  private anchorMs = Number.NaN;

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
    this.anchorMs = Number.NaN;
  }

  /** Whether the frame at `nowMs` should run. Call once per rAF callback. */
  shouldRun(nowMs: number): boolean {
    const interval = this.intervalMs;
    if (interval === 0) return true;

    if (Number.isNaN(this.anchorMs)) {
      // Seed the phase a quarter interval ahead of this frame. At refresh
      // rates that are an exact multiple of the cap (60 Hz with 60 or 30,
      // 120 Hz with 60) every later frame then sits a quarter interval away
      // from the threshold, the most room rAF jitter can get.
      this.anchorMs = nowMs + interval / 4;
      return true;
    }

    if (nowMs - this.anchorMs < interval / 2) return false;
    this.anchorMs = Math.max(this.anchorMs + interval, nowMs - interval / 2);
    return true;
  }
}
