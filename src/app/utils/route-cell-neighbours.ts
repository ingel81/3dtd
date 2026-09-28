import type { RouteCell } from './route-cell';
import type { RouteCellLattice } from './route-grid-builder';

/** Numeric ascending order for Array.prototype.sort, hoisted so hot paths allocate no comparator. */
const ascending = (a: number, b: number): number => a - b;

/** Opposite neighbours heightBetween interpolates between: west-east, south-north and the two diagonals. */
const FILL_PAIRS: readonly (readonly [number, number])[] = [[1, 0], [0, 1], [1, 1], [1, -1]];

/**
 * Heights from a cell's neighbours in the route grid (GlobalRouteGrid): the
 * median of the stable ones around it, the mean between opposite pairs, and
 * an estimate anywhere from the sampled cells nearby. Reads the grid's cells,
 * allocates nothing per call.
 */
export class RouteCellNeighbours {
  /** Reused sample buffer for medianOfStable. */
  private readonly medianScratch: number[] = [];
  /** Reused sample buffer for estimateY, which runs per enemy per sub-step in unsampled cells. */
  private readonly estimateScratch: number[] = [];

  constructor(
    private readonly cells: ReadonlyMap<number, RouteCell>,
    private readonly lattice: RouteCellLattice,
  ) {}

  /**
   * Median `terrainHeight` of the 8 adjacent stable cells of the same
   * surface sampled from a tile at least `minDepth` deep. Returns `null`
   * when fewer than 3 such neighbours exist: not enough signal for a
   * meaningful sanity check. Used by `sampleCellY` to reject hits that
   * diverge wildly from the local terrain. Same surface: a street under a
   * bridge lies a deck height below the deck cells around it.
   */
  medianOfStable(cell: RouteCell, minDepth = 0): number | null {
    const gx = this.lattice.index(cell.x);
    const gz = this.lattice.index(cell.z);
    const samples = this.medianScratch;
    samples.length = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        const n = this.cells.get(this.lattice.key(gx + dx, gz + dz));
        if (n && n.sample.state === 'stable' && n.surface === cell.surface && n.sample.tileDepth >= minDepth) {
          samples.push(n.terrainHeight);
        }
      }
    }
    if (samples.length < 3) return null;
    samples.sort(ascending);
    return samples[Math.floor(samples.length / 2)];
  }

  /** Mean over the opposite pairs of stable neighbours of `cell`'s surface around it, null without such a pair. */
  heightBetween(cell: RouteCell): number | null {
    const gx = this.lattice.index(cell.x);
    const gz = this.lattice.index(cell.z);
    let sum = 0;
    let pairs = 0;
    for (const [dx, dz] of FILL_PAIRS) {
      const a = this.cells.get(this.lattice.key(gx + dx, gz + dz));
      const b = this.cells.get(this.lattice.key(gx - dx, gz - dz));
      if (!a || !b || a.sample.state !== 'stable' || b.sample.state !== 'stable') continue;
      if (a.surface !== cell.surface || b.surface !== cell.surface) continue;
      sum += (a.terrainHeight + b.terrainHeight) / 2;
      pairs++;
    }
    return pairs > 0 ? sum / pairs : null;
  }

  /**
   * Best-effort terrain-Y estimate at an arbitrary local (x, z) using
   * the nearest sampled cells. Falls back through 3×3 then 5×5 ring
   * before giving up. Used by visual consumers (air-route tube, future
   * fallback paths) so a single unsampled cell in an otherwise-sampled
   * grid doesn't pull the viz down to `routeAnchorY` (which is often 0).
   */
  estimateY(x: number, z: number): number | null {
    const gx = this.lattice.index(x);
    const gz = this.lattice.index(z);
    const samples = this.estimateScratch;
    samples.length = 0;
    // 3×3 ring around the target cell (incl. centre).
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const n = this.cells.get(this.lattice.key(gx + dx, gz + dz));
        if (n && n.heightSampled) samples.push(n.terrainHeight);
      }
    }
    if (samples.length === 0) {
      // Expand to 5×5 ring (skip cells already visited).
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) continue;
          const n = this.cells.get(this.lattice.key(gx + dx, gz + dz));
          if (n && n.heightSampled) samples.push(n.terrainHeight);
        }
      }
    }
    if (samples.length === 0) return null;
    samples.sort(ascending);
    return samples[Math.floor(samples.length / 2)];
  }
}
