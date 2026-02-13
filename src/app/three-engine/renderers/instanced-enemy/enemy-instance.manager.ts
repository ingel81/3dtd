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
import { EnemyTypeConfig } from '../../../models/enemy-types';

const MAX_INSTANCES_PER_TYPE = 512;
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
  config: EnemyTypeConfig;
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
}

// Freeze tint color (light blue)
const FREEZE_TINT_R = 0.4;
const FREEZE_TINT_G = 0.8;
const FREEZE_TINT_B = 1.0;

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

  // Reusable temp objects
  private readonly matrix = new Matrix4();
  private static readonly _tempQuat = new Quaternion();
  private static readonly _tempScale = new Vector3();

  constructor(private readonly scene: Scene) {}

  /**
   * Create a pool for an enemy type with baked VAT data.
   */
  createPool(typeId: string, vatData: VATData, config: EnemyTypeConfig): void {
    if (this.pools.has(typeId)) return;

    const material = createVATMaterial(vatData);
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

    // Hide all slots initially
    for (let i = 0; i < MAX_INSTANCES_PER_TYPE; i++) {
      this.matrix.makeTranslation(0, -10000, 0);
      instancedMesh.setMatrixAt(i, this.matrix);
    }

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
    pool.tintColorAttr.needsUpdate = true;
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
      config,
    };

    pool.instances.set(id, state);
    this.enemyToType.set(id, typeId);

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

    // Update matrix
    this.setInstanceMatrix(pool, state.index, position, heading);

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

    if (active) {
      pool.tintColorAttr.setXYZ(state.index, FREEZE_TINT_R, FREEZE_TINT_G, FREEZE_TINT_B);
    } else {
      pool.tintColorAttr.setXYZ(state.index, 0, 0, 0);
    }
    pool.tintColorAttr.needsUpdate = true;
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
    for (const pool of this.pools.values()) {
      if (pool.instances.size === 0) continue;

      let framesDirty = false;

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

        // Compute current frame
        let localFrame: number;
        const totalTime = entry.frameCount / pool.vatData.fps;

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
    return Array.from(this.enemyToType.keys());
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
  ): void {
    const configOffset = pool.config.headingOffset ?? 0;
    EnemyInstanceManager._tempQuat.setFromAxisAngle(UP, heading + configOffset);

    const scale = pool.config.scale;
    EnemyInstanceManager._tempScale.set(scale, scale, scale);
    this.matrix.compose(
      position,
      EnemyInstanceManager._tempQuat,
      EnemyInstanceManager._tempScale,
    );
    pool.instancedMesh.setMatrixAt(index, this.matrix);
    pool.instancedMesh.instanceMatrix.needsUpdate = true;
  }
}
