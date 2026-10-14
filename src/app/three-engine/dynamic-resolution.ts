/**
 * Dynamic render resolution of the Low and Medium levels (render-quality.ts):
 * once a second it looks at what the frames cost and moves the resolution
 * scale within the level's range. Costly frames take it down at once, and
 * only several cheap seconds in a row take it back up, so it does not swing.
 *
 * The cost is the GPU time of the draw where the browser has a timer query,
 * else the time between frames; a frame cap or the display's refresh makes
 * that one look cheap at most, never costly. Pure: the engine feeds it and
 * sets the pixel ratio it answers.
 */

/** The frame budget, ms: 60 frames a second */
export const FRAME_BUDGET_MS = 1000 / 60;
/**
 * Over the `down` share of the budget the scale goes down a step, under the
 * `up` share it may go up. Frame intervals hold to the display's refresh
 * even when the GPU idles half the frame, so they count as costly only
 * once frames are dropped
 */
const SHARES = { gpu: { down: 0.9, up: 0.6 }, interval: { down: 1.25, up: 0.6 } } as const;
const DOWN_STEP = 0.1;
const UP_STEP = 0.05;
/** Cheap seconds in a row before the scale goes up */
const UP_AFTER = 3;
/**
 * Fewer samples than this say nothing yet: the engine gathers on (a very
 * slow GPU draws few frames a second, and it must still go down)
 */
export const MIN_SAMPLES = 3;

export class DynamicResolution {
  private cheapRun = 0;

  constructor(
    public scale: number,
    private readonly range: { min: number; max: number },
  ) {
    this.scale = clamp(scale, range.min, range.max);
  }

  /**
   * One second of frame costs, ms: GPU times or frame intervals. Frame
   * intervals are measured against the display's own frame interval where
   * it is longer than 60 frames a second (`displayMs`, DisplayRefresh): a
   * 30 Hz display shows 33 ms between frames however cheap they are, and
   * took the scale down to its minimum. Returns the new scale when it
   * changed, null when it stays.
   */
  evaluate(costs: readonly number[], kind: 'gpu' | 'interval', displayMs: number | null = null): number | null {
    if (costs.length < MIN_SAMPLES) return null;
    const sorted = [...costs].sort((a, b) => a - b);
    const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
    let next = this.scale;
    const shares = SHARES[kind];
    const budget = kind === 'interval' ? Math.max(FRAME_BUDGET_MS, displayMs ?? 0) : FRAME_BUDGET_MS;
    if (p90 > budget * shares.down) {
      this.cheapRun = 0;
      next = this.scale - DOWN_STEP;
    } else if (p90 < budget * shares.up) {
      if (++this.cheapRun >= UP_AFTER) {
        this.cheapRun = 0;
        next = this.scale + UP_STEP;
      }
    } else {
      this.cheapRun = 0;
    }
    next = Math.round(clamp(next, this.range.min, this.range.max) * 100) / 100;
    if (next === this.scale) return null;
    this.scale = next;
    return next;
  }
}

/** Frame intervals of common displays, ms (24 to 240 Hz) */
const DISPLAY_RATES = [24, 30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240].map((hz) => 1000 / hz);
/** Idle intervals a display estimate takes */
export const REFRESH_SAMPLES = 30;

/**
 * The display's frame interval, from the frames in which the engine drew
 * nothing (menu globe over the game, a loading map, programs compiling):
 * with V-Sync they come at the display's pace. A run of REFRESH_SAMPLES
 * whose middle half lies within 15 % of its median counts, snapped to a
 * common rate; the shortest such run wins (a busy run is only ever longer).
 * Null until one came. Pure: the engine feeds it.
 */
export class DisplayRefresh {
  private samples: number[] = [];
  interval: number | null = null;

  /** The time between two frames that drew nothing, ms */
  add(intervalMs: number): void {
    // A hidden tab or a stall says nothing about the display
    if (!(intervalMs > 0) || intervalMs > 100) return;
    this.samples.push(intervalMs);
    if (this.samples.length < REFRESH_SAMPLES) return;
    const sorted = this.samples.sort((a, b) => a - b);
    this.samples = [];
    const median = sorted[sorted.length >> 1];
    const spread = sorted[Math.floor(sorted.length * 0.75)] - sorted[Math.floor(sorted.length * 0.25)];
    if (spread > median * 0.15) return;
    const near = DISPLAY_RATES.reduce((best, ms) => (Math.abs(ms - median) < Math.abs(best - median) ? ms : best));
    const interval = Math.abs(near - median) <= near * 0.05 ? near : median;
    this.interval = this.interval === null ? interval : Math.min(this.interval, interval);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
