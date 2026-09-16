import type { ColumnSample } from '../three-engine/column-sample';
import type { RouteCell } from './route-cell';
import { corridorConfig, lowObjectTop } from './route-corridor';
import { type BandStation, offsetAt } from './corridor-band';

/**
 * Why a cell lies in the walkable band or beside it, for
 * `__corridor.pick()`.
 *
 * The band decides the corridor (corridor-band.ts): per station the
 * backbone, the lowest plausible cell across the line, and from it the walk
 * out to each side with step, drop, cross slope, hollow and roof check. Its
 * edges are what a route claims its cells within, so a cell beside the band
 * is one the band ends before. This file tells which rule of that walk it
 * was, off the frozen band and the columns, and gives a tunnel portal the
 * backbone instead of a hit on a roof over the street.
 *
 * Nothing here narrows the corridor any more: until 2026-09-16 the grid
 * named the cells an enemy could not walk to (`unwalkableCells`), every
 * station was capped short of the ones its piece of the corridor claimed
 * (`walkCaps`), and routes and cells were built again until nothing
 * narrowed. The band claims only the cells its walk reaches in the first
 * place.
 */

/** The column at a point, or half a metre beside it on a seam (RouteCellSampler.columnNear). */
export type ColumnAt = (x: number, z: number) => ColumnSample | null;

/** What the walk check reads: the grid's columns and the band of the routes in use. */
export interface WalkGround {
  /** The grid's column probe; the columns of the cells, cached by the engine. */
  column: ColumnAt;
  /**
   * The band station nearest to a local point over the routes in use
   * (PathAndRouteService.bandStationAt); null before a band is built.
   */
  station: (x: number, z: number) => BandStation | null;
}

/**
 * Why cellWalkable says what it says, for `__corridor.pick()`: `band`
 * (true), `hollow`, `roof`, `step` and `drop` (false, the rule of the walk
 * out the band ended on), `beyond the band` (false, further out for another
 * reason: the rays' wall, a bulge cut, the taper along the route), the rest
 * null. `passage`: a cell of a stretch run as a tunnel under something
 * filling the lane; `fixed stretch`: a bridge, a tunnel, the stretch off a
 * bridge end or the leg to the HQ, where the band decides nothing.
 */
export type WalkCheck =
  | 'band'
  | 'beyond the band'
  | 'hollow'
  | 'roof'
  | 'step'
  | 'drop'
  | 'passage'
  | 'fixed stretch'
  | 'deck or tunnel'
  | 'no sample'
  | 'coarse tile'
  | 'no band';

/** What the walk check found for one cell. */
export interface WalkJudgement {
  walkable: boolean | null;
  check: WalkCheck;
  /** Height of the cell over the backbone of its station, null where there is none. */
  overLine: number | null;
}

/** Whether an enemy could walk from the band's backbone out to `cell`, see judgeWalk. */
export function cellWalkable(cell: RouteCell, ground: WalkGround): boolean | null {
  return judgeWalk(cell, ground).walkable;
}

/**
 * Whether `cell` lies in the walkable band of its station, and why.
 *
 * True within the band's edges: the edge lies midway between the last cell
 * the walk reached and the first it did not, so every cell of the band lies
 * inside it and the one it ends before outside, whatever angle the line
 * across runs at. False beyond them, with the rule that ended the band: a
 * hollow object (a car the
 * photogrammetry made hollow, `lowObjectTop`), more than `roofRise` over
 * the backbone (a roof, an eave, a crown), more than `stepRise` above it (a
 * car, a hedge, a raised garden), more than `stepDrop` below it (an
 * embankment, a quay wall), else the rays' wall or the smoothing along the
 * route.
 *
 * Null where that cannot be told or would change nothing: a cell without a
 * sample of its own, one sampled from a tile coarser than `maxTileError`, a
 * deck or tunnel cell, a cell of a passage or of a stretch the band does
 * not decide, and every cell before a band is built.
 */
export function judgeWalk(cell: RouteCell, ground: WalkGround): WalkJudgement {
  const unjudged = (check: WalkCheck, overLine: number | null = null): WalkJudgement => ({ walkable: null, check, overLine });
  if (cell.surface === 'deck' || cell.surface === 'tunnel') return unjudged(cell.tunnelSpan?.passage ? 'passage' : 'deck or tunnel');
  if (cell.sample.state !== 'stable') return unjudged('no sample');
  if (cell.sample.tileGeometricError > corridorConfig.maxTileError) return unjudged('coarse tile');
  const station = ground.station(cell.x, cell.z);
  if (station === null) return unjudged('no band');
  if (station.kind === 'passage') return unjudged('passage');
  if (station.backbone === null) return unjudged('fixed stretch');

  const over = cell.terrainHeight - station.backbone.y;
  const offset = offsetAt(station, cell.x, cell.z);
  if (offset >= station.left && offset <= station.right) return { walkable: true, check: 'band', overLine: over };

  const { stepRise, stepDrop, roofRise } = corridorConfig;
  const own = ground.column(cell.x, cell.z);
  const check: WalkCheck = own !== null && lowObjectTop(own, own.groundY) !== null ? 'hollow'
    : over > roofRise ? 'roof'
    : over > stepRise ? 'step'
    : over < -stepDrop ? 'drop'
    : 'beyond the band';
  return { walkable: false, check, overLine: over };
}

/**
 * The ground a tunnel portal at (x, z) takes instead of the hit `y` of its
 * column: the street under the band station there (`street`, streetLevel),
 * where `y` lies more than `roofRise` above it or the column has no hit at
 * all (`y` null); else null, which keeps the hit
 * (RouteCellSampler.tunnelColumn).
 *
 * Without a hit: a portal whose column meets nothing, a hole in the mesh
 * or the underside of the eaves over a mouth, left every cell of the
 * stretch without a height, and the fallback level only helped where its
 * coarser mesh happened to have one. The street there is measured, from the
 * backbones of the stations around it.
 *
 * Two metres outside a mouth the column can come down on the jetty of the
 * house the passage runs through, or on the house itself where the OSM way
 * ends short of the opening, and every cell of the passage took its height
 * on the line between that and the other portal (playtest 2026-09-15,
 * Rothenburg, archway: the yellow cells climbed inside the passage, enemies
 * came out of the house on the other side).
 *
 * The street, not the backbone of that station: at a gate tower the mesh
 * reaches past the mouth, so the station outside it can be a passage itself
 * (no backbone) or have its own backbone on the tower, and the portal then
 * kept its hit on the roof (playtest 2026-09-16, Rothenburg, Weisser Turm).
 * `street` holds whatever the lane is covered by out of it.
 */
export function portalGround(x: number, z: number, y: number | null, ground: WalkGround): number | null {
  const street = ground.station(x, z)?.street ?? null;
  return street !== null && (y === null || y - street > corridorConfig.roofRise) ? street : null;
}
