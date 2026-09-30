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
 *
 * The rate holds at any sub-step length: a cooldown runs out somewhere
 * inside a sub-step, and the shot of that sub-step takes what was over into
 * the next cooldown. Without it every shot came up to a sub-step late, and a
 * unit fired slower than its rate the longer the sub-step (TODO E86).
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

  /**
   * Remaining cooldown in GAME-TIME ms; 0 or below = can fire. Below 0 only
   * in the sub-step it ran out in: how long ago that was (see update()).
   */
  private cooldownRemainingMs = 0;

  constructor(gameObject: GameObject, config: CombatConfig) {
    super(gameObject);
    this.damage = config.damage;
    this.range = config.range;
    this.fireRate = config.fireRate;
  }

  /** Game-time ms until the next shot, 0 or just below when it can fire (read by the `__towerTargets` console). */
  get cooldownRemaining(): number {
    return this.cooldownRemainingMs;
  }

  /** Set the remaining cooldown, for a snapshot restore (docs/SIMULATOR_PLAN.md, P4). */
  restoreCooldown(ms: number): void {
    this.cooldownRemainingMs = ms;
  }

  canFire(): boolean {
    return this.fireRate > 0 && this.cooldownRemainingMs <= 0;
  }

  /** The shot of this sub-step: the next cooldown starts where the last one ran out, not at the sub-step's end. */
  fire(): void {
    if (this.fireRate > 0) {
      this.cooldownRemainingMs += 1000 / this.fireRate;
    }
  }

  /**
   * One sub-step, before the unit may fire in it. A cooldown that runs out
   * in this sub-step goes below 0 by what was over, for fire() to take
   * along. It is kept for this one sub-step only: a unit that does not fire
   * now (no target) saves up nothing, and no sub-step brings two shots.
   */
  update(deltaTime: number): void {
    if (this.cooldownRemainingMs > 0) this.cooldownRemainingMs -= deltaTime;
    else this.cooldownRemainingMs = 0;
  }
}
