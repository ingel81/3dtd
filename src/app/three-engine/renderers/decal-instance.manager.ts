import * as THREE from 'three';
import { InstanceSlotAllocator } from './instance-slot-allocator';
import { DrawGate } from './draw-gate';

/**
 * Decal instance data
 */
export interface DecalInstance {
  id: string;
  index: number;
  spawnTime: number;
  fadeStartTime: number;
  fadeDuration: number;
  /** Opacity the decal was added with, the fade runs from here to 0 */
  baseOpacity: number;
}

/**
 * DecalInstanceManager - Manages instanced decals with custom shader
 *
 * Features:
 * - GPU instancing (1 draw call for all decals)
 * - Per-instance color, opacity, size, rotation
 * - Logarithmic depth buffer support (correct occlusion with 3D tiles)
 * - Procedural noise variation for organic look
 */
export class DecalInstanceManager {
  readonly instancedMesh: THREE.InstancedMesh;
  private instances = new Map<string, DecalInstance>();
  private readonly slots: InstanceSlotAllocator;
  /** Hides the mesh while no decal is placed (R6). */
  private readonly gate: DrawGate;
  private readonly matrix = new THREE.Matrix4();

  /**
   * Earliest fade start of a decal that is not fading yet, updateFades() has
   * nothing to do before it. Removing a decal leaves it where it is: a bound
   * that is too early costs one loop that finds nothing, never a missed fade.
   */
  private nextFadeStart = Infinity;

  // Per-instance attributes
  private colorAttribute: THREE.InstancedBufferAttribute;
  private opacityAttribute: THREE.InstancedBufferAttribute;
  private variationAttribute: THREE.InstancedBufferAttribute;

  // Reusable vectors
  private static readonly _tempPos = new THREE.Vector3();
  private static readonly _tempRot = new THREE.Quaternion();
  private static readonly _tempScale = new THREE.Vector3();
  private static readonly _up = new THREE.Vector3(0, 1, 0);

  constructor(
    geometry: THREE.BufferGeometry,
    material: THREE.ShaderMaterial,
    maxCount: number
  ) {
    this.instancedMesh = new THREE.InstancedMesh(geometry, material, maxCount);
    this.instancedMesh.count = 0;
    this.instancedMesh.frustumCulled = false;
    this.instancedMesh.renderOrder = 999; // Render after 3D tiles
    this.slots = new InstanceSlotAllocator(maxCount);
    this.gate = new DrawGate([this.instancedMesh]);

    // Create per-instance attributes
    const colors = new Float32Array(maxCount * 3); // RGB
    const opacities = new Float32Array(maxCount); // Alpha
    const variations = new Float32Array(maxCount); // Noise seed for variation

    this.colorAttribute = new THREE.InstancedBufferAttribute(colors, 3);
    this.opacityAttribute = new THREE.InstancedBufferAttribute(opacities, 1);
    this.variationAttribute = new THREE.InstancedBufferAttribute(variations, 1);

    this.instancedMesh.geometry.setAttribute('instanceColor', this.colorAttribute);
    this.instancedMesh.geometry.setAttribute('instanceOpacity', this.opacityAttribute);
    this.instancedMesh.geometry.setAttribute('instanceVariation', this.variationAttribute);
  }

  /**
   * Add a new decal instance, round with the given radius: the flat quad
   * spans ±1 before scaling. Until 2026-09-12 the Z axis stayed at 1, so
   * every decal was a 2*size by 2 m oval. `stretch` draws it that many
   * times as long along its own X axis (turned by `rotation`), `variation`
   * seeds the shader's pattern.
   */
  add(
    id: string,
    position: THREE.Vector3,
    radius: number,
    rotation: number,
    color: THREE.Color,
    opacity: number,
    spawnTime: number,
    fadeDelay: number,
    fadeDuration: number,
    stretch = 1,
    variation = Math.random()
  ): void {
    if (this.instances.has(id)) return;

    // Callers evict the oldest decal before adding to a full pool.
    const index = this.slots.alloc();
    if (index < 0) return;

    const instance: DecalInstance = {
      id,
      index,
      spawnTime,
      fadeStartTime: spawnTime + fadeDelay,
      fadeDuration,
      baseOpacity: opacity,
    };

    this.instances.set(id, instance);
    this.syncDrawCount();
    this.nextFadeStart = Math.min(this.nextFadeStart, instance.fadeStartTime);

    // Set matrix (position, rotation, scale)
    DecalInstanceManager._tempPos.copy(position);
    DecalInstanceManager._tempRot.setFromAxisAngle(DecalInstanceManager._up, rotation);
    DecalInstanceManager._tempScale.set(radius * stretch, radius, radius);

    this.matrix.compose(
      DecalInstanceManager._tempPos,
      DecalInstanceManager._tempRot,
      DecalInstanceManager._tempScale
    );
    this.instancedMesh.setMatrixAt(index, this.matrix);
    this.instancedMesh.instanceMatrix.needsUpdate = true;

    // Set per-instance color
    this.colorAttribute.setXYZ(index, color.r, color.g, color.b);
    this.colorAttribute.needsUpdate = true;

    // Set per-instance opacity
    this.opacityAttribute.setX(index, opacity);
    this.opacityAttribute.needsUpdate = true;

    // Set per-instance variation (random seed for shader noise)
    this.variationAttribute.setX(index, variation);
    this.variationAttribute.needsUpdate = true;
  }

