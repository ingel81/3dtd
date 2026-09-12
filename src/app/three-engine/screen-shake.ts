import type { Matrix4 } from 'three';

/**
 * Screen-shake envelope. The strongest running shake wins: a weaker one
 * that comes in while a stronger one still runs is dropped. The amplitude
 * falls linearly to 0 over the duration, in wall-clock ms, so a shake lasts
 * as long at 30 FPS as at 144 (the old per-frame decay assumed 60).
 */
export class ScreenShake {
  private amplitude = 0;
  private start = 0;
  private duration = 1;

  /**
   * @param amplitude - Peak offset as a share of the view height
   * @param durationMs - Time until the offset is back to 0
   * @param now - Wall clock, ms
   */
  trigger(amplitude: number, durationMs: number, now: number): void {
    if (amplitude <= this.amplitudeAt(now)) return;
    this.amplitude = amplitude;
    this.start = now;
    this.duration = Math.max(durationMs, 1);
  }

  /** Current amplitude, 0 when no shake runs. */
  amplitudeAt(now: number): number {
    if (this.amplitude <= 0) return 0;
    const t = (now - this.start) / this.duration;
    if (t >= 1) {
      this.amplitude = 0;
      return 0;
    }
    return this.amplitude * (1 - Math.max(0, t));
  }

  reset(): void {
    this.amplitude = 0;
  }
}

/**
 * Shift everything a projection matrix draws by (ndcX, ndcY) in normalised
 * device coordinates: in clip space x' = x + ndcX * w and y' = y + ndcY * w,
 * which adds ndc times row 3 to rows 0 and 1. A pure screen-space offset;
 * the view matrix, and with it the camera position, stays untouched.
 */
export function offsetProjection(m: Matrix4, ndcX: number, ndcY: number): void {
  const e = m.elements; // column-major: row r, column c at e[c * 4 + r]
  for (let c = 0; c < 4; c++) {
    const w = e[c * 4 + 3];
    e[c * 4] += ndcX * w;
    e[c * 4 + 1] += ndcY * w;
  }
}
