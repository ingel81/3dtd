/**
 * Fade between the normal look (0) and the blood moon (1). The progress runs
 * linearly towards the target, at its own speed each way; `amount` is that
 * progress eased, so the look starts and settles softly. A fade that turns
 * round halfway goes back from where it is, without a jump.
 */
export class BloodMoonFade {
  private progress = 0;
  private target = 0;

  constructor(
    private readonly inMs: number,
    private readonly outMs: number,
  ) {}

  /** Fade towards the blood moon (true) or back to the normal look (false). */
  setTarget(on: boolean): void {
    this.target = on ? 1 : 0;
  }

  /** Straight to the blood moon or the normal look, no fade. */
  snap(on: boolean): void {
    this.target = on ? 1 : 0;
    this.progress = this.target;
  }

  /** Run the fade for `dtMs`; a step of 0 (or less) changes nothing. */
  step(dtMs: number): void {
    if (!(dtMs > 0)) return;
    if (this.progress < this.target) {
      this.progress = Math.min(this.target, this.progress + dtMs / this.inMs);
    } else if (this.progress > this.target) {
      this.progress = Math.max(this.target, this.progress - dtMs / this.outMs);
    }
  }

  /** 0 = normal look, 1 = full blood moon, smoothstep over the progress */
  get amount(): number {
    const t = this.progress;
    return t * t * (3 - 2 * t);
  }
}
