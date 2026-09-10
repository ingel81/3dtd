import { Component } from '../core/component';
import { GameObject } from '../core/game-object';
import { GeoPosition } from '../models/game.types';

/**
 * Receives whether a TransformComponent still has to turn, i.e. whether
 * `update()` would move `rotation`. An owner that keeps this flag can skip
 * the call without loading the component. EnemyManager would otherwise make
 * it for every enemy every sub-step while only those rounding a corner turn.
 */
export interface TurningFlagSink {
  isTurning: boolean;
}

/**
 * TransformComponent handles position, rotation, and scale of a GameObject
 */
export class TransformComponent extends Component {
  position: GeoPosition = { lat: 0, lon: 0, height: 0 };
  scale = 1.0;
  terrainHeight = 0; // Must be set from terrain sampling before use

  // Rotation smoothing
  private _rotation = 0; // Heading in radians (smoothed), see `rotation`
  private targetRotation = 0;
  private rotationInitialized = false;
  rotationSmoothingFactor = 0.15; // 0 = no smoothing, 1 = instant

  constructor(
    gameObject: GameObject,
    private readonly turnSink: TurningFlagSink | null = null,
  ) {
    super(gameObject);
    this.syncTurningFlag();
  }

  /** Heading in radians (smoothed). An accessor so every write keeps the TurningFlagSink exact. */
  get rotation(): number {
    return this._rotation;
  }
  set rotation(value: number) {
    this._rotation = value;
    this.syncTurningFlag();
  }

  /**
   * Set position in geo coordinates
   */
  setPosition(lat: number, lon: number, height?: number): void {
    this.position.lat = lat;
    this.position.lon = lon;
    if (height !== undefined) this.position.height = height;
  }

  /**
   * Look at a target position (updates target rotation, smoothed in update)
   *
   * Uses the same heading calculation as EllipsoidSync.calculateHeadingFromDeltas()
   *
   * Coordinate system (with ReorientationPlugin + tiles.group.rotation.x = -PI/2):
   * - Local: -X = East, +Z = North, +Y = Up
   * - Geo: +lon = East, +lat = North
   *
   * Three.js rotation.y (counterclockwise from above):
   * - 0 = facing +Z (North)
   * - PI/2 = facing -X (East)
   * - PI or -PI = facing -Z (South)
   * - -PI/2 = facing +X (West)
   *
   * @returns false if the target was too close to derive a heading from (the
   *   target rotation is left as it was), true if the target rotation was set.
   */
  lookAt(target: GeoPosition): boolean {
    const dLon = target.lon - this.position.lon;
    const dLat = target.lat - this.position.lat;

    // Skip if movement is too small (prevents jitter)
    if (Math.abs(dLat) < 0.0000001 && Math.abs(dLon) < 0.0000001) return false;

    // Convert geo deltas to local direction:
    // - dLon > 0 (East) → local dx < 0 (because -X = East)
    // - dLat > 0 (North) → local dz > 0 (because +Z = North)
    const localDx = -dLon;
    const localDz = dLat;

    // Calculate rotation.y: atan2(x, z) gives angle from +Z axis
    this.targetRotation = Math.atan2(localDx, localDz);

    // Initialize rotation immediately on first call
    if (!this.rotationInitialized) {
      this._rotation = this.targetRotation;
      this.rotationInitialized = true;
    }
    this.syncTurningFlag();
    return true;
  }

  update(deltaTime: number): void {
    // Smoothly interpolate rotation towards target
    if (this.rotationInitialized && this._rotation !== this.targetRotation) {
      // Handle angle wrapping (shortest path)
      let diff = this.targetRotation - this._rotation;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;

      // Lerp towards target (frame-independent smoothing)
      if (Math.abs(diff) < 0.001) {
        this._rotation = this.targetRotation;
      } else {
        // Linear approximation of exponential smoothing (avoids Math.pow per enemy per frame)
        // For factor=0.15, dt=16.67ms: exact=0.15, approx=0.15. Error <4% across typical dt range.
        const t = Math.min(1, this.rotationSmoothingFactor * deltaTime / 16.67);
        this._rotation += diff * t;
        // Normalize rotation
        while (this._rotation > Math.PI) this._rotation -= 2 * Math.PI;
        while (this._rotation < -Math.PI) this._rotation += 2 * Math.PI;
      }
      this.syncTurningFlag();
    }
  }

  /**
   * Runs after every write to the rotation state, so the sink holds exactly
   * the condition under which `update()` does anything.
   */
  private syncTurningFlag(): void {
    if (this.turnSink !== null) {
      this.turnSink.isTurning = this.rotationInitialized && this._rotation !== this.targetRotation;
    }
  }
}
