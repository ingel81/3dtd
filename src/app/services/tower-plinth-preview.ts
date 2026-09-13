import type { Mesh, MeshStandardMaterial, Object3D } from 'three';
import { createPlinthMaterial } from '../three-engine/renderers/tower-plinth/plinth-material';
import { createPlinthMesh } from '../three-engine/renderers/tower-plinth/tower-plinth.renderer';
import { makeModelTransparent, tintPreviewModel } from './tower-preview-model';

/**
 * The plinth under the build preview: the same stones as the placed one,
 * see-through and tinted green or red like the preview tower. Rebuilt when
 * the footprint asks for another height or width, hidden on even ground.
 * TowerPlacementService owns one.
 */
export class TowerPlinthPreview {
  private mesh: Mesh | null = null;
  private material: MeshStandardMaterial | null = null;
  /** Footprint radius and height the mesh was built for. */
  private builtRadius = 0;
  private builtHeight = 0;
  /** Tint the material carries, null before the first. */
  private tintedValid: boolean | null = null;

  /**
   * Show the plinth under a preview tower whose foot is at (x, footY, z),
   * reaching `height` down, in `parent`. A height of 0 hides it.
   */
  show(parent: Object3D, x: number, footY: number, z: number, footprintRadius: number, height: number, valid: boolean): void {
    if (height <= 0) {
      this.hide();
      return;
    }

    if (!this.material) {
      this.material = createPlinthMaterial();
    }
    if (!this.mesh || footprintRadius !== this.builtRadius || height !== this.builtHeight) {
      this.removeMesh();
      this.mesh = createPlinthMesh(footprintRadius, height, this.material);
      this.builtRadius = footprintRadius;
      this.builtHeight = height;
      makeModelTransparent(this.mesh, 0.7);
    }
    if (this.mesh.parent !== parent) parent.add(this.mesh);
    if (this.tintedValid !== valid) {
      tintPreviewModel(this.mesh, valid);
      this.tintedValid = valid;
    }

    this.mesh.position.set(x, footY - height, z);
    this.mesh.visible = true;
  }

  hide(): void {
    if (this.mesh) this.mesh.visible = false;
  }

  /** Take the plinth out of its parent and free geometry and material. */
  dispose(): void {
    this.removeMesh();
    this.material?.dispose();
    this.material = null;
    this.tintedValid = null;
  }

  private removeMesh(): void {
    if (!this.mesh) return;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh = null;
  }
}
