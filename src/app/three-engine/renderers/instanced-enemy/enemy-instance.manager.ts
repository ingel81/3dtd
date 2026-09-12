import {
  InstancedMesh,
  InstancedBufferAttribute,
  Material,
  Matrix4,
  Vector3,
  Quaternion,
  Scene,
} from 'three';
import { VATData } from './vat-baker';
import { createVATMaterial } from './vat-material';
import { EnemyTypeConfig } from '../../../configs/enemy-types.config';
import { InstanceSlotAllocator } from '../instance-slot-allocator';
import { DrawGate } from '../draw-gate';

const MAX_INSTANCES_PER_TYPE = 20000;
const UP = new Vector3(0, 1, 0);

/** Per-enemy animation and visual state */
export interface EnemyInstanceState {
  id: string;
  typeId: string;
  index: number; // Instance slot index
  currentAnim: string; // Current animation clip name
  animTime: number; // Accumulated animation time (seconds)
  animSpeed: number; // Playback speed multiplier
  speedMultiplier: number; // From movement (walk/run speed ratio)
  isWalking: boolean;
  isDead: boolean;
  frozen: boolean;
  poisoned: boolean;
  burning: boolean;
  /** performance.now() timestamp when an active hit-flash expires (0 = no flash). */
  hitFlashEnd: number;
  /** Last global VAT frame written to the GPU attr — gate redundant writes/uploads. */
  lastFrame: number;
  /** Cached heading quaternion + the total angle it was built for (skips sin/cos when heading is unchanged). */
  headingQuat?: Quaternion;
  lastTotalHeading?: number;
  config: EnemyTypeConfig;
  /** Pool the slot lives in, so per-frame writers skip the typeId → pool lookup. */
  pool: TypePool;
  /**
   * Set once the slot is freed (removeEnemy / clear); a released state is
   * never reused. Holders of a cached state resolve it again by id.
   */
  released: boolean;
  /** Health-bar slot, set by InstancedEnemyRenderer.create() (-1 = none). */
  healthBarIndex: number;
  // Debug overrides (only set for debug-spawned enemies, undefined in normal gameplay)
  debugScale?: number;
  debugHeightOffset?: number;
  debugRotation?: number;
  debugHealthBarOffset?: number;
}

/** Per-type InstancedMesh pool */
export interface TypePool {
  typeId: string;
  instancedMesh: InstancedMesh;
  vatData: VATData;
  config: EnemyTypeConfig;

  // Instance management
  instances: Map<string, EnemyInstanceState>;
  /** Slot free list; its activeCount is the draw count and upload length. */
  slots: InstanceSlotAllocator;
  /** Hides the mesh while no slot is drawn (R6). */
  gate: DrawGate;

  // Per-instance attributes
  animFrameAttr: InstancedBufferAttribute;
  tintColorAttr: InstancedBufferAttribute;
  opacityAttr: InstancedBufferAttribute;

  // Dirty flags for batched GPU buffer updates (set per-instance, flushed once per frame)
  matrixDirty: boolean;
  tintDirty: boolean;
  animFrameDirty: boolean;
}

// Freeze tint color (light blue)
const FREEZE_TINT_R = 0.4;
const FREEZE_TINT_G = 0.8;
const FREEZE_TINT_B = 1.0;

// Poison tint color (green)
const POISON_TINT_R = 0.2;
const POISON_TINT_G = 0.8;
const POISON_TINT_B = 0.1;

// Burn tint color (orange)
const BURN_TINT_R = 1.0;
const BURN_TINT_G = 0.45;
const BURN_TINT_B = 0.05;

// Hit-flash tint color (electric blue-white, used for lightning chain hits)
const HIT_FLASH_R = 0.85;
const HIT_FLASH_G = 0.95;
const HIT_FLASH_B = 1.0;

