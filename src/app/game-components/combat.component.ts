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
 * Cooldown is driven by deltaTime (game-time ms). High-timescale correctness
 * is handled at the GameStateManager level via fixed-timestep sub-stepping —
 * the combat component itself behaves identically at every timescale.
 */
export class CombatComponent extends Component {
  damage: number;
  range: number;
  fireRate: number;

  /**
   * Killing blows: enemies whose last HP a hit of this unit took, counted by
   * DamageApplicationService. The veteran rank derives from it
   * (veteran-ranks.config.ts).
   */
  kills = 0;

  /**
   * HP this unit took off enemies, overkill not counted. Summed per hit by
   * DamageApplicationService, a plain number so the hot path allocates nothing.
   */
  damageDealt = 0;

  /** Remaining cooldown in GAME-TIME ms (0 = can fire). */
  private cooldownRemainingMs = 0;

  constructor(gameObject: GameObject, config: CombatConfig) {
    super(gameObject);
    this.damage = config.damage;
    this.range = config.range;
    this.fireRate = config.fireRate;
  }

  /** Game-time ms until the next shot, 0 when it can fire (read by the `__towerTargets` console). */
  get cooldownRemaining(): number {
    return this.cooldownRemainingMs;
  }

  canFire(): boolean {
    return this.fireRate > 0 && this.cooldownRemainingMs <= 0;
  }

  fire(): void {
    if (this.fireRate > 0) {
      this.cooldownRemainingMs = 1000 / this.fireRate;
    }
  }

  update(deltaTime: number): void {
    if (this.cooldownRemainingMs > 0) {
      this.cooldownRemainingMs -= deltaTime;
      if (this.cooldownRemainingMs < 0) this.cooldownRemainingMs = 0;
    }
  }
}
