import { Component, ComponentType } from '../core/component';
import { GameObject } from '../core/game-object';
import { GeoPosition } from '../models/game.types';
import { StatusEffect } from '../models/status-effects';
import { TransformComponent } from './transform.component';
import { haversineDistance, METERS_PER_DEGREE_LAT, DEG_TO_RAD } from '../utils/geo-utils';

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
  /**
   * Prefix sums of segment lengths: cumulativeLength[i] = sum of segments
   * [0..i-1] (so [0]=0, length = segmentLengths.length+1). Lets getPathProgress
   * run O(1) instead of summing completed segments every call (it's hit per
   * candidate in 'first'-strategy targeting).
   */
  private cumulativeLength: number[] = [0];
  /** Sum of all segment lengths — cached in precomputeSegmentLengths(). */
  private totalPathLength = 0;
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

  // Cached segment perpendicular vector (recalculated on segment change only)
  private cachedPerpLat = 0;
  private cachedPerpLon = 0;
  private cachedPerpSegIdx = -1;
  private cachedPerpValid = false;
  private cachedMetersPerDegree = METERS_PER_DEGREE_LAT; // Cached lat→meter conversion for lateral offset

  // Reusable lookAt target (avoid object literal allocation per frame)
  private static readonly _lookAtTarget: GeoPosition = { lat: 0, lon: 0 };

  // Reusable status result object (avoid per-enemy allocation in updateStatusEffects)
  private static readonly _statusResult = { isSlowed: false, isPoisoned: false, slowMultiplier: 1.0 };

  // Cached transform — move() runs per enemy per sub-step, and the generic
  // getComponent() Map lookup was measurable at 10k+ enemies. Resolved lazily
  // so the component stays constructible before a transform exists.
  private _transform: TransformComponent | null = null;

  constructor(gameObject: GameObject) {
    super(gameObject);
  }

  private get transformRef(): TransformComponent | null {
    return (this._transform ??= this.gameObject.getComponent<TransformComponent>(
      ComponentType.TRANSFORM,
    ));
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
    this.cachedPerpSegIdx = -1;
    this.cachedPerpValid = false;
    this.precomputeSegmentLengths();

    // Set initial position
    const transform = this.transformRef;
    if (transform && path.length > 0) {
      transform.setPosition(path[0].lat, path[0].lon, path[0].height);
      if (path[0].height !== undefined) {
        // Seed only — replaced by the grid read on the first update tick.
        transform.terrainHeight = path[0].height;
      }
    }
  }

  /**
   * Pre-compute segment lengths for accurate speed-based movement
   */
  private precomputeSegmentLengths(): void {
    this.segmentLengths = [];
    this.cumulativeLength = [0];
    let total = 0;
    for (let i = 0; i < this.path.length - 1; i++) {
      const dist = haversineDistance(
        this.path[i].lat,
        this.path[i].lon,
        this.path[i + 1].lat,
        this.path[i + 1].lon
      );
      this.segmentLengths.push(dist);
      total += dist;
      this.cumulativeLength.push(total); // cumulativeLength[i+1] = sum [0..i]
    }
    this.totalPathLength = total;
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
   * Effective speed INCLUDING any status effects whose duration is still
   * unexpired. The check `gameTimeMs - startTime < duration` succeeds for
   * any `gameTimeMs >= startTime` that hasn't yet elapsed the duration,
   * so walking through the list directly picks up active slow effects.
   */
  get effectiveSpeed(): number {
    let slowMult = 1.0;
    for (const effect of this.statusEffects) {
      if (effect.type === 'slow') {
        // Effect is considered "active" while its startTime + duration hasn't
        // been consumed — we don't know the current game-clock here, so we
        // assume it's still within the effect window. Callers that need an
        // explicit game-time check should use `getEffectiveSpeed(gameTimeMs)`.
        slowMult = 1 - effect.value;
        break;
      }
    }
    return this.speedMps * this.speedMultiplier * slowMult;
  }

  /** Get effective speed including any active slow effect at `gameTimeMs`. */
  getEffectiveSpeed(gameTimeMs: number): number {
    return this.speedMps * this.speedMultiplier * this.getSlowMultiplier(gameTimeMs);
  }

  /**
   * Get overall path progress (0 = start, 1 = reached end)
   */
  getPathProgress(): number {
    if (this.path.length === 0 || this.segmentLengths.length === 0) {
      return 0;
    }

    // Total path length is pre-summed in precomputeSegmentLengths().
    const totalLength = this.totalPathLength;
    if (totalLength === 0) return 1;

    // Completed segments via prefix sum (O(1)); clamp index past the end.
    const segCount = this.segmentLengths.length;
    const idx = this.currentIndex < segCount ? this.currentIndex : segCount;
    let coveredDistance = this.cumulativeLength[idx];

    // Add progress within current segment
    if (this.currentIndex < segCount) {
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

    // For poison effects: only one can be active at a time (no stacking, refreshes timer)
    if (effect.type === 'poison') {
      const existingPoisonIndex = this.statusEffects.findIndex((e) => e.type === 'poison');
      if (existingPoisonIndex >= 0) {
        this.statusEffects[existingPoisonIndex] = effect;
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
   * Single-pass status effect update: removes expired effects in-place
   * and returns active slow/poison flags + slow multiplier.
   *
   * `gameTimeMs` is the engine's monotonic game-clock (NOT performance.now()).
   * `effect.startTime` is also stored as game-time ms — effect duration is
   * compared in game-time, so it stays constant across all training timescales
   * without any compensation.
   */
  updateStatusEffects(gameTimeMs: number): {
    isSlowed: boolean;
    isPoisoned: boolean;
    slowMultiplier: number;
  } {
    let writeIdx = 0;
    const result = MovementComponent._statusResult;
    result.isSlowed = false;
    result.isPoisoned = false;
    result.slowMultiplier = 1.0;

    // eslint-disable-next-line @typescript-eslint/prefer-for-of -- in-place compact needs indexed write
    for (let i = 0; i < this.statusEffects.length; i++) {
      const effect = this.statusEffects[i];
      if (gameTimeMs - effect.startTime < effect.duration) {
        // Effect still active — keep it
        this.statusEffects[writeIdx++] = effect;
        if (effect.type === 'slow') {
          result.isSlowed = true;
          result.slowMultiplier = 1 - effect.value;
        } else if (effect.type === 'freeze') {
          // Freeze = full stop. Currently RESERVED/unused (no tower applies it),
          // but set the multiplier to 0 so the reserved effect is correct by
          // construction if it's ever enabled — previously it only tinted the
          // enemy blue while letting it move at full speed.
          result.isSlowed = true;
          result.slowMultiplier = 0;
        } else if (effect.type === 'poison') {
          result.isPoisoned = true;
        }
      }
    }
    this.statusEffects.length = writeIdx; // In-place compact, no allocation

    return result;
  }

  /** Remove expired status effects. `gameTimeMs` = engine game-clock. */
  removeExpiredEffects(gameTimeMs: number): void {
    let writeIdx = 0;
    // eslint-disable-next-line @typescript-eslint/prefer-for-of -- in-place compact needs indexed write
    for (let i = 0; i < this.statusEffects.length; i++) {
      const effect = this.statusEffects[i];
      if (gameTimeMs - effect.startTime < effect.duration) {
        this.statusEffects[writeIdx++] = effect;
      }
    }
    this.statusEffects.length = writeIdx;
  }

  /**
   * Get current slow multiplier (1.0 = no slow, 0 = frozen solid).
   *
   * Mirrors the 'slow'/'freeze' handling of `updateStatusEffects` — the two
   * must not disagree, or the simulation stops the enemy while the renderer
   * keeps its walk cycle running at full speed.
   */
  getSlowMultiplier(gameTimeMs: number): number {
    for (const effect of this.statusEffects) {
      if (gameTimeMs - effect.startTime >= effect.duration) continue;
      if (effect.type === 'freeze') return 0;
      if (effect.type === 'slow') return 1 - effect.value;
    }
    return 1.0;
  }

  /** Whether enemy has an active slow or freeze effect. */
  isSlowed(gameTimeMs: number): boolean {
    return this.statusEffects.some(
      (effect) =>
        (effect.type === 'slow' || effect.type === 'freeze') &&
        gameTimeMs - effect.startTime < effect.duration,
    );
  }

  /** Whether enemy has an active poison effect. */
  isPoisoned(gameTimeMs: number): boolean {
    return this.statusEffects.some(
      (effect) => effect.type === 'poison' && gameTimeMs - effect.startTime < effect.duration,
    );
  }

  /**
   * Move along path. `deltaTime` is sub-step game-time ms (~16.67ms).
   * `gameTimeMs` is the engine game-clock used for status-effect lookups.
   * `cachedSlowMult` lets the caller share the slow multiplier across
   * updateStatusEffects + move within the same sub-step (1 iteration).
   */
  move(deltaTime: number, gameTimeMs: number, cachedSlowMult?: number): 'moving' | 'reached_end' {
    if (this.paused || this.path.length < 2) return 'moving';

    const transform = this.transformRef;
    if (!transform) return 'moving';

    // Sub-step is fixed (~16.67ms game-time), so a small constant cap is safe.
    const maxDelta = 100;
    const cappedDelta = Math.min(deltaTime, maxDelta);
    const deltaSeconds = cappedDelta / 1000;

    // Use cached slow multiplier from updateStatusEffects if provided
    const slowMult = cachedSlowMult ?? this.getSlowMultiplier(gameTimeMs);
    const metersThisFrame = this.speedMps * this.speedMultiplier * slowMult * deltaSeconds;

    // Current segment length
    const segmentLength = this.segmentLengths[this.currentIndex] || 1;

    // Update progress based on actual segment length
    this.progress += metersThisFrame / segmentLength;

    // Handle segment transitions, keeping overflow for smooth movement
    while (this.progress >= 1) {
      this.progress -= 1;
      this.currentIndex++;
      this.cachedPerpValid = false; // Invalidate cached perpendicular on segment change

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
        // Cache perpendicular vector per segment (recalc only on segment change)
        if (!this.cachedPerpValid || this.cachedPerpSegIdx !== this.currentIndex) {
          const dLat = next.lat - current.lat;
          const dLon = next.lon - current.lon;
          const lenSq = dLat * dLat + dLon * dLon;
          if (lenSq > 0) {
            const len = Math.sqrt(lenSq);
            this.cachedPerpLat = -dLon / len;
            this.cachedPerpLon = dLat / len;
          } else {
            this.cachedPerpLat = 0;
            this.cachedPerpLon = 0;
          }
          // Cache metersPerDegree at segment start (varies <0.01% within a segment)
          this.cachedMetersPerDegree = METERS_PER_DEGREE_LAT * Math.cos(newLat * DEG_TO_RAD);
          this.cachedPerpSegIdx = this.currentIndex;
          this.cachedPerpValid = true;
        }
        if (this.cachedPerpLat !== 0 || this.cachedPerpLon !== 0) {
          const offsetDegrees = this.lateralOffsetMeters / this.cachedMetersPerDegree;
          newLat += this.cachedPerpLat * offsetDegrees;
          newLon += this.cachedPerpLon * offsetDegrees;
        }
      }

      transform.setPosition(newLat, newLon);

      // Height is NOT derived here. Interpolating the path's baked heights
      // was a second ground model beside the route grid, and the stale one:
      // the grid re-samples as tiles refine, the bake never did. EnemyManager
      // reads the grid per frame instead and applies `heightVariationMeters`
      // there, so air units keep their spread without this accumulating it
      // into `terrainHeight` on every step.

      // Update rotation based on actual movement direction (not next waypoint)
      // This prevents sudden heading jumps at segment transitions
      if (this.hasMovedOnce) {
        const dLat = newLat - this.previousLat;
        const dLon = newLon - this.previousLon;
        // Use squared distance to avoid sqrt (only checking threshold)
        const moveDistSq = dLat * dLat + dLon * dLon;
        if (moveDistSq > 1e-14) {
          // Reuse static object to avoid per-frame allocation
          const target = MovementComponent._lookAtTarget;
          target.lat = newLat + dLat;
          target.lon = newLon + dLon;
          transform.lookAt(target);
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

  update(_deltaTime: number): void {
    // Movement is triggered explicitly via move() method
  }
}
