import { Component, ComponentType } from '../core/component';
import { GameObject } from '../core/game-object';
import { GeoPosition } from '../models/game.types';
import { TransformComponent } from './transform.component';

/**
 * MovementComponent handles path-following movement
 */
export class MovementComponent extends Component {
  speedMps = 0; // Meters per second
  path: GeoPosition[] = [];
  currentIndex = 0;
  progress = 0; // 0-1 within current segment

  private segmentLengths: number[] = [];
  paused = false;

  // Lateral offset for path variety (perpendicular to movement direction)
  private lateralOffsetMeters = 0;

  // Track previous position for direction-based heading calculation
  private previousLat = 0;
  private previousLon = 0;
  private hasMovedOnce = false;

  constructor(gameObject: GameObject) {
    super(gameObject);
  }

  /**
   * Set lateral offset in meters (positive = right, negative = left of path)
   */
  setLateralOffset(offsetMeters: number): void {
    this.lateralOffsetMeters = offsetMeters;
  }

  /**
   * Set the path and pre-compute segment lengths
   */
  setPath(path: GeoPosition[]): void {
    this.path = path;
    this.currentIndex = 0;
    this.progress = 0;
    this.precomputeSegmentLengths();

    // Set initial position
    const transform = this.gameObject.getComponent<TransformComponent>(ComponentType.TRANSFORM);
    if (transform && path.length > 0) {
      transform.setPosition(path[0].lat, path[0].lon, path[0].height);
      if (path[0].height !== undefined) {
        transform.terrainHeight = path[0].height;
      }
    }
  }

  /**
   * Pre-compute segment lengths for accurate speed-based movement
   */
  private precomputeSegmentLengths(): void {
    this.segmentLengths = [];
    for (let i = 0; i < this.path.length - 1; i++) {
      const dist = this.haversineDistance(
        this.path[i].lat,
        this.path[i].lon,
        this.path[i + 1].lat,
        this.path[i + 1].lon
      );
      this.segmentLengths.push(dist);
    }
  }

  /**
   * Pause movement
   */
  pause(): void {
    this.paused = true;
  }

  /**
   * Resume movement
   */
  resume(): void {
    this.paused = false;
  }

  /**
   * Move along path
   * @returns 'moving' if still moving, 'reached_end' if path complete
   */
  move(deltaTime: number): 'moving' | 'reached_end' {
    if (this.paused || this.path.length < 2) return 'moving';

    const transform = this.gameObject.getComponent<TransformComponent>(ComponentType.TRANSFORM);
    if (!transform) return 'moving';

    // Cap deltaTime to prevent huge jumps
    const cappedDelta = Math.min(deltaTime, 100);
    const deltaSeconds = cappedDelta / 1000;

    // Movement in meters per frame
    const metersThisFrame = this.speedMps * deltaSeconds;

    // Current segment length
    const segmentLength = this.segmentLengths[this.currentIndex] || 1;

    // Update progress based on actual segment length
    this.progress += metersThisFrame / segmentLength;

    // Handle segment transitions, keeping overflow for smooth movement
    while (this.progress >= 1) {
      this.progress -= 1;
      this.currentIndex++;

      if (this.currentIndex >= this.path.length - 1) {
        return 'reached_end';
      }
    }

    // Interpolate position
    const current = this.path[this.currentIndex];
    const next = this.path[this.currentIndex + 1];

    if (current && next) {
      let newLat = current.lat + (next.lat - current.lat) * this.progress;
      let newLon = current.lon + (next.lon - current.lon) * this.progress;

      // Apply lateral offset perpendicular to movement direction
      if (this.lateralOffsetMeters !== 0) {
        const dLat = next.lat - current.lat;
        const dLon = next.lon - current.lon;
        const len = Math.sqrt(dLat * dLat + dLon * dLon);
        if (len > 0) {
          // Perpendicular vector (rotated 90 degrees)
          const perpLat = -dLon / len;
          const perpLon = dLat / len;
          // Convert meters to approximate degrees (at this latitude)
          const metersPerDegree = 111000 * Math.cos((newLat * Math.PI) / 180);
          const offsetDegrees = this.lateralOffsetMeters / metersPerDegree;
          newLat += perpLat * offsetDegrees;
          newLon += perpLon * offsetDegrees;
        }
      }

      transform.setPosition(newLat, newLon);

      // Interpolate height if available
      if (current.height !== undefined && next.height !== undefined) {
        transform.terrainHeight = current.height + (next.height - current.height) * this.progress;
      }

      // Update rotation based on actual movement direction (not next waypoint)
      // This prevents sudden heading jumps at segment transitions
      if (this.hasMovedOnce) {
        const dLat = newLat - this.previousLat;
        const dLon = newLon - this.previousLon;
        const moveDist = Math.sqrt(dLat * dLat + dLon * dLon);
        // Only update heading if we've moved a meaningful distance
        if (moveDist > 0.0000001) {
          transform.lookAt({ lat: newLat + dLat, lon: newLon + dLon });
        }
      } else {
        // First frame: look at next waypoint
        transform.lookAt(next);
        this.hasMovedOnce = true;
      }

      // Store current position for next frame's direction calculation
      this.previousLat = newLat;
      this.previousLon = newLon;
    }

    return 'moving';
  }

  /**
   * Get current segment
   */
  getCurrentSegment(): { from: GeoPosition; to: GeoPosition } | null {
    if (this.currentIndex >= this.path.length - 1) return null;
    return {
      from: this.path[this.currentIndex],
      to: this.path[this.currentIndex + 1],
    };
  }

  /**
   * Get next waypoint
   */
  getNextWaypoint(): GeoPosition | null {
    if (this.currentIndex + 1 >= this.path.length) return null;
    return this.path[this.currentIndex + 1];
  }

  /**
   * Haversine distance calculation
   */
  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000; // Earth radius in meters
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  update(deltaTime: number): void {
    // Movement is triggered explicitly via move() method
  }
}
