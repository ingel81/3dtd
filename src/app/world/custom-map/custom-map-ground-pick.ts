import { Object3D, type Intersection, type Raycaster } from 'three';
import type { CustomMapSurface } from './custom-map-surface';

/** What a ray can meet on the map, as a number that changes with it (GroundPickRoot's cache) */
class MapPickVersion {
  placements = 0;

  constructor(private readonly surface: CustomMapSurface) {}

  get value(): number {
    return this.surface.pickVersion + this.placements;
  }
}

/**
 * MapGroundPick: a custom map's ground as the camera controls raycast it
 * (CameraRig.setupEnvironmentControls, GroundPickRoot): the terrain and the
 * roofs that carry towers, met analytically (CustomMapSurface.pickRay over
 * the height field and the roofs), with no mesh of the scene. The map's
 * sight blockers as the controls' ground had them test every instance of
 * every building and tree mesh on a cache miss (a pan), and the cache's
 * version walked all their nodes twice a frame (8400 on an OSM city).
 *
 * `version` counts up when what a ray can meet changes: the roofs
 * (surface.pickVersion) and a move of the map in the scene (`moved`, a new
 * origin). The heights of a map in the game do not change.
 */
export class MapGroundPick extends Object3D {
  readonly version: MapPickVersion;

  constructor(private readonly surface: CustomMapSurface) {
    super();
    this.name = 'custom-map-ground-pick';
    this.version = new MapPickVersion(surface);
  }

  /** The map moved in the scene (a new origin): remembered rays no longer hold */
  moved(): void {
    this.version.placements++;
  }

  override raycast(raycaster: Raycaster, intersects: Intersection[]): void {
    const point = this.surface.pickRay(raycaster);
    if (!point) return;
    const distance = raycaster.ray.origin.distanceTo(point);
    if (distance < raycaster.near || distance > raycaster.far) return;
    intersects.push({ distance, point, object: this });
  }
}
