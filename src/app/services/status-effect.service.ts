import { Injectable } from '@angular/core';
import { Enemy } from '../entities/enemy.entity';
import { StatusEffect, StatusEffectType } from '../models/status-effects';

/**
 * StatusEffectService - Manages status effects on enemies
 *
 * Extracted from CombatEffectService for Single Responsibility.
 * Handles: Slow, Burn, Freeze effects
 */
@Injectable({ providedIn: 'root' })
export class StatusEffectService {
  /**
   * Apply a slow effect to an enemy.
   * The enemy's movement component handles stacking/refresh logic.
   */
  applySlow(
    enemy: Enemy,
    slowAmount: number,
    duration: number,
    sourceId: string
  ): void {
    const effect: StatusEffect = {
      type: 'slow',
      value: slowAmount,
      duration,
      startTime: performance.now(),
      sourceId,
    };
    enemy.movement.applyStatusEffect(effect);
  }

  /**
   * Apply a poison DOT effect to an enemy.
   * Only one poison can be active at a time (refreshes timer like slow).
   */
  applyPoison(
    enemy: Enemy,
    dotDps: number,
    duration: number,
    sourceId: string
  ): void {
    const effect: StatusEffect = {
      type: 'poison',
      value: dotDps,
      duration,
      startTime: performance.now(),
      sourceId,
    };
    enemy.movement.applyStatusEffect(effect);
  }

  /**
   * Apply a generic status effect to an enemy.
   * Extensible for future effect types (burn, freeze, poison).
   */
  applyEffect(
    enemy: Enemy,
    type: StatusEffectType,
    value: number,
    duration: number,
    sourceId: string
  ): void {
    const effect: StatusEffect = {
      type,
      value,
      duration,
      startTime: performance.now(),
      sourceId,
    };
    enemy.movement.applyStatusEffect(effect);
  }

  /**
   * Remove expired status effects from an enemy.
   * Delegates to the movement component's cleanup logic.
   */
  removeExpired(enemy: Enemy, currentTime: number): void {
    enemy.movement.statusEffects = enemy.movement.statusEffects.filter(
      (effect) => currentTime - effect.startTime < effect.duration
    );
  }

  /**
   * Check if an enemy currently has an active effect of the given type
   */
  hasActiveEffect(enemy: Enemy, type: StatusEffectType): boolean {
    const now = performance.now();
    return enemy.movement.statusEffects.some(
      (effect) => effect.type === type && now - effect.startTime < effect.duration
    );
  }
}
