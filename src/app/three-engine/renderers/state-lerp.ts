import type { IUniform } from 'three';

/** A state further than this from where its body is shown is a jump (teleport, restore, a replay's seek): no slide, m */
export const STATE_LERP_JUMP_M = 10;

/** The interval between two states the slide assumes, ms: clamped to this span */
const MIN_INTERVAL_MS = 8;
const MAX_INTERVAL_MS = 120;
/** Share of the newest interval in the smoothed one */
const INTERVAL_BLEND = 0.2;

/**
 * `?interp=off` leaves the slide out: every body stands where its state put
 * it. A switch for measuring and for looking at the difference (TODO E86).
 */
export function stateLerpParam(search: string): boolean {
  return new URLSearchParams(search).get('interp') !== 'off';
}

/**
 * The slide between two states of the simulation (TODO E86). States come at
 * about 30 per second while frames are drawn faster: a body written with a
 * new state keeps the offset back to where it was shown (`aPrevOffset`), and
 * the shader adds `offset * (1 - uStateLerp)`. The lerp runs from 0 at a
 * state to 1 one state interval later, so the picture shows the stretch
 * between the state before and the newest, one interval late.
 *
 * One clock for everything that slides (enemy instances, their health bars):
 * `uniform` is the same object in every material.
 */
export class StateLerp {
  /** uStateLerp; 1 shows every body where its state put it */
  readonly uniform: IUniform<number> = { value: 1 };
  private appliedAt: number | null = null;
  private intervalMs = 33;

  constructor(readonly enabled = true) {}

  /** The smoothed time between two states, ms */
  get interval(): number {
    return this.intervalMs;
  }

  /**
   * A state is written now. Returns the share of each body's old offset it
   * is still shown at (1 - lerp at this moment): the new offset starts from
   * there, so a state that comes early or late makes no jump.
   */
  begin(now: number): number {
    if (!this.enabled) return 0;
    const carry = 1 - this.at(now);
    if (this.appliedAt !== null) {
      const gap = Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, now - this.appliedAt));
      this.intervalMs += (gap - this.intervalMs) * INTERVAL_BLEND;
    }
    this.appliedAt = now;
    this.uniform.value = 0;
    return carry;
  }

  /** Per frame, before the draw */
  update(now: number): void {
    this.uniform.value = this.at(now);
  }

  /** Everything stands where its state put it (a clear, a new run) */
  reset(): void {
    this.appliedAt = null;
    this.uniform.value = 1;
  }

  private at(now: number): number {
    if (!this.enabled || this.appliedAt === null) return 1;
    return Math.min(1, Math.max(0, (now - this.appliedAt) / this.intervalMs));
  }
}
