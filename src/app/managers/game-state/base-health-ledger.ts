import { signal } from '@angular/core';
import { GameEventBus } from '../../game-engine';
import { GAME_BALANCE } from '../../configs/game-balance.config';

/**
 * The HQ's health. Damage and debug changes are announced as `health:changed`
 * (HQDamageService, ScreenShakeService and the store listen); a heal or a
 * reset sets the value silently.
 *
 * Owned by the GameStateManager, which exposes the signal as `baseHealth`.
 */
export class BaseHealthLedger {
  readonly baseHealth = signal<number>(GAME_BALANCE.player.startHealth);

  constructor(private readonly eventBus: GameEventBus) {}

  /**
   * A leak reached the base, and it costs what it costs.
   *
   * A wave used to cost at most 18 HP however many enemies walked in, so five
   * hundred of them did the same damage as two. The wave the player loses is
   * the one that decides the run, and it has to be allowed to decide it
   * (decision of 2026-09-20; the wave director's survivability cap is what
   * keeps a wave winnable, not a ceiling on the consequences).
   */
  applyLeak(damage: number): void {
    if (damage <= 0) return;
    this.change(Math.max(0, this.baseHealth() - damage));
  }

  /** Debug: add (or take) HP, bounded below by 0 only. */
  adjust(amount: number): void {
    this.change(Math.max(0, this.baseHealth() + amount));
  }

  /** Full health again, without health:changed. */
  /** Set the HP a snapshot saved, without health:changed; the HQ fire follows sim:restored. */
  restore(health: number): void {
    this.baseHealth.set(health);
  }

  resetToStart(): void {
    this.baseHealth.set(GAME_BALANCE.player.startHealth);
  }

  private change(newHealth: number): void {
    const oldHealth = this.baseHealth();
    // A base at zero is hit by everything still walking in; announcing each of
    // those as a change of nothing only shakes the screen for free.
    if (newHealth === oldHealth) return;
    this.baseHealth.set(newHealth);
    this.eventBus.emit({
      type: 'health:changed',
      health: newHealth,
      delta: newHealth - oldHealth,
    });
  }
}
