import { signal } from '@angular/core';
import { GameEventBus } from '../../game-engine';
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

  /** Books a delta (negative to charge). */
  add(delta: number): void {
    const newCredits = this.credits() + delta;
    this.credits.set(newCredits);
    this.eventBus.emit({
      type: 'credits:changed',
      credits: newCredits,
      delta,
    });
  }

  /**
   * Charges the amount if the credits reach.
   * @returns true if credits were spent, false if not enough
   */
  spend(amount: number): boolean {
    if (this.credits() < amount) return false;
    this.add(-amount);
    return true;
  }

  /** Back to the start credits, booked as one delta. */
  reset(): void {
    this.add(GAME_BALANCE.player.startCredits - this.credits());
  }
}
