import { Injectable, signal } from '@angular/core';

/** How long a first Sell waits for the confirming second one (ms). */
export const SELL_CONFIRM_WINDOW_MS = 2500;

/**
 * Two-step sell without a modal: the first request arms the tower, a second
 * one for the same tower within SELL_CONFIRM_WINDOW_MS confirms it. Shared by
 * the tower panel and the research panel, so every way to sell goes through
 * the same confirmation.
 *
 * Wall clock on purpose: it times a UI gesture, not the simulation, and has to
 * run out while the game is paused as well.
 */
@Injectable({ providedIn: 'root' })
export class SellConfirmService {
  /** Tower waiting for the confirming second request, null when none. */
  readonly armedTowerId = signal<string | null>(null);

  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * First call for a tower arms it and returns false; a second call for the
   * same tower inside the window returns true, and the caller sells. A request
   * for another tower moves the confirmation over to that one.
   */
  request(towerId: string): boolean {
    if (this.armedTowerId() === towerId) {
      this.disarm();
      return true;
    }
    this.clearTimer();
    this.armedTowerId.set(towerId);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.armedTowerId.set(null);
    }, SELL_CONFIRM_WINDOW_MS);
    return false;
  }

  /** Drop a pending confirmation. */
  disarm(): void {
    this.clearTimer();
    this.armedTowerId.set(null);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
