import { Component, ComponentType } from '../core/component';
import { GameObject } from '../core/game-object';
import { GeoPosition } from '../models/game.types';
import { StatusEffect } from '../models/status-effects';
import { TransformComponent } from './transform.component';
import { movementStore } from './movement-soa.store';

/**
 * MovementComponent handles path-following movement.
 *
 * The per-entity movement scalars (progress, speed, lateral offset, …) and
 * the flattened path live in {@link movementStore}'s typed arrays — this
 * component is a thin view over its slot there, keeping the object API for
 * everything that addresses enemies as objects (combat, targeting, events,
 * tests) while the hot loop advances all slots in one batch pass.
 *
 * Status effects stay here as plain objects: per-enemy arrays that are
 * usually empty and not part of the hot loop.
 */
export class MovementComponent extends Component {
  /** Slot index in the shared movement store. */
  readonly slot: number;

  // Original path array — kept by reference for API/debug readers
  // (wave-manager diagnostics, tests). The hot loop reads the flattened
  // copy in the store instead.
  private _path: GeoPosition[] = [];

  // Status effects (slow, freeze, etc.)
  statusEffects: StatusEffect[] = [];

  // Height variation for air units (persistent offset per enemy) — read by
  // EnemyManager's ground-height pass, not by the movement hot loop.
  private heightVariationMeters = 0;

  // Reusable status result object (avoid per-enemy allocation in updateStatusEffects)
  private static readonly _statusResult = { isSlowed: false, isPoisoned: false, slowMultiplier: 1.0 };

  // Cached transform — resolved lazily so the component stays constructible
  // before a transform exists.
  private _transform: TransformComponent | null = null;

  private _slotFreed = false;

  constructor(gameObject: GameObject) {
    super(gameObject);
    this.slot = movementStore.allocSlot();
  }

  private get transformRef(): TransformComponent | null {
    return (this._transform ??= this.gameObject.getComponent<TransformComponent>(
      ComponentType.TRANSFORM,
    ));
  }

  // --- Store-backed fields (public API unchanged) ---

  get speedMps(): number {
    return movementStore.speedMps[this.slot];
  }
  set speedMps(value: number) {
    if (this._slotFreed) return;
    movementStore.speedMps[this.slot] = value;
  }

  get speedMultiplier(): number {
    return movementStore.speedMultiplier[this.slot];
  }
  set speedMultiplier(value: number) {
    if (this._slotFreed) return;
    movementStore.speedMultiplier[this.slot] = value;
  }

  get currentIndex(): number {
    return movementStore.currentIndex[this.slot];
  }
  set currentIndex(value: number) {
    movementStore.currentIndex[this.slot] = value;
  }

  get progress(): number {
    return movementStore.progress[this.slot];
  }
  set progress(value: number) {
    movementStore.progress[this.slot] = value;
  }

  get paused(): boolean {
    return movementStore.isPaused(this.slot);
  }

  get path(): GeoPosition[] {
    return this._path;
  }

  /**
   * Set lateral offset in meters (positive = right, negative = left of path)
   */
  setLateralOffset(offsetMeters: number): void {
    if (this._slotFreed) return;
    movementStore.lateralOffset[this.slot] = offsetMeters;
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
   * Set the path. The store flattens it into typed arrays (interned — all
   * entities on the same route share one flat copy) and precomputes segment
   * lengths; the source array is treated as immutable from here on.
   */
  setPath(path: GeoPosition[]): void {
    if (this._slotFreed) return;
    this._path = path;
    movementStore.setPath(this.slot, movementStore.flattenPath(path));

    // Set initial position
    const transform = this.transformRef;
    movementStore.transforms[this.slot] = transform;
    if (transform && path.length > 0) {
      transform.setPosition(path[0].lat, path[0].lon, path[0].height);
      if (path[0].height !== undefined) {
        // Seed only — replaced by the grid read on the first update tick.
        transform.terrainHeight = path[0].height;
      }
    }
  }

  /**
   * Pause movement
   */
  pause(): void {
    if (this._slotFreed) return;
    movementStore.setPaused(this.slot, true);
  }

  /**
   * Resume movement
   */
  resume(): void {
    if (this._slotFreed) return;
    movementStore.setPaused(this.slot, false);
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
    return movementStore.getPathProgress(this.slot);
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
          result.isSlowed = true;
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

  /** Get current slow multiplier (1.0 = no slow). */
  getSlowMultiplier(gameTimeMs: number): number {
    for (const effect of this.statusEffects) {
      if (effect.type === 'slow' && gameTimeMs - effect.startTime < effect.duration) {
        return 1 - effect.value;
      }
    }
    return 1.0;
  }

  /** Whether enemy has an active slow effect. */
  isSlowed(gameTimeMs: number): boolean {
    return this.statusEffects.some(
      (effect) => effect.type === 'slow' && gameTimeMs - effect.startTime < effect.duration,
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
   *
   * Thin wrapper over the store's advanceSlot — EnemyManager advances all
   * enemies through the batch pass instead; this stays for everything that
   * moves a single entity (tests, potential scripted movers).
   */
  move(deltaTime: number, gameTimeMs: number, cachedSlowMult?: number): 'moving' | 'reached_end' {
    if (this._slotFreed) return 'moving';
    const slowMult = cachedSlowMult ?? this.getSlowMultiplier(gameTimeMs);
    return movementStore.advanceSlot(this.slot, deltaTime, slowMult) === 1
      ? 'reached_end'
      : 'moving';
  }

  /**
   * Get current segment
   */
  getCurrentSegment(): { from: GeoPosition; to: GeoPosition } | null {
    const idx = this.currentIndex;
    if (idx >= this._path.length - 1) return null;
    return {
      from: this._path[idx],
      to: this._path[idx + 1],
    };
  }


  /**
   * Get next waypoint
   */
  getNextWaypoint(): GeoPosition | null {
    const idx = this.currentIndex;
    if (idx + 1 >= this._path.length) return null;
    return this._path[idx + 1];
  }

  update(_deltaTime: number): void {
    // Movement is triggered explicitly via move() method
  }

  override onDestroy(): void {
    if (!this._slotFreed) {
      this._slotFreed = true;
      movementStore.freeSlot(this.slot);
    }
  }
}
