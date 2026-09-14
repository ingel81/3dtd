import { describe, it, expect, vi } from 'vitest';
import type { ColumnSample } from '../three-engine/column-sample';
import type { RouteCell } from './route-cell';
import { RouteCellSampler } from './route-cell-sampler';

/** A cell 10 m off a bridge end at (0, 0), not sampled yet. */
const approachCell = (): RouteCell => ({
  key: 1,
  x: 10,
  z: 0,
  axisX: 10,
  axisZ: 0,
  terrainHeight: 80,
  surface: 'approach',
  tunnelSpan: null,
  deckEnd: { x: 0, z: 0 },
  routeAnchorY: 80,
  sample: { state: 'unsampled', sampledAt: 0, tileDepth: 0, tileGeometricError: Infinity },
  heightSampled: false,
  enemies: new Set(),
  towerVisibility: new Map(),
  airVisibility: new Map(),
});

describe('RouteCellSampler.sampleCellY', () => {
  it('samples a cell off a bridge end again only once its column or the bridge end has a finer tile', () => {
    // The deck at 80 m over a quay at 70 m; the bridge end has the coarser tile.
    const lod = { cell: { depth: 20, geometricError: 2 }, deck: { depth: 18, geometricError: 8 } };
    const at = (x: number) => (x < 5 ? lod.deck : lod.cell);
    const columns = vi.fn((x: number): ColumnSample =>
      ({ groundY: 70, topY: 80, tileDepth: at(x).depth, tileGeometricError: at(x).geometricError }));
    const sampler = new RouteCellSampler(() => null);
    sampler.columnSampler = (x) => columns(x);
    sampler.terrainPeekLOD = (x) => at(x);
    const cell = approachCell();

    // The coarser LOD of the two columns (hitOf)
    expect(sampler.sampleCellY(cell)).toBe(true);
    expect(cell).toMatchObject({ terrainHeight: 80, sample: { state: 'stable', tileDepth: 18, tileGeometricError: 8 } });
    const cast = columns.mock.calls.length;

    // Nothing finer at either: the peek skips the cell, no column is cast
    expect(sampler.sampleCellY(cell)).toBe(false);
    expect(columns.mock.calls.length).toBe(cast);
    expect(sampler.peekSkipCount).toBe(1);

    // The bridge end refines: sampled again
    lod.deck = { depth: 20, geometricError: 2 };
    expect(sampler.sampleCellY(cell)).toBe(true);
    expect(cell.sample).toMatchObject({ tileDepth: 20, tileGeometricError: 2 });
  });
});
