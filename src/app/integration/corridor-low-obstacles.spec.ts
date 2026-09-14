/**
 * Integration Test: low obstacles the clearance rays find narrow the corridor
 *
 * User decision after the playtest of 2026-09-14 (front gardens, option a):
 * what stops only the low ray counts as a wall where the ground behind it
 * is raised, so parked cars and vans narrow the corridor, and so does a
 * front garden raised above the pavement. Thin obstacles are still closed.
 *
 * Synthetic tiles: one 2.5D mesh with no ground under a car, as in the
 * photogrammetry, cut into 5 m tiles of the finest LOD. The chain is the
 * one ClearanceRun and fitRoute in PathAndRouteService run: a probe per
 * station (TerrainQueries.measureStreetClearance), its free space and low
 * walls (probeFreeSpace, probeLowWall), the fit along the route and closing
 * short narrowings; then the grid from the pieces. `lowWallRise: 50` turns
 * the rule off, which gives the corridor as it was before.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial } from 'three';
import type { TilesRenderer } from '3d-tiles-renderer';
import { TerrainQueries } from '../three-engine/terrain-queries';
import type { EllipsoidSync } from '../three-engine/ellipsoid-sync';
import { GlobalRouteGrid } from '../utils/global-route-grid';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from '../utils/geo-utils';
import {
  CorridorPiece,
  StationProbe,
  closeShortNarrowings,
  corridorConfig,
  fitCorridorPieces,
  fitCorridorStations,
  probeFreeSpace,
  probeLowWall,
  resetCorridorConfig,
} from '../utils/route-corridor';
import type { RouteWaypoint } from '../models/game.types';

afterEach(() => resetCorridorConfig());

/** The street: eastbound along z = 1 from x = 0 to 40, the middle of a row of 2 m cells; right of travel is +z. */
const LENGTH = 40;
const STATIONS = 20;
const LINE_Z = 1;

/** Height of the mesh at local (x, z): the top of whatever stands there, a car without ground under it. */
type Ground = (x: number, z: number) => number;

const material = new MeshBasicMaterial({ side: DoubleSide });

/** 0.25 m between vertices, 20 quads a tile. The lattice lies 0.1 m off whole metres, so no station column hits a vertex or a tile edge. */
const STEP = 0.25;
const QUADS = 20;

