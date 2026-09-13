import { ColumnSample, ColumnSampler, TerrainPeekLOD, isBetterLod } from '../three-engine/column-sample';
import { RouteCell, TunnelSpan } from './route-cell';
import { corridorConfig } from './route-corridor';
import { logGrid } from './route-grid-log';

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

  /** Median der stabilen Nachbar-Cells, `null` bei zu wenig Nachbarn. */
  private readonly neighbourMedian: (cell: RouteCell) => number | null;

  /**
   * @param neighbourMedian `GlobalRouteGrid.medianOfStableNeighbourY`.
   *   Läuft nur, wenn ein Treffer kein LOD-Upgrade ist.
   */
  constructor(neighbourMedian: (cell: RouteCell) => number | null) {
    this.neighbourMedian = neighbourMedian;
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
   *  - If raycast misses: `cell.sample.state` stays `unsampled`,
   *    `cell.terrainHeight` keeps its previous value (anchor fallback).
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

    // One column probe. It already discards hits without usable LOD info
    // (undecoded tile meshes) and resolves ground against the finest LOD in
    // the column, so there is nothing left here to second-guess about which
    // hit to take.
    this.raycastCount++;
    if (this.columnSampler === null) return false;

    const column = cell.surface === 'tunnel' && cell.tunnelSpan
      ? this.tunnelColumn(cell.tunnelSpan)
      : this.columnSampler(cell.x, cell.z);
    if (column === null) {
      logGrid('SAMPLE', `miss key=${cell.key}`);
      return false;
    }
    const hit = {
      // A bridge deck is the top of its column, the ground is the bottom.
      y: cell.surface === 'deck' ? column.topY : column.groundY,
      tileDepth: column.tileDepth,
      tileGeometricError: column.tileGeometricError,
    };

    // A column at the corridor edge can come down on a roof, an eave or a
    // tree crown reaching over the street: the photogrammetry has no ground
    // under them, so the lowest hit is their top. Far above the ground on
    // the route centre line beside it, the cell takes that ground instead.
    // Only ever lowered, and never on a bridge deck, which is meant to be
    // high. The probe on the centre line is the centre cell's own column,
    // cached by the engine.
    let clamped = false;
    if (cell.surface === 'ground' && (cell.axisX !== cell.x || cell.axisZ !== cell.z)) {
      const axis = this.columnSampler(cell.axisX, cell.axisZ);
      if (axis !== null && hit.y - axis.groundY > corridorConfig.roofRise) {
        hit.y = axis.groundY;
        clamped = true;
      }
    }

    // Reject hits that diverge >50m from the local stable-neighbour median.
    // Catches localised outlier clusters where the tile engine returns a
    // bad hit (BBox / backface / water) for one region while surrounding
    // cells are correct. 50m is comfortable above realistic slopes
    // (Salzburg case: max 63m at a tunnel, which we want to reject).
    //
    // Skipped when this sample comes from a strictly better tile than the
    // cell already had. The neighbours were sampled from the same coarse
    // tiles as this cell, so their median agrees with the old wrong value —
    // letting it veto an upgrade is how a whole corridor stays pinned to the
    // block-level hull it was first sampled from. The guard is there to catch
    // a bad hit among comparable ones, not to defend a coarse consensus.
    const isUpgrade =
      cell.sample.state !== 'stable' ||
      isBetterLod(
        { depth: hit.tileDepth, geometricError: hit.tileGeometricError },
        cell.sample,
      );
    if (!isUpgrade) {
      const neighbourMedian = this.neighbourMedian(cell);
      if (neighbourMedian !== null && Math.abs(hit.y - neighbourMedian) > 50) {
        logGrid(
          'SAMPLE',
          `reject reason=outlier key=${cell.key} y=${hit.y.toFixed(2)} medianN=${neighbourMedian.toFixed(2)}`,
        );
        return false;
      }
    }

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
      if (
        Math.abs(hit.y - cell.terrainHeight) < 0.01 &&
        newDepth === oldDepth &&
        clamped === cell.sample.clamped
      ) {
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
      clamped,
    };
    cell.heightSampled = true;
    logGrid(
      'SAMPLE',
      `${wasStable ? 'refresh' : 'promote'} key=${cell.key} y=${hit.y.toFixed(2)} depth=${hit.tileDepth} err=${hit.tileGeometricError.toFixed(2)}${clamped ? ' clamped' : ''}`,
    );
    return true;
  }

  /**
   * The column a tunnel cell stands on. Its own column sees only the ground
   * or roof above the tunnel, so: the ground at the two portals of its
   * stretch, interpolated along it, with the coarser of the two LODs.
   * Null until both portals have a tile.
   */
  private tunnelColumn(span: TunnelSpan): ColumnSample | null {
    if (this.columnSampler === null) return null;
    const a = this.columnSampler(span.ax, span.az);
    const b = this.columnSampler(span.bx, span.bz);
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
      clamped: false,
    };
    cell.heightSampled = false;
    cell.terrainHeight = cell.routeAnchorY;
  }
}