  /**
   * Fade decals out once their delay has run and remove them when they are
   * gone. Call once per frame. Decals spend most of their life waiting for
   * the fade, so nothing is walked before the earliest fade start.
   */
  updateFades(now: number): void {
    if (now < this.nextFadeStart) return;

    let nextFadeStart = Infinity;
    for (const instance of this.instances.values()) {
      const elapsed = now - instance.fadeStartTime;
      if (elapsed <= 0) {
        nextFadeStart = Math.min(nextFadeStart, instance.fadeStartTime);
        continue;
      }

      const fadeProgress = Math.min(elapsed / instance.fadeDuration, 1);
      if (fadeProgress >= 1) {
        // Deleting the current entry while iterating a Map is safe.
        this.remove(instance.id);
        continue;
      }

      this.opacityAttribute.setX(instance.index, instance.baseOpacity * (1 - fadeProgress));
      this.opacityAttribute.needsUpdate = true;
      // Still fading, run again next frame. Waiting decals start at now or later.
      nextFadeStart = now;
    }
    this.nextFadeStart = nextFadeStart;
  }

  /**
   * Make an existing decal darker and young again: its opacity rises by
   * `step` from what it shows now (a fading decal counts at its faded
   * value), capped at `max`, and its fade starts over `fadeDelay` from `now`.
   *
   * @returns false when there is no decal with that ID
   */
  reinforce(id: string, step: number, max: number, now: number, fadeDelay: number): boolean {
    const instance = this.instances.get(id);
    if (!instance) return false;

    const elapsed = now - instance.fadeStartTime;
    const shown = elapsed > 0
      ? instance.baseOpacity * (1 - Math.min(elapsed / instance.fadeDuration, 1))
      : instance.baseOpacity;
    instance.baseOpacity = Math.min(max, shown + step);
    instance.spawnTime = now;
    instance.fadeStartTime = now + fadeDelay;
    this.nextFadeStart = Math.min(this.nextFadeStart, instance.fadeStartTime);

    this.opacityAttribute.setX(instance.index, instance.baseOpacity);
    this.opacityAttribute.needsUpdate = true;
    return true;
  }

  /**
   * Get instance by ID
   */
  getInstance(id: string): DecalInstance | undefined {
    return this.instances.get(id);
  }

  /**
   * Remove the decal whose fade starts first, so a full pool has room for
   * add(): in a pool whose decals share one fade delay the oldest, a
   * reinforced one counting from its reinforcement. Walks the Map, no array
   * copy.
   */
  removeNextToFade(): void {
    let next: DecalInstance | undefined;
    for (const instance of this.instances.values()) {
      if (!next || instance.fadeStartTime < next.fadeStartTime) next = instance;
    }
    if (next) this.remove(next.id);
  }

  /**
   * Remove a decal instance
   */
  remove(id: string): void {
    const instance = this.instances.get(id);
    if (!instance) return;

    // Hide by moving to infinity
    this.matrix.makeTranslation(0, -10000, 0);
    this.instancedMesh.setMatrixAt(instance.index, this.matrix);
    this.instancedMesh.instanceMatrix.needsUpdate = true;

    this.instances.delete(id);
    this.slots.release(instance.index);
    this.syncDrawCount();
  }

  /**
   * Get count of active instances
   */
  get count(): number {
    return this.instances.size;
  }

  /**
   * Clear all instances
   */
  clear(): void {
    for (const id of this.instances.keys()) {
      this.remove(id);
    }
    this.instances.clear();
    this.slots.reset();
    this.syncDrawCount();
    this.nextFadeStart = Infinity;
  }

  /** Draw count follows the slot allocator; the gate hides an empty pool. */
  private syncDrawCount(): void {
    this.instancedMesh.count = this.slots.activeCount;
    this.gate.setCount(this.slots.activeCount);
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.clear();
    this.instancedMesh.geometry.dispose();
    (this.instancedMesh.material as THREE.Material).dispose();
  }
}
