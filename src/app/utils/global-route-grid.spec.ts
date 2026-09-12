import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalRouteGrid } from './global-route-grid';
import type { ColumnSample } from '../three-engine/column-sample';
import type { Enemy } from '../entities/enemy.entity';
import type { RouteWaypoint } from '../models/game.types';
import { corridorConfig, lateralLimit, resetCorridorConfig } from './route-corridor';

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

  /** Local x, z to the fake geo space of `coordinateSync`, half widths left and right of the segment it starts. */
  const at = (x: number, z: number, left?: number, right = left): RouteWaypoint =>
    ({ lat: z, lon: x, corridorLeft: left, corridorRight: right });

  /** Distinct cells on the line x = `x`, from z = -20 to 20. */
  function cellsAcross(x: number): number {
    const keys = new Set<number>();
    for (let z = -20; z <= 20; z += 0.25) {
      const cell = grid.getCellAt(x, z);
      if (cell) keys.add(cell.key);
    }
    return keys.size;
  }

  it('takes each side from its own half width', () => {
    // Heading east: right of the direction of travel is south (+z).
    grid.generateFromRoutes([[at(0, 1, 2, 6), at(40, 1)]]);
    // Centre (21, 7) is 6 m to the right, (21, -1) 2 m and (21, -3) 4 m to the left.
    expect(grid.getCellAt(20, 6)).toBeDefined();
    expect(grid.getCellAt(20, -0.5)).toBeDefined();
    expect(grid.getCellAt(20, -2.5)).toBeUndefined();
    expect(cellsAcross(20)).toBe(5);
  });

  it('keeps two cells across the narrowest corridor', () => {
    // Centre line on a cell border, then through cell centres.
    grid.generateFromRoutes([[at(0, 0, corridorConfig.minHalfWidth), at(40, 0)]]);
    expect(cellsAcross(10)).toBe(2);

    grid.generateFromRoutes([[at(0, 1, corridorConfig.minHalfWidth), at(40, 1)]]);
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

  it('leaves no hole in the corridor at any heading, with narrow and wide stretches on it', () => {
    // A cell missing between cells on all four sides would show as a gap
    // in a tower's LOS display, on the free street.
    const holes: string[] = [];
    for (const widths of [[2, 2, 2], [2.75, 2, 2.75], [7, 2, 4], [2, 7, 2], [4.5, 3.5, 6]]) {
      for (let angle = 0; angle < Math.PI; angle += Math.PI / 17) {
        const ux = Math.cos(angle);
        const uz = Math.sin(angle);
        const route = [0, 20, 40, 60].map((s, k) => at(0.37 + s * ux, -0.61 + s * uz, widths[k]));
        // And a corner: the last stretch turns right by 60 degrees.
        const turn = angle + Math.PI / 3;
        route.push(at(route[3].lon + 20 * Math.cos(turn), route[3].lat + 20 * Math.sin(turn)));
        grid.generateFromRoutes([route]);
        for (const hole of grid.findHolesInRange(route[3].lon, route[3].lat, 60)) {
          holes.push(`widths ${widths} angle ${angle.toFixed(2)} at ${hole.x},${hole.z}`);
        }
      }
    }
    expect(holes).toEqual([]);
  });

  it('finds a hole where a cell is missing between cells on all four sides', () => {
    grid.generateFromRoutes([[at(0, 1, 4), at(40, 1)]]);
    expect(grid.findHolesInRange(20, 1, 30)).toEqual([]);
    // Drop the cell at (21, 1) behind the grid's back.
    const cells = (grid as unknown as { cells: Map<number, unknown> }).cells;
    const key = grid.getCellAt(21, 1)!.key;
    cells.delete(key);
    expect(grid.findHolesInRange(20, 1, 30)).toEqual([{ x: 21, z: 1 }]);
  });

  it('puts every point an enemy may reach into a cell, at any heading', () => {
    for (const halfWidth of [corridorConfig.minHalfWidth, 2.75, 4, 7]) {
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
 * `__corridor.towerCells()` reads this: what the grid holds in a tower's
 * range, to tell a gap in the LOS display apart.
 */
describe('GlobalRouteGrid tower range report', () => {
  const coordinateSync = {
    geoToLocalSimple: (lat: number, lon: number) => ({ x: lon, y: 0, z: lat }),
  } as never;

  it('counts the answers, the cells without a sample and the raised ones', () => {
    // Ground at 0, a van roof at 2.5 m over the cell around (21, 1), no tile
    // at all beyond x = 30.
    const column = (x: number, z: number): ColumnSample | null => {
      if (x > 30) return null;
      const y = Math.abs(x - 21) < 1 && Math.abs(z - 1) < 1 ? 2.5 : 0;
      return { groundY: y, topY: y, tileDepth: 20, tileGeometricError: 2 };
    };
    const grid = new GlobalRouteGrid();
    grid.initialize(column as never, coordinateSync);
    grid.generateFromRoutes([[{ lat: 1, lon: 0, corridorLeft: 3, corridorRight: 3 }, { lat: 1, lon: 60 }]]);
    // Tower at (20, 8): below the 10 m wall everything is visible.
    grid.registerTower('t1', 20, 8, 16, { referencePos: { x: 20, y: 20, z: 8 } } as never);

    const report = grid.describeTowerRange('t1', 20, 8, 16);
    expect(report.cells).toBeGreaterThan(20);
    expect(report.groundVisible + report.groundBlocked + report.groundMissing).toBe(report.cells);
    expect(report.groundMissing).toBe(0);
    expect(report.airMissing).toBe(report.cells);
    // The columns beyond x = 30 found no tile.
    expect(report.unsampled).toBeGreaterThan(0);
    expect(report.holes).toEqual([]);
    expect(report.raised).toEqual([{ x: 21, z: 1, aboveM: 2.5 }]);
  });
});

/**
 * Playtest 2026-09-12: the row of cells the red line runs through was
 * missing from a tower's LOS display on a diagonal street. These pin down
 * what the grid itself does with that row.
 */
describe('GlobalRouteGrid centre line', () => {
  const coordinateSync = {
    geoToLocalSimple: (lat: number, lon: number) => ({ x: lon, y: 0, z: lat }),
  } as never;
  const at = (x: number, z: number, left?: number, right = left): RouteWaypoint =>
    ({ lat: z, lon: x, corridorLeft: left, corridorRight: right });

  let grid: GlobalRouteGrid;

  beforeEach(() => {
    grid = new GlobalRouteGrid();
    grid.initialize((() => ({ groundY: 0, topY: 0, tileDepth: 20, tileGeometricError: 2 })) as never, coordinateSync);
  });

  /** A diagonal street, narrowed in the middle, with a corner at its end. */
  const diagonal = [at(0.37, -0.61, 2.75), at(20, 11, 2, 3), at(40, 23, 2.75), at(52, 40)];

  it('finds every cell at its own centre, one cell per spot', () => {
    grid.generateFromRoutes([diagonal]);
    const cells = grid.getCellsInRange(25, 15, 100);
    expect(cells.length).toBeGreaterThan(50);
    for (const cell of cells) expect(grid.getCellAt(cell.x, cell.z)).toBe(cell);
    expect(new Set(cells.map((c) => `${c.x},${c.z}`)).size).toBe(cells.length);
  });

  it('keeps the centre row of a street two routes share, whichever way they run', () => {
    // A second spawn walks the same street the other way, then turns off to the HQ.
    const reversed = [at(40, 23, 4), at(20, 11, 4), at(0.37, -0.61, 4), at(-10, -8)];
    grid.generateFromRoutes([diagonal, reversed]);
    grid.registerTower('t1', 20, 20, 30, { referencePos: { x: 20, y: 20, z: 20 } } as never);

    const centre = grid.describeCentreLine('t1', 20, 20, 30);
    expect(centre.cells).toBeGreaterThan(20);
    expect(centre.holes).toEqual([]);
    expect(centre.unsampled).toBe(0);
    expect(centre.groundMissing).toBe(0);
    // And the LOS display would take every one of them.
    const shown = new Set(grid.getCellsInRange(20, 20, 30));
    expect(grid.centreLineCells(20, 20, 30).cells.every((c) => shown.has(c))).toBe(true);
  });

  it('describes the spots around a point, nearest to the route line first', () => {
    grid.generateFromRoutes([[at(0, 1, 2), at(40, 1)]]);
    grid.registerTower('t1', 20, 8, 16, { referencePos: { x: 20, y: 20, z: 8 } } as never);

    const rows = grid.describeCellsAround(21, 3, 4, 't1');
    expect(rows[0].routeM).toBe(0);
    expect(rows.find((r) => r.x === 21 && r.z === 1))
      .toMatchObject({ routeM: 0, cell: true, state: 'stable', heightM: 0, ground: 'visible', air: '-' });
    // 6 m off a 2 m corridor: no cell there.
    expect(rows.find((r) => r.z === 7)).toMatchObject({ cell: false, state: '-', heightM: null, ground: '-' });
    expect(rows.every((r, k) => k === 0 || r.routeM >= rows[k - 1].routeM)).toBe(true);
  });
});

/**
 * Playtest 2026-09-12: edge cells sat on the eaves of houses at the street
 * and on a roof in an alley. The photogrammetry has no ground under a roof,
 * so the column there finds only the roof.
 */
describe('GlobalRouteGrid roof cells', () => {
  const coordinateSync = {
    geoToLocalSimple: (lat: number, lon: number) => ({ x: lon, y: 0, z: lat }),
  } as never;
  /** Street at 0 m; south of z = 2.5 a house whose roof, `roof` metres up, is all a column finds. */
  const street = (roof: number, deck = 0) => (_x: number, z: number): ColumnSample =>
    z > 2.5
      ? { groundY: roof, topY: roof, tileDepth: 20, tileGeometricError: 2 }
      : { groundY: 0, topY: deck, tileDepth: 20, tileGeometricError: 2 };
  const at = (x: number, z: number, onBridge?: boolean): RouteWaypoint =>
    ({ lat: z, lon: x, corridorLeft: 4, corridorRight: 4, onBridge });

  /** An eastbound street along z = 1, 4 m either side. */
  function build(column: (x: number, z: number) => ColumnSample, route = [at(0, 1), at(40, 1)]): GlobalRouteGrid {
    const grid = new GlobalRouteGrid();
    grid.initialize(column as never, coordinateSync);
    grid.generateFromRoutes([route]);
    return grid;
  }

  afterEach(() => resetCorridorConfig());

  it('puts a cell whose column finds only a roof back on the ground beside the route', () => {
    const grid = build(street(6));
    // Centre (21, 3): under the roof, 2 m off the centre line.
    const eave = grid.getCellAt(20.5, 3.5)!;
    expect(eave.terrainHeight).toBe(0);
    expect(eave.sample.clamped).toBe(true);
    expect(grid.getCellAt(20.5, 1.5)!.sample.clamped).toBe(false);
    // Enemies stand on the ground there, not on the roof.
    expect(grid.getGroundLocalYAt(20.5, 3.5)).toBe(0);
    expect(grid.describeTowerRange('t1', 20, 1, 10).clamped).toBeGreaterThan(0);
  });

  it('keeps a step below the threshold, and a bridge deck', () => {
    expect(build(street(2)).getCellAt(20.5, 3.5)!.terrainHeight).toBe(2);
    // Deck at 8 m over a street at 0: the edge cell stays on the deck.
    const bridge = build(street(0, 8), [at(0, 1, true), at(40, 1)]);
    expect(bridge.getCellAt(20.5, -0.5)!.terrainHeight).toBe(8);
  });

  it('takes the threshold from corridorConfig.roofRise', () => {
    corridorConfig.roofRise = 1.5;
    expect(build(street(2)).getCellAt(20.5, 3.5)!.sample.clamped).toBe(true);
  });
});

/**
 * On a bridge the lowest hit of a column is the river or road below. Route
 * cells of a bridge segment take the deck, the top of the column.
 */
describe('GlobalRouteGrid bridges', () => {
  const coordinateSync = {
    geoToLocalSimple: (lat: number, lon: number) => ({ x: lon, y: 0, z: lat }),
  } as never;
  const at = (x: number, z: number, onBridge?: boolean): RouteWaypoint =>
    ({ lat: z, lon: x, corridorLeft: 3, corridorRight: 3, onBridge });

  let grid: GlobalRouteGrid;

  beforeEach(() => {
    // A deck at 8 m over water at 0 m, as far as the columns are concerned.
    grid = new GlobalRouteGrid();
    grid.initialize((() => ({ groundY: 0, topY: 8, tileDepth: 20, tileGeometricError: 2 })) as never, coordinateSync);
  });

  it('puts the cells of a bridge segment on the deck and the rest on the ground', () => {
    grid.generateFromRoutes([[at(0, 0), at(30, 0, true), at(60, 0), at(90, 0)]]);
    expect(grid.getGroundLocalYAt(15, 0.5)).toBe(0);
    expect(grid.getGroundLocalYAt(45, 0.5)).toBe(8);
    expect(grid.getGroundLocalYAt(75, 0.5)).toBe(0);
  });

  it('keeps a cell on the ground when a segment off the bridge reaches it too', () => {
    grid.generateFromRoutes([[at(0, 0), at(30, 0, true), at(60, 0)]]);
    // Centre (31, 1) is 1.4 m from the approach, (35, 1) 5.1 m.
    expect(grid.getGroundLocalYAt(31, 0.5)).toBe(0);
    expect(grid.getGroundLocalYAt(35, 0.5)).toBe(8);
  });

  it('decides the surface before sampling, whichever route comes first', () => {
    // Bridge route first, then a street that runs under its middle.
    grid.generateFromRoutes([
      [at(0, 0), at(30, 0, true), at(60, 0)],
      [at(45, -20), at(45, 20)],
    ]);
    expect(grid.getGroundLocalYAt(45, 0.5)).toBe(0);
    expect(grid.getGroundLocalYAt(35, 0.5)).toBe(8);
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