/** Pick a death animation: random entry from deathAnimations pool, falling back to deathAnimation. Only returns clips the pool actually baked. */
function pickDeathAnimation(config: EnemyTypeConfig, pool: TypePool): string | undefined {
  const candidates: string[] = [];
  if (config.deathAnimations) {
    for (const name of config.deathAnimations) {
      if (pool.vatData.animations.has(name)) candidates.push(name);
    }
  }
  if (candidates.length > 0) {
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
  if (config.deathAnimation && pool.vatData.animations.has(config.deathAnimation)) {
    return config.deathAnimation;
  }
  return undefined;
}

/**
 * EnemyInstanceManager
 *
 * Manages per-enemy-type InstancedMesh pools with VAT-based animation.
 * Each enemy type gets one InstancedMesh (1 draw call per type).
 *
 * Animation is driven by per-instance `aAnimFrame` attribute that indexes
 * into the VAT DataTexture. Frame computation happens in updateAnimations().
 */
export class EnemyInstanceManager {
  private pools = new Map<string, TypePool>();
  private enemyToType = new Map<string, string>(); // enemyId → typeId
  private cachedAllIds: string[] | null = null; // null-invalidation cache

  /** Instances with a hit-flash running, so expiry skips everyone else. */
  private readonly flashing: EnemyInstanceState[] = [];

  /** setVisible() state, also applied to pools created later. */
  private shown = true;

  // Reusable temp objects
  private readonly matrix = new Matrix4();
  private static readonly _tempQuat = new Quaternion();

  constructor(private readonly scene: Scene) {}

  /**
   * Create a pool for an enemy type with baked VAT data.
   */
  createPool(typeId: string, vatData: VATData, config: EnemyTypeConfig): void {
    if (this.pools.has(typeId)) return;

    const material = createVATMaterial(vatData, {
      emissiveIntensity: config.emissiveIntensity,
      emissiveColor: config.emissiveColor,
      colorMultiplier: config.colorMultiplier,
    });
    const instancedMesh = new InstancedMesh(
      vatData.geometry,
      material,
      MAX_INSTANCES_PER_TYPE,
    );
    instancedMesh.count = 0;
    instancedMesh.frustumCulled = false;

    // Per-instance attributes
    const animFrameData = new Float32Array(MAX_INSTANCES_PER_TYPE);
    const tintColorData = new Float32Array(MAX_INSTANCES_PER_TYPE * 3);
    const opacityData = new Float32Array(MAX_INSTANCES_PER_TYPE);
    // Initialize opacity to 1
    opacityData.fill(1.0);

    const animFrameAttr = new InstancedBufferAttribute(animFrameData, 1);
    const tintColorAttr = new InstancedBufferAttribute(tintColorData, 3);
    const opacityAttr = new InstancedBufferAttribute(opacityData, 1);

    instancedMesh.geometry.setAttribute('aAnimFrame', animFrameAttr);
    instancedMesh.geometry.setAttribute('aTintColor', tintColorAttr);
    instancedMesh.geometry.setAttribute('aOpacity', opacityAttr);

    // count=0 → GPU renders nothing; slots are initialized on first use.
    // The gate keeps the empty mesh out of the render list.
    const gate = new DrawGate([instancedMesh]);
    gate.setShown(this.shown);
    this.scene.add(instancedMesh);

    this.pools.set(typeId, {
      typeId,
      instancedMesh,
      vatData,
      config,
      instances: new Map(),
      slots: new InstanceSlotAllocator(MAX_INSTANCES_PER_TYPE),
      gate,
      animFrameAttr,
      tintColorAttr,
      opacityAttr,
      matrixDirty: false,
      tintDirty: false,
      animFrameDirty: false,
    });
  }

  /**
   * Add an enemy instance. Returns the instance state, or null if the pool
   * doesn't exist or all MAX_INSTANCES_PER_TYPE slots are taken.
   */
  addEnemy(
    id: string,
    typeId: string,
    position: Vector3,
    heading: number,
  ): EnemyInstanceState | null {
    const pool = this.pools.get(typeId);
    if (!pool) return null;
    if (pool.instances.has(id)) return pool.instances.get(id)!;

    // Allocate instance slot
    const index = pool.slots.alloc();
    if (index < 0) return null;
    this.syncDrawCount(pool);

    // Set instance matrix
    this.setInstanceMatrix(pool, index, position, heading);

    // Set initial attributes. Frame and tint go out with the frame flush;
    // opacity has none and queues just this slot (without a range Three.js
    // re-uploads the full MAX-sized buffer).
    pool.animFrameAttr.setX(index, 0);
    pool.tintColorAttr.setXYZ(index, 0, 0, 0);
    pool.opacityAttr.setX(index, 1.0);
    pool.animFrameDirty = true;
    pool.tintDirty = true;
    pool.slots.uploadSlot(pool.opacityAttr, index);

    // Determine initial animation
    const config = pool.config;
    const walkAnim = config.walkAnimation ?? '';
    const initialAnim = pool.vatData.animations.has(walkAnim) ? walkAnim : 'static';

    const state: EnemyInstanceState = {
      id,
      typeId,
      index,
      currentAnim: initialAnim,
      animTime: config.randomAnimationStart ? Math.random() * 2.0 : 0,
      animSpeed: config.animationSpeed ?? 1.0,
      speedMultiplier: 1.0,
      isWalking: true,
      isDead: false,
      frozen: false,
      poisoned: false,
      burning: false,
      hitFlashEnd: 0,
      lastFrame: -1,
      config,
      pool,
      released: false,
      healthBarIndex: -1,
    };

    pool.instances.set(id, state);
    this.enemyToType.set(id, typeId);
    this.cachedAllIds = null;

    return state;
  }

  /**
   * Update an instance's matrix and animation speed. Takes the state (see
   * InstancedEnemyRenderer.resolveSlot) rather than an id: resolving the id
   * cost three string-keyed Map lookups per enemy per frame. The state must
   * not be released.
   */
  updateEnemyState(
    state: EnemyInstanceState,
    position: Vector3,
    heading: number,
    currentSpeed?: number,
  ): void {
    if (state.isDead) return;

    // Update matrix (state passed for debug overrides)
    this.setInstanceMatrix(state.pool, state.index, position, heading, state);

    // Update speed multiplier for animation
    if (currentSpeed !== undefined && state.config.baseSpeed > 0) {
      let effectiveBaseSpeed = state.config.baseSpeed;
      if (!state.isWalking && state.config.runSpeedMultiplier) {
        effectiveBaseSpeed *= state.config.runSpeedMultiplier;
      }
      state.speedMultiplier = currentSpeed / effectiveBaseSpeed;
    }
  }

  /**
   * Set animation to walk
   */
  startWalkAnimation(id: string): void {
    const state = this.getState(id);
    if (!state || state.isDead) return;

    const walkAnim = state.config.walkAnimation;
    if (!walkAnim) return;

    const pool = this.pools.get(state.typeId);
    if (!pool || !pool.vatData.animations.has(walkAnim)) return;

    state.currentAnim = walkAnim;
    state.isWalking = true;
    // Don't reset animTime to preserve continuity
  }

  /**
   * Set animation to run. Visual only: the speed is simulation state
   * (Enemy.rush / Enemy.setRunning), this just shows it.
   */
  startRunAnimation(id: string): void {
    const state = this.getState(id);
    if (!state || state.isDead) return;

    const runAnim = state.config.runAnimation;
    if (!runAnim) return;

    const pool = this.pools.get(state.typeId);
    if (!pool || !pool.vatData.animations.has(runAnim)) return;

    state.currentAnim = runAnim;
    state.isWalking = false;
  }

  /**
   * Set animation to idle
   */
  playIdleAnimation(id: string): void {
    const state = this.getState(id);
    if (!state || state.isDead) return;

    const idleAnim = state.config.idleAnimation;
    if (!idleAnim) return;

    const pool = this.pools.get(state.typeId);
    if (!pool || !pool.vatData.animations.has(idleAnim)) return;

    state.currentAnim = idleAnim;
    state.animTime = 0;
  }

  /**
   * Play death animation (non-looping, clamp at last frame)
   */
  playDeathAnimation(id: string): void {
    const state = this.getState(id);
    if (!state) return;

    state.isDead = true;
    state.animTime = 0;

    const pool = this.pools.get(state.typeId);
    if (!pool) return;

    const pickedDeath = pickDeathAnimation(state.config, pool);
    if (pickedDeath) {
      state.currentAnim = pickedDeath;
    }
  }

  /**
   * Set freeze visual (tint color)
   */
  setFreezeVisual(id: string, active: boolean): void {
    const state = this.getState(id);
    if (!state) return;
    state.frozen = active;
    const pool = this.pools.get(state.typeId);
    if (!pool) return;
    this.applyTint(state, pool);
  }

  setPoisonVisual(id: string, active: boolean): void {
    const state = this.getState(id);
    if (!state) return;
    state.poisoned = active;
    const pool = this.pools.get(state.typeId);
    if (!pool) return;
    this.applyTint(state, pool);
  }

  setBurnVisual(id: string, active: boolean): void {
    const state = this.getState(id);
    if (!state) return;
    state.burning = active;
    const pool = this.pools.get(state.typeId);
    if (!pool) return;
    this.applyTint(state, pool);
  }

  /**
   * Trigger a transient hit-flash on a single enemy (e.g. lightning chain hit).
   * Overrides freeze/poison briefly, then auto-reverts in expireHitFlashes()
   * once `durationMs` has elapsed.
   */
  triggerHitFlash(id: string, durationMs = 130): void {
    const state = this.getState(id);
    if (!state) return;
    if (state.hitFlashEnd === 0) this.flashing.push(state);
    state.hitFlashEnd = performance.now() + durationMs;
    this.applyTint(state, state.pool);
  }

  /**
   * Revert expired hit-flash tints to the persistent one (freeze/poison/none).
   * Once per frame, independent of the animation toggle; walks only the
   * flashing instances, not the pools.
   */
  expireHitFlashes(): void {
    if (this.flashing.length === 0) return;
    const now = performance.now();
    for (let i = this.flashing.length - 1; i >= 0; i--) {
      const state = this.flashing[i];
      if (!state.released && now < state.hitFlashEnd) continue;
      this.flashing[i] = this.flashing[this.flashing.length - 1];
      this.flashing.pop();
      state.hitFlashEnd = 0;
      // A released state's slot may already belong to another enemy.
      if (!state.released) this.applyTint(state, state.pool);
    }
  }

  /**
   * Compute the correct tint colour for an enemy given its state and write
   * it into the instance attribute. Priority: hit-flash > freeze > burn > poison > none.
   */
  private applyTint(state: EnemyInstanceState, pool: TypePool): void {
    if (state.hitFlashEnd > performance.now()) {
      pool.tintColorAttr.setXYZ(state.index, HIT_FLASH_R, HIT_FLASH_G, HIT_FLASH_B);
    } else if (state.frozen) {
      pool.tintColorAttr.setXYZ(state.index, FREEZE_TINT_R, FREEZE_TINT_G, FREEZE_TINT_B);
    } else if (state.burning) {
      pool.tintColorAttr.setXYZ(state.index, BURN_TINT_R, BURN_TINT_G, BURN_TINT_B);
    } else if (state.poisoned) {
      pool.tintColorAttr.setXYZ(state.index, POISON_TINT_R, POISON_TINT_G, POISON_TINT_B);
    } else {
      pool.tintColorAttr.setXYZ(state.index, 0, 0, 0);
    }
    pool.tintDirty = true;
  }

  /**
   * Update all animation frames. Called once per render frame.
   */
  updateAnimations(deltaTime: number): void {
    for (const pool of this.pools.values()) {
      if (pool.instances.size === 0) continue;

      for (const state of pool.instances.values()) {
        const entry = pool.vatData.animations.get(state.currentAnim);
        if (!entry) continue;

        // Advance animation time
        if (!state.isDead) {
          state.animTime += deltaTime * state.animSpeed * state.speedMultiplier;
        } else {
          // Death: advance but will clamp
          state.animTime += deltaTime * state.animSpeed;
        }

        // Compute current frame (totalTime pre-computed on entry)
        let localFrame: number;
        const totalTime = entry.totalTime;

        if (state.isDead) {
          // Clamp at last frame
          const maxFrame = entry.frameCount - 1;
          localFrame = Math.min(
            Math.floor((state.animTime / totalTime) * entry.frameCount),
            maxFrame,
          );
        } else {
          // Loop
          const normalizedTime = (state.animTime / totalTime) % 1.0;
          localFrame = Math.floor(normalizedTime * entry.frameCount) % entry.frameCount;
        }

        const globalFrame = entry.frameStart + localFrame;
        // Only write + flag dirty when the integer frame actually changed.
        // VAT frames are integers, so at 60fps a 30-frame clip changes only
        // ~every 2nd frame (slower clips less often) — when nothing changed,
        // the whole-buffer upload is skipped entirely.
        if (globalFrame !== state.lastFrame) {
          state.lastFrame = globalFrame;
          pool.animFrameAttr.setX(state.index, globalFrame);
          pool.animFrameDirty = true; // uploaded in flushDirtyFlags()
        }
      }
    }
  }

  /**
   * Remove an enemy instance
   */
  removeEnemy(id: string): void {
    const typeId = this.enemyToType.get(id);
    if (!typeId) return;
    const pool = this.pools.get(typeId);
    if (!pool) return;

    const state = pool.instances.get(id);
    if (!state) return;

    // Hide instance (a slot below the top stays inside the draw count).
    // Goes out with the frame flush: a per-slot range here would pile up
    // while nothing renders, and headless training keeps removing enemies.
    this.matrix.makeTranslation(0, -10000, 0);
    pool.instancedMesh.setMatrixAt(state.index, this.matrix);
    pool.matrixDirty = true;

    pool.instances.delete(id);
    pool.slots.release(state.index);
    this.syncDrawCount(pool);
    this.enemyToType.delete(id);
    this.cachedAllIds = null;
    state.released = true;
  }

  /**
   * Check if a type pool exists
   */
  hasPool(typeId: string): boolean {
    return this.pools.has(typeId);
  }

  /**
   * Get instance state
   */
  getState(id: string): EnemyInstanceState | null {
    const typeId = this.enemyToType.get(id);
    if (!typeId) return null;
    const pool = this.pools.get(typeId);
    if (!pool) return null;
    return pool.instances.get(id) ?? null;
  }

  /**
   * Get all instance IDs
   */
  getAllIds(): string[] {
    if (!this.cachedAllIds) {
      this.cachedAllIds = Array.from(this.enemyToType.keys());
    }
    return this.cachedAllIds;
  }

  /**
   * Get total instance count
   */
  get count(): number {
    return this.enemyToType.size;
  }

  /**
   * Set visibility of all instanced enemy meshes
   */
  setVisible(visible: boolean): void {
    this.shown = visible;
    for (const pool of this.pools.values()) {
      pool.gate.setShown(visible);
    }
  }

  /**
   * Clear all instances (keep pools)
   */
  clear(): void {
    for (const pool of this.pools.values()) {
      for (const state of pool.instances.values()) {
        this.matrix.makeTranslation(0, -10000, 0);
        pool.instancedMesh.setMatrixAt(state.index, this.matrix);
        state.released = true;
      }
      // Whole buffer was rewritten — drop any pending per-slot ranges so this
      // really is a full upload and not a partial one covering a few slots.
      pool.instancedMesh.instanceMatrix.clearUpdateRanges();
      pool.instancedMesh.instanceMatrix.needsUpdate = true;
      pool.instances.clear();
      pool.slots.reset();
      this.syncDrawCount(pool);
    }
    this.enemyToType.clear();
    this.cachedAllIds = null;
    this.flashing.length = 0;
  }

  /**
   * Apply debug overrides to an enemy instance (scale, height, rotation, animation speed).
   * Only used by the enemy debugger for live tuning of a single enemy.
   */
  applyDebugOverrides(id: string, overrides: {
    scale?: number;
    heightOffset?: number;
    healthBarOffset?: number;
    rotation?: number;
    animationSpeed?: number;
  }): void {
    const state = this.getState(id);
    if (!state) return;

    if (overrides.scale !== undefined) state.debugScale = overrides.scale;
    if (overrides.heightOffset !== undefined) state.debugHeightOffset = overrides.heightOffset;
    if (overrides.rotation !== undefined) state.debugRotation = overrides.rotation;
    if (overrides.healthBarOffset !== undefined) state.debugHealthBarOffset = overrides.healthBarOffset;
    if (overrides.animationSpeed !== undefined) state.animSpeed = overrides.animationSpeed;
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.clear();
    for (const pool of this.pools.values()) {
      this.scene.remove(pool.instancedMesh);
      pool.instancedMesh.geometry.dispose();
      (pool.instancedMesh.material as Material).dispose();
      pool.vatData.positionTexture.dispose();
    }
    this.pools.clear();
  }

  // =====================================================
  // PRIVATE
  // =====================================================

  /** Draw count follows the slot allocator; the gate hides an empty pool. */
  private syncDrawCount(pool: TypePool): void {
    pool.instancedMesh.count = pool.slots.activeCount;
    pool.gate.setCount(pool.slots.activeCount);
  }

  private setInstanceMatrix(
    pool: TypePool,
    index: number,
    position: Vector3,
    heading: number,
    state?: EnemyInstanceState,
  ): void {
    const configOffset = pool.config.headingOffset ?? 0;
    const rotationOffset = state?.debugRotation ?? 0;
    const totalHeading = heading + configOffset + rotationOffset;
    // Position changes every frame (enemy moving) so compose() always runs, but
    // the rotation quaternion only needs rebuilding (sin/cos) when the heading
    // actually changed — cache it per instance.
    let quat: Quaternion;
    if (state) {
      if (!state.headingQuat) state.headingQuat = new Quaternion();
      if (state.lastTotalHeading !== totalHeading) {
        state.headingQuat.setFromAxisAngle(UP, totalHeading);
        state.lastTotalHeading = totalHeading;
      }
      quat = state.headingQuat;
    } else {
      quat = EnemyInstanceManager._tempQuat.setFromAxisAngle(UP, totalHeading);
    }

    const scale = state?.debugScale ?? pool.config.scale;

    // Apply debug height offset if present
    let py = position.y;
    if (state?.debugHeightOffset !== undefined) {
      const heightDelta = state.debugHeightOffset - pool.config.heightOffset;
      py += heightDelta;
    }

    // Matrix4.compose() + setMatrixAt(), written straight into the instance
    // buffer: the same arithmetic in the same order as three r186's compose
    // (with the uniform scale on all three axes), so the stored floats are
    // identical, minus the intermediate Matrix4 and its 16-element copy.
    const qx = quat.x, qy = quat.y, qz = quat.z, qw = quat.w;
    const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
    const xx = qx * x2, xy = qx * y2, xz = qx * z2;
    const yy = qy * y2, yz = qy * z2, zz = qz * z2;
    const wx = qw * x2, wy = qw * y2, wz = qw * z2;

    const te = pool.instancedMesh.instanceMatrix.array as Float32Array;
    const o = index * 16;
    te[o] = (1 - (yy + zz)) * scale;
    te[o + 1] = (xy + wz) * scale;
    te[o + 2] = (xz - wy) * scale;
    te[o + 3] = 0;
    te[o + 4] = (xy - wz) * scale;
    te[o + 5] = (1 - (xx + zz)) * scale;
    te[o + 6] = (yz + wx) * scale;
    te[o + 7] = 0;
    te[o + 8] = (xz + wy) * scale;
    te[o + 9] = (yz - wx) * scale;
    te[o + 10] = (1 - (xx + yy)) * scale;
    te[o + 11] = 0;
    te[o + 12] = position.x;
    te[o + 13] = py;
    te[o + 14] = position.z;
    te[o + 15] = 1;
    pool.matrixDirty = true;
  }

  /**
   * Flush all dirty GPU buffer flags. Call once per frame after all updates.
   */
  flushDirtyFlags(): void {
    for (const pool of this.pools.values()) {
      // (0, activeCount) covers every drawn slot. Clearing first drops the
      // range of a flush the renderer never uploaded (e.g. mesh toggled
      // invisible), so the ranges array cannot grow. Without a range
      // Three.js would upload the full MAX_INSTANCES_PER_TYPE-sized buffer.
      // activeCount 0 means every slot was released since the write and
      // nothing is drawn. No range then: bufferSubData reads a length of 0
      // as "up to the end", so (0, 0) would upload the whole buffer.
      const activeCount = pool.slots.activeCount;
      if (pool.matrixDirty) {
        if (activeCount > 0) {
          pool.instancedMesh.instanceMatrix.clearUpdateRanges();
          pool.instancedMesh.instanceMatrix.addUpdateRange(0, activeCount * 16);
          pool.instancedMesh.instanceMatrix.needsUpdate = true;
        }
        pool.matrixDirty = false;
      }
      if (pool.tintDirty) {
        if (activeCount > 0) {
          pool.tintColorAttr.clearUpdateRanges();
          pool.tintColorAttr.addUpdateRange(0, activeCount * 3);
          pool.tintColorAttr.needsUpdate = true;
        }
        pool.tintDirty = false;
      }
      if (pool.animFrameDirty) {
        if (activeCount > 0) {
          pool.animFrameAttr.clearUpdateRanges();
          pool.animFrameAttr.addUpdateRange(0, activeCount);
          pool.animFrameAttr.needsUpdate = true;
        }
        pool.animFrameDirty = false;
      }
    }
  }
}
