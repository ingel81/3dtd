import * as THREE from 'three';

/**
 * Decal instance data
 */
export interface DecalInstance {
  id: string;
  index: number;
  spawnTime: number;
  fadeStartTime: number;
  fadeDuration: number;
  active: boolean;
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
  private freeIndices: number[] = [];
  private activeCount = 0;
  private readonly matrix = new THREE.Matrix4();

  // Per-instance attributes
  private colorAttribute: THREE.InstancedBufferAttribute;
  private opacityAttribute: THREE.InstancedBufferAttribute;
  private variationAttribute: THREE.InstancedBufferAttribute;

  // Reusable vectors
  private static readonly _tempPos = new THREE.Vector3();
  private static readonly _tempRot = new THREE.Quaternion();
  private static readonly _tempScale = new THREE.Vector3();

  constructor(
    geometry: THREE.BufferGeometry,
    material: THREE.ShaderMaterial,
    maxCount: number
  ) {
    this.instancedMesh = new THREE.InstancedMesh(geometry, material, maxCount);
    this.instancedMesh.count = 0;
    this.instancedMesh.frustumCulled = false;
    this.instancedMesh.renderOrder = 999; // Render after 3D tiles

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
   * Add a new decal instance
   */
  add(
    id: string,
    position: THREE.Vector3,
    size: number,
    rotation: number,
    color: THREE.Color,
    opacity: number,
    spawnTime: number,
    fadeDelay: number,
    fadeDuration: number
  ): void {
    if (this.instances.has(id)) return;

    let index: number;
    if (this.freeIndices.length > 0) {
      index = this.freeIndices.pop()!;
    } else {
      index = this.activeCount;
    }

    const instance: DecalInstance = {
      id,
      index,
      spawnTime,
      fadeStartTime: spawnTime + fadeDelay,
      fadeDuration,
      active: true,
    };

    this.instances.set(id, instance);
    this.activeCount = Math.max(this.activeCount, index + 1);
    this.instancedMesh.count = this.activeCount;

    // Set matrix (position, rotation, scale)
    DecalInstanceManager._tempPos.copy(position);
    DecalInstanceManager._tempRot.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation);
    DecalInstanceManager._tempScale.set(size, size, 1);

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
    this.variationAttribute.setX(index, Math.random());
    this.variationAttribute.needsUpdate = true;
  }

  /**
   * Update decal opacity (for fade animation)
   */
  updateOpacity(id: string, opacity: number): void {
    const instance = this.instances.get(id);
    if (!instance) return;

    this.opacityAttribute.setX(instance.index, opacity);
    this.opacityAttribute.needsUpdate = true;
  }

  /**
   * Get instance by ID
   */
  getInstance(id: string): DecalInstance | undefined {
    return this.instances.get(id);
  }

  /**
   * Get all active instances
   */
  getAllInstances(): DecalInstance[] {
    return Array.from(this.instances.values());
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

    // Mark as inactive
    instance.active = false;

    this.instances.delete(id);
    this.freeIndices.push(instance.index);
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
    this.freeIndices = [];
    this.activeCount = 0;
    this.instancedMesh.count = 0;
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
