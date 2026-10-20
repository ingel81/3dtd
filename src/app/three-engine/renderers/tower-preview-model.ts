import { Object3D, Mesh, Color, MeshStandardMaterial } from 'three';
import type { AssetManagerService } from '../../services/infrastructure/asset-manager.service';
import type { TowerTypeConfig } from '../../configs/tower-types.config';
import { addShotLightTo } from '../shot-lights/shot-light-shader';

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

/** How see-through the build preview's tower and plinth are. */
export const PREVIEW_OPACITY = 0.7;

/**
 * See-through, and drawn without writing depth, so the ground shows through.
 * A program of its own (three's OPAQUE define): the load-time warm-up builds
 * the preview's tower and plinth too (ThreeTowerRenderer.warmUpObjects,
 * TowerPlinthRenderer.warmUpObjects).
 */
export function makeModelTransparent(model: Object3D, opacity: number): void {
  forEachMaterial(model, (mat) => {
    mat.transparent = true;
    mat.opacity = opacity;
    mat.depthWrite = false;
  });
}

/**
 * The build preview's tower (TowerPlacementService): the model with its shot
 * light like a placed tower's (ThreeTowerRenderer), at its scale and base
 * rotation, see-through, at rest (without morph targets: nothing animates it,
 * CloneOptions.atRest). The load-time warm-up builds one per tower the same
 * way (ThreeTowerRenderer.warmUpObjects): the first pick linked its programs
 * in its frame (the archer's 250 to 550 ms on autumn keep and an OSM world,
 * E258). Null while the model is not loaded.
 */
export function buildPreviewModel(
  assets: Pick<AssetManagerService, 'cloneModel'>,
  config: Pick<TowerTypeConfig, 'modelUrl' | 'scale' | 'rotationY'>,
): Object3D | null {
  const model = assets.cloneModel(config.modelUrl, { atRest: true });
  if (!model) return null;
  addShotLightTo(model);
  model.scale.setScalar(config.scale);
  model.rotation.y = config.rotationY ?? 0;
  makeModelTransparent(model, PREVIEW_OPACITY);
  return model;
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
