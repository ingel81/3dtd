import { GeoPosition } from '../models/game.types';
import { TransformComponent } from './transform.component';
import { haversineDistance, METERS_PER_DEGREE_LAT, DEG_TO_RAD } from '../utils/geo-utils';

/**
 * A path flattened into typed arrays for the movement hot loop.
 *
 * Waypoint lat/lon are Float64 — these are geo degrees, where Float32's
 * ~7 significant digits would lose metres. Segment lengths and the total
 * are plain doubles from haversineDistance, kept as Float64 so movement
 * math is bit-identical to the old per-object implementation.
 */
export interface FlatPath {
  readonly lat: Float64Array;
  readonly lon: Float64Array;
  /** Segment lengths in meters; length = count - 1 (empty for count < 2). */
  readonly segLen: Float64Array;
  /** Sum of all segment lengths. */
  readonly total: number;
  /** Number of waypoints. */
  readonly count: number;
}

/** Bit flags for MovementSoaStore.flags. */
const enum MoveFlag {
  Paused = 1,
  HasMovedOnce = 2,
  PerpValid = 4,
}

/**
 * Structure-of-Arrays store for path-following movement state.
 *
 * Movement is the hottest per-enemy loop in the game (13k+ enemies at 3
 * sub-steps per frame). As object fields, each move touched half a dozen
 * scattered heap objects — enemy, movement component, path array, two
 * GeoPositions, segment-length array. Here the per-entity scalars live in
 * parallel typed arrays addressed by a slot index, and paths are flattened
 * once into typed arrays that all entities on the same route share, so a
 * batch pass streams through contiguous memory instead of chasing pointers.
 *
 * MovementComponent stays the public API — it is a thin view over its slot.
 * Status effects remain objects on the component; they are usually-empty
 * per-enemy arrays and not part of the hot loop.
 *
 * Slots are recycled through a free list (same pattern as
 * EnemyInstanceManager's pool). freeSlot() nulls the object references so a
 * dead entity's path/transform are not retained.
 */
export class MovementSoaStore {
  private capacity = 256;

  progress = new Float64Array(this.capacity);
  currentIndex = new Int32Array(this.capacity);
  speedMps = new Float64Array(this.capacity);
  speedMultiplier = new Float64Array(this.capacity);
  lateralOffset = new Float64Array(this.capacity);
  prevLat = new Float64Array(this.capacity);
  prevLon = new Float64Array(this.capacity);
  flags = new Uint8Array(this.capacity);

  // Per-segment perpendicular cache (recomputed only on segment change)
  private perpLat = new Float64Array(this.capacity);
  private perpLon = new Float64Array(this.capacity);
  private perpSegIdx = new Int32Array(this.capacity);
  private metersPerDegree = new Float64Array(this.capacity);

  /** Slow multiplier for the current sub-step, written by the caller before advanceBatch(). */
  slowMult = new Float64Array(this.capacity);
  /** Result of the last advance per slot: 0 = moving, 1 = reached end. */
  moveResult = new Uint8Array(this.capacity);

  paths: (FlatPath | null)[] = new Array<FlatPath | null>(this.capacity).fill(null);
  transforms: (TransformComponent | null)[] = new Array<TransformComponent | null>(
    this.capacity,
  ).fill(null);

  private freeList: number[] = [];
  private nextSlot = 0;

  // Flattened paths are interned per source array: every enemy of a wave
  // walks the same cached route object, so they all share one FlatPath.
  private flatPathCache = new WeakMap<GeoPosition[], FlatPath>();

  // Reusable lookAt target (avoid object literal allocation per step)
  private static readonly _lookAtTarget: GeoPosition = { lat: 0, lon: 0 };

  allocSlot(): number {
    const slot = this.freeList.pop() ?? this.nextSlot++;
    if (slot >= this.capacity) this.grow();
    this.progress[slot] = 0;
    this.currentIndex[slot] = 0;
    this.speedMps[slot] = 0;
    this.speedMultiplier[slot] = 1.0;
    this.lateralOffset[slot] = 0;
    this.prevLat[slot] = 0;
    this.prevLon[slot] = 0;
    this.flags[slot] = 0;
    this.perpSegIdx[slot] = -1;
    this.metersPerDegree[slot] = METERS_PER_DEGREE_LAT;
    this.slowMult[slot] = 1.0;
    this.moveResult[slot] = 0;
    this.paths[slot] = null;
    this.transforms[slot] = null;
    return slot;
  }

  freeSlot(slot: number): void {
    this.paths[slot] = null;
    this.transforms[slot] = null;
    this.freeList.push(slot);
  }

