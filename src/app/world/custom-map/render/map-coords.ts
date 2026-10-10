import type { Vector3 } from 'three';
import type { MapPoint } from '../map-document';

/**
 * Map space to scene space and back.
 *
 * Map space: metres, origin in the map's middle, `x` east, `y` north, heights
 * in metres above the map's zero. The game's scene comes from
 * `geoToLocalSimple` around the synthetic origin (0, 0): scene x = -east,
 * scene z = +north, scene y = up. A map therefore sits in the scene as
 *
 *   scene.x = -map.x
 *   scene.y =  height
 *   scene.z =  map.y
 *
 * That is a half turn around the up axis, not a mirror: a rotation of `r`
 * radians counter-clockwise in map space (seen from above, east towards
 * north) is `rotation.y = r` in the scene.
 *
 * Everything the custom map renderer builds lives in this frame, so the
 * editor and the game agree on where a map point is drawn.
 */

export function mapToScene(x: number, y: number, height: number, target: Vector3): Vector3 {
  return target.set(-x, height, y);
}

/** Map point under a scene position (the height is dropped) */
export function sceneToMap(position: { x: number; z: number }, target: MapPoint): MapPoint {
  target.x = -position.x;
  target.y = position.z;
  return target;
}

/** Scene rotation around the up axis for a map rotation (both radians) */
export function mapRotationToScene(rotation: number): number {
  return rotation;
}
