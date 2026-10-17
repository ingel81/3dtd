import { Mesh, type Material, type Object3D, type Scene } from 'three';
import type { ColumnSampler } from '../../column-sample';
import type { CoordinateSync } from '../index';
import { crownBraces, plinthBraces, type PlinthCrown } from './plinth-braces';
import { createPlinthGeometry } from './plinth-geometry';
import { createPlinthMaterial } from './plinth-material';

/**
 * A plinth mesh with a geometry of its own. Its origin is the lowest point
 * of the footprint; the top, `height` above it, is the tower's foot. Where
 * it hangs over a drop at the footprint probes `overhang`
 * (TowerFootprint.overhang), braces go under it (plinthBraces), part of the
 * same geometry. On a `crown` (a wall's walk) corbels carry it on both sides
 * of the wall instead (crownBraces), and its wall reaches down to nothing
 * beside it: the corbels hold it.
 */
export function createPlinthMesh(
  footprintRadius: number,
  height: number,
  material: Material,
  overhang: readonly number[] = [],
  groundAt?: (x: number, z: number) => number | null,
  crown: PlinthCrown | null = null,
): Mesh {
  const braces = crown ? crownBraces(footprintRadius, height, crown) : plinthBraces(footprintRadius, height, overhang);
  const mesh = new Mesh(createPlinthGeometry(footprintRadius, height, braces, crown ? undefined : groundAt), material);
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
    /** The world's column at a local point: its top surface is the ground the wall reaches down to */
    private readonly columnAt: ColumnSampler | null = null,
    /** The crown under a local point (WorldSurface.crownAt): a plinth there stands on corbels both sides */
    private readonly crownAt: ((x: number, z: number) => PlinthCrown | null) | null = null,
  ) {}

  /**
   * Plinth under tower `id`: its top at `footY` (the tower's foot, local
   * Y), reaching `height` down to the lowest point of the footprint. The
   * width follows the tower's footprintRadius, braces go under it where it
   * hangs over a drop at the footprint probes `overhang`. Where the ground
   * beside the wall lies lower than the footprint's lowest probe (a slope
   * beyond them) the wall reaches down into it (PLINTH_SKIRT_M). On a crown
   * (a wall's walk) corbels carry it on both sides (crownBraces). Replaces an
   * earlier one.
   */
  create(
    id: string,
    lat: number,
    lon: number,
    footY: number,
    height: number,
    footprintRadius: number,
    overhang: readonly number[] = [],
  ): void {
    this.remove(id);
    const origin = this.sync.geoToLocal(lat, lon, footY - height);
    // The top surface, not the ground under it: beside a roof the wall stays on the roof, not down the facade
    const columnAt = this.columnAt;
    const groundAt = columnAt
      ? (x: number, z: number) => {
          const column = columnAt(origin.x + x, origin.z + z);
          return column ? column.topY - origin.y : null;
        }
      : undefined;
    const crown = this.crownAt?.(origin.x, origin.z) ?? null;
    const mesh = createPlinthMesh(footprintRadius, height, this.material, overhang, groundAt, crown);
    mesh.position.copy(origin);
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

  /** A plinth with the shared material for the load-time warm-up, like ThreeTowerRenderer.warmUpObjects */
  warmUpObject(): Object3D {
    return createPlinthMesh(1, 1, this.material);
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
  }
}
