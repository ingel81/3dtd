import {
  InstancedMesh,
  InstancedBufferAttribute,
  PlaneGeometry,
  ShaderMaterial,
  Matrix4,
  Camera,
  Scene,
} from 'three';
import { FloatingTextAtlas, AtlasSlot } from './floating-text-atlas';
import { createFloatingTextMaterial } from './floating-text-material';
import { CoordinateSync } from '../index';

const MAX_INSTANCES = 2048;
const SWEEP_INTERVAL = 0.25; // seconds between expiration sweeps

export interface FloatingTextSpawnConfig {
  color?: string;
  fontSize?: number;
  duration?: number;       // ms
  floatSpeed?: number;
  scale?: number;
  outlineColor?: string;
  outlineWidth?: number;
  /** Screen-right spawn offset in world units (negative = left). Used to split overlapping popup categories. */
  lateralOffset?: number;
  /** Screen-right drift in world units per second (negative = left). Fans popups out diagonally over their lifetime. */
  lateralDrift?: number;
}

interface ActiveInstance {
  atlasSlot: AtlasSlot;
  expiresAt: number; // seconds
}

/**
 * GPU-instanced floating text manager.
 *
 * Renders all floating texts in 1 draw call using InstancedMesh + a shared texture atlas.
 * Text strings are cached in the atlas — identical text+color combos reuse the same slot.
 * Animation (float-up, scale, fade) runs entirely on the GPU via the shader.
 * JS only updates 3 uniforms per frame + periodic sweep for slot reclamation.
 */
export class FloatingTextInstanceManager {
  private readonly instancedMesh: InstancedMesh;
  private readonly atlas: FloatingTextAtlas;
  private readonly material: ShaderMaterial;

  // Instance tracking
  private activeInstances = new Map<number, ActiveInstance>();
  private freeIndices: number[] = [];
  private maxUsedIndex = 0;

  // Per-instance attribute buffers
  private atlasRectAttr!: InstancedBufferAttribute;
  private startTimeAttr!: InstancedBufferAttribute;
  private durationAttr!: InstancedBufferAttribute;
  private floatSpeedAttr!: InstancedBufferAttribute;
  private baseScaleAttr!: InstancedBufferAttribute;
  private lateralOffsetAttr!: InstancedBufferAttribute;
  private lateralDriftAttr!: InstancedBufferAttribute;

  // Reusable temp
  private readonly tempMatrix = new Matrix4();

  // Sweep timing
  private lastSweepTime = 0;

