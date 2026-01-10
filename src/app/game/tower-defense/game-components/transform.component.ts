import { Component } from '../core/component';
import { GameObject } from '../core/game-object';
import { GeoPosition } from '../models/game.types';

/**
 * TransformComponent handles position, rotation, and scale of a GameObject
 */
export class TransformComponent extends Component {
  position: GeoPosition = { lat: 0, lon: 0, height: 0 };
  rotation = 0; // Heading in radians (smoothed)
  scale = 1.0;
  terrainHeight = 0; // Must be set from terrain sampling before use

  // Rotation smoothing
  private targetRotation = 0;
  private rotationInitialized = false;
  rotationSmoothingFactor = 0.15; // 0 = no smoothing, 1 = instant

  constructor(gameObject: GameObject) {
    super(gameObject);
  }

  /**
   * Set position in geo coordinates
   */
  setPosition(lat: number, lon: number, height?: number): void {
    this.position = { lat, lon, height: height ?? this.position.height };
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
   */
  lookAt(target: GeoPosition): void {
    const dLon = target.lon - this.position.lon;
    const dLat = target.lat - this.position.lat;

    // Skip if movement is too small (prevents jitter)
    if (Math.abs(dLat) < 0.0000001 && Math.abs(dLon) < 0.0000001) return;

    // Convert geo deltas to local direction:
    // - dLon > 0 (East) → local dx < 0 (because -X = East)
    // - dLat > 0 (North) → local dz > 0 (because +Z = North)
    const localDx = -dLon;
    const localDz = dLat;

    // Calculate rotation.y: atan2(x, z) gives angle from +Z axis
    this.targetRotation = Math.atan2(localDx, localDz);

    // Initialize rotation immediately on first call
    if (!this.rotationInitialized) {
      this.rotation = this.targetRotation;
      this.rotationInitialized = true;
    }
  }

  update(deltaTime: number): void {
    // Smoothly interpolate rotation towards target
    if (this.rotationInitialized && this.rotation !== this.targetRotation) {
      // Handle angle wrapping (shortest path)
      let diff = this.targetRotation - this.rotation;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;

      // Lerp towards target
      if (Math.abs(diff) < 0.001) {
        this.rotation = this.targetRotation;
      } else {
        this.rotation += diff * this.rotationSmoothingFactor;
        // Normalize rotation
        while (this.rotation > Math.PI) this.rotation -= 2 * Math.PI;
        while (this.rotation < -Math.PI) this.rotation += 2 * Math.PI;
      }
    }
  }
}
