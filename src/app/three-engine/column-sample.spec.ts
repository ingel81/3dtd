import { describe, expect, it } from 'vitest';
import { ColumnHit, isBetterLod, selectColumnSample } from './column-sample';

const hit = (y: number, depth: number, geometricError = 10): ColumnHit => ({
  y,
  depth,
  geometricError,
});

describe('selectColumnSample', () => {
  it('returns null when there are no hits', () => {
    expect(selectColumnSample([])).toBeNull();
  });

  it('rejects hits without usable LOD metadata', () => {
    // depth 0 / infinite error == bounding-volume approximation before the
    // tile mesh is decoded. Accepting one cements a wrong height.
    expect(selectColumnSample([hit(85, 0), hit(90, 0, Infinity)])).toBeNull();
    expect(selectColumnSample([hit(85, 12, Infinity)])).toBeNull();
  });

  it('ignores a coarse ancestor still active during refinement', () => {
    // The regression that put routes on rooftops: a decimated block-level
    // hull (depth 17) coexists with the refined street (depth 21) while the
    // parent waits for all children to be ready.
    const sample = selectColumnSample([hit(85, 17), hit(3, 21)]);
    expect(sample?.groundY).toBe(3);
    expect(sample?.tileDepth).toBe(21);
  });

  it('takes the street, not the deck, when both are the same LOD', () => {
    // Elevated highway over a road: genuine stacked geometry, one LOD.
    const sample = selectColumnSample([hit(9, 21), hit(3, 21)]);
    expect(sample?.groundY).toBe(3);
    expect(sample?.topY).toBe(9);
  });

  it('reports the top surface of the finest LOD', () => {
    const sample = selectColumnSample([hit(85, 17), hit(40, 21), hit(3, 21)]);
    expect(sample?.topY).toBe(40);
    expect(sample?.groundY).toBe(3);
  });

  it('takes the lowest hit of the finest LOD even under a tall building', () => {
    // Street at 3 with a 40 m facade above it, all one tile. A column-local
    // "that gap is suspicious" rule would wrongly promote the roof here,
    // which is why plausibility lives in the grid instead.
    const sample = selectColumnSample([hit(40, 21), hit(3, 21)]);
    expect(sample?.groundY).toBe(3);
    expect(sample?.topY).toBe(40);
  });

  it('carries the finest geometric error of the chosen LOD', () => {
    const sample = selectColumnSample([hit(3, 21, 8), hit(4, 21, 2)]);
    expect(sample?.tileGeometricError).toBe(2);
  });

  it('accepts a coarse-only column so bootstrap has something to work with', () => {
    // No fine tile has streamed yet. The sample is stamped with its LOD, so
    // the cache and the grid both know to revisit it once better data lands.
    const sample = selectColumnSample([hit(85, 14)]);
    expect(sample?.groundY).toBe(85);
    expect(sample?.tileDepth).toBe(14);
  });
});

describe('isBetterLod', () => {
  const sample = { tileDepth: 20, tileGeometricError: 5 };

  it('is true for a deeper tile', () => {
    expect(isBetterLod({ depth: 21, geometricError: 99 }, sample)).toBe(true);
  });

  it('is true at equal depth with a lower geometric error', () => {
    expect(isBetterLod({ depth: 20, geometricError: 4 }, sample)).toBe(true);
  });

  it('is false at equal depth and equal error — nothing to re-sample', () => {
    expect(isBetterLod({ depth: 20, geometricError: 5 }, sample)).toBe(false);
  });

  it('is false for a coarser tile', () => {
    expect(isBetterLod({ depth: 19, geometricError: 1 }, sample)).toBe(false);
  });
});
