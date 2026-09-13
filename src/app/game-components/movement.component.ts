import { Component, ComponentType } from '../core/component';
import { GameObject } from '../core/game-object';
import { GeoPosition, RouteWaypoint } from '../models/game.types';
import { StatusEffect, StatusEffectType } from '../models/status-effects';
import { TransformComponent } from './transform.component';
import { METERS_PER_DEGREE_LAT, DEG_TO_RAD } from '../utils/geo-utils';
import { RouteProfile, getRouteProfile } from '../utils/route-corridor';

/**
 * MovementComponent handles path-following movement
 */
export class MovementComponent extends Component {
  speedMps = 0; // Base meters per second
  speedMultiplier = 1.0; // Multiplier for run animation etc.
  path: RouteWaypoint[] = [];
  currentIndex = 0;
  progress = 0; // 0-1 within current segment

  /**
   * Segment lengths, their prefix sums and the lateral limits of `path`,
   * computed once per path and shared by every enemy walking it
   * (getRouteProfile). The prefix sums let getPathProgress run O(1) instead
   * of summing completed segments every call (it's hit per candidate in
   * 'first'-strategy targeting).
   */
  private profile: RouteProfile = getRouteProfile(this.path);
  paused = false;

  // Status effects (slow, freeze, etc.)
  statusEffects: StatusEffect[] = [];

  // Place across the corridor for path variety, as a share of the local
  // lateral limit: -1 left, 0 centre line, 1 right of the movement direction
  private lateralFactor = 0;

  // Height variation for air units (persistent offset per enemy)
  private heightVariationMeters = 0;

  // Track previous position for direction-based heading calculation
  private previousLat = 0;
  private previousLon = 0;
  private hasMovedOnce = false;

  // Heading hold, see move(). `previousSegIdx` is the segment the previous
  // position was interpolated on, -1 after a jump that did not come from a
  // step (setPath, setLateralFactor), and `previousPiece` the piece of the
  // lateral limit it was on. `headingLocked` means a step that began and
  // ended on the current segment and piece has already set the heading.
  private previousSegIdx = -1;
  private previousPiece = 0;
  private headingLocked = false;

  // Degrees of lat and lon per metre of lateral offset on the current
  // segment (recalculated on segment change only)
  private cachedOffsetLatPerM = 0;
  private cachedOffsetLonPerM = 0;
  private cachedPerpSegIdx = -1;
  private cachedPerpValid = false;

  // Reusable lookAt target (avoid object literal allocation per frame)
  private static readonly _lookAtTarget: GeoPosition = { lat: 0, lon: 0 };

