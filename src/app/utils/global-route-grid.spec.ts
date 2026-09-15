import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalRouteGrid } from './global-route-grid';
import type { ColumnSample } from '../three-engine/column-sample';
import type { Enemy } from '../entities/enemy.entity';
import type { RouteWaypoint } from '../models/game.types';
import { corridorConfig, lateralLimit, resetCorridorConfig } from './route-corridor';
import { overlayCellKind } from './route-grid-aggregate-viz';
import { Vector3 } from 'three';
import { METERS_PER_DEGREE_LAT } from './geo-utils';
import { ROUTE_BODY_COVER, RouteBody, RouteBodyStations } from './route-body';

describe('GlobalRouteGrid bodies along the route', () => {
  // At the equator a degree of longitude is as long as one of latitude
  const flatSync = {
    geoToLocalSimpleInto: (lat: number, lon: number, height: number, target: Vector3): Vector3 =>
      target.set(lon * METERS_PER_DEGREE_LAT, height, -lat * METERS_PER_DEGREE_LAT),
  };
  // 100 m north, 3 m of corridor to each side
  const stations = new RouteBodyStations(
    [
      { lat: 0, lon: 0, corridorLeft: 3, corridorRight: 3 },
      { lat: 100 / METERS_PER_DEGREE_LAT, lon: 0, corridorLeft: 3, corridorRight: 3 },
    ],
    flatSync,
    200,
  );

  function oozeBetween(id: string, tail: number, tip: number): Enemy {
    const body = new RouteBody(stations);
    body.tailM = tail;
    body.tipM = tip;
    return { id, alive: true, body, transform: { terrainHeight: 203 } } as unknown as Enemy;
  }

  let grid: GlobalRouteGrid;
  beforeEach(() => {
    grid = new GlobalRouteGrid();
    grid.initialize((() => null) as never, { geoToLocalSimple: () => ({ x: 0, y: 0, z: 0 }) } as never);
  });

  it('takes a body into a radius query once the circle reaches it, with the hit where it does', () => {
    const ooze = oozeBetween('ooze', 10, 30);
    grid.addBodyEnemy(ooze);
    grid.addBodyEnemy(ooze);

    const found = grid.getEnemiesInRadius(10, -20, 8);
    expect(found).toEqual([ooze]);
    const edge = 3 * ROUTE_BODY_COVER;
    expect(ooze.body!.hitDistanceM).toBeCloseTo(10 - edge, 1);
    expect(ooze.body!.hit.lon * METERS_PER_DEGREE_LAT).toBeCloseTo(edge, 3);
    // No cell under it: the ground of its tip
    expect(ooze.body!.hit.height).toBe(203);
  });

  it('leaves out a body the circle misses, a dead one and the excluded one', () => {
    const ooze = oozeBetween('ooze', 10, 30);
    const dead = oozeBetween('dead', 10, 30);
    (dead as unknown as { alive: boolean }).alive = false;
    grid.addBodyEnemy(ooze);
    grid.addBodyEnemy(dead);

    expect(grid.getEnemiesInRadius(10, -20, 6)).toEqual([]);
    expect(grid.getEnemiesInRadius(0, -20, 6, 'ooze')).toEqual([]);
    expect(grid.getEnemiesInRadius(0, -20, 6)).toEqual([ooze]);
  });

  it('answers whether a living body is near, for the wake check', () => {
    grid.addBodyEnemy(oozeBetween('ooze', 10, 30));
    expect(grid.hasBodyWithin(0, -50, 25)).toBe(true);
    expect(grid.hasBodyWithin(0, -50, 15)).toBe(false);
  });

  it('forgets a body when it is removed and all of them on clear', () => {
    const a = oozeBetween('a', 10, 30);
    const b = oozeBetween('b', 10, 30);
    grid.addBodyEnemy(a);
    grid.addBodyEnemy(b);
    grid.removeBodyEnemy(a);
    expect(grid.getBodyEnemies()).toEqual([b]);
    const generation = grid.getGeneration();
    grid.clear();
    expect(grid.getBodyEnemies()).toEqual([]);
    expect(grid.getGeneration()).not.toBe(generation);
  });
});

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
 * Playtest 2026-09-13: a row of cells across a street stayed without a
 * height sample. A seam between two tile meshes ran through their centres,
 * and a column in the seam finds no tile.
 */
