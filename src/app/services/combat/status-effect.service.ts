import { Injectable } from '@angular/core';
import { Enemy } from '../../entities/enemy.entity';
import { StatusEffectType } from '../../models/status-effects';
import { LIGHTER_ARMOR } from '../../configs/combat/damage-matrix.config';

/**
 * StatusEffectService: applies slow / poison / burn / freeze / stun effects to enemies.
 *
 * `effect.startTime` is stored in **game-time ms** via an injected clock
 * provider (set once by GameStateManager on initialization). Using a provider
 * avoids a circular DI cycle (CombatEffectService → StatusEffectService →
 * GameStateManager → CombatEffectService) while still reading the engine's
 * authoritative game-clock every time an effect is applied.
 */
@Injectable({ providedIn: 'root' })
export class StatusEffectService {
  private gameClockProvider: () => number = () => 0;

  /** Wire the engine game-clock (called once during GameStateManager.initialize). */
  setGameClockProvider(provider: () => number): void {
    this.gameClockProvider = provider;
  }

  /** Nothing on a type with Phasing (immuneToSlow), unless a seal lifts it (applySeal) */
  applySlow(enemy: Enemy, slowAmount: number, duration: number, sourceId: string): void {
    if (enemy.typeConfig.immuneToSlow && !this.hasActiveEffect(enemy, 'seal')) return;
    enemy.movement.applyStatusEffect({
      type: 'slow',
      value: slowAmount,
      duration,
      startTime: this.gameClockProvider(),
      sourceId,
    });
  }

  /**
   * Seal: Phasing (immuneToSlow) lifted for `duration` game ms, a slow takes hold meanwhile and runs its own
   * course. One seal at a time, a new one refreshes it. Only for a type with Phasing; on any other it would
   * change nothing.
   */
  applySeal(enemy: Enemy, duration: number, sourceId: string): void {
    if (!enemy.typeConfig.immuneToSlow) return;
    enemy.movement.applyStatusEffect({
      type: 'seal',
      value: 1,
      duration,
      startTime: this.gameClockProvider(),
      sourceId,
    });
  }

  /**
   * Corrode: for `duration` game ms hits count against the better of its armor and the next lighter one
   * (matrixMultiplier). One at a time, a new one refreshes it; no stacking past one class. Nothing on a
   * boss or on an armor with no lighter class (unarmored, ethereal).
   */
  applyCorrode(enemy: Enemy, duration: number, sourceId: string): void {
    if (enemy.typeConfig.isBoss) return;
    const armor = enemy.getEffectiveArmorType();
    if (LIGHTER_ARMOR[armor] === armor) return;
    enemy.movement.applyStatusEffect({
      type: 'corrode',
      value: 1,
      duration,
      startTime: this.gameClockProvider(),
      sourceId,
    });
  }

  /** Whether the enemy is corroded now (MovementComponent.isCorroded) */
  isCorroded(enemy: Enemy): boolean {
    return enemy.movement.isCorroded(this.gameClockProvider());
  }

  applyPoison(enemy: Enemy, dotDps: number, duration: number, sourceId: string): void {
    enemy.movement.applyStatusEffect({
      type: 'poison',
      value: dotDps,
      duration,
      startTime: this.gameClockProvider(),
      sourceId,
    });
  }

  /**
   * Freeze: the enemy halts for `duration` game ms (MovementComponent.isHalted).
   * Kept per source like burn: the same source refreshes its entry.
   */
  applyFreeze(enemy: Enemy, duration: number, sourceId: string): void {
    enemy.movement.applyStatusEffect({
      type: 'freeze',
      value: 1,
      duration,
      startTime: this.gameClockProvider(),
      sourceId,
    });
  }

  /**
   * Stun: the electric halt, the same stop as a freeze with a look of its
   * own. Kept per source as well.
   */
  applyStun(enemy: Enemy, duration: number, sourceId: string): void {
    enemy.movement.applyStatusEffect({
      type: 'stun',
      value: 1,
      duration,
      startTime: this.gameClockProvider(),
      sourceId,
    });
  }

  /**
   * Burn from a fire beam. The beam re-applies it every sub-step while the
   * enemy is in the cone, so this refreshes in place instead of allocating.
   * Kept per source (see MovementComponent.applyStatusEffect): two fire towers
   * burn side by side, like their beams add up.
   */
  applyBurn(enemy: Enemy, dotDps: number, duration: number, sourceId: string): void {
    enemy.movement.refreshStatusEffect('burn', dotDps, duration, this.gameClockProvider(), sourceId);
  }

  applyEffect(
    enemy: Enemy,
    type: StatusEffectType,
    value: number,
    duration: number,
    sourceId: string,
  ): void {
    enemy.movement.applyStatusEffect({
      type,
      value,
      duration,
      startTime: this.gameClockProvider(),
      sourceId,
    });
  }

  /** Remove expired effects (compares against current game-clock). */
  removeExpired(enemy: Enemy): void {
    enemy.movement.removeExpiredEffects(this.gameClockProvider());
  }

  /** Whether enemy currently has an active effect of the given type. */
  hasActiveEffect(enemy: Enemy, type: StatusEffectType): boolean {
    const now = this.gameClockProvider();
    return enemy.movement.statusEffects.some(
      (e) => e.type === type && now - e.startTime < e.duration,
    );
  }
}