  // Reusable status result object (avoid per-enemy allocation in updateStatusEffects)
  private static readonly _statusResult = {
    isSlowed: false,
    isPoisoned: false,
    isBurning: false,
    isFrozen: false,
    isStunned: false,
    isHalted: false,
    slowMultiplier: 1.0,
  };

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
   * Set where across the corridor this enemy walks: -1 at the left limit, 0
   * on the centre line, 1 at the right limit (of the movement direction).
   * The metres follow the local corridor width, see route-corridor.ts: wide
   * on a main road, close to the centre line in an alley, never outside the
   * route cells.
   */
  setLateralFactor(factor: number): void {
    this.lateralFactor = Math.max(-1, Math.min(1, factor));
    // The next position is shifted sideways relative to the previous one.
    this.breakHeadingContinuity();
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

  /** Where across the corridor this enemy walks, see setLateralFactor(). */
  getLateralFactor(): number {
    return this.lateralFactor;
  }

  /**
   * Set the path. Its lengths and lateral limits come from the route
   * profile every enemy on this path shares.
   *
   * `startIndex` and `startProgress` put the enemy part-way along it, on
   * segment `startIndex` at `startProgress` (0-1) of its length, instead of
   * on path[0]: a split child joins where its parent died. The path is not
   * copied, so the child keeps sharing the parent's route profile.
   */
  setPath(path: RouteWaypoint[], startIndex = 0, startProgress = 0): void {
    this.path = path;
    this.profile = getRouteProfile(path);
    this.currentIndex = Math.min(Math.max(0, startIndex), Math.max(0, path.length - 2));
    this.progress = Math.min(Math.max(0, startProgress), 1);
    this.cachedPerpSegIdx = -1;
    this.cachedPerpValid = false;
    this.breakHeadingContinuity();

    // Set initial position, on the centre line like move() before its offset
    const transform = this.transformRef;
    if (transform && path.length > 0) {
      const from = path[this.currentIndex];
      const to = path[this.currentIndex + 1] ?? from;
      const t = this.progress;
      const height =
        from.height !== undefined && to.height !== undefined
          ? from.height + (to.height - from.height) * t
          : from.height;
      transform.setPosition(
        from.lat + (to.lat - from.lat) * t,
        from.lon + (to.lon - from.lon) * t,
        height,
      );
      if (height !== undefined) {
        // Seed only — replaced by the grid read on the first update tick.
        transform.terrainHeight = height;
      }
      // Face along the segment from the start, not only from the first
      // step: an enemy that stands still at first (debug placement, a
      // delayed start) would otherwise show heading 0, north.
      transform.lookAt(to);
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

  /** Get effective speed including any active slow effect at `gameTimeMs`. */
  getEffectiveSpeed(gameTimeMs: number): number {
    return this.speedMps * this.speedMultiplier * this.getSlowMultiplier(gameTimeMs);
  }

  /**
   * Get overall path progress (0 = start, 1 = reached end)
   */
  getPathProgress(): number {
    const { segmentLengths, totalLength } = this.profile;
    if (this.path.length === 0 || segmentLengths.length === 0) {
      return 0;
    }
    if (totalLength === 0) return 1;

    return Math.min(1, this.getDistanceAlongPath() / totalLength);
  }

  /**
   * Distance covered along the path from path[0] (m), on the centre line:
   * the lateral offset does not count.
   */
  getDistanceAlongPath(): number {
    const { segmentLengths, cumulativeLength } = this.profile;
    const segCount = segmentLengths.length;
    if (this.path.length === 0 || segCount === 0) return 0;

    // Completed segments via prefix sum (O(1)); clamp index past the end.
    const idx = this.currentIndex < segCount ? this.currentIndex : segCount;
    let coveredDistance = cumulativeLength[idx];

    // Add progress within current segment
    if (this.currentIndex < segCount) {
      coveredDistance += segmentLengths[this.currentIndex] * this.progress;
    }
    return coveredDistance;
  }

  /**
   * Apply a status effect to this entity.
   *
   * Slow and poison don't stack: one of each can be active, and any new one
   * replaces it regardless of source. Every other type (burn, freeze) is kept
   * per source: the same source refreshes its entry, another source adds one.
   * A replaced entry hands its DoT tick phase to the new one.
   */
  applyStatusEffect(effect: StatusEffect): void {
    const idx = this.findEffectSlot(effect.type, effect.sourceId);
    if (idx < 0) {
      this.statusEffects.push(effect);
      return;
    }
    effect.tickAccumMs = this.statusEffects[idx].tickAccumMs;
    this.statusEffects[idx] = effect;
  }

  /**
   * Same slot rule as applyStatusEffect, but writes into the existing entry
   * instead of replacing it, so a source that re-applies every sub-step (the
   * fire beam) allocates only when the effect starts.
   */
  refreshStatusEffect(
    type: StatusEffectType,
    value: number,
    duration: number,
    startTime: number,
    sourceId: string,
  ): void {
    const idx = this.findEffectSlot(type, sourceId);
    if (idx < 0) {
      this.statusEffects.push({ type, value, duration, startTime, sourceId });
      return;
    }
    const effect = this.statusEffects[idx];
    effect.value = value;
    effect.duration = duration;
    effect.startTime = startTime;
    effect.sourceId = sourceId;
  }

  /** Index of the entry a new effect of `type` from `sourceId` refreshes, or -1. */
  private findEffectSlot(type: StatusEffectType, sourceId: string | undefined): number {
    const bySource = type !== 'slow' && type !== 'poison';
    for (let i = 0; i < this.statusEffects.length; i++) {
      const e = this.statusEffects[i];
      if (e.type === type && (!bySource || e.sourceId === sourceId)) return i;
    }
    return -1;
  }

  /**
   * Single-pass status effect update: removes expired effects in-place
   * and returns the active flags + slow multiplier. A halt (freeze, stun)
   * sets the multiplier to 0 whatever else is active and in whatever order.
   *
   * `gameTimeMs` is the engine's monotonic game-clock (NOT performance.now()).
   * `effect.startTime` is also stored as game-time ms — effect duration is
   * compared in game-time, so it stays constant across all training timescales
   * without any compensation.
   */
  updateStatusEffects(gameTimeMs: number): {
    isSlowed: boolean;
    isPoisoned: boolean;
    isBurning: boolean;
    isFrozen: boolean;
    isStunned: boolean;
    /** No movement, no walk cycle, no walk/run switch this sub-step */
    isHalted: boolean;
    slowMultiplier: number;
  } {
    let writeIdx = 0;
    const result = MovementComponent._statusResult;
    result.isSlowed = false;
    result.isPoisoned = false;
    result.isBurning = false;
    result.isFrozen = false;
    result.isStunned = false;
    result.isHalted = false;
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
          result.isFrozen = true;
          result.isHalted = true;
        } else if (effect.type === 'stun') {
          result.isStunned = true;
          result.isHalted = true;
        } else if (effect.type === 'poison') {
          result.isPoisoned = true;
        } else if (effect.type === 'burn') {
          result.isBurning = true;
        }
      }
    }
    this.statusEffects.length = writeIdx; // In-place compact, no allocation

    if (result.isHalted) result.slowMultiplier = 0;
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
   * Get current slow multiplier (1.0 = no slow, 0 = halted).
   *
   * Mirrors `updateStatusEffects`: the two must not disagree, or the
   * simulation stops the enemy while the renderer keeps its walk cycle
   * running at full speed. A halt wins over a slow in any order.
   */
  getSlowMultiplier(gameTimeMs: number): number {
    let multiplier = 1.0;
    for (const effect of this.statusEffects) {
      if (gameTimeMs - effect.startTime >= effect.duration) continue;
      if (effect.type === 'freeze' || effect.type === 'stun') return 0;
      if (effect.type === 'slow') multiplier = 1 - effect.value;
    }
    return multiplier;
  }

  /** Whether enemy has an active slow effect (the ice tower's; a freeze is no slow). */
  isSlowed(gameTimeMs: number): boolean {
    return this.statusEffects.some(
      (effect) => effect.type === 'slow' && gameTimeMs - effect.startTime < effect.duration,
    );
  }

  /** Whether enemy is frozen solid (freeze). */
  isFrozen(gameTimeMs: number): boolean {
    return this.statusEffects.some(
      (effect) => effect.type === 'freeze' && gameTimeMs - effect.startTime < effect.duration,
    );
  }

  /** Whether enemy is stunned (stun). */
  isStunned(gameTimeMs: number): boolean {
    return this.statusEffects.some(
      (effect) => effect.type === 'stun' && gameTimeMs - effect.startTime < effect.duration,
    );
  }

  /**
   * Whether enemy is halted (freeze or stun): no movement, no walk cycle, no
   * walk/run switch. An enemy that could attack would not attack either.
   */
  isHalted(gameTimeMs: number): boolean {
    return this.statusEffects.some(
      (effect) =>
        (effect.type === 'freeze' || effect.type === 'stun') &&
        gameTimeMs - effect.startTime < effect.duration,
    );
  }

  /** Whether enemy has an active poison effect. */
  isPoisoned(gameTimeMs: number): boolean {
    return this.statusEffects.some(
      (effect) => effect.type === 'poison' && gameTimeMs - effect.startTime < effect.duration,
    );
  }

  /** Whether enemy has an active burn effect. */
  isBurning(gameTimeMs: number): boolean {
    return this.statusEffects.some(
      (effect) => effect.type === 'burn' && gameTimeMs - effect.startTime < effect.duration,
    );
  }

  /**
   * Move along path. `deltaTime` is sub-step game-time ms (~16.67ms).
   * `gameTimeMs` is the engine game-clock used for status-effect lookups.
   * `cachedSlowMult` lets the caller share the slow multiplier across
   * updateStatusEffects + move within the same sub-step (1 iteration).
   */
  move(deltaTime: number, gameTimeMs: number, cachedSlowMult?: number): 'moving' | 'reached_end' {
    if (this.paused) return 'moving';

    // Sub-step is fixed (~16.67ms game-time), so a small constant cap is safe.
    const maxDelta = 100;
    const cappedDelta = Math.min(deltaTime, maxDelta);
    const deltaSeconds = cappedDelta / 1000;

    // Use cached slow multiplier from updateStatusEffects if provided
    const slowMult = cachedSlowMult ?? this.getSlowMultiplier(gameTimeMs);
    return this.advance(this.speedMps * this.speedMultiplier * slowMult * deltaSeconds);
  }

  /**
   * Go `meters` further along the path centre line and place the enemy there,
   * lateral offset and heading included. move() calls it with the distance of
   * one sub-step at the enemy's own speed; a worm segment with the distance
   * its chain puts it at (managers/worm).
   */
  advance(meters: number): 'moving' | 'reached_end' {
    if (this.path.length < 2) return 'moving';

    const transform = this.transformRef;
    if (!transform) return 'moving';

    // Current segment length
    const segmentLength = this.profile.segmentLengths[this.currentIndex] || 1;

    // Update progress based on actual segment length
    this.progress += meters / segmentLength;

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

      // Apply lateral offset perpendicular to movement direction. `piece`
      // says which linear piece of the lateral limit the position is on,
      // for the heading hold below.
      let piece = 0;
      if (this.lateralFactor !== 0) {
        const i = this.currentIndex;
        // Cache the perpendicular per segment (recalc only on segment change).
        // Built in metres (east, north) and turned into degrees per metre,
        // with only the longitude scaled by cos(lat): the offset is a right
        // angle of the stated length on every heading, which the coverage of
        // the route cells relies on.
        if (!this.cachedPerpValid || this.cachedPerpSegIdx !== i) {
          const cosLat = Math.cos(current.lat * DEG_TO_RAD);
          const east = (next.lon - current.lon) * cosLat;
          const north = next.lat - current.lat;
          const len = Math.sqrt(east * east + north * north);
          if (len > 0) {
            this.cachedOffsetLatPerM = -east / len / METERS_PER_DEGREE_LAT;
            this.cachedOffsetLonPerM = north / len / (METERS_PER_DEGREE_LAT * cosLat);
          } else {
            this.cachedOffsetLatPerM = 0;
            this.cachedOffsetLonPerM = 0;
          }
          this.cachedPerpSegIdx = i;
          this.cachedPerpValid = true;
        }

        // Lateral limit here, on the side the enemy walks: the segment's
        // own, or less on the taper towards a narrower stretch before or
        // after it (route-corridor.ts). The offset below points right of
        // the direction of travel, a negative factor to the left.
        const profile = this.profile;
        const side = this.lateralFactor < 0 ? profile.left : profile.right;
        const segLen = profile.segmentLengths[i];
        const s = this.progress * segLen;
        let limit = side.segment[i];
        const entry = side.node[i] + profile.taper * s;
        if (entry < limit) {
          limit = entry;
          piece = 1;
        }
        const exit = side.node[i + 1] + profile.taper * (segLen - s);
        if (exit < limit) {
          limit = exit;
          piece = 2;
        }
        const offsetM = this.lateralFactor * limit;
        newLat += this.cachedOffsetLatPerM * offsetM;
        newLon += this.cachedOffsetLonPerM * offsetM;
      }

      transform.setPosition(newLat, newLon);

      // Height is NOT derived here. Interpolating the path's baked heights
      // was a second ground model beside the route grid, and the stale one:
      // the grid re-samples as tiles refine, the bake never did. EnemyManager
      // reads the grid per frame instead and applies `heightVariationMeters`
      // there, so air units keep their spread without this accumulating it
      // into `terrainHeight` on every step.

      // Update rotation based on actual movement direction (not next waypoint)
      // This prevents sudden heading jumps at segment transitions: the step
      // that crosses a waypoint faces along its chord.
      //
      // Within one piece of a segment that direction is constant: the
      // interpolation runs along one line, the perpendicular is fixed per
      // segment and the lateral limit is linear on each piece (flat, or a
      // taper towards a narrower stretch). So once a step that began and
      // ended on the current piece has set the heading, it is held until the
      // next discontinuity: a waypoint crossing, a taper starting or ending,
      // setPath() or setLateralFactor().
      // Recomputing it every step only produced lat/lon rounding noise
      // (~1e-8 rad), and that noise kept TransformComponent's rotation lerp,
      // which runs only while rotation !== target, busy for every enemy.
      const continuous = this.previousSegIdx === this.currentIndex && this.previousPiece === piece;
      if (!this.headingLocked || !continuous) {
        this.headingLocked = false;
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
            // lookAt() ignores steps under ~1 cm and keeps the old heading,
            // so a crawling enemy does not lock and keeps trying, as before.
            this.headingLocked = transform.lookAt(target) && continuous;
          }
        } else {
          // First step: setPath() already faced along the segment. The start
          // point carries no lateral offset, so this step is no movement
          // direction to take a heading from.
          this.hasMovedOnce = true;
        }
      }

      // Store current position for next frame's direction calculation
      this.previousLat = newLat;
      this.previousLon = newLon;
      this.previousSegIdx = this.currentIndex;
      this.previousPiece = piece;
    }

    return 'moving';
  }

  /**
   * The position was moved by something other than a step along the current
   * segment, so the next step's direction is not the segment's: derive the
   * heading from it again, and hold it only from the step after.
   */
  private breakHeadingContinuity(): void {
    this.previousSegIdx = -1;
    this.headingLocked = false;
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
