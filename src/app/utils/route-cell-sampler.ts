import { ColumnSample, ColumnSampler, TerrainPeekLOD, isBetterLod } from '../three-engine/column-sample';
import { RouteCell, TunnelSpan } from './route-cell';
import { carriedDeckY, surfaceY } from './deck-approach';
import { corridorConfig } from './route-corridor';
import { TUNNEL_PORTAL_OFFSET_M } from './route-grid-builder';
import { logGrid } from './route-grid-log';

/** What one column gives a cell, see RouteCellSampler.hitOf. */
interface CellHit {
  y: number;
  tileDepth: number;
  tileGeometricError: number;
}

/**
 * Terrain-Sampling einer einzelnen Route-Cell. Einzige Stelle, die
 * `cell.terrainHeight` und `cell.sample` schreibt, nachdem die Cell im
 * Grid liegt: `sampleCellY`, dazu der Debug-Reset `resetToUnsampled`.
 *
 * Hält die beiden Terrain-Proben, die `GlobalRouteGrid.initialize` setzt,
 * und die Zähler, die der Terrain-Sweep des Grids auswertet. Die
 * Nachbarschaft einer Cell kennt nur das Grid, darum kommt der
 * Nachbar-Median für den Ausreißer-Test als Funktion herein.
 */
export class RouteCellSampler {
  /**
   * The one terrain probe. Returns ground plus tile-LOD metadata for a
   * vertical column; `sampleCellY` records that LOD on the cell, so a dump
   * tells which tile a cell's height came from.
   */
  columnSampler: ColumnSampler | null = null;

  /**
   * Cheap LOD probe — the best tile LOD loaded at (x,z) WITHOUT raycasting.
   * `sampleCellY` uses it to skip a column that cannot succeed anyway,
   * where no tile mesh is decoded at the point yet. Optional: without it
   * every call casts its column.
   */
  terrainPeekLOD: TerrainPeekLOD | null = null;

  // ── Diagnostic counters, incremented from `sampleCellY` ─────────────
  // Columns skipped because no tile mesh was loaded at the point, and
  // columns actually cast.
  peekSkipCount = 0;
  raycastCount = 0;

  /** Monotonic counter incremented on each successful sample (debug only). */
  sampleFrame = 0;

  /**
   * A hit further than this from the median of its comparable stable
   * neighbours is no ground, see sampleCellY.
   */
  static readonly OUTLIER_M = 50;

  /**
   * Median der stabilen Nachbar-Cells aus Tiles mindestens `minDepth` tief,
   * `null` bei zu wenig Nachbarn.
   */
  private readonly neighbourMedian: (cell: RouteCell, minDepth: number) => number | null;

  /** The height a cell takes instead of the hit `y`, null to keep it; see sampleCellY. */
  private readonly replaceHit: ((cell: RouteCell, y: number) => number | null) | null;

  /** The ground a tunnel portal at (x, z) takes instead of the ground `y` of its column, null to keep it; see tunnelColumn. */
  private readonly replacePortal: ((x: number, z: number, y: number) => number | null) | null;

  /**
   * @param neighbourMedian `GlobalRouteGrid.medianOfStableNeighbourY`.
   *   Läuft nur, wenn die Säule getroffen hat.
   * @param replaceHit The grid's rule for a hit the cell must not keep:
   *   streetUnderRoof in corridor-walk.ts, for the cells the route centre
   *   line runs through. Asked for every hit a cell would take.
   * @param replacePortal The same rule at a tunnel portal:
   *   streetUnderRoofAt in corridor-walk.ts.
   */
  constructor(
    neighbourMedian: (cell: RouteCell, minDepth: number) => number | null,
    replaceHit: ((cell: RouteCell, y: number) => number | null) | null = null,
    replacePortal: ((x: number, z: number, y: number) => number | null) | null = null,
  ) {
    this.neighbourMedian = neighbourMedian;
    this.replaceHit = replaceHit;
    this.replacePortal = replacePortal;
  }

  // ========================================
  // SAMPLE — SINGLE SOURCE OF TRUTH FOR cell.terrainHeight
  // ========================================

