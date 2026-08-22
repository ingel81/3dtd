import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalRouteGrid } from './global-route-grid';
import type { ColumnSample } from '../three-engine/column-sample';

/**
 * Covers the healing loop that the rooftop-route bug lived in: a cell sampled
 * from a coarse tile has to be replaced once a finer tile streams in, and
 * everything baked off cell heights has to hear about it.
 *
 * The grid takes its terrain probe and LOD peek as injected functions, so
 * this runs without a tileset.
 */
describe('GlobalRouteGrid terrain sampling', () => {
  /** Minimal coordinate sync — the grid only needs geo→local for generation. */
  const coordinateSync = {
    geoToLocalSimple: (lat: number, lon: number) => ({ x: lon, y: 0, z: lat }),
  } as never;

  /** A straight route through the origin, in the fake coordinate space. */
  const route = [
    [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 20 },
    ],
  ];

  let grid: GlobalRouteGrid;
  let column: ColumnSample | null;
  let peek: { depth: number; geometricError: number } | null;
  let sampler: ReturnType<typeof vi.fn>;

  const sweep = () => grid.updateTerrainHeights();
  const groundAtOrigin = () => grid.getGroundLocalYAt(0, 0);

  beforeEach(() => {
    // Coarse block-level hull: what a city looks like before refinement.
    column = { groundY: 85, topY: 85, tileDepth: 14, tileGeometricError: 40 };
    peek = { depth: 14, geometricError: 40 };

    sampler = vi.fn(() => column);
    grid = new GlobalRouteGrid();
    grid.initialize(sampler as never, coordinateSync, () => peek);
    grid.generateFromRoutes(route as never);
    sweep();
  });

  it('accepts the coarse sample so there is something to stand on', () => {
    expect(groundAtOrigin()).toBe(85);
  });

  it('replaces it once a finer tile reports the real street', () => {
    column = { groundY: 3, topY: 40, tileDepth: 21, tileGeometricError: 2 };
    peek = { depth: 21, geometricError: 2 };

    sweep();

    expect(groundAtOrigin()).toBe(3);
  });

  it('does not re-probe while the loaded LOD is unchanged', () => {
    sampler.mockClear();
    sweep();
    // The peek says nothing improved, so the sweep must not pay for rays.
    expect(sampler).not.toHaveBeenCalled();
  });

  it('refuses to fall back to a coarser tile once it has a fine sample', () => {
    column = { groundY: 3, topY: 40, tileDepth: 21, tileGeometricError: 2 };
    peek = { depth: 21, geometricError: 2 };
    sweep();

    // Tiles re-stream coarser (zoom-out). The peek gate alone would already
    // skip this, so force the probe through to exercise the accept rule.
    column = { groundY: 85, topY: 85, tileDepth: 14, tileGeometricError: 40 };
    peek = { depth: 30, geometricError: 0 };
    sweep();

    expect(groundAtOrigin()).toBe(3);
  });

  it('tells every subscriber which cells changed', () => {
    // One listener is not enough: per-tower LOS and the baked route line both
    // have to self-heal, and a single-slot listener silently starved one.
    const first = vi.fn();
    const second = vi.fn();
    grid.addCellsChangedListener(first);
    grid.addCellsChangedListener(second);

    column = { groundY: 3, topY: 40, tileDepth: 21, tileGeometricError: 2 };
    peek = { depth: 21, geometricError: 2 };
    sweep();

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(first.mock.calls[0][0].length).toBeGreaterThan(0);
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    const off = grid.addCellsChangedListener(listener);
    off();

    column = { groundY: 3, topY: 40, tileDepth: 21, tileGeometricError: 2 };
    peek = { depth: 21, geometricError: 2 };
    sweep();

    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps the last good height when the probe comes back empty', () => {
    column = null;
    peek = { depth: 30, geometricError: 0 };
    sweep();

    expect(groundAtOrigin()).toBe(85);
  });
});
