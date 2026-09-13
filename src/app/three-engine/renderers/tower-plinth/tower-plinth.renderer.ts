import { Mesh, type Camera, type Material, type Object3D, type Scene, type WebGLRenderer } from 'three';
import type { CoordinateSync } from '../index';
import { createPlinthGeometry } from './plinth-geometry';
import { createPlinthMaterial } from './plinth-material';

/**
 * A plinth mesh with a geometry of its own. Its origin is the lowest point
 * of the footprint; the top, `height` above it, is the tower's foot.
 */
export function createPlinthMesh(footprintRadius: number, height: number, material: Material): Mesh {
  const mesh = new Mesh(createPlinthGeometry(footprintRadius, height), material);
  mesh.name = 'tower-plinth';
  return mesh;
}

/**
 * TowerPlinthRenderer: the stone plinths under towers on uneven ground,
 * one mesh per plinth (few towers get one), all with one material.
 *
 * Kept apart from ThreeTowerRenderer: the TowerManager creates the plinth
 * next to the tower model when the tower has a plinthHeight, and removes it
 * with the tower. The engine hands the meshes to the ScreenPicker, so a
 * click on the plinth picks its tower.
 */
export class TowerPlinthRenderer {
  private readonly material = createPlinthMaterial();
  private readonly plinths = new Map<string, Mesh>();

  constructor(
    private readonly scene: Scene,
    private readonly sync: CoordinateSync,
  ) {}

  /**
   * Plinth under tower `id`: its top at `footY` (the tower's foot, local
   * Y), reaching `height` down to the lowest point of the footprint. The
   * width follows the tower's footprintRadius. Replaces an earlier one.
   */
  create(id: string, lat: number, lon: number, footY: number, height: number, footprintRadius: number): void {
    this.remove(id);
    const mesh = createPlinthMesh(footprintRadius, height, this.material);
    mesh.position.copy(this.sync.geoToLocal(lat, lon, footY - height));
    // It never moves: one matrix, no recompose every frame
    mesh.updateMatrix();
    mesh.matrixAutoUpdate = false;
    this.scene.add(mesh);
    this.plinths.set(id, mesh);
  }

  /** Take the plinth of tower `id` out of the scene, if it has one. */
  remove(id: string): void {
    const mesh = this.plinths.get(id);
    if (!mesh) return;
    this.scene.remove(mesh);
    mesh.geometry.dispose();
    this.plinths.delete(id);
  }

  /** Remove every plinth. */
  clear(): void {
    for (const id of [...this.plinths.keys()]) {
      this.remove(id);
    }
  }

  /** The plinth meshes with their tower's id, for picking. */
  getAllMeshes(): { id: string; mesh: Object3D }[] {
    const result: { id: string; mesh: Object3D }[] = [];
    for (const [id, mesh] of this.plinths) {
      result.push({ id, mesh });
    }
    return result;
  }

  get count(): number {
    return this.plinths.size;
  }

  /**
   * Compile the plinth program ahead of the first plinth, like
   * ThreeTowerRenderer.precompile does for the tower models.
   */
  async precompile(renderer: WebGLRenderer, camera: Camera): Promise<void> {
    const warm = createPlinthMesh(1, 1, this.material);
    try {
      await renderer.compileAsync(warm, camera, this.scene);
    } finally {
      warm.geometry.dispose();
    }
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
  }
}