  /**
   * Attempt to write `cell.terrainHeight` from a fresh terrain raycast.
   *
   * **Apart from the debug reset {@link resetToUnsampled}, this is the ONLY
   * function in the codebase that writes `cell.terrainHeight` after a cell
   * has been added to the grid.** All other call sites read the cached value. The single-source-of-truth
   * invariant lets us reason about cell state without tracking who-wrote-
   * what-when across the grid / tower-reg / viz pathways.
   *
   * A cell is sampled when the grid generates it, and again only through
   * `GlobalRouteGrid.retryUnsampledCells`, for a cell without a sample of
   * its own: the corridor build runs that on the fallback level and then
   * freezes the cells (CorridorBuild). No tile load, camera move or tower
   * samples a cell afterwards.
   *
   *  - If no column at the cell centre or half a metre beside it (a seam
   *    between two tile meshes) gives a hit its neighbours accept
   *    (plausible): `cell.sample` and `cell.terrainHeight` keep what they
   *    had (anchor fallback for an unsampled cell).
   *  - If the column hits: `cell.terrainHeight` and `cell.sample` are
   *    updated, `cell.heightSampled` mirrors `state === 'stable'`.
   *
   * @returns `true` when the cell was promoted to / refreshed in `stable`.
   */
  sampleCellY(cell: RouteCell): boolean {
    // Peek the best LOD loaded at this (x,z) WITHOUT raycasting, and skip a
    // column that cannot succeed:
    //
    //  - peek === null: no loaded tile horizontally contains (x,z) → the
    //    column would miss anyway.
    //  - peek.depth === 0 or geometricError === Infinity: tile is in the map
    //    but its mesh isn't decoded yet → the column would land in the noLOD
    //    reject branch below. Catches the bootstrap-phase spike where
    //    1700+ raycasts run before any tile has usable LOD info.
    if (this.terrainPeekLOD !== null && this.columnSampler !== null) {
      const peek = this.terrainPeekLOD(cell.x, cell.z);

      // No usable LOD info at this point → raycast cannot succeed.
      if (peek === null || peek.depth === 0 || peek.geometricError === Infinity) {
        this.peekSkipCount++;
        return false;
      }
    }

    // The column at the cell centre, or, where that finds no tile or only a
    // hit its neighbours refuse (plausible), the first column half a metre
    // beside it that gives one: a seam between two tile meshes lets the
    // centre column find nothing or come down on something far below. At
    // most four more column probes, only for such a cell. A column already
    // discards hits without usable LOD info (undecoded tile meshes) and
    // resolves ground against the finest LOD in it. A tunnel cell takes its
    // portals instead. A cell on the stretch off a bridge end compares with
    // the height the route carries there from that end (carriedDeckY), and
    // like a tunnel cell waits for a column at the bridge end.
    this.raycastCount++;
    const sampler = this.columnSampler;
    if (sampler === null) return false;

    let hit: CellHit | null = null;
    let found = false;
    if (cell.surface === 'tunnel' && cell.tunnelSpan) {
      const column = this.tunnelColumn(cell.tunnelSpan);
      found = column !== null;
      if (column !== null) hit = this.plausible(cell, this.hitOf(cell, column, null, null));
    } else {
      const deckEnd = cell.surface === 'approach' ? cell.deckEnd : null;
      const deck = deckEnd ? this.columnNear(deckEnd.path[0].x, deckEnd.path[0].z) : null;
      const carried = deckEnd && deck ? carriedDeckY(deckEnd, (x, z) => this.columnNear(x, z)) : null;
      for (const [dx, dz] of RouteCellSampler.CELL_PROBES_M) {
        if (deckEnd !== null && deck === null) break;
        const column = sampler(cell.x + dx, cell.z + dz);
        if (column === null) continue;
        found = true;
        hit = this.plausible(cell, this.hitOf(cell, column, deck, carried));
        if (hit !== null) break;
      }
    }
    if (hit === null) {
      if (!found) logGrid('SAMPLE', `miss key=${cell.key}`);
      return false;
    }
    // A cell the route centre line runs through whose column came down on
    // a jetty, an oriel or a roof corner takes the street instead
    // (replaceHit). With its LOD, so the sweep leaves it until a finer
    // tile shows something else.
    const replaced = this.replaceHit?.(cell, hit.y) ?? null;
    if (replaced !== null) hit = { ...hit, y: replaced };

    cell.terrainHeight = hit.y;
    cell.sample = {
      state: 'stable',
      sampledAt: ++this.sampleFrame,
      tileDepth: hit.tileDepth,
      tileGeometricError: hit.tileGeometricError,
    };
    cell.heightSampled = true;
    logGrid(
      'SAMPLE',
      `promote key=${cell.key} y=${hit.y.toFixed(2)} depth=${hit.tileDepth} err=${hit.tileGeometricError.toFixed(2)}`,
    );
    return true;
  }

  /**
   * Where a probe looks, one after the other: the point itself, then half a
   * metre either way along each axis. A seam between two tile meshes is far
   * thinner; the engine caches columns in 0.5 m buckets, so each is a
   * column of its own.
   */
  private static readonly CELL_PROBES_M: readonly (readonly [number, number])[] = [
    [0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5],
  ];

