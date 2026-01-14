import { Component } from '../core/component';
import { GameObject } from '../core/game-object';

/**
 * HealthComponent manages HP and damage for entities
 */
export class HealthComponent extends Component {
  private _hp: number;
  private _maxHp: number;

  constructor(gameObject: GameObject, maxHp: number) {
    super(gameObject);
    this._maxHp = maxHp;
    this._hp = maxHp;
  }

  /**
   * Apply damage to this entity
   * @returns true if entity is now dead
   */
  takeDamage(amount: number): boolean {
    this._hp = Math.max(0, this._hp - amount);
    return this._hp === 0;
  }

  /**
   * Heal this entity
   */
  heal(amount: number): void {
    this._hp = Math.min(this._maxHp, this._hp + amount);
  }

  /**
   * Set HP directly (for initialization)
   */
  setHp(hp: number): void {
    this._hp = Math.max(0, Math.min(this._maxHp, hp));
  }

  /**
   * Reset health with new max HP (for debug/override purposes)
   */
  resetMaxHp(newMaxHp: number): void {
    this._maxHp = newMaxHp;
    this._hp = newMaxHp;
  }

  get hp(): number {
    return this._hp;
  }

  get maxHp(): number {
    return this._maxHp;
  }

  get healthPercent(): number {
    return this._hp / this._maxHp;
  }

  get isDead(): boolean {
    return this._hp === 0;
  }

  update(_deltaTime: number): void {
    // Health doesn't need per-frame updates
  }
}
