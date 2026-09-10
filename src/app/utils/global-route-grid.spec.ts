import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalRouteGrid } from './global-route-grid';
import type { ColumnSample } from '../three-engine/column-sample';
import type { Enemy } from '../entities/enemy.entity';

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

/**
 * updateEnemyPosition() keeps a memo of the last evaluated cell on the enemy
 * and skips its Map work while the enemy stays in that cell. These pin down
 * that the memo never lets membership drift from what the full lookup gives.
 */
describe('GlobalRouteGrid enemy cell memo', () => {
  const coordinateSync = {
    geoToLocalSimple: (lat: number, lon: number) => ({ x: lon, y: 0, z: lat }),
  } as never;
  /** Straight route along +x at z = 0; the corridor reaches ~7 m either side. */
  const route = [[{ lat: 0, lon: 0 }, { lat: 0, lon: 20 }]];
  const makeEnemy = (id: string) => ({ id }) as unknown as Enemy;

  let grid: GlobalRouteGrid;

  beforeEach(() => {
    // Cells beyond x = 10 stay unsampled, so the estimate path is covered too.
    const sampler = (x: number) =>
      x > 10 ? null : { groundY: 5 + x * 0.1, topY: 40, tileDepth: 20, tileGeometricError: 2 };
    grid = new GlobalRouteGrid();
    grid.initialize(sampler as never, coordinateSync);
    grid.generateFromRoutes(route as never);
  });

  const cellHas = (x: number, z: number, enemy: Enemy) => grid.getCellAt(x, z)?.enemies.has(enemy) ?? false;

  it('keeps an enemy tracked while it stays in its cell', () => {
    const enemy = makeEnemy('e1');
    grid.updateEnemyPosition(enemy, 4.2, 0.3);
    grid.updateEnemyPosition(enemy, 4.4, 0.5); // same 2 m cell
    grid.updateEnemyPosition(enemy, 4.6, 0.7);

    expect(cellHas(4.6, 0.7, enemy)).toBe(true);
    expect(grid.getStats()).toMatchObject({ trackedEnemies: 1, occupiedCells: 1 });
  });

  it('moves the enemy when it crosses into another cell', () => {
    const enemy = makeEnemy('e1');
    grid.updateEnemyPosition(enemy, 4.2, 0.3);
    grid.updateEnemyPosition(enemy, 6.2, 0.3);

    expect(cellHas(4.2, 0.3, enemy)).toBe(false);
    expect(cellHas(6.2, 0.3, enemy)).toBe(true);
    expect(grid.getStats()).toMatchObject({ trackedEnemies: 1, occupiedCells: 1 });
  });

  it('drops an enemy that leaves the corridor and re-adds it on return', () => {
    const enemy = makeEnemy('e1');
    grid.updateEnemyPosition(enemy, 4.2, 0.3);
    grid.updateEnemyPosition(enemy, 4.2, 50); // outside
    grid.updateEnemyPosition(enemy, 4.3, 50.1); // still outside, same key
    expect(grid.getStats()).toMatchObject({ trackedEnemies: 0, occupiedCells: 0 });

    grid.updateEnemyPosition(enemy, 4.2, 0.3);
    expect(cellHas(4.2, 0.3, enemy)).toBe(true);
  });

  it('re-adds an enemy after removeEnemy, even at the same position', () => {
    const enemy = makeEnemy('e1');
    grid.updateEnemyPosition(enemy, 4.2, 0.3);
    grid.removeEnemy(enemy);
    expect(cellHas(4.2, 0.3, enemy)).toBe(false);

    grid.updateEnemyPosition(enemy, 4.2, 0.3);
    expect(cellHas(4.2, 0.3, enemy)).toBe(true);
  });

  it('re-adds an enemy to the regenerated cells, even at the same position', () => {
    const enemy = makeEnemy('e1');
    grid.updateEnemyPosition(enemy, 4.2, 0.3);
    const before = grid.getCellAt(4.2, 0.3);

    grid.generateFromRoutes(route as never);
    grid.updateEnemyPosition(enemy, 4.2, 0.3);

    expect(grid.getCellAt(4.2, 0.3)).not.toBe(before);
    expect(cellHas(4.2, 0.3, enemy)).toBe(true);
  });

  it('reads the same ground through the memo as through the lookup', () => {
    const enemy = makeEnemy('e1');
    // Sampled cell, unsampled cell next to sampled ones, far unsampled cell, outside.
    const positions: [number, number][] = [[4.2, 0.3], [11.5, 0.3], [18.5, 1.2], [4.2, 50]];
    for (const [x, z] of positions) {
      grid.updateEnemyPosition(enemy, x, z);
      expect(grid.getGroundLocalYForEnemy(enemy, x, z)).toBe(grid.getGroundLocalYAt(x, z));
    }
    // A position the memo does not cover falls back to the lookup.
    expect(grid.getGroundLocalYForEnemy(enemy, 2.1, 0.1)).toBe(grid.getGroundLocalYAt(2.1, 0.1));
  });
});
