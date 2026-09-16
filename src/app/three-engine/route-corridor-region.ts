import { Matrix4, Sphere, Vector3 } from 'three';
import { fnv1a } from '../utils/fnv1a';

/**
 * Geometric error in metres a corridor build refines the region to while it
 * measures: the finest level the tiles have. At all five places measured on
 * 2026-09-16 (Berlin, Erlenbach, Rothenburg, Paris, Tokyo;
 * tmp/archive-2026-09/fix1/reports/phase0-results.md) the tiles under every station were
 * 2.0 m at 2.5 as at 0, so nothing the camera loads is finer.
 *
 * Only a build holds this level. It costs 39 to 166 MB of active tiles over
 * the coarse level, so the build hands the region back to
 * ROUTE_CORRIDOR_COARSE_ERROR_TARGET when it freezes (CorridorBuild.unmute).
 */
export const ROUTE_CORRIDOR_ERROR_TARGET = 2.5;

/**
 * The coarse level of the region, for two things:
 *
 * - what a build falls back to where the finest level has no column
 *   (CorridorBuild): in Paris 4 stations at the bridge found none at 2.5 m
 *   and one at 5 m;
 * - what the region rests at between builds. The frozen corridor samples no
 *   cell any more, so nothing needs fine tiles; the region stays only to
 *   keep corridor tiles ACTIVE off screen, which the tower LOS cubemap and
 *   its CPU raycast fallback need (see CorridorBuild.unmute).
 */
export const ROUTE_CORRIDOR_COARSE_ERROR_TARGET = 5;

/** The parts of a 3d-tiles-renderer bounding volume this region reads. */
interface BoundingVolumeLike {
  sphere?: Sphere | null;
  obb?: { box: { getBoundingSphere(target: Sphere): Sphere }; transform: Matrix4 } | null;
  regionObb?: BoundingVolumeLike['obb'];
}

/** The parts of an active tile lodState reads. */
export interface RegionTile {
  geometricError?: number;
  children?: readonly unknown[];
  content?: { uri?: string } | null;
  engineData?: { boundingVolume?: BoundingVolumeLike | null } | null;
}

/** How far the tiles reaching the region are refined, see lodState. */
export interface RegionLodState {
  /** Active tiles that reach the region. */
  tiles: number;
  /** Of those, at `errorTarget` or finer, or a leaf that cannot refine. */
  fine: number;
  /** Of those, 2 m or finer. */
  finest: number;
  /** Of those, coarser than `errorTarget` with children: still to refine. */
  coarse: number;
  /**
   * Which of the `fine` tiles those are, 8 hex digits over their content
   * paths (without the query, which carries the session): two builds of a
   * place measured on the same tiles when it is the same. The `coarse` ones
   * stay out: they are parents still to refine, and how many of them are
   * still active varies from load to load. Tokyo, retest of 2026-09-16: the
   * same corridor (fingerprint) with fine=181 both times and coarse=20 on a
   * fresh load, 14 after a location change and reset(), and with the
   * parents counted two different hashes.
   */
  tileSet: string;
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
    /** Metres of geometric error the corridor refines to; `__corridor.probeLod()` changes it for a run. */
    public errorTarget: number,
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

  /**
   * How far the active tiles that reach the region are refined, for the
   * corridor trace: a coarse tile stays active until its children are
   * ready, so a coarse one with children is a refinement still to come.
   * And which of the fine ones they are (`tileSet`), for comparing the
   * tiles two builds of a place measured on (PLAYTEST 745).
   * O(active tiles × segments), footprints cached per tile.
   */
  lodState(activeTiles: Iterable<RegionTile>): RegionLodState {
    const { state, paths } = this.scan(activeTiles);
    state.tileSet = fnv1a(paths.join('\n'));
    return state;
  }

  /**
   * The content paths of the fine tiles lodState hashes into `tileSet`,
   * without the query and sorted: which tiles those are, for the corridor
   * snapshot.
   */
  finePaths(activeTiles: Iterable<RegionTile>): string[] {
    return this.scan(activeTiles).paths;
  }

  /** The counts of lodState and the sorted content paths of its fine tiles. */
  private scan(activeTiles: Iterable<RegionTile>): { state: RegionLodState; paths: string[] } {
    const state: RegionLodState = { tiles: 0, fine: 0, finest: 0, coarse: 0, tileSet: '' };
    const paths: string[] = [];
    for (const tile of activeTiles) {
      const volume = tile.engineData?.boundingVolume;
      if (!volume || !this.intersectsTile(volume, tile)) continue;
      state.tiles++;
      const error = tile.geometricError ?? Infinity;
      if (error <= 2) state.finest++;
      if (error > this.errorTarget && (tile.children?.length ?? 0) > 0) {
        state.coarse++;
      } else {
        state.fine++;
        paths.push(tile.content?.uri?.split('?')[0] ?? '');
      }
    }
    return { state, paths: paths.sort() };
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