  private grow(): void {
    const old = {
      progress: this.progress,
      currentIndex: this.currentIndex,
      speedMps: this.speedMps,
      speedMultiplier: this.speedMultiplier,
      lateralOffset: this.lateralOffset,
      prevLat: this.prevLat,
      prevLon: this.prevLon,
      flags: this.flags,
      perpLat: this.perpLat,
      perpLon: this.perpLon,
      perpSegIdx: this.perpSegIdx,
      metersPerDegree: this.metersPerDegree,
      slowMult: this.slowMult,
      moveResult: this.moveResult,
    };
    this.capacity *= 2;
    this.progress = new Float64Array(this.capacity);
    this.progress.set(old.progress);
    this.currentIndex = new Int32Array(this.capacity);
    this.currentIndex.set(old.currentIndex);
    this.speedMps = new Float64Array(this.capacity);
    this.speedMps.set(old.speedMps);
    this.speedMultiplier = new Float64Array(this.capacity);
    this.speedMultiplier.set(old.speedMultiplier);
    this.lateralOffset = new Float64Array(this.capacity);
    this.lateralOffset.set(old.lateralOffset);
    this.prevLat = new Float64Array(this.capacity);
    this.prevLat.set(old.prevLat);
    this.prevLon = new Float64Array(this.capacity);
    this.prevLon.set(old.prevLon);
    this.flags = new Uint8Array(this.capacity);
    this.flags.set(old.flags);
    this.perpLat = new Float64Array(this.capacity);
    this.perpLat.set(old.perpLat);
    this.perpLon = new Float64Array(this.capacity);
    this.perpLon.set(old.perpLon);
    this.perpSegIdx = new Int32Array(this.capacity);
    this.perpSegIdx.set(old.perpSegIdx);
    this.metersPerDegree = new Float64Array(this.capacity);
    this.metersPerDegree.set(old.metersPerDegree);
    this.slowMult = new Float64Array(this.capacity);
    this.slowMult.set(old.slowMult);
    this.moveResult = new Uint8Array(this.capacity);
    this.moveResult.set(old.moveResult);
    this.paths.length = this.capacity;
    this.paths.fill(null, this.capacity / 2);
    this.transforms.length = this.capacity;
    this.transforms.fill(null, this.capacity / 2);
  }

  /**
   * Flatten (and intern) a path. Coordinates are copied once at set time —
   * the source array is treated as immutable afterwards, which the old code
   * already half-assumed by precomputing segment lengths up front.
   */
  flattenPath(path: GeoPosition[]): FlatPath {
    let flat = this.flatPathCache.get(path);
    if (flat) return flat;

    const count = path.length;
    const lat = new Float64Array(count);
    const lon = new Float64Array(count);
    const segLen = new Float64Array(Math.max(0, count - 1));
    let total = 0;
    for (let i = 0; i < count; i++) {
      lat[i] = path[i].lat;
      lon[i] = path[i].lon;
    }
    for (let i = 0; i < count - 1; i++) {
      const dist = haversineDistance(lat[i], lon[i], lat[i + 1], lon[i + 1]);
      segLen[i] = dist;
      total += dist;
    }
    flat = { lat, lon, segLen, total, count };
    this.flatPathCache.set(path, flat);
    return flat;
  }

  /** Assign a flattened path to a slot and reset its along-path state. */
  setPath(slot: number, flat: FlatPath): void {
    this.paths[slot] = flat;
    this.currentIndex[slot] = 0;
    this.progress[slot] = 0;
    this.perpSegIdx[slot] = -1;
    this.flags[slot] &= ~MoveFlag.PerpValid;
  }

  setPaused(slot: number, paused: boolean): void {
    if (paused) this.flags[slot] |= MoveFlag.Paused;
    else this.flags[slot] &= ~MoveFlag.Paused;
  }

  isPaused(slot: number): boolean {
    return (this.flags[slot] & MoveFlag.Paused) !== 0;
  }

  /**
   * Advance every slot in `slots[0..count)` by one sub-step, reading the
   * per-slot slow multiplier from `slowMult` and writing the outcome to
   * `moveResult`. This is the batch loop the SoA layout exists for: one
   * monomorphic call per slot into contiguous arrays, no component dispatch.
   */
  advanceBatch(slots: ArrayLike<number>, count: number, deltaMs: number): void {
    for (let i = 0; i < count; i++) {
      const slot = slots[i];
      this.moveResult[slot] = this.advanceSlot(slot, deltaMs, this.slowMult[slot]);
    }
  }

