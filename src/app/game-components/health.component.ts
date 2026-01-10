import { Component } from '../core/component';
import { GameObject } from '../core/game-object';

/**
 * HealthComponent manages HP and damage for entities
 */
export class HealthComponent extends Component {
  private _hp: number;
  readonly maxHp: number;

  constructor(gameObject: GameObject, maxHp: number) {
    super(gameObject);
    this.maxHp = maxHp;
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
    this._hp = Math.min(this.maxHp, this._hp + amount);
  }

  /**
   * Set HP directly (for initialization)
   */
  setHp(hp: number): void {
    this._hp = Math.max(0, Math.min(this.maxHp, hp));
  }

  get hp(): number {
    return this._hp;
  }

  get healthPercent(): number {
    return this._hp / this.maxHp;
  }

  get isDead(): boolean {
    return this._hp === 0;
  }

  update(deltaTime: number): void {
    // Health doesn't need per-frame updates
  }
}
