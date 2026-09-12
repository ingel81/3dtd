import { Object3D, Mesh, Color, MeshStandardMaterial } from 'three';

/** Emissive tint of the build preview on a valid spot. */
const VALID_TINT = new Color(0.15, 0.8, 0.15);
/** Emissive tint of the build preview on an invalid spot. */
const INVALID_TINT = new Color(0.9, 0.15, 0.15);

/** Every material of every mesh under `model`, single or array. */
function forEachMaterial(model: Object3D, fn: (material: MeshStandardMaterial) => void): void {
  model.traverse((child) => {
    if ((child as Mesh).isMesh) {
      const mesh = child as Mesh;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((mat) => fn(mat as MeshStandardMaterial));
    }
  });
}

/** See-through, and drawn without writing depth, so the ground shows through. */
export function makeModelTransparent(model: Object3D, opacity: number): void {
  forEachMaterial(model, (mat) => {
    mat.transparent = true;
    mat.opacity = opacity;
    mat.depthWrite = false;
  });
}

/** Green emissive tint for a valid spot, red for an invalid one. */
export function tintPreviewModel(model: Object3D, valid: boolean): void {
  const tintColor = valid ? VALID_TINT : INVALID_TINT;
  forEachMaterial(model, (mat) => {
    if (mat.emissive) {
      mat.emissive.copy(tintColor);
      mat.emissiveIntensity = 0.5;
    }
  });
}
