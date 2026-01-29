import { Component, ComponentType } from '../core/component';
import { GameObject } from '../core/game-object';
import { GeoPosition } from '../models/game.types';
import { TransformComponent } from './transform.component';

export interface CombatConfig {
  damage: number;
  range: number;
  fireRate: number; // Shots per second
}

/**
 * CombatComponent handles damage dealing and targeting
 */
export class CombatComponent extends Component {
  damage: number;
  range: number;
  fireRate: number;

  /** Number of kills this unit has made */
  kills = 0;

  private lastFireTime = 0;
  private target: GameObject | null = null;

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

  /**
   * Check if a target position is within range
   */
  isInRange(targetPosition: GeoPosition): boolean {
    const transform = this.gameObject.getComponent<TransformComponent>(ComponentType.TRANSFORM);
    if (!transform) return false;

    const distance = this.calculateDistance(transform.position, targetPosition);
    return distance <= this.range;
  }

  /**
   * Calculate distance between two positions
   */
  private calculateDistance(pos1: GeoPosition, pos2: GeoPosition): number {
    const R = 6371000; // Earth radius in meters
    const dLat = ((pos2.lat - pos1.lat) * Math.PI) / 180;
    const dLon = ((pos2.lon - pos1.lon) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((pos1.lat * Math.PI) / 180) *
        Math.cos((pos2.lat * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Set current target
   */
  setTarget(target: GameObject | null): void {
    this.target = target;
  }

  /**
   * Clear current target
   */
  clearTarget(): void {
    this.target = null;
  }

  /**
   * Check if a target is set
   */
  hasTarget(): boolean {
    return this.target !== null;
  }

  update(_deltaTime: number): void {
    // Combat logic is handled explicitly (tower shooting, etc.)
  }
}
