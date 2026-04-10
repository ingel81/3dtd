import {
  InstancedMesh,
  InstancedBufferAttribute,
  PlaneGeometry,
  ShaderMaterial,
  Matrix4,
  Vector3,
  Group,
} from 'three';
import { FloatingTextAtlas, AtlasSlot } from '../floating-text/floating-text-atlas';
import { createLabelMaterial } from './marker-shaders';

const MAX_LABELS = 8;
const LABEL_Y_OFFSET = 20; // Units above diamond center

interface LabelEntry {
  id: string;
  index: number;
  atlasSlot: AtlasSlot;
  position: Vector3; // Diamond position (label adds Y offset)
  phaseOffset: number;
}

/**
 * GPU-instanced persistent label renderer for markers.
 *
 * Renders billboard text labels ("HQ", "Spawn 1", etc.) above marker diamonds.
 * Uses FloatingTextAtlas for canvas-based text rendering into a shared texture.
 * All labels rendered in 1 draw call via InstancedMesh.
 *
 * Unlike FloatingTextInstanceManager, labels are persistent (no duration/fade).
 */
export class MarkerLabelManager {
  private readonly atlas: FloatingTextAtlas;
  private readonly material: ShaderMaterial;
  private readonly mesh: InstancedMesh;

  // Per-instance attributes
  private readonly atlasRectAttr: InstancedBufferAttribute;
  private readonly baseScaleAttr: InstancedBufferAttribute;
  private readonly phaseAttr: InstancedBufferAttribute;
  private readonly alphaAttr: InstancedBufferAttribute;

  // Tracking
  private labels = new Map<string, LabelEntry>();
  private freeIndices: number[] = [];
  private maxUsedIndex = 0;

  private readonly tmpMatrix = new Matrix4();

  constructor(private readonly overlayGroup: Group) {
    this.atlas = new FloatingTextAtlas();
    this.material = createLabelMaterial(this.atlas.texture);

    const geometry = new PlaneGeometry(1, 1);

    this.atlasRectAttr = new InstancedBufferAttribute(new Float32Array(MAX_LABELS * 4), 4);
    this.baseScaleAttr = new InstancedBufferAttribute(new Float32Array(MAX_LABELS * 2), 2);
    this.phaseAttr = new InstancedBufferAttribute(new Float32Array(MAX_LABELS), 1);
    this.alphaAttr = new InstancedBufferAttribute(new Float32Array(MAX_LABELS), 1);

    geometry.setAttribute('aAtlasRect', this.atlasRectAttr);
    geometry.setAttribute('aBaseScale', this.baseScaleAttr);
    geometry.setAttribute('aPhaseOffset', this.phaseAttr);
    geometry.setAttribute('aAlpha', this.alphaAttr);

    this.mesh = new InstancedMesh(geometry, this.material, MAX_LABELS);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6; // Above diamonds

    // Init: all alphas 0 (hidden)
    (this.alphaAttr.array as Float32Array).fill(0);

    // Free indices (reversed for pop)
    for (let i = MAX_LABELS - 1; i >= 0; i--) {
      this.freeIndices.push(i);
    }

    overlayGroup.add(this.mesh);
  }

  /**
   * Add a persistent label above a marker.
   */
  addLabel(
    id: string,
    text: string,
    position: Vector3,
    color: string,
    phaseOffset: number,
  ): void {
    // Remove existing
    if (this.labels.has(id)) this.removeLabel(id);

    const index = this.freeIndices.pop()!;

    // Render text into atlas
    const slot = this.atlas.getOrCreate(text, '#FFFFFF', 48, color, 4);

    // Position: diamond pos + label Y offset
    this.tmpMatrix.makeTranslation(position.x, position.y + LABEL_Y_OFFSET, position.z);
    this.mesh.setMatrixAt(index, this.tmpMatrix);

    // Atlas UV
    const [u, v, w, h] = slot.uvRect;
    this.atlasRectAttr.setXYZW(index, u, v, w, h);

    // Scale based on text aspect ratio
    const labelSize = 5;
    this.baseScaleAttr.setXY(index, labelSize * slot.textAspect, labelSize);

    // Phase + alpha
    this.phaseAttr.setX(index, phaseOffset);
    this.alphaAttr.setX(index, 1.0);

    // Mark dirty
    this.mesh.instanceMatrix.needsUpdate = true;
    this.atlasRectAttr.needsUpdate = true;
    this.baseScaleAttr.needsUpdate = true;
    this.phaseAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;

    // Track
    const entry: LabelEntry = {
      id,
      index,
      atlasSlot: slot,
      position: position.clone(),
      phaseOffset,
    };
    this.labels.set(id, entry);

    // Update count
    if (index + 1 > this.maxUsedIndex) {
      this.maxUsedIndex = index + 1;
      this.mesh.count = this.maxUsedIndex;
    }
  }

  /**
   * Remove a label.
   */
  removeLabel(id: string): void {
    const entry = this.labels.get(id);
    if (!entry) return;

    // Hide via alpha
    this.alphaAttr.setX(entry.index, 0);
    this.alphaAttr.needsUpdate = true;

    // Release atlas slot
    this.atlas.release(entry.atlasSlot);

    this.freeIndices.push(entry.index);
    this.labels.delete(id);
    this.recomputeMaxIndex();
  }

  /**
   * Update label position (follows marker height changes).
   */
  updatePosition(id: string, position: Vector3): void {
    const entry = this.labels.get(id);
    if (!entry) return;

    entry.position.copy(position);
    this.tmpMatrix.makeTranslation(position.x, position.y + LABEL_Y_OFFSET, position.z);
    this.mesh.setMatrixAt(entry.index, this.tmpMatrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Per-frame update: time uniform for bobbing animation.
   */
  update(): void {
    if (this.labels.size === 0) return;

    this.material.uniforms['uTime'].value = performance.now() / 1000;
  }

  /**
   * Clear all labels.
   */
  clear(): void {
    for (const entry of this.labels.values()) {
      this.atlas.release(entry.atlasSlot);
    }
    this.labels.clear();

    (this.alphaAttr.array as Float32Array).fill(0);
    this.alphaAttr.needsUpdate = true;

    this.freeIndices = [];
    for (let i = MAX_LABELS - 1; i >= 0; i--) {
      this.freeIndices.push(i);
    }

    this.maxUsedIndex = 0;
    this.mesh.count = 0;
    this.atlas.clear();
  }

  /**
   * Dispose all GPU resources.
   */
  dispose(): void {
    this.clear();
    this.overlayGroup.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.atlas.dispose();
  }

  private recomputeMaxIndex(): void {
    if (this.labels.size === 0) {
      this.maxUsedIndex = 0;
    } else {
      let max = 0;
      for (const entry of this.labels.values()) {
        if (entry.index >= max) max = entry.index + 1;
      }
      this.maxUsedIndex = max;
    }
    this.mesh.count = this.maxUsedIndex;
  }
}
