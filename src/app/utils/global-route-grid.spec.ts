import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalRouteGrid } from './global-route-grid';
import type { ColumnSample } from '../three-engine/column-sample';
import type { Enemy } from '../entities/enemy.entity';
import type { RouteWaypoint } from '../models/game.types';
import { CORRIDOR_MIN_HALF_WIDTH_M, lateralLimit } from './route-corridor';

// Stand-in for the cubemap: a wall at 10 m, so a cell's visibility follows
// its height. Targets below it are visible, targets above it are not.
vi.mock('./gpu-cube-resolve', () => ({
  isCubeVisible: (...args: number[]) => args[4] < 10,
}));

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

  // A height change nobody hears about is permanent: the peek-skip keeps
  // every later sweep from flagging the cell again.

  it('reports cells a local refine refreshed, not only promoted ones', () => {
    const listener = vi.fn();
    grid.addCellsChangedListener(listener);

    column = { groundY: 3, topY: 40, tileDepth: 21, tileGeometricError: 2 };
    peek = { depth: 21, geometricError: 2 };
    const result = grid.refineCellsInRadius(10, 0, 6);

    expect(result.refreshed).toBeGreaterThan(0);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0]).toHaveLength(result.refreshed);
  });

  it('reports the heights a tower registration moved, after its own answers are in', () => {
    const answeredWhenReported: boolean[] = [];
    grid.addCellsChangedListener((changed) => {
      for (const cell of changed) answeredWhenReported.push(cell.towerVisibility.has('t1'));
    });

    column = { groundY: 3, topY: 40, tileDepth: 21, tileGeometricError: 2 };
    peek = { depth: 21, geometricError: 2 };
    grid.registerTower('t1', 10, 0, 6, { referencePos: { x: 10, y: 20, z: 0 } } as never);

    expect(answeredWhenReported.length).toBeGreaterThan(0);
    expect(answeredWhenReported.every(Boolean)).toBe(true);
  });

  it('re-resolves a cached answer whose cell height the re-registration moved', () => {
    const ctx = { referencePos: { x: 10, y: 20, z: 0 } } as never;
    const listener = vi.fn();
    grid.registerTower('t1', 10, 0, 6, ctx);
    // 85 m roof: behind the wall.
    expect(grid.getCellsInRange(10, 0, 6).some((c) => c.towerVisibility.get('t1'))).toBe(false);

    grid.addCellsChangedListener(listener);
    column = { groundY: 3, topY: 40, tileDepth: 21, tileGeometricError: 2 };
    peek = { depth: 21, geometricError: 2 };
    grid.registerTowerIncremental('t1', 10, 0, 6, ctx);

    // 3 m street: in front of it.
    expect(grid.getCellsInRange(10, 0, 6).every((c) => c.towerVisibility.get('t1'))).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
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
  /** Straight route along +x at z = 0; no width on it, so the default 4.5 m either side. */
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

/**
 * The corridor follows the street: each segment brings its own half width,
 * and every point an enemy may reach (lateralLimit) has to lie in a cell,
 * or towers would not see the enemy standing there.
 */
describe('GlobalRouteGrid corridor width', () => {
  const coordinateSync = {
    geoToLocalSimple: (lat: number, lon: number) => ({ x: lon, y: 0, z: lat }),
  } as never;
  const sampler = () => ({ groundY: 0, topY: 0, tileDepth: 20, tileGeometricError: 2 });

  let grid: GlobalRouteGrid;

  beforeEach(() => {
    grid = new GlobalRouteGrid();
    grid.initialize(sampler as never, coordinateSync);
  });

  /** Local x, z to the fake geo space of `coordinateSync`. */
  const at = (x: number, z: number, corridorHalfWidth?: number): RouteWaypoint => ({ lat: z, lon: x, corridorHalfWidth });

  /** Distinct cells on the line x = `x`, from z = -20 to 20. */
  function cellsAcross(x: number): number {
    const keys = new Set<number>();
    for (let z = -20; z <= 20; z += 0.25) {
      const cell = grid.getCellAt(x, z);
      if (cell) keys.add(cell.key);
    }
    return keys.size;
  }

  it('keeps two cells across the narrowest corridor', () => {
    // Centre line on a cell border, then through cell centres.
    grid.generateFromRoutes([[at(0, 0, CORRIDOR_MIN_HALF_WIDTH_M), at(40, 0)]]);
    expect(cellsAcross(10)).toBe(2);

    grid.generateFromRoutes([[at(0, 1, CORRIDOR_MIN_HALF_WIDTH_M), at(40, 1)]]);
    expect(cellsAcross(10)).toBe(3);
  });

  it('follows the width of each segment', () => {
    grid.generateFromRoutes([[at(0, 0, 2), at(40, 0, 6), at(80, 0)]]);
    expect(grid.getCellAt(20, 4.5)).toBeUndefined();
    expect(grid.getCellAt(60, 4.5)).toBeDefined();
    expect(cellsAcross(60)).toBeGreaterThan(cellsAcross(20));
  });

  it('keeps every cell centre within the half width of its segment', () => {
    grid.generateFromRoutes([[at(0, 0, 2.75), at(30, 17, 2.75), at(60, 17)]]);
    const segments: [number, number, number, number][] = [[0, 0, 30, 17], [30, 17, 60, 17]];
    const distance = (px: number, pz: number, [ax, az, bx, bz]: [number, number, number, number]) => {
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(ax + t * dx - px, az + t * dz - pz);
    };
    const cells = grid.getCellsInRange(30, 10, 100);
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(Math.min(...segments.map((s) => distance(cell.x, cell.z, s)))).toBeLessThanOrEqual(2.75);
    }
  });

  it('puts every point an enemy may reach into a cell, at any heading', () => {
    for (const halfWidth of [CORRIDOR_MIN_HALF_WIDTH_M, 2.75, 4, 7]) {
      for (let angle = 0; angle < Math.PI; angle += Math.PI / 13) {
        const ux = Math.cos(angle);
        const uz = Math.sin(angle);
        // Start off the cell lattice so the line cuts cells unevenly.
        const ax = 0.37;
        const az = -0.61;
        grid.generateFromRoutes([[at(ax, az, halfWidth), at(ax + 50 * ux, az + 50 * uz)]]);

        const limit = lateralLimit(halfWidth);
        for (let s = 0; s <= 50; s += 0.7) {
          for (const side of [-1, -0.5, 0, 0.5, 1]) {
            const x = ax + s * ux - side * limit * uz;
            const z = az + s * uz + side * limit * ux;
            expect(grid.getCellAt(x, z), `hw ${halfWidth} angle ${angle.toFixed(2)} s ${s} side ${side}`).toBeDefined();
          }
        }
      }
    }
  });
});

/**
 * Cells are keyed with Math.floor when they are created, so every lookup has
 * to use the same rule. Truncation (`| 0`) rounds toward zero and put
 * positions left of / behind the origin into the neighbour cell on the origin
 * side: wrong cell for targeting, wrong ground under the enemy.
 */
describe('GlobalRouteGrid cell keys around the origin', () => {
  const coordinateSync = {
    geoToLocalSimple: (lat: number, lon: number) => ({ x: lon, y: 0, z: lat }),
    geoToLocalSimpleInto: (lat: number, lon: number, _h: number, out: { x: number; z: number }) => {
      out.x = lon;
      out.z = lat;
      return out;
    },
  } as never;
  /** Straight route along x through the origin: cells on both sides in x and z. */
  const route = [[{ lat: 0, lon: -20 }, { lat: 0, lon: 20 }]];
  const makeEnemy = (id: string) => ({ id }) as unknown as Enemy;

  let grid: GlobalRouteGrid;

  beforeEach(() => {
    // The ground encodes the cell centre, so a lookup that lands in the
    // wrong cell reads a different height.
    const sampler = (x: number, z: number) =>
      ({ groundY: x * 10 + z, topY: 40, tileDepth: 20, tileGeometricError: 2 });
    grid = new GlobalRouteGrid();
    grid.initialize(sampler as never, coordinateSync);
    grid.generateFromRoutes(route as never);
  });

  it('resolves a negative position to the cell that contains it', () => {
    expect(grid.getCellAt(-0.5, -0.5)).toMatchObject({ x: -1, z: -1 });
    expect(grid.getCellAt(-3.9, 0.5)).toMatchObject({ x: -3, z: 1 });
  });

  it('reads the ground of that cell, not of its neighbour toward the origin', () => {
    // Truncation read the (1, 1) and (-1, 1) cells here: 11 and -9.
    expect(grid.getGroundLocalYAt(-0.5, -0.5)).toBe(-11);
    expect(grid.getGroundLocalYAt(-3.9, 0.5)).toBe(-29);
  });

  it('files an enemy under the cell that contains it', () => {
    const enemy = makeEnemy('e1');
    grid.updateEnemyPosition(enemy, -0.5, -0.5);

    const [containing] = grid.getCellsInRange(-1, -1, 0.1);
    expect(containing.enemies.has(enemy)).toBe(true);
    expect(grid.getGroundLocalYForEnemy(enemy, -0.5, -0.5)).toBe(-11);
  });

  it('finds an enemy across the origin in a radius query', () => {
    const enemy = { id: 'e1', alive: true, position: { lat: 0.5, lon: -2.4 } } as unknown as Enemy;
    grid.updateEnemyPosition(enemy, -2.4, 0.5);

    expect(grid.getEnemiesInRadius(0.3, 0.5, 2.8)).toEqual([enemy]);
    expect(grid.getEnemiesInRadius(0.3, 0.5, 2.6)).toEqual([]);
  });

  it('registers a tower on every cell in range, also left of the origin', () => {
    const ctx = { referencePos: { x: -9, y: 20, z: 0 } } as never;
    grid.registerTower('t1', -9, 0, 5, ctx);

    const inRange = grid.getCellsInRange(-9, 0, 5);
    expect(inRange.length).toBeGreaterThan(0);
    expect(inRange.every((c) => c.towerVisibility.has('t1'))).toBe(true);
  });
});
