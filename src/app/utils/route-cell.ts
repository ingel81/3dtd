import type { Enemy } from '../entities/enemy.entity';
import { LOS_VIZ_CONFIG } from '../configs/los-viz.config';

/**
 * Per-cell sampling metadata. Maintained exclusively by `RouteCellSampler`
 * (`sampleCellY`, `fill` for the grid's gap filling, and `resetToUnsampled`).
 * Never write from anywhere else, otherwise the single-source-of-truth
 * invariant breaks.
 *
 * `tileDepth` and `tileGeometricError` are the LOD metadata of the tile
 * that produced the last successful sample. They drive the quality-
 * versioned idempotency in `sampleCellY`: a new sample at strictly worse
 * LOD (lower depth, higher geometricError) does not overwrite a cached
 * good sample. Stable under tile streaming.
 */
export interface CellSample {
  /**
   * `unsampled`: terrain raycast hasn't returned a hit yet, `terrainHeight`
   *   is still a fallback (route-anchor Y). Viz call sites skip these cells.
   * `filled`: no usable hit of its own, but the cell lies between stable
   *   cells of its surface (a seam between two tile meshes) and
   *   `terrainHeight` is interpolated between them (GlobalRouteGrid
   *   fillGaps). Counts as having a height; sampling keeps trying it like an
   *   unsampled cell.
   * `stable`: terrain raycast returned a hit; `terrainHeight` is real.
   */
  state: 'unsampled' | 'filled' | 'stable';
  /** Internal frame counter at last successful sample (debug only). */
  sampledAt: number;
  /** 3D Tiles tile depth at last sample. Higher = better LOD. 0 if unknown. */
  tileDepth: number;
  /** Tile geometricError at last sample. Lower = better LOD. Infinity if unknown. */
  tileGeometricError: number;
  /**
   * The column came down on something far above the ground on the route
   * centre line beside the cell (a roof, an eave, a tree crown over the
   * street) or on something the ground steps up onto abruptly (a parked car,
   * a van, a hedge), and `terrainHeight` is the ground beside it instead.
   * See `sampleCellY`.
   */
  clamped: boolean;
  /**
   * Where the step check clamped the cell: the top of the car, van or
   * hedge its column came down on, the height the cell had before the
   * check. The ground LOS probe stays above it (getGroundTargetY). Null on
   * every other cell, a cell the roof check clamped included.
   */
  stepTop: number | null;
}

/**
 * RouteCell - Single cell in the global route grid
 *
 * Contains:
 * - Position (cell center in local coordinates)
 * - Terrain height at cell center
 * - Set of enemies currently in this cell
 * - Map of tower visibility for ground LOS (LOS check results per tower)
 * - Map of tower visibility for air LOS (raycast against cell air-height)
 */
export interface RouteCell {
  /** Unique cell key (integer hash) */
  key: number;
  /** Cell center X in local coordinates */
  x: number;
  /** Cell center Z in local coordinates */
  z: number;
  /**
   * Centre of the grid spot on the route centre line next to the cell: the
   * point of its segment nearest to the cell, snapped to its grid spot.
   * Equal to x, z for a cell the centre line runs through. The ground there
   * is what `sampleCellY` checks the cell's height against.
   */
  axisX: number;
  axisZ: number;
  /** Terrain height at cell center (local Y coordinate) */
  terrainHeight: number;
  /**
   * Which surface of the column the cell stands on: `ground` is the lowest
   * hit, `deck` the highest, the deck of a bridge the route crosses rather
   * than the river or road below it. `tunnel`: neither, the cell lies in a
   * tunnel or covered passage and takes its height between the portals
   * (`tunnelSpan`). Set at generation from the OSM tags of the segments
   * that reach the cell, read by `sampleCellY`.
   */
  surface: 'ground' | 'deck' | 'tunnel';
  /** Portals a `tunnel` cell takes its height between; null on every other cell. */
  tunnelSpan: TunnelSpan | null;
  /**
   * Route-anchor Y, taken at generation time from the smoothed route height
   * at the nearest route sample point. Stands in as `terrainHeight` until the
   * first real sample and is the reference for the height diagnostics
   * (`deltaFromAnchor`). Raycasts are no longer validated against it.
   */
  routeAnchorY: number;
  /**
   * Sampling state of `terrainHeight`. See `CellSample`. Written only by
   * `RouteCellSampler`. Convenience read: `cell.sample.state === 'stable'`.
   */
  sample: CellSample;
  /**
   * The cell has a height to stand on: `sample.state` is `stable` or
   * `filled`. Kept as a property (rather than a getter) for hot-path read
   * access. Set in lockstep by `RouteCellSampler`.
   */
  heightSampled: boolean;
  /** Set of enemies currently in this cell */
  enemies: Set<Enemy>;
  /** Map of tower ID -> visibility for ground targets (true = can see this cell) */
  towerVisibility: Map<string, boolean>;
  /** Map of tower ID -> visibility for air targets (raycast against the air sample altitude) */
  airVisibility: Map<string, boolean>;
}

/**
 * Where a tunnel cell takes its height from: the ground at the two portals
 * of the tunnel stretch it lies in (local x, z, just outside the mouths),
 * `f` of the way from `a` to `b`.
 */
export interface TunnelSpan {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  f: number;
}

/**
 * Single-source-of-truth for the LOS air-sample altitude of a cell.
 * Used by the layer-builder (per-tower visibility shader), the
 * air-route-tube debug overlay, and any future air-targeting code that
 * needs the canonical sample-Y. Keep this in lock-step with
 * `tower-los-layer-builder.ts` which inlines the same formula.
 */
export function getAirTargetY(cell: RouteCell): number {
  return cell.terrainHeight + LOS_VIZ_CONFIG.airSampleYOffset;
}

/**
 * Single-source-of-truth for the LOS ground-sample altitude of a cell:
 * `groundSampleYOffset` above its ground. Above a cell the step check put
 * on the street in front of a parked car, a van or a hedge, the probe stays
 * above the object's top (`sample.stepTop`), where it was before the check:
 * at street height it lies in the object, and the cube calls the cell
 * blocked for any tower. Enemies there still walk and are drawn at
 * `terrainHeight`. A cell the roof check clamped probes above its ground.
 * Used by the grid's LOS resolve, the layer-builder and the LOS debugger.
 */
export function getGroundTargetY(cell: RouteCell): number {
  return (cell.sample.stepTop ?? cell.terrainHeight) + LOS_VIZ_CONFIG.groundSampleYOffset;
}
