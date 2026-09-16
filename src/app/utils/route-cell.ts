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
   *   cells of its surface (a seam between two tile meshes) or touches at
   *   least three of them (a hole at the edge of the corridor), and
   *   `terrainHeight` is taken from them (GlobalRouteGrid fillGaps); or a
   *   tunnel cell whose portal without a hit stands on the street of the
   *   band (RouteCellSampler.tunnelColumn). Counts as having a height;
   *   sampling keeps trying it like an unsampled cell.
   * `stable`: terrain raycast returned a hit; `terrainHeight` is real.
   */
  state: 'unsampled' | 'filled' | 'stable';
  /** Internal frame counter at last successful sample (debug only). */
  sampledAt: number;
  /** 3D Tiles tile depth at last sample. Higher = better LOD. 0 if unknown. */
  tileDepth: number;
  /** Tile geometricError at last sample. Lower = better LOD. Infinity if unknown. */
  tileGeometricError: number;
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
   * Equal to x, z for most cells the centre line runs through; where it only
   * clips a corner, the nearest point can lie in the spot beside it. The
   * walk check of the corridor starts there (cellWalkable, corridor-walk.ts).
   */
  axisX: number;
  axisZ: number;
  /** Terrain height at cell center (local Y coordinate) */
  terrainHeight: number;
  /**
   * Which surface of the column the cell stands on: `ground` is the lowest
   * hit, `deck` the highest, the deck of a bridge the route crosses rather
   * than the river or road below it. `approach`: on the route off a bridge
   * end, near it (carried-height.ts), the hit nearest to the height the route
   * carries there from the bridge end (`onApproach`), the deck carried on over
   * a quay or road below, the ground of a street or stairs on their own.
   * `tunnel`: none of them, the cell lies in a tunnel or covered passage
   * and takes its height between the portals (`tunnelSpan`). Set at
   * generation from the OSM tags of the segments that reach the cell, read
   * by `sampleCellY`.
   */
  surface: 'ground' | 'approach' | 'deck' | 'tunnel';
  /** Portals a `tunnel` cell takes its height between; null on every other cell. */
  tunnelSpan: TunnelSpan | null;
  /**
   * Where an `approach` cell lies on the route off a bridge end: the height
   * the route carries there (carriedY) is what its hits compare with
   * (approachY). Null on every other cell.
   */
  onApproach: ApproachPoint | null;
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
  /** The stretch is a passage under an obstacle on the centre line (RouteWaypoint.passage), not a tunnel from OSM. */
  passage?: boolean;
}

/**
 * A point on the route off a bridge end, see RouteCell.onApproach: `path`,
 * the route from the bridge end on, local x, z, its first point the bridge
 * end; `m`, how far along it the point lies, metres.
 */
export interface ApproachPoint {
  path: readonly { x: number; z: number }[];
  m: number;
}

/**
 * Single-source-of-truth for the LOS air-sample altitude of a cell.
 * Used by the layer-builder (per-tower visibility shader), the
 * air-route-tube debug overlay, and any future air-targeting code that
 * needs the canonical sample-Y. Keep this in lock-step with
 * `tower-los-layer-builder.ts` which inlines the same formula.
 * `ground` is the height the enemies stand on in the cell, its own
 * height unless the caller knows better (a cell without one).
 */
export function getAirTargetY(cell: RouteCell, ground = cell.terrainHeight): number {
  return ground + LOS_VIZ_CONFIG.airSampleYOffset;
}

/**
 * Single-source-of-truth for the LOS ground-sample altitude of a cell:
 * `groundSampleYOffset` above its ground. Used by the grid's LOS resolve,
 * the layer-builder, the LOS debug service and the LOS debugger.
 * `ground` as in getAirTargetY.
 */
export function getGroundTargetY(cell: RouteCell, ground = cell.terrainHeight): number {
  return ground + LOS_VIZ_CONFIG.groundSampleYOffset;
}
