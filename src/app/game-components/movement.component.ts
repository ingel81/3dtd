import { Component, ComponentType } from '../core/component';
import { GameObject } from '../core/game-object';
import { GeoPosition, RouteWaypoint } from '../models/game.types';
import { StatusEffect, StatusEffectType } from '../models/status-effects';
import { TransformComponent } from './transform.component';
import { METERS_PER_DEGREE_LAT, DEG_TO_RAD } from '../utils/geo-utils';
import { RouteProfile, SideLimits, getRouteProfile } from '../utils/route-corridor';
import type { RouteCorners } from '../utils/route-corners';

/** What updateStatusEffects() reports for one enemy and sub-step. */
export interface StatusFlags {
  isSlowed: boolean;
  isPoisoned: boolean;
  isBurning: boolean;
  isFrozen: boolean;
  isStunned: boolean;
  /** No movement, no walk cycle, no walk/run switch this sub-step */
  isHalted: boolean;
  slowMultiplier: number;
}

/** The piece of the path place() reports on a corner's arc, see the heading hold in advance(). */
const ARC_PIECE = 3;

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
   * Segment lengths, their prefix sums, the lateral limits and the corner
   * arcs of `path`, computed once per path and shared by every enemy
   * walking it (getRouteProfile). The prefix sums let getPathProgress run
   * O(1) instead of summing completed segments every call (it's hit per
   * candidate in 'first'-strategy targeting).
   */
  private profile: RouteProfile = getRouteProfile(this.path);
  /** The profile's corner arcs, null without `roundsCorners`. */
  private corners: RouteCorners | null = null;
  /**
   * Per segment, the metres from its start and before its end that lie on a
   * corner's arc (RouteCorners.arcIn, arcOut): all 0 without `roundsCorners`.
   */
  private arcIn: Float64Array = new Float64Array(0);
  private arcOut: Float64Array = new Float64Array(0);
  /**
   * The lateral limits on the side of the lateral factor (right for 0): of
   * the sharp route, and with the corners rounded per waypoint and where
   * the straight part of each segment starts and ends (ArcLimits; without
   * `roundsCorners` the sharp route's at the waypoints). Chosen by setPath()
   * and setLateralFactor().
   */
  private laneSide: SideLimits = this.profile.right;
  private laneSign = 1;
  private laneArc: Float64Array = this.profile.right.node;
  private laneEntry: Float64Array = this.profile.right.node;
  private laneExit: Float64Array = this.profile.right.node;
  paused = false;

  // Status effects (slow, freeze, etc.). Written only by applyStatusEffect,
  // refreshStatusEffect, updateStatusEffects and removeExpiredEffects, which
  // keep hasStatusEffects in step.
  statusEffects: StatusEffect[] = [];
  /**
   * `statusEffects.length !== 0`, kept on the component so the checks that
   * run per enemy every sub-step and every frame do not load the array.
   * Almost no enemy carries an effect, and the array is an object of its own
   * that cost a memory access per enemy each time.
   */
  hasStatusEffects = false;

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

  // Where place() put the enemy, and on a corner's arc the direction it
  // faces there, degrees per metre
  private placedLat = 0;
  private placedLon = 0;
  private facingLat = 0;
  private facingLon = 0;

  // Reusable lookAt target (avoid object literal allocation per frame)
  private static readonly _lookAtTarget: GeoPosition = { lat: 0, lon: 0 };

  /** updateStatusEffects() for an enemy without effects; never written. */
  static readonly NO_STATUS: Readonly<StatusFlags> = {
    isSlowed: false,
    isPoisoned: false,
    isBurning: false,
    isFrozen: false,
    isStunned: false,
    isHalted: false,
    slowMultiplier: 1.0,
  };

  // Reusable status result object (avoid per-enemy allocation in updateStatusEffects)
  private static readonly _statusResult: StatusFlags = {
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

  /**
   * @param roundsCorners Walk the corners of the path on arcs
   *   (RouteCorners). The hero does not: he re-plans from the nearest point
   *   of the route graph every quarter second, and a position on an arc
   *   would snap back to the sharp line each time.
   */
  constructor(
    gameObject: GameObject,
    readonly roundsCorners = true,
  ) {
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
    this.chooseLane();
    // The next position is shifted sideways relative to the previous one.
    this.breakHeadingContinuity();
  }

  /** The lateral limits of the side the lateral factor puts the enemy on, see `laneSide`. */
  private chooseLane(): void {
    const right = this.lateralFactor >= 0;
    const side = right ? this.profile.right : this.profile.left;
    this.laneSide = side;
    this.laneSign = right ? 1 : -1;
    if (this.corners) {
      const limits = right ? this.corners.right : this.corners.left;
      this.laneArc = limits.arc;
      this.laneEntry = limits.entry;
      this.laneExit = limits.exit;
    } else {
      this.laneArc = side.node;
      this.laneEntry = side.node;
      this.laneExit = side.node.subarray(1);
    }
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
   * Set the path. Its lengths, lateral limits and corner arcs come from the
   * route profile every enemy on this path shares.
   *
   * `startIndex` and `startProgress` put the enemy part-way along it, on
   * segment `startIndex` at `startProgress` (0-1) of its length, instead of
   * on path[0]: a split child joins where its parent died. The path is not
   * copied, so the child keeps sharing the parent's route profile. The
   * enemy stands where advance() would put it there, on a corner's arc
   * inside one, in the lane of its lateral factor (0 for a new enemy).
   */
  setPath(path: RouteWaypoint[], startIndex = 0, startProgress = 0): void {
    this.path = path;
    this.profile = getRouteProfile(path);
    this.corners = this.roundsCorners ? this.profile.corners : null;
    if (this.corners) {
      this.arcIn = this.corners.arcIn;
      this.arcOut = this.corners.arcOut;
    } else {
      this.arcIn = this.arcOut = new Float64Array(path.length);
    }
    this.chooseLane();
    this.currentIndex = Math.min(Math.max(0, startIndex), Math.max(0, path.length - 2));
    this.progress = Math.min(Math.max(0, startProgress), 1);
    this.cachedPerpSegIdx = -1;
    this.cachedPerpValid = false;
    this.breakHeadingContinuity();

    const transform = this.transformRef;
    if (transform && path.length > 0) {
      const from = path[this.currentIndex];
      const to = path[this.currentIndex + 1] ?? from;
      const t = this.progress;
      const height =
        from.height !== undefined && to.height !== undefined
          ? from.height + (to.height - from.height) * t
          : from.height;
      let lat = from.lat;
      let lon = from.lon;
      let onArc = false;
      if (path.length > 1) {
        onArc = this.place() === ARC_PIECE;
        lat = this.placedLat;
        lon = this.placedLon;
      }
      transform.setPosition(lat, lon, height);
      if (height !== undefined) {
        // Seed only — replaced by the grid read on the first update tick.
        transform.terrainHeight = height;
      }
      // Face along the path from the start, not only from the first step:
      // an enemy that stands still at first (debug placement, a delayed
      // start) would otherwise show heading 0, north.
      const target = MovementComponent._lookAtTarget;
      target.lat = lat + (onArc ? this.facingLat : to.lat - from.lat);
      target.lon = lon + (onArc ? this.facingLon : to.lon - from.lon);
      transform.lookAt(target);
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
      this.hasStatusEffects = true;
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
      this.hasStatusEffects = true;
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
  updateStatusEffects(gameTimeMs: number): StatusFlags {
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
    // In-place compact, no allocation. Written only when an effect expired;
    // almost every call has nothing to change.
    if (writeIdx !== this.statusEffects.length) this.statusEffects.length = writeIdx;
    this.hasStatusEffects = writeIdx !== 0;

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
    this.hasStatusEffects = writeIdx !== 0;
  }

  /**
   * Get current slow multiplier (1.0 = no slow, 0 = halted).
   *
   * Mirrors `updateStatusEffects`: the two must not disagree, or the
   * simulation stops the enemy while the renderer keeps its walk cycle
   * running at full speed. A halt wins over a slow in any order.
   */
  getSlowMultiplier(gameTimeMs: number): number {
    // presentFrame asks for every enemy every frame; almost none has an effect
    if (!this.hasStatusEffects) return 1.0;
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
   * one sub-step at the enemy's own speed.
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

    // Past the end of the path (a body still flowing into the base, see
    // OozeBodies): nothing to place
    if (this.currentIndex >= this.path.length - 1) return 'moving';

    const piece = this.place();
    const newLat = this.placedLat;
    const newLon = this.placedLon;
    transform.setPosition(newLat, newLon);

    // Height is NOT derived here. Interpolating the path's baked heights
    // was a second ground model beside the route grid, and the stale one:
    // the grid re-samples as tiles refine, the bake never did. EnemyManager
    // reads the grid per frame instead and applies `heightVariationMeters`
    // there, so air units keep their spread without this accumulating it
    // into `terrainHeight` on every step.

    if (piece === ARC_PIECE) {
      // On a corner's arc the direction turns with every step: face along
      // the arc, also in a lane that turns on the spot and shows no step.
      const target = MovementComponent._lookAtTarget;
      target.lat = newLat + this.facingLat;
      target.lon = newLon + this.facingLon;
      transform.lookAt(target);
      this.headingLocked = false;
      this.hasMovedOnce = true;
    } else {
      // Update rotation based on actual movement direction (not next
      // waypoint): the step that comes off an arc or crosses a sharp
      // waypoint faces along its chord.
      //
      // Within one piece of a segment that direction is constant: the
      // interpolation runs along one line, the perpendicular is fixed per
      // segment and the lateral limit is linear on each piece (flat, or a
      // taper towards a narrower stretch). So once a step that began and
      // ended on the current piece has set the heading, it is held until the
      // next discontinuity: a waypoint crossing, the end of an arc, a taper
      // starting or ending, setPath() or setLateralFactor().
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
    }

    // Store current position for next frame's direction calculation
    this.previousLat = newLat;
    this.previousLon = newLon;
    this.previousSegIdx = this.currentIndex;
    this.previousPiece = piece;

    return 'moving';
  }

  /**
   * Where the enemy stands at its segment and progress, into `placedLat`
   * and `placedLon`: on the centre line, or on the arc of a corner
   * (RouteCorners), moved across by its lateral factor times the lateral
   * limit there. Returns the piece of the path that is, for the heading
   * hold in advance(): 0 where the limit is flat, 1 and 2 on the taper from
   * the arc or waypoint before or after, ARC_PIECE on an arc, with the
   * direction along it in `facingLat` and `facingLon`.
   */
  private place(): number {
    const i = this.currentIndex;
    const current = this.path[i];
    const next = this.path[i + 1];
    const profile = this.profile;
    const segLen = profile.segmentLengths[i];
    const s = this.progress * segLen;

    // The arc of the waypoint at either end of the segment, where the
    // progress lies on its stretch
    const before = this.arcIn[i];
    const after = this.arcOut[i];
    if (s < before) return this.placeOnArc(i, i, s);
    if (segLen - s < after) return this.placeOnArc(i + 1, i, s);

    let lat = current.lat + (next.lat - current.lat) * this.progress;
    let lon = current.lon + (next.lon - current.lon) * this.progress;

    // Apply lateral offset perpendicular to movement direction. `piece`
    // says which linear piece of the lateral limit the position is on.
    let piece = 0;
    if (this.lateralFactor !== 0) {
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
      // own, or less on the taper from the arc or waypoint before or after
      // it towards a narrower stretch (route-corridor.ts). The offset below
      // points right of the direction of travel, a negative factor to the
      // left.
      let limit = this.laneSide.segment[i];
      const entry = this.laneEntry[i] + profile.taper * (s - before);
      if (entry < limit) {
        limit = entry;
        piece = 1;
      }
      const exit = this.laneExit[i] + profile.taper * (segLen - after - s);
      if (exit < limit) {
        limit = exit;
        piece = 2;
      }
      const offsetM = this.lateralFactor * limit;
      lat += this.cachedOffsetLatPerM * offsetM;
      lon += this.cachedOffsetLonPerM * offsetM;
    }

    this.placedLat = lat;
    this.placedLon = lon;
    return piece;
  }

  /**
   * place() on the arc waypoint `k` lies on, `s` m into segment `i`. The
   * progress over the arc's stretch maps linearly onto its angle. The lane
   * keeps the lateral limit at its place along the route, as on a straight
   * stretch (ArcLimits), at most the arc's cap on its side
   * (RouteCorners.capLeft, capRight) and less its shave there, and runs about
   * the arc's centre, `inside` m further in than the centre line. It faces
   * along the arc: a lane moving in or out as its limit changes would turn
   * the heading by up to a right angle where it barely goes round.
   */
  private placeOnArc(k: number, i: number, s: number): number {
    const profile = this.profile;
    const corners = this.corners!;
    const arc = corners.arcOf[k];
    const from = corners.from[arc];
    const radius = corners.radius[arc];
    const phi = ((profile.cumulativeLength[i] + s - from) * corners.turn[arc]) / (corners.to[arc] - from);
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);

    // Offset towards the inside
    let inside = 0;
    if (this.lateralFactor !== 0) {
      const taper = profile.taper;
      const segLen = profile.segmentLengths[i];
      // The limit from the places on this segment it is known at: its
      // waypoints and where its straight part starts and ends
      let limit = Math.min(
        this.laneSide.segment[i],
        this.laneArc[i] + taper * s,
        this.laneArc[i + 1] + taper * (segLen - s),
        this.laneEntry[i] + taper * Math.abs(s - Math.min(this.arcIn[i], segLen)),
        this.laneExit[i] + taper * Math.abs(s - Math.max(0, segLen - this.arcOut[i])),
        // The arc's cap on this side: its radius on the inside, where a
        // lane further in would run backwards
        this.laneSign > 0 ? corners.capRight[arc] : corners.capLeft[arc],
      );
      // Less its shave, rising from the arc's ends by the taper
      const shave = this.laneSign > 0 ? corners.shaveRight[arc] : corners.shaveLeft[arc];
      if (shave > 0) {
        const along = profile.cumulativeLength[i] + s;
        limit -= Math.min(shave, taper * Math.max(0, Math.min(along - from, corners.to[arc] - along)));
      }
      inside = this.lateralFactor * corners.inside[arc] * Math.max(0, limit);
    }
    // From where the arc starts: along the segment into its first waypoint
    // and towards the inside of the turn
    const r = radius - inside;
    const alongLat = corners.alongLat[arc];
    const alongLon = corners.alongLon[arc];
    const insideLat = corners.insideLat[arc];
    const insideLon = corners.insideLon[arc];
    this.placedLat = corners.startLat[arc] + alongLat * r * sin + insideLat * (radius - r * cos);
    this.placedLon = corners.startLon[arc] + alongLon * r * sin + insideLon * (radius - r * cos);
    this.facingLat = alongLat * cos + insideLat * sin;
    this.facingLon = alongLon * cos + insideLon * sin;
    return ARC_PIECE;
  }

  /**
   * Put the enemy `distance` m along the path centre line, forward from where
   * it is: segment and progress only, nothing is placed. For an enemy its
   * owner places itself, a worm segment (managers/worm/worm-path.ts). Unlike
   * advance() the progress is measured on the segment it ends on, so the
   * distance comes out exact across waypoints of any length.
   */
  seekDistance(distance: number): 'moving' | 'reached_end' {
    const { segmentLengths, cumulativeLength } = this.profile;
    const segCount = segmentLengths.length;
    if (segCount === 0) return 'moving';
    let i = this.currentIndex;
    while (i < segCount && distance >= cumulativeLength[i + 1]) i++;
    if (i !== this.currentIndex) this.cachedPerpValid = false;
    this.currentIndex = i;
    if (i >= segCount) {
      this.progress = 0;
      return 'reached_end';
    }
    this.progress = segmentLengths[i] > 0 ? (distance - cumulativeLength[i]) / segmentLengths[i] : 0;
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

  update(_deltaTime: number): void {
    // Movement is triggered explicitly via move() method
  }
}