  /**
   * The column at (x, z), or, where that finds no tile (a seam between two
   * tile meshes), the first column half a metre beside it that does. At
   * most four more column probes, only where the one at (x, z) comes back
   * empty. The portals of a tunnel take theirs from here, and so does the
   * walk check of the corridor (corridor-walk.ts).
   */
  columnNear(x: number, z: number): ColumnSample | null {
    const sampler = this.columnSampler;
    if (sampler === null) return null;
    for (const [dx, dz] of RouteCellSampler.CELL_PROBES_M) {
      const column = sampler(x + dx, z + dz);
      if (column !== null) return column;
    }
    return null;
  }

  /**
   * The height `column` gives `cell`: a bridge deck is the top of its
   * column, the ground is the bottom. On the stretch off a bridge end
   * (`deck`, the column at that end) the hit nearest to the height the
   * route carries there (`carried`, deckApproachY), with the coarser LOD of
   * the two columns, so the cell is sampled again once the bridge end has a
   * finer tile; the columns carriedDeckY reads between the two do not count
   * in it. Under a flat roof the bottom is usually the street: playtest
   * 2026-09-14 (Tokyo), roofs at 70.5 to 99.3 m had their column's ground at
   * 39.5 to 39.9 m. A column at the corridor edge can still come down on a
   * roof, an eave, a crown or a parked car with no ground showing under it;
   * the cell keeps that height, and the corridor ends before such a cell
   * instead (corridor-walk.ts).
   */
  private hitOf(cell: RouteCell, column: ColumnSample, deck: ColumnSample | null, carried: number | null): CellHit {
    // A tunnel cell's column is already the one between its portals (tunnelColumn).
    const y = cell.surface === 'tunnel' ? column.groundY : surfaceY(cell.surface, column, carried) ?? column.groundY;
    if (deck !== null) {
      return {
        y,
        tileDepth: Math.min(column.tileDepth, deck.tileDepth),
        tileGeometricError: Math.max(column.tileGeometricError, deck.tileGeometricError),
      };
    }
    return { y, tileDepth: column.tileDepth, tileGeometricError: column.tileGeometricError };
  }

  /**
   * `hit`, or null where it diverges more than OUTLIER_M from the local
   * stable-neighbour median. Catches localised outlier clusters where the
   * tile engine returns a bad hit (BBox / backface / water) for one region
   * while surrounding cells are correct, and a column that went through a
   * seam and came down far below (playtest 2026-09-13: -3542 m among cells
   * at 243 m). 50m is comfortable above realistic slopes (Salzburg case:
   * max 63m at a tunnel, which we want to reject).
   *
   * For a first sample, or one from a strictly better tile than the cell
   * already had, only neighbours sampled from tiles at least as deep as
   * this hit count. Neighbours sampled from coarser tiles agree with the
   * coarse hull, and letting them veto an upgrade is how a whole corridor
   * stays pinned to the block-level hull it was first sampled from. The
   * guard is there to catch a bad hit among comparable ones, not to defend
   * a coarse consensus.
   */
  private plausible(cell: RouteCell, hit: CellHit): CellHit | null {
    const isUpgrade =
      cell.sample.state !== 'stable' ||
      isBetterLod(
        { depth: hit.tileDepth, geometricError: hit.tileGeometricError },
        cell.sample,
      );
    const neighbourMedian = this.neighbourMedian(cell, isUpgrade ? hit.tileDepth : 0);
    if (neighbourMedian !== null && Math.abs(hit.y - neighbourMedian) > RouteCellSampler.OUTLIER_M) {
      logGrid(
        'SAMPLE',
        `reject reason=outlier key=${cell.key} y=${hit.y.toFixed(2)} medianN=${neighbourMedian.toFixed(2)}`,
      );
      return null;
    }
    return hit;
  }

  /**
   * The column a tunnel cell stands on. Its own column sees only the ground
   * or roof above the tunnel, so: the ground at the two portals of its
   * stretch, interpolated along it, with the coarser of the two LODs. A
   * portal whose column came down on a roof over the street (a jetty, the
   * house the passage runs through) takes the street around it instead
   * (replacePortal), so the cells no longer climb towards it. Between the
   * portals, columns that show the street under what covers it carry the
   * line (supportedY). Null until both portals have a tile.
   */
  private tunnelColumn(span: TunnelSpan): ColumnSample | null {
    const a = this.columnNear(span.ax, span.az);
    const b = this.columnNear(span.bx, span.bz);
    if (a === null || b === null) return null;
    const ay = this.replacePortal?.(span.ax, span.az, a.groundY) ?? a.groundY;
    const by = this.replacePortal?.(span.bx, span.bz, b.groundY) ?? b.groundY;
    const y = this.supportedY(span, ay, by);
    return {
      groundY: y,
      topY: y,
      tileDepth: Math.min(a.tileDepth, b.tileDepth),
      tileGeometricError: Math.max(a.tileGeometricError, b.tileGeometricError),
    };
  }

