import { signal, type WritableSignal } from '@angular/core';

/**
 * Signals that go back to where they started together, with one reset():
 * state that belongs to a session (a coop room) and has to be empty again
 * when it ends, without a list of set() calls that misses one. The start
 * value is kept as given, so it has to be one that is replaced, never
 * changed in place (a new Map on every change, not map.set).
 */
export class ResettableSignals {
  private readonly resets: (() => void)[] = [];

  /** A signal that reset() sets back to `initial` */
  signal<T>(initial: T): WritableSignal<T> {
    const s = signal(initial);
    this.resets.push(() => s.set(initial));
    return s;
  }

  /** Every signal back to its start value */
  reset(): void {
    for (const reset of this.resets) reset();
  }
}
