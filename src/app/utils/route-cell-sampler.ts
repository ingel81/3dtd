import { ColumnSample, ColumnSampler, TerrainPeekLOD, isBetterLod } from '../three-engine/column-sample';
import { RouteCell, TunnelSpan } from './route-cell';
import { surfaceY } from './deck-approach';
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
   * vertical column; `sampleCellY` uses the LOD for quality-versioned
   * idempotency so a coarse streaming pass can never overwrite a finer
   * sample.
   */
  columnSampler: ColumnSampler | null = null;

  /**
   * Cheap LOD probe — returns the best tile LOD currently loaded at
   * (x,z) WITHOUT raycasting. Used by `sampleCellY` to skip the full
   * raycast when a stable cell's tile-LOD has not improved. When null,
   * `updateTerrainHeights` falls back to the legacy raycast-every-cell
   * behaviour.
   */
  terrainPeekLOD: TerrainPeekLOD | null = null;

  // ── Per-batch diagnostic counters ───────────────────────────────────
  // Reset by the grid at the start of each terrain sweep
  // (`beginTerrainHeightRefresh`) and incremented from `sampleCellY`. Read
  // by the grid after the sweep to log the skip-vs-raycast ratio — that's
  // how we verify Option C is actually doing what it claims.
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

  /**
   * @param neighbourMedian `GlobalRouteGrid.medianOfStableNeighbourY`.
   *   Läuft nur, wenn die Säule getroffen hat.
   * @param replaceHit The grid's rule for a hit the cell must not keep:
   *   streetUnderRoof in corridor-walk.ts, for the cells the route centre
   *   line runs through. Asked for every hit a cell would take.
   */
  constructor(
    neighbourMedian: (cell: RouteCell, minDepth: number) => number | null,
    replaceHit: ((cell: RouteCell, y: number) => number | null) | null = null,
  ) {
    this.neighbourMedian = neighbourMedian;
    this.replaceHit = replaceHit;
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
   * Phase 1 semantics:
   *  - If no column at the cell centre or half a metre beside it (a seam
   *    between two tile meshes) gives a hit its neighbours accept
   *    (plausible): `cell.sample` and `cell.terrainHeight` keep what they
   *    had (anchor fallback for an unsampled cell).
   *  - If raycast hits: `cell.terrainHeight` and `cell.sample` are updated,
   *    `cell.heightSampled` mirrors `state === 'stable'`.
   *
   * Phase 2 will add tile-LOD versioning (reject samples with strictly
   * worse `geometricError` than the cached one), making this fully
   * idempotent under streaming.
   *
   * @returns `true` when the cell was promoted to / refreshed in `stable`.
   */
  sampleCellY(cell: RouteCell): boolean {
    // Tile-LOD-aware early exit (Option C, perf/route-grid-tile-aware-update):
    // Peek the best LOD currently loaded at this (x,z) WITHOUT raycasting.
    // Skip the raycast when ANY of the following is true:
    //
    //  - peek === null: no loaded tile horizontally contains (x,z) → raycast
    //    would miss anyway.
    //  - peek.depth === 0 or geometricError === Infinity: tile is in the map
    //    but its mesh isn't decoded yet → raycast would land in the noLOD
    //    reject branch below. Catches the bootstrap-phase spike where
    //    1700+ raycasts run before any tile has usable LOD info.
    //  - stable cell + peek LOD NOT strictly better than cell.sample: raycast
    //    result would be rejected by the worseLOD or noChange branch below.
    //
    // "Strictly better" mirrors the acceptance criterion: deeper depth (primary)
    // or same depth with lower geometricError.
    if (this.terrainPeekLOD !== null && this.columnSampler !== null) {
      const peek = this.terrainPeekLOD(cell.x, cell.z);

      // No usable LOD info at this point → raycast cannot succeed.
      if (peek === null || peek.depth === 0 || peek.geometricError === Infinity) {
        this.peekSkipCount++;
        return false;
      }

      // Stable cell + peek LOD not better than what we have → would be rejected.
      if (cell.sample.state === 'stable') {
        const peekIsBetter =
          peek.depth > cell.sample.tileDepth ||
          (peek.depth === cell.sample.tileDepth &&
            peek.geometricError < cell.sample.tileGeometricError);
        if (!peekIsBetter) {
          this.peekSkipCount++;
          return false;
        }
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
    // the deck at that end, and like a tunnel cell waits for a column there.
    this.raycastCount++;
    const sampler = this.columnSampler;
    if (sampler === null) return false;

    let hit: CellHit | null = null;
    let found = false;
    if (cell.surface === 'tunnel' && cell.tunnelSpan) {
      const column = this.tunnelColumn(cell.tunnelSpan);
      found = column !== null;
      if (column !== null) hit = this.plausible(cell, this.hitOf(cell, column, null));
    } else {
      const deckEnd = cell.surface === 'approach' ? cell.deckEnd : null;
      const deck = deckEnd ? this.columnNear(deckEnd.x, deckEnd.z) : null;
      for (const [dx, dz] of RouteCellSampler.CELL_PROBES_M) {
        if (deckEnd !== null && deck === null) break;
        const column = sampler(cell.x + dx, cell.z + dz);
        if (column === null) continue;
        found = true;
        hit = this.plausible(cell, this.hitOf(cell, column, deck));
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

    // Quality-versioned idempotency: if the cell already has a stable sample
    // from a strictly better tile (deeper LOD), refuse to overwrite with
    // potentially-degraded data. This keeps the grid robust against LOD
    // drops during streaming (e.g. user zooms out and tiles re-stream at
    // coarser detail).
    if (cell.sample.state === 'stable') {
      const oldDepth = cell.sample.tileDepth;
      const oldErr = cell.sample.tileGeometricError;
      const newDepth = hit.tileDepth;
      const newErr = hit.tileGeometricError;
      // Strictly worse LOD: lower depth AND higher geometricError.
      if (newDepth < oldDepth && newErr > oldErr) {
        logGrid(
          'SAMPLE',
          `reject reason=worseLOD key=${cell.key} oldDepth=${oldDepth} newDepth=${newDepth} oldErr=${oldErr.toFixed(2)} newErr=${newErr.toFixed(2)}`,
        );
        return false;
      }
      // Same Y and same LOD: nothing to do.
      if (Math.abs(hit.y - cell.terrainHeight) < 0.01 && newDepth === oldDepth) {
        return false;
      }
    }

    const wasStable = cell.sample.state === 'stable';
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
      `${wasStable ? 'refresh' : 'promote'} key=${cell.key} y=${hit.y.toFixed(2)} depth=${hit.tileDepth} err=${hit.tileGeometricError.toFixed(2)}`,
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
   * (`deck`, the column at that end) the top where it carries on the deck,
   * else the bottom (deckApproachY), with the coarser LOD of the two
   * columns, so the cell is sampled again once the bridge end has a finer
   * tile. A column at the corridor edge can come down on a roof, an eave, a
   * crown or a parked car, which the photogrammetry has no ground under;
   * the cell keeps that height, and the corridor ends before such a cell
   * instead (corridor-walk.ts).
   */
  private hitOf(cell: RouteCell, column: ColumnSample, deck: ColumnSample | null): CellHit {
    // A tunnel cell's column is already the one between its portals (tunnelColumn).
    const y = cell.surface === 'tunnel' ? column.groundY : surfaceY(cell.surface, column, deck?.topY ?? null) ?? column.groundY;
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
   * stretch, interpolated along it, with the coarser of the two LODs.
   * Null until both portals have a tile.
   */
  private tunnelColumn(span: TunnelSpan): ColumnSample | null {
    const a = this.columnNear(span.ax, span.az);
    const b = this.columnNear(span.bx, span.bz);
    if (a === null || b === null) return null;
    const y = a.groundY + (b.groundY - a.groundY) * span.f;
    return {
      groundY: y,
      topY: y,
      tileDepth: Math.min(a.tileDepth, b.tileDepth),
      tileGeometricError: Math.max(a.tileGeometricError, b.tileGeometricError),
    };
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
