import { LosResolveContext, isCubeVisible } from './gpu-cube-resolve';
import { RouteCell, getAirTargetY, getGroundTargetY } from './route-cell';

/**
 * Per-tower LOS answers on the route cells, resolved against the GPU cube
 * of the tower (TowerShadowMapper). GlobalRouteGrid.registerTower and
 * registerTowerIncremental run these over the cells in the tower's range
 * box. The cells are frozen when a tower is placed (CorridorBuild), so their
 * heights are the ones the answers are for, once and for good.
 */

/**
 * Compute LOS for every cell of `candidates` within `range` of the tower.
 * Pre-computes ground LOS and/or air LOS depending on the tower's targeting
 * capabilities.
 *
 * Visible cells are the UNION of ground- and air-visible cells: a cell
 * counts as visible if the tower can see *something* in it (ground level
 * OR the air sample altitude), so the tower-targeting fast path picks up
 * enemies of either type.
 *
 * @param candidates Cells whose centre can lie in range (the range box)
 * @param ctx GPU-cube resolve context (built by caller via TowerShadowMapper)
 * @returns the cells the tower can see something in
 */
export function resolveTowerLos(
  candidates: Iterable<RouteCell>,
  towerId: string,
  towerX: number,
  towerZ: number,
  range: number,
  ctx: LosResolveContext,
  canTargetGround: boolean,
  canTargetAir: boolean,
): RouteCell[] {
  const visibleCells: RouteCell[] = [];
  const rangeSq = range * range;
  const tipX = ctx.referencePos.x;
  const tipY = ctx.referencePos.y;
  const tipZ = ctx.referencePos.z;

  for (const cell of candidates) {
    const distSq = (cell.x - towerX) ** 2 + (cell.z - towerZ) ** 2;
    if (distSq > rangeSq) continue;

    const atTower = distSq < 0.01;

    // Ground visibility — GPU-cube sample at getGroundTargetY(cell) (terrain + 1.5m)
    let groundVisible = false;
    if (canTargetGround) {
      if (atTower) {
        groundVisible = true;
      } else {
        const targetY = getGroundTargetY(cell);
        groundVisible = isCubeVisible(tipX, tipY, tipZ, cell.x, targetY, cell.z, ctx);
      }
      cell.towerVisibility.set(towerId, groundVisible);
    }

    // Air visibility — GPU-cube sample at getAirTargetY(cell) (terrain + 15m)
    let airVisible = false;
    if (canTargetAir) {
      if (atTower) {
        airVisible = true;
      } else {
        const targetY = getAirTargetY(cell);
        airVisible = isCubeVisible(tipX, tipY, tipZ, cell.x, targetY, cell.z, ctx);
      }
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
 * heights do not change while a tower stands. Cells in the box but outside
 * the new range with a stale entry get cleaned up.
 *
 * This means a range-upgrade only samples the *new* cells (the annulus
 * between old and new range), not the entire disc.
 */
export function resolveTowerLosIncremental(
  candidates: Iterable<RouteCell>,
  towerId: string,
  towerX: number,
  towerZ: number,
  range: number,
  ctx: LosResolveContext,
  canTargetGround: boolean,
  canTargetAir: boolean,
): RouteCell[] {
  const visibleCells: RouteCell[] = [];
  const rangeSq = range * range;
  const tipX = ctx.referencePos.x;
  const tipY = ctx.referencePos.y;
  const tipZ = ctx.referencePos.z;

  for (const cell of candidates) {
    const distSq = (cell.x - towerX) ** 2 + (cell.z - towerZ) ** 2;
    const inRange = distSq <= rangeSq;

    if (!inRange) {
      // In-box but outside the exact circle — clean up any stale entry.
      cell.towerVisibility.delete(towerId);
      cell.airVisibility.delete(towerId);
      continue;
    }

    const atTower = distSq < 0.01;

    // Ground visibility — reuse cached value if present, otherwise GPU-sample
    let groundVisible = false;
    if (canTargetGround) {
      if (cell.towerVisibility.has(towerId)) {
        groundVisible = cell.towerVisibility.get(towerId)!;
      } else if (atTower) {
        groundVisible = true;
        cell.towerVisibility.set(towerId, groundVisible);
      } else {
        const targetY = getGroundTargetY(cell);
        groundVisible = isCubeVisible(tipX, tipY, tipZ, cell.x, targetY, cell.z, ctx);
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
      } else if (atTower) {
        airVisible = true;
        cell.airVisibility.set(towerId, airVisible);
      } else {
        const targetY = getAirTargetY(cell);
        airVisible = isCubeVisible(tipX, tipY, tipZ, cell.x, targetY, cell.z, ctx);
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
