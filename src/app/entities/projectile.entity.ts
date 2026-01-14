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
    this._totalDistance = this.calculateDistance(startPosition, targetEnemy.position);

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
   * Move towards target enemy
   * @returns true if hit target, false otherwise
   */
  updateTowardsTarget(deltaTime: number): boolean {
    if (!this.targetEnemy.alive) {
      return false; // Target dead
    }

    const targetPos = this.targetEnemy.position;
    const dist = this.calculateDistance(this.position, targetPos);
    const moveDistance = (this.movement.speedMps * deltaTime) / 1000;

    // Track traveled distance for progress calculation
    this._traveledDistance += moveDistance;

    if (dist <= moveDistance) {
      // Hit target
      this.transform.setPosition(targetPos.lat, targetPos.lon);
      this._flightHeight = this.getTargetHeight();
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

    return false;
  }

  /**
   * Calculate flight height at current position
   * Creates a slight arc trajectory for arrow projectiles
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

    // Only arrows have arc trajectory - bullets and other projectiles fly straight
    if (this.typeConfig.id !== 'arrow') {
      return baseHeight;
    }

    // Add arc for arrow projectiles: parabolic curve that peaks at midpoint
    // arcHeight = maxArc * 4 * progress * (1 - progress)
    // This gives 0 at progress=0, maxArc at progress=0.5, 0 at progress=1
    const maxArcHeight = Math.min(this._totalDistance * 0.05, 10); // Arc height proportional to distance, max 10m
    const arcOffset = maxArcHeight * 4 * progress * (1 - progress);

    return baseHeight + arcOffset;
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
}
