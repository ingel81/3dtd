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
   * One second of frame costs, ms: GPU times or frame intervals. Returns
   * the new scale when it changed, null when it stays.
   */
  evaluate(costs: readonly number[], kind: 'gpu' | 'interval'): number | null {
    if (costs.length < MIN_SAMPLES) return null;
    const sorted = [...costs].sort((a, b) => a - b);
    const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
    let next = this.scale;
    const shares = SHARES[kind];
    if (p90 > FRAME_BUDGET_MS * shares.down) {
      this.cheapRun = 0;
      next = this.scale - DOWN_STEP;
    } else if (p90 < FRAME_BUDGET_MS * shares.up) {
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
