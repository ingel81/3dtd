import { GameObject } from '../core/game-object';
import { ComponentType } from '../core/component';
import {
  TransformComponent,
  CombatComponent,
  MovementComponent,
  RenderComponent,
} from '../game-components';
import { GeoPosition } from '../models/game.types';
import {
  ProjectileTypeId,
  getProjectileType,
  ProjectileTypeConfig,
} from '../configs/projectile-types.config';
import { Enemy } from './enemy.entity';
import { geoDistance } from '../utils/geo-utils';

/**
 * Projectile entity - combines Transform, Combat, Movement, and Render components
 *
 * Flight path is calculated based on start height and target enemy position.
 * The projectile maintains its own flight height throughout its trajectory.
 */
export class Projectile extends GameObject {
  readonly typeConfig: ProjectileTypeConfig;
  readonly targetEnemy: Enemy;
  readonly sourceTowerId: string;

  private _transform!: TransformComponent;
  private _combat!: CombatComponent;
  private _movement!: MovementComponent;
  private _render!: RenderComponent;

  // Flight path properties
  private _startHeight: number;
  private _flightHeight: number;
  private _totalDistance: number = 0;
  private _traveledDistance: number = 0;

  // Homing projectiles (rockets) continuously update their direction
  private _isHoming: boolean = false;

  // Target lost tracking - projectile continues to last known position
  private _targetLost: boolean = false;
  private _lastTargetPosition: GeoPosition | null = null;
  private _lastTargetTerrainHeight: number = 0;

  constructor(
    startPosition: GeoPosition,
    targetEnemy: Enemy,
    typeId: ProjectileTypeId,
    damage: number,
    startHeight: number,
    sourceTowerId: string
  ) {
    super('projectile');
    this.typeConfig = getProjectileType(typeId);
    this.targetEnemy = targetEnemy;
    this.sourceTowerId = sourceTowerId;
    this._startHeight = startHeight;
    this._flightHeight = startHeight;

    // Add components
    this._transform = this.addComponent(
      new TransformComponent(this),
      ComponentType.TRANSFORM
    );
    this._combat = this.addComponent(
      new CombatComponent(this, {
        damage,
        range: 0,
        fireRate: 0,
      }),
      ComponentType.COMBAT
    );
    this._movement = this.addComponent(
      new MovementComponent(this),
      ComponentType.MOVEMENT
    );
    this._render = this.addComponent(
      new RenderComponent(this),
      ComponentType.RENDER
    );

    this._transform.setPosition(startPosition.lat, startPosition.lon, startHeight);
    this._movement.speedMps = this.typeConfig.speed;

    // Calculate total distance to target for progress tracking
    this._totalDistance = geoDistance(startPosition, targetEnemy.position);

    // Calculate initial direction vector
    this._direction = this.calculateDirectionVector(startPosition, startHeight);

    // Rockets are homing projectiles - they continuously update their direction
    this._isHoming = this.typeConfig.visualType === 'rocket';
  }

  /**
   * Calculate normalized direction vector from start to target
   * Uses geo coordinates converted to local offsets
   */
  private calculateDirectionVector(
    startPos: GeoPosition,
    startHeight: number
  ): { dx: number; dy: number; dz: number } {
    const targetPos = this.targetEnemy.position;
    const targetHeight = this.getTargetHeight(); // Includes heightOffset for air units

    // Calculate horizontal deltas (in geo coords, convert to local direction)
    // +lon = East = -X in local, +lat = North = +Z in local
    const dLon = targetPos.lon - startPos.lon;
    const dLat = targetPos.lat - startPos.lat;

    // Convert to local coordinate deltas
    // Scale doesn't matter since we normalize
    const dx = -dLon * 100000; // -X = East
    const dz = dLat * 100000;  // +Z = North
    const dy = targetHeight - startHeight; // Vertical difference

    // Normalize
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (length < 0.001) {
      return { dx: 0, dy: 0, dz: 1 }; // Default: forward
    }

    return {
      dx: dx / length,
      dy: dy / length,
      dz: dz / length,
    };
  }

  get transform(): TransformComponent {
    return this._transform;
  }
  get combat(): CombatComponent {
    return this._combat;
  }
  get movement(): MovementComponent {
    return this._movement;
  }
  get render(): RenderComponent {
    return this._render;
  }

  get position(): GeoPosition {
    return this.transform.position;
  }
  get damage(): number {
    return this.combat.damage;
  }

  /**
   * Get current flight height (interpolated along trajectory)
   */
  get flightHeight(): number {
    return this._flightHeight;
  }

  /**
   * Get flight progress (0 = start, 1 = target)
   */
  get flightProgress(): number {
    return this._totalDistance > 0 ? this._traveledDistance / this._totalDistance : 1;
  }

  /**
   * Get the fixed direction vector (calculated once at spawn, never changes)
   * This is the normalized direction from start to target
   */
  get direction(): { dx: number; dy: number; dz: number } {
    return this._direction;
  }

  private _direction: { dx: number; dy: number; dz: number } = { dx: 0, dy: 0, dz: 1 };

  /**
   * Check if this is a homing projectile (rockets)
   */
  get isHoming(): boolean {
    return this._isHoming;
  }

  /**
   * Check if this projectile has arc trajectory (arrows, cannonballs)
   */
  get hasArcTrajectory(): boolean {
    return this.typeConfig.id === 'arrow' || this.typeConfig.id === 'cannonball';
  }

  /**
   * Check if target was lost (enemy died mid-flight)
   * Projectile continues to last known position and explodes on ground
   */
  get targetLost(): boolean {
    return this._targetLost;
  }

