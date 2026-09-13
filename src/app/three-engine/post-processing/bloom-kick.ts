/** What a bloom kick changes on the bloom pass (UnrealBloomPass). */
export interface BloomValues {
  strength: number;
  threshold: number;
}

/**
 * A short brightening of the bloom, for the nuclear strike's flash. Blends
 * the pass's strength and threshold from the values it had when the kick
 * was made towards a peak, and puts those values back exactly once the
 * kick is over.
 */
export class BloomKick {
  private readonly base: BloomValues;
  private kicked = false;

  constructor(private readonly pass: BloomValues) {
    this.base = { strength: pass.strength, threshold: pass.threshold };
  }

  /** `amount` 0..1 of the way from the pass's own values to `peak`; 0 puts them back. */
  set(amount: number, peak: BloomValues): void {
    if (amount <= 0) {
      this.reset();
      return;
    }
    const k = Math.min(1, amount);
    this.pass.strength = this.base.strength + (peak.strength - this.base.strength) * k;
    this.pass.threshold = this.base.threshold + (peak.threshold - this.base.threshold) * k;
    this.kicked = true;
  }

  /** The pass's own values again. */
  reset(): void {
    if (!this.kicked) return;
    this.pass.strength = this.base.strength;
    this.pass.threshold = this.base.threshold;
    this.kicked = false;
  }
}
