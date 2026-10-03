import { LosResolveContext, isCubeVisible } from './gpu-cube-resolve';
import { RouteCell, getAirTargetY, getGroundTargetY } from './route-cell';

/**
 * Per-tower LOS answers on the route cells, resolved against the GPU cube
 * of the tower (TowerShadowMapper). GlobalRouteGrid.registerTower and
 * registerTowerIncremental run these over the cells in the tower's reach:
 * every cell whose square touches the range disc, not only those whose
 * centre lies in it, so an enemy in range always stands in a cell with an
 * answer (decision D2, SIMULATOR_PLAN.md). The cells are frozen when a
 * tower is placed (CorridorBuild), so their heights are the ones the
 * answers are for, once and for good.
 *
 * `standY` is the height enemies stand on in a cell
 * (GlobalRouteGrid.getGroundLocalYAt at its centre). For a cell with a
 * height that is its own; for one without, the anchor it holds can lie far
 * off where the enemies walk, and the answers go by what they walk on.
 */

/**
 * Does the cube from the tip in `ctx` see the ground sample of `cell` (1.5 m
 * above where enemies stand), or with `air` the air sample (15 m)? The cell
 * under the tower always counts as seen.
 */
export function cellInSight(
  cell: RouteCell,
  air: boolean,
  towerX: number,
  towerZ: number,
  ctx: LosResolveContext,
  standY: (cell: RouteCell) => number,
): boolean {
  if ((cell.x - towerX) ** 2 + (cell.z - towerZ) ** 2 < 0.01) return true;
  const targetY = air ? getAirTargetY(cell, standY(cell)) : getGroundTargetY(cell, standY(cell));
  const tip = ctx.referencePos;
  return isCubeVisible(tip.x, tip.y, tip.z, cell.x, targetY, cell.z, ctx);
}

/** What a tower would see from a spot, in cells, without booking it into the cells (sightFrom) */
export interface SightCount {
  /** Cells in its reach */
  readonly reach: number;
  /** Cells whose ground sample it sees, 0 for a tower that cannot target ground */
  readonly ground: number;
  /** Cells whose air sample it sees, 0 for a tower that cannot target air */
  readonly air: number;
}

/**
 * Count what the cube in `ctx` sees of `candidates`, the same test the
 * tower's own LOS runs (cellInSight), but the cells keep no answer: the bot
 * asks this of spots it might build on (docs/BOT_PLAYER_PLAN.md, B2).
 */
export function countSight(
  candidates: readonly RouteCell[],
  towerX: number,
  towerZ: number,
  ctx: LosResolveContext,
  canTargetGround: boolean,
  canTargetAir: boolean,
  standY: (cell: RouteCell) => number,
): SightCount {
  let ground = 0;
  let air = 0;
  for (const cell of candidates) {
    if (canTargetGround && cellInSight(cell, false, towerX, towerZ, ctx, standY)) ground++;
    if (canTargetAir && cellInSight(cell, true, towerX, towerZ, ctx, standY)) air++;
  }
  return { reach: candidates.length, ground, air };
}

/**
 * Compute LOS for every cell of `candidates`, the cells in the tower's reach.
 * Pre-computes ground LOS and/or air LOS depending on the tower's targeting
 * capabilities.
 *
 * Visible cells are the UNION of ground- and air-visible cells: a cell
 * counts as visible if the tower can see *something* in it (ground level
 * OR the air sample altitude), so the tower-targeting fast path picks up
 * enemies of either type.
 *
 * @param candidates Cells in the tower's reach (GlobalRouteGrid.cellsInReach)
 * @param ctx GPU-cube resolve context (built by caller via TowerShadowMapper)
 * @param standY Height enemies stand on in a cell
 * @returns the cells the tower can see something in
 */
export function resolveTowerLos(
  candidates: Iterable<RouteCell>,
  towerId: string,
  towerX: number,
  towerZ: number,
  ctx: LosResolveContext,
  canTargetGround: boolean,
  canTargetAir: boolean,
  standY: (cell: RouteCell) => number,
): RouteCell[] {
  const visibleCells: RouteCell[] = [];

  for (const cell of candidates) {
    // Ground visibility — GPU-cube sample at getGroundTargetY (ground + 1.5m)
    let groundVisible = false;
    if (canTargetGround) {
      groundVisible = cellInSight(cell, false, towerX, towerZ, ctx, standY);
      cell.towerVisibility.set(towerId, groundVisible);
    }

    // Air visibility — GPU-cube sample at getAirTargetY (ground + 15m)
    let airVisible = false;
    if (canTargetAir) {
      airVisible = cellInSight(cell, true, towerX, towerZ, ctx, standY);
      cell.airVisibility.set(towerId, airVisible);
    }

    if (groundVisible || airVisible) {
      visibleCells.push(cell);
    }
  }

  return visibleCells;
}

/**
 * resolveTowerLos after a range change (e.g. range upgrade) without
 * discarding existing LOS data.
 *
 * For cells already having an entry for this tower (in either visibility
 * map), the cached value is reused, no GPU sample: the cells and their
 * heights do not change while a tower stands. The reach only grows (range
 * upgrades), so every earlier entry lies in `candidates`.
 *
 * This means a range-upgrade only samples the *new* cells (the ring
 * between old and new reach), not the entire disc. The answers then come
 * from cubes of different moments; the tower's LosMask records the result,
 * which is what a re-simulation applies.
 */
export function resolveTowerLosIncremental(
  candidates: Iterable<RouteCell>,
  towerId: string,
  towerX: number,
  towerZ: number,
  ctx: LosResolveContext,
  canTargetGround: boolean,
  canTargetAir: boolean,
  standY: (cell: RouteCell) => number,
): RouteCell[] {
  const visibleCells: RouteCell[] = [];

  for (const cell of candidates) {
    // Ground visibility — reuse cached value if present, otherwise GPU-sample
    let groundVisible = false;
    if (canTargetGround) {
      if (cell.towerVisibility.has(towerId)) {
        groundVisible = cell.towerVisibility.get(towerId)!;
      } else {
        groundVisible = cellInSight(cell, false, towerX, towerZ, ctx, standY);
        cell.towerVisibility.set(towerId, groundVisible);
      }
    } else {
      // Capability removed — drop any stale entry
      cell.towerVisibility.delete(towerId);
    }

    // Air visibility — reuse cached value if present, otherwise GPU-sample
    let airVisible = false;
    if (canTargetAir) {
      if (cell.airVisibility.has(towerId)) {
        airVisible = cell.airVisibility.get(towerId)!;
      } else {
        airVisible = cellInSight(cell, true, towerX, towerZ, ctx, standY);
        cell.airVisibility.set(towerId, airVisible);
      }
    } else {
      cell.airVisibility.delete(towerId);
    }

    if (groundVisible || airVisible) {
      visibleCells.push(cell);
    }
  }

  return visibleCells;
}
