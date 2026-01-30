import { Component, ComponentType } from '../core/component';
import { GameObject } from '../core/game-object';
import { GeoPosition } from '../models/game.types';
import { StatusEffect } from '../models/status-effects';
import { TransformComponent } from './transform.component';
import { haversineDistance } from '../utils/geo-utils';

/**
 * MovementComponent handles path-following movement
 */
export class MovementComponent extends Component {
  speedMps = 0; // Base meters per second
  speedMultiplier = 1.0; // Multiplier for run animation etc.
  path: GeoPosition[] = [];
  currentIndex = 0;
  progress = 0; // 0-1 within current segment

  private segmentLengths: number[] = [];
  paused = false;

  // Status effects (slow, freeze, etc.)
  statusEffects: StatusEffect[] = [];

  // Lateral offset for path variety (perpendicular to movement direction)
  private lateralOffsetMeters = 0;

  // Height variation for air units (persistent offset per enemy)
  private heightVariationMeters = 0;

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
   * Set height variation in meters (for air units)
   */
  setHeightVariation(variationMeters: number): void {
    this.heightVariationMeters = variationMeters;
  }

  /**
   * Get height variation in meters
   */
  getHeightVariation(): number {
    return this.heightVariationMeters;
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
      const dist = haversineDistance(
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
   * Get effective speed (base speed × multiplier × slow effects)
   * Note: timescale is handled separately in the move() method
   */
  get effectiveSpeed(): number {
    return this.speedMps * this.speedMultiplier * this.getSlowMultiplier(1.0);
  }

  /**
   * Get effective speed with timescale
   */
  getEffectiveSpeed(timescale = 1.0): number {
    return this.speedMps * this.speedMultiplier * this.getSlowMultiplier(timescale);
  }

  /**
   * Get overall path progress (0 = start, 1 = reached end)
   */
  getPathProgress(): number {
    if (this.path.length === 0 || this.segmentLengths.length === 0) {
      return 0;
    }

    // Calculate total path length
    const totalLength = this.segmentLengths.reduce((sum, len) => sum + len, 0);
    if (totalLength === 0) return 1;

    // Calculate distance covered
    let coveredDistance = 0;

    // Add all completed segments
    for (let i = 0; i < this.currentIndex && i < this.segmentLengths.length; i++) {
      coveredDistance += this.segmentLengths[i];
    }

    // Add progress within current segment
    if (this.currentIndex < this.segmentLengths.length) {
      coveredDistance += this.segmentLengths[this.currentIndex] * this.progress;
    }

    return Math.min(1, coveredDistance / totalLength);
  }

  /**
   * Apply a status effect to this entity
   * Slow effects don't stack - only one slow can be active (refreshes duration)
   */
  applyStatusEffect(effect: StatusEffect): void {
    // For slow effects: only one can be active at a time (no stacking)
    // Any new slow replaces existing slow (refreshes timer)
    if (effect.type === 'slow') {
      const existingSlowIndex = this.statusEffects.findIndex((e) => e.type === 'slow');
      if (existingSlowIndex >= 0) {
        // Replace existing slow (refresh duration)
        this.statusEffects[existingSlowIndex] = effect;
      } else {
        this.statusEffects.push(effect);
      }
      return;
    }

    // For other effects: check same type + source
    const existingIndex = this.statusEffects.findIndex(
      (e) => e.type === effect.type && e.sourceId === effect.sourceId
    );

    if (existingIndex >= 0) {
      // Refresh existing effect
      this.statusEffects[existingIndex] = effect;
    } else {
      this.statusEffects.push(effect);
    }
  }

  /**
   * Remove expired status effects
   * @param timescale Game speed multiplier (affects effective duration)
   */
  removeExpiredEffects(timescale = 1.0): void {
    const now = performance.now();
    this.statusEffects = this.statusEffects.filter(
      (effect) => {
        const effectiveDuration = effect.duration / timescale;
        return now - effect.startTime < effectiveDuration;
      }
    );
  }

  /**
   * Get slow multiplier from active slow effect (only one can be active)
   * Returns 1.0 if not slowed, lower value if slowed (e.g. 0.5 = 50% speed)
   * @param timescale Game speed multiplier (affects effective duration)
   */
  getSlowMultiplier(timescale = 1.0): number {
    const now = performance.now();

    for (const effect of this.statusEffects) {
      const effectiveDuration = effect.duration / timescale;
      if (effect.type === 'slow' && now - effect.startTime < effectiveDuration) {
        // Slow effect active - return reduced speed multiplier
        return 1 - effect.value;
      }
    }

    return 1.0; // Not slowed
  }

  /**
   * Check if entity has any active slow effects
   * @param timescale Game speed multiplier (affects effective duration)
   */
  isSlowed(timescale = 1.0): boolean {
    const now = performance.now();
    return this.statusEffects.some(
      (effect) => {
        const effectiveDuration = effect.duration / timescale;
        return effect.type === 'slow' && now - effect.startTime < effectiveDuration;
      }
    );
  }

  /**
   * Move along path
   * @param deltaTime Delta time in milliseconds (already scaled by timescale)
   * @param timescale Game speed multiplier (for status effect duration)
   * @returns 'moving' if still moving, 'reached_end' if path complete
   */
  move(deltaTime: number, timescale = 1.0): 'moving' | 'reached_end' {
    if (this.paused || this.path.length < 2) return 'moving';

    const transform = this.gameObject.getComponent<TransformComponent>(ComponentType.TRANSFORM);
    if (!transform) return 'moving';

    // Cap deltaTime to prevent huge jumps (scale cap with timescale to avoid limiting high-speed gameplay)
    const maxDelta = 100 * Math.max(1, timescale);
    const cappedDelta = Math.min(deltaTime, maxDelta);
    const deltaSeconds = cappedDelta / 1000;

    // Movement in meters per frame (includes slow effects via effectiveSpeed)
    const metersThisFrame = this.getEffectiveSpeed(timescale) * deltaSeconds;

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

      // Apply height variation for air units
      if (this.heightVariationMeters !== 0) {
        transform.terrainHeight += this.heightVariationMeters;
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
   * Check if current segment has valid heights (no object allocation)
   */
  hasCurrentSegmentHeights(): boolean {
    if (this.currentIndex >= this.path.length - 1) return false;
    const from = this.path[this.currentIndex];
    const to = this.path[this.currentIndex + 1];
    return from.height != null && to.height != null;
  }

  /**
   * Get next waypoint
   */
  getNextWaypoint(): GeoPosition | null {
    if (this.currentIndex + 1 >= this.path.length) return null;
    return this.path[this.currentIndex + 1];
  }

  update(_deltaTime: number): void {
    // Movement is triggered explicitly via move() method
  }
}