  /**
   * Move towards target enemy
   * @returns true if hit target (or ground if target lost), false otherwise
   */
  updateTowardsTarget(deltaTime: number): boolean {
    // Check if target just died - capture last position
    if (!this.targetEnemy.alive && !this._targetLost) {
      this._targetLost = true;
      this._lastTargetPosition = { ...this.targetEnemy.position };
      this._lastTargetTerrainHeight = this.targetEnemy.transform.terrainHeight;
    }

    // Determine target position (live enemy or last known position)
    const targetPos = this._targetLost
      ? this._lastTargetPosition!
      : this.targetEnemy.position;
    const dist = geoDistance(this.position, targetPos);
    const moveDistance = (this.movement.speedMps * deltaTime) / 1000;

    // Track traveled distance for progress calculation
    this._traveledDistance += moveDistance;

    if (dist <= moveDistance) {
      // Hit target (or ground if target was lost)
      this.transform.setPosition(targetPos.lat, targetPos.lon);
      // If target lost, hit ground level; otherwise hit enemy height
      this._flightHeight = this._targetLost
        ? this._lastTargetTerrainHeight + 1 // Ground impact
        : this.getTargetHeight();
      return true;
    }

    // Move towards target
    const ratio = moveDistance / dist;
    const newLat = this.position.lat + (targetPos.lat - this.position.lat) * ratio;
    const newLon = this.position.lon + (targetPos.lon - this.position.lon) * ratio;

    this.transform.setPosition(newLat, newLon);

    // Calculate flight height along trajectory
    this._flightHeight = this.calculateFlightHeight();

    // Update direction for homing projectiles (rockets)
    if (this._isHoming) {
      this._direction = this.calculateDirectionVector(
        { lat: newLat, lon: newLon },
        this._flightHeight
      );
    }

    // Update direction for arc trajectory projectiles (tangent to parabola)
    if (this.hasArcTrajectory) {
      this._direction = this.calculateArcTangentDirection();
    }

    return false;
  }

  /**
   * Calculate tangent direction for arc trajectory projectiles
   * Returns normalized direction vector tangent to the parabolic arc
   */
  private calculateArcTangentDirection(): { dx: number; dy: number; dz: number } {
    // Use last known position if target was lost
    const targetPos = this._targetLost
      ? this._lastTargetPosition!
      : this.targetEnemy.position;
    const progress = this.flightProgress;

    // Horizontal direction (unchanged - always points towards target)
    const dLon = targetPos.lon - this.position.lon;
    const dLat = targetPos.lat - this.position.lat;
    const dx = -dLon * 100000;
    const dz = dLat * 100000;

    // Calculate horizontal magnitude for proper scaling
    const horizontalMag = Math.sqrt(dx * dx + dz * dz);

    // Calculate vertical tangent slope based on arc type
    // Derivative of arc: d(arcOffset)/d(progress) = maxArc * 4 * (1 - 2*progress)
    let arcSlope = 0;

    if (this.typeConfig.id === 'arrow') {
      const maxArcHeight = Math.min(this._totalDistance * 0.05, 10);
      arcSlope = maxArcHeight * 4 * (1 - 2 * progress);
    } else if (this.typeConfig.id === 'cannonball') {
      const maxArcHeight = Math.min(this._totalDistance * 0.15, 25);
      arcSlope = maxArcHeight * 4 * (1 - 2 * progress);
    }

    // Scale vertical component relative to horizontal travel
    // arcSlope is in meters per unit progress, convert to match horizontal scale
    const dy = arcSlope * (horizontalMag / this._totalDistance);

    // Also add the base height change (linear from start to target)
    const targetHeight = this.getTargetHeight();
    const baseHeightSlope = (targetHeight - this._startHeight) / this._totalDistance;
    const dyBase = baseHeightSlope * horizontalMag;

    const totalDy = dy + dyBase;

    // Normalize
    const length = Math.sqrt(dx * dx + totalDy * totalDy + dz * dz);
    if (length < 0.001) {
      return { dx: 0, dy: 0, dz: 1 };
    }

    return {
      dx: dx / length,
      dy: totalDy / length,
      dz: dz / length,
    };
  }

  /**
   * Calculate flight height at current position
   * Creates arc trajectories for arrow and cannonball projectiles
   * Homing projectiles (rockets) and bullets fly straight to target
   */
  private calculateFlightHeight(): number {
    const targetHeight = this.getTargetHeight();
    const progress = this.flightProgress;

    // Linear interpolation between start and target height
    const baseHeight = this._startHeight + (targetHeight - this._startHeight) * progress;

    // Homing projectiles fly straight - no arc
    if (this._isHoming) {
      return baseHeight;
    }

    // Arc trajectory for arrows: slight arc
    if (this.typeConfig.id === 'arrow') {
      const maxArcHeight = Math.min(this._totalDistance * 0.05, 10);
      const arcOffset = maxArcHeight * 4 * progress * (1 - progress);
      return baseHeight + arcOffset;
    }

    // Arc trajectory for cannonballs: higher parabolic arc (~20° launch angle)
    if (this.typeConfig.id === 'cannonball') {
      // Higher arc for cannonballs - proportional to distance
      const maxArcHeight = Math.min(this._totalDistance * 0.15, 25);
      const arcOffset = maxArcHeight * 4 * progress * (1 - progress);
      return baseHeight + arcOffset;
    }

    // All other projectiles (bullets, etc.) fly straight
    return baseHeight;
  }

  /**
   * Get target height (enemy position + model offset + head height)
   */
  private getTargetHeight(): number {
    const enemyTerrainHeight = this.targetEnemy.transform.terrainHeight ?? 0;
    // Include enemy's heightOffset (e.g., 15m for flying units like bats)
    const heightOffset = this.targetEnemy.typeConfig.heightOffset ?? 0;
    // Target head height (approximately 2-3m above model base)
    return enemyTerrainHeight + heightOffset + 3;
  }
}
