/**
 * What the editor needs from the map's renderer. The custom map renderer
 * (`world/custom-map/render/`) is the real one; `PlaceholderMapView` draws
 * the same document with plain colours until it is there.
 *
 * Scene space is the game's (`geoToLocalSimple` around the origin): y is
 * up, scene x = -map x (east), scene z = map y (north). A half turn, not a
 * mirror, so a map rotation r is rotation.y = r in the scene.
 */
import { Vector3, type Camera, type Object3D, type Ray } from 'three';
import type { MapPoint } from '../../world/custom-map/map-document';
import type { GridRect } from '../model/grid';

export interface EditorMapView {
  readonly group: Object3D;
  readonly ready: Promise<void>;
  heightAt(x: number, y: number): number;
  /** Where a ray in scene space meets the ground, in map space (z is the height) */
  raycast(ray: Ray): { x: number; y: number; z: number } | null;
  update(dt: number, camera: Camera): void;
  /** Height samples changed */
  updateHeights(rect: GridRect): void;
  /** Splat texels changed */
  updateSplat(rect: GridRect): void;
  /** Ground layers changed (materials, order) */
  updateLayers(): void;
  updateWater(): void;
  setObjects(): void;
  updateObject(id: string): void;
  updatePaths(): void;
  setEnvironment(): void;
  /** Triangles the map draws, for the status line */
  triangles(): number;
  dispose(): void;
}

export function mapToScene(x: number, y: number, h: number, target = new Vector3()): Vector3 {
  return target.set(-x, h, y);
}

export function sceneToMap(v: Vector3): MapPoint & { z: number } {
  return { x: -v.x, y: v.z, z: v.y };
}
