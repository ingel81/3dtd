import { Component } from '../core/component';
import { GameObject } from '../core/game-object';

export interface CombatConfig {
  damage: number;
  range: number;
  fireRate: number; // Shots per second
}

/**
 * CombatComponent handles damage dealing and targeting.
 * Combat logic (targeting, firing) is handled by TowerCombatService.
 * This component stores combat stats and firing state.
 */
export class CombatComponent extends Component {
  damage: number;
  range: number;
  fireRate: number;

  /** Number of kills this unit has made */
  kills = 0;

  private lastFireTime = 0;

  constructor(gameObject: GameObject, config: CombatConfig) {
    super(gameObject);
    this.damage = config.damage;
    this.range = config.range;
    this.fireRate = config.fireRate;
  }

  /**
   * Check if enough time has passed to fire again
   * @param currentTime Current timestamp in milliseconds
   * @param timescale Game speed multiplier (1.0 = normal, 8.0 = 8x faster)
   */
  canFire(currentTime: number, timescale = 1.0): boolean {
    const fireInterval = (1000 / this.fireRate) / timescale;
    return currentTime - this.lastFireTime >= fireInterval;
  }

  /**
   * Mark that a shot was fired
   */
  fire(currentTime: number): void {
    this.lastFireTime = currentTime;
  }

  update(_deltaTime: number): void {
    // Combat logic is handled by TowerCombatService
  }
}
