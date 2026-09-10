import { Component } from '../core/component';
import { GameObject } from '../core/game-object';

/**
 * Receives HealthComponent's dead/alive state on every HP write. Lets an
 * owner answer "is it dead?" from its own fields instead of loading the
 * component. EnemyManager asks that of every enemy several times a frame.
 */
export interface DeathFlagSink {
  deadFlag: boolean;
}

/**
 * HealthComponent manages HP and damage for entities
 */
export class HealthComponent extends Component {
  private _hp: number;
  private _maxHp: number;

  constructor(
    gameObject: GameObject,
    maxHp: number,
    private readonly deathSink: DeathFlagSink | null = null,
  ) {
    super(gameObject);
    this._maxHp = maxHp;
    this._hp = maxHp;
    this.syncDeathFlag();
  }

  /**
   * Apply damage to this entity
   * @returns true if entity is now dead
   */
  takeDamage(amount: number): boolean {
    this._hp = Math.max(0, this._hp - amount);
    this.syncDeathFlag();
    return this._hp === 0;
  }

  /**
   * Heal this entity
   */
  heal(amount: number): void {
    this._hp = Math.min(this._maxHp, this._hp + amount);
    this.syncDeathFlag();
  }

  /**
   * Set HP directly (for initialization)
   */
  setHp(hp: number): void {
    this._hp = Math.max(0, Math.min(this._maxHp, hp));
    this.syncDeathFlag();
  }

  /**
   * Reset health with new max HP (for debug/override purposes)
   */
  resetMaxHp(newMaxHp: number): void {
    this._maxHp = newMaxHp;
    this._hp = newMaxHp;
    this.syncDeathFlag();
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

  /** Runs after every `_hp` write, so the sink can never disagree with `isDead`. */
  private syncDeathFlag(): void {
    if (this.deathSink !== null) this.deathSink.deadFlag = this._hp === 0;
  }
}
