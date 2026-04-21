import { Component } from '../core/component';
import { GameObject } from '../core/game-object';

export interface CombatConfig {
  damage: number;
  range: number;
  fireRate: number; // Shots per second
}

/**
 * CombatComponent handles damage dealing and targeting.
 *
 * Combat logic (targeting, firing) is handled by TowerCombatService.
 * This component stores combat stats and firing state.
 *
 * Phase 5.11 fix: cooldown uses game-time (deltaTime-driven) instead of
 * wall-clock `now - lastFireTime`. At high training timescales (e.g. 75x)
 * the wall-clock approach clamped against the ~16ms frame boundary and
 * produced ~20% fewer shots than the fireRate should allow — causing the
 * bot to appear weaker the faster the simulation ran.
 */
export class CombatComponent extends Component {
  damage: number;
  range: number;
  fireRate: number;

  /** Number of kills this unit has made */
  kills = 0;

  /** Remaining cooldown in GAME-TIME ms (0 = can fire). */
  private cooldownRemainingMs = 0;

  constructor(gameObject: GameObject, config: CombatConfig) {
    super(gameObject);
    this.damage = config.damage;
    this.range = config.range;
    this.fireRate = config.fireRate;
  }

  /**
   * Can the tower fire this frame? (game-time cooldown elapsed)
   */
  canFire(): boolean {
    return this.fireRate > 0 && this.cooldownRemainingMs <= 0;
  }

  /**
   * Mark that a shot was fired — resets the cooldown.
   */
  fire(): void {
    if (this.fireRate > 0) {
      this.cooldownRemainingMs = 1000 / this.fireRate;
    }
  }

  /**
   * Advance the cooldown by the given game-time delta.
   * Called from tower-combat.service each frame for every active tower.
   */
  update(deltaTime: number): void {
    if (this.cooldownRemainingMs > 0) {
      this.cooldownRemainingMs -= deltaTime;
      if (this.cooldownRemainingMs < 0) this.cooldownRemainingMs = 0;
    }
  }
}