  /**
   * Metres between the points along a tunnel stretch whose columns may
   * carry its line (supportedY), one grid cell.
   */
  private static readonly SUPPORT_STEP_M = 2;

  /**
   * Longest tunnel stretch supportedY looks along, metres. Under a hill no
   * column shows the tunnel; an underpass under a motorway is some 40 m.
   */
  private static readonly SUPPORT_MAX_M = 100;

  /**
   * The height at `span.f` of the way from portal a (ground `ay`) to portal
   * b (`by`): on the line between them, or where columns between them show
   * the street under what covers it, on the line through the nearest such
   * column before and after the point. Such a column has something more than
   * `roofRise` over its lowest hit (a deck, a roof, a hill) and its lowest
   * hit at most `stepRise` above the line between the portals and at most
   * `roofRise` below it; one every SUPPORT_STEP_M on the straight line from
   * a to b, between the mouths (the portals stand for the ground outside
   * them, TUNNEL_PORTAL_OFFSET_M), on stretches up to SUPPORT_MAX_M.
   *
   * Playtest 2026-09-15, Erlenbach (D2): under the A6 the photogrammetry is
   * filled down to the ground but for a few columns at the edges of the
   * deck, which show the street 5.6 and 5.9 m under it. A street lowered
   * under a bridge lies below the line between the portals; a car parked
   * under it, with no ground under its roof, lies above and does not count,
   * nor does a column with a single surface (a jetty, the ground outside a
   * mouth). Their LOD does not count in the cell's.
   */
  private supportedY(span: TunnelSpan, ay: number, by: number): number {
    const length = Math.hypot(span.bx - span.ax, span.bz - span.az);
    let lo = { f: 0, y: ay };
    let hi = { f: 1, y: by };
    if (length <= RouteCellSampler.SUPPORT_MAX_M) {
      const { roofRise, stepRise } = corridorConfig;
      for (let m = RouteCellSampler.SUPPORT_STEP_M; m < length - TUNNEL_PORTAL_OFFSET_M; m += RouteCellSampler.SUPPORT_STEP_M) {
        if (m <= TUNNEL_PORTAL_OFFSET_M) continue;
        const f = m / length;
        const column = this.columnNear(span.ax + (span.bx - span.ax) * f, span.az + (span.bz - span.az) * f);
        if (column === null || column.topY - column.groundY <= roofRise) continue;
        const line = ay + (by - ay) * f;
        if (column.groundY > line + stepRise || column.groundY < line - roofRise) continue;
        if (f <= span.f) {
          lo = { f, y: column.groundY };
        } else {
          hi = { f, y: column.groundY };
          break;
        }
      }
    }
    return hi.f > lo.f ? lo.y + ((hi.y - lo.y) * (span.f - lo.f)) / (hi.f - lo.f) : lo.y;
  }

  /**
   * Gives a cell without a usable sample of its own the height its grid
   * interpolated between stable neighbours (GlobalRouteGrid.fillGaps). The
   * state is `filled`, not `stable`: sampleCellY keeps trying the cell like
   * an unsampled one and replaces the height with the first sample it
   * accepts. No tile LOD: the height is the neighbours', not a column's.
   *
   * @returns true when the height or the state changed.
   */
  fill(cell: RouteCell, y: number): boolean {
    if (cell.sample.state === 'filled' && Math.abs(cell.terrainHeight - y) < 0.01) return false;
    cell.terrainHeight = y;
    cell.sample = {
      state: 'filled',
      sampledAt: cell.sample.sampledAt,
      tileDepth: 0,
      tileGeometricError: Infinity,
    };
    cell.heightSampled = true;
    logGrid('SAMPLE', `fill key=${cell.key} y=${y.toFixed(2)}`);
    return true;
  }

  /**
   * Setzt eine Cell auf `unsampled` zurück, die Höhe fällt auf den
   * Route-Anker. Nur für den Debug-Reset `__rg.resetHeightsAndRetry`; der
   * nächste `sampleCellY` promotet die Cell wieder, sobald die Probe trifft.
   */
  resetToUnsampled(cell: RouteCell): void {
    cell.sample = {
      state: 'unsampled',
      sampledAt: 0,
      tileDepth: 0,
      tileGeometricError: Infinity,
    };
    cell.heightSampled = false;
    cell.terrainHeight = cell.routeAnchorY;
  }
}