/** TerrainQueries over the mesh of `ground`, x -4.4 to 45.6 and z -8.9 to 11.1. */
function tiles(ground: Ground): TerrainQueries {
  const group = new Group();
  const activeTiles = new Set<unknown>();
  for (let tx = 0; tx < 10; tx++) {
    for (let tz = 0; tz < 4; tz++) {
      const x0 = -4.4 + tx * QUADS * STEP;
      const z0 = -8.9 + tz * QUADS * STEP;
      const positions: number[] = [];
      for (let j = 0; j <= QUADS; j++) {
        for (let i = 0; i <= QUADS; i++) positions.push(x0 + i * STEP, ground(x0 + i * STEP, z0 + j * STEP), z0 + j * STEP);
      }
      const index: number[] = [];
      for (let j = 0; j < QUADS; j++) {
        for (let i = 0; i < QUADS; i++) {
          const a = j * (QUADS + 1) + i;
          index.push(a, a + QUADS + 1, a + 1, a + 1, a + QUADS + 1, a + QUADS + 2);
        }
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      geometry.setIndex(index);
      const mesh = new Mesh(geometry, material);
      const tile = { internal: { depth: 3 }, geometricError: 2, engineData: { scene: mesh } };
      mesh.userData['tile'] = tile;
      group.add(mesh);
      activeTiles.add(tile);
    }
  }
  group.updateMatrixWorld(true);
  const renderer = { group, activeTiles } as unknown as TilesRenderer;
  return new TerrainQueries({} as EllipsoidSync, { tiles: () => renderer, devTerrain: () => null });
}

/** A box `height` m high over x0..x1, z0..z1, else `under`. */
const box = (x0: number, x1: number, z0: number, z1: number, height: number, under: Ground): Ground =>
  (x, z) => (x >= x0 && x <= x1 && z >= z0 && z <= z1 ? height : under(x, z));

/** The street at 0 m, the pavement 0.15 m up from 4.8 m right of the centre line (z 5.8). */
const street: Ground = (_x, z) => (z >= 5.8 ? 0.15 : 0);

/** A car 1.8 m wide and 1.5 m high from x0, its side 2.9 m right of the centre line, at the pavement. */
const car = (x0: number, under: Ground, length = 4.5, height = 1.5, width = 1.8): Ground => box(x0, x0 + length, 3.9, 3.9 + width, height, under);

/** Every station of the street, probed as ClearanceRun does. */
function measure(queries: TerrainQueries): StationProbe[] {
  return Array.from({ length: STATIONS }, (_, k) =>
    queries.measureStreetClearance(
      ((k + 0.5) / STATIONS) * LENGTH, LINE_Z, 0, 1,
      [corridorConfig.rayHeightLow, corridorConfig.rayHeightHigh], corridorConfig.maxHalfWidth,
    )!);
}

const free = (probes: StationProbe[], side: 'left' | 'right') => probes.map((p) => +probeFreeSpace(p, side).toFixed(2));

/** The street's corridor pieces from its probes, as fitRoute builds them. */
function corridor(probes: StationProbe[]): CorridorPiece[] {
  const segment = {
    left: probes.map((p) => probeFreeSpace(p, 'left')),
    right: probes.map((p) => probeFreeSpace(p, 'right')),
    fallback: 2.75,
    onStreet: true,
    lowWallLeft: probes.map((p) => probeLowWall(p, 'left')),
    lowWallRight: probes.map((p) => probeLowWall(p, 'right')),
  };
  return closeShortNarrowings(fitCorridorPieces([segment]), [LENGTH], [false])[0];
}

/** Half width on `side` at every station. */
const widths = (pieces: CorridorPiece[], side: 'left' | 'right') =>
  Array.from({ length: STATIONS }, (_, k) => pieces.filter((p) => p.t <= (k + 0.5) / STATIONS).pop()![side]);

/** A value per station: `open`, and `other` at the stations `ks`. */
const expected = (open: number, ks: number[] = [], other = open) =>
  Array.from({ length: STATIONS }, (_, k) => (ks.includes(k) ? other : open));

const ORIGIN = { lat: 48.776, lon: 9.183 };
const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(ORIGIN.lat * DEG_TO_RAD);
/** The flat projection EllipsoidSync.geoToLocalSimple uses: x east, z south. */
const sync = {
  geoToLocalSimple: (lat: number, lon: number, height: number) => ({
    x: (lon - ORIGIN.lon) * M_PER_DEG_LON,
    y: height,
    z: -(lat - ORIGIN.lat) * METERS_PER_DEGREE_LAT,
  }),
};
const at = (x: number, z: number, left?: number, right = left): RouteWaypoint => ({
  lat: ORIGIN.lat - z / METERS_PER_DEGREE_LAT,
  lon: ORIGIN.lon + x / M_PER_DEG_LON,
  corridorLeft: left,
  corridorRight: right,
});

/** The grid of the street with `pieces` as its corridor. */
function grid(queries: TerrainQueries, pieces: CorridorPiece[]): GlobalRouteGrid {
  const route = pieces.map((p) => at(p.t * LENGTH, LINE_Z, p.left, p.right));
  route.push(at(LENGTH, LINE_Z));
  const built = new GlobalRouteGrid();
  built.initialize((x, z) => queries.sampleColumn(x, z), sync as never);
  built.generateFromRoutes([route]);
  return built;
}

/** Cells right of the centre line at the station x of every station, one row of 2 m cells per entry of `rows` (cell centre z). */
const cellsRight = (built: GlobalRouteGrid, rows: number[]) =>
  rows.map((z) => Array.from({ length: STATIONS }, (_, k) => built.getCellAt(2 * k + 1, z)).filter(Boolean).length);

describe('Corridor at low obstacles the clearance rays find', () => {
  it('narrows at a parked car over its length', () => {
    // 4.5 m long from x 10.3: stations 5 and 6 (x 11 and 13) pass it.
    const probes = measure(tiles(car(10.3, street)));
    // The low ray hits the flank of its mesh, the column 1 m behind is its roof.
    expect(free(probes, 'right')).toEqual(expected(7, [5, 6], 3.02));
    expect(probes[5].lowRise?.right).toBeCloseTo(1.5, 1);

    const pieces = corridor(probes);
    // 3.02 m to the car less the 0.5 m wall margin, rounded down; two
    // stations, shorter than dipLength, and kept.
    expect(widths(pieces, 'right')).toEqual(expected(7, [5, 6], 2.5));
    expect(widths(pieces, 'left')).toEqual(expected(7));
    expect(pieces.find((p) => p.right === 2.5)!.t * LENGTH).toBe(10);
    expect(fitCorridorStations([{
      left: free(probes, 'left'), right: free(probes, 'right'), fallback: 2.75, onStreet: true,
      lowWallRight: probes.map((p) => probeLowWall(p, 'right')),
    }]).right[0][5].rule).toBe('low obstacle, raised behind, wall less margin');

    corridorConfig.lowWallRise = 50;
    expect(widths(corridor(measure(tiles(car(10.3, street)))), 'right')).toEqual(expected(7));
  });

  it('narrows at a van 6 m long and 2.6 m high, under the high ray', () => {
    // Its flank in the mesh is steeper than the car's: the low ray hits it at 2.95 m.
    const probes = measure(tiles(car(20.3, street, 6, 2.6, 2)));
    expect(free(probes, 'right')).toEqual(expected(7, [10, 11, 12], 2.95));
    expect(widths(corridor(probes), 'right')).toEqual(expected(7, [10, 11, 12], 2));
  });

  it('still closes a lamp post, which stops both rays', () => {
    // Its mesh 0.25 m wide at the top, 5 m high, 2.8 m right of the centre line at x 31 (station 15).
    const probes = measure(tiles(box(30.8, 31.2, 3.8, 4.2, 5, street)));
    expect(probes[15].right[0]).toBeLessThan(3);
    expect(probes[15].lowRise?.right).toBeNaN();
    expect(widths(corridor(probes), 'right')).toEqual(expected(7));
  });

  /** A front garden behind the pavement (0.15 m, from 3 m right) from x 10.3 to 22.3: its ground `bed` m up, a hedge 1.2 m high on its front edge. */
  const garden = (bed: number): Ground => {
    const pavement: Ground = (_x, z) => (z >= 4 ? 0.15 : 0);
    const ground = box(10.3, 22.3, 6.2, 11.1, bed, pavement);
    return box(10.3, 22.3, 6.2, 6.7, bed + 1.2, ground);
  };

  it('narrows at a front garden raised 0.4 m above the pavement', () => {
    const probes = measure(tiles(garden(0.55)));
    expect(free(probes, 'right')).toEqual(expected(7, [5, 6, 7, 8, 9, 10], 5.23));
    expect(probes[5].lowRise?.right).toBeCloseTo(0.55, 2);
    expect(widths(corridor(probes), 'right')).toEqual(expected(7, [5, 6, 7, 8, 9, 10], 4.5));
  });

  it('keeps a front garden flush with the pavement in the corridor', () => {
    const probes = measure(tiles(garden(0.15)));
    // The hedge stops the low ray; the column behind it is the garden, 0.15 m up.
    expect(probes[5].right[0]).toBeCloseTo(5.28, 2);
    expect(probes[5].lowRise?.right).toBeCloseTo(0.15, 2);
    expect(widths(corridor(probes), 'right')).toEqual(expected(7));
  });

  it('does not narrow for a kerb 0.15 m high with a fence on its edge', () => {
    // The fence 1.35 m high where the pavement starts, 3 m right of the centre line, from x 10.3 to 30.3.
    const pavement: Ground = (_x, z) => (z >= 4 ? 0.15 : 0);
    const probes = measure(tiles(box(10.3, 30.3, 4, 4.2, 1.35, pavement)));
    expect(probes[8].right[0]).toBeCloseTo(3.04, 2);
    expect(probes[8].lowRise?.right).toBeCloseTo(0.15, 2);
    expect(widths(corridor(probes), 'right')).toEqual(expected(7));
  });

  it('ends the corridor at a row of parked cars, gaps and a driveway included', () => {
    // Six cars 1 m apart, a 5.5 m driveway between the third and the fourth.
    let ground = street;
    for (const x0 of [2.3, 7.8, 13.3, 23.3, 28.8, 34.3]) ground = car(x0, ground);
    const queries = tiles(ground);
    const probes = measure(queries);
    // Stations 0, 3, 6, 9 to 11 and 19 pass between the cars.
    expect(free(probes, 'right')).toEqual(expected(3.02, [0, 3, 6, 9, 10, 11, 19], 7));

    // The gaps, up to bulgeLength, are cut: one straight edge 2.5 m right of the centre line.
    const pieces = corridor(probes);
    expect(widths(pieces, 'right')).toEqual(expected(2.5));
    // Cells right of the line, rows 2, 4 and 6 m off: the street only, not the cars and the pavement behind them.
    expect(cellsRight(grid(queries, pieces), [3, 5, 7])).toEqual([20, 0, 0]);

    corridorConfig.lowWallRise = 50;
    const before = corridor(measure(queries));
    expect(widths(before, 'right')).toEqual(expected(7));
    expect(cellsRight(grid(queries, before), [3, 5, 7])).toEqual([20, 20, 20]);
  });

  it('keeps an alley at its minimum, the cells of the centre line included', () => {
    // Facades 2.5 m either side; a small car (1.6 m wide, 1.4 m high) from
    // 0.3 m right of the centre line, x 10.3 to 14.3 (stations 5 and 6).
    const facades: Ground = (_x, z) => (z <= LINE_Z - 2.5 || z >= LINE_Z + 2.5 ? 20 : 0);
    const queries = tiles(box(10.3, 14.3, 1.3, 2.9, 1.4, facades));
    const probes = measure(queries);
    expect(probes[5].right[0]).toBeCloseTo(0.28, 2);

    const pieces = corridor(probes);
    // 0.28 m less the margin is below minHalfWidth; closing short narrowings keeps the minimum.
    expect(widths(pieces, 'right')).toEqual(expected(1.5, [5, 6], 1));
    expect(widths(pieces, 'left')).toEqual(expected(1.5));
    const built = grid(queries, pieces);
    expect([5, 6].map((k) => built.getCellAt(2 * k + 1, LINE_Z) !== undefined)).toEqual([true, true]);
    expect(cellsRight(built, [3])).toEqual([0]);

    corridorConfig.lowWallRise = 50;
    const before = corridor(measure(queries));
    expect(widths(before, 'right')).toEqual(expected(1.5));
    expect(cellsRight(grid(queries, before), [3])).toEqual([0]);
  });
});