describe('GlobalRouteGrid tile seams', () => {
  const coordinateSync = {
    geoToLocalSimple: (lat: number, lon: number) => ({ x: lon, y: 0, z: lat }),
  } as never;
  /** Ground rising 0.1 m per metre east, with a 10 cm seam at x = 21 (the centres of grid column 10). */
  const seam = (x: number): ColumnSample | null =>
    Math.abs(x - 21) < 0.05 ? null : { groundY: x * 0.1, topY: x * 0.1, tileDepth: 20, tileGeometricError: 2 };

  it('samples a cell on the seam from half a metre beside it', () => {
    const grid = new GlobalRouteGrid();
    grid.initialize(seam as never, coordinateSync);
    grid.generateFromRoutes([[{ lat: 1, lon: 0, corridorLeft: 4, corridorRight: 4 }, { lat: 1, lon: 40 }]]);

    for (const z of [-1, 1, 3]) {
      const cell = grid.getCellAt(21, z)!;
      expect(cell.heightSampled, `z=${z}`).toBe(true);
      expect(cell.terrainHeight).toBeCloseTo(2.15, 6);
    }
  });

  /** A column in the seam comes down on a coarse tile 3.5 km below, `width` metres either side of x = 21. */
  const fallsThrough = (width: number) => (x: number): ColumnSample | null =>
    Math.abs(x - 21) < width ? { groundY: -3542, topY: -3542, tileDepth: 10, tileGeometricError: 500 } : seam(x);

  it('samples a cell whose centre column falls through the seam from beside it', () => {
    const grid = new GlobalRouteGrid();
    grid.initialize(fallsThrough(0.05) as never, coordinateSync);
    grid.generateFromRoutes([[{ lat: 1, lon: 0, corridorLeft: 4, corridorRight: 4 }, { lat: 1, lon: 40 }]]);
    grid.updateTerrainHeights();

    for (const z of [-3, -1, 1, 3, 5]) {
      const cell = grid.getCellAt(21, z)!;
      expect(cell.heightSampled, `z=${z}`).toBe(true);
      expect(cell.terrainHeight, `z=${z}`).toBeCloseTo(2.15, 6);
    }
  });

  it('refuses a first sample far below the neighbours, from a coarser tile', () => {
    const grid = new GlobalRouteGrid();
    grid.initialize(fallsThrough(0.6) as never, coordinateSync);
    grid.generateFromRoutes([[{ lat: 1, lon: 0, corridorLeft: 4, corridorRight: 4 }, { lat: 1, lon: 40 }]]);

    expect(grid.getCellAt(21, 1)!.sample.state).not.toBe('stable');
    // Enemies there stand on the neighbours' ground.
    expect(grid.getGroundLocalYAt(21, 1)).toBeCloseTo(2.1, 0);
  });

  it('compares a street under a high bridge with the street, not with the deck', () => {
    // A viaduct 60 m up along z = 1, a lane under it along x = 21, one cell wide.
    const viaduct = (): ColumnSample => ({ groundY: 0, topY: 60, tileDepth: 20, tileGeometricError: 2 });
    const grid = new GlobalRouteGrid();
    grid.initialize(viaduct as never, coordinateSync);
    grid.generateFromRoutes([
      [{ lat: 1, lon: 0, corridorLeft: 4, corridorRight: 4, onBridge: true }, { lat: 1, lon: 40 }],
      [{ lat: -20, lon: 21, corridorLeft: 0.5, corridorRight: 0.5 }, { lat: 20, lon: 21 }],
    ]);
    const under = grid.getCellAt(21, 1)!;
    expect(under.surface).toBe('ground');
    expect(grid.getCellAt(19, 1)!.terrainHeight).toBe(60);
    expect(under.heightSampled).toBe(true);
    expect(under.terrainHeight).toBe(0);
  });

  it('still takes a first sample from a finer tile than the neighbours had', () => {
    // Neighbours on a coarse hull 30 m up, the cell on the seam gets the fine street.
    const upgrade = (x: number): ColumnSample | null =>
      Math.abs(x - 21) < 0.6
        ? { groundY: -40, topY: -40, tileDepth: 21, tileGeometricError: 2 }
        : { groundY: 30, topY: 30, tileDepth: 14, tileGeometricError: 40 };
    const grid = new GlobalRouteGrid();
    grid.initialize(upgrade as never, coordinateSync);
    grid.generateFromRoutes([[{ lat: 1, lon: 0, corridorLeft: 4, corridorRight: 4 }, { lat: 1, lon: 40 }]]);
    expect(grid.getCellAt(21, 1)!.terrainHeight).toBe(-40);
  });

  const street = (column: (x: number) => ColumnSample | null) => {
    const grid = new GlobalRouteGrid();
    grid.initialize(column as never, coordinateSync);
    grid.generateFromRoutes([[{ lat: 1, lon: 0, corridorLeft: 4, corridorRight: 4 }, { lat: 1, lon: 40 }]]);
    return grid;
  };

  it('fills a cell between stable cells when no column near it gives ground', () => {
    const grid = street(fallsThrough(0.6));
    grid.updateTerrainHeights();

    for (const z of [-3, -1, 1, 3, 5]) {
      const cell = grid.getCellAt(21, z)!;
      expect(cell.sample.state, `z=${z}`).toBe('filled');
      expect(cell.heightSampled).toBe(true);
      // Halfway between the ground at x = 19 and x = 23; the edge cell had taken the -3542 m.
      expect(cell.terrainHeight, `z=${z}`).toBeCloseTo(2.1, 6);
      // A plain contour in the Route Grid Overlay.
      expect(overlayCellKind(cell) & 7).toBe(0);
    }
    expect(grid.dumpStats().filled).toBe(5);
    // The LOS display takes them, enemies stand on them.
    expect(grid.getCellsInRange(21, 1, 1)).toContain(grid.getCellAt(21, 1));
    expect(grid.getGroundLocalYAt(21, -3)).toBeCloseTo(2.1, 6);
  });

  it('replaces a fill with the first sample it accepts and reports both', () => {
    let width = 0.6;
    const grid = street((x) => fallsThrough(width)(x));
    const changed = vi.fn();
    grid.addCellsChangedListener(changed);
    // Its neighbours move: the fill follows them.
    grid.updateTerrainHeights();
    expect(changed).not.toHaveBeenCalled();

    // Finer tiles close the gap to a thin seam.
    width = 0;
    grid.updateTerrainHeights();
    const cell = grid.getCellAt(21, 1)!;
    expect(cell.sample.state).toBe('stable');
    expect(cell.terrainHeight).toBeCloseTo(2.15, 6);
    expect(changed.mock.calls.flatMap(([cells]) => cells)).toContain(cell);
  });

  it('leaves a cell without stable cells on opposite sides unsampled', () => {
    // A gap three cells wide.
    const grid = street((x) => (Math.abs(x - 21) < 2.6 ? null : seam(x)));
    grid.updateTerrainHeights();
    const cell = grid.getCellAt(21, 1)!;
    expect(cell.sample.state).toBe('unsampled');
    expect(overlayCellKind(cell) & 7).toBe(2);
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

  it('narrows to the cells the centre line runs through at a bottleneck', () => {
    // Half a cell either side. Centre line on a cell border: the cells on
    // both sides of it. Through cell centres: a single file.
    grid.generateFromRoutes([[at(0, 0, corridorConfig.minHalfWidth), at(40, 0)]]);
    expect(cellsAcross(10)).toBe(2);
    grid.generateFromRoutes([[at(0, 1, corridorConfig.minHalfWidth), at(40, 1)]]);
    expect(cellsAcross(10)).toBe(1);

    // On a diagonal, a staircase that holds every point of the centre line,
    // even with no width at all.
    for (const halfWidth of [corridorConfig.minHalfWidth, 0]) {
      grid.generateFromRoutes([[at(0.37, -0.61, halfWidth), at(40.37, 22.49)]]);
      for (let s = 0; s <= 1; s += 0.005) {
        expect(grid.getCellAt(0.37 + 40 * s, -0.61 + 23.1 * s), `hw ${halfWidth} s ${s}`).toBeDefined();
      }
    }
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
    for (const widths of [[1, 1, 1], [2, 2, 2], [2.75, 1, 2.75], [7, 2, 4], [1, 7, 1], [4.5, 3.5, 6]]) {
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
 * Playtest 2026-09-12 and 2026-09-14: edge cells sat on the eaves of houses
 * at the street, on a roof in an alley, on a parked van, on cars and
 * hedges. The photogrammetry has no ground under any of them, so the
 * column finds only their top. The cell keeps that height, the grid names
 * it as a cell no enemy could walk to, and the route service ends the
 * corridor before it (corridor-walk.ts).
 */
describe('GlobalRouteGrid cells an enemy could not walk to', () => {
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

  /** Centres of the cells the grid names as unwalkable, as "x,z". */
  const unwalkable = (grid: GlobalRouteGrid) => grid.unwalkableCells().map((c) => `${c.x},${c.z}`);

  it('keeps a cell whose column finds only a roof on the roof and names it', () => {
    const grid = build(street(6));
    // Centre (21, 3): under the roof, 2 m off the centre line.
    expect(grid.getCellAt(20.5, 3.5)!.terrainHeight).toBe(6);
    expect(unwalkable(grid)).toContain('21,3');
    expect(unwalkable(grid)).not.toContain('21,1');
    expect(unwalkable(grid)).not.toContain('21,-1');
    expect(grid.describeTowerRange('t1', 20, 1, 10).unwalkable).toBeGreaterThan(0);
    expect(grid.describeCellsAround(21, 3, 0.5, null)).toMatchObject([{ x: 21, z: 3, heightM: 6, walkable: false }]);
  });

  it('lets a rise below both thresholds be, and never judges a bridge deck', () => {
    // A 2 m rise is below roofRise; the step check would take it.
    corridorConfig.stepRise = 5;
    expect(build(street(2)).unwalkableCells()).toEqual([]);
    // Deck at 8 m over a street at 0: the edge cell stays on the deck.
    const bridge = build(street(0, 8), [at(0, 1, true), at(40, 1)]);
    expect(bridge.getCellAt(20.5, -0.5)!.terrainHeight).toBe(8);
    expect(bridge.unwalkableCells()).toEqual([]);
  });

  it('takes the threshold from corridorConfig.roofRise', () => {
    corridorConfig.stepRise = 5;
    corridorConfig.roofRise = 1.5;
    expect(unwalkable(build(street(2)))).toContain('21,3');
  });

  /**
   * Playtest 2026-09-14: cells stood on a parked van in an alley, and on
   * cars and hedges a little above the street. The clearance rays let the
   * corridor reach over them (only the low ray stops), and the photogrammetry
   * has no ground under a car either.
   */
  const column = (y: number): ColumnSample => ({ groundY: y, topY: y, tileDepth: 20, tileGeometricError: 2 });
  /** Street at 0 m, a car (roof 1.5 m) parked 1 to 3 m south of the centre line, the pavement at 0.15 m behind it. */
  const parked = (_x: number, z: number) => column(z > 2 && z < 4 ? 1.5 : z >= 4 ? 0.15 : 0);

  it('names a cell on a parked car, not the pavement behind it', () => {
    const grid = build(parked);
    // Centre (21, 3): on the car, at the car's roof.
    expect(grid.getCellAt(20.5, 3.5)!.terrainHeight).toBe(1.5);
    expect(unwalkable(grid)).toContain('21,3');
    // Centre (21, 5): the pavement, reached past the car.
    expect(grid.getCellAt(20.5, 5.5)!.terrainHeight).toBe(0.15);
    expect(unwalkable(grid)).not.toContain('21,5');

    // The same car on a quay, the river 5 m down north of the centre line:
    // the drop is no slope the car could stand on.
    const quay = build((x, z) => (z < 0 ? column(-5) : parked(x, z)));
    expect(unwalkable(quay)).toContain('21,3');
  });

  it('keeps the cells of a street across a slope walkable', () => {
    // A plane rising 0.5 m per metre southwards: 1 m from one cell to the
    // next, more than stepRise, but the ground falls as much on the other
    // side of the centre line.
    const grid = build((_x, z) => column((z - 1) * 0.5));
    expect(grid.getCellAt(20.5, 5.5)!.terrainHeight).toBe(2);
    expect(grid.getCellAt(20.5, 3.5)!.terrainHeight).toBe(1);
    expect(grid.unwalkableCells()).toEqual([]);
  });

  it('takes the step from corridorConfig.stepRise', () => {
    corridorConfig.stepRise = 2;
    expect(build(parked).unwalkableCells()).toEqual([]);
  });

  it('measures the edge cells at the head of a bridge from the deck, not from the water under it', () => {
    // A diagonal line, 7 m either side: around the last spot on the
    // embankment lie deck spots, whose lowest hit is the water 8 m down.
    const water = (x: number, z: number): ColumnSample => ((x + z) / 2 > 20 && (x + z) / 2 < 40
      ? { groundY: 0, topY: 8, tileDepth: 20, tileGeometricError: 2 }
      : { groundY: 8, topY: 8, tileDepth: 20, tileGeometricError: 2 });
    const wide = (x: number, z: number, onBridge?: boolean): RouteWaypoint =>
      ({ lat: z, lon: x, corridorLeft: 7, corridorRight: 7, onBridge });
    const grid = build(water, [wide(0, 0), wide(20, 20, true), wide(40, 40), wide(60, 60)]);
    expect(grid.getCellAt(17, 23)!.terrainHeight).toBe(8);
    expect(grid.unwalkableCells()).toEqual([]);
  });

  /**
   * Rothenburg, retest 560 to 563: the centre line of an alley runs under
   * a jetty whose column has no street under it (pick C, 5.7 m up), and
   * clips the corner of a roof (pick B, 7.6 m up). The corridor keeps
   * both cells at any width; they take the street.
   */
  it('puts a cell the centre line runs through on the street, not on a jetty or a roof corner over it', () => {
    const spot = (v: number) => (Math.floor(v / 2) + 0.5) * 2;
    const heights: Record<string, number> = { '-231,-57': 477, '-231,-55': 471.93 };
    const alley = (x: number, z: number) => column(heights[`${spot(x)},${spot(z)}`] ?? 471.25);
    const line = (x: number, z: number): RouteWaypoint => ({ lat: z, lon: x, corridorLeft: 1, corridorRight: 7 });
    const jetty = build(alley, [line(-235, -70), line(-229, -46)]);
    expect(jetty.getCellAt(-231, -57)!.terrainHeight).toBeLessThan(472);
    expect(jetty.getCellAt(-231, -57)!.sample.state).toBe('stable');
    // Its neighbour 0.65 m up under the jetty is no roof: it keeps its hit.
    expect(jetty.getCellAt(-231, -55)!.terrainHeight).toBe(471.93);

    const corner = (x: number, z: number) => column(spot(x) === -227 && spot(z) === -19 ? 480.57 : 472.9);
    const clipped = build(corner, [line(-230.9, -27.1), line(-224.9, -9.1)]);
    expect(clipped.getCellAt(-227, -19)!.terrainHeight).toBe(472.9);
  });

  it('keeps the cells of a centre line up a steep street where they are', () => {
    // 30 % along the line: 0.6 m from one spot to the next.
    const grid = build((x) => column(x * 0.3));
    expect(grid.getCellAt(21, 1)!.terrainHeight).toBeCloseTo(6.3, 9);
    expect(grid.getCellAt(39, 1)!.terrainHeight).toBeCloseTo(11.7, 9);
  });

  it('judges no cell sampled from a tile coarser than maxTileError', () => {
    expect(build((x, z) => ({ ...parked(x, z), tileGeometricError: 20 })).unwalkableCells()).toEqual([]);
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

  /** A deck at 8 m over water at 0 m from x = 30 to 60, as far as the columns are concerned; solid ground at 0 m either side. */
  const deck = (x: number): ColumnSample => ({ groundY: 0, topY: x >= 30 && x < 60 ? 8 : 0, tileDepth: 20, tileGeometricError: 2 });

  beforeEach(() => {
    grid = new GlobalRouteGrid();
    grid.initialize(deck as never, coordinateSync);
  });

  it('puts the cells of a bridge segment on the deck and the rest on the ground', () => {
    grid.generateFromRoutes([[at(0, 0), at(30, 0, true), at(60, 0), at(90, 0)]]);
    expect(grid.getGroundLocalYAt(15, 0.5)).toBe(0);
    expect(grid.getGroundLocalYAt(45, 0.5)).toBe(8);
    expect(grid.getGroundLocalYAt(75, 0.5)).toBe(0);
  });

  it('keeps the deck where the approach reaches it with its round end, and the approach where the bridge does', () => {
    // A gantry 20 m up over the approach just before the bridge, farther
    // over the deck (8 m) than the ground under it: a cell of the approach
    // stays under it, a deck cell would take its top.
    const gantry = new GlobalRouteGrid();
    gantry.initialize(((x: number) => (x > 26 && x < 30 ? { ...deck(x), topY: 20 } : deck(x))) as never, coordinateSync);
    gantry.generateFromRoutes([[at(0, 0), at(30, 0, true), at(60, 0)]]);
    // Centre (31, 1) lies along the bridge, 1.4 m from the approach's end;
    // (29, 1) along the approach, 1.4 m from the bridge's start.
    expect(gantry.getGroundLocalYAt(31, 0.5)).toBe(8);
    expect(gantry.getGroundLocalYAt(29, 0.5)).toBe(0);
    expect(gantry.getGroundLocalYAt(35, 0.5)).toBe(8);
  });

  /**
   * Playtest 2026-09-14, Paris, Pont d'Iéna: at both ends of the bridge the
   * red line, the cells and the enemies dropped under the deck. The quay
   * runs under the ends of the deck; the approaches' round ends, 7 m on a
   * 7 m corridor, made the first 7 m of the deck ground cells, which took
   * the lowest hit, the quay.
   */
  it('keeps the ends of a deck over a quay on the deck', () => {
    // Deck at 80 m from x = 30 to 90, the quay under it at 70 m; the
    // approaches on solid ground at 80 m either side.
    const quay = new GlobalRouteGrid();
    quay.initialize(((x: number) => (x > 30 && x < 90
      ? { groundY: 70, topY: 80, tileDepth: 20, tileGeometricError: 2 }
      : { groundY: 80, topY: 80, tileDepth: 20, tileGeometricError: 2 })) as never, coordinateSync);
    const wide = (x: number, onBridge?: boolean): RouteWaypoint =>
      ({ lat: 0, lon: x, corridorLeft: 7, corridorRight: 7, onBridge });
    quay.generateFromRoutes([[wide(0), wide(30, true), wide(90), wide(120)]]);

    // The cells at the two joints, where the red line takes its height, and
    // those across the first and last metres of the deck.
    expect(quay.getGroundLocalYAt(30, 0)).toBe(80);
    expect(quay.getGroundLocalYAt(90, 0)).toBe(80);
    for (const x of [31, 33, 35, 37, 83, 85, 87, 89]) {
      for (const z of [-5, -1, 1, 5]) expect(quay.getGroundLocalYAt(x, z), `${x}, ${z}`).toBe(80);
    }
  });

  /**
   * Playtest 2026-09-14, retest of item 564, Paris, Pont d'Iéna: the deck
   * reaches past both ends of the OSM bridge way, and the short ways that
   * continue it there (7 and 2 m at one head, 31 m at the other) carry no
   * bridge tag. Their cells, the red line and the enemies were on the quay
   * 8 to 9.5 m under the deck.
   */
  describe('past the ends of the bridge way', () => {
    /** Deck at 80 m from x = 18 to 104, 18 m wide, over a quay at 70 m; solid ground at 80 m round it. */
    const head = (x: number, z: number): ColumnSample => (x > 18 && x < 104 && Math.abs(z) < 9
      ? { groundY: 70, topY: 80, tileDepth: 20, tileGeometricError: 2 }
      : x > 18 && x < 104
        ? { groundY: 70, topY: 70, tileDepth: 20, tileGeometricError: 2 }
        : { groundY: 80, topY: 80, tileDepth: 20, tileGeometricError: 2 });
    const wide = (x: number, onBridge?: boolean): RouteWaypoint =>
      ({ lat: 0, lon: x, corridorLeft: 7, corridorRight: 7, onBridge });
    /** A road, ways of 8 and 6 m, the bridge way 30 to 90, ways of 6 and 34 m, a road. */
    const route = [wide(0), wide(16), wide(24), wide(30, true), wide(90), wide(96), wide(130), wide(150)];

    function build(column: (x: number, z: number) => ColumnSample, routes: RouteWaypoint[][]): GlobalRouteGrid {
      const built = new GlobalRouteGrid();
      built.initialize(column as never, coordinateSync);
      built.generateFromRoutes(routes);
      return built;
    }

    it('keeps the cells, the red line and the enemies on the deck over the ways off it', () => {
      const bridge = build(head, [route]);
      for (const x of [19, 21, 23, 25, 27, 29, 91, 93, 95, 97, 99, 101, 103]) {
        for (const z of [-5, -1, 1, 5]) expect(bridge.getGroundLocalYAt(x, z), `${x}, ${z}`).toBe(80);
      }
      // The red line takes its heights at the waypoints, the enemies from the cells.
      for (const x of [24, 30, 90, 96]) expect(bridge.getGroundLocalYAt(x, 0), `waypoint ${x}`).toBe(80);
      expect(bridge.getCellAt(25, 5)).toMatchObject({ surface: 'approach' });
      expect(bridge.getCellAt(25, 5)!.deckEnd!.path[0]).toEqual({ x: 30, z: 0 });
      // The walk check judges them from the centre line on the deck.
      expect(bridge.unwalkableCells()).toEqual([]);
      // Beside the deck, over the open quay, the ground.
      expect(build(head, [route.map((w) => ({ ...w, corridorLeft: 11, corridorRight: 11 }))]).getGroundLocalYAt(25, 10)).toBe(70);
    });

    /**
     * Playtest 2026-09-14, Erlenbach: Weinsberger Straße runs under an
     * Autobahn bridge that is no way of the route. With its street in the
     * columns, a way under a deck of no route way keeps its ground, also
     * right past the end of a bridge of its own route.
     */
    it('leaves a street under a deck of no route way on its ground', () => {
      // A deck 10 m up from x = 110 to 125 over solid ground at 80 m, 30 m wide.
      const overpass = (x: number, z: number): ColumnSample => (x > 110 && x < 125 && Math.abs(z) < 15
        ? { groundY: 80, topY: 90, tileDepth: 20, tileGeometricError: 2 }
        : head(x, z));
      const bridge = build(overpass, [route]);
      // Past the east end of the route's bridge (x = 90): approach cells, on their ground.
      expect(bridge.getCellAt(117, 1)).toMatchObject({ surface: 'approach', terrainHeight: 80 });
      expect(bridge.getCellAt(117, 5)).toMatchObject({ surface: 'approach', terrainHeight: 80 });
      // A street of its own under it, far from any bridge of the route.
      const street = [{ lat: -40, lon: 117, corridorLeft: 5, corridorRight: 5 }, { lat: 40, lon: 117 }];
      const under = build((x, z) => (Math.abs(z) < 15 ? overpass(x, z) : { groundY: 80, topY: 80, tileDepth: 20, tileGeometricError: 2 }), [street]);
      for (const z of [-11, -1, 1, 11]) expect(under.getCellAt(117, z)).toMatchObject({ surface: 'ground', terrainHeight: 80 });
      expect(under.unwalkableCells()).toEqual([]);
    });

    it('carries the deck no further than DECK_APPROACH_M past the end of the bridge way', () => {
      // The deck and the route on to x = 190 this time.
      const long = (x: number, z: number) => head(Math.min(x, 100), z);
      const bridge = build(long, [[...route.slice(0, -1), wide(190)]]);
      expect(bridge.getGroundLocalYAt(147, 1)).toBe(80);
      // Centre (153, 1): 63 m past the end at x = 90.
      expect(bridge.getGroundLocalYAt(153, 1)).toBe(70);
    });

    /**
     * A junction right past a bridge end where the route turns, over a road
     * under the square there (the case named for the retest 2026-09-15; the
     * picks came from Place de Varsovie, below).
     */
    it('keeps the square round a corner right past a bridge end on its level, over a road under it', () => {
      // Past the east end (x = 90) a square at 80 m, a road under it at 71 m from x = 92 to 100.
      const square = (x: number, z: number): ColumnSample => (x < 90 ? head(x, z)
        : x > 92 && x < 100 && z > -9 && z < 30 ? { groundY: 71, topY: 80, tileDepth: 20, tileGeometricError: 2 }
          : { groundY: 80, topY: 80, tileDepth: 20, tileGeometricError: 2 });
      const off = (x: number, z: number): RouteWaypoint => ({ lat: z, lon: x, corridorLeft: 7, corridorRight: 7 });
      // A junction 6 m past the end, then south along x = 96.
      const bridge = build(square, [[wide(0), wide(16), wide(24), wide(30, true), wide(90), off(96, 0), off(96, 40)]]);
      for (const x of [93, 95, 97, 99]) {
        for (const z of [5, 11, 17, 25]) expect(bridge.getGroundLocalYAt(x, z), `${x}, ${z}`).toBe(80);
      }
      // The red line takes its heights at the waypoints.
      for (const z of [0, 40]) expect(bridge.getGroundLocalYAt(96, z), `waypoint 96, ${z}`).toBe(80);
      expect(bridge.getCellAt(95, 11)).toMatchObject({ surface: 'approach' });
      // Nothing on the square is unwalkable. West of x = 90, beside the
      // bridge, the ground lies 10 m under it: the drop check (stepDrop)
      // ends the corridor there.
      const unwalkable = bridge.unwalkableCells();
      expect(unwalkable.filter((c) => c.x > 90)).toEqual([]);
      expect(unwalkable.every((c) => c.x < 90 && c.terrainHeight === 70)).toBe(true);
    });

    /**
     * Retest 2026-09-15, Paris, Pont d'Iéna, head at Place de Varsovie: the
     * route comes down a way of 34 m, turns 35 degrees onto Avenue de New
     * York (18 m) and 90 degrees onto a way of 9 m to the bridge way. The
     * columns of the road there have a second surface 1.2 to 3.9 m under it
     * in the same tile (picks A and C), at one spot the road 10 m below
     * (pick B). The turn ended the stretch after 9 m, and the cells behind
     * it took the surface under the road.
     */
    it('keeps the road over a hollow on its level where the route turns twice before a bridge', () => {
      const under = (groundY: number): ColumnSample => ({ groundY, topY: 80, tileDepth: 20, tileGeometricError: 2 });
      // The road at 80 m; along x = 21.3 from z = -16 to -1 a surface 1.3 to 3 m under it, round (21.3, -17.6) the road 10 m under it.
      const varsovie = (x: number, z: number): ColumnSample => {
        if (Math.abs(x - 21.3) < 4 && z > -16 && z < -1) return under(z < -8 ? 77 : 78.7);
        if (Math.hypot(x - 21.3, z + 17.6) < 3) return under(70);
        return x >= 30 && x < 90 ? under(70) : under(80);
      };
      const off = (x: number, z: number, onBridge?: boolean): RouteWaypoint =>
        ({ lat: z, lon: x, corridorLeft: 3, corridorRight: 3, onBridge });
      // In travel order: 34.4 m, a turn of 35 degrees, 17.6 m, a turn of 90 degrees, 8.7 m, the bridge 30 to 90.
      const bridge = build(varsovie, [[off(1.57, -45.78), off(21.3, -17.6), off(21.3, 0), off(30, 0, true), off(90, 0), off(120, 0)]]);
      for (const x of [19, 21, 23]) {
        for (const z of [-19, -17, -15, -11, -7, -3]) expect(bridge.getGroundLocalYAt(x, z), `${x}, ${z}`).toBe(80);
      }
      // The red line takes its heights at the waypoints.
      for (const z of [-17.6, 0]) expect(bridge.getGroundLocalYAt(21.3, z), `waypoint 21.3, ${z}`).toBe(80);
      expect(bridge.getCellAt(21, -11)).toMatchObject({ surface: 'approach' });
      expect(bridge.unwalkableCells()).toEqual([]);
    });

    it('follows stairs off a bridge end down to the quay, and keeps the quay under a deck there', () => {
      // Off the east end (x = 90) south: the deck to z = 9, stairs down to
      // the quay from z = 9 to 25 (1.25 m every 2 m), then the quay, under
      // another deck at 80 m from z = 36 to 44.
      const stairs = (x: number, z: number): ColumnSample => {
        if (x > 84 && x < 96 && z >= 9 && z < 25) {
          const y = 80 - (z - 9) * 0.625;
          return { groundY: y, topY: y, tileDepth: 20, tileGeometricError: 2 };
        }
        if (x > 80 && x < 100 && z > 36 && z < 44) return { groundY: 70, topY: 80, tileDepth: 20, tileGeometricError: 2 };
        return head(x, z);
      };
      const off = (x: number, z: number): RouteWaypoint => ({ lat: z, lon: x, corridorLeft: 3, corridorRight: 3 });
      const bridge = build(stairs, [[wide(0), wide(16), wide(24), wide(30, true), off(90, 0), off(90, 9), off(90, 25), off(90, 60)]]);
      // Centre (89, 13) and (91, 13): 2.5 m down the stairs.
      expect(bridge.getGroundLocalYAt(89, 13)).toBe(77.5);
      expect(bridge.getGroundLocalYAt(91, 13)).toBe(77.5);
      for (const z of [37, 39, 41, 43]) {
        expect(bridge.getCellAt(91, z), `91, ${z}`).toMatchObject({ surface: 'approach', terrainHeight: 70 });
      }
    });

    it('leaves a street under the deck on the ground', () => {
      // A street along x = 99, 3 m either side, under the way off the east end.
      const under = [{ lat: -30, lon: 99, corridorLeft: 3, corridorRight: 3 }, { lat: 30, lon: 99 }];
      for (const routes of [[route, under], [under, route]]) {
        const grid2 = build(head, routes);
        expect(grid2.getGroundLocalYAt(99, 1)).toBe(70);
        expect(grid2.getGroundLocalYAt(99, 5)).toBe(70);
        expect(grid2.getGroundLocalYAt(99, 20)).toBe(70);
        expect(grid2.getGroundLocalYAt(93, 1)).toBe(80);
      }
    });

    it('keeps a street by a tree crown or a statue on its ground, off the bridge and past its end', () => {
      // A crown 8 m and a statue 5 m high over solid ground at 80 m, at x = 121 (way off the bridge) and 41 m south of it.
      const objects = (x: number, z: number): ColumnSample =>
        Math.abs(x - 121) < 1 && z > 4 && z < 6 ? { groundY: 80, topY: 88, tileDepth: 20, tileGeometricError: 2 }
          : Math.abs(x - 121) < 1 && z > 44 && z < 46 ? { groundY: 80, topY: 85, tileDepth: 20, tileGeometricError: 2 }
            : head(x, z);
      const street = [{ lat: 45, lon: 100, corridorLeft: 3, corridorRight: 3 }, { lat: 45, lon: 140 }];
      const grid2 = build(objects, [route, street]);
      expect(grid2.getCellAt(121, 5)).toMatchObject({ surface: 'approach', terrainHeight: 80 });
      expect(grid2.getCellAt(121, 45)).toMatchObject({ surface: 'ground', terrainHeight: 80 });
    });
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
 * In a tunnel or covered passage a column sees only the hill or the building
 * above it. Its cells take the ground just outside the two mouths instead,
 * interpolated along the stretch.
 */
describe('GlobalRouteGrid tunnels', () => {
  const coordinateSync = {
    geoToLocalSimple: (lat: number, lon: number) => ({ x: lon, y: 0, z: lat }),
  } as never;
  const at = (x: number, z: number, inTunnel?: boolean): RouteWaypoint =>
    ({ lat: z, lon: x, corridorLeft: 3, corridorRight: 3, inTunnel });
  /** Eastbound along z = 1, in a tunnel from x = 20 to 40. */
  const route = [at(0, 1), at(20, 1, true), at(40, 1), at(60, 1)];
  /** Ground at 0 m west of the hill, 10 m east of it, the hill top at 30 m over the tunnel. */
  const hill = (x: number): ColumnSample | null => ({
    groundY: x > 20 && x < 40 ? 30 : x <= 20 ? 0 : 10, topY: 30, tileDepth: 20, tileGeometricError: 2,
  });

  function build(column: (x: number, z: number) => ColumnSample | null, passage = route): GlobalRouteGrid {
    const grid = new GlobalRouteGrid();
    grid.initialize(column as never, coordinateSync);
    grid.generateFromRoutes([passage]);
    return grid;
  }

  /**
   * Playtest 2026-09-15, retest 607, Rothenburg: in the narrow passage of
   * an archway the yellow cells climbed, and enemies came out of the house
   * on the other side. A portal 2 m outside a mouth can lie under the jetty
   * of the house the passage runs through, or on the house itself where the
   * OSM way ends short of the opening; its column has no street under it.
   */
  it('takes a portal under a jetty from the street around it', () => {
    // Street at 0 m; the house over the passage (x 20 to 30) 10 m high, its
    // jetty over the street up to x = 33 with its underside at 4 m.
    const house = (x: number): ColumnSample => {
      const y = x > 20 && x < 30 ? 10 : x >= 30 && x < 33 ? 4 : 0;
      return { groundY: y, topY: y, tileDepth: 20, tileGeometricError: 2 };
    };
    const grid = build(house, [at(0, 1), at(20, 1, true), at(30, 1), at(60, 1)]);
    // Portals at x = 18 and 32; cells up to 3 m past each mouth are the tunnel's.
    for (const x of [21, 25, 29, 31, 33]) {
      expect(grid.getCellAt(x, 1)!.surface, `${x}`).toBe('tunnel');
      expect(grid.getCellAt(x, 1)!.terrainHeight, `${x}`).toBeCloseTo(0, 6);
    }
    expect(grid.getCellAt(35, 1)!.terrainHeight).toBe(0);
  });

  it('puts the cells between the ground outside the two mouths', () => {
    const grid = build(hill);
    // Portals 2 m outside the mouths, at x = 18 (0 m) and 42 (10 m), 24 m apart.
    const inside = grid.getCellAt(31, 1)!;
    expect(inside.surface).toBe('tunnel');
    expect(inside.terrainHeight).toBeCloseTo((10 * 13) / 24, 6);
    expect(grid.getCellAt(10, 1)!.surface).toBe('ground');
    expect(grid.getCellAt(10, 1)!.terrainHeight).toBe(0);
    expect(grid.getCellAt(50, 1)!.terrainHeight).toBe(10);
  });

  it('makes a cell in the mouth that the approach reaches too a tunnel cell', () => {
    const grid = build(hill);
    // Centre (21, 1): 1 m from the approach, on the hill's column.
    const mouth = grid.getCellAt(21, 1)!;
    expect(mouth.surface).toBe('tunnel');
    expect(mouth.terrainHeight).toBeCloseTo((10 * 3) / 24, 6);
  });

  it('leaves the cells unsampled until both portals have a tile', () => {
    const grid = build((x) => (x > 41 ? null : hill(x)));
    const inside = grid.getCellAt(31, 1)!;
    expect(inside.sample.state).toBe('unsampled');
    expect(inside.heightSampled).toBe(false);
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

describe('GlobalRouteGrid nearest cell', () => {
  const coordinateSync = {
    geoToLocalSimple: (lat: number, lon: number) => ({ x: lon, y: 0, z: lat }),
  } as never;
  /** Straight route along x through the origin; cell centres sit at odd x and z. */
  const route = [[{ lat: 0, lon: -20 }, { lat: 0, lon: 20 }]];

  let grid: GlobalRouteGrid;

  beforeEach(() => {
    const sampler = () => ({ groundY: 0, topY: 0, tileDepth: 20, tileGeometricError: 2 });
    grid = new GlobalRouteGrid();
    grid.initialize(sampler as never, coordinateSync);
    grid.generateFromRoutes(route as never);
  });

  it('picks the cell whose centre is nearest to the point', () => {
    expect(grid.findNearestCell(5.2, 1.1, 30)).toMatchObject({ x: 5, z: 1 });
  });

  it('reaches a route beside the point, up to the given distance', () => {
    const cell = grid.findNearestCell(5, 28, 30)!;
    expect(cell).toBeDefined();
    expect(Math.hypot(cell.x - 5, cell.z - 28)).toBeLessThanOrEqual(30);
  });

  it('finds nothing when no cell is within the distance', () => {
    expect(grid.findNearestCell(5, 40, 30)).toBeUndefined();
    expect(grid.findNearestCell(60, 0, 30)).toBeUndefined();
  });

  it('breaks ties the same way every time: first cell in scan order', () => {
    // (6, 0) is equally far from the centres (5, -1), (5, 1), (7, -1), (7, 1)
    expect(grid.findNearestCell(6, 0, 30)).toMatchObject({ x: 5, z: -1 });
  });
});
