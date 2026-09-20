import { signal } from '@angular/core';
import { GameEventBus } from '../../game-engine';
import type { CreditsSource } from '../../game-engine/game-event-bus';
import { GAME_BALANCE } from '../../configs/game-balance.config';

/**
 * The player's credits. Every change goes through here and is announced as
 * `credits:changed` with the new total and the delta.
 *
 * Owned by the GameStateManager, which exposes the signal as `credits`.
 */
export class CreditsLedger {
  readonly credits = signal<number>(GAME_BALANCE.player.startCredits);

  constructor(private readonly eventBus: GameEventBus) {}

  /**
   * Books a delta (negative to charge). `source` says where it came from; the
   * run log splits income and spending by it, which the sign alone cannot do
   * (a refund and a kill are both positive).
   */
  add(delta: number, source: CreditsSource): void {
    const newCredits = this.credits() + delta;
    this.credits.set(newCredits);
    this.eventBus.emit({
      type: 'credits:changed',
      credits: newCredits,
      delta,
      source,
    });
  }

  /**
   * Charges the amount if the credits reach.
   * @returns true if credits were spent, false if not enough
   */
  spend(amount: number, source: CreditsSource): boolean {
    if (this.credits() < amount) return false;
    this.add(-amount, source);
    return true;
  }

  /** Back to the start credits, booked as one delta. */
  reset(): void {
    this.add(GAME_BALANCE.player.startCredits - this.credits(), 'reset');
  }
}
