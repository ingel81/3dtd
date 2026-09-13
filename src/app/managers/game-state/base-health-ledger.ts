import { signal } from '@angular/core';
import { GameEventBus } from '../../game-engine';
import { GAME_BALANCE } from '../../configs/game-balance.config';

/**
 * The HQ's health and the per-wave leak budget. Damage and debug changes are
 * announced as `health:changed` (HQDamageService, ScreenShakeService and the
 * store listen); a heal or a reset sets the value silently.
 *
 * Owned by the GameStateManager, which exposes the signal as `baseHealth`.
 */
export class BaseHealthLedger {
  readonly baseHealth = signal<number>(GAME_BALANCE.player.startHealth);
  /** HP already lost to leaks in the current wave; capped per wave. */
  private waveLeakDamage = 0;

  constructor(private readonly eventBus: GameEventBus) {}

  /**
   * A leak reached the base. Cap the damage a single wave can do. See
   * `maxLeakDamagePerWave`: late-game leaks cost 10 HP each and nothing
   * heals, so one wave with a missing counter could otherwise erase half a
   * run in ninety seconds.
   */
  applyLeak(damage: number): void {
    const budgetLeft = Math.max(
      0,
      GAME_BALANCE.combat.maxLeakDamagePerWave - this.waveLeakDamage,
    );
    const applied = Math.min(damage, budgetLeft);
    this.waveLeakDamage += applied;
    if (applied <= 0) return;

    this.change(Math.max(0, this.baseHealth() - applied));
  }

  /** Debug: add (or take) HP, bounded below by 0 only, outside the leak budget. */
  adjust(amount: number): void {
    this.change(Math.max(0, this.baseHealth() + amount));
  }

  /** Fresh leak budget for the new wave (see maxLeakDamagePerWave). */
  refillLeakBudget(): void {
    this.waveLeakDamage = 0;
  }

  /** Full health and a fresh leak budget, without health:changed. */
  resetToStart(): void {
    this.baseHealth.set(GAME_BALANCE.player.startHealth);
    this.waveLeakDamage = 0;
  }

  private change(newHealth: number): void {
    const oldHealth = this.baseHealth();
    this.baseHealth.set(newHealth);
    this.eventBus.emit({
      type: 'health:changed',
      health: newHealth,
      delta: newHealth - oldHealth,
    });
  }
}
