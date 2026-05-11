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
  /** performance.now() timestamp when an active hit-flash expires (0 = no flash). */
  hitFlashEnd: number;
  config: EnemyTypeConfig;
  // Debug overrides (only set for debug-spawned enemies, undefined in normal gameplay)
  debugScale?: number;
  debugHeightOffset?: number;
  debugRotation?: number;
  debugHealthBarOffset?: number;
}

/** Per-type InstancedMesh pool */
interface TypePool {
  typeId: string;
  instancedMesh: InstancedMesh;
  vatData: VATData;
  config: EnemyTypeConfig;

  // Instance management
  instances: Map<string, EnemyInstanceState>;
  freeIndices: number[];
  activeCount: number;

  // Per-instance attributes
  animFrameAttr: InstancedBufferAttribute;
  tintColorAttr: InstancedBufferAttribute;
  opacityAttr: InstancedBufferAttribute;

  // Dirty flags for batched GPU buffer updates (set per-instance, flushed once per frame)
  matrixDirty: boolean;
  tintDirty: boolean;
}

// Freeze tint color (light blue)
const FREEZE_TINT_R = 0.4;
const FREEZE_TINT_G = 0.8;
const FREEZE_TINT_B = 1.0;

// Poison tint color (green)
const POISON_TINT_R = 0.2;
const POISON_TINT_G = 0.8;
const POISON_TINT_B = 0.1;

