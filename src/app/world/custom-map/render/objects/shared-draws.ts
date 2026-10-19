import type { InstancedMesh, Sphere } from 'three';
import type { InstanceList } from './instance-list';

/**
 * A draw that objects of several assets share (object-layer.ts): the far
 * boxes of all buildings (far-boxes.ts), the impostors of all trees and big
 * rocks (impostor-array.ts). Each `key` is one list and one mesh: the boxes
 * that block sight apart from the others, the impostors by the size of their
 * views as well. An asset's level that draws here takes the list of its key;
 * the layer moves its objects in and out as for a level of its own and keeps
 * the list's bounds the union of its assets' bounds
 */
export interface SharedDraws {
  /** The list of `key` with room for at least `capacity`; a new, empty one (`renewed`) when it had less */
  list(key: string, capacity: number): { list: InstanceList; renewed: boolean };
  /** The bounds of what `key` may draw, which its mesh is culled by */
  bounds(key: string): Sphere;
  /** Uploads what the lists changed and draws what they hold (or, `warmUp`, one instance each for a compiling render) */
  sync(warmUp?: boolean): void;
  /** While `on` each mesh draws its first instances only, those near the focus (MapObjectLayer.nearOnly) */
  nearOnly(on: boolean): void;
  /** The meshes of what blocks no sight (a water reflection leaves them out) */
  openMeshes(): InstancedMesh[];
  dispose(): void;
}
