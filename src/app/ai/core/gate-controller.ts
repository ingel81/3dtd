/**
 * Fairness-gate controller — closed loop on how much a wave lets through.
 *
 * `fairMaxCount` estimates how many enemies a defense can destroy, discounted
 * by FAIRNESS_KILL_REALISM. That discount was measured on waves 1-10 and is
 * wrong from wave 11 on, so the cap has a standing bias and no way to notice
 * it. This corrects it from the only evidence that matters: what actually
 * reached the base.
 *
 * WHY THIS EXISTS, measured over a full day of training runs:
 *
 * Without any correction the cap lands on "exactly what the towers can kill",
 * which guarantees the towers kill it — 70% of waves killed everything, 80%
 * dealt no damage, and near-miss ratio sat at 0.03 against a design target of
 * 0.20. Four wave designers as different as a trained policy network and a
 * uniform random sampler produced statistically indistinguishable runs, because
 * the cap rather than the designer was choosing the wave size.
 *
 * TWO FAILURES THIS SHAPE AVOIDS, both of which shipped in the Python original:
 *
 * 1. Steering on kill-share ("the defense killed everything, allow more") reads
 *    the loop's own caution as headroom: a small wave is cleared BECAUSE it is
 *    small. That is one-way pressure, and it pinned the multiplier to whatever
 *    ceiling it was given — at 40 it produced caps of 4761 enemies and turned
 *    the gate off entirely. Steering on leak ratio is two-sided and settles.
 *
 * 2. A fixed step size cannot cover the distance. The multiplier has to reach
 *    ~1.6 just to undo the stale realism discount, and further before anything
 *    leaks. At 5% per window that is ~170 waves against runs of ~60 that start
 *    from 1.0 — it never arrived (measured median 1.28). Proportional control
 *    crosses it in a handful of windows and still settles, because the
 *    correction shrinks to nothing inside the target band.
 *
 * State is per-run: {@link reset} on a new game. Leaving it to accumulate
 * across runs made the multiplier a ratchet that climbed on every cleared wave
 * and fell only on a death; median run length was 6 waves against a target of
 * 80, and fresh runs opened against waves sized for a defense that had been
 * dismantled several games earlier.
 */

/** Waves of leak history before the loop steers at all. */
export const GATE_ADAPT_WINDOW = 4;

/**
 * Target band for the share of a wave that reaches the base.
 *
 * Below the floor the waves are not testing the defense; above the ceiling the
 * run is being ended. The gate is meant to prevent the second, not to enforce
 * the first — a cap that binds on most waves is not a safety limit, it is the
 * difficulty curve wearing a disguise.
 */
export const GATE_LEAK_TARGET_LO = 0.08;
export const GATE_LEAK_TARGET_HI = 0.16;

/** Proportional gain on the relative leak error, applied once per wave. */
export const GATE_GAIN = 0.35;

/** Multiplicative back-off when a run ends. Deliberately harsher than the gain. */
export const GATE_MULT_DOWN = 0.8;

export const GATE_MULT_MIN = 0.5;
export const GATE_MULT_MAX = 8;

export class GateController {
  private leakShares: number[] = [];
  private multiplier = 1;

  /** Current correction factor for `fairMaxCount`'s kill estimate. */
  get budgetMultiplier(): number {
    return this.multiplier;
  }

  /** Clear per-run state. Must be called when a new game starts. */
  reset(): void {
    this.leakShares = [];
    this.multiplier = 1;
  }

  /**
   * Fold one completed wave into the loop.
   *
   * @param leakRatio fraction of the wave that reached the base, 0..1, or null
   *                  when the wave produced no per-enemy data at all. Null is
   *                  NOT the same as zero: recording a phantom "nothing leaked"
   *                  sample pushes the loop to open the budget on evidence that
   *                  does not exist. The Python original guards this with
   *                  `enemiesSpawned > 0` and still steers on the samples it
   *                  already has, which is what this mirrors.
   * @param survived  false if this wave ended the run
   */
  recordWave(leakRatio: number | null, survived: boolean): number {
    if (leakRatio !== null && Number.isFinite(leakRatio)) {
      this.leakShares.push(Math.max(0, Math.min(1, leakRatio)));
      if (this.leakShares.length > GATE_ADAPT_WINDOW) this.leakShares.shift();
    }

    if (this.leakShares.length < GATE_ADAPT_WINDOW) return this.multiplier;

    const leaked = this.leakShares.reduce((a, b) => a + b, 0) / this.leakShares.length;

    if (!survived) {
      // The one outcome the gate exists to prevent. Back off hard rather than
      // proportionally — the cost of an over-large wave is asymmetric.
      this.multiplier = Math.max(GATE_MULT_MIN, this.multiplier * GATE_MULT_DOWN);
    } else if (leaked < GATE_LEAK_TARGET_LO || leaked > GATE_LEAK_TARGET_HI) {
      const target = (GATE_LEAK_TARGET_LO + GATE_LEAK_TARGET_HI) / 2;
      const error = (target - leaked) / target;          // +1 = nothing leaks at all
      const step = 1 + GATE_GAIN * Math.max(-1, Math.min(1, error));
      this.multiplier = Math.max(GATE_MULT_MIN, Math.min(GATE_MULT_MAX, this.multiplier * step));
    }
    // Inside the band — a little gets through and the player lives — is the
    // target state. Hold.

    return this.multiplier;
  }
}