  constructor(
    private readonly scene: Scene,
    private readonly sync: CoordinateSync,
  ) {
    this.atlas = new FloatingTextAtlas();
    this.material = createFloatingTextMaterial(this.atlas.texture);

    const geometry = new PlaneGeometry(1, 1);

    // Create per-instance attribute buffers
    this.atlasRectAttr = new InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 4), 4);
    this.startTimeAttr = new InstancedBufferAttribute(new Float32Array(MAX_INSTANCES), 1);
    this.durationAttr = new InstancedBufferAttribute(new Float32Array(MAX_INSTANCES), 1);
    this.floatSpeedAttr = new InstancedBufferAttribute(new Float32Array(MAX_INSTANCES), 1);
    this.baseScaleAttr = new InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 2), 2);
    this.lateralOffsetAttr = new InstancedBufferAttribute(new Float32Array(MAX_INSTANCES), 1);
    this.lateralDriftAttr = new InstancedBufferAttribute(new Float32Array(MAX_INSTANCES), 1);

    geometry.setAttribute('aAtlasRect', this.atlasRectAttr);
    geometry.setAttribute('aStartTime', this.startTimeAttr);
    geometry.setAttribute('aDuration', this.durationAttr);
    geometry.setAttribute('aFloatSpeed', this.floatSpeedAttr);
    geometry.setAttribute('aBaseScale', this.baseScaleAttr);
    geometry.setAttribute('aLateralOffset', this.lateralOffsetAttr);
    geometry.setAttribute('aLateralDrift', this.lateralDriftAttr);

    this.instancedMesh = new InstancedMesh(geometry, this.material, MAX_INSTANCES);
    this.instancedMesh.count = 0;
    this.instancedMesh.frustumCulled = false;
    this.instancedMesh.renderOrder = 1001;

    // Initialize all instances with duration=0 (shader hides them)
    (this.durationAttr.array as Float32Array).fill(0);

    // Fill free indices (reversed so pop() gives lowest index first)
    for (let i = MAX_INSTANCES - 1; i >= 0; i--) {
      this.freeIndices.push(i);
    }

    this.scene.add(this.instancedMesh);
  }

  /**
   * Spawn a floating text at a geo position.
   */
  spawn(
    text: string,
    lat: number,
    lon: number,
    height: number,
    config: FloatingTextSpawnConfig = {},
  ): void {
    const {
      color = '#FFD700',
      fontSize = 48,
      duration = 1000,
      floatSpeed = 2,
      scale = 1,
      outlineColor = '#000000',
      outlineWidth = 3,
      lateralOffset = 0,
      lateralDrift = 0,
    } = config;

    // Get or allocate atlas slot (cache hit = no canvas work)
    const slot = this.atlas.getOrCreate(text, color, fontSize, outlineColor, outlineWidth);

    // Allocate instance index
    let index: number;
    if (this.freeIndices.length > 0) {
      index = this.freeIndices.pop()!;
    } else {
      index = this.forceExpireOldest();
    }

    const now = performance.now() / 1000;
    const durationSec = duration / 1000;

    // Set position via instanceMatrix (translation only)
    const localPos = this.sync.geoToLocal(lat, lon, height);
    this.tempMatrix.makeTranslation(localPos.x, localPos.y, localPos.z);
    this.instancedMesh.setMatrixAt(index, this.tempMatrix);
    this.instancedMesh.instanceMatrix.needsUpdate = true;

    // Set per-instance attributes
    const [u, v, w, h] = slot.uvRect;
    this.atlasRectAttr.setXYZW(index, u, v, w, h);
    this.startTimeAttr.setX(index, now);
    this.durationAttr.setX(index, durationSec);
    this.floatSpeedAttr.setX(index, floatSpeed);

    // Compute world scale from text aspect ratio
    const baseSize = scale * 3;
    this.baseScaleAttr.setXY(index, baseSize * slot.textAspect, baseSize);

    this.lateralOffsetAttr.setX(index, lateralOffset);
    this.lateralDriftAttr.setX(index, lateralDrift);

    // Mark attributes dirty
    this.atlasRectAttr.needsUpdate = true;
    this.startTimeAttr.needsUpdate = true;
    this.durationAttr.needsUpdate = true;
    this.floatSpeedAttr.needsUpdate = true;
    this.baseScaleAttr.needsUpdate = true;
    this.lateralOffsetAttr.needsUpdate = true;
    this.lateralDriftAttr.needsUpdate = true;

    // Track active instance
    this.activeInstances.set(index, { atlasSlot: slot, expiresAt: now + durationSec });

    // Update mesh count
    if (index + 1 > this.maxUsedIndex) {
      this.maxUsedIndex = index + 1;
      this.instancedMesh.count = this.maxUsedIndex;
    }
  }

  /**
   * Update uniforms and sweep expired instances.
   * Called once per frame.
   */
  update(camera: Camera): void {
    if (this.activeInstances.size === 0 && this.instancedMesh.count === 0) return;

    const now = performance.now() / 1000;

    // Update shader uniforms (3 values, once per frame)
    this.material.uniforms['uTime'].value = now;
    const e = camera.matrixWorld.elements;
    this.material.uniforms['uCameraRight'].value.set(e[0], e[1], e[2]);
    this.material.uniforms['uCameraUp'].value.set(e[4], e[5], e[6]);

    // Periodic sweep for expired instances
    if (now - this.lastSweepTime >= SWEEP_INTERVAL) {
      this.lastSweepTime = now;
      this.sweepExpired(now);
    }
  }

  setVisible(visible: boolean): void {
    this.instancedMesh.visible = visible;
  }

  /** Clear all active instances (round reset). */
  clear(): void {
    for (const [, inst] of this.activeInstances) {
      this.atlas.release(inst.atlasSlot);
    }
    this.activeInstances.clear();

    this.freeIndices = [];
    for (let i = MAX_INSTANCES - 1; i >= 0; i--) {
      this.freeIndices.push(i);
    }

    // Hide all instances via duration = 0
    (this.durationAttr.array as Float32Array).fill(0);
    this.durationAttr.needsUpdate = true;

    this.maxUsedIndex = 0;
    this.instancedMesh.count = 0;

    this.atlas.clear();
  }

  /** Dispose all GPU resources. */
  dispose(): void {
    this.clear();
    this.scene.remove(this.instancedMesh);
    this.instancedMesh.geometry.dispose();
    this.material.dispose();
    this.atlas.dispose();
  }

  // --- Private ---

  private sweepExpired(now: number): void {
    for (const [index, inst] of this.activeInstances) {
      if (now >= inst.expiresAt) {
        this.freeInstance(index, inst);
      }
    }
    this.recomputeMaxIndex();
  }

  private freeInstance(index: number, inst: ActiveInstance): void {
    this.atlas.release(inst.atlasSlot);
    this.activeInstances.delete(index);
    this.freeIndices.push(index);

    // Set duration = 0 so shader hides it immediately
    this.durationAttr.setX(index, 0);
    this.durationAttr.needsUpdate = true;
  }

  private forceExpireOldest(): number {
    let oldestIndex = -1;
    let oldestTime = Infinity;
    for (const [index, inst] of this.activeInstances) {
      if (inst.expiresAt < oldestTime) {
        oldestTime = inst.expiresAt;
        oldestIndex = index;
      }
    }
    if (oldestIndex >= 0) {
      this.freeInstance(oldestIndex, this.activeInstances.get(oldestIndex)!);
    }
    return oldestIndex >= 0 ? oldestIndex : 0;
  }

  private recomputeMaxIndex(): void {
    if (this.activeInstances.size === 0) {
      this.maxUsedIndex = 0;
    } else {
      let max = 0;
      for (const index of this.activeInstances.keys()) {
        if (index >= max) max = index + 1;
      }
      this.maxUsedIndex = max;
    }
    this.instancedMesh.count = this.maxUsedIndex;
  }
}
