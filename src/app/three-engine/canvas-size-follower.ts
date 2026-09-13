/**
 * Keeps the drawing buffer at the canvas' CSS size: a resized window, header
 * and sidebar leaving for photo mode or coming back, a docked devtools panel.
 *
 * A ResizeObserver reports each change of the canvas' box. `fit` runs at once
 * for the first report, then at most once per THROTTLE_MS, and once more after
 * a burst so the last size is always applied: every fit reallocates the
 * post-processing targets, which a window drag would otherwise do each frame.
 * Where there is no ResizeObserver (unit tests) nothing is observed.
 */
export class CanvasSizeFollower {
  static readonly THROTTLE_MS = 100;

  private readonly observer: ResizeObserver | null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** A change came in while the throttle was closed */
  private pending = false;

  constructor(canvas: HTMLElement, private readonly fit: () => void) {
    this.observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.onResize());
    this.observer?.observe(canvas);
  }

  private onResize(): void {
    if (this.timer !== null) {
      this.pending = true;
      return;
    }
    this.fit();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.pending) return;
      this.pending = false;
      this.onResize();
    }, CanvasSizeFollower.THROTTLE_MS);
  }

  dispose(): void {
    this.observer?.disconnect();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending = false;
  }
}