  /**
   * Advance one slot along its path. Returns 0 (moving) or 1 (reached end).
   * Single implementation of the movement math — the batch pass and
   * MovementComponent.move() both land here.
   */
  advanceSlot(slot: number, deltaMs: number, slowMult: number): 0 | 1 {
    const fp = this.paths[slot];
    if ((this.flags[slot] & MoveFlag.Paused) !== 0 || fp === null || fp.count < 2) return 0;

    const transform = this.transforms[slot];
    if (transform === null) return 0;

    // Sub-step is fixed (~16.67ms game-time), so a small constant cap is safe.
    const cappedDelta = deltaMs > 100 ? 100 : deltaMs;
    const metersThisFrame =
      this.speedMps[slot] * this.speedMultiplier[slot] * slowMult * (cappedDelta / 1000);

    let idx = this.currentIndex[slot];
    let progress = this.progress[slot];
    const segLen = fp.segLen;

    // Update progress based on actual segment length
    progress += metersThisFrame / (segLen[idx] || 1);

    // Handle segment transitions, keeping overflow for smooth movement
    while (progress >= 1) {
      progress -= 1;
      idx++;
      this.flags[slot] &= ~MoveFlag.PerpValid; // Invalidate cached perpendicular

      if (idx >= fp.count - 1) {
        this.currentIndex[slot] = idx;
        this.progress[slot] = progress;
        return 1;
      }
    }
    this.currentIndex[slot] = idx;
    this.progress[slot] = progress;

    // Defensive: a slot whose index already sits on the last waypoint (move
    // called again after 'reached_end') has no segment to interpolate — the
    // old code fell through its `if (current && next)` guard here.
    if (idx + 1 >= fp.count) return 0;

    // Interpolate position
    const lat0 = fp.lat[idx];
    const lon0 = fp.lon[idx];
    const lat1 = fp.lat[idx + 1];
    const lon1 = fp.lon[idx + 1];
    let newLat = lat0 + (lat1 - lat0) * progress;
    let newLon = lon0 + (lon1 - lon0) * progress;

    // Apply lateral offset perpendicular to movement direction
    const lateral = this.lateralOffset[slot];
    if (lateral !== 0) {
      // Cache perpendicular vector per segment (recalc only on segment change)
      if ((this.flags[slot] & MoveFlag.PerpValid) === 0 || this.perpSegIdx[slot] !== idx) {
        const dLat = lat1 - lat0;
        const dLon = lon1 - lon0;
        const lenSq = dLat * dLat + dLon * dLon;
        if (lenSq > 0) {
          const len = Math.sqrt(lenSq);
          this.perpLat[slot] = -dLon / len;
          this.perpLon[slot] = dLat / len;
        } else {
          this.perpLat[slot] = 0;
          this.perpLon[slot] = 0;
        }
        // Cache metersPerDegree at segment start (varies <0.01% within a segment)
        this.metersPerDegree[slot] = METERS_PER_DEGREE_LAT * Math.cos(newLat * DEG_TO_RAD);
        this.perpSegIdx[slot] = idx;
        this.flags[slot] |= MoveFlag.PerpValid;
      }
      const perpLat = this.perpLat[slot];
      const perpLon = this.perpLon[slot];
      if (perpLat !== 0 || perpLon !== 0) {
        const offsetDegrees = lateral / this.metersPerDegree[slot];
        newLat += perpLat * offsetDegrees;
        newLon += perpLon * offsetDegrees;
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
    const target = MovementSoaStore._lookAtTarget;
    if ((this.flags[slot] & MoveFlag.HasMovedOnce) !== 0) {
      const dLat = newLat - this.prevLat[slot];
      const dLon = newLon - this.prevLon[slot];
      // Use squared distance to avoid sqrt (only checking threshold)
      const moveDistSq = dLat * dLat + dLon * dLon;
      if (moveDistSq > 1e-14) {
        target.lat = newLat + dLat;
        target.lon = newLon + dLon;
        transform.lookAt(target);
      }
    } else {
      // First frame: look at next waypoint
      target.lat = lat1;
      target.lon = lon1;
      transform.lookAt(target);
      this.flags[slot] |= MoveFlag.HasMovedOnce;
    }

    // Store current position for next step's direction calculation
    this.prevLat[slot] = newLat;
    this.prevLon[slot] = newLon;

    return 0;
  }

  /** Overall path progress for a slot (0 = start, 1 = reached end). */
  getPathProgress(slot: number): number {
    const fp = this.paths[slot];
    if (fp === null || fp.count === 0 || fp.segLen.length === 0) return 0;
    if (fp.total === 0) return 1;

    const idx = this.currentIndex[slot];
    let coveredDistance = 0;
    for (let i = 0; i < idx && i < fp.segLen.length; i++) {
      coveredDistance += fp.segLen[i];
    }
    if (idx < fp.segLen.length) {
      coveredDistance += fp.segLen[idx] * this.progress[slot];
    }
    return Math.min(1, coveredDistance / fp.total);
  }
}

/**
 * Shared store instance. MovementComponent allocates its slot here; the
 * EnemyManager batch pass advances all enemy slots against the same arrays.
 * Module-scoped on purpose — components are constructed outside DI.
 */
export const movementStore = new MovementSoaStore();
