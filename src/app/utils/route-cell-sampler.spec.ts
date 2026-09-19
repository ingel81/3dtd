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
  onApproach: { path: [{ x: 0, z: 0 }, { x: 10, z: 0 }], m: 10, start: 'bridge' },
  routeAnchorY: 80,
  sample: { state: 'unsampled', sampledAt: 0, tileDepth: 0, tileGeometricError: Infinity },
  heightSampled: false,
  enemies: new Set(),
  towerVisibility: new Map(),
  airVisibility: new Map(),
});

/**
 * The one place that writes a cell's height. A cell takes it when the grid
 * generates the cells and, for a cell the finest level gave no column, in
 * the build's retry on the fallback level; the build then freezes them
 * (CorridorBuild), and nothing samples a cell again.
 */
describe('RouteCellSampler.sampleCellY', () => {
  /** The deck at 80 m over a quay at 70 m; the bridge end has the coarser tile. */
  const setup = () => {
    const lod = { cell: { depth: 20, geometricError: 2 }, deck: { depth: 18, geometricError: 8 } };
    const at = (x: number) => (x < 5 ? lod.deck : lod.cell);
    const columns = vi.fn((x: number): ColumnSample =>
      ({ groundY: 70, topY: 80, tileDepth: at(x).depth, tileGeometricError: at(x).geometricError }));
    const sampler = new RouteCellSampler(() => null);
    sampler.columnSampler = (x) => columns(x);
    sampler.terrainPeekLOD = (x) => at(x);
    return { lod, columns, sampler, cell: approachCell() };
  };

  it('takes the coarser of the two tiles an approach cell stands on', () => {
    const { sampler, cell } = setup();

    // The coarser LOD of the two columns (hitOf)
    expect(sampler.sampleCellY(cell)).toBe(true);
    expect(cell).toMatchObject({ terrainHeight: 80, sample: { state: 'stable', tileDepth: 18, tileGeometricError: 8 } });
  });

  it('takes the finer tile of a bridge end that refined before the build sampled the cell', () => {
    const { lod, sampler, cell } = setup();
    expect(sampler.sampleCellY(cell)).toBe(true);

    lod.deck = { depth: 20, geometricError: 2 };

    expect(sampler.sampleCellY(cell)).toBe(true);
    expect(cell.sample).toMatchObject({ tileDepth: 20, tileGeometricError: 2 });
  });

  it('casts no column where no tile mesh is decoded yet', () => {
    const { columns, sampler, cell } = setup();

    // No loaded tile contains the point: the column would miss anyway.
    sampler.terrainPeekLOD = () => null;
    expect(sampler.sampleCellY(cell)).toBe(false);

    // The tile is there, its mesh is not: the column would find no usable LOD.
    sampler.terrainPeekLOD = () => ({ depth: 0, geometricError: Infinity });
    expect(sampler.sampleCellY(cell)).toBe(false);

    expect(columns).not.toHaveBeenCalled();
    expect(cell.sample.state).toBe('unsampled');
    expect(sampler.lastMiss).toBe('noColumn');
  });

  it('says why a cell got no sample, for the corridor trace', () => {
    const { lod, sampler, cell } = setup();
    expect(sampler.sampleCellY(cell)).toBe(true);
    expect(sampler.lastMiss).toBeNull();

    // No column at the bridge end the height is carried from.
    const columnAt = sampler.columnSampler!;
    sampler.columnSampler = (x, z) => (x < 5 ? null : columnAt(x, z));
    expect(sampler.sampleCellY(approachCell())).toBe(false);
    expect(sampler.lastMiss).toBe('noApproachStart');

    // Columns everywhere, their hits 60 m off the neighbours.
    sampler.columnSampler = columnAt;
    const refusing = new RouteCellSampler(() => 10);
    refusing.columnSampler = columnAt;
    refusing.terrainPeekLOD = () => lod.cell;
    expect(refusing.sampleCellY(approachCell())).toBe(false);
    expect(refusing.lastMiss).toBe('refused');
  });
});
