import { Matrix4, Sphere, Vector3 } from 'three';

/** The parts of a 3d-tiles-renderer bounding volume this region reads. */
interface BoundingVolumeLike {
  sphere?: Sphere | null;
  obb?: { box: { getBoundingSphere(target: Sphere): Sphere }; transform: Matrix4 } | null;
  regionObb?: BoundingVolumeLike['obb'];
}

/** Tile bounding sphere, projected onto the local ground plane. */
interface TileFootprint {
  x: number;
  z: number;
  radius: number;
}

/**
 * Load region for `LoadRegionPlugin` that keeps the enemy route corridor at
 * fine LOD, wherever the camera looks.
 *
 * The renderer only activates tiles inside the camera frustum, and raycasts
 * only hit active tiles. Route cells off screen therefore had no geometry to
 * sample, and cells seen from far away were baked from coarse tiles. Tiles
 * intersecting this region are refined down to `errorTarget` metres of
 * geometric error and kept active even when they are out of view.
 *
 * The test runs in the scene's local XZ plane against each tile's bounding
 * sphere, so terrain height never matters: the corridor reaches from the
 * valley floor to the rooftops. Bounding volumes live in the tiles group's
 * frame, `toLocal` is that group's world matrix at the time the corridor is
 * built. Build a new region when the group moves (origin change).
 *
 * Structurally matches the library's `BaseRegion`, which its typings declare
 * but do not export.
 */
export class RouteCorridorRegion {
  readonly mask = false;
  private readonly toLocal: Matrix4;
  /** Flat x0, z0, x1, z1 per segment. */
  private readonly segments: Float64Array;
  private readonly minX: number;
  private readonly maxX: number;
  private readonly minZ: number;
  private readonly maxZ: number;
  /** Tile bounding volumes never change, so each footprint is computed once. */
  private readonly footprints = new WeakMap<object, TileFootprint | null>();
  private readonly scratchSphere = new Sphere();
  private readonly scratchCenter = new Vector3();

  constructor(
    routes: readonly (readonly Vector3[])[],
    toLocal: Matrix4,
    private readonly halfWidth: number,
    readonly errorTarget: number,
  ) {
    this.toLocal = toLocal.clone();

    const coords: number[] = [];
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const route of routes) {
      for (let i = 0; i < route.length - 1; i++) {
        const a = route[i];
        const b = route[i + 1];
        coords.push(a.x, a.z, b.x, b.z);
        minX = Math.min(minX, a.x, b.x);
        maxX = Math.max(maxX, a.x, b.x);
        minZ = Math.min(minZ, a.z, b.z);
        maxZ = Math.max(maxZ, a.z, b.z);
      }
    }
    this.segments = new Float64Array(coords);
    this.minX = minX;
    this.maxX = maxX;
    this.minZ = minZ;
    this.maxZ = maxZ;
  }

  intersectsTile(boundingVolume: BoundingVolumeLike, tile: object): boolean {
    let footprint = this.footprints.get(tile);
    if (footprint === undefined) {
      footprint = this.footprintOf(boundingVolume);
      this.footprints.set(tile, footprint);
    }
    if (footprint === null) return false;

    const { x, z } = footprint;
    const reach = footprint.radius + this.halfWidth;
    if (x < this.minX - reach || x > this.maxX + reach) return false;
    if (z < this.minZ - reach || z > this.maxZ + reach) return false;

    const reachSq = reach * reach;
    const s = this.segments;
    for (let i = 0; i < s.length; i += 4) {
      if (distanceToSegmentSq(x, z, s[i], s[i + 1], s[i + 2], s[i + 3]) <= reachSq) return true;
    }
    return false;
  }

  /** Same formula as the library's `BaseRegion`: refine while the tile is coarser than `errorTarget`. */
  calculateError(tile: { geometricError: number }, tilesRenderer: { errorTarget: number }): number {
    return tile.geometricError - this.errorTarget + tilesRenderer.errorTarget;
  }

  /** No distance: corridor tiles load by error alone. */
  calculateDistance(): number {
    return Infinity;
  }

  private footprintOf(boundingVolume: BoundingVolumeLike): TileFootprint | null {
    const sphere = this.scratchSphere;
    const obb = boundingVolume.obb ?? boundingVolume.regionObb ?? null;
    if (boundingVolume.sphere) {
      sphere.copy(boundingVolume.sphere);
    } else if (obb) {
      obb.box.getBoundingSphere(sphere).applyMatrix4(obb.transform);
    } else {
      return null;
    }
    const center = this.scratchCenter.copy(sphere.center).applyMatrix4(this.toLocal);
    return { x: center.x, z: center.z, radius: sphere.radius };
  }
}

/** Squared distance from (px, pz) to the segment (ax, az)-(bx, bz). */
function distanceToSegmentSq(
  px: number, pz: number, ax: number, az: number, bx: number, bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  let t = lenSq > 0 ? ((px - ax) * dx + (pz - az) * dz) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const ex = px - (ax + t * dx);
  const ez = pz - (az + t * dz);
  return ex * ex + ez * ez;
}