// Hit-flash tint color (electric blue-white, used for lightning chain hits)
const HIT_FLASH_R = 0.85;
const HIT_FLASH_G = 0.95;
const HIT_FLASH_B = 1.0;

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

  // Reusable temp objects
  private readonly matrix = new Matrix4();
  private static readonly _tempQuat = new Quaternion();
  private static readonly _tempScale = new Vector3();
  private static readonly _tempPos = new Vector3();

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

    // count=0 → GPU renders nothing; slots are initialized on first use
    this.scene.add(instancedMesh);

    this.pools.set(typeId, {
      typeId,
      instancedMesh,
      vatData,
      config,
      instances: new Map(),
      freeIndices: [],
      activeCount: 0,
      animFrameAttr,
      tintColorAttr,
      opacityAttr,
      matrixDirty: false,
      tintDirty: false,
    });
  }

  /**
   * Add an enemy instance. Returns the instance state or null if pool doesn't exist.
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
    let index: number;
    if (pool.freeIndices.length > 0) {
      index = pool.freeIndices.pop()!;
    } else {
      index = pool.activeCount;
    }

    pool.activeCount = Math.max(pool.activeCount, index + 1);
    pool.instancedMesh.count = pool.activeCount;

    // Set instance matrix
    this.setInstanceMatrix(pool, index, position, heading);

    // Set initial attributes
    pool.animFrameAttr.setX(index, 0);
    pool.tintColorAttr.setXYZ(index, 0, 0, 0);
    pool.opacityAttr.setX(index, 1.0);
    pool.animFrameAttr.needsUpdate = true;
    pool.tintDirty = true;
    pool.opacityAttr.needsUpdate = true;

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
      hitFlashEnd: 0,
      config,
    };

    pool.instances.set(id, state);
    this.enemyToType.set(id, typeId);
    this.cachedAllIds = null;

    return state;
  }

  /**
   * Update enemy position, rotation, and health.
   */
  updateEnemy(
    id: string,
    position: Vector3,
    heading: number,
    currentSpeed?: number,
  ): void {
    const typeId = this.enemyToType.get(id);
    if (!typeId) return;
    const pool = this.pools.get(typeId);
    if (!pool) return;
    const state = pool.instances.get(id);
    if (!state || state.isDead) return;

    // Update matrix (state passed for debug overrides)
    this.setInstanceMatrix(pool, state.index, position, heading, state);

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
   * Set animation to run
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

    const deathAnim = state.config.deathAnimation;
    if (deathAnim) {
      const pool = this.pools.get(state.typeId);
      if (pool && pool.vatData.animations.has(deathAnim)) {
        state.currentAnim = deathAnim;
      }
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

  /**
   * Trigger a transient hit-flash on a single enemy (e.g. lightning chain hit).
   * Overrides freeze/poison briefly, then auto-reverts in updateAnimations()
   * once `durationMs` has elapsed.
   */
  triggerHitFlash(id: string, durationMs = 130): void {
    const state = this.getState(id);
    if (!state) return;
    state.hitFlashEnd = performance.now() + durationMs;
    const pool = this.pools.get(state.typeId);
    if (!pool) return;
    this.applyTint(state, pool);
  }

  /**
   * Compute the correct tint colour for an enemy given its state and write
   * it into the instance attribute. Priority: hit-flash > freeze > poison > none.
   */
  private applyTint(state: EnemyInstanceState, pool: TypePool): void {
    if (state.hitFlashEnd > performance.now()) {
      pool.tintColorAttr.setXYZ(state.index, HIT_FLASH_R, HIT_FLASH_G, HIT_FLASH_B);
    } else if (state.frozen) {
      pool.tintColorAttr.setXYZ(state.index, FREEZE_TINT_R, FREEZE_TINT_G, FREEZE_TINT_B);
    } else if (state.poisoned) {
      pool.tintColorAttr.setXYZ(state.index, POISON_TINT_R, POISON_TINT_G, POISON_TINT_B);
    } else {
      pool.tintColorAttr.setXYZ(state.index, 0, 0, 0);
    }
    pool.tintDirty = true;
  }

  /**
   * Get speed multiplier (walk vs run)
   */
  getSpeedMultiplier(id: string): number {
    const state = this.getState(id);
    if (!state) return 1.0;
    if (!state.isWalking && state.config.runSpeedMultiplier) {
      return state.config.runSpeedMultiplier;
    }
    return 1.0;
  }

  /**
   * Update all animation frames. Called once per render frame.
   */
  updateAnimations(deltaTime: number): void {
    const now = performance.now();
    for (const pool of this.pools.values()) {
      if (pool.instances.size === 0) continue;

      let framesDirty = false;

      for (const state of pool.instances.values()) {
        // Expire hit-flash tints: clear the flag and recompute the persistent
        // tint (freeze/poison/none) so per-frame state stays consistent.
        if (state.hitFlashEnd > 0 && now >= state.hitFlashEnd) {
          state.hitFlashEnd = 0;
          this.applyTint(state, pool);
        }

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
        pool.animFrameAttr.setX(state.index, globalFrame);
        framesDirty = true;
      }

      if (framesDirty) {
        pool.animFrameAttr.needsUpdate = true;
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

    // Hide instance
    this.matrix.makeTranslation(0, -10000, 0);
    pool.instancedMesh.setMatrixAt(state.index, this.matrix);
    pool.instancedMesh.instanceMatrix.needsUpdate = true;

    pool.instances.delete(id);
    pool.freeIndices.push(state.index);
    this.enemyToType.delete(id);
    this.cachedAllIds = null;
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
    for (const pool of this.pools.values()) {
      pool.instancedMesh.visible = visible;
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
      }
      pool.instancedMesh.instanceMatrix.needsUpdate = true;
      pool.instances.clear();
      pool.freeIndices = [];
      pool.activeCount = 0;
      pool.instancedMesh.count = 0;
    }
    this.enemyToType.clear();
    this.cachedAllIds = null;
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

  private setInstanceMatrix(
    pool: TypePool,
    index: number,
    position: Vector3,
    heading: number,
    state?: EnemyInstanceState,
  ): void {
    const configOffset = pool.config.headingOffset ?? 0;
    const rotationOffset = state?.debugRotation ?? 0;
    EnemyInstanceManager._tempQuat.setFromAxisAngle(UP, heading + configOffset + rotationOffset);

    const scale = state?.debugScale ?? pool.config.scale;
    EnemyInstanceManager._tempScale.set(scale, scale, scale);

    // Apply debug height offset if present
    if (state?.debugHeightOffset !== undefined) {
      const heightDelta = state.debugHeightOffset - pool.config.heightOffset;
      EnemyInstanceManager._tempPos.copy(position);
      EnemyInstanceManager._tempPos.y += heightDelta;
      this.matrix.compose(
        EnemyInstanceManager._tempPos,
        EnemyInstanceManager._tempQuat,
        EnemyInstanceManager._tempScale,
      );
    } else {
      this.matrix.compose(
        position,
        EnemyInstanceManager._tempQuat,
        EnemyInstanceManager._tempScale,
      );
    }
    pool.instancedMesh.setMatrixAt(index, this.matrix);
    pool.matrixDirty = true;
  }

  /**
   * Flush all dirty GPU buffer flags. Call once per frame after all updates.
   */
  flushDirtyFlags(): void {
    for (const pool of this.pools.values()) {
      if (pool.matrixDirty) {
        pool.instancedMesh.instanceMatrix.needsUpdate = true;
        pool.matrixDirty = false;
      }
      if (pool.tintDirty) {
        pool.tintColorAttr.needsUpdate = true;
        pool.tintDirty = false;
      }
    }
  }
}
